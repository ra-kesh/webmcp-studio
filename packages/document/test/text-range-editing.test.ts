import { describe, expect, it } from "vitest"
import type { TextNode } from "../src/schema"
import {
  applyTextLinkToRange,
  applyTextStyleToRange,
  deriveTextReplacement,
  normalizeTextSelection,
  replaceTextRunRange,
  resolveTextSelectionLink,
  replaceRichTextRange,
  resolveTextSelectionStyle,
  textNodeBaseStyle,
  textRunOverrideAtCaret,
} from "../src/text-range-editing"

const node = {
  type: "text",
  color: "#111111",
  fontFamily: "Geist",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  decoration: "none",
  lineHeight: 1.2,
  letterSpacing: 0,
} as TextNode

describe("text range editing", () => {
  it("normalizes directional UTF-16 selections without losing direction", () => {
    expect(normalizeTextSelection("A😀B", { anchor: 4, focus: 1 })).toEqual({
      anchor: 4,
      focus: 1,
      start: 1,
      end: 4,
      collapsed: false,
      direction: "backward",
    })
    expect(() =>
      normalizeTextSelection("A😀B", { anchor: 2, focus: 4 })
    ).toThrow(/splits a surrogate pair/)
  })

  it("reports truthful mixed and shared styles over a selection", () => {
    const state = resolveTextSelectionStyle(
      "One two",
      [
        { start: 0, end: 3, style: { fontWeight: 700, color: "#ff0000" } },
        { start: 3, end: 4, style: { fontWeight: 700 } },
        { start: 4, end: 7, style: { fontWeight: 700, color: "#00ff00" } },
      ],
      { anchor: 0, focus: 7 },
      textNodeBaseStyle(node)
    )
    expect(state.fontWeight).toEqual({ kind: "value", value: 700 })
    expect(state.color).toEqual({ kind: "mixed" })
    expect(state.italic).toEqual({ kind: "value", value: false })
  })

  it("uses the preceding insertion edge but the following style at a paragraph start", () => {
    const runs = [
      { start: 0, end: 5, style: { fontWeight: 700 } },
      { start: 6, end: 12, style: { italic: true } },
    ]
    expect(textRunOverrideAtCaret("First\nSecond", runs, 3)).toEqual({
      fontWeight: 700,
    })
    expect(textRunOverrideAtCaret("First\nSecond", runs, 6)).toEqual({
      italic: true,
    })
  })

  it("lets an explicit collapsed-caret typing override drive toolbar state", () => {
    const state = resolveTextSelectionStyle(
      "Hello",
      [],
      { anchor: 2, focus: 2 },
      textNodeBaseStyle(node),
      { italic: true, decoration: "underline" }
    )
    expect(state.italic).toEqual({ kind: "value", value: true })
    expect(state.decoration).toEqual({
      kind: "value",
      value: "underline",
    })
  })

  it("splits, patches, removes and recompacts selected run intervals", () => {
    const text = "abcdefghij"
    const bold = [{ start: 0, end: 10, style: { fontWeight: 700 } }]
    expect(
      applyTextStyleToRange(
        text,
        bold,
        { anchor: 7, focus: 3 },
        { fontWeight: null, italic: true }
      )
    ).toEqual([
      { start: 0, end: 3, style: { fontWeight: 700 } },
      { start: 3, end: 7, style: { italic: true } },
      { start: 7, end: 10, style: { fontWeight: 700 } },
    ])
  })

  it("keeps unrelated properties while formatting a partial overlap", () => {
    expect(
      applyTextStyleToRange(
        "abcdef",
        [{ start: 0, end: 6, style: { color: "#ff0000" } }],
        { anchor: 2, focus: 4 },
        { fontWeight: 700 }
      )
    ).toEqual([
      { start: 0, end: 2, style: { color: "#ff0000" } },
      {
        start: 2,
        end: 4,
        style: { color: "#ff0000", fontWeight: 700 },
      },
      { start: 4, end: 6, style: { color: "#ff0000" } },
    ])
  })

  it("remaps both sides of a replaced range and styles inserted text", () => {
    expect(
      replaceTextRunRange(
        "Hello world",
        [
          { start: 0, end: 5, style: { fontWeight: 700 } },
          { start: 6, end: 11, style: { italic: true } },
        ],
        { anchor: 3, focus: 8 },
        "y there",
        { decoration: "underline" }
      )
    ).toEqual({
      text: "Hely thererld",
      runs: [
        { start: 0, end: 3, style: { fontWeight: 700 } },
        { start: 3, end: 10, style: { decoration: "underline" } },
        { start: 10, end: 13, style: { italic: true } },
      ],
      selection: {
        anchor: 10,
        focus: 10,
        start: 10,
        end: 10,
        collapsed: true,
        direction: "none",
      },
    })
  })

  it("inherits an authored override when typing inside a run and preserves emoji", () => {
    expect(
      replaceTextRunRange(
        "A😀B",
        [{ start: 1, end: 3, style: { color: "#ff0000" } }],
        { anchor: 3, focus: 3 },
        "!"
      )
    ).toMatchObject({
      text: "A😀!B",
      runs: [{ start: 1, end: 4, style: { color: "#ff0000" } }],
    })
  })

  it("derives an emoji-safe minimal replacement from live editor text", () => {
    expect(deriveTextReplacement("A😀B", "A🫶B")).toEqual({
      selection: { anchor: 1, focus: 3 },
      replacement: "🫶",
    })
  })

  it("remaps paragraph and link semantics with the same text replacement", () => {
    expect(
      replaceRichTextRange(
        "Visit site\nNext",
        {
          runs: [],
          paragraphs: [
            { start: 0, end: 10, style: { align: "center" } },
            {
              start: 11,
              end: 15,
              style: { list: { kind: "bulleted", level: 1 } },
            },
          ],
          links: [
            {
              start: 6,
              end: 10,
              target: "https://example.com",
              newTab: true,
            },
          ],
        },
        { anchor: 8, focus: 8 },
        "ful"
      )
    ).toMatchObject({
      text: "Visit sifulte\nNext",
      content: {
        paragraphs: [
          { start: 0, end: 13, style: { align: "center" } },
          {
            start: 14,
            end: 18,
            style: { list: { kind: "bulleted", level: 1 } },
          },
        ],
        links: [
          {
            start: 6,
            end: 13,
            target: "https://example.com",
            newTab: true,
          },
        ],
      },
    })
  })

  it("reports none, one shared link, and partial mixed link selections", () => {
    const text = "One linked phrase"
    const links = [
      {
        start: 4,
        end: 10,
        target: "https://example.com",
        newTab: true,
      },
    ]

    expect(
      resolveTextSelectionLink(text, links, { anchor: 0, focus: 3 })
    ).toEqual({ kind: "none" })
    expect(
      resolveTextSelectionLink(text, links, { anchor: 10, focus: 4 })
    ).toEqual({
      kind: "value",
      target: "https://example.com",
      newTab: true,
    })
    expect(
      resolveTextSelectionLink(text, links, { anchor: 2, focus: 8 })
    ).toEqual({ kind: "mixed" })
  })

  it("sets, replaces, removes, and recompacts links over an exact range", () => {
    const text = "Alpha beta gamma"
    const initial = [
      {
        start: 0,
        end: 5,
        target: "https://old.example",
        newTab: true,
      },
      {
        start: 11,
        end: 16,
        target: "https://old.example",
        newTab: true,
      },
    ]
    const linked = applyTextLinkToRange(
      text,
      initial,
      { anchor: 6, focus: 10 },
      { target: "mailto:hello@example.com", newTab: false }
    )
    expect(linked).toEqual([
      initial[0],
      {
        start: 6,
        end: 10,
        target: "mailto:hello@example.com",
        newTab: false,
      },
      initial[1],
    ])

    expect(
      applyTextLinkToRange(
        text,
        linked,
        { anchor: 3, focus: 13 },
        { target: "https://new.example", newTab: true }
      )
    ).toEqual([
      {
        start: 0,
        end: 3,
        target: "https://old.example",
        newTab: true,
      },
      {
        start: 3,
        end: 13,
        target: "https://new.example",
        newTab: true,
      },
      {
        start: 13,
        end: 16,
        target: "https://old.example",
        newTab: true,
      },
    ])
    expect(
      applyTextLinkToRange(text, initial, { anchor: 0, focus: 16 }, null)
    ).toEqual([])
  })

  it("edits the containing link from a collapsed caret", () => {
    const text = "Linked text"
    const links = [
      {
        start: 0,
        end: text.length,
        target: "https://example.com",
        newTab: true,
      },
    ]
    expect(
      applyTextLinkToRange(
        text,
        links,
        { anchor: 6, focus: 6 },
        { target: "tel:+15551234567", newTab: false }
      )
    ).toEqual([
      {
        start: 0,
        end: text.length,
        target: "tel:+15551234567",
        newTab: false,
      },
    ])
    expect(() =>
      applyTextLinkToRange(text, [], { anchor: 6, focus: 6 }, null)
    ).toThrow("Select text before adding a link")
  })
})
