export type PageThumbnailRasterKey = Readonly<{
  documentId: string
  documentRevision: number
  documentSnapshotId: string
  pageId: string
  pageRevision: string
  rendererRevision: string
  pixelWidth: number
  pixelHeight: number
}>

export type PageThumbnailRasterEntry = Readonly<{
  key: PageThumbnailRasterKey
  url: string
  byteLength: number
  mimeType: string
}>

export type PageThumbnailRasterProducer = (
  key: PageThumbnailRasterKey,
  signal: AbortSignal
) => Promise<Blob>

export type PageThumbnailRasterCacheOptions = Readonly<{
  producer: PageThumbnailRasterProducer
  concurrency?: number
  maxEntries?: number
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
}>

export type PageThumbnailRasterCacheStats = Readonly<{
  entries: number
  queued: number
  active: number
  concurrency: number
  maxEntries: number
  disposed: boolean
}>

export type PageThumbnailRasterCache = Readonly<{
  /**
   * Returns a cached raster or schedules one producer call. Concurrent requests
   * for the same exact revision key share a promise.
   */
  request: (key: PageThumbnailRasterKey) => Promise<PageThumbnailRasterEntry>
  /** Returns a cached raster without changing LRU recency. */
  peek: (key: PageThumbnailRasterKey) => PageThumbnailRasterEntry | null
  /** Cancels queued or active work while retaining an already cached entry. */
  cancel: (key: PageThumbnailRasterKey) => void
  /**
   * Invalidates queued, active, and cached work for one exact revision key.
   * The producer is aborted and its caller is rejected immediately. A producer
   * that ignores AbortSignal still occupies its concurrency slot until it exits.
   */
  invalidate: (key: PageThumbnailRasterKey) => void
  /** Invalidates every revision and size retained for one page identity. */
  invalidatePage: (documentId: string, pageId: string) => void
  clear: () => void
  dispose: () => void
  getStats: () => PageThumbnailRasterCacheStats
}>

export class PageThumbnailRasterStaleError extends Error {
  constructor() {
    super("The page thumbnail request was invalidated before it completed.")
    this.name = "PageThumbnailRasterStaleError"
  }
}

export class PageThumbnailRasterCacheDisposedError extends Error {
  constructor() {
    super("The page thumbnail raster cache has been disposed.")
    this.name = "PageThumbnailRasterCacheDisposedError"
  }
}

type WorkState = "queued" | "active" | "settled"

type Work = {
  readonly serializedKey: string
  readonly key: PageThumbnailRasterKey
  readonly controller: AbortController
  readonly promise: Promise<PageThumbnailRasterEntry>
  readonly resolve: (entry: PageThumbnailRasterEntry) => void
  readonly reject: (error: unknown) => void
  state: WorkState
}

type CachedEntry = {
  readonly entry: PageThumbnailRasterEntry
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_ENTRIES = 64

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function validatedKey(key: PageThumbnailRasterKey): PageThumbnailRasterKey {
  if (
    key.documentId.length === 0 ||
    key.documentSnapshotId.length === 0 ||
    key.pageId.length === 0 ||
    key.pageRevision.length === 0 ||
    key.rendererRevision.length === 0
  ) {
    throw new TypeError(
      "Page thumbnail revision keys cannot contain empty IDs."
    )
  }
  if (!Number.isInteger(key.documentRevision) || key.documentRevision < 0) {
    throw new TypeError("Document revision must be a non-negative integer.")
  }
  if (
    !Number.isInteger(key.pixelWidth) ||
    key.pixelWidth < 1 ||
    !Number.isInteger(key.pixelHeight) ||
    key.pixelHeight < 1
  ) {
    throw new TypeError("Thumbnail pixel dimensions must be positive integers.")
  }
  return Object.freeze({ ...key })
}

function serializeKey(key: PageThumbnailRasterKey): string {
  return JSON.stringify([
    key.documentId,
    key.pageId,
    key.pageRevision,
    key.rendererRevision,
    key.pixelWidth,
    key.pixelHeight,
  ])
}

export function isSamePageThumbnailRasterCacheKey(
  left: PageThumbnailRasterKey,
  right: PageThumbnailRasterKey
): boolean {
  return serializeKey(left) === serializeKey(right)
}

function defaultCreateObjectURL(blob: Blob): string {
  if (typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is unavailable in this environment.")
  }
  return URL.createObjectURL(blob)
}

function defaultRevokeObjectURL(url: string): void {
  URL.revokeObjectURL(url)
}

/**
 * Pure scheduling and ownership boundary for inactive page thumbnail rasters.
 *
 * The caller owns visibility and decides which exact revision keys to request.
 * This cache never reads editor state, renders an Artboard, or guesses when a
 * page changed. The injected producer owns rasterization and must honor the
 * AbortSignal where possible. Every created object URL is revoked exactly once
 * on invalidation, LRU eviction, clear, or disposal.
 */
export function createPageThumbnailRasterCache(
  options: PageThumbnailRasterCacheOptions
): PageThumbnailRasterCache {
  const concurrency = boundedInteger(options.concurrency, DEFAULT_CONCURRENCY)
  const maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES)
  const createObjectURL = options.createObjectURL ?? defaultCreateObjectURL
  const revokeObjectURL = options.revokeObjectURL ?? defaultRevokeObjectURL
  const entries = new Map<string, CachedEntry>()
  const pending = new Map<string, Work>()
  const queue: Work[] = []
  const active = new Set<Work>()
  let disposed = false
  const isDisposed = () => disposed
  const isAborted = (work: Work) => work.controller.signal.aborted
  const isSettled = (work: Work) => work.state === "settled"

  const removeEntry = (serializedKey: string) => {
    const cached = entries.get(serializedKey)
    if (!cached) return
    entries.delete(serializedKey)
    revokeObjectURL(cached.entry.url)
  }

  const touchEntry = (serializedKey: string, cached: CachedEntry) => {
    entries.delete(serializedKey)
    entries.set(serializedKey, cached)
  }

  const enforceEntryLimit = () => {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value
      if (oldestKey === undefined) return
      removeEntry(oldestKey)
    }
  }

  const settle = (
    work: Work,
    outcome:
      | Readonly<{ status: "resolved"; entry: PageThumbnailRasterEntry }>
      | Readonly<{ status: "rejected"; error: unknown }>
  ) => {
    if (work.state === "settled") return
    work.state = "settled"
    if (pending.get(work.serializedKey) === work) {
      pending.delete(work.serializedKey)
    }
    if (outcome.status === "resolved") work.resolve(outcome.entry)
    else work.reject(outcome.error)
  }

  const rejectAsStale = (work: Work) => {
    work.controller.abort()
    settle(work, {
      status: "rejected",
      error: new PageThumbnailRasterStaleError(),
    })
  }

  const drain = () => {
    if (disposed) return
    while (active.size < concurrency) {
      const work = queue.shift()
      if (!work) return
      if (work.state !== "queued" || pending.get(work.serializedKey) !== work) {
        continue
      }
      work.state = "active"
      active.add(work)
      void (async () => {
        try {
          const blob = await options.producer(work.key, work.controller.signal)
          if (
            isDisposed() ||
            isSettled(work) ||
            isAborted(work) ||
            pending.get(work.serializedKey) !== work
          ) {
            if (!isSettled(work)) rejectAsStale(work)
            return
          }

          const url = createObjectURL(blob)
          if (
            isDisposed() ||
            isSettled(work) ||
            isAborted(work) ||
            pending.get(work.serializedKey) !== work
          ) {
            revokeObjectURL(url)
            if (!isSettled(work)) rejectAsStale(work)
            return
          }
          const entry = Object.freeze({
            key: work.key,
            url,
            byteLength: blob.size,
            mimeType: blob.type,
          })
          entries.set(work.serializedKey, { entry })
          enforceEntryLimit()
          settle(work, { status: "resolved", entry })
        } catch (error: unknown) {
          if (work.state === "settled") return
          const stale = isDisposed() || isAborted(work)
          settle(work, {
            status: "rejected",
            error: stale ? new PageThumbnailRasterStaleError() : error,
          })
        } finally {
          active.delete(work)
          drain()
        }
      })()
    }
  }

  const invalidateSerialized = (serializedKey: string) => {
    removeEntry(serializedKey)
    const work = pending.get(serializedKey)
    if (work) rejectAsStale(work)
  }

  const invalidateWhere = (
    predicate: (key: PageThumbnailRasterKey) => boolean
  ) => {
    const serializedKeys = new Set<string>()
    for (const [serializedKey, cached] of entries) {
      if (predicate(cached.entry.key)) serializedKeys.add(serializedKey)
    }
    for (const [serializedKey, work] of pending) {
      if (predicate(work.key)) serializedKeys.add(serializedKey)
    }
    for (const serializedKey of serializedKeys) {
      invalidateSerialized(serializedKey)
    }
    drain()
  }

  return Object.freeze({
    request(candidateKey) {
      if (disposed) throw new PageThumbnailRasterCacheDisposedError()
      const key = validatedKey(candidateKey)
      const serializedKey = serializeKey(key)
      const cached = entries.get(serializedKey)
      if (cached) {
        touchEntry(serializedKey, cached)
        return Promise.resolve(cached.entry)
      }
      const existing = pending.get(serializedKey)
      if (existing) return existing.promise

      let resolve!: (entry: PageThumbnailRasterEntry) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<PageThumbnailRasterEntry>(
        (promiseResolve, promiseReject) => {
          resolve = promiseResolve
          reject = promiseReject
        }
      )
      const work: Work = {
        serializedKey,
        key,
        controller: new AbortController(),
        promise,
        resolve,
        reject,
        state: "queued",
      }
      pending.set(serializedKey, work)
      queue.push(work)
      drain()
      return promise
    },
    peek(candidateKey) {
      const cached = entries.get(serializeKey(candidateKey))
      return cached?.entry ?? null
    },
    cancel(candidateKey) {
      const serializedKey = serializeKey(candidateKey)
      if (entries.has(serializedKey)) return
      const work = pending.get(serializedKey)
      if (!work) return
      rejectAsStale(work)
      drain()
    },
    invalidate(candidateKey) {
      invalidateSerialized(serializeKey(candidateKey))
      drain()
    },
    invalidatePage(documentId, pageId) {
      invalidateWhere(
        (key) => key.documentId === documentId && key.pageId === pageId
      )
    },
    clear() {
      invalidateWhere(() => true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const serializedKey of [...entries.keys()]) {
        removeEntry(serializedKey)
      }
      for (const work of [...pending.values()]) {
        work.controller.abort()
        settle(work, {
          status: "rejected",
          error: new PageThumbnailRasterCacheDisposedError(),
        })
      }
      queue.length = 0
    },
    getStats() {
      let queued = 0
      for (const work of pending.values()) {
        if (work.state === "queued") queued += 1
      }
      return Object.freeze({
        entries: entries.size,
        queued,
        active: active.size,
        concurrency,
        maxEntries,
        disposed,
      })
    },
  })
}
