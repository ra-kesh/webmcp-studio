import "fake-indexeddb/auto"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { afterEach, describe, expect, it } from "vitest"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import type { DraftRepositoryEvent } from "./document-draft-repository"

const timestamp = "2026-08-28T20:00:00.000Z"
const databaseNames: string[] = []

const objectStoreGetDescriptor = Object.getOwnPropertyDescriptor(
  IDBObjectStore.prototype,
  "get"
)
const objectStorePutDescriptor = Object.getOwnPropertyDescriptor(
  IDBObjectStore.prototype,
  "put"
)

if (!objectStoreGetDescriptor || !objectStorePutDescriptor) {
  throw new Error("fake-indexeddb did not expose the object-store methods")
}

const restoreIndexedDbPrototypes = () => {
  Object.defineProperty(
    IDBObjectStore.prototype,
    "get",
    objectStoreGetDescriptor
  )
  Object.defineProperty(
    IDBObjectStore.prototype,
    "put",
    objectStorePutDescriptor
  )
}

const deleteDatabase = (databaseName: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const openDatabase = (databaseName: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Transaction failed"))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Transaction aborted"))
  })

const readStoreValue = async (
  databaseName: string,
  storeName: "draft-body" | "draft-meta" | "draft-conflicts",
  documentId: string
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName)
    const done = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(storeName).get(documentId)
    )
    await done
    return value
  } finally {
    database.close()
  }
}

const storedPairBytes = async (databaseName: string, documentId: string) => ({
  body: JSON.stringify(
    await readStoreValue(databaseName, "draft-body", documentId)
  ),
  metadata: JSON.stringify(
    await readStoreValue(databaseName, "draft-meta", documentId)
  ),
})

const snapshot = (
  name = "Storage boundary draft",
  id = "document-storage-boundary"
): CurrentDraftSnapshot => {
  const document = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  return {
    document: { ...document, id, name },
    sourceContext: {
      quotationSource: null,
      quotationTemplateId: "editorial-olive",
      designTemplate: { id: "editorial-one-pager", version: 1 },
    },
  }
}

const editedSnapshot = (
  current: CurrentDraftSnapshot
): CurrentDraftSnapshot => ({
  document: {
    ...current.document,
    name: "Edited while storage is failing",
    revision: current.document.revision + 1,
    updatedAt: "2026-08-28T20:01:00.000Z",
  },
  sourceContext: current.sourceContext,
})

const establishConflict = async (
  repository: DocumentDraftRepository,
  initial: CurrentDraftSnapshot
) => {
  const created = await repository.create(initial)
  if (!created.ok) throw new Error("Expected fixture creation")
  const committed = await repository.save(
    editedSnapshot(initial),
    created.record.summary.recordVersion,
    created.record.summary.draftSnapshotId
  )
  if (!committed.ok) throw new Error("Expected committed fixture edit")
  const stale = await repository.save(
    {
      document: {
        ...initial.document,
        name: "Conflict candidate",
        revision: initial.document.revision + 2,
        updatedAt: "2026-08-28T20:02:00.000Z",
      },
      sourceContext: initial.sourceContext,
    },
    created.record.summary.recordVersion,
    created.record.summary.draftSnapshotId
  )
  if (stale.ok || stale.reason !== "conflict") {
    throw new Error("Expected a conflict fixture")
  }
  return stale.conflict
}

const createRepository = (indexedDbFactory: IDBFactory = indexedDB) => {
  const databaseName = `webmcp-studio-storage-failure-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  return {
    databaseName,
    repository: new DocumentDraftRepository({
      databaseName,
      indexedDB: indexedDbFactory,
      now: () => timestamp,
      sessionId: "storage-failure-session",
    }),
  }
}

const failedRequest = <T>(message: string): IDBRequest<T> => {
  const request = {
    error: new Error(message),
    onerror: null,
    onsuccess: null,
  } as unknown as IDBRequest<T>
  queueMicrotask(() => {
    request.onerror?.call(request, new Event("error"))
  })
  return request
}

const captureUnhandledRejections = () => {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => reasons.push(reason)
  process.on("unhandledRejection", listener)
  return {
    reasons,
    stop: () => process.off("unhandledRejection", listener),
  }
}

afterEach(async () => {
  restoreIndexedDbPrototypes()
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

describe.sequential("DocumentDraftRepository strict storage boundaries", () => {
  it("settles a blocked upgrade as a typed blocked result", async () => {
    const blockedFactory = {
      open: () => {
        const request = {
          onblocked: null,
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        } as unknown as IDBOpenDBRequest
        queueMicrotask(() => {
          request.onblocked?.call(
            request,
            new IDBVersionChangeEvent("blocked", {
              oldVersion: 1,
              newVersion: 2,
            })
          )
        })
        return request
      },
    } as unknown as IDBFactory
    const { repository } = createRepository(blockedFactory)

    const settled = await Promise.allSettled([repository.open()])

    expect(settled).toEqual([
      {
        status: "fulfilled",
        value: {
          ok: false,
          reason: "blocked",
          failure: {
            kind: "blocked",
            message: expect.stringMatching(
              /upgrade is blocked.*other Studio tab/i
            ),
          },
        },
      },
    ])
  })

  it("settles an IndexedDB request error with its actionable message", async () => {
    const initial = snapshot()
    const { repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const originalGet = IDBObjectStore.prototype.get
    let failNextBodyRead = true
    Object.defineProperty(IDBObjectStore.prototype, "get", {
      ...objectStoreGetDescriptor,
      value: function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        if (
          failNextBodyRead &&
          this.name === "draft-body" &&
          query === initial.document.id
        ) {
          failNextBodyRead = false
          return failedRequest("Injected draft-body request failure")
        }
        return originalGet.call(this, query)
      },
    })

    const unhandled = captureUnhandledRejections()
    const settled = await Promise.allSettled([
      repository.get(initial.document.id),
    ])
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    unhandled.stop()

    expect(settled).toEqual([
      {
        status: "fulfilled",
        value: {
          ok: false,
          reason: "storage_unavailable",
          failure: {
            kind: "request_failed",
            message: expect.stringContaining(
              "Injected draft-body request failure"
            ),
          },
        },
      },
    ])
    expect(unhandled.reasons).toEqual([])
  })

  it("rolls back body and metadata when the write transaction aborts", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const before = await storedPairBytes(databaseName, initial.document.id)
    const originalPut = IDBObjectStore.prototype.put
    let abortScheduled = false
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      ...objectStorePutDescriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        const request =
          key === undefined
            ? originalPut.call(this, value)
            : originalPut.call(this, value, key)
        if (
          !abortScheduled &&
          this.name === "draft-body" &&
          typeof value === "object" &&
          value !== null &&
          "recordVersion" in value &&
          value.recordVersion === 2
        ) {
          abortScheduled = true
          const transaction = this.transaction
          queueMicrotask(() => transaction.abort())
        }
        return request
      },
    })

    const unhandled = captureUnhandledRejections()
    const settled = await Promise.allSettled([
      repository.save(
        editedSnapshot(initial),
        created.record.summary.recordVersion,
        created.record.summary.draftSnapshotId
      ),
    ])
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    unhandled.stop()

    restoreIndexedDbPrototypes()
    expect(await storedPairBytes(databaseName, initial.document.id)).toEqual(
      before
    )
    expect(settled).toEqual([
      {
        status: "fulfilled",
        value: {
          ok: false,
          reason: "storage_unavailable",
          failure: {
            kind: "transaction_aborted",
            message: expect.stringMatching(/transaction.*aborted/i),
          },
        },
      },
    ])
    expect(unhandled.reasons).toEqual([])
  })

  it("preserves the committed pair when a write exceeds quota", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const before = await storedPairBytes(databaseName, initial.document.id)
    const originalPut = IDBObjectStore.prototype.put
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      ...objectStorePutDescriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (
          this.name === "draft-body" &&
          typeof value === "object" &&
          value !== null &&
          "recordVersion" in value &&
          value.recordVersion === 2
        ) {
          throw new DOMException(
            "The document quota limit was exceeded.",
            "QuotaExceededError"
          )
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key)
      },
    })

    const settled = await Promise.allSettled([
      repository.save(
        editedSnapshot(initial),
        created.record.summary.recordVersion,
        created.record.summary.draftSnapshotId
      ),
    ])

    restoreIndexedDbPrototypes()
    expect(await storedPairBytes(databaseName, initial.document.id)).toEqual(
      before
    )
    expect(settled).toEqual([
      {
        status: "fulfilled",
        value: {
          ok: false,
          reason: "storage_unavailable",
          failure: {
            kind: "quota_exceeded",
            message: expect.stringMatching(/quota limit was exceeded/i),
          },
        },
      },
    ])
  })

  it("rolls back copy body, metadata, and resolution when the atomic conflict transaction aborts", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const conflict = await establishConflict(repository, initial)
    const unresolvedConflict = JSON.stringify(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    )
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))
    const originalPut = IDBObjectStore.prototype.put
    let abortScheduled = false
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      ...objectStorePutDescriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        const request =
          key === undefined
            ? originalPut.call(this, value)
            : originalPut.call(this, value, key)
        if (
          !abortScheduled &&
          this.name === "draft-conflicts" &&
          typeof value === "object" &&
          value !== null &&
          "resolution" in value &&
          value.resolution === "save_copy"
        ) {
          abortScheduled = true
          const transaction = this.transaction
          queueMicrotask(() => transaction.abort())
        }
        return request
      },
    })

    const result = await repository.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-aborted-copy",
    })

    restoreIndexedDbPrototypes()
    expect(result).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "transaction_aborted",
        message: expect.stringMatching(/transaction.*aborted/i),
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", "document-aborted-copy")
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-meta", "document-aborted-copy")
    ).toBeUndefined()
    expect(
      JSON.stringify(
        await readStoreValue(
          databaseName,
          "draft-conflicts",
          conflict.conflictId
        )
      )
    ).toBe(unresolvedConflict)
    expect(events).toEqual([])
  })

  it("rolls back scheduled copy puts when conflict resolution exceeds quota", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const conflict = await establishConflict(repository, initial)
    const unresolvedConflict = JSON.stringify(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    )
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))
    const originalPut = IDBObjectStore.prototype.put
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      ...objectStorePutDescriptor,
      value: function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (
          this.name === "draft-conflicts" &&
          typeof value === "object" &&
          value !== null &&
          "resolution" in value &&
          value.resolution === "save_copy"
        ) {
          this.transaction.abort()
          throw new DOMException(
            "The conflict-copy quota limit was exceeded.",
            "QuotaExceededError"
          )
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key)
      },
    })

    const result = await repository.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-quota-copy",
    })

    restoreIndexedDbPrototypes()
    expect(result).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "quota_exceeded",
        message: expect.stringMatching(/conflict-copy quota limit/i),
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", "document-quota-copy")
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-meta", "document-quota-copy")
    ).toBeUndefined()
    expect(
      JSON.stringify(
        await readStoreValue(
          databaseName,
          "draft-conflicts",
          conflict.conflictId
        )
      )
    ).toBe(unresolvedConflict)
    expect(events).toEqual([])
  })
})
