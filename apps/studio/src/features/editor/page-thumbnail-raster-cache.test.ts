import { describe, expect, it, vi } from "vitest"

import {
  createPageThumbnailRasterCache,
  PageThumbnailRasterCacheDisposedError,
  PageThumbnailRasterStaleError,
} from "./page-thumbnail-raster-cache"
import type { PageThumbnailRasterKey } from "./page-thumbnail-raster-cache"

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}>

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function key(
  pageId: string,
  overrides: Partial<PageThumbnailRasterKey> = {}
): PageThumbnailRasterKey {
  return {
    documentId: "document-1",
    documentRevision: 7,
    documentSnapshotId: "snapshot-7",
    pageId,
    pageRevision: `page-revision-${pageId}`,
    rendererRevision: "render-view-1",
    pixelWidth: 104,
    pixelHeight: 144,
    ...overrides,
  }
}

function raster(pageId: string) {
  return new Blob([`raster:${pageId}`], { type: "image/png" })
}

function objectUrlHarness() {
  let sequence = 0
  return {
    create: vi.fn(() => `blob:thumbnail-${++sequence}`),
    revoke: vi.fn<(url: string) => void>(),
  }
}

async function settleMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("page thumbnail raster cache", () => {
  it("deduplicates exact keys and never exceeds bounded producer concurrency", async () => {
    const loads = new Map<string, Deferred<Blob>>()
    const started: string[] = []
    const urls = objectUrlHarness()
    const cache = createPageThumbnailRasterCache({
      concurrency: 2,
      maxEntries: 10,
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
      producer: (request) => {
        started.push(request.pageId)
        const load = deferred<Blob>()
        loads.set(request.pageId, load)
        return load.promise
      },
    })

    const page1 = cache.request(key("page-1"))
    const page1Duplicate = cache.request(key("page-1"))
    const page2 = cache.request(key("page-2"))
    const page3 = cache.request(key("page-3"))
    const page4 = cache.request(key("page-4"))

    expect(page1Duplicate).toBe(page1)
    expect(started).toEqual(["page-1", "page-2"])
    expect(cache.getStats()).toMatchObject({ active: 2, queued: 2 })

    loads.get("page-1")!.resolve(raster("page-1"))
    await page1
    await settleMicrotasks()
    expect(started).toEqual(["page-1", "page-2", "page-3"])
    expect(cache.getStats()).toMatchObject({ active: 2, queued: 1 })

    loads.get("page-2")!.resolve(raster("page-2"))
    loads.get("page-3")!.resolve(raster("page-3"))
    await Promise.all([page2, page3])
    await settleMicrotasks()
    expect(started).toEqual(["page-1", "page-2", "page-3", "page-4"])

    loads.get("page-4")!.resolve(raster("page-4"))
    await page4
    expect(cache.getStats()).toMatchObject({ entries: 4, active: 0, queued: 0 })
  })

  it("rejects invalidated work immediately and cannot publish a stale generation", async () => {
    const first = deferred<Blob>()
    const second = deferred<Blob>()
    const urls = objectUrlHarness()
    let calls = 0
    const signals: AbortSignal[] = []
    const cacheKey = key("page-stale")
    const cache = createPageThumbnailRasterCache({
      concurrency: 1,
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
      producer: (_request, signal) => {
        calls += 1
        if (calls === 1) {
          signals.push(signal)
          return first.promise
        }
        return second.promise
      },
    })

    const staleRequest = cache.request(cacheKey)
    const staleOutcome = staleRequest.catch((error: unknown) => error)
    cache.invalidate(cacheKey)

    expect(await staleOutcome).toBeInstanceOf(PageThumbnailRasterStaleError)
    expect(signals.at(0)?.aborted).toBe(true)
    expect(cache.peek(cacheKey)).toBeNull()

    const currentRequest = cache.request(cacheKey)
    expect(calls).toBe(1)
    first.resolve(raster("old-generation"))
    await settleMicrotasks()
    expect(calls).toBe(2)
    expect(urls.create).not.toHaveBeenCalled()

    second.resolve(raster("current-generation"))
    const current = await currentRequest
    expect(current.url).toBe("blob:thumbnail-1")
    expect(cache.peek(cacheKey)).toBe(current)
    expect(urls.create).toHaveBeenCalledTimes(1)
  })

  it("does not retain bookkeeping for unique invalidated revisions", async () => {
    const producer = vi.fn(async (request: PageThumbnailRasterKey) =>
      raster(request.pageRevision)
    )
    const cache = createPageThumbnailRasterCache({ producer })

    for (let revision = 0; revision < 1_000; revision += 1) {
      cache.invalidate(
        key("page-edited", { pageRevision: `page-revision-${revision}` })
      )
    }

    expect(cache.getStats()).toMatchObject({
      entries: 0,
      queued: 0,
      active: 0,
    })
    await expect(
      cache.request(
        key("page-edited", { pageRevision: "page-revision-current" })
      )
    ).resolves.toMatchObject({ key: { pageRevision: "page-revision-current" } })
    expect(producer).toHaveBeenCalledOnce()
  })

  it("cancels off-screen work without discarding an already cached raster", async () => {
    const pending = deferred<Blob>()
    const signals = new Map<string, AbortSignal>()
    const urls = objectUrlHarness()
    const cache = createPageThumbnailRasterCache({
      producer: (request, signal) => {
        signals.set(request.pageId, signal)
        return request.pageId === "page-cached"
          ? Promise.resolve(raster(request.pageId))
          : pending.promise
      },
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })
    const cachedKey = key("page-cached")
    const pendingKey = key("page-offscreen")
    const cached = await cache.request(cachedKey)
    const pendingOutcome = cache
      .request(pendingKey)
      .catch((error: unknown) => error)

    cache.cancel(cachedKey)
    cache.cancel(pendingKey)

    expect(cache.peek(cachedKey)).toBe(cached)
    expect(signals.get("page-offscreen")?.aborted).toBe(true)
    expect(await pendingOutcome).toBeInstanceOf(PageThumbnailRasterStaleError)
    expect(urls.revoke).not.toHaveBeenCalled()

    pending.resolve(raster("late-offscreen"))
    await settleMicrotasks()
    expect(urls.create).toHaveBeenCalledOnce()
  })

  it("revokes rather than publishing when invalidated during URL materialization", async () => {
    const cacheKey = key("page-reentrant-invalidation")
    const revoke = vi.fn<(url: string) => void>()
    const cache = createPageThumbnailRasterCache({
      producer: async () => raster("materialized"),
      createObjectURL: () => {
        cache.invalidate(cacheKey)
        return "blob:invalidated-during-materialization"
      },
      revokeObjectURL: revoke,
    })

    await expect(cache.request(cacheKey)).rejects.toBeInstanceOf(
      PageThumbnailRasterStaleError
    )
    expect(cache.peek(cacheKey)).toBeNull()
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith(
      "blob:invalidated-during-materialization"
    )
  })

  it("reuses unchanged pages across document snapshots but isolates page revisions and sizes", async () => {
    const urls = objectUrlHarness()
    const producer = vi.fn(async (request: PageThumbnailRasterKey) =>
      raster(`${request.documentRevision}:${request.pageRevision}`)
    )
    const cache = createPageThumbnailRasterCache({
      producer,
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })

    const base = key("page-1")
    const candidates = [
      base,
      key("page-1", { pageRevision: "page-revision-new" }),
      key("page-1", { rendererRevision: "render-view-2" }),
      key("page-1", { pixelWidth: 208 }),
      key("page-1", { pixelHeight: 288 }),
    ]

    await Promise.all(candidates.map((candidate) => cache.request(candidate)))
    await cache.request(
      key("page-1", {
        documentRevision: 8,
        documentSnapshotId: "snapshot-8",
      })
    )

    expect(producer).toHaveBeenCalledTimes(candidates.length)
    expect(cache.getStats().entries).toBe(candidates.length)
  })

  it("evicts the least-recently-used URL and revokes every retained URL once", async () => {
    const urls = objectUrlHarness()
    const cache = createPageThumbnailRasterCache({
      maxEntries: 2,
      producer: async (request) => raster(request.pageId),
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })
    const page1Key = key("page-1")
    const page2Key = key("page-2")
    const page3Key = key("page-3")

    const page1 = await cache.request(page1Key)
    const page2 = await cache.request(page2Key)
    expect(await cache.request(page1Key)).toBe(page1)
    const page3 = await cache.request(page3Key)

    expect(cache.peek(page1Key)).toBe(page1)
    expect(cache.peek(page2Key)).toBeNull()
    expect(cache.peek(page3Key)).toBe(page3)
    expect(urls.revoke).toHaveBeenCalledWith(page2.url)

    cache.dispose()
    expect(urls.revoke.mock.calls.map(([url]) => url).sort()).toEqual(
      [page1.url, page2.url, page3.url].sort()
    )
    expect(new Set(urls.revoke.mock.calls.map(([url]) => url)).size).toBe(3)
  })

  it("invalidates every retained and pending revision for one page only", async () => {
    const pendingPage = deferred<Blob>()
    const urls = objectUrlHarness()
    const cache = createPageThumbnailRasterCache({
      concurrency: 1,
      producer: (request) =>
        request.pageId === "page-pending"
          ? pendingPage.promise
          : Promise.resolve(raster(request.pageId)),
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })
    const retainedKey = key("page-retained", { documentRevision: 7 })
    const anotherRevision = key("page-retained", {
      documentRevision: 8,
      documentSnapshotId: "snapshot-8",
    })
    const otherPageKey = key("page-other")
    const retained = await cache.request(retainedKey)
    const retainedNew = await cache.request(anotherRevision)
    const other = await cache.request(otherPageKey)
    const pendingKey = key("page-pending")
    const pendingRequest = cache.request(pendingKey)
    const pendingOutcome = pendingRequest.catch((error: unknown) => error)

    cache.invalidatePage("document-1", "page-retained")
    expect(cache.peek(retainedKey)).toBeNull()
    expect(cache.peek(anotherRevision)).toBeNull()
    expect(cache.peek(otherPageKey)).toBe(other)
    expect(urls.revoke).toHaveBeenCalledWith(retained.url)
    expect(urls.revoke).toHaveBeenCalledWith(retainedNew.url)

    cache.invalidatePage("document-1", "page-pending")
    expect(await pendingOutcome).toBeInstanceOf(PageThumbnailRasterStaleError)
    const materializedBeforeLateCompletion = urls.create.mock.calls.length
    pendingPage.resolve(raster("late-pending"))
    await settleMicrotasks()
    expect(urls.create).toHaveBeenCalledTimes(materializedBeforeLateCompletion)
  })

  it("disposes active and queued callers, aborts work, and blocks reuse", async () => {
    const activeLoad = deferred<Blob>()
    const urls = objectUrlHarness()
    const signals: AbortSignal[] = []
    const producer = vi.fn(
      (_request: PageThumbnailRasterKey, signal: AbortSignal) => {
        signals.push(signal)
        return activeLoad.promise
      }
    )
    const cache = createPageThumbnailRasterCache({
      concurrency: 1,
      producer,
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })
    const activeRequest = cache
      .request(key("page-active"))
      .catch((error: unknown) => error)
    const queuedRequest = cache
      .request(key("page-queued"))
      .catch((error: unknown) => error)

    cache.dispose()

    expect(await activeRequest).toBeInstanceOf(
      PageThumbnailRasterCacheDisposedError
    )
    expect(await queuedRequest).toBeInstanceOf(
      PageThumbnailRasterCacheDisposedError
    )
    expect(signals).toHaveLength(1)
    expect(signals.at(0)?.aborted).toBe(true)
    expect(producer).toHaveBeenCalledTimes(1)
    expect(cache.getStats()).toMatchObject({
      entries: 0,
      queued: 0,
      disposed: true,
    })
    expect(() => cache.request(key("page-after-dispose"))).toThrow(
      PageThumbnailRasterCacheDisposedError
    )

    activeLoad.resolve(raster("late-active"))
    await settleMicrotasks()
    expect(urls.create).not.toHaveBeenCalled()
  })

  it("releases a failed producer slot and permits an exact retry", async () => {
    const urls = objectUrlHarness()
    const failure = new Error("renderer unavailable")
    const producer = vi
      .fn<(key: PageThumbnailRasterKey) => Promise<Blob>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(raster("recovered"))
    const cache = createPageThumbnailRasterCache({
      concurrency: 1,
      producer,
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    })
    const cacheKey = key("page-retry")

    await expect(cache.request(cacheKey)).rejects.toBe(failure)
    await expect(cache.request(cacheKey)).resolves.toMatchObject({
      url: "blob:thumbnail-1",
    })
    expect(producer).toHaveBeenCalledTimes(2)
  })

  it("rejects malformed revision identities before scheduling work", () => {
    const producer = vi.fn(async () => raster("never"))
    const cache = createPageThumbnailRasterCache({ producer })

    expect(() => cache.request(key("", { pixelWidth: 0 }))).toThrow(TypeError)
    expect(() =>
      cache.request(key("page-1", { documentRevision: -1 }))
    ).toThrow(TypeError)
    expect(producer).not.toHaveBeenCalled()
  })
})
