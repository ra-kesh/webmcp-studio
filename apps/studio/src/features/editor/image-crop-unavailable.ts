import type { ImageCropSession } from "@webmcp/editor"

export const IMAGE_CROP_UNAVAILABLE_MESSAGE =
  "Crop mode closed because this image could not be loaded. Replace the image or try again after it finishes loading."

export function resolveUnavailableImageCrop(
  session: ImageCropSession | null,
  nodeId: string
) {
  if (!session || session.target.nodeId !== nodeId) {
    return { handled: false as const, session, error: null }
  }
  return {
    handled: true as const,
    session: null,
    error: IMAGE_CROP_UNAVAILABLE_MESSAGE,
  }
}
