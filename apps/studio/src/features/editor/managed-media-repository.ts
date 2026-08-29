import {
  managedAssetIdFromSource,
  managedAssetSource,
  MANAGED_ASSET_PREFIX,
  mediaAssetIdSchema,
  mediaAssetArchiveResponseSchema,
  mediaAssetDeletionImpactResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetLookupResponseSchema,
  mediaAssetUploadResponseSchema,
} from "@webmcp/document"
import type {
  MediaAssetDeletionImpact,
  PublicMediaAsset,
} from "@webmcp/document"

export type ManagedMediaAsset = PublicMediaAsset

export type ManagedMediaCollection = "uploads" | "recent"

export const MANAGED_MEDIA_PREFIX = MANAGED_ASSET_PREFIX

export const managedMediaSource = managedAssetSource

export const managedMediaIdFromSource = managedAssetIdFromSource

export type ManagedMediaList = {
  assets: ManagedMediaAsset[]
  nextCursor: string | null
  storage?: { bytes: number; count: number }
}

export type ManagedMediaDeletionImpact = MediaAssetDeletionImpact

export type ManagedMediaMutation = "upload" | "archive" | "used"

let managedMediaRevision = 0
const managedMediaListeners = new Set<
  (mutation: ManagedMediaMutation, revision: number) => void
>()

const notifyManagedMediaMutation = (mutation: ManagedMediaMutation) => {
  managedMediaRevision += 1
  for (const listener of managedMediaListeners) {
    listener(mutation, managedMediaRevision)
  }
}

export const subscribeManagedMediaMutations = (
  listener: (mutation: ManagedMediaMutation, revision: number) => void
) => {
  managedMediaListeners.add(listener)
  return () => managedMediaListeners.delete(listener)
}

export class ManagedMediaError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = "ManagedMediaError"
    this.code = code
    this.status = status
  }
}

export const managedMediaErrorIsRetryable = (error: unknown) =>
  error instanceof ManagedMediaError &&
  (error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.code === "media_network_error" ||
    error.code === "media_upload_timeout" ||
    error.code === "media_upload_cancelled")

export const managedMediaErrorHasUnknownCommitStatus = (error: unknown) =>
  error instanceof ManagedMediaError &&
  (error.code === "media_upload_timeout" ||
    error.code === "media_network_error")

const readError = async (response: Response) => {
  const fallback = `Media request failed (${response.status})`
  try {
    const body: {
      error?: { code?: string; message?: string } | string
      message?: string
    } = await response.json()
    if (typeof body.error === "string") {
      return new ManagedMediaError(
        body.error,
        response.status,
        body.message ?? fallback
      )
    }
    return new ManagedMediaError(
      body.error?.code ?? "media_request_failed",
      response.status,
      body.error?.message ?? body.message ?? fallback
    )
  } catch {
    return new ManagedMediaError(
      "media_request_failed",
      response.status,
      fallback
    )
  }
}

export async function listManagedMedia({
  collection,
  query,
  cursor,
  limit,
  signal,
}: {
  collection: ManagedMediaCollection
  query?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}) {
  const parameters = new URLSearchParams({ collection })
  if (query?.trim()) parameters.set("query", query.trim())
  if (cursor) parameters.set("cursor", cursor)
  if (limit !== undefined) parameters.set("limit", String(limit))
  const response = await fetch(`/v1/studio/assets?${parameters}`, {
    signal,
  })
  if (!response.ok) throw await readError(response)
  return mediaAssetListResponseSchema.parse(await response.json())
}

export async function getManagedMedia(assetId: string, signal?: AbortSignal) {
  const parsedId = mediaAssetIdSchema.parse(assetId)
  const response = await fetch(
    `/v1/studio/assets/${encodeURIComponent(parsedId)}`,
    { signal }
  )
  if (response.status === 404) return null
  if (!response.ok) throw await readError(response)
  return mediaAssetLookupResponseSchema.parse(await response.json()).asset
}

export const managedMediaContentUrl = (assetId: string) =>
  `/v1/studio/assets/${encodeURIComponent(mediaAssetIdSchema.parse(assetId))}/content`

export const MANAGED_MEDIA_UPLOAD_TIMEOUT_MS = 60_000

export function uploadManagedMedia(
  file: File,
  {
    idempotencyKey = crypto.randomUUID(),
    onProgress,
  }: {
    idempotencyKey?: string
    onProgress?: (loaded: number, total: number | null) => void
  } = {}
) {
  const request = new XMLHttpRequest()
  const promise = new Promise<ManagedMediaAsset>((resolve, reject) => {
    request.open("POST", "/v1/studio/assets")
    request.responseType = "json"
    request.timeout = MANAGED_MEDIA_UPLOAD_TIMEOUT_MS
    request.setRequestHeader("Idempotency-Key", idempotencyKey)
    request.upload.onprogress = (event) => {
      onProgress?.(event.loaded, event.lengthComputable ? event.total : null)
    }
    request.onerror = () =>
      reject(
        new ManagedMediaError(
          "media_network_error",
          0,
          "The image could not reach Studio. Check your connection and retry."
        )
      )
    request.onabort = () =>
      reject(
        new ManagedMediaError("media_upload_cancelled", 0, "Upload cancelled.")
      )
    request.ontimeout = () =>
      reject(
        new ManagedMediaError(
          "media_upload_timeout",
          0,
          "The upload took too long. Check your connection and retry."
        )
      )
    request.onload = () => {
      const parsed = mediaAssetUploadResponseSchema.safeParse(request.response)
      if (request.status >= 200 && request.status < 300 && parsed.success) {
        notifyManagedMediaMutation("upload")
        resolve(parsed.data.asset)
        return
      }
      const body = request.response as {
        error?: { code?: string; message?: string } | string
        message?: string
      } | null
      const nested =
        body?.error && typeof body.error === "object" ? body.error : null
      reject(
        new ManagedMediaError(
          nested?.code ??
            (typeof body?.error === "string"
              ? body.error
              : "media_upload_failed"),
          request.status,
          nested?.message ??
            body?.message ??
            `The image could not be uploaded (${request.status}).`
        )
      )
    }
    const form = new FormData()
    form.set("file", file)
    request.send(form)
  })
  return { promise, cancel: () => request.abort(), idempotencyKey }
}

export async function getManagedMediaDeletionImpact(assetId: string) {
  const response = await fetch(
    `/v1/studio/assets/${encodeURIComponent(assetId)}/deletion-impact`
  )
  if (!response.ok) throw await readError(response)
  return mediaAssetDeletionImpactResponseSchema.parse(await response.json())
    .impact
}

export async function markManagedMediaUsed(assetId: string) {
  const response = await fetch(
    `/v1/studio/assets/${encodeURIComponent(assetId)}/used`,
    { method: "POST" }
  )
  if (!response.ok) throw await readError(response)
  const asset = mediaAssetUploadResponseSchema.parse(
    await response.json()
  ).asset
  notifyManagedMediaMutation("used")
  return asset
}

export async function archiveManagedMedia(
  assetId: string,
  impact: Pick<ManagedMediaDeletionImpact, "revision" | "token">
) {
  const response = await fetch(
    `/v1/studio/assets/${encodeURIComponent(assetId)}`,
    {
      method: "DELETE",
      headers: {
        "If-Match": `"asset-revision-${impact.revision}"`,
        "X-Asset-Impact-Token": impact.token,
      },
    }
  )
  if (!response.ok) throw await readError(response)
  const archived = mediaAssetArchiveResponseSchema.parse(await response.json())
  notifyManagedMediaMutation("archive")
  return archived
}
