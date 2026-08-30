import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  archiveManagedMedia,
  getManagedMedia,
  getManagedMediaDeletionImpact,
  listManagedMedia,
  MANAGED_MEDIA_UPLOAD_TIMEOUT_MS,
  ManagedMediaError,
  managedMediaErrorHasUnknownCommitStatus,
  managedMediaErrorIsRetryable,
  managedMediaContentUrl,
  markManagedMediaUsed,
  subscribeManagedMediaMutations,
  uploadManagedMedia,
} from "./managed-media-repository"

const asset = {
  id: "asset-abcdefghij",
  name: "Wedding portrait.jpg",
  mediaType: "image/jpeg" as const,
  bytes: 1_024,
  width: 1_200,
  height: 800,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  lastUsedAt: "2026-08-28T00:00:00.000Z",
  status: "ready" as const,
}

const impact = {
  assetId: asset.id,
  revision: 4,
  token: "a".repeat(64),
  canArchive: true,
  currentReferences: 0,
  publishedReferences: 0,
  references: [],
}
const useReceipt = {
  assetId: asset.id,
  usedAt: "2026-08-28T00:01:00.000Z",
  assetRevision: 2,
  requestId: "request-use-1",
}
const serverUseReceipt = {
  assetId: useReceipt.assetId,
  usedAt: useReceipt.usedAt,
  assetRevision: useReceipt.assetRevision,
}

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null
  } = { onprogress: null }
  method = ""
  url = ""
  responseType: XMLHttpRequestResponseType = ""
  response: unknown = null
  status = 0
  timeout = 0
  body: Document | XMLHttpRequestBodyInit | null = null
  headers = new Map<string, string>()
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onload: (() => void) | null = null

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value)
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body
  }

  abort() {
    this.onabort?.()
  }

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable,
    } as ProgressEvent)
  }

  emitLoad(status: number, response: unknown) {
    this.status = status
    this.response = response
    this.onload?.()
  }

  emitTimeout() {
    this.ontimeout?.()
  }
}

const latestRequest = () => {
  const request = MockXMLHttpRequest.instances.at(-1)
  if (!request) throw new Error("Expected an XMLHttpRequest")
  return request
}

describe("managed media repository", () => {
  it("classifies retryability from typed transport and HTTP identity", () => {
    expect(
      managedMediaErrorIsRetryable(
        new ManagedMediaError("media_upload_timeout", 0, "Timed out")
      )
    ).toBe(true)
    expect(
      managedMediaErrorIsRetryable(
        new ManagedMediaError("rate_limited", 429, "Try later")
      )
    ).toBe(true)
    expect(
      managedMediaErrorIsRetryable(
        new ManagedMediaError("invalid_image", 422, "Invalid image")
      )
    ).toBe(false)
    expect(
      managedMediaErrorIsRetryable(
        new ManagedMediaError("media_use_status_unknown", 200, "Unknown")
      )
    ).toBe(true)
    expect(managedMediaErrorIsRetryable(new Error("unknown"))).toBe(false)
  })

  it("builds content URLs only for canonical managed asset IDs", () => {
    expect(managedMediaContentUrl(asset.id)).toBe(
      `/v1/studio/assets/${asset.id}/content`
    )
    expect(() => managedMediaContentUrl("../private")).toThrow()
  })
  beforeEach(() => {
    MockXMLHttpRequest.instances = []
    vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("parses list responses and forwards normalized collection parameters", async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        assets: [asset],
        nextCursor: "cursor-next",
        storage: { bytes: asset.bytes, count: 1 },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      listManagedMedia({
        collection: "recent",
        query: "  portrait  ",
        cursor: "cursor-current",
        limit: 20,
        signal,
      })
    ).resolves.toEqual({
      assets: [asset],
      nextCursor: "cursor-next",
      storage: { bytes: asset.bytes, count: 1 },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/studio/assets?collection=recent&query=portrait&cursor=cursor-current&limit=20",
      { signal }
    )
  })

  it("looks up exact ready and archived metadata without accepting private fields", async () => {
    const archived = {
      ...asset,
      status: "archived" as const,
      selectable: false,
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ asset: archived }))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getManagedMedia(asset.id)).resolves.toEqual(archived)
    await expect(getManagedMedia(asset.id)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/v1/studio/assets/${asset.id}`,
      { signal: undefined }
    )
  })

  it("rejects malformed successful responses instead of trusting server JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          assets: [{ ...asset, width: 0 }],
          nextCursor: null,
        })
      )
    )

    await expect(
      listManagedMedia({ collection: "uploads" })
    ).rejects.toMatchObject({ name: "ZodError" })
  })

  it("uploads with validated success, progress, idempotency, and a finite timeout", async () => {
    const onProgress = vi.fn()
    const file = new File([new Uint8Array([1, 2, 3])], "portrait.jpg", {
      type: "image/jpeg",
    })
    const upload = uploadManagedMedia(file, {
      idempotencyKey: "upload-request-1",
      onProgress,
    })
    const request = latestRequest()

    expect(request.method).toBe("POST")
    expect(request.url).toBe("/v1/studio/assets")
    expect(request.responseType).toBe("json")
    expect(request.timeout).toBe(MANAGED_MEDIA_UPLOAD_TIMEOUT_MS)
    expect(request.headers.get("Idempotency-Key")).toBe("upload-request-1")
    expect(request.body).toBeInstanceOf(FormData)
    expect((request.body as FormData).get("file")).toBe(file)

    request.emitProgress(25, 100)
    request.emitProgress(30, 0, false)
    expect(onProgress).toHaveBeenNthCalledWith(1, 25, 100)
    expect(onProgress).toHaveBeenNthCalledWith(2, 30, null)

    request.emitLoad(201, { asset })
    await expect(upload.promise).resolves.toEqual(asset)
  })

  it("rejects a malformed 2xx upload body instead of accepting partial metadata", async () => {
    const upload = uploadManagedMedia(
      new File([new Uint8Array([1])], "portrait.jpg", {
        type: "image/jpeg",
      })
    )

    latestRequest().emitLoad(201, { asset: { ...asset, height: 0 } })

    await expect(upload.promise).rejects.toEqual(
      new ManagedMediaError(
        "media_upload_failed",
        201,
        "The image could not be uploaded (201)."
      )
    )
  })

  it("cancels an active upload with a typed recoverable error", async () => {
    const upload = uploadManagedMedia(
      new File([new Uint8Array([1])], "portrait.jpg", {
        type: "image/jpeg",
      })
    )

    upload.cancel()

    await expect(upload.promise).rejects.toEqual(
      new ManagedMediaError("media_upload_cancelled", 0, "Upload cancelled.")
    )
  })

  it("rejects uploads that exceed the finite XHR deadline", async () => {
    const upload = uploadManagedMedia(
      new File([new Uint8Array([1])], "portrait.jpg", {
        type: "image/jpeg",
      })
    )

    latestRequest().emitTimeout()

    await expect(upload.promise).rejects.toEqual(
      new ManagedMediaError(
        "media_upload_timeout",
        0,
        "The upload took too long. Check your connection and retry."
      )
    )
  })

  it("marks timeout and network loss as unknown commit status", () => {
    expect(
      managedMediaErrorHasUnknownCommitStatus(
        new ManagedMediaError("media_upload_timeout", 0, "Timed out")
      )
    ).toBe(true)
    expect(
      managedMediaErrorHasUnknownCommitStatus(
        new ManagedMediaError("media_network_error", 0, "Disconnected")
      )
    ).toBe(true)
    expect(
      managedMediaErrorHasUnknownCommitStatus(
        new ManagedMediaError("media_use_status_unknown", 200, "Unknown")
      )
    ).toBe(true)
    expect(
      managedMediaErrorHasUnknownCommitStatus(
        new ManagedMediaError("upload_too_large", 413, "Too large")
      )
    ).toBe(false)
  })

  it("parses deletion impact from the server envelope", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ impact }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getManagedMediaDeletionImpact(asset.id)).resolves.toEqual(
      impact
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/studio/assets/${asset.id}/deletion-impact`
    )
  })

  it("archives with revision and impact-token precondition headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        assetId: asset.id,
        status: "archived",
        revision: 5,
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      archiveManagedMedia(asset.id, {
        revision: impact.revision,
        token: impact.token,
      })
    ).resolves.toEqual({
      assetId: asset.id,
      status: "archived",
      revision: 5,
    })
    expect(fetchMock).toHaveBeenCalledWith(`/v1/studio/assets/${asset.id}`, {
      method: "DELETE",
      headers: {
        "If-Match": '"asset-revision-4"',
        "X-Asset-Impact-Token": impact.token,
      },
    })
  })

  it("marks an asset used with a retained key and returns its receipt", async () => {
    const signal = new AbortController().signal
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { receipt: serverUseReceipt },
          { headers: { "X-Request-Id": useReceipt.requestId } }
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      markManagedMediaUsed(asset.id, {
        idempotencyKey: "document-relink-use-1",
        signal,
      })
    ).resolves.toEqual(useReceipt)
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/studio/assets/${asset.id}/used`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "document-relink-use-1" },
        signal,
      }
    )
  })

  it("generates a stable key for an ordinary one-shot use update", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { receipt: serverUseReceipt },
          { headers: { "X-Request-Id": useReceipt.requestId } }
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    await markManagedMediaUsed(asset.id)

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.headers).toEqual({
      "Idempotency-Key": expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
    })
  })

  it("rejects a malformed retained use key before sending a request", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      markManagedMediaUsed(asset.id, { idempotencyKey: "bad key" })
    ).rejects.toMatchObject({ name: "ZodError" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a successful use response with malformed request identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { receipt: serverUseReceipt },
            { headers: { "X-Request-Id": "bad request" } }
          )
        )
    )

    await expect(
      markManagedMediaUsed(asset.id, { idempotencyKey: "use-mismatch" })
    ).rejects.toMatchObject({
      code: "media_use_status_unknown",
      status: 200,
      idempotencyKey: "use-mismatch",
      requestId: null,
    })
  })

  it("treats a valid wrong-asset receipt as unknown without notifying", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeManagedMediaMutations(listener)
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            receipt: {
              ...serverUseReceipt,
              assetId: "asset-0000000000000000000000000000999",
            },
          },
          { headers: { "X-Request-Id": useReceipt.requestId } }
        )
      )
    )

    await expect(
      markManagedMediaUsed(asset.id, { idempotencyKey: "use-wrong-asset" })
    ).rejects.toMatchObject({
      code: "media_use_status_unknown",
      idempotencyKey: "use-wrong-asset",
      requestId: useReceipt.requestId,
    })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("retains the use key when a committed 2xx receipt is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          receipt: { ...serverUseReceipt, assetRevision: 0 },
        })
      )
    )

    await expect(
      markManagedMediaUsed(asset.id, { idempotencyKey: "use-malformed" })
    ).rejects.toMatchObject({
      code: "media_use_status_unknown",
      status: 200,
      idempotencyKey: "use-malformed",
    })
  })

  it("treats abort after dispatch as unknown and retains the use key", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      throw new DOMException("Aborted", "AbortError")
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      markManagedMediaUsed(asset.id, {
        idempotencyKey: "use-aborted-after-dispatch",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      code: "media_use_status_unknown",
      status: 0,
      idempotencyKey: "use-aborted-after-dispatch",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("cancels a pre-aborted use before dispatch", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      markManagedMediaUsed(asset.id, {
        idempotencyKey: "use-pre-aborted",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      code: "media_use_cancelled",
      status: 0,
      idempotencyKey: "use-pre-aborted",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([425, 503])(
    "treats an ambiguous %i server failure as unknown after dispatch",
    async (status) => {
      const requestId = `request-use-${status}`
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(
            {
              error: {
                code: "request_status_unknown",
                message: "Request could not be confirmed",
                requestId,
              },
            },
            { status, headers: { "X-Request-Id": requestId } }
          )
        )
      )

      await expect(
        markManagedMediaUsed(asset.id, {
          idempotencyKey: `use-${status}`,
        })
      ).rejects.toMatchObject({
        code: "media_use_status_unknown",
        status,
        idempotencyKey: `use-${status}`,
        requestId,
      })
    }
  )

  it("retains a canonical request ID on a deterministic use failure", async () => {
    const requestId = "request-use-conflict"
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "idempotency_key_reused",
              message: "Key already used",
              requestId,
            },
          },
          { status: 409, headers: { "X-Request-Id": requestId } }
        )
      )
    )

    await expect(
      markManagedMediaUsed(asset.id, { idempotencyKey: "use-conflict" })
    ).rejects.toMatchObject({
      code: "idempotency_key_reused",
      status: 409,
      requestId,
    })
  })

  it("treats a mismatched canonical error identity as unknown", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeManagedMediaMutations(listener)
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "idempotency_key_reused",
              message: "Key already used",
              requestId: "request-use-body",
            },
          },
          {
            status: 409,
            headers: { "X-Request-Id": "request-use-header" },
          }
        )
      )
    )

    await expect(
      markManagedMediaUsed(asset.id, {
        idempotencyKey: "use-conflict-mismatched-identity",
      })
    ).rejects.toMatchObject({
      code: "media_use_status_unknown",
      status: 409,
      idempotencyKey: "use-conflict-mismatched-identity",
      requestId: null,
    })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("notifies catalog subscribers only after successful mutations", async () => {
    const listener = vi.fn()
    const unsubscribeThrowing = subscribeManagedMediaMutations(() => {
      throw new Error("view subscriber failed")
    })
    const unsubscribe = subscribeManagedMediaMutations(listener)
    const upload = uploadManagedMedia(
      new File([new Uint8Array([1])], "portrait.jpg", {
        type: "image/jpeg",
      })
    )
    latestRequest().emitLoad(201, { asset })
    await upload.promise

    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            { receipt: serverUseReceipt },
            { headers: { "X-Request-Id": useReceipt.requestId } }
          )
        )
        .mockResolvedValueOnce(
          Response.json({ assetId: asset.id, status: "archived", revision: 5 })
        )
    )
    await markManagedMediaUsed(asset.id)
    await archiveManagedMedia(asset.id, impact)

    expect(listener.mock.calls.map(([mutation]) => mutation)).toEqual([
      "upload",
      "used",
      "archive",
    ])
    unsubscribeThrowing()
    unsubscribe()
  })
})
