import type {
  DesignStyleTarget,
  Document,
  PaintStyle,
  SceneNode,
  TextNode,
  TypographyStyle,
} from "./schema"
import { applyTextStyleToRange } from "./text-range-editing"
import { applyTextLayoutPatch } from "./text-layout"
import type { TextRun, TextRunStyle } from "./rich-text"
import { normalizeTextRuns } from "./rich-text"

export type DesignStyleKind = "typography" | "paint"

export type DesignStyleUsage = Readonly<{
  styleId: string
  kind: DesignStyleKind
  nodeIds: readonly string[]
  nodeAttachmentCount: number
  rangeAttachmentCount: number
  totalAttachmentCount: number
}>

const typographyProperties = (style: TypographyStyle) => ({
  fontFamily: style.fontFamily,
  fontSize: style.fontSize,
  fontWeight: style.fontWeight,
  italic: style.italic,
  decoration: style.decoration,
  lineHeight: style.lineHeight,
  letterSpacing: style.letterSpacing,
})

const typographyRunStyle = (style: TypographyStyle): TextRunStyle => ({
  typographyStyleId: style.id,
  ...typographyProperties(style),
})

const paintRunStyle = (style: PaintStyle): TextRunStyle => ({
  paintStyleId: style.id,
  color: style.color,
})

const rangeForTarget = (node: TextNode, target: DesignStyleTarget) => {
  if (!target.range) return null
  if (target.range.end > node.text.length) {
    throw new Error(
      `Style range [${target.range.start}, ${target.range.end}) exceeds ${node.name}`
    )
  }
  return { anchor: target.range.start, focus: target.range.end }
}

const replaceRunAttachment = (
  node: TextNode,
  kind: DesignStyleKind,
  styleId: string,
  replacement: Readonly<TextRunStyle>
): TextRun[] => {
  const hasAttachment = node.runs.some((run) =>
    kind === "typography"
      ? run.style.typographyStyleId === styleId
      : run.style.paintStyleId === styleId
  )
  if (!hasAttachment) return node.runs
  return normalizeTextRuns(
    node.text,
    node.runs.map((run) => {
      const attached =
        kind === "typography"
          ? run.style.typographyStyleId === styleId
          : run.style.paintStyleId === styleId
      return attached
        ? { ...run, style: { ...run.style, ...replacement } }
        : run
    })
  )
}

export function applyTypographyStyleToTarget(
  node: SceneNode,
  target: DesignStyleTarget,
  style: TypographyStyle
): SceneNode {
  if (node.type !== "text") {
    throw new Error(`Typography styles can only be applied to text layers`)
  }
  const range = rangeForTarget(node, target)
  if (range) {
    return applyTextLayoutPatch(node, {
      runs: applyTextStyleToRange(
        node.text,
        node.runs,
        range,
        typographyRunStyle(style)
      ),
    })
  }
  return applyTextLayoutPatch(node, {
    typographyStyleId: style.id,
    ...typographyProperties(style),
  })
}

export function detachTypographyStyleFromTarget(
  node: SceneNode,
  target: DesignStyleTarget
): SceneNode {
  if (node.type !== "text") {
    throw new Error(`Typography styles can only be detached from text layers`)
  }
  const range = rangeForTarget(node, target)
  if (range) {
    return {
      ...node,
      runs: applyTextStyleToRange(node.text, node.runs, range, {
        typographyStyleId: null,
      }),
    }
  }
  const { typographyStyleId: _styleId, ...detached } = node
  return detached
}

function paintPropertyForNode(node: SceneNode): "color" | "fill" | "stroke" {
  if (node.type === "text") return "color"
  if (node.type === "line") return "stroke"
  if (node.type === "rect" || node.type === "ellipse" || node.type === "icon") {
    return "fill"
  }
  throw new Error(`Paint styles are not available for image layers`)
}

export function applyPaintStyleToTarget(
  node: SceneNode,
  target: DesignStyleTarget,
  style: PaintStyle
): SceneNode {
  if (target.range) {
    if (node.type !== "text") {
      throw new Error(`Paint ranges can only target text layers`)
    }
    const range = rangeForTarget(node, target)!
    return {
      ...node,
      runs: applyTextStyleToRange(
        node.text,
        node.runs,
        range,
        paintRunStyle(style)
      ),
    }
  }
  const property = paintPropertyForNode(node)
  return {
    ...node,
    paintStyleId: style.id,
    [property]: style.color,
    opacity: style.opacity,
  } as SceneNode
}

export function detachPaintStyleFromTarget(
  node: SceneNode,
  target: DesignStyleTarget
): SceneNode {
  if (target.range) {
    if (node.type !== "text") {
      throw new Error(`Paint ranges can only target text layers`)
    }
    const range = rangeForTarget(node, target)!
    return {
      ...node,
      runs: applyTextStyleToRange(node.text, node.runs, range, {
        paintStyleId: null,
      }),
    }
  }
  if (node.type === "image") {
    throw new Error(`Paint styles are not available for image layers`)
  }
  const { paintStyleId: _styleId, ...detached } = node
  return detached
}

export function propagateTypographyStyle(
  node: SceneNode,
  style: TypographyStyle
): SceneNode {
  if (node.type !== "text") return node
  const nextRuns = replaceRunAttachment(
    node,
    "typography",
    style.id,
    typographyRunStyle(style)
  )
  if (node.typographyStyleId !== style.id && nextRuns === node.runs) return node
  return applyTextLayoutPatch(node, {
    ...(node.typographyStyleId === style.id
      ? { typographyStyleId: style.id, ...typographyProperties(style) }
      : {}),
    runs: nextRuns,
  })
}

export function propagatePaintStyle(
  node: SceneNode,
  style: PaintStyle
): SceneNode {
  if (node.type === "image") return node
  if (node.type === "text") {
    const nextRuns = replaceRunAttachment(
      node,
      "paint",
      style.id,
      paintRunStyle(style)
    )
    if (node.paintStyleId !== style.id) {
      return nextRuns !== node.runs ? { ...node, runs: nextRuns } : node
    }
    return {
      ...node,
      color: style.color,
      opacity: style.opacity,
      runs: nextRuns,
    }
  }
  if (node.paintStyleId !== style.id) return node
  const property = paintPropertyForNode(node)
  return {
    ...node,
    [property]: style.color,
    opacity: style.opacity,
  } as SceneNode
}

export function detachStyleForDirectNodePatch(
  node: SceneNode,
  patch: Readonly<Record<string, unknown>>
): SceneNode {
  let next = node
  if (
    node.type === "text" &&
    node.typographyStyleId &&
    [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "italic",
      "decoration",
      "lineHeight",
      "letterSpacing",
    ].some((property) => property in patch) &&
    !("typographyStyleId" in patch)
  ) {
    const textNode = next as TextNode
    const { typographyStyleId: _styleId, ...detached } = textNode
    next = detached
  }
  const paintProperty =
    node.type === "text"
      ? "color"
      : node.type === "line"
        ? "stroke"
        : node.type === "rect" ||
            node.type === "ellipse" ||
            node.type === "icon"
          ? "fill"
          : null
  if (
    node.type !== "image" &&
    node.paintStyleId &&
    ((paintProperty !== null && paintProperty in patch) ||
      "opacity" in patch) &&
    !("paintStyleId" in patch)
  ) {
    const { paintStyleId: _styleId, ...detached } = next as Exclude<
      SceneNode,
      { type: "image" }
    >
    next = detached as SceneNode
  }
  return next
}

export function designStyleUsage(
  document: Document,
  kind: DesignStyleKind,
  styleId: string
): DesignStyleUsage {
  const nodeIds = new Set<string>()
  let nodeAttachmentCount = 0
  let rangeAttachmentCount = 0
  for (const node of document.nodes) {
    if (
      (kind === "typography" &&
        node.type === "text" &&
        node.typographyStyleId === styleId) ||
      (kind === "paint" &&
        node.type !== "image" &&
        node.paintStyleId === styleId)
    ) {
      nodeIds.add(node.id)
      nodeAttachmentCount += 1
    }
    if (node.type !== "text") continue
    for (const run of node.runs) {
      const attached =
        kind === "typography"
          ? run.style.typographyStyleId === styleId
          : run.style.paintStyleId === styleId
      if (!attached) continue
      nodeIds.add(node.id)
      rangeAttachmentCount += 1
    }
  }
  return {
    styleId,
    kind,
    nodeIds: [...nodeIds],
    nodeAttachmentCount,
    rangeAttachmentCount,
    totalAttachmentCount: nodeAttachmentCount + rangeAttachmentCount,
  }
}
