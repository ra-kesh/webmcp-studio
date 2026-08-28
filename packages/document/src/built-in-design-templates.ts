import {
  DesignTemplateRepository,
  type DesignTemplateDefinition,
} from "./design-templates"
import { northstarQuotationPayload } from "./quotation-fixture"
import { documentSchema, type Document, type SceneNode } from "./schema"

const createdAt = "2026-08-27T00:00:00.000Z"

const baseNode = (
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number
) => ({
  id,
  name,
  x,
  y,
  width,
  height,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
})

const textNode = (
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    color?: string
    fontSize?: number
    fontWeight?: number
    lineHeight?: number
    letterSpacing?: number
    align?: "left" | "center" | "right"
  } = {}
): SceneNode => ({
  ...baseNode(id, name, x, y, width, height),
  type: "text",
  text,
  color: options.color ?? "#1F2923",
  fontFamily: "Geist Variable",
  fontSize: options.fontSize ?? 32,
  fontWeight: options.fontWeight ?? 500,
  lineHeight: options.lineHeight ?? 1.15,
  letterSpacing: options.letterSpacing ?? 0,
  align: options.align ?? "left",
  sizingMode: "fixed",
})

const rectNode = (
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius = 0
): SceneNode => ({
  ...baseNode(id, name, x, y, width, height),
  type: "rect",
  fill,
  radius,
  strokeWidth: 0,
})

function editorialOnePager(): Document {
  const outputId = "editorial-one-pager-output"
  const pageId = "editorial-one-pager-page"
  const nodes: SceneNode[] = [
    rectNode("editorial-rail", "Olive rail", 0, 0, 34, 1754, "#2F493C"),
    textNode(
      "editorial-kicker",
      "Document type",
      "STUDIO BRIEF · 2027",
      112,
      112,
      760,
      34,
      { color: "#2F493C", fontSize: 20, fontWeight: 650, letterSpacing: 2.4 }
    ),
    textNode(
      "editorial-title",
      "Document title",
      "A clear story,\nbeautifully presented.",
      112,
      250,
      960,
      260,
      { fontSize: 78, fontWeight: 590, lineHeight: 1.02, letterSpacing: -2.2 }
    ),
    textNode(
      "editorial-subtitle",
      "Document subtitle",
      "A composed one-page format for proposals, creative briefs, introductions and client-ready summaries.",
      112,
      550,
      850,
      130,
      { color: "#687168", fontSize: 28, lineHeight: 1.35 }
    ),
    rectNode(
      "editorial-card",
      "Summary card",
      112,
      870,
      1016,
      430,
      "#E5DDCF",
      18
    ),
    textNode(
      "editorial-card-label",
      "Summary label",
      "THE ESSENTIAL IDEA",
      160,
      930,
      420,
      30,
      { color: "#2F493C", fontSize: 18, fontWeight: 650, letterSpacing: 2 }
    ),
    textNode(
      "editorial-card-copy",
      "Summary copy",
      "Lead with the decision your reader needs to make. Use the remaining space for evidence, context and one unmistakable next step.",
      160,
      1010,
      860,
      190,
      { fontSize: 34, fontWeight: 520, lineHeight: 1.3 }
    ),
    textNode(
      "editorial-footer",
      "Footer",
      "YOUR STUDIO  ·  HELLO@EXAMPLE.COM",
      112,
      1570,
      1016,
      28,
      { color: "#687168", fontSize: 16, fontWeight: 560, letterSpacing: 1.4 }
    ),
  ]
  return documentSchema.parse({
    schemaVersion: 2,
    id: "editorial-one-pager-template-document",
    name: "Editorial one-pager",
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    outputs: [
      {
        id: outputId,
        name: "Editorial one-pager",
        kind: "proposal",
        pageIds: [pageId],
        exportFormats: ["png", "pdf"],
      },
    ],
    pages: [
      {
        id: pageId,
        outputId,
        name: "One-pager",
        width: 1240,
        height: 1754,
        background: "#F3EFE6",
        nodeIds: nodes.map((node) => node.id),
      },
    ],
    nodes,
    groups: [],
    fields: [
      {
        id: "editorial-title-field",
        key: "document_title",
        label: "Document title",
        type: "text",
        required: true,
        defaultValue: "A clear story, beautifully presented.",
      },
      {
        id: "editorial-subtitle-field",
        key: "document_subtitle",
        label: "Document subtitle",
        type: "text",
        required: false,
        defaultValue:
          "A composed one-page format for proposals, creative briefs, introductions and client-ready summaries.",
      },
    ],
    fieldValues: {
      "editorial-title-field": "A clear story,\nbeautifully presented.",
      "editorial-subtitle-field":
        "A composed one-page format for proposals, creative briefs, introductions and client-ready summaries.",
    },
    bindings: [
      {
        id: "editorial-title-binding",
        fieldId: "editorial-title-field",
        nodeId: "editorial-title",
        property: "text",
      },
      {
        id: "editorial-subtitle-binding",
        fieldId: "editorial-subtitle-field",
        nodeId: "editorial-subtitle",
        property: "text",
      },
    ],
  })
}

function boldSquareAnnouncement(): Document {
  const outputId = "bold-square-output"
  const pageId = "bold-square-page"
  const nodes: SceneNode[] = [
    rectNode("bold-frame", "Inner frame", 54, 54, 972, 972, "#E9FF70", 28),
    rectNode("bold-panel", "Dark panel", 82, 82, 916, 916, "#151515", 18),
    textNode(
      "bold-kicker",
      "Announcement label",
      "NOW OPEN",
      130,
      132,
      500,
      40,
      { color: "#E9FF70", fontSize: 23, fontWeight: 680, letterSpacing: 3.2 }
    ),
    textNode(
      "bold-title",
      "Announcement title",
      "Make the\nnext thing\nunmissable.",
      130,
      270,
      820,
      390,
      {
        color: "#FFFFFF",
        fontSize: 92,
        fontWeight: 650,
        lineHeight: 0.98,
        letterSpacing: -3,
      }
    ),
    textNode(
      "bold-copy",
      "Announcement copy",
      "A high-impact square for launches, offers, events and social announcements.",
      130,
      720,
      700,
      110,
      { color: "#BDBDBD", fontSize: 28, lineHeight: 1.32 }
    ),
    rectNode("bold-button", "Call to action", 130, 880, 360, 74, "#E9FF70", 37),
    textNode(
      "bold-button-label",
      "Call to action label",
      "DISCOVER MORE  →",
      160,
      902,
      300,
      30,
      { color: "#151515", fontSize: 18, fontWeight: 700, letterSpacing: 1.2 }
    ),
  ]
  return documentSchema.parse({
    schemaVersion: 2,
    id: "bold-square-template-document",
    name: "Bold square announcement",
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    outputs: [
      {
        id: outputId,
        name: "Square announcement",
        kind: "square",
        pageIds: [pageId],
        exportFormats: ["png"],
      },
    ],
    pages: [
      {
        id: pageId,
        outputId,
        name: "Announcement",
        width: 1080,
        height: 1080,
        background: "#E9FF70",
        nodeIds: nodes.map((node) => node.id),
      },
    ],
    nodes,
    groups: [],
    fields: [
      {
        id: "bold-title-field",
        key: "announcement_title",
        label: "Announcement title",
        type: "text",
        required: true,
        defaultValue: "Make the next thing unmissable.",
      },
    ],
    fieldValues: {
      "bold-title-field": "Make the\nnext thing\nunmissable.",
    },
    bindings: [
      {
        id: "bold-title-binding",
        fieldId: "bold-title-field",
        nodeId: "bold-title",
        property: "text",
      },
    ],
  })
}

export const builtInDesignTemplateDefinitions: DesignTemplateDefinition[] = [
  {
    schemaVersion: 1,
    id: "editorial-one-pager",
    version: 1,
    kind: "document_starter",
    name: "Editorial one-pager",
    description:
      "A calm client-ready page for briefs, proposals and introductions.",
    category: "Documents",
    tags: ["editorial", "proposal", "brief", "minimal"],
    createdAt,
    source: { name: "Studio originals", license: "Internal" },
    document: editorialOnePager(),
  },
  {
    schemaVersion: 1,
    id: "bold-square-announcement",
    version: 1,
    kind: "document_starter",
    name: "Bold square announcement",
    description:
      "A high-contrast launch and social announcement with a decisive CTA.",
    category: "Social",
    tags: ["square", "launch", "event", "announcement"],
    createdAt,
    source: { name: "Studio originals", license: "Internal" },
    document: boldSquareAnnouncement(),
  },
  ...(
    [
      {
        id: "quotation-editorial-olive",
        name: "Editorial Olive",
        description: "Quiet, refined proposals for premium celebrations.",
        category: "Proposals",
        tags: ["quotation", "editorial", "olive", "wedding"],
        quotationTemplateId: "editorial-olive",
      },
      {
        id: "quotation-warm-paper",
        name: "Warm Paper",
        description: "Tactile warmth for human, modern client proposals.",
        category: "Proposals",
        tags: ["quotation", "warm", "paper", "wedding"],
        quotationTemplateId: "warm-paper",
      },
      {
        id: "quotation-midnight-film",
        name: "Midnight Film",
        description: "A cinematic dark treatment for visual studios.",
        category: "Proposals",
        tags: ["quotation", "cinematic", "dark", "film"],
        quotationTemplateId: "midnight-film",
      },
    ] as const
  ).map((template): DesignTemplateDefinition => ({
    schemaVersion: 1,
    version: 1,
    kind: "quotation_style",
    composerVersion: 1,
    createdAt,
    source: { name: "Studio originals", license: "Internal" },
    ...template,
    tags: [...template.tags],
  })),
]

export const builtInDesignTemplateRepository = new DesignTemplateRepository(
  builtInDesignTemplateDefinitions,
  northstarQuotationPayload
)
