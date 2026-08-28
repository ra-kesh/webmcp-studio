import {
  imageFrameMaskSchema,
  imagePlacementSchema,
  type Document,
  type ImageFrameMask,
  type ImagePlacement,
} from "@webmcp/document"

export type ImageCropSessionTarget = Readonly<{
  documentId: string
  pageId: string
  nodeId: string
  assetId: string
  src: string
}>

export type ImageCropSession = Readonly<{
  target: ImageCropSessionTarget
  baseline: Readonly<ImagePlacement>
  draft: Readonly<ImagePlacement>
  baselineFrame: ImageCropFrame
  draftFrame: ImageCropFrame
  baselineFrameMask: Readonly<ImageFrameMask>
  draftFrameMask: Readonly<ImageFrameMask>
  draftRevision: number
}>

export type ImageCropFrame = Readonly<{
  x: number
  y: number
  width: number
  height: number
  rotation: number
}>

export type ImageCropSessionStartRejection =
  | "page_missing"
  | "target_not_on_page"
  | "target_missing"
  | "target_not_image"
  | "target_locked"
  | "target_hidden"

export type ImageCropSessionStartResult =
  | { status: "started"; session: ImageCropSession }
  | { status: "rejected"; reason: ImageCropSessionStartRejection }

export type ImageCropSessionInvalidation =
  | "document_replaced"
  | "page_changed"
  | "page_removed"
  | "target_removed_from_page"
  | "target_removed"
  | "target_replaced"
  | "source_changed"
  | "placement_changed"
  | "frame_changed"
  | "frame_mask_changed"
  | "target_locked"
  | "target_hidden"

export type ImageCropPlacementCommandDraft = {
  type: "set_image_placement"
  nodeId: string
  placement: ImagePlacement
}

export type ImageCropFrameCommandDraft = {
  type: "update_node"
  nodeId: string
  patch: ImageCropFrame
}

export type ImageCropFrameMaskCommandDraft = {
  type: "set_image_frame_mask"
  nodeId: string
  frameMask: ImageFrameMask
}

export type ImageCropCommandDraft =
  | ImageCropPlacementCommandDraft
  | ImageCropFrameCommandDraft
  | ImageCropFrameMaskCommandDraft

export type ImageCropTransaction = Readonly<{
  label: "Crop image"
  commands: readonly ImageCropCommandDraft[]
}>

export type ImageCropSessionApplyResult =
  | {
      status: "applied"
      placement: Readonly<ImagePlacement>
      frame: ImageCropFrame
      frameMask: Readonly<ImageFrameMask>
      transaction: ImageCropTransaction
    }
  | {
      status: "unchanged"
      placement: Readonly<ImagePlacement>
      frame: ImageCropFrame
      frameMask: Readonly<ImageFrameMask>
      transaction: null
    }
  | {
      status: "cancelled"
      reason: ImageCropSessionInvalidation
      placement: Readonly<ImagePlacement>
      frame: ImageCropFrame
      frameMask: Readonly<ImageFrameMask>
      transaction: null
    }

export type ImageCropSessionCancelResult = {
  status: "cancelled"
  reason: "user_cancelled" | ImageCropSessionInvalidation
  placement: Readonly<ImagePlacement>
  frame: ImageCropFrame
  frameMask: Readonly<ImageFrameMask>
  transaction: null
}

const freezePlacement = (placement: ImagePlacement) =>
  Object.freeze({ ...placement })

const freezeFrame = (frame: ImageCropFrame) => {
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.rotation) ||
    !Number.isFinite(frame.width) ||
    frame.width <= 0 ||
    !Number.isFinite(frame.height) ||
    frame.height <= 0
  ) {
    throw new RangeError("Image crop frame must have finite positive geometry.")
  }
  return Object.freeze({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    rotation: frame.rotation,
  })
}

const freezeFrameMask = (frameMask: ImageFrameMask) =>
  Object.freeze(imageFrameMaskSchema.parse(frameMask))

const samePlacement = (
  left: Readonly<ImagePlacement>,
  right: Readonly<ImagePlacement>
) =>
  left.mode === right.mode &&
  left.focalX === right.focalX &&
  left.focalY === right.focalY &&
  left.zoom === right.zoom &&
  left.rotation === right.rotation &&
  left.flipX === right.flipX &&
  left.flipY === right.flipY

const sameFrame = (left: ImageCropFrame, right: ImageCropFrame) =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height &&
  left.rotation === right.rotation

const sameFrameMask = (
  left: Readonly<ImageFrameMask>,
  right: Readonly<ImageFrameMask>
) => JSON.stringify(left) === JSON.stringify(right)

export const imageCropSessionHasChanges = (session: ImageCropSession) =>
  !samePlacement(session.baseline, session.draft) ||
  !sameFrame(session.baselineFrame, session.draftFrame) ||
  !sameFrameMask(session.baselineFrameMask, session.draftFrameMask)

const findNode = (document: Document, nodeId: string) =>
  document.nodes.find((candidate) => candidate.id === nodeId)

export function startImageCropSession(
  document: Document,
  pageId: string,
  nodeId: string
): ImageCropSessionStartResult {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return { status: "rejected", reason: "page_missing" }
  if (!page.nodeIds.includes(nodeId)) {
    return { status: "rejected", reason: "target_not_on_page" }
  }

  const node = findNode(document, nodeId)
  if (!node) return { status: "rejected", reason: "target_missing" }
  if (node.type !== "image") {
    return { status: "rejected", reason: "target_not_image" }
  }
  if (node.locked) return { status: "rejected", reason: "target_locked" }
  if (!node.visible) return { status: "rejected", reason: "target_hidden" }

  const baseline = freezePlacement(node.placement)
  const baselineFrame = freezeFrame(node)
  const baselineFrameMask = freezeFrameMask(node.frameMask)
  return {
    status: "started",
    session: Object.freeze({
      target: Object.freeze({
        documentId: document.id,
        pageId,
        nodeId,
        assetId: node.assetId,
        src: node.src,
      }),
      baseline,
      draft: baseline,
      baselineFrame,
      draftFrame: baselineFrame,
      baselineFrameMask,
      draftFrameMask: baselineFrameMask,
      draftRevision: 0,
    }),
  }
}

export function previewImageCropDraft(
  session: ImageCropSession,
  patch: Readonly<{
    placement?: ImagePlacement
    frame?: ImageCropFrame
    frameMask?: ImageFrameMask
  }>
): ImageCropSession {
  const draft = patch.placement
    ? freezePlacement(imagePlacementSchema.parse(patch.placement))
    : session.draft
  const draftFrame = patch.frame ? freezeFrame(patch.frame) : session.draftFrame
  const draftFrameMask = patch.frameMask
    ? freezeFrameMask(patch.frameMask)
    : session.draftFrameMask
  if (
    samePlacement(session.draft, draft) &&
    sameFrame(session.draftFrame, draftFrame) &&
    sameFrameMask(session.draftFrameMask, draftFrameMask)
  ) {
    return session
  }
  return Object.freeze({
    ...session,
    draft,
    draftFrame,
    draftFrameMask,
    draftRevision: session.draftRevision + 1,
  })
}

export function previewImageCropPlacement(
  session: ImageCropSession,
  patch: Partial<ImagePlacement>
): ImageCropSession {
  const placement = freezePlacement(
    imagePlacementSchema.parse({ ...session.draft, ...patch })
  )
  return previewImageCropDraft(session, {
    placement,
  })
}

export function imageCropSessionInvalidation(
  session: ImageCropSession,
  document: Document,
  activePageId = session.target.pageId
): ImageCropSessionInvalidation | null {
  if (document.id !== session.target.documentId) return "document_replaced"
  if (activePageId !== session.target.pageId) return "page_changed"

  const page = document.pages.find(
    (candidate) => candidate.id === session.target.pageId
  )
  if (!page) return "page_removed"
  if (!page.nodeIds.includes(session.target.nodeId)) {
    return "target_removed_from_page"
  }

  const node = findNode(document, session.target.nodeId)
  if (!node) return "target_removed"
  if (node.type !== "image") return "target_replaced"
  if (
    node.assetId !== session.target.assetId ||
    node.src !== session.target.src
  ) {
    return "source_changed"
  }
  if (!samePlacement(node.placement, session.baseline)) {
    return "placement_changed"
  }
  if (!sameFrame(node, session.baselineFrame)) return "frame_changed"
  if (!sameFrameMask(node.frameMask, session.baselineFrameMask)) {
    return "frame_mask_changed"
  }
  if (node.locked) return "target_locked"
  if (!node.visible) return "target_hidden"
  return null
}

export function applyImageCropSession(
  session: ImageCropSession,
  document: Document,
  activePageId = session.target.pageId
): ImageCropSessionApplyResult {
  const invalidation = imageCropSessionInvalidation(
    session,
    document,
    activePageId
  )
  if (invalidation) {
    return {
      status: "cancelled",
      reason: invalidation,
      placement: session.baseline,
      frame: session.baselineFrame,
      frameMask: session.baselineFrameMask,
      transaction: null,
    }
  }
  if (!imageCropSessionHasChanges(session)) {
    return {
      status: "unchanged",
      placement: session.baseline,
      frame: session.baselineFrame,
      frameMask: session.baselineFrameMask,
      transaction: null,
    }
  }

  const placement = freezePlacement(imagePlacementSchema.parse(session.draft))
  const frame = freezeFrame(session.draftFrame)
  const frameMask = freezeFrameMask(session.draftFrameMask)
  const commands: ImageCropCommandDraft[] = []
  if (!sameFrame(session.baselineFrame, frame)) {
    commands.push({
      type: "update_node",
      nodeId: session.target.nodeId,
      patch: { ...frame },
    })
  }
  if (!samePlacement(session.baseline, placement)) {
    commands.push({
      type: "set_image_placement",
      nodeId: session.target.nodeId,
      placement: { ...placement },
    })
  }
  if (!sameFrameMask(session.baselineFrameMask, frameMask)) {
    commands.push({
      type: "set_image_frame_mask",
      nodeId: session.target.nodeId,
      frameMask: { ...frameMask },
    })
  }
  return {
    status: "applied",
    placement,
    frame,
    frameMask,
    transaction: Object.freeze({
      label: "Crop image",
      commands: Object.freeze(commands),
    }),
  }
}

export function cancelImageCropSession(
  session: ImageCropSession,
  reason: ImageCropSessionCancelResult["reason"] = "user_cancelled"
): ImageCropSessionCancelResult {
  return {
    status: "cancelled",
    reason,
    placement: session.baseline,
    frame: session.baselineFrame,
    frameMask: session.baselineFrameMask,
    transaction: null,
  }
}

export function reconcileImageCropSession(
  session: ImageCropSession,
  document: Document,
  activePageId = session.target.pageId
):
  | { status: "active"; session: ImageCropSession }
  | ImageCropSessionCancelResult {
  const invalidation = imageCropSessionInvalidation(
    session,
    document,
    activePageId
  )
  return invalidation
    ? cancelImageCropSession(session, invalidation)
    : { status: "active", session }
}
