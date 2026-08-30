import { z } from "zod"

const nonEmptyObject = <Schema extends z.ZodRawShape>(shape: Schema) =>
  z
    .object(shape)
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "A rich-text override must change at least one property",
    })

export const textDecorationSchema = z.enum([
  "none",
  "underline",
  "line_through",
])

export const textRunStyleSchema = nonEmptyObject({
  typographyStyleId: z.string().min(1).optional(),
  paintStyleId: z.string().min(1).optional(),
  color: z.string().optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  decoration: textDecorationSchema.optional(),
  lineHeight: z.number().min(0.5).max(3).optional(),
  letterSpacing: z.number().min(-20).max(200).optional(),
})

export const textRunSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    style: textRunStyleSchema,
  })
  .strict()
  .refine((run) => run.start < run.end, {
    message: "A text run must cover at least one UTF-16 code unit",
  })

const textListSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bulleted"),
      level: z.number().int().min(0).max(8).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("numbered"),
      level: z.number().int().min(0).max(8).default(0),
      start: z.number().int().positive().default(1),
    })
    .strict(),
])

export const textParagraphStyleSchema = nonEmptyObject({
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  list: textListSchema.optional(),
})

export const textParagraphSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    style: textParagraphStyleSchema,
  })
  .strict()
  .refine((paragraph) => paragraph.start <= paragraph.end, {
    message: "A paragraph range cannot end before it starts",
  })

export const isSafeTextLinkTarget = (target: string) => {
  try {
    const url = new URL(target)
    return ["https:", "mailto:", "tel:"].includes(url.protocol)
  } catch {
    return false
  }
}

export const textLinkSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    target: z.string().min(1).refine(isSafeTextLinkTarget, {
      message: "Text links must use https, mailto, or tel",
    }),
    newTab: z.boolean().default(false),
  })
  .strict()
  .refine((link) => link.start < link.end, {
    message: "A text link must cover at least one UTF-16 code unit",
  })

export const richTextContentSchema = z
  .object({
    runs: z.array(textRunSchema),
    paragraphs: z.array(textParagraphSchema),
    links: z.array(textLinkSchema),
  })
  .strict()

export type TextDecoration = z.infer<typeof textDecorationSchema>
export type TextRunStyle = z.infer<typeof textRunStyleSchema>
export type TextRun = z.infer<typeof textRunSchema>
export type TextRunInput = z.input<typeof textRunSchema>
export type TextParagraphStyle = z.infer<typeof textParagraphStyleSchema>
export type TextParagraph = z.infer<typeof textParagraphSchema>
export type TextParagraphInput = z.input<typeof textParagraphSchema>
export type TextLink = z.infer<typeof textLinkSchema>
export type TextLinkInput = z.input<typeof textLinkSchema>
export type RichTextContent = z.infer<typeof richTextContentSchema>
export type RichTextContentInput = z.input<typeof richTextContentSchema>

export class RichTextRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RichTextRangeError"
  }
}

export const isRichTextBoundary = (text: string, offset: number) => {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return false
  }
  if (offset <= 0 || offset >= text.length) return true
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
}

const splitsSurrogatePair = (text: string, offset: number) =>
  !isRichTextBoundary(text, offset)

const assertCharacterRange = (
  text: string,
  range: { start: number; end: number },
  label: string
) => {
  if (range.end > text.length) {
    throw new RichTextRangeError(
      `${label} [${range.start}, ${range.end}) exceeds text length ${text.length}`
    )
  }
  if (
    splitsSurrogatePair(text, range.start) ||
    splitsSurrogatePair(text, range.end)
  ) {
    throw new RichTextRangeError(
      `${label} [${range.start}, ${range.end}) splits a surrogate pair`
    )
  }
}

const styleIdentity = (style: TextRunStyle) => JSON.stringify(style)

export function normalizeTextRuns(
  text: string,
  input: readonly TextRunInput[]
) {
  const runs = input
    .map((run) => textRunSchema.parse(run))
    .sort((left, right) =>
      left.start === right.start
        ? left.end - right.end
        : left.start - right.start
    )
  const normalized: TextRun[] = []
  for (const run of runs) {
    assertCharacterRange(text, run, "Text run")
    const previous = normalized.at(-1)
    if (previous && run.start < previous.end) {
      throw new RichTextRangeError(
        `Text runs [${previous.start}, ${previous.end}) and [${run.start}, ${run.end}) overlap`
      )
    }
    if (
      previous &&
      run.start === previous.end &&
      styleIdentity(run.style) === styleIdentity(previous.style)
    ) {
      previous.end = run.end
      continue
    }
    normalized.push(structuredClone(run))
  }
  return normalized
}

export function normalizeTextParagraphs(
  text: string,
  input: readonly TextParagraphInput[]
) {
  const paragraphs = input
    .map((paragraph) => textParagraphSchema.parse(paragraph))
    .sort((left, right) =>
      left.start === right.start
        ? left.end - right.end
        : left.start - right.start
    )
  let previous: TextParagraph | undefined
  for (const paragraph of paragraphs) {
    if (paragraph.end > text.length) {
      throw new RichTextRangeError(
        `Paragraph [${paragraph.start}, ${paragraph.end}) exceeds text length ${text.length}`
      )
    }
    if (
      splitsSurrogatePair(text, paragraph.start) ||
      splitsSurrogatePair(text, paragraph.end)
    ) {
      throw new RichTextRangeError(
        `Paragraph [${paragraph.start}, ${paragraph.end}) splits a surrogate pair`
      )
    }
    if (
      (paragraph.start > 0 && text[paragraph.start - 1] !== "\n") ||
      (paragraph.end < text.length && text[paragraph.end] !== "\n")
    ) {
      throw new RichTextRangeError(
        `Paragraph [${paragraph.start}, ${paragraph.end}) must align with newline boundaries`
      )
    }
    if (
      previous &&
      (paragraph.start < previous.end ||
        (paragraph.start === previous.start && paragraph.end === previous.end))
    ) {
      throw new RichTextRangeError(
        `Paragraph ranges [${previous.start}, ${previous.end}) and [${paragraph.start}, ${paragraph.end}) overlap`
      )
    }
    previous = paragraph
  }
  return paragraphs.map((paragraph) => structuredClone(paragraph))
}

export function normalizeTextLinks(
  text: string,
  input: readonly TextLinkInput[]
) {
  const links = input
    .map((link) => textLinkSchema.parse(link))
    .sort((left, right) =>
      left.start === right.start
        ? left.end - right.end
        : left.start - right.start
    )
  let previous: TextLink | undefined
  for (const link of links) {
    assertCharacterRange(text, link, "Text link")
    if (previous && link.start < previous.end) {
      throw new RichTextRangeError(
        `Text links [${previous.start}, ${previous.end}) and [${link.start}, ${link.end}) overlap`
      )
    }
    previous = link
  }
  return links.map((link) => structuredClone(link))
}

export function normalizeRichTextContent(
  text: string,
  input: RichTextContentInput
): RichTextContent {
  const parsed = richTextContentSchema.parse(input)
  return {
    runs: normalizeTextRuns(text, parsed.runs),
    paragraphs: normalizeTextParagraphs(text, parsed.paragraphs),
    links: normalizeTextLinks(text, parsed.links),
  }
}
