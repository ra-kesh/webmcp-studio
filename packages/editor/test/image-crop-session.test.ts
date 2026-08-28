import {
  applyCommand,
  documentSchema,
  northstarSeed,
  type Document,
  type ImagePlacement,
  type SceneNode,
} from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  applyImageCropSession,
  cancelImageCropSession,
  imageCropSessionHasChanges,
  imageCropSessionInvalidation,
  previewImageCropDraft,
  previewImageCropPlacement,
  reconcileImageCropSession,
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
  id: "image-1",
  type: "image",
  name: "Session image",
  x: 40,
  y: 60,
  width: 320,
  height: 180,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: "asset-image-1",
  src: "https://example.com/image-1.png",
  placement: imagePlacement,
  frameMask: { shape: "rectangle" },
  alt: "Session test image",
  decorative: false,
}

const createDocument = (): Document => {
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

const updateImage = (
  document: Document,
  patch: Partial<ImageNode>
): Document => ({
  ...document,
  nodes: document.nodes.map((node) =>
    node.id === imageNode.id ? ({ ...node, ...patch } as ImageNode) : node
  ),
})

const requireSession = (document = createDocument()) => {
  const pageId = document.pages[0]!.id
  const result = startImageCropSession(document, pageId, imageNode.id)
  if (result.status !== "started") {
    throw new Error(`Expected crop session, received ${result.reason}`)
  }
  return result.session
}

describe("image crop session", () => {
  it("captures immutable target identity, placement, frame, and mask", () => {
    const document = createDocument()
    const session = requireSession(document)

    expect(session.target).toEqual({
      documentId: document.id,
      pageId: document.pages[0]!.id,
      nodeId: imageNode.id,
      assetId: imageNode.assetId,
      src: imageNode.src,
    })
    expect(session.baseline).toEqual(imagePlacement)
    expect(session.draft).toBe(session.baseline)
    expect(session.baselineFrame).toEqual({
      x: imageNode.x,
      y: imageNode.y,
      width: imageNode.width,
      height: imageNode.height,
      rotation: imageNode.rotation,
    })
    expect(session.draftFrame).toBe(session.baselineFrame)
    expect(session.baselineFrameMask).toEqual(imageNode.frameMask)
    expect(session.draftFrameMask).toBe(session.baselineFrameMask)
    expect(session.draftRevision).toBe(0)
    expect(Object.isFrozen(session)).toBe(true)
    expect(Object.isFrozen(session.target)).toBe(true)
    expect(Object.isFrozen(session.baseline)).toBe(true)
    expect(Object.isFrozen(session.baselineFrame)).toBe(true)
    expect(Object.isFrozen(session.baselineFrameMask)).toBe(true)
  })

  it("rejects targets that cannot enter crop", () => {
    const document = createDocument()
    const pageId = document.pages[0]!.id
    const textNode = document.nodes.find((node) => node.type === "text")!

    expect(
      startImageCropSession(document, "missing-page", imageNode.id)
    ).toEqual({ status: "rejected", reason: "page_missing" })
    expect(startImageCropSession(document, pageId, "missing-node")).toEqual({
      status: "rejected",
      reason: "target_not_on_page",
    })
    expect(startImageCropSession(document, pageId, textNode.id)).toEqual({
      status: "rejected",
      reason: "target_not_image",
    })
    expect(
      startImageCropSession(
        updateImage(document, { locked: true }),
        pageId,
        imageNode.id
      )
    ).toEqual({ status: "rejected", reason: "target_locked" })
  })

  it("updates only the immutable draft during preview", () => {
    const session = requireSession()
    const moved = previewImageCropPlacement(session, {
      mode: "manual",
      focalX: 0.7,
      focalY: 0.2,
    })
    const scaled = previewImageCropPlacement(moved, { zoom: 1.4 })

    expect(session.draft).toEqual(imagePlacement)
    expect(moved.baseline).toBe(session.baseline)
    expect(moved.draft).toMatchObject({
      mode: "manual",
      focalX: 0.7,
      focalY: 0.2,
      zoom: 1,
    })
    expect(scaled.draft.zoom).toBe(1.4)
    expect(scaled.draftRevision).toBe(2)
    expect(previewImageCropPlacement(scaled, { zoom: 1.4 })).toBe(scaled)
    expect(imageCropSessionHasChanges(scaled)).toBe(true)

    const restored = previewImageCropPlacement(scaled, imagePlacement)
    expect(restored.draftRevision).toBe(3)
    expect(imageCropSessionHasChanges(restored)).toBe(false)
  })

  it("returns one named placement command when applying a changed draft", () => {
    const document = createDocument()
    const session = previewImageCropPlacement(requireSession(document), {
      mode: "manual",
      focalX: 0.65,
      zoom: 1.25,
    })

    const result = applyImageCropSession(session, document)

    expect(result.status).toBe("applied")
    if (result.status !== "applied") throw new Error("Expected apply")
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

    const updated = applyCommand(document, {
      ...result.transaction.commands[0],
      id: "crop-image-1",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
    })
    const updatedImage = updated.nodes.find(
      (node): node is ImageNode =>
        node.id === imageNode.id && node.type === "image"
    )!
    expect(updatedImage.placement).toEqual(result.placement)
    expect(updated.revision).toBe(document.revision + 1)
  })

  it("returns one ordered transaction for frame, placement, and mask drafts", () => {
    const document = createDocument()
    const baseline = requireSession(document)
    const session = previewImageCropDraft(baseline, {
      frame: {
        ...baseline.draftFrame,
        x: 24,
        y: 32,
        width: 420,
        height: 240,
      },
      placement: {
        ...baseline.draft,
        mode: "manual",
        focalX: 0.25,
        zoom: 1.6,
      },
      frameMask: { shape: "rounded_rectangle", radius: 0.18 },
    })

    const result = applyImageCropSession(session, document)
    expect(result.status).toBe("applied")
    if (result.status !== "applied") throw new Error("Expected apply")
    expect(result.transaction).toEqual({
      label: "Crop image",
      commands: [
        {
          type: "update_node",
          nodeId: imageNode.id,
          patch: result.frame,
        },
        {
          type: "set_image_placement",
          nodeId: imageNode.id,
          placement: result.placement,
        },
        {
          type: "set_image_frame_mask",
          nodeId: imageNode.id,
          frameMask: result.frameMask,
        },
      ],
    })
    expect(session.baselineFrame).toEqual({
      x: imageNode.x,
      y: imageNode.y,
      width: imageNode.width,
      height: imageNode.height,
      rotation: imageNode.rotation,
    })
    expect(session.baselineFrameMask).toEqual(imageNode.frameMask)
  })

  it("returns no transaction for unchanged apply or cancellation", () => {
    const document = createDocument()
    const session = requireSession(document)

    expect(applyImageCropSession(session, document)).toEqual({
      status: "unchanged",
      placement: session.baseline,
      frame: session.baselineFrame,
      frameMask: session.baselineFrameMask,
      transaction: null,
    })
    expect(cancelImageCropSession(session)).toEqual({
      status: "cancelled",
      reason: "user_cancelled",
      placement: session.baseline,
      frame: session.baselineFrame,
      frameMask: session.baselineFrameMask,
      transaction: null,
    })
  })

  it("cancels when target identity or canonical placement becomes stale", () => {
    const document = createDocument()
    const session = requireSession(document)
    const changedPlacement = {
      ...imagePlacement,
      focalX: 0.75,
    }

    const staleCases: Array<{
      reason: ReturnType<typeof imageCropSessionInvalidation>
      document: Document
      activePageId?: string
    }> = [
      {
        reason: "document_replaced",
        document: { ...document, id: "replacement-document" },
      },
      {
        reason: "page_changed",
        document,
        activePageId: "another-page",
      },
      {
        reason: "source_changed",
        document: updateImage(document, {
          src: "https://example.com/replacement.png",
        }),
      },
      {
        reason: "placement_changed",
        document: updateImage(document, { placement: changedPlacement }),
      },
      {
        reason: "frame_changed",
        document: updateImage(document, { width: imageNode.width + 10 }),
      },
      {
        reason: "frame_mask_changed",
        document: updateImage(document, { frameMask: { shape: "ellipse" } }),
      },
      {
        reason: "target_locked",
        document: updateImage(document, { locked: true }),
      },
    ]

    for (const stale of staleCases) {
      expect(
        imageCropSessionInvalidation(
          session,
          stale.document,
          stale.activePageId
        )
      ).toBe(stale.reason)
      expect(
        applyImageCropSession(session, stale.document, stale.activePageId)
      ).toMatchObject({
        status: "cancelled",
        reason: stale.reason,
        placement: session.baseline,
        transaction: null,
      })
    }
  })

  it("reconciles a valid session and cancels an invalid one", () => {
    const document = createDocument()
    const session: ImageCropSession = requireSession(document)

    expect(reconcileImageCropSession(session, document)).toEqual({
      status: "active",
      session,
    })
    expect(
      reconcileImageCropSession(
        session,
        updateImage(document, { visible: false })
      )
    ).toEqual({
      status: "cancelled",
      reason: "target_hidden",
      placement: session.baseline,
      frame: session.baselineFrame,
      frameMask: session.baselineFrameMask,
      transaction: null,
    })
  })
})
