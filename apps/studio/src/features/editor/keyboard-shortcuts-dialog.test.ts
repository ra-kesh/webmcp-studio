import { describe, expect, it } from "vitest"
import { CANVAS_TRANSFORM_SHORTCUTS } from "./keyboard-shortcuts-dialog"

describe("canvas transform shortcut disclosure", () => {
  it("documents every transform modifier implemented by the Fabric canvas", () => {
    expect(CANVAS_TRANSFORM_SHORTCUTS).toEqual([
      { label: "Preserve proportions while resizing", shortcut: "Shift" },
      { label: "Snap rotation to 15°", shortcut: "Shift" },
      { label: "Resize from the center", shortcut: "Alt / Option" },
    ])
  })
})
