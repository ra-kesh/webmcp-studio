import {
  normalizeTextParagraphs,
  type TextParagraph,
  type TextParagraphInput,
  type TextParagraphStyle,
} from "./rich-text"
import {
  normalizeTextSelection,
  type TextSelection,
  type TextSelectionSharedValue,
} from "./text-range-editing"

export type TextList = NonNullable<TextParagraphStyle["list"]>

export type TextParagraphStylePatch = Readonly<{
  align?: TextParagraphStyle["align"] | null
  list?: TextList | null
}>

export type TextSelectionParagraphState = Readonly<{
  align: TextSelectionSharedValue<NonNullable<TextParagraphStyle["align"]>>
  list: TextSelectionSharedValue<TextList | null>
}>

type ParagraphRange = Readonly<{ start: number; end: number }>

export function textParagraphRanges(text: string): ParagraphRange[] {
  const ranges: ParagraphRange[] = []
  let start = 0
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (offset === text.length || text[offset] === "\n") {
      ranges.push({ start, end: offset })
      start = offset + 1
    }
  }
  return ranges
}

const paragraphIndexAt = (
  ranges: readonly ParagraphRange[],
  offset: number
) => {
  const index = ranges.findIndex(
    (range) => range.start <= offset && offset <= range.end
  )
  return index === -1 ? Math.max(0, ranges.length - 1) : index
}

const selectedParagraphIndexes = (text: string, selection: TextSelection) => {
  const normalized = normalizeTextSelection(text, selection)
  const ranges = textParagraphRanges(text)
  const first = paragraphIndexAt(ranges, normalized.start)
  const lastOffset = normalized.collapsed
    ? normalized.start
    : Math.max(normalized.start, normalized.end - 1)
  const last = paragraphIndexAt(ranges, lastOffset)
  return { ranges, first, last }
}

const styleByRange = (
  paragraphs: readonly TextParagraph[],
  range: ParagraphRange
) =>
  paragraphs.find(
    (paragraph) =>
      paragraph.start === range.start && paragraph.end === range.end
  )?.style ?? {}

const sharedValue = <Value>(
  values: readonly Value[],
  identity: (value: Value) => string = (value) => JSON.stringify(value)
): TextSelectionSharedValue<Value> => {
  const first = values[0]
  if (first === undefined) throw new Error("A paragraph selection is required")
  const firstIdentity = identity(first)
  return values.every((value) => identity(value) === firstIdentity)
    ? { kind: "value", value: first }
    : { kind: "mixed" }
}

export function resolveTextSelectionParagraphState(
  text: string,
  input: readonly TextParagraphInput[],
  selection: TextSelection,
  baseAlign: NonNullable<TextParagraphStyle["align"]>
): TextSelectionParagraphState {
  const paragraphs = normalizeTextParagraphs(text, input)
  const { ranges, first, last } = selectedParagraphIndexes(text, selection)
  const styles = ranges
    .slice(first, last + 1)
    .map((range) => styleByRange(paragraphs, range))
  return {
    align: sharedValue(styles.map((style) => style.align ?? baseAlign)),
    list: sharedValue(styles.map((style) => style.list ?? null)),
  }
}

const appendParagraph = (
  output: TextParagraphInput[],
  range: ParagraphRange,
  style: TextParagraphStyle
) => {
  if (!Object.keys(style).length) return
  output.push({ ...range, style })
}

export function applyTextParagraphStyleToRange(
  text: string,
  input: readonly TextParagraphInput[],
  selection: TextSelection,
  patch: TextParagraphStylePatch,
  baseAlign?: NonNullable<TextParagraphStyle["align"]>
): TextParagraph[] {
  const paragraphs = normalizeTextParagraphs(text, input)
  const { ranges, first, last } = selectedParagraphIndexes(text, selection)
  const output: TextParagraphInput[] = []
  ranges.forEach((range, index) => {
    const style = structuredClone(styleByRange(paragraphs, range))
    if (index >= first && index <= last) {
      if (patch.align !== undefined) {
        if (patch.align === null || patch.align === baseAlign)
          delete style.align
        else style.align = patch.align
      }
      if (patch.list !== undefined) {
        if (patch.list === null) delete style.list
        else style.list = structuredClone(patch.list)
      }
    }
    appendParagraph(output, range, style)
  })
  return normalizeTextParagraphs(text, output)
}

export function editTextParagraphListByKey(input: {
  key: "Enter" | "Backspace" | "Tab"
  shiftKey?: boolean
  text: string
  paragraphs: readonly TextParagraphInput[]
  selection: TextSelection
}): TextParagraph[] | null {
  const normalized = normalizeTextSelection(input.text, input.selection)
  const paragraphs = normalizeTextParagraphs(input.text, input.paragraphs)
  const { ranges, first, last } = selectedParagraphIndexes(
    input.text,
    input.selection
  )
  const currentRange = ranges[first]!
  const currentStyle = styleByRange(paragraphs, currentRange)

  if (input.key === "Enter") {
    if (
      !normalized.collapsed ||
      !currentStyle.list ||
      input.text.slice(currentRange.start, currentRange.end).length > 0
    ) {
      return null
    }
    return applyTextParagraphStyleToRange(
      input.text,
      paragraphs,
      input.selection,
      { list: null }
    )
  }

  if (input.key === "Backspace") {
    if (
      !normalized.collapsed ||
      normalized.start !== currentRange.start ||
      !currentStyle.list
    ) {
      return null
    }
    const list = currentStyle.list
    return applyTextParagraphStyleToRange(
      input.text,
      paragraphs,
      input.selection,
      {
        list:
          list.level === 0
            ? null
            : {
                ...list,
                level: list.level - 1,
              },
      }
    )
  }

  let changed = false
  const output: TextParagraphInput[] = []
  ranges.forEach((range, index) => {
    const style = structuredClone(styleByRange(paragraphs, range))
    if (index >= first && index <= last && style.list) {
      const level = style.list.level
      if (input.shiftKey) {
        if (level === 0) delete style.list
        else style.list = { ...style.list, level: level - 1 }
        changed = true
      } else if (level < 8) {
        style.list = { ...style.list, level: level + 1 }
        changed = true
      }
    }
    appendParagraph(output, range, style)
  })
  return changed ? normalizeTextParagraphs(input.text, output) : null
}
