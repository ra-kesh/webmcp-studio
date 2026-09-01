import { assertValidDocument } from "./validation"
import type { Document, GroupDefinition, Page, SceneNode } from "./schema"
import {
  quotationRenderPayloadV1Schema,
  type QuotationRenderPayloadV1,
} from "./quotation-contract"

export const QUOTATION_COMPOSER_V3_VERSION = 3
export const QUOTATION_COMPOSER_V4_VERSION = 4
export const QUOTATION_COMPOSER_VERSION = QUOTATION_COMPOSER_V4_VERSION

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

const formatMoney = (value: string | null) => {
  if (value === null) return "Price on request"
  const rounded = Math.round(Number(value))
  const digits = Math.abs(rounded).toString()
  const tail = digits.slice(-3)
  const head = digits.slice(0, -3)
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")
  const grouped = head ? `${groupedHead},${tail}` : tail
  return `${rounded < 0 ? "-" : ""}₹${grouped}`
}

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
  semanticKey?: string
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

type CardDetail = Readonly<{
  role: "email" | "phone" | "address" | "schedule" | "audience" | "notes"
  value: string
}>

export type QuotationCompositionTrace = Readonly<{
  nodeIdsBySemanticKey: Readonly<Record<string, string>>
  groupIdsBySemanticKey: Readonly<Record<string, string>>
}>

export type TracedQuotationDocument = Readonly<{
  document: Document
  trace: QuotationCompositionTrace
}>

class QuotationCanvasWriter {
  readonly pages: Page[] = []
  readonly nodes: SceneNode[] = []
  readonly groups: GroupDefinition[] = []
  readonly nodeIdsBySemanticKey = new Map<string, string>()
  readonly groupIdsBySemanticKey = new Map<string, string>()
  private nodeSequence = 0
  private groupSequence = 0
  private currentPage: Page | null = null
  private cursorY = CONTENT_TOP

  constructor(
    readonly payload: QuotationRenderPayloadV1,
    readonly template: QuotationTemplate,
    readonly defaultTextLocked: boolean
  ) {}

  private id(prefix: string) {
    this.nodeSequence += 1
    return `${prefix}-${this.nodeSequence}`
  }

  private recordSemanticNode(semanticKey: string | undefined, nodeId: string) {
    if (!semanticKey) return
    if (this.nodeIdsBySemanticKey.has(semanticKey)) {
      throw new Error(`Duplicate quotation semantic key: ${semanticKey}`)
    }
    this.nodeIdsBySemanticKey.set(semanticKey, nodeId)
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
    parentGroupId?: string,
    semanticKey?: string
  ) {
    this.groups.push({
      id,
      name,
      pageId,
      nodeIds,
      parentGroupId,
      role: "organize",
    })
    if (semanticKey) {
      if (this.groupIdsBySemanticKey.has(semanticKey)) {
        throw new Error(
          `Duplicate quotation group semantic key: ${semanticKey}`
        )
      }
      this.groupIdsBySemanticKey.set(semanticKey, id)
    }
  }

  private captureGroup<T>(
    name: string,
    semanticKey: string,
    createNodes: () => T
  ) {
    const page = this.currentPage
    if (!page) throw new Error(`Cannot create ${name} without an active page.`)
    const firstNodeIndex = page.nodeIds.length
    const result = createNodes()
    if (this.currentPage?.id !== page.id) {
      throw new Error(`${name} cannot span quotation pages.`)
    }
    const nodeIds = page.nodeIds.slice(firstNodeIndex)
    if (nodeIds.length) {
      this.addGroup(
        this.groupId(),
        name,
        page.id,
        nodeIds,
        undefined,
        semanticKey
      )
    }
    return result
  }

  addRect(options: {
    semanticKey?: string
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
    this.recordSemanticNode(options.semanticKey, node.id)
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
      locked: options.locked ?? this.defaultTextLocked,
      text,
      runs: [],
      paragraphs: [],
      links: [],
      color: options.color,
      fontFamily: "Geist Variable",
      fontSize: options.fontSize,
      fontWeight: options.weight ?? 400,
      italic: false,
      decoration: "none",
      lineHeight,
      letterSpacing: 0,
      align: options.align ?? "left",
      sizingMode: "fixed",
    }
    this.nodes.push(node)
    this.currentPage?.nodeIds.push(node.id)
    this.recordSemanticNode(options.semanticKey, node.id)
    return { id: node.id, height: node.height }
  }

  addLine(y: number, semanticKey?: string) {
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
    this.recordSemanticNode(semanticKey, node.id)
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
      semanticKey: "cover.accent",
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
        semanticKey: "cover.studio-name",
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
        semanticKey: "cover.quotation-type",
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
      semanticKey: "cover.title",
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
        semanticKey: "cover.prepared-for",
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
        semanticKey: "cover.details-card",
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
        semanticKey: "cover.quote-number",
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
        semanticKey: "cover.quotation-date",
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
        semanticKey: "cover.valid-until",
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
      coverGroupId,
      "cover.identity-group"
    )
    this.addGroup(
      datesGroupId,
      "Date details",
      page.id,
      dateNodeIds,
      quoteCardGroupId,
      "cover.date-group"
    )
    this.addGroup(
      quoteCardGroupId,
      "Quotation details",
      page.id,
      quoteCardNodeIds,
      coverGroupId,
      "cover.details-group"
    )
    this.addGroup(
      coverGroupId,
      "Cover layout",
      page.id,
      [accentNodeId],
      undefined,
      "cover.layout-group"
    )
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
    const pageRole = `composer.page-role.${index}`
    this.captureGroup("Page chrome", `${pageRole}.chrome.group`, () => {
      this.addText({
        semanticKey: `${pageRole}.chrome.studio-name`,
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
        semanticKey: `${pageRole}.chrome.quote-number`,
        name: "Page quote number",
        value: this.payload.quote.quoteNumber,
        x: PAGE_WIDTH - PAGE_MARGIN - 280,
        y: 72,
        width: 280,
        fontSize: 15,
        color: palette.muted,
        align: "right",
      })
      this.addLine(126, `${pageRole}.chrome.divider`)
      this.addText({
        semanticKey: `${pageRole}.chrome.page-number`,
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
        const pageRole = `composer.page-role.${this.pages.length}`
        this.addText({
          semanticKey: `${pageRole}.continuation.label`,
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
        this.addLine(this.cursorY, `${pageRole}.continuation.divider`)
        this.cursorY += 24
      }
    }
  }

  section(title: string, kicker?: string, semanticKey = `section.${title}`) {
    this.ensure(kicker ? 136 : 100, title, false)
    this.captureGroup(`${title} section`, `${semanticKey}.group`, () => {
      if (kicker) {
        this.addText({
          semanticKey: `${semanticKey}.kicker`,
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
        semanticKey: `${semanticKey}.heading`,
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
      this.addLine(this.cursorY, `${semanticKey}.divider`)
    })
    this.cursorY += 30
  }

  paragraph(
    value: string,
    name = "Paragraph",
    semanticKey = `paragraph.${name}`
  ) {
    const wrapped = wrapText(value, CONTENT_WIDTH, 20)
    const height = Math.ceil(wrapped.split("\n").length * 20 * 1.38 + 8)
    this.ensure(height + 24)
    this.addText({
      semanticKey,
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

  card(
    title: string,
    details: CardDetail[],
    continuationName: string,
    semanticKey = `card.${title}`
  ) {
    const lineHeights = details.map(({ value }) =>
      Math.max(
        27,
        wrapText(value, CONTENT_WIDTH - 64, 17).split("\n").length * 24
      )
    )
    const height = 78 + lineHeights.reduce((sum, value) => sum + value, 0)
    this.ensure(height + 20, continuationName)
    const top = this.cursorY
    this.captureGroup(title, `${semanticKey}.group`, () => {
      this.addRect({
        semanticKey: `${semanticKey}.background`,
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
        semanticKey: `${semanticKey}.title`,
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
      details.forEach(({ role, value }, index) => {
        this.addText({
          semanticKey: `${semanticKey}.${role}`,
          name: `${title} detail ${index + 1}`,
          value,
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

  row(
    label: string,
    value: string,
    continuationName: string,
    semanticKey = `row.${continuationName}.${label}`
  ) {
    const wrappedValue = wrapText(value, 690, 17)
    const height = Math.max(58, wrappedValue.split("\n").length * 25 + 28)
    this.ensure(height, continuationName)
    this.captureGroup(label, `${semanticKey}.group`, () => {
      this.addText({
        semanticKey: `${semanticKey}.label`,
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
        semanticKey: `${semanticKey}.value`,
        name: `${label} value`,
        value,
        x: PAGE_MARGIN + 330,
        y: this.cursorY + 13,
        width: CONTENT_WIDTH - 330,
        fontSize: 17,
        color: this.template.palette.ink,
      })
      this.addLine(this.cursorY + height - 1, `${semanticKey}.divider`)
    })
    this.cursorY += height
  }
}

// Composer 3 and 4 share this exact structural builder. Composer 4 changed only
// the default text lock. Later structural composer versions must add a new
// versioned builder instead of changing the meaning of this one.
function buildQuotationV3V4(writer: QuotationCanvasWriter) {
  const { payload } = writer
  const { document } = payload
  const eventByKey = new Map(document.events.map((event) => [event.key, event]))

  const cover = writer.addCover()
  writer.createPage("Overview")
  writer.section(
    "The celebration",
    document.quotationType.label,
    "overview.celebration"
  )
  writer.paragraph(
    `This proposal has been prepared for ${document.participants
      .map((participant) => participant.contact.name)
      .join(
        " and "
      )}. It brings the event plan, coverage options, deliverables, commercial terms and delivery schedule into one source-backed document.`,
    "Overview introduction",
    "overview.introduction"
  )
  writer.section("People", undefined, "people.section")
  for (const participant of document.participants) {
    const details = [
      { role: "email", value: participant.contact.email },
      { role: "phone", value: participant.contact.phoneNumber },
      { role: "address", value: participant.contact.address },
    ].filter((detail): detail is CardDetail => typeof detail.value === "string")
    writer.card(
      participant.contact.name,
      details,
      "People",
      `participant.${participant.key}`
    )
  }

  writer.section(
    "Event plan",
    `${document.events.length} events`,
    "events.section"
  )
  for (const item of document.events) {
    const date =
      item.timelineMode === "fixed"
        ? formatDate(item.fixedDate)
        : (item.dateWindow ?? "Date to be confirmed")
    writer.card(
      item.eventType.label,
      (
        [
          {
            role: "schedule",
            value: `${date}${item.location ? ` · ${item.location}` : ""}`,
          },
          {
            role: "audience",
            value: [
              item.guestCount ? `${item.guestCount} guests` : null,
              item.side !== "common" ? `${item.side} side` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          },
          { role: "notes", value: item.notes ?? "" },
        ] satisfies CardDetail[]
      ).filter(({ value }) => Boolean(value)),
      "Event plan",
      `event.${item.key}`
    )
  }

  for (const item of document.packages) {
    const recommended = item.key === document.recommendedPackageKey
    writer.section(
      item.name,
      recommended ? "Recommended package" : "Coverage option",
      `package.${item.key}.section`
    )
    writer.row(
      "Investment",
      formatMoney(item.price),
      item.name,
      `package.${item.key}.investment`
    )
    if (item.summary) {
      writer.paragraph(
        item.summary,
        `${item.name} summary`,
        `package.${item.key}.summary`
      )
    }
    writer.section(
      "Coverage",
      undefined,
      `package.${item.key}.coverage-section`
    )
    for (const coverage of item.coverage) {
      const coveredEvent = eventByKey.get(coverage.eventKey)
      writer.row(
        coveredEvent?.eventType.label ?? coverage.eventKey,
        coverage.roles ?? "Coverage included",
        `${item.name} coverage`,
        `package.${item.key}.coverage.${coverage.key}`
      )
    }
    writer.section(
      "Deliverables",
      undefined,
      `package.${item.key}.deliverables-section`
    )
    for (const deliverable of item.deliverables) {
      writer.row(
        `${deliverable.quantity} × ${deliverable.name}`,
        deliverable.details ?? "Included",
        `${item.name} deliverables`,
        `package.${item.key}.deliverable.${deliverable.key}`
      )
    }
  }

  writer.section("Delivery schedule", undefined, "delivery.section")
  for (const [index, clause] of document.deliveryTimelines.entries()) {
    writer.row(
      String(index + 1).padStart(2, "0"),
      clause.text,
      "Delivery schedule",
      `delivery.${clause.key}`
    )
  }
  writer.section("Payment schedule", undefined, "payment.section")
  for (const milestone of document.paymentMilestones) {
    writer.row(
      `${milestone.percentage}% · ${milestone.label}`,
      milestone.timing,
      "Payment schedule",
      `payment.${milestone.key}`
    )
  }
  writer.section("Terms", undefined, "terms.section")
  for (const [index, clause] of document.fixedTerms.entries()) {
    writer.row(
      String(index + 1).padStart(2, "0"),
      clause.text,
      "Terms",
      `term.${clause.key}`
    )
  }
  writer.section("Ready when you are", undefined, "closing.section")
  writer.paragraph(
    `This quotation is valid until ${formatDate(payload.quote.validUntil)}. Accepting it confirms the selected package and allows ${payload.branding.organizationName} to reserve the production dates.`,
    "Closing paragraph",
    "closing.paragraph"
  )
  if (payload.branding.email || payload.branding.phone) {
    writer.card(
      payload.branding.organizationName,
      [
        { role: "email", value: payload.branding.email },
        { role: "phone", value: payload.branding.phone },
        { role: "address", value: payload.branding.address },
      ].filter(
        (detail): detail is CardDetail => typeof detail.value === "string"
      ),
      "Contact",
      "closing.contact"
    )
  }
  return cover
}

function composeTracedQuotationDocumentV3V4(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId,
  composerVersion:
    typeof QUOTATION_COMPOSER_V3_VERSION | typeof QUOTATION_COMPOSER_V4_VERSION
): TracedQuotationDocument {
  const payload = quotationRenderPayloadV1Schema.parse(input)
  const template =
    quotationTemplates.find((candidate) => candidate.id === templateId) ??
    quotationTemplates[0]
  if (!template) throw new Error("No quotation templates are registered.")
  const writer = new QuotationCanvasWriter(
    payload,
    template,
    composerVersion === QUOTATION_COMPOSER_V3_VERSION
  )
  const cover = buildQuotationV3V4(writer)
  const now = payload.quote.createdAt
  const document = assertValidDocument({
    schemaVersion: 5,
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
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
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
  return {
    document,
    trace: {
      nodeIdsBySemanticKey: Object.fromEntries(writer.nodeIdsBySemanticKey),
      groupIdsBySemanticKey: Object.fromEntries(writer.groupIdsBySemanticKey),
    },
  }
}

export function composeTracedQuotationDocumentV4(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): TracedQuotationDocument {
  return composeTracedQuotationDocumentV3V4(
    input,
    templateId,
    QUOTATION_COMPOSER_V4_VERSION
  )
}

export function composeQuotationDocumentV3(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): Document {
  return composeTracedQuotationDocumentV3V4(
    input,
    templateId,
    QUOTATION_COMPOSER_V3_VERSION
  ).document
}

export function composeQuotationDocumentV4(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): Document {
  return composeTracedQuotationDocumentV4(input, templateId).document
}

export function composeQuotationDocumentForVersion(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId,
  composerVersion: number
): Document | null {
  if (composerVersion === QUOTATION_COMPOSER_V3_VERSION) {
    return composeQuotationDocumentV3(input, templateId)
  }
  if (composerVersion === QUOTATION_COMPOSER_V4_VERSION) {
    return composeQuotationDocumentV4(input, templateId)
  }
  return null
}

export function composeTracedQuotationDocument(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): TracedQuotationDocument {
  return composeTracedQuotationDocumentV4(input, templateId)
}

export function composeQuotationDocument(
  input: QuotationRenderPayloadV1,
  templateId: QuotationTemplateId = "editorial-olive"
): Document {
  return composeQuotationDocumentV4(input, templateId)
}
