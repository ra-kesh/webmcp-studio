import type { ImageCropSessionCancelResult } from "@webmcp/editor/image-crop-session"

const imageCropInvalidationMessages = {
  document_replaced:
    "Crop was cancelled because the document was replaced. Your last committed image placement is unchanged.",
  page_changed:
    "Crop was cancelled because the active page changed. Your last committed image placement is unchanged.",
  page_removed:
    "Crop was cancelled because its page was removed. No crop changes were applied.",
  target_removed_from_page:
    "Crop was cancelled because the image moved off this page. No crop changes were applied.",
  target_removed:
    "Crop was cancelled because the image was removed. No crop changes were applied.",
  target_replaced:
    "Crop was cancelled because the image layer was replaced. No crop changes were applied.",
  source_changed:
    "Crop was cancelled because the image source changed. Its last committed placement is unchanged.",
  placement_changed:
    "Crop was cancelled because the image placement changed elsewhere. The newer committed placement was kept.",
  frame_changed:
    "Crop was cancelled because the image frame changed elsewhere. The newer committed frame was kept.",
  frame_mask_changed:
    "Crop was cancelled because the image frame shape changed elsewhere. The newer committed frame was kept.",
  target_locked:
    "Crop was cancelled because the image was locked. No crop changes were applied.",
  target_hidden:
    "Crop was cancelled because the image was hidden. No crop changes were applied.",
  user_cancelled: "Crop was cancelled. No crop changes were applied.",
} satisfies Record<ImageCropSessionCancelResult["reason"], string>

export function imageCropInvalidationMessage(
  reason: ImageCropSessionCancelResult["reason"]
) {
  return imageCropInvalidationMessages[reason]
}
