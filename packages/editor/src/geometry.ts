import type { SceneNode } from "@webmcp/document"

export type Alignment =
  "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom"

export type Distribution = "horizontal" | "vertical"

export type NodePositionChange = {
  nodeId: string
  patch: Pick<SceneNode, "x" | "y">
}

export type NodeBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

const round = (value: number) => Math.round(value * 10) / 10

export function getNodeBounds(node: SceneNode): NodeBounds {
  const angle = (node.rotation * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const corners = [
    { x: 0, y: 0 },
    { x: node.width * cosine, y: node.width * sine },
    { x: -node.height * sine, y: node.height * cosine },
    {
      x: node.width * cosine - node.height * sine,
      y: node.width * sine + node.height * cosine,
    },
  ]
  const left = node.x + Math.min(...corners.map((corner) => corner.x))
  const right = node.x + Math.max(...corners.map((corner) => corner.x))
  const top = node.y + Math.min(...corners.map((corner) => corner.y))
  const bottom = node.y + Math.max(...corners.map((corner) => corner.y))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function getSelectionBounds(nodes: SceneNode[]): NodeBounds | null {
  if (!nodes.length) return null
  const bounds = nodes.map(getNodeBounds)
  const left = Math.min(...bounds.map((item) => item.left))
  const top = Math.min(...bounds.map((item) => item.top))
  const right = Math.max(...bounds.map((item) => item.right))
  const bottom = Math.max(...bounds.map((item) => item.bottom))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function alignNodes(
  nodes: SceneNode[],
  alignment: Alignment
): NodePositionChange[] {
  const selection = getSelectionBounds(nodes)
  if (!selection || nodes.length < 2) return []

  return nodes.map((node) => {
    const bounds = getNodeBounds(node)
    let deltaX = 0
    let deltaY = 0
    if (alignment === "left") deltaX = selection.left - bounds.left
    if (alignment === "horizontal-center")
      deltaX = selection.centerX - bounds.centerX
    if (alignment === "right") deltaX = selection.right - bounds.right
    if (alignment === "top") deltaY = selection.top - bounds.top
    if (alignment === "vertical-center")
      deltaY = selection.centerY - bounds.centerY
    if (alignment === "bottom") deltaY = selection.bottom - bounds.bottom
    return {
      nodeId: node.id,
      patch: { x: round(node.x + deltaX), y: round(node.y + deltaY) },
    }
  })
}

export function alignNodesToBounds(
  nodes: SceneNode[],
  alignment: Alignment,
  target: NodeBounds
): NodePositionChange[] {
  const selection = getSelectionBounds(nodes)
  if (!selection) return []
  let deltaX = 0
  let deltaY = 0
  if (alignment === "left") deltaX = target.left - selection.left
  if (alignment === "horizontal-center")
    deltaX = target.centerX - selection.centerX
  if (alignment === "right") deltaX = target.right - selection.right
  if (alignment === "top") deltaY = target.top - selection.top
  if (alignment === "vertical-center")
    deltaY = target.centerY - selection.centerY
  if (alignment === "bottom") deltaY = target.bottom - selection.bottom

  return nodes.map((node) => ({
    nodeId: node.id,
    patch: { x: round(node.x + deltaX), y: round(node.y + deltaY) },
  }))
}

export function distributeNodes(
  nodes: SceneNode[],
  distribution: Distribution
): NodePositionChange[] {
  if (nodes.length < 3) return []
  const horizontal = distribution === "horizontal"
  const entries = nodes
    .map((node) => ({ node, bounds: getNodeBounds(node) }))
    .sort((a, b) =>
      horizontal ? a.bounds.left - b.bounds.left : a.bounds.top - b.bounds.top
    )
  const first = entries[0]
  const last = entries.at(-1)
  if (!first || !last) return []
  const start = horizontal ? first.bounds.left : first.bounds.top
  const end = horizontal ? last.bounds.right : last.bounds.bottom
  const occupied = entries.reduce(
    (total, entry) =>
      total + (horizontal ? entry.bounds.width : entry.bounds.height),
    0
  )
  const gap = (end - start - occupied) / (entries.length - 1)
  let cursor = start

  return entries.map(({ node, bounds }) => {
    const current = horizontal ? bounds.left : bounds.top
    const delta = cursor - current
    cursor += (horizontal ? bounds.width : bounds.height) + gap
    return {
      nodeId: node.id,
      patch: {
        x: round(node.x + (horizontal ? delta : 0)),
        y: round(node.y + (horizontal ? 0 : delta)),
      },
    }
  })
}
