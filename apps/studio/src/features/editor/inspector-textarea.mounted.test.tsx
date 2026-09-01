// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommitTextarea } from "./inspector-controls"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe("CommitTextarea live preview", () => {
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

  const renderTextarea = async () => {
    const onPreview = vi.fn()
    const onPreviewCancel = vi.fn()
    const onCommit = vi.fn()
    await act(async () => {
      root.render(
        <CommitTextarea
          aria-label="Text content"
          value="Quotation title"
          onPreview={onPreview}
          onPreviewCancel={onPreviewCancel}
          onCommit={onCommit}
        />
      )
    })
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Text content"]'
    )
    expect(textarea).not.toBeNull()
    return { textarea: textarea!, onPreview, onPreviewCancel, onCommit }
  }

  const inputText = async (textarea: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set
      valueSetter?.call(textarea, value)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  const flushPreview = async () => {
    const callback = scheduledFrame
    scheduledFrame = null
    expect(callback).not.toBeNull()
    await act(async () => callback?.(performance.now()))
  }

  it("previews typing, commits once on blur, cancels on Escape, and cleans up on unmount", async () => {
    const pageError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { textarea, onPreview, onPreviewCancel, onCommit } =
      await renderTextarea()

    await inputText(textarea, "Quotation title updated")
    expect(onCommit).not.toHaveBeenCalled()
    await flushPreview()
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onPreview).toHaveBeenLastCalledWith("Quotation title updated")

    await act(async () => {
      textarea.focus()
      textarea.blur()
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith("Quotation title updated")
    expect(onPreviewCancel).not.toHaveBeenCalled()

    await inputText(textarea, "Cancelled title")
    await flushPreview()
    await act(async () => {
      textarea.focus()
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })
    expect(textarea.value).toBe("Quotation title")
    expect(onPreviewCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledTimes(1)

    await inputText(textarea, "Unmounted preview")
    await flushPreview()
    await act(async () => root.render(null))
    expect(onPreviewCancel).toHaveBeenCalledTimes(2)
    expect(pageError).not.toHaveBeenCalled()
    pageError.mockRestore()
  })
})
