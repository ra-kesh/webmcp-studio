import { projectImageCropFrameToLocalBounds } from "@webmcp/editor"
import type { NodeGeometryPatch } from "@webmcp/editor"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"

export type NumericImageCropFramePreview = Readonly<{
  nodeId: string
  frame: ImageCropSession["draftFrame"]
  placement: ImageCropSession["draft"]
  frameMask: ImageCropSession["draftFrameMask"]
}>

export function projectNumericImageCropFrameEdit({
  session,
  naturalSize,
  patch,
}: Readonly<{
  session: ImageCropSession
  naturalSize: Readonly<{ width: number; height: number }> | null
  patch: Partial<NodeGeometryPatch>
}>): NumericImageCropFramePreview {
  const nextFrame = { ...session.draftFrame, ...patch }
  if (patch.width === undefined && patch.height === undefined) {
    return {
      nodeId: session.target.nodeId,
      frame: nextFrame,
      placement: session.draft,
      frameMask: session.draftFrameMask,
    }
  }
  if (!naturalSize) {
    throw new RangeError(
      "Verified natural image dimensions are required to resize its crop frame."
    )
  }
  return {
    nodeId: session.target.nodeId,
    ...projectImageCropFrameToLocalBounds({
      frame: session.draftFrame,
      naturalSize,
      placement: session.draft,
      frameMask: session.draftFrameMask,
      localBounds: {
        left: 0,
        top: 0,
        right: nextFrame.width,
        bottom: nextFrame.height,
      },
    }),
  }
}
