import { describe, expect, it } from "vitest"
import {
  analyzeQuotationGroupOrganization,
  applyQuotationGroupOrganization,
  composeQuotationDocument,
  northstarQuotationPayload,
} from "../src"

const composed = () =>
  composeQuotationDocument(northstarQuotationPayload, "editorial-olive")

describe("quotation content migrations", () => {
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
