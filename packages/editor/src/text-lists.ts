export const plainTextListStyles = ["none", "bulleted", "numbered"] as const

export type PlainTextListStyle = (typeof plainTextListStyles)[number]
export type PlainTextListState = PlainTextListStyle | "mixed"

export type PlainTextListEdit = {
  text: string
  selectionStart: number
  selectionEnd: number
}

type ParsedListLine = {
  content: string
  contentStart: number
  indentation: string
  style: Exclude<PlainTextListStyle, "none">
}

type TextReplacement = {
  start: number
  end: number
  value: string
}

const listMarker = /^([ \t]*)(?:(?:[\u2022*-])|(\d+[.)]))(?:[ \t]+|$)(.*)$/u
const numberedMarker = /^([ \t]*)\d+[.)](?:[ \t]+|$)/u
const indentUnit = "  "

function parseListLine(line: string): ParsedListLine | null {
  const match = listMarker.exec(line)
  if (!match) return null
  return {
    content: match[3] ?? "",
    contentStart: line.length - (match[3] ?? "").length,
    indentation: match[1] ?? "",
    style: match[2] ? "numbered" : "bulleted",
  }
}

function indentationWidth(indentation: string): number {
  let width = 0
  for (const character of indentation) {
    width += character === "\t" ? indentUnit.length : 1
  }
  return width
}

function lineBoundsAt(text: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const start = text.lastIndexOf("\n", clamped - 1) + 1
  const nextBreak = text.indexOf("\n", clamped)
  return {
    start,
    end: nextBreak === -1 ? text.length : nextBreak,
  }
}

function normalizeSelection(text: string, start: number, end: number) {
  const first = Math.max(0, Math.min(start, text.length))
  const second = Math.max(0, Math.min(end, text.length))
  return first <= second
    ? { start: first, end: second }
    : { start: second, end: first }
}

function applyReplacements(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacements: TextReplacement[]
): PlainTextListEdit {
  const ordered = [...replacements].sort((a, b) => a.start - b.start)
  let result = ""
  let cursor = 0
  for (const replacement of ordered) {
    result += text.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
  }
  result += text.slice(cursor)

  const remap = (offset: number) => {
    let delta = 0
    for (const replacement of ordered) {
      if (offset < replacement.start) break
      if (
        replacement.start === replacement.end &&
        offset === replacement.start
      ) {
        return replacement.start + delta + replacement.value.length
      }
      if (offset <= replacement.end) {
        return (
          replacement.start +
          delta +
          Math.min(offset - replacement.start, replacement.value.length)
        )
      }
      delta += replacement.value.length - (replacement.end - replacement.start)
    }
    return offset + delta
  }

  return {
    text: result,
    selectionStart: remap(selectionStart),
    selectionEnd: remap(selectionEnd),
  }
}

function renumberPlainTextLists(edit: PlainTextListEdit): PlainTextListEdit {
  const replacements: TextReplacement[] = []
  const counters = new Map<number, number>()
  let offset = 0

  for (const line of edit.text.split("\n")) {
    const parsed = parseListLine(line)
    if (parsed?.style === "numbered") {
      const depth = indentationWidth(parsed.indentation)
      for (const key of counters.keys()) {
        if (key > depth) counters.delete(key)
      }
      const next = (counters.get(depth) ?? 0) + 1
      counters.set(depth, next)
      const currentMarker = numberedMarker.exec(line)?.[0] ?? ""
      const nextMarker = `${parsed.indentation}${next}. `
      if (currentMarker !== nextMarker) {
        replacements.push({
          start: offset,
          end: offset + currentMarker.length,
          value: nextMarker,
        })
      }
    } else if (line.trim()) {
      counters.clear()
    }
    offset += line.length + 1
  }

  return replacements.length
    ? applyReplacements(
        edit.text,
        edit.selectionStart,
        edit.selectionEnd,
        replacements
      )
    : edit
}

export function detectPlainTextListStyle(text: string): PlainTextListState {
  const styles = new Set<PlainTextListStyle>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    styles.add(parseListLine(line)?.style ?? "none")
  }
  if (styles.size === 0) return "none"
  if (styles.size === 1) return [...styles][0] ?? "none"
  return "mixed"
}

export function renumberPlainTextList(text: string): string {
  return renumberPlainTextLists({
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  }).text
}

export function applyPlainTextListStyle(
  text: string,
  style: PlainTextListStyle
): string {
  const converted = text
    .split("\n")
    .map((line) => {
      const parsed = parseListLine(line)
      if (!parsed && !line.trim()) return line

      const indentation =
        parsed?.indentation ?? line.match(/^[ \t]*/u)?.[0] ?? ""
      const content = parsed?.content ?? line.slice(indentation.length)
      if (style === "none") return `${indentation}${content}`
      if (style === "bulleted") return `${indentation}\u2022 ${content}`
      return `${indentation}1. ${content}`
    })
    .join("\n")

  return style === "numbered" ? renumberPlainTextList(converted) : converted
}

export function continuePlainTextList(
  text: string,
  selectionStart: number,
  selectionEnd: number
): PlainTextListEdit | null {
  const selection = normalizeSelection(text, selectionStart, selectionEnd)
  const bounds = lineBoundsAt(text, selection.start)
  const parsed = parseListLine(text.slice(bounds.start, bounds.end))
  if (!parsed) return null

  if (selection.start === selection.end && !parsed.content.trim()) {
    return renumberPlainTextLists({
      text: `${text.slice(0, bounds.start)}${text.slice(bounds.end)}`,
      selectionStart: bounds.start,
      selectionEnd: bounds.start,
    })
  }

  const contentBoundary = bounds.start + parsed.contentStart
  const editStart = Math.max(selection.start, contentBoundary)
  const editEnd = Math.max(selection.end, contentBoundary)
  const marker = parsed.style === "bulleted" ? "\u2022 " : "1. "
  const insertion = `\n${parsed.indentation}${marker}`
  const inserted = applyReplacements(text, editStart, editStart, [
    { start: editStart, end: editEnd, value: insertion },
  ])
  const nextCursor = editStart + insertion.length
  const collapsed = {
    ...inserted,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  }
  return parsed.style === "numbered"
    ? renumberPlainTextLists(collapsed)
    : collapsed
}

export function indentPlainTextList(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "indent" | "outdent"
): PlainTextListEdit | null {
  const selection = normalizeSelection(text, selectionStart, selectionEnd)
  const activeBounds = lineBoundsAt(text, selection.start)
  if (!parseListLine(text.slice(activeBounds.start, activeBounds.end)))
    return null

  const firstLineStart = activeBounds.start
  const inclusiveEnd =
    selection.end > selection.start && text[selection.end - 1] === "\n"
      ? selection.end - 1
      : selection.end
  const lastLineEnd = lineBoundsAt(text, inclusiveEnd).end
  const replacements: TextReplacement[] = []
  let lineStart = firstLineStart

  while (lineStart <= lastLineEnd) {
    const lineEnd = text.indexOf("\n", lineStart)
    const boundedEnd = lineEnd === -1 ? text.length : lineEnd
    const parsed = parseListLine(text.slice(lineStart, boundedEnd))
    if (parsed) {
      if (direction === "indent") {
        replacements.push({
          start: lineStart,
          end: lineStart,
          value: indentUnit,
        })
      } else if (parsed.indentation.startsWith("\t")) {
        replacements.push({ start: lineStart, end: lineStart + 1, value: "" })
      } else {
        const removable = Math.min(
          indentUnit.length,
          parsed.indentation.match(/^ */u)?.[0].length ?? 0
        )
        if (removable) {
          replacements.push({
            start: lineStart,
            end: lineStart + removable,
            value: "",
          })
        }
      }
    }
    if (lineEnd === -1 || lineEnd >= lastLineEnd) break
    lineStart = lineEnd + 1
  }

  if (!replacements.length) {
    return {
      text,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    }
  }
  return renumberPlainTextLists(
    applyReplacements(text, selection.start, selection.end, replacements)
  )
}

export function removePlainTextListMarker(
  text: string,
  selectionStart: number,
  selectionEnd: number
): PlainTextListEdit | null {
  const selection = normalizeSelection(text, selectionStart, selectionEnd)
  if (selection.start !== selection.end) return null
  const bounds = lineBoundsAt(text, selection.start)
  const parsed = parseListLine(text.slice(bounds.start, bounds.end))
  if (!parsed || selection.start !== bounds.start + parsed.contentStart) {
    return null
  }

  const markerStart = bounds.start + parsed.indentation.length
  const withoutMarker = applyReplacements(text, markerStart, markerStart, [
    {
      start: markerStart,
      end: bounds.start + parsed.contentStart,
      value: "",
    },
  ])
  return renumberPlainTextLists({
    ...withoutMarker,
    selectionStart: markerStart,
    selectionEnd: markerStart,
  })
}

export function resolvePlainTextListKey(input: {
  key: string
  shiftKey?: boolean
  text: string
  selectionStart: number
  selectionEnd: number
}): PlainTextListEdit | null {
  if (input.key === "Enter" && !input.shiftKey) {
    return continuePlainTextList(
      input.text,
      input.selectionStart,
      input.selectionEnd
    )
  }
  if (input.key === "Tab") {
    return indentPlainTextList(
      input.text,
      input.selectionStart,
      input.selectionEnd,
      input.shiftKey ? "outdent" : "indent"
    )
  }
  if (input.key === "Backspace") {
    return removePlainTextListMarker(
      input.text,
      input.selectionStart,
      input.selectionEnd
    )
  }
  return null
}
