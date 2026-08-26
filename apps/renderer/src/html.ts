import type { Document, SceneNode } from "@webmcp/document"

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

function nodeMarkup(node: SceneNode): string {
  const common = [
    "position:absolute",
    `left:${node.x}px`,
    `top:${node.y}px`,
    `width:${node.width}px`,
    `height:${node.height}px`,
    `opacity:${node.opacity}`,
    `transform:rotate(${node.rotation}deg)`,
    `display:${node.visible ? "block" : "none"}`,
  ].join(";")

  if (node.type === "rect") {
    return `<div data-node-id="${escapeHtml(node.id)}" style="${common};background:${escapeHtml(node.fill)};border-radius:${node.radius}px"></div>`
  }

  if (node.type === "image") {
    return `<img data-node-id="${escapeHtml(node.id)}" src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}" style="${common};object-fit:${node.fit}" />`
  }

  const textStyle = [
    common,
    `color:${escapeHtml(node.color)}`,
    `font-family:${escapeHtml(node.fontFamily)},sans-serif`,
    `font-size:${node.fontSize}px`,
    `font-weight:${node.fontWeight}`,
    "line-height:1.18",
    `text-align:${node.align}`,
    "white-space:pre-line",
  ].join(";")
  return `<div data-node-id="${escapeHtml(node.id)}" style="${textStyle}">${escapeHtml(node.text)}</div>`
}

export function renderDocumentToHtml(
  document: Document,
  pageId: string
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const nodes = page.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is SceneNode => node !== undefined)
    .map(nodeMarkup)
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:${page.width}px;height:${page.height}px;overflow:hidden}body{background:${escapeHtml(page.background)}}</style></head><body>${nodes}</body></html>`
}
