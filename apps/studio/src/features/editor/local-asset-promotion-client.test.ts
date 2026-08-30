import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LocalAssetPromotionHttpError,
  lookupLocalAssetPromotion,
  resolveLocalAssetPromotions,
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
  it("resolves a strict ordered mapping batch with no-store and a request ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          results: [
            { localAssetId: "local-missing", promotion: null },
            { localAssetId: "local-photo-1", promotion },
          ],
        },
        { headers: { "X-Request-Id": "request-resolve-1" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      resolveLocalAssetPromotions(["local-missing", "local-photo-1"])
    ).resolves.toEqual({
      results: [
        { localAssetId: "local-missing", promotion: null },
        { localAssetId: "local-photo-1", promotion },
      ],
      requestId: "request-resolve-1",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/studio/assets/local-promotions/resolve",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localAssetIds: ["local-missing", "local-photo-1"],
        }),
      })
    )
  })

  it("rejects empty, duplicate, invalid, and over-limit mapping batches before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(resolveLocalAssetPromotions([])).rejects.toThrow()
    await expect(
      resolveLocalAssetPromotions(["local-one", "local-one"])
    ).rejects.toThrow()
    await expect(resolveLocalAssetPromotions(["../escape"])).rejects.toThrow()
    await expect(
      resolveLocalAssetPromotions(
        Array.from({ length: 101 }, (_, index) => `local-${index}`)
      )
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: "missing result",
      results: [{ localAssetId: "local-one", promotion: null }],
    },
    {
      name: "wrong order",
      results: [
        { localAssetId: "local-two", promotion: null },
        { localAssetId: "local-one", promotion: null },
      ],
    },
    {
      name: "nested alias drift",
      results: [
        {
          localAssetId: "local-one",
          promotion: { ...promotion, localAssetId: "local-two" },
        },
        { localAssetId: "local-two", promotion: null },
      ],
    },
  ])("rejects $name in a mapping response", async ({ results }) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { results },
            { headers: { "X-Request-Id": "request-invalid-1" } }
          )
        )
    )

    await expect(
      resolveLocalAssetPromotions(["local-one", "local-two"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_invalid_response",
      requestId: "request-invalid-1",
    })
  })

  it("rejects private fields instead of returning them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            results: [
              {
                localAssetId: "local-photo-1",
                promotion: {
                  ...promotion,
                  r2Key: "private/object-key",
                },
              },
            ],
          },
          { headers: { "X-Request-Id": "request-private-1" } }
        )
      )
    )

    await expect(
      resolveLocalAssetPromotions(["local-photo-1"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_invalid_response",
      requestId: "request-private-1",
    })
  })

  it("requires a valid request ID on a successful mapping response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          results: [{ localAssetId: "local-one", promotion: null }],
        })
      )
    )

    await expect(
      resolveLocalAssetPromotions(["local-one"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_invalid_response",
      requestId: null,
    })
  })

  it("rejects malformed successful JSON as unavailable mapping data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{", {
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": "request-malformed-1",
          },
        })
      )
    )

    await expect(
      resolveLocalAssetPromotions(["local-one"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_invalid_response",
      requestId: "request-malformed-1",
    })
  })

  it("preserves a canonical mapping server error and never treats it as unmapped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "media_database_unavailable",
              message: "Mapping database unavailable",
              requestId: "request-error-1",
              retryable: true,
            },
          },
          {
            status: 503,
            headers: { "X-Request-Id": "request-error-1" },
          }
        )
      )
    )

    await expect(
      resolveLocalAssetPromotions(["local-one"])
    ).rejects.toMatchObject({
      code: "media_database_unavailable",
      status: 503,
      requestId: "request-error-1",
      retryable: true,
    })
  })

  it.each([
    {
      name: "missing body request identity",
      bodyRequestId: undefined,
    },
    {
      name: "mismatched body request identity",
      bodyRequestId: "request-error-other",
    },
  ])("rejects a mapping server error with $name", async ({ bodyRequestId }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "local_asset_promotion_not_found",
              message: "No mapping exists",
              ...(bodyRequestId ? { requestId: bodyRequestId } : {}),
              retryable: false,
            },
          },
          {
            status: 404,
            headers: { "X-Request-Id": "request-error-header" },
          }
        )
      )
    )

    await expect(
      resolveLocalAssetPromotions(["local-one"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_invalid_response",
      status: 404,
      requestId: "request-error-header",
      retryable: true,
    })
  })

  it("keeps cancellation active while a mapping response body is read", async () => {
    const controller = new AbortController()
    const bodyStarted = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        async (_url, init) =>
          ({
            status: 200,
            ok: true,
            headers: new Headers({ "X-Request-Id": "request-cancel-1" }),
            json: () =>
              new Promise((_, reject) => {
                bodyStarted.resolve()
                init?.signal?.addEventListener(
                  "abort",
                  () => reject(init.signal?.reason),
                  { once: true }
                )
              }),
          }) as Response
      )
    )
    const reason = new DOMException("Superseded", "AbortError")
    const resolution = resolveLocalAssetPromotions(["local-one"], {
      signal: controller.signal,
    })
    const rejection = expect(resolution).rejects.toBe(reason)
    await bodyStarted.promise

    controller.abort(reason)

    await rejection
  })

  it("does not start mapping network work after caller cancellation", async () => {
    const controller = new AbortController()
    const reason = new DOMException("Superseded", "AbortError")
    controller.abort(reason)
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      resolveLocalAssetPromotions(["local-one"], {
        signal: controller.signal,
      })
    ).rejects.toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("classifies mapping timeout and network failure without inventing unmapped", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true }
            )
          })
      )
    )
    const timeout = resolveLocalAssetPromotions(["local-one"], {
      timeoutMilliseconds: 10,
    })
    const timeoutRejection = expect(timeout).rejects.toMatchObject({
      code: "local_media_mapping_unavailable",
      retryable: true,
    })
    await vi.advanceTimersByTimeAsync(11)
    await timeoutRejection
    vi.useRealTimers()

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))
    )
    await expect(
      resolveLocalAssetPromotions(["local-one"])
    ).rejects.toMatchObject({
      code: "local_media_mapping_unavailable",
      retryable: true,
    })
  })

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
