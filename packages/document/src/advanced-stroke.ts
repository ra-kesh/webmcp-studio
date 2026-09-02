import type { StrokePaint } from "./schema"

export type StrokeSides = NonNullable<StrokePaint["sides"]>

export const allStrokeSides = (): StrokeSides => ({
  top: true,
  right: true,
  bottom: true,
  left: true,
})

export const strokePaintOutset = (
  paint: Pick<StrokePaint, "width" | "alignment">
) =>
  paint.alignment === "outside"
    ? paint.width
    : paint.alignment === "center"
      ? paint.width / 2
      : 0

export const strokeStackOutset = (paints: readonly StrokePaint[]) =>
  paints.reduce(
    (maximum, paint) =>
      paint.visible ? Math.max(maximum, strokePaintOutset(paint)) : maximum,
    0
  )

export const strokeStackBounds = (
  frame: { x: number; y: number; width: number; height: number },
  paints: readonly StrokePaint[]
) => {
  const outset = strokeStackOutset(paints)
  return {
    x: frame.x - outset,
    y: frame.y - outset,
    width: frame.width + outset * 2,
    height: frame.height + outset * 2,
  }
}

export const strokeGeometryInset = (
  paint: Pick<StrokePaint, "width" | "alignment">
) =>
  paint.alignment === "outside"
    ? -paint.width / 2
    : paint.alignment === "center"
      ? 0
      : paint.width / 2
