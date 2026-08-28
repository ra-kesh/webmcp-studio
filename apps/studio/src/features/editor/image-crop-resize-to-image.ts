import { projectResizeImageFrameToImage } from "@webmcp/editor"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import type { ImageCropFramePreview } from "./image-crop-frame-overlay"

export function projectResizeFrameToImagePreview(
  session: ImageCropSession,
  naturalSize: Readonly<{ width: number; height: number }>
): ImageCropFramePreview {
  return {
    nodeId: session.target.nodeId,
    ...projectResizeImageFrameToImage({
      frame: session.draftFrame,
      naturalSize,
      placement: session.draft,
      frameMask: session.draftFrameMask,
    }),
  }
}

const sameFrame = (
  left: ImageCropSession["draftFrame"],
  right: ImageCropSession["draftFrame"]
) =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height &&
  left.rotation === right.rotation

const samePlacement = (
  left: ImageCropSession["draft"],
  right: ImageCropSession["draft"]
) =>
  left.mode === right.mode &&
  left.focalX === right.focalX &&
  left.focalY === right.focalY &&
  left.zoom === right.zoom &&
  left.rotation === right.rotation &&
  left.flipX === right.flipX &&
  left.flipY === right.flipY

export function resolveResizeFrameToImagePreview(
  session: ImageCropSession,
  naturalSize: Readonly<{ width: number; height: number }>
) {
  try {
    const preview = projectResizeFrameToImagePreview(session, naturalSize)
    return sameFrame(preview.frame, session.draftFrame) &&
      samePlacement(preview.placement, session.draft)
      ? null
      : preview
  } catch {
    return null
  }
}
