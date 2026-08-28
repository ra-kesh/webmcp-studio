export type ImageCropToolbarEdge = "top" | "bottom"

export type ImageCropToolbarPlacementInput = Readonly<{
  frameTop: number
  frameBottom: number
  viewportHeight: number
  toolbarHeight?: number
  topInset?: number
  bottomInset?: number
  gap?: number
}>

export function resolveImageCropToolbarEdge({
  frameTop,
  frameBottom,
  viewportHeight,
  toolbarHeight = 112,
  topInset = 8,
  bottomInset = 140,
  gap = 16,
}: ImageCropToolbarPlacementInput): ImageCropToolbarEdge {
  if (
    !Number.isFinite(frameTop) ||
    !Number.isFinite(frameBottom) ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return "bottom"
  }

  const bottomToolbarTop = viewportHeight - bottomInset - toolbarHeight
  const bottomToolbarBottom = viewportHeight - bottomInset
  const overlapsBottom =
    frameBottom + gap > bottomToolbarTop && frameTop - gap < bottomToolbarBottom
  const fitsAboveFrame = topInset + toolbarHeight + gap <= frameTop

  return overlapsBottom && fitsAboveFrame ? "top" : "bottom"
}
