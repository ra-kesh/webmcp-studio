import type { Document, Page } from "./schema"
import { validateRenderPolicy } from "./render-policy"

export const pageThumbnailLimits = Object.freeze({
  minDimension: 1,
  maxDimension: 512,
  maxPixelArea: 262_144,
})

export type PageThumbnailSize = {
  width: number
  height: number
}

export type PageThumbnailBounds = {
  maxWidth: number
  maxHeight: number
}

export type PageThumbnailSizeErrorCode =
  "thumbnail_dimension_out_of_bounds" | "thumbnail_aspect_ratio_mismatch"

export class PageThumbnailSizeError extends Error {
  constructor(readonly code: PageThumbnailSizeErrorCode) {
    super(
      code === "thumbnail_aspect_ratio_mismatch"
        ? "Thumbnail dimensions do not match the source page aspect ratio"
        : "Thumbnail dimensions are outside the renderer limits"
    )
    this.name = "PageThumbnailSizeError"
  }
}

/**
 * Produces the smallest canonical document that can render one page exactly.
 * Page thumbnails must not inherit unrelated output/page/resource limits or
 * repeatedly send the rest of a large document through Browser Rendering.
 */
export function createPageThumbnailDocument(
  document: Document,
  pageId: string
): Document {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) throw new Error(`Unknown page ${pageId}`)
  const output = document.outputs.find(
    (candidate) =>
      candidate.id === page.outputId && candidate.pageIds.includes(page.id)
  )
  if (!output) throw new Error(`Unknown output for page ${page.name}`)

  const nodeIds = new Set(page.nodeIds)

  return {
    ...document,
    outputs: [{ ...output, pageIds: [page.id] }],
    pages: [{ ...page, nodeIds: [...page.nodeIds] }],
    nodes: document.nodes.filter((node) => nodeIds.has(node.id)),
    groups: document.groups.filter((group) => group.pageId === page.id),
    // Canonical field commands already project bound values into scene nodes.
    // The thumbnail renderer paints nodes only, so retaining field defaults and
    // current values would duplicate managed image bytes without changing pixels.
    fields: [],
    fieldValues: {},
    bindings: [],
  }
}

/** Stable visual/dependency revision for one page, independent of unrelated pages. */
export function createPageThumbnailRevision(
  document: Document,
  pageId: string
): string {
  const projected = createPageThumbnailDocument(document, pageId)
  const payload = JSON.stringify({
    schemaVersion: projected.schemaVersion,
    output: projected.outputs[0],
    page: projected.pages[0],
    nodes: projected.nodes,
    groups: projected.groups,
  })
  let primary = 0x811c9dc5
  let secondary = 0x9e3779b9
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index)
    primary = Math.imul(primary ^ code, 0x01000193)
    secondary = Math.imul(secondary ^ code, 0x85ebca6b)
  }
  return `${payload.length}:${(primary >>> 0).toString(16).padStart(8, "0")}${(
    secondary >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`
}

const isBoundedInteger = (value: number) =>
  Number.isInteger(value) &&
  value >= pageThumbnailLimits.minDimension &&
  value <= pageThumbnailLimits.maxDimension

const roundedThumbnailDimension = (value: number) =>
  Math.min(
    pageThumbnailLimits.maxDimension,
    Math.max(pageThumbnailLimits.minDimension, Math.round(value))
  )

/**
 * Fits an integer thumbnail inside the requested pixel bounds while retaining
 * one exact scaling anchor. Deriving only the non-limiting axis prevents two
 * independent rounding operations from producing an invalid aspect pair.
 */
export function fitPageThumbnailSize(
  page: Pick<Page, "width" | "height">,
  bounds: PageThumbnailBounds
): PageThumbnailSize {
  if (
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0 ||
    !Number.isFinite(bounds.maxWidth) ||
    !Number.isFinite(bounds.maxHeight) ||
    bounds.maxWidth < pageThumbnailLimits.minDimension ||
    bounds.maxHeight < pageThumbnailLimits.minDimension
  ) {
    throw new PageThumbnailSizeError("thumbnail_dimension_out_of_bounds")
  }

  const maxWidth = Math.min(
    pageThumbnailLimits.maxDimension,
    Math.round(bounds.maxWidth)
  )
  const maxHeight = Math.min(
    pageThumbnailLimits.maxDimension,
    Math.round(bounds.maxHeight)
  )
  const widthScale = maxWidth / page.width
  const heightScale = maxHeight / page.height
  const size =
    widthScale <= heightScale
      ? {
          width: maxWidth,
          height: roundedThumbnailDimension(
            (maxWidth * page.height) / page.width
          ),
        }
      : {
          width: roundedThumbnailDimension(
            (maxHeight * page.width) / page.height
          ),
          height: maxHeight,
        }

  return assertPageThumbnailSize(page, size)
}

export function assertPageThumbnailSize(
  page: Pick<Page, "width" | "height">,
  requested: PageThumbnailSize
): PageThumbnailSize {
  if (
    !isBoundedInteger(requested.width) ||
    !isBoundedInteger(requested.height) ||
    requested.width * requested.height > pageThumbnailLimits.maxPixelArea
  ) {
    throw new PageThumbnailSizeError("thumbnail_dimension_out_of_bounds")
  }

  // Raster dimensions are integers. Accept the nearest-pixel result when
  // either requested axis is used as the exact scaling anchor. The derived
  // axis clamps to one pixel so every valid page aspect remains representable.
  const heightFromWidth = roundedThumbnailDimension(
    (requested.width * page.height) / page.width
  )
  const widthFromHeight = roundedThumbnailDimension(
    (requested.height * page.width) / page.height
  )
  if (
    requested.height !== heightFromWidth &&
    requested.width !== widthFromHeight
  ) {
    throw new PageThumbnailSizeError("thumbnail_aspect_ratio_mismatch")
  }

  return { ...requested }
}

export function pageThumbnailScale(
  page: Pick<Page, "width" | "height">,
  requested: PageThumbnailSize
): number {
  assertPageThumbnailSize(page, requested)
  return requested.height ===
    roundedThumbnailDimension((requested.width * page.height) / page.width)
    ? requested.width / page.width
    : requested.height / page.height
}

export function createPageThumbnailRenderResourcePlan(
  document: Document,
  input: {
    outputId: string
    pageId: string
    size: PageThumbnailSize
  }
) {
  const blocking = validateRenderPolicy(document)
  if (blocking.length) throw new Error(blocking[0]!.message)

  const output = document.outputs.find(
    (candidate) => candidate.id === input.outputId
  )
  if (!output) throw new Error(`Unknown output ${input.outputId}`)
  const page = document.pages.find(
    (candidate) =>
      candidate.id === input.pageId && candidate.outputId === output.id
  )
  if (!page || !output.pageIds.includes(page.id)) {
    throw new Error(`Unknown page ${input.pageId} for ${output.name}`)
  }
  const size = assertPageThumbnailSize(page, input.size)
  const pixelArea = size.width * size.height
  return {
    outputId: output.id,
    format: "png" as const,
    pageIds: [page.id],
    pageCount: 1,
    pixelArea,
    estimatedStorageBytes: pixelArea * 4,
  }
}
