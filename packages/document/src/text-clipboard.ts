import { z } from "zod"

import {
  normalizeRichTextContent,
  normalizeTextLinks,
  normalizeTextParagraphs,
  normalizeTextRuns,
  richTextContentSchema,
  type RichTextContent,
  type TextLinkInput,
  type TextParagraphInput,
  type TextParagraphStyle,
  type TextRunInput,
  type TextRunStyle,
} from "./rich-text"
import type { TextNode } from "./schema"
import {
  normalizeTextSelection,
  replaceRichTextRange,
  type ReplaceRichTextRangeResult,
  type TextSelection,
} from "./text-range-editing"

export const STUDIO_RICH_TEXT_CLIPBOARD_KIND = "webmcp-studio/rich-text"
export const STUDIO_RICH_TEXT_CLIPBOARD_MIME =
  "application/x-webmcp-studio-rich-text+json"
export const STUDIO_RICH_TEXT_CLIPBOARD_HTML_ATTRIBUTE =
  "data-webmcp-studio-rich-text"
export const STUDIO_RICH_TEXT_CLIPBOARD_VERSION = 1

const MAX_CLIPBOARD_TEXT_LENGTH = 1_000_000
const MAX_CLIPBOARD_JSON_LENGTH = 5_000_000

const textClipboardPayloadSchema = z
  .object({
    kind: z.literal(STUDIO_RICH_TEXT_CLIPBOARD_KIND),
    version: z.literal(STUDIO_RICH_TEXT_CLIPBOARD_VERSION),
    text: z.string().max(MAX_CLIPBOARD_TEXT_LENGTH),
    content: richTextContentSchema,
  })
  .strict()

export type TextClipboardPayload = z.infer<typeof textClipboardPayloadSchema>

const textParagraphRanges = (text: string) => {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (offset === text.length || text[offset] === "\n") {
      ranges.push({ start, end: offset })
      start = offset + 1
    }
  }
  return ranges
}

const appendRun = (
  output: TextRunInput[],
  start: number,
  end: number,
  style: TextRunStyle
) => {
  if (start >= end) return
  output.push({ start, end, style: structuredClone(style) })
}

const nodeBaseRunStyle = (node: TextNode): TextRunStyle => ({
  color: node.color,
  fontFamily: node.fontFamily,
  fontSize: node.fontSize,
  fontWeight: node.fontWeight,
  italic: node.italic,
  decoration: node.decoration,
  lineHeight: node.lineHeight,
  letterSpacing: node.letterSpacing,
})

const materializedRunStyle = (style: TextRunStyle): TextRunStyle => {
  const {
    typographyStyleId: _typographyStyleId,
    paintStyleId: _paintStyleId,
    ...appearance
  } = style
  return appearance
}

const materializedRichTextContent = (
  text: string,
  content: RichTextContent
): RichTextContent => ({
  ...content,
  runs: normalizeTextRuns(
    text,
    content.runs.flatMap((run) => {
      const style = materializedRunStyle(run.style)
      return Object.keys(style).length ? [{ ...run, style }] : []
    })
  ),
})

const runStyleAt = (
  runs: ReturnType<typeof normalizeTextRuns>,
  offset: number,
  base: TextRunStyle
) =>
  materializedRunStyle({
    ...base,
    ...(runs.find((run) => run.start <= offset && offset < run.end)?.style ??
      {}),
  })

const paragraphStyleAt = (
  text: string,
  paragraphs: ReturnType<typeof normalizeTextParagraphs>,
  offset: number,
  baseAlign: TextNode["align"]
): TextParagraphStyle => {
  const range = textParagraphRanges(text).find(
    (candidate) => candidate.start <= offset && offset <= candidate.end
  )
  const style = range
    ? paragraphs.find(
        (paragraph) =>
          paragraph.start === range.start && paragraph.end === range.end
      )?.style
    : undefined
  return {
    align: style?.align ?? baseAlign,
    ...(style?.list ? { list: structuredClone(style.list) } : {}),
  }
}

export function createTextClipboardPayload(
  node: TextNode,
  selectionInput: TextSelection
): TextClipboardPayload | null {
  const selection = normalizeTextSelection(node.text, selectionInput)
  if (selection.collapsed) return null
  const content = normalizeRichTextContent(node.text, {
    runs: node.runs,
    paragraphs: node.paragraphs,
    links: node.links,
  })
  const text = node.text.slice(selection.start, selection.end)
  const boundaries = new Set([selection.start, selection.end])
  for (const run of content.runs) {
    if (run.start < selection.end && run.end > selection.start) {
      boundaries.add(Math.max(run.start, selection.start))
      boundaries.add(Math.min(run.end, selection.end))
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right)
  const runs: TextRunInput[] = []
  const base = nodeBaseRunStyle(node)
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index]!
    const end = ordered[index + 1]!
    appendRun(
      runs,
      start - selection.start,
      end - selection.start,
      runStyleAt(content.runs, start, base)
    )
  }

  const paragraphs: TextParagraphInput[] = textParagraphRanges(text).map(
    (range) => ({
      ...range,
      style: paragraphStyleAt(
        node.text,
        content.paragraphs,
        selection.start + range.start,
        node.align
      ),
    })
  )
  const links: TextLinkInput[] = content.links.flatMap((link) => {
    const start = Math.max(link.start, selection.start)
    const end = Math.min(link.end, selection.end)
    return start < end
      ? [
          {
            start: start - selection.start,
            end: end - selection.start,
            target: link.target,
            newTab: link.newTab,
          },
        ]
      : []
  })

  return {
    kind: STUDIO_RICH_TEXT_CLIPBOARD_KIND,
    version: STUDIO_RICH_TEXT_CLIPBOARD_VERSION,
    text,
    content: normalizeRichTextContent(text, { runs, paragraphs, links }),
  }
}

export const serializeTextClipboardPayload = (payload: TextClipboardPayload) =>
  JSON.stringify(payload)

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

export function serializeTextClipboardHtml(payload: TextClipboardPayload) {
  const encoded = encodeURIComponent(serializeTextClipboardPayload(payload))
  return `<span ${STUDIO_RICH_TEXT_CLIPBOARD_HTML_ATTRIBUTE}="${encoded}">${escapeHtml(payload.text).replaceAll("\n", "<br>")}</span>`
}

export function parseTextClipboardPayload(
  value: string
): TextClipboardPayload | null {
  if (!value || value.length > MAX_CLIPBOARD_JSON_LENGTH) return null
  try {
    const parsed = textClipboardPayloadSchema.parse(JSON.parse(value))
    const content = normalizeRichTextContent(parsed.text, parsed.content)
    return {
      ...parsed,
      content: materializedRichTextContent(parsed.text, content),
    }
  } catch {
    return null
  }
}

export function parseTextClipboardHtml(value: string) {
  if (!value || value.length > MAX_CLIPBOARD_JSON_LENGTH * 2) return null
  const match = value.match(
    new RegExp(`${STUDIO_RICH_TEXT_CLIPBOARD_HTML_ATTRIBUTE}="([^"]+)"`)
  )
  if (!match?.[1]) return null
  try {
    return parseTextClipboardPayload(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

const keepRangesOutsideInsertion = <
  Range extends { start: number; end: number },
>(
  ranges: readonly Range[],
  start: number,
  end: number
) =>
  ranges.flatMap((range) => {
    const output: Range[] = []
    if (range.start < start) {
      output.push({
        ...structuredClone(range),
        end: Math.min(range.end, start),
      })
    }
    if (range.end > end) {
      output.push({
        ...structuredClone(range),
        start: Math.max(range.start, end),
      })
    }
    return output.filter((candidate) => candidate.start < candidate.end)
  })

export function pasteTextClipboardPayload(
  text: string,
  contentInput: RichTextContent,
  selectionInput: TextSelection,
  payloadInput: TextClipboardPayload
): ReplaceRichTextRangeResult {
  const payload = textClipboardPayloadSchema.parse(payloadInput)
  const payloadContent = materializedRichTextContent(
    payload.text,
    normalizeRichTextContent(payload.text, payload.content)
  )
  const selection = normalizeTextSelection(text, selectionInput)
  const replaced = replaceRichTextRange(
    text,
    contentInput,
    selection,
    payload.text
  )
  const insertionStart = selection.start
  const insertionEnd = insertionStart + payload.text.length

  const runs = normalizeTextRuns(replaced.text, [
    ...keepRangesOutsideInsertion(
      replaced.content.runs,
      insertionStart,
      insertionEnd
    ),
    ...payloadContent.runs.map((run) => ({
      ...structuredClone(run),
      start: run.start + insertionStart,
      end: run.end + insertionStart,
    })),
  ])
  const links = normalizeTextLinks(replaced.text, [
    ...keepRangesOutsideInsertion(
      replaced.content.links,
      insertionStart,
      insertionEnd
    ),
    ...payloadContent.links.map((link) => ({
      ...structuredClone(link),
      start: link.start + insertionStart,
      end: link.end + insertionStart,
    })),
  ])

  const paragraphStyles = new Map(
    replaced.content.paragraphs.map((paragraph) => [
      `${paragraph.start}:${paragraph.end}`,
      structuredClone(paragraph.style),
    ])
  )
  const finalParagraphs = textParagraphRanges(replaced.text)
  for (const paragraph of payloadContent.paragraphs) {
    const probe = insertionStart + paragraph.start
    const range = finalParagraphs.find(
      (candidate) => candidate.start <= probe && probe <= candidate.end
    )
    if (range) {
      paragraphStyles.set(
        `${range.start}:${range.end}`,
        structuredClone(paragraph.style)
      )
    }
  }
  const paragraphs = normalizeTextParagraphs(
    replaced.text,
    finalParagraphs.flatMap((range) => {
      const style = paragraphStyles.get(`${range.start}:${range.end}`)
      return style ? [{ ...range, style }] : []
    })
  )

  return {
    ...replaced,
    content: { runs, paragraphs, links },
  }
}
