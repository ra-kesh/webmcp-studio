import { describe, expect, it } from "vitest"
import {
  composeQuotationDocument,
  northstarQuotationPayload,
} from "@webmcp/document"
import {
  chooseQuotationRefreshCollision,
  emptyQuotationRefreshJournal,
  quotationRefreshJournalForStorage,
  quotationRefreshJournalSchema,
  resolveQuotationRefresh,
  setPendingQuotationRefresh,
} from "./quotation-refresh-journal"

const hash = (digit: string) => `sha256-${digit.repeat(64)}`

const pendingRefresh = () => ({
  id: "refresh-1",
  preparedAt: "2026-08-30T00:00:00.000Z",
  documentId: "quotation-document",
  baseDocumentRevision: 8,
  baseHistorySnapshotId: "history-base",
  baseDraftSnapshotId: hash("1"),
  base: {
    quotationId: northstarQuotationPayload.source.quotationId,
    sourceRevision: 3,
    quoteVersion: 3,
    contractVersion: 1 as const,
    sourceSnapshotId: hash("2"),
  },
  incoming: {
    quotationId: northstarQuotationPayload.source.quotationId,
    sourceRevision: 4,
    quoteVersion: 4,
    contractVersion: 1 as const,
    sourceSnapshotId: hash("3"),
  },
  incomingSource: {
    ...structuredClone(northstarQuotationPayload),
    source: { ...northstarQuotationPayload.source, revision: 4 },
    quote: { ...northstarQuotationPayload.quote, quoteVersion: 4 },
  },
  baseContentSnapshotId: hash("5"),
  candidateContentSnapshotId: hash("6"),
  candidateDocument: {
    ...composeQuotationDocument(northstarQuotationPayload),
    id: "quotation-document",
    revision: 9,
  },
  composerVersion: 2,
  template: { id: "quotation-editorial-olive", version: 2 },
  appearanceTemplateId: "editorial-olive" as const,
  proposalId: hash("4"),
  impact: {
    changedSourcePaths: ["document.title"],
    changedCategories: ["Document details"],
    generatedPageCount: 6,
    previousGeneratedPageCount: 6,
    generatedLayerCount: 90,
    addedSourceLayers: 0,
    removedSourceLayers: 0,
    updatedSourceLayers: 1,
    preservedStudioLayers: 1,
    preservedCustomLayerCount: 0,
    businessChanges: [{ category: "Events", added: 0, removed: 0, updated: 1 }],
    conflicts: [
      {
        kind: "changed_by_both" as const,
        semanticKey: "cover.title",
        layerName: "Quotation title",
        properties: ["text"],
      },
    ],
  },
  collisionChoices: {},
})

describe("quotation refresh journal", () => {
  it("keeps unrelated draft envelopes byte-compatible until refresh history exists", () => {
    expect(
      quotationRefreshJournalForStorage(emptyQuotationRefreshJournal())
    ).toBeUndefined()
  })

  it("persists one exact pending refresh and explicit collision choices", () => {
    const pending = pendingRefresh()
    const proposed = setPendingQuotationRefresh(
      emptyQuotationRefreshJournal(),
      pending
    )
    const decided = chooseQuotationRefreshCollision(
      proposed,
      "cover.title",
      "preserve_studio"
    )

    expect(decided.pending?.incomingSource).toEqual(pending.incomingSource)
    expect(decided.pending?.collisionChoices).toEqual({
      "cover.title": "preserve_studio",
    })
    expect(() => setPendingQuotationRefresh(decided, pending)).toThrow(
      "Resolve or reject"
    )
  })

  it("moves a decision to the bounded resolved log without raw source data", () => {
    const pending = pendingRefresh()
    const proposed = setPendingQuotationRefresh(
      emptyQuotationRefreshJournal(),
      pending
    )
    const resolved = resolveQuotationRefresh(proposed, {
      id: pending.id,
      decision: "rejected",
      decidedAt: "2026-08-30T00:05:00.000Z",
      base: pending.base,
      incoming: pending.incoming,
      composerVersion: pending.composerVersion,
      template: pending.template,
      appearanceTemplateId: pending.appearanceTemplateId,
      proposalId: pending.proposalId,
      impact: {
        changedCategories: pending.impact.changedCategories,
        generatedPageCount: pending.impact.generatedPageCount,
        previousGeneratedPageCount: pending.impact.previousGeneratedPageCount,
        generatedLayerCount: pending.impact.generatedLayerCount,
        addedSourceLayers: pending.impact.addedSourceLayers,
        removedSourceLayers: pending.impact.removedSourceLayers,
        updatedSourceLayers: pending.impact.updatedSourceLayers,
        preservedStudioLayers: pending.impact.preservedStudioLayers,
        preservedCustomLayerCount: pending.impact.preservedCustomLayerCount,
        businessChanges: pending.impact.businessChanges,
      },
      collisionChoices: {},
      baseContentSnapshotId: pending.baseContentSnapshotId,
      resultContentSnapshotId: null,
      resultDocumentRevision: null,
    })

    expect(resolved.pending).toBeNull()
    expect(resolved.resolved).toHaveLength(1)
    expect(JSON.stringify(resolved.resolved[0])).not.toContain(
      northstarQuotationPayload.document.title
    )
  })

  it("rejects a refresh sidecar whose pending recovery payload exceeds 8 MB", () => {
    const pending = pendingRefresh()
    pending.incomingSource.document.fixedTerms[0]!.text = "x".repeat(
      8 * 1024 * 1024
    )
    expect(
      quotationRefreshJournalSchema.safeParse({
        pending,
        resolved: [],
      }).success
    ).toBe(false)
  })
})
