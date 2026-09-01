import {
  createPageThumbnailDocument,
  createPageThumbnailRevision,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import type {
  DocumentDraftPreview,
  DocumentDraftRecord,
  DraftPreviewIdentity,
  DraftPreviewReadResult,
  DraftRepositoryFailure,
} from "./document-draft-repository"
import {
  createDocumentPreviewKey,
  serializeDocumentPreviewKey,
} from "./document-preview-contract"
import type {
  DocumentPreviewIdentity,
  DocumentPreviewKey,
} from "./document-preview-contract"
import type { PageThumbnailRasterKey } from "./page-thumbnail-raster-cache"
import {
  pageThumbnailRasterRetryDelay,
  produceStudioPageThumbnailRaster,
} from "./page-thumbnail-raster-producer"
import type { PageThumbnailDocumentSnapshot } from "./page-thumbnail-raster-producer"
import { projectLocalAssetPreviewSources } from "./local-asset-preview"
import { localAssetIdFromSource } from "./local-asset-store"
import {
  managedMediaContentUrl,
  managedMediaIdFromSource,
} from "./managed-media-repository"

export type DocumentPreviewState =
  | Readonly<{ status: "deferred" }>
  | Readonly<{ status: "loading"; phase: "reading" | "producing" }>
  | Readonly<{
      status: "ready"
      url: string
      cached: boolean
    }>
  | Readonly<{
      status: "live_fallback"
      document: Document
      pageId: string
    }>
  | Readonly<{
      status: "failed"
      message: string
      retryable: boolean
    }>

export type DocumentPreviewControllerDependencies = Readonly<{
  readPreview: (
    identity: DraftPreviewIdentity
  ) => Promise<DraftPreviewReadResult>
  getDocument: (documentId: string) => Promise<
    | Readonly<{ ok: true; status: "found"; record: DocumentDraftRecord }>
    | Readonly<{ ok: true; status: "missing" }>
    | Readonly<{
        ok: false
        reason: string
        failure: DraftRepositoryFailure
      }>
  >
  putPreview: (
    preview: Omit<DocumentDraftPreview, "schemaVersion" | "createdAt">
  ) => Promise<
    | Readonly<{ ok: true; value: DocumentDraftPreview }>
    | Readonly<{
        ok: false
        reason: string
        failure?: DraftRepositoryFailure
      }>
  >
  produce?: typeof produceStudioPageThumbnailRaster
  liveFallback?: boolean
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  scheduleMicrotask?: (callback: () => void) => void
  concurrency?: number
  maxEntries?: number
  loadLocalAsset?: (assetId: string) => Promise<Blob | null>
}>

type Entry = {
  readonly key: DocumentPreviewKey
  consumers: number
  generation: number
  state: DocumentPreviewState
  controller: AbortController | null
  queued: boolean
  fallbackUrls: string[]
}

type UrlEntry = Readonly<{ url: string }>

const deferredState: DocumentPreviewState = Object.freeze({
  status: "deferred",
})

const exactHeadMatches = (
  identity: DocumentPreviewIdentity,
  record: DocumentDraftRecord
) =>
  record.summary.deletedAt === null &&
  record.summary.documentId === identity.documentId &&
  record.summary.recordVersion === identity.recordVersion &&
  record.summary.contentSnapshotId === identity.contentSnapshotId &&
  record.summary.firstPageId === identity.pageId &&
  record.summary.firstPageWidth === identity.pageWidth &&
  record.summary.firstPageHeight === identity.pageHeight

const toDraftIdentity = (key: DocumentPreviewKey): DraftPreviewIdentity => ({
  documentId: key.documentId,
  recordVersion: key.recordVersion,
  contentSnapshotId: key.contentSnapshotId,
  pageId: key.pageId,
  pageWidth: key.pageWidth,
  pageHeight: key.pageHeight,
  rendererRevision: key.rendererRevision,
  width: key.pixelWidth,
  height: key.pixelHeight,
})

const toRasterKey = (
  key: DocumentPreviewKey,
  record: DocumentDraftRecord
): PageThumbnailRasterKey => ({
  documentId: key.documentId,
  documentRevision: key.documentRevision,
  documentSnapshotId: key.contentSnapshotId,
  pageId: key.pageId,
  pageRevision: createPageThumbnailRevision(
    record.envelope.document,
    key.pageId
  ),
  rendererRevision: key.rendererRevision,
  pixelWidth: key.pixelWidth,
  pixelHeight: key.pixelHeight,
})

const abortableDelay = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = globalThis.setTimeout(resolve, delayMs)
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })

const previewJobIsStale = (
  entry: Entry,
  generation: number,
  signal: AbortSignal
) => signal.aborted || entry.generation !== generation

export class DocumentPreviewController {
  readonly #dependencies: Required<
    Pick<
      DocumentPreviewControllerDependencies,
      "createObjectURL" | "revokeObjectURL" | "scheduleMicrotask" | "produce"
    >
  > &
    DocumentPreviewControllerDependencies
  readonly #entries = new Map<string, Entry>()
  readonly #urls = new Map<string, UrlEntry>()
  readonly #queue: Entry[] = []
  readonly #listeners = new Set<() => void>()
  readonly #concurrency: number
  readonly #maxEntries: number
  #active = 0
  #disposed = false

  constructor(dependencies: DocumentPreviewControllerDependencies) {
    this.#dependencies = {
      ...dependencies,
      produce: dependencies.produce ?? produceStudioPageThumbnailRaster,
      createObjectURL:
        dependencies.createObjectURL ?? ((blob) => URL.createObjectURL(blob)),
      revokeObjectURL:
        dependencies.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url)),
      scheduleMicrotask:
        dependencies.scheduleMicrotask ??
        ((callback) => queueMicrotask(callback)),
    }
    this.#concurrency = Math.max(1, Math.floor(dependencies.concurrency ?? 3))
    this.#maxEntries = Math.max(1, Math.floor(dependencies.maxEntries ?? 64))
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot(identity: DocumentPreviewIdentity): DocumentPreviewState {
    const key = createDocumentPreviewKey(identity)
    const serialized = serializeDocumentPreviewKey(key)
    return this.#entries.get(serialized)?.state ?? deferredState
  }

  retain(identity: DocumentPreviewIdentity) {
    if (this.#disposed) return () => {}
    const key = createDocumentPreviewKey(identity)
    const serialized = serializeDocumentPreviewKey(key)
    let entry = this.#entries.get(serialized)
    if (!entry) {
      const cached = this.#urls.get(serialized)
      entry = {
        key,
        consumers: 0,
        generation: 0,
        state: cached
          ? { status: "ready", url: cached.url, cached: true }
          : deferredState,
        controller: null,
        queued: false,
        fallbackUrls: [],
      }
      this.#entries.set(serialized, entry)
    }
    const cached = this.#urls.get(serialized)
    if (cached) {
      this.#urls.delete(serialized)
      this.#urls.set(serialized, cached)
    }
    entry.consumers += 1
    if (entry.state.status === "deferred") this.#enqueue(entry)
    const retainedEntry = entry
    let released = false
    return () => {
      if (released) return
      released = true
      retainedEntry.consumers = Math.max(0, retainedEntry.consumers - 1)
      this.#dependencies.scheduleMicrotask(() => {
        if (this.#disposed || retainedEntry.consumers > 0) return
        this.#cancelEntry(retainedEntry, { preserveFailure: true })
        this.#trimUrls()
      })
    }
  }

  retry(identity: DocumentPreviewIdentity) {
    if (this.#disposed) return
    const key = createDocumentPreviewKey(identity)
    const entry = this.#entries.get(serializeDocumentPreviewKey(key))
    if (!entry || entry.consumers < 1) return
    this.#cancelEntry(entry)
    this.#enqueue(entry)
  }

  invalidateDocument(
    documentId: string,
    { reloadVisible = false }: { reloadVisible?: boolean } = {}
  ) {
    for (const [serialized, entry] of this.#entries) {
      if (entry.key.documentId !== documentId) continue
      this.#cancelEntry(entry)
      const cached = this.#urls.get(serialized)
      if (cached) {
        this.#urls.delete(serialized)
        this.#dependencies.revokeObjectURL(cached.url)
      }
      if (reloadVisible && entry.consumers > 0) {
        this.#enqueue(entry)
      } else {
        this.#entries.delete(serialized)
      }
    }
    this.#emit()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#entries.values()) this.#cancelEntry(entry)
    this.#entries.clear()
    this.#queue.length = 0
    for (const cached of this.#urls.values()) {
      this.#dependencies.revokeObjectURL(cached.url)
    }
    this.#urls.clear()
    this.#listeners.clear()
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  #publish(entry: Entry, state: DocumentPreviewState, generation: number) {
    if (
      this.#disposed ||
      entry.generation !== generation ||
      entry.consumers < 1
    )
      return false
    entry.state = state
    this.#emit()
    return true
  }

  #enqueue(entry: Entry) {
    if (this.#disposed || entry.queued || entry.controller) return
    entry.generation += 1
    entry.queued = true
    entry.state = { status: "loading", phase: "reading" }
    this.#queue.push(entry)
    this.#emit()
    this.#drain()
  }

  #clearFallbackUrls(entry: Entry) {
    for (const url of entry.fallbackUrls) {
      this.#dependencies.revokeObjectURL(url)
    }
    entry.fallbackUrls = []
  }

  #cancelEntry(
    entry: Entry,
    { preserveFailure = false }: { preserveFailure?: boolean } = {}
  ) {
    entry.generation += 1
    entry.queued = false
    entry.controller?.abort()
    entry.controller = null
    this.#clearFallbackUrls(entry)
    if (
      entry.state.status !== "ready" &&
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
      const controller = new AbortController()
      entry.controller = controller
      this.#active += 1
      void this.#run(entry, generation, controller.signal).finally(() => {
        this.#active -= 1
        if (entry.controller === controller) entry.controller = null
        this.#drain()
      })
    }
  }

  async #run(entry: Entry, generation: number, signal: AbortSignal) {
    try {
      const stored = await this.#dependencies.readPreview(
        toDraftIdentity(entry.key)
      )
      if (previewJobIsStale(entry, generation, signal)) return
      if (stored.ok && stored.status === "ready") {
        this.#publishBlob(entry, stored.preview.blob, true, generation)
        return
      }
      if (stored.ok && stored.status === "not_active") {
        this.#publish(entry, deferredState, generation)
        return
      }
      if (!stored.ok && stored.reason === "stale_head") {
        this.#publish(
          entry,
          {
            status: "failed",
            message:
              "The document changed. Refreshing its preview metadata is required.",
            retryable: false,
          },
          generation
        )
        return
      }
      if (!stored.ok && stored.reason === "storage_unavailable") {
        this.#publishFailure(entry, stored.failure, generation)
        return
      }

      this.#publish(
        entry,
        { status: "loading", phase: "producing" },
        generation
      )
      const current = await this.#dependencies.getDocument(entry.key.documentId)
      if (previewJobIsStale(entry, generation, signal)) return
      if (!current.ok) {
        this.#publishFailure(entry, current.failure, generation)
        return
      }
      if (
        current.status === "missing" ||
        !exactHeadMatches(entry.key, current.record)
      ) {
        this.#publish(
          entry,
          {
            status: "failed",
            message:
              "The document changed before its preview could be created.",
            retryable: false,
          },
          generation
        )
        return
      }
      const thumbnailDocument = createPageThumbnailDocument(
        current.record.envelope.document,
        entry.key.pageId
      )
      const hasLocalAsset = thumbnailDocument.nodes.some(
        (node) => node.type === "image" && node.src.startsWith("asset:local/")
      )
      if (this.#dependencies.liveFallback || hasLocalAsset) {
        const previewUrls = new Map<string, string>()
        const fallbackUrls: string[] = []
        entry.fallbackUrls = fallbackUrls
        if (hasLocalAsset && this.#dependencies.loadLocalAsset) {
          const assetIds = [
            ...new Set(
              thumbnailDocument.nodes.flatMap((node) => {
                if (node.type !== "image") return []
                const assetId = localAssetIdFromSource(node.src)
                return assetId ? [assetId] : []
              })
            ),
          ]
          for (const assetId of assetIds) {
            const blob = await this.#dependencies.loadLocalAsset(assetId)
            if (previewJobIsStale(entry, generation, signal)) {
              this.#clearFallbackUrls(entry)
              return
            }
            if (!blob) continue
            const url = this.#dependencies.createObjectURL(blob)
            fallbackUrls.push(url)
            previewUrls.set(assetId, url)
          }
        }
        const liveDocument = hasLocalAsset
          ? projectLocalAssetPreviewSources(thumbnailDocument, previewUrls)
          : thumbnailDocument
        const materializedDocument = {
          ...liveDocument,
          nodes: liveDocument.nodes.map((node) => {
            if (node.type !== "image") return node
            const assetId = managedMediaIdFromSource(node.src)
            return assetId
              ? { ...node, src: managedMediaContentUrl(assetId) }
              : node
          }),
        }
        this.#publish(
          entry,
          {
            status: "live_fallback",
            document: materializedDocument,
            pageId: entry.key.pageId,
          },
          generation
        )
        return
      }

      const rasterKey = toRasterKey(entry.key, current.record)
      const snapshot: PageThumbnailDocumentSnapshot = {
        document: current.record.envelope.document,
        snapshotId: entry.key.contentSnapshotId,
      }
      let blob: Blob | null = null
      let lastError: unknown = null
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          blob = await this.#dependencies.produce({
            key: rasterKey,
            snapshot,
            signal,
          })
          break
        } catch (error) {
          lastError = error
          const delay = pageThumbnailRasterRetryDelay(error, attempt)
          if (delay === null || attempt === 3) break
          await abortableDelay(delay, signal)
        }
      }
      if (!blob) throw lastError ?? new Error("Preview rendering failed.")
      if (previewJobIsStale(entry, generation, signal)) return
      const storedPreview = await this.#dependencies.putPreview({
        documentId: entry.key.documentId,
        contentSnapshotId: entry.key.contentSnapshotId,
        pageId: entry.key.pageId,
        rendererRevision: entry.key.rendererRevision,
        width: entry.key.pixelWidth,
        height: entry.key.pixelHeight,
        mimeType: "image/png",
        byteLength: blob.size,
        blob,
      })
      if (previewJobIsStale(entry, generation, signal)) return
      if (storedPreview.ok) {
        this.#publishBlob(entry, storedPreview.value.blob, true, generation)
        return
      }
      if (
        storedPreview.failure?.kind === "storage_unavailable" ||
        storedPreview.failure?.kind === "quota_exceeded"
      ) {
        this.#publishBlob(entry, blob, false, generation)
        return
      }
      this.#publish(
        entry,
        {
          status: "failed",
          message:
            storedPreview.failure?.message ??
            "The document changed before its preview could be stored.",
          retryable: true,
        },
        generation
      )
    } catch (error) {
      if (previewJobIsStale(entry, generation, signal)) return
      this.#clearFallbackUrls(entry)
      this.#publish(
        entry,
        {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The document preview could not be created.",
          retryable: true,
        },
        generation
      )
    }
  }

  #publishFailure(
    entry: Entry,
    failure: DraftRepositoryFailure,
    generation: number
  ) {
    this.#publish(
      entry,
      {
        status: "failed",
        message: failure.message,
        retryable: failure.kind !== "validation_failed",
      },
      generation
    )
  }

  #publishBlob(entry: Entry, blob: Blob, cached: boolean, generation: number) {
    if (
      this.#disposed ||
      entry.generation !== generation ||
      entry.consumers < 1
    )
      return
    this.#clearFallbackUrls(entry)
    const serialized = serializeDocumentPreviewKey(entry.key)
    const previous = this.#urls.get(serialized)
    const url = this.#dependencies.createObjectURL(blob)
    this.#urls.delete(serialized)
    this.#urls.set(serialized, { url })
    entry.state = { status: "ready", url, cached }
    this.#emit()
    if (previous && previous.url !== url) {
      this.#dependencies.revokeObjectURL(previous.url)
    }
    this.#trimUrls()
  }

  #trimUrls() {
    while (this.#urls.size > this.#maxEntries) {
      let evicted = false
      for (const [serialized, cached] of this.#urls) {
        const entry = this.#entries.get(serialized)
        if (entry && entry.consumers > 0) continue
        this.#urls.delete(serialized)
        this.#dependencies.revokeObjectURL(cached.url)
        if (entry?.state.status === "ready" && entry.state.url === cached.url) {
          entry.state = deferredState
          this.#entries.delete(serialized)
        }
        evicted = true
        break
      }
      if (!evicted) break
    }
  }
}
