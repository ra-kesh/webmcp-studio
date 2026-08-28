import { describe, expect, it } from "vitest"
import {
  composeQuotationDocument,
  northstarQuotationPayload,
  quotationRenderPayloadV1Schema,
  quotationTemplates,
  validateDocument,
} from "../src"

describe("quotation composition", () => {
  it("accepts the versioned Stuwiz quotation payload", () => {
    expect(
      quotationRenderPayloadV1Schema.parse(northstarQuotationPayload).source
        .type
    ).toBe("stuwiz.quotation")
  })

  it("rejects unknown Stuwiz contract keys instead of stripping them", () => {
    expect(
      quotationRenderPayloadV1Schema.safeParse({
        ...northstarQuotationPayload,
        unexpected: true,
      }).success
    ).toBe(false)
    expect(
      quotationRenderPayloadV1Schema.safeParse({
        ...northstarQuotationPayload,
        source: { ...northstarQuotationPayload.source, unexpected: true },
      }).success
    ).toBe(false)
  })

  it("rejects broken source references and commercial totals", () => {
    const invalid = structuredClone(northstarQuotationPayload)
    invalid.document.packages[0]!.coverage[0]!.eventKey = "missing-event"
    invalid.document.paymentMilestones[0]!.percentage = "25"

    const result = quotationRenderPayloadV1Schema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "Coverage references an unknown event",
          "Payment percentages must total 100.00",
        ])
      )
    }
  })

  it("materializes all source sections across a dynamic page set", () => {
    const document = composeQuotationDocument(northstarQuotationPayload)
    const renderedText = document.nodes
      .filter((node) => node.type === "text")
      .map((node) => node.text)
      .join("\n")

    expect(document.outputs[0]?.pageIds).toHaveLength(document.pages.length)
    expect(document.pages.length).toBeGreaterThan(5)
    expect(renderedText).toContain("Welcome dinner")
    expect(renderedText).toContain("Legacy Story")
    expect(renderedText).toContain("Same-day edit")
    expect(renderedText).toContain("The booking amount is non-refundable")
    expect(validateDocument(document)).toEqual([])
  })

  it("composes semantic layer groups instead of a flat quotation node list", () => {
    const document = composeQuotationDocument(northstarQuotationPayload)
    const coverGroups = document.groups.filter(
      (group) => group.pageId === "quotation-page-1"
    )

    expect(coverGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Cover layout",
          nodeIds: ["rect-1"],
        }),
        expect.objectContaining({
          name: "Cover identity",
          nodeIds: ["text-2", "text-3", "text-4", "text-5"],
        }),
        expect.objectContaining({
          name: "Quotation details",
          nodeIds: ["rect-6", "text-7"],
        }),
        expect.objectContaining({
          name: "Date details",
          nodeIds: ["text-8", "text-9"],
        }),
      ])
    )
    expect(
      coverGroups.find((group) => group.name === "Cover identity")
        ?.parentGroupId
    ).toBe(coverGroups.find((group) => group.name === "Cover layout")?.id)
    expect(
      coverGroups.find((group) => group.name === "Date details")?.parentGroupId
    ).toBe(coverGroups.find((group) => group.name === "Quotation details")?.id)
    expect(
      document.pages.every((page) =>
        document.groups.some((group) => group.pageId === page.id)
      )
    ).toBe(true)
    expect(document.groups.length).toBeGreaterThan(50)
    expect(validateDocument(document)).toEqual([])
  })

  it("keeps content and pagination stable while templates change styling", () => {
    const documents = quotationTemplates.map((template) =>
      composeQuotationDocument(northstarQuotationPayload, template.id)
    )
    expect(new Set(documents.map((document) => document.pages.length))).toEqual(
      new Set([documents[0]?.pages.length])
    )
    expect(
      new Set(documents.map((document) => document.pages[0]?.background)).size
    ).toBe(quotationTemplates.length)
  })

  it("adds pages when the source grows instead of clipping content", () => {
    const base = composeQuotationDocument(northstarQuotationPayload)
    const expandedPayload = {
      ...northstarQuotationPayload,
      document: {
        ...northstarQuotationPayload.document,
        fixedTerms: Array.from({ length: 30 }, (_, index) => ({
          key: `expanded-term-${index + 1}`,
          text: `Operational term ${index + 1}: the production team and client will confirm this requirement in writing before the first event date.`,
        })),
      },
    }
    const expanded = composeQuotationDocument(expandedPayload)

    expect(expanded.pages.length).toBeGreaterThan(base.pages.length)
    expect(
      expanded.nodes.some(
        (node) =>
          node.type === "text" && node.text.includes("Operational term 30")
      )
    ).toBe(true)
  })
})
