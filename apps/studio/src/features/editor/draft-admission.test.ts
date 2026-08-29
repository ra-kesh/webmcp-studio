import {
  builtInDesignTemplateRepository,
  deriveDocumentSnapshotId,
  northstarQuotationPayload,
  prepareQuotationRefresh,
  quotationSourceFingerprint,
} from "@webmcp/document"
import type { ChangeSet } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import {
  DRAFT_MAX_ENCODED_BYTES,
  deriveDraftSnapshotId,
  encodedUtf8ByteLength,
  encodeCanonicalDraftEnvelope,
  prepareDraftAdmission,
} from "./draft-admission"
import { DOCUMENT_IMPORT_MAX_JSON_BYTES } from "./document-import"
import {
  createEmptyReviewJournal,
  createReviewProposal,
} from "./review-journal"
import { createKnownQuotationComposition } from "./quotation-composition-context"
import {
  quotationRefreshProposalId,
  type QuotationRefreshJournal,
} from "./quotation-refresh-journal"

const snapshot = (): CurrentDraftSnapshot => ({
  document: builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  ),
  sourceContext: {
    quotationSource: null,
    quotationTemplateId: "editorial-olive",
    designTemplate: { id: "editorial-one-pager", version: 1 },
  },
})

const reviewFor = (candidate: CurrentDraftSnapshot) => {
  const node = candidate.document.nodes[0]
  const changeSet: ChangeSet = {
    id: "review-draft-identity",
    documentId: candidate.document.id,
    baseRevision: candidate.document.revision,
    baseSnapshotId: "sha256-review-base",
    title: "Rename one layer",
    createdAt: "2026-08-29T06:00:00.000Z",
    createdBy: "agent",
    status: "pending",
    operations: [
      {
        id: "operation-rename-layer",
        status: "pending",
        summary: "Rename one layer",
        command: {
          id: "command-rename-layer",
          type: "update_node",
          actor: "agent",
          at: "2026-08-29T06:00:00.000Z",
          nodeId: node.id,
          patch: { name: "Reviewed layer" },
        },
      },
    ],
  }
  return createReviewProposal(
    createEmptyReviewJournal(),
    candidate.document,
    changeSet
  )
}

const quotationRefreshSnapshot = async (): Promise<CurrentDraftSnapshot> => {
  const designTemplate = { id: "quotation-editorial-olive", version: 2 }
  const document = builtInDesignTemplateRepository.materialize(
    designTemplate.id,
    designTemplate.version,
    { quotation: northstarQuotationPayload, identity: "canonical" }
  )
  const composition = await createKnownQuotationComposition(
    northstarQuotationPayload,
    designTemplate
  )
  if (composition.status !== "known") {
    throw new Error("Expected known quotation composition")
  }
  const incomingSource = structuredClone(northstarQuotationPayload)
  incomingSource.source.revision += 1
  incomingSource.quote.quoteVersion += 1
  incomingSource.quote.quoteNumber = "Q-REFRESH-ADMISSION"
  const preparedAt = "2026-08-30T04:00:00.000Z"
  const prepared = prepareQuotationRefresh({
    currentDocument: document,
    currentSource: northstarQuotationPayload,
    incomingSource,
    templateId: "editorial-olive",
    now: preparedAt,
  })
  const [baseContentSnapshotId, candidateContentSnapshotId] = await Promise.all(
    [
      deriveDocumentSnapshotId(document),
      deriveDocumentSnapshotId(prepared.document),
    ]
  )
  const base = {
    quotationId: northstarQuotationPayload.source.quotationId,
    sourceRevision: northstarQuotationPayload.source.revision,
    quoteVersion: northstarQuotationPayload.quote.quoteVersion,
    contractVersion: 1 as const,
    sourceSnapshotId: await quotationSourceFingerprint(
      northstarQuotationPayload
    ),
  }
  const incoming = {
    quotationId: incomingSource.source.quotationId,
    sourceRevision: incomingSource.source.revision,
    quoteVersion: incomingSource.quote.quoteVersion,
    contractVersion: 1 as const,
    sourceSnapshotId: await quotationSourceFingerprint(incomingSource),
  }
  const impact = {
    ...prepared.impact,
    changedSourcePaths: [...prepared.impact.changedSourcePaths],
    changedCategories: [...prepared.impact.changedCategories],
    businessChanges: prepared.impact.businessChanges.map((change) => ({
      ...change,
    })),
    conflicts: prepared.impact.conflicts.map((conflict) => ({
      ...conflict,
      properties: [...conflict.properties],
    })),
  }
  const coordinates = {
    documentId: document.id,
    baseDocumentRevision: document.revision,
    baseHistorySnapshotId: "history-refresh-admission",
    baseDraftSnapshotId: "sha256-base-draft-admission",
    baseContentSnapshotId,
    candidateContentSnapshotId,
    base,
    incoming,
    composerVersion: composition.composerVersion,
    template: composition.template,
    appearanceTemplateId: "editorial-olive" as const,
    impact,
    collisionChoices: {},
  }
  const quotationRefresh: QuotationRefreshJournal = {
    pending: {
      id: "refresh-admission",
      preparedAt,
      ...coordinates,
      incomingSource,
      candidateDocument: prepared.document,
      proposalId: await quotationRefreshProposalId(coordinates),
    },
    resolved: [],
  }
  return {
    document,
    sourceContext: {
      quotationSource: northstarQuotationPayload,
      quotationTemplateId: "editorial-olive",
      designTemplate,
      composition,
    },
    quotationRefresh,
  }
}

describe("draft admission", () => {
  it("uses one 32 MiB boundary for imports and durable drafts", () => {
    expect(DRAFT_MAX_ENCODED_BYTES).toBe(32 * 1024 * 1024)
    expect(DOCUMENT_IMPORT_MAX_JSON_BYTES).toBe(DRAFT_MAX_ENCODED_BYTES)
  })

  it("returns the canonical versioned envelope and exact UTF-8 byte length", async () => {
    const candidate = snapshot()
    candidate.document = { ...candidate.document, name: "Álbum ✨" }

    const result = await prepareDraftAdmission(candidate)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope).toMatchObject({
      schemaVersion: 1,
      document: { name: "Álbum ✨" },
    })
    expect(result.encodedJson).toBe(
      encodeCanonicalDraftEnvelope(result.envelope)
    )
    expect(result.encodedByteLength).toBe(
      encodedUtf8ByteLength(result.encodedJson)
    )
    expect(result.encodedByteLength).toBeGreaterThan(result.encodedJson.length)
    expect(result.contentSnapshotId).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(result.draftSnapshotId).toMatch(/^sha256-[a-f0-9]{64}$/)
  })

  it("keeps content and draft identity separate when source context changes", async () => {
    const linked = await prepareDraftAdmission(snapshot())
    const unlinkedCandidate = snapshot()
    unlinkedCandidate.sourceContext = null
    const unlinked = await prepareDraftAdmission(unlinkedCandidate)

    expect(linked.ok).toBe(true)
    expect(unlinked.ok).toBe(true)
    if (!linked.ok || !unlinked.ok) return
    expect(unlinked.contentSnapshotId).toBe(linked.contentSnapshotId)
    expect(unlinked.draftSnapshotId).not.toBe(linked.draftSnapshotId)
  })

  it("admits exact quotation composition provenance and rejects source drift", async () => {
    const designTemplate = {
      id: "quotation-editorial-olive",
      version: 2,
    }
    const composition = await createKnownQuotationComposition(
      northstarQuotationPayload,
      designTemplate
    )
    const candidate: CurrentDraftSnapshot = {
      document: builtInDesignTemplateRepository.materialize(
        designTemplate.id,
        designTemplate.version,
        { quotation: northstarQuotationPayload, identity: "canonical" }
      ),
      sourceContext: {
        quotationSource: northstarQuotationPayload,
        quotationTemplateId: "editorial-olive",
        designTemplate,
        composition,
      },
    }

    expect(await prepareDraftAdmission(candidate)).toMatchObject({ ok: true })

    const drifted = structuredClone(candidate)
    if (!drifted.sourceContext?.quotationSource)
      throw new Error("Expected quotation source")
    drifted.sourceContext.quotationSource.source.revision += 1
    expect(await prepareDraftAdmission(drifted)).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: {
        message: expect.stringContaining("coordinates do not match"),
      },
    })
  })

  it("changes only draft identity when review history changes", async () => {
    const plain = snapshot()
    const reviewed = snapshot()
    reviewed.reviewJournal = reviewFor(reviewed)

    const plainAdmission = await prepareDraftAdmission(plain)
    const reviewedAdmission = await prepareDraftAdmission(reviewed)

    expect(plainAdmission.ok).toBe(true)
    expect(reviewedAdmission.ok).toBe(true)
    if (!plainAdmission.ok || !reviewedAdmission.ok) return
    expect(reviewedAdmission.contentSnapshotId).toBe(
      plainAdmission.contentSnapshotId
    )
    expect(reviewedAdmission.draftSnapshotId).not.toBe(
      plainAdmission.draftSnapshotId
    )
  })

  it("admits an exact persisted quotation refresh and rejects cross-field tampering", async () => {
    const exact = await quotationRefreshSnapshot()
    expect(await prepareDraftAdmission(exact)).toMatchObject({ ok: true })

    const sourceTamper = structuredClone(exact)
    sourceTamper.quotationRefresh!.pending!.incomingSource.document.title =
      "Tampered incoming source"
    expect(await prepareDraftAdmission(sourceTamper)).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { message: expect.stringContaining("incoming source") },
    })

    const candidateTamper = structuredClone(exact)
    candidateTamper.quotationRefresh!.pending!.candidateDocument.name =
      "Tampered candidate"
    expect(await prepareDraftAdmission(candidateTamper)).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { message: expect.stringContaining("candidate document") },
    })

    const proposalTamper = structuredClone(exact)
    proposalTamper.quotationRefresh!.pending!.proposalId = `sha256-${"f".repeat(64)}`
    expect(await prepareDraftAdmission(proposalTamper)).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { message: expect.stringContaining("proposal") },
    })
  })

  it("keeps legacy empty-review drafts byte compatible", async () => {
    const legacy = await prepareDraftAdmission(snapshot())
    const explicitEmpty = snapshot()
    explicitEmpty.reviewJournal = createEmptyReviewJournal()
    const normalized = await prepareDraftAdmission(explicitEmpty)

    expect(legacy.ok).toBe(true)
    expect(normalized.ok).toBe(true)
    if (!legacy.ok || !normalized.ok) return
    expect(normalized.envelope.reviewJournal).toBeUndefined()
    expect(normalized.encodedJson).toBe(legacy.encodedJson)
    expect(normalized.draftSnapshotId).toBe(legacy.draftSnapshotId)
  })

  it("hashes canonical draft identity independent of object key order", async () => {
    const sourceContext = snapshot().sourceContext
    if (!sourceContext) throw new Error("Expected source context")
    const reordered = {
      designTemplate: sourceContext.designTemplate,
      quotationTemplateId: sourceContext.quotationTemplateId,
      quotationSource: sourceContext.quotationSource,
    }

    expect(await deriveDraftSnapshotId("sha256-content", sourceContext)).toBe(
      await deriveDraftSnapshotId("sha256-content", reordered)
    )
  })

  it("rejects invalid snapshots through the current-draft validator", async () => {
    const invalid = snapshot()
    invalid.document = { ...invalid.document, id: "" }

    const result = await prepareDraftAdmission(invalid)

    expect(result).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "schema_invalid" },
    })
  })

  it("rejects a valid canonical envelope above the shared limit", async () => {
    const oversized = snapshot()
    oversized.document = {
      ...oversized.document,
      name: "x".repeat(DRAFT_MAX_ENCODED_BYTES),
    }

    const result = await prepareDraftAdmission(oversized)

    expect(result).toMatchObject({
      ok: false,
      reason: "too_large",
      maximumEncodedByteLength: DRAFT_MAX_ENCODED_BYTES,
    })
    if (result.ok || result.reason !== "too_large") return
    expect(result.encodedByteLength).toBeGreaterThan(DRAFT_MAX_ENCODED_BYTES)
  })
})
