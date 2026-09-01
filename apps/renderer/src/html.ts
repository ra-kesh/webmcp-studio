import {
  assertPageThumbnailSize,
  pageThumbnailScale,
  projectNodeForRender,
  projectFrameClipStack,
  projectPageForRender,
  serializeImagePaintProjector,
  type Document,
  type ImagePaintProjectionInput,
  type RenderImagePaintProjection,
  type RenderNodeProjection,
  type SceneNode,
} from "@webmcp/document"
import type { PageThumbnailSize } from "@webmcp/document"
import type {
  MaskPaintSource,
  PagePaintPlanEntry,
  PagePaintBounds,
} from "@webmcp/document/internal/page-paint-plan"
import {
  isAdmittedAlphaMaskSource,
  isAdmittedVectorMaskSource,
  projectPagePaintPlan,
} from "@webmcp/document/internal/page-paint-plan"
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
  check(query: string, text?: string): boolean
  load(query: string, text?: string): Promise<RenderFontFace[]>
}

type RenderFontRequirement = Readonly<{
  nodeId: string
  fontFamilies: readonly string[]
}>

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
  src?: string
  style: RenderStyle
}

type RenderCoverageImageTarget = Readonly<{
  nodeId: string
  target: { setAttribute(name: string, value: string): void }
}>

type RenderCoverageSource = Readonly<{
  height: number
  nodeId: string
  target: { setAttribute(name: string, value: string): void }
  template: { innerHTML: string }
  width: number
}>

type RenderStyle = {
  setProperty(name: string, value: string): void
}

type ImagePaintProjector = (
  input: ImagePaintProjectionInput
) => RenderImagePaintProjection

export async function markRenderResourcesReady(input: {
  coverageImageTargets?: readonly RenderCoverageImageTarget[]
  coverageSources?: readonly RenderCoverageSource[]
  root: RenderRoot
  fonts: RenderFontSet
  fontRequirements?: readonly RenderFontRequirement[]
  images: RenderImage[]
  managedFontFaceCss?: string
  projectImagePaint: ImagePaintProjector
  luminanceSourceNodeIds?: readonly string[]
  verifyLuminanceConversion?: () => Promise<boolean>
}): Promise<void> {
  const fail = (code: string, nodeId?: string) => {
    input.root.removeAttribute("data-render-ready")
    input.root.setAttribute("data-render-error", code)
    if (nodeId) input.root.setAttribute("data-render-error-node", nodeId)
  }

  try {
    const fontRequirements = input.fontRequirements ?? []
    const query = '16px "Geist Variable"'
    const probeText = "WebMCP"
    const managedFontSourceNodeId = fontRequirements.find((requirement) =>
      requirement.fontFamilies.includes("Geist Variable")
    )?.nodeId
    let managedFontReady = false
    try {
      // CSS-connected faces are lazy: an all-shape document does not request
      // the embedded font merely because its @font-face rule exists.
      await input.fonts.load(query, probeText)
      await input.fonts.ready
      const managedFaceLoaded = Array.from(input.fonts).some(
        (face) =>
          face.family.replace(/["']/g, "") === "Geist Variable" &&
          face.status === "loaded"
      )
      managedFontReady =
        input.fonts.check(query, probeText) && managedFaceLoaded
    } catch {
      fail("managed_font_failed", managedFontSourceNodeId)
      return
    }
    if (!managedFontReady) {
      fail("managed_font_failed", managedFontSourceNodeId)
      return
    }

    const checkedRequirements = new Set<string>()
    for (const requirement of fontRequirements) {
      for (const family of requirement.fontFamilies) {
        if (family === "Geist Variable") continue
        const requirementKey = `${requirement.nodeId}\u0000${family}`
        if (checkedRequirements.has(requirementKey)) continue
        checkedRequirements.add(requirementKey)
        const requirementQuery = `16px "${family.replaceAll('"', '\\"')}"`
        try {
          await input.fonts.load(requirementQuery, probeText)
          await input.fonts.ready
          if (!input.fonts.check(requirementQuery, probeText)) {
            fail("managed_font_failed", requirement.nodeId)
            return
          }
        } catch {
          fail("managed_font_failed", requirement.nodeId)
          return
        }
      }
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
        for (const coverageTarget of input.coverageImageTargets ?? []) {
          if (coverageTarget.nodeId !== image.dataset.nodeId) continue
          coverageTarget.target.setAttribute("href", image.src ?? "")
          coverageTarget.target.setAttribute(
            "width",
            String(image.naturalWidth)
          )
          coverageTarget.target.setAttribute(
            "height",
            String(image.naturalHeight)
          )
          coverageTarget.target.setAttribute(
            "transform",
            `matrix(${a},${b},${c},${d},${e},${f})`
          )
        }
      } catch {
        fail("image_projection_failed", image.dataset.nodeId)
        return
      }
    }

    for (const source of input.coverageSources ?? []) {
      try {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}" viewBox="0 0 ${source.width} ${source.height}"><style>${input.managedFontFaceCss ?? ""}</style><foreignObject x="0" y="0" width="${source.width}" height="${source.height}">${source.template.innerHTML}</foreignObject></svg>`
        const sourceUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        const browser = globalThis as unknown as {
          Image: new () => {
            complete: boolean
            decode(): Promise<unknown>
            naturalHeight: number
            naturalWidth: number
            src: string
          }
        }
        const probe = new browser.Image()
        probe.src = sourceUrl
        await probe.decode()
        if (
          !probe.complete ||
          probe.naturalWidth <= 0 ||
          probe.naturalHeight <= 0
        ) {
          throw new Error("Coverage source did not decode")
        }
        source.target.setAttribute("href", sourceUrl)
      } catch {
        fail("resource_readiness_failed", source.nodeId)
        return
      }
    }

    const luminanceSourceNodeIds = input.luminanceSourceNodeIds ?? []
    if (luminanceSourceNodeIds.length) {
      try {
        if (!(await input.verifyLuminanceConversion?.())) {
          fail("luminance_conversion_failed", luminanceSourceNodeIds[0])
          return
        }
      } catch {
        fail("luminance_conversion_failed", luminanceSourceNodeIds[0])
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

export async function verifyBrowserLuminanceConversion(): Promise<boolean> {
  type BrowserImage = {
    src: string
    decode(): Promise<unknown>
  }
  type BrowserCanvasContext = {
    drawImage(image: BrowserImage, x: number, y: number): void
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
      settings?: { colorSpace: "srgb" }
    ): { data: Uint8ClampedArray }
  }
  const browser = globalThis as unknown as {
    Image: new () => BrowserImage
    document: {
      createElement(name: "canvas"): {
        width: number
        height: number
        getContext(
          type: "2d",
          settings: { colorSpace: "srgb"; willReadFrequently: true }
        ): BrowserCanvasContext | null
      }
    }
  }
  const colors = [
    ["black", 1],
    ["white", 1],
    ["rgb(128,128,128)", 1],
    ["red", 1],
    ["lime", 1],
    ["blue", 1],
    ["red", 0],
    ["red", 0.4],
  ] as const
  const expected = [0, 255, 128, 54, 182, 18, 0, 22, 68]
  const filter = (id: string) =>
    `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.2126 0.7152 0.0722 0 0" result="y"/><feComposite in="y" in2="SourceGraphic" operator="in"/></filter>`
  const filters = colors.map((_, index) => filter(`f${index}`)).join("")
  const outputs = colors
    .map(
      ([color, opacity], index) =>
        `<rect x="${index}" width="1" height="1" fill="${color}" opacity="${opacity}" filter="url(#f${index})"/>`
    )
    .join("")
  const svgNamespace = "http:" + "//www.w3.org/2000/svg"
  const svg = `<svg xmlns="${svgNamespace}" width="9" height="1"><defs>${filters}${filter("overlap-red")}${filter("overlap-green")}</defs>${outputs}<rect x="8" width="1" height="1" fill="red" opacity=".5" filter="url(#overlap-red)"/><rect x="8" width="1" height="1" fill="lime" opacity=".25" filter="url(#overlap-green)"/></svg>`
  const image = new browser.Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try {
    await image.decode()
    const canvas = browser.document.createElement("canvas")
    canvas.width = 9
    canvas.height = 1
    const context = canvas.getContext("2d", {
      colorSpace: "srgb",
      willReadFrequently: true,
    })
    if (!context) return false
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, 9, 1, {
      colorSpace: "srgb",
    }).data
    return expected.every(
      (alpha, index) => Math.abs((pixels[index * 4 + 3] ?? -255) - alpha) <= 3
    )
  } catch {
    return false
  }
}

const geistFontDataUrl = `data:font/woff2;base64,${GEIST_LATIN_WOFF2_BASE64}`
const geistFontFace = `@font-face{font-family:"${MANAGED_FONT_FAMILY}";font-style:normal;font-display:block;font-weight:100 900;src:url("${geistFontDataUrl}") format("woff2")}`
const resourceReadyScript = `<script>(${markRenderResourcesReady.toString()})({root:document.documentElement,fonts:document.fonts,fontRequirements:Array.from(document.querySelectorAll("[data-mask-font-families]"),element=>({nodeId:element.getAttribute("data-mask-font-source-node")||"",fontFamilies:JSON.parse(element.getAttribute("data-mask-font-families")||"[]")})),images:Array.from(document.querySelectorAll("img[data-node-id]")),coverageImageTargets:Array.from(document.querySelectorAll("[data-mask-coverage-template][data-mask-coverage-kind=image]"),template=>({nodeId:template.getAttribute("data-mask-coverage-node-id")||"",target:document.getElementById(template.getAttribute("data-mask-coverage-target-id")||"")})).filter(source=>source.target),coverageSources:Array.from(document.querySelectorAll("[data-mask-coverage-template]:not([data-mask-coverage-kind=image])"),template=>({nodeId:template.getAttribute("data-mask-coverage-node-id")||"",width:Number(template.getAttribute("data-mask-coverage-width")),height:Number(template.getAttribute("data-mask-coverage-height")),template,target:document.getElementById(template.getAttribute("data-mask-coverage-target-id")||"")})).filter(source=>source.target),managedFontFaceCss:${JSON.stringify(geistFontFace)},projectImagePaint:${serializeImagePaintProjector()},luminanceSourceNodeIds:Array.from(document.querySelectorAll("[data-luminance-source-isolation]"),element=>element.getAttribute("data-luminance-source-isolation")||"").filter(Boolean),verifyLuminanceConversion:${verifyBrowserLuminanceConversion.toString()}})</script>`

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

function renderTextMarkup(
  projection: Extract<RenderNodeProjection, { type: "text" }>
) {
  return projection.content.layout.lines
    .map((line, lineIndex) => {
      const lineStyle = [
        "display:block",
        `height:${line.height}px`,
        `line-height:${line.height}px`,
        `text-align:${line.align === "justify" ? "left" : line.align}`,
        ...(line.justifySpacing
          ? [`word-spacing:${line.justifySpacing}px`]
          : []),
        "white-space:pre",
      ].join(";")
      const segments = line.segments
        .map((segment) => {
          const decoration =
            segment.style.decoration === "line_through"
              ? "line-through"
              : segment.style.decoration
          const segmentStyle = [
            `color:${escapeHtml(segment.style.color)}`,
            `font-family:${escapeHtml(segment.style.fontFamily)},sans-serif`,
            `font-size:${segment.style.fontSize}px`,
            `font-weight:${segment.style.fontWeight}`,
            `font-style:${segment.style.italic ? "italic" : "normal"}`,
            `text-decoration-line:${decoration}`,
            `letter-spacing:${segment.style.letterSpacing}px`,
            `line-height:${line.height}px`,
          ].join(";")
          const content = `<span data-text-source-start="${segment.sourceStart}" data-text-source-end="${segment.sourceEnd}"${segment.synthetic ? ' data-text-synthetic="true"' : ""} style="${segmentStyle}">${escapeHtml(segment.text)}</span>`
          if (!segment.link) return content
          return `<a href="${escapeHtml(segment.link.target)}"${segment.link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""} style="color:inherit;text-decoration:inherit">${content}</a>`
        })
        .join("")
      return `<span data-text-line="${lineIndex}" style="${lineStyle}">${segments}</span>`
    })
    .join("")
}

function renderTextFontFamilies(node: Extract<SceneNode, { type: "text" }>) {
  return [
    ...new Set([
      node.fontFamily,
      ...node.runs.flatMap((run) =>
        run.style.fontFamily ? [run.style.fontFamily] : []
      ),
    ]),
  ]
}

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

  if (projection.type === "rect" || projection.type === "frame") {
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
    "text-rendering:geometricPrecision",
    "-webkit-font-smoothing:antialiased",
    `text-align:${projection.content.align}`,
    `white-space:${projection.content.whiteSpace}`,
    `overflow-wrap:${projection.content.overflowWrap}`,
    `overflow:${projection.content.sizingMode === "fixed" ? "hidden" : "visible"}`,
  ].join(";")
  if (node.type !== "text") throw new Error(`Unknown text node: ${node.id}`)
  const textIdentity = `${identity} data-text-sizing-mode="${projection.content.sizingMode}" data-text-measurement="${projection.content.layout.measurement}" data-text-line-count="${projection.content.layout.lineCount}" data-text-overflow="${projection.content.layout.overflow ? "true" : "false"}" data-text-overflow-x="${projection.content.layout.overflowX ? "true" : "false"}" data-text-overflow-y="${projection.content.layout.overflowY ? "true" : "false"}" data-mask-font-source-node="${escapeHtml(node.id)}" data-mask-font-families="${escapeHtml(JSON.stringify(renderTextFontFamilies(node)))}"`
  return `<div ${textIdentity} style="${textStyle}">${renderTextMarkup(projection)}</div>`
}

const maskIdentifier = (groupId: string): string =>
  `studio-mask-${Array.from(groupId, (character) =>
    character.codePointAt(0)?.toString(16).padStart(6, "0")
  ).join("-")}`

const renderVectorMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds
): string => {
  if (!isAdmittedVectorMaskSource(node)) {
    throw new Error(
      `Mask source ${node.id} must be a rectangle, ellipse, or icon`
    )
  }
  const projection = projectNodeForRender(node)
  const { frame } = projection
  const x = frame.x - bounds.x
  const y = frame.y - bounds.y
  const transform = `rotate(${frame.rotation} ${x} ${y})`
  if (projection.type === "rect") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<rect data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" rx="${projection.content.radius}" ry="${projection.content.radius}" fill="white" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "ellipse") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<ellipse data-mask-source-id="${escapeHtml(frame.id)}" cx="${x + frame.width / 2}" cy="${y + frame.height / 2}" rx="${frame.width / 2}" ry="${frame.height / 2}" fill="white" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "icon") {
    const stroke = projection.content.stroke
      ? ` stroke="white" stroke-width="${projection.content.strokeWidth}"`
      : ""
    return `<svg data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" viewBox="${escapeHtml(projection.content.viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="visible" opacity="${frame.opacity}" transform="${transform}"><path d="${escapeHtml(projection.content.path)}" fill="white"${stroke} /></svg>`
  }
  throw new Error(`Mask source ${node.id} did not project as vector geometry`)
}

const renderCoverageMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds,
  source: MaskPaintSource | undefined,
  maskId: string
): Readonly<{ markup: string; preload: string }> => {
  if (!isAdmittedAlphaMaskSource(node)) {
    throw new Error(
      `Alpha mask source ${node.id} must be a rectangle, ellipse, icon, image, or text layer`
    )
  }
  const translatedSource = `<div xmlns="http://www.w3.org/1999/xhtml" style="position:absolute;left:${-bounds.x}px;top:${-bounds.y}px;width:${bounds.width}px;height:${bounds.height}px">${renderNodeToHtml(node)}</div>`
  if (node.type === "text" && source?.kind !== "text") {
    throw new Error(`Missing alpha text readiness for ${node.id}`)
  }
  const fontReadiness =
    node.type === "text" && source?.kind === "text"
      ? ` data-mask-font-source-node="${escapeHtml(node.id)}" data-mask-font-families="${escapeHtml(JSON.stringify(source.fontFamilies))}"`
      : ""
  const targetId = `${maskId}-${maskIdentifier(node.id)}-coverage`
  const coverageKind = node.type === "image" ? "image" : "html"
  const markup =
    node.type === "image"
      ? (() => {
          const frameX = node.x - bounds.x
          const frameY = node.y - bounds.y
          const clipId = `${targetId}-clip`
          const clip =
            node.frameMask.shape === "ellipse"
              ? `<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" />`
              : `<rect x="0" y="0" width="${node.width}" height="${node.height}"${node.frameMask.shape === "rounded_rectangle" ? ` rx="${(node.frameMask.radius ?? 0) * Math.min(node.width, node.height)}" ry="${(node.frameMask.radius ?? 0) * Math.min(node.width, node.height)}"` : ""} />`
          return `<g data-mask-source-id="${escapeHtml(node.id)}" opacity="${node.opacity}" transform="translate(${frameX} ${frameY}) rotate(${node.rotation} 0 0)" clip-path="url(#${clipId})"><defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${clip}</clipPath></defs><image id="${targetId}" x="0" y="0" preserveAspectRatio="none" /></g>`
        })()
      : `<image id="${targetId}" data-mask-source-id="${escapeHtml(node.id)}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="none" />`
  const preload = `<div data-mask-coverage-template="true" data-mask-coverage-kind="${coverageKind}" data-mask-coverage-node-id="${escapeHtml(node.id)}" data-mask-coverage-target-id="${targetId}" data-mask-coverage-width="${bounds.width}" data-mask-coverage-height="${bounds.height}"${fontReadiness} aria-hidden="true" style="position:fixed;left:-100000px;top:0;width:${bounds.width}px;height:${bounds.height}px;overflow:hidden;visibility:hidden;pointer-events:none">${translatedSource}</div>`
  return { markup, preload }
}

const renderLuminanceVectorMaskSource = (
  node: SceneNode,
  bounds: PagePaintBounds
): string => {
  if (!isAdmittedVectorMaskSource(node)) {
    throw new Error(`Luminance vector source ${node.id} is not supported`)
  }
  const projection = projectNodeForRender(node)
  const { frame } = projection
  const x = frame.x - bounds.x
  const y = frame.y - bounds.y
  const transform = `rotate(${frame.rotation} ${x} ${y})`
  if (projection.type === "rect") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<rect data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" rx="${projection.content.radius}" ry="${projection.content.radius}" fill="${escapeHtml(projection.content.fill)}" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "ellipse") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}" stroke-opacity="${frame.opacity}"`
      : ""
    return `<ellipse data-mask-source-id="${escapeHtml(frame.id)}" cx="${x + frame.width / 2}" cy="${y + frame.height / 2}" rx="${frame.width / 2}" ry="${frame.height / 2}" fill="${escapeHtml(projection.content.fill)}" fill-opacity="${frame.opacity}"${stroke} transform="${transform}" />`
  }
  if (projection.type === "icon") {
    const stroke = projection.content.stroke
      ? ` stroke="${escapeHtml(projection.content.stroke)}" stroke-width="${projection.content.strokeWidth}"`
      : ""
    return `<svg data-mask-source-id="${escapeHtml(frame.id)}" x="${x}" y="${y}" width="${frame.width}" height="${frame.height}" viewBox="${escapeHtml(projection.content.viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="visible" opacity="${frame.opacity}" transform="${transform}"><path d="${escapeHtml(projection.content.path)}" fill="${escapeHtml(projection.content.fill)}"${stroke} /></svg>`
  }
  throw new Error(
    `Luminance vector source ${node.id} did not project as vector geometry`
  )
}

/**
 * Serializes one canonical page-paint-plan entry for every HTML render path.
 */
export function renderPagePaintPlanEntryToHtml(
  entry: PagePaintPlanEntry,
  nodesById: ReadonlyMap<string, SceneNode>,
  document?: Document
): string {
  if (entry.kind === "node") {
    const node = nodesById.get(entry.nodeId)
    if (!node) throw new Error(`Unknown paint-plan node: ${entry.nodeId}`)
    const markup = renderNodeToHtml(node)
    const clips = document ? projectFrameClipStack(document, node.id) : []
    return clips.reduce(
      (content, clip, index) =>
        `<div data-frame-clip-node-id="${escapeHtml(node.id)}" data-frame-clip-depth="${index}" style="position:absolute;left:${clip.x}px;top:${clip.y}px;width:${clip.width}px;height:${clip.height}px;overflow:hidden;border-radius:${clip.radius}px"><div style="position:absolute;left:${-clip.x}px;top:${-clip.y}px">${content}</div></div>`,
      markup
    )
  }

  const content = entry.content
    .map((child) => renderPagePaintPlanEntryToHtml(child, nodesById, document))
    .join("")
  const { bounds } = entry
  const groupId = escapeHtml(entry.groupId)
  const compositeStyle = [
    "position:absolute",
    "box-sizing:border-box",
    `left:${bounds.x}px`,
    `top:${bounds.y}px`,
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    "overflow:hidden",
    "isolation:isolate",
  ]
  const contentStyle = [
    "position:absolute",
    "left:0",
    "top:0",
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    `transform:translate(${-bounds.x}px,${-bounds.y}px)`,
    "transform-origin:top left",
  ]

  if (!entry.maskEnabled || !entry.compositeRequired) {
    return `<div data-mask-group-id="${groupId}" data-mask-enabled="${entry.maskEnabled ? "true" : "false"}" data-mask-composite="false" style="${compositeStyle.join(";")}"><div data-mask-content="${groupId}" style="${contentStyle.join(";")}">${content}</div></div>`
  }

  if (
    entry.maskType !== "vector" &&
    entry.maskType !== "alpha" &&
    entry.maskType !== "luminance"
  ) {
    throw new Error(`Unsupported mask paint type: ${entry.maskType}`)
  }

  const maskId = maskIdentifier(entry.groupId)
  const visibleSourceIds = new Set(entry.visibleSourceNodeIds)
  const visibleSources = entry.sourceNodeIds
    .filter((sourceNodeId) => visibleSourceIds.has(sourceNodeId))
    .map((sourceNodeId, index) => {
      const source = nodesById.get(sourceNodeId)
      if (!source) throw new Error(`Unknown mask source: ${sourceNodeId}`)
      const rendered =
        entry.maskType === "vector"
          ? { markup: renderVectorMaskSource(source, bounds), preload: "" }
          : entry.maskType === "luminance" && isAdmittedVectorMaskSource(source)
            ? {
                markup: renderLuminanceVectorMaskSource(source, bounds),
                preload: "",
              }
            : entry.maskType === "alpha" && isAdmittedVectorMaskSource(source)
              ? { markup: renderVectorMaskSource(source, bounds), preload: "" }
              : renderCoverageMaskSource(
                  source,
                  bounds,
                  entry.sources.find(
                    (candidate) => candidate.nodeId === sourceNodeId
                  ),
                  maskId
                )
      const filterId = `${maskId}-luminance-${index}`
      return { sourceNodeId, ...rendered, filterId }
    })
  const luminanceFilters =
    entry.maskType === "luminance"
      ? visibleSources
          .map(
            ({ sourceNodeId, filterId }) =>
              `<filter id="${filterId}" data-luminance-source-id="${escapeHtml(sourceNodeId)}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.2126 0.7152 0.0722 0 0" result="${filterId}-luminance"/><feComposite in="${filterId}-luminance" in2="SourceGraphic" operator="in" result="${filterId}-luminance-alpha"/></filter>`
          )
          .join("")
      : ""
  const sources = visibleSources
    .map(({ sourceNodeId, markup, filterId }) =>
      entry.maskType === "luminance"
        ? markup.startsWith("<foreignObject ")
          ? markup.replace(
              "<foreignObject ",
              `<foreignObject data-luminance-source-isolation="${escapeHtml(sourceNodeId)}" filter="url(#${filterId})" `
            )
          : `<g data-luminance-source-isolation="${escapeHtml(sourceNodeId)}" filter="url(#${filterId})">${markup}</g>`
        : markup
    )
    .join("")
  const coveragePreloads = visibleSources.map(({ preload }) => preload).join("")
  compositeStyle.push(
    `mask:url(#${maskId})`,
    `-webkit-mask:url(#${maskId})`,
    "mask-mode:alpha"
  )
  return `<div data-mask-group-id="${groupId}" data-mask-enabled="true" data-mask-composite="true" style="${compositeStyle.join(";")}"><svg aria-hidden="true" width="0" height="0" style="position:absolute"><defs>${luminanceFilters}<mask id="${maskId}" x="0" y="0" width="${bounds.width}" height="${bounds.height}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha">${sources}</mask></defs></svg>${coveragePreloads}<div data-mask-content="${groupId}" style="${contentStyle.join(";")}">${content}</div></div>`
}

function pageNodesMarkup(document: Document, pageId: string): string {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page: ${pageId}`)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  return projectPagePaintPlan(document, page.id)
    .entries.map((entry) =>
      renderPagePaintPlanEntryToHtml(entry, nodesById, document)
    )
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
