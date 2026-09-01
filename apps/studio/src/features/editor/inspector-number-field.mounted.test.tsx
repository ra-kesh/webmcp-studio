// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InspectorNumberField } from "./inspector-controls"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function pointerEvent(type: string, clientX: number, pointerId = 7) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
  })
  Object.defineProperty(event, "pointerId", { value: pointerId })
  return event
}

describe("InspectorNumberField scrubbing", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let scheduledFrame: FrameRequestCallback | null

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    scheduledFrame = null
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback
        return 1
      })
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  const renderField = async () => {
    const onPreview = vi.fn()
    const onPreviewCancel = vi.fn()
    const onCommit = vi.fn()
    await act(async () => {
      root.render(
        <InspectorNumberField
          label="Width"
          compactLabel="W"
          value={{ kind: "value", value: 10 }}
          onPreview={onPreview}
          onPreviewCancel={onPreviewCancel}
          onCommit={onCommit}
        />
      )
    })
    const field = host.querySelector<HTMLDivElement>(
      '[data-slot="inspector-number-field"]'
    )
    expect(field).not.toBeNull()
    Object.defineProperties(field!, {
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
      setPointerCapture: { value: vi.fn() },
    })
    return { field: field!, onPreview, onPreviewCancel, onCommit }
  }

  const flushPreview = async () => {
    const callback = scheduledFrame
    scheduledFrame = null
    expect(callback).not.toBeNull()
    await act(async () => callback?.(performance.now()))
  }

  it("previews horizontal movement and commits exactly once on pointer up", async () => {
    const { field, onPreview, onCommit } = await renderField()

    await act(async () => field.dispatchEvent(pointerEvent("pointerdown", 100)))
    await act(async () => field.dispatchEvent(pointerEvent("pointermove", 110)))

    expect(field.dataset.scrubbing).toBe("true")
    expect(onCommit).not.toHaveBeenCalled()
    await flushPreview()
    expect(onPreview).toHaveBeenLastCalledWith(20)

    await act(async () => field.dispatchEvent(pointerEvent("pointermove", 115)))
    await act(async () => field.dispatchEvent(pointerEvent("pointerup", 115)))

    expect(onPreview).toHaveBeenLastCalledWith(25)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(25)
  })

  it("turns a click without movement into inline text editing", async () => {
    const { field, onCommit } = await renderField()

    await act(async () => field.dispatchEvent(pointerEvent("pointerdown", 100)))
    await act(async () => field.dispatchEvent(pointerEvent("pointerup", 100)))

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Width"]'
    )
    expect(input).not.toBeNull()
    expect(input?.value).toBe("10")
    expect(document.activeElement).toBe(input)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("restores the canonical value when pointer scrubbing is cancelled", async () => {
    const { field, onPreviewCancel, onCommit } = await renderField()

    await act(async () => field.dispatchEvent(pointerEvent("pointerdown", 100)))
    await act(async () => field.dispatchEvent(pointerEvent("pointermove", 112)))
    await flushPreview()
    await act(async () =>
      field.dispatchEvent(pointerEvent("pointercancel", 112))
    )

    expect(onPreviewCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
    expect(field.textContent).toContain("10")
  })
})
