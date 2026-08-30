import {
  inspectRasterBytes,
  libraryPreviewDescriptorSchema,
} from "@webmcp/document"
import type {
  LibraryPreviewDescriptor,
  RasterMediaType,
} from "@webmcp/document"

export type LibraryPreviewState =
  | Readonly<{ status: "deferred" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready"
      url: string
      cached: boolean
      width: number
      height: number
      mediaType: RasterMediaType
    }>
  | Readonly<{
      status: "live_fallback"
      descriptor: LibraryPreviewDescriptor & { kind: "live_fallback" }
    }>
  | Readonly<{
      status: "failed"
      message: string
      retryable: true
    }>

export type LibraryPreviewControllerDependencies = Readonly<{
  fetch?: typeof globalThis.fetch
  sha256?: (bytes: Uint8Array) => Promise<string>
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  scheduleMicrotask?: (callback: () => void) => void
  concurrency?: number
  maxEntries?: number
}>

export type LibraryPreviewControllerStats = Readonly<{
  active: number
  queued: number
  cached: number
  concurrency: number
  maxEntries: number
  disposed: boolean
}>

type PreviewEntry = {
  readonly descriptor: LibraryPreviewDescriptor
  readonly key: string
  consumers: number
  generation: number
  state: LibraryPreviewState
  controller: AbortController | null
  queued: boolean
  bypassCache: boolean
}

type CachedPreview = Readonly<{
  url: string
  width: number
  height: number
  mediaType: RasterMediaType
}>

const deferredState: LibraryPreviewState = Object.freeze({
  status: "deferred",
})

const DEFAULT_CONCURRENCY = 3
const DEFAULT_MAX_ENTRIES = 64

const boundedInteger = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.floor(value))

const defaultSha256 = async (bytes: Uint8Array) => {
  const ownedBytes = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const normalizedResponseMediaType = (response: Response) =>
  response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? ""

const stale = (entry: PreviewEntry, generation: number, signal: AbortSignal) =>
  signal.aborted || entry.generation !== generation

export function serializeLibraryPreviewDescriptor(
  descriptor: LibraryPreviewDescriptor
) {
  return JSON.stringify([
    descriptor.kind,
    descriptor.itemId,
    descriptor.itemVersion,
    descriptor.pageId,
    descriptor.width,
    descriptor.height,
    descriptor.resourcePath,
    descriptor.mediaType,
    descriptor.contentSha256,
    descriptor.rendererRevision,
  ])
}

/**
 * Owns immutable library preview fetches independently from React and catalog
 * discovery. Callers decide when a card is near enough to retain its exact
 * descriptor; this controller owns request sharing, validation and URL life.
 */
export class LibraryPreviewController {
  readonly #dependencies: Required<
    Pick<
      LibraryPreviewControllerDependencies,
      | "fetch"
      | "sha256"
      | "createObjectURL"
      | "revokeObjectURL"
      | "scheduleMicrotask"
    >
  > &
    LibraryPreviewControllerDependencies
  readonly #entries = new Map<string, PreviewEntry>()
  readonly #cache = new Map<string, CachedPreview>()
  readonly #queue: PreviewEntry[] = []
  readonly #listeners = new Set<() => void>()
  readonly #concurrency: number
  readonly #maxEntries: number
  #active = 0
  #disposed = false

  constructor(dependencies: LibraryPreviewControllerDependencies = {}) {
    this.#dependencies = {
      ...dependencies,
      fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
      sha256: dependencies.sha256 ?? defaultSha256,
      createObjectURL:
        dependencies.createObjectURL ?? ((blob) => URL.createObjectURL(blob)),
      revokeObjectURL:
        dependencies.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url)),
      scheduleMicrotask:
        dependencies.scheduleMicrotask ??
        ((callback) => queueMicrotask(callback)),
    }
    this.#concurrency = Math.min(
      DEFAULT_CONCURRENCY,
      boundedInteger(dependencies.concurrency, DEFAULT_CONCURRENCY)
    )
    this.#maxEntries = boundedInteger(
      dependencies.maxEntries,
      DEFAULT_MAX_ENTRIES
    )
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot(candidate: LibraryPreviewDescriptor): LibraryPreviewState {
    const descriptor = libraryPreviewDescriptorSchema.parse(candidate)
    return (
      this.#entries.get(serializeLibraryPreviewDescriptor(descriptor))?.state ??
      deferredState
    )
  }

  retain(candidate: LibraryPreviewDescriptor) {
    if (this.#disposed) return () => {}
    const descriptor = Object.freeze(
      libraryPreviewDescriptorSchema.parse(candidate)
    )
    const key = serializeLibraryPreviewDescriptor(descriptor)
    let entry = this.#entries.get(key)
    if (!entry) {
      const cached = this.#cache.get(key)
      entry = {
        descriptor,
        key,
        consumers: 0,
        generation: 0,
        state:
          descriptor.kind === "live_fallback"
            ? {
                status: "live_fallback",
                descriptor: descriptor as LibraryPreviewDescriptor & {
                  kind: "live_fallback"
                },
              }
            : cached
              ? {
                  status: "ready",
                  url: cached.url,
                  cached: true,
                  width: cached.width,
                  height: cached.height,
                  mediaType: cached.mediaType,
                }
              : deferredState,
        controller: null,
        queued: false,
        bypassCache: false,
      }
      this.#entries.set(key, entry)
    }
    entry.consumers += 1
    const cached = this.#cache.get(key)
    if (cached) this.#touchCache(key, cached)
    if (entry.state.status === "deferred") this.#enqueue(entry, false)

    const retainedEntry = entry
    let released = false
    return () => {
      if (released) return
      released = true
      retainedEntry.consumers = Math.max(0, retainedEntry.consumers - 1)
      this.#dependencies.scheduleMicrotask(() => {
        if (this.#disposed || retainedEntry.consumers > 0) return
        this.#cancel(retainedEntry, { preserveFailure: true })
        this.#trimCache()
      })
    }
  }

  retry(candidate: LibraryPreviewDescriptor) {
    if (this.#disposed) return
    const descriptor = libraryPreviewDescriptorSchema.parse(candidate)
    if (descriptor.kind !== "raster") return
    const key = serializeLibraryPreviewDescriptor(descriptor)
    const entry = this.#entries.get(key)
    if (!entry || entry.consumers < 1) return
    this.#cancel(entry)
    this.#removeCached(key)
    this.#enqueue(entry, true)
  }

  getStats(): LibraryPreviewControllerStats {
    return Object.freeze({
      active: this.#active,
      queued: this.#queue.reduce(
        (count, entry) => count + (entry.queued ? 1 : 0),
        0
      ),
      cached: this.#cache.size,
      concurrency: this.#concurrency,
      maxEntries: this.#maxEntries,
      disposed: this.#disposed,
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#entries.values()) this.#cancel(entry)
    this.#entries.clear()
    this.#queue.length = 0
    for (const cached of this.#cache.values()) {
      this.#dependencies.revokeObjectURL(cached.url)
    }
    this.#cache.clear()
    this.#listeners.clear()
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  #touchCache(key: string, cached: CachedPreview) {
    this.#cache.delete(key)
    this.#cache.set(key, cached)
  }

  #removeCached(key: string) {
    const cached = this.#cache.get(key)
    if (!cached) return
    this.#cache.delete(key)
    this.#dependencies.revokeObjectURL(cached.url)
  }

  #publish(
    entry: PreviewEntry,
    state: LibraryPreviewState,
    generation: number
  ) {
    if (
      this.#disposed ||
      entry.generation !== generation ||
      entry.consumers < 1
    ) {
      return false
    }
    entry.state = state
    this.#emit()
    return true
  }

  #enqueue(entry: PreviewEntry, bypassCache: boolean) {
    if (
      this.#disposed ||
      entry.descriptor.kind !== "raster" ||
      entry.queued ||
      entry.controller
    ) {
      return
    }
    entry.generation += 1
    entry.queued = true
    entry.bypassCache = bypassCache
    entry.state = { status: "loading" }
    this.#queue.push(entry)
    this.#emit()
    this.#drain()
  }

  #cancel(
    entry: PreviewEntry,
    { preserveFailure = false }: { preserveFailure?: boolean } = {}
  ) {
    entry.generation += 1
    entry.queued = false
    entry.controller?.abort()
    entry.controller = null
    entry.bypassCache = false
    if (
      entry.state.status !== "ready" &&
      entry.state.status !== "live_fallback" &&
      !(preserveFailure && entry.state.status === "failed")
    ) {
      entry.state = deferredState
    }
  }

  #drain() {
    if (this.#disposed) return
    while (this.#active < this.#concurrency) {
      const entry = this.#queue.shift()
      if (!entry) return
      if (!entry.queued || entry.consumers < 1) continue
      entry.queued = false
      const generation = entry.generation
      const bypassCache = entry.bypassCache
      entry.bypassCache = false
      const controller = new AbortController()
      entry.controller = controller
      this.#active += 1
      void this.#load(
        entry,
        generation,
        bypassCache,
        controller.signal
      ).finally(() => {
        this.#active -= 1
        if (entry.controller === controller) entry.controller = null
        this.#drain()
      })
    }
  }

  async #load(
    entry: PreviewEntry,
    generation: number,
    bypassCache: boolean,
    signal: AbortSignal
  ) {
    const descriptor = entry.descriptor
    if (
      descriptor.kind !== "raster" ||
      !descriptor.resourcePath ||
      !descriptor.mediaType ||
      !descriptor.contentSha256
    ) {
      return
    }
    try {
      const response = await this.#dependencies.fetch(descriptor.resourcePath, {
        signal,
        credentials: "same-origin",
        cache: bypassCache ? "reload" : "default",
      })
      if (stale(entry, generation, signal)) return
      if (!response.ok) {
        throw new Error(`Preview request failed with HTTP ${response.status}.`)
      }
      const responseMediaType = normalizedResponseMediaType(response)
      if (responseMediaType !== descriptor.mediaType) {
        throw new Error("Preview response type did not match its manifest.")
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (stale(entry, generation, signal)) return
      const dimensions = inspectRasterBytes(descriptor.mediaType, bytes)
      if (
        dimensions.width !== descriptor.width ||
        dimensions.height !== descriptor.height
      ) {
        throw new Error("Preview dimensions did not match its manifest.")
      }
      const contentSha256 = await this.#dependencies.sha256(bytes)
      if (stale(entry, generation, signal)) return
      if (contentSha256 !== descriptor.contentSha256) {
        throw new Error("Preview checksum did not match its manifest.")
      }
      const blob = new Blob([bytes], { type: descriptor.mediaType })
      const url = this.#dependencies.createObjectURL(blob)
      if (stale(entry, generation, signal) || entry.consumers < 1) {
        this.#dependencies.revokeObjectURL(url)
        return
      }
      const previous = this.#cache.get(entry.key)
      const cached: CachedPreview = {
        url,
        width: dimensions.width,
        height: dimensions.height,
        mediaType: descriptor.mediaType,
      }
      this.#cache.delete(entry.key)
      this.#cache.set(entry.key, cached)
      entry.state = {
        status: "ready",
        url,
        cached: false,
        width: dimensions.width,
        height: dimensions.height,
        mediaType: descriptor.mediaType,
      }
      this.#emit()
      if (previous && previous.url !== url) {
        this.#dependencies.revokeObjectURL(previous.url)
      }
      this.#trimCache()
    } catch (error) {
      if (stale(entry, generation, signal)) return
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Preview could not be loaded."
      this.#publish(
        entry,
        { status: "failed", message, retryable: true },
        generation
      )
    }
  }

  #trimCache() {
    while (this.#cache.size > this.#maxEntries) {
      let evicted = false
      for (const [key, cached] of this.#cache) {
        const entry = this.#entries.get(key)
        if (entry && entry.consumers > 0) continue
        this.#cache.delete(key)
        this.#dependencies.revokeObjectURL(cached.url)
        if (entry?.state.status === "ready" && entry.state.url === cached.url) {
          this.#entries.delete(key)
        }
        evicted = true
        break
      }
      if (!evicted) break
    }
  }
}
