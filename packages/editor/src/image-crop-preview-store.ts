import type { ImageFrameMask, ImagePlacement } from "@webmcp/document"

import {
  previewImageCropDraft,
  type ImageCropFrame,
  type ImageCropSession,
  type ImageCropSessionTarget,
} from "./image-crop-session"

export type ImageCropPreviewPatch = Readonly<{
  placement?: Partial<ImagePlacement>
  frame?: ImageCropFrame
  frameMask?: ImageFrameMask
}>

export type ImageCropPreviewResult =
  "accepted" | "unchanged" | "stale" | "destroyed"

export type ImageCropPreviewFrameScheduler = Readonly<{
  request(callback: () => void): number
  cancel(frameId: number): void
}>

export type ImageCropPreviewStore = Readonly<{
  /** Frame-coalesced snapshot for useSyncExternalStore consumers. */
  getSnapshot(): ImageCropSession
  /** Latest draft, including input received before the next frame flush. */
  getLiveSession(): ImageCropSession
  subscribe(listener: () => void): () => void
  preview(
    target: ImageCropSessionTarget,
    patch: ImageCropPreviewPatch
  ): ImageCropPreviewResult
  destroy(): void
}>

const browserFrameScheduler: ImageCropPreviewFrameScheduler = {
  request(callback) {
    if (typeof globalThis.requestAnimationFrame === "function") {
      return globalThis.requestAnimationFrame(callback)
    }
    // This is the browser scheduler. Node's ambient typings widen the global
    // return value to `NodeJS.Timeout`, while browsers return the numeric handle
    // required by requestAnimationFrame/cancelAnimationFrame parity.
    return globalThis.setTimeout(callback, 16) as unknown as number
  },
  cancel(frameId) {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frameId)
      return
    }
    globalThis.clearTimeout(frameId)
  },
}

export function isSameImageCropSessionTarget(
  left: ImageCropSessionTarget,
  right: ImageCropSessionTarget
) {
  return (
    left.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.nodeId === right.nodeId &&
    left.assetId === right.assetId &&
    left.src === right.src
  )
}

export function createImageCropPreviewStore(
  initialSession: ImageCropSession,
  scheduler: ImageCropPreviewFrameScheduler = browserFrameScheduler
): ImageCropPreviewStore {
  const target = initialSession.target
  const listeners = new Set<() => void>()
  let liveSession = initialSession
  let publishedSession = initialSession
  let pendingFrameId: number | null = null
  let destroyed = false

  const flush = () => {
    pendingFrameId = null
    if (destroyed || publishedSession === liveSession) return
    publishedSession = liveSession
    for (const listener of [...listeners]) listener()
  }

  const scheduleFlush = () => {
    if (pendingFrameId !== null) return
    pendingFrameId = scheduler.request(flush)
  }

  return Object.freeze({
    getSnapshot() {
      return publishedSession
    },
    getLiveSession() {
      return liveSession
    },
    subscribe(listener) {
      if (destroyed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    preview(candidateTarget, patch) {
      if (destroyed) return "destroyed"
      if (!isSameImageCropSessionTarget(target, candidateTarget)) {
        return "stale"
      }

      const next = previewImageCropDraft(liveSession, {
        ...patch,
        placement: patch.placement
          ? { ...liveSession.draft, ...patch.placement }
          : undefined,
      })
      if (next === liveSession) return "unchanged"
      liveSession = next
      scheduleFlush()
      return "accepted"
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      listeners.clear()
      if (pendingFrameId !== null) {
        scheduler.cancel(pendingFrameId)
        pendingFrameId = null
      }
    },
  })
}
