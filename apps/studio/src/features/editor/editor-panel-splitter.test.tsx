// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorPanelSplitter } from "./editor-panel-splitter"

function dispatchPointerEvent(
  target: Element,
  type: string,
  options: { clientX: number; pointerId: number; button?: number }
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX,
  })
  Object.defineProperty(event, "pointerId", { value: options.pointerId })
  target.dispatchEvent(event)
}

describe("EditorPanelSplitter", () => {
  let host: HTMLDivElement
  let root: Root
  let frameCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    frameCallbacks = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function renderSplitter(
    overrides: Partial<React.ComponentProps<typeof EditorPanelSplitter>> = {}
  ) {
    const onResize = vi.fn<(value: number) => void>()
    const onResizeEnd = vi.fn<(value: number) => void>()
    const onToggleCollapse = vi.fn<() => void>()
    const props = {
      label: "Resize document panel",
      value: 264,
      minValue: 208,
      maxValue: 360,
      resizeDirection: "right" as const,
      onResize,
      onResizeEnd,
      onToggleCollapse,
      ...overrides,
    }
    await act(async () => root.render(<EditorPanelSplitter {...props} />))
    const splitter = host.querySelector<HTMLElement>('[role="separator"]')
    if (!splitter) throw new Error("Expected an editor panel splitter")
    Object.assign(splitter, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    return { onResize, onResizeEnd, onToggleCollapse, splitter }
  }

  it("exposes separator semantics and a 12px hit target around a 1px divider", async () => {
    const { splitter } = await renderSplitter({ controlsId: "document-panel" })

    expect(splitter.getAttribute("aria-label")).toBe("Resize document panel")
    expect(splitter.getAttribute("aria-orientation")).toBe("vertical")
    expect(splitter.getAttribute("aria-valuemin")).toBe("208")
    expect(splitter.getAttribute("aria-valuemax")).toBe("360")
    expect(splitter.getAttribute("aria-valuenow")).toBe("264")
    expect(splitter.getAttribute("aria-controls")).toBe("document-panel")
    expect(splitter.tabIndex).toBe(0)
    expect(splitter.className).toContain("w-3")
    expect(splitter.className).toContain("focus-visible:ring-2")
    expect(splitter.querySelector("span")?.className).toContain("w-px")
  })

  it("resizes by keyboard step, large step, bounds, and collapse action", async () => {
    const { onResize, onResizeEnd, onToggleCollapse, splitter } =
      await renderSplitter()

    await act(async () => {
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })
      )
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowLeft",
          shiftKey: true,
        })
      )
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" })
      )
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" })
      )
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      )
    })

    expect(onResize.mock.calls.map(([next]) => next)).toEqual([
      272, 232, 208, 360,
    ])
    expect(onResizeEnd.mock.calls.map(([next]) => next)).toEqual([
      272, 232, 208, 360,
    ])
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it("maps physical arrow movement to a right-hand panel width", async () => {
    const { onResize, splitter } = await renderSplitter({
      value: 336,
      minValue: 280,
      maxValue: 440,
      resizeDirection: "left",
    })

    await act(async () => {
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })
      )
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })
      )
    })

    expect(onResize.mock.calls.map(([next]) => next)).toEqual([344, 328])
  })

  it("coalesces pointer moves to one resize per frame and settles on release", async () => {
    const { onResize, onResizeEnd, splitter } = await renderSplitter({
      value: 240,
    })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 7,
      })
      dispatchPointerEvent(splitter, "pointermove", {
        clientX: 112,
        pointerId: 7,
      })
      dispatchPointerEvent(splitter, "pointermove", {
        clientX: 128,
        pointerId: 7,
      })
    })

    expect(splitter.getAttribute("data-resizing")).toBe("true")
    expect(splitter.setPointerCapture).toHaveBeenCalledWith(7)
    expect(onResize).not.toHaveBeenCalled()
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    await act(async () => frameCallbacks.shift()?.(16))
    expect(onResize).toHaveBeenLastCalledWith(268)

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerup", {
        clientX: 140,
        pointerId: 7,
      })
    })

    expect(onResize).toHaveBeenLastCalledWith(280)
    expect(onResizeEnd).toHaveBeenCalledWith(280)
    expect(splitter.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(splitter.hasAttribute("data-resizing")).toBe(false)
  })

  it("settles the pending value and cancels the frame on pointer cancellation", async () => {
    const { onResize, onResizeEnd, splitter } = await renderSplitter({
      value: 220,
    })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 3,
      })
      dispatchPointerEvent(splitter, "pointermove", {
        clientX: 130,
        pointerId: 3,
      })
      dispatchPointerEvent(splitter, "pointercancel", {
        clientX: 130,
        pointerId: 3,
      })
    })

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(250)
    expect(onResizeEnd).toHaveBeenCalledWith(250)
    expect(splitter.hasAttribute("data-resizing")).toBe(false)
  })

  it("settles capture loss without movement and accepts a fresh drag", async () => {
    const { onResize, onResizeEnd, splitter } = await renderSplitter({
      value: 240,
    })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 4,
      })
      dispatchPointerEvent(splitter, "lostpointercapture", {
        clientX: 100,
        pointerId: 4,
      })
    })

    expect(onResize).not.toHaveBeenCalled()
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenLastCalledWith(240)
    expect(splitter.hasAttribute("data-resizing")).toBe(false)

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 5,
      })
      dispatchPointerEvent(splitter, "pointerup", {
        clientX: 116,
        pointerId: 5,
      })
    })

    expect(onResize).toHaveBeenLastCalledWith(256)
    expect(onResizeEnd).toHaveBeenCalledTimes(2)
    expect(onResizeEnd).toHaveBeenLastCalledWith(256)
  })

  it("flushes a queued resize once when pointer capture is lost", async () => {
    const { onResize, onResizeEnd, splitter } = await renderSplitter({
      value: 240,
    })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 6,
      })
      dispatchPointerEvent(splitter, "pointermove", {
        clientX: 124,
        pointerId: 6,
      })
      dispatchPointerEvent(splitter, "lostpointercapture", {
        clientX: 124,
        pointerId: 6,
      })
    })

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith(264)
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenLastCalledWith(264)
    expect(splitter.hasAttribute("data-resizing")).toBe(false)

    await act(async () => frameCallbacks.shift()?.(16))
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it("does not settle twice when release is followed by lost capture", async () => {
    const { onResizeEnd, splitter } = await renderSplitter({ value: 240 })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 8,
      })
      dispatchPointerEvent(splitter, "pointerup", {
        clientX: 120,
        pointerId: 8,
      })
      dispatchPointerEvent(splitter, "lostpointercapture", {
        clientX: 120,
        pointerId: 8,
      })
    })

    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenCalledWith(260)
  })

  it("clamps pointer movement to the supplied bounds", async () => {
    const { onResize, onResizeEnd, splitter } = await renderSplitter({
      value: 240,
    })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 2,
      })
      dispatchPointerEvent(splitter, "pointerup", {
        clientX: 800,
        pointerId: 2,
      })
    })

    expect(onResize).toHaveBeenCalledWith(360)
    expect(onResizeEnd).toHaveBeenCalledWith(360)
  })

  it("disables pointer and keyboard input when requested", async () => {
    const { onResize, onResizeEnd, onToggleCollapse, splitter } =
      await renderSplitter({ disabled: true })

    await act(async () => {
      dispatchPointerEvent(splitter, "pointerdown", {
        clientX: 100,
        pointerId: 2,
      })
      splitter.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" })
      )
    })

    expect(splitter.tabIndex).toBe(-1)
    expect(splitter.getAttribute("aria-disabled")).toBe("true")
    expect(onResize).not.toHaveBeenCalled()
    expect(onResizeEnd).not.toHaveBeenCalled()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })
})
