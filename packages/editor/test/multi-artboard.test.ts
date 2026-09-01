import { describe, expect, it } from "vitest"
import {
  MultiArtboardLayoutController,
  WorkspaceCameraController,
  deriveActivePageId,
  pageIdForNavigationKey,
  visiblePageIds,
} from "../src/multi-artboard"

const pages = [
  { id: "portrait", width: 600, height: 800 },
  { id: "landscape", width: 1000, height: 500 },
  { id: "square", width: 700, height: 700 },
]

describe("MultiArtboardLayoutController", () => {
  it("centers mixed-size pages in a vertical world without changing page geometry", () => {
    const layout = new MultiArtboardLayoutController(pages, { gap: 100 })

    expect(layout.frames).toEqual([
      {
        pageId: "portrait",
        index: 0,
        left: 200,
        top: 0,
        right: 800,
        bottom: 800,
        width: 600,
        height: 800,
      },
      {
        pageId: "landscape",
        index: 1,
        left: 0,
        top: 900,
        right: 1000,
        bottom: 1400,
        width: 1000,
        height: 500,
      },
      {
        pageId: "square",
        index: 2,
        left: 150,
        top: 1500,
        right: 850,
        bottom: 2200,
        width: 700,
        height: 700,
      },
    ])
    expect(layout.documentBounds).toEqual({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 2200,
      width: 1000,
      height: 2200,
    })
  })

  it("round-trips page-local and world coordinates", () => {
    const layout = new MultiArtboardLayoutController(pages, { gap: 80 })
    const local = { x: 173.25, y: 294.75 }
    const world = layout.pageToWorld("square", local)

    expect(world).toEqual({ x: 323.25, y: 1754.75 })
    expect(layout.worldToPage("square", world!)).toEqual(local)
    expect(layout.pageToWorld("missing", local)).toBeNull()
  })

  it("recomputes positions from order and leaves an empty document at the origin", () => {
    const reordered = new MultiArtboardLayoutController(
      [pages[2]!, pages[0]!],
      { gap: 40 }
    )
    expect(reordered.getFrame("square")?.top).toBe(0)
    expect(reordered.getFrame("portrait")?.top).toBe(740)
    expect(new MultiArtboardLayoutController([]).documentBounds).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    })
  })
})

describe("multi-artboard camera and active page", () => {
  const layout = new MultiArtboardLayoutController(pages, { gap: 100 })
  const viewport = { width: 1000, height: 800 }

  it("fits one page, a page-local selection, and every page", () => {
    const camera = new WorkspaceCameraController()

    expect(camera.zoomToPage(layout, "landscape", viewport)).toEqual({
      x: 56,
      y: -621.2,
      zoom: 0.888,
    })

    const selectionCamera = camera.zoomToSelection(
      layout,
      "square",
      {
        left: 100,
        top: 120,
        right: 300,
        bottom: 320,
        width: 200,
        height: 200,
        centerX: 200,
        centerY: 220,
      },
      viewport
    )
    expect(selectionCamera.zoom).toBe(2)
    expect(camera.screenToWorld({ x: 500, y: 400 })).toEqual({
      x: 350,
      y: 1720,
    })

    const allPagesCamera = camera.zoomToAllPages(layout, viewport)
    expect(allPagesCamera.zoom).toBeCloseTo(688 / 2200)
    expect(camera.worldToScreen({ x: 500, y: 1100 })).toEqual({
      x: 500,
      y: 400,
    })
  })

  it("uses selection, explicit focus, center, then intersection ownership", () => {
    const camera = new WorkspaceCameraController().zoomToPage(
      layout,
      "landscape",
      viewport
    )
    expect(
      deriveActivePageId(layout, {
        selectionPageId: "portrait",
        focusedPageId: "square",
        camera,
        viewport,
      })
    ).toBe("portrait")
    expect(
      deriveActivePageId(layout, {
        focusedPageId: "square",
        camera,
        viewport,
      })
    ).toBe("square")
    expect(deriveActivePageId(layout, { camera, viewport })).toBe("landscape")

    expect(
      deriveActivePageId(layout, {
        camera: { x: 0, y: -800, zoom: 1 },
        viewport: { width: 1000, height: 200 },
      })
    ).toBe("landscape")
  })

  it("keeps visible mounts bounded and retains pinned interaction pages", () => {
    const hundredPages = Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index + 1}`,
      width: index % 2 ? 1000 : 600,
      height: index % 3 ? 800 : 500,
    }))
    const largeLayout = new MultiArtboardLayoutController(hundredPages, {
      gap: 120,
    })
    const camera = new WorkspaceCameraController().zoomToPage(
      largeLayout,
      "page-50",
      viewport
    )
    const visible = visiblePageIds(largeLayout, camera, viewport, {
      overscanScreens: 1,
      pinnedPageIds: new Set(["page-1"]),
    })

    expect(visible.has("page-1")).toBe(true)
    expect(visible.has("page-50")).toBe(true)
    expect(visible.size).toBeLessThan(10)
  })
})

describe("page keyboard navigation", () => {
  const pageIds = pages.map((page) => page.id)

  it("moves in document order and clamps at the ends", () => {
    expect(pageIdForNavigationKey(pageIds, "portrait", "ArrowUp")).toBe(
      "portrait"
    )
    expect(pageIdForNavigationKey(pageIds, "portrait", "ArrowDown")).toBe(
      "landscape"
    )
    expect(pageIdForNavigationKey(pageIds, "landscape", "End")).toBe("square")
    expect(pageIdForNavigationKey(pageIds, "square", "PageDown")).toBe("square")
    expect(pageIdForNavigationKey(pageIds, "square", "x")).toBeNull()
  })
})
