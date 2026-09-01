import type { Document, SceneNode } from "@webmcp/document"
import type {
  AlignmentSnapTarget,
  CanvasAdapter,
  CanvasImageCropDraft,
  CanvasImageCropMode,
  Selection,
} from "@webmcp/editor"

export type FabricRenderInvalidationKind =
  "document" | "viewport" | "selection" | "preview" | "repaint"

export type FabricPreviewInvalidation =
  | Readonly<{ kind: "crop_mode"; mode: CanvasImageCropMode | null }>
  | Readonly<{ kind: "crop_draft"; draft: CanvasImageCropDraft }>
  | Readonly<{
      kind: "node_patch"
      nodeId: string
      patch: Partial<SceneNode>
    }>
  | Readonly<{ kind: "node_restore"; nodeId: string }>

export type FabricRenderInvalidationSnapshot = Readonly<{
  attached: boolean
  attachment: number
  lastKind: FabricRenderInvalidationKind | null
  counts: Readonly<Record<FabricRenderInvalidationKind, number>>
}>

const emptyCounts = (): Record<FabricRenderInvalidationKind, number> => ({
  document: 0,
  viewport: 0,
  selection: 0,
  preview: 0,
  repaint: 0,
})

const settleWithAbort = <T>(operation: Promise<T>, signal?: AbortSignal) => {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(signal.reason)
    }
    const cleanUp = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void operation.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

export class FabricRenderInvalidationController {
  #adapter: CanvasAdapter | null = null
  #attachment = 0
  #documentTail: Promise<void> = Promise.resolve()
  #lastKind: FabricRenderInvalidationKind | null = null
  readonly #counts = emptyCounts()

  get adapter() {
    return this.#adapter
  }

  attach(adapter: CanvasAdapter) {
    if (this.#adapter === adapter) return this.#attachment
    this.#adapter = adapter
    this.#attachment += 1
    return this.#attachment
  }

  detach(adapter?: CanvasAdapter) {
    if (adapter && this.#adapter !== adapter) return false
    if (!this.#adapter) return false
    this.#adapter = null
    this.#attachment += 1
    return true
  }

  whenDocumentSettled() {
    return this.#documentTail
  }

  invalidateDocument({
    document,
    pageId,
    signal,
    prepare,
  }: {
    document: Document
    pageId: string
    signal?: AbortSignal
    prepare?: () => Promise<void>
  }) {
    const adapter = this.#adapter
    const attachment = this.#attachment
    this.#record("document")
    if (!adapter) return Promise.resolve(false)
    const pending = this.#documentTail.then(async () => {
      signal?.throwIfAborted()
      if (this.#adapter !== adapter || this.#attachment !== attachment) {
        return false
      }
      if (prepare) await settleWithAbort(prepare(), signal)
      signal?.throwIfAborted()
      if (this.#adapter !== adapter || this.#attachment !== attachment) {
        return false
      }
      await settleWithAbort(adapter.sync(document, pageId, signal), signal)
      return this.#adapter === adapter && this.#attachment === attachment
    })
    this.#documentTail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  invalidateViewport(
    invalidation:
      | Readonly<{ kind: "zoom"; zoom: number }>
      | Readonly<{
          kind: "snap_targets"
          pageId: string
          targets: readonly AlignmentSnapTarget[]
        }>
  ) {
    const adapter = this.#adapter
    this.#record("viewport")
    if (!adapter) return false
    if (invalidation.kind === "zoom") {
      adapter.setViewportZoom(invalidation.zoom)
    } else {
      adapter.setSnapTargets(invalidation.pageId, invalidation.targets)
    }
    return true
  }

  invalidateSelection(selection: Selection | null) {
    const adapter = this.#adapter
    this.#record("selection")
    if (!adapter) return false
    adapter.select(selection)
    return true
  }

  invalidatePreview(invalidation: FabricPreviewInvalidation) {
    const adapter = this.#adapter
    this.#record("preview")
    if (!adapter) return false
    if (invalidation.kind === "crop_mode") {
      return adapter.setImageCropMode(invalidation.mode)
    }
    if (invalidation.kind === "crop_draft") {
      return adapter.previewImageCropDraft(invalidation.draft)
    }
    if (invalidation.kind === "node_patch") {
      return adapter.previewNodePatch(invalidation.nodeId, invalidation.patch)
    }
    return adapter.restoreNodePreview(invalidation.nodeId)
  }

  invalidateRepaint() {
    const adapter = this.#adapter
    this.#record("repaint")
    if (!adapter) return false
    adapter.requestRender()
    return true
  }

  getSnapshot(): FabricRenderInvalidationSnapshot {
    return {
      attached: this.#adapter !== null,
      attachment: this.#attachment,
      lastKind: this.#lastKind,
      counts: { ...this.#counts },
    }
  }

  #record(kind: FabricRenderInvalidationKind) {
    this.#lastKind = kind
    this.#counts[kind] += 1
  }
}
