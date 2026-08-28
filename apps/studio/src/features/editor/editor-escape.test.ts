import { describe, expect, it, vi } from "vitest"
import { handleEditorEscape } from "./editor-escape"

describe("handleEditorEscape", () => {
  it.each([
    ["guide_drag_cancelled", [true, false], ["guide-drag"]],
    [
      "guide_selection_cleared",
      [false, true],
      ["guide-drag", "guide-selection"],
    ],
  ] as const)(
    "gives guide state first Escape precedence: %s",
    (expected, outcomes, expectedCalls) => {
      const calls: string[] = []
      const result = handleEditorEscape({
        cancelGuideDrag: () => {
          calls.push("guide-drag")
          return outcomes[0]
        },
        clearGuideSelection: () => {
          calls.push("guide-selection")
          return outcomes[1]
        },
        cancelCrop: () => {
          calls.push("crop")
          return false
        },
        cancelText: () => false,
        cancelTransform: () => false,
        clearSelection: () => undefined,
      })

      expect(result).toBe(expected)
      expect(calls).toEqual(expectedCalls)
    }
  )

  it.each([
    ["crop_cancelled", [true, false, false], ["crop"]],
    ["text_cancelled", [false, true, false], ["crop", "text"]],
    [
      "transform_cancelled",
      [false, false, true],
      ["crop", "text", "transform"],
    ],
    [
      "selection_cleared",
      [false, false, false],
      ["crop", "text", "transform", "selection"],
    ],
  ] as const)(
    "returns %s without invoking a less-specific action",
    (expected, outcomes, expectedCalls) => {
      const calls: string[] = []
      const result = handleEditorEscape({
        cancelCrop: () => {
          calls.push("crop")
          return outcomes[0]
        },
        cancelText: () => {
          calls.push("text")
          return outcomes[1]
        },
        cancelTransform: () => {
          calls.push("transform")
          return outcomes[2]
        },
        clearSelection: () => calls.push("selection"),
      })

      expect(result).toBe(expected)
      expect(calls).toEqual(expectedCalls)
    }
  )

  it("clears selection exactly once only when no interaction owns Escape", () => {
    const clearSelection = vi.fn()
    handleEditorEscape({
      cancelCrop: () => false,
      cancelText: () => false,
      cancelTransform: () => false,
      clearSelection,
    })

    expect(clearSelection).toHaveBeenCalledOnce()
  })
})
