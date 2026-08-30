import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LocalAssetPromotionHttpError,
  lookupLocalAssetPromotion,
  uploadLocalAssetPromotion,
} from "./local-asset-promotion-client"

const promotion = {
  localAssetId: "local-photo-1",
  contentSha256: "a".repeat(64),
  asset: {
    id: "asset-abcdefghij",
    name: "portrait.png",
    mediaType: "image/png" as const,
    bytes: 3,
    width: 1,
    height: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
    status: "ready" as const,
    selectable: true,
    revision: 1,
  },
}

class MockXMLHttpRequest {
  static readonly DONE = 4
  static instances: MockXMLHttpRequest[] = []
  static throwOnOpen = false
  static throwOnSend = false

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null
  } = { onprogress: null }
  readyState = 0
  responseType: XMLHttpRequestResponseType = ""
  response: unknown = null
  status = 0
  timeout = 0
  body: Document | XMLHttpRequestBodyInit | null = null
  headers = new Map<string, string>()
  responseHeaders = new Map<string, string>()
  throwOnHeaderRead = false
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onload: (() => void) | null = null

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open() {
    if (MockXMLHttpRequest.throwOnOpen) throw new Error("open failed")
    this.readyState = 1
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value)
  }

  getResponseHeader(name: string) {
    if (this.throwOnHeaderRead) throw new Error("headers unavailable")
    return this.responseHeaders.get(name) ?? null
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    if (MockXMLHttpRequest.throwOnSend) throw new Error("send failed")
    this.body = body
    this.readyState = 2
  }

  abort() {
    this.readyState = MockXMLHttpRequest.DONE
    this.onabort?.()
  }

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable,
    } as ProgressEvent)
  }

  emitLoad(status: number, response: unknown, requestId = "request-upload-1") {
    this.readyState = MockXMLHttpRequest.DONE
    this.status = status
    this.response = response
    this.responseHeaders.set("X-Request-Id", requestId)
    this.onload?.()
  }
}

const latestRequest = () => {
  const request = MockXMLHttpRequest.instances.at(-1)
  if (!request) throw new Error("Expected an XMLHttpRequest")
  return request
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  MockXMLHttpRequest.instances = []
  MockXMLHttpRequest.throwOnOpen = false
  MockXMLHttpRequest.throwOnSend = false
  vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("local asset promotion HTTP client", () => {
  it("reconciles an exact mapping with no-store and a required request ID", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { promotion },
          { headers: { "X-Request-Id": "request-lookup-1" } }
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(lookupLocalAssetPromotion("local-photo-1")).resolves.toEqual({
      promotion,
      requestId: "request-lookup-1",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/studio/assets/local-promotions/local-photo-1",
      expect.objectContaining({ cache: "no-store" })
    )
  })

  it("treats the canonical exact-alias 404 as an unmapped result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "local_asset_promotion_not_found",
              message: "Not found",
              requestId: "request-missing-1",
              retryable: false,
            },
          },
          { status: 404, headers: { "X-Request-Id": "request-missing-1" } }
        )
      )
    )

    await expect(lookupLocalAssetPromotion("local-photo-1")).resolves.toEqual({
      promotion: null,
      requestId: "request-missing-1",
    })
  })

  it("keeps caller cancellation active while the response body is being read", async () => {
    const controller = new AbortController()
    const bodyStarted = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const requestSignal = init?.signal
        return {
          status: 200,
          ok: true,
          headers: new Headers({ "X-Request-Id": "request-body-1" }),
          json: () =>
            new Promise((_, reject) => {
              bodyStarted.resolve()
              requestSignal?.addEventListener(
                "abort",
                () => reject(requestSignal.reason),
                { once: true }
              )
            }),
        } as Response
      })
    )
    const lookup = lookupLocalAssetPromotion("local-photo-1", {
      signal: controller.signal,
    })
    const rejected = expect(lookup).rejects.toMatchObject({
      name: "AbortError",
    })
    await bodyStarted.promise

    controller.abort(new DOMException("Cancelled", "AbortError"))

    await rejected
  })

  it("keeps the lookup deadline active while the response body is being read", async () => {
    vi.useFakeTimers()
    const bodyStarted = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const requestSignal = init?.signal
        return {
          status: 200,
          ok: true,
          headers: new Headers({ "X-Request-Id": "request-body-2" }),
          json: () =>
            new Promise((_, reject) => {
              bodyStarted.resolve()
              requestSignal?.addEventListener(
                "abort",
                () => reject(requestSignal.reason),
                { once: true }
              )
            }),
        } as Response
      })
    )
    const lookup = lookupLocalAssetPromotion("local-photo-1", {
      timeoutMilliseconds: 10,
    })
    const rejected = expect(lookup).rejects.toMatchObject({
      code: "local_promotion_reconcile_timeout",
    })
    await bodyStarted.promise

    await vi.advanceTimersByTimeAsync(11)

    await rejected
  })

  it("rejects a lookup response for a different local alias", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { promotion: { ...promotion, localAssetId: "local-photo-2" } },
            { headers: { "X-Request-Id": "request-wrong-alias-1" } }
          )
        )
    )

    await expect(
      lookupLocalAssetPromotion("local-photo-1")
    ).rejects.toMatchObject({ code: "local_promotion_invalid_response" })
  })

  it("uploads one named Blob with a stable key and real progress", async () => {
    const progress = vi.fn()
    const upload = uploadLocalAssetPromotion(
      {
        localAssetId: "local-photo-1",
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        name: "portrait.png",
        idempotencyKey: "promotion-key-1",
      },
      { onProgress: progress }
    )
    const request = latestRequest()

    expect(request.headers.get("Idempotency-Key")).toBe("promotion-key-1")
    expect(request.body).toBeInstanceOf(FormData)
    expect((request.body as FormData).get("localAssetId")).toBe("local-photo-1")
    expect((request.body as FormData).get("file")).toBeInstanceOf(File)
    request.emitProgress(2, 3)
    expect(progress).toHaveBeenCalledWith(2, 3)

    request.emitLoad(201, { promotion, storageDeltaBytes: 3 })
    await expect(upload).resolves.toEqual({
      promotion,
      requestId: "request-upload-1",
    })
  })

  it("settles abort before response headers as unknown instead of hanging", async () => {
    const controller = new AbortController()
    const upload = uploadLocalAssetPromotion(
      {
        localAssetId: "local-photo-1",
        blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
        name: "portrait.png",
        idempotencyKey: "promotion-key-1",
      },
      { signal: controller.signal }
    )
    latestRequest().throwOnHeaderRead = true

    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(upload).rejects.toEqual(
      new LocalAssetPromotionHttpError({
        code: "local_promotion_upload_cancelled",
        status: 0,
        message:
          "The upload stopped locally. Studio must check whether the server committed it.",
        retryable: true,
        commitStatus: "unknown",
      })
    )
  })

  it("does not construct or send XHR for a pre-aborted upload", async () => {
    const controller = new AbortController()
    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(
      uploadLocalAssetPromotion(
        {
          localAssetId: "local-photo-1",
          blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
          name: "portrait.png",
          idempotencyKey: "promotion-key-1",
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(MockXMLHttpRequest.instances).toHaveLength(0)
  })

  it("rejects an upload response for a different local alias as remotely ambiguous", async () => {
    const upload = uploadLocalAssetPromotion({
      localAssetId: "local-photo-1",
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
      name: "portrait.png",
      idempotencyKey: "promotion-key-1",
    })
    latestRequest().emitLoad(200, {
      promotion: { ...promotion, localAssetId: "local-photo-2" },
      storageDeltaBytes: 0,
    })

    await expect(upload).rejects.toMatchObject({
      code: "local_promotion_invalid_response",
      commitStatus: "unknown",
    })
  })

  it.each(["open", "send"] as const)(
    "normalizes synchronous XHR %s failure",
    async (boundary) => {
      if (boundary === "open") MockXMLHttpRequest.throwOnOpen = true
      else MockXMLHttpRequest.throwOnSend = true

      await expect(
        uploadLocalAssetPromotion({
          localAssetId: "local-photo-1",
          blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
          name: "portrait.png",
          idempotencyKey: "promotion-key-1",
        })
      ).rejects.toMatchObject({
        name: "LocalAssetPromotionHttpError",
        code: "local_promotion_client_failed",
        retryable: true,
        commitStatus: "known",
      })
    }
  )

  it("normalizes synchronous XHR construction failure", async () => {
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        constructor() {
          throw new Error("construction failed")
        }
      }
    )

    await expect(
      uploadLocalAssetPromotion({
        localAssetId: "local-photo-1",
        blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
        name: "portrait.png",
        idempotencyKey: "promotion-key-1",
      })
    ).rejects.toMatchObject({
      code: "local_promotion_client_failed",
      commitStatus: "known",
    })
  })

  it("normalizes synchronous multipart construction failure", async () => {
    vi.stubGlobal(
      "FormData",
      class {
        constructor() {
          throw new Error("form failed")
        }
      }
    )

    await expect(
      uploadLocalAssetPromotion({
        localAssetId: "local-photo-1",
        blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
        name: "portrait.png",
        idempotencyKey: "promotion-key-1",
      })
    ).rejects.toMatchObject({
      code: "local_promotion_client_failed",
      commitStatus: "known",
    })
  })

  it("rejects a successful payload without the canonical request identity", async () => {
    const upload = uploadLocalAssetPromotion({
      localAssetId: "local-photo-1",
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
      name: "portrait.png",
      idempotencyKey: "promotion-key-1",
    })
    latestRequest().emitLoad(200, { promotion, storageDeltaBytes: 0 }, "")

    await expect(upload).rejects.toMatchObject({
      code: "local_promotion_invalid_response",
      commitStatus: "unknown",
    })
  })
})
