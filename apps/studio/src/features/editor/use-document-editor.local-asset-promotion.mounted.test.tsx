// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import {
  assetReferenceKeysForSource,
  builtInDesignTemplateRepository,
  deriveDocumentSnapshotId,
  documentSchema,
  localAssetSource,
  managedAssetSource,
} from "@webmcp/document"
import type { Document, SceneNode } from "@webmcp/document"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import type {
  ActiveLocalAssetPromotionResult,
  ActiveRelinkResult,
} from "./active-local-asset-promotion"
import { startActiveLocalAssetPromotion } from "./active-local-asset-promotion"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import type { DocumentDraftRecord } from "./document-draft-repository"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import {
  checkpointReleasedLocalAssetPromotionConflict,
  localAssetPromotionJournalSchema,
  readLocalAssetPromotionJournal,
} from "./local-asset-promotion-journal"
import type { LocalAssetPromotionJournal } from "./local-asset-promotion-journal"
import { getLocalAssetRecord } from "./local-asset-store"
import type { LocalAssetRecord } from "./local-asset-store"
import { markManagedMediaUsed } from "./managed-media-repository"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"

vi.mock("./active-local-asset-promotion", { spy: true })
vi.mock("./local-asset-promotion-journal", { spy: true })
vi.mock("./local-asset-store", { spy: true })
vi.mock("./managed-media-repository", { spy: true })

const checkpointConflictMock = vi.mocked(
  checkpointReleasedLocalAssetPromotionConflict
)
const getLocalRecordMock = vi.mocked(getLocalAssetRecord)
const markManagedUsedMock = vi.mocked(markManagedMediaUsed)
const readJournalMock = vi.mocked(readLocalAssetPromotionJournal)
const startActiveMock = vi.mocked(startActiveLocalAssetPromotion)

type Editor = ReturnType<typeof useDocumentEditor>
type PromotionInput = Parameters<typeof startActiveLocalAssetPromotion>[0]
type PromotionOptions = Parameters<typeof startActiveLocalAssetPromotion>[1]

const documentDatabaseName = "webmcp-studio-documents"
const realIndexedDB = globalThis.indexedDB
const localAssetId = "local-photo-1"
const managedAssetId = "asset-abcdefghij"
const imageNodeId = "promotion-image-1"

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const deleteDocumentDatabase = () =>
  new Promise<void>((resolve) => {
    const request = realIndexedDB.deleteDatabase(documentDatabaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const localRecord: LocalAssetRecord = {
  schemaVersion: 4,
  id: localAssetId,
  name: "portrait.png",
  mediaType: "image/png",
  size: 3,
  width: 1,
  height: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  lastUsedAt: "2026-08-30T00:00:00.000Z",
  archivedAt: null,
  revision: 4,
  integrity: "ready",
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
}

const imageNode = (src: string, assetId = localAssetId): SceneNode => ({
  id: imageNodeId,
  type: "image",
  name: "Promotion image",
  x: 80,
  y: 120,
  width: 420,
  height: 280,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId,
  src,
  placement: {
    mode: "fill",
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  frameMask: { shape: "rectangle" },
  alt: "Promotion fixture",
  decorative: false,
})

const documentWithImage = (
  id: string,
  source: string,
  assetId = localAssetId,
  addUnrelatedNode = false
): Document => {
  const base = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  const page = base.pages[0]
  const unrelatedNode: SceneNode = {
    id: "unrelated-rectangle",
    type: "rect",
    name: "Unrelated edit",
    x: 24,
    y: 24,
    width: 40,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: "#ff0000",
    radius: 0,
    strokeWidth: 0,
  }
  return documentSchema.parse({
    ...base,
    id,
    name: id,
    pages: base.pages.map((candidate) =>
      candidate.id === page.id
        ? {
            ...candidate,
            nodeIds: [
              ...candidate.nodeIds,
              imageNodeId,
              ...(addUnrelatedNode ? [unrelatedNode.id] : []),
            ],
          }
        : candidate
    ),
    nodes: [
      ...base.nodes,
      imageNode(source, assetId),
      ...(addUnrelatedNode ? [unrelatedNode] : []),
    ],
  })
}

const envelopeFor = (document: Document): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document,
  sourceContext: {
    quotationSource: null,
    quotationTemplateId: "editorial-olive",
    designTemplate: { id: "editorial-one-pager", version: 1 },
  },
})

const createRecord = async (
  repository: DocumentDraftRepository,
  document: Document
) => {
  const envelope = envelopeFor(document)
  const created = await repository.create(
    {
      document: envelope.document,
      sourceContext: envelope.sourceContext,
    },
    {
      kind: "template",
      templateId: "editorial-one-pager",
      templateVersion: 1,
    }
  )
  if (!created.ok) {
    throw new Error(
      `Expected the mounted draft fixture: ${JSON.stringify(created)}`
    )
  }
  const read = await repository.get(document.id)
  if (!read.ok || read.status !== "found") {
    throw new Error("Expected the mounted draft record")
  }
  return read.record
}

const journalFor = (
  input: PromotionInput,
  state: LocalAssetPromotionJournal["state"] = "mapped",
  patch: Partial<LocalAssetPromotionJournal> = {}
) =>
  localAssetPromotionJournalSchema.parse({
    schemaVersion: 1,
    localAssetId,
    revision: 7,
    contentSha256: "a".repeat(64),
    idempotencyKey: "promotion-upload-key-1",
    recentUseIdempotencyKey: "promotion-recent-key-1",
    attempt: 1,
    state,
    managedAssetId,
    managedContentSha256: "a".repeat(64),
    managedStatus: "ready",
    managedAssetRevision: 2,
    sourceDocumentId: input.sourceDocumentId,
    sourceContentSnapshotId: input.sourceContentSnapshotId,
    sourceHistorySnapshotId: input.sourceHistorySnapshotId,
    sourceOperationVersion: input.sourceOperationVersion,
    sourceDraftRecordVersion: input.sourceDraftRecordVersion,
    sourceDraftSnapshotId: input.sourceDraftSnapshotId,
    sourceLocalAssetRevision: input.sourceLocalAssetRevision,
    expectedReferenceKeys: [...input.expectedReferenceKeys],
    mappingRequestId: "mapping-request-1",
    relinkResultContentSnapshotId: null,
    relinkResultHistorySnapshotId: null,
    relinkResultOperationVersion: null,
    relinkResultKind: null,
    relinkResultDraftContentSnapshotId: null,
    relinkResultDraftSnapshotId: null,
    relinkResultDraftRecordVersion: null,
    relinkCommitId: null,
    relinkUndoable: null,
    recentUseUsedAt: null,
    recentUseAssetRevision: null,
    recentUseRequestId: null,
    errorCode: null,
    errorRequestId: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z",
    lease: null,
    ...patch,
  })

const pendingOperation = (operationId = "mounted-operation-1") => {
  const result = deferred<ActiveLocalAssetPromotionResult>()
  return {
    operationId,
    promise: result.promise,
    cancel: vi.fn<() => boolean>(() => true),
    resolve: result.resolve,
  }
}

function MountedEditor({
  capture,
  initialRecord,
}: {
  capture: (editor: Editor) => void
  initialRecord: DocumentDraftRecord
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ initialRecord, persistence })
  useLayoutEffect(() => capture(editor), [capture, editor])
  return null
}

describe.sequential("useDocumentEditor mounted local asset promotion", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean
  let repository: DocumentDraftRepository
  let captured: { current: Editor | null }
  const capture = (editor: Editor) => {
    captured.current = editor
  }

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(async () => {
    localStorage.clear()
    await deleteDocumentDatabase()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
    captured = { current: null }
    repository = new DocumentDraftRepository({
      indexedDB: realIndexedDB,
      sessionId: `promotion-mounted-${crypto.randomUUID()}`,
      now: () => "2026-08-30T00:00:00.000Z",
    })
    readJournalMock.mockResolvedValue({ status: "missing" })
    getLocalRecordMock.mockResolvedValue(localRecord)
    checkpointConflictMock.mockImplementation(async () => {
      throw new Error("Unexpected conflict checkpoint")
    })
    markManagedUsedMock.mockResolvedValue({
      assetId: managedAssetId,
      usedAt: "2026-08-30T00:00:10.000Z",
      assetRevision: 3,
      requestId: "recent-request-1",
    })
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    repository.close()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    localStorage.clear()
    await deleteDocumentDatabase()
  })

  const mount = async (record: DocumentDraftRecord) => {
    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper createRepository={() => repository}>
          <MountedEditor capture={capture} initialRecord={record} />
        </StudioPersistenceTestWrapper>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
      expect(captured.current?.sessionMode).toBe("workspace")
    })
    return captured.current!
  }

  const reroute = async (record: DocumentDraftRecord) => {
    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper createRepository={() => repository}>
          <MountedEditor capture={capture} initialRecord={record} />
        </StudioPersistenceTestWrapper>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
      expect(captured.current?.document.id).toBe(record.summary.documentId)
    })
  }

  it("admits one owner when the user starts the same promotion twice rapidly", async () => {
    const record = await createRecord(
      repository,
      documentWithImage("rapid-start-document", localAssetSource(localAssetId))
    )
    const editor = await mount(record)
    const journalRead = deferred<{ status: "missing" }>()
    readJournalMock.mockReturnValue(journalRead.promise)
    const operation = pendingOperation()
    startActiveMock.mockReturnValue(operation)

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    await act(async () => {
      first = editor.startLocalAssetPromotion(localAssetId)
      second = editor.startLocalAssetPromotion(localAssetId)
      await Promise.resolve()
    })

    expect(captured.current?.localAssetPromotions[localAssetId]?.phase).toBe(
      "preparing"
    )
    await act(async () => journalRead.resolve({ status: "missing" }))

    await expect(Promise.all([first, second])).resolves.toEqual([true, false])
    expect(startActiveMock).toHaveBeenCalledTimes(1)
    operation.resolve({
      status: "backed_up",
      journal: null,
      message: "Stopped by test.",
      retryable: true,
    })
  })

  it("acknowledges Cancel during deferred preflight and never starts a late owner", async () => {
    const record = await createRecord(
      repository,
      documentWithImage(
        "cancel-preflight-document",
        localAssetSource(localAssetId)
      )
    )
    const editor = await mount(record)
    const journalRead = deferred<{ status: "missing" }>()
    readJournalMock.mockImplementation(
      (_assetId: string, signal?: AbortSignal) => {
        if (!signal) throw new Error("Expected promotion preflight signal")
        expect(signal.aborted).toBe(false)
        return journalRead.promise
      }
    )

    let started!: Promise<boolean>
    await act(async () => {
      started = editor.startLocalAssetPromotion(localAssetId)
      await Promise.resolve()
    })
    await act(async () => {
      expect(captured.current!.cancelLocalAssetPromotion(localAssetId)).toBe(
        true
      )
    })

    expect(captured.current?.localAssetPromotions[localAssetId]).toMatchObject({
      phase: "cancelling",
      message: "Stopping…",
    })

    await act(async () => journalRead.resolve({ status: "missing" }))
    await expect(started).resolves.toBe(false)
    await vi.waitFor(() => {
      expect(
        captured.current?.localAssetPromotions[localAssetId]
      ).toMatchObject({
        phase: "cancelled",
        retryable: true,
      })
    })
    expect(startActiveMock).not.toHaveBeenCalled()
  })

  it("fences progress and editor mutation after route retirement and unmount", async () => {
    const firstRecord = await createRecord(
      repository,
      documentWithImage("retired-document", localAssetSource(localAssetId))
    )
    const secondRecord = await createRecord(
      repository,
      documentWithImage("next-document", "https://example.com/next.png", "next")
    )
    const editor = await mount(firstRecord)
    const operation = pendingOperation()
    let operationOptions: PromotionOptions | null = null
    startActiveMock.mockImplementation(
      (_input: PromotionInput, options: PromotionOptions) => {
        operationOptions = options
        return operation
      }
    )

    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(true)
    })
    await reroute(secondRecord)
    const nextDocument = structuredClone(captured.current!.document)

    await act(async () => {
      operationOptions!.onProgress?.({
        localAssetId,
        phase: "uploading",
        loaded: 2,
        total: 3,
        message: null,
        retryable: false,
        undoable: null,
      })
      const relink =
        await operationOptions!.dependencies.applyOrRecognizeRelink(
          journalFor(startActiveMock.mock.calls[0][0]),
          new AbortController().signal,
          vi.fn(),
          vi.fn(async () => undefined)
        )
      expect(relink).toBeNull()
    })
    expect(captured.current!.document).toEqual(nextDocument)
    expect(captured.current!.localAssetPromotions[localAssetId]).toBeUndefined()

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    operationOptions!.onProgress?.({
      localAssetId,
      phase: "uploading",
      loaded: 3,
      total: 3,
      message: null,
      retryable: false,
      undoable: null,
    })
    operation.resolve({
      status: "backed_up",
      journal: null,
      message: "Retired.",
      retryable: true,
    })
    expect(operation.cancel).toHaveBeenCalledTimes(1)
  })

  it("blocks document transitions while saving and releases them while updating Recent", async () => {
    const firstRecord = await createRecord(
      repository,
      documentWithImage(
        "critical-transition-document",
        localAssetSource(localAssetId)
      )
    )
    const secondRecord = await createRecord(
      repository,
      documentWithImage(
        "post-critical-document",
        "https://example.com/post-critical.png",
        "post-critical"
      )
    )
    const editor = await mount(firstRecord)
    const operation = pendingOperation("critical-transition-operation")
    let operationOptions: PromotionOptions | null = null
    startActiveMock.mockImplementation(
      (_input: PromotionInput, options: PromotionOptions) => {
        operationOptions = options
        return operation
      }
    )

    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(true)
      operationOptions!.onProgress?.({
        localAssetId,
        phase: "saving",
        loaded: null,
        total: null,
        message: null,
        retryable: false,
        undoable: true,
      })
    })

    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(
          secondRecord.summary.documentId
        )
      ).toBe(false)
    })
    expect(captured.current?.document.id).toBe(firstRecord.summary.documentId)
    expect(captured.current?.documentError).toBe(
      "Wait for the image to finish saving everywhere before opening another document."
    )

    await act(async () => {
      operationOptions!.onProgress?.({
        localAssetId,
        phase: "updating_recent",
        loaded: null,
        total: null,
        message: null,
        retryable: false,
        undoable: true,
      })
    })
    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(
          secondRecord.summary.documentId
        )
      ).toBe(true)
    })
    expect(captured.current?.document.id).toBe(secondRecord.summary.documentId)

    await act(async () => {
      operationOptions!.onProgress?.({
        localAssetId,
        phase: "complete",
        loaded: null,
        total: null,
        message: null,
        retryable: false,
        undoable: true,
      })
      operation.resolve({
        status: "complete",
        journal: journalFor(startActiveMock.mock.calls[0][0], "complete", {
          relinkResultContentSnapshotId:
            startActiveMock.mock.calls[0][0].sourceContentSnapshotId,
          relinkResultHistorySnapshotId:
            startActiveMock.mock.calls[0][0].sourceHistorySnapshotId,
          relinkResultOperationVersion:
            startActiveMock.mock.calls[0][0].sourceOperationVersion,
          relinkResultKind: "committed",
          relinkCommitId: "critical-transition-commit",
          relinkUndoable: true,
          relinkResultDraftContentSnapshotId:
            startActiveMock.mock.calls[0][0].sourceContentSnapshotId,
          relinkResultDraftSnapshotId:
            startActiveMock.mock.calls[0][0].sourceDraftSnapshotId,
          relinkResultDraftRecordVersion:
            startActiveMock.mock.calls[0][0].sourceDraftRecordVersion,
          recentUseUsedAt: "2026-08-30T00:00:10.000Z",
          recentUseAssetRevision: 3,
          recentUseRequestId: "recent-request-1",
        }),
        published: false,
      })
      await operation.promise
    })
    expect(captured.current?.localAssetPromotions[localAssetId]).toBeUndefined()

    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(
          firstRecord.summary.documentId
        )
      ).toBe(true)
    })
    expect(captured.current?.document.id).toBe(firstRecord.summary.documentId)
    expect(captured.current?.localAssetPromotions[localAssetId]).toBeUndefined()
  })

  it("keeps the persistence lease alive through a critical unmount and exact Recent completion", async () => {
    const sourceDocument = documentWithImage(
      "critical-unmount-document",
      localAssetSource(localAssetId)
    )
    const record = await createRecord(repository, sourceDocument)
    const editor = await mount(record)
    const originalSave = repository.save.bind(repository)
    const writeStarted = deferred<void>()
    const releaseWrite = deferred<void>()
    const save = vi
      .spyOn(repository, "save")
      .mockImplementation(async (...args) => {
        writeStarted.resolve()
        await releaseWrite.promise
        return originalSave(...args)
      })
    const controllerClose = vi.spyOn(
      DocumentDraftSaveController.prototype,
      "close"
    )
    let operationCompletion: Promise<ActiveLocalAssetPromotionResult> | null =
      null
    let completedJournal: LocalAssetPromotionJournal | null = null
    startActiveMock.mockImplementation(
      (input: PromotionInput, options: PromotionOptions) => {
        operationCompletion = Promise.resolve().then(async () => {
          const mapped = journalFor(input)
          const relink = await options.dependencies.applyOrRecognizeRelink(
            mapped,
            new AbortController().signal,
            vi.fn(),
            vi.fn(async () => undefined)
          )
          if (!relink) throw new Error("Expected mounted relink commit")
          options.onProgress?.({
            localAssetId,
            phase: "saving",
            loaded: null,
            total: null,
            message: null,
            retryable: false,
            undoable: relink.undoable,
          })
          const receipt = await options.dependencies.flushRelink(mapped, relink)
          if (!receipt) throw new Error("Expected exact durable receipt")
          options.onProgress?.({
            localAssetId,
            phase: "updating_recent",
            loaded: null,
            total: null,
            message: null,
            retryable: false,
            undoable: relink.undoable,
          })
          const recent = await options.dependencies.markManagedUsed(
            managedAssetId,
            mapped.recentUseIdempotencyKey
          )
          completedJournal = journalFor(input, "complete", {
            relinkResultContentSnapshotId: relink.contentSnapshotId,
            relinkResultHistorySnapshotId: relink.historySnapshotId,
            relinkResultOperationVersion: relink.operationVersion,
            relinkResultKind: relink.kind,
            relinkCommitId: relink.commitId,
            relinkUndoable: relink.undoable,
            relinkResultDraftContentSnapshotId: receipt.contentSnapshotId,
            relinkResultDraftSnapshotId: receipt.draftSnapshotId,
            relinkResultDraftRecordVersion: receipt.recordVersion,
            recentUseUsedAt: recent.usedAt,
            recentUseAssetRevision: recent.assetRevision,
            recentUseRequestId: recent.requestId,
          })
          return {
            status: "complete",
            journal: completedJournal,
            published: options.dependencies.mayPublish(
              "critical-unmount-operation"
            ),
          }
        })
        return {
          operationId: "critical-unmount-operation",
          promise: operationCompletion,
          cancel: vi.fn<() => boolean>(() => false),
        }
      }
    )

    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(true)
      await writeStarted.promise
    })
    expect(captured.current?.localAssetPromotions[localAssetId]?.phase).toBe(
      "saving"
    )

    await act(async () => {
      root.unmount()
      rootUnmounted = true
      await Promise.resolve()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(controllerClose).not.toHaveBeenCalled()
    expect(markManagedUsedMock).not.toHaveBeenCalled()

    releaseWrite.resolve()
    const result = await operationCompletion!
    expect(result).toMatchObject({ status: "complete", published: false })
    expect(completedJournal).toMatchObject({
      state: "complete",
      recentUseRequestId: "recent-request-1",
    })
    expect(markManagedUsedMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(controllerClose).toHaveBeenCalledTimes(1))
  })

  it("retries a checkpointed failed save as critical without a second relink", async () => {
    const targetDocument = documentWithImage(
      "checkpoint-retry-document",
      managedAssetSource(managedAssetId),
      managedAssetId
    )
    const record = await createRecord(repository, targetDocument)
    const editor = await mount(record)
    const expectedKeys = assetReferenceKeysForSource(
      targetDocument,
      managedAssetSource(managedAssetId)
    )
    const contentSnapshotId = await deriveDocumentSnapshotId(targetDocument)
    const staleInput: PromotionInput = {
      localAssetId,
      sourceDocumentId: targetDocument.id,
      sourceContentSnapshotId: contentSnapshotId,
      sourceHistorySnapshotId: "stale-history",
      sourceOperationVersion: editor.operationVersion,
      sourceDraftRecordVersion: record.summary.recordVersion,
      sourceDraftSnapshotId: record.summary.draftSnapshotId,
      sourceLocalAssetRevision: localRecord.revision,
      expectedReferenceKeys: expectedKeys,
    }
    getLocalRecordMock.mockResolvedValue(null)
    readJournalMock.mockResolvedValue({
      status: "ready",
      journal: journalFor(staleInput, "relinking", {
        relinkResultContentSnapshotId: contentSnapshotId,
        relinkResultHistorySnapshotId: "stale-result-history",
        relinkResultOperationVersion: editor.operationVersion,
        relinkResultKind: "committed",
        relinkCommitId: "stale-commit",
        relinkUndoable: true,
        errorCode: "local_relink_persistence_failed",
      }),
    })
    const state = vi
      .spyOn(DocumentDraftSaveController.prototype, "state", "get")
      .mockReturnValue({
        status: "failed",
        message: "Injected save failure.",
        retryable: true,
      })
    const retry = vi
      .spyOn(DocumentDraftSaveController.prototype, "retry")
      .mockResolvedValue(undefined)
    const flush = vi
      .spyOn(DocumentDraftSaveController.prototype, "flushWithReceipt")
      .mockResolvedValue({
        ok: true,
        receipt: {
          documentId: targetDocument.id,
          recordVersion: record.summary.recordVersion,
          contentSnapshotId,
          draftSnapshotId: record.summary.draftSnapshotId,
          savedAt: record.summary.savedAt,
        },
      })
    let applyResult: ActiveRelinkResult | null = null
    const enterCritical = vi.fn()
    startActiveMock.mockImplementation(
      (input: PromotionInput, options: PromotionOptions) => {
        const completion = Promise.resolve().then(async () => {
          const freshJournal = journalFor(input)
          applyResult = await options.dependencies.applyOrRecognizeRelink(
            freshJournal,
            new AbortController().signal,
            enterCritical,
            vi.fn(async () => undefined)
          )
          if (!applyResult) throw new Error("Expected exact target recovery")
          const receipt = await options.dependencies.flushRelink(
            freshJournal,
            applyResult
          )
          if (!receipt) throw new Error("Expected durable retry receipt")
          await options.dependencies.markManagedUsed(
            managedAssetId,
            freshJournal.recentUseIdempotencyKey
          )
          return {
            status: "complete" as const,
            journal: journalFor(input, "complete", {
              relinkResultContentSnapshotId: applyResult.contentSnapshotId,
              relinkResultHistorySnapshotId: applyResult.historySnapshotId,
              relinkResultOperationVersion: applyResult.operationVersion,
              relinkResultKind: applyResult.kind,
              relinkCommitId: applyResult.commitId,
              relinkUndoable: applyResult.undoable,
              relinkResultDraftContentSnapshotId: receipt.contentSnapshotId,
              relinkResultDraftSnapshotId: receipt.draftSnapshotId,
              relinkResultDraftRecordVersion: receipt.recordVersion,
              recentUseUsedAt: "2026-08-30T00:00:10.000Z",
              recentUseAssetRevision: 3,
              recentUseRequestId: "recent-request-1",
            }),
            published: true,
          }
        })
        return {
          operationId: "checkpoint-retry-operation",
          promise: completion,
          cancel: vi.fn<() => boolean>(() => false),
        }
      }
    )

    const undoEntryBefore = editor.documentUndoEntry
    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(true)
    })
    await vi.waitFor(() => {
      expect(captured.current?.localAssetPromotions[localAssetId]?.phase).toBe(
        "complete"
      )
    })

    expect(state).toHaveBeenCalled()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(applyResult).toMatchObject({
      kind: "already_applied",
      commitId: null,
      undoable: false,
    })
    expect(enterCritical).toHaveBeenCalledWith(false)
    expect(captured.current?.documentUndoEntry).toEqual(undoEntryBefore)
    expect(startActiveMock).toHaveBeenCalledTimes(1)
    expect(markManagedUsedMock).toHaveBeenCalledTimes(1)
  })

  it("turns a target-only mismatch into a durable non-retryable conflict", async () => {
    const wrongTarget = "asset-bbbbbbbbbb"
    const currentDocument = documentWithImage(
      "target-mismatch-document",
      managedAssetSource(wrongTarget),
      wrongTarget
    )
    const record = await createRecord(repository, currentDocument)
    const editor = await mount(record)
    const expectedKeys = assetReferenceKeysForSource(
      currentDocument,
      managedAssetSource(wrongTarget)
    )
    const staleInput: PromotionInput = {
      localAssetId,
      sourceDocumentId: currentDocument.id,
      sourceContentSnapshotId: await deriveDocumentSnapshotId(currentDocument),
      sourceHistorySnapshotId: editor.snapshotId,
      sourceOperationVersion: editor.operationVersion,
      sourceDraftRecordVersion: record.summary.recordVersion,
      sourceDraftSnapshotId: record.summary.draftSnapshotId,
      sourceLocalAssetRevision: localRecord.revision,
      expectedReferenceKeys: expectedKeys,
    }
    getLocalRecordMock.mockResolvedValue(null)
    readJournalMock.mockResolvedValue({
      status: "ready",
      journal: journalFor(staleInput),
    })
    checkpointConflictMock.mockResolvedValue(journalFor(staleInput))

    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(false)
    })

    expect(checkpointConflictMock).toHaveBeenCalledWith(
      { localAssetId, expectedRevision: 7 },
      expect.any(AbortSignal)
    )
    expect(startActiveMock).not.toHaveBeenCalled()
    expect(captured.current?.localAssetPromotions[localAssetId]).toMatchObject({
      phase: "conflict",
      retryable: false,
      managedAssetId,
    })
  })

  it("reanchors an exact managed target after an unrelated edit as already applied", async () => {
    const currentDocument = documentWithImage(
      "target-reanchor-document",
      managedAssetSource(managedAssetId),
      managedAssetId,
      true
    )
    const record = await createRecord(repository, currentDocument)
    const editor = await mount(record)
    const expectedKeys = assetReferenceKeysForSource(
      currentDocument,
      managedAssetSource(managedAssetId)
    )
    const staleInput: PromotionInput = {
      localAssetId,
      sourceDocumentId: currentDocument.id,
      sourceContentSnapshotId: await deriveDocumentSnapshotId(currentDocument),
      sourceHistorySnapshotId: "history-before-unrelated-edit",
      sourceOperationVersion: Math.max(0, editor.operationVersion - 1),
      sourceDraftRecordVersion: record.summary.recordVersion,
      sourceDraftSnapshotId: record.summary.draftSnapshotId,
      sourceLocalAssetRevision: localRecord.revision,
      expectedReferenceKeys: expectedKeys,
    }
    getLocalRecordMock.mockResolvedValue(null)
    readJournalMock.mockResolvedValue({
      status: "ready",
      journal: journalFor(staleInput, "relinking", {
        relinkResultContentSnapshotId: staleInput.sourceContentSnapshotId,
        relinkResultHistorySnapshotId: "history-before-unrelated-edit",
        relinkResultOperationVersion: staleInput.sourceOperationVersion,
        relinkResultKind: "committed",
        relinkCommitId: "commit-before-unrelated-edit",
        relinkUndoable: true,
      }),
    })
    const operation = pendingOperation("reanchor-operation")
    let input: PromotionInput | null = null
    let options: PromotionOptions | null = null
    startActiveMock.mockImplementation(
      (nextInput: PromotionInput, nextOptions: PromotionOptions) => {
        input = nextInput
        options = nextOptions
        return operation
      }
    )

    const undoEntryBefore = editor.documentUndoEntry
    await act(async () => {
      expect(await editor.startLocalAssetPromotion(localAssetId)).toBe(true)
    })
    expect(input).toMatchObject({ supersedeUnpersistedRelinkRevision: 7 })
    const enterCritical = vi.fn()
    const reassertOwned = vi.fn(async () => undefined)
    let relink: ActiveRelinkResult | null = null
    await act(async () => {
      relink = await options!.dependencies.applyOrRecognizeRelink(
        journalFor(input!),
        new AbortController().signal,
        enterCritical,
        reassertOwned
      )
    })

    expect(reassertOwned).toHaveBeenCalledTimes(1)
    expect(enterCritical).toHaveBeenCalledWith(false)
    expect(relink).toMatchObject({
      kind: "already_applied",
      commitId: null,
      undoable: false,
    })
    expect(captured.current?.documentUndoEntry).toEqual(undoEntryBefore)
    expect(captured.current?.document).toEqual(currentDocument)
    operation.resolve({
      status: "backed_up",
      journal: null,
      message: "Stopped by test.",
      retryable: true,
    })
  })
})
