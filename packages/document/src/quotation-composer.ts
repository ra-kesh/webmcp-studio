import { assertValidDocument } from "./validation"
import type { Document, GroupDefinition, Page, SceneNode } from "./schema"
import {
  quotationRenderPayloadV1Schema,
  type QuotationRenderPayloadV1,
} from "./quotation-contract"

const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
const PAGE_MARGIN = 92
const CONTENT_TOP = 178
const CONTENT_BOTTOM = 1590
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2

export type QuotationTemplateId =
  "editorial-olive" | "warm-paper" | "midnight-film"

export type QuotationTemplate = {
  id: QuotationTemplateId
  name: string
  description: string
  category: string
  palette: {
    background: string
    ink: string
    muted: string
    accent: string
    surface: string
    border: string
  }
}

export const quotationTemplates: QuotationTemplate[] = [
  {
    id: "editorial-olive",
    name: "Editorial Olive",
    description: "Quiet, refined and made for premium celebrations.",
    category: "Editorial",
    palette: {
      background: "#f3efe6",
      ink: "#1f2923",
      muted: "#687168",
      accent: "#2f493c",
      surface: "#e5ddcf",
      border: "#cfc6b7",
    },
  },
  {
    id: "warm-paper",
    name: "Warm Paper",
    description: "A modern proposal with tactile, human warmth.",
    category: "Minimal",
    palette: {
      background: "#fbf8f2",
      ink: "#201b18",
      muted: "#746a63",
      accent: "#9b4c32",
      surface: "#efe7dc",
      border: "#d9cfc2",
    },
  },
  {
    id: "midnight-film",
    name: "Midnight Film",
    description: "High-contrast cinematic treatment for visual studios.",
    category: "Cinematic",
    palette: {
      background: "#11171d",
      ink: "#f5f1e9",
      muted: "#aab1b5",
      accent: "#93b9a4",
      surface: "#202a32",
      border: "#36434c",
    },
  },
]

const formatDate = (value: string | null) => {
  if (!value) return "To be confirmed"
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`))
}

const formatMoney = (value: string | null) =>
  value === null
    ? "Price on request"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(Number(value))

function wrapText(value: string, width: number, fontSize: number) {
  const maxCharacters = Math.max(12, Math.floor(width / (fontSize * 0.54)))
  const paragraphs = value.split("\n")
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push("")
      continue
    }
    let line = words[0] ?? ""
    for (const word of words.slice(1)) {
      if (`${line} ${word}`.length <= maxCharacters) line += ` ${word}`
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines.join("\n")
}

type TextOptions = {
  name: string
  value: string
  x: number
  y: number
  width: number
  fontSize: number
  color: string
  weight?: number
  lineHeight?: number
  align?: "left" | "center" | "right"
  locked?: boolean
}

class QuotationCanvasWriter {
  readonly pages: Page[] = []
  readonly nodes: SceneNode[] = []
  readonly groups: GroupDefinition[] = []
  private nodeSequence = 0
  private groupSequence = 0
  private currentPage: Page | null = null
  private cursorY = CONTENT_TOP

  constructor(
    readonly payload: QuotationRenderPayloadV1,
    readonly template: QuotationTemplate
  ) {}

  private id(prefix: string) {
    this.nodeSequence += 1
    return `${prefix}-${this.nodeSequence}`
  }

  private groupId() {
    this.groupSequence += 1
    return `quotation-group-${this.groupSequence}`
  }

  private addGroup(
    id: string,
    name: string,
    pageId: string,
    nodeIds: string[],
    parentGroupId?: string
  ) {
    this.groups.push({ id, name, pageId, nodeIds, parentGroupId })
  }

  private captureGroup<T>(name: string, createNodes: () => T) {
    const page = this.currentPage
    if (!page) throw new Error(`Cannot create ${name} without an active page.`)
    const firstNodeIndex = page.nodeIds.length
    const result = createNodes()
    if (this.currentPage?.id !== page.id) {
      throw new Error(`${name} cannot span quotation pages.`)
    }
    const nodeIds = page.nodeIds.slice(firstNodeIndex)
    if (nodeIds.length) {
      this.addGroup(this.groupId(), name, page.id, nodeIds)
    }
    return result
  }

  addRect(options: {
    name: string
    x: number
    y: number
    width: number
    height: number
    fill: string
    radius?: number
    stroke?: string
    strokeWidth?: number
    locked?: boolean
  }) {
    const node: SceneNode = {
      id: this.id("rect"),
      type: "rect",
      name: options.name,
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: options.locked ?? true,
      fill: options.fill,
      radius: options.radius ?? 0,
      stroke: options.stroke,
      strokeWidth: options.strokeWidth ?? 0,
    }
    this.nodes.push(node)
    this.currentPage?.nodeIds.push(node.id)
    return node.id
  }

  addText(options: TextOptions) {
    const lineHeight = options.lineHeight ?? 1.28
    const text = wrapText(options.value, options.width, options.fontSize)
    const lineCount = Math.max(1, text.split("\n").length)
    const node: SceneNode = {
      id: this.id("text"),
      type: "text",
      name: options.name,
      x: options.x,
      y: options.y,
      width: options.width,
      height: Math.ceil(lineCount * options.fontSize * lineHeight + 6),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: options.locked ?? true,
      text,
      color: options.color,
      fontFamily: "Geist Variable",
      fontSize: options.fontSize,
      fontWeight: options.weight ?? 400,
      lineHeight,
      letterSpacing: 0,
      align: options.align ?? "left",
      sizingMode: "fixed",
    }
    this.nodes.push(node)
    this.currentPage?.nodeIds.push(node.id)
    return { id: node.id, height: node.height }
  }

  addLine(y: number) {
    const node: SceneNode = {
      id: this.id("line"),
      type: "line",
      name: "Divider",
      x: PAGE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: true,
      stroke: this.template.palette.border,
      strokeWidth: 1,
    }
    this.nodes.push(node)
    this.currentPage?.nodeIds.push(node.id)
    return node.id
  }

  addCover() {
    const { palette } = this.template
    const page = this.createPage("Cover", false)
    const coverGroupId = this.groupId()
    const identityGroupId = this.groupId()
    const quoteCardGroupId = this.groupId()
    const datesGroupId = this.groupId()
    const accentNodeId = this.addRect({
      name: "Cover accent",
      x: 0,
      y: 0,
      width: 28,
      height: PAGE_HEIGHT,
      fill: palette.accent,
    })
    const identityNodeIds: string[] = []
    identityNodeIds.push(
      this.addText({
        name: "Studio name",
        value: this.payload.branding.organizationName.toUpperCase(),
        x: PAGE_MARGIN,
        y: 104,
        width: 620,
        fontSize: 20,
        weight: 600,
        color: palette.accent,
      }).id
    )
    identityNodeIds.push(
      this.addText({
        name: "Quotation type",
        value: this.payload.document.quotationType.label,
        x: PAGE_MARGIN,
        y: 420,
        width: 760,
        fontSize: 24,
        weight: 500,
        color: palette.muted,
      }).id
    )
    const title = this.addText({
      name: "Quotation title",
      value: this.payload.document.title,
      x: PAGE_MARGIN,
      y: 486,
      width: 900,
      fontSize: 76,
      weight: 520,
      lineHeight: 1.06,
      color: palette.ink,
    })
    identityNodeIds.push(title.id)
    const people = this.payload.document.participants
      .map((participant) => participant.contact.name)
      .join(" & ")
    identityNodeIds.push(
      this.addText({
        name: "Prepared for",
        value: `Prepared for ${people}`,
        x: PAGE_MARGIN,
        y: Math.min(890, 516 + title.height),
        width: 720,
        fontSize: 25,
        color: palette.muted,
      }).id
    )
    const quoteCardNodeIds: string[] = []
    quoteCardNodeIds.push(
      this.addRect({
        name: "Quotation details",
        x: PAGE_MARGIN,
        y: 1376,
        width: CONTENT_WIDTH,
        height: 220,
        fill: palette.surface,
        radius: 12,
      })
    )
    quoteCardNodeIds.push(
      this.addText({
        name: "Quote number",
        value: this.payload.quote.quoteNumber,
        x: PAGE_MARGIN + 32,
        y: 1410,
        width: 300,
        fontSize: 18,
        weight: 600,
        color: palette.ink,
      }).id
    )
    const dateNodeIds: string[] = []
    dateNodeIds.push(
      this.addText({
        name: "Quotation date",
        value: formatDate(this.payload.document.quotationDate),
        x: PAGE_MARGIN + 32,
        y: 1470,
        width: 390,
        fontSize: 18,
        color: palette.muted,
      }).id
    )
    dateNodeIds.push(
      this.addText({
        name: "Valid until",
        value: `Valid until ${formatDate(this.payload.quote.validUntil)}`,
        x: 650,
        y: 1410,
        width: 460,
        fontSize: 18,
        weight: 500,
        color: palette.ink,
        align: "right",
      }).id
    )
    this.addGroup(
      identityGroupId,
      "Cover identity",
      page.id,
      identityNodeIds,
      coverGroupId
    )
    this.addGroup(
      datesGroupId,
      "Date details",
      page.id,
      dateNodeIds,
      quoteCardGroupId
    )
    this.addGroup(
      quoteCardGroupId,
      "Quotation details",
      page.id,
      quoteCardNodeIds,
      coverGroupId
    )
    this.addGroup(coverGroupId, "Cover layout", page.id, [accentNodeId])
    return { page, titleNodeId: title.id }
  }

  createPage(name: string, withChrome = true) {
    const index = this.pages.length + 1
    const page: Page = {
      id: `quotation-page-${index}`,
      outputId: "quotation-output",
      name,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      background: this.template.palette.background,
      nodeIds: [],
    }
    this.pages.push(page)
    this.currentPage = page
    this.cursorY = CONTENT_TOP
    if (withChrome) this.addPageChrome(index)
    return page
  }

  private addPageChrome(index: number) {
    const { palette } = this.template
    this.captureGroup("Page chrome", () => {
      this.addText({
        name: "Page studio name",
        value: this.payload.branding.organizationName.toUpperCase(),
        x: PAGE_MARGIN,
        y: 72,
        width: 520,
        fontSize: 16,
        weight: 600,
        color: palette.accent,
      })
      this.addText({
        name: "Page quote number",
        value: this.payload.quote.quoteNumber,
        x: PAGE_WIDTH - PAGE_MARGIN - 280,
        y: 72,
        width: 280,
        fontSize: 15,
        color: palette.muted,
        align: "right",
      })
      this.addLine(126)
      this.addText({
        name: "Page number",
        value: String(index).padStart(2, "0"),
        x: PAGE_WIDTH - PAGE_MARGIN - 80,
        y: 1650,
        width: 80,
        fontSize: 15,
        color: palette.muted,
        align: "right",
      })
    })
  }

  ensure(
    height: number,
    continuationName = "Quotation details",
    showContinuation = true
  ) {
    if (!this.currentPage || this.cursorY + height > CONTENT_BOTTOM) {
      this.createPage(continuationName)
      if (showContinuation) {
        this.addText({
          name: `${continuationName} continuation`,
          value: `${continuationName} — continued`,
          x: PAGE_MARGIN,
          y: this.cursorY,
          width: CONTENT_WIDTH,
          fontSize: 18,
          weight: 560,
          color: this.template.palette.accent,
        })
        this.cursorY += 48
        this.addLine(this.cursorY)
        this.cursorY += 24
      }
    }
  }

  section(title: string, kicker?: string) {
    this.ensure(kicker ? 136 : 100, title, false)
    this.captureGroup(`${title} section`, () => {
      if (kicker) {
        this.addText({
          name: `${title} kicker`,
          value: kicker.toUpperCase(),
          x: PAGE_MARGIN,
          y: this.cursorY,
          width: CONTENT_WIDTH,
          fontSize: 14,
          weight: 650,
          color: this.template.palette.accent,
        })
        this.cursorY += 34
      }
      this.addText({
        name: `${title} heading`,
        value: title,
        x: PAGE_MARGIN,
        y: this.cursorY,
        width: CONTENT_WIDTH,
        fontSize: 38,
        weight: 560,
        color: this.template.palette.ink,
        lineHeight: 1.1,
      })
      this.cursorY += 70
      this.addLine(this.cursorY)
    })
    this.cursorY += 30
  }

  paragraph(value: string, name = "Paragraph") {
    const wrapped = wrapText(value, CONTENT_WIDTH, 20)
    const height = Math.ceil(wrapped.split("\n").length * 20 * 1.38 + 8)
    this.ensure(height + 24)
    this.addText({
      name,
      value,
      x: PAGE_MARGIN,
      y: this.cursorY,
      width: CONTENT_WIDTH,
      fontSize: 20,
      lineHeight: 1.38,
      color: this.template.palette.ink,
    })
    this.cursorY += height + 24
  }

  card(title: string, lines: string[], continuationName: string) {
    const lineHeights = lines.map((line) =>
      Math.max(
        27,
        wrapText(line, CONTENT_WIDTH - 64, 17).split("\n").length * 24
      )
    )
    const height = 78 + lineHeights.reduce((sum, value) => sum + value, 0)
    this.ensure(height + 20, continuationName)
    const top = this.cursorY
    this.captureGroup(title, () => {
      this.addRect({
        name: `${title} card`,
        x: PAGE_MARGIN,
        y: top,
        width: CONTENT_WIDTH,
        height,
        fill: this.template.palette.surface,
        radius: 10,
        stroke: this.template.palette.border,
        strokeWidth: 1,
      })
      this.addText({
        name: `${title} title`,
        value: title,
        x: PAGE_MARGIN + 30,
        y: top + 25,
        width: CONTENT_WIDTH - 60,
        fontSize: 23,
        weight: 600,
        color: this.template.palette.ink,
      })
      let y = top + 70
      lines.forEach((line, index) => {
        this.addText({
          name: `${title} detail ${index + 1}`,
          value: line,
          x: PAGE_MARGIN + 30,
          y,
          width: CONTENT_WIDTH - 60,
          fontSize: 17,
          lineHeight: 1.35,
          color: this.template.palette.muted,
        })
        y += lineHeights[index] ?? 27
      })
    })
    this.cursorY += height + 20
  }

  row(label: string, value: string, continuationName: string) {
    const wrappedValue = wrapText(value, 690, 17)
    const height = Math.max(58, wrappedValue.split("\n").length * 25 + 28)
    this.ensure(height, continuationName)
    this.captureGroup(label, () => {
      this.addText({
        name: `${label} label`,
        value: label,
        x: PAGE_MARGIN,
        y: this.cursorY + 13,
        width: 290,
        fontSize: 16,
        weight: 560,
        color: this.template.palette.muted,
      })
      this.addText({
        name: `${label} value`,
        value,
        x: PAGE_MARGIN + 330,
        y: this.cursorY + 13,
        width: CONTENT_WIDTH - 330,
        fontSize: 17,
        color: this.template.palette.ink,
      })
      this.addLine(this.cursorY + height - 1)
    })
    this.cursorY += height
  }
}

function buildQuotation(writer: QuotationCanvasWriter) {
  const { payload } = writer
  const { document } = payload
  const eventByKey = new Map(document.events.map((event) => [event.key, event]))

  const cover = writer.addCover()
  writer.createPage("Overview")
  writer.section("The celebration", document.quotationType.label)
  writer.paragraph(
    `This proposal has been prepared for ${document.participants
      .map((participant) => participant.contact.name)
      .join(
        " and "
      )}. It brings the event plan, coverage options, deliverables, commercial terms and delivery schedule into one source-backed document.`
  )
  writer.section("People")
  for (const participant of document.participants) {
    const details = [
      participant.contact.email,
      participant.contact.phoneNumber,
      participant.contact.address,
    ].filter((value): value is string => Boolean(value))
    writer.card(participant.contact.name, details, "People")
  }

  writer.section("Event plan", `${document.events.length} events`)
  for (const item of document.events) {
    const date =
      item.timelineMode === "fixed"
        ? formatDate(item.fixedDate)
        : (item.dateWindow ?? "Date to be confirmed")
    writer.card(
      item.eventType.label,
      [
        `${date}${item.location ? ` · ${item.location}` : ""}`,
        [
          item.guestCount ? `${item.guestCount} guests` : null,
          item.side !== "common" ? `${item.side} side` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        item.notes ?? "",
      ].filter(Boolean),
      "Event plan"
    )
  }

  for (const item of document.packages) {
    const recommended = item.key === document.recommendedPackageKey
    writer.section(
      item.name,
      recommended ? "Recommended package" : "Coverage option"
    )
    writer.row("Investment", formatMoney(item.price), item.name)
    if (item.summary) writer.paragraph(item.summary, `${item.name} summary`)
    writer.section("Coverage")
    for (const coverage of item.coverage) {
      const coveredEvent = eventByKey.get(coverage.eventKey)
      writer.row(
        coveredEvent?.eventType.label ?? coverage.eventKey,
        coverage.roles ?? "Coverage included",
        `${item.name} coverage`
      )
    }
    writer.section("Deliverables")
    for (const deliverable of item.deliverables) {
      writer.row(
        `${deliverable.quantity} × ${deliverable.name}`,
        deliverable.details ?? "Included",
        `${item.name} deliverables`
      )
    }
  }

  writer.section("Delivery schedule")
  for (const [index, clause] of document.deliveryTimelines.entries()) {
    writer.row(
      String(index + 1).padStart(2, "0"),
      clause.text,
      "Delivery schedule"
    )
  }
  writer.section("Payment schedule")
  for (const milestone of document.paymentMilestones) {
    writer.row(
      `${milestone.percentage}% · ${milestone.label}`,
      milestone.timing,
      "Payment schedule"
    )
  }
  writer.section("Terms")
  for (const [index, clause] of document.fixedTerms.entries()) {
    writer.row(String(index + 1).padStart(2, "0"), clause.text, "Terms")
  }
  writer.section("Ready when you are")
  writer.paragraph(
    `This quotation is valid until ${formatDate(payload.quote.validUntil)}. Accepting it confirms the selected package and allows ${payload.branding.organizationName} to reserve the production dates.`
  )
  if (payload.branding.email || payload.branding.phone) {
    writer.card(
      payload.branding.organizationName,
      [
        payload.branding.email,
        payload.branding.phone,
        payload.branding.address,
      ].filter((value): value is string => Boolean(value)),
      "Contact"
    )
  }
  return cover
}

export function composeQuotationDocument(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): Document {
  const payload = quotationRenderPayloadV1Schema.parse(input)
  const template =
    quotationTemplates.find((candidate) => candidate.id === templateId) ??
    quotationTemplates[0]
  if (!template) throw new Error("No quotation templates are registered.")
  const writer = new QuotationCanvasWriter(payload, template)
  const cover = buildQuotation(writer)
  const now = payload.quote.createdAt
  return assertValidDocument({
    schemaVersion: 2,
    id: `quotation-${payload.source.quotationId}`,
    name: payload.document.title,
    revision: payload.source.revision,
    createdAt: now,
    updatedAt: now,
    outputs: [
      {
        id: "quotation-output",
        name: "Quotation",
        kind: "proposal",
        pageIds: writer.pages.map((page) => page.id),
        exportFormats: ["pdf", "png"],
      },
    ],
    pages: writer.pages,
    nodes: writer.nodes,
    groups: writer.groups,
    fields: [
      {
        id: "field-quotation-title",
        key: "quotation_title",
        label: "Quotation title",
        type: "text",
        required: true,
        defaultValue: payload.document.title,
      },
    ],
    fieldValues: { "field-quotation-title": payload.document.title },
    bindings: [
      {
        id: "binding-quotation-title",
        fieldId: "field-quotation-title",
        nodeId: cover.titleNodeId,
        property: "text",
      },
    ],
  })
}
