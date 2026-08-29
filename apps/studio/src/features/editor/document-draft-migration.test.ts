import "fake-indexeddb/auto"
import { describe, expect, test } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import type { ChangeSet } from "@webmcp/document"
import {
  CURRENT_DRAFT_STORAGE_KEY,
  LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
  LEGACY_DOCUMENT_STORAGE_KEY,
  LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
  LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
} from "./current-draft-repository"
import type {
  CurrentDraftEnvelope,
  DraftStorage,
} from "./current-draft-repository"
import { migrateCurrentDraftToRepository } from "./document-draft-migration"
import type { CurrentDraftMigrationRepository } from "./document-draft-migration"
import { DocumentDraftRepository } from "./document-draft-repository"
import type {
  DocumentDraftRecord,
  DraftMigrationResult,
} from "./document-draft-repository"
import {
  createDraftRecoveryRecord,
  DRAFT_RECOVERY_STORAGE_KEY,
} from "./draft-recovery"
import {
  createEmptyReviewJournal,
  createReviewProposal,
} from "./review-journal"

const timestamp = "2026-08-28T12:00:00.000Z"

const draftDocument = builtInDesignTemplateRepository.materialize(
  "editorial-one-pager",
  1,
  { identity: "canonical" }
)

const envelope = (name = draftDocument.name): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: { ...draftDocument, name },
  sourceContext: {
    quotationSource: null,
    quotationTemplateId: "editorial-olive",
    designTemplate: { id: "editorial-one-pager", version: 1 },
  },
})

const envelopeWithReview = (): CurrentDraftEnvelope => {
  const current = envelope()
  const node = current.document.nodes[0]
  const changeSet: ChangeSet = {
    id: "review-current-draft-migration",
    documentId: current.document.id,
    baseRevision: current.document.revision,
    baseSnapshotId: "snapshot-current-draft-migration",
    title: "Preserve the pending migration review",
    createdAt: "2026-08-29T06:00:00.000Z",
    createdBy: "agent",
    status: "pending",
    operations: [
      {
        id: "operation-current-draft-migration",
        status: "pending",
        summary: "Rename one layer",
        command: {
          id: "command-current-draft-migration",
          type: "update_node",
          actor: "agent",
          at: "2026-08-29T06:00:00.000Z",
          nodeId: node.id,
          patch: { name: "Reviewed layer" },
        },
      },
    ],
  }
  return {
    ...current,
    reviewJournal: createReviewProposal(
      createEmptyReviewJournal(),
      current.document,
      changeSet
    ),
  }
}

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>()
  readonly removals: string[] = []
  throwOnRemove: string | null = null

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial))
      this.values.set(key, value)
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    if (this.throwOnRemove === key) throw new Error(`remove denied for ${key}`)
    this.removals.push(key)
    this.values.delete(key)
  }
}

const storageProvider = (storage: DraftStorage) => () => storage

const repository = (suffix: string) =>
  new DocumentDraftRepository({
    databaseName: `migration-test-${suffix}-${crypto.randomUUID()}`,
    indexedDB,
    sessionId: `session-${suffix}`,
    now: () => timestamp,
  })

describe("current draft repository migration", () => {
  test("opens IndexedDB before reading legacy storage and reports a blocked upgrade", async () => {
    let storageReads = 0
    const blockedRepository: CurrentDraftMigrationRepository = {
      open: async () => ({
        ok: false,
        reason: "blocked",
        failure: { kind: "blocked", message: "Close the other tab." },
      }),
      migrateCurrentDraft: async () => {
        throw new Error("migration must not run")
      },
      updateCurrentDraftMigrationCleanup: async () => {
        throw new Error("cleanup must not run")
      },
      get: async () => ({ ok: true, status: "missing" }),
    }

    const result = await migrateCurrentDraftToRepository({
      repository: blockedRepository,
      getStorage: () => {
        storageReads += 1
        return new MemoryStorage()
      },
    })

    expect(result).toMatchObject({ status: "blocked" })
    expect(storageReads).toBe(0)
  })

  test("gives an owned recovery record precedence and preserves current bytes", async () => {
    const current = JSON.stringify(envelope())
    const recovery = createDraftRecoveryRecord({
      sourceStorageKey: CURRENT_DRAFT_STORAGE_KEY,
      raw: "broken bytes",
      failure: { kind: "malformed_json", message: "Broken." },
      capturedAt: timestamp,
    })
    const storage = new MemoryStorage({
      [DRAFT_RECOVERY_STORAGE_KEY]: JSON.stringify(recovery),
      [CURRENT_DRAFT_STORAGE_KEY]: current,
    })
    const drafts = repository("recovery")

    const result = await migrateCurrentDraftToRepository({
      repository: drafts,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(result).toEqual({
      status: "recovery_required",
      recovery,
      recoveryStored: true,
    })
    expect(await drafts.get(draftDocument.id)).toEqual({
      ok: true,
      status: "missing",
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(current)
    expect(storage.removals).toEqual([])
  })

  test("creates a migrated record, verifies it publicly, then cleans all old keys", async () => {
    const current = envelopeWithReview()
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: JSON.stringify(current),
      [LEGACY_DOCUMENT_STORAGE_KEY]: "unused legacy bytes",
      [LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY]: "legacy template",
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: "legacy quotation",
      [LEGACY_DESIGN_TEMPLATE_STORAGE_KEY]: "legacy design",
    })
    const drafts = repository("create")
    let pendingCleanupKeys: readonly string[] = []
    const cleanupJournal: (readonly string[])[] = []
    const inspectingRepository: CurrentDraftMigrationRepository = {
      open: () => drafts.open(),
      migrateCurrentDraft: (snapshot, options) => {
        pendingCleanupKeys = options.pendingCleanupKeys
        return drafts.migrateCurrentDraft(snapshot, options)
      },
      updateCurrentDraftMigrationCleanup: (
        documentId,
        draftSnapshotId,
        pendingKeys
      ) => {
        cleanupJournal.push([...pendingKeys])
        return drafts.updateCurrentDraftMigrationCleanup(
          documentId,
          draftSnapshotId,
          pendingKeys
        )
      },
      get: (documentId) => drafts.get(documentId),
    }

    const result = await migrateCurrentDraftToRepository({
      repository: inspectingRepository,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(result).toMatchObject({
      status: "migrated",
      disposition: "created",
      source: "envelope",
      record: {
        summary: {
          documentId: draftDocument.id,
          origin: { kind: "current-draft-migration" },
        },
      },
      cleanupFailures: [],
    })
    expect(result).toMatchObject({
      status: "migrated",
      record: {
        envelope: {
          reviewJournal: {
            pending: {
              changeSet: { id: "review-current-draft-migration" },
            },
          },
        },
      },
    })
    expect(pendingCleanupKeys).toEqual([
      LEGACY_DOCUMENT_STORAGE_KEY,
      LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
      LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
      LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
      CURRENT_DRAFT_STORAGE_KEY,
    ])
    expect(storage.removals).toEqual([
      LEGACY_DOCUMENT_STORAGE_KEY,
      LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
      LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
      LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
      CURRENT_DRAFT_STORAGE_KEY,
    ])
    expect(cleanupJournal).toEqual([
      pendingCleanupKeys.slice(1),
      pendingCleanupKeys.slice(2),
      pendingCleanupKeys.slice(3),
      pendingCleanupKeys.slice(4),
      [],
    ])
    expect(storage.values.size).toBe(0)
  })

  test("keeps legacy bytes until a legacy document has committed and read back", async () => {
    const serializedLegacy = JSON.stringify(draftDocument)
    const storage = new MemoryStorage({
      [LEGACY_DOCUMENT_STORAGE_KEY]: serializedLegacy,
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: "unproven source context",
    })
    const delegate = repository("legacy-order")
    let sawOriginalBytes = false
    const inspectingRepository: CurrentDraftMigrationRepository = {
      open: () => delegate.open(),
      migrateCurrentDraft: async (snapshot, options) => {
        sawOriginalBytes =
          storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY) === serializedLegacy &&
          storage.getItem(LEGACY_QUOTATION_SOURCE_STORAGE_KEY) !== null &&
          storage.removals.length === 0
        return delegate.migrateCurrentDraft(snapshot, options)
      },
      updateCurrentDraftMigrationCleanup: (...args) =>
        delegate.updateCurrentDraftMigrationCleanup(...args),
      get: (documentId) => delegate.get(documentId),
    }

    const result = await migrateCurrentDraftToRepository({
      repository: inspectingRepository,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(sawOriginalBytes).toBe(true)
    expect(result).toMatchObject({
      status: "migrated",
      source: "legacy",
      bootstrapWarnings: [{ operation: "legacy_source_context_discarded" }],
    })
    expect(storage.getItem(LEGACY_DOCUMENT_STORAGE_KEY)).toBeNull()
  })

  test("resumes failed cleanup without overwriting a newer edit", async () => {
    const serialized = JSON.stringify(envelope())
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: serialized,
    })
    storage.throwOnRemove = CURRENT_DRAFT_STORAGE_KEY
    const drafts = repository("retry")

    const first = await migrateCurrentDraftToRepository({
      repository: drafts,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(first).toMatchObject({
      status: "migrated",
      disposition: "created",
      cleanupFailures: [{ key: CURRENT_DRAFT_STORAGE_KEY }],
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(serialized)

    const migratedRead = await drafts.get(draftDocument.id)
    expect(migratedRead).toMatchObject({ ok: true, status: "found" })
    if (!migratedRead.ok || migratedRead.status !== "found") {
      throw new Error("expected the migrated draft to exist")
    }
    const editedEnvelope = envelope("Edited after migration")
    const edited = await drafts.save(
      {
        document: editedEnvelope.document,
        sourceContext: editedEnvelope.sourceContext,
      },
      migratedRead.record.summary.recordVersion,
      migratedRead.record.summary.draftSnapshotId
    )
    expect(edited).toMatchObject({ ok: true })

    storage.throwOnRemove = null
    const second = await migrateCurrentDraftToRepository({
      repository: drafts,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(second).toMatchObject({
      status: "migrated",
      disposition: "already_migrated",
      record: {
        summary: { name: "Edited after migration", recordVersion: 2 },
        envelope: { document: { name: "Edited after migration" } },
      },
      cleanupFailures: [],
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()

    const finalRead = await drafts.get(draftDocument.id)
    expect(finalRead).toMatchObject({
      ok: true,
      status: "found",
      record: {
        summary: { name: "Edited after migration", recordVersion: 2 },
        envelope: { document: { name: "Edited after migration" } },
      },
    })
    expect(await drafts.listConflicts(draftDocument.id)).toEqual({
      ok: true,
      value: [],
    })
  })

  test("stops context cleanup at the first failure and preserves the identity key", async () => {
    const serialized = JSON.stringify(envelope())
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: serialized,
      [LEGACY_DOCUMENT_STORAGE_KEY]: "legacy document",
      [LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY]: "legacy template",
      [LEGACY_QUOTATION_SOURCE_STORAGE_KEY]: "legacy quotation",
      [LEGACY_DESIGN_TEMPLATE_STORAGE_KEY]: "legacy design",
    })
    storage.throwOnRemove = LEGACY_QUOTATION_SOURCE_STORAGE_KEY

    const result = await migrateCurrentDraftToRepository({
      repository: repository("context-cleanup-failure"),
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(result).toMatchObject({
      status: "migrated",
      disposition: "created",
      cleanupFailures: [{ key: LEGACY_QUOTATION_SOURCE_STORAGE_KEY }],
    })
    expect(storage.removals).toEqual([
      LEGACY_DOCUMENT_STORAGE_KEY,
      LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
    ])
    expect(storage.getItem(LEGACY_QUOTATION_SOURCE_STORAGE_KEY)).toBe(
      "legacy quotation"
    )
    expect(storage.getItem(LEGACY_DESIGN_TEMPLATE_STORAGE_KEY)).toBe(
      "legacy design"
    )
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(serialized)
  })

  test("retains a different-content collision and leaves localStorage unchanged", async () => {
    const candidate = envelope("Legacy candidate")
    const serialized = JSON.stringify(candidate)
    const storage = new MemoryStorage({
      [CURRENT_DRAFT_STORAGE_KEY]: serialized,
    })
    const drafts = repository("collision")
    const existing = await drafts.create(
      {
        document: envelope("Existing document").document,
        sourceContext: candidate.sourceContext,
      },
      { kind: "blank" }
    )
    expect(existing.ok).toBe(true)

    const result = await migrateCurrentDraftToRepository({
      repository: drafts,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(result).toMatchObject({
      status: "collision",
      conflict: {
        reason: "migration_collision",
        candidate: { document: { name: "Legacy candidate" } },
      },
      current: { name: "Existing document" },
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(serialized)
    expect(storage.removals).toEqual([])
    expect(await drafts.listConflicts(draftDocument.id)).toMatchObject({
      ok: true,
      value: [{ reason: "migration_collision" }],
    })
  })

  test("does not clean old bytes when public read-back is not exact", async () => {
    const current = JSON.stringify(envelope())
    const storage = new MemoryStorage({ [CURRENT_DRAFT_STORAGE_KEY]: current })
    let migratedRecord: DocumentDraftRecord | null = null
    const faultyRepository: CurrentDraftMigrationRepository = {
      open: async () => ({ ok: true }),
      migrateCurrentDraft: async (
        snapshot,
        _options
      ): Promise<DraftMigrationResult> => {
        const drafts = repository("verification-fixture")
        const created = await drafts.create(snapshot, {
          kind: "current-draft-migration",
        })
        if (!created.ok) throw new Error("fixture create failed")
        migratedRecord = created.record
        return { ok: true, status: "created", record: created.record }
      },
      updateCurrentDraftMigrationCleanup: async (
        _documentId,
        _draftSnapshotId,
        pendingCleanupKeys
      ) => ({ ok: true, pendingCleanupKeys }),
      get: async () =>
        migratedRecord
          ? {
              ok: true,
              status: "found",
              record: {
                ...migratedRecord,
                summary: {
                  ...migratedRecord.summary,
                  draftSnapshotId: "sha256-wrong",
                },
              },
            }
          : { ok: true, status: "missing" },
    }

    const result = await migrateCurrentDraftToRepository({
      repository: faultyRepository,
      getStorage: storageProvider(storage),
      now: () => timestamp,
    })

    expect(result).toMatchObject({ status: "verification_failed" })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(current)
    expect(storage.removals).toEqual([])
  })
})
