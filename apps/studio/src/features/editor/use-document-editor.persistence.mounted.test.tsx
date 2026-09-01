// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import {
  builtInDesignTemplateRepository,
  createTemplateVersion,
  documentSchema,
  projectCuratedMediaDetail,
} from "@webmcp/document"
import type { ChangeSet, SceneNode, TemplateVersion } from "@webmcp/document"
import { act, StrictMode, useLayoutEffect } from "react"
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
import { CURRENT_DRAFT_STORAGE_KEY } from "./current-draft-repository"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import { DocumentDraftRepository } from "./document-draft-repository"
import type {
  DocumentDraftRecord,
  DraftListRecoveryItem,
  DraftRepositoryEvent,
} from "./document-draft-repository"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import { quotationStarter } from "./quotation-starter"
import { createKnownQuotationComposition } from "./quotation-composition-context"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import type { StudioPersistenceApi } from "../persistence/studio-persistence-provider"
import { useDocumentEditor } from "./use-document-editor"
import type {
  ResolvedTemplateAction,
  TemplateActionPorts,
} from "../../content/library/library-template-actions"
import { getStudioLibraryCatalogDetail } from "../../content/library/catalog"
import { createLibraryTemplateDocument } from "./library-template-create-command"
import { studioMediaManifest } from "../../content/library/media/manifest"
import type { VerifiedCuratedMediaContent } from "../../content/library/media/curated-media-content"
import type { LibraryMediaActionPreparationPorts } from "./library-media-action-preparation"
import { IMAGE_REPLACEMENT_OUTPUT_STALE_REASON } from "./image-replacement-output-admission"

type Editor = ReturnType<typeof useDocumentEditor>

const applyExactLibraryTemplate = async (
  editor: Editor,
  id: string,
  version: number
) => {
  const resolved = await editor.resolveApplyLibraryTemplate({
    itemKind: "template",
    id,
    version,
  })
  return resolved ? editor.confirmApplyLibraryTemplate(resolved) : false
}

type RepositoryLifecycle = Readonly<{
  status: "opening" | "ready" | "blocked" | "unavailable"
  failure?: Readonly<{ kind: string; message: string }>
}>

type PublishRequestBody = Readonly<{
  id: string
  templateId: string
  version: number
  publishedAt: string
  document: CurrentDraftEnvelope["document"]
}>

const repositoryDatabaseName = "webmcp-studio-documents"
const realIndexedDB = globalThis.indexedDB

const quotationEnvelope = (): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: quotationStarter.document,
  sourceContext: {
    quotationSource: quotationStarter.source,
    quotationTemplateId: quotationStarter.templateId,
    designTemplate: null,
  },
})

const designEnvelope = (): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  ),
  sourceContext: {
    quotationSource: null,
    quotationTemplateId: quotationStarter.templateId,
    designTemplate: { id: "editorial-one-pager", version: 1 },
  },
})

const cropImage: Extract<SceneNode, { type: "image" }> = {
  id: "persistence-race-image",
  type: "image",
  name: "Persistence race image",
  x: 80,
  y: 120,
  width: 420,
  height: 280,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: "persistence-race-image",
  src: "https://example.com/persistence-race-image.jpg",
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
  alt: "Persistence race fixture",
  decorative: false,
}

const cropEnvelope = (): CurrentDraftEnvelope => {
  const envelope = designEnvelope()
  const firstPage = envelope.document.pages[0]
  return {
    ...envelope,
    document: documentSchema.parse({
      ...envelope.document,
      pages: envelope.document.pages.map((page) =>
        page.id === firstPage.id
          ? { ...page, nodeIds: [...page.nodeIds, cropImage.id] }
          : page
      ),
      nodes: [...envelope.document.nodes, cropImage],
    }),
  }
}

const publicationRaceEnvelope = (): CurrentDraftEnvelope => {
  const envelope = cropEnvelope()
  return {
    ...envelope,
    document: documentSchema.parse({
      ...envelope.document,
      nodes: envelope.document.nodes.map((node) =>
        node.id === cropImage.id && node.type === "image"
          ? {
              ...node,
              src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            }
          : node
      ),
    }),
  }
}

const publicationRaceMedia = studioMediaManifest[0]
const publicationRaceMediaDetail = projectCuratedMediaDetail(
  publicationRaceMedia,
  {
    curatedRank: 0,
    preferences: { favorite: false, lastUsedAt: null, collectionIds: [] },
  }
)
const publicationRaceMediaContent: VerifiedCuratedMediaContent = {
  identity: {
    assetId: publicationRaceMedia.id,
    version: publicationRaceMedia.version,
    contentSha256: publicationRaceMedia.contentSha256,
  },
  item: publicationRaceMedia,
  canonicalSource: publicationRaceMedia.resourcePath,
  bytes: new Uint8Array(publicationRaceMedia.bytes),
  src: `data:${publicationRaceMedia.mimeType};base64,publication-race`,
}
const publicationRaceMediaPorts: LibraryMediaActionPreparationPorts = {
  getExactDetail: async () => publicationRaceMediaDetail,
  resolveCurated: async () => publicationRaceMediaContent,
  getManagedRecord: async () => null,
  verifyManagedResource: async () => {
    throw new Error("Managed media is outside this test.")
  },
  recheckLocal: async () => {
    throw new Error("Local media is outside this test.")
  },
}

const repository = (sessionId: string) =>
  new DocumentDraftRepository({
    indexedDB: realIndexedDB,
    sessionId,
    now: () => "2026-08-28T21:00:00.000Z",
  })

const recoveryItem = (
  status: DraftListRecoveryItem["status"],
  documentId = "unreadable-local-document"
): DraftListRecoveryItem => ({
  documentId,
  quarantineId: status === "quarantined" ? `quarantine-${documentId}` : null,
  status,
  failure: {
    kind: "corrupt_record",
    message: `Stored document ${documentId} is unreadable.`,
  },
})

const repositoryWithIncomingEvents = (sessionId: string) => {
  let channel: BroadcastChannel | null = null
  const draftRepository = new DocumentDraftRepository({
    indexedDB: realIndexedDB,
    sessionId,
    now: () => "2026-08-28T21:00:00.000Z",
    createBroadcastChannel: (name) => {
      channel = {
        name,
        onmessage: null,
        onmessageerror: null,
        close: vi.fn(),
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }
      return channel
    },
  })
  return {
    repository: draftRepository,
    deliver: (event: DraftRepositoryEvent) => {
      if (!channel?.onmessage) {
        throw new Error("Expected the repository event channel to be open")
      }
      channel.onmessage(new MessageEvent("message", { data: event }))
    },
  }
}

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = realIndexedDB.deleteDatabase(repositoryDatabaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

const settleEffects = async (milliseconds = 50) => {
  await act(async () => pause(milliseconds))
}

const repositoryLifecycle = (editor: Editor): RepositoryLifecycle =>
  editor.repositoryLifecycle

const claimsDurableSave = (editor: Editor) =>
  editor.localSaveState.status === "saved"

const mountedLibraryTemplateDetailPort: TemplateActionPorts["getDetail"] =
  async (kind, id, version, signal) => {
    if (signal.aborted) throw signal.reason
    return getStudioLibraryCatalogDetail(kind, id, version)
  }

const expectExactSourceContext = (record: DocumentDraftRecord) => {
  expect(record.envelope.sourceContext).toEqual(
    quotationEnvelope().sourceContext
  )
}

const jsonFile = (value: unknown): File => {
  const bytes = JSON.stringify(value)
  return {
    size: new TextEncoder().encode(bytes).byteLength,
    text: async () => bytes,
  } as File
}

const deferredJsonFile = (value: unknown) => {
  const bytes = JSON.stringify(value)
  let resolveText: ((text: string) => void) | null = null
  const pendingText = new Promise<string>((resolve) => {
    resolveText = resolve
  })
  const text = vi.fn(() => pendingText)
  return {
    file: {
      size: new TextEncoder().encode(bytes).byteLength,
      text,
    } as unknown as File,
    text,
    resolve: () => resolveText?.(bytes),
  }
}

const importFile = (document: CurrentDraftEnvelope["document"]): File =>
  jsonFile(document)

const currentEnvelope = (editor: Editor): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: structuredClone(editor.document),
  sourceContext: {
    quotationSource: structuredClone(editor.quotationSource),
    quotationTemplateId: editor.activeQuotationTemplateId,
    designTemplate: structuredClone(editor.activeDesignTemplate),
    ...(editor.activeQuotationComposition
      ? { composition: structuredClone(editor.activeQuotationComposition) }
      : {}),
  },
})

const exactHistory = (editor: Editor) => ({
  envelope: currentEnvelope(editor),
  snapshotId: editor.snapshotId,
  operationVersion: editor.operationVersion,
  canUndo: editor.canUndo,
  canRedo: editor.canRedo,
})

const reviewChangeSet = (editor: Editor): ChangeSet => {
  const node = editor.document.nodes[0]
  return {
    id: "persistence-import-race-review",
    documentId: editor.document.id,
    baseRevision: editor.document.revision,
    baseSnapshotId: editor.snapshotId,
    title: "Persistence import race review",
    createdAt: "2026-08-28T21:10:00.000Z",
    createdBy: "agent",
    status: "pending",
    operations: [
      {
        id: "persistence-import-race-operation",
        summary: "Change target opacity",
        status: "pending",
        command: {
          id: "persistence-import-race-command",
          type: "update_node",
          actor: "agent",
          at: "2026-08-28T21:10:00.000Z",
          nodeId: node.id,
          patch: { opacity: Math.max(0, node.opacity - 0.1) },
        },
      },
    ],
  }
}

type DeferredImportKind = "document" | "quotation"

const documentImportCandidate = (editor: Editor, label: string) => ({
  ...structuredClone(editor.document),
  name: label,
  revision: editor.document.revision + 1,
  updatedAt: "2026-08-28T21:11:00.000Z",
})

const quotationImportCandidate = (label: string) => {
  const source = structuredClone(quotationStarter.source)
  source.source.quotationId = label
  source.source.revision += 1
  source.quote.quoteNumber = label.toUpperCase()
  source.quote.quoteVersion += 1
  return source
}

const beginDeferredImport = async (
  editor: Editor,
  kind: DeferredImportKind,
  label: string
) => {
  const value =
    kind === "document"
      ? documentImportCandidate(editor, label)
      : quotationImportCandidate(label)
  const deferred = deferredJsonFile(value)
  let settled: Promise<boolean | void> = Promise.resolve()
  await act(async () => {
    settled =
      kind === "document"
        ? editor.importDocumentFile(deferred.file)
        : editor.importQuotationFile(deferred.file)
    await Promise.resolve()
  })
  expect(deferred.text).toHaveBeenCalledOnce()
  return { ...deferred, settled, value }
}

const captureDownload = () => {
  let blob: Blob | null = null
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation((value) => {
      if (!(value instanceof Blob)) {
        throw new Error("Expected the current-version download to use a Blob")
      }
      blob = value
      return "blob:mounted-current-version"
    })
  const revokeObjectURL = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined)
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined)

  return {
    createObjectURL,
    revokeObjectURL,
    click,
    text: async () => {
      if (!blob) throw new Error("Expected a downloaded Blob")
      if (typeof blob.text === "function") return blob.text()
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(blob!)
      })
    },
  }
}

function MountedEditor({
  capture,
  capturePersistence,
  initialRecord = null,
  libraryMediaPreparationPorts,
  onInitialRecordInstalled,
}: {
  capture: (editor: Editor) => void
  capturePersistence: (persistence: StudioPersistenceApi) => void
  initialRecord?: DocumentDraftRecord | null
  libraryMediaPreparationPorts?: LibraryMediaActionPreparationPorts
  onInitialRecordInstalled?: (record: DocumentDraftRecord) => void
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({
    initialRecord,
    onInitialRecordInstalled,
    persistence,
    libraryTemplateDetailPort: mountedLibraryTemplateDetailPort,
    libraryMediaPreparationPorts,
  })
  useLayoutEffect(() => {
    capture(editor)
    capturePersistence(persistence)
  })
  return null
}

describe.sequential("useDocumentEditor repository persistence", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(async () => {
    localStorage.clear()
    await deleteRepositoryDatabase()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    localStorage.clear()
    await deleteRepositoryDatabase()
  })

  async function mount(
    createDraftRepository: () => DocumentDraftRepository = () =>
      repository("hook-default"),
    initialRecord: DocumentDraftRecord | null = null,
    options: Readonly<{
      libraryMediaPreparationPorts?: LibraryMediaActionPreparationPorts
      onInitialRecordInstalled?: (record: DocumentDraftRecord) => void
      strict?: boolean
    }> = {}
  ) {
    const captured: {
      current: Editor | null
      renders: Editor[]
      persistence: StudioPersistenceApi | null
    } = {
      current: null,
      renders: [],
      persistence: null,
    }
    await act(async () => {
      const tree = (
        <StudioPersistenceTestWrapper createRepository={createDraftRepository}>
          <MountedEditor
            capture={(editor) => {
              captured.current = editor
              captured.renders.push(editor)
            }}
            capturePersistence={(persistence) => {
              captured.persistence = persistence
            }}
            initialRecord={initialRecord}
            libraryMediaPreparationPorts={options.libraryMediaPreparationPorts}
            onInitialRecordInstalled={options.onInitialRecordInstalled}
          />
        </StudioPersistenceTestWrapper>
      )
      root.render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
    })
    return captured
  }

  async function openEnvelope(
    envelope: CurrentDraftEnvelope,
    suffix: string,
    beforeContinue?: (persistence: StudioPersistenceApi) => void,
    mountOptions: Readonly<{
      libraryMediaPreparationPorts?: LibraryMediaActionPreparationPorts
    }> = {}
  ) {
    const hookRepository = repository(`hook-${suffix}`)
    const origin = envelope.sourceContext?.quotationSource
      ? ({ kind: "quotation" } as const)
      : ({
          kind: "template",
          templateId:
            envelope.sourceContext?.designTemplate?.id ?? "editorial-one-pager",
          templateVersion: envelope.sourceContext?.designTemplate?.version ?? 1,
        } as const)
    const created = await hookRepository.create(
      {
        document: envelope.document,
        sourceContext: envelope.sourceContext,
      },
      origin
    )
    if (!created.ok) throw new Error("Expected repository fixture creation")

    const captured = await mount(() => hookRepository, null, mountOptions)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    if (!captured.persistence) {
      throw new Error("Expected the mounted persistence API")
    }
    beforeContinue?.(captured.persistence)
    let continued = false
    await act(async () => {
      continued = await captured.current!.openStoredDocument(
        envelope.document.id
      )
    })
    expect(continued).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    return { captured, created: created.record, hookRepository }
  }

  const readRecord = async (
    draftRepository: DocumentDraftRepository,
    documentId: string
  ) => {
    const result = await draftRepository.get(documentId)
    expect(result).toMatchObject({ ok: true, status: "found" })
    if (!result.ok || result.status !== "found") {
      throw new Error("Expected a durable document record")
    }
    return result.record
  }

  const seedStoredStaleConflict = async (suffix: string) => {
    const envelope = designEnvelope()
    const draftRepository = repository(`stored-conflict-${suffix}`)
    const created = await draftRepository.create(
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
    if (!created.ok) throw new Error("Expected conflict fixture creation")
    const durableDocument = {
      ...envelope.document,
      name: "Durable external head",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:01:00.000Z",
    }
    const durable = await draftRepository.save(
      {
        document: durableDocument,
        sourceContext: envelope.sourceContext,
      },
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    if (!durable.ok) throw new Error("Expected external durable save")
    const candidateDocument = {
      ...envelope.document,
      name: "Preserved local candidate",
      revision: envelope.document.revision + 2,
      updatedAt: "2026-08-28T21:02:00.000Z",
    }
    const stale = await repository(`stored-conflict-writer-${suffix}`).save(
      {
        document: candidateDocument,
        sourceContext: envelope.sourceContext,
      },
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    expect(stale).toMatchObject({ ok: false, reason: "conflict" })
    if (stale.ok || stale.reason !== "conflict") {
      throw new Error("Expected stored stale conflict")
    }
    return {
      candidateDocument,
      conflict: stale.conflict,
      draftRepository,
      durable: durable.record,
      envelope,
    }
  }

  it("installs an admitted route record before exposing a workspace session", async () => {
    const draftRepository = repository("route-admitted")
    const envelope = quotationEnvelope()
    const created = await draftRepository.create(
      { document: envelope.document, sourceContext: envelope.sourceContext },
      { kind: "quotation" }
    )
    if (!created.ok) {
      throw new Error(
        `Expected route fixture creation: ${JSON.stringify(created)}`
      )
    }

    const captured = await mount(() => draftRepository, created.record)
    await vi.waitFor(() => {
      expect({
        error: captured.current?.documentError,
        status: captured.current?.routeSessionStatus,
      }).toEqual({ error: null, status: "ready" })
      expect(captured.current?.sessionMode).toBe("workspace")
    })
    expect(captured.current?.document).toEqual(created.record.envelope.document)
    expect(captured.current?.getActiveDocumentId()).toBe(
      created.record.summary.documentId
    )
    expect(captured.current?.localSaveState.status).toBe("saved")
  })

  it("notifies once after the exact admitted head installs under StrictMode", async () => {
    const draftRepository = repository("route-installed-callback")
    const envelope = quotationEnvelope()
    const created = await draftRepository.create(
      { document: envelope.document, sourceContext: envelope.sourceContext },
      { kind: "quotation" }
    )
    if (!created.ok) throw new Error("Expected route fixture creation")
    const installed = vi.fn()

    const captured = await mount(() => draftRepository, created.record, {
      onInitialRecordInstalled: installed,
      strict: true,
    })
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
    })

    expect(installed).toHaveBeenCalledOnce()
    expect(installed).toHaveBeenCalledWith(created.record)
  })

  it("never mounts or acknowledges an admitted head that advanced before install", async () => {
    const draftRepository = repository("route-stale-admitted-head")
    const envelope = quotationEnvelope()
    const created = await draftRepository.create(
      { document: envelope.document, sourceContext: envelope.sourceContext },
      { kind: "quotation" }
    )
    if (!created.ok) throw new Error("Expected route fixture creation")
    const advancedDocument = {
      ...created.record.envelope.document,
      name: "Authoritative advanced document",
      revision: created.record.envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:05:00.000Z",
    }
    const advanced = await draftRepository.save(
      {
        document: advancedDocument,
        sourceContext: created.record.envelope.sourceContext,
      },
      created.record.summary.recordVersion,
      created.record.summary.draftSnapshotId
    )
    if (!advanced.ok) throw new Error("Expected authoritative head advance")
    const installed = vi.fn()

    const captured = await mount(() => draftRepository, created.record, {
      onInitialRecordInstalled: installed,
    })
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("failed")
    })

    expect(installed).not.toHaveBeenCalled()
    expect(captured.current?.document.id).not.toBe(
      created.record.summary.documentId
    )
    expect(captured.current?.documentError).toContain("advanced")
  })

  it("persists pending review provenance and the discarded resolution", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "review-journal"
    )
    const proposal = reviewChangeSet(captured.current!)

    await act(async () => {
      captured.current?.proposeChangeSet(proposal, {
        source: "webmcp",
        actorLabel: "WebMCP agent",
        toolName: "execute_product_command",
        reason: "Check one layer before applying",
        requestId: "review-mounted-request",
      })
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })

    const pending = await readRecord(hookRepository, envelope.document.id)
    expect(pending.envelope.reviewJournal?.pending).toMatchObject({
      changeSet: { id: proposal.id },
      provenance: {
        toolName: "execute_product_command",
        reason: "Check one layer before applying",
        requestId: "review-mounted-request",
      },
    })
    expect(pending.summary.contentSnapshotId).toBe(
      created.summary.contentSnapshotId
    )

    await act(async () => root.unmount())
    root = createRoot(host)
    const reloaded = await mount(() => hookRepository, pending)
    await vi.waitFor(() => {
      expect(reloaded.current?.routeSessionStatus).toBe("ready")
    })
    expect(reloaded.current?.pendingChangeSet?.id).toBe(proposal.id)
    expect(reloaded.current?.reviewJournal.pending?.provenance).toMatchObject({
      toolName: "execute_product_command",
      requestId: "review-mounted-request",
    })
    expect(reloaded.current?.snapshotId).toBe(proposal.baseSnapshotId)
    expect(reloaded.current?.changeSetConflict).toBeNull()

    await act(async () => {
      reloaded.current?.discardChangeSet()
      expect(await reloaded.current!.flushActiveDraft()).toBe(true)
    })

    const resolved = await readRecord(hookRepository, envelope.document.id)
    expect(resolved.envelope.reviewJournal).toMatchObject({
      pending: null,
      resolved: [
        {
          changeSet: { id: proposal.id, status: "rejected" },
          resolution: {
            status: "discarded",
            acceptedOperationIds: [],
            rejectedOperationIds: proposal.operations.map(({ id }) => id),
          },
        },
      ],
    })
    expect(resolved.summary.contentSnapshotId).toBe(
      pending.summary.contentSnapshotId
    )
    expect(resolved.summary.draftSnapshotId).not.toBe(
      pending.summary.draftSnapshotId
    )
    await act(async () => {
      expect(await reloaded.current!.returnToStart()).toBe(true)
    })
  })

  it("rediscovers the exact unresolved candidate before a routed session becomes ready", async () => {
    const seeded = await seedStoredStaleConflict("route-reload")
    const captured = await mount(() => seeded.draftRepository, seeded.durable)

    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
      expect(captured.current?.conflictRecoveryState).toMatchObject({
        status: "conflict",
        documentId: seeded.envelope.document.id,
        conflict: {
          conflictId: seeded.conflict.conflictId,
          candidateDraftSnapshotId: seeded.conflict.candidateDraftSnapshotId,
        },
      })
    })
    expect(captured.current?.document.name).toBe("Durable external head")
    expect(captured.current?.localSaveState).toEqual({
      status: "conflict",
      conflictId: seeded.conflict.conflictId,
      reason: "stale_write",
    })

    const download = captureDownload()
    await act(async () => {
      expect(captured.current?.downloadCurrentVersion()).toBe(true)
    })
    await settleEffects(0)
    expect(await download.text()).toBe(
      JSON.stringify(
        { schemaVersion: 1, ...seeded.conflict.candidate },
        null,
        2
      )
    )
  })

  it("reloads the durable head through a fresh session before resolving the exact conflict", async () => {
    const seeded = await seedStoredStaleConflict("reload-saved")
    const captured = await mount(() => seeded.draftRepository, seeded.durable)
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
      expect(captured.current?.conflictRecoveryState.status).toBe("conflict")
    })

    let result: Awaited<ReturnType<Editor["reloadSavedAfterConflict"]>> | null =
      null
    await act(async () => {
      result = await captured.current!.reloadSavedAfterConflict()
    })

    expect(result).toEqual({ ok: true, destination: "document" })
    expect(captured.current?.document).toEqual(seeded.durable.envelope.document)
    expect(captured.current?.canUndo).toBe(false)
    expect(captured.current?.conflictRecoveryState).toEqual({
      status: "inactive",
    })
    expect(captured.current?.localSaveState.status).toBe("saved")
    const conflicts = await seeded.draftRepository.listConflicts(
      seeded.envelope.document.id
    )
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          conflictId: seeded.conflict.conflictId,
          resolution: "reload_saved",
          resolvedAt: expect.any(String),
        },
      ],
    })
  })

  it("saves the exact stored candidate as an atomic copy and installs that returned record", async () => {
    const seeded = await seedStoredStaleConflict("save-copy")
    const captured = await mount(() => seeded.draftRepository, seeded.durable)
    await vi.waitFor(() => {
      expect(captured.current?.routeSessionStatus).toBe("ready")
      expect(captured.current?.conflictRecoveryState.status).toBe("conflict")
    })

    let result: Awaited<ReturnType<Editor["saveConflictAsCopy"]>> | null = null
    await act(async () => {
      result = await captured.current!.saveConflictAsCopy()
    })

    const completed = result as unknown as Awaited<
      ReturnType<Editor["saveConflictAsCopy"]>
    >
    expect(completed).toMatchObject({
      ok: true,
      documentId: expect.any(String),
    })
    if (!completed.ok) throw new Error("Expected conflict copy")
    expect(completed.documentId).not.toBe(seeded.envelope.document.id)
    expect(captured.current?.document.id).toBe(completed.documentId)
    expect(captured.current?.document.name).toBe(
      `${seeded.candidateDocument.name} copy`
    )
    expect(captured.current?.conflictRecoveryState).toMatchObject({
      status: "failed",
      documentId: seeded.envelope.document.id,
      action: "save_copy",
      createdDocumentId: completed.documentId,
      conflict: {
        conflictId: seeded.conflict.conflictId,
        candidateDraftSnapshotId: seeded.conflict.candidateDraftSnapshotId,
      },
    })
    expect(captured.current?.conflictRecoveryModel).toMatchObject({
      status: "conflict",
      documentId: seeded.envelope.document.id,
      documentName: seeded.candidateDocument.name,
      operation: {
        status: "failed",
        action: "save_copy",
        createdDocumentId: completed.documentId,
      },
    })
    const copy = await readRecord(seeded.draftRepository, completed.documentId)
    expect(copy.summary.origin).toEqual({
      kind: "duplicate",
      sourceDocumentId: seeded.envelope.document.id,
    })
    const conflicts = await seeded.draftRepository.listConflicts(
      seeded.envelope.document.id
    )
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          conflictId: seeded.conflict.conflictId,
          resolution: "save_copy",
          resolutionDocumentId: completed.documentId,
        },
      ],
    })
  })

  it("saves the newest live edit as a copy when another edit is pending behind the conflicted save", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "save-copy-pending-edit"
    )
    const originalSave = hookRepository.save.bind(hookRepository)
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    let saveStarted = false
    vi.spyOn(hookRepository, "save").mockImplementation(
      async (...arguments_) => {
        saveStarted = true
        await saveGate
        return originalSave(...arguments_)
      }
    )

    await act(async () => {
      captured.current?.addRectangle()
    })
    let flushPromise = Promise.resolve(true)
    await act(async () => {
      flushPromise = captured.current!.flushActiveDraft()
      await vi.waitFor(() => expect(saveStarted).toBe(true))
    })

    const externalDocument = {
      ...envelope.document,
      name: "Durable external head",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-29T02:00:00.000Z",
    }
    const external = await originalSave(
      {
        document: externalDocument,
        sourceContext: envelope.sourceContext,
      },
      created.summary.recordVersion,
      created.summary.draftSnapshotId
    )
    expect(external).toMatchObject({ ok: true })

    await act(async () => {
      captured.current?.addRectangle()
    })
    const newestLiveEnvelope = currentEnvelope(captured.current!)
    expect(
      newestLiveEnvelope.document.nodes.filter(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toHaveLength(2)

    await act(async () => {
      releaseSave?.()
      expect(await flushPromise).toBe(false)
    })
    await vi.waitFor(() => {
      expect(captured.current?.conflictRecoveryState.status).toBe("conflict")
    })

    let copiedResult: Awaited<ReturnType<Editor["saveConflictAsCopy"]>> | null =
      null
    await act(async () => {
      copiedResult = await captured.current!.saveConflictAsCopy()
    })
    const completed = copiedResult as unknown as Awaited<
      ReturnType<Editor["saveConflictAsCopy"]>
    >
    expect(completed).toMatchObject({ ok: true })
    if (!completed.ok) throw new Error("Expected the live conflict copy")
    const copy = await readRecord(hookRepository, completed.documentId)
    expect(copy.envelope.document.nodes).toEqual(
      newestLiveEnvelope.document.nodes
    )
    expect(copy.envelope.sourceContext).toEqual(
      newestLiveEnvelope.sourceContext
    )
  })

  it("retries reload against the exact newer durable head before resolving", async () => {
    const seeded = await seedStoredStaleConflict("reload-head-race")
    const captured = await mount(() => seeded.draftRepository, seeded.durable)
    await vi.waitFor(() => {
      expect(captured.current?.conflictRecoveryState.status).toBe("conflict")
    })
    const originalResolve = seeded.draftRepository.resolveConflict.bind(
      seeded.draftRepository
    )
    const originalSave = seeded.draftRepository.save.bind(
      seeded.draftRepository
    )
    let injected = false
    vi.spyOn(seeded.draftRepository, "resolveConflict").mockImplementation(
      async (...arguments_) => {
        if (!injected) {
          injected = true
          const current = await readRecord(
            seeded.draftRepository,
            seeded.envelope.document.id
          )
          const newer = await originalSave(
            {
              document: {
                ...current.envelope.document,
                name: "Newest durable head",
                revision: current.envelope.document.revision + 1,
                updatedAt: "2026-08-29T02:01:00.000Z",
              },
              sourceContext: current.envelope.sourceContext,
            },
            current.summary.recordVersion,
            current.summary.draftSnapshotId
          )
          if (!newer.ok) throw new Error("Expected the injected newer head")
        }
        return originalResolve(...arguments_)
      }
    )

    let result: Awaited<ReturnType<Editor["reloadSavedAfterConflict"]>> | null =
      null
    await act(async () => {
      result = await captured.current!.reloadSavedAfterConflict()
    })

    expect(result).toEqual({ ok: true, destination: "document" })
    expect(injected).toBe(true)
    expect(captured.current?.document.name).toBe("Newest durable head")
    expect(captured.current?.conflictRecoveryState).toEqual({
      status: "inactive",
    })
  })

  it("keeps an empty repository on Start and never persists the private bootstrap", async () => {
    const captured = await mount()

    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")

    await settleEffects(650)
    const inspector = repository("empty-repository-inspector")
    const listed = await inspector.list({ state: "all" })

    expect(listed).toEqual({
      ok: true,
      page: { items: [], nextCursor: null, recoveryItems: [] },
    })
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY) === null).toBe(true)
    expect(repositoryLifecycle(captured.current!)).toMatchObject({
      status: "ready",
    })
    expect(claimsDurableSave(captured.current!)).toBe(false)
  })

  it("leaves corrupt-list recovery to the retained document library owner", async () => {
    const hookRepository = repository("corrupt-only-list-hook")
    vi.spyOn(hookRepository, "list").mockResolvedValue({
      ok: true,
      page: {
        items: [],
        nextCursor: null,
        recoveryItems: [recoveryItem("quarantined")],
      },
    })

    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    expect(captured.current?.startModel).toMatchObject({
      status: "ready",
      durable: true,
      storageWarning: null,
    })
    expect(hookRepository.list).not.toHaveBeenCalled()
    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")
    expect(await captured.current?.continueSessionDocument()).toBe(false)
    expect(claimsDurableSave(captured.current!)).toBe(false)

    let created = false
    await act(async () => {
      created = await captured.current!.createBlankDocument({
        name: "Recovery-aware blank",
        width: 1200,
        height: 800,
      })
    })
    expect(created).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current!.startModel).toMatchObject({
      status: "ready",
      storageWarning: null,
    })
  })

  it("opens a healthy exact ID without creating a second Start list owner", async () => {
    const envelope = designEnvelope()
    const hookRepository = repository("mixed-recovery-list-hook")
    const created = await hookRepository.create(
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
    if (!created.ok) throw new Error("Expected repository fixture creation")
    vi.spyOn(hookRepository, "list").mockResolvedValue({
      ok: true,
      page: {
        items: [created.record.summary],
        nextCursor: null,
        recoveryItems: [recoveryItem("retained")],
      },
    })

    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
        durable: true,
        storageWarning: null,
      })
    })
    expect(hookRepository.list).not.toHaveBeenCalled()

    let continued = false
    await act(async () => {
      continued = await captured.current!.openStoredDocument(
        envelope.document.id
      )
    })
    expect(continued).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(captured.current?.startModel).toMatchObject({
      status: "ready",
      storageWarning: null,
    })
    expect(captured.current?.localSaveState.status).toBe("saved")
  })

  it("exposes opening then a blocked repository without claiming durability", async () => {
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
    const blockedRepository = new DocumentDraftRepository({
      indexedDB: blockedFactory,
      sessionId: "blocked-repository",
    })

    const captured = await mount(() => blockedRepository)
    await settleEffects()

    expect(
      captured.renders.some(
        (editor) => repositoryLifecycle(editor).status === "opening"
      )
    ).toBe(true)
    expect(repositoryLifecycle(captured.current!)).toMatchObject({
      status: "blocked",
      failure: {
        kind: "blocked",
        message: expect.stringMatching(/blocked.*other Studio tab/i),
      },
    })
    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")
    expect(claimsDurableSave(captured.current!)).toBe(false)
  })

  it("exposes repository unavailability instead of projecting an empty durable start", async () => {
    const unavailableFactory = {
      open: () => {
        throw new Error("IndexedDB denied by browser policy")
      },
    } as unknown as IDBFactory
    const unavailableRepository = new DocumentDraftRepository({
      indexedDB: unavailableFactory,
      sessionId: "unavailable-repository",
    })

    const captured = await mount(() => unavailableRepository)
    await settleEffects()

    expect(repositoryLifecycle(captured.current!)).toMatchObject({
      status: "unavailable",
      failure: {
        kind: "storage_unavailable",
        message: expect.stringContaining("IndexedDB denied by browser policy"),
      },
    })
    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")
    expect(claimsDurableSave(captured.current!)).toBe(false)
  })

  it("migrates exact source context durably but opens it only through Continue", async () => {
    const envelope = quotationEnvelope()
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, JSON.stringify(envelope))

    const hookRepository = repository("migration-hook")
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    const inspector = repository("migration-inspector")
    const migrated = await inspector.get(envelope.document.id)

    expect(migrated).toMatchObject({ ok: true, status: "found" })
    if (!migrated.ok || migrated.status !== "found") {
      throw new Error("Expected the current draft to migrate into IndexedDB")
    }
    expectExactSourceContext(migrated.record)
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY) === null).toBe(true)
    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")

    let continued = false
    await act(async () => {
      continued = await Promise.resolve(
        captured.current?.openStoredDocument(envelope.document.id) ?? false
      )
    })

    expect(continued).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(captured.current?.quotationSource).toEqual(
      envelope.sourceContext?.quotationSource
    )
    expect(captured.current?.activeQuotationTemplateId).toBe(
      envelope.sourceContext?.quotationTemplateId
    )
    expect(captured.current?.activeDesignTemplate).toEqual(
      envelope.sourceContext?.designTemplate
    )
  })

  it("opens a repository record with exact identity and source context", async () => {
    const envelope = designEnvelope()
    const drafts = repository("record-seeder")
    const created = await drafts.create(
      {
        document: envelope.document,
        sourceContext: envelope.sourceContext,
      },
      { kind: "quotation" }
    )
    if (!created.ok) throw new Error("Expected repository fixture creation")

    const hookRepository = repository("record-hook")
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")
    expect(captured.current?.startModel).toMatchObject({
      status: "ready",
    })

    let continued = false
    await act(async () => {
      continued = await Promise.resolve(
        captured.current?.openStoredDocument(envelope.document.id) ?? false
      )
    })

    expect(continued).toBe(true)
    expect(captured.current?.document.id).toBe(
      created.record.summary.documentId
    )
    expect(captured.current?.quotationSource).toEqual(
      created.record.envelope.sourceContext?.quotationSource
    )
    expect(captured.current?.activeQuotationTemplateId).toBe(
      created.record.envelope.sourceContext?.quotationTemplateId
    )
    expect(captured.current?.activeDesignTemplate).toEqual(
      created.record.envelope.sourceContext?.designTemplate
    )
  })

  it("opens the requested document ID when several active records exist", async () => {
    const firstEnvelope = quotationEnvelope()
    const requestedEnvelope = designEnvelope()
    const hookRepository = repository("exact-id-among-many")
    const first = await hookRepository.create(
      {
        document: firstEnvelope.document,
        sourceContext: firstEnvelope.sourceContext,
      },
      { kind: "quotation" }
    )
    const requested = await hookRepository.create(
      {
        document: requestedEnvelope.document,
        sourceContext: requestedEnvelope.sourceContext,
      },
      {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      }
    )
    if (!first.ok || !requested.ok) {
      throw new Error("Expected both exact-ID fixtures to be created")
    }
    const get = vi.spyOn(hookRepository, "get")
    const touchOpened = vi.spyOn(hookRepository, "touchOpened")
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    let opened = false
    await act(async () => {
      opened = await captured.current!.openStoredDocument(
        requested.record.summary.documentId
      )
    })

    expect(opened).toBe(true)
    expect(captured.current?.document).toEqual(
      requested.record.envelope.document
    )
    expect(captured.current?.document.id).not.toBe(
      first.record.summary.documentId
    )
    expect(get).toHaveBeenCalledWith(requested.record.summary.documentId)
    expect(touchOpened).toHaveBeenCalledWith(
      requested.record.summary.documentId
    )
  })

  it.each(["missing", "deleted", "corrupt"] as const)(
    "rejects an exact-ID open for a %s record without installing the private starter",
    async (caseName) => {
      const envelope = designEnvelope()
      const documentId =
        caseName === "missing" ? "missing-exact-document" : envelope.document.id
      const hookRepository = repository(`exact-id-${caseName}`)
      if (caseName !== "missing") {
        const created = await hookRepository.create(
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
        if (!created.ok) throw new Error("Expected exact-ID fixture creation")
        if (caseName === "deleted") {
          const deleted = await hookRepository.softDelete(
            documentId,
            created.record.summary.recordVersion
          )
          if (!deleted.ok) throw new Error("Expected exact-ID fixture deletion")
        }
      }
      const originalGet = hookRepository.get.bind(hookRepository)
      if (caseName === "corrupt") {
        vi.spyOn(hookRepository, "get").mockImplementation(
          async (requestedDocumentId) =>
            requestedDocumentId === documentId
              ? {
                  ok: false,
                  reason: "corrupt_record",
                  quarantineId: "quarantine-exact-corrupt",
                  failure: {
                    kind: "corrupt_record",
                    message: "The requested local document is corrupt.",
                  },
                }
              : originalGet(requestedDocumentId)
        )
      }
      const touchOpened = vi.spyOn(hookRepository, "touchOpened")
      const captured = await mount(() => hookRepository)
      await vi.waitFor(() => {
        expect(repositoryLifecycle(captured.current!)).toMatchObject({
          status: "ready",
        })
      })

      let opened = true
      await act(async () => {
        opened = await captured.current!.openStoredDocument(documentId)
      })

      expect(opened).toBe(false)
      expect(captured.current?.sessionMode).toBe("start")
      expect(captured.current?.document.id).toBe("private-bootstrap-document")
      expect(touchOpened).not.toHaveBeenCalled()
      expect(captured.current?.documentError).toBeTruthy()
    }
  )

  it.each(["missing", "deleted", "corrupt"] as const)(
    "preserves the exact active workspace and persistence session when a different %s ID cannot open",
    async (caseName) => {
      const activeEnvelope = quotationEnvelope()
      let acquireLease: ReturnType<typeof vi.spyOn> | null = null
      const { captured, hookRepository } = await openEnvelope(
        activeEnvelope,
        `active-workspace-${caseName}`,
        (persistence) => {
          acquireLease = vi.spyOn(persistence, "acquireLease")
        }
      )
      expect(acquireLease).toHaveBeenCalledTimes(1)
      const activeHistory = exactHistory(captured.current!)
      const activeSaveState = captured.current!.localSaveState
      const activeDurable = await readRecord(
        hookRepository,
        activeEnvelope.document.id
      )
      const targetEnvelope = designEnvelope()
      let targetDocumentId = `${caseName}-different-document`
      if (caseName === "deleted") {
        const target = await hookRepository.create(
          {
            document: targetEnvelope.document,
            sourceContext: targetEnvelope.sourceContext,
          },
          {
            kind: "template",
            templateId: "editorial-one-pager",
            templateVersion: 1,
          }
        )
        if (!target.ok) throw new Error("Expected deleted target creation")
        targetDocumentId = target.record.summary.documentId
        const deleted = await hookRepository.softDelete(
          targetDocumentId,
          target.record.summary.recordVersion
        )
        if (!deleted.ok) throw new Error("Expected target deletion")
      }
      if (caseName === "corrupt") {
        const originalGet = hookRepository.get.bind(hookRepository)
        vi.spyOn(hookRepository, "get").mockImplementation(
          async (documentId) =>
            documentId === targetDocumentId
              ? {
                  ok: false,
                  reason: "corrupt_record",
                  quarantineId: "different-target-quarantine",
                  failure: {
                    kind: "corrupt_record",
                    message: "The different target is corrupt.",
                  },
                }
              : originalGet(documentId)
        )
      }

      await act(async () => {
        expect(
          await captured.current!.openStoredDocument(targetDocumentId)
        ).toBe(false)
      })

      expect(captured.current?.sessionMode).toBe("workspace")
      expect(captured.current?.document.id).toBe(activeEnvelope.document.id)
      expect(captured.current?.document.id).not.toBe(
        "private-bootstrap-document"
      )
      expect(exactHistory(captured.current!)).toEqual(activeHistory)
      expect(captured.current?.localSaveState).toEqual(activeSaveState)
      expect(acquireLease).toHaveBeenCalledTimes(1)
      await act(async () => {
        expect(await captured.current!.flushActiveDraft()).toBe(true)
      })
      expect(
        await readRecord(hookRepository, activeEnvelope.document.id)
      ).toEqual(activeDurable)
    }
  )

  it.each(["missing", "corrupt"] as const)(
    "keeps the private Start session when the initial exact read is %s",
    async (caseName) => {
      const envelope = designEnvelope()
      const hookRepository = repository(`initial-${caseName}-start-card`)
      const created = await hookRepository.create(
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
      if (!created.ok) throw new Error("Expected exact-ID fixture creation")
      const captured = await mount(() => hookRepository)
      await vi.waitFor(() => {
        expect(captured.current?.startModel).toMatchObject({
          status: "ready",
        })
      })
      vi.spyOn(hookRepository, "get").mockResolvedValue(
        caseName === "missing"
          ? { ok: true, status: "missing" }
          : {
              ok: false,
              reason: "corrupt_record",
              quarantineId: "initial-read-quarantine",
              failure: {
                kind: "corrupt_record",
                message: "The requested local document is corrupt.",
              },
            }
      )

      await act(async () => {
        expect(
          await captured.current!.openStoredDocument(
            created.record.summary.documentId
          )
        ).toBe(false)
      })

      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
      })
      expect(captured.current?.sessionMode).toBe("start")
    }
  )

  it("leaves an unrelated stored document untouched after another exact read goes missing", async () => {
    const firstEnvelope = quotationEnvelope()
    const secondEnvelope = designEnvelope()
    const hookRepository = repository("unrelated-newer-start-card")
    const first = await hookRepository.create(
      {
        document: firstEnvelope.document,
        sourceContext: firstEnvelope.sourceContext,
      },
      { kind: "quotation" }
    )
    const second = await hookRepository.create(
      {
        document: secondEnvelope.document,
        sourceContext: secondEnvelope.sourceContext,
      },
      {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      }
    )
    if (!first.ok || !second.ok) {
      throw new Error("Expected both Start card fixtures to be created")
    }
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
      })
    })
    const requestedDocumentId = first.record.summary.documentId
    const retainedDocumentId = second.record.summary.documentId
    const originalGet = hookRepository.get.bind(hookRepository)
    vi.spyOn(hookRepository, "get").mockImplementation(async (documentId) =>
      documentId === requestedDocumentId
        ? { ok: true, status: "missing" }
        : originalGet(documentId)
    )

    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(requestedDocumentId)
      ).toBe(false)
    })

    expect(captured.current?.startModel).toMatchObject({
      status: "ready",
    })
    expect(await readRecord(hookRepository, retainedDocumentId)).toEqual(
      second.record
    )
  })

  it("opens verified bytes when touchOpened fails because storage is unavailable", async () => {
    const envelope = designEnvelope()
    const hookRepository = repository("exact-id-touch-fallback")
    const created = await hookRepository.create(
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
    if (!created.ok) throw new Error("Expected exact-ID fixture creation")
    vi.spyOn(hookRepository, "touchOpened").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Recent activity could not be updated.",
      },
    })
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    let opened = false
    await act(async () => {
      opened = await captured.current!.openStoredDocument(
        created.record.summary.documentId
      )
    })

    expect(opened).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document).toEqual(created.record.envelope.document)
    expect(captured.current?.documentError).toMatch(
      /opened from verified local bytes.*Recent activity could not be updated/i
    )
  })

  it("keeps a foreign head change stronger than the touch warning when verified-byte fallback installs", async () => {
    const openEnvelopeFixture = quotationEnvelope()
    const targetEnvelope = designEnvelope()
    const seeder = repository("touch-fallback-foreign-seeder")
    const current = await seeder.create(
      {
        document: openEnvelopeFixture.document,
        sourceContext: openEnvelopeFixture.sourceContext,
      },
      { kind: "quotation" }
    )
    const target = await seeder.create(
      {
        document: targetEnvelope.document,
        sourceContext: targetEnvelope.sourceContext,
      },
      {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      }
    )
    if (!current.ok || !target.ok) {
      throw new Error("Expected touch fallback race fixtures")
    }
    const incoming = repositoryWithIncomingEvents("touch-fallback-foreign-hook")
    let releaseFlush: (() => void) | null = null
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    let deferFlush = false
    let flushStarted = false
    const originalFlush = DocumentDraftSaveController.prototype.flush
    vi.spyOn(DocumentDraftSaveController.prototype, "flush").mockImplementation(
      async function (this: DocumentDraftSaveController) {
        if (deferFlush) {
          flushStarted = true
          await flushGate
        }
        return originalFlush.call(this)
      }
    )
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(
          current.record.summary.documentId
        )
      ).toBe(true)
    })
    vi.spyOn(incoming.repository, "touchOpened").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Recent activity could not be updated.",
      },
    })
    deferFlush = true

    let openPromise = Promise.resolve(false)
    await act(async () => {
      openPromise = captured.current!.openStoredDocument(
        target.record.summary.documentId
      )
      await vi.waitFor(() => expect(flushStarted).toBe(true))
    })
    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "content_saved",
        documentId: target.record.summary.documentId,
        recordVersion: target.record.summary.recordVersion + 1,
        contentSnapshotId: `sha256-${"1".repeat(64)}`,
        draftSnapshotId: `sha256-${"2".repeat(64)}`,
        sessionId: "foreign-touch-fallback-session",
      })
      releaseFlush?.()
    })

    let opened = false
    await act(async () => {
      opened = await openPromise
    })

    expect(opened).toBe(true)
    expect(captured.current?.localSaveState).toEqual({
      status: "external_change",
      reason: "saved_elsewhere",
      observedRecordVersion: target.record.summary.recordVersion + 1,
    })
    expect(captured.current?.documentError).toMatch(
      /changed in another Studio session/i
    )
    expect(captured.current?.documentError).not.toMatch(
      /Recent activity could not be updated/i
    )
  })

  it("keeps an accepted exact-ID open authoritative over later Home and replacement requests", async () => {
    const envelope = designEnvelope()
    const hookRepository = repository("exact-id-transition-owner")
    const created = await hookRepository.create(
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
    if (!created.ok) throw new Error("Expected exact-ID fixture creation")
    const originalGet = hookRepository.get.bind(hookRepository)
    let resolveGet: ((record: DocumentDraftRecord) => void) | null = null
    const getGate = new Promise<DocumentDraftRecord>((resolve) => {
      resolveGet = resolve
    })
    let getStarted = false
    vi.spyOn(hookRepository, "get").mockImplementation(async (documentId) => {
      if (documentId !== created.record.summary.documentId) {
        return originalGet(documentId)
      }
      getStarted = true
      return { ok: true, status: "found", record: await getGate }
    })
    const create = vi.spyOn(hookRepository, "create")
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    let openPromise = Promise.resolve(false)
    await act(async () => {
      openPromise = captured.current!.openStoredDocument(
        created.record.summary.documentId
      )
      await vi.waitFor(() => expect(getStarted).toBe(true))
    })

    await act(async () => {
      expect(await captured.current!.returnToStart()).toBe(false)
      expect(
        await captured.current!.createBlankDocument({
          name: "Rejected late replacement",
          width: 1200,
          height: 800,
        })
      ).toBe(false)
    })
    expect(create).not.toHaveBeenCalled()

    let opened = false
    await act(async () => {
      resolveGet?.(created.record)
      opened = await openPromise
    })

    expect(opened).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(
      created.record.summary.documentId
    )
  })

  it("keeps exact-ID admission independent from the library controller's list failures", async () => {
    const targetEnvelope = designEnvelope()
    const differentEnvelope = quotationEnvelope()
    const seeder = repository("opening-readiness-seeder")
    const target = await seeder.create(
      {
        document: targetEnvelope.document,
        sourceContext: targetEnvelope.sourceContext,
      },
      {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      }
    )
    const different = await seeder.create(
      {
        document: differentEnvelope.document,
        sourceContext: differentEnvelope.sourceContext,
      },
      { kind: "quotation" }
    )
    if (!target.ok || !different.ok) {
      throw new Error("Expected both readiness-race fixtures to be created")
    }
    const incoming = repositoryWithIncomingEvents("opening-readiness-hook")
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    if (!captured.persistence) {
      throw new Error("Expected mounted persistence")
    }
    const acquireLease = vi.spyOn(captured.persistence, "acquireLease")
    const originalGet = incoming.repository.get.bind(incoming.repository)
    let resolveGet: ((record: DocumentDraftRecord) => void) | null = null
    const getGate = new Promise<DocumentDraftRecord>((resolve) => {
      resolveGet = resolve
    })
    let getStarted = false
    vi.spyOn(incoming.repository, "get").mockImplementation(
      async (documentId) => {
        if (documentId !== target.record.summary.documentId) {
          return originalGet(documentId)
        }
        getStarted = true
        return { ok: true, status: "found", record: await getGate }
      }
    )
    vi.spyOn(incoming.repository, "list").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "The invalidation refresh could not read local storage.",
      },
    })

    let openPromise = Promise.resolve(false)
    await act(async () => {
      openPromise = captured.current!.openStoredDocument(
        target.record.summary.documentId
      )
      await vi.waitFor(() => expect(getStarted).toBe(true))
    })
    let activity: Awaited<ReturnType<typeof incoming.repository.touchOpened>>
    await act(async () => {
      activity = await incoming.repository.touchOpened(
        different.record.summary.documentId
      )
    })
    expect(activity!.ok).toBe(true)
    let opened = false
    await act(async () => {
      resolveGet?.(target.record)
      opened = await openPromise
    })

    expect(opened).toBe(true)
    expect(acquireLease).toHaveBeenCalledTimes(1)
    expect(incoming.repository.list).not.toHaveBeenCalled()
    expect(repositoryLifecycle(captured.current!)).toMatchObject({
      status: "ready",
    })
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(target.record.summary.documentId)
  })

  it.each(["saved", "deleted", "restored", "quarantined"] as const)(
    "never installs an exact-ID open as clean when a foreign %s event arrives between touch and install",
    async (eventType) => {
      const openEnvelopeFixture = quotationEnvelope()
      const targetEnvelope = designEnvelope()
      const seeder = repository(`opening-${eventType}-seeder`)
      const current = await seeder.create(
        {
          document: openEnvelopeFixture.document,
          sourceContext: openEnvelopeFixture.sourceContext,
        },
        { kind: "quotation" }
      )
      const target = await seeder.create(
        {
          document: targetEnvelope.document,
          sourceContext: targetEnvelope.sourceContext,
        },
        {
          kind: "template",
          templateId: "editorial-one-pager",
          templateVersion: 1,
        }
      )
      if (!current.ok || !target.ok) {
        throw new Error("Expected both opening-race fixtures to be created")
      }
      const incoming = repositoryWithIncomingEvents(`opening-${eventType}-hook`)
      let releaseFlush: (() => void) | null = null
      const flushGate = new Promise<void>((resolve) => {
        releaseFlush = resolve
      })
      let deferFlush = false
      let flushStarted = false
      const originalFlush = DocumentDraftSaveController.prototype.flush
      vi.spyOn(
        DocumentDraftSaveController.prototype,
        "flush"
      ).mockImplementation(async function (this: DocumentDraftSaveController) {
        if (deferFlush) {
          flushStarted = true
          await flushGate
        }
        return originalFlush.call(this)
      })
      const captured = await mount(() => incoming.repository)
      await vi.waitFor(() => {
        expect(repositoryLifecycle(captured.current!)).toMatchObject({
          status: "ready",
        })
      })
      await act(async () => {
        expect(
          await captured.current!.openStoredDocument(
            current.record.summary.documentId
          )
        ).toBe(true)
      })
      deferFlush = true

      let openPromise = Promise.resolve(false)
      await act(async () => {
        openPromise = captured.current!.openStoredDocument(
          target.record.summary.documentId
        )
        await vi.waitFor(() => expect(flushStarted).toBe(true))
      })

      await act(async () => {
        incoming.deliver(
          eventType === "saved"
            ? {
                type: "saved",
                reason: "content_saved",
                documentId: target.record.summary.documentId,
                recordVersion: target.record.summary.recordVersion + 4,
                contentSnapshotId: `sha256-${"a".repeat(64)}`,
                draftSnapshotId: `sha256-${"b".repeat(64)}`,
                sessionId: "foreign-opening-session",
              }
            : eventType === "deleted" || eventType === "restored"
              ? {
                  type: eventType,
                  documentId: target.record.summary.documentId,
                  recordVersion: target.record.summary.recordVersion + 1,
                  sessionId: "foreign-opening-session",
                }
              : {
                  type: "quarantined",
                  documentId: target.record.summary.documentId,
                  quarantineId: "foreign-opening-quarantine",
                  sessionId: "foreign-opening-session",
                }
        )
        if (eventType === "saved") {
          incoming.deliver({
            type: "saved",
            reason: "content_saved",
            documentId: target.record.summary.documentId,
            recordVersion: target.record.summary.recordVersion + 3,
            contentSnapshotId: `sha256-${"c".repeat(64)}`,
            draftSnapshotId: `sha256-${"d".repeat(64)}`,
            sessionId: "delayed-older-opening-session",
          })
        }
        await Promise.resolve()
      })

      let opened = false
      await act(async () => {
        releaseFlush?.()
        opened = await openPromise
      })

      expect(opened).toBe(true)
      expect(captured.current?.document.id).toBe(
        target.record.summary.documentId
      )
      expect(captured.current?.localSaveState).toEqual(
        eventType === "saved" || eventType === "restored"
          ? {
              status: "external_change",
              reason: "saved_elsewhere",
              observedRecordVersion:
                target.record.summary.recordVersion +
                (eventType === "saved" ? 4 : 1),
            }
          : {
              status: "external_change",
              reason:
                eventType === "quarantined"
                  ? "quarantined_elsewhere"
                  : "deleted_elsewhere",
              observedRecordVersion:
                eventType === "deleted"
                  ? target.record.summary.recordVersion + 1
                  : target.record.summary.recordVersion,
            }
      )
      expect(captured.current?.documentError).toMatch(
        eventType === "saved" || eventType === "restored"
          ? /changed in another Studio session/i
          : eventType === "deleted"
            ? /deleted in another Studio session/i
            : /quarantined/i
      )
    }
  )

  it("uses the local opened commit as an authoritative barrier over pre-touch repository hints", async () => {
    const envelope = designEnvelope()
    const seeder = repository("opening-barrier-seeder")
    const target = await seeder.create(
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
    if (!target.ok) throw new Error("Expected opening-barrier fixture")
    const incoming = repositoryWithIncomingEvents("opening-barrier-hook")
    const originalGet = incoming.repository.get.bind(incoming.repository)
    let resolveGet: ((record: DocumentDraftRecord) => void) | null = null
    const getGate = new Promise<DocumentDraftRecord>((resolve) => {
      resolveGet = resolve
    })
    let getStarted = false
    vi.spyOn(incoming.repository, "get").mockImplementation(
      async (documentId) => {
        if (documentId !== target.record.summary.documentId) {
          return originalGet(documentId)
        }
        getStarted = true
        return { ok: true, status: "found", record: await getGate }
      }
    )
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })

    let openPromise = Promise.resolve(false)
    await act(async () => {
      openPromise = captured.current!.openStoredDocument(
        target.record.summary.documentId
      )
      await vi.waitFor(() => expect(getStarted).toBe(true))
    })
    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "content_saved",
        documentId: target.record.summary.documentId,
        recordVersion: target.record.summary.recordVersion + 4,
        contentSnapshotId: `sha256-${"e".repeat(64)}`,
        draftSnapshotId: `sha256-${"f".repeat(64)}`,
        sessionId: "stale-pre-touch-session",
      })
      resolveGet?.(target.record)
    })

    let opened = false
    await act(async () => {
      opened = await openPromise
    })

    expect(opened).toBe(true)
    expect(captured.current?.document.id).toBe(target.record.summary.documentId)
    expect(captured.current?.localSaveState.status).toBe("saved")
    expect(captured.current?.documentError).toBeNull()
  })

  it.each(["deleted", "restored"] as const)(
    "ignores a delayed version-two %s hint after touch verifies version three",
    async (eventType) => {
      const envelope = designEnvelope()
      const seeder = repository(`opening-stale-${eventType}-seeder`)
      const target = await seeder.create(
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
      if (!target.ok) throw new Error("Expected stale-event fixture")
      const incoming = repositoryWithIncomingEvents(
        `opening-stale-${eventType}-hook`
      )
      const originalTouch = incoming.repository.touchOpened.bind(
        incoming.repository
      )
      vi.spyOn(incoming.repository, "touchOpened").mockImplementation(
        async (documentId) => {
          const touched = await originalTouch(documentId)
          if (!touched.ok) return touched
          incoming.deliver({
            type: eventType,
            documentId,
            recordVersion: 2,
            sessionId: `delayed-${eventType}-session`,
          })
          return {
            ok: true,
            value: {
              ...touched.value,
              summary: { ...touched.value.summary, recordVersion: 3 },
            },
          }
        }
      )
      const captured = await mount(() => incoming.repository)
      await vi.waitFor(() => {
        expect(repositoryLifecycle(captured.current!)).toMatchObject({
          status: "ready",
        })
      })

      let opened = false
      await act(async () => {
        opened = await captured.current!.openStoredDocument(
          target.record.summary.documentId
        )
      })

      expect(opened).toBe(true)
      expect(captured.current?.document.id).toBe(
        target.record.summary.documentId
      )
      expect(captured.current?.localSaveState).toMatchObject({
        status: "saved",
        recordVersion: 3,
      })
      expect(captured.current?.documentError).toBeNull()
    }
  )

  it("keeps opening metadata events out of the removed Start list owner", async () => {
    const openEnvelopeFixture = quotationEnvelope()
    const targetEnvelope = designEnvelope()
    const seeder = repository("opening-metadata-seeder")
    const current = await seeder.create(
      {
        document: openEnvelopeFixture.document,
        sourceContext: openEnvelopeFixture.sourceContext,
      },
      { kind: "quotation" }
    )
    const target = await seeder.create(
      {
        document: targetEnvelope.document,
        sourceContext: targetEnvelope.sourceContext,
      },
      {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 1,
      }
    )
    if (!current.ok || !target.ok) {
      throw new Error("Expected both metadata-race fixtures to be created")
    }
    const incoming = repositoryWithIncomingEvents("opening-metadata-hook")
    const list = vi.spyOn(incoming.repository, "list")
    let releaseFlush: (() => void) | null = null
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    let deferFlush = false
    let flushStarted = false
    const originalFlush = DocumentDraftSaveController.prototype.flush
    vi.spyOn(DocumentDraftSaveController.prototype, "flush").mockImplementation(
      async function (this: DocumentDraftSaveController) {
        if (deferFlush) {
          flushStarted = true
          await flushGate
        }
        return originalFlush.call(this)
      }
    )
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(
          current.record.summary.documentId
        )
      ).toBe(true)
    })
    deferFlush = true

    let openPromise = Promise.resolve(false)
    await act(async () => {
      openPromise = captured.current!.openStoredDocument(
        target.record.summary.documentId
      )
      await vi.waitFor(() => expect(flushStarted).toBe(true))
    })
    list.mockClear()

    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "opened",
        documentId: target.record.summary.documentId,
        recordVersion: target.record.summary.recordVersion,
        contentSnapshotId: target.record.summary.contentSnapshotId,
        draftSnapshotId: target.record.summary.draftSnapshotId,
        sessionId: incoming.repository.sessionId,
      })
      await Promise.resolve()
    })
    expect(list).not.toHaveBeenCalled()

    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "opened",
        documentId: target.record.summary.documentId,
        recordVersion: target.record.summary.recordVersion,
        contentSnapshotId: target.record.summary.contentSnapshotId,
        draftSnapshotId: target.record.summary.draftSnapshotId,
        sessionId: "foreign-opening-session",
      })
      incoming.deliver({
        type: "saved",
        reason: "publication_linked",
        documentId: target.record.summary.documentId,
        recordVersion: target.record.summary.recordVersion,
        contentSnapshotId: target.record.summary.contentSnapshotId,
        draftSnapshotId: target.record.summary.draftSnapshotId,
        sessionId: "foreign-publication-session",
      })
      await Promise.resolve()
    })
    expect(list).not.toHaveBeenCalled()

    let opened = false
    await act(async () => {
      releaseFlush?.()
      opened = await openPromise
    })

    expect(opened).toBe(true)
    expect(captured.current?.document.id).toBe(target.record.summary.documentId)
    expect(captured.current?.localSaveState.status).toBe("saved")
    expect(captured.current?.documentError).toBeNull()
  })

  it("persists an ordinary editor commit as the exact controller snapshot", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "ordinary-edit"
    )

    await act(async () => {
      captured.current?.addRectangle()
    })
    const editedDocument = structuredClone(captured.current!.document)
    expect(
      editedDocument.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)

    await settleEffects(450)
    const saved = await readRecord(hookRepository, envelope.document.id)

    expect(saved.summary.recordVersion).toBe(created.summary.recordVersion + 1)
    expect(saved.envelope.document).toEqual(editedDocument)
    expect(saved.envelope.sourceContext).toEqual(envelope.sourceContext)
    expect(captured.current?.localSaveState).toMatchObject({
      status: "saved",
      recordVersion: saved.summary.recordVersion,
    })
  })

  it("never replays an origin-global publication cache into the active workspace", async () => {
    const envelope = designEnvelope()
    const cached = createTemplateVersion(envelope.document, {
      id: "template-version-foreign-workspace",
      templateId: `template-${envelope.document.id}`,
      version: 9,
      sourceSnapshotId: "legacy-foreign-workspace-snapshot",
      publishedAt: "2026-08-28T20:00:00.000Z",
    })
    localStorage.setItem(
      "webmcp-studio:published-versions:v1",
      JSON.stringify([cached])
    )
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "template_not_found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await openEnvelope(envelope, "principal-isolation")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toEqual([])
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  })

  it("joins concurrent publication callers before the first await", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-single-flight"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const head = await readRecord(hookRepository, envelope.document.id)
    let resolvePublication: ((response: Response) => void) | undefined
    const response = new Promise<Response>((resolve) => {
      resolvePublication = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_, init) =>
        init?.method === "POST"
          ? response
          : Promise.resolve(new Response(null, { status: 404 }))
      )
    vi.stubGlobal("fetch", fetchMock)

    let first: Promise<TemplateVersion> | undefined
    let second: Promise<TemplateVersion> | undefined
    await act(async () => {
      first = captured.current!.publishTemplate()
      second = captured.current!.publishTemplate()
      expect(first).toBe(second)
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
        ).toHaveLength(1)
      )
    })

    const publicationCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST"
    )
    const request = JSON.parse(
      String(publicationCall?.[1]?.body)
    ) as PublishRequestBody
    const authoritative = createTemplateVersion(request.document, {
      id: request.id,
      templateId: request.templateId,
      version: request.version,
      sourceSnapshotId: head.summary.contentSnapshotId,
      publishedAt: request.publishedAt,
    })
    await act(async () => {
      resolvePublication?.(
        new Response(JSON.stringify(authoritative), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
      await expect(first).resolves.toEqual(authoritative)
      await expect(second).resolves.toEqual(authoritative)
    })
  })

  it("rejects publication when replacement starts and settles during the publish response", async () => {
    const envelope = publicationRaceEnvelope()
    const getExactDetail = vi.fn(publicationRaceMediaPorts.getExactDetail)
    const resolveCurated = vi.fn(publicationRaceMediaPorts.resolveCurated)
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-image-replacement-race",
      undefined,
      {
        libraryMediaPreparationPorts: {
          ...publicationRaceMediaPorts,
          getExactDetail,
          resolveCurated,
        },
      }
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const head = await readRecord(hookRepository, envelope.document.id)
    const releaseFabric =
      captured.current!.registerImageReplacementRendererOwner("fabric")
    const releaseReact =
      captured.current!.registerImageReplacementRendererOwner("react")
    const linkPublication = vi.spyOn(hookRepository, "linkPublication")
    const sourceImage = captured.current!.document.nodes.find(
      (node) => node.type === "image"
    )
    if (sourceImage?.type !== "image") {
      throw new Error("Expected a publishable image fixture.")
    }
    const sourcePage = captured.current!.document.pages.find((page) =>
      page.nodeIds.includes(sourceImage.id)
    )
    if (!sourcePage) throw new Error("Expected the image fixture page.")
    let resolvePublication!: (response: Response) => void
    const publicationResponse = new Promise<Response>((resolve) => {
      resolvePublication = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) =>
        init?.method === "POST"
          ? publicationResponse
          : Promise.resolve(new Response(null, { status: 404 }))
      )
    vi.stubGlobal("fetch", fetchMock)

    let publishing!: Promise<TemplateVersion>
    await act(async () => {
      publishing = captured.current!.publishTemplate()
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
        ).toHaveLength(1)
      )
    })

    let replacement!: Promise<"committed" | "no_op" | "rejected">
    let replacementOutcome: "committed" | "no_op" | "rejected" | undefined
    await act(async () => {
      replacement = captured.current!.performLibraryMediaAction({
        correlationId: "publication-image-replacement-race",
        detail: publicationRaceMediaDetail,
        target: {
          type: "replace",
          pageId: sourcePage.id,
          nodeId: sourceImage.id,
        },
      })
      void replacement.then((outcome) => {
        replacementOutcome = outcome
      })
    })
    await act(async () => {
      await vi.waitFor(() => expect(getExactDetail).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(resolveCurated).toHaveBeenCalledOnce())
      await vi.waitFor(
        () =>
          expect(
            captured.current!.pendingImageReplacement ?? replacementOutcome
          ).toBeTruthy(),
        { timeout: 5_000 }
      )
    })
    expect(replacementOutcome).toBeUndefined()
    releaseReact()
    await act(async () => {
      await expect(replacement).resolves.toBe("rejected")
    })
    expect(captured.current!.pendingImageReplacement).toBeNull()

    const publicationCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST"
    )
    const request = JSON.parse(
      String(publicationCall?.[1]?.body)
    ) as PublishRequestBody
    const authoritative = createTemplateVersion(request.document, {
      id: request.id,
      templateId: request.templateId,
      version: request.version,
      sourceSnapshotId: head.summary.contentSnapshotId,
      publishedAt: request.publishedAt,
    })
    resolvePublication(
      new Response(JSON.stringify(authoritative), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    )

    await expect(publishing).rejects.toThrow(
      IMAGE_REPLACEMENT_OUTPUT_STALE_REASON
    )
    expect(linkPublication).not.toHaveBeenCalled()
    releaseFabric()
  }, 15_000)

  it("refuses to publish a snapshot changed after exact approval", async () => {
    const envelope = designEnvelope()
    const { captured } = await openEnvelope(
      envelope,
      "publication-exact-approval"
    )
    const expected = {
      documentId: captured.current!.document.id,
      revision: captured.current!.document.revision,
      snapshotId: captured.current!.snapshotId,
    }
    await act(async () => {
      captured.current!.addRectangle()
    })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      await expect(captured.current!.publishTemplate(expected)).rejects.toThrow(
        /changed after publication approval/i
      )
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not join an exact publication to another snapshot owner", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-exact-single-flight"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const head = await readRecord(hookRepository, envelope.document.id)
    const expectedA = {
      documentId: captured.current!.document.id,
      revision: captured.current!.document.revision,
      snapshotId: captured.current!.snapshotId,
    }
    let resolvePublication: ((response: Response) => void) | undefined
    const publicationResponse = new Promise<Response>((resolve) => {
      resolvePublication = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) =>
        init?.method === "POST"
          ? publicationResponse
          : Promise.resolve(new Response(null, { status: 404 }))
      )
    vi.stubGlobal("fetch", fetchMock)

    let publishingA: Promise<TemplateVersion> | undefined
    await act(async () => {
      publishingA = captured.current!.publishTemplate(expectedA)
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
        ).toHaveLength(1)
      )
      captured.current!.addRectangle()
    })
    const expectedB = {
      documentId: captured.current!.document.id,
      revision: captured.current!.document.revision,
      snapshotId: captured.current!.snapshotId,
    }

    await expect(captured.current!.publishTemplate(expectedB)).rejects.toThrow(
      /another publication owns a different document snapshot/i
    )

    const publicationCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST"
    )
    const request = JSON.parse(
      String(publicationCall?.[1]?.body)
    ) as PublishRequestBody
    const authoritative = createTemplateVersion(request.document, {
      id: request.id,
      templateId: request.templateId,
      version: request.version,
      sourceSnapshotId: head.summary.contentSnapshotId,
      publishedAt: request.publishedAt,
    })
    await act(async () => {
      resolvePublication?.(
        new Response(JSON.stringify(authoritative), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
      await expect(publishingA).resolves.toEqual(authoritative)
    })
  })

  it("aborts an externally owned publication before any later server request", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-external-abort"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const durable = await hookRepository.get(envelope.document.id)
    let releaseRead: (() => void) | undefined
    const delayedRead = new Promise<typeof durable>((resolve) => {
      releaseRead = () => resolve(durable)
    })
    const getSpy = vi
      .spyOn(hookRepository, "get")
      .mockImplementationOnce(() => delayedRead)
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    const expected = {
      documentId: captured.current!.document.id,
      revision: captured.current!.document.revision,
      snapshotId: captured.current!.snapshotId,
    }

    let publishing: Promise<TemplateVersion> | undefined
    await act(async () => {
      publishing = captured.current!.publishTemplate(expected, {
        signal: controller.signal,
      })
      await vi.waitFor(() => expect(getSpy).toHaveBeenCalledOnce())
      controller.abort(
        new DOMException("WebMCP registration was replaced.", "AbortError")
      )
      await expect(publishing).rejects.toMatchObject({ name: "AbortError" })
    })

    releaseRead?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("holds publication ownership until an aborting transport acknowledges cancel", async () => {
    const envelope = designEnvelope()
    const { captured } = await openEnvelope(
      envelope,
      "publication-cancel-acknowledgement"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    let releaseAbort: (() => void) | undefined
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              releaseAbort = () => reject(init.signal?.reason)
            },
            { once: true }
          )
        })
      })
    vi.stubGlobal("fetch", fetchMock)

    let publishing: Promise<TemplateVersion> | undefined
    await act(async () => {
      publishing = captured.current!.publishTemplate()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      expect(captured.current!.cancelPublication()).toBe(true)
      expect(captured.current!.publishTemplate()).toBe(publishing)
    })
    expect(captured.current!.publishSyncStatus).toBe("cancelling")

    await act(async () => {
      releaseAbort?.()
      await expect(publishing).rejects.toMatchObject({ name: "AbortError" })
    })
    expect(captured.current!.publishSyncStatus).toBe("status_unknown")
    expect(captured.current!.publishError).toMatch(/status is unknown/i)
  })

  it("recovers a stale cross-browser version ordinal under one operation", async () => {
    const envelope = quotationEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-version-recovery"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const head = await readRecord(hookRepository, envelope.document.id)
    const postedVersions: number[] = []
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_, init) => {
        if (init?.method !== "POST") {
          return new Response(null, { status: 404 })
        }
        const request = JSON.parse(String(init.body)) as PublishRequestBody
        postedVersions.push(request.version)
        if (postedVersions.length === 1) {
          return new Response(
            JSON.stringify({
              error: { code: "version_conflict", expectedVersion: 3 },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          )
        }
        return new Response(
          JSON.stringify(
            createTemplateVersion(request.document, {
              id: request.id,
              templateId: request.templateId,
              version: request.version,
              sourceSnapshotId: head.summary.contentSnapshotId,
              publishedAt: request.publishedAt,
            })
          ),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      })
    vi.stubGlobal("fetch", fetchMock)

    let published: TemplateVersion | undefined
    await act(async () => {
      published = await captured.current!.publishTemplate()
    })

    expect(postedVersions).toEqual([1, 3])
    expect(published?.version).toBe(3)
    expect(published?.templateId).toBe(`template-${envelope.document.id}`)
    expect(captured.current!.publishedVersions).toEqual([published])
  })

  it("links an authoritative publication to the exact durable head", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-link"
    )

    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const head = await readRecord(hookRepository, envelope.document.id)
    const authoritative = createTemplateVersion(head.envelope.document, {
      id: "template-version-authoritative-exact",
      templateId: `template-${head.summary.documentId}`,
      version: 4,
      sourceSnapshotId: head.summary.contentSnapshotId,
      publishedAt: "2026-08-28T21:15:00.000Z",
    })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? new Response(JSON.stringify(authoritative), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(null, { status: 404 })
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    let published: TemplateVersion | undefined
    await act(async () => {
      published = await captured.current!.publishTemplate()
    })

    expect(published).toEqual(authoritative)
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(1)
    const linked = await readRecord(hookRepository, envelope.document.id)
    expect(linked.summary).toEqual({
      ...head.summary,
      lastPublished: {
        templateId: authoritative.templateId,
        templateVersionId: authoritative.id,
        templateVersion: authoritative.version,
        contentSnapshotId: head.summary.contentSnapshotId,
        publishedAt: authoritative.publishedAt,
      },
    })
    expect(linked.envelope).toEqual(head.envelope)
  })

  it("keeps a newer durable head unmarked when publication finishes late", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "publication-stale-head"
    )

    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const publishingHead = await readRecord(
      hookRepository,
      envelope.document.id
    )
    let resolvePublication: ((response: Response) => void) | undefined
    const publicationResponse = new Promise<Response>((resolve) => {
      resolvePublication = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_, init) =>
        init?.method === "POST"
          ? publicationResponse
          : Promise.resolve(new Response(null, { status: 404 }))
      )
    vi.stubGlobal("fetch", fetchMock)
    const linkPublication = vi.spyOn(hookRepository, "linkPublication")

    let publishPromise: Promise<TemplateVersion> | undefined
    await act(async () => {
      publishPromise = captured.current!.publishTemplate()
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
        ).toHaveLength(1)
      )
    })

    await act(async () => {
      captured.current!.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const newerHead = await readRecord(hookRepository, envelope.document.id)
    expect(newerHead.summary.recordVersion).toBe(
      publishingHead.summary.recordVersion + 1
    )
    expect(newerHead.summary.contentSnapshotId).not.toBe(
      publishingHead.summary.contentSnapshotId
    )

    const [, requestInit] = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST"
    ) ?? [undefined, undefined]
    expect(typeof requestInit?.body).toBe("string")
    const request = JSON.parse(String(requestInit?.body)) as PublishRequestBody
    const authoritative = createTemplateVersion(request.document, {
      id: "template-version-authoritative-late",
      templateId: request.templateId,
      version: 7,
      sourceSnapshotId: publishingHead.summary.contentSnapshotId,
      publishedAt: "2026-08-28T21:20:00.000Z",
    })

    let published: TemplateVersion | undefined
    await act(async () => {
      resolvePublication?.(
        new Response(JSON.stringify(authoritative), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      published = await publishPromise
    })

    expect(published).toEqual(authoritative)
    expect(linkPublication).toHaveBeenCalledOnce()
    expect(await linkPublication.mock.results[0].value).toMatchObject({
      ok: false,
      reason: "stale_head",
      current: {
        recordVersion: newerHead.summary.recordVersion,
        contentSnapshotId: newerHead.summary.contentSnapshotId,
        lastPublished: null,
      },
    })
    expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
      newerHead
    )
    expect(captured.current?.documentError).toBe(
      "Publication succeeded, and newer local edits remain unpublished."
    )
    expect(captured.current?.publishSyncStatus).toBe("idle")
  })

  it("refuses publication for a session-only document", async () => {
    const unavailableFactory = {
      open: () => {
        throw new Error("IndexedDB denied by browser policy")
      },
    } as unknown as IDBFactory
    const unavailableRepository = new DocumentDraftRepository({
      indexedDB: unavailableFactory,
      sessionId: "session-only-publication",
    })
    const captured = await mount(() => unavailableRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "unavailable",
      })
    })
    await act(async () => {
      expect(
        await captured.current!.createBlankDocument({
          name: "Session-only publication",
          width: 1200,
          height: 800,
        })
      ).toBe(true)
    })
    expect(captured.current?.localSaveState.status).toBe("session_only")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    let refusal: unknown
    await act(async () => {
      try {
        await captured.current!.publishTemplate()
      } catch (error) {
        refusal = error
      }
    })

    expect(refusal).toEqual(
      new Error(
        "Publishing requires durable browser document storage. Download your version and restore storage access before publishing."
      )
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("persists the new source context when a design template disconnects quotation data", async () => {
    const envelope = quotationEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "template-context"
    )

    let applied = false
    await act(async () => {
      applied = await applyExactLibraryTemplate(
        captured.current!,
        "bold-square-announcement",
        1
      )
    })
    expect(applied).toBe(true)
    const exactDocument = structuredClone(captured.current!.document)
    const exactContext = {
      quotationSource: captured.current!.quotationSource,
      quotationTemplateId: captured.current!.activeQuotationTemplateId,
      designTemplate: captured.current!.activeDesignTemplate,
    }
    expect(exactContext).toEqual({
      quotationSource: null,
      quotationTemplateId: quotationStarter.templateId,
      designTemplate: { id: "bold-square-announcement", version: 1 },
    })

    let flushed = false
    await act(async () => {
      flushed = await captured.current!.flushActiveDraft()
    })
    expect(flushed).toBe(true)
    const saved = await readRecord(hookRepository, envelope.document.id)

    expect(saved.summary.recordVersion).toBe(created.summary.recordVersion + 1)
    expect(saved.envelope.document).toEqual(exactDocument)
    expect(saved.envelope.sourceContext).toEqual(exactContext)
  })

  it("keeps exact library apply resolution read-only until confirmation", async () => {
    const envelope = quotationEnvelope()
    const { captured } = await openEnvelope(envelope, "library-action-confirm")
    const before = structuredClone(captured.current!.document)
    let resolved: Awaited<ReturnType<Editor["resolveApplyLibraryTemplate"]>> =
      null

    await act(async () => {
      resolved = await captured.current!.resolveApplyLibraryTemplate({
        itemKind: "template",
        id: "bold-square-announcement",
        version: 1,
      })
    })

    expect(resolved).not.toBeNull()
    expect(captured.current!.document).toEqual(before)
    expect(resolved).toMatchObject({
      action: "apply",
      intent: {
        itemKind: "template",
        id: "bold-square-announcement",
        version: 1,
      },
      detail: {
        materialization: {
          templateId: "bold-square-announcement",
          templateVersion: 1,
        },
      },
    })

    let applied = false
    await act(async () => {
      applied = await captured.current!.confirmApplyLibraryTemplate(resolved!)
    })

    expect(applied).toBe(true)
    expect(captured.current!.document).not.toEqual(before)
    expect(captured.current!.activeDesignTemplate).toEqual({
      id: "bold-square-announcement",
      version: 1,
    })
  })

  it("rejects a template apply when canvas admission closes during confirmation", async () => {
    const envelope = quotationEnvelope()
    const { captured } = await openEnvelope(
      envelope,
      "library-action-runtime-admission"
    )
    const before = captured.current!.document
    const beforeSnapshotId = captured.current!.snapshotId
    const beforeOperationVersion = captured.current!.operationVersion
    const resolved = await captured.current!.resolveApplyLibraryTemplate({
      itemKind: "template",
      id: "bold-square-announcement",
      version: 1,
    })
    expect(resolved).not.toBeNull()
    let admitted = true
    let confirmation!: Promise<boolean>

    await act(async () => {
      confirmation = captured.current!.confirmApplyLibraryTemplate(resolved!, {
        admitCommit: () => admitted,
      })
      admitted = false
      await expect(confirmation).resolves.toBe(false)
    })

    expect(captured.current!.document).toBe(before)
    expect(captured.current!.snapshotId).toBe(beforeSnapshotId)
    expect(captured.current!.operationVersion).toBe(beforeOperationVersion)
  })

  it("records Recent once after the exact created document becomes durable and active", async () => {
    const envelope = quotationEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "library-create-records-recent"
    )
    const recordUsed = vi.fn(async () => true)

    let created = false
    await act(async () => {
      created = await createLibraryTemplateDocument(
        {
          itemKind: "template",
          id: "quotation-midnight-film",
          version: 4,
        },
        {
          resolve: captured.current!.resolveCreateFromLibraryTemplate,
          confirm: captured.current!.confirmCreateFromLibraryTemplate,
          recordUsed,
        }
      )
    })

    expect(created).toBe(true)
    const createdDocumentId = captured.current!.document.id
    expect(createdDocumentId).not.toBe(envelope.document.id)
    expect(await readRecord(hookRepository, createdDocumentId)).toMatchObject({
      summary: { documentId: createdDocumentId, deletedAt: null },
      envelope: { document: { id: createdDocumentId } },
    })
    await vi.waitFor(() => expect(recordUsed).toHaveBeenCalledOnce())
    expect(recordUsed).toHaveBeenCalledWith(
      {
        itemKind: "template",
        id: "quotation-midnight-film",
        version: 4,
      },
      "Midnight Film",
      "create",
      createdDocumentId
    )
  })

  it("keeps a successful session-only template creation out of Recent", async () => {
    const unavailableFactory = {
      open: () => {
        throw new Error("IndexedDB denied by browser policy")
      },
    } as unknown as IDBFactory
    const unavailableRepository = new DocumentDraftRepository({
      indexedDB: unavailableFactory,
      sessionId: "session-only-library-create",
    })
    const captured = await mount(() => unavailableRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "unavailable",
      })
    })
    const recordUsed = vi.fn(async () => true)

    let created = false
    await act(async () => {
      created = await createLibraryTemplateDocument(
        {
          itemKind: "template",
          id: "editorial-one-pager",
          version: 1,
        },
        {
          resolve: captured.current!.resolveCreateFromLibraryTemplate,
          confirm: captured.current!.confirmCreateFromLibraryTemplate,
          recordUsed,
        }
      )
    })

    expect(created).toBe(true)
    expect(captured.current!.localSaveState.status).toBe("session_only")
    expect(recordUsed).not.toHaveBeenCalled()
  })

  it("keeps a failed durable template creation out of Recent", async () => {
    const envelope = quotationEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "library-create-failure-no-recent"
    )
    vi.spyOn(hookRepository, "create").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Injected template creation failure",
      },
    })
    const recordUsed = vi.fn(async () => true)

    let created = true
    await act(async () => {
      created = await createLibraryTemplateDocument(
        {
          itemKind: "template",
          id: "quotation-midnight-film",
          version: 4,
        },
        {
          resolve: captured.current!.resolveCreateFromLibraryTemplate,
          confirm: captured.current!.confirmCreateFromLibraryTemplate,
          recordUsed,
        }
      )
    })

    expect(created).toBe(false)
    expect(captured.current!.document.id).toBe(envelope.document.id)
    expect(recordUsed).not.toHaveBeenCalled()
  })

  it("does not let caller-owned resolved snapshot state forge create authority", async () => {
    const envelope = quotationEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "library-create-private-authority"
    )
    let resolvedAction!: ResolvedTemplateAction

    await act(async () => {
      const resolved = await captured.current!.resolveCreateFromLibraryTemplate(
        {
          itemKind: "template",
          id: "bold-square-announcement",
          version: 1,
        }
      )
      if (resolved) resolvedAction = resolved
    })
    expect(resolvedAction).toBeDefined()

    const node = captured.current!.document.nodes[0]
    await act(async () => {
      expect(
        captured.current!.updateNode(node.id, {
          opacity: Math.max(0, node.opacity - 0.1),
        })
      ).toBe(true)
    })
    const authoritativeDocument = structuredClone(captured.current!.document)
    const writableSnapshot = resolvedAction.snapshot as {
      document: ResolvedTemplateAction["snapshot"]["document"]
      documentGeneration: number
    }
    writableSnapshot.document = captured.current!.document
    writableSnapshot.documentGeneration = captured.current!.operationVersion
    const create = vi.spyOn(hookRepository, "create")

    let confirmed: Awaited<
      ReturnType<Editor["confirmCreateFromLibraryTemplate"]>
    > = { succeeded: true, completionId: null }
    await act(async () => {
      confirmed =
        await captured.current!.confirmCreateFromLibraryTemplate(resolvedAction)
    })

    expect(confirmed).toEqual({ succeeded: false, completionId: null })
    expect(create).not.toHaveBeenCalled()
    expect(captured.current!.document).toEqual(authoritativeDocument)
    expect(captured.current!.document.id).toBe(envelope.document.id)
  })

  it("keeps a deferred template install owned when later resolve and cancel requests arrive", async () => {
    const envelope = quotationEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "library-create-owned-install"
    )
    let resolved: Awaited<
      ReturnType<Editor["resolveCreateFromLibraryTemplate"]>
    > = null
    await act(async () => {
      resolved = await captured.current!.resolveCreateFromLibraryTemplate({
        itemKind: "template",
        id: "quotation-midnight-film",
        version: 4,
      })
    })
    expect(resolved).not.toBeNull()

    const originalCreate = hookRepository.create.bind(hookRepository)
    let releaseCreate: (() => void) | null = null
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    let createStarted = false
    const create = vi
      .spyOn(hookRepository, "create")
      .mockImplementation(async (...arguments_) => {
        createStarted = true
        await createGate
        return originalCreate(...arguments_)
      })

    let confirmation!: ReturnType<Editor["confirmCreateFromLibraryTemplate"]>
    await act(async () => {
      confirmation = captured.current!.confirmCreateFromLibraryTemplate(
        resolved!
      )
      await vi.waitFor(() => expect(createStarted).toBe(true))
    })

    let laterResolution: Awaited<
      ReturnType<Editor["resolveCreateFromLibraryTemplate"]>
    > = resolved
    await act(async () => {
      laterResolution =
        await captured.current!.resolveCreateFromLibraryTemplate({
          itemKind: "template",
          id: "bold-square-announcement",
          version: 1,
        })
      captured.current!.cancelLibraryTemplateAction()
    })
    expect(laterResolution).toBeNull()
    expect(captured.current!.document.id).toBe(envelope.document.id)

    let confirmed: Awaited<typeof confirmation> = {
      succeeded: false,
      completionId: null,
    }
    await act(async () => {
      releaseCreate?.()
      confirmed = await confirmation
    })

    expect(confirmed).toEqual({
      succeeded: true,
      completionId: captured.current!.document.id,
    })
    expect(create).toHaveBeenCalledOnce()
    expect(captured.current!.document.id).not.toBe(envelope.document.id)
    expect(captured.current!.activeDesignTemplate).toEqual({
      id: "quotation-midnight-film",
      version: 4,
    })
  })

  it("does not install a deferred template document after mounted authority is invalidated", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "library-create-unmounted-install"
    )
    let resolved: Awaited<
      ReturnType<Editor["resolveCreateFromLibraryTemplate"]>
    > = null
    await act(async () => {
      resolved = await captured.current!.resolveCreateFromLibraryTemplate({
        itemKind: "template",
        id: "bold-square-announcement",
        version: 1,
      })
    })
    expect(resolved).not.toBeNull()

    const originalCreate = hookRepository.create.bind(hookRepository)
    let releaseCreate: (() => void) | null = null
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    let createStarted = false
    const create = vi
      .spyOn(hookRepository, "create")
      .mockImplementation(async (...arguments_) => {
        createStarted = true
        await createGate
        return originalCreate(...arguments_)
      })

    let confirmation!: ReturnType<Editor["confirmCreateFromLibraryTemplate"]>
    await act(async () => {
      confirmation = captured.current!.confirmCreateFromLibraryTemplate(
        resolved!
      )
      await vi.waitFor(() => expect(createStarted).toBe(true))
    })

    await act(async () => root.unmount())
    root = createRoot(host)
    let confirmed: Awaited<typeof confirmation> = {
      succeeded: true,
      completionId: "unexpected",
    }
    await act(async () => {
      releaseCreate?.()
      confirmed = await confirmation
    })

    expect(confirmed).toEqual({ succeeded: false, completionId: null })
    expect(create).toHaveBeenCalledOnce()
    expect(captured.current!.document.id).toBe(envelope.document.id)
    expect(captured.current!.getActiveDocumentId()).toBeNull()
  })

  it("persists Undo and Redo with their exact historical source contexts", async () => {
    const envelope = quotationEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "history-context"
    )
    const originalRevision = envelope.document.revision

    await act(async () => {
      expect(
        await applyExactLibraryTemplate(
          captured.current!,
          "bold-square-announcement",
          1
        )
      ).toBe(true)
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const applied = await readRecord(hookRepository, envelope.document.id)
    expect(applied).toMatchObject({
      summary: { recordVersion: created.summary.recordVersion + 1 },
      envelope: {
        document: { revision: originalRevision + 1 },
        sourceContext: {
          quotationSource: null,
          designTemplate: { id: "bold-square-announcement", version: 1 },
        },
      },
    })

    await act(async () => {
      captured.current?.undo()
    })
    expect(captured.current?.document.revision).toBe(originalRevision)
    expect(captured.current?.quotationSource).toEqual(
      envelope.sourceContext?.quotationSource
    )
    expect(captured.current?.activeDesignTemplate).toEqual(
      envelope.sourceContext?.designTemplate
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const undone = await readRecord(hookRepository, envelope.document.id)
    expect(undone.summary.recordVersion).toBe(applied.summary.recordVersion + 1)
    expect(undone.envelope.document.revision).toBe(originalRevision)
    expect(undone.envelope.sourceContext).toEqual(envelope.sourceContext)

    await act(async () => {
      captured.current?.redo()
    })
    expect(captured.current?.document.revision).toBe(originalRevision + 1)
    expect(captured.current?.quotationSource).toBeNull()
    expect(captured.current?.activeDesignTemplate).toEqual({
      id: "bold-square-announcement",
      version: 1,
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const redone = await readRecord(hookRepository, envelope.document.id)
    expect(redone.summary.recordVersion).toBe(undone.summary.recordVersion + 1)
    expect(redone.envelope.document).toEqual(applied.envelope.document)
    expect(redone.envelope.sourceContext).toEqual(
      applied.envelope.sourceContext
    )
  })

  it("keeps Home pending until the active controller flush becomes durable", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "deferred-home"
    )
    const originalSave = hookRepository.save.bind(hookRepository)
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    let saveStarted = false
    vi.spyOn(hookRepository, "save").mockImplementation(
      async (...arguments_) => {
        saveStarted = true
        await saveGate
        return originalSave(...arguments_)
      }
    )
    await act(async () => {
      captured.current?.addRectangle()
    })

    let homeSettled = false
    let homePromise = Promise.resolve(false)
    await act(async () => {
      homePromise = captured.current!.returnToStart()
      void homePromise.then(() => {
        homeSettled = true
      })
      await Promise.resolve()
    })

    expect(saveStarted).toBe(true)
    expect(homeSettled).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")

    let returnedHome = false
    await act(async () => {
      releaseSave?.()
      returnedHome = await homePromise
    })

    expect(returnedHome).toBe(true)
    expect(captured.current?.sessionMode).toBe("start")
    const saved = await readRecord(hookRepository, envelope.document.id)
    expect(saved.summary.recordVersion).toBe(created.summary.recordVersion + 1)
  })

  it("refuses Home when the durable write fails and retains the in-memory edit", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "failed-home"
    )
    vi.spyOn(hookRepository, "save").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Injected local storage failure",
      },
    })
    await act(async () => {
      captured.current?.addRectangle()
    })

    let returnedHome = true
    await act(async () => {
      returnedHome = await captured.current!.returnToStart()
    })

    expect(returnedHome).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.localSaveState).toEqual({
      status: "failed",
      message: "Injected local storage failure",
      retryable: true,
    })
    expect(
      captured.current?.document.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(created.summary.recordVersion)
  })

  it("keeps session replacement pending until the previous controller is durable", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "deferred-replacement"
    )
    const originalSave = hookRepository.save.bind(hookRepository)
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    let saveStarted = false
    vi.spyOn(hookRepository, "save").mockImplementation(
      async (...arguments_) => {
        saveStarted = true
        await saveGate
        return originalSave(...arguments_)
      }
    )
    await act(async () => {
      captured.current?.addRectangle()
    })

    let replacementSettled = false
    let replacementPromise = Promise.resolve(false)
    await act(async () => {
      replacementPromise = captured.current!.createBlankDocument({
        name: "Replacement after durable drain",
        width: 1600,
        height: 900,
      })
      void replacementPromise.then(() => {
        replacementSettled = true
      })
      await vi.waitFor(() => {
        expect(saveStarted).toBe(true)
      })
    })

    expect(replacementSettled).toBe(false)
    expect(captured.current?.document.id).toBe(envelope.document.id)

    let replaced = false
    await act(async () => {
      releaseSave?.()
      replaced = await replacementPromise
    })

    expect(replaced).toBe(true)
    expect(captured.current?.document.name).toBe(
      "Replacement after durable drain"
    )
    expect(captured.current?.document.id).not.toBe(envelope.document.id)
    const savedPrevious = await readRecord(hookRepository, envelope.document.id)
    expect(savedPrevious.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(
      savedPrevious.envelope.document.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)
  })

  it("lets a synchronously accepted replacement finish before a later Home request", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "replacement-owner-before-home"
    )
    const originalCreate = hookRepository.create.bind(hookRepository)
    let releaseCreate: (() => void) | null = null
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    let createStarted = false
    vi.spyOn(hookRepository, "create").mockImplementation(
      async (...arguments_) => {
        createStarted = true
        await createGate
        return originalCreate(...arguments_)
      }
    )

    let replacementPromise = Promise.resolve(false)
    await act(async () => {
      replacementPromise = captured.current!.createBlankDocument({
        name: "First-owned replacement",
        width: 1600,
        height: 900,
      })
      await vi.waitFor(() => expect(createStarted).toBe(true))
    })

    let returnedHome = true
    await act(async () => {
      returnedHome = await captured.current!.returnToStart()
    })
    expect(returnedHome).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)

    let replaced = false
    await act(async () => {
      releaseCreate?.()
      replaced = await replacementPromise
    })
    expect(replaced).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.name).toBe("First-owned replacement")
    expect(captured.current?.document.id).not.toBe(envelope.document.id)
  })

  it("rejects replacement while Home owns teardown and retires the exact session once", async () => {
    const envelope = designEnvelope()
    let releaseFlush: (() => void) | null = null
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    let deferFlush = false
    let flushStarted = false
    const originalFlush = DocumentDraftSaveController.prototype.flush
    const flush = vi
      .spyOn(DocumentDraftSaveController.prototype, "flush")
      .mockImplementation(async function (this: DocumentDraftSaveController) {
        if (deferFlush) {
          flushStarted = true
          await flushGate
        }
        return originalFlush.call(this)
      })
    const close = vi.spyOn(DocumentDraftSaveController.prototype, "close")
    const releaseLease = vi.fn()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "home-owner-before-replacement",
      (persistence) => {
        const acquireLease = persistence.acquireLease
        vi.spyOn(persistence, "acquireLease").mockImplementation(() => {
          const release = acquireLease()
          let active = true
          return () => {
            if (!active) return
            active = false
            releaseLease()
            release()
          }
        })
      }
    )
    const create = vi.spyOn(hookRepository, "create")
    close.mockClear()
    releaseLease.mockClear()
    deferFlush = true

    let homePromise = Promise.resolve(false)
    await act(async () => {
      homePromise = captured.current!.returnToStart()
      await vi.waitFor(() => expect(flushStarted).toBe(true))
    })

    let replaced = true
    await act(async () => {
      replaced = await captured.current!.createBlankDocument({
        name: "Rejected late replacement",
        width: 1600,
        height: 900,
      })
    })
    expect(replaced).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(close).not.toHaveBeenCalled()
    expect(releaseLease).not.toHaveBeenCalled()

    let returnedHome = false
    await act(async () => {
      releaseFlush?.()
      returnedHome = await homePromise
    })
    expect(returnedHome).toBe(true)
    expect(captured.current?.sessionMode).toBe("start")
    expect(flush).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(releaseLease).toHaveBeenCalledTimes(1)
  })

  it("retains the exact old session and lease when an overlapping replacement flush fails", async () => {
    const envelope = designEnvelope()
    const close = vi.spyOn(DocumentDraftSaveController.prototype, "close")
    const releaseLease = vi.fn()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "overlapping-failed-flush",
      (persistence) => {
        const acquireLease = persistence.acquireLease
        vi.spyOn(persistence, "acquireLease").mockImplementation(() => {
          const release = acquireLease()
          let active = true
          return () => {
            if (!active) return
            active = false
            releaseLease()
            release()
          }
        })
      }
    )
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    let saveStarted = false
    vi.spyOn(hookRepository, "save").mockImplementation(async () => {
      saveStarted = true
      await saveGate
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: {
          kind: "storage_unavailable",
          message: "Injected overlapping transition failure",
        },
      }
    })
    const create = vi.spyOn(hookRepository, "create")
    await act(async () => {
      captured.current?.addRectangle()
    })

    let replacementPromise = Promise.resolve(false)
    await act(async () => {
      replacementPromise = captured.current!.createBlankDocument({
        name: "Must not install after failed overlap",
        width: 1600,
        height: 900,
      })
      await vi.waitFor(() => expect(saveStarted).toBe(true))
    })
    let returnedHome = true
    await act(async () => {
      returnedHome = await captured.current!.returnToStart()
    })
    expect(returnedHome).toBe(false)

    let replaced = true
    await act(async () => {
      releaseSave?.()
      replaced = await replacementPromise
    })
    expect(replaced).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(captured.current?.localSaveState).toEqual({
      status: "failed",
      message: "Injected overlapping transition failure",
      retryable: true,
    })
    expect(create).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(releaseLease).not.toHaveBeenCalled()
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(created.summary.recordVersion)
  })

  it("admits only the first of two same-tick replacements", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "same-tick-replacements"
    )
    const originalCreate = hookRepository.create.bind(hookRepository)
    let releaseCreate: (() => void) | null = null
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    let createStarted = false
    const create = vi
      .spyOn(hookRepository, "create")
      .mockImplementation(async (...arguments_) => {
        createStarted = true
        await createGate
        return originalCreate(...arguments_)
      })

    let firstPromise = Promise.resolve(false)
    let secondPromise = Promise.resolve(true)
    await act(async () => {
      firstPromise = captured.current!.createBlankDocument({
        name: "First same-tick replacement",
        width: 1600,
        height: 900,
      })
      secondPromise = captured.current!.createBlankDocument({
        name: "Losing same-tick replacement",
        width: 1200,
        height: 1200,
      })
      await vi.waitFor(() => expect(createStarted).toBe(true))
    })

    expect(await secondPromise).toBe(false)
    expect(captured.current?.document.id).toBe(envelope.document.id)
    let firstReplaced = false
    await act(async () => {
      releaseCreate?.()
      firstReplaced = await firstPromise
    })
    expect(firstReplaced).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.name).toBe("First same-tick replacement")
    expect(captured.current?.operationVersion).toBe(0)

    const listed = await hookRepository.list({ state: "all", limit: 10 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error("Expected the replacement list")
    expect(listed.page.items).toHaveLength(2)
    expect(listed.page.items.map((item) => item.name)).toContain(
      "First same-tick replacement"
    )
    expect(listed.page.items.map((item) => item.name)).not.toContain(
      "Losing same-tick replacement"
    )
  })

  it("refuses session replacement when the previous controller cannot flush", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "failed-replacement"
    )
    vi.spyOn(hookRepository, "save").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Injected replacement drain failure",
      },
    })
    await act(async () => {
      captured.current?.addRectangle()
    })

    let replaced = true
    await act(async () => {
      replaced = await captured.current!.createBlankDocument({
        name: "Must not replace the active session",
        width: 1600,
        height: 900,
      })
    })

    expect(replaced).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(captured.current?.localSaveState).toEqual({
      status: "failed",
      message: "Injected replacement drain failure",
      retryable: true,
    })
    expect(
      captured.current?.document.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(created.summary.recordVersion)
  })

  it("refuses Home on a real compare-and-swap conflict and retains the candidate", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "conflict-home"
    )
    const otherTab = repository("conflict-other-tab")
    const externalDocument = {
      ...envelope.document,
      name: "Changed in another tab",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:01:00.000Z",
    }
    const external = await hookRepository.save(
      {
        document: externalDocument,
        sourceContext: envelope.sourceContext,
      },
      created.summary.recordVersion,
      created.summary.draftSnapshotId
    )
    expect(external).toMatchObject({
      ok: true,
      record: { summary: { recordVersion: created.summary.recordVersion + 1 } },
    })
    await act(async () => {
      captured.current?.addRectangle()
    })

    let returnedHome = true
    await act(async () => {
      returnedHome = await captured.current!.returnToStart()
    })

    expect(returnedHome).toBe(false)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.localSaveState).toMatchObject({
      status: "conflict",
      reason: "stale_write",
      conflictId: expect.any(String),
    })
    const conflicts = await otherTab.listConflicts(envelope.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          reason: "stale_write",
          expectedRecordVersion: created.summary.recordVersion,
          observedRecordVersion: created.summary.recordVersion + 1,
          candidate: { document: { id: envelope.document.id } },
        },
      ],
    })
    expect(
      captured.current?.document.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)
  })

  it("downloads the exact current envelope from a failed save without retrying or changing durable state", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "failed-download"
    )
    const save = vi.spyOn(hookRepository, "save").mockResolvedValue({
      ok: false,
      reason: "storage_unavailable",
      failure: {
        kind: "storage_unavailable",
        message: "Injected download-boundary storage failure",
      },
    })
    await act(async () => {
      captured.current?.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(false)
    })
    expect(captured.current?.localSaveState).toEqual({
      status: "failed",
      message: "Injected download-boundary storage failure",
      retryable: true,
    })

    const expectedEnvelope = currentEnvelope(captured.current!)
    const durableBefore = await readRecord(hookRepository, envelope.document.id)
    const conflictsBefore = await hookRepository.listConflicts(
      envelope.document.id
    )
    expect(conflictsBefore).toEqual({ ok: true, value: [] })
    const saveCallsBeforeDownload = save.mock.calls.length
    const download = captureDownload()

    let downloaded = false
    await act(async () => {
      downloaded = await captured.current!.downloadCurrentVersion()
    })
    await settleEffects(0)

    expect(downloaded).toBe(true)
    expect(save).toHaveBeenCalledTimes(saveCallsBeforeDownload)
    expect(download.createObjectURL).toHaveBeenCalledTimes(1)
    expect(download.click).toHaveBeenCalledTimes(1)
    expect(download.revokeObjectURL).toHaveBeenCalledWith(
      "blob:mounted-current-version"
    )
    expect(await download.text()).toBe(
      JSON.stringify(expectedEnvelope, null, 2)
    )
    expect(currentEnvelope(captured.current!)).toEqual(expectedEnvelope)
    expect(captured.current?.localSaveState.status).toBe("failed")
    expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
      durableBefore
    )
    expect(await hookRepository.listConflicts(envelope.document.id)).toEqual(
      conflictsBefore
    )
  })

  it("downloads the exact conflict candidate without another save or conflict mutation", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "conflict-download"
    )
    const otherTab = repository("conflict-download-other-tab")
    const externalDocument = {
      ...envelope.document,
      name: "External conflict winner",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:01:00.000Z",
    }
    const external = await hookRepository.save(
      {
        document: externalDocument,
        sourceContext: envelope.sourceContext,
      },
      created.summary.recordVersion,
      created.summary.draftSnapshotId
    )
    expect(external).toMatchObject({
      ok: true,
      record: { summary: { recordVersion: created.summary.recordVersion + 1 } },
    })
    const save = vi.spyOn(hookRepository, "save")
    await act(async () => {
      captured.current?.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(false)
    })
    expect(captured.current?.localSaveState).toMatchObject({
      status: "conflict",
      reason: "stale_write",
    })

    const expectedEnvelope = currentEnvelope(captured.current!)
    const durableBefore = await readRecord(otherTab, envelope.document.id)
    const conflictsBefore = await otherTab.listConflicts(envelope.document.id)
    expect(conflictsBefore).toMatchObject({
      ok: true,
      value: [
        {
          candidate: {
            document: expectedEnvelope.document,
            sourceContext: expectedEnvelope.sourceContext,
          },
        },
      ],
    })
    const saveCallsBeforeDownload = save.mock.calls.length
    const download = captureDownload()

    let downloaded = false
    await act(async () => {
      downloaded = await captured.current!.downloadCurrentVersion()
    })
    await settleEffects(0)

    expect(downloaded).toBe(true)
    expect(save).toHaveBeenCalledTimes(saveCallsBeforeDownload)
    expect(download.createObjectURL).toHaveBeenCalledTimes(1)
    expect(download.click).toHaveBeenCalledTimes(1)
    expect(download.revokeObjectURL).toHaveBeenCalledWith(
      "blob:mounted-current-version"
    )
    expect(await download.text()).toBe(
      JSON.stringify(expectedEnvelope, null, 2)
    )
    expect(currentEnvelope(captured.current!)).toEqual(expectedEnvelope)
    expect(captured.current?.localSaveState.status).toBe("conflict")
    expect(await readRecord(otherTab, envelope.document.id)).toEqual(
      durableBefore
    )
    expect(await otherTab.listConflicts(envelope.document.id)).toEqual(
      conflictsBefore
    )
  })

  it("rejects a different-id workspace import without changing history or durability", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "different-id-import"
    )
    const durableBefore = await readRecord(hookRepository, envelope.document.id)
    const historyBefore = {
      document: structuredClone(captured.current!.document),
      snapshotId: captured.current!.snapshotId,
      operationVersion: captured.current!.operationVersion,
      canUndo: captured.current!.canUndo,
      canRedo: captured.current!.canRedo,
      sourceContext: currentEnvelope(captured.current!).sourceContext,
    }
    const importedDocument = {
      ...structuredClone(envelope.document),
      id: "different-import-document",
      name: "Must not replace the active identity",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:02:00.000Z",
    }
    const save = vi.spyOn(hookRepository, "save")

    let imported = true
    await act(async () => {
      imported = await captured.current!.importDocumentFile(
        importFile(importedDocument)
      )
    })
    await settleEffects(450)

    expect(imported).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(captured.current?.document).toEqual(historyBefore.document)
    expect(captured.current?.snapshotId).toBe(historyBefore.snapshotId)
    expect(captured.current?.operationVersion).toBe(
      historyBefore.operationVersion
    )
    expect(captured.current?.canUndo).toBe(historyBefore.canUndo)
    expect(captured.current?.canRedo).toBe(historyBefore.canRedo)
    expect(currentEnvelope(captured.current!).sourceContext).toEqual(
      historyBefore.sourceContext
    )
    expect(captured.current?.documentError).toMatch(
      /different Studio document|document identity|document id/i
    )
    expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
      durableBefore
    )
    const listed = await hookRepository.list({ state: "all" })
    expect(listed).toMatchObject({
      ok: true,
      page: {
        items: [{ documentId: envelope.document.id }],
        nextCursor: null,
        recoveryItems: [],
      },
    })
  })

  it("allows a canonical same-id import and saves it through the active controller", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "same-id-import"
    )
    const importedDocument = {
      ...structuredClone(envelope.document),
      name: "Canonical in-place import",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:03:00.000Z",
    }
    const save = vi.spyOn(hookRepository, "save")

    let imported = false
    await act(async () => {
      imported = await captured.current!.importDocumentFile(
        importFile(importedDocument)
      )
    })
    expect(imported).toBe(true)
    expect(captured.current?.document).toEqual(importedDocument)
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toEqual({
      document: importedDocument,
      sourceContext: {
        quotationSource: null,
        quotationTemplateId: envelope.sourceContext?.quotationTemplateId,
        designTemplate: null,
      },
    })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(durable.envelope).toEqual({
      schemaVersion: 1,
      document: importedDocument,
      sourceContext: {
        quotationSource: null,
        quotationTemplateId: envelope.sourceContext?.quotationTemplateId,
        designTemplate: null,
      },
    })
  })

  it("blocks a differently identified quotation from replacing a linked draft", async () => {
    const envelope = quotationEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "quotation-import-identity"
    )
    const activeDocumentId = envelope.document.id
    const quotationSource = structuredClone(quotationStarter.source)
    quotationSource.source.quotationId = "quotation-from-another-system"
    quotationSource.source.revision += 1
    quotationSource.quote.quoteNumber = "Q-IDENTITY-IMPORT"
    quotationSource.quote.quoteVersion += 1
    const save = vi.spyOn(hookRepository, "save")
    let imported = true

    await act(async () => {
      imported = await captured.current!.importQuotationFile(
        jsonFile(quotationSource)
      )
    })

    expect(imported).toBe(false)
    expect(captured.current?.document.id).toBe(activeDocumentId)
    expect(captured.current?.document).toEqual(envelope.document)
    expect(captured.current?.quotationSource).toEqual(
      envelope.sourceContext?.quotationSource
    )
    expect(captured.current?.documentError).toContain(
      "belongs to another Stuwiz quotation"
    )
    expect(save).not.toHaveBeenCalled()
    const durable = await readRecord(hookRepository, activeDocumentId)
    expect(durable.summary.recordVersion).toBe(created.summary.recordVersion)
    expect(durable.envelope).toEqual(envelope)
  })

  it("previews and accepts a same-quotation refresh while preserving an explicit Studio edit", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "quotation-source-refresh"
    )
    await act(async () => {
      expect(
        await captured.current!.importQuotationFile(
          jsonFile(quotationStarter.source)
        )
      ).toBe(true)
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    await act(async () => {
      expect(
        await applyExactLibraryTemplate(
          captured.current!,
          "quotation-midnight-film",
          4
        )
      ).toBe(true)
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    expect(captured.current!.activeQuotationTemplateId).toBe("midnight-film")
    const detailNode = captured.current!.document.nodes.find(
      (node) => node.name === "Welcome dinner detail 1" && node.type === "text"
    )
    if (!detailNode || detailNode.type !== "text") {
      throw new Error("Expected quotation event detail fixture")
    }
    await act(async () => {
      expect(
        captured.current!.updateNode(detailNode.id, {
          text: "Studio-authored welcome dinner location",
        })
      ).toBe(true)
      await Promise.resolve()
    })
    const documentBeforePreview = captured.current!.getCurrentDocumentSnapshot()
    expect(
      documentBeforePreview.nodes.find(
        (node) => node.id === detailNode.id && node.type === "text"
      )
    ).toMatchObject({ text: "Studio-authored welcome dinner location" })
    const incoming = structuredClone(quotationStarter.source)
    incoming.source.revision += 1
    incoming.quote.quoteVersion += 1
    incoming.document.events[0].location = "Stuwiz-updated venue"

    let imported = false
    await act(async () => {
      imported = await captured.current!.importQuotationFile(jsonFile(incoming))
    })
    expect(imported, captured.current!.documentError ?? undefined).toBe(true)

    expect(captured.current!.document).toEqual(documentBeforePreview)
    expect(captured.current!.quotationSource).toEqual(quotationStarter.source)
    expect(captured.current!.quotationRefreshJournal.pending).toMatchObject({
      base: { sourceRevision: quotationStarter.source.source.revision },
      incoming: { sourceRevision: incoming.source.revision },
      appearanceTemplateId: "midnight-film",
    })
    expect(
      captured.current!.quotationRefreshJournal.pending?.impact.conflicts
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ semanticKey: "event.welcome.schedule" }),
      ])
    )
    const preparedProposalId =
      captured.current!.quotationRefreshJournal.pending!.proposalId

    await act(async () => {
      expect(
        await captured.current!.chooseQuotationRefreshConflict(
          "event.welcome.schedule",
          "preserve_studio"
        )
      ).toBe(true)
    })
    expect(
      captured.current!.quotationRefreshJournal.pending!.proposalId
    ).not.toBe(preparedProposalId)
    expect(
      captured.current!.quotationRefreshJournal.pending!
        .candidateContentSnapshotId
    ).toMatch(/^sha256-[a-f0-9]{64}$/)
    await act(async () => {
      expect(await captured.current!.acceptQuotationRefresh()).toBe(true)
    })

    expect(captured.current!.quotationSource).toEqual(incoming)
    expect(captured.current!.activeQuotationTemplateId).toBe("midnight-film")
    expect(captured.current!.quotationRefreshJournal.pending).toBeNull()
    expect(captured.current!.quotationRefreshJournal.resolved[0]).toMatchObject(
      {
        decision: "accepted",
        incoming: { sourceRevision: incoming.source.revision },
        collisionChoices: {
          "event.welcome.schedule": "preserve_studio",
        },
      }
    )
    expect(
      captured.current!.document.nodes.find(
        (node) => node.id === detailNode.id && node.type === "text"
      )
    ).toMatchObject({ text: "Studio-authored welcome dinner location" })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.envelope.quotationRefresh?.pending).toBeNull()
    expect(durable.envelope.quotationRefresh?.resolved[0]?.decision).toBe(
      "accepted"
    )
    expect(durable.envelope.sourceContext?.quotationSource).toEqual(incoming)
  })

  it("restores an exact pending quotation refresh after reopen and durably rejects it", async () => {
    const envelope = designEnvelope()
    const { captured, hookRepository } = await openEnvelope(
      envelope,
      "quotation-refresh-reopen"
    )
    await act(async () => {
      expect(
        await captured.current!.importQuotationFile(
          jsonFile(quotationStarter.source)
        )
      ).toBe(true)
    })
    const incoming = structuredClone(quotationStarter.source)
    incoming.source.revision += 1
    incoming.quote.quoteVersion += 1
    incoming.quote.quoteNumber = "Q-REFRESH-REOPEN"

    await act(async () => {
      expect(
        await captured.current!.importQuotationFile(jsonFile(incoming))
      ).toBe(true)
    })
    const beforeReopen = structuredClone(
      captured.current!.quotationRefreshJournal.pending
    )
    expect(beforeReopen).not.toBeNull()
    const durableBeforeReopen = await readRecord(
      hookRepository,
      envelope.document.id
    )

    await act(async () => root.unmount())
    root = createRoot(host)
    const reopenedRepository = repository("hook-quotation-refresh-reopened")
    const reopened = await mount(() => reopenedRepository, durableBeforeReopen)
    await vi.waitFor(() => {
      expect(reopened.current?.routeSessionStatus).toBe("ready")
    })
    expect(reopened.current!.quotationRefreshJournal.pending).toEqual(
      beforeReopen
    )
    expect(reopened.current!.document).toEqual(
      durableBeforeReopen.envelope.document
    )

    await act(async () => {
      expect(await reopened.current!.rejectQuotationRefresh()).toBe(true)
    })
    const durableAfterReject = await readRecord(
      reopenedRepository,
      envelope.document.id
    )
    expect(durableAfterReject.envelope.quotationRefresh?.pending).toBeNull()
    expect(
      durableAfterReject.envelope.quotationRefresh?.resolved[0]
    ).toMatchObject({
      decision: "rejected",
      incoming: { sourceRevision: incoming.source.revision },
    })
    expect(durableAfterReject.envelope.sourceContext?.quotationSource).toEqual(
      quotationStarter.source
    )
  })

  it("applies the explicit legacy layer organization as one undoable durable change", async () => {
    const envelope = quotationEnvelope()
    envelope.document = structuredClone(envelope.document)
    envelope.document.groups = []
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "legacy-layer-organization"
    )
    expect(captured.current?.quotationGroupOrganization.status).toBe(
      "available"
    )
    const before = currentEnvelope(captured.current!)

    await act(async () => {
      expect(captured.current?.upgradeQuotationLayerOrganization()).toBe(true)
    })

    const upgraded = currentEnvelope(captured.current!)
    expect(upgraded.document.groups.length).toBeGreaterThan(50)
    expect(upgraded.sourceContext?.composition).toEqual({
      status: "legacy_unknown",
      appliedMigrations: ["quotation.groups@2"],
    })
    expect({
      ...upgraded.document,
      groups: [],
      revision: before.document.revision,
      updatedAt: before.document.updatedAt,
    }).toEqual(before.document)

    await act(async () => captured.current?.undo())
    expect(currentEnvelope(captured.current!)).toEqual(before)
    expect(captured.current?.quotationGroupOrganization.status).toBe(
      "available"
    )

    await act(async () => captured.current?.redo())
    expect(currentEnvelope(captured.current!)).toEqual(upgraded)
    expect(captured.current?.quotationGroupOrganization.status).toBe(
      "already_current"
    )
    await act(async () => {
      expect(await captured.current?.flushActiveDraft()).toBe(true)
    })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(durable.envelope).toEqual(upgraded)
  })

  it("explicitly unlocks composer-v3 quotation text as one undoable durable change", async () => {
    const envelope = quotationEnvelope()
    if (!envelope.sourceContext) {
      throw new Error("Expected quotation source context fixture")
    }
    envelope.document = {
      ...structuredClone(envelope.document),
      nodes: envelope.document.nodes.map((node) =>
        node.type === "text" ? { ...node, locked: true } : node
      ),
    }
    envelope.sourceContext.designTemplate = {
      id: "quotation-editorial-olive",
      version: 3,
    }
    envelope.sourceContext.composition = await createKnownQuotationComposition(
      quotationStarter.source,
      { id: "quotation-editorial-olive", version: 3 },
      3
    )
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "quotation-text-editability"
    )
    expect(captured.current?.quotationTextEditability).toMatchObject({
      status: "available",
      impact: { unlockTextLayerCount: expect.any(Number) },
    })
    const before = currentEnvelope(captured.current!)

    await act(async () => {
      expect(captured.current?.upgradeQuotationTextEditability()).toBe(true)
    })

    const upgraded = currentEnvelope(captured.current!)
    expect(
      upgraded.document.nodes.filter((node) => node.type === "text")
    ).not.toHaveLength(0)
    expect(
      upgraded.document.nodes
        .filter((node) => node.type === "text")
        .every((node) => !node.locked)
    ).toBe(true)
    expect(
      upgraded.document.nodes
        .filter((node) => node.type !== "text")
        .every((node) => node.locked)
    ).toBe(true)
    expect(upgraded.sourceContext?.composition).toMatchObject({
      status: "known",
      composerVersion: 4,
      template: { id: "quotation-editorial-olive", version: 4 },
    })
    expect(upgraded.sourceContext?.designTemplate).toEqual({
      id: "quotation-editorial-olive",
      version: 4,
    })

    await act(async () => captured.current?.undo())
    expect(currentEnvelope(captured.current!)).toEqual(before)
    expect(captured.current?.quotationTextEditability.status).toBe("available")

    await act(async () => captured.current?.redo())
    expect(currentEnvelope(captured.current!)).toEqual(upgraded)
    expect(captured.current?.quotationTextEditability.status).toBe(
      "already_current"
    )
    await act(async () => {
      expect(await captured.current?.flushActiveDraft()).toBe(true)
    })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(durable.envelope).toEqual(upgraded)
  })

  it("explicitly records composer-v4 provenance when composer-v3 text is already editable", async () => {
    const envelope = quotationEnvelope()
    if (!envelope.sourceContext) {
      throw new Error("Expected quotation source context fixture")
    }
    envelope.document = {
      ...structuredClone(envelope.document),
      nodes: envelope.document.nodes.map((node) =>
        node.type === "text" ? { ...node, locked: false } : node
      ),
    }
    envelope.sourceContext.designTemplate = {
      id: "quotation-editorial-olive",
      version: 3,
    }
    envelope.sourceContext.composition = await createKnownQuotationComposition(
      quotationStarter.source,
      { id: "quotation-editorial-olive", version: 3 },
      3
    )
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "quotation-text-editability-zero-target"
    )
    expect(captured.current?.quotationTextEditability).toMatchObject({
      status: "available",
      targets: [],
      impact: { unlockTextLayerCount: 0 },
    })
    const before = currentEnvelope(captured.current!)
    const beforeLocks = before.document.nodes.map((node) => ({
      id: node.id,
      locked: node.locked,
    }))

    await act(async () => {
      expect(captured.current?.upgradeQuotationTextEditability()).toBe(true)
    })

    const upgraded = currentEnvelope(captured.current!)
    expect(
      upgraded.document.nodes.map((node) => ({
        id: node.id,
        locked: node.locked,
      }))
    ).toEqual(beforeLocks)
    expect(upgraded.sourceContext?.composition).toMatchObject({
      status: "known",
      composerVersion: 4,
      template: { id: "quotation-editorial-olive", version: 4 },
    })
    expect(upgraded.sourceContext?.designTemplate).toEqual({
      id: "quotation-editorial-olive",
      version: 4,
    })
    await act(async () => captured.current?.undo())
    expect(currentEnvelope(captured.current!)).toEqual(before)
    await act(async () => captured.current?.redo())
    expect(currentEnvelope(captured.current!)).toEqual(upgraded)
    await act(async () => {
      expect(await captured.current?.flushActiveDraft()).toBe(true)
    })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(durable.envelope).toEqual(upgraded)
  })

  it("ignores foreign open and publication metadata events so flush and Home remain available", async () => {
    const envelope = designEnvelope()
    const { captured, created } = await openEnvelope(
      envelope,
      "metadata-event-invalidation"
    )
    const otherTab = repository("metadata-event-invalidation-other-tab")
    expect(captured.current?.localSaveState.status).toBe("saved")

    await act(async () => {
      const touched = await otherTab.touchOpened(envelope.document.id)
      expect(touched).toMatchObject({
        ok: true,
        value: {
          summary: { recordVersion: created.summary.recordVersion },
        },
      })
      await pause(25)
    })
    expect(captured.current?.localSaveState.status).toBe("saved")
    expect(captured.current?.documentError).toBeNull()

    await act(async () => {
      const linked = await otherTab.linkPublication({
        documentId: envelope.document.id,
        recordVersion: created.summary.recordVersion,
        contentSnapshotId: created.summary.contentSnapshotId,
        templateId: "metadata-event-template",
        templateVersionId: "metadata-event-template-version-1",
        templateVersion: 1,
        publishedAt: "2026-08-28T21:12:00.000Z",
      })
      expect(linked).toMatchObject({
        ok: true,
        status: "linked",
        summary: {
          recordVersion: created.summary.recordVersion,
          lastPublished: {
            templateVersionId: "metadata-event-template-version-1",
          },
        },
      })
      await pause(25)
    })
    expect(captured.current?.localSaveState.status).toBe("saved")
    expect(captured.current?.documentError).toBeNull()

    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    let returnedHome = false
    await act(async () => {
      returnedHome = await captured.current!.returnToStart()
    })
    expect(returnedHome).toBe(true)
    expect(captured.current?.sessionMode).toBe("start")
  })

  it("ignores delayed older and equal content events but projects a true newer source save before CAS", async () => {
    const envelope = designEnvelope()
    const seeder = repository("delayed-content-event-seeder")
    const created = await seeder.create(
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
    if (!created.ok) throw new Error("Expected repository fixture creation")
    const incoming = repositoryWithIncomingEvents("delayed-content-event-hook")
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
      })
    })
    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(envelope.document.id)
      ).toBe(true)
    })

    await act(async () => {
      captured.current?.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(true)
    })
    const localHead = await readRecord(
      incoming.repository,
      envelope.document.id
    )
    expect(localHead.summary.recordVersion).toBe(
      created.record.summary.recordVersion + 1
    )

    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "content_saved",
        documentId: envelope.document.id,
        recordVersion: created.record.summary.recordVersion,
        contentSnapshotId: created.record.summary.contentSnapshotId,
        draftSnapshotId: created.record.summary.draftSnapshotId,
        sessionId: "delayed-older-session",
      })
      incoming.deliver({
        type: "saved",
        reason: "content_saved",
        documentId: envelope.document.id,
        recordVersion: localHead.summary.recordVersion,
        contentSnapshotId: localHead.summary.contentSnapshotId,
        draftSnapshotId: localHead.summary.draftSnapshotId,
        sessionId: "delayed-equal-session",
      })
      await Promise.resolve()
    })
    expect(captured.current?.localSaveState).toMatchObject({
      status: "saved",
      recordVersion: localHead.summary.recordVersion,
    })
    expect(captured.current?.documentError).toBeNull()

    const otherTab = repository("delayed-content-event-other-tab")
    const sourceOnlyContext = {
      ...localHead.envelope.sourceContext!,
      designTemplate: null,
    }
    const external = await otherTab.save(
      {
        document: localHead.envelope.document,
        sourceContext: sourceOnlyContext,
      },
      localHead.summary.recordVersion,
      localHead.summary.draftSnapshotId
    )
    if (!external.ok) throw new Error("Expected a newer external source save")
    expect(external.record.summary.contentSnapshotId).toBe(
      localHead.summary.contentSnapshotId
    )
    expect(external.record.summary.draftSnapshotId).not.toBe(
      localHead.summary.draftSnapshotId
    )

    await act(async () => {
      incoming.deliver({
        type: "saved",
        reason: "content_saved",
        documentId: envelope.document.id,
        recordVersion: external.record.summary.recordVersion,
        contentSnapshotId: external.record.summary.contentSnapshotId,
        draftSnapshotId: external.record.summary.draftSnapshotId,
        sessionId: "true-newer-source-session",
      })
      await Promise.resolve()
    })
    expect(captured.current?.localSaveState).toEqual({
      status: "external_change",
      reason: "saved_elsewhere",
      observedRecordVersion: external.record.summary.recordVersion,
    })

    await act(async () => {
      captured.current?.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(false)
    })
    expect(captured.current?.localSaveState).toMatchObject({
      status: "conflict",
      reason: "stale_write",
      conflictId: expect.any(String),
    })
    const conflicts = await otherTab.listConflicts(envelope.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          expectedRecordVersion: localHead.summary.recordVersion,
          observedRecordVersion: external.record.summary.recordVersion,
          reason: "stale_write",
        },
      ],
    })
  })

  it("projects a foreign active-document quarantine as an external deletion boundary", async () => {
    const envelope = designEnvelope()
    const seeder = repository("foreign-quarantine-seeder")
    const created = await seeder.create(
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
    if (!created.ok) throw new Error("Expected repository fixture creation")
    const incoming = repositoryWithIncomingEvents("foreign-quarantine-hook")
    const captured = await mount(() => incoming.repository)
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
      })
    })
    await act(async () => {
      expect(
        await captured.current!.openStoredDocument(envelope.document.id)
      ).toBe(true)
    })

    await act(async () => {
      incoming.deliver({
        type: "quarantined",
        documentId: envelope.document.id,
        quarantineId: "foreign-quarantine-id",
        sessionId: "foreign-quarantine-session",
      })
      await Promise.resolve()
    })

    expect(captured.current?.localSaveState).toEqual({
      status: "external_change",
      reason: "quarantined_elsewhere",
      observedRecordVersion: created.record.summary.recordVersion,
    })
    expect(captured.current?.documentError).toContain("quarantined")
    expect(claimsDurableSave(captured.current!)).toBe(false)
    expect(captured.current?.document).toEqual(envelope.document)
  })

  it("projects a foreign save as external change, then lets a local edit reach authoritative CAS conflict", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "foreign-save-invalidation"
    )
    expect(captured.current?.localSaveState.status).toBe("saved")
    const otherTab = repository("foreign-save-invalidation-other-tab")
    const externalDocument = {
      ...envelope.document,
      name: "Foreign saved head",
      revision: envelope.document.revision + 1,
      updatedAt: "2026-08-28T21:04:00.000Z",
    }

    await act(async () => {
      const external = await otherTab.save(
        {
          document: externalDocument,
          sourceContext: envelope.sourceContext,
        },
        created.summary.recordVersion,
        created.summary.draftSnapshotId
      )
      expect(external).toMatchObject({
        ok: true,
        record: {
          summary: { recordVersion: created.summary.recordVersion + 1 },
        },
      })
      await pause(25)
    })
    await vi.waitFor(() => {
      expect(captured.current?.localSaveState).toEqual({
        status: "external_change",
        reason: "saved_elsewhere",
        observedRecordVersion: created.summary.recordVersion + 1,
      })
    })
    expect(claimsDurableSave(captured.current!)).toBe(false)
    expect(captured.current?.document).toEqual(envelope.document)

    await act(async () => {
      captured.current?.addRectangle()
    })
    const afterFirstExternalEdit = captured.current?.document.nodes.length
    await act(async () => {
      captured.current?.addEllipse()
    })
    expect(captured.current?.document.nodes.length).toBe(afterFirstExternalEdit)
    expect(captured.current?.documentError).toContain(
      "Resolve the saved-version conflict"
    )
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(false)
    })

    expect(captured.current?.localSaveState).toMatchObject({
      status: "conflict",
      reason: "stale_write",
      conflictId: expect.any(String),
    })
    const conflicts = await hookRepository.listConflicts(envelope.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          reason: "stale_write",
          expectedRecordVersion: created.summary.recordVersion,
          observedRecordVersion: created.summary.recordVersion + 1,
          candidate: {
            document: { id: envelope.document.id },
          },
        },
      ],
    })
  })

  it("materializes an unchanged external-change branch through the authoritative stale CAS", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "foreign-save-materialize"
    )
    const otherTab = repository("foreign-save-materialize-other-tab")
    const external = await otherTab.save(
      {
        document: {
          ...envelope.document,
          name: "Foreign head before explicit preservation",
          revision: envelope.document.revision + 1,
          updatedAt: "2026-08-28T21:04:00.000Z",
        },
        sourceContext: envelope.sourceContext,
      },
      created.summary.recordVersion,
      created.summary.draftSnapshotId
    )
    if (!external.ok) throw new Error("Expected external save")
    await vi.waitFor(() => {
      expect(captured.current?.localSaveState.status).toBe("external_change")
    })

    await act(async () => {
      expect(await captured.current!.materializeExternalChangeConflict()).toBe(
        true
      )
    })

    expect(captured.current?.conflictRecoveryState).toMatchObject({
      status: "conflict",
      conflict: {
        reason: "stale_write",
        candidate: { document: envelope.document },
      },
    })
    const conflicts = await hookRepository.listConflicts(envelope.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          reason: "stale_write",
          expectedRecordVersion: created.summary.recordVersion,
          observedRecordVersion: external.record.summary.recordVersion,
          candidate: { document: envelope.document },
        },
      ],
    })
  })

  it("projects a foreign soft delete as external change and retains a deleted-elsewhere CAS candidate", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "foreign-delete-invalidation"
    )
    expect(captured.current?.localSaveState.status).toBe("saved")
    const otherTab = repository("foreign-delete-invalidation-other-tab")

    await act(async () => {
      const deleted = await otherTab.softDelete(
        envelope.document.id,
        created.summary.recordVersion
      )
      expect(deleted).toMatchObject({
        ok: true,
        record: {
          summary: {
            recordVersion: created.summary.recordVersion + 1,
            deletedAt: expect.any(String),
          },
        },
      })
      await pause(25)
    })
    await vi.waitFor(() => {
      expect(captured.current?.localSaveState).toEqual({
        status: "external_change",
        reason: "deleted_elsewhere",
        observedRecordVersion: created.summary.recordVersion + 1,
      })
    })
    expect(claimsDurableSave(captured.current!)).toBe(false)
    expect(captured.current?.document).toEqual(envelope.document)

    await act(async () => {
      captured.current?.addRectangle()
    })
    await act(async () => {
      expect(await captured.current!.flushActiveDraft()).toBe(false)
    })

    expect(captured.current?.localSaveState).toMatchObject({
      status: "conflict",
      reason: "deleted_elsewhere",
      conflictId: expect.any(String),
    })
    const conflicts = await hookRepository.listConflicts(envelope.document.id)
    expect(conflicts).toMatchObject({
      ok: true,
      value: [
        {
          reason: "deleted_elsewhere",
          expectedRecordVersion: created.summary.recordVersion,
          observedRecordVersion: created.summary.recordVersion + 1,
          candidate: { document: { id: envelope.document.id } },
        },
      ],
    })
  })

  it("refuses an exact-ID open when the durable record is deleted after get but before touch", async () => {
    const envelope = designEnvelope()
    const hookRepository = repository("continue-delete-race-hook")
    const created = await hookRepository.create(
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
    if (!created.ok) throw new Error("Expected repository fixture creation")
    const otherTab = repository("continue-delete-race-other-tab")
    const originalTouch = hookRepository.touchOpened.bind(hookRepository)
    let deletionResult: Awaited<
      ReturnType<DocumentDraftRepository["softDelete"]>
    > | null = null
    vi.spyOn(hookRepository, "touchOpened").mockImplementation(
      async (documentId) => {
        deletionResult = await otherTab.softDelete(
          documentId,
          created.record.summary.recordVersion
        )
        return originalTouch(documentId)
      }
    )
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(captured.current?.startModel).toMatchObject({
        status: "ready",
      })
    })

    let continued = true
    await act(async () => {
      continued = await captured.current!.openStoredDocument(
        envelope.document.id
      )
    })

    expect(deletionResult).toMatchObject({
      ok: true,
      record: { summary: { deletedAt: expect.any(String) } },
    })
    expect(continued).toBe(false)
    expect(captured.current?.sessionMode).toBe("start")
    expect(captured.current?.document.id).toBe("private-bootstrap-document")
    expect(captured.current?.startModel).toMatchObject({
      status: "ready",
    })
    expect(captured.current?.documentError).toMatch(/removed.*before.*opened/i)
    expect(claimsDurableSave(captured.current!)).toBe(false)
  })

  it("marks an ordinary commit unsaved synchronously and pagehide drains the exact candidate", async () => {
    const envelope = designEnvelope()
    const { captured, created, hookRepository } = await openEnvelope(
      envelope,
      "commit-pagehide"
    )
    expect(captured.current?.localSaveState.status).toBe("saved")
    const originalSave = hookRepository.save.bind(hookRepository)
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    let saveStarted = false
    vi.spyOn(hookRepository, "save").mockImplementation(
      async (...arguments_) => {
        saveStarted = true
        await saveGate
        return originalSave(...arguments_)
      }
    )

    await act(async () => {
      captured.current?.addRectangle()
    })
    const exactCandidate = currentEnvelope(captured.current!)
    expect(captured.current?.localSaveState.status).toBe("saving")
    expect(saveStarted).toBe(false)

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"))
      await Promise.resolve()
    })
    expect(saveStarted).toBe(true)
    expect(captured.current?.localSaveState.status).toBe("saving")

    await act(async () => {
      releaseSave?.()
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(captured.current?.localSaveState.status).toBe("saved")
    })
    const durable = await readRecord(hookRepository, envelope.document.id)
    expect(durable.summary.recordVersion).toBe(
      created.summary.recordVersion + 1
    )
    expect(durable.envelope).toEqual(exactCandidate)
  })

  it.each(["document", "quotation"] as const)(
    "rejects a deferred %s import after an ordinary commit and preserves the newer durable history",
    async (kind) => {
      const envelope = designEnvelope()
      const { captured, created, hookRepository } = await openEnvelope(
        envelope,
        `${kind}-import-ordinary-commit-race`
      )
      const deferred = await beginDeferredImport(
        captured.current!,
        kind,
        `${kind}-stale-ordinary-import`
      )

      await act(async () => {
        captured.current?.addRectangle()
      })
      await act(async () => {
        expect(await captured.current!.flushActiveDraft()).toBe(true)
      })
      const newerHistory = exactHistory(captured.current!)
      const durableBeforeCompletion = await readRecord(
        hookRepository,
        envelope.document.id
      )
      expect(durableBeforeCompletion.summary.recordVersion).toBe(
        created.summary.recordVersion + 1
      )

      let result: boolean | void = undefined
      await act(async () => {
        deferred.resolve()
        result = await deferred.settled
      })

      if (kind === "document") expect(result).toBe(false)
      expect(exactHistory(captured.current!)).toEqual(newerHistory)
      expect(captured.current?.documentError).toMatch(/changed.*being read/i)
      expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
        durableBeforeCompletion
      )
    }
  )

  it.each([
    { kind: "document", blocker: "crop" },
    { kind: "quotation", blocker: "crop" },
    { kind: "document", blocker: "review" },
    { kind: "quotation", blocker: "review" },
  ] as const)(
    "rejects a deferred $kind import when a $blocker becomes active without replacing exact history",
    async ({ kind, blocker }) => {
      const envelope = blocker === "crop" ? cropEnvelope() : designEnvelope()
      const { captured, hookRepository } = await openEnvelope(
        envelope,
        `${kind}-import-${blocker}-race`
      )
      const durableBefore = await readRecord(
        hookRepository,
        envelope.document.id
      )
      const deferred = await beginDeferredImport(
        captured.current!,
        kind,
        `${kind}-stale-${blocker}-import`
      )

      await act(async () => {
        if (blocker === "crop") {
          expect(captured.current?.beginImageCrop(cropImage.id)).toBe(true)
        } else {
          captured.current?.proposeChangeSet(reviewChangeSet(captured.current))
        }
      })
      const historyBeforeCompletion = exactHistory(captured.current!)
      if (blocker === "crop") {
        expect(captured.current?.imageCropSession?.target.nodeId).toBe(
          cropImage.id
        )
      } else {
        expect(captured.current?.pendingChangeSet?.id).toBe(
          "persistence-import-race-review"
        )
      }

      let result: boolean | void = undefined
      await act(async () => {
        deferred.resolve()
        result = await deferred.settled
      })

      if (kind === "document") expect(result).toBe(false)
      expect(exactHistory(captured.current!)).toEqual(historyBeforeCompletion)
      if (blocker === "crop") {
        expect(captured.current?.imageCropSession?.target.nodeId).toBe(
          cropImage.id
        )
      } else {
        expect(captured.current?.pendingChangeSet?.id).toBe(
          "persistence-import-race-review"
        )
      }
      if (blocker === "crop") {
        expect(captured.current?.documentError).toMatch(
          /finish or cancel.*crop/i
        )
      } else {
        expect(captured.current?.changeSetError).toMatch(
          /resolve or discard.*preview/i
        )
      }
      expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
        durableBefore
      )
    }
  )

  it.each(["document", "quotation"] as const)(
    "rejects a deferred %s import after session replacement and preserves the replacement durability",
    async (kind) => {
      const envelope = designEnvelope()
      const { captured, created, hookRepository } = await openEnvelope(
        envelope,
        `${kind}-import-session-replacement-race`
      )
      const deferred = await beginDeferredImport(
        captured.current!,
        kind,
        `${kind}-stale-replaced-session-import`
      )

      let replaced = false
      await act(async () => {
        replaced = await captured.current!.createBlankDocument({
          name: `${kind} replacement session`,
          width: 1600,
          height: 900,
        })
      })
      expect(replaced).toBe(true)
      const replacementHistory = exactHistory(captured.current!)
      const replacementDocumentId = captured.current!.document.id
      expect(replacementDocumentId).not.toBe(envelope.document.id)
      const replacementDurable = await readRecord(
        hookRepository,
        replacementDocumentId
      )

      let result: boolean | void = undefined
      await act(async () => {
        deferred.resolve()
        result = await deferred.settled
      })

      if (kind === "document") expect(result).toBe(false)
      expect(exactHistory(captured.current!)).toEqual(replacementHistory)
      expect(captured.current?.documentError).toBeNull()
      expect(await readRecord(hookRepository, replacementDocumentId)).toEqual(
        replacementDurable
      )
      const originalDurable = await readRecord(
        hookRepository,
        envelope.document.id
      )
      expect(originalDurable.summary.recordVersion).toBe(
        created.summary.recordVersion
      )
      expect(originalDurable.envelope).toEqual(envelope)
    }
  )

  it.each(["document", "quotation"] as const)(
    "lets a newer %s import win and rejects the delayed competing completion",
    async (kind) => {
      const envelope = designEnvelope()
      const { captured, created, hookRepository } = await openEnvelope(
        envelope,
        `${kind}-competing-import-race`
      )
      const deferred = await beginDeferredImport(
        captured.current!,
        kind,
        `${kind}-losing-delayed-import`
      )

      if (kind === "document") {
        let imported = false
        await act(async () => {
          imported = await captured.current!.importDocumentFile(
            jsonFile(
              documentImportCandidate(
                captured.current!,
                "Winning immediate document import"
              )
            )
          )
        })
        expect(imported).toBe(true)
      } else {
        await act(async () => {
          await captured.current!.importQuotationFile(
            jsonFile(quotationImportCandidate("winning-quotation-import"))
          )
        })
      }
      await act(async () => {
        expect(await captured.current!.flushActiveDraft()).toBe(true)
      })
      const winningHistory = exactHistory(captured.current!)
      const winningDurable = await readRecord(
        hookRepository,
        envelope.document.id
      )
      expect(winningDurable.summary.recordVersion).toBe(
        created.summary.recordVersion + 1
      )

      let result: boolean | void = undefined
      await act(async () => {
        deferred.resolve()
        result = await deferred.settled
      })

      if (kind === "document") expect(result).toBe(false)
      expect(exactHistory(captured.current!)).toEqual(winningHistory)
      expect(captured.current?.documentError).toBeNull()
      expect(await readRecord(hookRepository, envelope.document.id)).toEqual(
        winningDurable
      )
    }
  )

  it("keeps the synchronously accepted deferred Continue as the session owner", async () => {
    const envelope = quotationEnvelope()
    const drafts = repository("generation-seeder")
    const created = await drafts.create(
      {
        document: envelope.document,
        sourceContext: envelope.sourceContext,
      },
      { kind: "quotation" }
    )
    if (!created.ok) throw new Error("Expected repository fixture creation")
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, JSON.stringify(envelope))

    const hookRepository = repository("generation-hook")
    const captured = await mount(() => hookRepository)
    await vi.waitFor(() => {
      expect(repositoryLifecycle(captured.current!)).toMatchObject({
        status: "ready",
      })
    })
    const originalGet = hookRepository.get.bind(hookRepository)
    let getStarted = false
    let resolveDeferred: ((record: DocumentDraftRecord) => void) | null = null
    const deferredRecord = new Promise<DocumentDraftRecord>((resolve) => {
      resolveDeferred = resolve
    })
    vi.spyOn(hookRepository, "get").mockImplementation(async (documentId) => {
      if (documentId === envelope.document.id) {
        getStarted = true
        return { ok: true, status: "found", record: await deferredRecord }
      }
      return originalGet(documentId)
    })

    let continuePromise: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      continuePromise = Promise.resolve(
        captured.current?.openStoredDocument(envelope.document.id) ?? false
      )
      await Promise.resolve()
    })

    let createdNewer = true
    await act(async () => {
      createdNewer = await Promise.resolve(
        captured.current?.createBlankDocument({
          name: "Newer session",
          width: 1600,
          height: 900,
        }) ?? false
      )
    })
    let continued = false
    await act(async () => {
      resolveDeferred?.(created.record)
      continued = await continuePromise
    })

    expect(getStarted).toBe(true)
    expect(createdNewer).toBe(false)
    expect(continued).toBe(true)
    expect(captured.current?.sessionMode).toBe("workspace")
    expect(captured.current?.document.id).toBe(envelope.document.id)
    expect(captured.current?.document.name).toBe(envelope.document.name)
  })
})
