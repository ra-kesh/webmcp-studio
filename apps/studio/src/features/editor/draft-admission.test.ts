import {
  builtInDesignTemplateRepository,
  northstarQuotationPayload,
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
