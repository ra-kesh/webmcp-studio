import "fake-indexeddb/auto"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { afterEach, describe, expect, it } from "vitest"
import { CURRENT_DRAFT_STORAGE_KEY } from "./current-draft-repository"
import type {
  CurrentDraftSnapshot,
  DraftStorage,
} from "./current-draft-repository"
import { migrateCurrentDraftToRepository } from "./document-draft-migration"
import { DocumentDraftRepository } from "./document-draft-repository"
import type { DocumentDraftReadResult } from "./document-draft-repository"

const corruptReadResult = (
  result: DocumentDraftReadResult
): Extract<DocumentDraftReadResult, { quarantineId: string }> => {
  if (result.ok || !("quarantineId" in result)) {
    throw new Error("Expected a corrupt read with a quarantine ID")
  }
  return result
}

let databaseSequence = 0
const databaseNames: string[] = []

const timestamp = "2026-08-28T18:00:00.000Z"

const snapshot = (
  name = "Failure contract draft",
  id = "document-failure-contract"
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

const changedSnapshot = (
  initial: CurrentDraftSnapshot,
  name: string
): CurrentDraftSnapshot => ({
  document: {
    ...initial.document,
    name,
    revision: initial.document.revision + 1,
    updatedAt: "2026-08-28T18:01:00.000Z",
  },
  sourceContext: initial.sourceContext,
})

const createRepository = (
  options: {
    databaseName?: string
    sessionId?: string
    now?: () => string
    indexedDB?: IDBFactory
    createBroadcastChannel?: (name: string) => BroadcastChannel
  } = {}
) => {
  const databaseName =
    options.databaseName ??
    `webmcp-studio-failure-test-${databaseSequence++}-${crypto.randomUUID()}`
  if (!databaseNames.includes(databaseName)) databaseNames.push(databaseName)
  const repositoryOptions = {
    databaseName,
    indexedDB: options.indexedDB ?? indexedDB,
    now: options.now ?? (() => timestamp),
    sessionId: options.sessionId,
    createBroadcastChannel: options.createBroadcastChannel,
  } satisfies ConstructorParameters<typeof DocumentDraftRepository>[0]
  return {
    databaseName,
    repository: new DocumentDraftRepository(repositoryOptions),
  }
}

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

const readStoreValue = async <T>(
  databaseName: string,
  storeName: string,
  key: IDBValidKey
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName)
    const done = transactionDone(transaction)
    const value = await requestResult<T>(
      transaction.objectStore(storeName).get(key)
    )
    await done
    return value
  } finally {
    database.close()
  }
}

const mutateStores = async (
  databaseName: string,
  mutation: (stores: { body: IDBObjectStore; metadata: IDBObjectStore }) => void
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(
      ["draft-body", "draft-meta"],
      "readwrite"
    )
    const done = transactionDone(transaction)
    mutation({
      body: transaction.objectStore("draft-body"),
      metadata: transaction.objectStore("draft-meta"),
    })
    await done
  } finally {
    database.close()
  }
}

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

class CleanupFailureStorage implements DraftStorage {
  readonly values = new Map<string, string>()
  failCurrentDraftRemoval = true

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    if (this.failCurrentDraftRemoval && key === CURRENT_DRAFT_STORAGE_KEY) {
      throw new Error("Current-draft cleanup denied")
    }
    this.values.delete(key)
  }
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

describe("DocumentDraftRepository failure contract", () => {
  it("does not let stale quarantine evidence delete a newer valid pair", async () => {
    const initial = snapshot()
    const { databaseName, repository: writer } = createRepository({
      sessionId: "writer",
    })
    const created = await writer.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")

    const healthyBody = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      initial.document.id
    )
    const healthyMetadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )
    await mutateStores(databaseName, ({ metadata }) => {
      metadata.put({
        ...healthyMetadata,
        contentSnapshotId: "sha256-corrupt-observation",
      })
    })

    const repairDatabase = await openDatabase(databaseName)
    const repairTransactions: Promise<void>[] = []
    let openCount = 0
    const interposedIndexedDB = new Proxy(indexedDB, {
      get(target, property) {
        if (property === "open") {
          return (name: string, version?: number) => {
            openCount += 1
            if (openCount === 2) {
              const transaction = repairDatabase.transaction(
                ["draft-body", "draft-meta"],
                "readwrite"
              )
              repairTransactions.push(transactionDone(transaction))
              transaction.objectStore("draft-body").put(healthyBody)
              transaction.objectStore("draft-meta").put(healthyMetadata)
            }
            return version === undefined
              ? target.open(name)
              : target.open(name, version)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const { repository: reader } = createRepository({
      databaseName,
      sessionId: "reader",
      indexedDB: interposedIndexedDB,
    })

    const read = await reader.get(initial.document.id)
    await Promise.all(repairTransactions)
    repairDatabase.close()

    expect(repairTransactions).toHaveLength(1)
    expect(openCount).toBeGreaterThanOrEqual(3)
    expect(read).toMatchObject({
      ok: true,
      status: "found",
      record: { summary: { recordVersion: 1 } },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(healthyBody)
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toEqual(healthyMetadata)
  })

  it("returns healthy list rows with retained recovery when quarantine storage fails", async () => {
    const activityAt = "2026-08-28T18:10:00.000Z"
    const { databaseName, repository } = createRepository({
      now: () => activityAt,
      sessionId: "retained-list",
    })
    for (const documentId of ["document-a", "document-b", "document-c"]) {
      const created = await repository.create(snapshot(documentId, documentId))
      expect(created).toMatchObject({ ok: true })
    }
    const bodyBefore = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      "document-b"
    )
    const metadataBefore = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      "document-b"
    )
    const corruptMetadata = { ...metadataBefore, name: "" }
    await mutateStores(databaseName, ({ metadata }) => {
      metadata.put(corruptMetadata)
    })
    const events: unknown[] = []
    repository.subscribe((event) => events.push(event))
    const originalTransaction = IDBDatabase.prototype.transaction
    const transactionCall = originalTransaction as unknown as (
      this: IDBDatabase,
      storeNames: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ) => IDBTransaction
    Object.defineProperty(IDBDatabase.prototype, "transaction", {
      configurable: true,
      writable: true,
      value: function (
        this: IDBDatabase,
        storeNames: string | string[],
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions
      ) {
        const names =
          typeof storeNames === "string" ? [storeNames] : [...storeNames]
        if (names.includes("draft-quarantine")) {
          throw new Error("Injected quarantine transaction failure")
        }
        return transactionCall.call(this, storeNames, mode, options)
      },
    })

    let listed: Awaited<ReturnType<DocumentDraftRepository["list"]>>
    try {
      listed = await repository.list({ limit: 2 })
    } finally {
      Object.defineProperty(IDBDatabase.prototype, "transaction", {
        configurable: true,
        writable: true,
        value: originalTransaction,
      })
    }

    expect(listed).toMatchObject({
      ok: true,
      page: {
        items: [{ documentId: "document-c" }, { documentId: "document-a" }],
        nextCursor: null,
        recoveryItems: [
          {
            documentId: "document-b",
            quarantineId: null,
            status: "retained",
            failure: {
              kind: "storage_unavailable",
              message: expect.stringContaining(
                "Injected quarantine transaction failure"
              ),
            },
          },
        ],
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", "document-b")
    ).toEqual(bodyBefore)
    expect(
      await readStoreValue(databaseName, "draft-meta", "document-b")
    ).toEqual(corruptMetadata)
    expect(await repository.listQuarantine("document-b")).toEqual({
      ok: true,
      value: [],
    })
    expect(events).toEqual([])
  })

  it("omits stale list evidence when a healthy pair supersedes it before quarantine", async () => {
    const activityAt = "2026-08-28T18:20:00.000Z"
    const initial = snapshot("Repairable", "document-repairable")
    const { databaseName, repository: writer } = createRepository({
      now: () => activityAt,
      sessionId: "repair-writer",
    })
    const created = await writer.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const healthyBody = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      initial.document.id
    )
    const healthyMetadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )
    await mutateStores(databaseName, ({ metadata }) => {
      metadata.put({ ...healthyMetadata, name: "" })
    })

    const repairDatabase = await openDatabase(databaseName)
    const repairTransactions: Promise<void>[] = []
    let openCount = 0
    const interposedIndexedDB = new Proxy(indexedDB, {
      get(target, property) {
        if (property === "open") {
          return (name: string, version?: number) => {
            openCount += 1
            if (openCount === 2) {
              const transaction = repairDatabase.transaction(
                ["draft-body", "draft-meta"],
                "readwrite"
              )
              repairTransactions.push(transactionDone(transaction))
              transaction.objectStore("draft-body").put(healthyBody)
              transaction.objectStore("draft-meta").put(healthyMetadata)
            }
            return version === undefined
              ? target.open(name)
              : target.open(name, version)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const { repository: reader } = createRepository({
      databaseName,
      indexedDB: interposedIndexedDB,
      sessionId: "repair-reader",
    })
    const events: unknown[] = []
    reader.subscribe((event) => events.push(event))
    const startingCursor = `${encodeURIComponent(activityAt)}~${encodeURIComponent("document-z")}`

    const first = await reader.list({ cursor: startingCursor })
    await Promise.all(repairTransactions)
    repairDatabase.close()

    expect(first).toEqual({
      ok: true,
      page: { items: [], nextCursor: null, recoveryItems: [] },
    })
    expect(repairTransactions).toHaveLength(1)
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(healthyBody)
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toEqual(healthyMetadata)
    expect(await reader.listQuarantine(initial.document.id)).toEqual({
      ok: true,
      value: [],
    })
    expect(events).toEqual([])

    expect(await reader.list({ cursor: startingCursor })).toMatchObject({
      ok: true,
      page: {
        items: [{ documentId: initial.document.id }],
        recoveryItems: [],
      },
    })
  })

  it("returns typed storage failures from open, get, list, and save", async () => {
    const deniedIndexedDB = {
      open: () => {
        throw new Error("IndexedDB denied by browser policy")
      },
    } as unknown as IDBFactory
    const initial = snapshot()
    const { repository } = createRepository({ indexedDB: deniedIndexedDB })
    const contract = repository

    const [opened, read, listed, saved] = await Promise.allSettled([
      repository.open(),
      contract.get(initial.document.id),
      contract.list(),
      repository.save(initial, 1, `sha256-${"a".repeat(64)}`),
    ])

    expect(opened).toMatchObject({
      status: "fulfilled",
      value: { ok: false, reason: "storage_unavailable" },
    })
    expect(read).toMatchObject({
      status: "fulfilled",
      value: { ok: false, reason: "storage_unavailable" },
    })
    expect(listed).toMatchObject({
      status: "fulfilled",
      value: { ok: false, reason: "storage_unavailable" },
    })
    expect(saved).toMatchObject({
      status: "fulfilled",
      value: { ok: false, reason: "storage_unavailable" },
    })
  })

  it("rejects malformed save ancestry before storage and never poisons conflicts", async () => {
    const initial = snapshot()
    const { repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const candidate = changedSnapshot(initial, "Malformed ancestry candidate")
    const unsafeSave = repository.save.bind(repository) as unknown as (
      value: CurrentDraftSnapshot,
      version: unknown,
      base?: unknown
    ) => ReturnType<DocumentDraftRepository["save"]>

    const results = await Promise.allSettled([
      unsafeSave(candidate, -1, "sha256-"),
      unsafeSave(candidate, 1.5, created.record.summary.draftSnapshotId),
      unsafeSave(candidate, 1),
      unsafeSave(candidate, 1, `sha256-${"z".repeat(64)}`),
      unsafeSave(candidate, 1, `sha256-${"A".repeat(64)}`),
    ])

    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(result).toMatchObject({
        status: "fulfilled",
        value: { ok: false, reason: "validation_failed" },
      })
    }
    expect(await repository.listConflicts(initial.document.id)).toEqual({
      ok: true,
      value: [],
    })
    expect(await repository.get(initial.document.id)).toMatchObject({
      ok: true,
      status: "found",
      record: { summary: { recordVersion: 1 } },
    })
  })

  it("returns a non-retryable corrupt result when the pair breaks after save preflight", async () => {
    const initial = snapshot()
    const { databaseName, repository: creator } = createRepository({
      sessionId: "preflight-creator",
    })
    const created = await creator.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const healthyMetadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )
    const mutationDatabase = await openDatabase(databaseName)
    const mutationTransactions: Promise<void>[] = []
    let openCount = 0
    const interposedIndexedDB = new Proxy(indexedDB, {
      get(target, property) {
        if (property === "open") {
          return (name: string, version?: number) => {
            openCount += 1
            if (openCount === 2) {
              const transaction = mutationDatabase.transaction(
                "draft-meta",
                "readwrite"
              )
              mutationTransactions.push(transactionDone(transaction))
              transaction.objectStore("draft-meta").put({
                ...healthyMetadata,
                contentSnapshotId: `sha256-${"b".repeat(64)}`,
              })
            }
            return version === undefined
              ? target.open(name)
              : target.open(name, version)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const { repository: writer } = createRepository({
      databaseName,
      sessionId: "preflight-writer",
      indexedDB: interposedIndexedDB,
    })

    const result = await writer.save(
      changedSnapshot(initial, "Candidate after preflight"),
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    await Promise.all(mutationTransactions)
    mutationDatabase.close()

    expect(result).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      quarantineId: expect.any(String),
      failure: { kind: "corrupt_record" },
    })
    if (result.ok || result.reason !== "corrupt_record") {
      throw new Error("Expected a corrupt save result")
    }
    expect(await writer.getQuarantine(result.quarantineId)).toMatchObject({
      ok: true,
      value: { documentId: initial.document.id, activeRowsRemoved: true },
    })
  })

  it("uses the migration marker to resume cleanup after the migrated head changes", async () => {
    const initial = snapshot()
    const storage = new CleanupFailureStorage()
    storage.setItem(
      CURRENT_DRAFT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        document: initial.document,
        sourceContext: initial.sourceContext,
      })
    )
    const { repository } = createRepository({ sessionId: "migration-retry" })

    const first = await migrateCurrentDraftToRepository({
      repository,
      getStorage: () => storage,
      now: () => timestamp,
    })
    expect(first).toMatchObject({
      status: "migrated",
      disposition: "created",
      cleanupFailures: [{ key: CURRENT_DRAFT_STORAGE_KEY }],
    })

    const edited = await repository.save(
      changedSnapshot(initial, "Edited after migration"),
      1,
      first.status === "migrated"
        ? first.record.summary.draftSnapshotId
        : "unreachable"
    )
    expect(edited).toMatchObject({
      ok: true,
      record: { summary: { recordVersion: 2 } },
    })

    storage.failCurrentDraftRemoval = false
    const retry = await migrateCurrentDraftToRepository({
      repository,
      getStorage: () => storage,
      now: () => "2026-08-28T18:02:00.000Z",
    })

    expect(retry).toMatchObject({
      status: "migrated",
      disposition: "already_migrated",
      cleanupFailures: [],
      record: {
        summary: { recordVersion: 2, name: "Edited after migration" },
      },
    })
    expect(storage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()
  })

  it("distinguishes a missing draft from a corrupt draft", async () => {
    const { repository } = createRepository()
    const result = await repository.get("document-that-never-existed")

    expect(result).toEqual({ ok: true, status: "missing" })
  })

  const corruptCases = [
    {
      name: "missing body",
      failingStore: "draft-body",
      code: "missing_body",
      reason: "The draft body is missing.",
      mutate: (
        documentId: string,
        _body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => stores.body.delete(documentId),
    },
    {
      name: "missing metadata",
      failingStore: "draft-meta",
      code: "missing_metadata",
      reason: "The draft metadata is missing.",
      mutate: (
        documentId: string,
        _body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => stores.metadata.delete(documentId),
    },
    {
      name: "malformed body",
      failingStore: "draft-body",
      code: "schema_invalid",
      reason: "The draft body could not be decoded.",
      mutate: (
        documentId: string,
        _body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => stores.body.put({ schemaVersion: 1, documentId }),
    },
    {
      name: "unsupported body schema",
      failingStore: "draft-body",
      code: "schema_invalid",
      reason: "The draft body uses unsupported schema version 99.",
      mutate: (
        _documentId: string,
        body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => stores.body.put({ ...body, schemaVersion: 99 }),
    },
    {
      name: "content hash mismatch",
      failingStore: "paired-record",
      code: "integrity_mismatch",
      reason: "The draft body does not match its stored content snapshot hash.",
      mutate: (
        _documentId: string,
        body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => {
        const changedBody = structuredClone(body)
        const document =
          changedBody.document as CurrentDraftSnapshot["document"]
        document.nodes[0] = {
          ...document.nodes[0],
          name: "Changed without changing the stored hash",
        }
        stores.body.put(changedBody)
      },
    },
    {
      name: "invalid document aggregate",
      failingStore: "draft-body",
      code: "schema_invalid",
      reason: "The draft document aggregate is invalid.",
      mutate: (
        _documentId: string,
        body: Record<string, unknown>,
        _metadata: Record<string, unknown>,
        stores: { body: IDBObjectStore; metadata: IDBObjectStore }
      ) => {
        const changedBody = structuredClone(body)
        const document =
          changedBody.document as CurrentDraftSnapshot["document"]
        document.pages[0] = {
          ...document.pages[0],
          nodeIds: [...document.pages[0].nodeIds, "missing-node"],
        }
        stores.body.put(changedBody)
      },
    },
  ] as const

  for (const corruption of corruptCases) {
    it(`returns a typed corrupt result for ${corruption.name}`, async () => {
      const initial = snapshot(corruption.name)
      const { databaseName, repository } = createRepository()
      const created = await repository.create(initial)
      if (!created.ok) throw new Error("Expected fixture creation")
      const body = await readStoreValue<Record<string, unknown>>(
        databaseName,
        "draft-body",
        initial.document.id
      )
      const metadata = await readStoreValue<Record<string, unknown>>(
        databaseName,
        "draft-meta",
        initial.document.id
      )
      await mutateStores(databaseName, (stores) =>
        corruption.mutate(initial.document.id, body, metadata, stores)
      )

      const read = await repository.get(initial.document.id)

      expect(read).toMatchObject({
        ok: false,
        reason: "corrupt_record",
        quarantineId: expect.any(String),
        failure: { kind: "corrupt_record" },
      })
      const corruptRead = corruptReadResult(read)
      const quarantined = await repository.getQuarantine(
        corruptRead.quarantineId
      )
      expect(quarantined).toMatchObject({
        ok: true,
        value: {
          documentId: initial.document.id,
          failure: {
            store: corruption.failingStore,
            key: initial.document.id,
            code: corruption.code,
            message: corruption.reason,
          },
          activeRowsRemoved: true,
        },
      })
    })
  }

  it("lists, reads, serializes, and deletes quarantined raw data", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    await mutateStores(databaseName, ({ body }) => {
      body.delete(initial.document.id)
    })
    const read = await repository.get(initial.document.id)
    const corruptRead = corruptReadResult(read)
    const contract = repository

    const list = await contract.listQuarantine(initial.document.id)
    expect(list).toMatchObject({
      ok: true,
      value: [{ quarantineId: corruptRead.quarantineId }],
    })

    const record = await contract.getQuarantine(corruptRead.quarantineId)
    expect(record).toMatchObject({
      ok: true,
      value: {
        quarantineId: corruptRead.quarantineId,
        documentId: initial.document.id,
        failure: {
          store: "draft-body",
          key: initial.document.id,
          code: "missing_body",
          message: "The draft body is missing.",
        },
        activeRowsRemoved: true,
        metadata: expect.objectContaining({ documentId: initial.document.id }),
      },
    })
    const download = new Blob([JSON.stringify(record)], {
      type: "application/json",
    })
    expect(download.type).toBe("application/json")
    expect(await download.text()).toContain(initial.document.id)
    expect(await download.text()).toContain("metadata")

    expect(await contract.deleteQuarantine(corruptRead.quarantineId)).toEqual({
      ok: true,
      value: { deletedId: corruptRead.quarantineId },
    })
    expect(await contract.getQuarantine(corruptRead.quarantineId)).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(await contract.listQuarantine(initial.document.id)).toEqual({
      ok: true,
      value: [],
    })
    expect(await contract.deleteQuarantine(corruptRead.quarantineId)).toEqual({
      ok: false,
      reason: "missing",
    })
  })

  it("does not increment or rewrite an exact same-content save", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository()
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const bodyBefore = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      initial.document.id
    )
    const metadataBefore = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )

    const saved = await repository.save(
      initial,
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )

    expect(saved).toMatchObject({
      ok: true,
      unchanged: true,
      record: { summary: { recordVersion: 1 } },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(bodyBefore)
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toEqual(metadataBefore)
  })

  it("lets exactly one simultaneous version-1 save commit version 2", async () => {
    const initial = snapshot()
    const { databaseName, repository: creator } = createRepository({
      sessionId: "creator",
    })
    const created = await creator.create(initial)
    if (!created.ok) throw new Error("Expected fixture creation")
    const tabA = createRepository({
      databaseName,
      sessionId: "tab-a",
    }).repository
    const tabB = createRepository({
      databaseName,
      sessionId: "tab-b",
    }).repository

    const results = await Promise.all([
      tabA.save(
        changedSnapshot(initial, "Candidate A"),
        1,
        created.record.summary.draftSnapshotId
      ),
      tabB.save(
        changedSnapshot(initial, "Candidate B"),
        1,
        created.record.summary.draftSnapshotId
      ),
    ])

    const winners = results.filter((result) => result.ok && !result.unchanged)
    const losers = results.filter(
      (result) => !result.ok && result.reason === "conflict"
    )
    expect(winners).toHaveLength(1)
    expect(winners[0]).toMatchObject({
      ok: true,
      record: { summary: { recordVersion: 2 } },
    })
    expect(losers).toHaveLength(1)
    expect(losers[0]).toMatchObject({
      ok: false,
      reason: "conflict",
      conflict: { expectedRecordVersion: 1, observedRecordVersion: 2 },
    })
    const conflictsResult = await creator.listConflicts(initial.document.id)
    expect(conflictsResult).toMatchObject({ ok: true })
    if (!conflictsResult.ok) throw new Error("Expected readable conflicts")
    const conflicts = conflictsResult.value
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].candidate.document.name).toMatch(/^Candidate [AB]$/)
  })

  it("keeps equal-activity pagination stable across the cursor boundary", async () => {
    const { repository } = createRepository({ now: () => timestamp })
    await repository.create(snapshot("A", "document-a"))
    await repository.create(snapshot("B", "document-b"))
    await repository.create(snapshot("C", "document-c"))
    const contract = repository

    const first = await contract.list({ limit: 2 })
    expect(first).toMatchObject({
      ok: true,
      page: {
        items: [
          { documentId: "document-c", activityAt: timestamp },
          { documentId: "document-b", activityAt: timestamp },
        ],
        nextCursor: expect.any(String),
      },
    })
    if (!first.ok || !first.page.nextCursor) {
      throw new Error("Expected the first list page")
    }

    const second = await contract.list({
      limit: 2,
      cursor: first.page.nextCursor,
    })
    expect(second).toEqual({
      ok: true,
      page: {
        items: [expect.objectContaining({ documentId: "document-a" })],
        nextCursor: null,
        recoveryItems: [],
      },
    })
  })

  it("isolates BroadcastChannel construction, observers, malformed messages, post, unsubscribe, and close", async () => {
    const constructorFailure = createRepository({
      createBroadcastChannel: () => {
        throw new Error("channel construction denied")
      },
    }).repository
    expect(
      await constructorFailure.create(snapshot("Constructor failure"))
    ).toMatchObject({ ok: true })

    const messageSink: {
      listener: ((event: MessageEvent<unknown>) => void) | null
    } = { listener: null }
    let closed = false
    const channel = {
      name: "failure-channel",
      onmessage: null,
      onmessageerror: null,
      postMessage: () => {
        throw new Error("post denied")
      },
      close: () => {
        closed = true
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    } as unknown as BroadcastChannel
    Object.defineProperty(channel, "onmessage", {
      get: () => messageSink.listener,
      set: (listener) => {
        messageSink.listener = listener
      },
    })
    const dispatchInbound = (data: unknown) => {
      messageSink.listener?.({ data } as MessageEvent<unknown>)
    }
    const { repository } = createRepository({
      createBroadcastChannel: () => channel,
    })
    const observed: string[] = []
    repository.subscribe(() => {
      throw new Error("observer failed")
    })
    const unsubscribe = repository.subscribe((event) => {
      observed.push(event.type)
    })

    expect(await repository.create(snapshot("Post failure"))).toMatchObject({
      ok: true,
    })
    expect(observed).toEqual(["saved"])
    dispatchInbound({ type: "saved", sessionId: "remote" })
    expect(observed).toEqual(["saved"])
    dispatchInbound({
      type: "deleted",
      documentId: "remote-document",
      recordVersion: 2,
      sessionId: "remote-session",
    })
    expect(observed).toEqual(["saved", "deleted"])
    dispatchInbound({
      type: "conflict_resolved",
      conflictId: "conflict-reload",
      documentId: "remote-document",
      resolution: "reload_saved",
      resolutionDocumentId: null,
      sessionId: "remote-session",
    })
    dispatchInbound({
      type: "conflict_resolved",
      conflictId: "conflict-copy",
      documentId: "remote-document",
      resolution: "save_copy",
      resolutionDocumentId: "document-copy",
      sessionId: "remote-session",
    })
    expect(observed).toEqual([
      "saved",
      "deleted",
      "conflict_resolved",
      "conflict_resolved",
    ])
    for (const malformed of [
      {
        resolution: "reload_saved",
        resolutionDocumentId: "must-be-null",
      },
      { resolution: "save_copy", resolutionDocumentId: null },
      { resolution: "unknown", resolutionDocumentId: null },
    ]) {
      dispatchInbound({
        type: "conflict_resolved",
        conflictId: "conflict-malformed",
        documentId: "remote-document",
        sessionId: "remote-session",
        ...malformed,
      })
    }
    dispatchInbound({
      type: "conflict_resolved",
      documentId: "remote-document",
      resolution: "reload_saved",
      resolutionDocumentId: null,
      sessionId: "remote-session",
    })
    expect(observed).toEqual([
      "saved",
      "deleted",
      "conflict_resolved",
      "conflict_resolved",
    ])
    dispatchInbound({
      type: "quarantined",
      documentId: "remote-document",
      quarantineId: "remote-quarantine",
      sessionId: "remote-session",
    })
    dispatchInbound({
      type: "quarantined",
      documentId: "remote-document",
      quarantineId: "",
      sessionId: "remote-session",
    })
    expect(observed).toEqual([
      "saved",
      "deleted",
      "conflict_resolved",
      "conflict_resolved",
      "quarantined",
    ])

    unsubscribe()
    dispatchInbound({
      type: "restored",
      documentId: "remote-document",
      recordVersion: 3,
      sessionId: "remote-session",
    })
    expect(observed).toEqual([
      "saved",
      "deleted",
      "conflict_resolved",
      "conflict_resolved",
      "quarantined",
    ])
    repository.close()
    expect(closed).toBe(true)
  })
})
