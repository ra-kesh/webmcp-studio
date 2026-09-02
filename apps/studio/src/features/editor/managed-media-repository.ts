import {
  isRenderSafeImageSource,
  managedAssetIdFromSource,
  managedAssetSource,
  MANAGED_ASSET_PREFIX,
  mediaAssetIdSchema,
  mediaAssetArchiveResponseSchema,
  mediaAssetDeletionImpactResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetLookupResponseSchema,
  mediaAssetUseResponseSchema,
  mediaAssetUploadResponseSchema,
  mediaIdempotencyKeySchema,
  mediaRequestIdSchema,
} from "@webmcp/document"
import type {
  MediaAssetDeletionImpact,
  MediaAssetUseReceipt,
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

export type ManagedMediaUseReceipt = MediaAssetUseReceipt & {
  requestId: string
}

export type ManagedMediaMutation = "upload" | "archive" | "used"

let managedMediaRevision = 0
const managedMediaListeners = new Set<
  (mutation: ManagedMediaMutation, revision: number) => void
>()

const notifyManagedMediaMutation = (mutation: ManagedMediaMutation) => {
  managedMediaRevision += 1
  for (const listener of managedMediaListeners) {
    try {
      listener(mutation, managedMediaRevision)
    } catch {
      // A view subscriber is advisory. It cannot change whether a repository
      // mutation or durable use receipt succeeded.
    }
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
  readonly idempotencyKey: string | null
  readonly requestId: string | null
  readonly requestIdentityValid: boolean

  constructor(
    code: string,
    status: number,
    message: string,
    {
      idempotencyKey = null,
      requestId = null,
      requestIdentityValid = false,
    }: {
      idempotencyKey?: string | null
      requestId?: string | null
      requestIdentityValid?: boolean
    } = {}
  ) {
    super(message)
    this.name = "ManagedMediaError"
    this.code = code
    this.status = status
    this.idempotencyKey = idempotencyKey
    this.requestId = requestId
    this.requestIdentityValid = requestIdentityValid
  }
}

export const managedMediaErrorIsRetryable = (error: unknown) =>
  error instanceof ManagedMediaError &&
  (error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.code === "media_network_error" ||
    error.code === "media_use_status_unknown" ||
    error.code === "media_upload_timeout" ||
    error.code === "media_upload_cancelled")

export const managedMediaErrorHasUnknownCommitStatus = (error: unknown) =>
  error instanceof ManagedMediaError &&
  (error.code === "media_upload_timeout" ||
    error.code === "media_network_error" ||
    error.code === "media_use_status_unknown")

const mediaUseStatusUnknown = (
  idempotencyKey: string,
  status: number,
  message: string,
  requestId: string | null = null
) =>
  new ManagedMediaError("media_use_status_unknown", status, message, {
    idempotencyKey,
    requestId,
    requestIdentityValid: requestId !== null,
  })

const responseRequestIdentity = (
  response: Response,
  bodyRequestId: unknown = null
) => {
  const headerValue = response.headers.get("x-request-id")
  const header = mediaRequestIdSchema.safeParse(headerValue)
  const body = mediaRequestIdSchema.safeParse(bodyRequestId)
  const valid = header.success && body.success && header.data === body.data
  return {
    requestId: valid ? header.data : null,
    valid,
  }
}

const readError = async (response: Response) => {
  const fallback = `Media request failed (${response.status})`
  try {
    const body: {
      error?: { code?: string; message?: string; requestId?: string } | string
      message?: string
    } = await response.json()
    if (typeof body.error === "string") {
      return new ManagedMediaError(
        body.error,
        response.status,
        body.message ?? fallback,
        { requestId: null, requestIdentityValid: false }
      )
    }
    const identity = responseRequestIdentity(
      response,
      body.error?.requestId ?? null
    )
    return new ManagedMediaError(
      body.error?.code ?? "media_request_failed",
      response.status,
      body.error?.message ?? body.message ?? fallback,
      {
        requestId: identity.requestId,
        requestIdentityValid: identity.valid,
      }
    )
  } catch {
    return new ManagedMediaError(
      "media_request_failed",
      response.status,
      fallback,
      { requestId: null, requestIdentityValid: false }
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

export async function getManagedMediaRenderSource(
  assetId: string,
  signal?: AbortSignal
) {
  const response = await fetch(managedMediaContentUrl(assetId), { signal })
  if (!response.ok) throw await readError(response)
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase()
  if (
    mediaType !== "image/png" &&
    mediaType !== "image/jpeg" &&
    mediaType !== "image/webp"
  ) {
    throw new ManagedMediaError(
      "unsupported_media_type",
      415,
      "Only PNG, JPEG, and WebP images can be used for generation."
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  const source = `data:${mediaType};base64,${btoa(binary)}`
  if (!isRenderSafeImageSource(source)) {
    throw new ManagedMediaError(
      "asset_not_renderable",
      422,
      "The image exceeds Studio's network-isolated render budget."
    )
  }
  return source
}

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

export async function markManagedMediaUsed(
  assetId: string,
  {
    idempotencyKey = crypto.randomUUID(),
    signal,
  }: { idempotencyKey?: string; signal?: AbortSignal } = {}
): Promise<ManagedMediaUseReceipt> {
  const parsedAssetId = mediaAssetIdSchema.parse(assetId)
  const parsedIdempotencyKey = mediaIdempotencyKeySchema.parse(idempotencyKey)
  if (signal?.aborted) {
    throw new ManagedMediaError(
      "media_use_cancelled",
      0,
      "Updating Recent was cancelled before the request started.",
      { idempotencyKey: parsedIdempotencyKey }
    )
  }
  let response: Response
  try {
    response = await fetch(
      `/v1/studio/assets/${encodeURIComponent(parsedAssetId)}/used`,
      {
        method: "POST",
        headers: { "Idempotency-Key": parsedIdempotencyKey },
        signal,
      }
    )
  } catch {
    throw mediaUseStatusUnknown(
      parsedIdempotencyKey,
      0,
      "Studio could not confirm whether Recent was updated. Retry with the same request key."
    )
  }
  if (!response.ok) {
    const responseError = await readError(response)
    if (!responseError.requestIdentityValid) {
      throw mediaUseStatusUnknown(
        parsedIdempotencyKey,
        response.status,
        "Studio returned an unverified error identity after the Recent request. Retry with the same request key."
      )
    }
    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status >= 500
    ) {
      throw mediaUseStatusUnknown(
        parsedIdempotencyKey,
        response.status,
        "Studio could not confirm whether Recent was updated. Retry with the same request key.",
        responseError.requestId
      )
    }
    throw responseError
  }
  const successRequestId = mediaRequestIdSchema.safeParse(
    response.headers.get("x-request-id")
  )
  let receipt: MediaAssetUseReceipt
  try {
    receipt = mediaAssetUseResponseSchema.parse(await response.json()).receipt
  } catch {
    throw mediaUseStatusUnknown(
      parsedIdempotencyKey,
      response.status,
      "Studio may have updated Recent, but its receipt could not be verified. Retry with the same request key.",
      successRequestId.success ? successRequestId.data : null
    )
  }
  if (receipt.assetId !== parsedAssetId || !successRequestId.success) {
    throw mediaUseStatusUnknown(
      parsedIdempotencyKey,
      response.status,
      "Studio may have updated Recent, but its receipt identity could not be verified. Retry with the same request key.",
      successRequestId.success ? successRequestId.data : null
    )
  }
  notifyManagedMediaMutation("used")
  return { ...receipt, requestId: successRequestId.data }
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
