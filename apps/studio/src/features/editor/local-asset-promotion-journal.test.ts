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
  checkpointReleasedLocalAssetPromotionConflict,
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
  recentUseIdempotencyKey: "recent-use-idempotency-1",
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

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const controlNextJournalTransactionAbort = () => {
  const entered = deferred<void>()
  const abortRequested = deferred<void>()
  const originalObjectStore = IDBTransaction.prototype.objectStore
  const originalAbort = IDBTransaction.prototype.abort
  let transaction: IDBTransaction | null = null
  let journalObjectStoreCalls = 0
  vi.spyOn(IDBTransaction.prototype, "objectStore").mockImplementation(
    function (this: IDBTransaction, name: string) {
      const store = originalObjectStore.call(this, name)
      if (name === LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME) {
        journalObjectStoreCalls += 1
        transaction ??= this
        entered.resolve()
      }
      return store
    }
  )
  vi.spyOn(IDBTransaction.prototype, "abort").mockImplementation(function (
    this: IDBTransaction
  ) {
    transaction = this
    abortRequested.resolve()
  })
  return {
    entered: entered.promise,
    abortRequested: abortRequested.promise,
    journalObjectStoreCalls: () => journalObjectStoreCalls,
    acknowledge: () => {
      if (!transaction)
        throw new Error("Expected an active journal transaction")
      originalAbort.call(transaction)
    },
  }
}

const allowNextJournalTransactionToCommitAfterAbort = () => {
  const entered = deferred<void>()
  const originalObjectStore = IDBTransaction.prototype.objectStore
  vi.spyOn(IDBTransaction.prototype, "objectStore").mockImplementation(
    function (this: IDBTransaction, name: string) {
      const store = originalObjectStore.call(this, name)
      if (name === LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME) entered.resolve()
      return store
    }
  )
  vi.spyOn(IDBTransaction.prototype, "abort").mockImplementation(() => {
    // Simulate the browser reporting that commit already won this race.
  })
  return entered.promise
}

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
        ? { ...value, localAssetId }
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
  vi.restoreAllMocks()
  Object.defineProperty(IDBObjectStore.prototype, "put", originalPutDescriptor)
  await deleteDatabase()
})

describe("local asset promotion journal", () => {
  it("waits for read abort acknowledgement and serializes the immediate retry", async () => {
    await createOrResumeLocalAssetPromotionJournal(creationInput())
    const controlled = controlNextJournalTransactionAbort()
    const controller = new AbortController()
    const reason = new DOMException("Cancelled", "AbortError")
    const first = readLocalAssetPromotionJournal(
      creationInput().localAssetId,
      controller.signal
    )
    await controlled.entered

    controller.abort(reason)
    await controlled.abortRequested
    const retry = readLocalAssetPromotionJournal(creationInput().localAssetId)
    let firstSettled = false
    void first.then(
      () => {
        firstSettled = true
      },
      () => {
        firstSettled = true
      }
    )
    await Promise.resolve()
    expect(firstSettled).toBe(false)
    expect(controlled.journalObjectStoreCalls()).toBe(1)

    controlled.acknowledge()
    await expect(first).rejects.toBe(reason)
    await expect(retry).resolves.toMatchObject({ status: "ready" })
  })

  it("rolls back a cancelled create before allowing a serialized retry", async () => {
    await readLocalAssetPromotionJournal("local-initialize-create")
    const controlled = controlNextJournalTransactionAbort()
    const controller = new AbortController()
    const reason = new DOMException("Cancelled", "AbortError")
    const input = creationInput("local-cancelled-create")
    const first = createOrResumeLocalAssetPromotionJournal(
      input,
      controller.signal
    )
    await controlled.entered

    controller.abort(reason)
    await controlled.abortRequested
    const retryRead = readLocalAssetPromotionJournal(input.localAssetId)
    await Promise.resolve()
    expect(controlled.journalObjectStoreCalls()).toBe(1)

    controlled.acknowledge()
    await expect(first).rejects.toBe(reason)
    await expect(retryRead).resolves.toEqual({ status: "missing" })
    await expect(
      createOrResumeLocalAssetPromotionJournal(input)
    ).resolves.toMatchObject({ state: "queued", lease: null })
  })

  it("rolls back a cancelled claim and leaves no busy lease for retry", async () => {
    const queued = await createOrResumeLocalAssetPromotionJournal(
      creationInput("local-cancelled-claim")
    )
    const controlled = controlNextJournalTransactionAbort()
    const controller = new AbortController()
    const reason = new DOMException("Cancelled", "AbortError")
    const claim = claimLocalAssetPromotionJournal(
      {
        localAssetId: queued.localAssetId,
        expectedRevision: queued.revision,
        ownerId: "owner-cancelled",
        leaseToken: "lease-cancelled",
        leaseMilliseconds: 90_000,
        now: "2026-08-30T00:00:01.000Z",
      },
      controller.signal
    )
    await controlled.entered

    controller.abort(reason)
    await controlled.abortRequested
    const retryRead = readLocalAssetPromotionJournal(queued.localAssetId)
    await Promise.resolve()
    expect(controlled.journalObjectStoreCalls()).toBe(1)

    controlled.acknowledge()
    await expect(claim).rejects.toBe(reason)
    const afterAbort = await retryRead
    expect(afterAbort).toMatchObject({
      status: "ready",
      journal: { revision: queued.revision, lease: null },
    })
    await expect(
      claimLocalAssetPromotionJournal({
        localAssetId: queued.localAssetId,
        expectedRevision: queued.revision,
        ownerId: "owner-retry",
        leaseToken: "lease-retry",
        leaseMilliseconds: 90_000,
        now: "2026-08-30T00:00:02.000Z",
      })
    ).resolves.toMatchObject({ lease: { ownerId: "owner-retry" } })
  })

  it("returns a committed create checkpoint after cancellation without creating a lease", async () => {
    await readLocalAssetPromotionJournal("local-initialize-commit")
    const entered = allowNextJournalTransactionToCommitAfterAbort()
    const controller = new AbortController()
    const input = creationInput("local-create-commit-wins")
    const create = createOrResumeLocalAssetPromotionJournal(
      input,
      controller.signal
    )
    await entered

    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(create).resolves.toMatchObject({
      localAssetId: input.localAssetId,
      state: "queued",
      lease: null,
    })
    await expect(
      readLocalAssetPromotionJournal(input.localAssetId)
    ).resolves.toMatchObject({
      status: "ready",
      journal: { state: "queued", lease: null },
    })
  })

  it("returns a committed claim so its exact lease can be released after cancellation", async () => {
    const queued = await createOrResumeLocalAssetPromotionJournal(
      creationInput("local-claim-commit-wins")
    )
    const entered = allowNextJournalTransactionToCommitAfterAbort()
    const controller = new AbortController()
    const claim = claimLocalAssetPromotionJournal(
      {
        localAssetId: queued.localAssetId,
        expectedRevision: queued.revision,
        ownerId: "owner-commit-wins",
        leaseToken: "lease-commit-wins",
        leaseMilliseconds: 90_000,
        now: "2026-08-30T00:00:01.000Z",
      },
      controller.signal
    )
    await entered

    controller.abort(new DOMException("Cancelled", "AbortError"))
    const claimed = await claim
    expect(claimed).toMatchObject({
      lease: {
        ownerId: "owner-commit-wins",
        token: "lease-commit-wins",
      },
    })
    await releaseLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "owner-commit-wins",
      leaseToken: "lease-commit-wins",
      now: "2026-08-30T00:00:02.000Z",
    })
    await expect(
      readLocalAssetPromotionJournal(claimed.localAssetId)
    ).resolves.toMatchObject({
      status: "ready",
      journal: { lease: null },
    })
  })

  it.each(["read", "create"] as const)(
    "closes a malformed database handle when journal %s setup throws synchronously",
    async (operation) => {
      await readLocalAssetPromotionJournal(`local-initialize-${operation}`)
      const close = vi.spyOn(IDBDatabase.prototype, "close")
      const abort = vi.spyOn(IDBTransaction.prototype, "abort")
      vi.spyOn(IDBTransaction.prototype, "objectStore").mockImplementation(
        () => {
          throw new Error("malformed journal handle")
        }
      )

      const result =
        operation === "read"
          ? readLocalAssetPromotionJournal("local-malformed-read")
          : createOrResumeLocalAssetPromotionJournal(
              creationInput("local-malformed-create")
            )
      if (operation === "read") {
        await expect(result).rejects.toThrow("malformed journal handle")
      } else {
        await expect(result).rejects.toMatchObject({
          code: "local_promotion_checkpoint_failed",
          cause: expect.objectContaining({
            message: "malformed journal handle",
          }),
        })
      }
      expect(abort).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalled()
    }
  )

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

  it("upgrades a Slice 3 journal with a distinct stable Recent key", async () => {
    const {
      now: _now,
      recentUseIdempotencyKey: _recentUseIdempotencyKey,
      ...legacyCreationInput
    } = creationInput()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_ASSET_DATABASE_NAME, 5)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
          { keyPath: "localAssetId" }
        )
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(
      LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
      "readwrite"
    )
    transaction.objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME).put({
      schemaVersion: 1,
      ...legacyCreationInput,
      revision: 2,
      contentSha256: managedContentSha256,
      attempt: 1,
      state: "mapped",
      managedAssetId: "asset-1234567890",
      managedContentSha256,
      managedStatus: "archived",
      managedAssetRevision: 2,
      mappingRequestId: "request-map-legacy",
      relinkResultContentSnapshotId: null,
      relinkResultHistorySnapshotId: null,
      relinkResultDraftSnapshotId: null,
      relinkResultDraftRecordVersion: null,
      relinkCommitId: null,
      relinkUndoable: null,
      errorCode: null,
      errorRequestId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lease: null,
    })
    await transactionDone(transaction)
    database.close()

    const upgraded = await readLocalAssetPromotionJournal(
      creationInput().localAssetId
    )

    expect(upgraded.status).toBe("ready")
    if (upgraded.status !== "ready") return
    expect(upgraded.journal.recentUseIdempotencyKey).toMatch(
      /^legacy-recent-[0-9a-f]{16}$/
    )
    expect(upgraded.journal.recentUseIdempotencyKey).not.toBe(
      upgraded.journal.idempotencyKey
    )
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
      relinkResultOperationVersion: 8,
      relinkResultKind: "committed" as const,
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
        relinkResultDraftContentSnapshotId: `sha256-${"d".repeat(64)}`,
        relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
        relinkResultDraftRecordVersion: 4,
        recentUseUsedAt: "2026-08-30T00:00:02.000Z",
        recentUseAssetRevision: 2,
        recentUseRequestId: "request-used-1",
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

  it("reanchors only a released pre-receipt relink result and preserves mapping identities", async () => {
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
    const checkpointed = await compareAndSwapLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:01.000Z",
      patch: {
        state: "relinking",
        contentSha256: managedContentSha256,
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedStatus: "ready",
        managedAssetRevision: 1,
        mappingRequestId: "request-map-1",
        relinkResultContentSnapshotId: `sha256-${"d".repeat(64)}`,
        relinkResultHistorySnapshotId: "history-result-1",
        relinkResultOperationVersion: 8,
        relinkResultKind: "committed",
        relinkCommitId: "commit-1",
        relinkUndoable: true,
      },
    })
    const released = await releaseLocalAssetPromotionJournal({
      localAssetId: checkpointed.localAssetId,
      expectedRevision: checkpointed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:02.000Z",
    })

    const recovered = await createOrResumeLocalAssetPromotionJournal({
      ...creationInput(),
      idempotencyKey: released.idempotencyKey,
      recentUseIdempotencyKey: released.recentUseIdempotencyKey,
      sourceContentSnapshotId: `sha256-${"f".repeat(64)}`,
      sourceHistorySnapshotId: "history-reloaded",
      sourceOperationVersion: 1,
      sourceDraftRecordVersion: 5,
      sourceDraftSnapshotId: `sha256-${"1".repeat(64)}`,
      supersedeUnpersistedRelinkRevision: released.revision,
      now: "2026-08-30T00:00:03.000Z",
    })

    expect(recovered).toMatchObject({
      state: "mapped",
      managedAssetId: released.managedAssetId,
      idempotencyKey: released.idempotencyKey,
      recentUseIdempotencyKey: released.recentUseIdempotencyKey,
      relinkResultKind: null,
      relinkCommitId: null,
    })
  })

  it("checkpoints a released relink conflict without discarding its recovery receipt", async () => {
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
    const checkpointed = await compareAndSwapLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:01.000Z",
      patch: {
        state: "relinking",
        contentSha256: managedContentSha256,
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedStatus: "ready",
        managedAssetRevision: 1,
        mappingRequestId: "request-map-1",
        relinkResultContentSnapshotId: `sha256-${"d".repeat(64)}`,
        relinkResultHistorySnapshotId: "history-result-1",
        relinkResultOperationVersion: 8,
        relinkResultKind: "committed",
        relinkCommitId: "commit-1",
        relinkUndoable: true,
      },
    })
    const released = await releaseLocalAssetPromotionJournal({
      localAssetId: checkpointed.localAssetId,
      expectedRevision: checkpointed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:02.000Z",
    })

    const conflict = await checkpointReleasedLocalAssetPromotionConflict({
      localAssetId: released.localAssetId,
      expectedRevision: released.revision,
      now: "2026-08-30T00:00:03.000Z",
    })

    expect(conflict).toMatchObject({
      state: "relinking",
      errorCode: "local_relink_conflict",
      relinkResultKind: "committed",
      relinkCommitId: "commit-1",
      lease: null,
    })
    await expect(
      checkpointReleasedLocalAssetPromotionConflict({
        localAssetId: released.localAssetId,
        expectedRevision: released.revision,
        now: "2026-08-30T00:00:04.000Z",
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
        relinkResultOperationVersion: 8,
        relinkResultKind: "committed",
        relinkResultDraftContentSnapshotId: `sha256-${"d".repeat(64)}`,
        relinkResultDraftSnapshotId: `sha256-${"e".repeat(64)}`,
        relinkResultDraftRecordVersion: 4,
        relinkCommitId: "commit-1",
        relinkUndoable: true,
        recentUseUsedAt: "2026-08-30T00:00:01.000Z",
        recentUseAssetRevision: 2,
        recentUseRequestId: "request-used-1",
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
    await expect(
      createOrResumeLocalAssetPromotionJournal({
        ...creationInput(),
        idempotencyKey: released.idempotencyKey,
        recentUseIdempotencyKey: "recent-use-idempotency-conflict",
        sourceDocumentId: "document-conflict",
        sourceLocalAssetRevision: released.sourceLocalAssetRevision + 1,
        supersedeCompletedRevision: released.revision,
        now: "2026-08-30T00:00:02.750Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)
    const next = await createOrResumeLocalAssetPromotionJournal({
      ...creationInput(),
      idempotencyKey: "promotion-idempotency-2",
      recentUseIdempotencyKey: "recent-use-idempotency-2",
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
        recentUseIdempotencyKey: "recent-use-idempotency-2",
        lease: null,
      })
    )
    expect(next.relinkCommitId).toBeNull()
    expect(next.relinkResultDraftSnapshotId).toBeNull()
  })

  it("re-anchors only a released unrelinked mapping and preserves both operation keys", async () => {
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
    const mapped = await compareAndSwapLocalAssetPromotionJournal({
      localAssetId: claimed.localAssetId,
      expectedRevision: claimed.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:01.000Z",
      patch: {
        state: "mapped",
        contentSha256: managedContentSha256,
        managedAssetId: "asset-1234567890",
        managedContentSha256,
        managedStatus: "archived",
        managedAssetRevision: 2,
        mappingRequestId: "request-mapped-1",
      },
    })
    const released = await releaseLocalAssetPromotionJournal({
      localAssetId: mapped.localAssetId,
      expectedRevision: mapped.revision,
      ownerId: "tab-a",
      leaseToken: "lease-a",
      now: "2026-08-30T00:00:02.000Z",
    })
    const nextInput = {
      ...creationInput(),
      sourceContentSnapshotId: `sha256-${"f".repeat(64)}`,
      sourceHistorySnapshotId: "history-snapshot-2",
      sourceOperationVersion: 8,
      sourceDraftRecordVersion: 4,
      sourceDraftSnapshotId: `sha256-${"1".repeat(64)}`,
      supersedeUnrelinkedRevision: released.revision,
      now: "2026-08-30T00:00:03.000Z",
    }

    const reanchored = await createOrResumeLocalAssetPromotionJournal(nextInput)

    expect(reanchored).toMatchObject({
      state: "mapped",
      managedStatus: "archived",
      idempotencyKey: creationInput().idempotencyKey,
      recentUseIdempotencyKey: creationInput().recentUseIdempotencyKey,
      sourceHistorySnapshotId: "history-snapshot-2",
      sourceOperationVersion: 8,
      lease: null,
    })
    await expect(
      createOrResumeLocalAssetPromotionJournal({
        ...nextInput,
        sourceHistorySnapshotId: "history-snapshot-3",
        recentUseIdempotencyKey: "different-recent-key",
        supersedeUnrelinkedRevision: reanchored.revision,
        now: "2026-08-30T00:00:04.000Z",
      })
    ).rejects.toBeInstanceOf(LocalAssetPromotionJournalRevisionError)
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
