import { builtInDesignTemplateRepository } from "@webmcp/document"
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
