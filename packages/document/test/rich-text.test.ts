import { describe, expect, it } from "vitest"
import {
  RichTextRangeError,
  isSafeTextLinkTarget,
  normalizeRichTextContent,
  normalizeTextLinks,
  normalizeTextParagraphs,
  normalizeTextRuns,
  textRunStyleSchema,
} from "../src/rich-text"

describe("rich text ranges", () => {
  it("orders ranges and merges adjacent equal character styles", () => {
    expect(
      normalizeTextRuns("One two three", [
        { start: 8, end: 13, style: { fontWeight: 700 } },
        { start: 0, end: 3, style: { color: "#123456" } },
        { start: 4, end: 7, style: { fontWeight: 700 } },
        { start: 7, end: 8, style: { fontWeight: 700 } },
      ])
    ).toEqual([
      { start: 0, end: 3, style: { color: "#123456" } },
      { start: 4, end: 13, style: { fontWeight: 700 } },
    ])
  })

  it("rejects overlapping character styles instead of choosing precedence", () => {
    expect(() =>
      normalizeTextRuns("abcdef", [
        { start: 0, end: 4, style: { fontWeight: 700 } },
        { start: 3, end: 6, style: { italic: true } },
      ])
    ).toThrow(RichTextRangeError)
  })

  it("uses UTF-16 offsets without allowing a range to split an emoji", () => {
    const text = "A😀B"
    expect(text.length).toBe(4)
    expect(
      normalizeTextRuns(text, [
        { start: 1, end: 3, style: { decoration: "underline" } },
      ])
    ).toEqual([{ start: 1, end: 3, style: { decoration: "underline" } }])
    expect(() =>
      normalizeTextRuns(text, [
        { start: 1, end: 2, style: { decoration: "underline" } },
      ])
    ).toThrow(/splits a surrogate pair/)
  })

  it("rejects empty style overrides", () => {
    expect(() => textRunStyleSchema.parse({})).toThrow(
      /must change at least one property/
    )
  })

  it("requires paragraph annotations to follow newline boundaries", () => {
    expect(
      normalizeTextParagraphs("First\nSecond\n", [
        {
          start: 6,
          end: 12,
          style: { list: { kind: "numbered", level: 1, start: 3 } },
        },
        { start: 0, end: 5, style: { align: "center" } },
        { start: 13, end: 13, style: { list: { kind: "bulleted", level: 0 } } },
      ])
    ).toEqual([
      { start: 0, end: 5, style: { align: "center" } },
      {
        start: 6,
        end: 12,
        style: { list: { kind: "numbered", level: 1, start: 3 } },
      },
      {
        start: 13,
        end: 13,
        style: { list: { kind: "bulleted", level: 0 } },
      },
    ])
    expect(() =>
      normalizeTextParagraphs("First\nSecond", [
        { start: 1, end: 5, style: { align: "right" } },
      ])
    ).toThrow(/newline boundaries/)
  })

  it("admits only explicit safe link protocols and non-overlapping links", () => {
    expect(isSafeTextLinkTarget("https://example.com/proposal")).toBe(true)
    expect(isSafeTextLinkTarget("mailto:hello@example.com")).toBe(true)
    expect(isSafeTextLinkTarget("tel:+919999999999")).toBe(true)
    expect(isSafeTextLinkTarget("javascript:alert(1)")).toBe(false)
    expect(isSafeTextLinkTarget("//example.com")).toBe(false)

    expect(() =>
      normalizeTextLinks("Read and call", [
        { start: 0, end: 8, target: "https://example.com", newTab: true },
        { start: 5, end: 13, target: "tel:+919999999999", newTab: false },
      ])
    ).toThrow(/overlap/)
  })

  it("normalizes the complete rich-text payload through one boundary", () => {
    expect(
      normalizeRichTextContent("Hello\nworld", {
        runs: [{ start: 0, end: 5, style: { fontWeight: 700 } }],
        paragraphs: [
          { start: 6, end: 11, style: { list: { kind: "bulleted" } } },
        ],
        links: [
          {
            start: 6,
            end: 11,
            target: "https://example.com",
            newTab: true,
          },
        ],
      })
    ).toEqual({
      runs: [{ start: 0, end: 5, style: { fontWeight: 700 } }],
      paragraphs: [
        {
          start: 6,
          end: 11,
          style: { list: { kind: "bulleted", level: 0 } },
        },
      ],
      links: [
        {
          start: 6,
          end: 11,
          target: "https://example.com",
          newTab: true,
        },
      ],
    })
  })
})
