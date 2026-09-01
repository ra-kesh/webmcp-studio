import type { Page } from "@webmcp/document"
import type { NodeBounds } from "./geometry"
import {
  clampCanvasZoom,
  zoomCameraAtPoint,
  type CanvasCamera,
  type Point,
  type ViewportSize,
} from "./viewport"

export type WorldRect = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}>

export type PageWorldFrame = WorldRect &
  Readonly<{
    pageId: string
    index: number
  }>

export type MultiArtboardLayoutOptions = Readonly<{
  direction?: "vertical"
  gap?: number
}>

export type ActivePageDerivation = Readonly<{
  selectionPageId?: string | null
  focusedPageId?: string | null
  camera: CanvasCamera
  viewport: ViewportSize
}>

export const DEFAULT_ARTBOARD_GAP = 160
export const DEFAULT_ARTBOARD_FIT_PADDING = 112

const emptyWorldRect = (): WorldRect => ({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
})

const rectFromEdges = (
  left: number,
  top: number,
  right: number,
  bottom: number
): WorldRect => ({
  left,
  top,
  right,
  bottom,
  width: Math.max(0, right - left),
  height: Math.max(0, bottom - top),
})

export function worldRectFromBounds(bounds: NodeBounds): WorldRect {
  return rectFromEdges(bounds.left, bounds.top, bounds.right, bounds.bottom)
}

export function rectIntersectionArea(first: WorldRect, second: WorldRect) {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left)
  )
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
  )
  return width * height
}

export function rectContainsPoint(rect: WorldRect, point: Point) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
}

export function viewportWorldRect(
  camera: CanvasCamera,
  viewport: ViewportSize
): WorldRect {
  const left = -camera.x / camera.zoom
  const top = -camera.y / camera.zoom
  return rectFromEdges(
    left,
    top,
    left + viewport.width / camera.zoom,
    top + viewport.height / camera.zoom
  )
}

export function expandWorldRect(
  rect: WorldRect,
  horizontal: number,
  vertical = horizontal
): WorldRect {
  return rectFromEdges(
    rect.left - horizontal,
    rect.top - vertical,
    rect.right + horizontal,
    rect.bottom + vertical
  )
}

export class MultiArtboardLayoutController {
  readonly frames: readonly PageWorldFrame[]
  readonly documentBounds: WorldRect
  readonly #framesByPageId: ReadonlyMap<string, PageWorldFrame>

  constructor(
    pages: readonly Pick<Page, "id" | "width" | "height">[],
    options: MultiArtboardLayoutOptions = {}
  ) {
    const direction = options.direction ?? "vertical"
    if (direction !== "vertical") {
      throw new Error(`Unsupported artboard direction: ${direction}`)
    }
    const gap = options.gap ?? DEFAULT_ARTBOARD_GAP
    if (!Number.isFinite(gap) || gap < 0) {
      throw new Error("Artboard gap must be a finite non-negative number.")
    }
    const maximumWidth = pages.reduce(
      (maximum, page) => Math.max(maximum, page.width),
      0
    )
    let y = 0
    const frames = pages.map((page, index): PageWorldFrame => {
      const left = (maximumWidth - page.width) / 2
      const frame = {
        pageId: page.id,
        index,
        left,
        top: y,
        right: left + page.width,
        bottom: y + page.height,
        width: page.width,
        height: page.height,
      }
      y = frame.bottom + gap
      return frame
    })
    this.frames = frames
    this.#framesByPageId = new Map(frames.map((frame) => [frame.pageId, frame]))
    this.documentBounds = frames.length
      ? rectFromEdges(0, 0, maximumWidth, frames.at(-1)?.bottom ?? 0)
      : emptyWorldRect()
  }

  getFrame(pageId: string) {
    return this.#framesByPageId.get(pageId) ?? null
  }

  pageToWorld(pageId: string, point: Point): Point | null {
    const frame = this.getFrame(pageId)
    return frame ? { x: frame.left + point.x, y: frame.top + point.y } : null
  }

  worldToPage(pageId: string, point: Point): Point | null {
    const frame = this.getFrame(pageId)
    return frame ? { x: point.x - frame.left, y: point.y - frame.top } : null
  }

  pageBoundsToWorld(pageId: string, bounds: NodeBounds): WorldRect | null {
    const frame = this.getFrame(pageId)
    return frame
      ? rectFromEdges(
          frame.left + bounds.left,
          frame.top + bounds.top,
          frame.left + bounds.right,
          frame.top + bounds.bottom
        )
      : null
  }
}

export function visiblePageIds(
  layout: MultiArtboardLayoutController,
  camera: CanvasCamera,
  viewport: ViewportSize,
  options: Readonly<{
    overscanScreens?: number
    pinnedPageIds?: ReadonlySet<string>
  }> = {}
) {
  const viewportBounds = viewportWorldRect(camera, viewport)
  const overscanScreens = Math.max(0, options.overscanScreens ?? 1)
  const visibleBounds = expandWorldRect(
    viewportBounds,
    viewportBounds.width * overscanScreens,
    viewportBounds.height * overscanScreens
  )
  const result = new Set<string>()
  for (const frame of layout.frames) {
    if (rectIntersectionArea(frame, visibleBounds) > 0) {
      result.add(frame.pageId)
    }
  }
  for (const pageId of options.pinnedPageIds ?? []) {
    if (layout.getFrame(pageId)) result.add(pageId)
  }
  return result
}

export function deriveActivePageId(
  layout: MultiArtboardLayoutController,
  input: ActivePageDerivation
) {
  if (input.selectionPageId && layout.getFrame(input.selectionPageId)) {
    return input.selectionPageId
  }
  if (input.focusedPageId && layout.getFrame(input.focusedPageId)) {
    return input.focusedPageId
  }
  const viewportBounds = viewportWorldRect(input.camera, input.viewport)
  const center = {
    x: (viewportBounds.left + viewportBounds.right) / 2,
    y: (viewportBounds.top + viewportBounds.bottom) / 2,
  }
  const containing = layout.frames.find((frame) =>
    rectContainsPoint(frame, center)
  )
  if (containing) return containing.pageId

  let bestFrame: PageWorldFrame | null = null
  let bestArea = -1
  for (const frame of layout.frames) {
    const area = rectIntersectionArea(frame, viewportBounds)
    if (area > bestArea) {
      bestArea = area
      bestFrame = frame
    }
  }
  return bestFrame?.pageId ?? null
}

export function fitWorldRectInViewport(
  bounds: WorldRect,
  viewport: ViewportSize,
  options: Readonly<{ padding?: number; maxZoom?: number }> = {}
): CanvasCamera {
  const padding = Math.max(0, options.padding ?? DEFAULT_ARTBOARD_FIT_PADDING)
  const availableWidth = Math.max(1, viewport.width - padding)
  const availableHeight = Math.max(1, viewport.height - padding)
  const zoom = clampCanvasZoom(
    Math.min(
      availableWidth / Math.max(bounds.width, 1),
      availableHeight / Math.max(bounds.height, 1),
      options.maxZoom ?? 1
    )
  )
  return {
    x: viewport.width / 2 - (bounds.left + bounds.width / 2) * zoom,
    y: viewport.height / 2 - (bounds.top + bounds.height / 2) * zoom,
    zoom,
  }
}

export class WorkspaceCameraController {
  #camera: CanvasCamera

  constructor(initial: CanvasCamera = { x: 0, y: 0, zoom: 1 }) {
    this.#camera = { ...initial, zoom: clampCanvasZoom(initial.zoom) }
  }

  get camera(): CanvasCamera {
    return this.#camera
  }

  set(camera: CanvasCamera) {
    this.#camera = { ...camera, zoom: clampCanvasZoom(camera.zoom) }
    return this.camera
  }

  pan(delta: Point) {
    return this.set({
      ...this.#camera,
      x: this.#camera.x + delta.x,
      y: this.#camera.y + delta.y,
    })
  }

  zoomAtPoint(zoom: number, anchor: Point) {
    return this.set(zoomCameraAtPoint(this.#camera, zoom, anchor))
  }

  zoomToBounds(
    bounds: WorldRect,
    viewport: ViewportSize,
    options?: Readonly<{ padding?: number; maxZoom?: number }>
  ) {
    return this.set(fitWorldRectInViewport(bounds, viewport, options))
  }

  zoomToPage(
    layout: MultiArtboardLayoutController,
    pageId: string,
    viewport: ViewportSize
  ) {
    const frame = layout.getFrame(pageId)
    return frame
      ? this.zoomToBounds(frame, viewport, { maxZoom: 1 })
      : this.camera
  }

  zoomToSelection(
    layout: MultiArtboardLayoutController,
    pageId: string,
    bounds: NodeBounds,
    viewport: ViewportSize
  ) {
    const worldBounds = layout.pageBoundsToWorld(pageId, bounds)
    return worldBounds
      ? this.zoomToBounds(worldBounds, viewport, {
          padding: 160,
          maxZoom: 2,
        })
      : this.camera
  }

  zoomToAllPages(
    layout: MultiArtboardLayoutController,
    viewport: ViewportSize
  ) {
    return layout.frames.length
      ? this.zoomToBounds(layout.documentBounds, viewport, { maxZoom: 1 })
      : this.camera
  }

  screenToWorld(point: Point): Point {
    return {
      x: (point.x - this.#camera.x) / this.#camera.zoom,
      y: (point.y - this.#camera.y) / this.#camera.zoom,
    }
  }

  worldToScreen(point: Point): Point {
    return {
      x: this.#camera.x + point.x * this.#camera.zoom,
      y: this.#camera.y + point.y * this.#camera.zoom,
    }
  }
}

export function pageIdForNavigationKey(
  pageIds: readonly string[],
  activePageId: string | null,
  key: string
) {
  if (!pageIds.length) return null
  const currentIndex = Math.max(0, pageIds.indexOf(activePageId ?? ""))
  if (key === "Home") return pageIds[0] ?? null
  if (key === "End") return pageIds.at(-1) ?? null
  if (key === "ArrowUp" || key === "PageUp") {
    return pageIds[Math.max(0, currentIndex - 1)] ?? null
  }
  if (key === "ArrowDown" || key === "PageDown") {
    return pageIds[Math.min(pageIds.length - 1, currentIndex + 1)] ?? null
  }
  return null
}
