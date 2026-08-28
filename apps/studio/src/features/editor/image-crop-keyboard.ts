export type ImageCropArrowKey =
  "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"

/**
 * Crop nudges are defined in screen pixels, not document units or focal
 * percentages. The canvas adapter removes camera zoom and frame rotation.
 */
export function imageCropKeyboardScreenDelta(
  key: ImageCropArrowKey,
  coarse: boolean
) {
  const distance = coarse ? 10 : 1
  return {
    x: key === "ArrowLeft" ? -distance : key === "ArrowRight" ? distance : 0,
    y: key === "ArrowUp" ? -distance : key === "ArrowDown" ? distance : 0,
  }
}
