// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InspectorColorField } from "./inspector-controls"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe("InspectorColorField picker interaction", () => {
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

  const renderPicker = async ({
    onPreview = vi.fn(),
    onPreviewCancel = vi.fn(),
    onCommit = vi.fn(),
  } = {}) => {
    await act(async () => {
      root.render(
        <InspectorColorField
          label="Fill"
          value="#111111"
          onPreview={onPreview}
          onPreviewCancel={onPreviewCancel}
          onCommit={onCommit}
        />
      )
    })
    const picker = host.querySelector<HTMLInputElement>(
      'input[aria-label="Fill color picker"]'
    )
    expect(picker).not.toBeNull()
    return { picker: picker!, onPreview, onPreviewCancel, onCommit }
  }

  const inputColor = async (picker: HTMLInputElement, value: string) => {
    await act(async () => {
      picker.value = value
      picker.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  const flushPreview = async () => {
    const callback = scheduledFrame
    scheduledFrame = null
    expect(callback).not.toBeNull()
    await act(async () => callback?.(performance.now()))
  }

  it("coalesces continuous picker input into live previews and commits once on change", async () => {
    const { picker, onPreview, onCommit } = await renderPicker()

    await inputColor(picker, "#222222")
    await inputColor(picker, "#333333")

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()

    await flushPreview()
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onPreview).toHaveBeenLastCalledWith("#333333")

    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith("#333333")
  })

  it("restores the canonical canvas value when Escape cancels a preview", async () => {
    const { picker, onPreviewCancel, onCommit } = await renderPicker()

    await inputColor(picker, "#444444")
    await flushPreview()
    await act(async () => {
      picker.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })

    expect(onPreviewCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
