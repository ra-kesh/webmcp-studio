import type { NodeBounds } from "./geometry"

export type CanvasCamera = {
  x: number
  y: number
  zoom: number
}

export type ViewportSize = {
  width: number
  height: number
}

export type Point = {
  x: number
  y: number
}

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 4

export function clampCanvasZoom(
  value: number,
  min = MIN_CANVAS_ZOOM,
  max = MAX_CANVAS_ZOOM
) {
  return Math.min(max, Math.max(min, value))
}

export function fitPageInViewport(
  page: { width: number; height: number },
  viewport: ViewportSize,
  options: { padding?: number; maxZoom?: number } = {}
): CanvasCamera {
  const padding = options.padding ?? 112
  const zoom = clampCanvasZoom(
    Math.min(
      (viewport.width - padding) / page.width,
      (viewport.height - padding) / page.height,
      options.maxZoom ?? 1
    )
  )
  return {
    x: (viewport.width - page.width * zoom) / 2,
    y: (viewport.height - page.height * zoom) / 2,
    zoom,
  }
}

export function zoomCameraAtPoint(
  camera: CanvasCamera,
  requestedZoom: number,
  anchor: Point
): CanvasCamera {
  const zoom = clampCanvasZoom(requestedZoom)
  const pageX = (anchor.x - camera.x) / camera.zoom
  const pageY = (anchor.y - camera.y) / camera.zoom
  return {
    x: anchor.x - pageX * zoom,
    y: anchor.y - pageY * zoom,
    zoom,
  }
}

export function focusCameraOnBounds(
  bounds: NodeBounds,
  viewport: ViewportSize,
  options: { padding?: number; maxZoom?: number } = {}
): CanvasCamera {
  const padding = options.padding ?? 160
  const zoom = clampCanvasZoom(
    Math.min(
      (viewport.width - padding) / Math.max(bounds.width, 1),
      (viewport.height - padding) / Math.max(bounds.height, 1),
      options.maxZoom ?? 2
    )
  )
  return {
    x: viewport.width / 2 - bounds.centerX * zoom,
    y: viewport.height / 2 - bounds.centerY * zoom,
    zoom,
  }
}

export function revealBoundsInViewport(
  camera: CanvasCamera,
  bounds: NodeBounds,
  viewport: ViewportSize,
  margin = 48
): CanvasCamera {
  const left = camera.x + bounds.left * camera.zoom
  const top = camera.y + bounds.top * camera.zoom
  const right = camera.x + bounds.right * camera.zoom
  const bottom = camera.y + bounds.bottom * camera.zoom
  let deltaX = 0
  let deltaY = 0

  if (left < margin) deltaX = margin - left
  else if (right > viewport.width - margin) {
    deltaX = viewport.width - margin - right
  }
  if (top < margin) deltaY = margin - top
  else if (bottom > viewport.height - margin) {
    deltaY = viewport.height - margin - bottom
  }

  return { ...camera, x: camera.x + deltaX, y: camera.y + deltaY }
}
