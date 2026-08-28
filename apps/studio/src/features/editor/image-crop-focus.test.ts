import { describe, expect, it, vi } from "vitest"

import {
  captureImageCropFocusSession,
  focusImageCropToolbarEntry,
  isImageCropCanvasFocus,
  restoreImageCropFocus,
} from "./image-crop-focus"

function focusTarget(isConnected = true) {
  return {
    isConnected,
    focus: vi.fn(),
  }
}

describe("image crop focus session", () => {
  it("captures the exact control opener and requests toolbar focus", () => {
    const opener = focusTarget()
    const session = captureImageCropFocusSession("control", opener)

    expect(session).toEqual({
      focusToolbarOnMount: true,
      opener,
    })
  })

  it("keeps canvas focus when crop starts from direct manipulation", () => {
    const canvas = focusTarget()
    const session = captureImageCropFocusSession("canvas", canvas)

    expect(session).toEqual({
      focusToolbarOnMount: false,
      opener: null,
    })
    expect(focusImageCropToolbarEntry(false, canvas)).toBe(false)
    expect(canvas.focus).not.toHaveBeenCalled()
  })

  it("recognizes the Fabric application canvas without treating other controls as canvas entry", () => {
    expect(
      isImageCropCanvasFocus({
        closest: (selector: string) =>
          selector.includes(".upper-canvas")
            ? { className: "upper-canvas" }
            : null,
      })
    ).toBe(true)
    expect(isImageCropCanvasFocus({ closest: () => null })).toBe(false)
  })

  it("focuses the toolbar target once without scrolling", () => {
    const done = focusTarget()

    expect(focusImageCropToolbarEntry(true, done)).toBe(true)
    expect(done.focus).toHaveBeenCalledTimes(1)
    expect(done.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it("restores the exact connected opener before considering the canvas fallback", () => {
    const opener = focusTarget()
    const fallback = focusTarget()
    const session = captureImageCropFocusSession("control", opener)

    expect(restoreImageCropFocus(session, fallback)).toBe("opener")
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(fallback.focus).not.toHaveBeenCalled()
  })

  it("falls back to the canvas when the opener was removed with a compact sheet", () => {
    const opener = focusTarget(false)
    const fallback = focusTarget()
    const session = captureImageCropFocusSession("control", opener)

    expect(restoreImageCropFocus(session, fallback)).toBe("fallback")
    expect(opener.focus).not.toHaveBeenCalled()
    expect(fallback.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
