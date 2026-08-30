import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CanvasTextEditingState } from "@webmcp/editor"
import { textFormattingTogglePatch } from "./text-formatting-model"
import { TextFormattingToolbar } from "./text-formatting-toolbar"

const state = (overrides: Partial<CanvasTextEditingState["style"]> = {}) =>
  ({
    nodeId: "text-1",
    text: "Hello",
    selection: { anchor: 0, focus: 5 },
    typographyStyle: { kind: "value", value: null },
    paintStyle: { kind: "value", value: null },
    link: { kind: "none" },
    paragraph: {
      align: { kind: "value", value: "left" },
      list: { kind: "value", value: null },
    },
    style: {
      color: { kind: "value", value: "#111827" },
      fontFamily: { kind: "value", value: "Geist Variable" },
      fontSize: { kind: "value", value: 24 },
      fontWeight: { kind: "value", value: 400 },
      italic: { kind: "value", value: false },
      decoration: { kind: "value", value: "none" },
      lineHeight: { kind: "value", value: 1.2 },
      letterSpacing: { kind: "value", value: 0 },
      ...overrides,
    },
  }) satisfies CanvasTextEditingState

describe("text formatting toolbar", () => {
  it("toggles resolved selection values and treats mixed values as off", () => {
    expect(textFormattingTogglePatch(state(), "bold")).toEqual({
      fontWeight: 700,
    })
    expect(
      textFormattingTogglePatch(
        state({ fontWeight: { kind: "value", value: 700 } }),
        "bold"
      )
    ).toEqual({ fontWeight: 400 })
    expect(
      textFormattingTogglePatch(state({ italic: { kind: "mixed" } }), "italic")
    ).toEqual({ italic: true })
  })

  it("keeps underline and strikethrough mutually truthful", () => {
    expect(textFormattingTogglePatch(state(), "underline")).toEqual({
      decoration: "underline",
    })
    expect(
      textFormattingTogglePatch(
        state({
          decoration: { kind: "value", value: "line_through" },
        }),
        "strikethrough"
      )
    ).toEqual({ decoration: "none" })
  })

  it("keeps every formatting control reachable inside a compact viewport", () => {
    const html = renderToStaticMarkup(
      createElement(TextFormattingToolbar, {
        state: state(),
        onApply: vi.fn(),
        onEditLink: vi.fn(),
      })
    )

    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Selected text formatting"')
    expect(html).toContain("w-full")
    expect(html).toContain("overflow-x-auto")
    expect(html).toContain("overscroll-x-contain")
    expect(html).toContain("[&amp;&gt;*]:shrink-0")
  })
})
