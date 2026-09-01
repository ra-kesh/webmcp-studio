import { useEffect, useState } from "react"
import type { Document, SceneNode } from "@webmcp/document"
import {
  cancelImageCropSession,
  createImageCropPreviewStore,
  reconcileImageCropSession,
} from "@webmcp/editor"
import type { ImageCropPreviewStore, ImageCropSession } from "@webmcp/editor"
import { imageCropInvalidationMessage } from "./image-crop-invalidation"
import { resolveUnavailableImageCrop } from "./image-crop-unavailable"

export type ImageCropFramePreviewDraft = Readonly<{
  nodeId: string
  frame: ImageCropSession["draftFrame"]
  placement: ImageCropSession["draft"]
  frameMask: ImageCropSession["draftFrameMask"]
}>

type ImageCropPreviewPatch = Readonly<{
  placement?: Partial<Extract<SceneNode, { type: "image" }>["placement"]>
  frame?: ImageCropSession["draftFrame"]
  frameMask?: ImageCropSession["draftFrameMask"]
}>

export class ImageCropSessionController {
  readonly #onStoreChange: (store: ImageCropPreviewStore | null) => void
  #store: ImageCropPreviewStore | null = null
  #session: ImageCropSession | null = null

  constructor(onStoreChange: (store: ImageCropPreviewStore | null) => void) {
    this.#onStoreChange = onStoreChange
  }

  get previewStore() {
    return this.#store
  }

  get currentSession() {
    return this.#session
  }

  get hasActiveSession() {
    return this.#session !== null
  }

  open(session: ImageCropSession) {
    this.#store?.destroy()
    this.#store = createImageCropPreviewStore(session)
    this.#session = session
    this.#onStoreChange(this.#store)
  }

  close() {
    this.#store?.destroy()
    this.#store = null
    this.#session = null
    this.#onStoreChange(null)
  }

  destroy() {
    this.#store?.destroy()
    this.#store = null
    this.#session = null
  }

  preview(nodeId: string, patch: ImageCropPreviewPatch) {
    const session = this.#session
    const store = this.#store
    if (!session || !store || session.target.nodeId !== nodeId) return false
    const result = store.preview(session.target, patch)
    if (result !== "accepted" && result !== "unchanged") return false
    this.#session = store.getLiveSession()
    return true
  }

  reconcile(document: Document, activePageId: string) {
    const session = this.#session
    if (!session) return null
    const result = reconcileImageCropSession(session, document, activePageId)
    if (result.status === "active") return null
    this.close()
    return imageCropInvalidationMessage(result.reason)
  }

  rejectUnavailable(nodeId: string) {
    const session = this.#session
    const resolution = resolveUnavailableImageCrop(session, nodeId)
    if (!resolution.handled || !session) return null
    cancelImageCropSession(session)
    this.close()
    return resolution.error
  }
}

export function useImageCropSessionController() {
  const [previewStore, setPreviewStore] =
    useState<ImageCropPreviewStore | null>(null)
  const [controller] = useState(
    () => new ImageCropSessionController(setPreviewStore)
  )

  useEffect(() => () => controller.destroy(), [controller])

  return {
    controller,
    previewStore,
    session: previewStore?.getSnapshot() ?? null,
  }
}
