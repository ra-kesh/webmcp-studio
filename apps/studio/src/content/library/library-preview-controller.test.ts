import { describe, expect, it, vi } from "vitest"
import type { LibraryPreviewDescriptor } from "@webmcp/document"
import { LibraryPreviewController } from "./library-preview-controller"

const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  ),
  (character) => character.charCodeAt(0)
)
const PNG_SHA256 =
  "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"

const rasterDescriptor = (
  id: string,
  overrides: Partial<LibraryPreviewDescriptor> = {}
): LibraryPreviewDescriptor => ({
  kind: "raster",
  itemId: id,
  itemVersion: 1,
  pageId: "cover",
  width: 1,
  height: 1,
  resourcePath: `/library/previews/${id}.png`,
  mediaType: "image/png",
  contentSha256: PNG_SHA256,
  rendererRevision: "renderer-thumbnail-v1",
  ...overrides,
})

const liveDescriptor = (id: string): LibraryPreviewDescriptor => ({
  kind: "live_fallback",
  itemId: id,
  itemVersion: 1,
  pageId: "cover",
  width: 1240,
  height: 1754,
  resourcePath: null,
  mediaType: null,
  contentSha256: null,
  rendererRevision: null,
})

const pngResponse = (bytes: Uint8Array = PNG_BYTES, mediaType = "image/png") =>
  new Response(bytes.slice(), {
    status: 200,
    headers: { "Content-Type": mediaType },
  })

const eventually = async (assertion: () => void) => {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

const readyState = (
  controller: LibraryPreviewController,
  descriptor: LibraryPreviewDescriptor
) =>
  eventually(() => {
    expect(controller.getSnapshot(descriptor).status).toBe("ready")
  })

describe("LibraryPreviewController", () => {
  it("publishes live fallback only when the manifest explicitly requests it", () => {
    const fetch = vi.fn()
    const controller = new LibraryPreviewController({ fetch })
    const descriptor = liveDescriptor("quotation-style")

    expect(controller.getSnapshot(descriptor)).toEqual({ status: "deferred" })
    controller.retain(descriptor)

    expect(controller.getSnapshot(descriptor)).toEqual({
      status: "live_fallback",
      descriptor,
    })
    expect(fetch).not.toHaveBeenCalled()
    controller.dispose()
  })

  it("deduplicates exact descriptors and admits at most three raster fetches globally", async () => {
    const descriptors = Array.from({ length: 4 }, (_, index) =>
      rasterDescriptor(`template-${index}`)
    )
    descriptors.push(
      rasterDescriptor("template-0", {
        pageId: "second-page",
        resourcePath: "/library/previews/template-0-second-page.png",
      })
    )
    const resolvers: Array<(response: Response) => void> = []
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const controller = new LibraryPreviewController({ fetch })

    controller.retain(descriptors[0])
    controller.retain(descriptors[0])
    for (const descriptor of descriptors.slice(1)) controller.retain(descriptor)

    await eventually(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(controller.getStats()).toMatchObject({ active: 3, queued: 2 })

    resolvers.shift()?.(pngResponse())
    await eventually(() => expect(fetch).toHaveBeenCalledTimes(4))
    resolvers.shift()?.(pngResponse())
    await eventually(() => expect(fetch).toHaveBeenCalledTimes(5))
    for (const resolve of resolvers) resolve(pngResponse())
    await Promise.all(
      descriptors.map((descriptor) => readyState(controller, descriptor))
    )
    expect(fetch).toHaveBeenCalledTimes(5)
    controller.dispose()
  })

  it("never allows an injected concurrency setting to exceed the product-wide ceiling", async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const controller = new LibraryPreviewController({
      concurrency: 99,
      fetch,
    })

    for (let index = 0; index < 4; index += 1) {
      controller.retain(rasterDescriptor(`bounded-${index}`))
    }

    await eventually(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(controller.getStats()).toMatchObject({
      active: 3,
      queued: 1,
      concurrency: 3,
    })
    for (const resolve of resolvers) resolve(pngResponse())
    controller.dispose()
  })

  it("validates response MIME, intrinsic dimensions, and SHA-256 before publishing a URL", async () => {
    const cases: Array<{
      name: string
      descriptor: LibraryPreviewDescriptor
      response: Response
      message: string
    }> = [
      {
        name: "mime",
        descriptor: rasterDescriptor("mime"),
        response: pngResponse(PNG_BYTES, "image/jpeg"),
        message: "Preview response type did not match its manifest.",
      },
      {
        name: "dimensions",
        descriptor: rasterDescriptor("dimensions", { width: 2 }),
        response: pngResponse(),
        message: "Preview dimensions did not match its manifest.",
      },
      {
        name: "checksum",
        descriptor: rasterDescriptor("checksum", {
          contentSha256: "f".repeat(64),
        }),
        response: pngResponse(),
        message: "Preview checksum did not match its manifest.",
      },
    ]

    for (const testCase of cases) {
      const createObjectURL = vi.fn()
      const controller = new LibraryPreviewController({
        fetch: vi.fn(async () => testCase.response),
        createObjectURL,
      })
      controller.retain(testCase.descriptor)
      await eventually(() => {
        expect(controller.getSnapshot(testCase.descriptor)).toEqual({
          status: "failed",
          message: testCase.message,
          retryable: true,
        })
      })
      expect(createObjectURL, testCase.name).not.toHaveBeenCalled()
      expect(controller.getSnapshot(testCase.descriptor).status).not.toBe(
        "live_fallback"
      )
      controller.dispose()
    }
  })

  it("bypasses a potentially corrupt browser cache on an explicit retry", async () => {
    const corruptBytes = PNG_BYTES.slice()
    corruptBytes[45] = corruptBytes[45] ^ 1
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pngResponse(corruptBytes))
      .mockResolvedValueOnce(pngResponse())
    const createObjectURL = vi.fn(() => "blob:verified")
    const controller = new LibraryPreviewController({ fetch, createObjectURL })
    const descriptor = rasterDescriptor("retry")

    controller.retain(descriptor)
    await eventually(() => {
      expect(controller.getSnapshot(descriptor).status).toBe("failed")
    })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: "default" })

    controller.retry(descriptor)
    await readyState(controller, descriptor)
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ cache: "reload" })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it("revokes a replaced URL before publishing the retried raster", async () => {
    let urlIndex = 0
    const revokeObjectURL = vi.fn()
    const controller = new LibraryPreviewController({
      fetch: vi.fn(async () => pngResponse()),
      createObjectURL: vi.fn(() => `blob:replacement-${urlIndex++}`),
      revokeObjectURL,
    })
    const descriptor = rasterDescriptor("replacement")

    controller.retain(descriptor)
    await readyState(controller, descriptor)
    controller.retry(descriptor)
    await eventually(() => {
      expect(controller.getSnapshot(descriptor)).toMatchObject({
        status: "ready",
        url: "blob:replacement-1",
      })
    })
    expect(revokeObjectURL.mock.calls.flat()).toEqual(["blob:replacement-0"])

    controller.dispose()
    expect(revokeObjectURL.mock.calls.flat()).toEqual([
      "blob:replacement-0",
      "blob:replacement-1",
    ])
  })

  it("delays release by a microtask for StrictMode and rejects an aborted generation", async () => {
    const scheduled: Array<() => void> = []
    let resolveFetch!: (response: Response) => void
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
          expect(init?.signal?.aborted).toBe(false)
        })
    )
    const createObjectURL = vi.fn(() => "blob:stale")
    const controller = new LibraryPreviewController({
      fetch,
      createObjectURL,
      scheduleMicrotask: (callback) => scheduled.push(callback),
    })
    const descriptor = rasterDescriptor("strict-mode")

    const releaseFirst = controller.retain(descriptor)
    await eventually(() => expect(fetch).toHaveBeenCalledTimes(1))
    releaseFirst()
    const releaseSecond = controller.retain(descriptor)
    scheduled.shift()?.()
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)

    releaseSecond()
    scheduled.shift()?.()
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    resolveFetch(pngResponse())
    await Promise.resolve()
    await Promise.resolve()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(controller.getSnapshot(descriptor)).toEqual({ status: "deferred" })
    controller.dispose()
  })

  it("evicts least-recently-used inactive URLs and revokes every URL exactly once", async () => {
    let urlIndex = 0
    const revokeObjectURL = vi.fn()
    const controller = new LibraryPreviewController({
      fetch: vi.fn(async () => pngResponse()),
      createObjectURL: vi.fn(() => `blob:preview-${urlIndex++}`),
      revokeObjectURL,
      maxEntries: 2,
    })
    const first = rasterDescriptor("lru-first")
    const second = rasterDescriptor("lru-second")
    const third = rasterDescriptor("lru-third")

    for (const descriptor of [first, second]) {
      const release = controller.retain(descriptor)
      await readyState(controller, descriptor)
      release()
      await Promise.resolve()
    }
    const releaseRetainedFirst = controller.retain(first)
    await readyState(controller, first)
    expect(controller.getStats().cached).toBe(2)
    releaseRetainedFirst()
    await Promise.resolve()
    controller.retain(third)
    await readyState(controller, third)

    expect(controller.getStats()).toMatchObject({ cached: 2, maxEntries: 2 })
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")

    controller.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(revokeObjectURL.mock.calls.flat()).toEqual([
      "blob:preview-1",
      "blob:preview-0",
      "blob:preview-2",
    ])
  })
})
