import { applyCommand, documentSchema, northstarSeed } from "@webmcp/document"
import type { Document, ImagePlacement, SceneNode } from "@webmcp/document"
import {
  applyImageCropSession,
  cancelImageCropSession,
  previewImageCropPlacement,
  startImageCropSession,
} from "@webmcp/editor/image-crop-session"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import { registerImageEditSessionContract } from "./image-edit-session.test-contract"
import type {
  ImageEditHistoryCommit,
  ImageEditSessionContractHarness,
} from "./image-edit-session.test-contract"

type ImageNode = Extract<SceneNode, { type: "image" }>

const placement: ImagePlacement = {
  mode: "fill",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

const image: ImageNode = {
  id: "image-1",
  type: "image",
  name: "Contract image",
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
  placement,
  frameMask: { shape: "rectangle" },
  alt: "Contract test image",
  decorative: false,
}

const createDocument = (): Document => {
  const page = northstarSeed.pages[0]
  return documentSchema.parse({
    ...northstarSeed,
    pages: northstarSeed.pages.map((candidate) =>
      candidate.id === page.id
        ? { ...candidate, nodeIds: [...candidate.nodeIds, image.id] }
        : candidate
    ),
    nodes: [...northstarSeed.nodes, image],
  })
}

const clampFocal = (value: number) => Math.min(1, Math.max(0, value))

const createHarness = (): ImageEditSessionContractHarness => {
  let document = createDocument()
  const pageId = document.pages[0].id
  let session: ImageCropSession | null = null
  let historyCommits: ImageEditHistoryCommit[] = []
  const cameraZoomRequests: number[] = []
  const contentScaleRequests: number[] = []

  return {
    doubleClickImage(nodeId) {
      const result = startImageCropSession(document, pageId, nodeId)
      if (result.status !== "started") {
        throw new Error(`Crop entry failed: ${result.reason}`)
      }
      session = result.session
    },
    moveDraftContent(delta) {
      if (!session) throw new Error("Crop session is not active")
      session = previewImageCropPlacement(session, {
        mode: "manual",
        focalX: clampFocal(session.draft.focalX + delta.x / 100),
        focalY: clampFocal(session.draft.focalY + delta.y / 100),
      })
    },
    completeCrop() {
      if (!session) throw new Error("Crop session is not active")
      const result = applyImageCropSession(session, document, pageId)
      session = null
      if (result.status !== "applied") return
      const command = {
        ...result.transaction.commands[0],
        id: "crop-image-contract",
        actor: "human" as const,
        at: "2026-08-28T12:00:00.000Z",
      }
      if (command.type !== "set_image_placement") {
        throw new Error("Expected a placement-only crop transaction")
      }
      document = applyCommand(document, command)
      historyCommits = [
        ...historyCommits,
        { label: result.transaction.label, patch: command.placement },
      ]
    },
    cancelCrop() {
      if (!session) throw new Error("Crop session is not active")
      cancelImageCropSession(session)
      session = null
    },
    pinchCamera(scale) {
      cameraZoomRequests.push(scale)
    },
    setContentScale(scale) {
      if (!session) throw new Error("Crop session is not active")
      contentScaleRequests.push(scale)
      session = previewImageCropPlacement(session, {
        mode: "manual",
        zoom: scale,
      })
    },
    snapshot() {
      return {
        cropTargetId: session?.target.nodeId ?? null,
        draftRevision: session?.draftRevision ?? 0,
        documentRevision: document.revision,
        historyCommits,
        cameraZoomRequests,
        contentScaleRequests,
      }
    },
  }
}

registerImageEditSessionContract(createHarness)
