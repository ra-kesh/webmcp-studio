import {
  assertPageThumbnailSize,
  createPageThumbnailDocument,
  createPageThumbnailRevision,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import type {
  PageThumbnailRasterKey,
  PageThumbnailRasterProducer,
} from "./page-thumbnail-raster-cache"

export const studioPageThumbnailEndpoint = "/v1/studio/page-thumbnail"
export const studioPageThumbnailRendererRevision = "renderer-thumbnail-v1"

export type PageThumbnailDocumentSnapshot = Readonly<{
  document: Document
  snapshotId: string
}>

export type StudioPageThumbnailRasterProducerOptions = Readonly<{
  getSnapshot: () => PageThumbnailDocumentSnapshot
  fetcher?: typeof fetch
  endpoint?: string
}>

export type ProduceStudioPageThumbnailRasterOptions = Readonly<{
  key: PageThumbnailRasterKey
  snapshot: PageThumbnailDocumentSnapshot
  signal: AbortSignal
  fetcher?: typeof fetch
  endpoint?: string
}>

export class StudioPageThumbnailRasterError extends Error {
  constructor(
    readonly code:
      | "local_asset_requires_live_preview"
      | "stale_document"
      | "request_failed"
      | "invalid_response",
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = "StudioPageThumbnailRasterError"
  }
}

const MAX_TRANSIENT_RETRY_ATTEMPTS = 3
const MAX_TRANSIENT_RETRY_DELAY_MS = 30_000

function responseRetryAfterMs(response: Response): number | null {
  const transient =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  if (!transient) return null
  const value = response.headers.get("Retry-After")?.trim()
  if (!value) return 1_000
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    return Math.min(
      MAX_TRANSIENT_RETRY_DELAY_MS,
      Math.max(0, Number(value) * 1_000)
    )
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 1_000
  return Math.min(
    MAX_TRANSIENT_RETRY_DELAY_MS,
    Math.max(0, timestamp - Date.now())
  )
}

export function pageThumbnailRasterRetryDelay(
  error: unknown,
  attempt: number
): number | null {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > MAX_TRANSIENT_RETRY_ATTEMPTS
  ) {
    return null
  }
  const retryAfterMs =
    error instanceof StudioPageThumbnailRasterError
      ? error.retryAfterMs
      : error instanceof TypeError
        ? 1_000
        : null
  if (retryAfterMs === null) return null
  const exponentialFloor = 500 * 2 ** (attempt - 1)
  return Math.min(
    MAX_TRANSIENT_RETRY_DELAY_MS,
    Math.max(exponentialFloor, retryAfterMs)
  )
}

function assertExactSnapshot(
  key: PageThumbnailRasterKey,
  snapshot: PageThumbnailDocumentSnapshot
) {
  if (snapshot.document.id !== key.documentId) {
    throw new StudioPageThumbnailRasterError(
      "stale_document",
      "The document changed before this page thumbnail could start."
    )
  }
  const page = snapshot.document.pages.find(
    (candidate) => candidate.id === key.pageId
  )
  if (!page) {
    throw new StudioPageThumbnailRasterError(
      "stale_document",
      "The requested page no longer exists in this document."
    )
  }
  if (
    createPageThumbnailRevision(snapshot.document, page.id) !== key.pageRevision
  ) {
    throw new StudioPageThumbnailRasterError(
      "stale_document",
      "The page changed before this thumbnail could start."
    )
  }
  assertPageThumbnailSize(page, {
    width: key.pixelWidth,
    height: key.pixelHeight,
  })
  return page.outputId
}

function exactPositiveIntegerHeader(response: Response, name: string) {
  const value = response.headers.get(name)
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // Preserve the renderer's stable domain error even if a runtime has
    // already closed or locked the response stream.
  }
}

/**
 * Produces one renderer-backed raster from the immutable snapshot admitted by
 * the caller. The operation keeps no active-editor state, so concurrent
 * document preview jobs cannot read another job's document from a shared
 * mutable closure.
 */
export async function produceStudioPageThumbnailRaster({
  key,
  snapshot,
  signal,
  fetcher = fetch,
  endpoint = studioPageThumbnailEndpoint,
}: ProduceStudioPageThumbnailRasterOptions): Promise<Blob> {
  const outputId = assertExactSnapshot(key, snapshot)
  const thumbnailDocument = createPageThumbnailDocument(
    snapshot.document,
    key.pageId
  )
  if (
    thumbnailDocument.nodes.some(
      (node) => node.type === "image" && node.src.startsWith("asset:local/")
    )
  ) {
    throw new StudioPageThumbnailRasterError(
      "local_asset_requires_live_preview",
      "Local images use the viewport-bounded live thumbnail renderer."
    )
  }
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId: key.pageId,
      size: { width: key.pixelWidth, height: key.pixelHeight },
      document: thumbnailDocument,
    }),
    signal,
  })
  if (!response.ok) {
    const retryAfterMs = responseRetryAfterMs(response)
    // A fetch resolves as soon as response headers arrive. Release the unread
    // error body before freeing the raster-cache slot so browser-level network
    // concurrency cannot grow beyond the cache's own concurrency budget.
    await discardResponseBody(response)
    throw new StudioPageThumbnailRasterError(
      "request_failed",
      `Page thumbnail rendering failed with status ${response.status}.`,
      retryAfterMs
    )
  }

  const width = exactPositiveIntegerHeader(response, "X-Width")
  const height = exactPositiveIntegerHeader(response, "X-Height")
  const byteLength = exactPositiveIntegerHeader(response, "X-Bytes")
  if (
    response.headers.get("Content-Type")?.split(";", 1)[0] !== "image/png" ||
    response.headers.get("X-Render-Mode") !== "ephemeral-thumbnail" ||
    response.headers.get("X-Page-Id") !== key.pageId ||
    response.headers.get("X-Output-Id") !== outputId ||
    response.headers.has("X-Render-Key") ||
    width !== key.pixelWidth ||
    height !== key.pixelHeight ||
    byteLength === null
  ) {
    await discardResponseBody(response)
    throw new StudioPageThumbnailRasterError(
      "invalid_response",
      "The thumbnail renderer returned an invalid resource identity."
    )
  }
  const blob = await response.blob()
  if (blob.type !== "image/png" || blob.size !== byteLength) {
    throw new StudioPageThumbnailRasterError(
      "invalid_response",
      "The thumbnail renderer returned invalid PNG bytes."
    )
  }
  return blob
}

/**
 * Active-editor adapter retained for the filmstrip. It reads the current
 * editor snapshot once per cache job, then delegates to the stateless raster
 * operation.
 */
export function createStudioPageThumbnailRasterProducer({
  getSnapshot,
  fetcher = fetch,
  endpoint = studioPageThumbnailEndpoint,
}: StudioPageThumbnailRasterProducerOptions): PageThumbnailRasterProducer {
  return (key, signal) =>
    produceStudioPageThumbnailRaster({
      key,
      snapshot: getSnapshot(),
      signal,
      fetcher,
      endpoint,
    })
}
