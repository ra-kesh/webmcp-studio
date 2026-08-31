import {
  libraryMediaDetailSchema,
  publicMediaAssetSchema,
} from "@webmcp/document"
import type { LibraryMediaDetail, PublicMediaAsset } from "@webmcp/document"
import { studioLibraryDiscoveryAdapter } from "./library-discovery-adapter"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"

export const MANAGED_MEDIA_CATALOG_RETRY_DELAYS_MS = [
  100, 200, 400, 800,
] as const

export type ManagedMediaCatalogHandshakeResult =
  | Readonly<{
      status: "ready"
      detail: LibraryMediaDetail
      attempts: number
    }>
  | Readonly<{
      status: "not_yet_discoverable"
      assetId: string
      attempts: number
      requestId: string | null
    }>
  | Readonly<{
      status: "stale"
      assetId: string
      attempts: number
      reason:
        | "invalid_detail"
        | "identity_mismatch"
        | "metadata_mismatch"
        | "not_usable"
    }>

export type ManagedMediaCatalogHandshakeOptions = Readonly<{
  signal: AbortSignal
  retryDelaysMs?: readonly number[]
  lookupCurrent?: (
    assetId: string,
    signal: AbortSignal
  ) => Promise<LibraryMediaDetail>
  waitForRetry?: (delayMs: number, signal: AbortSignal) => Promise<void>
}>

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const abortReason = (signal: AbortSignal) => {
  try {
    signal.throwIfAborted()
  } catch (error) {
    return error
  }
  return new DOMException("The operation was aborted", "AbortError")
}

const defaultWaitForRetry = (delayMs: number, signal: AbortSignal) => {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

const retryDelays = (input?: readonly number[]) => {
  const delays = input ?? MANAGED_MEDIA_CATALOG_RETRY_DELAYS_MS
  if (
    delays.length > 10 ||
    delays.some(
      (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 5_000
    )
  ) {
    throw new RangeError(
      "Managed media catalog retry delays must contain at most 10 values from 0-5000ms."
    )
  }
  return [...delays]
}

const staleReason = (
  upload: PublicMediaAsset,
  detail: LibraryMediaDetail
):
  | Extract<ManagedMediaCatalogHandshakeResult, { status: "stale" }>["reason"]
  | null => {
  if (
    detail.summary.mediaSource !== "managed" ||
    detail.summary.id !== upload.id ||
    detail.selectionIdentity.source !== "managed" ||
    detail.selectionIdentity.assetId !== upload.id ||
    detail.selectionIdentity.catalogVersion !== detail.summary.version
  ) {
    return "identity_mismatch"
  }
  if (
    detail.summary.mimeType !== upload.mediaType ||
    detail.summary.bytes !== upload.bytes ||
    detail.summary.dimensions.width !== upload.width ||
    detail.summary.dimensions.height !== upload.height
  ) {
    return "metadata_mismatch"
  }
  if (
    detail.summary.owner.kind !== "workspace" ||
    detail.summary.catalogStatus !== "active" ||
    !detail.summary.selectable ||
    !detail.summary.permissions.canUse ||
    detail.summary.compatibility.availability !== "available"
  ) {
    return "not_usable"
  }
  return null
}

const isNotYetDiscoverable = (
  error: unknown
): error is LibraryDiscoveryHttpError =>
  error instanceof LibraryDiscoveryHttpError &&
  error.status === 404 &&
  error.code === "library_item_not_found"

/**
 * Converts a successful managed upload into the exact catalog detail required
 * by editor actions. The upload record never supplies or predicts a catalog
 * version; only the source-aware current-detail endpoint can do that.
 */
export async function resolveManagedMediaCatalogUpload(
  uploadInput: PublicMediaAsset,
  options: ManagedMediaCatalogHandshakeOptions
): Promise<ManagedMediaCatalogHandshakeResult> {
  const upload = publicMediaAssetSchema.parse(structuredClone(uploadInput))
  const delays = retryDelays(options.retryDelaysMs)
  const lookupCurrent =
    options.lookupCurrent ??
    studioLibraryDiscoveryAdapter.getCurrentManagedDetail
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry
  let lastRequestId: string | null = null

  for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
    options.signal.throwIfAborted()
    try {
      const detailInput = await lookupCurrent(upload.id, options.signal)
      options.signal.throwIfAborted()
      const parsed = libraryMediaDetailSchema.safeParse(
        structuredClone(detailInput)
      )
      if (!parsed.success) {
        return Object.freeze({
          status: "stale",
          assetId: upload.id,
          attempts: attempt,
          reason: "invalid_detail",
        })
      }
      const detail = immutable(parsed.data)
      const reason = staleReason(upload, detail)
      if (reason) {
        return Object.freeze({
          status: "stale",
          assetId: upload.id,
          attempts: attempt,
          reason,
        })
      }
      return Object.freeze({ status: "ready", detail, attempts: attempt })
    } catch (error) {
      if (options.signal.aborted) options.signal.throwIfAborted()
      if (!isNotYetDiscoverable(error)) throw error
      lastRequestId = error.requestId
      if (attempt > delays.length) {
        return Object.freeze({
          status: "not_yet_discoverable",
          assetId: upload.id,
          attempts: attempt,
          requestId: lastRequestId,
        })
      }
      await waitForRetry(delays[attempt - 1], options.signal)
    }
  }

  throw new Error(
    "Managed media catalog reconciliation exhausted unexpectedly."
  )
}
