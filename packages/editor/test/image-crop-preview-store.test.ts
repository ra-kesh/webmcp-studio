import {
  documentSchema,
  northstarSeed,
  type Document,
  type ImagePlacement,
  type SceneNode,
} from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"

import {
  createImageCropPreviewStore,
  type ImageCropPreviewFrameScheduler,
} from "../src/image-crop-preview-store"
import {
  applyImageCropSession,
  startImageCropSession,
  type ImageCropSession,
} from "../src/image-crop-session"

type ImageNode = Extract<SceneNode, { type: "image" }>

const imagePlacement: ImagePlacement = {
  mode: "fill",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

const imageNode: ImageNode = {
  id: "image-preview-store",
  type: "image",
  name: "Preview store image",
  x: 40,
  y: 60,
  width: 320,
  height: 180,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: "asset-preview-store",
  src: "https://example.com/preview-store.png",
  placement: imagePlacement,
  frameMask: { shape: "rectangle" },
  alt: "Preview store test image",
  decorative: false,
}

function createDocument(): Document {
  const page = northstarSeed.pages[0]!
  return documentSchema.parse({
    ...northstarSeed,
    pages: northstarSeed.pages.map((candidate) =>
      candidate.id === page.id
        ? { ...candidate, nodeIds: [...candidate.nodeIds, imageNode.id] }
        : candidate
    ),
    nodes: [...northstarSeed.nodes, imageNode],
  })
}

function requireSession(document = createDocument()): ImageCropSession {
  const result = startImageCropSession(
    document,
    document.pages[0]!.id,
    imageNode.id
  )
  if (result.status !== "started") throw new Error(result.reason)
  return result.session
}

function createManualFrameScheduler() {
  let nextFrameId = 1
  const callbacks = new Map<number, () => void>()
  const scheduler: ImageCropPreviewFrameScheduler = {
    request: vi.fn((callback) => {
      const frameId = nextFrameId++
      callbacks.set(frameId, callback)
      return frameId
    }),
    cancel: vi.fn((frameId) => {
      callbacks.delete(frameId)
    }),
  }
  return {
    scheduler,
    flush() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const callback of pending) callback()
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

describe("image crop preview store", () => {
  it("coalesces 50 high-frequency previews into one subscriber notification", () => {
    const session = requireSession()
    const frames = createManualFrameScheduler()
    const store = createImageCropPreviewStore(session, frames.scheduler)
    const listener = vi.fn()
    store.subscribe(listener)

    for (let index = 1; index <= 50; index += 1) {
      expect(
        store.preview(session.target, {
          placement: { mode: "manual", focalX: index / 100 },
        })
      ).toBe("accepted")
    }

    expect(frames.scheduler.request).toHaveBeenCalledTimes(1)
    expect(frames.pendingCount()).toBe(1)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(session)
    expect(store.getLiveSession().draftRevision).toBe(50)
    expect(store.getLiveSession().draft.focalX).toBe(0.5)

    frames.flush()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(store.getLiveSession())
    expect(store.getSnapshot().draftRevision).toBe(50)
  })

  it("applies the latest live draft once even before the queued frame flush", () => {
    const document = createDocument()
    const session = requireSession(document)
    const frames = createManualFrameScheduler()
    const store = createImageCropPreviewStore(session, frames.scheduler)

    for (let index = 1; index <= 50; index += 1) {
      store.preview(session.target, {
        placement: { mode: "manual", zoom: 1 + index / 100 },
      })
    }

    const result = applyImageCropSession(store.getLiveSession(), document)
    expect(result.status).toBe("applied")
    if (result.status !== "applied") throw new Error("Expected apply")
    expect(result.placement.zoom).toBe(1.5)
    expect(result.transaction).toEqual({
      label: "Crop image",
      commands: [
        {
          type: "set_image_placement",
          nodeId: imageNode.id,
          placement: result.placement,
        },
      ],
    })
    expect(result.transaction.commands).toHaveLength(1)
    expect(frames.scheduler.request).toHaveBeenCalledTimes(1)
  })

  it("rejects late events whose immutable target or source is stale", () => {
    const session = requireSession()
    const frames = createManualFrameScheduler()
    const store = createImageCropPreviewStore(session, frames.scheduler)

    expect(
      store.preview(
        {
          ...session.target,
          src: "https://example.com/replacement.png",
        },
        { placement: { zoom: 2 } }
      )
    ).toBe("stale")
    expect(
      store.preview(
        { ...session.target, nodeId: "another-image" },
        { placement: { zoom: 2 } }
      )
    ).toBe("stale")
    expect(store.getLiveSession()).toBe(session)
    expect(frames.scheduler.request).not.toHaveBeenCalled()
  })

  it("cancels pending work and ignores previews after destruction", () => {
    const session = requireSession()
    const frames = createManualFrameScheduler()
    const store = createImageCropPreviewStore(session, frames.scheduler)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    expect(
      store.preview(session.target, {
        placement: { mode: "manual", zoom: 1.2 },
      })
    ).toBe("accepted")
    store.destroy()
    unsubscribe()

    expect(frames.scheduler.cancel).toHaveBeenCalledTimes(1)
    expect(frames.pendingCount()).toBe(0)
    expect(
      store.preview(session.target, {
        placement: { mode: "manual", zoom: 1.4 },
      })
    ).toBe("destroyed")
    frames.flush()
    expect(listener).not.toHaveBeenCalled()
  })
})
