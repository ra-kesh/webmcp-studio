import { describe, expect, it } from "vitest"
import {
  filterStudioCommandPaletteItems,
  groupStudioCommandPaletteItems,
  productCommandInvocationKey,
} from "./command-palette"
import type { StudioCommandPaletteItem } from "./command-palette"

const item = (
  id: string,
  label: string,
  category: string,
  keywords: readonly string[],
  shortcut?: string
): StudioCommandPaletteItem => ({
  id,
  label,
  category,
  keywords,
  shortcut,
  enabled: true,
  run: () => true,
})

const commands = [
  item("history.undo", "Undo", "Edit", ["history", "revert"], "Cmd+Z"),
  item("canvas.fit", "Fit page", "View", ["canvas", "zoom"], "Shift+1"),
  item("object.add-text", "Add text", "Text", ["insert", "type"], "T"),
]

describe("command palette model", () => {
  it("finds commands by label, category, keyword, and shortcut", () => {
    expect(filterStudioCommandPaletteItems(commands, "fit")).toEqual([
      commands[1],
    ])
    expect(filterStudioCommandPaletteItems(commands, "view zoom")).toEqual([
      commands[1],
    ])
    expect(filterStudioCommandPaletteItems(commands, "revert")).toEqual([
      commands[0],
    ])
    expect(filterStudioCommandPaletteItems(commands, "cmd+z")).toEqual([
      commands[0],
    ])
  })

  it("normalizes whitespace and returns every command for an empty query", () => {
    expect(filterStudioCommandPaletteItems(commands, "  ADD   type ")).toEqual([
      commands[2],
    ])
    expect(filterStudioCommandPaletteItems(commands, "   ")).toBe(commands)
  })

  it("keeps catalog order while grouping commands", () => {
    expect(groupStudioCommandPaletteItems(commands)).toEqual([
      { category: "Edit", commands: [commands[0]] },
      { category: "View", commands: [commands[1]] },
      { category: "Text", commands: [commands[2]] },
    ])
  })

  it("gives parameterized command variants stable unique identities", () => {
    expect(
      productCommandInvocationKey({
        commandId: "arrange.align",
        arguments: {
          kind: "alignment",
          relativeTo: "selection",
          alignment: "left",
        },
      })
    ).not.toBe(
      productCommandInvocationKey({
        commandId: "arrange.align",
        arguments: {
          kind: "alignment",
          relativeTo: "page",
          alignment: "left",
        },
      })
    )
  })
})
