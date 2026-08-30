import { ellipse, line, rect, text } from "./starter-document-builder"
import type {
  StarterDocumentPlan,
  TemplatePagePlan,
  TemplatePalette,
} from "./starter-document-builder"

export { ellipse, line, rect, text }

export type StarterCatalogPlan = StarterDocumentPlan & {
  category: string
  description: string
  tags: readonly string[]
  formatFamily: string
  useCaseIds: readonly string[]
  job: string
}

export const a4 = { width: 1240, height: 1754 } as const
export const wide = { width: 1600, height: 900 } as const
export const square = { width: 1080, height: 1080 } as const
export const story = { width: 1080, height: 1920 } as const
export const invitation = { width: 1200, height: 1600 } as const

export const palettes = {
  olive: {
    background: "#F3EFE6",
    ink: "#1F2923",
    muted: "#667068",
    accent: "#2F493C",
    panel: "#E5DDCF",
  },
  cobalt: {
    background: "#F4F6FC",
    ink: "#111827",
    muted: "#65708A",
    accent: "#275CE7",
    panel: "#DDE6FF",
  },
  ember: {
    background: "#FFF7F0",
    ink: "#2A1712",
    muted: "#7A5F57",
    accent: "#C94C2F",
    panel: "#F4DCCF",
  },
  midnight: {
    background: "#101820",
    ink: "#F7F2E8",
    muted: "#A9B2B9",
    accent: "#91C7AE",
    panel: "#202D36",
  },
  violet: {
    background: "#F7F3FF",
    ink: "#231A36",
    muted: "#756A87",
    accent: "#6E4CDD",
    panel: "#E7DDFC",
  },
  sand: {
    background: "#F5F0E7",
    ink: "#302921",
    muted: "#7A6E60",
    accent: "#A55A3B",
    panel: "#E7DDCD",
  },
  lemon: {
    background: "#F4FF80",
    ink: "#151515",
    muted: "#53563C",
    accent: "#151515",
    panel: "#FFFFFF",
  },
  rose: {
    background: "#FFF6F7",
    ink: "#3B2228",
    muted: "#866A71",
    accent: "#B84A66",
    panel: "#F4DDE3",
  },
} satisfies Record<string, TemplatePalette>

export const label = (
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  color?: string,
  group = "Header"
) =>
  text(
    id,
    "Section label",
    value,
    { x, y, width, height: 34, group },
    {
      role: "label",
      color,
    }
  )

export const title = (
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    role?: "display" | "heading"
    color?: string
    align?: "left" | "center" | "right"
    fieldKey?: string
    group?: string
    fontSize?: number
  } = {}
) =>
  text(
    id,
    "Title",
    value,
    { x, y, width, height, group: options.group ?? "Headline" },
    {
      role: options.role ?? "display",
      color: options.color,
      align: options.align,
      fieldKey: options.fieldKey,
      fieldLabel: options.fieldKey ? "Title" : undefined,
      fontSize: options.fontSize,
    }
  )

export const copy = (
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    color?: string
    align?: "left" | "center" | "right"
    group?: string
    fontSize?: number
  } = {}
) =>
  text(
    id,
    "Body copy",
    value,
    { x, y, width, height, group: options.group ?? "Copy" },
    {
      role: "body",
      color: options.color,
      align: options.align,
      fontSize: options.fontSize,
    }
  )

export const page = (
  id: string,
  name: string,
  dimensions: { width: number; height: number },
  blocks: TemplatePagePlan["blocks"],
  background?: string
): TemplatePagePlan => ({ id, name, ...dimensions, blocks, background })
