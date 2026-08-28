import { describe, expect, test } from "vitest"
import { canvasChangeHistoryOptions } from "./canvas-change-policy"

const node = {
  id: "copy",
  type: "rect" as const,
  name: "Copy",
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 1,
  radius: 0,
}

describe("canvas change history policy", () => {
  test("names a direct text exit as one Edit text transaction", () => {
    expect(
      canvasChangeHistoryOptions([
        { nodeId: "copy", patch: { text: "Revised copy" } },
      ])
    ).toEqual({ label: "Edit text" })
  })

  test("does not mislabel geometry changes as text edits", () => {
    expect(
      canvasChangeHistoryOptions([
        { nodeId: "copy", patch: { text: "Revised copy", x: 24 } },
      ])
    ).toBeUndefined()
    expect(
      canvasChangeHistoryOptions([{ nodeId: "copy", patch: { x: 24 } }])
    ).toBeUndefined()
  })

  test("names completed canvas geometry transactions from canonical changes", () => {
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { x: 24, y: 30 } }],
        [node]
      )
    ).toEqual({ label: "Move selection" })
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { x: 24, width: 140 } }],
        [node]
      )
    ).toEqual({ label: "Resize selection" })
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { x: 24, rotation: 15 } }],
        [node]
      )
    ).toEqual({ label: "Rotate selection" })
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { width: 140, rotation: 15 } }],
        [node]
      )
    ).toEqual({ label: "Transform selection" })
  })

  test("does not name canonical no-ops or non-geometry patches as transforms", () => {
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { x: node.x, y: node.y } }],
        [node]
      )
    ).toBeUndefined()
    expect(
      canvasChangeHistoryOptions(
        [{ nodeId: node.id, patch: { opacity: 0.5 } }],
        [node]
      )
    ).toBeUndefined()
  })
})
