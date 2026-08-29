import "fake-indexeddb/auto"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  LOCAL_ASSET_DATABASE_NAME,
  LOCAL_ASSET_DATABASE_VERSION,
  LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
} from "./local-asset-database"
import {
  LocalAssetPromotionCheckpointError,
  LocalAssetPromotionJournalCorruptError,
  LocalAssetPromotionJournalRevisionError,
  LocalAssetPromotionLeaseError,
  claimLocalAssetPromotionJournal,
  compareAndSwapLocalAssetPromotionJournal,
  createOrResumeLocalAssetPromotionJournal,
  localAssetPromotionJournalSchema,
  readLocalAssetPromotionJournal,
  releaseLocalAssetPromotionJournal,
  renewLocalAssetPromotionJournalLease,
} from "./local-asset-promotion-journal"
import { getLocalAssetRecord } from "./local-asset-store"

const timestamp = "2026-08-30T00:00:00.000Z"
const contentSnapshotId = `sha256-${"a".repeat(64)}`
const draftSnapshotId = `sha256-${"b".repeat(64)}`
const managedContentSha256 = "c".repeat(64)

const deleteDatabase = () =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LOCAL_ASSET_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const creationInput = (localAssetId = "local-promotion-1") => ({
  localAssetId,
  idempotencyKey: "promotion-idempotency-1",
  sourceDocumentId: "document-1",
  sourceContentSnapshotId: contentSnapshotId,
  sourceHistorySnapshotId: "history-snapshot-1",
  sourceOperationVersion: 7,
  sourceDraftRecordVersion: 3,
  sourceDraftSnapshotId: draftSnapshotId,
  sourceLocalAssetRevision: 2,
  expectedReferenceKeys: ["field/hero/current", "node/hero/src"],
  now: timestamp,
})

const openDatabase = (version?: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(LOCAL_ASSET_DATABASE_NAME)
        : indexedDB.open(LOCAL_ASSET_DATABASE_NAME, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"))
  })

const putRawJournal = async (value: unknown, localAssetId: string) => {
  const database = await openDatabase()
  const transaction = database.transaction(
    LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
    "readwrite"
  )
  transaction
    .objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME)
    .put(
      value && typeof value === "object"
        ? { ...(value as object), localAssetId }
        : { localAssetId, value }
    )
  await transactionDone(transaction)
  database.close()
}

const originalPutDescriptor = Object.getOwnPropertyDescriptor(
  IDBObjectStore.prototype,
  "put"
)

if (!originalPutDescriptor) {
  throw new Error("fake-indexeddb did not expose IDBObjectStore.put")
}

afterEach(async () => {
  vi.unstubAllGlobals()
  Object.defineProperty(IDBObjectStore.prototype, "put", originalPutDescriptor)
  await deleteDatabase()
})

describe("local asset promotion journal", () => {
  it("upgrades the asset database from v4 to v5 without changing metadata or Blob bytes", async () => {
    const blob = new Blob(["preserve-these-exact-bytes"], {
      type: "image/png",
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_ASSET_DATABASE_NAME, 4)
      request.onupgradeneeded = () => {
        const result = request.result
        result.createObjectStore("assets", { keyPath: "id" })
        result.createObjectStore("asset-metadata", { keyPath: "id" })
        result.createObjectStore("asset-blobs")
        result.createObjectStore("asset-quarantine", { keyPath: "id" })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(
      ["asset-metadata", "asset-blobs"],
      "readwrite"
    )
    transaction.objectStore("asset-metadata").put({
      schemaVersion: 4,
      id: "asset-preserved",
      name: "preserved.png",
      mediaType: "image/png",
      size: blob.size,
      width: 100,
      height: 80,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
      archivedAt: null,
      revision: 4,
      integrity: "ready",
    })
    transaction.objectStore("asset-blobs").put(blob, "asset-preserved")
    await transactionDone(transaction)
    database.close()

    await createOrResumeLocalAssetPromotionJournal(creationInput())

    const upgraded = await openDatabase()
    expect(upgraded.version).toBe(LOCAL_ASSET_DATABASE_VERSION)
    expect(
      upgraded.objectStoreNames.contains(
        LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME
      )
    ).toBe(true)
    upgraded.close()
    const record = await getLocalAssetRecord("asset-preserved")
    expect(record).toEqual(
      expect.objectContaining({
        schemaVersion: 4,
        revision: 4,
        name: "preserved.png",
      })
    )
    expect(await record?.blob.text()).toBe("preserve-these-exact-bytes")
  })

  it("strictly parses complete v1 records and rejects drifted or incoherent records", async () => {
    const journal =
      await createOrResumeLocalAssetPromotionJournal(creationInput())

    expect(localAssetPromotionJournalSchema.safeParse(journal).success).toBe(
      true
    )
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...journal,
        unexpected: true,
      }).success
    ).toBe(false)
    for (const idempotencyKey of [
      "contains a space",
      "unicode-💥",
      "a".repeat(129),
    ]) {
      expect(
        localAssetPromotionJournalSchema.safeParse({
          ...journal,
          idempotencyKey,
        }).success
      ).toBe(false)
      await expect(
        createOrResumeLocalAssetPromotionJournal({
          ...creationInput(`invalid-key-${idempotencyKey.length}`),
          idempotencyKey,
        })
      ).rejects.toThrow()
    }
    expect(await readLocalAssetPromotionJournal("invalid-key-16")).toEqual({
      status: "missing",
    })
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...journal,
        expectedReferenceKeys: [...journal.expectedReferenceKeys].reverse(),
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...journal,
        managedAssetId: "asset-1234567890",
        managedContentSha256: null,
        managedStatus: null,
        managedAssetRevision: null,
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...journal,
        contentSha256: `sha256-${"c".repeat(64)}`,
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...journal,
        lease: {
          ownerId: "tab-a",
          token: "lease-a",
          expiresAt: "2026-08-30T00:06:00.001Z",
        },
      }).success
    ).toBe(false)
  })

  it("enforces hash, mapping, relink, and durable-draft facts at their exact lifecycle states", async () => {
    const queued =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    for (const state of [
      "reconciling",
      "uploading",
      "status_unknown",
      "conflict",
      "mapped",
      "relinking",
      "complete",
    ] as const) {
      expect(
        localAssetPromotionJournalSchema.safeParse({ ...queued, state }).success
      ).toBe(false)
    }

    const hashed = { ...queued, contentSha256: managedContentSha256 }
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...hashed,
        state: "status_unknown",
      }).success
    ).toBe(true)
    const mapped = {
      ...hashed,
      state: "mapped" as const,
      managedAssetId: "asset-1234567890",
      managedContentSha256,
      managedStatus: "ready" as const,
      managedAssetRevision: 1,
      mappingRequestId: "request-mapped-1",
    }
    expect(localAssetPromotionJournalSchema.safeParse(mapped).success).toBe(
      true
    )
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        state: "uploading",
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        state: "conflict",
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        state: "conflict",
        managedContentSha256: "d".repeat(64),
      }).success
    ).toBe(true)

    const relinkCommit = {
      relinkResultContentSnapshotId: `sha256-${"d".repeat(64)}`,
      relinkResultHistorySnapshotId: "history-result-1",
      relinkCommitId: "commit-1",
      relinkUndoable: false,
    }
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        ...relinkCommit,
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        ...relinkCommit,
        state: "relinking",
      }).success
    ).toBe(true)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        ...relinkCommit,
        state: "relinking",
        relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
        relinkResultDraftRecordVersion: 4,
      }).success
    ).toBe(false)
    expect(
      localAssetPromotionJournalSchema.safeParse({
        ...mapped,
        ...relinkCommit,
        state: "complete",
        relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
        relinkResultDraftRecordVersion: 4,
      }).success
    ).toBe(true)
  })

  it("returns the exact existing checkpoint only for the same creation anchor", async () => {
    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    const resumed =
      await createOrResumeLocalAssetPromotionJournal(creationInput())

    expect(resumed).toEqual(created)
    await expect(
      createOrResumeLocalAssetPromotionJournal({
        ...creationInput(),
        sourceOperationVersion: 8,
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)
  })

  it("supersedes a released complete operation for a second document without losing its mapping", async () => {
    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    const claimed = await claimLocalAssetPromotionJournal({
      localAssetId: created.localAssetId,
      expectedRevision: created.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      leaseMilliseconds: 10_000,
      now: timestamp,
    })
    const completed = await compareAndSwapLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:01.000Z",
      patch: {
        state: "complete",
        contentSha256: managedContentSha256,
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedStatus: "ready",
        managedAssetRevision: 1,
        mappingRequestId: "request-complete-1",
        relinkResultContentSnapshotId: `sha256-${"d".repeat(64)}`,
        relinkResultHistorySnapshotId: "history-result-1",
        relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
        relinkResultDraftRecordVersion: 4,
        relinkCommitId: "commit-1",
        relinkUndoable: true,
      },
    })

    await expect(
      compareAndSwapLocalAssetPromotionJournal({
        localAssetId: completed.localAssetId,
        expectedRevision: completed.revision,
        ownerId: "tab-a",
        leaseToken: "lease-a",
        now: "2026-08-30T00:00:01.500Z",
        patch: { state: "mapped" },
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)

    await expect(
      createOrResumeLocalAssetPromotionJournal({
        ...creationInput(),
        sourceDocumentId: "document-2",
        supersedeCompletedRevision: completed.revision,
        now: "2026-08-30T00:00:02.000Z",
      })
    ).rejects.toThrow("already working")

    const released = await releaseLocalAssetPromotionJournal({
      localAssetId: completed.localAssetId,
      expectedRevision: completed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:02.000Z",
    })
    await expect(
      claimLocalAssetPromotionJournal({
        localAssetId: released.localAssetId,
        expectedRevision: released.revision,
        ownerId: "tab-b",
        leaseToken: "lease-b",
        leaseMilliseconds: 10_000,
        now: "2026-08-30T00:00:02.500Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)
    const next = await createOrResumeLocalAssetPromotionJournal({
      ...creationInput(),
      idempotencyKey: "promotion-idempotency-2",
      sourceDocumentId: "document-2",
      supersedeCompletedRevision: released.revision,
      now: "2026-08-30T00:00:03.000Z",
    })

    expect(next).toEqual(
      expect.objectContaining({
        revision: released.revision + 1,
        state: "mapped",
        sourceDocumentId: "document-2",
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedAssetRevision: 1,
        lease: null,
      })
    )
    expect(next.relinkCommitId).toBeNull()
    expect(next.relinkResultDraftSnapshotId).toBeNull()
  })

  it("fails the checkpoint atomically when the journal put cannot be written", async () => {
    const originalPut = IDBObjectStore.prototype.put
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      configurable: true,
      writable: true,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (this.name === LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME) {
          throw new DOMException("Quota exhausted", "QuotaExceededError")
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key)
      },
    })

    await expect(
      createOrResumeLocalAssetPromotionJournal(creationInput())
    ).rejects.toBeInstanceOf(LocalAssetPromotionCheckpointError)
    expect(await readLocalAssetPromotionJournal("local-promotion-1")).toEqual({
      status: "missing",
    })
  })

  it("keeps a committed checkpoint authoritative when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class DisabledBroadcastChannel {
        constructor() {
          throw new DOMException("Disabled", "SecurityError")
        }
      }
    )

    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())

    expect(created.revision).toBe(1)
    expect(await readLocalAssetPromotionJournal(created.localAssetId)).toEqual({
      status: "ready",
      journal: created,
    })
  })

  it("requires the exact revision and live lease token for every CAS mutation", async () => {
    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    const claimed = await claimLocalAssetPromotionJournal({
      localAssetId: created.localAssetId,
      expectedRevision: created.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      leaseMilliseconds: 10_000,
      now: timestamp,
    })

    await expect(
      compareAndSwapLocalAssetPromotionJournal({
        localAssetId: claimed.localAssetId,
        expectedRevision: created.revision,
        ownerId: "tab-a",
        leaseToken: "lease-a",
        patch: { state: "hashing" },
        now: "2026-08-30T00:00:01.000Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)
    await expect(
      compareAndSwapLocalAssetPromotionJournal({
        localAssetId: claimed.localAssetId,
        expectedRevision: claimed.revision,
        ownerId: "tab-a",
        leaseToken: "wrong-token",
        patch: { state: "hashing" },
        now: "2026-08-30T00:00:01.000Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionLeaseError)

    const updated = await compareAndSwapLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      patch: {
        attempt: 1,
        state: "mapped",
        contentSha256: managedContentSha256,
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedStatus: "ready",
        managedAssetRevision: 1,
        mappingRequestId: "request-mapped-1",
      },
      now: "2026-08-30T00:00:01.000Z",
    })
    expect(updated).toEqual(
      expect.objectContaining({
        revision: claimed.revision + 1,
        state: "mapped",
        attempt: 1,
      })
    )
  })

  it("serializes two-tab claims so only one owner can win", async () => {
    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    const claims = await Promise.allSettled([
      claimLocalAssetPromotionJournal({
        localAssetId: created.localAssetId,
        expectedRevision: created.revision,
        ownerId: "tab-a",
        leaseToken: "lease-a",
        leaseMilliseconds: 10_000,
        now: timestamp,
      }),
      claimLocalAssetPromotionJournal({
        localAssetId: created.localAssetId,
        expectedRevision: created.revision,
        ownerId: "tab-b",
        leaseToken: "lease-b",
        leaseMilliseconds: 10_000,
        now: timestamp,
      }),
    ])

    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(
      1
    )
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(
      1
    )
    const stored = await readLocalAssetPromotionJournal(created.localAssetId)
    expect(stored.status).toBe("ready")
    if (stored.status !== "ready") throw new Error("Expected journal")
    expect(["tab-a", "tab-b"]).toContain(stored.journal.lease?.ownerId)
  })

  it("allows expiry takeover and rejects every late mutation from the old owner", async () => {
    const created =
      await createOrResumeLocalAssetPromotionJournal(creationInput())
    const firstOwner = await claimLocalAssetPromotionJournal({
      localAssetId: created.localAssetId,
      expectedRevision: created.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      leaseMilliseconds: 1_000,
      now: timestamp,
    })
    const secondOwner = await claimLocalAssetPromotionJournal({
      localAssetId: firstOwner.localAssetId,
      expectedRevision: firstOwner.revision,
      ownerId: "tab-b",
      leaseToken: "lease-b",
      leaseMilliseconds: 10_000,
      now: "2026-08-30T00:00:01.001Z",
    })

    await expect(
      compareAndSwapLocalAssetPromotionJournal({
        localAssetId: secondOwner.localAssetId,
        expectedRevision: secondOwner.revision,
        ownerId: "tab-a",
        leaseToken: "lease-a",
        patch: { state: "failed", errorCode: "late_owner" },
        now: "2026-08-30T00:00:01.002Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionLeaseError)
    const renewed = await renewLocalAssetPromotionJournalLease({
      localAssetId: secondOwner.localAssetId,
      expectedRevision: secondOwner.revision,
      ownerId: "tab-b",
      leaseToken: "lease-b",
      leaseMilliseconds: 10_000,
      now: "2026-08-30T00:00:02.000Z",
    })
    const released = await releaseLocalAssetPromotionJournal({
      localAssetId: renewed.localAssetId,
      expectedRevision: renewed.revision,
      ownerId: "tab-b",
      leaseToken: "lease-b",
      now: "2026-08-30T00:00:03.000Z",
    })
    expect(released.lease).toBeNull()
  })

  it("isolates corrupt promotion progress from a usable local asset", async () => {
    const blob = new Blob(["healthy-image"], { type: "image/png" })
    await createOrResumeLocalAssetPromotionJournal(
      creationInput("healthy-local-asset")
    )
    const database = await openDatabase()
    const transaction = database.transaction(
      ["asset-metadata", "asset-blobs"],
      "readwrite"
    )
    transaction.objectStore("asset-metadata").put({
      schemaVersion: 4,
      id: "healthy-local-asset",
      name: "healthy.png",
      mediaType: "image/png",
      size: blob.size,
      width: 20,
      height: 10,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
      archivedAt: null,
      revision: 1,
      integrity: "ready",
    })
    transaction.objectStore("asset-blobs").put(blob, "healthy-local-asset")
    await transactionDone(transaction)
    database.close()
    await putRawJournal(
      { localAssetId: "healthy-local-asset", schemaVersion: 999 },
      "healthy-local-asset"
    )

    expect(await readLocalAssetPromotionJournal("healthy-local-asset")).toEqual(
      { status: "corrupt", localAssetId: "healthy-local-asset" }
    )
    await expect(
      createOrResumeLocalAssetPromotionJournal(
        creationInput("healthy-local-asset")
      )
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalCorruptError)
    const record = await getLocalAssetRecord("healthy-local-asset")
    expect(record?.name).toBe("healthy.png")
    expect(await record?.blob.text()).toBe("healthy-image")
  })
})
