import { describe, expect, it } from "vitest"
import {
  composeQuotationDocument,
  composeTracedQuotationDocument,
  northstarQuotationPayload,
  quotationRenderPayloadV1Schema,
  quotationTemplates,
  validateDocument,
} from "../src"

function tracedText(
  composition: ReturnType<typeof composeTracedQuotationDocument>,
  semanticKey: string
) {
  const nodeId = composition.trace.nodeIdsBySemanticKey[semanticKey]
  const node = composition.document.nodes.find(
    (candidate) => candidate.id === nodeId
  )
  expect(node?.type).toBe("text")
  return node?.type === "text" ? node.text : undefined
}

function tracedPageId(
  composition: ReturnType<typeof composeTracedQuotationDocument>,
  semanticKey: string
) {
  const nodeId = composition.trace.nodeIdsBySemanticKey[semanticKey]
  return composition.document.pages.find((page) =>
    page.nodeIds.includes(nodeId ?? "")
  )?.id
}

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
    expect(renderedText).toContain("₹4,85,000")
    expect(renderedText).not.toContain("₹\u00a0")
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

  it("emits a unique semantic trace without changing canonical output", () => {
    const canonical = composeQuotationDocument(northstarQuotationPayload)
    const traced = composeTracedQuotationDocument(northstarQuotationPayload)
    const nodeIds = Object.values(traced.trace.nodeIdsBySemanticKey)
    const groupIds = Object.values(traced.trace.groupIdsBySemanticKey)

    expect(traced.document).toEqual(canonical)
    expect(JSON.stringify(traced.document)).toBe(JSON.stringify(canonical))
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
    expect(new Set(groupIds).size).toBe(groupIds.length)
    expect(nodeIds).toHaveLength(canonical.nodes.length)
    expect(groupIds).toHaveLength(canonical.groups.length)
    expect(
      traced.trace.nodeIdsBySemanticKey["event.welcome.title"]
    ).toBeTruthy()
    expect(
      traced.trace.nodeIdsBySemanticKey[
        "package.signature.deliverable.signature-film.value"
      ]
    ).toBeTruthy()
  })

  it("keeps business semantic keys stable when keyed records are reordered", () => {
    const reordered = structuredClone(northstarQuotationPayload)
    reordered.document.participants.reverse()
    reordered.document.events.reverse()
    reordered.document.packages.reverse()
    reordered.document.packages.forEach((item) => {
      item.coverage.reverse()
      item.deliverables.reverse()
    })
    reordered.document.deliveryTimelines.reverse()
    reordered.document.paymentMilestones.reverse()
    reordered.document.fixedTerms.reverse()
    const before = composeTracedQuotationDocument(northstarQuotationPayload)
    const after = composeTracedQuotationDocument(reordered)

    const stableBusinessKeys = [
      ...northstarQuotationPayload.document.participants.flatMap(({ key }) => [
        `participant.${key}.title`,
        `participant.${key}.email`,
        `participant.${key}.phone`,
        `participant.${key}.address`,
      ]),
      ...northstarQuotationPayload.document.events.flatMap(({ key }) => [
        `event.${key}.title`,
        `event.${key}.schedule`,
        `event.${key}.audience`,
      ]),
      ...northstarQuotationPayload.document.packages.flatMap((item) => [
        `package.${item.key}.investment.value`,
        ...item.coverage.map(
          ({ key }) => `package.${item.key}.coverage.${key}.value`
        ),
        ...item.deliverables.map(
          ({ key }) => `package.${item.key}.deliverable.${key}.value`
        ),
      ]),
      ...northstarQuotationPayload.document.deliveryTimelines.map(
        ({ key }) => `delivery.${key}.value`
      ),
      ...northstarQuotationPayload.document.paymentMilestones.map(
        ({ key }) => `payment.${key}.value`
      ),
      ...northstarQuotationPayload.document.fixedTerms.map(
        ({ key }) => `term.${key}.value`
      ),
    ]

    for (const semanticKey of stableBusinessKeys) {
      expect(tracedText(after, semanticKey), semanticKey).toBe(
        tracedText(before, semanticKey)
      )
    }
  })

  it.each(["email", "phoneNumber", "address"] as const)(
    "does not shift participant semantic identity when %s is removed",
    (removedProperty) => {
      const changed = structuredClone(northstarQuotationPayload)
      changed.document.participants[0]!.contact[removedProperty] = null
      const before = composeTracedQuotationDocument(northstarQuotationPayload)
      const after = composeTracedQuotationDocument(changed)
      const removedRole =
        removedProperty === "phoneNumber" ? "phone" : removedProperty

      expect(
        after.trace.nodeIdsBySemanticKey[`participant.aditi.${removedRole}`]
      ).toBeUndefined()
      for (const role of ["email", "phone", "address"]) {
        if (role === removedRole) continue
        expect(tracedText(after, `participant.aditi.${role}`)).toBe(
          tracedText(before, `participant.aditi.${role}`)
        )
      }
    }
  )

  it("uses explicit roles for optional branding contact values", () => {
    const changed = structuredClone(northstarQuotationPayload)
    changed.branding.email = null
    const before = composeTracedQuotationDocument(northstarQuotationPayload)
    const after = composeTracedQuotationDocument(changed)

    expect(
      after.trace.nodeIdsBySemanticKey["closing.contact.email"]
    ).toBeUndefined()
    expect(tracedText(after, "closing.contact.phone")).toBe(
      tracedText(before, "closing.contact.phone")
    )
    expect(tracedText(after, "closing.contact.address")).toBe(
      tracedText(before, "closing.contact.address")
    )
  })

  it("keeps a manually edited business key associated after repagination", () => {
    const expanded = structuredClone(northstarQuotationPayload)
    const seed = expanded.document.events[0]!
    expanded.document.events.unshift(
      ...Array.from({ length: 12 }, (_, index) => ({
        ...structuredClone(seed),
        key: `added-event-${index + 1}`,
        eventType: {
          ...seed.eventType,
          key: `added-event-${index + 1}`,
          label: `Added event ${index + 1}`,
        },
      }))
    )
    const semanticKey = "event.wedding.title"
    const before = composeTracedQuotationDocument(northstarQuotationPayload)
    const edited = structuredClone(before.document)
    const editedNodeId = before.trace.nodeIdsBySemanticKey[semanticKey]
    const editedNode = edited.nodes.find((node) => node.id === editedNodeId)
    if (!editedNode || editedNode.type !== "text") {
      throw new Error("Expected the traced wedding title text node.")
    }
    editedNode.text = "Studio-edited wedding title"
    const after = composeTracedQuotationDocument(expanded)

    expect(tracedPageId(after, semanticKey)).not.toBe(
      tracedPageId(before, semanticKey)
    )
    expect(tracedText(after, semanticKey)).toBe(tracedText(before, semanticKey))
    expect(editedNode.text).toBe("Studio-edited wedding title")
    expect(
      Object.keys(after.trace.nodeIdsBySemanticKey).every(
        (key) => !key.startsWith("page.")
      )
    ).toBe(true)
    expect(
      Object.keys(after.trace.nodeIdsBySemanticKey).some((key) =>
        key.startsWith("composer.page-role.")
      )
    ).toBe(true)
  })
})
