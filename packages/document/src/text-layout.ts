import type { TextNode, TextNodePatch } from "./schema"

const MIN_TEXT_DIMENSION = 1
const LAYOUT_PRECISION = 10
const LAYOUT_EPSILON = 0.05

export const TEXT_LAYOUT_MEASUREMENT_VERSION =
  "managed_font_approximation_v1" as const

const TEXT_LAYOUT_KEYS = new Set<keyof TextNodePatch>([
  "text",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "sizingMode",
  "width",
  "height",
])

export type ProjectedTextLine = {
  text: string
  width: number
}

export type TextLayoutProjection = {
  measurement: typeof TEXT_LAYOUT_MEASUREMENT_VERSION
  mode: TextNode["sizingMode"]
  lines: ProjectedTextLine[]
  displayText: string
  lineCount: number
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

function splitTokenToWidth(
  token: string,
  maxWidth: number,
  typography: Pick<TextNode, "fontSize" | "fontWeight" | "letterSpacing">
): string[] {
  const chunks: string[] = []
  let chunk = ""
  for (const glyph of Array.from(token)) {
    const candidate = `${chunk}${glyph}`
    if (chunk && estimateManagedTextWidth(candidate, typography) > maxWidth) {
      chunks.push(chunk)
      chunk = glyph
    } else {
      chunk = candidate
    }
  }
  if (chunk || !chunks.length) chunks.push(chunk)
  return chunks
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  typography: Pick<TextNode, "fontSize" | "fontWeight" | "letterSpacing">
): ProjectedTextLine[] {
  if (!paragraph) return [{ text: "", width: 0 }]
  const tokens = paragraph.split(/(\s+)/u).filter(Boolean)
  const lines: string[] = []
  let line = ""

  const pushLine = () => {
    lines.push(line)
    line = ""
  }

  for (const token of tokens) {
    const candidate = `${line}${token}`
    if (estimateManagedTextWidth(candidate, typography) <= maxWidth) {
      line = candidate
      continue
    }

    if (line && /^\s+$/u.test(token)) {
      // Keep the original delimiter at the soft-wrap edge. Moving it to the
      // next line creates visible indentation when projected lines are rendered
      // with preserved whitespace.
      line = candidate
      pushLine()
      continue
    }

    if (line) pushLine()
    if (estimateManagedTextWidth(token, typography) <= maxWidth) {
      line = token
      continue
    }

    const chunks = splitTokenToWidth(token, maxWidth, typography)
    for (const [index, chunk] of chunks.entries()) {
      if (index < chunks.length - 1) lines.push(chunk)
      else line = chunk
    }
  }
  if (line || !lines.length) lines.push(line)
  return lines.map((text) => ({
    text,
    width: estimateManagedTextWidth(text.replace(/[ \t]+$/u, ""), typography),
  }))
}

function explicitLines(
  text: string,
  typography: Pick<TextNode, "fontSize" | "fontWeight" | "letterSpacing">
): ProjectedTextLine[] {
  return text.split("\n").map((line) => ({
    text: line,
    width: estimateManagedTextWidth(line, typography),
  }))
}

export function projectTextLayout(node: TextNode): TextLayoutProjection {
  const typography = {
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    letterSpacing: node.letterSpacing,
  }
  const unwrappedLines = explicitLines(node.text, typography)
  const intrinsicWidth = Math.max(
    MIN_TEXT_DIMENSION,
    ...unwrappedLines.map((line) => line.width)
  )
  const lines =
    node.sizingMode === "auto_width"
      ? unwrappedLines
      : node.text
          .split("\n")
          .flatMap((paragraph) =>
            wrapParagraph(paragraph, node.width, typography)
          )
  const lineHeightPx = roundLayout(node.fontSize * node.lineHeight)
  const requiredWidth = Math.max(
    MIN_TEXT_DIMENSION,
    ...lines.map((line) => line.width)
  )
  const requiredHeight = Math.max(
    MIN_TEXT_DIMENSION,
    roundLayout(lines.length * lineHeightPx)
  )
  const overflowX = requiredWidth - node.width > LAYOUT_EPSILON
  const overflowY = requiredHeight - node.height > LAYOUT_EPSILON

  return {
    measurement: TEXT_LAYOUT_MEASUREMENT_VERSION,
    mode: node.sizingMode,
    lines,
    displayText: lines.map((line) => line.text).join("\n"),
    lineCount: lines.length,
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
