import { applyTextLayoutPatch } from "@webmcp/document"
import type { Page, TextNode, TextSizingMode } from "@webmcp/document"

export const studioTextPresetIds = [
  "heading",
  "subheading",
  "body",
  "caption",
] as const

export type StudioTextPresetId = (typeof studioTextPresetIds)[number]

export type StudioTextPreset = {
  id: StudioTextPresetId
  name: string
  description: string
  sample: string
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  sizingMode: TextSizingMode
  widthRatio: number
  fontSizeRatio: number
  minFontSize: number
  maxFontSize: number
}

export const studioTextPresets: readonly StudioTextPreset[] = [
  {
    id: "heading",
    name: "Heading",
    description: "A strong title that wraps as it grows.",
    sample: "Add a heading",
    fontWeight: 650,
    lineHeight: 1.04,
    letterSpacing: -1.5,
    sizingMode: "auto_height",
    widthRatio: 0.72,
    fontSizeRatio: 0.065,
    minFontSize: 48,
    maxFontSize: 84,
  },
  {
    id: "subheading",
    name: "Subheading",
    description: "Supporting copy with clear hierarchy.",
    sample: "Add a subheading",
    fontWeight: 560,
    lineHeight: 1.16,
    letterSpacing: -0.6,
    sizingMode: "auto_height",
    widthRatio: 0.68,
    fontSizeRatio: 0.04,
    minFontSize: 32,
    maxFontSize: 54,
  },
  {
    id: "body",
    name: "Body",
    description: "Readable paragraph copy for documents.",
    sample: "Add body text",
    fontWeight: 450,
    lineHeight: 1.42,
    letterSpacing: 0,
    sizingMode: "auto_height",
    widthRatio: 0.62,
    fontSizeRatio: 0.024,
    minFontSize: 20,
    maxFontSize: 30,
  },
  {
    id: "caption",
    name: "Caption",
    description: "Compact labels, notes, and metadata.",
    sample: "Add a caption",
    fontWeight: 560,
    lineHeight: 1.28,
    letterSpacing: 0.8,
    sizingMode: "auto_width",
    widthRatio: 0.4,
    fontSizeRatio: 0.016,
    minFontSize: 14,
    maxFontSize: 18,
  },
]

export const defaultStudioTextPresetId: StudioTextPresetId = "body"

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum)

const darkTextColor = "#18181b"
const lightTextColor = "#fafafa"

function parseHexColor(value: string) {
  const normalized = value.trim().toLowerCase()
  const expanded = /^#[0-9a-f]{3}$/u.test(normalized)
    ? `#${normalized
        .slice(1)
        .split("")
        .map((digit) => `${digit}${digit}`)
        .join("")}`
    : normalized
  if (!/^#[0-9a-f]{6}$/u.test(expanded)) return null
  return [1, 3, 5].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16)
  ) as [number, number, number]
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return (
    channel(red) * 0.2126 + channel(green) * 0.7152 + channel(blue) * 0.0722
  )
}

function contrastRatio(first: number, second: number) {
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function textColorForPageBackground(
  background: string,
  preferredColors: readonly string[] = []
) {
  const pageColor = parseHexColor(background)
  const darkColor = parseHexColor(darkTextColor)
  const lightColor = parseHexColor(lightTextColor)
  if (!pageColor || !darkColor || !lightColor) return darkTextColor
  const pageLuminance = relativeLuminance(pageColor)
  const readablePreferredColor = preferredColors.find((color) => {
    const parsed = parseHexColor(color)
    return (
      parsed !== null &&
      contrastRatio(pageLuminance, relativeLuminance(parsed)) >= 4.5
    )
  })
  if (readablePreferredColor) return readablePreferredColor
  return contrastRatio(pageLuminance, relativeLuminance(lightColor)) >
    contrastRatio(pageLuminance, relativeLuminance(darkColor))
    ? lightTextColor
    : darkTextColor
}

export function getStudioTextPreset(presetId: StudioTextPresetId) {
  const preset = studioTextPresets.find(
    (candidate) => candidate.id === presetId
  )
  if (!preset) throw new Error(`Unknown text preset: ${presetId}`)
  return preset
}

export function textPresetPlacement(page: Page, presetId: StudioTextPresetId) {
  const preset = getStudioTextPreset(presetId)
  const shortestSide = Math.min(page.width, page.height)
  const fontSize = clamp(
    Math.round(shortestSide * preset.fontSizeRatio),
    preset.minFontSize,
    preset.maxFontSize
  )
  const horizontalMargin = Math.max(32, Math.min(96, page.width * 0.08))
  const availableWidth = Math.max(1, page.width - horizontalMargin * 2)
  const width = Math.round(
    Math.min(availableWidth, Math.max(180, page.width * preset.widthRatio))
  )
  const estimatedHeight = Math.max(
    1,
    Math.ceil(fontSize * preset.lineHeight * 1.12)
  )

  return {
    preset,
    x: Math.round((page.width - width) / 2),
    y: Math.round((page.height - estimatedHeight) / 2),
    width,
    height: estimatedHeight,
    fontSize,
  }
}

export function createStudioTextNode(
  page: Page,
  presetId: StudioTextPresetId,
  id: string,
  options: { preferredColors?: readonly string[] } = {}
): TextNode {
  const placement = textPresetPlacement(page, presetId)
  const initialNode: TextNode = {
    id,
    type: "text",
    name: placement.preset.name,
    text: placement.preset.sample,
    runs: [],
    paragraphs: [],
    links: [],
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    constraints: { horizontal: "min", vertical: "min" },
    color: textColorForPageBackground(page.background, options.preferredColors),
    fontFamily: "Geist Variable",
    fontSize: placement.fontSize,
    fontWeight: placement.preset.fontWeight,
    italic: false,
    decoration: "none",
    lineHeight: placement.preset.lineHeight,
    letterSpacing: placement.preset.letterSpacing,
    align: "left",
    sizingMode: placement.preset.sizingMode,
  }
  const laidOutNode = applyTextLayoutPatch(initialNode, {
    text: initialNode.text,
  })
  return {
    ...laidOutNode,
    x: Math.round((page.width - laidOutNode.width) / 2),
    y: Math.round((page.height - laidOutNode.height) / 2),
  }
}
