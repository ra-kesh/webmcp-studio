import type { Document, SceneNode } from "@webmcp/document"

const round = (value: number, places = 3) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const nodeColors = (node: SceneNode) => {
  const colors = new Set<string>()
  const record = node as unknown as Record<string, unknown>
  for (const key of ["color", "fill", "stroke"]) {
    const value = record[key]
    if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)) {
      colors.add(value.toUpperCase())
    }
  }
  for (const key of ["fills", "strokes"]) {
    const paints = record[key]
    if (!Array.isArray(paints)) continue
    for (const paint of paints) {
      if (!paint || typeof paint !== "object") continue
      const color = (paint as Record<string, unknown>).color
      if (typeof color === "string" && /^#[0-9a-f]{3,8}$/i.test(color)) {
        colors.add(color.toUpperCase())
      }
    }
  }
  return colors
}

const regionFor = (x: number, y: number) => {
  const horizontal = x < 1 / 3 ? "left" : x > 2 / 3 ? "right" : "center"
  const vertical = y < 1 / 3 ? "top" : y > 2 / 3 ? "bottom" : "middle"
  return `${vertical}-${horizontal}`
}

export function analyzeGeneratedCandidatePage(
  document: Document,
  pageId: string
) {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown generated candidate page ${pageId}.`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const nodes = page.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is SceneNode => Boolean(node?.visible))
  const palette = new Set<string>([page.background.toUpperCase()])
  const grid = Array.from({ length: 20 * 20 }, () => false)
  const regionCounts = new Map<string, number>()
  const anchors = nodes.map((node, zIndex) => {
    for (const color of nodeColors(node)) palette.add(color)
    const left = node.x / page.width
    const top = node.y / page.height
    const right = (node.x + node.width) / page.width
    const bottom = (node.y + node.height) / page.height
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    const region = regionFor(centerX, centerY)
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1)
    const startX = Math.max(0, Math.floor(left * 20))
    const endX = Math.min(20, Math.ceil(right * 20))
    const startY = Math.max(0, Math.floor(top * 20))
    const endY = Math.min(20, Math.ceil(bottom * 20))
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) grid[y * 20 + x] = true
    }
    return {
      name: node.name,
      type: node.type,
      zIndex,
      region,
      frame: {
        x: round(left),
        y: round(top),
        width: round(node.width / page.width),
        height: round(node.height / page.height),
        rotation: round(node.rotation),
      },
      opacity: round(node.opacity),
      outOfBounds: left < 0 || top < 0 || right > 1 || bottom > 1,
      ...(node.type === "text"
        ? {
            typography: {
              fontFamily: node.fontFamily,
              fontSize: node.fontSize,
              fontWeight: node.fontWeight,
              lineHeight: node.lineHeight,
              characters: node.text.length,
            },
          }
        : {}),
    }
  })

  const overlaps: Array<Record<string, unknown>> = []
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    const first = nodes[firstIndex]!
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < nodes.length;
      secondIndex += 1
    ) {
      const second = nodes[secondIndex]!
      const width = Math.max(
        0,
        Math.min(first.x + first.width, second.x + second.width) -
          Math.max(first.x, second.x)
      )
      const height = Math.max(
        0,
        Math.min(first.y + first.height, second.y + second.height) -
          Math.max(first.y, second.y)
      )
      const area = width * height
      if (area <= 0) continue
      const ratio =
        area /
        Math.min(first.width * first.height, second.width * second.height)
      if (ratio < 0.03) continue
      overlaps.push({
        lower: { name: first.name, type: first.type, zIndex: firstIndex },
        upper: { name: second.name, type: second.type, zIndex: secondIndex },
        smallerNodeCoverage: round(ratio),
      })
    }
  }
  overlaps.sort(
    (a, b) =>
      Number(b.smallerNodeCoverage ?? 0) - Number(a.smallerNodeCoverage ?? 0)
  )

  const textSizes = nodes
    .filter(
      (node): node is Extract<SceneNode, { type: "text" }> =>
        node.type === "text"
    )
    .map((node) => node.fontSize)
    .filter((size) => Number.isFinite(size) && size > 0)
  const occupiedCells = grid.filter(Boolean).length
  const occupiedRatio = occupiedCells / grid.length
  const outOfBounds = anchors.filter((anchor) => anchor.outOfBounds)
  const warnings: string[] = []
  if (occupiedRatio > 0.82)
    warnings.push("Estimated negative space is below 18%.")
  if (occupiedRatio < 0.18 && nodes.length > 1)
    warnings.push(
      "Estimated occupied area is below 18%; check whether the focal event is strong enough."
    )
  if (outOfBounds.length)
    warnings.push(
      `${outOfBounds.length} visible layer(s) extend beyond the page bounds.`
    )
  if (
    textSizes.length > 1 &&
    Math.max(...textSizes) / Math.min(...textSizes) < 3
  )
    warnings.push("Typography scale jump is below 3x.")

  return {
    page: {
      id: page.id,
      name: page.name,
      width: page.width,
      height: page.height,
      background: page.background,
    },
    composition: {
      visibleLayerCount: nodes.length,
      occupiedAreaEstimate: round(occupiedRatio),
      negativeSpaceEstimate: round(1 - occupiedRatio),
      regions: Object.fromEntries([...regionCounts].sort()),
      palette: [...palette],
      typographyScale:
        textSizes.length > 0
          ? {
              minimum: Math.min(...textSizes),
              maximum: Math.max(...textSizes),
              ratio: round(Math.max(...textSizes) / Math.min(...textSizes)),
            }
          : null,
      anchors,
      overlaps: overlaps.slice(0, 24),
      warnings,
      interpretation:
        "Frames and density are renderer-independent composition aids. The attached PNG is the canonical visual authority for clipping, text layout, effects, and intentional overlap.",
    },
  }
}
