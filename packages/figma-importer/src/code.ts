import type {
  Document as StudioDocument,
  FillPaint as StudioFillPaint,
  GroupDefinition as StudioGroup,
  Page as StudioPage,
  SceneNode as StudioNode,
  StrokePaint as StudioStrokePaint,
  StudioInterchangePackage,
} from "@webmcp/document"

type StudioFrame = Extract<StudioNode, { type: "frame" }>
type StudioSection = Extract<StudioNode, { type: "section" }>
type StudioText = Extract<StudioNode, { type: "text" }>
type StudioImage = Extract<StudioNode, { type: "image" }>
type StudioPaintNode = Extract<
  StudioNode,
  {
    type:
      | "rect"
      | "ellipse"
      | "icon"
      | "frame"
      | "section"
      | "polygon"
      | "star"
      | "vector"
      | "boolean_result"
  }
>

type ImportRequest =
  | { type: "close" }
  | { type: "import-package"; payload: unknown }
  | { type: "import-url"; url: string }

type ImportResult = {
  pages: number
  layers: number
  warnings: string[]
  firstPage?: PageNode
  firstFrame?: FrameNode
}

type Point = { x: number; y: number }

type ImportedNode =
  | TextNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | FrameNode
  | PolygonNode
  | StarNode

type GroupableNode = ImportedNode | GroupNode

type ImportContext = {
  package: StudioInterchangePackage
  document: StudioDocument
  sourceUrl?: string
  nodesById: Map<string, StudioNode>
  frameOwnerByNodeId: Map<string, string>
  figmaNodesByStudioId: Map<string, ImportedNode>
  figmaGroupsByStudioId: Map<string, GroupNode>
  imageHashes: Map<string, Promise<string | undefined>>
  availableFonts: Promise<ReadonlyArray<Font>>
  warnings: Set<string>
  layers: number
}

const PLUGIN_DATA_NODE_ID = "webmcpStudioNodeId"
const PLUGIN_DATA_PAGE_ID = "webmcpStudioPageId"
const PLUGIN_DATA_GROUP_ID = "webmcpStudioGroupId"
const PLUGIN_DATA_DOCUMENT_ID = "webmcpStudioDocumentId"
const PLUGIN_DATA_NODE_TYPE = "webmcpStudioNodeType"
const PLUGIN_DATA_FORMAT_VERSION = "webmcpStudioInterchangeVersion"

figma.showUI(__html__, {
  width: 420,
  height: 520,
  themeColors: true,
})

figma.ui.onmessage = async (message: ImportRequest) => {
  if (message.type === "close") {
    figma.closePlugin()
    return
  }

  try {
    let payload: unknown
    let sourceUrl: string | undefined
    if (message.type === "import-url") {
      sourceUrl = parseHandoffUrl(message.url)
      postProgress("Fetching the Studio package...")
      const response = await fetch(sourceUrl, {
        headers: { accept: "application/json" },
      })
      if (!response.ok) {
        throw new Error(
          `The handoff request failed with ${response.status} ${response.statusText}.`
        )
      }
      payload = await response.json()
    } else {
      payload = message.payload
    }

    const interchange = readInterchangePackage(payload)
    postProgress("Rebuilding editable layers...")
    const result = await importInterchange(interchange, sourceUrl)
    if (result.firstPage) await figma.setCurrentPageAsync(result.firstPage)
    if (result.firstFrame) {
      figma.currentPage.selection = [result.firstFrame]
      figma.viewport.scrollAndZoomIntoView([result.firstFrame])
    }
    figma.notify(
      `Imported ${result.layers} editable layers across ${result.pages} pages.`,
      { timeout: 4_000 }
    )
    figma.ui.postMessage({
      type: "complete",
      pages: result.pages,
      layers: result.layers,
      warnings: result.warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    figma.notify(message, { error: true, timeout: 6_000 })
    figma.ui.postMessage({ type: "error", message })
  }
}

function postProgress(message: string) {
  figma.ui.postMessage({ type: "progress", message })
}

function parseHandoffUrl(input: string): string {
  const value = input.trim()
  const isHttps = /^https:\/\/[^\s/?#]+(?::\d+)?(?:[/?#]|$)/i.test(value)
  const isLocalhost = /^http:\/\/localhost(?::\d+)?(?:[/?#]|$)/i.test(value)
  if (!isHttps && !isLocalhost) {
    throw new Error("Handoff URLs must use HTTPS.")
  }
  return value
}

function readInterchangePackage(input: unknown): StudioInterchangePackage {
  if (!isRecord(input))
    throw new Error("The selected file is not a JSON object.")
  if (input.format !== "webmcp-studio-interchange" || input.version !== 1) {
    throw new Error("Choose a Studio Interchange v1 package.")
  }
  if (!isRecord(input.document)) {
    throw new Error("The Studio package does not contain a document.")
  }
  if (
    !Array.isArray(input.document.pages) ||
    !Array.isArray(input.document.nodes)
  ) {
    throw new Error("The Studio document is missing its pages or layers.")
  }
  if (!Array.isArray(input.assets) || !Array.isArray(input.fonts)) {
    throw new Error("The Studio package is missing its asset or font manifest.")
  }
  return input as StudioInterchangePackage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function importInterchange(
  interchange: StudioInterchangePackage,
  sourceUrl?: string
): Promise<ImportResult> {
  const document = interchange.document
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const frameOwnerByNodeId = new Map<string, string>()
  for (const node of document.nodes) {
    for (const childId of childIds(node)) {
      frameOwnerByNodeId.set(childId, node.id)
    }
  }

  const context: ImportContext = {
    package: interchange,
    document,
    sourceUrl,
    nodesById,
    frameOwnerByNodeId,
    figmaNodesByStudioId: new Map(),
    figmaGroupsByStudioId: new Map(),
    imageHashes: new Map(),
    availableFonts: figma.listAvailableFontsAsync(),
    warnings: new Set(
      interchange.compatibility.figma.issues.map((issue) => issue.message)
    ),
    layers: 0,
  }

  let firstPage: PageNode | undefined
  let firstFrame: FrameNode | undefined
  for (const [index, page] of document.pages.entries()) {
    postProgress(`Importing page ${index + 1} of ${document.pages.length}...`)
    const imported = await importPage(page, context)
    firstPage ??= imported.page
    firstFrame ??= imported.frame
  }

  return {
    pages: document.pages.length,
    layers: context.layers,
    warnings: [...context.warnings],
    firstPage,
    firstFrame,
  }
}

async function importPage(
  page: StudioPage,
  context: ImportContext
): Promise<{ page: PageNode; frame: FrameNode }> {
  const figmaPage = figma.createPage()
  figmaPage.name = uniquePageName(page.name)
  setPagePluginData(figmaPage, page, context.document)
  await figma.setCurrentPageAsync(figmaPage)

  const pageFrame = figma.createFrame()
  pageFrame.name = page.name
  pageFrame.resize(page.width, page.height)
  pageFrame.x = 0
  pageFrame.y = 0
  pageFrame.clipsContent = true
  pageFrame.fills = [solidPaint(page.background)]
  setPagePluginData(pageFrame, page, context.document)

  const pageNodeIds = new Set(page.nodeIds)
  const rootNodeIds = page.nodeIds.filter((nodeId) => {
    const ownerId = context.frameOwnerByNodeId.get(nodeId)
    return !ownerId || !pageNodeIds.has(ownerId)
  })

  for (const nodeId of rootNodeIds) {
    await importNodeTree(nodeId, pageFrame, { x: 0, y: 0 }, context)
  }
  for (const nodeId of page.nodeIds) {
    if (context.figmaNodesByStudioId.has(nodeId)) continue
    context.warnings.add(
      `Layer ${nodeId} had an invalid container reference and was placed at page level.`
    )
    await importNodeTree(nodeId, pageFrame, { x: 0, y: 0 }, context)
  }

  recreateGroups(page, context)
  return { page: figmaPage, frame: pageFrame }
}

async function importNodeTree(
  nodeId: string,
  parent: FrameNode,
  parentOrigin: Point,
  context: ImportContext
): Promise<ImportedNode | undefined> {
  const existing = context.figmaNodesByStudioId.get(nodeId)
  if (existing) return existing
  const source = context.nodesById.get(nodeId)
  if (!source) {
    context.warnings.add(`Missing Studio layer ${nodeId} was skipped.`)
    return undefined
  }

  const imported = await createFigmaNode(source, context)
  if (!imported) return undefined
  parent.appendChild(imported)
  context.figmaNodesByStudioId.set(source.id, imported)
  context.layers += 1
  applyCommonProperties(imported, source, parentOrigin, context)

  if (source.type === "frame" || source.type === "section") {
    const container = imported.type === "FRAME" ? imported : undefined
    if (!container) return imported
    for (const childId of childIds(source)) {
      await importNodeTree(
        childId,
        container,
        { x: source.x, y: source.y },
        context
      )
    }
  }
  return imported
}

function childIds(node: StudioNode): string[] {
  if (node.type === "frame") return node.children.map((child) => child.nodeId)
  if (node.type === "section") return [...node.childNodeIds]
  return []
}

async function createFigmaNode(
  source: StudioNode,
  context: ImportContext
): Promise<ImportedNode | undefined> {
  switch (source.type) {
    case "text":
      return createTextNode(source, context)
    case "rect": {
      const node = figma.createRectangle()
      await applyPaintNode(node, source, context)
      applyCorners(node, source)
      return node
    }
    case "ellipse": {
      const node = figma.createEllipse()
      await applyPaintNode(node, source, context)
      return node
    }
    case "line": {
      const node = figma.createLine()
      applyStrokes(node, source, context)
      return node
    }
    case "image":
      return createImageNode(source, context)
    case "frame":
    case "section": {
      const node = figma.createFrame()
      node.clipsContent = source.type === "frame" ? source.clipsContent : false
      await applyPaintNode(node, source, context)
      applyCorners(node, source)
      if (source.type === "frame") applyAutoLayout(node, source, context)
      return node
    }
    case "polygon": {
      const node = figma.createPolygon()
      node.pointCount = source.pointCount
      await applyPaintNode(node, source, context)
      return node
    }
    case "star": {
      const node = figma.createStar()
      node.pointCount = source.pointCount
      node.innerRadius = source.innerRadius
      await applyPaintNode(node, source, context)
      return node
    }
    case "icon":
    case "vector":
    case "boolean_result":
      return createSvgNode(source, context)
  }
}

async function createTextNode(
  source: StudioText,
  context: ImportContext
): Promise<TextNode> {
  const node = figma.createText()
  const baseFont = await resolveFont(
    source.fontFamily,
    source.fontWeight,
    source.italic,
    context
  )
  await figma.loadFontAsync(baseFont)
  node.fontName = baseFont
  node.characters = source.text
  node.fontSize = source.fontSize
  node.fills = [solidPaint(source.color)]
  node.lineHeight = { unit: "PERCENT", value: source.lineHeight * 100 }
  node.letterSpacing = { unit: "PIXELS", value: source.letterSpacing }
  node.textAlignHorizontal = textHorizontalAlignment(source.align)
  node.textAlignVertical = textVerticalAlignment(source.verticalAlign)
  node.textDecoration = textDecoration(source.decoration)
  node.textCase = textCase(source.textCase)

  for (const run of source.runs) {
    const start = Math.max(0, Math.min(run.start, source.text.length))
    const end = Math.max(start, Math.min(run.end, source.text.length))
    if (end <= start) continue
    const font = await resolveFont(
      run.style.fontFamily ?? source.fontFamily,
      run.style.fontWeight ?? source.fontWeight,
      run.style.italic ?? source.italic,
      context
    )
    await figma.loadFontAsync(font)
    node.setRangeFontName(start, end, font)
    if (run.style.fontSize !== undefined) {
      node.setRangeFontSize(start, end, run.style.fontSize)
    }
    if (run.style.color) {
      node.setRangeFills(start, end, [solidPaint(run.style.color)])
    }
    if (run.style.lineHeight !== undefined) {
      node.setRangeLineHeight(start, end, {
        unit: "PERCENT",
        value: run.style.lineHeight * 100,
      })
    }
    if (run.style.letterSpacing !== undefined) {
      node.setRangeLetterSpacing(start, end, {
        unit: "PIXELS",
        value: run.style.letterSpacing,
      })
    }
    if (run.style.decoration) {
      node.setRangeTextDecoration(
        start,
        end,
        textDecoration(run.style.decoration)
      )
    }
  }
  if (source.paragraphs.some((paragraph) => paragraph.style.align)) {
    context.warnings.add(
      `${source.name}'s per-paragraph alignment was reduced to one text-layer alignment.`
    )
  }
  for (const link of source.links) {
    node.setRangeHyperlink(link.start, link.end, {
      type: "URL",
      value: link.target,
    })
  }

  return node
}

async function resolveFont(
  family: string,
  weight: number,
  italic: boolean,
  context: ImportContext
): Promise<FontName> {
  const available = await context.availableFonts
  const familyMatches = available.filter(
    (entry) => entry.fontName.family.toLowerCase() === family.toLowerCase()
  )
  const desiredStyle = fontStyleName(weight, italic)
  const exact = familyMatches.find(
    (entry) => entry.fontName.style.toLowerCase() === desiredStyle.toLowerCase()
  )
  if (exact) return exact.fontName

  const desiredTokens = fontStyleTokens(weight, italic)
  const scored = familyMatches
    .map((entry) => ({
      fontName: entry.fontName,
      score: fontMatchScore(entry.fontName.style, desiredTokens),
    }))
    .sort((left, right) => right.score - left.score)[0]
  if (scored) {
    if (scored.fontName.style.toLowerCase() !== desiredStyle.toLowerCase()) {
      context.warnings.add(
        `${family} ${desiredStyle} was mapped to ${scored.fontName.style}.`
      )
    }
    return scored.fontName
  }

  const fallback = available.find(
    (entry) =>
      entry.fontName.family === "Inter" &&
      entry.fontName.style === (italic ? "Italic" : "Regular")
  )
  const fontName = fallback?.fontName ?? { family: "Inter", style: "Regular" }
  context.warnings.add(
    `${family} ${desiredStyle} is unavailable in Figma and was replaced with ${fontName.family} ${fontName.style}.`
  )
  return fontName
}

function fontStyleName(weight: number, italic: boolean): string {
  const base =
    weight <= 150
      ? "Thin"
      : weight <= 250
        ? "Extra Light"
        : weight <= 350
          ? "Light"
          : weight <= 450
            ? "Regular"
            : weight <= 550
              ? "Medium"
              : weight <= 650
                ? "Semi Bold"
                : weight <= 750
                  ? "Bold"
                  : weight <= 850
                    ? "Extra Bold"
                    : "Black"
  return italic ? `${base} Italic` : base
}

function fontStyleTokens(weight: number, italic: boolean): string[] {
  return fontStyleName(weight, italic)
    .toLowerCase()
    .replace("semibold", "semi bold")
    .replace("extrabold", "extra bold")
    .replace("extralight", "extra light")
    .split(/\s+/)
}

function fontMatchScore(style: string, desiredTokens: string[]): number {
  const normalized = style
    .toLowerCase()
    .replace("semibold", "semi bold")
    .replace("extrabold", "extra bold")
    .replace("extralight", "extra light")
  return desiredTokens.reduce(
    (score, token) => score + (normalized.includes(token) ? 2 : -1),
    0
  )
}

async function createImageNode(
  source: StudioImage,
  context: ImportContext
): Promise<RectangleNode | EllipseNode> {
  const shape =
    source.frameMask.shape === "ellipse"
      ? figma.createEllipse()
      : figma.createRectangle()
  if (
    shape.type === "RECTANGLE" &&
    source.frameMask.shape === "rounded_rectangle"
  ) {
    const shorterSide = Math.min(source.width, source.height)
    if (source.frameMask.cornerRadii) {
      shape.topLeftRadius = source.frameMask.cornerRadii.topLeft * shorterSide
      shape.topRightRadius = source.frameMask.cornerRadii.topRight * shorterSide
      shape.bottomRightRadius =
        source.frameMask.cornerRadii.bottomRight * shorterSide
      shape.bottomLeftRadius =
        source.frameMask.cornerRadii.bottomLeft * shorterSide
    } else {
      shape.cornerRadius = source.frameMask.radius * shorterSide
    }
  }

  const hash = await imageHash(source.assetId, source.src, context)
  if (hash) {
    shape.fills = [
      {
        type: "IMAGE",
        imageHash: hash,
        scaleMode: source.placement.mode === "fit" ? "FIT" : "FILL",
      },
    ]
  } else {
    shape.fills = [solidPaint("#e5e5e5")]
    context.warnings.add(
      `${source.name} uses an image source that the Figma plugin could not fetch.`
    )
  }
  if (
    source.placement.mode === "manual" ||
    source.placement.rotation !== 0 ||
    source.placement.flipX ||
    source.placement.flipY
  ) {
    context.warnings.add(
      `${source.name}'s manual image crop was reduced to a Figma fill crop.`
    )
  }
  return shape
}

async function imageHash(
  assetId: string,
  source: string,
  context: ImportContext
): Promise<string | undefined> {
  const manifestSource = context.package.assets.find(
    (asset) => asset.assetId === assetId && asset.source === source
  )?.source
  const resolvedSource = manifestSource ?? source
  const cacheKey = `${assetId}\u0000${resolvedSource}`
  const current = context.imageHashes.get(cacheKey)
  if (current) return current
  const pending = loadImageHash(resolvedSource, context.sourceUrl)
  context.imageHashes.set(cacheKey, pending)
  return pending
}

async function loadImageHash(
  source: string,
  sourceUrl?: string
): Promise<string | undefined> {
  let bytes: Uint8Array
  if (source.startsWith("data:")) {
    const commaIndex = source.indexOf(",")
    if (commaIndex < 0) return undefined
    const metadata = source.slice(0, commaIndex)
    const body = source.slice(commaIndex + 1)
    bytes = metadata.endsWith(";base64")
      ? figma.base64Decode(body)
      : new TextEncoder().encode(decodeURIComponent(body))
  } else {
    let url: URL
    try {
      url = sourceUrl ? new URL(source, sourceUrl) : new URL(source)
    } catch {
      return undefined
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      return undefined
    }
    const response = await fetch(url)
    if (!response.ok) return undefined
    bytes = new Uint8Array(await response.arrayBuffer())
  }
  return figma.createImage(bytes).hash
}

function createSvgNode(
  source: Extract<StudioNode, { type: "icon" | "vector" | "boolean_result" }>,
  context: ImportContext
): FrameNode {
  const firstStroke = visibleStrokes(source)[0]
  const fill =
    source.fill && source.fill !== "transparent" ? source.fill : "none"
  const stroke = firstStroke?.color ?? source.stroke ?? "none"
  const strokeWidth = firstStroke?.width ?? source.strokeWidth ?? 0
  const fillRule =
    source.type === "vector" || source.type === "boolean_result"
      ? source.fillRule
      : "nonzero"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeXml(source.viewBox)}"><path d="${escapeXml(source.path)}" fill="${escapeXml(fill)}" fill-rule="${fillRule}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"/></svg>`
  try {
    return figma.createNodeFromSvg(svg)
  } catch {
    context.warnings.add(`${source.name}'s SVG path could not be parsed.`)
    const fallback = figma.createFrame()
    fallback.fills = [solidPaint(fill === "none" ? "#e5e5e5" : fill)]
    return fallback
  }
}

async function applyPaintNode(
  target: GeometryMixin,
  source: StudioPaintNode,
  context: ImportContext
) {
  target.fills = source.fills
    ? await Promise.all(
        source.fills
          .filter((paint) => paint.visible)
          .map((paint) => toFigmaFill(paint, context))
      ).then((paints) =>
        paints.filter((paint): paint is Paint => Boolean(paint))
      )
    : [solidPaint(source.fill)]
  applyStrokes(target, source, context)
}

async function toFigmaFill(
  paint: StudioFillPaint,
  context: ImportContext
): Promise<Paint | undefined> {
  if (paint.type === "image") {
    const hash = await imageHash(paint.assetId, paint.src, context)
    if (!hash) return undefined
    return {
      type: "IMAGE",
      imageHash: hash,
      scaleMode: "FILL",
      opacity: paint.opacity,
      visible: paint.visible,
      blendMode: blendMode(paint.blendMode),
      imageTransform: [
        [paint.transform.a, paint.transform.c, paint.transform.e],
        [paint.transform.b, paint.transform.d, paint.transform.f],
      ],
    }
  }
  if (paint.type === "linear_gradient") {
    const dx = paint.to.x - paint.from.x
    const dy = paint.to.y - paint.from.y
    return {
      type: "GRADIENT_LINEAR",
      gradientStops: paint.stops.map((stop) => ({
        position: stop.position,
        color: rgba(stop.color, stop.opacity),
      })),
      gradientTransform: [
        [dx, -dy, paint.from.x],
        [dy, dx, paint.from.y],
      ],
      opacity: paint.opacity,
      visible: paint.visible,
      blendMode: blendMode(paint.blendMode),
    }
  }
  if (paint.type === "radial_gradient") {
    const angle = (paint.rotation * Math.PI) / 180
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    return {
      type: "GRADIENT_RADIAL",
      gradientStops: paint.stops.map((stop) => ({
        position: stop.position,
        color: rgba(stop.color, stop.opacity),
      })),
      gradientTransform: [
        [paint.radiusX * cosine, -paint.radiusY * sine, paint.center.x],
        [paint.radiusX * sine, paint.radiusY * cosine, paint.center.y],
      ],
      opacity: paint.opacity,
      visible: paint.visible,
      blendMode: blendMode(paint.blendMode),
    }
  }
  const parsed = parseColor(paint.color)
  return {
    type: "SOLID",
    color: parsed.color,
    opacity: parsed.opacity * paint.opacity,
    visible: paint.visible,
    blendMode: blendMode(paint.blendMode),
  }
}

function applyStrokes(
  target: GeometryMixin,
  source: StudioNode,
  context: ImportContext
) {
  if (!("stroke" in source)) return
  const strokes = visibleStrokes(source)
  if (strokes.length > 0) {
    target.strokes = strokes.map((stroke) => {
      const parsed = parseColor(stroke.color)
      return {
        type: "SOLID",
        color: parsed.color,
        opacity: parsed.opacity * stroke.opacity,
        visible: stroke.visible,
        blendMode: blendMode(stroke.blendMode),
      }
    })
    const first = strokes[0]!
    target.strokeWeight = first.width
    target.strokeAlign = strokeAlignment(first.alignment)
    target.strokeCap = strokeCap(first.cap)
    target.strokeJoin = strokeJoin(first.join)
    target.dashPattern = first.dash ?? []
    if (new Set(strokes.map((stroke) => stroke.width)).size > 1) {
      context.warnings.add(
        `${source.name}'s per-paint stroke widths were reduced to one Figma stroke width.`
      )
    }
    if (first.sides && !Object.values(first.sides).every(Boolean)) {
      context.warnings.add(
        `${source.name}'s independent stroke sides are not native in Figma.`
      )
    }
    return
  }
  if (source.stroke && (source.strokeWidth ?? 0) > 0) {
    target.strokes = [solidPaint(source.stroke)]
    target.strokeWeight = source.strokeWidth ?? 0
  } else {
    target.strokes = []
  }
}

function visibleStrokes(source: StudioNode): StudioStrokePaint[] {
  if (!("strokes" in source) || !source.strokes) return []
  return source.strokes.filter((stroke) => stroke.visible)
}

function applyCommonProperties(
  target: ImportedNode,
  source: StudioNode,
  parentOrigin: Point,
  context: ImportContext
) {
  target.name = source.name
  if ("resize" in target) {
    target.resize(Math.max(0.01, source.width), Math.max(0.01, source.height))
  }
  target.x = source.x - parentOrigin.x
  target.y = source.y - parentOrigin.y
  target.rotation = source.rotation
  target.opacity = source.opacity
  target.visible = source.visible
  target.locked = source.locked
  target.blendMode = blendMode(source.blendMode)
  if ("constraints" in target) {
    target.constraints = {
      horizontal: constraint(source.constraints.horizontal),
      vertical: constraint(source.constraints.vertical),
    }
  }
  if ("effects" in target && source.effects) {
    target.effects = source.effects.map((effect): Effect => {
      if (effect.type === "layer_blur") {
        return {
          type: "LAYER_BLUR",
          blurType: "NORMAL",
          radius: effect.radius,
          visible: effect.visible,
        }
      }
      return {
        type: "DROP_SHADOW",
        color: rgba(effect.color),
        offset: { x: effect.offsetX, y: effect.offsetY },
        radius: effect.blur,
        spread: 0,
        visible: effect.visible,
        blendMode: "NORMAL",
        showShadowBehindNode: false,
      }
    })
  }

  if (target.type === "TEXT") {
    target.textAutoResize =
      source.type === "text" && source.sizingMode === "auto_width"
        ? "WIDTH_AND_HEIGHT"
        : source.type === "text" && source.sizingMode === "auto_height"
          ? "HEIGHT"
          : "NONE"
    if (target.textAutoResize === "NONE") {
      target.resize(Math.max(0.01, source.width), Math.max(0.01, source.height))
    }
  }
  setNodePluginData(target, source, context.document)
}

function applyCorners(
  target: RectangleNode | FrameNode,
  source: Extract<StudioNode, { type: "rect" | "frame" | "section" }>
) {
  if (
    "independentCorners" in source &&
    source.independentCorners &&
    source.cornerRadii
  ) {
    target.topLeftRadius = source.cornerRadii.topLeft
    target.topRightRadius = source.cornerRadii.topRight
    target.bottomRightRadius = source.cornerRadii.bottomRight
    target.bottomLeftRadius = source.cornerRadii.bottomLeft
  } else {
    target.cornerRadius = source.radius
  }
  target.cornerSmoothing =
    "cornerSmoothing" in source ? (source.cornerSmoothing ?? 0) : 0
}

function applyAutoLayout(
  target: FrameNode,
  source: StudioFrame,
  context: ImportContext
) {
  if (!source.autoLayout) return
  target.layoutMode = source.autoLayout.direction.toUpperCase() as
    "HORIZONTAL" | "VERTICAL"
  target.itemSpacing = source.autoLayout.gap
  target.paddingTop = source.autoLayout.padding.top
  target.paddingRight = source.autoLayout.padding.right
  target.paddingBottom = source.autoLayout.padding.bottom
  target.paddingLeft = source.autoLayout.padding.left
  target.primaryAxisSizingMode =
    source.autoLayout.direction === "horizontal"
      ? source.autoLayout.horizontalSizing === "hug"
        ? "AUTO"
        : "FIXED"
      : source.autoLayout.verticalSizing === "hug"
        ? "AUTO"
        : "FIXED"
  target.counterAxisSizingMode =
    source.autoLayout.direction === "horizontal"
      ? source.autoLayout.verticalSizing === "hug"
        ? "AUTO"
        : "FIXED"
      : source.autoLayout.horizontalSizing === "hug"
        ? "AUTO"
        : "FIXED"
  target.primaryAxisAlignItems =
    source.autoLayout.primaryAlign === "space_between"
      ? "SPACE_BETWEEN"
      : axisAlignment(source.autoLayout.primaryAlign)
  target.counterAxisAlignItems =
    source.autoLayout.counterAlign === "stretch"
      ? "MIN"
      : axisAlignment(source.autoLayout.counterAlign)
  if (source.autoLayout.counterAlign === "stretch") {
    context.warnings.add(
      `${source.name}'s stretch alignment was kept through child sizing rather than a Figma frame setting.`
    )
  }
}

function recreateGroups(page: StudioPage, context: ImportContext) {
  const groups = context.document.groups.filter(
    (group) => group.pageId === page.id
  )
  const pending = new Set(groups.map((group) => group.id))
  while (pending.size > 0) {
    let madeProgress = false
    for (const group of groups) {
      if (!pending.has(group.id)) continue
      const childGroups = groups.filter(
        (candidate) => candidate.parentGroupId === group.id
      )
      if (childGroups.some((child) => pending.has(child.id))) continue
      createGroup(group, childGroups, context)
      pending.delete(group.id)
      madeProgress = true
    }
    if (madeProgress) continue
    for (const groupId of pending) {
      context.warnings.add(
        `Group ${groupId} has a cyclic parent reference and was skipped.`
      )
    }
    break
  }
}

function createGroup(
  group: StudioGroup,
  childGroups: StudioGroup[],
  context: ImportContext
) {
  const candidates: GroupableNode[] = []
  for (const nodeId of group.nodeIds) {
    const node = context.figmaNodesByStudioId.get(nodeId)
    if (node) candidates.push(node)
  }
  for (const childGroup of childGroups) {
    const node = context.figmaGroupsByStudioId.get(childGroup.id)
    if (node) candidates.push(node)
  }
  if (candidates.length === 0) return
  const parent = candidates[0]?.parent
  if (
    !parent ||
    !isContainerNode(parent) ||
    candidates.some((node) => node.parent !== parent)
  ) {
    context.warnings.add(
      `${group.name} crosses Figma containers and remains encoded as Studio layer metadata.`
    )
    return
  }

  if (group.role === "mask") {
    const maskIds = new Set(group.mask.sourceNodeIds)
    candidates.sort((left, right) => {
      const leftIsMask = maskIds.has(left.getPluginData(PLUGIN_DATA_NODE_ID))
      const rightIsMask = maskIds.has(right.getPluginData(PLUGIN_DATA_NODE_ID))
      return Number(rightIsMask) - Number(leftIsMask)
    })
  }
  const figmaGroup = figma.group(candidates, parent)
  figmaGroup.name = group.name
  figmaGroup.setPluginData(PLUGIN_DATA_GROUP_ID, group.id)
  figmaGroup.setPluginData(PLUGIN_DATA_DOCUMENT_ID, context.document.id)
  figmaGroup.setPluginData(PLUGIN_DATA_FORMAT_VERSION, "1")
  context.figmaGroupsByStudioId.set(group.id, figmaGroup)

  if (group.role === "mask") {
    const primaryMaskId = group.mask.sourceNodeIds[0]
    const maskNode = primaryMaskId
      ? context.figmaNodesByStudioId.get(primaryMaskId)
      : undefined
    if (maskNode && "isMask" in maskNode) maskNode.isMask = true
    if (group.mask.sourceNodeIds.length > 1 || group.mask.type !== "vector") {
      context.warnings.add(
        `${group.name}'s ${group.mask.type} mask uses a reduced Figma mask mapping.`
      )
    }
  }
}

function isContainerNode(node: BaseNode): node is BaseNode & ChildrenMixin {
  return "children" in node
}

function setNodePluginData(
  target: ImportedNode,
  source: StudioNode,
  document: StudioDocument
) {
  target.setPluginData(PLUGIN_DATA_NODE_ID, source.id)
  target.setPluginData(PLUGIN_DATA_DOCUMENT_ID, document.id)
  target.setPluginData(PLUGIN_DATA_NODE_TYPE, source.type)
  target.setPluginData(PLUGIN_DATA_FORMAT_VERSION, "1")
}

function setPagePluginData(
  target: PageNode | FrameNode,
  page: StudioPage,
  document: StudioDocument
) {
  target.setPluginData(PLUGIN_DATA_PAGE_ID, page.id)
  target.setPluginData(PLUGIN_DATA_DOCUMENT_ID, document.id)
  target.setPluginData(PLUGIN_DATA_FORMAT_VERSION, "1")
}

function uniquePageName(requested: string): string {
  const existing = new Set(figma.root.children.map((page) => page.name))
  if (!existing.has(requested)) return requested
  let suffix = 2
  while (existing.has(`${requested} ${suffix}`)) suffix += 1
  return `${requested} ${suffix}`
}

function solidPaint(input: string): SolidPaint {
  const parsed = parseColor(input)
  return {
    type: "SOLID",
    color: parsed.color,
    opacity: parsed.opacity,
  }
}

function rgba(input: string, opacity = 1): RGBA {
  const parsed = parseColor(input)
  return { ...parsed.color, a: parsed.opacity * opacity }
}

function parseColor(input: string): { color: RGB; opacity: number } {
  const value = input.trim().toLowerCase()
  if (value === "transparent") {
    return { color: { r: 0, g: 0, b: 0 }, opacity: 0 }
  }
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i)
  if (short) {
    return {
      color: {
        r: Number.parseInt(short[1]! + short[1]!, 16) / 255,
        g: Number.parseInt(short[2]! + short[2]!, 16) / 255,
        b: Number.parseInt(short[3]! + short[3]!, 16) / 255,
      },
      opacity: short[4] ? Number.parseInt(short[4] + short[4], 16) / 255 : 1,
    }
  }
  const long = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (long) {
    return {
      color: {
        r: Number.parseInt(long[1]!.slice(0, 2), 16) / 255,
        g: Number.parseInt(long[1]!.slice(2, 4), 16) / 255,
        b: Number.parseInt(long[1]!.slice(4, 6), 16) / 255,
      },
      opacity: long[2] ? Number.parseInt(long[2], 16) / 255 : 1,
    }
  }
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/
  )
  if (rgb) {
    return {
      color: {
        r: Math.min(255, Number(rgb[1])) / 255,
        g: Math.min(255, Number(rgb[2])) / 255,
        b: Math.min(255, Number(rgb[3])) / 255,
      },
      opacity: rgb[4] === undefined ? 1 : Math.min(1, Number(rgb[4])),
    }
  }
  return { color: { r: 0, g: 0, b: 0 }, opacity: 1 }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function blendMode(value?: StudioNode["blendMode"]): BlendMode {
  const modes: Record<NonNullable<StudioNode["blendMode"]>, BlendMode> = {
    normal: "NORMAL",
    darken: "DARKEN",
    multiply: "MULTIPLY",
    "color-burn": "COLOR_BURN",
    lighten: "LIGHTEN",
    screen: "SCREEN",
    "color-dodge": "COLOR_DODGE",
    overlay: "OVERLAY",
    "soft-light": "SOFT_LIGHT",
    "hard-light": "HARD_LIGHT",
    difference: "DIFFERENCE",
    exclusion: "EXCLUSION",
    hue: "HUE",
    saturation: "SATURATION",
    color: "COLOR",
    luminosity: "LUMINOSITY",
  }
  return value ? modes[value] : "NORMAL"
}

function constraint(
  value: StudioNode["constraints"]["horizontal"]
): ConstraintType {
  return value === "min"
    ? "MIN"
    : value === "max"
      ? "MAX"
      : (value.toUpperCase() as ConstraintType)
}

function strokeAlignment(
  value?: StudioStrokePaint["alignment"]
): "CENTER" | "INSIDE" | "OUTSIDE" {
  return value
    ? (value.toUpperCase() as "CENTER" | "INSIDE" | "OUTSIDE")
    : "CENTER"
}

function strokeCap(value?: StudioStrokePaint["cap"]): StrokeCap {
  return value ? (value.toUpperCase() as StrokeCap) : "NONE"
}

function strokeJoin(value?: StudioStrokePaint["join"]): StrokeJoin {
  return value ? (value.toUpperCase() as StrokeJoin) : "MITER"
}

function textHorizontalAlignment(
  value: StudioText["align"]
): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  return value === "justify"
    ? "JUSTIFIED"
    : (value.toUpperCase() as "LEFT" | "CENTER" | "RIGHT")
}

function textVerticalAlignment(
  value?: StudioText["verticalAlign"]
): "TOP" | "CENTER" | "BOTTOM" {
  if (value === "middle") return "CENTER"
  return value ? (value.toUpperCase() as "TOP" | "BOTTOM") : "TOP"
}

function textDecoration(value?: StudioText["decoration"]): TextDecoration {
  if (value === "underline") return "UNDERLINE"
  if (value === "line_through") return "STRIKETHROUGH"
  return "NONE"
}

function textCase(value?: StudioText["textCase"]): TextCase {
  if (value === "uppercase") return "UPPER"
  if (value === "lowercase") return "LOWER"
  if (value === "title") return "TITLE"
  return "ORIGINAL"
}

function axisAlignment(
  value: "start" | "center" | "end"
): "MIN" | "CENTER" | "MAX" {
  if (value === "start") return "MIN"
  if (value === "end") return "MAX"
  return "CENTER"
}
