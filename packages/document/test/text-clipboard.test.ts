import { describe, expect, it } from "vitest"

import type { TextNode } from "../src/schema"
import {
  createTextClipboardPayload,
  parseTextClipboardHtml,
  parseTextClipboardPayload,
  pasteParsedTextClipboardPayload,
  serializeTextClipboardHtml,
  pasteTextClipboardPayload,
  serializeTextClipboardPayload,
} from "../src/text-clipboard"

const textNode = (overrides: Partial<TextNode> = {}): TextNode => ({
  id: "text-1",
  type: "text",
  name: "Text",
  x: 0,
  y: 0,
  width: 400,
  height: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  text: "Alpha\nBeta",
  color: "#111827",
  fontFamily: "Geist Variable",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  decoration: "none",
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "left",
  sizingMode: "auto_height",
  runs: [{ start: 0, end: 5, style: { fontWeight: 700 } }],
  paragraphs: [
    {
      start: 0,
      end: 5,
      style: { align: "center", list: { kind: "bulleted", level: 1 } },
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
  ...overrides,
})

describe("rich text clipboard", () => {
  it("materializes selected appearance and paragraph semantics", () => {
    const payload = createTextClipboardPayload(textNode(), {
      anchor: 0,
      focus: 10,
    })

    expect(payload).toMatchObject({
      kind: "webmcp-studio/rich-text",
      version: 1,
      text: "Alpha\nBeta",
    })
    expect(payload?.content.runs[0]).toMatchObject({
      start: 0,
      end: 5,
      style: { fontWeight: 700, fontFamily: "Geist Variable" },
    })
    expect(payload?.content.paragraphs[0]?.style).toEqual({
      align: "center",
      list: { kind: "bulleted", level: 1 },
    })
    expect(payload?.content.links[0]).toMatchObject({
      start: 6,
      end: 10,
      target: "https://example.com",
    })
  })

  it("materializes base emphasis and removes document-local style identities", () => {
    const payload = createTextClipboardPayload(
      textNode({
        italic: true,
        decoration: "underline",
        typographyStyleId: "typography-editorial",
        paintStyleId: "paint-brand",
        runs: [
          {
            start: 0,
            end: 5,
            style: {
              typographyStyleId: "typography-editorial",
              paintStyleId: "paint-brand",
              color: "#7C3AED",
              fontWeight: 700,
            },
          },
        ],
      }),
      { anchor: 0, focus: 10 }
    )

    expect(payload?.content.runs).not.toEqual([])
    for (const run of payload?.content.runs ?? []) {
      expect(run.style.typographyStyleId).toBeUndefined()
      expect(run.style.paintStyleId).toBeUndefined()
      expect(run.style.italic).toBe(true)
      expect(run.style.decoration).toBe("underline")
    }
  })

  it("strips resource identities from parsed and pasted portable payloads", () => {
    const portable = {
      kind: "webmcp-studio/rich-text" as const,
      version: 1 as const,
      text: "Styled",
      content: {
        runs: [
          {
            start: 0,
            end: 6,
            style: {
              typographyStyleId: "missing-typography-style",
              paintStyleId: "missing-paint-style",
              color: "#2563EB",
              fontWeight: 700,
            },
          },
        ],
        paragraphs: [],
        links: [],
      },
    }
    const parsed = parseTextClipboardPayload(JSON.stringify(portable))

    expect(parsed?.content.runs[0]?.style).toEqual({
      color: "#2563EB",
      fontWeight: 700,
    })

    const pasted = pasteTextClipboardPayload(
      "Target",
      { runs: [], paragraphs: [], links: [] },
      { anchor: 0, focus: 6 },
      portable
    )
    expect(pasted.content.runs[0]?.style).toEqual({
      color: "#2563EB",
      fontWeight: 700,
    })
  })

  it("rejects unknown, malformed, oversized, and unsafe payloads", () => {
    expect(parseTextClipboardPayload("not json")).toBeNull()
    expect(
      parseTextClipboardPayload(
        JSON.stringify({ kind: "another-app", version: 1 })
      )
    ).toBeNull()
    const payload = createTextClipboardPayload(textNode(), {
      anchor: 0,
      focus: 10,
    })!
    expect(
      parseTextClipboardPayload(serializeTextClipboardPayload(payload))
    ).toEqual(payload)
    expect(
      parseTextClipboardPayload(
        JSON.stringify({
          ...payload,
          content: {
            ...payload.content,
            links: [
              {
                start: 0,
                end: 5,
                target: "javascript:alert(1)",
                newTab: false,
              },
            ],
          },
        })
      )
    ).toBeNull()
    expect(parseTextClipboardPayload("x".repeat(5_000_001))).toBeNull()
    const html = serializeTextClipboardHtml(payload)
    expect(html).toContain("Alpha<br>Beta")
    expect(parseTextClipboardHtml(html)).toEqual(payload)
    expect(
      parseTextClipboardHtml('<span data-other="value">Alpha</span>')
    ).toBeNull()
  })

  it("pastes rich content over a selection without retaining target ranges", () => {
    const source = createTextClipboardPayload(textNode(), {
      anchor: 0,
      focus: 10,
    })!
    const target = textNode({
      text: "Before after",
      runs: [{ start: 0, end: 12, style: { italic: true } }],
      paragraphs: [],
      links: [],
    })
    const result = pasteTextClipboardPayload(
      target.text,
      {
        runs: target.runs,
        paragraphs: target.paragraphs,
        links: target.links,
      },
      { anchor: 0, focus: 6 },
      source
    )
    const parsedSource = parseTextClipboardPayload(
      serializeTextClipboardPayload(source)
    )
    if (!parsedSource) throw new Error("Expected parsed rich clipboard payload")
    const parsedResult = pasteParsedTextClipboardPayload(
      target.text,
      {
        runs: target.runs,
        paragraphs: target.paragraphs,
        links: target.links,
      },
      { anchor: 0, focus: 6 },
      parsedSource
    )

    expect(result.text).toBe("Alpha\nBeta after")
    expect(parsedResult).toEqual(result)
    expect(result.selection).toMatchObject({ anchor: 10, focus: 10 })
    expect(result.content.runs.some((run) => run.style.italic)).toBe(true)
    expect(result.content.runs[0]).toMatchObject({
      start: 0,
      end: 5,
      style: { fontWeight: 700, italic: false },
    })
    expect(result.content.paragraphs[0]?.style.list).toEqual({
      kind: "bulleted",
      level: 1,
    })
    expect(result.content.links[0]).toMatchObject({
      start: 6,
      end: 10,
      target: "https://example.com",
    })
  })
})
