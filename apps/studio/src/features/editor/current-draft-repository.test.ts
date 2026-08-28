import { describe, expect, test } from "vitest"
import {
  builtInDesignTemplateRepository,
  composeQuotationDocument,
  northstarQuotationPayload,
} from "@webmcp/document"
import {
  createDraftRecoveryRecord,
  DRAFT_RECOVERY_STORAGE_KEY,
} from "./draft-recovery"
import {
  bootstrapCurrentDraft,
  CURRENT_DRAFT_STORAGE_KEY,
  decodeCurrentDraftEnvelope,
  flushCurrentDraft,
  LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
  LEGACY_DOCUMENT_STORAGE_KEY,
  LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
  LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
  validateCurrentDraftSnapshot,
  writeCurrentDraft,
} from "./current-draft-repository"
import type {
  CurrentDraftEnvelope,
  CurrentDraftSnapshot,
  DraftStorage,
} from "./current-draft-repository"

const quotationDocument = composeQuotationDocument(
  northstarQuotationPayload,
  "editorial-olive"
)

const quotationSnapshot: CurrentDraftSnapshot = {
  document: quotationDocument,
  sourceContext: {
    quotationSource: northstarQuotationPayload,
    quotationTemplateId: "editorial-olive",
    designTemplate: { id: "quotation-editorial-olive", version: 1 },
  },
}

const starterSnapshot: CurrentDraftSnapshot = {
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
}

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>()
  readonly writes: Array<{ key: string; value: string }> = []
  readonly removals: string[] = []
  throwOnGet: string | null = null
  throwOnSet: string | null = null
  throwOnRemove: string | null = null

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value)
    }
  }

  getItem(key: string) {
    if (this.throwOnGet === key) throw new Error(`read denied for ${key}`)
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.throwOnSet === key) throw new Error(`quota denied for ${key}`)
    this.writes.push({ key, value })
    this.values.set(key, value)
  }

  removeItem(key: string) {
    if (this.throwOnRemove === key) throw new Error(`remove denied for ${key}`)
    this.removals.push(key)
    this.values.delete(key)
  }
}

const provider = (storage: DraftStorage) => () => storage

const envelope = (
  snapshot: CurrentDraftSnapshot = quotationSnapshot
): CurrentDraftEnvelope => ({ schemaVersion: 1, ...snapshot })

describe("current browser draft repository", () => {
  test("returns an explicit empty state without writing sample content", () => {
    const storage = new MemoryStorage()

    expect(bootstrapCurrentDraft({ getStorage: provider(storage) })).toEqual({
      status: "empty",
    })
    expect(storage.writes).toEqual([])
    expect(storage.removals).toEqual([])
  })

  test("restores a validated atomic envelope without rewriting it", () => {
    const serialized = JSON.stringify(envelope())
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: serialized,
    })

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "current",
      source: "envelope",
      migrated: false,
      envelope: {
        document: {
          id: quotationDocument.id,
          name: quotationDocument.name,
        },
        sourceContext: {
          quotationTemplateId: "editorial-olive",
          designTemplate: { id: "quotation-editorial-olive", version: 1 },
        },
      },
      warnings: [],
    })
    expect(storage.writes).toEqual([])
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(serialized)
  })

  test("migrates a nested legacy document and rewrites only the atomic key", () => {
    const legacyDocument = {
      ...structuredClone(quotationDocument),
      schemaVersion: 1,
    }
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        document: legacyDocument,
        sourceContext: null,
      }),
    })

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "current",
      source: "envelope",
      migrated: true,
      envelope: { document: { schemaVersion: 2 }, sourceContext: null },
    })
    expect(storage.writes.map(({ key }) => key)).toEqual([
      CURRENT_DRAFT_STORAGE_KEY,
    ])
  })

  test("gives an existing owned recovery record precedence over draft bytes", () => {
    const recovery = createDraftRecoveryRecord({
      sourceStorageKey: CURRENT_DRAFT_STORAGE_KEY,
      raw: "broken current draft",
      failure: { kind: "malformed_json", message: "Broken." },
      capturedAt: "2026-08-28T09:00:00.000Z",
    })
    const storage = new MemoryStorage({
      [DRAFT_RECOVERY_STORAGE_KEY]: JSON.stringify(recovery),
      [CURRENT_DRAFT_STORAGE_KEY]: JSON.stringify(envelope()),
    })

    expect(bootstrapCurrentDraft({ getStorage: provider(storage) })).toEqual({
      status: "recovery_required",
      recovery,
      recoveryStored: true,
    })
    expect(storage.writes).toEqual([])
  })

  test("quarantines an invalid recovery-record payload instead of treating storage as empty", () => {
    const rawRecovery = '{"schemaVersion":1,"raw":42}'
    const storage = new MemoryStorage({
      [DRAFT_RECOVERY_STORAGE_KEY]: rawRecovery,
    })

    const result = bootstrapCurrentDraft({
      getStorage: provider(storage),
      now: () => "2026-08-28T09:30:00.000Z",
    })

    expect(result).toMatchObject({
      status: "recovery_required",
      recoveryStored: true,
      recovery: {
        sourceStorageKey: DRAFT_RECOVERY_STORAGE_KEY,
        capturedAt: "2026-08-28T09:30:00.000Z",
        raw: rawRecovery,
        failure: { kind: "schema_invalid" },
      },
    })
    expect(
      JSON.parse(storage.getItem(DRAFT_RECOVERY_STORAGE_KEY) ?? "null")
    ).toMatchObject({ raw: rawRecovery })
  })

  test("quarantines malformed current bytes without replacing the source", () => {
    const raw = '{"schemaVersion":1,"document":'
    const storage = new MemoryStorage({ [CURRENT_DRAFT_STORAGE_KEY]: raw })

    const result = bootstrapCurrentDraft({
      getStorage: provider(storage),
      now: () => "2026-08-28T10:00:00.000Z",
    })

    expect(result).toMatchObject({
      status: "recovery_required",
      recoveryStored: true,
      recovery: {
        sourceStorageKey: CURRENT_DRAFT_STORAGE_KEY,
        capturedAt: "2026-08-28T10:00:00.000Z",
        raw,
        failure: { kind: "malformed_json" },
      },
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(DRAFT_RECOVERY_STORAGE_KEY)).not.toBeNull()
  })

  test("still requires recovery when the second recovery copy cannot be written", () => {
    const raw = "not-json"
    const storage = new MemoryStorage({ [CURRENT_DRAFT_STORAGE_KEY]: raw })
    storage.throwOnSet = DRAFT_RECOVERY_STORAGE_KEY

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "recovery_required",
      recoveryStored: false,
      recovery: { raw },
      storageFailure: { operation: "write_recovery" },
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(raw)
  })

  test("classifies an unsupported envelope version as migration failure", () => {
    expect(
      decodeCurrentDraftEnvelope(
        JSON.stringify({
          schemaVersion: 7,
          document: quotationDocument,
          sourceContext: null,
        })
      )
    ).toMatchObject({
      ok: false,
      failure: { kind: "migration_failed" },
    })
  })

  test("migrates a valid legacy document only after the atomic write succeeds", () => {
    const legacySource = JSON.stringify(northstarQuotationPayload)
    const storage = new MemoryStorage({
      [LEGACY_DOCUMENT_STORAGE_KEY]: JSON.stringify(quotationDocument),
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: legacySource,
      [LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY]: "editorial-olive",
      [LEGACY_DESIGN_TEMPLATE_STORAGE_KEY]: JSON.stringify({
        id: "quotation-editorial-olive",
        version: 1,
      }),
    })

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "current",
      source: "legacy",
      migrated: true,
      envelope: {
        document: { id: quotationDocument.id },
        sourceContext: null,
      },
      warnings: [
        {
          operation: "legacy_source_context_discarded",
          message: expect.stringContaining("Re-import quotation data"),
        },
      ],
    })
    expect(storage.writes[0]?.key).toBe(CURRENT_DRAFT_STORAGE_KEY)
    expect(storage.removals).toEqual([
      LEGACY_DOCUMENT_STORAGE_KEY,
      LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
      LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
      LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
    ])
    expect(storage.getItem(LEGACY_QUOTATION_SOURCE_STORAGE_KEY)).toBeNull()
  })

  test("migrates a document-only legacy draft without claiming source data was discarded", () => {
    const storage = new MemoryStorage({
      [LEGACY_DOCUMENT_STORAGE_KEY]: JSON.stringify(quotationDocument),
    })

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "current",
      source: "legacy",
      migrated: true,
      warnings: [],
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).not.toBeNull()
  })

  test("preserves all legacy bytes when a source-context key cannot be read", () => {
    const raw = JSON.stringify(quotationDocument)
    const storage = new MemoryStorage({
      [LEGACY_DOCUMENT_STORAGE_KEY]: raw,
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: "source-bytes",
    })
    storage.throwOnGet = LEGACY_QUOTATION_SOURCE_STORAGE_KEY

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "storage_unavailable",
      failure: { operation: "read_legacy" },
      recoverableDraft: { document: { id: quotationDocument.id } },
      legacyBytesPreserved: true,
    })
    expect(storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY)).toBe(raw)
    expect(storage.writes).toEqual([])
    expect(storage.removals).toEqual([])
  })

  test("keeps every legacy byte when the migration write hits quota", () => {
    const raw = JSON.stringify(quotationDocument)
    const sourceRaw = JSON.stringify(northstarQuotationPayload)
    const storage = new MemoryStorage({
      [LEGACY_DOCUMENT_STORAGE_KEY]: raw,
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: sourceRaw,
    })
    storage.throwOnSet = CURRENT_DRAFT_STORAGE_KEY

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "storage_unavailable",
      failure: { operation: "write_current" },
      recoverableDraft: {
        document: { id: quotationDocument.id },
        sourceContext: null,
      },
      legacyBytesPreserved: true,
    })
    expect(storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(LEGACY_QUOTATION_SOURCE_STORAGE_KEY)).toBe(sourceRaw)
    expect(storage.removals).toEqual([])
  })

  test("keeps invalid legacy bytes in place and creates a recovery record", () => {
    const raw = '{"schemaVersion":1}'
    const storage = new MemoryStorage({ [LEGACY_DOCUMENT_STORAGE_KEY]: raw })

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "recovery_required",
      recovery: {
        sourceStorageKey: LEGACY_DOCUMENT_STORAGE_KEY,
        raw,
        failure: { kind: "schema_invalid" },
      },
    })
    expect(storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY)).toBe(raw)
    expect(storage.removals).toEqual([])
  })

  test("reports cleanup failures after a successful migration without losing either copy", () => {
    const raw = JSON.stringify(quotationDocument)
    const storage = new MemoryStorage({ [LEGACY_DOCUMENT_STORAGE_KEY]: raw })
    storage.throwOnRemove = LEGACY_DOCUMENT_STORAGE_KEY

    const result = bootstrapCurrentDraft({ getStorage: provider(storage) })

    expect(result).toMatchObject({
      status: "current",
      source: "legacy",
      warnings: expect.arrayContaining([
        {
          operation: "cleanup_legacy",
          message: expect.any(String),
        },
      ]),
    })
    if (result.status === "current") {
      expect(result.warnings).toHaveLength(1)
    }
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY)).toBe(raw)
  })

  test.each([
    [
      "storage getter",
      () => {
        throw new Error("SecurityError")
      },
      "get_storage",
    ],
    [
      "recovery read",
      () => {
        const storage = new MemoryStorage()
        storage.throwOnGet = DRAFT_RECOVERY_STORAGE_KEY
        return storage
      },
      "read_recovery",
    ],
    [
      "current read",
      () => {
        const storage = new MemoryStorage()
        storage.throwOnGet = CURRENT_DRAFT_STORAGE_KEY
        return storage
      },
      "read_current",
    ],
    [
      "legacy read",
      () => {
        const storage = new MemoryStorage()
        storage.throwOnGet = LEGACY_DOCUMENT_STORAGE_KEY
        return storage
      },
      "read_legacy",
    ],
  ])("contains a throwing %s", (_label, getStorage, operation) => {
    expect(bootstrapCurrentDraft({ getStorage })).toMatchObject({
      status: "storage_unavailable",
      failure: { operation },
    })
  })

  test("validates canonical document relationships before a write", () => {
    const invalid = structuredClone(quotationSnapshot)
    const sourceNode = invalid.document.nodes[0]
    invalid.document.nodes.push({
      ...sourceNode,
      id: "orphan-current-draft-node",
    })
    const storage = new MemoryStorage()

    const result = writeCurrentDraft(invalid, {
      getStorage: provider(storage),
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "aggregate_invalid" },
    })
    expect(storage.writes).toEqual([])
  })

  test.each([
    {
      label: "unknown immutable template version",
      context: {
        ...starterSnapshot.sourceContext,
        designTemplate: { id: "editorial-one-pager", version: 99 },
      },
    },
    {
      label: "quotation style without quotation source",
      context: {
        quotationSource: null,
        quotationTemplateId: "editorial-olive",
        designTemplate: { id: "quotation-editorial-olive", version: 1 },
      },
    },
    {
      label: "quotation style identity mismatch",
      context: {
        quotationSource: northstarQuotationPayload,
        quotationTemplateId: "warm-paper",
        designTemplate: { id: "quotation-editorial-olive", version: 1 },
      },
    },
    {
      label: "document starter with unrelated quotation source",
      context: {
        quotationSource: northstarQuotationPayload,
        quotationTemplateId: "editorial-olive",
        designTemplate: { id: "editorial-one-pager", version: 1 },
      },
    },
  ])("rejects $label", ({ context }) => {
    const result = validateCurrentDraftSnapshot({
      document: starterSnapshot.document,
      sourceContext: context,
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "schema_invalid" },
    })
  })

  test("rejects malformed quotation source data", () => {
    const result = validateCurrentDraftSnapshot({
      document: quotationDocument,
      sourceContext: {
        quotationSource: { contractVersion: 1 },
        quotationTemplateId: "editorial-olive",
        designTemplate: null,
      },
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "schema_invalid" },
    })
  })

  test.each([
    [
      "circular document",
      () => {
        const document: Record<string, unknown> = {}
        document.self = document
        return document
      },
    ],
    ["BigInt document", () => ({ id: 1n })],
  ])("contains an unserializable %s", (_label, createDocument) => {
    const storage = new MemoryStorage()
    const result = writeCurrentDraft(
      {
        document: createDocument(),
        sourceContext: null,
      } as unknown as CurrentDraftSnapshot,
      { getStorage: provider(storage) }
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "schema_invalid",
        message: expect.stringContaining("cannot be serialized safely"),
      },
    })
    expect(storage.writes).toEqual([])
  })

  test("writes one validated envelope and leaves an older value intact on quota failure", () => {
    const old = JSON.stringify(envelope(starterSnapshot))
    const storage = new MemoryStorage({ [CURRENT_DRAFT_STORAGE_KEY]: old })
    storage.throwOnSet = CURRENT_DRAFT_STORAGE_KEY

    const result = writeCurrentDraft(quotationSnapshot, {
      getStorage: provider(storage),
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
      failure: { operation: "write_current" },
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(old)
  })

  test("blocks ordinary writes while an owned recovery record exists", () => {
    const recovery = createDraftRecoveryRecord({
      sourceStorageKey: LEGACY_DOCUMENT_STORAGE_KEY,
      raw: "broken",
      failure: { kind: "malformed_json", message: "Broken." },
    })
    const storage = new MemoryStorage({
      [DRAFT_RECOVERY_STORAGE_KEY]: JSON.stringify(recovery),
    })

    expect(
      writeCurrentDraft(quotationSnapshot, {
        getStorage: provider(storage),
      })
    ).toEqual({ ok: false, reason: "recovery_required", recovery })
    expect(storage.writes).toEqual([])
  })

  test("flush captures the latest snapshot at the critical boundary", () => {
    const storage = new MemoryStorage()
    let latest = starterSnapshot
    const capture = () => latest
    latest = quotationSnapshot

    const result = flushCurrentDraft(capture, {
      getStorage: provider(storage),
    })

    expect(result).toMatchObject({
      ok: true,
      envelope: { document: { id: quotationDocument.id } },
    })
    expect(
      JSON.parse(storage.getItem(CURRENT_DRAFT_STORAGE_KEY) ?? "null")
    ).toEqual(JSON.parse(JSON.stringify(envelope(quotationSnapshot))))
  })

  test("contains a failure while capturing the latest flush snapshot", () => {
    const storage = new MemoryStorage()
    const result = flushCurrentDraft(
      () => {
        throw new Error("editor transaction is unsettled")
      },
      { getStorage: provider(storage) }
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "capture_failed",
      message: expect.stringContaining("editor transaction is unsettled"),
    })
    expect(storage.writes).toEqual([])
  })
})
