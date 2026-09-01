import { describe, expect, it } from "vitest"
import {
  analyzeQuotationGroupOrganization,
  analyzeQuotationTextEditability,
  applyQuotationGroupOrganization,
  applyQuotationTextEditability,
  composeQuotationDocument,
  northstarQuotationPayload,
  QUOTATION_COMPOSER_VERSION,
  QUOTATION_TEXT_EDITABILITY_MIGRATION_ID,
  QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION,
  QUOTATION_TEXT_EDITABILITY_TARGET_TEMPLATE_VERSION,
} from "../src"
import type { SceneNode } from "../src"

const composed = () =>
  composeQuotationDocument(northstarQuotationPayload, "editorial-olive")

const composerV3Document = () => {
  const document = composed()
  document.nodes = document.nodes.map((node) =>
    node.type === "text" ? { ...node, locked: true } : node
  )
  return document
}

describe("quotation content migrations", () => {
  it("freezes the named editability migration to exact composer and template version 4", () => {
    expect(QUOTATION_TEXT_EDITABILITY_TARGET_COMPOSER_VERSION).toBe(4)
    expect(QUOTATION_TEXT_EDITABILITY_TARGET_TEMPLATE_VERSION).toBe(4)
  })

  it("prepares an explicit v3 to v4 text-editability upgrade with exact impact", () => {
    const current = composerV3Document()
    const generatedText = current.nodes.filter((node) => node.type === "text")
    const generatedStructural = current.nodes.filter(
      (node) => node.type === "rect" || node.type === "line"
    )
    const alreadyEditable = generatedText[0]!
    alreadyEditable.locked = false
    const customText: SceneNode = {
      ...structuredClone(generatedText[1]!),
      id: "custom-client-note",
      name: "Client note",
      locked: true,
    }
    current.nodes.push(customText)
    current.pages[0]!.nodeIds.push(customText.id)

    const analysis = analyzeQuotationTextEditability(
      current,
      northstarQuotationPayload,
      "editorial-olive",
      3
    )

    expect(analysis).toMatchObject({
      status: "available",
      migrationId: QUOTATION_TEXT_EDITABILITY_MIGRATION_ID,
      fromComposerVersion: 3,
      toComposerVersion: QUOTATION_COMPOSER_VERSION,
      documentId: current.id,
      documentRevision: current.revision,
      impact: {
        generatedTextLayerCount: generatedText.length,
        unlockTextLayerCount: generatedText.length - 1,
        alreadyEditableTextLayerCount: 1,
        preservedStructuralLayerCount: generatedStructural.length,
        preservedCustomLayerCount: 1,
      },
    })
    if (analysis.status !== "available") return
    expect(analysis.targets).toHaveLength(generatedText.length - 1)
    expect(analysis.targets).not.toContainEqual(
      expect.objectContaining({ nodeId: customText.id })
    )
  })

  it("unlocks only analyzed generated text and preserves every other byte", () => {
    const current = composerV3Document()
    const generatedText = current.nodes.filter((node) => node.type === "text")
    const customText: SceneNode = {
      ...structuredClone(generatedText[0]!),
      id: "custom-locked-note",
      name: "Deliberately locked custom note",
      locked: true,
    }
    current.nodes.push(customText)
    current.pages[0]!.nodeIds.push(customText.id)
    const before = structuredClone(current)
    const analysis = analyzeQuotationTextEditability(
      current,
      northstarQuotationPayload,
      "editorial-olive",
      3
    )
    expect(analysis.status).toBe("available")
    if (analysis.status !== "available") return

    const upgraded = applyQuotationTextEditability(
      current,
      analysis,
      "2026-09-01T12:00:00.000Z"
    )

    expect(
      upgraded.nodes
        .filter((node) =>
          analysis.targets.some(({ nodeId }) => nodeId === node.id)
        )
        .every((node) => node.locked === false)
    ).toBe(true)
    expect(
      upgraded.nodes.find((node) => node.id === customText.id)?.locked
    ).toBe(true)
    expect(
      upgraded.nodes
        .filter((node) => node.type === "rect" || node.type === "line")
        .every((node) => node.locked)
    ).toBe(true)
    expect({
      ...upgraded,
      nodes: upgraded.nodes.map((node) => {
        const original = before.nodes.find(
          (candidate) => candidate.id === node.id
        )!
        return { ...node, locked: original.locked }
      }),
      revision: before.revision,
      updatedAt: before.updatedAt,
    }).toEqual(before)
  })

  it("blocks unknown, retired, and structurally ambiguous text upgrades", () => {
    const current = composerV3Document()
    expect(
      analyzeQuotationTextEditability(current, null, "editorial-olive", null)
    ).toMatchObject({ status: "not_applicable" })
    expect(
      analyzeQuotationTextEditability(
        current,
        northstarQuotationPayload,
        "editorial-olive",
        2
      )
    ).toMatchObject({ status: "blocked", reason: expect.stringContaining("2") })

    const moved = structuredClone(current)
    const movedText = moved.nodes.find((node) => node.type === "text")!
    moved.pages[0]!.nodeIds = moved.pages[0]!.nodeIds.filter(
      (nodeId) => nodeId !== movedText.id
    )
    moved.pages[1]!.nodeIds.push(movedText.id)
    expect(
      analyzeQuotationTextEditability(
        moved,
        northstarQuotationPayload,
        "editorial-olive",
        3
      )
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("original page"),
    })
  })

  it("recognizes composer v4 and rejects a stale prepared text upgrade", () => {
    expect(
      analyzeQuotationTextEditability(
        composed(),
        northstarQuotationPayload,
        "editorial-olive",
        QUOTATION_COMPOSER_VERSION
      )
    ).toMatchObject({ status: "already_current" })

    const current = composerV3Document()
    const analysis = analyzeQuotationTextEditability(
      current,
      northstarQuotationPayload,
      "editorial-olive",
      3
    )
    expect(analysis.status).toBe("available")
    if (analysis.status !== "available") return
    expect(() =>
      applyQuotationTextEditability(
        { ...current, revision: current.revision + 1 },
        analysis
      )
    ).toThrow("document changed")
    const mutatedWithoutRevision = structuredClone(current)
    const target = analysis.targets[0]!
    mutatedWithoutRevision.nodes.find(
      (node) => node.id === target.nodeId
    )!.locked = false
    expect(() =>
      applyQuotationTextEditability(mutatedWithoutRevision, analysis)
    ).toThrow(target.nodeId)
  })

  it("keeps an all-editable composer-v3 document explicitly upgradeable", () => {
    const current = composerV3Document()
    current.nodes = current.nodes.map((node) =>
      node.type === "text" ? { ...node, locked: false } : node
    )
    const analysis = analyzeQuotationTextEditability(
      current,
      northstarQuotationPayload,
      "editorial-olive",
      3
    )

    expect(analysis).toMatchObject({
      status: "available",
      toComposerVersion: 4,
      targets: [],
      impact: { unlockTextLayerCount: 0 },
    })
    if (analysis.status !== "available") return
    const upgraded = applyQuotationTextEditability(
      current,
      analysis,
      "2026-09-01T12:00:00.000Z"
    )
    expect(upgraded.nodes).toEqual(current.nodes)
    expect(upgraded.revision).toBe(current.revision + 1)
  })

  it("prepares an explicit group-only upgrade for a flat legacy quotation", () => {
    const current = composed()
    current.groups = []
    const firstText = current.nodes.find((node) => node.type === "text")
    if (!firstText || firstText.type !== "text") throw new Error("Missing text")
    firstText.text = "Client-approved wording"
    firstText.name = "Renamed by the user"
    firstText.x += 17
    current.pages[0]!.nodeIds.reverse()

    const before = structuredClone(current)
    const analysis = analyzeQuotationGroupOrganization(
      current,
      northstarQuotationPayload,
      "editorial-olive"
    )
    expect(analysis.status).toBe("available")
    if (analysis.status !== "available") return

    const upgraded = applyQuotationGroupOrganization(
      current,
      analysis,
      "2026-08-29T12:00:00.000Z"
    )
    expect(upgraded.groups.length).toBeGreaterThan(50)
    expect(upgraded.revision).toBe(before.revision + 1)
    expect(upgraded.updatedAt).toBe("2026-08-29T12:00:00.000Z")
    expect({
      ...upgraded,
      groups: [],
      revision: before.revision,
      updatedAt: before.updatedAt,
    }).toEqual(before)
    const coverIdentity = upgraded.groups.find(
      (group) => group.name === "Cover identity"
    )
    expect(coverIdentity?.nodeIds).toEqual(
      upgraded.pages[0]!.nodeIds.filter((nodeId) =>
        new Set(["text-2", "text-3", "text-4", "text-5"]).has(nodeId)
      )
    )
  })

  it("does not infer an upgrade over existing custom or partial grouping", () => {
    const current = composed()
    current.groups = [current.groups[0]!]

    expect(
      analyzeQuotationGroupOrganization(
        current,
        northstarQuotationPayload,
        "editorial-olive"
      )
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("custom"),
    })
  })

  it("blocks when composer-owned node identity or page membership drifted", () => {
    const current = composed()
    current.groups = []
    const nodeId = "text-2"
    current.nodes = current.nodes.filter((node) => node.id !== nodeId)
    current.pages[0]!.nodeIds = current.pages[0]!.nodeIds.filter(
      (candidate) => candidate !== nodeId
    )

    expect(
      analyzeQuotationGroupOrganization(
        current,
        northstarQuotationPayload,
        "editorial-olive"
      )
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining(nodeId),
    })
  })

  it("blocks when the linked source no longer describes every composer-owned layer", () => {
    const current = composed()
    current.groups = []
    const sourceWithoutAddress = structuredClone(northstarQuotationPayload)
    sourceWithoutAddress.branding.address = null

    expect(
      analyzeQuotationGroupOrganization(
        current,
        sourceWithoutAddress,
        "editorial-olive"
      )
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("composer-owned layer"),
    })
  })

  it("rejects an available analysis after the document revision or identity changes", () => {
    const current = composed()
    current.groups = []
    const analysis = analyzeQuotationGroupOrganization(
      current,
      northstarQuotationPayload,
      "editorial-olive"
    )
    expect(analysis.status).toBe("available")
    if (analysis.status !== "available") return

    expect(() =>
      applyQuotationGroupOrganization(
        { ...current, revision: current.revision + 1 },
        analysis
      )
    ).toThrow("document changed")
    expect(() =>
      applyQuotationGroupOrganization(
        { ...current, id: `${current.id}-copy` },
        analysis
      )
    ).toThrow("document changed")
  })

  it("recognizes the current semantic groups without proposing a rewrite", () => {
    expect(
      analyzeQuotationGroupOrganization(
        composed(),
        northstarQuotationPayload,
        "editorial-olive"
      )
    ).toEqual({ status: "already_current" })
  })
})
