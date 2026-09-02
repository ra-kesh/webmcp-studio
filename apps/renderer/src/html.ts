import {
  assertPageThumbnailSize,
  cornerRadiiCss,
  hasExplicitPaintStack,
  pageThumbnailScale,
  projectNodeForRender,
  projectFrameClipStack,
  projectPageForRender,
  roundedRectanglePath,
  roundedRectanglePaintPath,
  serializeImagePaintProjector,
  strokeGeometryInset,
  type Document,
  type ImagePaintProjectionInput,
  type RenderImagePaintProjection,
  type RenderFillPaint,
  type RenderNodeProjection,
  type SceneNode,
} from "@webmcp/document"
import type { PageThumbnailSize } from "@webmcp/document"
import type {
  MaskPaintSource,
  PagePaintPlanEntry,
  PagePaintBounds,
} from "@webmcp/document/internal/page-paint-plan"
import {
  isAdmittedAlphaMaskSource,
  isAdmittedVectorMaskSource,
  projectPagePaintPlan,
} from "@webmcp/document/internal/page-paint-plan"
import { rendererFontFaceCss, rendererFontFaceManifest } from "./fonts"

type RenderRoot = {
  removeAttribute(name: string): void
  setAttribute(name: string, value: string): void
}

type RenderFontFace = {
  family: string
  status: string
  style: string
  weight: string
}

type RenderFontSet = Iterable<RenderFontFace> & {
  check(query: string, text?: string): boolean
  load(query: string, text?: string): Promise<RenderFontFace[]>
}

type RenderFontRequirement = Readonly<{
  family: string
  nodeId: string
  scope: "ordinary_text" | "mask_text"
  style: "normal" | "italic"
  text: string
  weight: number
}>

type RendererFontFaceDefinition = Readonly<{
  assetId: string
  family: string
  sha256: string
  source: "bundled" | "google_fonts_cache"
  style: "normal" | "italic"
  unicodeRange: string
  weight: Readonly<{ min: number; max: number }>
}>

type RenderImage = {
  complete: boolean
  dataset: {
    imageFrameHeight?: string
    imageFrameClipPath?: string
    imageFrameMask?: string
    imageFrameWidth?: string
    imagePlacement?: string
    imagePaintPreload?: string
    nodeId?: string
  }
  decode(): Promise<unknown>
  naturalHeight: number
  naturalWidth: number
  parentElement: { style: RenderStyle } | null
  src?: string
  style: RenderStyle
}

type RenderCoverageImageTarget = Readonly<{
  nodeId: string
  target: { setAttribute(name: string, value: string): void }
}>

type RenderCoverageSource = Readonly<{
  height: number
  nodeId: string
  target: { setAttribute(name: string, value: string): void }
  template: { innerHTML: string }
  width: number
}>

type RenderStyle = {
  setProperty(name: string, value: string): void
}

type ImagePaintProjector = (
  input: ImagePaintProjectionInput
) => RenderImagePaintProjection

export async function markRenderResourcesReady(input: {
  coverageImageTargets?: readonly RenderCoverageImageTarget[]
  coverageSources?: readonly RenderCoverageSource[]
  root: RenderRoot
  fonts: RenderFontSet
  ordinaryFontRequirements?: readonly RenderFontRequirement[]
  maskFontRequirements?: readonly RenderFontRequirement[]
  fontFaces?: readonly RendererFontFaceDefinition[]
  fontTimeoutMs?: number
  images: RenderImage[]
  managedFontFaceCss?: string
  projectImagePaint: ImagePaintProjector
  luminanceSourceNodeIds?: readonly string[]
  verifyLuminanceConversion?: () => Promise<boolean>
}): Promise<void> {
  input.root.setAttribute("data-render-progress", "start")
  const fail = (
    code: string,
    details: {
      nodeId?: string
      fontFamily?: string
      fontStyle?: string
      fontWeight?: number
      stage?: string
    } = {}
  ) => {
    input.root.removeAttribute("data-render-ready")
    input.root.setAttribute("data-render-error", code)
    if (details.nodeId)
      input.root.setAttribute("data-render-error-node", details.nodeId)
    if (details.fontFamily)
      input.root.setAttribute("data-render-error-font", details.fontFamily)
    if (details.fontStyle)
      input.root.setAttribute("data-render-error-font-style", details.fontStyle)
    if (details.fontWeight !== undefined)
      input.root.setAttribute(
        "data-render-error-font-weight",
        String(details.fontWeight)
      )
    if (details.stage)
      input.root.setAttribute("data-render-error-stage", details.stage)
  }

  try {
    const requirements = [
      ...(input.ordinaryFontRequirements ?? []),
      ...(input.maskFontRequirements ?? []),
    ]
    const groupedRequirements = new Map<
      string,
      { requirement: RenderFontRequirement; characters: Set<string> }
    >()
    for (const requirement of requirements) {
      const key = `${requirement.scope}\u0000${requirement.family}\u0000${requirement.style}\u0000${requirement.weight}`
      const grouped = groupedRequirements.get(key) ?? {
        requirement,
        characters: new Set<string>(),
      }
      for (const character of requirement.text)
        grouped.characters.add(character)
      groupedRequirements.set(key, grouped)
    }

    for (const { requirement, characters } of groupedRequirements.values()) {
      input.root.setAttribute(
        "data-render-progress",
        `font:${requirement.scope}:${requirement.style}:${requirement.weight}`
      )
      const definition = (input.fontFaces ?? []).find(
        (face) =>
          face.family === requirement.family &&
          face.style === requirement.style &&
          requirement.weight >= face.weight.min &&
          requirement.weight <= face.weight.max
      )
      const failureDetails = {
        nodeId: requirement.nodeId,
        fontFamily: requirement.family,
        fontStyle: requirement.style,
        fontWeight: requirement.weight,
      }
      if (!definition) {
        fail("font_face_failed", {
          ...failureDetails,
          stage: `${requirement.scope}_font_resolve`,
        })
        return
      }

      const family = requirement.family.replaceAll('"', '\\"')
      const query = `${requirement.style} ${requirement.weight} 16px "${family}"`
      const coverageText = [...characters].sort().join("") || "WebMCP"
      const unicodeRanges = definition.unicodeRange
        .split(",")
        .flatMap((part) => {
          const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part.trim())
          if (!match) return []
          return [
            {
              min: Number.parseInt(match[1]!, 16),
              max: Number.parseInt(match[2] ?? match[1]!, 16),
            },
          ]
        })
      const unsupportedCharacter = [...coverageText].find((character) => {
        const codePoint = character.codePointAt(0)
        return (
          codePoint === undefined ||
          !unicodeRanges.some(
            (range) => codePoint >= range.min && codePoint <= range.max
          )
        )
      })
      if (unsupportedCharacter) {
        fail("font_face_failed", {
          ...failureDetails,
          stage: `${requirement.scope}_font_coverage`,
        })
        return
      }
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        const loadedFaces = await Promise.race([
          input.fonts.load(query, coverageText),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("font_load_timeout")),
              input.fontTimeoutMs ?? 5_000
            )
          }),
        ])
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        const exactFaceLoaded = loadedFaces.some((face) => {
          const weights = face.weight
            .split(/\s+/)
            .map(Number)
            .filter(Number.isFinite)
          const weightMatches =
            weights.length === 1
              ? weights[0] === requirement.weight
              : weights.length === 2 &&
                requirement.weight >= weights[0]! &&
                requirement.weight <= weights[1]!
          return (
            face.family.replace(/["']/g, "") === requirement.family &&
            face.style === requirement.style &&
            weightMatches &&
            face.status === "loaded"
          )
        })
        if (!exactFaceLoaded || !input.fonts.check(query, coverageText)) {
          fail("font_face_failed", {
            ...failureDetails,
            stage: `${requirement.scope}_font_verify`,
          })
          return
        }
      } catch (error) {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        fail("font_face_failed", {
          ...failureDetails,
          stage: `${requirement.scope}_${
            error instanceof Error && error.message === "font_load_timeout"
              ? "font_load_timeout"
              : "font_load"
          }`,
        })
        return
      }
    }

    input.root.setAttribute("data-render-progress", "fonts_ready")

    for (const image of input.images) {
      input.root.setAttribute(
        "data-render-progress",
        `image:${image.dataset.nodeId ?? "unknown"}`
      )
      try {
        await image.decode()
      } catch {
        fail("image_decode_failed", { nodeId: image.dataset.nodeId })
        return
      }
      if (
        !image.complete ||
        image.naturalWidth <= 0 ||
        image.naturalHeight <= 0
      ) {
        fail("image_decode_failed", { nodeId: image.dataset.nodeId })
        return
      }

      if (image.dataset.imagePaintPreload === "true") continue

      try {
        const frameWidth = Number(image.dataset.imageFrameWidth)
        const frameHeight = Number(image.dataset.imageFrameHeight)
        const placement = JSON.parse(image.dataset.imagePlacement ?? "")
        const frameMask = JSON.parse(image.dataset.imageFrameMask ?? "")
        const projection = input.projectImagePaint({
          frame: { width: frameWidth, height: frameHeight },
          naturalSize: {
            width: image.naturalWidth,
            height: image.naturalHeight,
          },
          placement,
          frameMask,
        })
        const { a, b, c, d, e, f } = projection.sourceToFrame
        image.style.setProperty("position", "absolute")
        image.style.setProperty("left", "0")
        image.style.setProperty("top", "0")
        image.style.setProperty("width", `${image.naturalWidth}px`)
        image.style.setProperty("height", `${image.naturalHeight}px`)
        image.style.setProperty("max-width", "none")
        image.style.setProperty("max-height", "none")
        image.style.setProperty("transform-origin", "0 0")
        image.style.setProperty(
          "transform",
          `matrix(${a},${b},${c},${d},${e},${f})`
        )

        const frameStyle = image.parentElement?.style
        if (!frameStyle) throw new Error("Image frame is missing")
        const clip = projection.clip
        const authoredClipPath = image.dataset.imageFrameClipPath
        const clipPath = authoredClipPath
          ? `path('${authoredClipPath}')`
          : clip.shape === "ellipse"
            ? `ellipse(${clip.radiusX}px ${clip.radiusY}px at ${clip.centerX}px ${clip.centerY}px)`
            : clip.shape === "rounded_rectangle"
              ? `inset(0 round ${clip.radius}px)`
              : "inset(0)"
        frameStyle.setProperty("clip-path", clipPath)
        for (const coverageTarget of input.coverageImageTargets ?? []) {
          if (coverageTarget.nodeId !== image.dataset.nodeId) continue
          coverageTarget.target.setAttribute("href", image.src ?? "")
          coverageTarget.target.setAttribute(
            "width",
            String(image.naturalWidth)
          )
          coverageTarget.target.setAttribute(
            "height",
            String(image.naturalHeight)
          )
          coverageTarget.target.setAttribute(
            "transform",
            `matrix(${a},${b},${c},${d},${e},${f})`
          )
        }
      } catch {
        fail("image_projection_failed", { nodeId: image.dataset.nodeId })
        return
      }
    }

    for (const source of input.coverageSources ?? []) {
      input.root.setAttribute(
        "data-render-progress",
        `coverage:${source.nodeId}`
      )
      try {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}" viewBox="0 0 ${source.width} ${source.height}"><style>${input.managedFontFaceCss ?? ""}</style><foreignObject x="0" y="0" width="${source.width}" height="${source.height}">${source.template.innerHTML}</foreignObject></svg>`
        const sourceUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        const browser = globalThis as unknown as {
          Image: new () => {
            complete: boolean
            decode(): Promise<unknown>
            naturalHeight: number
            naturalWidth: number
            src: string
          }
        }
        const probe = new browser.Image()
        probe.src = sourceUrl
        await probe.decode()
        if (
          !probe.complete ||
          probe.naturalWidth <= 0 ||
          probe.naturalHeight <= 0
        ) {
          throw new Error("Coverage source did not decode")
        }
        source.target.setAttribute("href", sourceUrl)
      } catch {
        fail("resource_readiness_failed", { nodeId: source.nodeId })
        return
      }
    }

    const luminanceSourceNodeIds = input.luminanceSourceNodeIds ?? []
    if (luminanceSourceNodeIds.length) {
      try {
        if (!(await input.verifyLuminanceConversion?.())) {
          fail("luminance_conversion_failed", {
            nodeId: luminanceSourceNodeIds[0],
          })
          return
        }
      } catch {
        fail("luminance_conversion_failed", {
          nodeId: luminanceSourceNodeIds[0],
        })
        return
      }
    }

    input.root.removeAttribute("data-render-error")
    input.root.removeAttribute("data-render-error-node")
    input.root.removeAttribute("data-render-error-font")
    input.root.removeAttribute("data-render-error-font-style")
    input.root.removeAttribute("data-render-error-font-weight")
    input.root.removeAttribute("data-render-error-stage")
    input.root.setAttribute("data-render-progress", "ready")
    input.root.setAttribute("data-render-ready", "true")
  } catch {
    fail("resource_readiness_failed")
  }
}

export async function verifyBrowserLuminanceConversion(): Promise<boolean> {
  type BrowserImage = {
    src: string
    decode(): Promise<unknown>
  }
  type BrowserCanvasContext = {
    drawImage(image: BrowserImage, x: number, y: number): void
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
      settings?: { colorSpace: "srgb" }
    ): { data: Uint8ClampedArray }
  }
  const browser = globalThis as unknown as {
    Image: new () => BrowserImage
    document: {
      createElement(name: "canvas"): {
        width: number
        height: number
        getContext(
          type: "2d",
          settings: { colorSpace: "srgb"; willReadFrequently: true }
        ): BrowserCanvasContext | null
      }
    }
  }
  const colors = [
    ["black", 1],
    ["white", 1],
    ["rgb(128,128,128)", 1],
    ["red", 1],
    ["lime", 1],
    ["blue", 1],
    ["red", 0],
    ["red", 0.4],
  ] as const
  const expected = [0, 255, 128, 54, 182, 18, 0, 22, 68]
  const filter = (id: string) =>
    `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.2126 0.7152 0.0722 0 0" result="y"/><feComposite in="y" in2="SourceGraphic" operator="in"/></filter>`
  const filters = colors.map((_, index) => filter(`f${index}`)).join("")
  const outputs = colors
    .map(
      ([color, opacity], index) =>
        `<rect x="${index}" width="1" height="1" fill="${color}" opacity="${opacity}" filter="url(#f${index})"/>`
    )
    .join("")
  const svgNamespace = "http:" + "//www.w3.org/2000/svg"
  const svg = `<svg xmlns="${svgNamespace}" width="9" height="1"><defs>${filters}${filter("overlap-red")}${filter("overlap-green")}</defs>${outputs}<rect x="8" width="1" height="1" fill="red" opacity=".5" filter="url(#overlap-red)"/><rect x="8" width="1" height="1" fill="lime" opacity=".25" filter="url(#overlap-green)"/></svg>`
  const image = new browser.Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try {
    await image.decode()
    const canvas = browser.document.createElement("canvas")
    canvas.width = 9
    canvas.height = 1
    const context = canvas.getContext("2d", {
      colorSpace: "srgb",
      willReadFrequently: true,
    })
    if (!context) return false
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, 9, 1, {
      colorSpace: "srgb",
    }).data
    return expected.every(
      (alpha, index) => Math.abs((pixels[index * 4 + 3] ?? -255) - alpha) <= 3
    )
  } catch {
    return false
  }
}

const fontRequirementFromElement = `(element,scope)=>({nodeId:element.getAttribute("data-render-font-node")||"",family:element.getAttribute("data-render-font-family")||"",style:element.getAttribute("data-render-font-style")==="italic"?"italic":"normal",weight:Number(element.getAttribute("data-render-font-weight")),text:element.textContent||"",scope})`
const resourceReadyScript = `<script>{const __name=(target)=>target;(${markRenderResourcesReady.toString()})({root:document.documentElement,fonts:document.fonts,fontFaces:${JSON.stringify(rendererFontFaceManifest)},ordinaryFontRequirements:Array.from(document.querySelectorAll("[data-render-font-family]"),element=>element).filter(element=>!element.closest("[data-mask-coverage-template]")).map(element=>(${fontRequirementFromElement})(element,"ordinary_text")),maskFontRequirements:Array.from(document.querySelectorAll("[data-mask-coverage-template] [data-render-font-family]"),element=>(${fontRequirementFromElement})(element,"mask_text")),images:Array.from(document.querySelectorAll("img[data-node-id]")),coverageImageTargets:Array.from(document.querySelectorAll("[data-mask-coverage-template][data-mask-coverage-kind=image]"),template=>({nodeId:template.getAttribute("data-mask-coverage-node-id")||"",target:document.getElementById(template.getAttribute("data-mask-coverage-target-id")||"")})).filter(source=>source.target),coverageSources:Array.from(document.querySelectorAll("[data-mask-coverage-template]:not([data-mask-coverage-kind=image])"),template=>({nodeId:template.getAttribute("data-mask-coverage-node-id")||"",width:Number(template.getAttribute("data-mask-coverage-width")),height:Number(template.getAttribute("data-mask-coverage-height")),template,target:document.getElementById(template.getAttribute("data-mask-coverage-target-id")||"")})).filter(source=>source.target),managedFontFaceCss:document.getElementById("renderer-font-faces")?.textContent||"",projectImagePaint:${serializeImagePaintProjector()},luminanceSourceNodeIds:Array.from(document.querySelectorAll("[data-luminance-source-isolation]"),element=>element.getAttribute("data-luminance-source-isolation")||"").filter(Boolean),verifyLuminanceConversion:${verifyBrowserLuminanceConversion.toString()}})}</script>`

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

type HtmlShapeProjection = Extract<
  RenderNodeProjection,
  {
    type:
      | "rect"
      | "frame"
      | "ellipse"
      | "line"
      | "icon"
      | "section"
      | "polygon"
      | "star"
      | "vector"
      | "boolean_result"
  }
>

const svgPaintIdentifier = (nodeId: string, paintId: string) =>
  `studio-paint-${Array.from(`${nodeId}\u0000${paintId}`, (character) =>
    character.codePointAt(0)?.toString(16)
  ).join("-")}`

const paintStyle = (paint: {
  opacity: number
  visible: boolean
  blendMode: string
}) =>
  `opacity:${paint.opacity};display:${paint.visible ? "block" : "none"};mix-blend-mode:${paint.blendMode}`

const renderFillDefinition = (
  nodeId: string,
  paint: Exclude<RenderFillPaint, { type?: "solid" }>
) => {
  const id = svgPaintIdentifier(nodeId, paint.id)
  if (paint.type === "linear_gradient") {
    const stops = paint.stops
      .map(
        (stop) =>
          `<stop offset="${stop.position}" stop-color="${escapeHtml(stop.color)}" stop-opacity="${stop.opacity}" />`
      )
      .join("")
    return `<linearGradient id="${id}" x1="${paint.from.x}" y1="${paint.from.y}" x2="${paint.to.x}" y2="${paint.to.y}">${stops}</linearGradient>`
  }
  if (paint.type === "radial_gradient") {
    const stops = paint.stops
      .map(
        (stop) =>
          `<stop offset="${stop.position}" stop-color="${escapeHtml(stop.color)}" stop-opacity="${stop.opacity}" />`
      )
      .join("")
    return `<radialGradient id="${id}" cx="0" cy="0" r="1" gradientTransform="translate(${paint.center.x} ${paint.center.y}) rotate(${paint.rotation}) scale(${paint.radiusX} ${paint.radiusY})">${stops}</radialGradient>`
  }
  const { a, b, c, d, e, f } = paint.transform
  return `<pattern id="${id}" width="1" height="1" patternContentUnits="objectBoundingBox" patternUnits="objectBoundingBox"><image data-image-paint-node-id="${escapeHtml(nodeId)}" href="${escapeHtml(paint.src)}" width="1" height="1" preserveAspectRatio="none" transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})" /></pattern>`
}

const renderFillValue = (nodeId: string, paint: RenderFillPaint) =>
  !paint.type || paint.type === "solid"
    ? escapeHtml(paint.color)
    : `url(#${svgPaintIdentifier(nodeId, paint.id)})`

const renderStrokeAttributes = (
  paint: HtmlShapeProjection["content"]["strokes"][number]
) =>
  [
    `stroke="${escapeHtml(paint.color)}"`,
    `stroke-width="${paint.width}"`,
    paint.dash.length ? `stroke-dasharray="${paint.dash.join(" ")}"` : "",
    `stroke-linecap="${paint.cap}"`,
    `stroke-linejoin="${paint.join}"`,
    `stroke-miterlimit="${paint.miterLimit}"`,
    'vector-effect="non-scaling-stroke"',
  ]
    .filter(Boolean)
    .join(" ")

const renderPaintedShapeToHtml = (
  projection: HtmlShapeProjection,
  identity: string,
  common: string
) => {
  const nodeId = projection.frame.id
  if (projection.type === "line") {
    const strokes = projection.content.strokes
      .map(
        (paint) =>
          `<line x1="0" y1="0" x2="${projection.frame.width}" y2="${projection.frame.height}" fill="none" ${renderStrokeAttributes(paint)} style="${paintStyle(paint)}" />`
      )
      .join("")
    return `<svg ${identity} viewBox="0 0 ${projection.frame.width} ${projection.frame.height}" preserveAspectRatio="none" style="${common};overflow:visible">${strokes}</svg>`
  }

  const definitions = projection.content.fills
    .filter((paint): paint is Exclude<RenderFillPaint, { type?: "solid" }> =>
      Boolean(paint.type && paint.type !== "solid")
    )
    .map((paint) => renderFillDefinition(nodeId, paint))
    .join("")
  const imagePreloads = projection.content.fills
    .filter(
      (paint): paint is Extract<RenderFillPaint, { type: "image" }> =>
        paint.type === "image"
    )
    .map(
      (paint) =>
        `<img data-image-paint-preload="true" data-node-id="${escapeHtml(nodeId)}" data-image-paint-id="${escapeHtml(paint.id)}" src="${escapeHtml(paint.src)}" alt="" aria-hidden="true" style="position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none" />`
    )
    .join("")
  const fillMarkup = projection.content.fills.map((paint) => ({
    paint,
    attributes: `fill="${renderFillValue(nodeId, paint)}" stroke="none" style="${paintStyle(paint)}"`,
  }))
  const strokeMarkup = projection.content.strokes.map((paint) => ({
    paint,
    attributes: `fill="none" ${renderStrokeAttributes(paint)} style="${paintStyle(paint)}"`,
  }))

  const pathProjection =
    projection.type === "icon" ||
    projection.type === "polygon" ||
    projection.type === "star" ||
    projection.type === "vector" ||
    projection.type === "boolean_result"
      ? projection
      : null
  const shape = (
    entry: (typeof fillMarkup)[number] | (typeof strokeMarkup)[number],
    kind: "fill" | "stroke"
  ) => {
    if (pathProjection) {
      const fillRule =
        pathProjection.type === "icon"
          ? "nonzero"
          : pathProjection.content.fillRule
      return `<path d="${escapeHtml(pathProjection.content.path)}" fill-rule="${fillRule}" ${entry.attributes} />`
    }
    const inset =
      kind === "stroke" && "width" in entry.paint
        ? strokeGeometryInset({
            width: entry.paint.width,
            alignment: entry.paint.alignment,
          })
        : 0
    if (projection.type === "ellipse") {
      return `<ellipse cx="${projection.frame.width / 2}" cy="${projection.frame.height / 2}" rx="${Math.max(0, projection.frame.width / 2 - inset)}" ry="${Math.max(0, projection.frame.height / 2 - inset)}" ${entry.attributes} />`
    }
    if (
      kind === "stroke" &&
      "sides" in entry.paint &&
      !Object.values(entry.paint.sides).every(Boolean)
    ) {
      const x1 = inset
      const y1 = inset
      const x2 = projection.frame.width - inset
      const y2 = projection.frame.height - inset
      return [
        entry.paint.sides.top
          ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" ${entry.attributes} />`
          : "",
        entry.paint.sides.right
          ? `<line x1="${x2}" y1="${y1}" x2="${x2}" y2="${y2}" ${entry.attributes} />`
          : "",
        entry.paint.sides.bottom
          ? `<line x1="${x2}" y1="${y2}" x2="${x1}" y2="${y2}" ${entry.attributes} />`
          : "",
        entry.paint.sides.left
          ? `<line x1="${x1}" y1="${y2}" x2="${x1}" y2="${y1}" ${entry.attributes} />`
          : "",
      ].join("")
    }
    if (
      (projection.type === "rect" || projection.type === "frame") &&
      (projection.content.corners.independent ||
        projection.content.corners.smoothing > 0)
    ) {
      return `<path d="${escapeHtml(
        roundedRectanglePaintPath({
          width: Math.max(0, projection.frame.width - inset * 2),
          height: Math.max(0, projection.frame.height - inset * 2),
          cornerRadii: projection.content.corners.radii,
          cornerSmoothing: projection.content.corners.smoothing,
          strokeWidth:
            kind === "stroke" && "width" in entry.paint ? entry.paint.width : 0,
        })
      )}"${inset ? ` transform="translate(${inset} ${inset})"` : ""} ${entry.attributes} />`
    }
    const radius =
      "radius" in projection.content ? projection.content.radius : 0
    return `<rect x="${inset}" y="${inset}" width="${Math.max(0, projection.frame.width - inset * 2)}" height="${Math.max(0, projection.frame.height - inset * 2)}" rx="${radius}" ry="${radius}" ${entry.attributes} />`
  }
  const viewBox = pathProjection
    ? pathProjection.content.viewBox
    : `0 0 ${projection.frame.width} ${projection.frame.height}`
  const preserveAspectRatio =
    pathProjection?.type === "icon" ? "xMidYMid meet" : "none"
  const shapes = [
    ...fillMarkup.map((entry) => shape(entry, "fill")),
    ...strokeMarkup.map((entry) => shape(entry, "stroke")),
  ].join("")
  return `<svg ${identity} viewBox="${escapeHtml(viewBox)}" preserveAspectRatio="${preserveAspectRatio}" style="${common};overflow:visible"><defs>${definitions}</defs>${shapes}</svg>${imagePreloads}`
}

function renderTextMarkup(
  projection: Extract<RenderNodeProjection, { type: "text" }>
) {
  return projection.content.layout.lines
    .map((line, lineIndex) => {
      const lineStyle = [
        "display:block",
        `height:${line.height}px`,
        `line-height:${line.height}px`,
        `text-align:${line.align === "justify" ? "left" : line.align}`,
        ...(line.justifySpacing
          ? [`word-spacing:${line.justifySpacing}px`]
          : []),
        "white-space:pre",
      ].join(";")
      const segments = line.segments
        .map((segment) => {
          const decoration =
            segment.style.decoration === "line_through"
              ? "line-through"
              : segment.style.decoration
          const segmentStyle = [
            `color:${escapeHtml(segment.style.color)}`,
            `font-family:${escapeHtml(segment.style.fontFamily)},sans-serif`,
            `font-size:${segment.style.fontSize}px`,
            `font-weight:${segment.style.fontWeight}`,
            `font-style:${segment.style.italic ? "italic" : "normal"}`,
            `text-decoration-line:${decoration}`,
            `letter-spacing:${segment.style.letterSpacing}px`,
            `line-height:${line.height}px`,
          ].join(";")
          const content = `<span data-text-source-start="${segment.sourceStart}" data-text-source-end="${segment.sourceEnd}" data-render-font-node="${escapeHtml(projection.frame.id)}" data-render-font-family="${escapeHtml(segment.style.fontFamily)}" data-render-font-style="${segment.style.italic ? "italic" : "normal"}" data-render-font-weight="${segment.style.fontWeight}"${segment.synthetic ? ' data-text-synthetic="true"' : ""} style="${segmentStyle}">${escapeHtml(segment.text)}</span>`
          if (!segment.link) return content
          return `<a href="${escapeHtml(segment.link.target)}"${segment.link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""} style="color:inherit;text-decoration:inherit">${content}</a>`
        })
        .join("")
      return `<span data-text-line="${lineIndex}" style="${lineStyle}">${segments}</span>`
    })
    .join("")
}

export function renderNodeToHtml(node: SceneNode): string {
  const projection = projectNodeForRender(node)
  const { frame } = projection
  const common = [
    "position:absolute",
    "box-sizing:border-box",
    `left:${frame.x}px`,
    `top:${frame.y}px`,
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    `opacity:${frame.opacity}`,
    `mix-blend-mode:${frame.blendMode}`,
    `transform:rotate(${frame.rotation}deg)`,
    "transform-origin:top left",
    `display:${frame.visible ? "block" : "none"}`,
  ].join(";")
  const identity = `data-node-id="${escapeHtml(frame.id)}" data-node-locked="${frame.locked ? "true" : "false"}"`

  if (
    projection.type !== "text" &&
    projection.type !== "image" &&
    (hasExplicitPaintStack(
      node as Parameters<typeof hasExplicitPaintStack>[0]
    ) ||
      projection.type === "section" ||
      projection.type === "polygon" ||
      projection.type === "star" ||
      projection.type === "vector" ||
      projection.type === "boolean_result")
  ) {
    return renderPaintedShapeToHtml(projection, identity, common)
  }

  if (projection.type === "rect" || projection.type === "frame") {
    if (
      projection.content.corners.independent ||
      projection.content.corners.smoothing > 0
    ) {
      const stroke = projection.content.stroke
        ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}"`
        : ""
      const path = roundedRectanglePaintPath({
        width: frame.width,
        height: frame.height,
        cornerRadii: projection.content.corners.radii,
        cornerSmoothing: projection.content.corners.smoothing,
        strokeWidth: projection.content.stroke
          ? projection.content.strokeWidth
          : 0,
      })
      return `<svg ${identity} viewBox="0 0 ${frame.width} ${frame.height}" preserveAspectRatio="none" style="${common};overflow:visible"><path d="${escapeHtml(path)}" fill="${escapeHtml(projection.content.fill)}"${stroke} vector-effect="non-scaling-stroke" /></svg>`
    }
    const border = projection.content.stroke
      ? `;border:${projection.content.strokeWidth}px solid ${escapeHtml(projection.content.stroke)}`
      : ""
    return `<div ${identity} style="${common};background:${escapeHtml(projection.content.fill)};border-radius:${projection.content.radius}px${border}"></div>`
  }

  if (projection.type === "ellipse") {
    const border = projection.content.stroke
      ? `;border:${projection.content.strokeWidth}px solid ${escapeHtml(projection.content.stroke)}`
      : ""
    return `<div ${identity} style="${common};background:${escapeHtml(projection.content.fill)};border-radius:50%${border}"></div>`
  }

  if (projection.type === "line") {
    return `<svg ${identity} viewBox="0 0 ${frame.width} ${frame.height}" preserveAspectRatio="none" style="${common};overflow:visible"><line x1="0" y1="0" x2="${frame.width}" y2="${frame.height}" stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}" vector-effect="non-scaling-stroke" /></svg>`
  }

  if (projection.type === "icon") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}"`
      : ""
    return `<svg ${identity} viewBox="${escapeHtml(projection.content.viewBox)}" preserveAspectRatio="xMidYMid meet" style="${common}"><path d="${escapeHtml(projection.content.path)}" fill="${escapeHtml(projection.content.fill)}"${stroke} stroke-width="${projection.content.strokeWidth}" /></svg>`
  }

  if (projection.type === "image") {
    const placement = projection.content.placement
    const mask = projection.content.frameMask
    const decorativeAttribute = projection.content.decorative
      ? ' aria-hidden="true"'
      : ""
    const runtimeData = [
      `data-image-frame-width="${frame.width}"`,
      `data-image-frame-height="${frame.height}"`,
      `data-image-placement="${escapeHtml(JSON.stringify(placement))}"`,
      `data-image-frame-mask="${escapeHtml(JSON.stringify(mask))}"`,
      ...(mask.shape === "rounded_rectangle" &&
      ((mask.cornerSmoothing ?? 0) > 0 || mask.cornerRadii)
        ? [
            `data-image-frame-clip-path="${escapeHtml(
              roundedRectanglePath({
                width: frame.width,
                height: frame.height,
                radius: mask.radius * Math.min(frame.width, frame.height),
                cornerRadii: mask.cornerRadii
                  ? {
                      topLeft:
                        mask.cornerRadii.topLeft *
                        Math.min(frame.width, frame.height),
                      topRight:
                        mask.cornerRadii.topRight *
                        Math.min(frame.width, frame.height),
                      bottomRight:
                        mask.cornerRadii.bottomRight *
                        Math.min(frame.width, frame.height),
                      bottomLeft:
                        mask.cornerRadii.bottomLeft *
                        Math.min(frame.width, frame.height),
                    }
                  : undefined,
                cornerSmoothing: mask.cornerSmoothing,
              })
            )}"`,
          ]
        : []),
    ].join(" ")
    return `<div data-image-frame-id="${escapeHtml(frame.id)}" style="${common};overflow:hidden"><img ${identity} ${runtimeData}${decorativeAttribute} src="${escapeHtml(projection.content.src)}" alt="${escapeHtml(projection.content.decorative ? "" : projection.content.alt)}" style="position:absolute;left:0;top:0;max-width:none;max-height:none;transform-origin:0 0" /></div>`
  }

  const textStyle = [
    common,
    `color:${escapeHtml(projection.content.color)}`,
    `font-family:${escapeHtml(projection.content.fontFamily)},sans-serif`,
    `font-size:${projection.content.fontSize}px`,
    `font-weight:${projection.content.fontWeight}`,
    `line-height:${projection.content.lineHeight}`,
    `letter-spacing:${projection.content.letterSpacing}px`,
    "text-rendering:geometricPrecision",
    "-webkit-font-smoothing:antialiased",
    `text-align:${projection.content.align}`,
    `direction:${projection.content.direction}`,
    `display:${projection.frame.visible ? "flex" : "none"}`,
    "flex-direction:column",
    `justify-content:${projection.content.verticalAlign === "middle" ? "center" : projection.content.verticalAlign === "bottom" ? "flex-end" : "flex-start"}`,
    `white-space:${projection.content.whiteSpace}`,
    `overflow-wrap:${projection.content.overflowWrap}`,
    `overflow:${projection.content.sizingMode === "fixed" ? "hidden" : "visible"}`,
  ].join(";")
  if (node.type !== "text") throw new Error(`Unknown text node: ${node.id}`)
  const textIdentity = `${identity} data-text-sizing-mode="${projection.content.sizingMode}" data-text-measurement="${projection.content.layout.measurement}" data-text-line-count="${projection.content.layout.lineCount}" data-text-source-line-count="${projection.content.layout.sourceLineCount}" data-text-direction="${projection.content.direction}" data-text-vertical-align="${projection.content.verticalAlign}" data-text-case="${projection.content.textCase}" data-text-truncated="${projection.content.layout.truncated ? "true" : "false"}" data-text-overflow="${projection.content.layout.overflow ? "true" : "false"}" data-text-overflow-x="${projection.content.layout.overflowX ? "true" : "false"}" data-text-overflow-y="${projection.content.layout.overflowY ? "true" : "false"}"`
  return `<div ${textIdentity} style="${textStyle}">${renderTextMarkup(projection)}</div>`
}

const maskIdentifier = (groupId: string): string =>
  `studio-mask-${Array.from(groupId, (character) =>
    character.codePointAt(0)?.toString(16).padStart(6, "0")
  ).join("-")}`

const renderVectorMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds
): string => {
  if (!isAdmittedVectorMaskSource(node)) {
    throw new Error(
      `Mask source ${node.id} must be a rectangle, ellipse, or icon`
    )
  }
  const projection = projectNodeForRender(node)
  const { frame } = projection
  const x = frame.x - bounds.x
  const y = frame.y - bounds.y
  const transform = `rotate(${frame.rotation} ${x} ${y})`
  if (projection.type === "rect") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    if (
      projection.content.corners.independent ||
      projection.content.corners.smoothing > 0
    ) {
      const path = roundedRectanglePaintPath({
        width: frame.width,
        height: frame.height,
        cornerRadii: projection.content.corners.radii,
        cornerSmoothing: projection.content.corners.smoothing,
        strokeWidth: projection.content.stroke
          ? projection.content.strokeWidth
          : 0,
      })
      return `<path data-mask-source-id="${escapeHtml(frame.id)}" d="${escapeHtml(path)}" fill="white" fill-opacity="${frame.opacity}"${stroke} transform="translate(${x} ${y}) rotate(${frame.rotation} 0 0)" />`
    }
    return `<rect data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" rx="${projection.content.radius}" ry="${projection.content.radius}" fill="white" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "ellipse") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<ellipse data-mask-source-id="${escapeHtml(frame.id)}" cx="${x + frame.width / 2}" cy="${y + frame.height / 2}" rx="${frame.width / 2}" ry="${frame.height / 2}" fill="white" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "icon") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}"`
      : ""
    return `<svg data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" viewBox="${escapeHtml(projection.content.viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="visible" opacity="${frame.opacity}" transform="${transform}"><path d="${escapeHtml(projection.content.path)}" fill="white"${stroke} /></svg>`
  }
  throw new Error(`Mask source ${node.id} did not project as vector geometry`)
}

const renderCoverageMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds,
  source: MaskPaintSource | undefined,
  maskId: string
): Readonly<{ markup: string; preload: string }> => {
  if (!isAdmittedAlphaMaskSource(node)) {
    throw new Error(
      `Alpha mask source ${node.id} must be a rectangle, ellipse, icon, image, or text layer`
    )
  }
  const translatedSource = `<div xmlns="http://www.w3.org/1999/xhtml" style="position:absolute;left:${-bounds.x}px;top:${-bounds.y}px;width:${bounds.width}px;height:${bounds.height}px">${renderNodeToHtml(node)}</div>`
  if (node.type === "text" && source?.kind !== "text") {
    throw new Error(`Missing alpha text readiness for ${node.id}`)
  }
  const fontReadiness =
    node.type === "text" && source?.kind === "text"
      ? ` data-mask-font-source-node="${escapeHtml(node.id)}"`
      : ""
  const targetId = `${maskId}-${maskIdentifier(node.id)}-coverage`
  const coverageKind = node.type === "image" ? "image" : "html"
  const markup =
    node.type === "image"
      ? (() => {
          const frameX = node.x - bounds.x
          const frameY = node.y - bounds.y
          const clipId = `${targetId}-clip`
          const shorterEdge = Math.min(node.width, node.height)
          const clip =
            node.frameMask.shape === "ellipse"
              ? `<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" />`
              : node.frameMask.shape === "rounded_rectangle" &&
                  ((node.frameMask.cornerSmoothing ?? 0) > 0 ||
                    node.frameMask.cornerRadii)
                ? `<path d="${escapeHtml(
                    roundedRectanglePath({
                      width: node.width,
                      height: node.height,
                      radius: node.frameMask.radius * shorterEdge,
                      cornerRadii: node.frameMask.cornerRadii
                        ? {
                            topLeft:
                              node.frameMask.cornerRadii.topLeft * shorterEdge,
                            topRight:
                              node.frameMask.cornerRadii.topRight * shorterEdge,
                            bottomRight:
                              node.frameMask.cornerRadii.bottomRight *
                              shorterEdge,
                            bottomLeft:
                              node.frameMask.cornerRadii.bottomLeft *
                              shorterEdge,
                          }
                        : undefined,
                      cornerSmoothing: node.frameMask.cornerSmoothing,
                    })
                  )}" />`
                : `<rect x="0" y="0" width="${node.width}" height="${node.height}"${node.frameMask.shape === "rounded_rectangle" ? ` rx="${(node.frameMask.radius ?? 0) * Math.min(node.width, node.height)}" ry="${(node.frameMask.radius ?? 0) * Math.min(node.width, node.height)}"` : ""} />`
          return `<g data-mask-source-id="${escapeHtml(node.id)}" opacity="${node.opacity}" transform="translate(${frameX} ${frameY}) rotate(${node.rotation} 0 0)" clip-path="url(#${clipId})"><defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${clip}</clipPath></defs><image id="${targetId}" x="0" y="0" preserveAspectRatio="none" /></g>`
        })()
      : `<image id="${targetId}" data-mask-source-id="${escapeHtml(node.id)}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="none" />`
  const preload = `<div data-mask-coverage-template="true" data-mask-coverage-kind="${coverageKind}" data-mask-coverage-node-id="${escapeHtml(node.id)}" data-mask-coverage-target-id="${targetId}" data-mask-coverage-width="${bounds.width}" data-mask-coverage-height="${bounds.height}"${fontReadiness} aria-hidden="true" style="position:fixed;left:-100000px;top:0;width:${bounds.width}px;height:${bounds.height}px;overflow:hidden;visibility:hidden;pointer-events:none">${translatedSource}</div>`
  return { markup, preload }
}

const renderLuminanceVectorMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds
): string => {
  if (!isAdmittedVectorMaskSource(node)) {
    throw new Error(`Luminance vector source ${node.id} is not supported`)
  }
  const projection = projectNodeForRender(node)
  const { frame } = projection
  const x = frame.x - bounds.x
  const y = frame.y - bounds.y
  const transform = `rotate(${frame.rotation} ${x} ${y})`
  if (projection.type === "rect") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    if (
      projection.content.corners.independent ||
      projection.content.corners.smoothing > 0
    ) {
      const path = roundedRectanglePaintPath({
        width: frame.width,
        height: frame.height,
        cornerRadii: projection.content.corners.radii,
        cornerSmoothing: projection.content.corners.smoothing,
        strokeWidth: projection.content.stroke
          ? projection.content.strokeWidth
          : 0,
      })
      return `<path data-mask-source-id="${escapeHtml(frame.id)}" d="${escapeHtml(path)}" fill="${escapeHtml(projection.content.fill)}" fill-opacity="${frame.opacity}"${stroke} transform="translate(${x} ${y}) rotate(${frame.rotation} 0 0)" />`
    }
    return `<rect data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" rx="${projection.content.radius}" ry="${projection.content.radius}" fill="${escapeHtml(projection.content.fill)}" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "ellipse") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<ellipse data-mask-source-id="${escapeHtml(frame.id)}" cx="${x + frame.width / 2}" cy="${y + frame.height / 2}" rx="${frame.width / 2}" ry="${frame.height / 2}" fill="${escapeHtml(projection.content.fill)}" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "icon") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}"`
      : ""
    return `<svg data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" viewBox="${escapeHtml(projection.content.viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="visible" opacity="${frame.opacity}" transform="${transform}"><path d="${escapeHtml(projection.content.path)}" fill="${escapeHtml(projection.content.fill)}"${stroke} /></svg>`
  }
  throw new Error(
    `Luminance vector source ${node.id} did not project as vector geometry`
  )
}

/**
 * Serializes one canonical page-paint-plan entry for every HTML render path.
 */
export function renderPagePaintPlanEntryToHtml(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  document?: Document
): string {
  if (entry.kind === "node") {
    const node = nodesById.get(entry.nodeId)
    if (!node) throw new Error(`Unknown paint-plan node: ${entry.nodeId}`)
    const markup = renderNodeToHtml(node)
    const clips = document ? projectFrameClipStack(document, node.id) : []
    return clips.reduce(
      (content, clip, index) =>
        `<div data-frame-clip-node-id="${escapeHtml(node.id)}" data-frame-clip-depth="${index}" style="position:absolute;left:${clip.x}px;top:${clip.y}px;width:${clip.width}px;height:${clip.height}px;overflow:hidden;border-radius:${clip.cornerRadii ? cornerRadiiCss(clip.cornerRadii) : `${clip.radius}px`}${(clip.cornerSmoothing ?? 0) > 0 && clip.path ? `;clip-path:path('${clip.path}')` : ""}"><div style="position:absolute;left:${-clip.x}px;top:${-clip.y}px">${content}</div></div>`,
      markup
    )
  }

  const content = entry.content
    .map((child) => renderPagePaintPlanEntryToHtml(child, nodesById, document))
    .join("")
  const { bounds } = entry
  const groupId = escapeHtml(entry.groupId)
  const compositeStyle = [
    "position:absolute",
    "box-sizing:border-box",
    `left:${bounds.x}px`,
    `top:${bounds.y}px`,
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    "overflow:hidden",
    "isolation:isolate",
  ]
  const contentStyle = [
    "position:absolute",
    "left:0",
    "top:0",
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    `transform:translate(${-bounds.x}px,${-bounds.y}px)`,
    "transform-origin:top left",
  ]

  if (!entry.maskEnabled || !entry.compositeRequired) {
    return `<div data-mask-group-id="${groupId}" data-mask-enabled="${entry.maskEnabled ? "true" : "false"}" data-mask-composite="false" style="${compositeStyle.join(";")}"><div data-mask-content="${groupId}" style="${contentStyle.join(";")}">${content}</div></div>`
  }

  if (
    entry.maskType !== "vector" &&
    entry.maskType !== "alpha" &&
    entry.maskType !== "luminance"
  ) {
    throw new Error(`Unsupported mask paint type: ${entry.maskType}`)
  }

  const maskId = maskIdentifier(entry.groupId)
  const visibleSourceIds = new Set(entry.visibleSourceNodeIds)
  const visibleSources = entry.sourceNodeIds
    .filter((sourceNodeId) => visibleSourceIds.has(sourceNodeId))
    .map((sourceNodeId, index) => {
      const source = nodesById.get(sourceNodeId)
      if (!source) throw new Error(`Unknown mask source: ${sourceNodeId}`)
      const rendered =
        entry.maskType === "vector"
          ? { markup: renderVectorMaskSource(source, bounds), preload: "" }
          : entry.maskType === "luminance" && isAdmittedVectorMaskSource(source)
            ? {
                markup: renderLuminanceVectorMaskSource(source, bounds),
                preload: "",
              }
            : entry.maskType === "alpha" && isAdmittedVectorMaskSource(source)
              ? { markup: renderVectorMaskSource(source, bounds), preload: "" }
              : renderCoverageMaskSource(
                  source,
                  bounds,
                  entry.sources.find(
                    (candidate) => candidate.nodeId === sourceNodeId
                  ),
                  maskId
                )
      const filterId = `${maskId}-luminance-${index}`
      return { sourceNodeId, ...rendered, filterId }
    })
  const luminanceFilters =
    entry.maskType === "luminance"
      ? visibleSources
          .map(
            ({ sourceNodeId, filterId }) =>
              `<filter id="${filterId}" data-luminance-source-id="${escapeHtml(sourceNodeId)}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.2126 0.7152 0.0722 0 0" result="${filterId}-luminance"/><feComposite in="${filterId}-luminance" in2="SourceGraphic" operator="in" result="${filterId}-luminance-alpha"/></filter>`
          )
          .join("")
      : ""
  const sources = visibleSources
    .map(({ sourceNodeId, markup, filterId }) =>
      entry.maskType === "luminance"
        ? markup.startsWith("<foreignObject ")
          ? markup.replace(
              "<foreignObject ",
              `<foreignObject data-luminance-source-isolation="${escapeHtml(sourceNodeId)}" filter="url(#${filterId})" `
            )
          : `<g data-luminance-source-isolation="${escapeHtml(sourceNodeId)}" filter="url(#${filterId})">${markup}</g>`
        : markup
    )
    .join("")
  const coveragePreloads = visibleSources.map(({ preload }) => preload).join("")
  compositeStyle.push(
    `mask:url(#${maskId})`,
    `-webkit-mask:url(#${maskId})`,
    "mask-mode:alpha"
  )
  return `<div data-mask-group-id="${groupId}" data-mask-enabled="true" data-mask-composite="true" style="${compositeStyle.join(";")}"><svg aria-hidden="true" width="0" height="0" style="position:absolute"><defs>${luminanceFilters}<mask id="${maskId}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha">${sources}</mask></defs></svg>${coveragePreloads}<div data-mask-content="${groupId}" style="${contentStyle.join(";")}">${content}</div></div>`
}

function pageNodesMarkup(document: Document, pageId: string): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  return projectPagePaintPlan(document, page.id)
    .entries.map((entry) =>
      renderPagePaintPlanEntryToHtml(entry, nodesById, document)
    )
    .join("")
}

export function renderDocumentToHtml(
  document: Document,
  pageId: string
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const projectedPage = projectPageForRender(page)
  const nodes = pageNodesMarkup(document, projectedPage.id)

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(projectedPage.name)}</title><style id="renderer-font-faces">${rendererFontFaceCss}</style><style>*{box-sizing:border-box}html,body{margin:0;width:${projectedPage.width}px;height:${projectedPage.height}px;overflow:hidden}body{background:${escapeHtml(projectedPage.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body data-page-id="${escapeHtml(projectedPage.id)}">${nodes}${resourceReadyScript}</body></html>`
}

export function renderDocumentThumbnailToHtml(
  document: Document,
  pageId: string,
  requestedSize: PageThumbnailSize
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const size = assertPageThumbnailSize(page, requestedSize)
  const projectedPage = projectPageForRender(page)
  const scale = pageThumbnailScale(projectedPage, size)
  const nodes = pageNodesMarkup(document, projectedPage.id)

  return `<!doctype html><html data-thumbnail-width="${size.width}" data-thumbnail-height="${size.height}"><head><meta charset="utf-8"><title>${escapeHtml(projectedPage.name)}</title><style id="renderer-font-faces">${rendererFontFaceCss}</style><style>*{box-sizing:border-box}html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}body{position:relative;background:${escapeHtml(projectedPage.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}.studio-thumbnail-page{position:absolute;left:0;top:0;width:${projectedPage.width}px;height:${projectedPage.height}px;overflow:hidden;transform:scale(${scale});transform-origin:0 0;background:${escapeHtml(projectedPage.background)}}</style></head><body><main class="studio-thumbnail-page" data-page-id="${escapeHtml(projectedPage.id)}" data-source-width="${projectedPage.width}" data-source-height="${projectedPage.height}">${nodes}</main>${resourceReadyScript}</body></html>`
}

export function renderOutputToHtml(
  document: Document,
  outputId: string
): string {
  const output = document.outputs.find((candidate) => candidate.id === outputId)
  if (!output) throw new Error(`Unknown output: ${outputId}`)

  const pages = output.pageIds.map((pageId) => {
    const page = document.pages.find((candidate) => candidate.id === pageId)
    if (!page || page.outputId !== output.id) {
      throw new Error(`Unknown page ${pageId} for output ${outputId}`)
    }
    return projectPageForRender(page)
  })
  const pageRules = pages
    .map(
      (page, index) =>
        `@page studio-page-${index}{size:${page.width}px ${page.height}px;margin:0}.studio-page-${index}{page:studio-page-${index};width:${page.width}px;height:${page.height}px}`
    )
    .join("")
  const sheets = pages
    .map(
      (page, index) =>
        `<section class="studio-page studio-page-${index}" data-page-id="${escapeHtml(page.id)}" aria-label="${escapeHtml(page.name)}" style="background:${escapeHtml(page.background)}">${pageNodesMarkup(document, page.id)}</section>`
    )
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.name)} — ${escapeHtml(output.name)}</title><style id="renderer-font-faces">${rendererFontFaceCss}</style><style>*{box-sizing:border-box}html,body{margin:0;padding:0}.studio-page{position:relative;overflow:hidden;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}.studio-page:last-child{break-after:auto;page-break-after:auto}${pageRules}</style></head><body>${sheets}${resourceReadyScript}</body></html>`
}
