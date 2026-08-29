import { describe, expect, it } from "vitest"
import {
  fitPageInViewport,
  focusCameraOnBounds,
  revealBoundsInViewport,
  resizeCameraForViewport,
  zoomCameraAtPoint,
} from "../src/viewport"

describe("canvas viewport camera", () => {
  it("fits and centers a page with breathing room", () => {
    expect(
      fitPageInViewport(
        { width: 1200, height: 1600 },
        { width: 900, height: 700 }
      )
    ).toEqual({ x: 229.5, y: 56, zoom: 0.3675 })
  })

  it("keeps the page point under the cursor fixed while zooming", () => {
    const camera = { x: 100, y: 60, zoom: 0.5 }
    const anchor = { x: 420, y: 260 }
    const pagePoint = {
      x: (anchor.x - camera.x) / camera.zoom,
      y: (anchor.y - camera.y) / camera.zoom,
    }
    const next = zoomCameraAtPoint(camera, 1.25, anchor)
    expect(next.x + pagePoint.x * next.zoom).toBe(anchor.x)
    expect(next.y + pagePoint.y * next.zoom).toBe(anchor.y)
  })

  it("preserves the world point at the visual centre while the viewport resizes", () => {
    const camera = { x: -420, y: -180, zoom: 0.75 }
    const previousViewport = { width: 800, height: 600 }
    const nextViewport = { width: 1200, height: 760 }
    const previousWorldCentre = {
      x: (previousViewport.width / 2 - camera.x) / camera.zoom,
      y: (previousViewport.height / 2 - camera.y) / camera.zoom,
    }

    const next = resizeCameraForViewport(camera, previousViewport, nextViewport)

    expect(next.zoom).toBe(camera.zoom)
    expect((nextViewport.width / 2 - next.x) / next.zoom).toBe(
      previousWorldCentre.x
    )
    expect((nextViewport.height / 2 - next.y) / next.zoom).toBe(
      previousWorldCentre.y
    )
  })

  it("does not move the camera before both viewport measurements are usable", () => {
    const camera = { x: 24, y: 32, zoom: 0.5 }
    expect(
      resizeCameraForViewport(
        camera,
        { width: 0, height: 0 },
        { width: 900, height: 700 }
      )
    ).toBe(camera)
  })

  it("centers a selection without zooming beyond the editing limit", () => {
    const camera = focusCameraOnBounds(
      {
        left: 200,
        top: 300,
        right: 240,
        bottom: 320,
        width: 40,
        height: 20,
        centerX: 220,
        centerY: 310,
      },
      { width: 1000, height: 800 }
    )
    expect(camera.zoom).toBe(2)
    expect(camera.x + 220 * camera.zoom).toBe(500)
    expect(camera.y + 310 * camera.zoom).toBe(400)
  })

  it("pans only far enough to reveal an offscreen selection", () => {
    const camera = revealBoundsInViewport(
      { x: -1150, y: -760, zoom: 1 },
      {
        left: 1000,
        top: 700,
        right: 1200,
        bottom: 800,
        width: 200,
        height: 100,
        centerX: 1100,
        centerY: 750,
      },
      { width: 500, height: 400 }
    )
    expect(camera).toEqual({ x: -952, y: -652, zoom: 1 })
  })
})
