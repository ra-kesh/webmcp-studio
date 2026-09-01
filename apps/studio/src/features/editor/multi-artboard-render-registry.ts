import type { Document, SceneNode } from "@webmcp/document"
import type {
  AlignmentSnapTarget,
  CanvasImageCropDraft,
  CanvasImageCropMode,
  Selection,
} from "@webmcp/editor"
import type { MultiArtboardLayoutController } from "@webmcp/editor/multi-artboard"
import { visiblePageIds } from "@webmcp/editor/multi-artboard"
import type { CanvasCamera, ViewportSize } from "@webmcp/editor/viewport"

export type MultiArtboardPreviewInvalidation =
  | Readonly<{ kind: "crop_mode"; mode: CanvasImageCropMode | null }>
  | Readonly<{ kind: "crop_draft"; draft: CanvasImageCropDraft }>
  | Readonly<{
      kind: "node_patch"
      nodeId: string
      patch: Partial<SceneNode>
    }>
  | Readonly<{ kind: "node_restore"; nodeId: string }>

export type PageRenderInvalidationController = Readonly<{
  detach: () => boolean
  whenDocumentSettled: () => Promise<void>
  invalidateDocument: (input: {
    document: Document
    pageId: string
    signal?: AbortSignal
    prepare?: () => Promise<void>
  }) => Promise<boolean>
  invalidateViewport: (
    input:
      | Readonly<{ kind: "zoom"; zoom: number }>
      | Readonly<{
          kind: "snap_targets"
          pageId: string
          targets: readonly AlignmentSnapTarget[]
        }>
  ) => boolean
  invalidateSelection: (selection: Selection | null) => boolean
  invalidatePreview: (invalidation: MultiArtboardPreviewInvalidation) => boolean
  invalidateRepaint: () => boolean
}>

export type MultiArtboardRenderRegistrySnapshot = Readonly<{
  mountedPageIds: readonly string[]
  pinnedPageIds: readonly string[]
}>

export class MultiArtboardRenderRegistry {
  readonly #controllers = new Map<string, PageRenderInvalidationController>()
  readonly #pinnedPageIds = new Set<string>()

  attach(pageId: string, controller: PageRenderInvalidationController) {
    const previous = this.#controllers.get(pageId)
    if (previous === controller) return false
    if (previous) previous.detach()
    this.#controllers.set(pageId, controller)
    return true
  }

  async detach(pageId: string, controller?: PageRenderInvalidationController) {
    const current = this.#controllers.get(pageId)
    if (!current || (controller && current !== controller)) return false
    current.detach()
    this.#controllers.delete(pageId)
    this.#pinnedPageIds.delete(pageId)
    await current.whenDocumentSettled()
    return true
  }

  dispose() {
    const settling: Promise<void>[] = []
    for (const controller of this.#controllers.values()) {
      controller.detach()
      settling.push(controller.whenDocumentSettled())
    }
    this.#controllers.clear()
    this.#pinnedPageIds.clear()
    return Promise.all(settling).then(() => undefined)
  }

  pin(pageId: string) {
    this.#pinnedPageIds.add(pageId)
  }

  unpin(pageId: string) {
    this.#pinnedPageIds.delete(pageId)
  }

  visiblePageIds(
    layout: MultiArtboardLayoutController,
    camera: CanvasCamera,
    viewport: ViewportSize,
    overscanScreens = 1
  ) {
    return visiblePageIds(layout, camera, viewport, {
      overscanScreens,
      pinnedPageIds: this.#pinnedPageIds,
    })
  }

  invalidateDocument(
    pageId: string,
    input: Omit<
      Parameters<PageRenderInvalidationController["invalidateDocument"]>[0],
      "pageId"
    >
  ) {
    return (
      this.#controllers.get(pageId)?.invalidateDocument({ ...input, pageId }) ??
      Promise.resolve(false)
    )
  }

  invalidateCamera(zoom: number) {
    for (const controller of this.#controllers.values()) {
      controller.invalidateViewport({ kind: "zoom", zoom })
    }
  }

  invalidateSnapTargets(
    pageId: string,
    targets: readonly AlignmentSnapTarget[]
  ) {
    return (
      this.#controllers.get(pageId)?.invalidateViewport({
        kind: "snap_targets",
        pageId,
        targets,
      }) ?? false
    )
  }

  invalidateSelection(selection: Selection | null) {
    for (const [pageId, controller] of this.#controllers) {
      controller.invalidateSelection(
        selection?.pageId === pageId ? selection : null
      )
    }
  }

  invalidatePreview(
    pageId: string,
    invalidation: MultiArtboardPreviewInvalidation
  ) {
    return (
      this.#controllers.get(pageId)?.invalidatePreview(invalidation) ?? false
    )
  }

  invalidateRepaint(pageId?: string) {
    if (pageId) {
      return this.#controllers.get(pageId)?.invalidateRepaint() ?? false
    }
    for (const controller of this.#controllers.values()) {
      controller.invalidateRepaint()
    }
    return this.#controllers.size > 0
  }

  getSnapshot(): MultiArtboardRenderRegistrySnapshot {
    return {
      mountedPageIds: [...this.#controllers.keys()],
      pinnedPageIds: [...this.#pinnedPageIds],
    }
  }
}
