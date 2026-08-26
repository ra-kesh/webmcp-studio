import type { Document, SceneNode } from "@webmcp/document"

const GEIST_FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.3.0/files/geist-latin-wght-normal.woff2"
const geistFontFace = `@font-face{font-family:"Geist Variable";font-style:normal;font-display:block;font-weight:100 900;src:url("${GEIST_FONT_URL}") format("woff2")}`
const fontReadyScript = `<script>document.fonts.ready.then(()=>document.documentElement.setAttribute("data-fonts-ready","true"))</script>`

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
    "transform-origin:top left",
    `display:${node.visible ? "block" : "none"}`,
  ].join(";")

  if (node.type === "rect") {
    const border = node.stroke
      ? `;border:${node.strokeWidth}px solid ${escapeHtml(node.stroke)}`
      : ""
    return `<div data-node-id="${escapeHtml(node.id)}" style="${common};background:${escapeHtml(node.fill)};border-radius:${node.radius}px${border}"></div>`
  }

  if (node.type === "ellipse") {
    const border = node.stroke
      ? `;border:${node.strokeWidth}px solid ${escapeHtml(node.stroke)}`
      : ""
    return `<div data-node-id="${escapeHtml(node.id)}" style="${common};background:${escapeHtml(node.fill)};border-radius:50%${border}"></div>`
  }

  if (node.type === "line") {
    return `<svg data-node-id="${escapeHtml(node.id)}" viewBox="0 0 ${node.width} ${node.height}" preserveAspectRatio="none" style="${common};overflow:visible"><line x1="0" y1="0" x2="${node.width}" y2="${node.height}" stroke="${escapeHtml(node.stroke)}" stroke-width="${node.strokeWidth}" vector-effect="non-scaling-stroke" /></svg>`
  }

  if (node.type === "icon") {
    const stroke = node.stroke ? ` stroke="${escapeHtml(node.stroke)}"` : ""
    return `<svg data-node-id="${escapeHtml(node.id)}" viewBox="${escapeHtml(node.viewBox)}" preserveAspectRatio="xMidYMid meet" style="${common}"><path d="${escapeHtml(node.path)}" fill="${escapeHtml(node.fill)}"${stroke} stroke-width="${node.strokeWidth}" /></svg>`
  }

  if (node.type === "image") {
    return `<img data-node-id="${escapeHtml(node.id)}" src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}" style="${common};object-fit:${node.fit};object-position:${node.cropX * 100}% ${node.cropY * 100}%" />`
  }

  const textStyle = [
    common,
    `color:${escapeHtml(node.color)}`,
    `font-family:${escapeHtml(node.fontFamily)},sans-serif`,
    `font-size:${node.fontSize}px`,
    `font-weight:${node.fontWeight}`,
    `line-height:${node.lineHeight}`,
    `letter-spacing:${node.letterSpacing}px`,
    `text-align:${node.align}`,
    "white-space:pre-line",
  ].join(";")
  return `<div data-node-id="${escapeHtml(node.id)}" style="${textStyle}">${escapeHtml(node.text)}</div>`
}

function pageNodesMarkup(document: Document, pageId: string): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  return page.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is SceneNode => node !== undefined)
    .map(nodeMarkup)
    .join("")
}

export function renderDocumentToHtml(
  document: Document,
  pageId: string
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodes = pageNodesMarkup(document, page.id)

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(page.name)}</title><style>${geistFontFace}*{box-sizing:border-box}html,body{margin:0;width:${page.width}px;height:${page.height}px;overflow:hidden}body{background:${escapeHtml(page.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body data-page-id="${escapeHtml(page.id)}">${nodes}${fontReadyScript}</body></html>`
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
    return page
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.name)} — ${escapeHtml(output.name)}</title><style>${geistFontFace}*{box-sizing:border-box}html,body{margin:0;padding:0}.studio-page{position:relative;overflow:hidden;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}.studio-page:last-child{break-after:auto;page-break-after:auto}${pageRules}</style></head><body>${sheets}${fontReadyScript}</body></html>`
}
