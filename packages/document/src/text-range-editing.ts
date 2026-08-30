import {
  normalizeTextRuns,
  normalizeTextLinks,
  normalizeTextParagraphs,
  RichTextRangeError,
  textRunStyleSchema,
  type RichTextContent,
  type TextLink,
  type TextLinkInput,
  type TextParagraph,
  type TextParagraphInput,
  type TextRun,
  type TextRunInput,
  type TextRunStyle,
} from "./rich-text"
import type { TextNode } from "./schema"
import type { ResolvedTextStyle } from "./text-layout"

export type TextSelection = Readonly<{
  anchor: number
  focus: number
}>

export type NormalizedTextSelection = Readonly<{
  anchor: number
  focus: number
  start: number
  end: number
  collapsed: boolean
  direction: "forward" | "backward" | "none"
}>

export type TextSelectionSharedValue<Value> =
  Readonly<{ kind: "value"; value: Value }> | Readonly<{ kind: "mixed" }>

export type TextSelectionStyleState = {
  [Key in keyof ResolvedTextStyle]: TextSelectionSharedValue<
    ResolvedTextStyle[Key]
  >
}

export type TextSelectionLinkState =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "mixed" }>
  | Readonly<{
      kind: "value"
      target: string
      newTab: boolean
    }>

export type TextRunStylePatch = {
  [Key in keyof TextRunStyle]?: TextRunStyle[Key] | null
}

const styleKeys = [
  "typographyStyleId",
  "paintStyleId",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "decoration",
  "lineHeight",
  "letterSpacing",
] as const satisfies readonly (keyof TextRunStyle)[]

const typographyStyleKeys = new Set<keyof TextRunStyle>([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "decoration",
  "lineHeight",
  "letterSpacing",
])

const paintStyleKeys = new Set<keyof TextRunStyle>(["color"])

const splitsSurrogatePair = (text: string, offset: number) => {
  if (offset <= 0 || offset >= text.length) return false
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return (
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  )
}

const assertTextOffset = (text: string, offset: number, label: string) => {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new RichTextRangeError(
      `${label} ${offset} must be a UTF-16 offset between 0 and ${text.length}`
    )
  }
  if (splitsSurrogatePair(text, offset)) {
    throw new RichTextRangeError(`${label} ${offset} splits a surrogate pair`)
  }
}

export function normalizeTextSelection(
  text: string,
  selection: TextSelection
): NormalizedTextSelection {
  assertTextOffset(text, selection.anchor, "Selection anchor")
  assertTextOffset(text, selection.focus, "Selection focus")
  const start = Math.min(selection.anchor, selection.focus)
  const end = Math.max(selection.anchor, selection.focus)
  return {
    ...selection,
    start,
    end,
    collapsed: start === end,
    direction:
      selection.anchor === selection.focus
        ? "none"
        : selection.anchor < selection.focus
          ? "forward"
          : "backward",
  }
}

export function textNodeBaseStyle(node: TextNode): ResolvedTextStyle {
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

const canonicalStyle = (style: Readonly<TextRunStyle>): TextRunStyle => {
  const canonical: TextRunStyle = {}
  for (const key of styleKeys) {
    const value = style[key]
    if (value !== undefined) {
      Object.assign(canonical, { [key]: value })
    }
  }
  return canonical
}

const sameStyle = (
  left: Readonly<TextRunStyle>,
  right: Readonly<TextRunStyle>
) => styleKeys.every((key) => Object.is(left[key], right[key]))

const appendRun = (
  runs: TextRunInput[],
  start: number,
  end: number,
  style: Readonly<TextRunStyle>
) => {
  if (start >= end || Object.keys(style).length === 0) return
  const canonical = canonicalStyle(style)
  const previous = runs.at(-1)
  if (
    previous &&
    previous.end === start &&
    sameStyle(previous.style, canonical)
  ) {
    previous.end = end
    return
  }
  runs.push({ start, end, style: canonical })
}

const normalizedRunsAndBoundaries = (
  text: string,
  input: readonly TextRunInput[],
  extraBoundaries: readonly number[] = []
) => {
  const runs = normalizeTextRuns(text, input)
  const boundaries = new Set([0, text.length, ...extraBoundaries])
  for (const run of runs) {
    boundaries.add(run.start)
    boundaries.add(run.end)
  }
  return {
    runs,
    boundaries: [...boundaries].sort((left, right) => left - right),
  }
}

const overrideAtCharacter = (
  runs: readonly TextRun[],
  offset: number
): TextRunStyle => {
  const run = runs.find(
    (candidate) => candidate.start <= offset && offset < candidate.end
  )
  return run ? canonicalStyle(run.style) : {}
}

const previousCodePointStart = (text: string, offset: number) => {
  if (offset <= 0) return 0
  const previous = offset - 1
  return splitsSurrogatePair(text, previous) ? previous - 1 : previous
}

/**
 * Resolves the authored override inherited by newly typed text. At an existing
 * paragraph start the following character wins, so prepending text does not
 * unexpectedly adopt the previous paragraph's appearance. Everywhere else the
 * preceding insertion edge wins, matching common design-editor behavior.
 */
export function textRunOverrideAtCaret(
  text: string,
  input: readonly TextRunInput[],
  caret: number
): TextRunStyle {
  const selection = normalizeTextSelection(text, {
    anchor: caret,
    focus: caret,
  })
  const runs = normalizeTextRuns(text, input)
  if (text.length === 0) return {}
  if (selection.start === 0) return overrideAtCharacter(runs, 0)
  if (text[selection.start - 1] === "\n" && selection.start < text.length) {
    return overrideAtCharacter(runs, selection.start)
  }
  return overrideAtCharacter(
    runs,
    previousCodePointStart(text, selection.start)
  )
}

const effectiveStyle = (
  base: Readonly<ResolvedTextStyle>,
  override: Readonly<TextRunStyle>
): ResolvedTextStyle => ({ ...base, ...override })

const valueState = <Value>(
  values: readonly Value[]
): TextSelectionSharedValue<Value> => {
  const first = values[0]
  if (first === undefined) {
    throw new RichTextRangeError("A text style state requires one value")
  }
  return values.every((value) => Object.is(value, first))
    ? { kind: "value", value: first }
    : { kind: "mixed" }
}

export function resolveTextSelectionStyle(
  text: string,
  input: readonly TextRunInput[],
  selectionInput: TextSelection,
  base: Readonly<ResolvedTextStyle>,
  typingOverride?: Readonly<TextRunStyle>
): TextSelectionStyleState {
  const selection = normalizeTextSelection(text, selectionInput)
  const normalized = normalizedRunsAndBoundaries(text, input, [
    selection.start,
    selection.end,
  ])
  const styles: ResolvedTextStyle[] = []
  if (selection.collapsed) {
    styles.push(
      effectiveStyle(
        base,
        typingOverride ??
          textRunOverrideAtCaret(text, normalized.runs, selection.start)
      )
    )
  } else {
    for (let index = 0; index < normalized.boundaries.length - 1; index += 1) {
      const start = normalized.boundaries[index]!
      const end = normalized.boundaries[index + 1]!
      if (start >= selection.end || end <= selection.start) continue
      styles.push(
        effectiveStyle(base, overrideAtCharacter(normalized.runs, start))
      )
    }
  }
  return {
    color: valueState(styles.map((style) => style.color)),
    fontFamily: valueState(styles.map((style) => style.fontFamily)),
    fontSize: valueState(styles.map((style) => style.fontSize)),
    fontWeight: valueState(styles.map((style) => style.fontWeight)),
    italic: valueState(styles.map((style) => style.italic)),
    decoration: valueState(styles.map((style) => style.decoration)),
    lineHeight: valueState(styles.map((style) => style.lineHeight)),
    letterSpacing: valueState(styles.map((style) => style.letterSpacing)),
  }
}

const sameLink = (
  left: Pick<TextLink, "target" | "newTab">,
  right: Pick<TextLink, "target" | "newTab">
) => left.target === right.target && left.newTab === right.newTab

const linkAtCaret = (links: readonly TextLink[], caret: number) =>
  links.find((link) => link.start < caret && caret <= link.end)

export function resolveTextSelectionLink(
  text: string,
  input: readonly TextLinkInput[],
  selectionInput: TextSelection
): TextSelectionLinkState {
  const selection = normalizeTextSelection(text, selectionInput)
  const links = normalizeTextLinks(text, input)
  if (selection.collapsed) {
    const link = linkAtCaret(links, selection.start)
    return link
      ? { kind: "value", target: link.target, newTab: link.newTab }
      : { kind: "none" }
  }

  const boundaries = new Set([selection.start, selection.end])
  for (const link of links) {
    if (link.start < selection.end && link.end > selection.start) {
      boundaries.add(Math.max(link.start, selection.start))
      boundaries.add(Math.min(link.end, selection.end))
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right)
  const values: Array<Pick<TextLink, "target" | "newTab"> | null> = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index]!
    const end = ordered[index + 1]!
    if (start >= end) continue
    values.push(
      links.find((link) => link.start <= start && end <= link.end) ?? null
    )
  }
  if (values.every((value) => value === null)) return { kind: "none" }
  const first = values[0]
  if (
    first &&
    values.every((value) => value !== null && sameLink(first, value))
  ) {
    return { kind: "value", target: first.target, newTab: first.newTab }
  }
  return { kind: "mixed" }
}

export function applyTextLinkToRange(
  text: string,
  input: readonly TextLinkInput[],
  selectionInput: TextSelection,
  value: Pick<TextLinkInput, "target" | "newTab"> | null
): TextLink[] {
  let selection = normalizeTextSelection(text, selectionInput)
  const links = normalizeTextLinks(text, input)
  if (selection.collapsed) {
    const current = linkAtCaret(links, selection.start)
    if (!current) {
      throw new RichTextRangeError("Select text before adding a link")
    }
    selection = normalizeTextSelection(text, {
      anchor: current.start,
      focus: current.end,
    })
  }

  const output: TextLinkInput[] = []
  for (const link of links) {
    appendLink(output, link, link.start, Math.min(link.end, selection.start))
    if (link.end > selection.end) {
      appendLink(output, link, Math.max(link.start, selection.end), link.end)
    }
  }
  if (value) {
    appendLink(output, value, selection.start, selection.end)
  }
  return normalizeTextLinks(text, output)
}

const parsePatch = (patch: Readonly<TextRunStylePatch>) => {
  if (Object.keys(patch).length === 0) {
    throw new RichTextRangeError("A text style patch must change a property")
  }
  const values: TextRunStyle = {}
  for (const key of styleKeys) {
    const value = patch[key]
    if (value !== undefined && value !== null) {
      Object.assign(values, { [key]: value })
    }
  }
  if (Object.keys(values).length > 0) textRunStyleSchema.parse(values)
  return patch
}

const patchedStyle = (
  style: Readonly<TextRunStyle>,
  patch: Readonly<TextRunStylePatch>
) => {
  const next = { ...style }
  const patchKeys = Object.keys(patch) as (keyof TextRunStyle)[]
  if (
    next.typographyStyleId &&
    patch.typographyStyleId === undefined &&
    patchKeys.some((key) => typographyStyleKeys.has(key))
  ) {
    delete next.typographyStyleId
  }
  if (
    next.paintStyleId &&
    patch.paintStyleId === undefined &&
    patchKeys.some((key) => paintStyleKeys.has(key))
  ) {
    delete next.paintStyleId
  }
  for (const key of styleKeys) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else Object.assign(next, { [key]: value })
  }
  return canonicalStyle(next)
}

export function patchTextRunStyle(
  style: Readonly<TextRunStyle>,
  patchInput: Readonly<TextRunStylePatch>
): TextRunStyle {
  return patchedStyle(style, parsePatch(patchInput))
}

export function applyTextStyleToRange(
  text: string,
  input: readonly TextRunInput[],
  selectionInput: TextSelection,
  patchInput: Readonly<TextRunStylePatch>
): TextRun[] {
  const selection = normalizeTextSelection(text, selectionInput)
  if (selection.collapsed) {
    throw new RichTextRangeError(
      "Applying a stored text style requires a non-collapsed selection"
    )
  }
  const patch = parsePatch(patchInput)
  const normalized = normalizedRunsAndBoundaries(text, input, [
    selection.start,
    selection.end,
  ])
  const output: TextRunInput[] = []
  for (let index = 0; index < normalized.boundaries.length - 1; index += 1) {
    const start = normalized.boundaries[index]!
    const end = normalized.boundaries[index + 1]!
    const current = overrideAtCharacter(normalized.runs, start)
    const style =
      start < selection.end && end > selection.start
        ? patchedStyle(current, patch)
        : current
    appendRun(output, start, end, style)
  }
  return normalizeTextRuns(text, output)
}

export type ReplaceTextRunRangeResult = Readonly<{
  text: string
  runs: readonly TextRun[]
  selection: NormalizedTextSelection
}>

export type TextReplacement = Readonly<{
  selection: TextSelection
  replacement: string
}>

/** Returns the smallest single replacement that transforms before into after. */
export function deriveTextReplacement(
  before: string,
  after: string
): TextReplacement {
  let start = 0
  const sharedLength = Math.min(before.length, after.length)
  while (start < sharedLength && before[start] === after[start]) start += 1
  if (splitsSurrogatePair(before, start) || splitsSurrogatePair(after, start)) {
    start -= 1
  }

  let beforeEnd = before.length
  let afterEnd = after.length
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  if (
    splitsSurrogatePair(before, beforeEnd) ||
    splitsSurrogatePair(after, afterEnd)
  ) {
    beforeEnd += 1
    afterEnd += 1
  }
  return {
    selection: { anchor: start, focus: beforeEnd },
    replacement: after.slice(start, afterEnd),
  }
}

export function replaceTextRunRange(
  text: string,
  input: readonly TextRunInput[],
  selectionInput: TextSelection,
  replacement: string,
  insertionOverride?: Readonly<TextRunStyle>
): ReplaceTextRunRangeResult {
  const selection = normalizeTextSelection(text, selectionInput)
  const runs = normalizeTextRuns(text, input)
  const nextText =
    text.slice(0, selection.start) + replacement + text.slice(selection.end)
  const delta = replacement.length - (selection.end - selection.start)
  const output: TextRunInput[] = []

  for (const run of runs) {
    appendRun(output, run.start, Math.min(run.end, selection.start), run.style)
    if (run.end > selection.end) {
      appendRun(
        output,
        Math.max(run.start, selection.end) + delta,
        run.end + delta,
        run.style
      )
    }
  }

  if (replacement.length > 0) {
    const inherited =
      insertionOverride ?? textRunOverrideAtCaret(text, runs, selection.start)
    appendRun(
      output,
      selection.start,
      selection.start + replacement.length,
      inherited
    )
  }

  const caret = selection.start + replacement.length
  return {
    text: nextText,
    runs: normalizeTextRuns(nextText, output),
    selection: normalizeTextSelection(nextText, {
      anchor: caret,
      focus: caret,
    }),
  }
}

const paragraphBounds = (text: string) => {
  const bounds: Array<{ start: number; end: number }> = []
  let start = 0
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (offset === text.length || text[offset] === "\n") {
      bounds.push({ start, end: offset })
      start = offset + 1
    }
  }
  return bounds
}

const paragraphStyleAt = (
  text: string,
  paragraphs: readonly TextParagraph[],
  offset: number
) => {
  const bounds = paragraphBounds(text).find(
    (candidate) =>
      candidate.start <= offset &&
      (offset <= candidate.end || candidate.end === text.length)
  )
  if (!bounds) return undefined
  return paragraphs.find(
    (paragraph) =>
      paragraph.start === bounds.start && paragraph.end === bounds.end
  )?.style
}

const remapParagraphs = (
  text: string,
  nextText: string,
  input: readonly TextParagraphInput[],
  selection: NormalizedTextSelection,
  replacementLength: number
) => {
  const paragraphs = normalizeTextParagraphs(text, input)
  if (!paragraphs.length) return []
  const delta = replacementLength - (selection.end - selection.start)
  const output: TextParagraphInput[] = []
  for (const bounds of paragraphBounds(nextText)) {
    const sourceOffset =
      bounds.start < selection.start
        ? bounds.start
        : bounds.start >= selection.start + replacementLength
          ? bounds.start - delta
          : selection.start
    const style = paragraphStyleAt(
      text,
      paragraphs,
      Math.min(sourceOffset, text.length)
    )
    if (style) output.push({ ...bounds, style: structuredClone(style) })
  }
  return normalizeTextParagraphs(nextText, output)
}

const appendLink = (
  output: TextLinkInput[],
  link: Pick<TextLinkInput, "target" | "newTab">,
  start: number,
  end: number
) => {
  if (start >= end) return
  const previous = output.at(-1)
  if (
    previous &&
    previous.end === start &&
    previous.target === link.target &&
    previous.newTab === link.newTab
  ) {
    previous.end = end
    return
  }
  output.push({
    start,
    end,
    target: link.target,
    newTab: link.newTab,
  })
}

const remapLinks = (
  text: string,
  nextText: string,
  input: readonly TextLinkInput[],
  selection: NormalizedTextSelection,
  replacementLength: number
): TextLink[] => {
  const links = normalizeTextLinks(text, input)
  const delta = replacementLength - (selection.end - selection.start)
  const output: TextLinkInput[] = []
  for (const link of links) {
    const containsReplacement =
      link.start <= selection.start && link.end >= selection.end
    if (containsReplacement) {
      const inheritsAtCaret =
        !selection.collapsed ||
        (link.start < selection.start && selection.start <= link.end)
      appendLink(
        output,
        link,
        link.start,
        link.end + delta - (inheritsAtCaret ? 0 : replacementLength)
      )
      if (selection.collapsed && !inheritsAtCaret && replacementLength > 0) {
        const retained = output.pop()
        if (retained) {
          appendLink(output, retained, retained.start, selection.start)
          appendLink(
            output,
            retained,
            selection.start + replacementLength,
            retained.end + replacementLength
          )
        }
      }
      continue
    }
    appendLink(output, link, link.start, Math.min(link.end, selection.start))
    if (link.end > selection.end) {
      appendLink(
        output,
        link,
        Math.max(link.start, selection.end) + delta,
        link.end + delta
      )
    }
  }
  return normalizeTextLinks(nextText, output)
}

export type ReplaceRichTextRangeResult = Readonly<{
  text: string
  content: RichTextContent
  selection: NormalizedTextSelection
}>

export function replaceRichTextRange(
  text: string,
  content: RichTextContent,
  selectionInput: TextSelection,
  replacement: string,
  insertionOverride?: Readonly<TextRunStyle>
): ReplaceRichTextRangeResult {
  const selection = normalizeTextSelection(text, selectionInput)
  const runResult = replaceTextRunRange(
    text,
    content.runs,
    selection,
    replacement,
    insertionOverride
  )
  return {
    text: runResult.text,
    content: {
      runs: [...runResult.runs],
      paragraphs: remapParagraphs(
        text,
        runResult.text,
        content.paragraphs,
        selection,
        replacement.length
      ),
      links: remapLinks(
        text,
        runResult.text,
        content.links,
        selection,
        replacement.length
      ),
    },
    selection: runResult.selection,
  }
}
