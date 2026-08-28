import { describe, expect, it } from "vitest"
import {
  twoTouchNavigationMetrics,
  wheelPanDelta,
  wheelZoomScale,
} from "./use-canvas-gesture-navigation"

describe("canvas gesture navigation", () => {
  it("preserves two-dimensional trackpad movement", () => {
    expect(
      wheelPanDelta({
        deltaMode: 0,
        deltaX: 18,
        deltaY: 3,
        shiftKey: false,
      })
    ).toEqual({ deltaX: 18, deltaY: 3 })
  })

  it("maps Shift plus a vertical wheel to horizontal movement", () => {
    expect(
      wheelPanDelta({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 24,
        shiftKey: true,
      })
    ).toEqual({ deltaX: 24, deltaY: 0 })
  })

  it("normalizes line and page deltas", () => {
    expect(
      wheelPanDelta({
        deltaMode: 1,
        deltaX: 0,
        deltaY: 2,
        shiftKey: true,
      })
    ).toEqual({ deltaX: 80, deltaY: 0 })
    expect(
      wheelPanDelta({
        deltaMode: 2,
        deltaX: 1,
        deltaY: 0,
        shiftKey: false,
      })
    ).toEqual({ deltaX: 800, deltaY: 0 })
  })

  it("uses the higher-resolution macOS pinch scale", () => {
    const desktopWheel = wheelZoomScale(
      { ctrlKey: false, deltaMode: 0, deltaY: -1 },
      false
    )
    const macPinch = wheelZoomScale(
      { ctrlKey: true, deltaMode: 0, deltaY: -1 },
      true
    )

    expect(desktopWheel).toBeGreaterThan(1)
    expect(macPinch).toBeGreaterThan(desktopWheel)
  })

  it("derives stable two-touch distance and midpoint", () => {
    expect(
      twoTouchNavigationMetrics({
        0: { clientX: 12, clientY: 20 },
        1: { clientX: 18, clientY: 28 },
        length: 2,
      })
    ).toEqual({ distance: 10, midpoint: { x: 15, y: 24 } })
    expect(twoTouchNavigationMetrics({ length: 0 })).toBeNull()
  })
})
