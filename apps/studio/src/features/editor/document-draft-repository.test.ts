import "fake-indexeddb/auto"
import {
  builtInDesignTemplateRepository,
  fitPageThumbnailSize,
} from "@webmcp/document"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  CurrentDraftSnapshot,
  CurrentDraftSourceContext,
} from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import type {
  DocumentDraftConflict,
  DocumentDraftPreview,
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DraftPreviewIdentity,
  DraftRepositoryEvent,
  DraftListResult,
} from "./document-draft-repository"
import {
  DRAFT_MAX_ENCODED_BYTES,
  prepareDraftAdmission,
} from "./draft-admission"
import {
  createEmptyReviewJournal,
  createReviewProposal,
} from "./review-journal"
import type { ChangeSet } from "@webmcp/document"

const STORE_NAMES = [
  "draft-body",
  "draft-conflicts",
  "draft-media-migrations",
  "draft-meta",
  "draft-previews",
  "draft-quarantine",
  "repository-settings",
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const BODY_KEYS = [
  "contentSnapshotId",
  "document",
  "documentId",
  "draftSnapshotId",
  "encodedByteLength",
  "recordVersion",
  "reviewJournal",
  "schemaVersion",
  "sourceContext",
] as const

const META_KEYS = [
  "activityAt",
  "contentSnapshotId",
  "createdAt",
  "deletedAt",
  "documentId",
  "documentRevision",
  "draftSnapshotId",
  "encodedByteLength",
  "exportFormats",
  "firstPageHeight",
  "firstPageId",
  "firstPageName",
  "firstPageWidth",
  "lastOpenedAt",
  "lastPublished",
  "name",
  "origin",
  "outputCount",
  "pageCount",
  "recordVersion",
  "savedAt",
  "schemaVersion",
  "sourceKind",
] as const

let databaseSequence = 0
const databaseNames: string[] = []

const snapshot = (
  name = "Editorial draft",
  id = "document-editorial-draft"
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

const snapshotWith = (
  current: CurrentDraftSnapshot,
  changes: {
    name?: string
    revision?: number
    quotationTemplateId?: CurrentDraftSourceContext["quotationTemplateId"]
  }
): CurrentDraftSnapshot => ({
  document: {
    ...current.document,
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(changes.revision === undefined ? {} : { revision: changes.revision }),
  },
  sourceContext: current.sourceContext
    ? {
        ...current.sourceContext,
        quotationTemplateId:
          changes.quotationTemplateId ??
          current.sourceContext.quotationTemplateId,
      }
    : null,
})

const snapshotWithReview = (
  current: CurrentDraftSnapshot
): CurrentDraftSnapshot => {
  const node = current.document.nodes[0]
  const changeSet: ChangeSet = {
    id: "review-repository-roundtrip",
    documentId: current.document.id,
    baseRevision: current.document.revision,
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
  return {
    ...current,
    reviewJournal: createReviewProposal(
      createEmptyReviewJournal(),
      current.document,
      changeSet,
      {
        source: "webmcp",
        actorLabel: "WebMCP agent",
        toolName: "execute_product_command",
        reason: "Make the layer easier to identify",
        requestId: "request-review-roundtrip",
      }
    ),
  }
}

const createRepository = (
  times: readonly string[],
  options: {
    databaseName?: string
    sessionId?: string
    indexedDB?: IDBFactory
  } = {}
) => {
  const databaseName =
    options.databaseName ?? `webmcp-studio-documents-test-${databaseSequence++}`
  if (!databaseNames.includes(databaseName)) databaseNames.push(databaseName)
  let timeIndex = 0
  let idIndex = 0
  return {
    databaseName,
    repository: new DocumentDraftRepository({
      databaseName,
      indexedDB: options.indexedDB ?? indexedDB,
      now: () =>
        times[Math.min(timeIndex++, times.length - 1)] ??
        "2026-08-28T00:00:00.000Z",
      createId: () => `generated-${++idIndex}`,
      sessionId: options.sessionId,
    }),
  }
}

const establishStaleConflict = async (
  repository: DocumentDraftRepository,
  initial: CurrentDraftSnapshot,
  candidate: CurrentDraftSnapshot
) => {
  const created = await repository.create(initial)
  if (!created.ok) throw new Error("Expected a created draft")
  const committed = await repository.save(
    snapshotWith(initial, { name: "Committed head", revision: 2 }),
    created.record.summary.recordVersion,
    created.record.summary.draftSnapshotId
  )
  if (!committed.ok) throw new Error("Expected a committed head")
  const stale = await repository.save(
    candidate,
    created.record.summary.recordVersion,
    created.record.summary.draftSnapshotId
  )
  if (stale.ok || stale.reason !== "conflict") {
    throw new Error("Expected a stale conflict candidate")
  }
  return { created, committed, conflict: stale.conflict }
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
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
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

const readAllStoreValues = async <T>(
  databaseName: string,
  storeName: string
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName)
    const done = transactionDone(transaction)
    const values = await requestResult<T[]>(
      transaction.objectStore(storeName).getAll()
    )
    await done
    return values
  } finally {
    database.close()
  }
}

const putStoreValue = async (
  databaseName: string,
  storeName: string,
  value: unknown
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName, "readwrite")
    const done = transactionDone(transaction)
    transaction.objectStore(storeName).put(value)
    await done
  } finally {
    database.close()
  }
}

const putStoreValues = async (
  databaseName: string,
  storeName: string,
  values: readonly unknown[]
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName, "readwrite")
    const done = transactionDone(transaction)
    const store = transaction.objectStore(storeName)
    for (const value of values) store.put(value)
    await done
  } finally {
    database.close()
  }
}

const deleteStoreValue = async (
  databaseName: string,
  storeName: string,
  key: IDBValidKey
) => {
  const database = await openDatabase(databaseName)
  try {
    const transaction = database.transaction(storeName, "readwrite")
    const done = transactionDone(transaction)
    transaction.objectStore(storeName).delete(key)
    await done
  } finally {
    database.close()
  }
}

const legacyRichTextPair = async (
  record: DocumentDraftRecord,
  snapshotValue: CurrentDraftSnapshot
) => {
  const document = structuredClone(snapshotValue.document) as any
  document.schemaVersion = 2
  delete document.typographyStyles
  delete document.paintStyles
  delete document.variables
  for (const node of document.nodes) {
    if (node.type !== "text") continue
    delete node.runs
    delete node.paragraphs
    delete node.links
  }
  return {
    body: {
      schemaVersion: 1,
      documentId: document.id,
      recordVersion: record.summary.recordVersion,
      contentSnapshotId: record.summary.contentSnapshotId,
      draftSnapshotId: record.summary.draftSnapshotId,
      encodedByteLength: record.summary.encodedByteLength,
      document,
      sourceContext: snapshotValue.sourceContext,
    },
    metadata: {
      ...record.summary,
      contentSnapshotId: record.summary.contentSnapshotId,
      draftSnapshotId: record.summary.draftSnapshotId,
      encodedByteLength: record.summary.encodedByteLength,
    },
  }
}

const pngBlob = (bytes = [137, 80, 78, 71]) =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" })

const unwrapFound = (result: DocumentDraftReadResult): DocumentDraftRecord => {
  if (!result.ok)
    throw new Error(`Expected a readable draft: ${result.failure.message}`)
  if (result.status === "missing") throw new Error("Expected a stored draft")
  return result.record
}

const expectedHeadFor = (record: DocumentDraftRecord) => ({
  status: "found" as const,
  recordVersion: record.summary.recordVersion,
  contentSnapshotId: record.summary.contentSnapshotId,
  draftSnapshotId: record.summary.draftSnapshotId,
  deletedAt: record.summary.deletedAt,
})

const unwrapList = (result: DraftListResult) => {
  if (!result.ok)
    throw new Error(`Expected a draft list: ${result.failure.message}`)
  return result.page
}

const validPreview = (
  snapshotValue: CurrentDraftSnapshot,
  summary: {
    documentId: string
    contentSnapshotId: string
    firstPageId: string
  }
): Omit<DocumentDraftPreview, "schemaVersion" | "createdAt"> => {
  const firstPage = snapshotValue.document.pages.find(
    (page) => page.id === summary.firstPageId
  )!
  const size = fitPageThumbnailSize(firstPage, {
    maxWidth: 124,
    maxHeight: 175,
  })
  const blob = pngBlob()
  return {
    documentId: summary.documentId,
    contentSnapshotId: summary.contentSnapshotId,
    pageId: summary.firstPageId,
    rendererRevision: "renderer-v1",
    ...size,
    mimeType: "image/png",
    byteLength: blob.size,
    blob,
  }
}

const previewIdentity = (
  preview: Omit<DocumentDraftPreview, "schemaVersion" | "createdAt">,
  summary: {
    recordVersion: number
    firstPageWidth: number
    firstPageHeight: number
  }
): DraftPreviewIdentity => ({
  documentId: preview.documentId,
  recordVersion: summary.recordVersion,
  contentSnapshotId: preview.contentSnapshotId,
  pageId: preview.pageId,
  pageWidth: summary.firstPageWidth,
  pageHeight: summary.firstPageHeight,
  rendererRevision: preview.rendererRevision,
  width: preview.width,
  height: preview.height,
})

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

describe("DocumentDraftRepository", () => {
  it("atomically upgrades a stored schema-v2 document instead of quarantining it", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const legacy = await legacyRichTextPair(created.record, initial)
    await putStoreValue(databaseName, "draft-body", legacy.body)
    await putStoreValue(databaseName, "draft-meta", legacy.metadata)

    const opened = unwrapFound(await repository.get(initial.document.id))

    expect(opened.summary.recordVersion).toBe(2)
    expect(opened.envelope.document).toMatchObject({
      schemaVersion: 3,
      typographyStyles: [],
      paintStyles: [],
      variables: [],
    })
    expect(
      opened.envelope.document.nodes
        .filter((node) => node.type === "text")
        .every(
          (node) =>
            Array.isArray(node.runs) &&
            Array.isArray(node.paragraphs) &&
            Array.isArray(node.links)
        )
    ).toBe(true)
    expect(await repository.listQuarantine(initial.document.id)).toEqual({
      ok: true,
      value: [],
    })
  })

  it("restores a schema-v2 document already quarantined by the v3 rollout", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const legacy = await legacyRichTextPair(created.record, initial)
    const quarantineId = "quarantine-schema-v2-rollout"
    await putStoreValue(databaseName, "draft-quarantine", {
      schemaVersion: 1,
      quarantineId,
      documentId: initial.document.id,
      detectedAt: "2026-08-28T12:00:30.000Z",
      failure: {
        store: "paired-record",
        key: initial.document.id,
        code: "integrity_mismatch",
        message:
          "The draft body does not match its stored content snapshot hash.",
      },
      body: legacy.body,
      metadata: legacy.metadata,
      activeRowsRemoved: true,
    })
    await deleteStoreValue(databaseName, "draft-body", initial.document.id)
    await deleteStoreValue(databaseName, "draft-meta", initial.document.id)

    const opened = unwrapFound(await repository.get(initial.document.id))

    expect(opened.summary.recordVersion).toBe(2)
    expect(opened.envelope.document.schemaVersion).toBe(3)
    expect(await repository.getQuarantine(quarantineId)).toEqual({
      ok: false,
      reason: "missing",
    })
  })

  it("creates the exact v2 stores and an atomic metadata/body pair", async () => {
    const initial = snapshot()
    const prepared = await prepareDraftAdmission(initial)
    if (!prepared.ok) throw new Error("Expected a valid draft admission")
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
    ])

    const created = await repository.create(initial, {
      kind: "template",
      templateId: "editorial-one-pager",
      templateVersion: 1,
    })
    if (!created.ok) throw new Error("Expected a created draft")

    const database = await openDatabase(databaseName)
    expect(Array.from(database.objectStoreNames).sort()).toEqual(STORE_NAMES)
    database.close()

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
    expect(Object.keys(body).sort()).toEqual(BODY_KEYS)
    expect(Object.keys(metadata).sort()).toEqual(META_KEYS)
    expect(body).toMatchObject({
      schemaVersion: 1,
      documentId: initial.document.id,
      recordVersion: 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      encodedByteLength: prepared.encodedByteLength,
      document: { id: initial.document.id, name: "Editorial draft" },
      sourceContext: initial.sourceContext,
    })
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      documentId: initial.document.id,
      recordVersion: 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      encodedByteLength: prepared.encodedByteLength,
      documentRevision: initial.document.revision,
      origin: {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      },
      deletedAt: null,
      lastPublished: null,
    })
  })

  it("links publication to the exact head without changing body or save identity", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      ["2026-08-28T12:00:00.000Z"],
      { sessionId: "publication-link" }
    )
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
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
    const events: unknown[] = []
    repository.subscribe((event) => events.push(event))

    const linked = await repository.linkPublication({
      documentId: initial.document.id,
      recordVersion: created.record.summary.recordVersion,
      contentSnapshotId: created.record.summary.contentSnapshotId,
      templateId: "template-editorial",
      templateVersionId: "template-version-editorial-4",
      templateVersion: 4,
      publishedAt: "2026-08-28T12:05:00.000Z",
    })

    expect(linked).toMatchObject({
      ok: true,
      status: "linked",
      summary: {
        recordVersion: created.record.summary.recordVersion,
        contentSnapshotId: created.record.summary.contentSnapshotId,
        savedAt: created.record.summary.savedAt,
        activityAt: created.record.summary.activityAt,
        lastPublished: {
          templateId: "template-editorial",
          templateVersionId: "template-version-editorial-4",
          templateVersion: 4,
          contentSnapshotId: created.record.summary.contentSnapshotId,
          publishedAt: "2026-08-28T12:05:00.000Z",
        },
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(bodyBefore)
    const metadataAfter = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )
    expect({ ...metadataAfter, lastPublished: null }).toEqual(metadataBefore)
    expect(
      unwrapFound(await repository.get(initial.document.id)).summary
    ).toEqual(
      expect.objectContaining({
        lastPublished: expect.objectContaining({
          templateVersionId: "template-version-editorial-4",
        }),
      })
    )
    expect(events).toEqual([
      {
        type: "saved",
        reason: "publication_linked",
        documentId: initial.document.id,
        recordVersion: created.record.summary.recordVersion,
        contentSnapshotId: created.record.summary.contentSnapshotId,
        draftSnapshotId: created.record.summary.draftSnapshotId,
        sessionId: "publication-link",
      },
    ])
  })

  it("does not link a publication after a newer local head commits", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const saved = await repository.save(
      snapshotWith(initial, { name: "Newer local head", revision: 1 }),
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    if (!saved.ok) throw new Error("Expected a newer saved head")
    const events: unknown[] = []
    repository.subscribe((event) => events.push(event))
    const bodyBefore = await readStoreValue(
      databaseName,
      "draft-body",
      initial.document.id
    )
    const metadataBefore = await readStoreValue(
      databaseName,
      "draft-meta",
      initial.document.id
    )

    expect(
      await repository.linkPublication({
        documentId: initial.document.id,
        recordVersion: created.record.summary.recordVersion,
        contentSnapshotId: created.record.summary.contentSnapshotId,
        templateId: "template-editorial",
        templateVersionId: "template-version-stale",
        templateVersion: 2,
        publishedAt: "2026-08-28T12:05:00.000Z",
      })
    ).toMatchObject({
      ok: false,
      reason: "stale_head",
      current: {
        recordVersion: saved.record.summary.recordVersion,
        contentSnapshotId: saved.record.summary.contentSnapshotId,
        lastPublished: null,
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(bodyBefore)
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toEqual(metadataBefore)
    expect(events).toEqual([])
  })

  it("returns typed missing, deleted, corrupt, and unavailable publication results", async () => {
    const initial = snapshot()
    const missing = createRepository([]).repository
    const publication = {
      documentId: initial.document.id,
      recordVersion: 1,
      contentSnapshotId: `sha256-${"a".repeat(64)}`,
      templateId: "template-editorial",
      templateVersionId: "template-version-editorial-1",
      templateVersion: 1,
      publishedAt: "2026-08-28T12:05:00.000Z",
    }
    expect(await missing.linkPublication(publication)).toEqual({
      ok: false,
      reason: "missing",
    })

    const deletedFixture = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const deletedCreated = await deletedFixture.repository.create(initial)
    if (!deletedCreated.ok) throw new Error("Expected a created draft")
    await deletedFixture.repository.softDelete(initial.document.id, 1)
    expect(
      await deletedFixture.repository.linkPublication({
        ...publication,
        contentSnapshotId: deletedCreated.record.summary.contentSnapshotId,
      })
    ).toMatchObject({
      ok: false,
      reason: "deleted",
      current: { deletedAt: expect.any(String) },
    })

    const corruptFixture = createRepository(["2026-08-28T12:00:00.000Z"])
    const corruptCreated = await corruptFixture.repository.create(initial)
    if (!corruptCreated.ok) throw new Error("Expected a created draft")
    const corruptMetadata = await readStoreValue<Record<string, unknown>>(
      corruptFixture.databaseName,
      "draft-meta",
      initial.document.id
    )
    await putStoreValue(corruptFixture.databaseName, "draft-meta", {
      ...corruptMetadata,
      lastPublished: { templateId: "incomplete" },
    })
    expect(
      await corruptFixture.repository.linkPublication({
        ...publication,
        contentSnapshotId: corruptCreated.record.summary.contentSnapshotId,
      })
    ).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      quarantineId: expect.any(String),
      failure: { kind: "corrupt_record" },
    })

    const unavailable = new DocumentDraftRepository({
      indexedDB: {
        open: () => {
          throw new DOMException("Storage denied", "SecurityError")
        },
      } as unknown as IDBFactory,
    })
    expect(await unavailable.linkPublication(publication)).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
      failure: { kind: "storage_unavailable" },
    })
  })

  it("rejects malformed publication links without opening storage or throwing", async () => {
    let opened = false
    const repository = new DocumentDraftRepository({
      indexedDB: {
        open: () => {
          opened = true
          throw new Error("must not open")
        },
      } as unknown as IDBFactory,
    })
    const valid = {
      documentId: "document-editorial-draft",
      recordVersion: 1,
      contentSnapshotId: `sha256-${"a".repeat(64)}`,
      templateId: "template-editorial",
      templateVersionId: "template-version-editorial-1",
      templateVersion: 1,
      publishedAt: "2026-08-28T12:05:00.000Z",
    }
    const malformed: unknown[] = [
      null,
      {},
      { ...valid, documentId: "" },
      { ...valid, recordVersion: 0 },
      { ...valid, contentSnapshotId: `sha256-${"A".repeat(64)}` },
      { ...valid, templateId: " " },
      { ...valid, templateVersionId: "" },
      { ...valid, templateVersion: 1.5 },
      { ...valid, publishedAt: "not-a-time" },
    ]

    for (const input of malformed) {
      await expect(
        repository.linkPublication(input as never)
      ).resolves.toMatchObject({
        ok: false,
        reason: "validation_failed",
        failure: { kind: "validation_failed" },
      })
    }
    expect(opened).toBe(false)
  })

  it("reopens records from another repository instance and paginates recents without body reads", async () => {
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T12:00:00.000Z",
        "2026-08-28T12:01:00.000Z",
        "2026-08-28T12:02:00.000Z",
      ],
      { sessionId: "session-a" }
    )
    await repository.create(snapshot("First", "document-first"))
    await repository.create(snapshot("Second", "document-second"))
    await repository.create(snapshot("Third", "document-third"))

    const reopened = createRepository([], {
      databaseName,
      sessionId: "session-b",
    }).repository
    expect(
      unwrapFound(await reopened.get("document-second")).envelope.document.name
    ).toBe("Second")

    const firstPage = unwrapList(await reopened.list({ limit: 2 }))
    expect(firstPage.items.map((item) => item.documentId)).toEqual([
      "document-third",
      "document-second",
    ])
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    if (!firstPage.nextCursor) throw new Error("Expected a continuation cursor")

    const secondPage = unwrapList(
      await reopened.list({
        limit: 2,
        cursor: firstPage.nextCursor,
      })
    )
    expect(secondPage.items.map((item) => item.documentId)).toEqual([
      "document-first",
    ])
    expect(secondPage.nextCursor).toBeNull()
  })

  it("keeps content and draft snapshot identities separate for a source-context-only save", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const events: unknown[] = []
    repository.subscribe((event) => events.push(event))

    const sourceOnlyChange = snapshotWith(initial, {
      quotationTemplateId: "midnight-film",
    })
    const saved = await repository.save(
      sourceOnlyChange,
      1,
      created.record.summary.draftSnapshotId
    )
    if (!saved.ok) throw new Error("Expected a saved draft")

    expect(saved.unchanged).toBe(false)
    expect(saved.record.summary.recordVersion).toBe(2)
    expect(saved.record.summary.contentSnapshotId).toBe(
      created.record.summary.contentSnapshotId
    )
    expect(saved.record.summary.draftSnapshotId).not.toBe(
      created.record.summary.draftSnapshotId
    )
    expect(saved.record.summary.encodedByteLength).not.toBe(
      created.record.summary.encodedByteLength
    )
    expect(events).toEqual([
      {
        type: "saved",
        reason: "content_saved",
        documentId: initial.document.id,
        recordVersion: saved.record.summary.recordVersion,
        contentSnapshotId: saved.record.summary.contentSnapshotId,
        draftSnapshotId: saved.record.summary.draftSnapshotId,
        sessionId: repository.sessionId,
      },
    ])
  })

  it("round-trips review provenance without changing content identity", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")

    const reviewed = snapshotWithReview(initial)
    const saved = await repository.save(
      reviewed,
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    if (!saved.ok) throw new Error("Expected a saved review journal")

    expect(saved.record.summary.contentSnapshotId).toBe(
      created.record.summary.contentSnapshotId
    )
    expect(saved.record.summary.draftSnapshotId).not.toBe(
      created.record.summary.draftSnapshotId
    )
    expect(
      saved.record.envelope.reviewJournal?.pending?.provenance
    ).toMatchObject({
      toolName: "execute_product_command",
      requestId: "request-review-roundtrip",
    })

    const reopened = await repository.get(initial.document.id)
    expect(reopened).toMatchObject({
      ok: true,
      status: "found",
      record: {
        envelope: {
          reviewJournal: {
            pending: {
              provenance: { toolName: "execute_product_command" },
            },
          },
        },
      },
    })
  })

  it("advances recordVersion when a valid save rewinds document.revision", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
      "2026-08-28T12:02:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")

    const forward = await repository.save(
      snapshotWith(initial, { name: "Forward edit", revision: 9 }),
      1,
      created.record.summary.draftSnapshotId
    )
    if (!forward.ok) throw new Error("Expected the forward save")
    const rewound = await repository.save(
      snapshotWith(initial, { name: "Undo result", revision: 2 }),
      2,
      forward.record.summary.draftSnapshotId
    )
    if (!rewound.ok) throw new Error("Expected the rewind save")

    expect(rewound.record.summary).toMatchObject({
      name: "Undo result",
      documentRevision: 2,
      recordVersion: 3,
    })
  })

  it("retains the latest same-session stale candidate and independent tab conflicts", async () => {
    const initial = snapshot()
    const { databaseName, repository: tabA } = createRepository(
      [
        "2026-08-28T12:00:00.000Z",
        "2026-08-28T12:01:00.000Z",
        "2026-08-28T12:02:00.000Z",
        "2026-08-28T12:03:00.000Z",
      ],
      { sessionId: "tab-a" }
    )
    const tabB = createRepository(["2026-08-28T12:04:00.000Z"], {
      databaseName,
      sessionId: "tab-b",
    }).repository
    const created = await tabA.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    await tabA.save(
      snapshotWith(initial, { name: "Committed" }),
      1,
      created.record.summary.draftSnapshotId
    )

    await tabA.save(
      snapshotWith(initial, { name: "First stale candidate" }),
      1,
      created.record.summary.draftSnapshotId
    )
    const sameSessionLatest = await tabA.save(
      snapshotWith(initial, { name: "Latest stale candidate" }),
      1,
      created.record.summary.draftSnapshotId
    )
    const otherTab = await tabB.save(
      snapshotWith(initial, { name: "Other tab candidate" }),
      1,
      created.record.summary.draftSnapshotId
    )

    expect(sameSessionLatest).toMatchObject({
      ok: false,
      reason: "conflict",
      conflict: {
        sessionId: "tab-a",
        expectedRecordVersion: 1,
        observedRecordVersion: 2,
        baseDraftSnapshotId: created.record.summary.draftSnapshotId,
        candidate: { document: { name: "Latest stale candidate" } },
        reason: "stale_write",
      },
    })
    expect(otherTab).toMatchObject({
      ok: false,
      reason: "conflict",
      conflict: {
        sessionId: "tab-b",
        baseDraftSnapshotId: created.record.summary.draftSnapshotId,
        candidate: { document: { name: "Other tab candidate" } },
      },
    })
    const conflictsResult = await tabA.listConflicts(initial.document.id)
    expect(conflictsResult).toMatchObject({ ok: true })
    if (!conflictsResult.ok) throw new Error("Expected readable conflicts")
    const conflicts = conflictsResult.value
    expect(conflicts).toHaveLength(2)
    expect(
      conflicts.map((conflict) => conflict.candidate.document.name).sort()
    ).toEqual(["Latest stale candidate", "Other tab candidate"])
    const currentHead = expectedHeadFor(
      unwrapFound(await tabA.get(initial.document.id))
    )

    const resolved = await tabA.resolveConflict(
      conflicts[0].conflictId,
      "reload_saved",
      conflicts[0].candidateDraftSnapshotId,
      currentHead
    )
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        conflictId: conflicts[0].conflictId,
        resolvedAt: expect.any(String),
        resolution: "reload_saved",
      },
    })
    expect(
      await tabA.resolveConflict(
        "missing-conflict",
        "reload_saved",
        conflicts[0].candidateDraftSnapshotId,
        currentHead
      )
    ).toEqual({ ok: false, reason: "missing" })
    expect(unwrapFound(await tabA.get(initial.document.id)).summary.name).toBe(
      "Committed"
    )
  })

  it("atomically saves the exact admitted conflict candidate as a canonical copy and publishes ordered events", async () => {
    const initial = snapshot()
    const candidate = snapshotWith(initial, {
      name: "Stale candidate",
      revision: 7,
      quotationTemplateId: "midnight-film",
    })
    const copyTime = "2026-08-28T12:03:00.000Z"
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T12:00:00.000Z",
        "2026-08-28T12:01:00.000Z",
        "2026-08-28T12:02:00.000Z",
        copyTime,
      ],
      { sessionId: "tab-copy" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      candidate
    )
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))

    const result = await repository.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-recovered-copy",
      name: "  Recovered candidate  ",
    })

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      record: {
        summary: {
          documentId: "document-recovered-copy",
          name: "Recovered candidate",
          recordVersion: 1,
          documentRevision: 0,
          createdAt: copyTime,
          savedAt: copyTime,
          lastOpenedAt: copyTime,
          activityAt: copyTime,
          deletedAt: null,
          origin: {
            kind: "duplicate",
            sourceDocumentId: initial.document.id,
          },
          lastPublished: null,
        },
      },
      conflict: {
        conflictId: conflict.conflictId,
        resolution: "save_copy",
        resolvedAt: copyTime,
        resolutionDocumentId: "document-recovered-copy",
      },
    })
    if (!result.ok) throw new Error("Expected an atomic conflict copy")
    expect(result.record.envelope).toEqual({
      schemaVersion: 1,
      document: {
        ...structuredClone(candidate.document),
        id: "document-recovered-copy",
        name: "Recovered candidate",
        revision: 0,
        createdAt: copyTime,
        updatedAt: copyTime,
      },
      sourceContext: structuredClone(candidate.sourceContext),
    })
    expect(
      unwrapFound(await repository.get("document-recovered-copy"))
    ).toEqual(result.record)
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(result.conflict)
    expect(
      await readStoreValue(
        databaseName,
        "draft-previews",
        "document-recovered-copy"
      )
    ).toBeUndefined()
    expect(events).toEqual([
      {
        type: "saved",
        reason: "content_saved",
        documentId: "document-recovered-copy",
        recordVersion: 1,
        contentSnapshotId: result.record.summary.contentSnapshotId,
        draftSnapshotId: result.record.summary.draftSnapshotId,
        sessionId: repository.sessionId,
      },
      {
        type: "conflict_resolved",
        conflictId: conflict.conflictId,
        documentId: initial.document.id,
        resolution: "save_copy",
        resolutionDocumentId: "document-recovered-copy",
        sessionId: repository.sessionId,
      },
    ])
  })

  it("returns typed missing and stale conflict results without creating a target", async () => {
    const initial = snapshot()
    const { repository } = createRepository(
      [
        "2026-08-28T12:05:00.000Z",
        "2026-08-28T12:06:00.000Z",
        "2026-08-28T12:07:00.000Z",
      ],
      { sessionId: "typed-results" }
    )
    const missingSnapshotId = `sha256-${"0".repeat(64)}`
    expect(
      await repository.saveConflictAsCopy({
        conflictId: "missing-conflict",
        expectedCandidateDraftSnapshotId: missingSnapshotId,
        newDocumentId: "document-missing-copy",
      })
    ).toEqual({ ok: false, reason: "missing_conflict" })

    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Stale identity candidate" })
    )
    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: missingSnapshotId,
        newDocumentId: "document-stale-copy",
      })
    ).toEqual({
      ok: false,
      reason: "stale_conflict",
      current: conflict,
    })
    expect(await repository.get("document-stale-copy")).toEqual({
      ok: true,
      status: "missing",
    })
  })

  it("rejects a candidate replaced between conflict-copy preflight and the atomic transaction", async () => {
    const initial = snapshot()
    const { databaseName, repository: creator } = createRepository(
      [
        "2026-08-28T12:08:00.000Z",
        "2026-08-28T12:09:00.000Z",
        "2026-08-28T12:10:00.000Z",
      ],
      { sessionId: "replace-owner" }
    )
    const { conflict } = await establishStaleConflict(
      creator,
      initial,
      snapshotWith(initial, { name: "Preflight candidate" })
    )
    const replacementSnapshot = snapshotWith(initial, {
      name: "Replacement candidate",
      revision: 11,
      quotationTemplateId: "warm-paper",
    })
    const replacementAdmission =
      await prepareDraftAdmission(replacementSnapshot)
    if (!replacementAdmission.ok) {
      throw new Error("Expected replacement admission")
    }
    const replacementConflict: DocumentDraftConflict = {
      ...conflict,
      candidate: replacementSnapshot,
      candidateContentSnapshotId: replacementAdmission.contentSnapshotId,
      candidateDraftSnapshotId: replacementAdmission.draftSnapshotId,
      detectedAt: "2026-08-28T12:11:00.000Z",
    }
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
                "draft-conflicts",
                "readwrite"
              )
              mutationTransactions.push(transactionDone(transaction))
              transaction
                .objectStore("draft-conflicts")
                .put(replacementConflict)
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
    const writer = createRepository(["2026-08-28T12:12:00.000Z"], {
      databaseName,
      sessionId: "copy-writer",
      indexedDB: interposedIndexedDB,
    }).repository

    const result = await writer.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-replaced-copy",
    })
    await Promise.all(mutationTransactions)
    mutationDatabase.close()

    expect(result).toEqual({
      ok: false,
      reason: "stale_conflict",
      current: replacementConflict,
    })
    expect(openCount).toBeGreaterThanOrEqual(2)
    expect(await creator.get("document-replaced-copy")).toEqual({
      ok: true,
      status: "missing",
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(replacementConflict)
  })

  it("converges concurrent same-target conflict-copy calls on one created record", async () => {
    const initial = snapshot()
    const candidate = snapshotWith(initial, { name: "Concurrent candidate" })
    const { databaseName, repository: creator } = createRepository(
      [
        "2026-08-28T12:10:00.000Z",
        "2026-08-28T12:11:00.000Z",
        "2026-08-28T12:12:00.000Z",
      ],
      { sessionId: "conflict-owner" }
    )
    const { conflict } = await establishStaleConflict(
      creator,
      initial,
      candidate
    )
    const tabA = createRepository(["2026-08-28T12:13:00.000Z"], {
      databaseName,
      sessionId: "copy-a",
    }).repository
    const tabB = createRepository(["2026-08-28T12:14:00.000Z"], {
      databaseName,
      sessionId: "copy-b",
    }).repository
    const input = {
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-concurrent-copy",
    }

    const results = await Promise.all([
      tabA.saveConflictAsCopy(input),
      tabB.saveConflictAsCopy(input),
    ])

    expect(
      results
        .map((result) => (result.ok ? result.status : result.reason))
        .sort()
    ).toEqual(["created", "replayed"])
    const records = results.flatMap((result) =>
      result.ok ? [result.record] : []
    )
    expect(records).toHaveLength(2)
    expect(records[1]).toEqual(records[0])
    expect(unwrapFound(await creator.get("document-concurrent-copy"))).toEqual(
      records[0]
    )
    expect(
      (await readAllStoreValues(databaseName, "draft-meta")).filter(
        (value) =>
          isRecord(value) && value.documentId === "document-concurrent-copy"
      )
    ).toHaveLength(1)
  })

  it("lets one target win concurrent different-target calls and replays that winner", async () => {
    const initial = snapshot()
    const candidate = snapshotWith(initial, {
      name: "Different target candidate",
    })
    const { databaseName, repository: creator } = createRepository(
      [
        "2026-08-28T12:20:00.000Z",
        "2026-08-28T12:21:00.000Z",
        "2026-08-28T12:22:00.000Z",
      ],
      { sessionId: "conflict-owner" }
    )
    const { conflict } = await establishStaleConflict(
      creator,
      initial,
      candidate
    )
    const tabA = createRepository(["2026-08-28T12:23:00.000Z"], {
      databaseName,
      sessionId: "copy-a",
    }).repository
    const tabB = createRepository(["2026-08-28T12:24:00.000Z"], {
      databaseName,
      sessionId: "copy-b",
    }).repository
    const baseInput = {
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
    }

    const results = await Promise.all([
      tabA.saveConflictAsCopy({
        ...baseInput,
        newDocumentId: "document-target-a",
      }),
      tabB.saveConflictAsCopy({
        ...baseInput,
        newDocumentId: "document-target-b",
      }),
    ])
    const winner = results.find(
      (result): result is Extract<typeof result, { ok: true }> =>
        result.ok && result.status === "created"
    )
    const replay = results.find(
      (result): result is Extract<typeof result, { ok: true }> =>
        result.ok && result.status === "replayed"
    )
    if (!winner || !replay)
      throw new Error("Expected one winner and one replay")
    expect(replay.record).toEqual(winner.record)
    const losingDocumentId =
      winner.record.summary.documentId === "document-target-a"
        ? "document-target-b"
        : "document-target-a"
    expect(await creator.get(losingDocumentId)).toEqual({
      ok: true,
      status: "missing",
    })
  })

  it("replays the stored copy after reopen without writes, events, or timestamp changes", async () => {
    const initial = snapshot()
    const candidate = snapshotWith(initial, { name: "Replay candidate" })
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T12:30:00.000Z",
        "2026-08-28T12:31:00.000Z",
        "2026-08-28T12:32:00.000Z",
        "2026-08-28T12:33:00.000Z",
      ],
      { sessionId: "conflict-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      candidate
    )
    const created = await repository.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-replay-copy",
    })
    if (!created.ok) throw new Error("Expected the first copy")
    const before = {
      body: await readStoreValue(
        databaseName,
        "draft-body",
        "document-replay-copy"
      ),
      metadata: await readStoreValue(
        databaseName,
        "draft-meta",
        "document-replay-copy"
      ),
      conflict: await readStoreValue(
        databaseName,
        "draft-conflicts",
        conflict.conflictId
      ),
    }
    repository.close()
    const reopened = createRepository(["2026-08-29T00:00:00.000Z"], {
      databaseName,
      sessionId: "retry-session",
    }).repository
    const events: DraftRepositoryEvent[] = []
    reopened.subscribe((event) => events.push(event))

    const replayed = await reopened.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-ignored-retry-target",
    })

    expect(replayed).toEqual({
      ok: true,
      status: "replayed",
      record: created.record,
      conflict: created.conflict,
    })
    expect(events).toEqual([])
    expect({
      body: await readStoreValue(
        databaseName,
        "draft-body",
        "document-replay-copy"
      ),
      metadata: await readStoreValue(
        databaseName,
        "draft-meta",
        "document-replay-copy"
      ),
      conflict: await readStoreValue(
        databaseName,
        "draft-conflicts",
        conflict.conflictId
      ),
    }).toEqual(before)
    expect(await reopened.get("document-ignored-retry-target")).toEqual({
      ok: true,
      status: "missing",
    })
  })

  it("rejects non-atomic save-copy resolution and emits reload resolution only after commit", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T12:40:00.000Z",
        "2026-08-28T12:41:00.000Z",
        "2026-08-28T12:42:00.000Z",
        "2026-08-28T12:43:00.000Z",
      ],
      { sessionId: "reload-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Reload candidate" })
    )
    const currentHead = expectedHeadFor(
      unwrapFound(await repository.get(initial.document.id))
    )
    const unresolvedBytes = await readStoreValue(
      databaseName,
      "draft-conflicts",
      conflict.conflictId
    )
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))

    expect(
      await repository.resolveConflict(
        conflict.conflictId,
        "save_copy",
        conflict.candidateDraftSnapshotId,
        currentHead
      )
    ).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message:
          "Save-copy resolution requires the atomic saveConflictAsCopy operation.",
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(unresolvedBytes)
    expect(events).toEqual([])

    expect(
      await repository.resolveConflict(
        conflict.conflictId,
        "reload_saved",
        `sha256-${"f".repeat(64)}`,
        currentHead
      )
    ).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message:
          "A newer preserved conflict candidate replaced this recovery action.",
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(unresolvedBytes)
    expect(events).toEqual([])

    const resolved = await repository.resolveConflict(
      conflict.conflictId,
      "reload_saved",
      conflict.candidateDraftSnapshotId,
      currentHead
    )
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        resolution: "reload_saved",
        resolutionDocumentId: null,
        resolvedAt: "2026-08-28T12:43:00.000Z",
      },
    })
    expect(events).toEqual([
      {
        type: "conflict_resolved",
        conflictId: conflict.conflictId,
        documentId: initial.document.id,
        resolution: "reload_saved",
        resolutionDocumentId: null,
        sessionId: repository.sessionId,
      },
    ])
    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId: "document-must-not-exist",
      })
    ).toMatchObject({
      ok: false,
      reason: "resolved_without_copy",
      current: { resolution: "reload_saved", resolutionDocumentId: null },
    })
    expect(await repository.get("document-must-not-exist")).toEqual({
      ok: true,
      status: "missing",
    })
  })

  it("preserves a legacy save-copy resolution without guessing a result document", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T12:50:00.000Z",
        "2026-08-28T12:51:00.000Z",
        "2026-08-28T12:52:00.000Z",
      ],
      { sessionId: "legacy-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Legacy candidate" })
    )
    const legacy = {
      ...conflict,
      resolvedAt: "2026-08-28T12:53:00.000Z",
      resolution: "save_copy",
    } as Record<string, unknown>
    delete legacy.resolutionDocumentId
    await putStoreValue(databaseName, "draft-conflicts", legacy)

    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId: "document-legacy-guess",
      })
    ).toMatchObject({
      ok: false,
      reason: "resolved_without_copy",
      current: {
        resolution: "save_copy",
        resolutionDocumentId: null,
      },
    })
    expect(await repository.get("document-legacy-guess")).toEqual({
      ok: true,
      status: "missing",
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(legacy)
  })

  it("preserves existing or corrupt copy targets and leaves the conflict unresolved", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T13:00:00.000Z",
        "2026-08-28T13:01:00.000Z",
        "2026-08-28T13:02:00.000Z",
        "2026-08-28T13:03:00.000Z",
      ],
      { sessionId: "target-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Target candidate" })
    )
    const existing = await repository.create(
      snapshot("Existing target", "document-existing-target")
    )
    if (!existing.ok) throw new Error("Expected an existing target")

    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId: "document-existing-target",
      })
    ).toEqual({
      ok: false,
      reason: "target_exists",
      current: existing.record.summary,
    })
    const corruptTarget = {
      schemaVersion: 1,
      documentId: "document-corrupt-target",
      recordVersion: 1,
    }
    await putStoreValue(databaseName, "draft-body", corruptTarget)
    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId: "document-corrupt-target",
      })
    ).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      failure: { kind: "corrupt_record" },
    })
    expect(
      await readStoreValue(
        databaseName,
        "draft-body",
        "document-corrupt-target"
      )
    ).toEqual(corruptTarget)
    expect(await readAllStoreValues(databaseName, "draft-quarantine")).toEqual(
      []
    )
    expect(
      await readStoreValue<DocumentDraftConflict>(
        databaseName,
        "draft-conflicts",
        conflict.conflictId
      )
    ).toMatchObject({ resolvedAt: null, resolution: null })
  })

  it("rejects a malformed candidate hash before opening a copy write transaction", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T13:10:00.000Z",
        "2026-08-28T13:11:00.000Z",
        "2026-08-28T13:12:00.000Z",
      ],
      { sessionId: "hash-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Hash candidate" })
    )
    const malformed = {
      ...conflict,
      candidateDraftSnapshotId: `sha256-${"0".repeat(64)}`,
    }
    await putStoreValue(databaseName, "draft-conflicts", malformed)

    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: malformed.candidateDraftSnapshotId,
        newDocumentId: "document-hash-copy",
      })
    ).toEqual({
      ok: false,
      reason: "corrupt_record",
      failure: {
        kind: "corrupt_record",
        message: "The stored conflict candidate failed its integrity check.",
      },
    })
    expect(await repository.get("document-hash-copy")).toEqual({
      ok: true,
      status: "missing",
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(malformed)
  })

  it("rejects an oversized stored conflict candidate before opening a copy write transaction", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T13:15:00.000Z",
        "2026-08-28T13:16:00.000Z",
        "2026-08-28T13:17:00.000Z",
      ],
      { sessionId: "oversized-owner" }
    )
    const { conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Normal candidate" })
    )
    const oversized: DocumentDraftConflict = {
      ...conflict,
      candidate: {
        ...conflict.candidate,
        document: {
          ...conflict.candidate.document,
          name: "x".repeat(DRAFT_MAX_ENCODED_BYTES),
        },
      },
    }
    await putStoreValue(databaseName, "draft-conflicts", oversized)

    expect(
      await repository.saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId: "document-oversized-copy",
      })
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message: expect.stringContaining("Studio drafts must be"),
      },
    })
    expect(await repository.get("document-oversized-copy")).toEqual({
      ok: true,
      status: "missing",
    })
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(oversized)
  })

  it("keeps a resolved conflict byte-equivalent and allocates a new ID for a later stale candidate", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository(
      [
        "2026-08-28T13:20:00.000Z",
        "2026-08-28T13:21:00.000Z",
        "2026-08-28T13:22:00.000Z",
        "2026-08-28T13:23:00.000Z",
        "2026-08-28T13:24:00.000Z",
      ],
      { sessionId: "preserved-owner" }
    )
    const { created, conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "First conflict" })
    )
    const copied = await repository.saveConflictAsCopy({
      conflictId: conflict.conflictId,
      expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
      newDocumentId: "document-preserved-copy",
    })
    if (!copied.ok) throw new Error("Expected a resolved copy")
    const resolvedBytes = await readStoreValue(
      databaseName,
      "draft-conflicts",
      conflict.conflictId
    )

    const later = await repository.save(
      snapshotWith(initial, { name: "Later stale candidate", revision: 9 }),
      1,
      created.record.summary.draftSnapshotId
    )
    expect(later).toMatchObject({
      ok: false,
      reason: "conflict",
      conflict: {
        candidate: { document: { name: "Later stale candidate" } },
        resolvedAt: null,
        resolutionDocumentId: null,
      },
    })
    if (later.ok || later.reason !== "conflict") {
      throw new Error("Expected the later conflict")
    }
    expect(later.conflict.conflictId).not.toBe(conflict.conflictId)
    expect(
      await readStoreValue(databaseName, "draft-conflicts", conflict.conflictId)
    ).toEqual(resolvedBytes)
    expect((await repository.listConflicts(initial.document.id)).ok).toBe(true)
  })

  it("uses a tombstone to block stale resurrection and restores by current version", async () => {
    const initial = snapshot()
    const { databaseName, repository: tabA } = createRepository(
      [
        "2026-08-28T12:00:00.000Z",
        "2026-08-28T12:01:00.000Z",
        "2026-08-28T12:03:00.000Z",
      ],
      { sessionId: "tab-a" }
    )
    const tabB = createRepository(["2026-08-28T12:02:00.000Z"], {
      databaseName,
      sessionId: "tab-b",
    }).repository
    const created = await tabA.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")

    const deleted = await tabA.softDelete(initial.document.id, 1)
    if (!deleted.ok) throw new Error("Expected a tombstone")
    expect(deleted.record.summary).toMatchObject({
      recordVersion: 2,
      deletedAt: "2026-08-28T12:01:00.000Z",
    })
    expect(unwrapList(await tabA.list()).items).toEqual([])
    expect(unwrapList(await tabA.list({ state: "all" })).items).toHaveLength(1)

    const stale = await tabB.save(
      snapshotWith(initial, { name: "Must not resurrect" }),
      1,
      created.record.summary.draftSnapshotId
    )
    expect(stale).toMatchObject({
      ok: false,
      reason: "deleted",
      conflict: { reason: "deleted_elsewhere", sessionId: "tab-b" },
    })
    expect(
      unwrapFound(await tabA.get(initial.document.id)).envelope.document.name
    ).toBe("Editorial draft")

    const restored = await tabA.restore(initial.document.id, 2)
    if (!restored.ok) throw new Error("Expected a restored draft")
    expect(restored.record.summary).toMatchObject({
      recordVersion: 3,
      deletedAt: null,
    })
    expect(
      unwrapList(await tabA.list()).items.map((item) => item.documentId)
    ).toEqual([initial.document.id])
  })

  it("purges a deleted record and its exact preview", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:00:10.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)
    expect(await repository.putPreview(preview)).toMatchObject({
      ok: true,
      value: {
        documentId: preview.documentId,
        contentSnapshotId: preview.contentSnapshotId,
        pageId: preview.pageId,
      },
    })
    const deleted = await repository.softDelete(initial.document.id, 1)
    if (!deleted.ok) throw new Error("Expected a deleted draft")

    expect(await repository.purge(initial.document.id, 2)).toEqual({
      ok: true,
      deletedId: initial.document.id,
    })
    expect(await repository.get(initial.document.id)).toEqual({
      ok: true,
      status: "missing",
    })
    expect(await repository.getPreview(initial.document.id)).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toBeUndefined()
  })

  it("duplicates into a new record with explicit origin and independent identity", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
      "2026-08-28T12:02:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")

    const duplicate = await repository.duplicate(initial.document.id, {
      name: "Editorial draft copy",
      newDocumentId: "document-editorial-copy",
    })
    if (!duplicate.ok) throw new Error("Expected a duplicated draft")

    expect(duplicate.record.summary).toMatchObject({
      documentId: "document-editorial-copy",
      name: "Editorial draft copy",
      documentRevision: 0,
      recordVersion: 1,
      origin: {
        kind: "duplicate",
        sourceDocumentId: initial.document.id,
      },
    })
    expect(duplicate.record.summary.contentSnapshotId).not.toBe(
      created.record.summary.contentSnapshotId
    )
    expect(duplicate.record.envelope.sourceContext).toEqual(
      created.record.envelope.sourceContext
    )
  })

  it("touches last-open activity without changing the save version", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:05:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const events: unknown[] = []
    repository.subscribe((event) => events.push(event))

    expect(await repository.touchOpened(initial.document.id)).toMatchObject({
      ok: true,
      value: {
        summary: {
          documentId: initial.document.id,
          recordVersion: 1,
          lastOpenedAt: "2026-08-28T12:05:00.000Z",
        },
      },
    })
    const touched = unwrapFound(await repository.get(initial.document.id))
    expect(touched.summary).toMatchObject({
      recordVersion: 1,
      savedAt: created.record.summary.savedAt,
      lastOpenedAt: "2026-08-28T12:05:00.000Z",
      activityAt: "2026-08-28T12:05:00.000Z",
    })
    expect(events).toEqual([
      {
        type: "saved",
        reason: "opened",
        documentId: initial.document.id,
        recordVersion: created.record.summary.recordVersion,
        contentSnapshotId: created.record.summary.contentSnapshotId,
        draftSnapshotId: created.record.summary.draftSnapshotId,
        sessionId: repository.sessionId,
      },
    ])
    expect(await repository.touchOpened("missing-document")).toEqual({
      ok: false,
      reason: "missing",
    })
  })

  it("accepts previews only for the exact current page and content snapshot", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:00:10.000Z",
      "2026-08-28T12:00:20.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)

    expect(await repository.putPreview(preview)).toMatchObject({
      ok: true,
      value: {
        documentId: preview.documentId,
        contentSnapshotId: preview.contentSnapshotId,
        pageId: preview.pageId,
      },
    })
    expect(
      await repository.getPreview(preview.documentId, preview.contentSnapshotId)
    ).toMatchObject({
      ok: true,
      value: {
        pageId: preview.pageId,
        rendererRevision: "renderer-v1",
        width: preview.width,
        height: preview.height,
        byteLength: preview.byteLength,
      },
    })
    expect(
      await repository.putPreview({
        ...preview,
        contentSnapshotId: "sha256-stale",
      })
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed" },
    })
    expect(
      await repository.putPreview({ ...preview, pageId: "missing-page" })
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed" },
    })
    expect(
      await repository.putPreview({ ...preview, width: 513 })
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed" },
    })
    expect(
      await repository.putPreview({ ...preview, byteLength: 999 })
    ).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed" },
    })

    const sourceOnly = snapshotWith(initial, {
      quotationTemplateId: "midnight-film",
    })
    const sourceSaved = await repository.save(
      sourceOnly,
      1,
      created.record.summary.draftSnapshotId
    )
    if (!sourceSaved.ok) throw new Error("Expected a source-only save")
    expect(
      await repository.getPreview(preview.documentId, preview.contentSnapshotId)
    ).toMatchObject({
      ok: true,
      value: {
        documentId: preview.documentId,
        contentSnapshotId: preview.contentSnapshotId,
      },
    })

    const contentSaved = await repository.save(
      snapshotWith(sourceOnly, { name: "Changed content" }),
      2,
      sourceSaved.record.summary.draftSnapshotId
    )
    if (!contentSaved.ok) throw new Error("Expected a content save")
    expect(await repository.getPreview(preview.documentId)).toEqual({
      ok: false,
      reason: "missing",
    })
  })

  it("reads an exact summary-bound preview without opening the draft body store", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:00:10.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)
    const stored = await repository.putPreview(preview)
    if (!stored.ok) throw new Error("Expected a stored preview")
    const identity = previewIdentity(preview, created.record.summary)
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction")

    try {
      expect(await repository.getPreviewForSummary(identity)).toEqual({
        ok: true,
        status: "ready",
        preview: stored.value,
      })
      expect(transactionSpy).toHaveBeenCalledTimes(1)
      expect(transactionSpy.mock.calls[0]?.[0]).toEqual([
        "draft-meta",
        "draft-previews",
      ])
    } finally {
      transactionSpy.mockRestore()
    }
  })

  it("distinguishes missing, replaceable stale, stale-head, and inactive summary previews", async () => {
    const initial = snapshot()
    const { repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:00:10.000Z",
      "2026-08-28T12:00:20.000Z",
      "2026-08-28T12:00:30.000Z",
      "2026-08-28T12:00:40.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)
    const initialIdentity = previewIdentity(preview, created.record.summary)

    expect(await repository.getPreviewForSummary(initialIdentity)).toEqual({
      ok: true,
      status: "missing",
    })
    expect(await repository.putPreview(preview)).toMatchObject({ ok: true })
    expect(
      await repository.getPreviewForSummary({
        ...initialIdentity,
        rendererRevision: "renderer-v2",
      })
    ).toEqual({ ok: true, status: "stale_preview" })

    const alternateSize = fitPageThumbnailSize(
      {
        width: created.record.summary.firstPageWidth,
        height: created.record.summary.firstPageHeight,
      },
      { maxWidth: 100, maxHeight: 140 }
    )
    expect(
      await repository.getPreviewForSummary({
        ...initialIdentity,
        ...alternateSize,
      })
    ).toEqual({ ok: true, status: "stale_preview" })

    const sourceOnly = snapshotWith(initial, {
      quotationTemplateId: "midnight-film",
    })
    const sourceSaved = await repository.save(
      sourceOnly,
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    if (!sourceSaved.ok) throw new Error("Expected a source-only save")
    expect(await repository.getPreviewForSummary(initialIdentity)).toEqual({
      ok: false,
      reason: "stale_head",
      current: sourceSaved.record.summary,
    })
    const refreshedIdentity = previewIdentity(
      preview,
      sourceSaved.record.summary
    )
    expect(
      await repository.getPreviewForSummary(refreshedIdentity)
    ).toMatchObject({ ok: true, status: "ready" })

    const deleted = await repository.softDelete(
      initial.document.id,
      sourceSaved.record.summary.recordVersion
    )
    if (!deleted.ok) throw new Error("Expected a deleted draft")
    expect(await repository.getPreviewForSummary(refreshedIdentity)).toEqual({
      ok: true,
      status: "not_active",
    })

    const restored = await repository.restore(
      initial.document.id,
      deleted.record.summary.recordVersion
    )
    if (!restored.ok) throw new Error("Expected a restored draft")
    expect(
      await repository.getPreviewForSummary(
        previewIdentity(preview, restored.record.summary)
      )
    ).toMatchObject({ ok: true, status: "ready" })
  })

  it("reports malformed stored preview bytes without reading or quarantining the document body", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)
    await putStoreValue(databaseName, "draft-previews", {
      schemaVersion: 1,
      ...preview,
      createdAt: "2026-08-28T12:00:10.000Z",
      byteLength: preview.byteLength + 1,
    })

    expect(
      await repository.getPreviewForSummary(
        previewIdentity(preview, created.record.summary)
      )
    ).toEqual({
      ok: false,
      reason: "corrupt_preview",
      failure: {
        kind: "corrupt_record",
        message: "The stored document preview could not be decoded.",
      },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toBeDefined()
    expect(await readAllStoreValues(databaseName, "draft-quarantine")).toEqual(
      []
    )

    await putStoreValue(databaseName, "draft-previews", {
      schemaVersion: 1,
      ...preview,
      createdAt: "2026-08-28T12:00:20.000Z",
      height: preview.width,
    })
    expect(
      await repository.getPreviewForSummary(
        previewIdentity(preview, created.record.summary)
      )
    ).toMatchObject({
      ok: false,
      reason: "corrupt_preview",
      failure: {
        kind: "corrupt_record",
        message: "The stored document preview dimensions are invalid.",
      },
    })
  })

  it("maps lightweight preview storage failures without throwing", async () => {
    const initial = snapshot()
    const { repository: source } = createRepository([
      "2026-08-28T12:00:00.000Z",
    ])
    const created = await source.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const preview = validPreview(initial, created.record.summary)
    const unavailable = new DocumentDraftRepository({
      indexedDB: {
        open: () => {
          throw new DOMException("Storage denied", "SecurityError")
        },
      } as unknown as IDBFactory,
    })

    expect(
      await unavailable.getPreviewForSummary(
        previewIdentity(preview, created.record.summary)
      )
    ).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
      failure: { kind: "storage_unavailable" },
    })
  })

  it("quarantines a corrupt pair and removes it from recents", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:01:00.000Z",
    ])
    await repository.create(initial)

    const metadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )
    await putStoreValue(databaseName, "draft-meta", {
      ...metadata,
      contentSnapshotId: `sha256-${"a".repeat(64)}`,
    })

    expect(await repository.get(initial.document.id)).toMatchObject({
      ok: false,
      reason: "corrupt_record",
      failure: { kind: "corrupt_record" },
    })
    expect(unwrapList(await repository.list())).toEqual({
      items: [],
      nextCursor: null,
      recoveryItems: [],
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toBeUndefined()
    const quarantine = await readAllStoreValues<Record<string, unknown>>(
      databaseName,
      "draft-quarantine"
    )
    expect(quarantine).toHaveLength(1)
    expect(quarantine[0]).toMatchObject({
      schemaVersion: 1,
      documentId: initial.document.id,
      failure: {
        store: "paired-record",
        key: initial.document.id,
        code: "pair_mismatch",
        message:
          "The draft metadata and body do not describe the same revision.",
      },
      activeRowsRemoved: true,
    })
  })

  it("continues past index-visible corruption, fills the healthy page, and quarantines the exact pair and preview", async () => {
    const activityAt = "2026-08-28T21:00:00.000Z"
    const { databaseName, repository } = createRepository([activityAt])
    for (const documentId of [
      "document-a",
      "document-b",
      "document-c",
      "document-d",
    ]) {
      const created = await repository.create(snapshot(documentId, documentId))
      expect(created).toMatchObject({ ok: true })
    }
    const corruptBody = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      "document-b"
    )
    const healthyMetadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      "document-b"
    )
    const corruptMetadata = { ...healthyMetadata, name: "" }
    const preview = { documentId: "document-b", marker: "must be removed" }
    await putStoreValue(databaseName, "draft-meta", corruptMetadata)
    await putStoreValue(databaseName, "draft-previews", preview)
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))

    const first = unwrapList(await repository.list({ limit: 2 }))
    expect(first.items.map((item) => item.documentId)).toEqual([
      "document-d",
      "document-c",
    ])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.recoveryItems).toEqual([
      {
        documentId: "document-b",
        quarantineId: expect.any(String),
        status: "quarantined",
        failure: {
          kind: "corrupt_record",
          message: "The draft metadata could not be decoded.",
        },
      },
    ])
    if (!first.nextCursor || !first.recoveryItems[0]?.quarantineId) {
      throw new Error("Expected pagination and quarantine identities")
    }
    const second = unwrapList(
      await repository.list({ limit: 2, cursor: first.nextCursor })
    )
    expect(second).toEqual({
      items: [expect.objectContaining({ documentId: "document-a" })],
      nextCursor: null,
      recoveryItems: [],
    })
    expect(
      await readStoreValue(databaseName, "draft-body", "document-b")
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-meta", "document-b")
    ).toBeUndefined()
    expect(
      await readStoreValue(databaseName, "draft-previews", "document-b")
    ).toBeUndefined()
    expect(
      await readStoreValue(
        databaseName,
        "draft-quarantine",
        first.recoveryItems[0].quarantineId
      )
    ).toMatchObject({
      documentId: "document-b",
      body: corruptBody,
      metadata: corruptMetadata,
      activeRowsRemoved: true,
    })
    expect(events).toEqual([
      {
        type: "quarantined",
        documentId: "document-b",
        quarantineId: first.recoveryItems[0].quarantineId,
        sessionId: repository.sessionId,
      },
    ])
  })

  it("keeps a conflict unresolved when the durable head changes before reload resolution", async () => {
    const initial = snapshot()
    const { repository } = createRepository(
      [
        "2026-08-29T02:10:00.000Z",
        "2026-08-29T02:11:00.000Z",
        "2026-08-29T02:12:00.000Z",
        "2026-08-29T02:13:00.000Z",
      ],
      { sessionId: "reload-race-owner" }
    )
    const { committed, conflict } = await establishStaleConflict(
      repository,
      initial,
      snapshotWith(initial, { name: "Preserved reload candidate" })
    )
    const staleExpectedHead = expectedHeadFor(committed.record)
    const newer = await repository.save(
      snapshotWith(initial, { name: "Newest durable head", revision: 3 }),
      committed.record.summary.recordVersion,
      committed.record.summary.draftSnapshotId
    )
    if (!newer.ok) throw new Error("Expected a newer durable head")
    const events: DraftRepositoryEvent[] = []
    repository.subscribe((event) => events.push(event))

    const resolved = await repository.resolveConflict(
      conflict.conflictId,
      "reload_saved",
      conflict.candidateDraftSnapshotId,
      staleExpectedHead
    )

    expect(resolved).toEqual({
      ok: false,
      reason: "head_changed",
      current: { status: "found", record: newer.record },
    })
    expect(events).toEqual([])
    const conflicts = await repository.listConflicts(initial.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          conflictId: conflict.conflictId,
          resolvedAt: null,
          resolution: null,
        },
      ],
    })
  })

  it("does not let corrupt equal-timestamp rows consume healthy limits or duplicate cursor results", async () => {
    const activityAt = "2026-08-28T21:10:00.000Z"
    const { databaseName, repository } = createRepository([activityAt])
    for (const documentId of [
      "document-a",
      "document-b",
      "document-c",
      "document-d",
      "document-e",
      "document-f",
      "document-g",
    ]) {
      const created = await repository.create(snapshot(documentId, documentId))
      expect(created).toMatchObject({ ok: true })
    }
    for (const documentId of ["document-c", "document-f"]) {
      const metadata = await readStoreValue<Record<string, unknown>>(
        databaseName,
        "draft-meta",
        documentId
      )
      await putStoreValue(databaseName, "draft-meta", {
        ...metadata,
        pageCount: 0,
      })
    }
    const startingCursor = `${encodeURIComponent(activityAt)}~${encodeURIComponent("document-z")}`
    const first = unwrapList(
      await repository.list({ limit: 2, cursor: startingCursor })
    )
    expect(first.items.map((item) => item.documentId)).toEqual([
      "document-g",
      "document-e",
    ])
    expect(first.recoveryItems).toEqual([
      expect.objectContaining({
        documentId: "document-f",
        status: "quarantined",
      }),
    ])
    if (!first.nextCursor) throw new Error("Expected the first cursor")

    const second = unwrapList(
      await repository.list({ limit: 2, cursor: first.nextCursor })
    )
    expect(second.items.map((item) => item.documentId)).toEqual([
      "document-d",
      "document-b",
    ])
    expect(second.recoveryItems).toEqual([
      expect.objectContaining({
        documentId: "document-c",
        status: "quarantined",
      }),
    ])
    if (!second.nextCursor) throw new Error("Expected the second cursor")

    const third = unwrapList(
      await repository.list({ limit: 2, cursor: second.nextCursor })
    )
    expect(third).toEqual({
      items: [expect.objectContaining({ documentId: "document-a" })],
      nextCursor: null,
      recoveryItems: [],
    })
    expect(
      [...first.items, ...second.items, ...third.items].map(
        (item) => item.documentId
      )
    ).toEqual([
      "document-g",
      "document-e",
      "document-d",
      "document-b",
      "document-a",
    ])
  })

  it("advances the sparse-index integrity sweep in bounded batches and eventually quarantines every discoverable row", async () => {
    const { databaseName, repository } = createRepository([
      "2026-08-28T21:20:00.000Z",
    ])
    expect(await repository.open()).toMatchObject({ ok: true })
    const sparseRows = Array.from({ length: 51 }, (_, index) => ({
      schemaVersion: 1,
      documentId: `sparse-${index.toString().padStart(3, "0")}`,
    }))
    await putStoreValues(databaseName, "draft-meta", sparseRows)

    const first = unwrapList(await repository.list())
    expect(first.items).toEqual([])
    expect(first.recoveryItems).toHaveLength(50)
    expect(
      first.recoveryItems.every(
        (item) => item.status === "quarantined" && item.documentId !== null
      )
    ).toBe(true)
    expect(
      await readStoreValue(
        databaseName,
        "repository-settings",
        "integrityScan.draftMetaV1"
      )
    ).toEqual({
      key: "integrityScan.draftMetaV1",
      value: { afterPrimaryKey: "sparse-049", completedAt: null },
    })

    const second = unwrapList(await repository.list())
    expect(second.items).toEqual([])
    expect(second.recoveryItems).toEqual([
      expect.objectContaining({
        documentId: "sparse-050",
        status: "quarantined",
      }),
    ])
    expect(
      await readStoreValue(
        databaseName,
        "repository-settings",
        "integrityScan.draftMetaV1"
      )
    ).toEqual({
      key: "integrityScan.draftMetaV1",
      value: {
        afterPrimaryKey: null,
        completedAt: "2026-08-28T21:20:00.000Z",
      },
    })
    expect(await readAllStoreValues(databaseName, "draft-meta")).toEqual([])
    expect(
      await readAllStoreValues(databaseName, "draft-quarantine")
    ).toHaveLength(51)
  })

  it("retains a sparse malformed non-string primary key without coercing or quarantining it", async () => {
    const { databaseName, repository } = createRepository([
      "2026-08-28T21:30:00.000Z",
    ])
    expect(await repository.open()).toMatchObject({ ok: true })
    const malformed = { schemaVersion: 1, documentId: 42 }
    await putStoreValue(databaseName, "draft-meta", malformed)

    expect(unwrapList(await repository.list())).toEqual({
      items: [],
      nextCursor: null,
      recoveryItems: [
        {
          documentId: null,
          quarantineId: null,
          status: "retained",
          failure: {
            kind: "corrupt_record",
            message: "Stored document metadata could not be decoded.",
          },
        },
      ],
    })
    expect(await readStoreValue(databaseName, "draft-meta", 42)).toEqual(
      malformed
    )
    expect(await readAllStoreValues(databaseName, "draft-quarantine")).toEqual(
      []
    )
  })

  it("rejects an oversized save before storage and preserves the committed pair", async () => {
    const initial = snapshot()
    const { databaseName, repository } = createRepository([
      "2026-08-28T12:00:00.000Z",
    ])
    const created = await repository.create(initial)
    if (!created.ok) throw new Error("Expected a created draft")
    const beforeBody = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-body",
      initial.document.id
    )
    const beforeMetadata = await readStoreValue<Record<string, unknown>>(
      databaseName,
      "draft-meta",
      initial.document.id
    )

    const oversized: CurrentDraftSnapshot = {
      ...initial,
      document: {
        ...initial.document,
        name: "x".repeat(DRAFT_MAX_ENCODED_BYTES),
      },
    }
    const rejected = await repository.save(
      oversized,
      1,
      created.record.summary.draftSnapshotId
    )
    expect(rejected).toMatchObject({
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed" },
    })
    expect(
      await readStoreValue(databaseName, "draft-body", initial.document.id)
    ).toEqual(beforeBody)
    expect(
      await readStoreValue(databaseName, "draft-meta", initial.document.id)
    ).toEqual(beforeMetadata)
  })

  it("rejects unbounded list requests before opening storage", async () => {
    const { repository } = createRepository(["2026-08-28T12:00:00.000Z"])

    for (const limit of [101, 0, 1.5]) {
      expect(await repository.list({ limit })).toEqual({
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document list limit must be an integer from 1 to 100.",
        },
      })
    }
  })

  it("applies active, deleted, all, and query predicates before satisfying each tie-stable page limit", async () => {
    const activityAt = "2026-08-28T20:00:00.000Z"
    const { repository } = createRepository([activityAt])
    const fixtures = [
      ["Alpha active", "document-a"],
      ["Alpha deleted", "document-b"],
      ["Gamma active", "document-c"],
      ["Delta deleted", "document-d"],
      ["Alpha extra active", "document-e"],
      ["Alpha final deleted", "document-f"],
    ] as const
    for (const [name, documentId] of fixtures) {
      const created = await repository.create(snapshot(name, documentId))
      expect(created).toMatchObject({ ok: true })
    }
    for (const documentId of ["document-b", "document-d", "document-f"]) {
      const deleted = await repository.softDelete(documentId, 1)
      expect(deleted).toMatchObject({ ok: true })
    }

    const collectIds = async ({
      state,
      query,
      limit,
    }: {
      state: "active" | "deleted" | "all"
      query?: string
      limit: number
    }) => {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = unwrapList(
          await repository.list({ state, query, limit, cursor })
        )
        ids.push(...page.items.map((item) => item.documentId))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return ids
    }

    expect(await collectIds({ state: "active", limit: 2 })).toEqual([
      "document-e",
      "document-c",
      "document-a",
    ])
    expect(await collectIds({ state: "deleted", limit: 2 })).toEqual([
      "document-f",
      "document-d",
      "document-b",
    ])
    expect(await collectIds({ state: "all", limit: 2 })).toEqual([
      "document-f",
      "document-e",
      "document-d",
      "document-c",
      "document-b",
      "document-a",
    ])
    expect(
      await collectIds({ state: "active", query: "alpha", limit: 1 })
    ).toEqual(["document-e", "document-a"])
    expect(
      await collectIds({ state: "deleted", query: "ALPHA", limit: 1 })
    ).toEqual(["document-f", "document-b"])
    expect(
      await collectIds({ state: "all", query: " alpha ", limit: 2 })
    ).toEqual(["document-f", "document-e", "document-b", "document-a"])
  })

  it("rejects an unknown list state before opening storage", async () => {
    let opened = false
    const repository = new DocumentDraftRepository({
      indexedDB: {
        open: () => {
          opened = true
          throw new Error("Storage should not open")
        },
      } as unknown as IDBFactory,
    })

    expect(await repository.list({ state: "archived" as never })).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message: "Document list state must be active, deleted, or all.",
      },
    })
    expect(opened).toBe(false)
  })

  it("rejects malformed list option, query, and cursor values before opening storage", async () => {
    let opened = false
    const repository = new DocumentDraftRepository({
      indexedDB: {
        open: () => {
          opened = true
          throw new Error("Storage should not open")
        },
      } as unknown as IDBFactory,
    })

    expect(await repository.list(null as never)).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message: "Document list options must be an object.",
      },
    })
    expect(await repository.list({ query: 0 as never })).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message: "Document list query must be a string.",
      },
    })
    expect(await repository.list({ cursor: false as never })).toEqual({
      ok: false,
      reason: "validation_failed",
      failure: {
        kind: "validation_failed",
        message: "The document list cursor is invalid.",
      },
    })
    expect(opened).toBe(false)
  })
})
