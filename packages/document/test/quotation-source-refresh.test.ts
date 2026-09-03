import { describe, expect, it } from "vitest"
import {
  applyQuotationTemplate,
  composeQuotationDocument,
  northstarQuotationPayload,
  prepareQuotationRefresh,
  validateDocument,
} from "../src"
import type { SceneNode } from "../src"

const incomingSource = () => {
  const source = structuredClone(northstarQuotationPayload)
  source.source.revision += 1
  source.quote.quoteVersion += 1
  return source
}

const customRect = (id: string, name: string) =>
  ({
    id,
    type: "rect",
    name,
    x: 80,
    y: 80,
    width: 120,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    constraints: { horizontal: "min", vertical: "min" },
    fill: "#ff00ff",
    radius: 8,
    strokeWidth: 0,
  }) satisfies SceneNode

function deleteNode(
  document: ReturnType<typeof composeQuotationDocument>,
  id: string
) {
  document.nodes = document.nodes.filter((node) => node.id !== id)
  document.pages = document.pages.map((page) => ({
    ...page,
    nodeIds: page.nodeIds.filter((nodeId) => nodeId !== id),
  }))
  document.groups = document.groups.flatMap((group) => {
    const nodeIds = group.nodeIds.filter((nodeId) => nodeId !== id)
    return nodeIds.length ? [{ ...group, nodeIds }] : []
  })
  document.bindings = document.bindings.filter(
    (binding) => binding.nodeId !== id
  )
}

describe("quotation source refresh", () => {
  it("rejects a different quotation and non-monotonic revisions", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const different = incomingSource()
    different.source.quotationId = "another-quotation"
    expect(() =>
      prepareQuotationRefresh({
        currentDocument,
        currentSource: northstarQuotationPayload,
        incomingSource: different,
        templateId: "editorial-olive",
      })
    ).toThrow("same source quotation ID")
    expect(() =>
      prepareQuotationRefresh({
        currentDocument,
        currentSource: northstarQuotationPayload,
        incomingSource: northstarQuotationPayload,
        templateId: "editorial-olive",
      })
    ).toThrow("newer source document revision")
  })

  it("applies upstream-only changes and keeps a valid document", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const incoming = incomingSource()
    incoming.document.events[0]!.location = "The New Courtyard"
    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
      now: "2026-08-30T00:00:00.000Z",
    })

    expect(result.impact.changedCategories).toContain("Events")
    expect(result.impact.updatedSourceLayers).toBeGreaterThan(0)
    expect(result.impact.conflicts).toEqual([])
    expect(
      result.document.nodes.some(
        (node) =>
          node.type === "text" && node.text.includes("The New Courtyard")
      )
    ).toBe(true)
    expect(validateDocument(result.document)).toEqual([])
  })

  it("preserves Studio-only edits and reports divergent collisions", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const currentTitle = currentDocument.nodes.find(
      (node) => node.name === "Quotation title" && node.type === "text"
    )
    if (!currentTitle || currentTitle.type !== "text")
      throw new Error("Missing title")
    currentTitle.text = "A hand-edited Studio title"
    currentTitle.fontSize = 82
    const incoming = incomingSource()
    incoming.document.title = "An updated source title"
    const preserved = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
      conflictPolicy: "preserve_studio",
    })
    const sourceWins = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
      conflictPolicy: "use_source",
    })

    const preservedTitle = preserved.document.nodes.find(
      (node) => node.id === currentTitle.id && node.type === "text"
    )
    const sourceTitle = sourceWins.document.nodes.find(
      (node) => node.id === currentTitle.id && node.type === "text"
    )
    expect(preservedTitle).toMatchObject({
      text: "A hand-edited Studio title",
      fontSize: 82,
    })
    expect(sourceTitle).toMatchObject({
      text: "An updated source\ntitle",
      fontSize: 82,
    })
    expect(preserved.impact.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ semanticKey: "cover.title" }),
      ])
    )
  })

  it("matches keyed source items through reorder and repagination", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const welcomeTitle = currentDocument.nodes.find(
      (node) => node.name === "Welcome dinner title" && node.type === "text"
    )
    if (!welcomeTitle || welcomeTitle.type !== "text") {
      throw new Error("Missing welcome title")
    }
    welcomeTitle.fontWeight = 700
    const incoming = incomingSource()
    incoming.document.events.reverse()
    incoming.document.fixedTerms = Array.from({ length: 30 }, (_, index) => ({
      key: `refresh-term-${index}`,
      text: `Refresh term ${index + 1}`,
    }))
    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
    })
    const preservedWelcome = result.document.nodes.find(
      (node) => node.id === welcomeTitle.id && node.type === "text"
    )

    expect(result.document.pages.length).toBeGreaterThan(
      currentDocument.pages.length
    )
    expect(preservedWelcome).toMatchObject({
      text: "Welcome dinner",
      fontWeight: 700,
    })
    expect(validateDocument(result.document)).toEqual([])
  })

  it("keeps an applied appearance while merging against its original composition", () => {
    const original = composeQuotationDocument(
      northstarQuotationPayload,
      "editorial-olive"
    )
    const currentDocument = applyQuotationTemplate(
      original,
      "editorial-olive",
      "midnight-film"
    )
    const welcomeDetail = currentDocument.nodes.find(
      (node) => node.name === "Welcome dinner detail 1" && node.type === "text"
    )
    if (!welcomeDetail || welcomeDetail.type !== "text") {
      throw new Error("Missing welcome detail")
    }
    welcomeDetail.text = "Studio-authored welcome dinner location"
    const incoming = incomingSource()
    incoming.document.events[0]!.location = "The New Courtyard"

    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      compositionTemplateId: "editorial-olive",
      templateId: "midnight-film",
      collisionChoices: {
        "event.welcome.schedule": "preserve_studio",
      },
    })

    expect(result.document.pages[0]?.background).toBe(
      currentDocument.pages[0]?.background
    )
    expect(
      result.document.nodes.find(
        (node) => node.id === welcomeDetail.id && node.type === "text"
      )
    ).toMatchObject({
      text: "Studio-authored welcome dinner location",
      color: welcomeDetail.color,
    })
    expect(result.impact.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          semanticKey: "event.welcome.schedule",
          properties: ["text"],
        }),
      ])
    )
  })

  it("preserves custom layers and nested groups when their exact page anchor is unchanged", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const page = currentDocument.pages[0]!
    const parentNode = customRect("custom-parent-node", "Custom parent")
    const childNode = customRect("custom-child-node", "Custom child")
    currentDocument.nodes.push(parentNode, childNode)
    page.nodeIds.push(parentNode.id, childNode.id)
    currentDocument.groups.push(
      {
        id: "custom-child-group",
        role: "organize",
        name: "Custom child group",
        pageId: page.id,
        nodeIds: [childNode.id],
        parentGroupId: "custom-parent-group",
      },
      {
        id: "custom-parent-group",
        role: "organize",
        name: "Custom parent group",
        pageId: page.id,
        nodeIds: [parentNode.id],
      }
    )
    const incoming = incomingSource()
    incoming.document.fixedTerms[0]!.text = "Updated source term"

    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
    })

    expect(result.document.pages[0]?.nodeIds).toEqual(
      expect.arrayContaining([parentNode.id, childNode.id])
    )
    expect(result.document.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "custom-child-group",
          parentGroupId: "custom-parent-group",
        }),
        expect.objectContaining({ id: "custom-parent-group" }),
      ])
    )
  })

  it("blocks instead of relocating custom layers when a source page repaginates", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const participantPage = currentDocument.pages[1]!
    const customNode = customRect("custom-participant-note", "Participant note")
    currentDocument.nodes.push(customNode)
    participantPage.nodeIds.push(customNode.id)
    const incoming = incomingSource()
    incoming.document.participants[0]!.contact.email = null

    expect(() =>
      prepareQuotationRefresh({
        currentDocument,
        currentSource: northstarQuotationPayload,
        incomingSource: incoming,
        templateId: "editorial-olive",
      })
    ).toThrow("custom layers on repaginated source pages")
  })

  it("preserves an intentional generated-group deletion when source structure is unchanged", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const removedGroup = currentDocument.groups.find(
      (group) => group.name === "Welcome dinner"
    )
    if (!removedGroup) throw new Error("Missing generated group")
    currentDocument.groups = currentDocument.groups.filter(
      (group) => group.id !== removedGroup.id
    )
    const incoming = incomingSource()
    incoming.quote.quoteNumber = "Q-UPDATED-GROUP-PRESERVATION"

    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
    })

    expect(
      result.document.groups.some((group) => group.id === removedGroup.id)
    ).toBe(false)
  })

  it("preserves a generated-node deletion when its source value is unchanged", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const deletedNode = currentDocument.nodes.find(
      (node) => node.name === "Welcome dinner detail 1"
    )
    if (!deletedNode) throw new Error("Missing generated event detail")
    deleteNode(currentDocument, deletedNode.id)
    const incoming = incomingSource()
    incoming.quote.quoteNumber = "Q-DELETION-PRESERVED"

    const result = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
    })

    expect(
      result.document.nodes.some((node) => node.id === deletedNode.id)
    ).toBe(false)
    expect(
      result.impact.conflicts.some(
        (conflict) => conflict.semanticKey === "event.welcome.schedule"
      )
    ).toBe(false)
    expect(validateDocument(result.document)).toEqual([])
  })

  it("requires a choice when Studio deleted a generated node that its source changed", () => {
    const currentDocument = composeQuotationDocument(northstarQuotationPayload)
    const deletedNode = currentDocument.nodes.find(
      (node) => node.name === "Welcome dinner detail 1"
    )
    if (!deletedNode) throw new Error("Missing generated event detail")
    deleteNode(currentDocument, deletedNode.id)
    const incoming = incomingSource()
    incoming.document.events[0]!.location = "The Changed Courtyard"

    const preserved = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
      collisionChoices: {
        "event.welcome.schedule": "preserve_studio",
      },
    })
    const sourceWins = prepareQuotationRefresh({
      currentDocument,
      currentSource: northstarQuotationPayload,
      incomingSource: incoming,
      templateId: "editorial-olive",
      collisionChoices: {
        "event.welcome.schedule": "use_source",
      },
    })

    expect(
      preserved.impact.conflicts.find(
        (conflict) => conflict.semanticKey === "event.welcome.schedule"
      )
    ).toMatchObject({
      kind: "changed_by_both",
      properties: expect.arrayContaining(["text"]),
    })
    expect(
      preserved.document.nodes.some((node) => node.id === deletedNode.id)
    ).toBe(false)
    expect(
      sourceWins.document.nodes.find(
        (node) =>
          node.name === "Welcome dinner detail 1" &&
          node.type === "text" &&
          node.text.includes("The Changed Courtyard")
      )
    ).toBeDefined()
    expect(validateDocument(preserved.document)).toEqual([])
    expect(validateDocument(sourceWins.document)).toEqual([])
  })
})
