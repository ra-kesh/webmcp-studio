import { describe, expect, it } from "vitest"
import {
  applyQuotationTemplate,
  composeQuotationDocument,
  inferQuotationTemplateId,
  northstarQuotationPayload,
  quotationTemplates,
  validateDocument,
  type Document,
} from "../src"

const WITHOUT_VISUALS = new Set([
  "revision",
  "updatedAt",
  "background",
  "color",
  "fill",
  "stroke",
])

const omitVisuals = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(omitVisuals)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !WITHOUT_VISUALS.has(key))
        .map(([key, child]) => [key, omitVisuals(child)])
    )
  }
  return value
}

const createEditedDocument = () => {
  const document = structuredClone(
    composeQuotationDocument(northstarQuotationPayload, "editorial-olive")
  )
  const title = document.nodes.find(
    (node) => node.id === "text-4" && node.type === "text"
  )
  if (!title || title.type !== "text") throw new Error("Missing cover title")

  title.text = "A manually refined wedding story"
  title.name = "Client-approved title"
  title.x += 18
  title.locked = false
  document.fieldValues["field-quotation-title"] = "Approved field value"
  document.outputs[0]!.name = "Client presentation"
  document.outputs[0]!.exportFormats = ["pdf"]

  document.nodes.push({
    id: "manual-note",
    type: "text",
    name: "Agent-approved note",
    x: 80,
    y: 120,
    width: 420,
    height: 80,
    rotation: 0,
    opacity: 0.84,
    visible: true,
    locked: false,
    text: "Keep this accepted change",
    runs: [],
    paragraphs: [],
    links: [],
    color: "#7c3aed",
    fontFamily: "Geist Variable",
    fontSize: 32,
    fontWeight: 600,
    italic: false,
    decoration: "none",
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    sizingMode: "fixed",
  })
  document.pages.push({
    id: "manual-page",
    outputId: "quotation-output",
    name: "Client notes",
    width: 1240,
    height: 1754,
    background: "#f3efe6",
    nodeIds: ["manual-note"],
  })
  document.outputs[0]!.pageIds.push("manual-page")
  document.groups.push({
    id: "manual-group",
    role: "organize",
    pageId: "manual-page",
    name: "Approved notes",
    nodeIds: ["manual-note"],
  })
  document.fields.push({
    id: "field-manual-note",
    key: "manual_note",
    label: "Manual note",
    type: "text",
    required: false,
    defaultValue: "Keep this accepted change",
    agentDescription: "Preserved custom note",
    validation: {},
  })
  document.fieldValues["field-manual-note"] = "Keep this accepted change"
  document.bindings.push({
    id: "binding-manual-note",
    fieldId: "field-manual-note",
    nodeId: "manual-note",
    property: "text",
  })
  return document as Document
}

describe("quotation template application", () => {
  it("preserves edited aggregate semantics while changing visual tokens", () => {
    const current = createEditedDocument()
    const untouched = structuredClone(current)
    const next = applyQuotationTemplate(
      current,
      "editorial-olive",
      "midnight-film",
      { now: "2026-08-28T12:00:00.000Z" }
    )
    const midnight = quotationTemplates.find(
      (template) => template.id === "midnight-film"
    )!

    expect(current).toEqual(untouched)
    expect(omitVisuals(next)).toEqual(omitVisuals(current))
    expect(next.revision).toBe(current.revision + 1)
    expect(next.updatedAt).toBe("2026-08-28T12:00:00.000Z")
    expect(next.pages[0]?.background).toBe(midnight.palette.background)
    expect(next.pages.at(-1)?.background).toBe(midnight.palette.background)
    expect(next.nodes.find((node) => node.id === "manual-note")).toEqual(
      expect.objectContaining({
        name: "Agent-approved note",
        text: "Keep this accepted change",
        color: "#7c3aed",
      })
    )
    expect(next.groups).toEqual(current.groups)
    expect(next.outputs).toEqual(current.outputs)
    expect(next.fields).toEqual(current.fields)
    expect(next.fieldValues).toEqual(current.fieldValues)
    expect(next.bindings).toEqual(current.bindings)
    expect(inferQuotationTemplateId(current, "warm-paper")).toBe(
      "editorial-olive"
    )
    expect(inferQuotationTemplateId(next, "warm-paper")).toBe("midnight-film")
    expect(
      validateDocument(next).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("returns the same aggregate when the selected template is active", () => {
    const current = createEditedDocument()
    expect(
      applyQuotationTemplate(current, "editorial-olive", "editorial-olive")
    ).toBe(current)
  })

  it("keeps rich text, reusable paint, and variable-controlled colors coherent", () => {
    const current = createEditedDocument()
    const editorial = quotationTemplates.find(
      (template) => template.id === "editorial-olive"
    )!
    const midnight = quotationTemplates.find(
      (template) => template.id === "midnight-film"
    )!
    const note = current.nodes.find((node) => node.id === "manual-note")
    const panel = current.nodes.find((node) => node.type === "rect")
    if (!note || note.type !== "text" || !panel || panel.type !== "rect") {
      throw new Error("Missing template resource fixtures")
    }

    current.paintStyles = [
      {
        id: "paint-template-accent",
        name: "Template / Accent",
        color: editorial.palette.accent,
        opacity: 0.84,
      },
    ]
    note.paintStyleId = "paint-template-accent"
    note.color = editorial.palette.accent
    note.opacity = 0.84
    note.runs = [
      {
        start: 0,
        end: 4,
        style: { color: editorial.palette.muted },
      },
    ]
    current.variables = [
      {
        id: "variable-template-surface",
        name: "Template / Surface",
        type: "color",
        value: editorial.palette.surface,
      },
    ]
    current.variableBindings = [
      {
        id: "binding-template-surface",
        variableId: "variable-template-surface",
        target: { kind: "node", nodeId: panel.id, property: "fill" },
      },
    ]
    panel.fill = editorial.palette.surface

    const next = applyQuotationTemplate(
      current,
      "editorial-olive",
      "midnight-film"
    )
    const nextNote = next.nodes.find((node) => node.id === note.id)
    const nextPanel = next.nodes.find((node) => node.id === panel.id)

    expect(next.paintStyles[0]).toMatchObject({
      id: "paint-template-accent",
      color: midnight.palette.accent,
    })
    expect(nextNote).toMatchObject({
      paintStyleId: "paint-template-accent",
      color: midnight.palette.accent,
      opacity: 0.84,
    })
    expect(
      nextNote?.type === "text" ? nextNote.runs[0]?.style.color : null
    ).toBe(midnight.palette.muted)
    expect(next.variables[0]).toMatchObject({
      id: "variable-template-surface",
      value: midnight.palette.surface,
    })
    expect(nextPanel).toMatchObject({ fill: midnight.palette.surface })
    expect(next.variableBindings).toEqual(current.variableBindings)
    expect(
      validateDocument(next).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("uses the supplied fallback when a document has no quotation tokens", () => {
    const current = createEditedDocument()
    current.pages.forEach((page) => {
      page.background = "#123456"
    })
    current.nodes.forEach((node) => {
      if (node.type === "text") node.color = "#123456"
      if (node.type === "rect" || node.type === "ellipse") {
        node.fill = "#123456"
        node.stroke = "#123456"
      }
      if (node.type === "line") node.stroke = "#123456"
      if (node.type === "icon") {
        node.fill = "#123456"
        node.stroke = "#123456"
      }
    })

    expect(inferQuotationTemplateId(current, "warm-paper")).toBe("warm-paper")
  })
})
