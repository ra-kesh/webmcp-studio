import {
  DesignTemplateRepository,
  type DesignTemplateDefinition,
} from "./design-templates"
import { northstarQuotationPayload } from "./quotation-fixture"
import {
  composeQuotationDocument,
  composeQuotationDocumentV3,
  QUOTATION_COMPOSER_VERSION,
} from "./quotation-composer"
import {
  defaultNodeConstraints,
  documentSchema,
  type Document,
  type SceneNode,
} from "./schema"
import { builtInDocumentStarterDefinitions } from "./built-ins/templates/starter-manifests"
import {
  createStudioQuotationStyleManifest,
  createStudioTemplateManifest,
} from "./built-ins/templates/template-manifest"

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
  constraints: defaultNodeConstraints(),
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
  runs: [],
  paragraphs: [],
  links: [],
  color: options.color ?? "#1F2923",
  fontFamily: "Geist Variable",
  fontSize: options.fontSize ?? 32,
  fontWeight: options.fontWeight ?? 500,
  italic: false,
  decoration: "none",
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
    schemaVersion: 6,
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
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
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
    schemaVersion: 6,
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
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
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

const legacyEditorialOnePager = editorialOnePager()
const legacyBoldSquareAnnouncement = boldSquareAnnouncement()

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
    source: {
      name: "Studio originals",
      license: "Studio original template",
    },
    manifest: createStudioTemplateManifest({
      id: "editorial-one-pager",
      formatFamily: "a4-portrait",
      useCaseIds: ["proposal", "brief", "client-work"],
      job: "Create a concise printable proposal, brief or client introduction.",
      document: legacyEditorialOnePager,
      contentSha256:
        "5d5a188b6c9e60d4467fb0d35c26e619a61e74947150c8fb6a270643b9c7144f",
    }),
    document: legacyEditorialOnePager,
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
    source: {
      name: "Studio originals",
      license: "Studio original template",
    },
    manifest: createStudioTemplateManifest({
      id: "bold-square-announcement",
      formatFamily: "social-square",
      useCaseIds: ["social-post", "launch", "announcement"],
      job: "Publish a legible launch or event announcement for social feeds.",
      document: legacyBoldSquareAnnouncement,
      contentSha256:
        "2111294407f8c086f7ac247dd9fdf6e49a9100ac40d9b92385049e08fc467cf3",
    }),
    document: legacyBoldSquareAnnouncement,
  },
  ...builtInDocumentStarterDefinitions,
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
  ).flatMap((template): DesignTemplateDefinition[] => [
    {
      schemaVersion: 1,
      version: 4,
      kind: "quotation_style",
      composerVersion: QUOTATION_COMPOSER_VERSION,
      createdAt: "2026-09-01T00:00:00.000Z",
      source: {
        name: "Studio originals",
        license: "Studio original template",
      },
      manifest: createStudioQuotationStyleManifest({
        id: template.id,
        quotationTemplateId: template.quotationTemplateId,
        composerVersion: QUOTATION_COMPOSER_VERSION,
        formatFamily: "quotation-proposal",
        useCaseIds: ["quotation", "proposal", "wedding"],
        job: "Restyle a source-backed wedding quotation without changing its commercial content.",
        previewDocument: composeQuotationDocument(
          northstarQuotationPayload,
          template.quotationTemplateId
        ),
        contentSha256: {
          "quotation-editorial-olive":
            "d938631e37da99fc30502a4f73ec407df03bafde78b68c91b6b9fdddd5452a26",
          "quotation-warm-paper":
            "4e50e438ea088bcd8b1c1606404f50af16f21e758e5eaf6896f44cd68ec09b63",
          "quotation-midnight-film":
            "5a161ef47ab3f6d68c826dd90474ebfebbb6d9af8c1b9e2c12907fbe4832e6b8",
        }[template.id],
      }),
      ...template,
      tags: [...template.tags],
    },
    {
      schemaVersion: 1,
      version: 3,
      kind: "quotation_style",
      composerVersion: 3,
      catalogStatus: "retired",
      createdAt: "2026-08-29T00:00:00.000Z",
      source: {
        name: "Studio originals",
        license: "Studio original template",
      },
      manifest: createStudioQuotationStyleManifest({
        id: template.id,
        quotationTemplateId: template.quotationTemplateId,
        composerVersion: 3,
        formatFamily: "quotation-proposal",
        useCaseIds: ["quotation", "proposal", "wedding"],
        job: "Restyle a source-backed wedding quotation without changing its commercial content.",
        previewDocument: composeQuotationDocumentV3(
          northstarQuotationPayload,
          template.quotationTemplateId
        ),
        contentSha256: {
          "quotation-editorial-olive":
            "bf053bd31da14a50dd28bef67996086b0beeabf74cc7e82f2978cb389711856a",
          "quotation-warm-paper":
            "1e49119fa6e7070872ed5f3ddfa762350ca44e8e4871b3968f59e38f022c7b5e",
          "quotation-midnight-film":
            "e20ba6d14f33b1ee7f34761cb9b8d06a02585db42148bb139b2c02afffae7641",
        }[template.id],
      }),
      ...template,
      tags: [...template.tags],
    },
    {
      schemaVersion: 1,
      version: 2,
      kind: "quotation_style",
      composerVersion: 2,
      catalogStatus: "retired",
      createdAt: "2026-08-29T00:00:00.000Z",
      source: {
        name: "Studio originals",
        license: "Studio original template",
      },
      manifest: createStudioQuotationStyleManifest({
        id: template.id,
        quotationTemplateId: template.quotationTemplateId,
        composerVersion: 2,
        formatFamily: "quotation-proposal",
        useCaseIds: ["quotation", "proposal", "wedding"],
        job: "Retain the immutable identity of a quotation style created by composer version 2.",
        previewDocument: null,
        contentSha256: {
          "quotation-editorial-olive":
            "6c79df28b8e0e309f13a0eaf57419cd82ad18f96376984d67b4ab6c1f30ae835",
          "quotation-warm-paper":
            "d484bfa8ef073bf9f9ee6fc2822d6f61f20fa6f5d42c592fea24a2a3d4289b7b",
          "quotation-midnight-film":
            "a409002c141fd6d1dd447f52cdf1dbe47e0c7bd8a81d2f456d90fe4aa3ba7df4",
        }[template.id],
      }),
      ...template,
      tags: [...template.tags],
    },
    {
      schemaVersion: 1,
      version: 1,
      kind: "quotation_style",
      composerVersion: 1,
      catalogStatus: "retired",
      createdAt,
      source: {
        name: "Studio originals",
        license: "Studio original template",
      },
      manifest: createStudioQuotationStyleManifest({
        id: template.id,
        quotationTemplateId: template.quotationTemplateId,
        composerVersion: 1,
        formatFamily: "quotation-proposal",
        useCaseIds: ["quotation", "proposal", "wedding"],
        job: "Retain the immutable identity of a quotation style created by composer version 1.",
        previewDocument: null,
        contentSha256: {
          "quotation-editorial-olive":
            "8246e678290ab53527a54dd321e6f0de2c0c31dd3a9d281a02c7d7e250bd2759",
          "quotation-warm-paper":
            "6a639ca9c3c7c20d8b019a9291d3d348f23f48af575eda416a418e69ccf1bdb6",
          "quotation-midnight-film":
            "50d06ffe7a3cb915849c3cb5f47cdd933c54389108abd943360b58147acfb106",
        }[template.id],
      }),
      ...template,
      tags: [...template.tags],
    },
  ]),
]

export const builtInDesignTemplateRepository = new DesignTemplateRepository(
  builtInDesignTemplateDefinitions,
  northstarQuotationPayload
)
