import type { SceneNode } from "./schema"

export type FrameLayoutGrid = Extract<
  NonNullable<Extract<SceneNode, { type: "frame" }>["layoutGrids"]>[number],
  { pattern: "columns" | "rows" | "grid" }
>

export type FrameLayoutGridSection = Readonly<{
  axis: "x" | "y"
  start: number
  end: number
}>

export type FrameLayoutGridLine = Readonly<{
  axis: "x" | "y"
  position: number
}>

const MAX_PROJECTED_GRID_LINES = 4_096

const bandSize = (
  frameSize: number,
  grid: Extract<FrameLayoutGrid, { pattern: "columns" | "rows" }>
) =>
  grid.alignment === "stretch"
    ? (frameSize -
        grid.offset * 2 -
        Math.max(0, grid.count - 1) * grid.gutter) /
      grid.count
    : grid.sectionSize

const bandStart = (
  frameSize: number,
  grid: Extract<FrameLayoutGrid, { pattern: "columns" | "rows" }>,
  sectionSize: number
) => {
  const span =
    grid.count * sectionSize + Math.max(0, grid.count - 1) * grid.gutter
  if (grid.alignment === "center") return (frameSize - span) / 2 + grid.offset
  if (grid.alignment === "max") return frameSize - span - grid.offset
  return grid.offset
}

export function projectFrameLayoutGridSections(
  frame: Pick<Extract<SceneNode, { type: "frame" }>, "width" | "height">,
  grid: FrameLayoutGrid
): FrameLayoutGridSection[] {
  if (!grid.visible || grid.pattern === "grid") return []
  const axis: "x" | "y" = grid.pattern === "columns" ? "x" : "y"
  const frameSize = axis === "x" ? frame.width : frame.height
  const size = bandSize(frameSize, grid)
  if (!Number.isFinite(size) || size <= 0) return []
  const start = bandStart(frameSize, grid, size)
  return Array.from({ length: grid.count }, (_, index) => ({
    axis,
    start: start + index * (size + grid.gutter),
    end: start + index * (size + grid.gutter) + size,
  })).filter((section) => section.end > 0 && section.start < frameSize)
}

export function projectFrameLayoutGridLines(
  frame: Pick<Extract<SceneNode, { type: "frame" }>, "width" | "height">,
  grid: FrameLayoutGrid
): FrameLayoutGridLine[] {
  if (!grid.visible) return []
  if (grid.pattern !== "grid") {
    return projectFrameLayoutGridSections(frame, grid).flatMap((section) => [
      { axis: section.axis, position: section.start },
      { axis: section.axis, position: section.end },
    ])
  }
  const lines: FrameLayoutGridLine[] = []
  for (
    let x = grid.offset, index = 0;
    x <= frame.width && index < MAX_PROJECTED_GRID_LINES;
    x += grid.size, index += 1
  ) {
    lines.push({ axis: "x", position: x })
  }
  for (
    let y = grid.offset, index = 0;
    y <= frame.height && index < MAX_PROJECTED_GRID_LINES;
    y += grid.size, index += 1
  ) {
    lines.push({ axis: "y", position: y })
  }
  return lines
}

export function scaleFrameLayoutGrid(
  grid: FrameLayoutGrid,
  scale: number
): FrameLayoutGrid {
  if (grid.pattern === "grid") {
    return { ...grid, offset: grid.offset * scale, size: grid.size * scale }
  }
  return {
    ...grid,
    offset: grid.offset * scale,
    sectionSize: grid.sectionSize * scale,
    gutter: grid.gutter * scale,
  }
}
