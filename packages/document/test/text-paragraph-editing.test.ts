import { describe, expect, it } from "vitest"

import {
  applyTextParagraphStyleToRange,
  editTextParagraphListByKey,
  resolveTextSelectionParagraphState,
  textParagraphRanges,
} from "../src/text-paragraph-editing"

describe("text paragraph editing", () => {
  const text = "Alpha\nBeta\n"
  const paragraphs = [
    {
      start: 0,
      end: 5,
      style: { list: { kind: "numbered" as const, level: 0, start: 1 } },
    },
    {
      start: 6,
      end: 10,
      style: { list: { kind: "numbered" as const, level: 1, start: 2 } },
    },
  ]

  it("keeps empty trailing paragraphs in the canonical range map", () => {
    expect(textParagraphRanges(text)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
      { start: 11, end: 11 },
    ])
  })

  it("reports shared and mixed paragraph values over an exact selection", () => {
    expect(
      resolveTextSelectionParagraphState(
        text,
        paragraphs,
        { anchor: 1, focus: 4 },
        "left"
      ).list
    ).toEqual({
      kind: "value",
      value: { kind: "numbered", level: 0, start: 1 },
    })
    expect(
      resolveTextSelectionParagraphState(
        text,
        paragraphs,
        { anchor: 1, focus: 9 },
        "left"
      ).list
    ).toEqual({ kind: "mixed" })
  })

  it("applies list and alignment metadata without changing authored text", () => {
    expect(
      applyTextParagraphStyleToRange(
        text,
        [],
        { anchor: 0, focus: text.length },
        { list: { kind: "bulleted", level: 0 }, align: "center" },
        "left"
      )
    ).toEqual([
      {
        start: 0,
        end: 5,
        style: {
          align: "center",
          list: { kind: "bulleted", level: 0 },
        },
      },
      {
        start: 6,
        end: 10,
        style: {
          align: "center",
          list: { kind: "bulleted", level: 0 },
        },
      },
    ])
  })

  it("ends an empty list item on Enter", () => {
    expect(
      editTextParagraphListByKey({
        key: "Enter",
        text: "Alpha\n",
        paragraphs: [
          {
            start: 6,
            end: 6,
            style: { list: { kind: "bulleted", level: 0 } },
          },
        ],
        selection: { anchor: 6, focus: 6 },
      })
    ).toEqual([])
  })

  it("outdents or removes a list marker at the paragraph start", () => {
    expect(
      editTextParagraphListByKey({
        key: "Backspace",
        text,
        paragraphs,
        selection: { anchor: 6, focus: 6 },
      })?.[1]?.style.list
    ).toEqual({ kind: "numbered", level: 0, start: 2 })
    expect(
      editTextParagraphListByKey({
        key: "Backspace",
        text,
        paragraphs,
        selection: { anchor: 0, focus: 0 },
      })?.find((paragraph) => paragraph.start === 0)?.style.list
    ).toBeUndefined()
  })

  it("indents every selected semantic list paragraph without text markers", () => {
    const edited = editTextParagraphListByKey({
      key: "Tab",
      text,
      paragraphs,
      selection: { anchor: 0, focus: 10 },
    })
    expect(edited?.map((paragraph) => paragraph.style.list?.level)).toEqual([
      1, 2,
    ])
    expect(text).toBe("Alpha\nBeta\n")
  })
})
