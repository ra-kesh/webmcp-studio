import {
  localAssetIdSchema,
  localAssetPromotionLookupResponseSchema,
  localAssetPromotionResolveRequestSchema,
  localAssetPromotionResolveResponseSchema,
  localAssetPromotionResponseSchema,
  mediaIdempotencyKeySchema,
} from "@webmcp/document"
import type { LocalAssetPromotion } from "@webmcp/document"

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const LOCAL_ASSET_PROMOTION_LOOKUP_TIMEOUT_MS = 15_000
export const LOCAL_ASSET_PROMOTION_UPLOAD_TIMEOUT_MS = 60_000

export class LocalAssetPromotionHttpError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | null
  readonly retryable: boolean
  readonly commitStatus: "known" | "unknown"

  constructor(input: {
    code: string
    status: number
    message: string
    requestId?: string | null
    retryable: boolean
    commitStatus?: "known" | "unknown"
  }) {
    super(input.message)
    this.name = "LocalAssetPromotionHttpError"
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId ?? null
    this.retryable = input.retryable
    this.commitStatus = input.commitStatus ?? "known"
  }
}

export type LocalAssetPromotionLookupResult = Readonly<{
  promotion: LocalAssetPromotion | null
  requestId: string
}>

export type LocalAssetPromotionUploadResult = Readonly<{
  promotion: LocalAssetPromotion
  requestId: string
}>

export type LocalAssetPromotionResolution = Readonly<{
  localAssetId: string
  promotion: LocalAssetPromotion | null
}>

export type LocalAssetPromotionResolveResult = Readonly<{
  results: readonly LocalAssetPromotionResolution[]
  requestId: string
}>

const requestIdFromHeaders = (headers: Headers) => {
  const requestId = headers.get("X-Request-Id")?.trim() ?? ""
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null
}

const retryableFor = (status: number, code: string) =>
  [408, 425, 429, 502, 503, 504].includes(status) ||
  /(?:capacity|concurrency|rate|connection|timeout|temporarily|unavailable)/.test(
    code
  )

const parseErrorBody = (value: unknown) => {
  if (!value || typeof value !== "object") return null
  const envelope = value as {
    error?: {
      code?: unknown
      message?: unknown
      requestId?: unknown
      retryable?: unknown
    }
  }
  if (!envelope.error || typeof envelope.error !== "object") return null
  return envelope.error
}

const httpErrorFrom = (
  status: number,
  value: unknown,
  requestIdHeader: string | null
) => {
  const detail = parseErrorBody(value)
  const code =
    typeof detail?.code === "string" &&
    /^[a-z][a-z0-9_]{0,127}$/.test(detail.code)
      ? detail.code
      : "local_promotion_request_failed"
  const requestIdBody =
    typeof detail?.requestId === "string" &&
    REQUEST_ID_PATTERN.test(detail.requestId)
      ? detail.requestId
      : null
  return new LocalAssetPromotionHttpError({
    code,
    status,
    message:
      typeof detail?.message === "string" && detail.message.length > 0
        ? detail.message.slice(0, 512)
        : `Studio could not complete the image promotion request (${status}).`,
    requestId: requestIdHeader ?? requestIdBody,
    retryable:
      typeof detail?.retryable === "boolean"
        ? detail.retryable
        : retryableFor(status, code),
  })
}

const mappingHttpErrorFrom = (
  status: number,
  value: unknown,
  requestIdHeader: string
) => {
  const detail = parseErrorBody(value)
  const requestIdBody =
    typeof detail?.requestId === "string" &&
    REQUEST_ID_PATTERN.test(detail.requestId)
      ? detail.requestId
      : null
  if (requestIdBody !== requestIdHeader) {
    return new LocalAssetPromotionHttpError({
      code: "local_media_mapping_invalid_response",
      status,
      message:
        "Studio returned image mapping error data with a mismatched request identity.",
      requestId: requestIdHeader,
      retryable: true,
    })
  }
  return httpErrorFrom(status, value, requestIdHeader)
}

const requireRequestId = (requestId: string | null) => {
  if (requestId) return requestId
  throw new LocalAssetPromotionHttpError({
    code: "local_promotion_invalid_response",
    status: 0,
    message: "Studio returned image promotion data without a request identity.",
    retryable: true,
  })
}

const boundedFetchSignal = (
  signal: AbortSignal | undefined,
  timeoutMilliseconds: number
) => {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(
      new DOMException("The promotion lookup timed out.", "TimeoutError")
    )
  }, timeoutMilliseconds)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanUp: () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    },
  }
}

export async function lookupLocalAssetPromotion(
  localAssetId: string,
  options: {
    signal?: AbortSignal
    timeoutMilliseconds?: number
  } = {}
): Promise<LocalAssetPromotionLookupResult> {
  const parsedLocalAssetId = localAssetIdSchema.parse(localAssetId)
  const bounded = boundedFetchSignal(
    options.signal,
    options.timeoutMilliseconds ?? LOCAL_ASSET_PROMOTION_LOOKUP_TIMEOUT_MS
  )
  let response: Response
  let value: unknown
  try {
    response = await fetch(
      `/v1/studio/assets/local-promotions/${encodeURIComponent(parsedLocalAssetId)}`,
      { signal: bounded.signal, cache: "no-store" }
    )
    try {
      value = await response.json()
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      if (bounded.timedOut()) throw error
      value = null
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (bounded.timedOut()) {
      throw new LocalAssetPromotionHttpError({
        code: "local_promotion_reconcile_timeout",
        status: 0,
        message: "Studio took too long to check the saved image copy.",
        retryable: true,
      })
    }
    throw new LocalAssetPromotionHttpError({
      code: "local_promotion_network_error",
      status: 0,
      message: "Studio could not check the saved image copy.",
      retryable: true,
    })
  } finally {
    bounded.cleanUp()
  }

  options.signal?.throwIfAborted()
  const requestId = requestIdFromHeaders(response.headers)
  if (response.status === 404) {
    const error = httpErrorFrom(response.status, value, requestId)
    if (error.code === "local_asset_promotion_not_found") {
      return { promotion: null, requestId: requireRequestId(error.requestId) }
    }
    throw error
  }
  if (!response.ok) throw httpErrorFrom(response.status, value, requestId)
  const parsed = localAssetPromotionLookupResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new LocalAssetPromotionHttpError({
      code: "local_promotion_invalid_response",
      status: response.status,
      message: "Studio returned invalid image promotion data.",
      requestId,
      retryable: true,
    })
  }
  if (parsed.data.promotion.localAssetId !== parsedLocalAssetId) {
    throw new LocalAssetPromotionHttpError({
      code: "local_promotion_invalid_response",
      status: response.status,
      message: "Studio returned a mapping for another local image.",
      requestId,
      retryable: true,
    })
  }
  return {
    promotion: parsed.data.promotion,
    requestId: requireRequestId(requestId),
  }
}

export async function resolveLocalAssetPromotions(
  localAssetIdsInput: readonly string[],
  options: {
    signal?: AbortSignal
    timeoutMilliseconds?: number
  } = {}
): Promise<LocalAssetPromotionResolveResult> {
  options.signal?.throwIfAborted()
  const request = localAssetPromotionResolveRequestSchema.parse({
    localAssetIds: localAssetIdsInput,
  })
  const bounded = boundedFetchSignal(
    options.signal,
    options.timeoutMilliseconds ?? LOCAL_ASSET_PROMOTION_LOOKUP_TIMEOUT_MS
  )
  let response: Response
  let value: unknown
  try {
    response = await fetch("/v1/studio/assets/local-promotions/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: bounded.signal,
      cache: "no-store",
    })
    try {
      value = await response.json()
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      if (bounded.timedOut()) throw error
      value = null
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (bounded.timedOut()) {
      throw new LocalAssetPromotionHttpError({
        code: "local_media_mapping_unavailable",
        status: 0,
        message: "Studio took too long to check saved image copies.",
        retryable: true,
      })
    }
    throw new LocalAssetPromotionHttpError({
      code: "local_media_mapping_unavailable",
      status: 0,
      message: "Studio could not check saved image copies.",
      retryable: true,
    })
  } finally {
    bounded.cleanUp()
  }

  options.signal?.throwIfAborted()
  const requestId = requestIdFromHeaders(response.headers)
  if (!requestId) {
    throw new LocalAssetPromotionHttpError({
      code: "local_media_mapping_invalid_response",
      status: response.status,
      message: "Studio returned image mapping data without a request identity.",
      retryable: true,
    })
  }
  if (!response.ok) {
    throw mappingHttpErrorFrom(response.status, value, requestId)
  }

  const parsed = localAssetPromotionResolveResponseSchema.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.results.length !== request.localAssetIds.length
  ) {
    throw new LocalAssetPromotionHttpError({
      code: "local_media_mapping_invalid_response",
      status: response.status,
      message: "Studio returned an incomplete image mapping response.",
      requestId,
      retryable: true,
    })
  }
  for (let index = 0; index < request.localAssetIds.length; index += 1) {
    const expectedLocalAssetId = request.localAssetIds[index]
    const resolution = parsed.data.results[index]
    if (
      resolution.localAssetId !== expectedLocalAssetId ||
      (resolution.promotion !== null &&
        resolution.promotion.localAssetId !== expectedLocalAssetId)
    ) {
      throw new LocalAssetPromotionHttpError({
        code: "local_media_mapping_invalid_response",
        status: response.status,
        message: "Studio returned image mappings in the wrong order.",
        requestId,
        retryable: true,
      })
    }
  }
  return { results: parsed.data.results, requestId }
}

export function uploadLocalAssetPromotion(
  input: {
    localAssetId: string
    blob: Blob
    name: string
    idempotencyKey: string
  },
  options: {
    signal?: AbortSignal
    timeoutMilliseconds?: number
    onProgress?: (loaded: number, total: number | null) => void
  } = {}
): Promise<LocalAssetPromotionUploadResult> {
  const localAssetId = localAssetIdSchema.parse(input.localAssetId)
  const idempotencyKey = mediaIdempotencyKeySchema.parse(input.idempotencyKey)
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason)
  }
  return new Promise((resolve, reject) => {
    let request: XMLHttpRequest
    try {
      request = new XMLHttpRequest()
    } catch (error) {
      reject(
        new LocalAssetPromotionHttpError({
          code: "local_promotion_client_failed",
          status: 0,
          message: "This browser could not start the image upload.",
          retryable: true,
        })
      )
      return
    }
    let settled = false
    const cleanUp = () => {
      options.signal?.removeEventListener("abort", abort)
      request.upload.onprogress = null
      request.onerror = null
      request.onabort = null
      request.ontimeout = null
      request.onload = null
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanUp()
      callback()
    }
    const responseRequestId = () => {
      try {
        const value = request.getResponseHeader("X-Request-Id")?.trim() ?? ""
        return REQUEST_ID_PATTERN.test(value) ? value : null
      } catch {
        return null
      }
    }
    const abort = () => {
      try {
        if (request.readyState !== XMLHttpRequest.DONE) request.abort()
      } catch {
        settle(() =>
          reject(
            new LocalAssetPromotionHttpError({
              code: "local_promotion_upload_cancelled",
              status: 0,
              message:
                "The browser could not confirm that the upload stopped. Studio must reconcile before retrying.",
              retryable: true,
              commitStatus: "unknown",
            })
          )
        )
      }
    }

    try {
      request.open("POST", "/v1/studio/assets/local-promotions")
      request.responseType = "json"
      request.timeout =
        options.timeoutMilliseconds ?? LOCAL_ASSET_PROMOTION_UPLOAD_TIMEOUT_MS
      request.setRequestHeader("Idempotency-Key", idempotencyKey)
    } catch (error) {
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_client_failed",
            status: 0,
            message: "This browser could not prepare the image upload.",
            retryable: true,
          })
        )
      )
      return
    }
    request.upload.onprogress = (event) => {
      options.onProgress?.(
        event.loaded,
        event.lengthComputable ? event.total : null
      )
    }
    request.onerror = () =>
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_network_error",
            status: 0,
            message:
              "The image upload connection was lost. Studio must reconcile before retrying.",
            requestId: responseRequestId(),
            retryable: true,
            commitStatus: "unknown",
          })
        )
      )
    request.onabort = () =>
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_upload_cancelled",
            status: 0,
            message:
              "The upload stopped locally. Studio must check whether the server committed it.",
            requestId: responseRequestId(),
            retryable: true,
            commitStatus: "unknown",
          })
        )
      )
    request.ontimeout = () =>
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_upload_timeout",
            status: 0,
            message:
              "The image upload timed out. Studio must reconcile before retrying.",
            requestId: responseRequestId(),
            retryable: true,
            commitStatus: "unknown",
          })
        )
      )
    request.onload = () => {
      const requestId = responseRequestId()
      const parsed = localAssetPromotionResponseSchema.safeParse(
        request.response
      )
      if (request.status >= 200 && request.status < 300 && parsed.success) {
        if (parsed.data.promotion.localAssetId !== localAssetId) {
          settle(() =>
            reject(
              new LocalAssetPromotionHttpError({
                code: "local_promotion_invalid_response",
                status: request.status,
                message: "Studio returned a mapping for another local image.",
                requestId,
                retryable: true,
                commitStatus: "unknown",
              })
            )
          )
          return
        }
        let validRequestId: string
        try {
          validRequestId = requireRequestId(requestId)
        } catch (error) {
          settle(() =>
            reject(
              error instanceof LocalAssetPromotionHttpError
                ? new LocalAssetPromotionHttpError({
                    code: error.code,
                    status: error.status,
                    message: error.message,
                    requestId: error.requestId,
                    retryable: error.retryable,
                    commitStatus: "unknown",
                  })
                : error
            )
          )
          return
        }
        settle(() =>
          resolve({
            promotion: parsed.data.promotion,
            requestId: validRequestId,
          })
        )
        return
      }
      const error = parsed.success
        ? new LocalAssetPromotionHttpError({
            code: "local_promotion_invalid_response",
            status: request.status,
            message:
              "Studio returned image promotion data with an error status.",
            requestId,
            retryable: true,
          })
        : request.status >= 200 && request.status < 300
          ? new LocalAssetPromotionHttpError({
              code: "local_promotion_invalid_response",
              status: request.status,
              message: "Studio returned invalid image promotion data.",
              requestId,
              retryable: true,
              commitStatus: "unknown",
            })
          : httpErrorFrom(request.status, request.response, requestId)
      settle(() => reject(error))
    }

    let form: FormData
    try {
      form = new FormData()
      form.set("localAssetId", localAssetId)
      form.set("file", input.blob, input.name)
    } catch (error) {
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_client_failed",
            status: 0,
            message: "This browser could not prepare the image bytes.",
            retryable: true,
          })
        )
      )
      return
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    try {
      request.send(form)
      if (options.signal?.aborted) abort()
    } catch (error) {
      settle(() =>
        reject(
          new LocalAssetPromotionHttpError({
            code: "local_promotion_client_failed",
            status: 0,
            message: "This browser could not send the image upload.",
            retryable: true,
          })
        )
      )
    }
  })
}
