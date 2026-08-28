import { describe, expect, it } from "vitest"

import { resolveImageCropToolbarEdge } from "./image-crop-toolbar-placement"

describe("resolveImageCropToolbarEdge", () => {
  it("keeps the toolbar at the bottom when it does not cover the frame", () => {
    expect(
      resolveImageCropToolbarEdge({
        frameTop: 80,
        frameBottom: 360,
        viewportHeight: 900,
      })
    ).toBe("bottom")
  })

  it("moves the toolbar to the top when the bottom position covers the frame", () => {
    expect(
      resolveImageCropToolbarEdge({
        frameTop: 260,
        frameBottom: 760,
        viewportHeight: 900,
      })
    ).toBe("top")
  })

  it("does not move to the top when that would cover the frame too", () => {
    expect(
      resolveImageCropToolbarEdge({
        frameTop: 20,
        frameBottom: 820,
        viewportHeight: 900,
      })
    ).toBe("bottom")
  })

  it("falls back safely before a viewport measurement exists", () => {
    expect(
      resolveImageCropToolbarEdge({
        frameTop: 100,
        frameBottom: 700,
        viewportHeight: 0,
      })
    ).toBe("bottom")
  })
})
