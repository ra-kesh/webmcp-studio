import type { TextLink, TextRunStyle } from "./rich-text"
import type { TextNode, TextNodePatch } from "./schema"

const MIN_TEXT_DIMENSION = 1
const LAYOUT_PRECISION = 10
const LAYOUT_EPSILON = 0.05

export const TEXT_LAYOUT_MEASUREMENT_VERSION =
  "managed_font_rich_text_v3" as const

const TEXT_LAYOUT_KEYS = new Set<keyof TextNodePatch>([
  "text",
  "runs",
  "paragraphs",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "decoration",
  "lineHeight",
  "letterSpacing",
  "align",
  "direction",
  "verticalAlign",
  "textCase",
  "truncation",
  "maxLines",
  "sizingMode",
  "width",
  "height",
])

export type ResolvedTextStyle = {
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  decoration: "none" | "underline" | "line_through"
  lineHeight: number
  letterSpacing: number
}

export type ProjectedTextSegment = {
  text: string
  width: number
  sourceStart: number
  sourceEnd: number
  synthetic: boolean
  styled: boolean
  style: ResolvedTextStyle
  link?: TextLink
}

export type ProjectedTextLine = {
  text: string
  width: number
  height: number
  align: "left" | "center" | "right" | "justify"
  justifySpacing: number
  sourceStart: number
  sourceEnd: number
  segments: ProjectedTextSegment[]
}

export type TextLayoutProjection = {
  measurement: typeof TEXT_LAYOUT_MEASUREMENT_VERSION
  mode: TextNode["sizingMode"]
  lines: ProjectedTextLine[]
  displayText: string
  lineCount: number
  sourceLineCount: number
  truncated: boolean
  lineHeightPx: number
  intrinsicWidth: number
  requiredWidth: number
  requiredHeight: number
  overflowX: boolean
  overflowY: boolean
  overflow: boolean
}

const roundLayout = (value: number) =>
  Math.round(value * LAYOUT_PRECISION) / LAYOUT_PRECISION

function glyphAdvanceEm(glyph: string): number {
  if (glyph === "\t") return 1.12
  if (/\s/u.test(glyph)) return 0.28
  if (/[ilI|!.,:;'`]/u.test(glyph)) return 0.28
  if (/[mwMW@%&#]/u.test(glyph)) return 0.82
  if (/[A-Z]/u.test(glyph)) return 0.64
  if (/[0-9]/u.test(glyph)) return 0.56
  if (/[a-z]/u.test(glyph)) return 0.52
  if (/[-_+=/\\()[\]{}]/u.test(glyph)) return 0.42
  const codePoint = glyph.codePointAt(0) ?? 0
  if (codePoint >= 0x2e80 || codePoint > 0xffff) return 1
  return 0.62
}

function baseResolvedTextStyle(node: TextNode): ResolvedTextStyle {
  return {
    color: node.color,
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    italic: node.italic,
    decoration: node.decoration,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
  }
}

function resolveRunStyle(
  base: ResolvedTextStyle,
  override: TextRunStyle | undefined
): ResolvedTextStyle {
  return override ? { ...base, ...override } : base
}

export function estimateManagedTextWidth(
  value: string,
  typography: Pick<TextNode, "fontSize" | "fontWeight" | "letterSpacing">
): number {
  const glyphs = Array.from(value)
  if (!glyphs.length) return 0
  const weightAdjustment = 1 + (typography.fontWeight - 400) / 20_000
  const glyphWidth = glyphs.reduce(
    (sum, glyph) =>
      sum + glyphAdvanceEm(glyph) * typography.fontSize * weightAdjustment,
    0
  )
  return Math.max(
    0,
    roundLayout(
      glyphWidth + Math.max(0, glyphs.length - 1) * typography.letterSpacing
    )
  )
}

type StyledGlyph = {
  text: string
  sourceStart: number
  sourceEnd: number
  synthetic: boolean
  styled: boolean
  style: ResolvedTextStyle
  link?: TextLink
}

type HardParagraph = {
  start: number
  end: number
  glyphs: StyledGlyph[]
  align: ProjectedTextLine["align"]
}

function glyphWidth(glyph: StyledGlyph) {
  const weightAdjustment = 1 + (glyph.style.fontWeight - 400) / 20_000
  return glyphAdvanceEm(glyph.text) * glyph.style.fontSize * weightAdjustment
}

function rawGlyphSequenceWidth(
  glyphs: readonly StyledGlyph[],
  trimEnd = false
) {
  let end = glyphs.length
  if (trimEnd) {
    while (end > 0 && /[ \t]/u.test(glyphs[end - 1]?.text ?? "")) end -= 1
  }
  if (!end) return 0
  let width = 0
  for (let index = 0; index < end; index += 1) {
    const glyph = glyphs[index]
    if (!glyph) continue
    width += glyphWidth(glyph)
    if (index < end - 1) width += glyph.style.letterSpacing
  }
  return width
}

function measuredWidth(width: number) {
  return Math.max(0, roundLayout(width))
}

function measuredGlyphs(glyphs: readonly StyledGlyph[], trimEnd = false) {
  return measuredWidth(rawGlyphSequenceWidth(glyphs, trimEnd))
}

function sameStyle(left: ResolvedTextStyle, right: ResolvedTextStyle) {
  return (
    left.color === right.color &&
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.fontWeight === right.fontWeight &&
    left.italic === right.italic &&
    left.decoration === right.decoration &&
    left.lineHeight === right.lineHeight &&
    left.letterSpacing === right.letterSpacing
  )
}

function sameLink(left: TextLink | undefined, right: TextLink | undefined) {
  return (
    left?.target === right?.target &&
    left?.newTab === right?.newTab &&
    left?.start === right?.start &&
    left?.end === right?.end
  )
}

function segmentsForGlyphs(glyphs: readonly StyledGlyph[]) {
  const segments: ProjectedTextSegment[] = []
  for (const glyph of glyphs) {
    const previous = segments.at(-1)
    if (
      previous &&
      previous.synthetic === glyph.synthetic &&
      previous.styled === glyph.styled &&
      sameStyle(previous.style, glyph.style) &&
      sameLink(previous.link, glyph.link) &&
      (glyph.synthetic || previous.sourceEnd === glyph.sourceStart)
    ) {
      previous.text += glyph.text
      previous.sourceEnd = glyph.sourceEnd
      continue
    }
    segments.push({ ...glyph, width: 0 })
  }
  return segments.map((segment) => ({
    ...segment,
    width: estimateManagedTextWidth(segment.text, segment.style),
  }))
}

function projectedLine(
  glyphs: readonly StyledGlyph[],
  align: ProjectedTextLine["align"],
  fallback: Readonly<{ start: number; end: number; style: ResolvedTextStyle }>
): ProjectedTextLine {
  const sourceGlyphs = glyphs.filter((glyph) => !glyph.synthetic)
  const height = Math.max(
    fallback.style.fontSize * fallback.style.lineHeight,
    ...glyphs.map((glyph) => glyph.style.fontSize * glyph.style.lineHeight)
  )
  return {
    text: glyphs.map((glyph) => glyph.text).join(""),
    width: measuredGlyphs(glyphs, true),
    height: roundLayout(height),
    align,
    justifySpacing: 0,
    sourceStart: sourceGlyphs[0]?.sourceStart ?? fallback.start,
    sourceEnd: sourceGlyphs.at(-1)?.sourceEnd ?? fallback.end,
    segments: segmentsForGlyphs(glyphs),
  }
}

function justifyProjectedLine(line: ProjectedTextLine, maxWidth: number) {
  const visibleText = line.text.replace(/[ \t]+$/u, "")
  const gaps = Array.from(visibleText).filter((glyph) =>
    /[ \t]/u.test(glyph)
  ).length
  if (!gaps || line.width >= maxWidth) return line
  const justifySpacing = roundLayout((maxWidth - line.width) / gaps)
  return {
    ...line,
    width: roundLayout(line.width + justifySpacing * gaps),
    justifySpacing,
    segments: line.segments.map((segment) => ({
      ...segment,
      width: roundLayout(
        segment.width +
          justifySpacing *
            Array.from(segment.text).filter((glyph) => /[ \t]/u.test(glyph))
              .length
      ),
    })),
  }
}

function wrapStyledGlyphs(
  paragraph: HardParagraph,
  maxWidth: number,
  baseStyle: ResolvedTextStyle
) {
  if (!paragraph.glyphs.length) {
    return [
      projectedLine([], paragraph.align, {
        start: paragraph.start,
        end: paragraph.end,
        style: baseStyle,
      }),
    ]
  }
  const tokens: StyledGlyph[][] = []
  for (const glyph of paragraph.glyphs) {
    const whitespace = /^\s$/u.test(glyph.text)
    const current = tokens.at(-1)
    if (current && /^\s$/u.test(current[0]?.text ?? "") === whitespace) {
      current.push(glyph)
    } else {
      tokens.push([glyph])
    }
  }
  const lines: StyledGlyph[][] = []
  let line: StyledGlyph[] = []
  // Keep the unrounded width beside the line. Each token and fallback glyph is
  // measured once; only the existing one-decimal comparison is repeated.
  let lineWidth = 0
  const pushLine = () => {
    lines.push(line)
    line = []
    lineWidth = 0
  }
  const appendToken = (token: readonly StyledGlyph[], tokenWidth: number) => {
    if (line.length) {
      lineWidth += line.at(-1)!.style.letterSpacing
    }
    lineWidth += tokenWidth
    for (const glyph of token) line.push(glyph)
  }
  const appendGlyph = (glyph: StyledGlyph) => {
    if (line.length) {
      lineWidth += line.at(-1)!.style.letterSpacing
    }
    lineWidth += glyphWidth(glyph)
    line.push(glyph)
  }
  for (const token of tokens) {
    const tokenWidth = rawGlyphSequenceWidth(token)
    const candidateWidth =
      lineWidth +
      (line.length ? line.at(-1)!.style.letterSpacing : 0) +
      tokenWidth
    if (measuredWidth(candidateWidth) <= maxWidth) {
      appendToken(token, tokenWidth)
      continue
    }
    const whitespace = /^\s$/u.test(token[0]?.text ?? "")
    if (line.length && whitespace) {
      appendToken(token, tokenWidth)
      pushLine()
      continue
    }
    if (line.length) pushLine()
    if (measuredWidth(tokenWidth) <= maxWidth) {
      appendToken(token, tokenWidth)
      continue
    }
    for (const glyph of token) {
      const nextWidth =
        lineWidth +
        (line.length ? line.at(-1)!.style.letterSpacing : 0) +
        glyphWidth(glyph)
      if (line.length && measuredWidth(nextWidth) > maxWidth) pushLine()
      appendGlyph(glyph)
    }
  }
  if (line.length || !lines.length) lines.push(line)
  return lines.map((glyphs, index) => {
    const projected = projectedLine(glyphs, paragraph.align, {
      start: paragraph.start,
      end: paragraph.end,
      style: baseStyle,
    })
    return paragraph.align === "justify" && index < lines.length - 1
      ? justifyProjectedLine(projected, maxWidth)
      : projected
  })
}

function paragraphRanges(text: string) {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === "\n") {
      ranges.push({ start, end: index })
      start = index + 1
    }
  }
  return ranges
}

function listPrefix(
  style: TextNode["paragraphs"][number]["style"] | undefined
) {
  if (!style?.list) return ""
  const indent = "  ".repeat(style.list.level)
  return style.list.kind === "bulleted"
    ? `${indent}• `
    : `${indent}${style.list.start}. `
}

function styledParagraphs(node: TextNode): HardParagraph[] {
  const baseStyle = baseResolvedTextStyle(node)
  let runIndex = 0
  let linkIndex = 0
  return paragraphRanges(node.text).map((range) => {
    const annotation = node.paragraphs.find(
      (paragraph) =>
        paragraph.start === range.start && paragraph.end === range.end
    )
    const glyphs: StyledGlyph[] = []
    const prefix = listPrefix(annotation?.style)
    for (const glyph of Array.from(prefix)) {
      glyphs.push({
        text: glyph,
        sourceStart: range.start,
        sourceEnd: range.start,
        synthetic: true,
        styled: false,
        style: baseStyle,
      })
    }
    for (let offset = range.start; offset < range.end;) {
      while (node.runs[runIndex] && node.runs[runIndex]!.end <= offset) {
        runIndex += 1
      }
      while (node.links[linkIndex] && node.links[linkIndex]!.end <= offset) {
        linkIndex += 1
      }
      const authoredText = String.fromCodePoint(
        node.text.codePointAt(offset) ?? 0
      )
      const end = offset + authoredText.length
      const textCase = node.textCase ?? "original"
      const isTitleStart =
        offset === 0 ||
        /[^\p{L}\p{N}]/u.test(node.text.slice(0, offset).at(-1) ?? "")
      const text =
        textCase === "uppercase"
          ? authoredText.toLocaleUpperCase()
          : textCase === "lowercase"
            ? authoredText.toLocaleLowerCase()
            : textCase === "title"
              ? isTitleStart
                ? authoredText.toLocaleUpperCase()
                : authoredText.toLocaleLowerCase()
              : authoredText
      const run = node.runs[runIndex]
      const link = node.links[linkIndex]
      const projectedGlyphs = text === authoredText ? [text] : Array.from(text)
      for (const projectedGlyph of projectedGlyphs) {
        glyphs.push({
          text: projectedGlyph,
          sourceStart: offset,
          sourceEnd: end,
          synthetic: false,
          styled: Boolean(run && run.start <= offset && run.end >= end),
          style: resolveRunStyle(
            baseStyle,
            run && run.start <= offset && run.end >= end ? run.style : undefined
          ),
          ...(link && link.start <= offset && link.end >= end ? { link } : {}),
        })
      }
      offset = end
    }
    return {
      ...range,
      glyphs,
      align: annotation?.style.align ?? node.align,
    }
  })
}

function truncateLineWithEllipsis(
  line: ProjectedTextLine,
  maxWidth: number,
  fallbackStyle: ResolvedTextStyle
): ProjectedTextLine {
  const glyphs: StyledGlyph[] = line.segments.flatMap((segment) =>
    Array.from(segment.text).map((text) => ({
      text,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      synthetic: segment.synthetic,
      styled: segment.styled,
      style: segment.style,
      ...(segment.link ? { link: segment.link } : {}),
    }))
  )
  while (glyphs.length && /\s/u.test(glyphs.at(-1)?.text ?? "")) glyphs.pop()
  const sourceEnd = glyphs.at(-1)?.sourceEnd ?? line.sourceEnd
  const ellipsis: StyledGlyph = {
    text: "…",
    sourceStart: sourceEnd,
    sourceEnd,
    synthetic: true,
    styled: false,
    style: glyphs.at(-1)?.style ?? fallbackStyle,
  }
  while (glyphs.length && measuredGlyphs([...glyphs, ellipsis]) > maxWidth) {
    glyphs.pop()
  }
  const projected = projectedLine([...glyphs, ellipsis], line.align, {
    start: line.sourceStart,
    end: line.sourceEnd,
    style: fallbackStyle,
  })
  return line.align === "justify"
    ? { ...projected, align: "justify", justifySpacing: 0 }
    : projected
}

export function resolveTextDirection(node: TextNode): "ltr" | "rtl" {
  if (node.direction === "ltr" || node.direction === "rtl")
    return node.direction
  const firstStrong = Array.from(node.text).find((glyph) =>
    /[\p{L}\p{N}]/u.test(glyph)
  )
  return firstStrong && /[\u0590-\u08ff\ufb1d-\ufefc]/u.test(firstStrong)
    ? "rtl"
    : "ltr"
}

export function projectTextLayout(node: TextNode): TextLayoutProjection {
  const baseStyle = baseResolvedTextStyle(node)
  const paragraphs = styledParagraphs(node)
  const unwrappedLines = paragraphs.map((paragraph) =>
    projectedLine(paragraph.glyphs, paragraph.align, {
      start: paragraph.start,
      end: paragraph.end,
      style: baseStyle,
    })
  )
  const intrinsicWidth = Math.max(
    MIN_TEXT_DIMENSION,
    ...unwrappedLines.map((line) => line.width)
  )
  const sourceLines =
    node.sizingMode === "auto_width"
      ? unwrappedLines
      : paragraphs.flatMap((paragraph) =>
          wrapStyledGlyphs(paragraph, node.width, baseStyle)
        )
  const lineHeightPx = roundLayout(node.fontSize * node.lineHeight)
  const requiredWidth = Math.max(
    MIN_TEXT_DIMENSION,
    ...sourceLines.map((line) => line.width)
  )
  const requiredHeight = Math.max(
    MIN_TEXT_DIMENSION,
    roundLayout(sourceLines.reduce((sum, line) => sum + line.height, 0))
  )
  const overflowX = requiredWidth - node.width > LAYOUT_EPSILON
  const overflowY = requiredHeight - node.height > LAYOUT_EPSILON
  let heightLineLimit = sourceLines.length
  if (node.sizingMode === "fixed") {
    let measuredHeight = 0
    heightLineLimit = 0
    for (const line of sourceLines) {
      if (measuredHeight + line.height > node.height + LAYOUT_EPSILON) break
      measuredHeight += line.height
      heightLineLimit += 1
    }
    heightLineLimit = Math.max(1, heightLineLimit)
  }
  const visibleLineLimit = Math.min(
    sourceLines.length,
    node.maxLines ?? sourceLines.length,
    heightLineLimit
  )
  const truncated = visibleLineLimit < sourceLines.length
  const lines = sourceLines.slice(0, visibleLineLimit)
  if (truncated && (node.truncation ?? "clip") === "ellipsis" && lines.length) {
    lines[lines.length - 1] = truncateLineWithEllipsis(
      lines[lines.length - 1]!,
      node.width,
      baseStyle
    )
  }

  return {
    measurement: TEXT_LAYOUT_MEASUREMENT_VERSION,
    mode: node.sizingMode,
    lines,
    displayText: lines.map((line) => line.text).join("\n"),
    lineCount: lines.length,
    sourceLineCount: sourceLines.length,
    truncated,
    lineHeightPx,
    intrinsicWidth: roundLayout(intrinsicWidth),
    requiredWidth: roundLayout(requiredWidth),
    requiredHeight,
    overflowX,
    overflowY,
    overflow: node.sizingMode === "fixed" && (overflowX || overflowY),
  }
}

export function projectTextLayoutAfterPatch(
  node: TextNode,
  patch: TextNodePatch
): TextLayoutProjection {
  return projectTextLayout({ ...node, ...patch })
}

export function hasTextLayoutChange(patch: TextNodePatch): boolean {
  return Object.keys(patch).some((key) =>
    TEXT_LAYOUT_KEYS.has(key as keyof TextNodePatch)
  )
}

export function deriveTextGeometryPatch(
  node: TextNode,
  patch: TextNodePatch
): Partial<Pick<TextNode, "width" | "height">> {
  if (!hasTextLayoutChange(patch)) return {}
  const candidate = { ...node, ...patch }
  const layout = projectTextLayout(candidate)
  if (candidate.sizingMode === "auto_width") {
    return {
      width: layout.intrinsicWidth,
      height: layout.requiredHeight,
    }
  }
  if (candidate.sizingMode === "auto_height") {
    return { height: layout.requiredHeight }
  }
  return {}
}

export function applyTextLayoutPatch(
  node: TextNode,
  patch: TextNodePatch
): TextNode {
  return {
    ...node,
    ...patch,
    ...deriveTextGeometryPatch(node, patch),
    id: node.id,
    type: "text",
  }
}

export function repairTextOverflowPatch(node: TextNode): TextNodePatch {
  const current = projectTextLayout(node)
  if (node.sizingMode !== "fixed" || !current.overflow) {
    return {}
  }
  const sizingMode = current.overflowX ? "auto_width" : "auto_height"
  return {
    sizingMode,
    ...deriveTextGeometryPatch(node, { sizingMode }),
  }
}
