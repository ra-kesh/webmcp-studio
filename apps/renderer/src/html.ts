import {
  assertPageThumbnailSize,
  pageThumbnailScale,
  projectNodeForRender,
  projectPageForRender,
  serializeImagePaintProjector,
  type Document,
  type ImagePaintProjectionInput,
  type RenderImagePaintProjection,
  type SceneNode,
} from "@webmcp/document"
import type { PageThumbnailSize } from "@webmcp/document"
import { GEIST_LATIN_WOFF2_BASE64 } from "./geist-font"

const MANAGED_FONT_FAMILY = "Geist Variable"

type RenderRoot = {
  removeAttribute(name: string): void
  setAttribute(name: string, value: string): void
}

type RenderFontFace = {
  family: string
  status: string
}

type RenderFontSet = Iterable<RenderFontFace> & {
  ready: Promise<unknown>
  check(query: string): boolean
}

type RenderImage = {
  complete: boolean
  dataset: {
    imageFrameHeight?: string
    imageFrameMask?: string
    imageFrameWidth?: string
    imagePlacement?: string
    nodeId?: string
  }
  decode(): Promise<unknown>
  naturalHeight: number
  naturalWidth: number
  parentElement: { style: RenderStyle } | null
  style: RenderStyle
}

type RenderStyle = {
  setProperty(name: string, value: string): void
}

type ImagePaintProjector = (
  input: ImagePaintProjectionInput
) => RenderImagePaintProjection

export async function markRenderResourcesReady(input: {
  root: RenderRoot
  fonts: RenderFontSet
  images: RenderImage[]
  projectImagePaint: ImagePaintProjector
}): Promise<void> {
  const fail = (code: string, nodeId?: string) => {
    input.root.removeAttribute("data-render-ready")
    input.root.setAttribute("data-render-error", code)
    if (nodeId) input.root.setAttribute("data-render-error-node", nodeId)
  }

  try {
    await input.fonts.ready
    const query = '16px "Geist Variable"'
    const managedFaceLoaded = Array.from(input.fonts).some(
      (face) =>
        face.family.replace(/["']/g, "") === "Geist Variable" &&
        face.status === "loaded"
    )
    if (!input.fonts.check(query) || !managedFaceLoaded) {
      fail("managed_font_failed")
      return
    }

    for (const image of input.images) {
      try {
        await image.decode()
      } catch {
        fail("image_decode_failed", image.dataset.nodeId)
        return
      }
      if (
        !image.complete ||
        image.naturalWidth <= 0 ||
        image.naturalHeight <= 0
      ) {
        fail("image_decode_failed", image.dataset.nodeId)
        return
      }

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
        const clipPath =
          clip.shape === "ellipse"
            ? `ellipse(${clip.radiusX}px ${clip.radiusY}px at ${clip.centerX}px ${clip.centerY}px)`
            : clip.shape === "rounded_rectangle"
              ? `inset(0 round ${clip.radius}px)`
              : "inset(0)"
        frameStyle.setProperty("clip-path", clipPath)
      } catch {
        fail("image_projection_failed", image.dataset.nodeId)
        return
      }
    }

    input.root.removeAttribute("data-render-error")
    input.root.removeAttribute("data-render-error-node")
    input.root.setAttribute("data-render-ready", "true")
  } catch {
    fail("resource_readiness_failed")
  }
}

const geistFontDataUrl = `data:font/woff2;base64,${GEIST_LATIN_WOFF2_BASE64}`
const geistFontFace = `@font-face{font-family:"${MANAGED_FONT_FAMILY}";font-style:normal;font-display:block;font-weight:100 900;src:url("${geistFontDataUrl}") format("woff2")}`
const resourceReadyScript = `<script>(${markRenderResourcesReady.toString()})({root:document.documentElement,fonts:document.fonts,images:Array.from(document.querySelectorAll("img[data-node-id]")),projectImagePaint:${serializeImagePaintProjector()}})</script>`

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

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
    `transform:rotate(${frame.rotation}deg)`,
    "transform-origin:top left",
    `display:${frame.visible ? "block" : "none"}`,
  ].join(";")
  const identity = `data-node-id="${escapeHtml(frame.id)}" data-node-locked="${frame.locked ? "true" : "false"}"`

  if (projection.type === "rect") {
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
    `text-align:${projection.content.align}`,
    `white-space:${projection.content.whiteSpace}`,
    `overflow-wrap:${projection.content.overflowWrap}`,
    `overflow:${projection.content.sizingMode === "fixed" ? "hidden" : "visible"}`,
  ].join(";")
  const textIdentity = `${identity} data-text-sizing-mode="${projection.content.sizingMode}" data-text-measurement="${projection.content.layout.measurement}" data-text-line-count="${projection.content.layout.lineCount}" data-text-overflow="${projection.content.layout.overflow ? "true" : "false"}" data-text-overflow-x="${projection.content.layout.overflowX ? "true" : "false"}" data-text-overflow-y="${projection.content.layout.overflowY ? "true" : "false"}"`
  return `<div ${textIdentity} style="${textStyle}">${escapeHtml(projection.content.displayText)}</div>`
}

function pageNodesMarkup(document: Document, pageId: string): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  return page.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is SceneNode => node !== undefined)
    .map(renderNodeToHtml)
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(projectedPage.name)}</title><style>${geistFontFace}*{box-sizing:border-box}html,body{margin:0;width:${projectedPage.width}px;height:${projectedPage.height}px;overflow:hidden}body{background:${escapeHtml(projectedPage.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body data-page-id="${escapeHtml(projectedPage.id)}">${nodes}${resourceReadyScript}</body></html>`
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

  return `<!doctype html><html data-thumbnail-width="${size.width}" data-thumbnail-height="${size.height}"><head><meta charset="utf-8"><title>${escapeHtml(projectedPage.name)}</title><style>${geistFontFace}*{box-sizing:border-box}html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}body{position:relative;background:${escapeHtml(projectedPage.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}.studio-thumbnail-page{position:absolute;left:0;top:0;width:${projectedPage.width}px;height:${projectedPage.height}px;overflow:hidden;transform:scale(${scale});transform-origin:0 0;background:${escapeHtml(projectedPage.background)}}</style></head><body><main class="studio-thumbnail-page" data-page-id="${escapeHtml(projectedPage.id)}" data-source-width="${projectedPage.width}" data-source-height="${projectedPage.height}">${nodes}</main>${resourceReadyScript}</body></html>`
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.name)} — ${escapeHtml(output.name)}</title><style>${geistFontFace}*{box-sizing:border-box}html,body{margin:0;padding:0}.studio-page{position:relative;overflow:hidden;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}.studio-page:last-child{break-after:auto;page-break-after:auto}${pageRules}</style></head><body>${sheets}${resourceReadyScript}</body></html>`
}
