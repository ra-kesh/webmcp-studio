import { describe, expect, it, vi } from "vitest"
import {
  createPageThumbnailDocument,
  createPageThumbnailRevision,
  northstarSeed,
} from "@webmcp/document"

import { createImageHeavyPerformanceFixture } from "./image-heavy-performance-fixture.test-contract"
import { filmstripThumbnailRasterSize } from "./page-filmstrip"
import {
  createStudioPageThumbnailRasterProducer,
  pageThumbnailRasterRetryDelay,
  produceStudioPageThumbnailRaster,
  rendererBackedPageThumbnailsEnabled,
} from "./page-thumbnail-raster-producer"
import type { PageThumbnailRasterKey } from "./page-thumbnail-raster-cache"

const fixture = createImageHeavyPerformanceFixture({
  pageCount: 2,
  imagesPerPage: 1,
})

describe("renderer-backed page thumbnail mode", () => {
  it("requires an explicit opt-in before using the remote renderer", () => {
    expect(rendererBackedPageThumbnailsEnabled(undefined)).toBe(false)
    expect(rendererBackedPageThumbnailsEnabled("")).toBe(false)
    expect(rendererBackedPageThumbnailsEnabled("false")).toBe(false)
    expect(rendererBackedPageThumbnailsEnabled("TRUE")).toBe(false)
    expect(rendererBackedPageThumbnailsEnabled("true")).toBe(true)
  })
})

const key = (overrides: Partial<PageThumbnailRasterKey> = {}) => ({
  documentId: fixture.document.id,
  documentRevision: fixture.document.revision,
  documentSnapshotId: "snapshot-1",
  pageId: fixture.document.pages[0].id,
  pageRevision: createPageThumbnailRevision(
    fixture.document,
    fixture.document.pages[0].id
  ),
  rendererRevision: "renderer-thumbnail-v1",
  pixelWidth: 104,
  pixelHeight: 67,
  ...overrides,
})

function thumbnailResponse(
  requestKey: PageThumbnailRasterKey,
  overrides: Record<string, string> = {}
) {
  const bytes = new Blob(["png"], { type: "image/png" })
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "X-Render-Mode": "ephemeral-thumbnail",
      "X-Page-Id": requestKey.pageId,
      "X-Output-Id": fixture.document.outputs[0].id,
      "X-Width": String(requestKey.pixelWidth),
      "X-Height": String(requestKey.pixelHeight),
      "X-Bytes": String(bytes.size),
      ...overrides,
    },
  })
}

describe("Studio page thumbnail raster producer", () => {
  it("renders concurrent immutable snapshots without shared active-editor state", async () => {
    const secondDocument = {
      ...fixture.document,
      id: "document-second-preview",
      name: "Second preview document",
    }
    const firstKey = key()
    const secondKey = key({
      documentId: secondDocument.id,
      documentSnapshotId: "snapshot-2",
    })
    const bodies: Array<{ document: { id: string; name: string } }> = []
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return thumbnailResponse(bodies.length === 1 ? firstKey : secondKey)
    })
    const firstController = new AbortController()
    const secondController = new AbortController()

    await Promise.all([
      produceStudioPageThumbnailRaster({
        key: firstKey,
        snapshot: {
          document: fixture.document,
          snapshotId: "snapshot-1",
        },
        signal: firstController.signal,
        fetcher,
        endpoint: "/thumbnail-test",
      }),
      produceStudioPageThumbnailRaster({
        key: secondKey,
        snapshot: {
          document: secondDocument,
          snapshotId: "snapshot-2",
        },
        signal: secondController.signal,
        fetcher,
        endpoint: "/thumbnail-test",
      }),
    ])

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/thumbnail-test",
      expect.objectContaining({ signal: firstController.signal })
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/thumbnail-test",
      expect.objectContaining({ signal: secondController.signal })
    )
    expect(bodies.map(({ document }) => document)).toEqual([
      expect.objectContaining({
        id: fixture.document.id,
        name: fixture.document.name,
      }),
      expect.objectContaining({
        id: secondDocument.id,
        name: secondDocument.name,
      }),
    ])
  })

  it("accepts the exact 2x portrait filmstrip raster through the HTTP contract", async () => {
    const page = northstarSeed.pages.find(
      (candidate) => candidate.id === "cover"
    )!
    const rasterSize = filmstripThumbnailRasterSize(page, 2)
    const requestKey: PageThumbnailRasterKey = {
      documentId: northstarSeed.id,
      documentRevision: northstarSeed.revision,
      documentSnapshotId: "northstar-snapshot",
      pageId: page.id,
      pageRevision: createPageThumbnailRevision(northstarSeed, page.id),
      rendererRevision: "renderer-thumbnail-v1",
      pixelWidth: rasterSize.width,
      pixelHeight: rasterSize.height,
    }
    expect(requestKey).toMatchObject({ pixelWidth: 79, pixelHeight: 112 })
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      thumbnailResponse(requestKey, { "X-Output-Id": page.outputId })
    )
    const producer = createStudioPageThumbnailRasterProducer({
      getSnapshot: () => ({
        document: northstarSeed,
        snapshotId: "northstar-snapshot",
      }),
      fetcher,
    })

    await expect(
      producer(requestKey, new AbortController().signal)
    ).resolves.toMatchObject({ type: "image/png" })
    const [, init] = fetcher.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      pageId: "cover",
      size: { width: 79, height: 112 },
    })
  })

  it("posts the exact document, page, dimensions, and abort signal", async () => {
    const requestKey = key()
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => thumbnailResponse(requestKey))
    const producer = createStudioPageThumbnailRasterProducer({
      getSnapshot: () => ({
        document: fixture.document,
        snapshotId: "snapshot-1",
      }),
      fetcher,
    })
    const controller = new AbortController()

    const blob = await producer(requestKey, controller.signal)

    expect(blob.type).toBe("image/png")
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("/v1/studio/page-thumbnail")
    expect(init).toMatchObject({
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      pageId: requestKey.pageId,
      size: { width: 104, height: 67 },
      document: createPageThumbnailDocument(
        fixture.document,
        requestKey.pageId
      ),
    })
  })

  it("preserves canonical managed aliases instead of browser preview URLs", async () => {
    const managedDocument = {
      ...fixture.document,
      nodes: fixture.document.nodes.map((node, index) =>
        index === 0 && node.type === "image"
          ? {
              ...node,
              assetId: "asset-managedpreview01",
              src: "asset:managed/asset-managedpreview01",
            }
          : node
      ),
    }
    const requestKey = key({
      pageRevision: createPageThumbnailRevision(
        managedDocument,
        managedDocument.pages[0].id
      ),
    })
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init) throw new Error("Expected thumbnail request options")
        const body: { document: typeof managedDocument } = JSON.parse(
          String(init.body)
        )
        const node = body.document.nodes[0]
        if (node.type !== "image") throw new Error("Expected managed image")
        expect(node.src).toBe("asset:managed/asset-managedpreview01")
        return thumbnailResponse(requestKey)
      }
    )
    const producer = createStudioPageThumbnailRasterProducer({
      getSnapshot: () => ({
        document: managedDocument,
        snapshotId: "snapshot-1",
      }),
      fetcher,
    })

    await expect(
      producer(requestKey, new AbortController().signal)
    ).resolves.toMatchObject({ type: "image/png" })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("rejects a stale document before network work", async () => {
    const fetcher = vi.fn()
    const changedDocument = {
      ...fixture.document,
      pages: fixture.document.pages.map((page, index) =>
        index === 0 ? { ...page, background: "#abcdef" } : page
      ),
    }
    const producer = createStudioPageThumbnailRasterProducer({
      getSnapshot: () => ({
        document: changedDocument,
        snapshotId: "snapshot-1",
      }),
      fetcher,
    })

    await expect(
      producer(key(), new AbortController().signal)
    ).rejects.toMatchObject({
      code: "stale_document",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("uses the live fallback for a page containing browser-local assets", async () => {
    const localDocument = {
      ...fixture.document,
      nodes: fixture.document.nodes.map((node, index) =>
        index === 0 && node.type === "image"
          ? {
              ...node,
              assetId: "asset-local-preview01",
              src: "asset:local/asset-local-preview01",
            }
          : node
      ),
    }
    const fetcher = vi.fn()
    const producer = createStudioPageThumbnailRasterProducer({
      getSnapshot: () => ({
        document: localDocument,
        snapshotId: "snapshot-local",
      }),
      fetcher,
    })
    const requestKey = key({
      documentSnapshotId: "snapshot-local",
      pageRevision: createPageThumbnailRevision(
        localDocument,
        localDocument.pages[0].id
      ),
    })

    await expect(
      producer(requestKey, new AbortController().signal)
    ).rejects.toMatchObject({ code: "local_asset_requires_live_preview" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("rejects status failures and renderer identity mismatches", async () => {
    const requestKey = key()
    const getSnapshot = () => ({
      document: fixture.document,
      snapshotId: "snapshot-1",
    })
    const cancelFailureBody = vi.fn()
    const failureProducer = createStudioPageThumbnailRasterProducer({
      getSnapshot,
      fetcher: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              cancel: cancelFailureBody,
            }),
            {
              status: 429,
              headers: { "Retry-After": "2" },
            }
          )
      ),
    })
    const cancelMismatchedBody = vi.fn()
    const mismatchedProducer = createStudioPageThumbnailRasterProducer({
      getSnapshot,
      fetcher: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              cancel: cancelMismatchedBody,
            }),
            {
              headers: {
                "Content-Type": "image/png",
                "X-Render-Mode": "ephemeral-thumbnail",
                "X-Page-Id": requestKey.pageId,
                "X-Output-Id": "wrong-output",
                "X-Width": String(requestKey.pixelWidth),
                "X-Height": String(requestKey.pixelHeight),
                "X-Bytes": "1",
              },
            }
          )
      ),
    })

    const failure = await failureProducer(
      requestKey,
      new AbortController().signal
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: "request_failed",
      retryAfterMs: 2_000,
    })
    expect(cancelFailureBody).toHaveBeenCalledOnce()
    expect(pageThumbnailRasterRetryDelay(failure, 1)).toBe(2_000)
    expect(pageThumbnailRasterRetryDelay(failure, 2)).toBe(2_000)
    expect(pageThumbnailRasterRetryDelay(failure, 3)).toBe(2_000)
    expect(pageThumbnailRasterRetryDelay(failure, 4)).toBeNull()
    expect(
      pageThumbnailRasterRetryDelay(new TypeError("network unavailable"), 1)
    ).toBe(1_000)
    await expect(
      mismatchedProducer(requestKey, new AbortController().signal)
    ).rejects.toMatchObject({
      code: "invalid_response",
    })
    expect(cancelMismatchedBody).toHaveBeenCalledOnce()
  })
})
