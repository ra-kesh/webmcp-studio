import type { FillPaint, SceneNode, StrokePaint } from "./schema"

export type PaintStackNode = Extract<
  SceneNode,
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

export const isSolidFillPaint = (
  paint: FillPaint
): paint is Extract<FillPaint, { color: string }> =>
  paint.type === undefined || paint.type === "solid"

const availablePaintId = (paints: readonly FillPaint[], requested: string) => {
  const ids = new Set(paints.map((paint) => paint.id))
  if (!ids.has(requested)) return requested
  let suffix = 2
  while (ids.has(`${requested}-${suffix}`)) suffix += 1
  return `${requested}-${suffix}`
}

export const nodeFillPaints = (node: PaintStackNode): readonly FillPaint[] => {
  if (node.type === "line") return []
  if (node.fills !== undefined) return node.fills
  return [
    {
      id: "legacy-fill",
      color: node.fill,
      opacity: 1,
      visible: true,
    },
  ]
}

export const nodeStrokePaints = (
  node: PaintStackNode
): readonly StrokePaint[] => {
  if (node.strokes !== undefined) return node.strokes
  if (!node.stroke || node.strokeWidth <= 0) return []
  return [
    {
      id: "legacy-stroke",
      color: node.stroke,
      width: node.strokeWidth,
      opacity: 1,
      visible: true,
    },
  ]
}

export const visibleFillPaints = (node: PaintStackNode) =>
  nodeFillPaints(node).filter((paint) => paint.visible && paint.opacity > 0)

export const visibleStrokePaints = (node: PaintStackNode) =>
  nodeStrokePaints(node).filter(
    (paint) => paint.visible && paint.opacity > 0 && paint.width > 0
  )

export const hasExplicitPaintStack = (node: PaintStackNode) =>
  (node.type !== "line" && node.fills !== undefined) ||
  node.strokes !== undefined

export function synchronizeLegacyPaintFields(
  node: PaintStackNode,
  patch: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const next = { ...patch }
  if (node.type !== "line") {
    if (Array.isArray(next.fills)) {
      const firstSolid = (next.fills as FillPaint[]).find(isSolidFillPaint)
      if (firstSolid) next.fill = firstSolid.color
    } else if (typeof next.fill === "string" && node.fills?.[0]) {
      const first = node.fills[0]
      next.fills =
        first && isSolidFillPaint(first)
          ? [{ ...first, color: next.fill }, ...node.fills.slice(1)]
          : [
              {
                id: availablePaintId(node.fills ?? [], "direct-fill"),
                type: "solid",
                color: next.fill,
                opacity: 1,
                visible: true,
              },
              ...(node.fills ?? []),
            ]
    }
  }
  if (Array.isArray(next.strokes)) {
    const first = next.strokes[0] as StrokePaint | undefined
    if (first) {
      next.stroke = first.color
      next.strokeWidth = first.width
    }
  } else if (node.strokes?.[0]) {
    if (
      typeof next.stroke === "string" ||
      typeof next.strokeWidth === "number"
    ) {
      next.strokes = [
        {
          ...node.strokes[0],
          ...(typeof next.stroke === "string" ? { color: next.stroke } : {}),
          ...(typeof next.strokeWidth === "number"
            ? { width: next.strokeWidth }
            : {}),
        },
        ...node.strokes.slice(1),
      ]
    }
  }
  return next
}

export function scaleStrokePaints(
  paints: readonly StrokePaint[] | undefined,
  scale: number
): readonly StrokePaint[] | undefined {
  return paints?.map((paint) => ({
    ...paint,
    width: paint.width * scale,
    ...(paint.dash ? { dash: paint.dash.map((value) => value * scale) } : {}),
  }))
}
