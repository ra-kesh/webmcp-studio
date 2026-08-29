export type SelectedImageToolbarPlacement =
  | Readonly<{
      mode: "overlay"
      edge: "top" | "bottom"
      top: number
      left: number
      width: number
    }>
  | Readonly<{ mode: "docked"; edge: "top" }>

export type SelectedImageToolbarPlacementInput = Readonly<{
  frameTop: number
  frameBottom: number
  frameLeft: number
  frameRight: number
  viewportWidth: number
  viewportHeight: number
  toolbarWidth?: number
  toolbarHeight?: number
  sideInset?: number
  topInset?: number
  bottomInset?: number
  gap?: number
}>

export type SelectedImageToolbarCameraProjectionInput = Readonly<{
  bounds: Readonly<{
    left: number
    right: number
    top: number
    bottom: number
  }>
  camera: Readonly<{ x: number; y: number; zoom: number }>
  viewport: Readonly<{ width: number; height: number }>
}>

type SelectedImageToolbarStyleTarget = {
  hidden: boolean | string
  style: {
    top: string
    left: string
    width: string
  }
}

export const SELECTED_IMAGE_TOOLBAR_HEIGHT = 48
export const SELECTED_IMAGE_TOOLBAR_WIDTH = 480
export const PAGE_FILMSTRIP_HEIGHT = 88
export const CAMERA_BAR_SECTION_BOTTOM = 100
export const CAMERA_BAR_COMPACT_HEIGHT = 48
export const CONTEXT_BAR_CAMERA_GAP = 8
export const SELECTED_IMAGE_TOOLBAR_BOTTOM_INSET =
  CAMERA_BAR_SECTION_BOTTOM -
  PAGE_FILMSTRIP_HEIGHT +
  CAMERA_BAR_COMPACT_HEIGHT +
  CONTEXT_BAR_CAMERA_GAP

export function resolveSelectedImageToolbarPlacement({
  frameTop,
  frameBottom,
  frameLeft,
  frameRight,
  viewportWidth,
  viewportHeight,
  toolbarWidth = SELECTED_IMAGE_TOOLBAR_WIDTH,
  toolbarHeight = SELECTED_IMAGE_TOOLBAR_HEIGHT,
  sideInset = 8,
  topInset = 8,
  bottomInset = SELECTED_IMAGE_TOOLBAR_BOTTOM_INSET,
  gap = 12,
}: SelectedImageToolbarPlacementInput): SelectedImageToolbarPlacement {
  if (
    !Number.isFinite(frameTop) ||
    !Number.isFinite(frameBottom) ||
    !Number.isFinite(frameLeft) ||
    !Number.isFinite(frameRight) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= sideInset * 2 ||
    viewportHeight <= topInset + bottomInset + toolbarHeight
  ) {
    return { mode: "docked", edge: "top" }
  }

  const visibleTop = Math.min(frameTop, frameBottom)
  const visibleBottom = Math.max(frameTop, frameBottom)
  const visibleLeft = Math.min(frameLeft, frameRight)
  const visibleRight = Math.max(frameLeft, frameRight)
  const width = Math.min(toolbarWidth, viewportWidth - sideInset * 2)
  const desiredLeft = (visibleLeft + visibleRight - width) / 2
  const left = Math.min(
    Math.max(desiredLeft, sideInset),
    viewportWidth - sideInset - width
  )
  const top = visibleTop - gap - toolbarHeight
  const bottom = visibleBottom + gap
  const topFits = top >= topInset
  const bottomFits = bottom + toolbarHeight <= viewportHeight - bottomInset

  if (!topFits && !bottomFits) return { mode: "docked", edge: "top" }
  if (topFits && !bottomFits) {
    return { mode: "overlay", edge: "top", top, left, width }
  }
  if (!topFits && bottomFits) {
    return { mode: "overlay", edge: "bottom", top: bottom, left, width }
  }

  const topClearance = visibleTop - topInset
  const bottomClearance = viewportHeight - bottomInset - visibleBottom
  return topClearance >= bottomClearance
    ? { mode: "overlay", edge: "top", top, left, width }
    : { mode: "overlay", edge: "bottom", top: bottom, left, width }
}

export function projectSelectedImageToolbarForCamera({
  bounds,
  camera,
  viewport,
}: SelectedImageToolbarCameraProjectionInput) {
  return resolveSelectedImageToolbarPlacement({
    frameLeft: camera.x + bounds.left * camera.zoom,
    frameRight: camera.x + bounds.right * camera.zoom,
    frameTop: camera.y + bounds.top * camera.zoom,
    frameBottom: camera.y + bounds.bottom * camera.zoom,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  })
}

export function applySelectedImageToolbarCameraProjection(
  target: SelectedImageToolbarStyleTarget,
  input: SelectedImageToolbarCameraProjectionInput
) {
  const placement = projectSelectedImageToolbarForCamera(input)
  target.hidden = placement.mode !== "overlay"
  if (placement.mode === "overlay") {
    target.style.top = `${placement.top}px`
    target.style.left = `${placement.left}px`
    target.style.width = `${placement.width}px`
  }
  return placement
}
