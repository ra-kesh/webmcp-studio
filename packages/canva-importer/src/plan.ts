import {
  decodeStudioInterchangePackage,
  getGroupNodeIds,
  layerEffectBounds,
  projectNodeForRender,
  roundedRectanglePath,
  type Document,
  type GroupDefinition,
  type RenderFillPaint,
  type RenderStrokePaint,
  type SceneNode,
  type StudioInterchangePackage,
} from "@webmcp/document"
import type {
  CanvaAbsolutePagePlan,
  CanvaElementBox,
  CanvaGroupElement,
  CanvaImageFill,
  CanvaImageSource,
  CanvaImportPlan,
  CanvaImportWarning,
  CanvaParagraphRange,
  CanvaPlannedElement,
  CanvaRasterElement,
  CanvaRasterizationReason,
  CanvaRasterRequest,
  CanvaShapeElement,
  CanvaShapePath,
  CanvaSolidFill,
  CanvaTextElement,
  CanvaTextRange,
  CanvaTextStyle,
} from "./types"

export type CanvaPlanOptions = Readonly<{
  /** Raster scale for unsupported selections. Defaults to 2. */
  rasterScale?: number
}>

type PlanningContext = {
  interchange: StudioInterchangePackage
  document: Document
  rasterScale: number
  nativeEditableNodeIds: Set<string>
  rasterizations: CanvaRasterRequest[]
  warnings: CanvaImportWarning[]
}

type PageRasterUnit = Readonly<{
  nodeIds: readonly string[]
  groupId?: string
  name: string
  reasons: readonly CanvaRasterizationReason[]
  firstIndex: number
}>

const visibleEffects = (node: SceneNode) =>
  (node.effects ?? []).filter((effect) => effect.visible)

const normalBlend = (value: string | undefined) =>
  value === undefined || value === "normal"

const isIdentityImageTransform = (paint: RenderFillPaint) => {
  if (paint.type !== "image") return true
  const { a, b, c, d, e, f } = paint.transform
  return a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0
}

const unsupportedFillStack = (fills: readonly RenderFillPaint[]) => {
  const visible = fills.filter((paint) => paint.visible && paint.opacity > 0)
  if (visible.length > 1) return true
  const fill = visible[0]
  if (!fill) return false
  if (fill.opacity !== 1 || !normalBlend(fill.blendMode)) return true
  if (fill.type === "linear_gradient" || fill.type === "radial_gradient") {
    return true
  }
  return !isIdentityImageTransform(fill)
}

const unsupportedStrokeStack = (strokes: readonly RenderStrokePaint[]) => {
  const visible = strokes.filter(
    (stroke) => stroke.visible && stroke.opacity > 0 && stroke.width > 0
  )
  if (visible.length > 1) return true
  const stroke = visible[0]
  if (!stroke) return false
  return (
    stroke.opacity !== 1 ||
    !normalBlend(stroke.blendMode) ||
    stroke.alignment !== "center" ||
    stroke.dash.length > 0 ||
    stroke.cap !== "butt" ||
    stroke.join !== "miter" ||
    !Object.values(stroke.sides).every(Boolean)
  )
}

const nodeRasterizationReasons = (
  node: SceneNode
): CanvaRasterizationReason[] => {
  const reasons: CanvaRasterizationReason[] = []
  if (!normalBlend(node.blendMode)) reasons.push("blend_mode")
  if (visibleEffects(node).length > 0) reasons.push("effects")
  if (node.flipX || node.flipY) reasons.push("flip_transform")

  if (node.type === "text") return reasons
  if (node.type === "image") {
    const placement = node.placement
    if (
      placement.mode !== "fill" ||
      placement.focalX !== 0.5 ||
      placement.focalY !== 0.5 ||
      placement.zoom !== 1 ||
      placement.rotation !== 0 ||
      placement.flipX ||
      placement.flipY
    ) {
      reasons.push("image_placement")
    }
    return reasons
  }

  const projection = projectNodeForRender(node)
  if (projection.type === "line") {
    if (unsupportedStrokeStack(projection.content.strokes)) {
      reasons.push("stroke_stack")
    }
    return reasons
  }
  if (projection.type === "text" || projection.type === "image") {
    return reasons
  }
  if (unsupportedFillStack(projection.content.fills)) {
    reasons.push("fill_stack")
  }
  if (unsupportedStrokeStack(projection.content.strokes)) {
    reasons.push("stroke_stack")
  }
  return reasons
}

const normalizeRotation = (rotation: number) => {
  const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

const nativeBox = (node: SceneNode): CanvaElementBox => ({
  top: node.y,
  left: node.x,
  width: Math.max(node.width, 0.01),
  height: Math.max(node.height, 0.01),
  rotation: normalizeRotation(node.rotation),
})

const rotatedBounds = (box: CanvaElementBox): CanvaElementBox => {
  if (box.rotation === 0) return box
  const radians = (box.rotation * Math.PI) / 180
  const absoluteCosine = Math.abs(Math.cos(radians))
  const absoluteSine = Math.abs(Math.sin(radians))
  const width = box.width * absoluteCosine + box.height * absoluteSine
  const height = box.width * absoluteSine + box.height * absoluteCosine
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
    rotation: 0,
  }
}

const unionBoxes = (boxes: readonly CanvaElementBox[]): CanvaElementBox => {
  if (!boxes.length) {
    return { top: 0, left: 0, width: 1, height: 1, rotation: 0 }
  }
  const bounds = boxes.map(rotatedBounds)
  const left = Math.min(...bounds.map((box) => box.left))
  const top = Math.min(...bounds.map((box) => box.top))
  const right = Math.max(...bounds.map((box) => box.left + box.width))
  const bottom = Math.max(...bounds.map((box) => box.top + box.height))
  return {
    left,
    top,
    width: Math.max(0.01, right - left),
    height: Math.max(0.01, bottom - top),
    rotation: 0,
  }
}

const boundsForNodeIds = (
  document: Document,
  nodeIds: readonly string[]
): CanvaElementBox => {
  const wanted = new Set(nodeIds)
  return unionBoxes(
    document.nodes
      .filter((node) => wanted.has(node.id) && node.visible)
      .map((node) => {
        const rotated = rotatedBounds(nativeBox(node))
        const bounds = layerEffectBounds(
          {
            x: rotated.left,
            y: rotated.top,
            width: rotated.width,
            height: rotated.height,
          },
          node.effects
        )
        return {
          top: bounds.y,
          left: bounds.x,
          width: bounds.width,
          height: bounds.height,
          rotation: 0,
        }
      })
  )
}

const metadata = (
  context: PlanningContext,
  pageId: string,
  nodeIds: readonly string[],
  groupId?: string
) => ({
  documentId: context.document.id,
  pageId,
  nodeIds: [...nodeIds],
  ...(groupId ? { groupId } : {}),
})

const baseElement = (
  context: PlanningContext,
  pageId: string,
  node: SceneNode
) => ({
  ...nativeBox(node),
  name: node.name,
  locked: node.locked,
  transparency: 1 - node.opacity,
  metadata: metadata(context, pageId, [node.id]),
})

const solidFill = (color: string): CanvaSolidFill => ({
  kind: "solid",
  color,
})

const imageSource = (
  assetId: string,
  url: string,
  altText: string,
  decorative: boolean
): CanvaImageSource => ({
  kind: "studio_asset",
  assetId,
  url,
  altText,
  decorative,
})

const imageFill = (source: CanvaImageSource): CanvaImageFill => ({
  kind: "image",
  source,
  dropTarget: false,
})

const canvaFill = (
  fill: RenderFillPaint | undefined,
  altText = "",
  decorative = true
): CanvaShapePath["fill"] => {
  if (!fill || !fill.visible || fill.opacity <= 0) return null
  if (fill.type === "image") {
    return imageFill(imageSource(fill.assetId, fill.src, altText, decorative))
  }
  if (fill.type === "linear_gradient" || fill.type === "radial_gradient") {
    return null
  }
  return solidFill(fill.color)
}

const canvaStroke = (stroke: RenderStrokePaint | undefined) =>
  !stroke || !stroke.visible || stroke.opacity <= 0 || stroke.width <= 0
    ? undefined
    : { color: stroke.color, weight: stroke.width }

const ellipsePath = (width: number, height: number) => {
  const radiusX = width / 2
  const radiusY = height / 2
  return `M ${radiusX} 0 A ${radiusX} ${radiusY} 0 1 1 ${radiusX} ${height} A ${radiusX} ${radiusY} 0 1 1 ${radiusX} 0 Z`
}

const sectionPath = (node: Extract<SceneNode, { type: "section" }>) =>
  roundedRectanglePath({
    width: node.width,
    height: node.height,
    cornerRadii: {
      topLeft: node.radius,
      topRight: node.radius,
      bottomRight: node.radius,
      bottomLeft: node.radius,
    },
    cornerSmoothing: 0,
  })

const shapeElement = (
  context: PlanningContext,
  pageId: string,
  node: Exclude<SceneNode, { type: "text" | "image" }>
): CanvaShapeElement => {
  const projection = projectNodeForRender(node)
  const base = baseElement(context, pageId, node)

  if (projection.type === "text" || projection.type === "image") {
    throw new Error(`Cannot create a Canva shape from ${projection.type}`)
  }

  if (projection.type === "line") {
    const stroke = projection.content.strokes.find(
      (candidate) =>
        candidate.visible && candidate.opacity > 0 && candidate.width > 0
    )
    const width = Math.max(node.width, stroke?.width ?? 1)
    const height = Math.max(node.height, stroke?.width ?? 1)
    return {
      ...base,
      left: node.width === 0 ? node.x - width / 2 : node.x,
      top: node.height === 0 ? node.y - height / 2 : node.y,
      width,
      height,
      type: "shape",
      viewBox: { top: 0, left: 0, width, height },
      paths: [
        {
          d: `M ${node.width === 0 ? width / 2 : 0} ${
            node.height === 0 ? height / 2 : 0
          } L ${node.width === 0 ? width / 2 : width} ${
            node.height === 0 ? height / 2 : height
          }`,
          fill: null,
          stroke: canvaStroke(stroke),
        },
      ],
    }
  }

  const fill = projection.content.fills.find(
    (candidate) => candidate.visible && candidate.opacity > 0
  )
  const stroke = projection.content.strokes.find(
    (candidate) =>
      candidate.visible && candidate.opacity > 0 && candidate.width > 0
  )
  let path: string
  switch (projection.type) {
    case "rect":
    case "frame":
      path = projection.content.corners.path
      break
    case "ellipse":
      path = ellipsePath(node.width, node.height)
      break
    case "section":
      path = sectionPath(node as Extract<SceneNode, { type: "section" }>)
      break
    default:
      path = projection.content.path
  }
  return {
    ...base,
    type: "shape",
    viewBox: { top: 0, left: 0, width: node.width, height: node.height },
    paths: [
      {
        d: path,
        fill: canvaFill(fill),
        stroke: canvaStroke(stroke),
      },
    ],
  }
}

const canvaTextStyle = (
  source: Pick<
    Extract<SceneNode, { type: "text" }>,
    | "color"
    | "fontFamily"
    | "fontSize"
    | "fontWeight"
    | "italic"
    | "decoration"
    | "lineHeight"
    | "letterSpacing"
  >
): CanvaTextStyle => ({
  color: source.color,
  fontFamily: source.fontFamily,
  fontSize: source.fontSize,
  fontWeight: source.fontWeight,
  italic: source.italic,
  decoration:
    source.decoration === "line_through" ? "strikethrough" : source.decoration,
  lineHeight: source.lineHeight,
  letterSpacing: source.letterSpacing,
})

const textElement = (
  context: PlanningContext,
  pageId: string,
  node: Extract<SceneNode, { type: "text" }>
): CanvaTextElement => {
  const ranges: CanvaTextRange[] = node.runs.map((run) => ({
    start: run.start,
    end: run.end,
    style: {
      ...(run.style.color ? { color: run.style.color } : {}),
      ...(run.style.fontFamily ? { fontFamily: run.style.fontFamily } : {}),
      ...(run.style.fontSize ? { fontSize: run.style.fontSize } : {}),
      ...(run.style.fontWeight ? { fontWeight: run.style.fontWeight } : {}),
      ...(run.style.italic !== undefined ? { italic: run.style.italic } : {}),
      ...(run.style.decoration
        ? {
            decoration:
              run.style.decoration === "line_through"
                ? ("strikethrough" as const)
                : run.style.decoration,
          }
        : {}),
      ...(run.style.lineHeight ? { lineHeight: run.style.lineHeight } : {}),
      ...(run.style.letterSpacing !== undefined
        ? { letterSpacing: run.style.letterSpacing }
        : {}),
    },
  }))
  const paragraphs: CanvaParagraphRange[] = node.paragraphs.map(
    (paragraph) => ({
      start: paragraph.start,
      end: paragraph.end,
      align:
        paragraph.style.align === "left" || !paragraph.style.align
          ? "start"
          : paragraph.style.align === "right"
            ? "end"
            : paragraph.style.align,
      ...(paragraph.style.list
        ? {
            list: {
              kind: paragraph.style.list.kind,
              level: paragraph.style.list.level,
              ...(paragraph.style.list.kind === "numbered"
                ? { start: paragraph.style.list.start }
                : {}),
            },
          }
        : {}),
    })
  )
  return {
    ...baseElement(context, pageId, node),
    type: "text",
    text: node.text,
    style: canvaTextStyle(node),
    ranges,
    paragraphs,
    horizontalAlignment:
      node.align === "left"
        ? "start"
        : node.align === "right"
          ? "end"
          : node.align,
    verticalAlignment:
      node.verticalAlign === "middle"
        ? "center"
        : node.verticalAlign === "bottom"
          ? "end"
          : "start",
  }
}

const imageMaskPath = (node: Extract<SceneNode, { type: "image" }>) => {
  if (node.frameMask.shape === "ellipse") {
    return ellipsePath(node.width, node.height)
  }
  if (node.frameMask.shape === "rounded_rectangle") {
    const edge = Math.min(node.width, node.height)
    const fallbackRadius = node.frameMask.radius * edge
    const sourceRadii = node.frameMask.cornerRadii
    return roundedRectanglePath({
      width: node.width,
      height: node.height,
      cornerRadii: sourceRadii
        ? {
            topLeft: sourceRadii.topLeft * edge,
            topRight: sourceRadii.topRight * edge,
            bottomRight: sourceRadii.bottomRight * edge,
            bottomLeft: sourceRadii.bottomLeft * edge,
          }
        : {
            topLeft: fallbackRadius,
            topRight: fallbackRadius,
            bottomRight: fallbackRadius,
            bottomLeft: fallbackRadius,
          },
      cornerSmoothing: node.frameMask.cornerSmoothing ?? 0,
    })
  }
  return `M 0 0 H ${node.width} V ${node.height} H 0 Z`
}

const imageElement = (
  context: PlanningContext,
  pageId: string,
  node: Extract<SceneNode, { type: "image" }>
): CanvaShapeElement => ({
  ...baseElement(context, pageId, node),
  type: "shape",
  viewBox: { top: 0, left: 0, width: node.width, height: node.height },
  paths: [
    {
      d: imageMaskPath(node),
      fill: imageFill(
        imageSource(node.assetId, node.src, node.alt, node.decorative)
      ),
    },
  ],
})

const rasterRequest = (
  context: PlanningContext,
  pageId: string,
  nodeIds: readonly string[],
  reasons: readonly CanvaRasterizationReason[],
  groupId?: string
): CanvaRasterRequest => ({
  kind: "studio_raster",
  pageId,
  nodeIds: [...nodeIds],
  ...(groupId ? { groupId } : {}),
  bounds: boundsForNodeIds(context.document, nodeIds),
  format: "png",
  scale: context.rasterScale,
  reasons: [...new Set(reasons)],
})

const rasterElement = (
  context: PlanningContext,
  pageId: string,
  request: CanvaRasterRequest,
  name: string
): CanvaRasterElement => {
  context.rasterizations.push(request)
  const sourceNodes = context.document.nodes.filter((node) =>
    request.nodeIds.includes(node.id)
  )
  return {
    ...request.bounds,
    name,
    locked: sourceNodes.length > 0 && sourceNodes.every((node) => node.locked),
    transparency: 0,
    metadata: metadata(context, pageId, request.nodeIds, request.groupId),
    type: "rect",
    fill: { kind: "image", source: request, dropTarget: false },
  }
}

const elementForNode = (
  context: PlanningContext,
  pageId: string,
  node: SceneNode
): CanvaPlannedElement => {
  const reasons = nodeRasterizationReasons(node)
  if (reasons.length > 0) {
    return rasterElement(
      context,
      pageId,
      rasterRequest(context, pageId, [node.id], reasons),
      node.name
    )
  }
  context.nativeEditableNodeIds.add(node.id)
  if (node.type === "text") return textElement(context, pageId, node)
  if (node.type === "image") return imageElement(context, pageId, node)
  return shapeElement(context, pageId, node)
}

const frameRasterUnits = (
  document: Document,
  pageId: string,
  pageNodeIds: readonly string[]
): PageRasterUnit[] => {
  const pageIndex = new Map(pageNodeIds.map((nodeId, index) => [nodeId, index]))
  return document.nodes
    .filter(
      (node): node is Extract<SceneNode, { type: "frame" }> =>
        node.type === "frame" && node.visible && node.clipsContent
    )
    .map((node) => {
      const nodeIds = [node.id, ...node.children.map((child) => child.nodeId)]
        .filter((nodeId) => pageIndex.has(nodeId))
        .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
      return {
        nodeIds,
        name: node.name,
        reasons: ["frame_clipping" as const],
        firstIndex: Math.min(
          ...nodeIds.map((nodeId) => pageIndex.get(nodeId) ?? Infinity)
        ),
      }
    })
    .filter(
      (unit) => unit.nodeIds.length > 1 && Number.isFinite(unit.firstIndex)
    )
}

const maskRasterUnits = (
  document: Document,
  pageId: string,
  pageNodeIds: readonly string[]
): PageRasterUnit[] => {
  const pageIndex = new Map(pageNodeIds.map((nodeId, index) => [nodeId, index]))
  return document.groups
    .filter(
      (group): group is Extract<GroupDefinition, { role: "mask" }> =>
        group.pageId === pageId && group.role === "mask"
    )
    .map((group) => {
      const nodeIds = getGroupNodeIds(document, group.id).filter((nodeId) =>
        pageIndex.has(nodeId)
      )
      return {
        nodeIds,
        groupId: group.id,
        name: group.name,
        reasons: ["mask_group" as const],
        firstIndex: Math.min(
          ...nodeIds.map((nodeId) => pageIndex.get(nodeId) ?? Infinity)
        ),
      }
    })
    .filter(
      (unit) => unit.nodeIds.length > 0 && Number.isFinite(unit.firstIndex)
    )
}

const coalesceRasterUnits = (
  units: readonly PageRasterUnit[],
  pageNodeIds: readonly string[]
): PageRasterUnit[] => {
  const pageIndex = new Map(pageNodeIds.map((nodeId, index) => [nodeId, index]))
  const pending = [...units].sort(
    (left, right) => left.firstIndex - right.firstIndex
  )
  const result: PageRasterUnit[] = []
  for (const unit of pending) {
    let merged = unit
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const existing = result[index]!
      const existingIds = new Set(existing.nodeIds)
      if (!merged.nodeIds.some((nodeId) => existingIds.has(nodeId))) continue
      const nodeIds = [
        ...new Set([...existing.nodeIds, ...merged.nodeIds]),
      ].sort(
        (left, right) =>
          (pageIndex.get(left) ?? Infinity) - (pageIndex.get(right) ?? Infinity)
      )
      merged = {
        nodeIds,
        ...(existing.groupId === merged.groupId && existing.groupId
          ? { groupId: existing.groupId }
          : {}),
        name:
          existing.name === merged.name
            ? existing.name
            : `${existing.name} + ${merged.name}`,
        reasons: [...new Set([...existing.reasons, ...merged.reasons])],
        firstIndex: Math.min(existing.firstIndex, merged.firstIndex),
      }
      result.splice(index, 1)
    }
    result.push(merged)
  }
  return result.sort((left, right) => left.firstIndex - right.firstIndex)
}

const rebaseElement = (
  element: CanvaPlannedElement,
  bounds: CanvaElementBox
): CanvaPlannedElement => ({
  ...element,
  left: element.left - bounds.left,
  top: element.top - bounds.top,
})

const contiguousIndexes = (indexes: readonly number[]) =>
  indexes.every(
    (value, index) => index === 0 || value === indexes[index - 1]! + 1
  )

const applyLeafOrganizeGroups = (
  context: PlanningContext,
  pageId: string,
  elements: CanvaPlannedElement[]
): CanvaPlannedElement[] => {
  const groups = context.document.groups.filter(
    (group) => group.pageId === pageId && group.role === "organize"
  )
  const parentIds = new Set(
    context.document.groups.flatMap((group) =>
      group.parentGroupId ? [group.parentGroupId] : []
    )
  )
  let result = elements
  for (const group of groups) {
    if (parentIds.has(group.id) || group.nodeIds.length === 0) {
      context.warnings.push({
        code: "group_flattened",
        message: `Group "${group.name}" was flattened because nested group editing is not mapped yet.`,
        pageId,
        groupId: group.id,
        nodeIds: group.nodeIds,
      })
      continue
    }
    const memberIds = new Set(group.nodeIds)
    const indexes = result.flatMap((element, index) => {
      const elementIds = element.metadata.nodeIds
      return elementIds.length === 1 && memberIds.has(elementIds[0]!)
        ? [index]
        : []
    })
    if (
      indexes.length !== group.nodeIds.length ||
      !contiguousIndexes(indexes)
    ) {
      context.warnings.push({
        code: "group_flattened",
        message: `Group "${group.name}" was flattened to preserve its page stacking order.`,
        pageId,
        groupId: group.id,
        nodeIds: group.nodeIds,
      })
      continue
    }
    const firstIndex = indexes[0]!
    const children = result.slice(firstIndex, firstIndex + indexes.length)
    const bounds = unionBoxes(children)
    const grouped: CanvaGroupElement = {
      ...bounds,
      name: group.name,
      locked: children.every((element) => element.locked),
      transparency: 0,
      metadata: metadata(context, pageId, group.nodeIds, group.id),
      type: "group",
      children: children.map((element) => rebaseElement(element, bounds)),
    }
    result = [
      ...result.slice(0, firstIndex),
      grouped,
      ...result.slice(firstIndex + indexes.length),
    ]
  }
  return result
}

const planPage = (
  context: PlanningContext,
  page: Document["pages"][number]
): CanvaAbsolutePagePlan => {
  const nodesById = new Map(
    context.document.nodes.map((node) => [node.id, node])
  )
  const maskUnits = coalesceRasterUnits(
    [
      ...maskRasterUnits(context.document, page.id, page.nodeIds),
      ...frameRasterUnits(context.document, page.id, page.nodeIds),
    ],
    page.nodeIds
  )
  const unitByFirstIndex = new Map(
    maskUnits.map((unit) => [unit.firstIndex, unit])
  )
  const maskedNodeIds = new Set(maskUnits.flatMap((unit) => unit.nodeIds))
  const elements: CanvaPlannedElement[] = []

  page.nodeIds.forEach((nodeId, index) => {
    const unit = unitByFirstIndex.get(index)
    if (unit) {
      const request = rasterRequest(
        context,
        page.id,
        unit.nodeIds,
        unit.reasons,
        unit.groupId
      )
      elements.push(rasterElement(context, page.id, request, unit.name))
    }
    if (maskedNodeIds.has(nodeId)) return
    const node = nodesById.get(nodeId)
    if (!node?.visible) return
    elements.push(elementForNode(context, page.id, node))
  })

  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(page.background)) {
    context.warnings.push({
      code: "page_background_may_differ",
      message: `Page "${page.name}" uses a background value that the Canva host may need to normalize.`,
      pageId: page.id,
    })
  }

  return {
    sourcePageId: page.id,
    name: page.name,
    width: page.width,
    height: page.height,
    background: page.background,
    elements: applyLeafOrganizeGroups(context, page.id, elements),
  }
}

const documentWarnings = (context: PlanningContext) => {
  const document = context.document
  if (document.bindings.length > 0) {
    context.warnings.push({
      code: "field_bindings_not_imported",
      message:
        "Studio field bindings remain in interchange metadata but are not Canva data bindings.",
    })
  }
  if (document.variableBindings.length > 0) {
    context.warnings.push({
      code: "variable_bindings_not_imported",
      message:
        "Studio variable bindings remain in interchange metadata but are not Canva variables.",
    })
  }
  if (
    document.components.length > 0 ||
    document.componentInstances.length > 0
  ) {
    context.warnings.push({
      code: "component_semantics_not_imported",
      message:
        "Component instances import as editable layers without Studio component identity.",
    })
  }
  const constrainedNodeIds = document.nodes
    .filter(
      (node) =>
        node.constraints.horizontal !== "min" ||
        node.constraints.vertical !== "min"
    )
    .map((node) => node.id)
  if (constrainedNodeIds.length > 0) {
    context.warnings.push({
      code: "constraints_not_imported",
      message:
        "Studio resize constraints do not have an equivalent Canva binding.",
      nodeIds: constrainedNodeIds,
    })
  }
  const linkedTextNodeIds = document.nodes
    .filter((node) => node.type === "text" && node.links.length > 0)
    .map((node) => node.id)
  if (linkedTextNodeIds.length > 0) {
    context.warnings.push({
      code: "text_links_not_imported",
      message:
        "Text stays editable, but Studio text links are not included in the Canva element plan.",
      nodeIds: linkedTextNodeIds,
    })
  }
  const overflowNodeIds = document.nodes
    .filter(
      (node) =>
        node.type === "text" &&
        (node.truncation !== undefined || node.maxLines !== undefined)
    )
    .map((node) => node.id)
  if (overflowNodeIds.length > 0) {
    context.warnings.push({
      code: "text_overflow_may_differ",
      message:
        "Canva may reflow text that uses Studio clipping or line limits.",
      nodeIds: overflowNodeIds,
    })
  }
  const fontNodeIds = document.nodes
    .filter((node) => node.type === "text")
    .map((node) => node.id)
  if (fontNodeIds.length > 0) {
    context.warnings.push({
      code: "font_may_substitute",
      message:
        "The Canva host must resolve each Studio font or report its substitution.",
      nodeIds: fontNodeIds,
    })
  }
}

export function planCanvaImport(
  input: StudioInterchangePackage | unknown,
  options: CanvaPlanOptions = {}
): CanvaImportPlan {
  const interchange = decodeStudioInterchangePackage(input)
  const rasterScale = options.rasterScale ?? 2
  if (!Number.isFinite(rasterScale) || rasterScale <= 0 || rasterScale > 4) {
    throw new Error(
      "Canva raster scale must be greater than zero and at most 4"
    )
  }
  const context: PlanningContext = {
    interchange,
    document: interchange.document,
    rasterScale,
    nativeEditableNodeIds: new Set<string>(),
    rasterizations: [],
    warnings: [],
  }
  documentWarnings(context)
  const pages = context.document.pages.map((page) => planPage(context, page))
  return {
    format: "webmcp-studio-canva-import",
    version: 1,
    source: {
      documentId: interchange.source.documentId,
      documentName: interchange.source.documentName,
      revision: interchange.source.documentRevision,
      interchangeVersion: interchange.version,
    },
    pages,
    compatibility: {
      nativeEditableNodeIds: [...context.nativeEditableNodeIds],
      rasterizations: context.rasterizations,
      warnings: context.warnings,
    },
  }
}
