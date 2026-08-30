import "fake-indexeddb/auto"
import {
  applyCommand,
  assetReferenceKeysForSource,
  builtInDesignTemplateRepository,
  documentSchema,
  localAssetSource,
  managedAssetSource,
  sceneNodeSchema,
} from "@webmcp/document"
import { afterEach, describe, expect, it } from "vitest"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import type {
  AdmissionMigrationAlias,
  DocumentDraftRecord,
  DraftHeadIdentity,
  LocalMediaAdmissionReceipt,
  MigrateLocalMediaInput,
} from "./document-draft-repository"

const localAssetId = "local-admission-photo"
const localSource = localAssetSource(localAssetId)
const managedAssetId = "asset-admissionphoto01"
const managedSource = managedAssetSource(managedAssetId)
const createdAt = "2026-08-30T09:00:00.000Z"
const migratedAt = "2026-08-30T09:01:00.000Z"
const restoredAt = "2026-08-30T09:02:00.000Z"
const acknowledgedAt = "2026-08-30T09:03:00.000Z"
const databaseNames: string[] = []
const objectStorePutDescriptor = Object.getOwnPropertyDescriptor(
  IDBObjectStore.prototype,
  "put"
)
const objectStoreDeleteDescriptor = Object.getOwnPropertyDescriptor(
  IDBObjectStore.prototype,
  "delete"
)

if (!objectStorePutDescriptor || !objectStoreDeleteDescriptor) {
  throw new Error("fake-indexeddb did not expose object-store mutations")
}

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

afterEach(async () => {
  Object.defineProperty(
    IDBObjectStore.prototype,
    "put",
    objectStorePutDescriptor
  )
  Object.defineProperty(
    IDBObjectStore.prototype,
    "delete",
    objectStoreDeleteDescriptor
  )
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

const repository = (suffix: string) => {
  const databaseName = `draft-media-admission-${suffix}-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  let id = 0
  return {
    databaseName,
    value: new DocumentDraftRepository({
      databaseName,
      indexedDB,
      now: () => migratedAt,
      createId: () => `generated-${++id}`,
      sessionId: `session-${suffix}`,
    }),
  }
}

const openDatabase = (name: string, version?: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(name)
        : indexedDB.open(name, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => undefined
    transaction.onabort = () => reject(transaction.error)
  })

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const readStore = async <T>(
  databaseName: string,
  storeName: string,
  key: IDBValidKey
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName)
    const done = transactionDone(transaction)
    const result = await requestResult<T>(
      transaction.objectStore(storeName).get(key)
    )
    await done
    return result
  } finally {
    database.close()
  }
}

const sourceSnapshot = (
  documentId = "document-media-admission"
): CurrentDraftSnapshot => {
  const base = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  const page = base.pages[0]
  const image = sceneNodeSchema.parse({
    id: "admission-image",
    type: "image",
    name: "Admission image",
    assetId: localAssetId,
    src: localSource,
    alt: "A local admission image",
    altProvenance: "authored",
    decorative: false,
    placement: {
      mode: "manual",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    x: 40,
    y: 40,
    width: 240,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  })
  const document = documentSchema.parse({
    ...base,
    id: documentId,
    name: "Media admission fixture",
    createdAt,
    updatedAt: createdAt,
    pages: base.pages.map((candidate) =>
      candidate.id === page.id
        ? { ...candidate, nodeIds: [...candidate.nodeIds, image.id] }
        : candidate
    ),
    nodes: [...base.nodes, image],
  })
  return {
    document,
    sourceContext: {
      quotationSource: null,
      quotationTemplateId: "editorial-olive",
      designTemplate: { id: "editorial-one-pager", version: 1 },
    },
  }
}

const migrationFixture = (created: DocumentDraftRecord) => {
  const expectedReferenceKeys = assetReferenceKeysForSource(
    created.envelope.document,
    localSource
  )
  const resultEnvelope = {
    ...created.envelope,
    document: applyCommand(created.envelope.document, {
      id: "admission-relink",
      type: "relink_asset_references",
      actor: "human",
      at: migratedAt,
      from: localSource,
      toAssetId: managedAssetId,
      toSource: managedSource,
      expectedReferenceKeys,
    }),
  }
  const source: DraftHeadIdentity = {
    documentId: created.summary.documentId,
    recordVersion: created.summary.recordVersion,
    contentSnapshotId: created.summary.contentSnapshotId,
    draftSnapshotId: created.summary.draftSnapshotId,
    deletedAt: created.summary.deletedAt,
  }
  const alias: AdmissionMigrationAlias = {
    localAssetId,
    managedAssetId,
    managedSource,
    contentSha256: "a".repeat(64),
    managedStatus: "ready",
    expectedReferenceKeys,
    localState: "ready",
    relationship: "same_hash",
    mappingRequestId: "request-admission-map",
  }
  return {
    source,
    resultEnvelope,
    aliases: [alias],
    receiptId: `receipt-${created.summary.documentId}`,
    createdAt: migratedAt,
  } satisfies MigrateLocalMediaInput
}

const createFixture = async (suffix: string) => {
  const fixture = repository(suffix)
  const source = sourceSnapshot()
  const created = await fixture.value.create(source)
  if (!created.ok) throw new Error("Expected draft fixture creation")
  return {
    ...fixture,
    source,
    created,
    input: migrationFixture(created.record),
  }
}

const settleManagedUses = async (
  draftRepository: DocumentDraftRepository,
  receipt: LocalMediaAdmissionReceipt,
  suffix: string
) => {
  for (const [index, use] of receipt.managedUses.entries()) {
    const result = await draftRepository.markLocalMediaAdmissionManagedUse({
      receiptId: receipt.receiptId,
      assetId: use.assetId,
      idempotencyKey: use.idempotencyKey,
      requestId: `request-${suffix}-${index}`,
      usedAt: acknowledgedAt,
      assetRevision: index + 1,
    })
    if (!result.ok) throw new Error("Expected managed Recent use settlement")
  }
}

describe("DocumentDraftRepository local-media admission", () => {
  it("upgrades a version-1 database in place and adds only the receipt store and indexes", async () => {
    const fixture = repository("upgrade")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(fixture.databaseName, 1)
      request.onupgradeneeded = () => {
        const value = request.result
        value.createObjectStore("draft-body", { keyPath: "documentId" })
        value.createObjectStore("draft-meta", { keyPath: "documentId" })
        value.createObjectStore("draft-previews", { keyPath: "documentId" })
        value.createObjectStore("draft-quarantine", {
          keyPath: "quarantineId",
        })
        value.createObjectStore("draft-conflicts", { keyPath: "conflictId" })
        value.createObjectStore("repository-settings", { keyPath: "key" })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("repository-settings", "readwrite")
    const done = transactionDone(transaction)
    transaction.objectStore("repository-settings").put({
      key: "legacy-sentinel",
      value: "preserved",
    })
    await done
    database.close()

    expect(await fixture.value.open()).toEqual({
      ok: true,
      databaseName: fixture.databaseName,
      schemaVersion: 2,
    })
    const upgraded = await openDatabase(fixture.databaseName)
    expect(upgraded.version).toBe(2)
    expect(Array.from(upgraded.objectStoreNames)).toContain(
      "draft-media-migrations"
    )
    const receiptStore = upgraded
      .transaction("draft-media-migrations")
      .objectStore("draft-media-migrations")
    expect(Array.from(receiptStore.indexNames).sort()).toEqual([
      "acknowledgedAtCreatedAt",
      "documentIdCreatedAt",
    ])
    upgraded.close()
    expect(
      await readStore<Record<string, unknown>>(
        fixture.databaseName,
        "repository-settings",
        "legacy-sentinel"
      )
    ).toEqual({ key: "legacy-sentinel", value: "preserved" })
  })

  it("atomically migrates the exact head, invalidates its preview, stores the preimage, and replays once", async () => {
    const fixture = await createFixture("atomic")
    const preview = {
      schemaVersion: 1 as const,
      documentId: fixture.created.record.summary.documentId,
      contentSnapshotId: fixture.created.record.summary.contentSnapshotId,
      pageId: fixture.created.record.summary.firstPageId,
      rendererRevision: "renderer-media-admission",
      width: 100,
      height: 141,
      mimeType: "image/png" as const,
      byteLength: 1,
      createdAt,
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
    }
    const database = await openDatabase(fixture.databaseName)
    const previewTransaction = database.transaction(
      "draft-previews",
      "readwrite"
    )
    const previewDone = transactionDone(previewTransaction)
    previewTransaction.objectStore("draft-previews").put(preview)
    await previewDone
    database.close()

    const migrated = await fixture.value.migrateLocalMedia(fixture.input)
    expect(migrated).toMatchObject({
      ok: true,
      status: "migrated",
      record: {
        summary: {
          recordVersion: fixture.created.record.summary.recordVersion + 1,
        },
        envelope: {
          document: {
            nodes: expect.arrayContaining([
              expect.objectContaining({
                id: "admission-image",
                assetId: managedAssetId,
                src: managedSource,
              }),
            ]),
          },
        },
      },
      receipt: {
        source: fixture.input.source,
        aliases: fixture.input.aliases,
        preimage: fixture.created.record.envelope,
        managedUses: [
          {
            assetId: managedAssetId,
            idempotencyKey: expect.stringMatching(
              /^admission-use:[0-9a-f]{64}$/
            ),
            requestId: null,
            usedAt: null,
            assetRevision: null,
          },
        ],
      },
    })
    if (!migrated.ok) throw new Error("Expected media migration")
    expect(
      await readStore(
        fixture.databaseName,
        "draft-previews",
        fixture.source.document.id
      )
    ).toBeUndefined()
    expect(
      await fixture.value.getLocalMediaAdmissionReceipt(fixture.input.receiptId)
    ).toEqual({ ok: true, status: "found", receipt: migrated.receipt })
    expect(
      await fixture.value.getPendingLocalMediaAdmissionReceiptForDocument(
        fixture.source.document.id
      )
    ).toEqual({ ok: true, status: "found", receipt: migrated.receipt })

    const replayed = await fixture.value.migrateLocalMedia(fixture.input)
    expect(replayed).toMatchObject({
      ok: true,
      status: "replayed",
      record: {
        summary: { recordVersion: migrated.record.summary.recordVersion },
      },
      receipt: { receiptId: migrated.receipt.receiptId },
    })
    expect(
      (
        (await fixture.value.get(fixture.source.document.id)) as {
          ok: true
          status: "found"
          record: DocumentDraftRecord
        }
      ).record.summary.recordVersion
    ).toBe(migrated.record.summary.recordVersion)
  })

  it("returns stale and deleted heads without creating ordinary conflict rows or receipts", async () => {
    const stale = await createFixture("stale")
    const newer = await stale.value.save(
      {
        ...stale.source,
        document: {
          ...stale.source.document,
          name: "Newer head",
          revision: stale.source.document.revision + 1,
          updatedAt: migratedAt,
        },
      },
      stale.created.record.summary.recordVersion,
      stale.created.record.summary.draftSnapshotId
    )
    if (!newer.ok) throw new Error("Expected newer head")
    expect(await stale.value.migrateLocalMedia(stale.input)).toMatchObject({
      ok: false,
      reason: "stale_head",
      current: { recordVersion: newer.record.summary.recordVersion },
    })
    expect(
      await stale.value.getLocalMediaAdmissionReceipt(stale.input.receiptId)
    ).toEqual({ ok: true, status: "missing" })
    expect(await stale.value.listConflicts(stale.source.document.id)).toEqual({
      ok: true,
      value: [],
    })

    const deleted = await createFixture("deleted")
    expect(
      await deleted.value.softDelete(
        deleted.source.document.id,
        deleted.created.record.summary.recordVersion
      )
    ).toMatchObject({ ok: true })
    expect(await deleted.value.migrateLocalMedia(deleted.input)).toMatchObject({
      ok: false,
      reason: "deleted",
    })
  })

  it("records each managed Recent receipt once under its precommitted idempotency key", async () => {
    const fixture = await createFixture("managed-use")
    const migrated = await fixture.value.migrateLocalMedia(fixture.input)
    if (!migrated.ok) throw new Error("Expected media migration")
    const use = migrated.receipt.managedUses[0]
    const input = {
      receiptId: migrated.receipt.receiptId,
      assetId: use.assetId,
      idempotencyKey: use.idempotencyKey,
      requestId: "request-admission-used",
      usedAt: acknowledgedAt,
      assetRevision: 7,
    }
    const updated = await fixture.value.markLocalMediaAdmissionManagedUse(input)
    expect(updated).toMatchObject({
      ok: true,
      status: "updated",
      receipt: {
        managedUses: [
          {
            assetId: input.assetId,
            idempotencyKey: input.idempotencyKey,
            requestId: input.requestId,
            usedAt: input.usedAt,
            assetRevision: input.assetRevision,
          },
        ],
      },
    })
    expect(
      await fixture.value.markLocalMediaAdmissionManagedUse(input)
    ).toMatchObject({ ok: true, status: "replayed" })
    expect(
      await fixture.value.markLocalMediaAdmissionManagedUse({
        ...input,
        requestId: "request-different-use",
      })
    ).toMatchObject({ ok: false, reason: "validation_failed" })
    expect(
      await fixture.value.markLocalMediaAdmissionManagedUse({
        ...input,
        assetId: "asset-unrelated00001",
      })
    ).toEqual({ ok: false, reason: "asset_missing" })
  })

  it("keeps the admission receipt recoverable until every managed Recent use is durably settled", async () => {
    const fixture = await createFixture("unsettled-managed-use")
    const migrated = await fixture.value.migrateLocalMedia(fixture.input)
    if (!migrated.ok) throw new Error("Expected media migration")

    expect(
      await fixture.value.acknowledgeLocalMediaAdmissionReceipt(
        fixture.input.receiptId,
        acknowledgedAt
      )
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: {
        message:
          "Finish adding every recovered image to Recent before keeping this version.",
      },
    })
    expect(
      await fixture.value.getPendingLocalMediaAdmissionReceiptForDocument(
        fixture.source.document.id
      )
    ).toEqual({ ok: true, status: "found", receipt: migrated.receipt })

    const use = migrated.receipt.managedUses[0]
    expect(
      await fixture.value.markLocalMediaAdmissionManagedUse({
        receiptId: migrated.receipt.receiptId,
        assetId: use.assetId,
        idempotencyKey: use.idempotencyKey,
        requestId: "request-unsettled-managed-use",
        usedAt: acknowledgedAt,
        assetRevision: 7,
      })
    ).toMatchObject({ ok: true, status: "updated" })
    expect(
      await fixture.value.acknowledgeLocalMediaAdmissionReceipt(
        fixture.input.receiptId,
        acknowledgedAt
      )
    ).toMatchObject({
      ok: true,
      status: "acknowledged",
      receipt: { acknowledgedAt, preimage: null },
    })
  })

  it("blocks a second migration while a preimage is pending and refuses restore or acknowledgement after the head advances", async () => {
    const fixture = await createFixture("pending")
    const migrated = await fixture.value.migrateLocalMedia(fixture.input)
    if (!migrated.ok) throw new Error("Expected media migration")

    const secondInput = {
      ...fixture.input,
      receiptId: "receipt-second-admission",
      source: migrated.receipt.result,
    }
    expect(await fixture.value.migrateLocalMedia(secondInput)).toEqual({
      ok: false,
      reason: "receipt_pending",
      receipt: migrated.receipt,
    })

    const advanced = await fixture.value.save(
      {
        document: {
          ...migrated.record.envelope.document,
          name: "Edited after recovery",
          revision: migrated.record.envelope.document.revision + 1,
          updatedAt: restoredAt,
        },
        sourceContext: migrated.record.envelope.sourceContext,
        reviewJournal: migrated.record.envelope.reviewJournal,
        quotationRefresh: migrated.record.envelope.quotationRefresh,
      },
      migrated.record.summary.recordVersion,
      migrated.record.summary.draftSnapshotId
    )
    if (!advanced.ok) throw new Error("Expected advanced head")
    expect(
      await fixture.value.restoreLocalMediaAdmissionReceipt(
        fixture.input.receiptId,
        restoredAt
      )
    ).toMatchObject({
      ok: false,
      reason: "advanced_head",
      current: { recordVersion: advanced.record.summary.recordVersion },
    })
    await settleManagedUses(fixture.value, migrated.receipt, "advanced")
    expect(
      await fixture.value.acknowledgeLocalMediaAdmissionReceipt(
        fixture.input.receiptId,
        acknowledgedAt
      )
    ).toMatchObject({
      ok: true,
      status: "acknowledged",
      receipt: { acknowledgedAt, preimage: null },
    })
    await expect(
      fixture.value.get(fixture.source.document.id)
    ).resolves.toEqual({
      ok: true,
      status: "found",
      record: advanced.record,
    })
  })

  it("restores only the exact migration result and acknowledges by removing the duplicate preimage", async () => {
    const restoreFixture = await createFixture("restore")
    const migrated = await restoreFixture.value.migrateLocalMedia(
      restoreFixture.input
    )
    if (!migrated.ok) throw new Error("Expected media migration")
    const restored =
      await restoreFixture.value.restoreLocalMediaAdmissionReceipt(
        restoreFixture.input.receiptId,
        restoredAt
      )
    expect(restored).toMatchObject({
      ok: true,
      status: "restored",
      record: {
        summary: { recordVersion: migrated.record.summary.recordVersion + 1 },
        envelope: restoreFixture.created.record.envelope,
      },
      receipt: { restoredAt },
    })
    if (!restored.ok) throw new Error("Expected restored admission preimage")
    expect(
      await restoreFixture.value.restoreLocalMediaAdmissionReceipt(
        restoreFixture.input.receiptId,
        restoredAt
      )
    ).toMatchObject({ ok: true, status: "replayed" })
    expect(
      await restoreFixture.value.getPendingLocalMediaAdmissionReceiptForDocument(
        restoreFixture.source.document.id
      )
    ).toEqual({ ok: true, status: "found", receipt: restored.receipt })
    const secondInput = {
      ...migrationFixture(restored.record),
      receiptId: "receipt-after-restored-disposition",
      createdAt: acknowledgedAt,
    }
    expect(await restoreFixture.value.migrateLocalMedia(secondInput)).toEqual({
      ok: false,
      reason: "receipt_pending",
      receipt: restored.receipt,
    })
    expect(
      await restoreFixture.value.getLocalMediaAdmissionReceipt(
        secondInput.receiptId
      )
    ).toEqual({ ok: true, status: "missing" })
    expect(
      await restoreFixture.value.acknowledgeLocalMediaAdmissionReceipt(
        restoreFixture.input.receiptId,
        acknowledgedAt
      )
    ).toMatchObject({
      ok: true,
      status: "acknowledged",
      receipt: { acknowledgedAt, restoredAt, preimage: null },
    })
    expect(
      await restoreFixture.value.getLocalMediaAdmissionReceipt(
        restoreFixture.input.receiptId
      )
    ).toMatchObject({
      ok: true,
      status: "found",
      receipt: { acknowledgedAt, restoredAt, preimage: null },
    })

    const acknowledgeFixture = await createFixture("acknowledge")
    const acknowledgedMigration =
      await acknowledgeFixture.value.migrateLocalMedia(acknowledgeFixture.input)
    if (!acknowledgedMigration.ok) throw new Error("Expected media migration")
    await settleManagedUses(
      acknowledgeFixture.value,
      acknowledgedMigration.receipt,
      "acknowledge"
    )
    const acknowledged =
      await acknowledgeFixture.value.acknowledgeLocalMediaAdmissionReceipt(
        acknowledgeFixture.input.receiptId,
        acknowledgedAt
      )
    expect(acknowledged).toMatchObject({
      ok: true,
      status: "acknowledged",
      receipt: { acknowledgedAt, preimage: null },
    })
    expect(
      await acknowledgeFixture.value.getPendingLocalMediaAdmissionReceiptForDocument(
        acknowledgeFixture.source.document.id
      )
    ).toEqual({ ok: true, status: "missing" })
    expect(
      await acknowledgeFixture.value.restoreLocalMediaAdmissionReceipt(
        acknowledgeFixture.input.receiptId,
        restoredAt
      )
    ).toEqual({ ok: false, reason: "preimage_unavailable" })
    expect(
      await acknowledgeFixture.value.acknowledgeLocalMediaAdmissionReceipt(
        acknowledgeFixture.input.receiptId,
        acknowledgedAt
      )
    ).toMatchObject({ ok: true, status: "replayed" })
  })

  it("acknowledges an abort before opening storage and leaves the exact source untouched", async () => {
    const fixture = await createFixture("abort")
    const controller = new AbortController()
    controller.abort(new DOMException("Superseded", "AbortError"))
    await expect(
      fixture.value.migrateLocalMedia(fixture.input, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(await fixture.value.get(fixture.source.document.id)).toEqual({
      ok: true,
      status: "found",
      record: fixture.created.record,
    })
    expect(
      await fixture.value.getLocalMediaAdmissionReceipt(fixture.input.receiptId)
    ).toEqual({ ok: true, status: "missing" })
  })

  it("retains only the newest 32 acknowledged metadata receipts without touching a pending preimage", async () => {
    const fixture = repository("retention")
    const receiptIds: string[] = []
    for (let index = 0; index < 33; index += 1) {
      const documentId = `document-retention-${String(index).padStart(2, "0")}`
      const source = sourceSnapshot(documentId)
      const created = await fixture.value.create(source)
      if (!created.ok) throw new Error("Expected retention fixture creation")
      const input = {
        ...migrationFixture(created.record),
        receiptId: `receipt-retention-${String(index).padStart(2, "0")}`,
        createdAt: new Date(
          Date.parse(migratedAt) + index * 1_000
        ).toISOString(),
      }
      const migrated = await fixture.value.migrateLocalMedia(input)
      if (!migrated.ok) throw new Error("Expected retention migration")
      await settleManagedUses(
        fixture.value,
        migrated.receipt,
        `retention-${index}`
      )
      const acknowledged =
        await fixture.value.acknowledgeLocalMediaAdmissionReceipt(
          input.receiptId,
          new Date(Date.parse(acknowledgedAt) + index * 1_000).toISOString()
        )
      if (!acknowledged.ok) throw new Error("Expected receipt acknowledgement")
      receiptIds.push(input.receiptId)
    }
    expect(
      await fixture.value.getLocalMediaAdmissionReceipt(receiptIds[0])
    ).toEqual({ ok: true, status: "missing" })
    expect(
      await fixture.value.getLocalMediaAdmissionReceipt(receiptIds[1])
    ).toMatchObject({
      ok: true,
      status: "found",
      receipt: { preimage: null },
    })

    const pendingSource = sourceSnapshot("document-retention-pending")
    const pendingCreated = await fixture.value.create(pendingSource)
    if (!pendingCreated.ok) throw new Error("Expected pending fixture creation")
    const pendingInput = migrationFixture(pendingCreated.record)
    const pending = await fixture.value.migrateLocalMedia(pendingInput)
    if (!pending.ok) throw new Error("Expected pending migration")
    expect(
      await fixture.value.getPendingLocalMediaAdmissionReceiptForDocument(
        pendingSource.document.id
      )
    ).toEqual({ ok: true, status: "found", receipt: pending.receipt })
  })

  for (const [storeName, method] of [
    ["draft-body", "put"],
    ["draft-meta", "put"],
    ["draft-previews", "delete"],
    ["draft-media-migrations", "put"],
  ] as const) {
    it(`rolls back the body, metadata, preview, and receipt when ${storeName}.${method} fails`, async () => {
      const fixture = await createFixture(`rollback-${storeName}`)
      const preview = {
        schemaVersion: 1,
        documentId: fixture.source.document.id,
        marker: "keep-preview",
      }
      const database = await openDatabase(fixture.databaseName)
      const previewTransaction = database.transaction(
        "draft-previews",
        "readwrite"
      )
      const previewDone = transactionDone(previewTransaction)
      previewTransaction.objectStore("draft-previews").put(preview)
      await previewDone
      database.close()
      const bodyBefore = await readStore(
        fixture.databaseName,
        "draft-body",
        fixture.source.document.id
      )
      const metadataBefore = await readStore(
        fixture.databaseName,
        "draft-meta",
        fixture.source.document.id
      )

      const descriptor =
        method === "put"
          ? objectStorePutDescriptor
          : objectStoreDeleteDescriptor
      const original = descriptor.value as (...args: unknown[]) => IDBRequest
      let injected = false
      Object.defineProperty(IDBObjectStore.prototype, method, {
        ...descriptor,
        value: function (this: IDBObjectStore, ...args: unknown[]) {
          if (!injected && this.name === storeName) {
            injected = true
            throw new DOMException(
              "Injected admission failure",
              "QuotaExceededError"
            )
          }
          return original.apply(this, args)
        },
      })

      expect(
        await fixture.value.migrateLocalMedia(fixture.input)
      ).toMatchObject({
        ok: false,
        reason: "storage_unavailable",
      })
      Object.defineProperty(IDBObjectStore.prototype, method, descriptor)
      expect(
        await readStore(
          fixture.databaseName,
          "draft-body",
          fixture.source.document.id
        )
      ).toEqual(bodyBefore)
      expect(
        await readStore(
          fixture.databaseName,
          "draft-meta",
          fixture.source.document.id
        )
      ).toEqual(metadataBefore)
      expect(
        await readStore(
          fixture.databaseName,
          "draft-previews",
          fixture.source.document.id
        )
      ).toEqual(preview)
      expect(
        await fixture.value.getLocalMediaAdmissionReceipt(
          fixture.input.receiptId
        )
      ).toEqual({ ok: true, status: "missing" })
    })
  }
})
