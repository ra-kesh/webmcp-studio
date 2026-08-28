import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  builtInDesignTemplateRepository,
  changeSetSchema,
  captureSemanticFragment,
  cloneTemplateDocument,
  cloneSemanticFragment,
  createTemplateVersion,
  deriveDocumentSnapshotId,
  decideAllChangeOperations,
  decideChangeOperation,
  documentSchema,
  findSelectedGroupId,
  getChangeSetConflict,
  getGroupNodeIds,
  composeQuotationDocument,
  inferQuotationTemplateId,
  previewChangeSet,
  quotationCompositionRequestV1Schema,
  quotationRenderPayloadV1Schema,
  quotationTemplates,
  templateVersionSchema,
} from "@webmcp/document"
import type {
  ChangeOperation,
  ChangeSet,
  Document,
  DocumentCommand,
  DesignTemplateCatalogItem,
  FieldBinding,
  FieldDefinition,
  ImageFrameMask,
  QuotationRenderPayloadV1,
  QuotationTemplateId,
  SceneNode,
  SemanticFragment,
  TemplateVersion,
} from "@webmcp/document"
import { layerDropCommands } from "@webmcp/editor/layer-tree"
import type { LayerDropIntent, LayerTreeItem } from "@webmcp/editor/layer-tree"
import {
  applyImageCropSession,
  cancelImageCropSession,
  createImageCropPreviewStore,
  reconcileImageCropSession,
  startImageCropSession,
} from "@webmcp/editor"
import type {
  CanvasNodeChange,
  CommandDraft,
  ImageCropPreviewStore,
  ImageCropSession,
  Selection,
} from "@webmcp/editor"
import {
  alignNodes,
  alignNodesToBounds,
  distributeNodes,
} from "@webmcp/editor/geometry"
import type { Alignment, Distribution } from "@webmcp/editor/geometry"
import {
  createImageFrameCommandDrafts,
  createImagePlacementCommandDrafts,
  editorCommandHistoryLabel,
} from "@webmcp/editor/commands"
import type {
  EditorImageFrameCommandId,
  EditorImagePlacementCommandId,
} from "@webmcp/editor/commands"
import {
  commitCommands,
  createDocumentHistory,
  redoDocument,
  replaceDocument,
  undoDocument,
} from "@webmcp/editor/history"
import type {
  DocumentHistory,
  HistoryCommitOptions,
} from "@webmcp/editor/history"
import {
  assertLocalAssetCapacity,
  getLocalAssetRecord,
  getImageDimensions,
  loadLocalAsset,
  localAssetIdFromSource,
  localAssetSource,
  markLocalAssetUsed,
  rollbackLocalAsset,
  saveLocalAsset,
} from "./local-asset-store"
import type { LocalAssetSummary } from "./local-asset-store"
import {
  decodeBrowserImageSource,
  stageUsableLocalImageSource,
} from "./local-image-source-stage"
import type { StagedLocalImageSource } from "./local-image-source-stage"
import {
  projectLocalAssetPreviewSources,
  reusableAssetFromLocalRecord,
} from "./local-asset-preview"
import {
  assetMutationMessage,
  captureAddAssetAnchor,
  captureReplaceAssetAnchor,
  executeAssetMutation,
  getAssetMutationAbortReason,
} from "./asset-mutation-transaction"
import type {
  AssetMutationAnchor,
  AssetMutationState,
} from "./asset-mutation-transaction"
import { canvasChangeHistoryOptions } from "./canvas-change-policy"
import type { StudioAsset } from "./asset-catalog"
import {
  getManagedMedia,
  managedMediaContentUrl,
  managedMediaIdFromSource,
  markManagedMediaUsed,
} from "./managed-media-repository"
import { managedAssetIdsInCommands } from "./managed-asset-command-accounting"
import type { ManagedMediaAsset } from "./managed-media-repository"
import { verifyManagedBrowserImageResource } from "./managed-image-resource"
import { validateMediaDimensions, validateMediaFile } from "./media-file-policy"
import {
  createReusableImageNode,
  reusableImageReplacementCommand,
  reusableImageReplacementPatch,
} from "./media-selection-model"
import type { ReusableImageAsset } from "./media-selection-model"
import { ImageReplacementCoordinator } from "./image-replacement-coordinator"
import type { PreparedImageReplacement } from "./image-replacement-coordinator"
import type { ImageReplacementRendererEvent } from "./image-replacement-readiness"
import { imageReplacementBindingImpact } from "./image-replacement-binding"
import { decodeStoredDraft, DRAFT_RECOVERY_STORAGE_KEY } from "./draft-recovery"
import type { DraftRecoveryRecord } from "./draft-recovery"
import {
  CURRENT_DRAFT_STORAGE_KEY,
  decodeCurrentDraftEnvelope,
  LEGACY_DOCUMENT_STORAGE_KEY,
  validateCurrentDraftSnapshot,
} from "./current-draft-repository"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  DocumentDraftRecord,
  DraftOrigin,
  DraftRepositoryEvent,
} from "./document-draft-repository"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import type { LocalSaveState } from "./document-draft-save-controller"
import type { StudioPersistenceApi } from "../persistence/studio-persistence-provider"
import type { StudioStartModel } from "./studio-start-model"
import { parseDocumentImportFile } from "./document-import"
import { createStudioTextNode, defaultStudioTextPresetId } from "./text-presets"
import type { StudioTextPresetId } from "./text-presets"
import { quotationStarter } from "./quotation-starter"
import { validateNewDocumentOptions } from "./new-document-model"
import type { NewDocumentInput } from "./new-document-model"
import {
  prepareApplyTemplate,
  prepareCreateFromTemplate,
} from "./template-lifecycle"
import type { TemplateSourceContext } from "./template-lifecycle"
import { resolveUnavailableImageCrop } from "./image-crop-unavailable"
import { imageCropInvalidationMessage } from "./image-crop-invalidation"
import {
  publishedVersionsForDocument,
  replaceAuthoritativePublishedVersions,
  restorePublishedVersions,
} from "./published-version-state"

const PUBLISHED_STORAGE_KEY = "webmcp-studio:published-versions:v1"

const decodeValidatedImageDimensions = async (file: Blob) => {
  const dimensions = await getImageDimensions(file)
  const validationError = validateMediaDimensions(dimensions)
  if (validationError) throw new Error(validationError)
  return dimensions
}

const designTemplateForQuotation = (templateId: QuotationTemplateId) => {
  const item = builtInDesignTemplateRepository
    .list({ kind: "quotation_style" })
    .find(
      (candidate) =>
        candidate.kind === "quotation_style" &&
        candidate.quotationTemplateId === templateId
    )
  return item ? { id: item.id, version: item.version } : null
}

type RepositoryLifecycle =
  | Readonly<{ status: "opening" }>
  | Readonly<{ status: "ready" }>
  | Readonly<{
      status: "blocked" | "unavailable"
      failure: Readonly<{ kind: string; message: string }>
    }>
type PublishSyncStatus = "idle" | "syncing" | "synced" | "error"
type DesignTemplateCatalogState = {
  status: "loading" | "ready" | "error"
  items: DesignTemplateCatalogItem[]
  categories: string[]
  error: string | null
}

type RendererReplacementPayload = Readonly<{
  anchor: AssetMutationAnchor
  asset: ReusableImageAsset
}>

type ActivePersistenceSession = Readonly<{
  generation: number
  controller: DocumentDraftSaveController
  unsubscribe: () => void
  releaseLease: () => void
}>

type SessionTransition = Readonly<{
  token: number
  kind: "continue" | "replace" | "recovery" | "home"
}>

type OpeningInvalidationEvent =
  | Extract<DraftRepositoryEvent, { type: "saved" }>
  | Extract<DraftRepositoryEvent, { type: "deleted" | "restored" }>
  | Extract<DraftRepositoryEvent, { type: "quarantined" }>

type OpeningDocumentState = {
  documentId: string
  transitionToken: number
  invalidatingEvents: OpeningInvalidationEvent[]
}

function selectOpeningInvalidation(
  events: readonly OpeningInvalidationEvent[],
  verifiedRecord: DocumentDraftRecord
): OpeningInvalidationEvent | null {
  const quarantine = events.find((event) => event.type === "quarantined")
  if (quarantine) return quarantine

  let selected: Exclude<
    OpeningInvalidationEvent,
    { type: "quarantined" }
  > | null = null
  for (const event of events) {
    if (event.type === "quarantined") continue
    const covered =
      event.recordVersion < verifiedRecord.summary.recordVersion ||
      (event.recordVersion === verifiedRecord.summary.recordVersion &&
        (event.type !== "saved" ||
          (event.contentSnapshotId ===
            verifiedRecord.summary.contentSnapshotId &&
            event.draftSnapshotId === verifiedRecord.summary.draftSnapshotId)))
    if (covered) continue
    if (!selected || event.recordVersion >= selected.recordVersion) {
      selected = event
    }
  }
  return selected
}

function sourceContextsMatch(
  left: TemplateSourceContext | null,
  right: TemplateSourceContext
) {
  if (left === null) {
    return (
      right.quotationSource === null &&
      right.quotationTemplateId === quotationStarter.templateId &&
      right.designTemplate === null
    )
  }
  return (
    left.quotationSource === right.quotationSource &&
    left.quotationTemplateId === right.quotationTemplateId &&
    left.designTemplate?.id === right.designTemplate?.id &&
    left.designTemplate?.version === right.designTemplate?.version
  )
}

type PendingRendererReplacement =
  PreparedImageReplacement<RendererReplacementPayload>

export type StudioSessionMode = "start" | "workspace"

function createNeutralBootstrapDocument(): Document {
  return documentSchema.parse({
    schemaVersion: 2,
    id: "private-bootstrap-document",
    name: "Untitled document",
    revision: 0,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    outputs: [
      {
        id: "private-bootstrap-output",
        name: "Untitled document",
        kind: "custom",
        pageIds: ["private-bootstrap-page"],
        exportFormats: ["png", "pdf"],
      },
    ],
    pages: [
      {
        id: "private-bootstrap-page",
        outputId: "private-bootstrap-output",
        name: "Page 1",
        width: 1240,
        height: 1754,
        background: "#ffffff",
        nodeIds: [],
      },
    ],
    nodes: [],
    groups: [],
    fields: [],
    fieldValues: {},
    bindings: [],
  })
}

async function syncPublishedVersion(version: TemplateVersion) {
  const response = await fetch("/v1/studio/templates/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: version.id,
      templateId: version.templateId,
      version: version.version,
      publishedAt: version.publishedAt,
      document: version.document,
    }),
  })
  if (response.ok) {
    return templateVersionSchema.parse(await response.json())
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string }
  } | null
  const detail = payload?.error?.code
    ? payload.error.code.replaceAll("_", " ")
    : `status ${response.status}`
  throw new Error(`Publishing service: ${detail}.`)
}

function commandFromDraft(draft: CommandDraft): DocumentCommand {
  return {
    ...draft,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: "human",
  }
}

function findNode(document: Document, nodeId: string) {
  return document.nodes.find((node) => node.id === nodeId)
}

function reconcileSelection(
  selection: Selection | null,
  document: Document
): Selection | null {
  if (!selection) return null
  const page = document.pages.find(
    (candidate) => candidate.id === selection.pageId
  )
  if (!page) return null
  const pageNodeIds = new Set(page.nodeIds)
  const documentNodeIds = new Set(document.nodes.map((node) => node.id))
  const nodeIds = selection.nodeIds.filter(
    (nodeId) => pageNodeIds.has(nodeId) && documentNodeIds.has(nodeId)
  )
  return nodeIds.length ? { pageId: page.id, nodeIds } : null
}

export type DocumentHistoryCommit = Readonly<{
  id: string
  committedAt: number
  label: string
}>

export function useDocumentEditor({
  onHistoryCommit,
  persistence,
}: {
  onHistoryCommit?: (entry: DocumentHistoryCommit) => void
  persistence: StudioPersistenceApi
}) {
  const persistenceRef = useRef(persistence)
  persistenceRef.current = persistence
  const getDraftRepository = useCallback(
    () => persistenceRef.current.repository,
    []
  )
  const [sessionMode, setSessionMode] = useState<StudioSessionMode>("start")
  const sessionModeRef = useRef<StudioSessionMode>(sessionMode)
  sessionModeRef.current = sessionMode
  const [history, setHistory] = useState<DocumentHistory>(() =>
    createDocumentHistory(createNeutralBootstrapDocument())
  )
  const [activePageId, setActivePageId] = useState("private-bootstrap-page")
  const [quotationSource, setQuotationSource] =
    useState<QuotationRenderPayloadV1 | null>(null)
  const [activeQuotationTemplateId, setActiveQuotationTemplateId] =
    useState<QuotationTemplateId>(quotationStarter.templateId)
  const [activeDesignTemplate, setActiveDesignTemplate] = useState<{
    id: string
    version: number
  } | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [imageCropPreviewStore, setImageCropPreviewStore] =
    useState<ImageCropPreviewStore | null>(null)
  const imageCropPreviewStoreRef = useRef<ImageCropPreviewStore | null>(null)
  const imageCropSession = imageCropPreviewStore?.getSnapshot() ?? null
  const imageCropSessionRef = useRef<ImageCropSession | null>(null)
  const [localSaveState, setLocalSaveState] = useState<LocalSaveState>({
    status: "opening",
  })
  const localSaveStateRef = useRef<LocalSaveState>(localSaveState)
  localSaveStateRef.current = localSaveState
  const [repositoryLifecycle, setRepositoryLifecycle] =
    useState<RepositoryLifecycle>({ status: "opening" })
  const [clipboardCount, setClipboardCount] = useState(0)
  const [assetVersion, setAssetVersion] = useState(0)
  const [isImportingAsset, setIsImportingAsset] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [pendingImageReplacement, setPendingImageReplacement] =
    useState<PendingRendererReplacement | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [templateActionError, setTemplateActionError] = useState<string | null>(
    null
  )
  const [draftRecovery, setDraftRecovery] =
    useState<DraftRecoveryRecord | null>(null)
  const [draftRecoveryNotice, setDraftRecoveryNotice] = useState<string | null>(
    null
  )
  const [pendingChangeSet, setPendingChangeSet] = useState<ChangeSet | null>(
    null
  )
  const [lastResolvedChangeSet, setLastResolvedChangeSet] =
    useState<ChangeSet | null>(null)
  const [changeSetError, setChangeSetError] = useState<string | null>(null)
  const [isApplyingChangeSet, setIsApplyingChangeSet] = useState(false)
  const [publishedVersions, setPublishedVersions] = useState<TemplateVersion[]>(
    []
  )
  const publishedVersionsRef = useRef(publishedVersions)
  publishedVersionsRef.current = publishedVersions
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSyncStatus, setPublishSyncStatus] =
    useState<PublishSyncStatus>("idle")

  const closeImageCropSession = useCallback(() => {
    imageCropPreviewStoreRef.current?.destroy()
    imageCropPreviewStoreRef.current = null
    imageCropSessionRef.current = null
    setImageCropPreviewStore(null)
  }, [])

  useEffect(
    () => () => {
      imageCropPreviewStoreRef.current?.destroy()
      imageCropPreviewStoreRef.current = null
      imageCropSessionRef.current = null
    },
    []
  )
  const [documentSnapshotId, setDocumentSnapshotId] = useState<string | null>(
    null
  )
  const [designTemplateCatalog, setDesignTemplateCatalog] =
    useState<DesignTemplateCatalogState>({
      status: "loading",
      items: [],
      categories: [],
      error: null,
    })
  const [startModel, setStartModel] = useState<StudioStartModel>({
    status: "opening",
  })
  const persistenceBlockedRef = useRef(true)
  const repositoryReadyRef = useRef(false)
  const openingDocumentIdRef = useRef<OpeningDocumentState | null>(null)
  const activeRecordRef = useRef<DocumentDraftRecord | null>(null)
  const activePersistenceSessionRef = useRef<ActivePersistenceSession | null>(
    null
  )
  const sessionGenerationRef = useRef(0)
  const sessionTransitionSequenceRef = useRef(0)
  const activeSessionTransitionRef = useRef<SessionTransition | null>(null)
  const settlingPersistenceSessionRef = useRef<{
    session: ActivePersistenceSession
    promise: Promise<boolean>
  } | null>(null)
  const retiringPersistenceSessionRef = useRef<{
    session: ActivePersistenceSession
    promise: Promise<boolean>
  } | null>(null)
  const documentImportRequestGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const draftRecoveryRef = useRef(draftRecovery)
  draftRecoveryRef.current = draftRecovery
  const clipboardRef = useRef<SemanticFragment | null>(null)
  const assetUrlsRef = useRef(new Map<string, string>())
  const assetLoadPromisesRef = useRef(new Map<string, Promise<void>>())
  const referencedLocalAssetIdsRef = useRef(new Set<string>())
  const assetLifecycleActiveRef = useRef(true)
  const attemptedVersionSyncRef = useRef(new Set<string>())
  const historyRef = useRef(history)
  historyRef.current = history
  const lastCapturedDocumentRef = useRef<Document | null>(null)
  const lastCapturedSourceContextRef = useRef<TemplateSourceContext | null>(
    null
  )
  const onHistoryCommitRef = useRef(onHistoryCommit)
  onHistoryCommitRef.current = onHistoryCommit
  const notifyHistoryCommit = useCallback((next: DocumentHistory) => {
    const entry = next.past.at(-1)
    if (!entry) return
    onHistoryCommitRef.current?.({
      id: entry.id,
      committedAt: entry.committedAt,
      label: entry.label,
    })
  }, [])
  const templateSourceContextRef = useRef<TemplateSourceContext>({
    quotationSource,
    quotationTemplateId: activeQuotationTemplateId,
    designTemplate: activeDesignTemplate,
  })
  templateSourceContextRef.current = {
    quotationSource,
    quotationTemplateId: activeQuotationTemplateId,
    designTemplate: activeDesignTemplate,
  }
  const templateSourceBySnapshotRef = useRef(
    new Map<string, TemplateSourceContext>()
  )
  templateSourceBySnapshotRef.current.set(
    history.snapshotId,
    templateSourceContextRef.current
  )
  const activePageIdRef = useRef(activePageId)
  activePageIdRef.current = activePageId
  const pendingChangeSetRef = useRef(pendingChangeSet)
  pendingChangeSetRef.current = pendingChangeSet
  const applyingChangeSetRef = useRef(false)
  const assetMutationActiveRef = useRef(false)
  const imageReplacementCoordinatorRef =
    useRef<ImageReplacementCoordinator<RendererReplacementPayload> | null>(null)

  const installPublishedVersions = useCallback(
    (versions: TemplateVersion[]) => {
      localStorage.setItem(PUBLISHED_STORAGE_KEY, JSON.stringify(versions))
      publishedVersionsRef.current = versions
      setPublishedVersions(versions)
    },
    []
  )

  const installTemplateSourceContext = useCallback(
    (context: TemplateSourceContext) => {
      templateSourceContextRef.current = context
      setQuotationSource(context.quotationSource)
      setActiveQuotationTemplateId(context.quotationTemplateId)
      setActiveDesignTemplate(context.designTemplate)
      return true
    },
    []
  )

  const rememberStartEnvelope = useCallback(
    (envelope: CurrentDraftEnvelope) => {
      setStartModel((current) =>
        current.status === "blocked" || current.status === "unavailable"
          ? {
              ...current,
              recoverableEnvelope: envelope,
            }
          : {
              status: "ready",
              durable: false,
              storageWarning:
                current.status === "ready" && current.storageWarning
                  ? current.storageWarning
                  : "Browser document storage is unavailable. This draft exists only for this session.",
              recoverableEnvelope: envelope,
            }
      )
    },
    []
  )

  const projectLocalSaveState = useCallback((state: LocalSaveState) => {
    localSaveStateRef.current = state
    setLocalSaveState(state)
    if (state.status === "failed") setDocumentError(state.message)
    if (state.status === "conflict") {
      setDocumentError(
        state.reason === "deleted_elsewhere"
          ? "This document was deleted in another Studio session. Your local version is still available to download."
          : "This document changed in another Studio session. Your local version is still available to download."
      )
    }
  }, [])

  const projectForeignActiveDocumentEvent = useCallback(
    (event: DraftRepositoryEvent, forceOpeningInvalidation = false) => {
      if (event.type === "saved") {
        if (event.reason !== "content_saved") return false
        const controller =
          activePersistenceSessionRef.current?.controller ?? null
        if (
          !forceOpeningInvalidation &&
          controller &&
          (event.recordVersion < controller.recordVersion ||
            (event.contentSnapshotId === controller.contentSnapshotId &&
              event.draftSnapshotId === controller.draftSnapshotId))
        )
          return true
        projectLocalSaveState({
          status: "external_change",
          reason: "saved_elsewhere",
          observedRecordVersion: event.recordVersion,
        })
        setDocumentError(
          "This document changed in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "restored") {
        projectLocalSaveState({
          status: "external_change",
          reason: "saved_elsewhere",
          observedRecordVersion: event.recordVersion,
        })
        setDocumentError(
          "This document changed in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "deleted") {
        projectLocalSaveState({
          status: "external_change",
          reason: "deleted_elsewhere",
          observedRecordVersion: event.recordVersion,
        })
        setDocumentError(
          "This document was deleted in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "quarantined") {
        projectLocalSaveState({
          status: "external_change",
          reason: "deleted_elsewhere",
          observedRecordVersion:
            activeRecordRef.current?.summary.recordVersion ?? 0,
        })
        setDocumentError(
          "This document was quarantined after another Studio session found corrupt local data. Your open version has not been discarded."
        )
        return true
      }
      return false
    },
    [projectLocalSaveState]
  )

  const installEditorSession = useCallback(
    (envelope: CurrentDraftEnvelope) => {
      const nextHistory = createDocumentHistory(envelope.document)
      const sourceContext: TemplateSourceContext = envelope.sourceContext ?? {
        quotationSource: null,
        quotationTemplateId: quotationStarter.templateId,
        designTemplate: null,
      }
      historyRef.current = nextHistory
      templateSourceBySnapshotRef.current.clear()
      templateSourceBySnapshotRef.current.set(
        nextHistory.snapshotId,
        sourceContext
      )
      setHistory(nextHistory)
      installTemplateSourceContext(sourceContext)
      const firstPageId = envelope.document.pages[0].id
      activePageIdRef.current = firstPageId
      setActivePageId(firstPageId)
      setSelection(null)
      setDocumentError(null)
      setTemplateActionError(null)
      setSessionMode("workspace")
    },
    [installTemplateSourceContext]
  )

  const capturePersistenceSession = useCallback(
    (session: ActivePersistenceSession) => {
      if (
        sessionModeRef.current !== "workspace" ||
        activePersistenceSessionRef.current !== session
      )
        return true
      const document = historyRef.current.document
      const sourceContext = templateSourceContextRef.current
      if (
        lastCapturedDocumentRef.current === document &&
        sourceContextsMatch(lastCapturedSourceContextRef.current, sourceContext)
      )
        return true
      try {
        if (session.controller.documentId !== document.id) {
          throw new Error(
            `Studio refused to save document ${document.id} through the controller for ${session.controller.documentId}.`
          )
        }
        session.controller.capture({ document, sourceContext })
        lastCapturedDocumentRef.current = document
        lastCapturedSourceContextRef.current = sourceContext
        return true
      } catch (error) {
        setDocumentError(
          error instanceof Error
            ? error.message
            : "Studio could not capture the current document for saving."
        )
        return false
      }
    },
    []
  )

  const settlePersistenceSession = useCallback(
    async (session: ActivePersistenceSession) => {
      if (activePersistenceSessionRef.current !== session) return true
      const existing = settlingPersistenceSessionRef.current
      if (existing?.session === session) return existing.promise

      const settlement = Promise.resolve().then(async () => {
        try {
          if (localSaveStateRef.current.status === "external_change")
            return false
          if (!capturePersistenceSession(session)) return false
          try {
            await session.controller.flush()
          } catch (error) {
            setDocumentError(
              error instanceof Error
                ? error.message
                : "Studio could not finish saving the current document."
            )
            return false
          }
          if (session.controller.state.status !== "saved") return false
          return activePersistenceSessionRef.current === session
        } finally {
          if (settlingPersistenceSessionRef.current?.session === session) {
            settlingPersistenceSessionRef.current = null
          }
        }
      })
      settlingPersistenceSessionRef.current = { session, promise: settlement }
      return settlement
    },
    [capturePersistenceSession]
  )

  const retirePersistenceSession = useCallback(
    async (
      session: ActivePersistenceSession,
      canRetire: () => boolean = () => true
    ) => {
      if (activePersistenceSessionRef.current !== session) return true
      const existing = retiringPersistenceSessionRef.current
      if (existing?.session === session) return existing.promise

      const retirement = (async () => {
        try {
          if (!(await settlePersistenceSession(session))) return false
          if (!canRetire()) return false

          session.unsubscribe()
          try {
            session.controller.close()
          } finally {
            session.releaseLease()
          }
          if (activePersistenceSessionRef.current === session) {
            activePersistenceSessionRef.current = null
            activeRecordRef.current = null
            sessionGenerationRef.current = Math.max(
              sessionGenerationRef.current + 1,
              session.generation + 1
            )
          }
          return true
        } finally {
          if (retiringPersistenceSessionRef.current?.session === session) {
            retiringPersistenceSessionRef.current = null
          }
        }
      })()
      retiringPersistenceSessionRef.current = { session, promise: retirement }
      return retirement
    },
    [settlePersistenceSession]
  )

  const claimSessionTransition = useCallback(
    (kind: SessionTransition["kind"]): SessionTransition | null => {
      if (!mountedRef.current) return null
      if (activeSessionTransitionRef.current) return null
      const transition: SessionTransition = {
        token: sessionTransitionSequenceRef.current + 1,
        kind,
      }
      sessionTransitionSequenceRef.current = transition.token
      activeSessionTransitionRef.current = transition
      return transition
    },
    []
  )

  const ownsSessionTransition = useCallback(
    (transition: SessionTransition) =>
      mountedRef.current &&
      activeSessionTransitionRef.current?.token === transition.token,
    []
  )

  const releaseSessionTransition = useCallback(
    (transition: SessionTransition) => {
      if (activeSessionTransitionRef.current?.token === transition.token) {
        activeSessionTransitionRef.current = null
      }
    },
    []
  )

  const installDraftRecord = useCallback(
    async (
      record: DocumentDraftRecord,
      transition: SessionTransition,
      canInstall: () => boolean = () => true
    ) => {
      if (!ownsSessionTransition(transition) || !canInstall()) return false
      if (
        record.summary.documentId !== record.envelope.document.id ||
        record.summary.deletedAt !== null
      ) {
        setDocumentError(
          "Studio refused to open a document whose stored identity is inconsistent."
        )
        return false
      }

      let releaseLease: (() => void) | null = null
      let controller: DocumentDraftSaveController | null = null
      let unsubscribe: (() => void) | null = null
      let nextSession: ActivePersistenceSession | null = null
      try {
        releaseLease = persistenceRef.current.acquireLease()
        controller = new DocumentDraftSaveController({
          repository: getDraftRepository(),
          record,
        })
        const generation = sessionGenerationRef.current + 1
        unsubscribe = controller.subscribe((state) => {
          if (
            !mountedRef.current ||
            !nextSession ||
            activePersistenceSessionRef.current !== nextSession ||
            sessionGenerationRef.current !== generation
          )
            return
          projectLocalSaveState(state)
        })
        nextSession = {
          generation,
          controller,
          unsubscribe,
          releaseLease,
        }
      } catch (error) {
        unsubscribe?.()
        controller?.close()
        releaseLease?.()
        setDocumentError(
          error instanceof Error
            ? error.message
            : "Studio could not start local document persistence."
        )
        return false
      }

      const previousSession = activePersistenceSessionRef.current
      if (
        previousSession &&
        !(await retirePersistenceSession(previousSession, canInstall))
      ) {
        nextSession.unsubscribe()
        nextSession.controller.close()
        nextSession.releaseLease()
        return false
      }
      if (
        !ownsSessionTransition(transition) ||
        !canInstall() ||
        activePersistenceSessionRef.current !== null
      ) {
        nextSession.unsubscribe()
        nextSession.controller.close()
        nextSession.releaseLease()
        return false
      }

      sessionGenerationRef.current = nextSession.generation
      activeRecordRef.current = record
      activePersistenceSessionRef.current = nextSession
      lastCapturedDocumentRef.current = record.envelope.document
      lastCapturedSourceContextRef.current =
        record.envelope.sourceContext ?? null
      projectLocalSaveState(nextSession.controller.state)
      installEditorSession(record.envelope)
      return true
    },
    [
      getDraftRepository,
      installEditorSession,
      ownsSessionTransition,
      projectLocalSaveState,
      retirePersistenceSession,
    ]
  )

  const persistAndInstallSession = useCallback(
    async (envelope: CurrentDraftEnvelope, origin: DraftOrigin) => {
      const transition = claimSessionTransition("replace")
      if (!transition) return false
      try {
        if (persistenceBlockedRef.current || !repositoryReadyRef.current) {
          const validated = validateCurrentDraftSnapshot({
            document: envelope.document,
            sourceContext: envelope.sourceContext,
          })
          if (!validated.ok) {
            setDocumentError(validated.failure.message)
            return false
          }
          if (!ownsSessionTransition(transition)) return false
          const previousSession = activePersistenceSessionRef.current
          if (
            previousSession &&
            !(await retirePersistenceSession(previousSession))
          )
            return false
          if (!ownsSessionTransition(transition)) return false
          activeRecordRef.current = null
          lastCapturedDocumentRef.current = validated.envelope.document
          lastCapturedSourceContextRef.current =
            validated.envelope.sourceContext ?? null
          projectLocalSaveState({
            status: "session_only",
            message:
              "Changes are kept only in this tab because browser document storage is unavailable.",
          })
          rememberStartEnvelope(validated.envelope)
          installEditorSession(validated.envelope)
          return true
        }

        const previousSession = activePersistenceSessionRef.current
        if (
          previousSession &&
          !(await settlePersistenceSession(previousSession))
        )
          return false
        if (!ownsSessionTransition(transition)) return false

        const draftRepository = getDraftRepository()
        const created = await draftRepository.create(
          {
            document: envelope.document,
            sourceContext: envelope.sourceContext,
          },
          origin
        )
        if (!ownsSessionTransition(transition)) return false
        if (!created.ok) {
          const message =
            "failure" in created
              ? created.failure.message
              : created.reason === "exists"
                ? "A document with this identifier already exists."
                : "Studio could not create this document."
          setDocumentError(message)
          projectLocalSaveState({
            status: "failed",
            message,
            retryable: created.reason === "storage_unavailable",
          })
          if (created.reason === "storage_unavailable") {
            setRepositoryLifecycle({
              status: "unavailable",
              failure: created.failure,
            })
          }
          return false
        }
        const installed = await installDraftRecord(created.record, transition)
        if (!ownsSessionTransition(transition)) return false
        return installed
      } finally {
        releaseSessionTransition(transition)
      }
    },
    [
      claimSessionTransition,
      getDraftRepository,
      installDraftRecord,
      installEditorSession,
      ownsSessionTransition,
      projectLocalSaveState,
      releaseSessionTransition,
      rememberStartEnvelope,
      retirePersistenceSession,
      settlePersistenceSession,
    ]
  )

  const openStoredDocument = useCallback(
    async (documentId: string) => {
      if (
        !documentId ||
        !repositoryReadyRef.current ||
        persistenceRef.current.state.status !== "ready"
      )
        return false
      const transition = claimSessionTransition("continue")
      if (!transition) return false
      const opening: OpeningDocumentState = {
        documentId,
        transitionToken: transition.token,
        invalidatingEvents: [],
      }
      openingDocumentIdRef.current = opening
      const ownsOpening = () =>
        ownsSessionTransition(transition) &&
        openingDocumentIdRef.current === opening
      const canContinueOpening = () =>
        ownsOpening() &&
        repositoryReadyRef.current &&
        persistenceRef.current.state.status === "ready"
      const rejectInvalidatedOpening = (event: OpeningInvalidationEvent) => {
        setDocumentError(
          event.type === "saved" || event.type === "restored"
            ? "This document changed in another Studio session while Studio was opening it. Open it again to load the latest version."
            : event.type === "deleted"
              ? "This document was deleted in another Studio session while Studio was opening it."
              : "This document was quarantined while Studio was opening it because another session found corrupt local data."
        )
      }
      const installVerifiedRecord = async (
        record: DocumentDraftRecord,
        touchWarning: string | null = null
      ) => {
        const preInstallInvalidation = selectOpeningInvalidation(
          opening.invalidatingEvents,
          record
        )
        if (preInstallInvalidation) {
          rejectInvalidatedOpening(preInstallInvalidation)
          return false
        }
        const installed = await installDraftRecord(
          record,
          transition,
          canContinueOpening
        )
        if (!canContinueOpening()) return false
        const lateInvalidation = selectOpeningInvalidation(
          opening.invalidatingEvents,
          record
        )
        if (installed && lateInvalidation) {
          projectForeignActiveDocumentEvent(lateInvalidation, true)
        } else if (installed && touchWarning) {
          setDocumentError(touchWarning)
        }
        return installed
      }
      try {
        const draftRepository = getDraftRepository()
        const result = await draftRepository.get(documentId)
        if (!canContinueOpening()) return false
        if (!result.ok || result.status !== "found") {
          const message = !result.ok
            ? result.failure.message
            : "That Studio document no longer exists in this browser."
          setDocumentError(message)
          return false
        }
        if (
          result.record.summary.documentId !== documentId ||
          result.record.envelope.document.id !== documentId
        ) {
          setDocumentError(
            "Studio refused to open a stored document with a different identity."
          )
          return false
        }
        if (result.record.summary.deletedAt !== null) {
          setDocumentError(
            "That Studio document is in Trash. Restore it before opening."
          )
          return false
        }
        const touched = await draftRepository.touchOpened(documentId)
        if (!canContinueOpening()) return false
        if (touched.ok) {
          if (
            touched.value.summary.documentId !== documentId ||
            touched.value.envelope.document.id !== documentId ||
            touched.value.summary.deletedAt !== null
          ) {
            setDocumentError(
              "Studio refused to open a stored document whose identity or Trash state changed."
            )
            return false
          }
          return await installVerifiedRecord(touched.value)
        }
        if (touched.reason === "storage_unavailable") {
          return await installVerifiedRecord(
            result.record,
            `The document opened from verified local bytes, but Studio could not update its recent activity: ${touched.failure.message}`
          )
        }
        const message =
          touched.reason === "missing"
            ? "That Studio document was removed before it could be opened."
            : touched.failure.message
        setDocumentError(message)
        return false
      } finally {
        if (openingDocumentIdRef.current === opening) {
          openingDocumentIdRef.current = null
        }
        releaseSessionTransition(transition)
      }
    },
    [
      claimSessionTransition,
      getDraftRepository,
      installDraftRecord,
      ownsSessionTransition,
      projectForeignActiveDocumentEvent,
      releaseSessionTransition,
    ]
  )

  const continueSessionDocument = useCallback(async () => {
    if (
      startModel.status === "opening" ||
      startModel.status === "recovery_required" ||
      startModel.durable ||
      !startModel.recoverableEnvelope
    )
      return false
    return persistAndInstallSession(startModel.recoverableEnvelope, {
      kind: "import",
    })
  }, [persistAndInstallSession, startModel])

  const captureSettledDraft = useCallback(() => {
    if (sessionModeRef.current !== "workspace") return true
    const document = historyRef.current.document
    const sourceContext = templateSourceContextRef.current
    if (
      lastCapturedDocumentRef.current === document &&
      sourceContextsMatch(lastCapturedSourceContextRef.current, sourceContext)
    )
      return true

    const session = activePersistenceSessionRef.current
    if (!session) {
      const validated = validateCurrentDraftSnapshot({
        document,
        sourceContext,
      })
      if (!validated.ok) {
        setDocumentError(validated.failure.message)
        return false
      }
      lastCapturedDocumentRef.current = document
      lastCapturedSourceContextRef.current = sourceContext
      rememberStartEnvelope(validated.envelope)
      projectLocalSaveState({
        status: "session_only",
        message:
          "Changes are kept only in this tab because browser document storage is unavailable.",
      })
      return true
    }

    return capturePersistenceSession(session)
  }, [capturePersistenceSession, projectLocalSaveState, rememberStartEnvelope])

  const flushActiveDraft = useCallback(async () => {
    if (sessionModeRef.current !== "workspace") return true
    if (!captureSettledDraft()) return false
    if (localSaveStateRef.current.status === "external_change") return false
    const session = activePersistenceSessionRef.current
    if (!session) return true
    await session.controller.flush()
    return session.controller.state.status === "saved"
  }, [captureSettledDraft])

  const retryActiveDraftSave = useCallback(async () => {
    const controller = activePersistenceSessionRef.current?.controller
    if (!controller || controller.state.status !== "failed") return false
    await controller.retry()
    return (controller.state as LocalSaveState).status === "saved"
  }, [])

  const getCurrentDocumentSnapshot = useCallback(
    () => structuredClone(historyRef.current.document),
    []
  )

  const returnToStart = useCallback(async () => {
    if (imageCropSessionRef.current) {
      setDocumentError(
        "Finish or cancel the active image crop before going home."
      )
      return false
    }
    if (pendingChangeSetRef.current) {
      setDocumentError(
        "Resolve or discard the review preview before going home."
      )
      return false
    }
    const transition = claimSessionTransition("home")
    if (!transition) return false
    try {
      const session = activePersistenceSessionRef.current
      if (session && !(await retirePersistenceSession(session))) return false
      if (!ownsSessionTransition(transition)) return false
      if (!session && !(await flushActiveDraft())) return false
      if (!ownsSessionTransition(transition)) return false
      activeRecordRef.current = null
      setSelection(null)
      setSessionMode("start")
      return true
    } finally {
      releaseSessionTransition(transition)
    }
  }, [
    claimSessionTransition,
    flushActiveDraft,
    ownsSessionTransition,
    releaseSessionTransition,
    retirePersistenceSession,
  ])

  useEffect(() => {
    const state = persistence.state
    if (state.status === "opening") {
      persistenceBlockedRef.current = true
      repositoryReadyRef.current = false
      setRepositoryLifecycle({ status: "opening" })
      setStartModel({ status: "opening" })
      return
    }
    if (state.status === "recovery_required") {
      persistenceBlockedRef.current = true
      repositoryReadyRef.current = false
      setDraftRecovery(state.recovery)
      localSaveStateRef.current = {
        status: "failed",
        message: state.recovery.failure.message,
        retryable: false,
      }
      setLocalSaveState(localSaveStateRef.current)
      setStartModel({
        status: "recovery_required",
        recovery: state.recovery,
      })
      return
    }
    if (state.status === "blocked" || state.status === "unavailable") {
      persistenceBlockedRef.current = true
      repositoryReadyRef.current = false
      projectLocalSaveState({
        status: "session_only",
        message: state.failure.message,
      })
      setRepositoryLifecycle({
        status: state.status,
        failure: state.failure,
      })
      setStartModel({
        status: state.status,
        durable: false,
        storageWarning: state.failure.message,
        recoverableEnvelope: state.recoverableEnvelope,
      })
      return
    }

    persistenceBlockedRef.current = false
    repositoryReadyRef.current = true
    setDraftRecovery(null)
    setRepositoryLifecycle({ status: "ready" })
    setStartModel({
      status: "ready",
      durable: true,
      storageWarning: state.warning,
      recoverableEnvelope: null,
    })
  }, [persistence.state, projectLocalSaveState])

  useEffect(() => {
    const unsubscribeRepository =
      persistenceRef.current.subscribeRepositoryEvents((event) => {
        if (!mountedRef.current || !repositoryReadyRef.current) return
        const draftRepository = getDraftRepository()
        const opening = openingDocumentIdRef.current
        if (event.documentId === opening?.documentId) {
          if (
            event.type === "saved" &&
            event.reason === "opened" &&
            event.sessionId === draftRepository.sessionId
          ) {
            opening.invalidatingEvents = []
            return
          }
          if (
            (event.type === "saved" && event.reason === "content_saved") ||
            event.type === "deleted" ||
            event.type === "restored" ||
            event.type === "quarantined"
          ) {
            opening.invalidatingEvents.push(event)
          }
          return
        }
        if (event.documentId === activeRecordRef.current?.summary.documentId) {
          if (event.sessionId === draftRepository.sessionId) return
          projectForeignActiveDocumentEvent(event)
          return
        }
      })
    return unsubscribeRepository
  }, [getDraftRepository, projectForeignActiveDocumentEvent])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionTransitionSequenceRef.current += 1
      activeSessionTransitionRef.current = null
      const session = activePersistenceSessionRef.current
      if (!session) return
      const document = historyRef.current.document
      const sourceContext = templateSourceContextRef.current
      if (
        session.controller.documentId === document.id &&
        (lastCapturedDocumentRef.current !== document ||
          !sourceContextsMatch(
            lastCapturedSourceContextRef.current,
            sourceContext
          ))
      ) {
        try {
          session.controller.capture({ document, sourceContext })
        } catch {
          // A prior verified capture can still drain during teardown.
        }
      }
      session.unsubscribe()
      activePersistenceSessionRef.current = null
      activeRecordRef.current = null
      sessionGenerationRef.current += 1
      void (async () => {
        try {
          await session.controller.flush()
        } catch {
          // Teardown cannot surface UI, but the exact lease remains held until
          // this rejected drain has settled.
        } finally {
          try {
            session.controller.close()
          } finally {
            session.releaseLease()
          }
        }
      })().catch(() => undefined)
    }
  }, [])

  const loadDesignTemplateCatalog = useCallback(() => {
    setDesignTemplateCatalog((current) => ({
      ...current,
      status: "loading",
      error: null,
    }))
    void Promise.resolve()
      .then(() => ({
        items: builtInDesignTemplateRepository.list(),
        categories: builtInDesignTemplateRepository.categories(),
      }))
      .then(({ items, categories }) => {
        setDesignTemplateCatalog({
          status: "ready",
          items,
          categories,
          error: null,
        })
      })
      .catch((error: unknown) => {
        setDesignTemplateCatalog((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "The template catalog could not be loaded.",
        }))
      })
  }, [])

  useEffect(() => {
    loadDesignTemplateCatalog()
  }, [loadDesignTemplateCatalog])

  const readAssetMutationState = useCallback(
    (): AssetMutationState => ({
      snapshotId: historyRef.current.snapshotId,
      document: historyRef.current.document,
      activePageId: activePageIdRef.current,
      reviewPending: pendingChangeSetRef.current !== null,
      recoveryPending: draftRecoveryRef.current !== null,
    }),
    []
  )

  useEffect(() => {
    let cancelled = false
    let storedVersions: string | null = null
    try {
      storedVersions = localStorage.getItem(PUBLISHED_STORAGE_KEY)
    } catch {
      setPublishError("Published versions could not be read in this browser.")
    }
    if (storedVersions)
      void restorePublishedVersions(storedVersions)
        .then((versions) => {
          if (!cancelled) installPublishedVersions(versions)
        })
        .catch(() => {
          if (!cancelled)
            setPublishError("Published versions could not be restored.")
        })
    return () => {
      cancelled = true
    }
  }, [installPublishedVersions])

  useEffect(() => {
    if (sessionMode !== "workspace") return
    const unsynced = [...publishedVersions]
      .sort((a, b) => a.version - b.version)
      .filter((version) => !attemptedVersionSyncRef.current.has(version.id))
    if (!unsynced.length) return
    let cancelled = false
    setPublishSyncStatus("syncing")
    const authoritative: TemplateVersion[] = []
    void unsynced
      .reduce(
        (pending, version) =>
          pending.then(async () => {
            authoritative.push(await syncPublishedVersion(version))
          }),
        Promise.resolve()
      )
      .then(() => {
        if (cancelled) return
        const next = replaceAuthoritativePublishedVersions(
          publishedVersionsRef.current,
          authoritative
        )
        installPublishedVersions(next)
        for (const version of [...unsynced, ...authoritative]) {
          attemptedVersionSyncRef.current.add(version.id)
        }
        setPublishSyncStatus("synced")
        setPublishError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPublishSyncStatus("error")
        setPublishError(
          error instanceof Error ? error.message : "Publishing sync failed."
        )
      })
    return () => {
      cancelled = true
    }
  }, [installPublishedVersions, publishedVersions, sessionMode])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (sessionModeRef.current !== "workspace") return
      captureSettledDraft()
      if (localSaveStateRef.current.status === "saved") return
      event.preventDefault()
      event.returnValue = ""
    }
    const beginBestEffortDrain = () => {
      if (sessionModeRef.current !== "workspace") return
      captureSettledDraft()
      void activePersistenceSessionRef.current?.controller.flush()
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    window.addEventListener("pagehide", beginBestEffortDrain)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload)
      window.removeEventListener("pagehide", beginBestEffortDrain)
    }
  }, [captureSettledDraft])

  useEffect(() => {
    let cancelled = false
    void deriveDocumentSnapshotId(history.document).then((snapshotId) => {
      if (!cancelled) setDocumentSnapshotId(snapshotId)
    })
    return () => {
      cancelled = true
    }
  }, [history.document])

  const downloadDraftRecovery = useCallback(() => {
    const recovery = draftRecovery
    if (!recovery) return
    const blob = new Blob([recovery.raw], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `webmcp-studio-unreadable-draft-${recovery.capturedAt.replaceAll(":", "-")}.json`
    anchor.click()
    setDraftRecoveryNotice(
      "Download started. Both stored copies remain unchanged."
    )
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [draftRecovery])

  const downloadEnvelope = useCallback(
    (envelope: CurrentDraftEnvelope, suffix = "") => {
      try {
        const blob = new Blob([JSON.stringify(envelope, null, 2)], {
          type: "application/json",
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        const safeName =
          envelope.document.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "studio-document"
        anchor.href = url
        anchor.download = `${safeName}${suffix}.studio.json`
        anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        return true
      } catch {
        setDocumentError(
          "Studio could not prepare the current document download."
        )
        return false
      }
    },
    []
  )

  /**
   * Recovery escape hatch for a candidate that cannot currently be saved.
   * This intentionally does not flush: failed/conflicted controller state is
   * precisely why the user needs a byte-exact in-memory copy.
   */
  const downloadCurrentVersion = useCallback(
    () =>
      downloadEnvelope(
        {
          schemaVersion: 1,
          document: historyRef.current.document,
          sourceContext: templateSourceContextRef.current,
        },
        "-my-version"
      ),
    [downloadEnvelope]
  )

  const downloadCurrentDocument = useCallback(async () => {
    if (!(await flushActiveDraft())) return false
    try {
      const current = historyRef.current.document
      const blob = new Blob([JSON.stringify(current, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      const safeName =
        current.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "studio-document"
      anchor.download = `${safeName}.studio.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      return true
    } catch {
      setDocumentError(
        "Studio could not prepare the current document download."
      )
      return false
    }
  }, [flushActiveDraft])

  const retryDraftRecovery = useCallback(async () => {
    const recovery = draftRecovery
    if (!recovery) return
    const transition = claimSessionTransition("recovery")
    if (!transition) return false
    try {
      const decoded =
        recovery.sourceStorageKey === CURRENT_DRAFT_STORAGE_KEY
          ? decodeCurrentDraftEnvelope(recovery.raw)
          : recovery.sourceStorageKey === LEGACY_DOCUMENT_STORAGE_KEY
            ? (() => {
                const legacy = decodeStoredDraft(recovery.raw)
                return legacy.ok
                  ? {
                      ok: true as const,
                      envelope: {
                        schemaVersion: 1 as const,
                        document: legacy.document,
                        sourceContext: null,
                      },
                    }
                  : legacy
              })()
            : {
                ok: false as const,
                failure: recovery.failure,
              }
      if (!decoded.ok) {
        setDraftRecoveryNotice(
          "Recovery still stops at the same safety check. Nothing was changed."
        )
        return false
      }
      const created = await getDraftRepository().create(
        {
          document: decoded.envelope.document,
          sourceContext: decoded.envelope.sourceContext,
        },
        { kind: "current-draft-migration" }
      )
      if (!ownsSessionTransition(transition)) return false
      if (!created.ok) {
        const message =
          "failure" in created
            ? created.failure.message
            : "Studio could not restore this draft without replacing another document."
        setDocumentError(message)
        return false
      }
      let cleanupWarning: string | null = null
      try {
        localStorage.removeItem(CURRENT_DRAFT_STORAGE_KEY)
        localStorage.removeItem(LEGACY_DOCUMENT_STORAGE_KEY)
        localStorage.removeItem(DRAFT_RECOVERY_STORAGE_KEY)
      } catch {
        cleanupWarning =
          "The document was restored, but one legacy recovery key could not be removed."
      }
      persistenceRef.current.completeRecovery(cleanupWarning)
      persistenceBlockedRef.current = false
      repositoryReadyRef.current = true
      setDraftRecovery(null)
      setDraftRecoveryNotice(cleanupWarning)
      const installed = await installDraftRecord(created.record, transition)
      if (!ownsSessionTransition(transition)) return false
      return installed
    } finally {
      releaseSessionTransition(transition)
    }
  }, [
    claimSessionTransition,
    draftRecovery,
    getDraftRepository,
    installDraftRecord,
    ownsSessionTransition,
    releaseSessionTransition,
  ])

  const resetDraftRecovery = useCallback(async () => {
    if (!draftRecovery) return false
    const transition = claimSessionTransition("recovery")
    if (!transition) return false
    try {
      const envelope: CurrentDraftEnvelope = {
        schemaVersion: 1,
        document: quotationStarter.document,
        sourceContext: {
          quotationSource: quotationStarter.source,
          quotationTemplateId: quotationStarter.templateId,
          designTemplate: designTemplateForQuotation(
            quotationStarter.templateId
          ),
        },
      }
      const created = await getDraftRepository().create(
        { document: envelope.document, sourceContext: envelope.sourceContext },
        { kind: "quotation" }
      )
      if (!ownsSessionTransition(transition)) return false
      if (!created.ok) {
        const message =
          "failure" in created
            ? created.failure.message
            : "Studio could not create the reset document without replacing another draft."
        setDocumentError(message)
        setDraftRecoveryNotice(
          "Reset failed. The unreadable recovery copy remains unchanged."
        )
        return false
      }
      let cleanupWarning: string | null = null
      try {
        localStorage.removeItem(CURRENT_DRAFT_STORAGE_KEY)
        localStorage.removeItem(LEGACY_DOCUMENT_STORAGE_KEY)
        localStorage.removeItem(DRAFT_RECOVERY_STORAGE_KEY)
      } catch {
        cleanupWarning =
          "The starter was restored, but one legacy recovery key could not be removed."
      }
      persistenceRef.current.completeRecovery(cleanupWarning)
      persistenceBlockedRef.current = false
      repositoryReadyRef.current = true
      setDraftRecovery(null)
      setDraftRecoveryNotice(cleanupWarning)
      const installed = await installDraftRecord(created.record, transition)
      if (!ownsSessionTransition(transition)) return false
      return installed
    } finally {
      releaseSessionTransition(transition)
    }
  }, [
    claimSessionTransition,
    draftRecovery,
    getDraftRepository,
    installDraftRecord,
    ownsSessionTransition,
    releaseSessionTransition,
  ])

  const changeSetConflict = pendingChangeSet
    ? getChangeSetConflict(
        history.document,
        pendingChangeSet,
        history.snapshotId
      )
    : null

  useEffect(() => {
    const sourceDocument =
      pendingChangeSet && !changeSetConflict
        ? previewChangeSet(
            history.document,
            pendingChangeSet,
            history.snapshotId
          )
        : history.document
    const referencedAssetIds = new Set(
      sourceDocument.nodes.flatMap((node) => {
        if (node.type !== "image") return []
        const assetId = localAssetIdFromSource(node.src)
        return assetId ? [assetId] : []
      })
    )
    referencedLocalAssetIdsRef.current = referencedAssetIds

    let revokedAnAsset = false
    for (const [assetId, url] of assetUrlsRef.current) {
      if (referencedAssetIds.has(assetId)) continue
      URL.revokeObjectURL(url)
      assetUrlsRef.current.delete(assetId)
      revokedAnAsset = true
    }
    if (revokedAnAsset) setAssetVersion((current) => current + 1)

    const missingAssetIds = sourceDocument.nodes.flatMap((node) => {
      if (node.type !== "image") return []
      const assetId = localAssetIdFromSource(node.src)
      return assetId &&
        !assetUrlsRef.current.has(assetId) &&
        !assetLoadPromisesRef.current.has(assetId)
        ? [assetId]
        : []
    })
    if (!missingAssetIds.length) return
    const uniqueAssetIds = [...new Set(missingAssetIds)]
    for (const assetId of uniqueAssetIds) {
      const loadPromise = loadLocalAsset(assetId)
        .then((blob) => {
          if (!blob) {
            if (
              assetLifecycleActiveRef.current &&
              referencedLocalAssetIdsRef.current.has(assetId)
            ) {
              setAssetError("A saved image is missing on this device.")
              setAssetVersion((current) => current + 1)
            }
            return
          }
          if (
            !assetLifecycleActiveRef.current ||
            !referencedLocalAssetIdsRef.current.has(assetId)
          ) {
            return
          }
          const url = URL.createObjectURL(blob)
          if (assetUrlsRef.current.has(assetId)) {
            URL.revokeObjectURL(url)
            return
          }
          assetUrlsRef.current.set(assetId, url)
          setAssetVersion((current) => current + 1)
        })
        .catch(() => {
          if (
            assetLifecycleActiveRef.current &&
            referencedLocalAssetIdsRef.current.has(assetId)
          ) {
            setAssetError("A saved image could not be restored on this device.")
          }
        })
        .finally(() => {
          if (assetLoadPromisesRef.current.get(assetId) === loadPromise) {
            assetLoadPromisesRef.current.delete(assetId)
          }
        })
      assetLoadPromisesRef.current.set(assetId, loadPromise)
    }
  }, [changeSetConflict, history.document, pendingChangeSet])

  useEffect(
    () => () => {
      assetLifecycleActiveRef.current = false
      referencedLocalAssetIdsRef.current.clear()
      for (const url of assetUrlsRef.current.values()) URL.revokeObjectURL(url)
      assetUrlsRef.current.clear()
    },
    []
  )

  const allowMutation = useCallback((allowActiveImageCrop = false) => {
    if (draftRecoveryRef.current) {
      setDocumentError(
        "Resolve the unreadable local draft before editing this document."
      )
      return false
    }
    if (imageCropSessionRef.current && !allowActiveImageCrop) {
      setDocumentError("Finish or cancel the active image crop first.")
      return false
    }
    if (!pendingChangeSetRef.current) return true
    setChangeSetError("Resolve or discard the preview before editing.")
    return false
  }, [])

  const commit = useCallback(
    (
      drafts: CommandDraft[],
      options?: HistoryCommitOptions,
      allowActiveImageCrop = false
    ) => {
      if (!drafts.length) return false
      if (!allowMutation(allowActiveImageCrop)) return false
      try {
        const next = commitCommands(
          historyRef.current,
          drafts.map(commandFromDraft),
          options
        )
        historyRef.current = next
        setHistory(next)
        notifyHistoryCommit(next)
        captureSettledDraft()
        return true
      } catch (error) {
        setDocumentError(
          error instanceof Error
            ? error.message
            : "Studio could not apply that change."
        )
        return false
      }
    },
    [allowMutation, captureSettledDraft, notifyHistoryCommit]
  )

  const imageReplacementCoordinator = useMemo(
    () =>
      new ImageReplacementCoordinator<RendererReplacementPayload>({
        validate: (replacement) => {
          const abortReason = getAssetMutationAbortReason(
            replacement.payload.anchor,
            readAssetMutationState()
          )
          return abortReason
            ? assetMutationMessage("replace", {
                status: "aborted",
                reason: abortReason,
              })
            : null
        },
        commit: (replacement) => {
          const node = findNode(historyRef.current.document, replacement.nodeId)
          if (node?.type !== "image") return false
          return commit(
            [reusableImageReplacementCommand(node, replacement.payload.asset)],
            { label: "Replace image" }
          )
        },
        onPendingChange: setPendingImageReplacement,
        onFailure: setAssetError,
      }),
    [commit, readAssetMutationState]
  )
  imageReplacementCoordinatorRef.current = imageReplacementCoordinator

  useEffect(
    () => () => {
      imageReplacementCoordinator.cancel()
    },
    [imageReplacementCoordinator]
  )

  const reportImageReplacementRendererState = useCallback(
    (event: ImageReplacementRendererEvent) =>
      imageReplacementCoordinatorRef.current?.report(event) ?? "stale",
    []
  )

  const settleImageCrop = useCallback(
    (decision: "apply" | "cancel") => {
      const session = imageCropSessionRef.current
      if (!session) return true
      if (decision === "cancel") {
        cancelImageCropSession(session)
        closeImageCropSession()
        return true
      }
      const result = applyImageCropSession(
        session,
        historyRef.current.document,
        activePageIdRef.current
      )
      if (result.status === "cancelled") {
        closeImageCropSession()
        setDocumentError(
          "Crop was cancelled because the image changed somewhere else."
        )
        return false
      }
      if (result.status === "unchanged") {
        closeImageCropSession()
        return true
      }
      const committed = commit(
        [...result.transaction.commands],
        { label: result.transaction.label },
        true
      )
      if (committed) {
        closeImageCropSession()
      }
      return committed
    },
    [closeImageCropSession, commit]
  )

  const selectPage = useCallback(
    (pageId: string) => {
      if (pageId === activePageIdRef.current) return
      if (!settleImageCrop("apply")) return
      activePageIdRef.current = pageId
      setActivePageId(pageId)
      setSelection(null)
    },
    [settleImageCrop]
  )

  const updateNodes = useCallback(
    (changes: CanvasNodeChange[]) => {
      return commit(
        changes.map(({ nodeId, patch }) => ({
          type: "update_node",
          nodeId,
          patch,
        })),
        canvasChangeHistoryOptions(changes, historyRef.current.document.nodes)
      )
    },
    [commit]
  )

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<SceneNode>) =>
      commit([{ type: "update_node", nodeId, patch }]),
    [commit]
  )

  const setImageFrameMask = useCallback(
    (nodeId: string, frameMask: ImageFrameMask) => {
      const current = imageCropSessionRef.current
      if (current?.target.nodeId === nodeId) {
        const result = imageCropPreviewStoreRef.current?.preview(
          current.target,
          { frameMask }
        )
        if (result !== "accepted" && result !== "unchanged") return false
        imageCropSessionRef.current =
          imageCropPreviewStoreRef.current?.getLiveSession() ?? current
        return true
      }
      return commit([{ type: "set_image_frame_mask", nodeId, frameMask }], {
        label: "Change image frame",
      })
    },
    [commit]
  )

  const setImagePlacement = useCallback(
    (
      nodeId: string,
      placement: Extract<SceneNode, { type: "image" }>["placement"],
      label = "Change image placement"
    ) => {
      const current = imageCropSessionRef.current
      if (current?.target.nodeId === nodeId) {
        const result = imageCropPreviewStoreRef.current?.preview(
          current.target,
          { placement }
        )
        if (result !== "accepted" && result !== "unchanged") return false
        imageCropSessionRef.current =
          imageCropPreviewStoreRef.current?.getLiveSession() ?? current
        return true
      }
      return commit([{ type: "set_image_placement", nodeId, placement }], {
        label,
      })
    },
    [commit]
  )

  const updateSelectionNodes = useCallback(
    (patch: Partial<SceneNode>) => {
      const editableNodeIds = (selection?.nodeIds ?? []).filter((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node !== undefined && !node.locked
      })
      if (!editableNodeIds.length) return false
      return commit(
        editableNodeIds.map((nodeId) => ({
          type: "update_node" as const,
          nodeId,
          patch,
        })),
        { label: "Update selection properties" }
      )
    },
    [commit, selection]
  )

  const beginImageCrop = useCallback(
    (nodeId: string) => {
      if (!allowMutation()) return false
      const result = startImageCropSession(
        historyRef.current.document,
        activePageIdRef.current,
        nodeId
      )
      if (result.status === "rejected") {
        const message =
          result.reason === "target_locked"
            ? "Unlock this image before cropping it."
            : result.reason === "target_hidden"
              ? "Show this image before cropping it."
              : result.reason === "target_not_image"
                ? "Crop is available only for image layers."
                : "This image is no longer available on the active page."
        setDocumentError(message)
        return false
      }
      setSelection({
        pageId: result.session.target.pageId,
        nodeIds: [result.session.target.nodeId],
      })
      imageCropPreviewStoreRef.current?.destroy()
      const previewStore = createImageCropPreviewStore(result.session)
      imageCropPreviewStoreRef.current = previewStore
      imageCropSessionRef.current = result.session
      setImageCropPreviewStore(previewStore)
      setDocumentError(null)
      return true
    },
    [allowMutation]
  )

  const reportImageCropReadiness = useCallback(
    (readiness: "unknown" | "loading" | "unavailable") => {
      setDocumentError(
        readiness === "loading"
          ? "This image is still loading. Try Crop again when image editing is ready."
          : readiness === "unavailable"
            ? "This image could not be loaded. Replace it before cropping."
            : "Image editing is not ready yet. Wait for the canvas to verify this source, then try Crop again."
      )
      return false
    },
    []
  )

  const previewImageCrop = useCallback(
    (patch: Partial<Extract<SceneNode, { type: "image" }>["placement"]>) => {
      const current = imageCropSessionRef.current
      const store = imageCropPreviewStoreRef.current
      if (!current || !store) return false
      const result = store.preview(current.target, { placement: patch })
      if (result !== "accepted" && result !== "unchanged") return false
      imageCropSessionRef.current = store.getLiveSession()
      return true
    },
    []
  )

  const previewImageCropFrame = useCallback(
    (preview: {
      nodeId: string
      frame: ImageCropSession["draftFrame"]
      placement: ImageCropSession["draft"]
      frameMask: ImageCropSession["draftFrameMask"]
    }) => {
      const current = imageCropSessionRef.current
      const store = imageCropPreviewStoreRef.current
      if (!current || !store || current.target.nodeId !== preview.nodeId) {
        return false
      }
      const result = store.preview(current.target, {
        frame: preview.frame,
        placement: preview.placement,
        frameMask: preview.frameMask,
      })
      if (result !== "accepted" && result !== "unchanged") return false
      imageCropSessionRef.current = store.getLiveSession()
      return true
    },
    []
  )

  const finishImageCrop = useCallback(
    () => settleImageCrop("apply"),
    [settleImageCrop]
  )

  const discardImageCrop = useCallback(
    () => settleImageCrop("cancel"),
    [settleImageCrop]
  )

  const rejectUnavailableImageCrop = useCallback(
    (nodeId: string) => {
      const current = imageCropSessionRef.current
      const resolution = resolveUnavailableImageCrop(current, nodeId)
      if (!resolution.handled || !current) return false
      cancelImageCropSession(current)
      closeImageCropSession()
      setDocumentError(resolution.error)
      return true
    },
    [closeImageCropSession]
  )

  const setEditorSelection = useCallback(
    (nextSelection: Selection | null) => {
      const cropTargetId = imageCropSessionRef.current?.target.nodeId
      const keepsCropTarget =
        cropTargetId !== undefined &&
        nextSelection?.pageId === activePageIdRef.current &&
        nextSelection.nodeIds.length === 1 &&
        nextSelection.nodeIds[0] === cropTargetId
      if (cropTargetId && !keepsCropTarget && !settleImageCrop("apply")) {
        return
      }
      setSelection(nextSelection)
    },
    [settleImageCrop]
  )

  const updateField = useCallback(
    (fieldId: string, value: string | number | boolean) => {
      return commit([{ type: "set_field", fieldId, value }])
    },
    [commit]
  )

  const createField = useCallback(
    (field: Omit<FieldDefinition, "id">) => {
      return commit([
        {
          type: "add_field",
          field: { ...field, id: `field-${crypto.randomUUID()}` },
        },
      ])
    },
    [commit]
  )

  const updateFieldDefinition = useCallback(
    (fieldId: string, patch: Partial<Omit<FieldDefinition, "id">>) => {
      commit([{ type: "update_field", fieldId, patch }])
    },
    [commit]
  )

  const removeField = useCallback(
    (fieldId: string) => {
      commit([{ type: "remove_field", fieldId }])
    },
    [commit]
  )

  const bindField = useCallback(
    (fieldId: string, nodeId: string, property: FieldBinding["property"]) => {
      return commit([
        {
          type: "bind_field",
          binding: {
            id: `binding-${crypto.randomUUID()}`,
            fieldId,
            nodeId,
            property,
          },
        },
      ])
    },
    [commit]
  )

  const unbindField = useCallback(
    (bindingId: string) => {
      commit([{ type: "unbind_field", bindingId }])
    },
    [commit]
  )

  const proposeChangeSet = useCallback(
    (changeSetInput: ChangeSet) => {
      if (draftRecoveryRef.current) {
        throw new Error(
          "Resolve the unreadable local draft before proposing changes."
        )
      }
      if (pendingChangeSetRef.current) {
        throw new Error("Resolve or discard the pending change set first.")
      }
      if (imageCropSessionRef.current) settleImageCrop("cancel")
      const changeSet = changeSetSchema.parse(changeSetInput)
      const conflict = getChangeSetConflict(
        historyRef.current.document,
        changeSet,
        historyRef.current.snapshotId
      )
      if (conflict) throw new Error(conflict.message)
      previewChangeSet(
        historyRef.current.document,
        changeSet,
        historyRef.current.snapshotId
      )
      const proposedPage = changeSet.operations.find(
        (operation) => operation.command.type === "add_output_variant"
      )?.command
      pendingChangeSetRef.current = changeSet
      setPendingChangeSet(changeSet)
      setChangeSetError(null)
      setSelection(null)
      if (proposedPage?.type === "add_output_variant") {
        activePageIdRef.current = proposedPage.page.id
        setActivePageId(proposedPage.page.id)
      }
      return changeSet
    },
    [settleImageCrop]
  )

  const decideOperation = useCallback(
    (operationId: string, status: ChangeOperation["status"]) => {
      setPendingChangeSet((current) =>
        current ? decideChangeOperation(current, operationId, status) : current
      )
      setChangeSetError(null)
    },
    []
  )

  const decideAllOperations = useCallback(
    (status: Exclude<ChangeOperation["status"], "pending">) => {
      setPendingChangeSet((current) =>
        current ? decideAllChangeOperations(current, status) : current
      )
      setChangeSetError(null)
    },
    []
  )

  const discardChangeSet = useCallback(() => {
    const current = pendingChangeSetRef.current
    if (!current) return
    const rejected = decideAllChangeOperations(current, "rejected")
    setLastResolvedChangeSet(rejected)
    pendingChangeSetRef.current = null
    setPendingChangeSet(null)
    setChangeSetError(null)
    if (
      !historyRef.current.document.pages.some(
        (page) => page.id === activePageId
      )
    ) {
      setActivePageId(historyRef.current.document.pages[0].id)
    }
  }, [activePageId])

  const applyChangeSet = useCallback(async () => {
    if (draftRecoveryRef.current) {
      setChangeSetError(
        "Resolve the unreadable local draft before applying changes."
      )
      return
    }
    if (applyingChangeSetRef.current) return
    const current = pendingChangeSetRef.current
    if (!current) return
    const conflict = getChangeSetConflict(
      historyRef.current.document,
      current,
      historyRef.current.snapshotId
    )
    if (conflict) {
      setChangeSetError(conflict.message)
      return
    }
    const commands = current.operations
      .filter((operation) => operation.status === "accepted")
      .map((operation) => operation.command)
    if (!commands.length) {
      setChangeSetError("Accept at least one operation before applying.")
      return
    }
    applyingChangeSetRef.current = true
    setIsApplyingChangeSet(true)
    try {
      const managedAssetIds = managedAssetIdsInCommands(commands)
      const managedAssets = await Promise.all(
        managedAssetIds.map((assetId) => getManagedMedia(assetId))
      )
      if (managedAssets.some((asset) => !asset?.selectable)) {
        setChangeSetError(
          "An image in this review is no longer available. Inspect the current design and create a new review."
        )
        return
      }
      if (pendingChangeSetRef.current?.id !== current.id) return
      const latestConflict = getChangeSetConflict(
        historyRef.current.document,
        current,
        historyRef.current.snapshotId
      )
      if (latestConflict) {
        setChangeSetError(latestConflict.message)
        return
      }
      const next = commitCommands(historyRef.current, commands, {
        label: current.title,
      })
      historyRef.current = next
      setHistory(next)
      notifyHistoryCommit(next)
      captureSettledDraft()
      setLastResolvedChangeSet(current)
      pendingChangeSetRef.current = null
      setPendingChangeSet(null)
      setChangeSetError(null)
      setSelection(null)
    } catch {
      setChangeSetError(
        "Studio could not recheck the review’s images. Check your connection and retry."
      )
    } finally {
      applyingChangeSetRef.current = false
      setIsApplyingChangeSet(false)
    }
  }, [captureSettledDraft, notifyHistoryCommit])

  const publishTemplate = useCallback(async () => {
    if (draftRecoveryRef.current) {
      const message =
        "Resolve the unreadable local draft before publishing this document."
      setPublishError(message)
      throw new Error(message)
    }
    if (pendingChangeSetRef.current) {
      const message = "Resolve the pending change set before publishing."
      setPublishError(message)
      throw new Error(message)
    }
    if (imageCropSessionRef.current) {
      const message =
        "Finish or cancel the active image crop before publishing."
      setPublishError(message)
      throw new Error(message)
    }
    if (!(await flushActiveDraft())) {
      const message =
        "Studio could not durably save the current document before publishing."
      setPublishError(message)
      throw new Error(message)
    }
    const controller = activePersistenceSessionRef.current?.controller ?? null
    if (!controller) {
      const message =
        "Publishing requires durable browser document storage. Download your version and restore storage access before publishing."
      setPublishError(message)
      throw new Error(message)
    }
    const document = structuredClone(historyRef.current.document)
    const draftRepository = getDraftRepository()
    const durableRead = await draftRepository.get(document.id)
    if (!durableRead.ok || durableRead.status !== "found") {
      const message = !durableRead.ok
        ? durableRead.failure.message
        : "The saved document disappeared before publication could begin."
      setPublishError(message)
      throw new Error(message)
    }
    const durableHead = durableRead.record
    const templateId = quotationSource
      ? activeQuotationTemplateId
      : `template-${document.id}`
    const existing = publishedVersionsForDocument(
      publishedVersions,
      templateId,
      document.id
    ).sort((a, b) => b.version - a.version)
    const latest = existing.at(0)
    const sourceSnapshotId = await deriveDocumentSnapshotId(document)
    if (
      durableHead.summary.documentId !== document.id ||
      durableHead.summary.recordVersion !== controller.recordVersion ||
      durableHead.summary.contentSnapshotId !== controller.contentSnapshotId ||
      durableHead.summary.contentSnapshotId !== sourceSnapshotId
    ) {
      const message =
        "The local document changed while Studio was preparing publication. Save the latest head and publish again."
      setPublishError(message)
      throw new Error(message)
    }
    activeRecordRef.current = durableHead
    const linkAuthoritativePublication = async (
      authoritative: TemplateVersion
    ) => {
      const linked = await draftRepository.linkPublication({
        documentId: durableHead.summary.documentId,
        recordVersion: durableHead.summary.recordVersion,
        contentSnapshotId: durableHead.summary.contentSnapshotId,
        templateId: authoritative.templateId,
        templateVersionId: authoritative.id,
        templateVersion: authoritative.version,
        publishedAt: authoritative.publishedAt,
      })
      if (linked.ok) {
        const active = activeRecordRef.current
        if (
          active?.summary.documentId === linked.summary.documentId &&
          active.summary.recordVersion === linked.summary.recordVersion &&
          active.summary.contentSnapshotId === linked.summary.contentSnapshotId
        ) {
          const nextRecord = { ...active, summary: linked.summary }
          activeRecordRef.current = nextRecord
        }
        return
      }
      if (linked.reason === "stale_head") {
        setDocumentError(
          "Publication succeeded, and newer local edits remain unpublished."
        )
        return
      }
      const message =
        "failure" in linked
          ? linked.failure.message
          : linked.reason === "deleted"
            ? "Publication succeeded, but the local draft was deleted before it could be linked."
            : "Publication succeeded, but its local draft link could not be recorded."
      setDocumentError(message)
    }
    const contentMatch = existing.find(
      (version) => version.sourceSnapshotId === sourceSnapshotId
    )
    if (contentMatch) {
      try {
        setPublishSyncStatus("syncing")
        let authoritative = contentMatch
        const synchronized: TemplateVersion[] = []
        for (const version of [...existing].sort(
          (a, b) => a.version - b.version
        )) {
          const synced = await syncPublishedVersion(version)
          synchronized.push(synced)
          if (version.id === contentMatch.id) authoritative = synced
        }
        const next = replaceAuthoritativePublishedVersions(
          publishedVersionsRef.current,
          synchronized
        )
        installPublishedVersions(next)
        for (const version of [...existing, ...synchronized]) {
          attemptedVersionSyncRef.current.add(version.id)
        }
        setPublishSyncStatus("synced")
        setPublishError(null)
        await linkAuthoritativePublication(authoritative)
        return authoritative
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Publishing sync failed."
        setPublishSyncStatus("error")
        setPublishError(message)
        throw error
      }
    }
    try {
      const version = createTemplateVersion(document, {
        id: `template-version-${crypto.randomUUID()}`,
        templateId,
        version: (latest?.version ?? 0) + 1,
        sourceSnapshotId,
        publishedAt: new Date().toISOString(),
      })
      setPublishSyncStatus("syncing")
      let authoritative = version
      const synchronized: TemplateVersion[] = []
      for (const candidate of [...existing, version].sort(
        (a, b) => a.version - b.version
      )) {
        const synced = await syncPublishedVersion(candidate)
        synchronized.push(synced)
        if (candidate.id === version.id) authoritative = synced
      }
      const next = replaceAuthoritativePublishedVersions(
        [...publishedVersionsRef.current, version],
        synchronized
      )
      installPublishedVersions(next)
      for (const candidate of [...existing, version, ...synchronized]) {
        attemptedVersionSyncRef.current.add(candidate.id)
      }
      setPublishSyncStatus("synced")
      setPublishError(null)
      await linkAuthoritativePublication(authoritative)
      return authoritative
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Publishing failed."
      setPublishError(message)
      setPublishSyncStatus("error")
      throw error
    }
  }, [
    activeQuotationTemplateId,
    flushActiveDraft,
    getDraftRepository,
    installPublishedVersions,
    publishedVersions,
    quotationSource,
  ])

  const addText = useCallback(
    (presetId: StudioTextPresetId = defaultStudioTextPresetId) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return null
      const id = `text-${crypto.randomUUID()}`
      const activeTemplateInk = quotationSource
        ? quotationTemplates.find(
            (template) => template.id === activeQuotationTemplateId
          )?.palette.ink
        : undefined
      const pageNodeIds = new Set(page.nodeIds)
      const pageTextColorCounts = historyRef.current.document.nodes.reduce(
        (counts, node) => {
          if (
            pageNodeIds.has(node.id) &&
            node.type === "text" &&
            node.visible
          ) {
            counts.set(node.color, (counts.get(node.color) ?? 0) + 1)
          }
          return counts
        },
        new Map<string, number>()
      )
      const existingTextColors = [...pageTextColorCounts]
        .sort((left, right) => right[1] - left[1])
        .map(([color]) => color)
      const node = createStudioTextNode(page, presetId, id, {
        preferredColors: [
          ...(activeTemplateInk ? [activeTemplateInk] : []),
          ...existingTextColors,
        ],
      })
      if (commit([{ type: "add_node", pageId: page.id, node }])) {
        setSelection({ pageId: page.id, nodeIds: [id] })
        return id
      }
      return null
    },
    [activePageId, activeQuotationTemplateId, commit, quotationSource]
  )

  const addRectangle = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `rect-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "rect",
      name: "Rectangle",
      x: Math.round(page.width / 2 - 180),
      y: Math.round(page.height / 2 - 130),
      width: 360,
      height: 260,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#d9c9b2",
      radius: 24,
      strokeWidth: 0,
    }
    if (commit([{ type: "add_node", pageId: page.id, node }])) {
      setSelection({ pageId: page.id, nodeIds: [id] })
    }
  }, [activePageId, commit])

  const addEllipse = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `ellipse-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "ellipse",
      name: "Ellipse",
      x: Math.round(page.width / 2 - 150),
      y: Math.round(page.height / 2 - 150),
      width: 300,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#d9c9b2",
      strokeWidth: 0,
    }
    if (commit([{ type: "add_node", pageId: page.id, node }])) {
      setSelection({ pageId: page.id, nodeIds: [id] })
    }
  }, [activePageId, commit])

  const addLine = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page) return
    const id = `line-${crypto.randomUUID()}`
    const node: SceneNode = {
      id,
      type: "line",
      name: "Line",
      x: Math.round(page.width / 2 - 180),
      y: Math.round(page.height / 2),
      width: 360,
      height: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      stroke: "#1e2622",
      strokeWidth: 4,
    }
    if (commit([{ type: "add_node", pageId: page.id, node }])) {
      setSelection({ pageId: page.id, nodeIds: [id] })
    }
  }, [activePageId, commit])

  const addIcon = useCallback(
    ({
      name,
      path,
      viewBox,
    }: {
      name: string
      path: string
      viewBox: string
    }) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const id = `icon-${crypto.randomUUID()}`
      const node: SceneNode = {
        id,
        type: "icon",
        name,
        path,
        viewBox,
        x: Math.round(page.width / 2 - 90),
        y: Math.round(page.height / 2 - 90),
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#8a5d38",
        strokeWidth: 0,
      }
      if (commit([{ type: "add_node", pageId: page.id, node }])) {
        setSelection({ pageId: page.id, nodeIds: [id] })
      }
    },
    [activePageId, commit]
  )

  const addImageFile = useCallback(
    async (file: File) => {
      if (!allowMutation()) return
      setAssetError(null)
      const validationError = validateMediaFile(file)
      if (validationError) {
        setAssetError(validationError)
        return
      }
      if (assetMutationActiveRef.current) {
        setAssetError(
          "Another image is still being prepared. Wait, then retry."
        )
        return
      }
      const initialState = readAssetMutationState()
      const anchor = captureAddAssetAnchor(initialState)
      const page = initialState.document.pages.find(
        (candidate) => candidate.id === anchor?.pageId
      )
      if (!anchor || !page) {
        setAssetError(
          "The active page is unavailable. Choose a page and retry."
        )
        return
      }
      assetMutationActiveRef.current = true
      setIsImportingAsset(true)
      try {
        await assertLocalAssetCapacity(file.size)
        const assetId = `asset-${crypto.randomUUID()}`
        const id = `image-${crypto.randomUUID()}`
        const result = await executeAssetMutation({
          anchor,
          readState: readAssetMutationState,
          prepare: () => decodeValidatedImageDimensions(file),
          persist: (dimensions) => saveLocalAsset(file, assetId, dimensions),
          rollback: () => rollbackLocalAsset(assetId),
          commit: (dimensions) => {
            const maxWidth = Math.min(640, page.width * 0.64)
            const maxHeight = Math.min(640, page.height * 0.64)
            const scale = Math.min(
              maxWidth / dimensions.width,
              maxHeight / dimensions.height,
              1
            )
            const width = Math.max(1, Math.round(dimensions.width * scale))
            const height = Math.max(1, Math.round(dimensions.height * scale))
            const node: SceneNode = {
              id,
              type: "image",
              name: file.name.replace(/\.[^.]+$/, "") || "Image",
              assetId,
              src: localAssetSource(assetId),
              alt: file.name,
              altProvenance: "generated",
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
              decorative: false,
              x: Math.round((page.width - width) / 2),
              y: Math.round((page.height - height) / 2),
              width,
              height,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
            }
            return commit([{ type: "add_node", pageId: page.id, node }])
          },
        })
        if (result.status === "committed") {
          try {
            assetUrlsRef.current.set(assetId, URL.createObjectURL(file))
            setAssetVersion((current) => current + 1)
          } catch {
            setAssetError(
              "The image was added, but its preview could not open. Reload Studio to restore it from local storage."
            )
          }
          setSelection({ pageId: page.id, nodeIds: [id] })
        } else {
          setAssetError(assetMutationMessage("add", result))
        }
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The image could not be added: ${error.message}`
            : "The image could not be added. Retry after checking browser storage."
        )
      } finally {
        assetMutationActiveRef.current = false
        setIsImportingAsset(false)
      }
    },
    [allowMutation, commit, readAssetMutationState]
  )

  const addReusableImageAsset = useCallback(
    (asset: ReusableImageAsset) => {
      if (!allowMutation()) return false
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return false
      const id = `image-${crypto.randomUUID()}`
      const node = createReusableImageNode(page, asset, id)
      if (commit([{ type: "add_node", pageId: page.id, node }])) {
        setSelection({ pageId: page.id, nodeIds: [id] })
        return true
      }
      return false
    },
    [activePageId, allowMutation, commit]
  )

  const replaceReusableImageAsset = useCallback(
    (nodeId: string, asset: ReusableImageAsset) => {
      if (!allowMutation()) return false
      const bindingImpact = imageReplacementBindingImpact(
        historyRef.current.document,
        nodeId
      )
      if (bindingImpact) {
        setAssetError(bindingImpact.message)
        return false
      }
      const node = historyRef.current.document.nodes.find(
        (candidate) => candidate.id === nodeId
      )
      if (!node || node.type !== "image") return false
      setAssetError(null)
      return commit([reusableImageReplacementCommand(node, asset)], {
        label: "Replace image",
      })
    },
    [allowMutation, commit]
  )

  const beginRendererAcknowledgedReplacement = useCallback(
    (nodeId: string) => {
      if (!allowMutation()) return null
      const bindingImpact = imageReplacementBindingImpact(
        historyRef.current.document,
        nodeId
      )
      if (bindingImpact) {
        setAssetError(bindingImpact.message)
        return null
      }
      if (assetMutationActiveRef.current) {
        setAssetError(
          "Another image is still being prepared. Wait, then retry."
        )
        return null
      }
      const anchor = captureReplaceAssetAnchor(readAssetMutationState(), nodeId)
      if (!anchor) {
        setAssetError(
          "That image layer is no longer available on the active page. Select it and retry."
        )
        return null
      }
      assetMutationActiveRef.current = true
      setIsImportingAsset(true)
      setAssetError(null)
      return anchor
    },
    [allowMutation, readAssetMutationState]
  )

  const awaitRendererAcknowledgedReplacement = useCallback(
    (
      anchor: AssetMutationAnchor,
      asset: ReusableImageAsset,
      previewSrc = asset.src
    ) => {
      const abortReason = getAssetMutationAbortReason(
        anchor,
        readAssetMutationState()
      )
      if (abortReason) {
        setAssetError(
          assetMutationMessage("replace", {
            status: "aborted",
            reason: abortReason,
          })
        )
        return Promise.resolve(false)
      }
      return imageReplacementCoordinator.start({
        token: `image-replacement-${crypto.randomUUID()}`,
        nodeId: anchor.nodeId ?? "",
        previewSrc,
        naturalSize: { width: asset.width, height: asset.height },
        payload: { anchor, asset },
      })
    },
    [imageReplacementCoordinator, readAssetMutationState]
  )

  const addLibraryAsset = useCallback(
    (asset: StudioAsset) =>
      addReusableImageAsset({
        assetId: `library-${asset.id}`,
        name: asset.name,
        description: asset.description,
        src: asset.src,
        width: asset.width,
        height: asset.height,
      }),
    [addReusableImageAsset]
  )

  const replaceImageWithLibraryAsset = useCallback(
    async (nodeId: string, asset: StudioAsset) => {
      const anchor = beginRendererAcknowledgedReplacement(nodeId)
      if (!anchor) return false
      try {
        const dimensions = await decodeBrowserImageSource(asset.src)
        const dimensionError = validateMediaDimensions(dimensions)
        if (dimensionError) throw new Error(dimensionError)
        if (
          dimensions.width !== asset.width ||
          dimensions.height !== asset.height
        ) {
          throw new Error(
            `The library image decoded as ${dimensions.width} × ${dimensions.height}, expected ${asset.width} × ${asset.height}.`
          )
        }
        return await awaitRendererAcknowledgedReplacement(anchor, {
          assetId: `library-${asset.id}`,
          name: asset.name,
          description: asset.description,
          src: asset.src,
          ...dimensions,
        })
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The library image could not be prepared: ${error.message} The original image was kept.`
            : "The library image could not be prepared. The original image was kept."
        )
        return false
      } finally {
        assetMutationActiveRef.current = false
        setIsImportingAsset(false)
      }
    },
    [awaitRendererAcknowledgedReplacement, beginRendererAcknowledgedReplacement]
  )

  const addManagedMediaAsset = useCallback(
    async (asset: ManagedMediaAsset) => {
      if (!allowMutation()) return false
      const anchor = captureAddAssetAnchor(readAssetMutationState())
      if (!anchor) return false
      try {
        const current = await getManagedMedia(asset.id)
        if (!current?.selectable) {
          setAssetError(
            "That workspace image is no longer available. Refresh the media library and choose another image."
          )
          return false
        }
        const resource = await verifyManagedBrowserImageResource(
          current,
          decodeValidatedImageDimensions
        )
        const abortReason = getAssetMutationAbortReason(
          anchor,
          readAssetMutationState()
        )
        if (abortReason) {
          setAssetError(
            assetMutationMessage("add", {
              status: "aborted",
              reason: abortReason,
            })
          )
          return false
        }
        const committed = addReusableImageAsset({
          assetId: current.id,
          name: current.name.replace(/\.[^.]+$/, "") || "Image",
          description: current.name,
          src: resource.src,
          width: resource.width,
          height: resource.height,
        })
        if (committed) {
          try {
            await markManagedMediaUsed(current.id)
          } catch {
            setAssetError(
              "The image was added, but Studio could not update its Recent position. The design change is safe."
            )
          }
        }
        return committed
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The workspace image could not be decoded: ${error.message}`
            : "The workspace image could not be decoded. Choose another image."
        )
        return false
      }
    },
    [addReusableImageAsset, allowMutation, readAssetMutationState]
  )

  const replaceImageWithManagedMediaAsset = useCallback(
    async (nodeId: string, asset: ManagedMediaAsset) => {
      const anchor = beginRendererAcknowledgedReplacement(nodeId)
      if (!anchor) return false
      try {
        const current = await getManagedMedia(asset.id)
        if (!current?.selectable) {
          setAssetError(
            "That workspace image is no longer available. Refresh the media library and choose another image."
          )
          return false
        }
        const resource = await verifyManagedBrowserImageResource(
          current,
          decodeValidatedImageDimensions
        )
        const committed = await awaitRendererAcknowledgedReplacement(
          anchor,
          {
            assetId: current.id,
            name: current.name.replace(/\.[^.]+$/, "") || "Image",
            description: current.name,
            src: resource.src,
            width: resource.width,
            height: resource.height,
          },
          managedMediaContentUrl(current.id)
        )
        if (committed) {
          try {
            await markManagedMediaUsed(current.id)
          } catch {
            setAssetError(
              "The image was replaced, but Studio could not update its Recent position. The design change is safe."
            )
          }
        }
        return committed
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The replacement image could not be decoded: ${error.message}`
            : "The replacement image could not be decoded. Choose another image."
        )
        return false
      } finally {
        assetMutationActiveRef.current = false
        setIsImportingAsset(false)
      }
    },
    [awaitRendererAcknowledgedReplacement, beginRendererAcknowledgedReplacement]
  )

  const replaceImageFile = useCallback(
    async (nodeId: string, file: File) => {
      if (!allowMutation()) return
      const bindingImpact = imageReplacementBindingImpact(
        historyRef.current.document,
        nodeId
      )
      if (bindingImpact) {
        setAssetError(bindingImpact.message)
        return
      }
      setAssetError(null)
      const validationError = validateMediaFile(file)
      if (validationError) {
        setAssetError(validationError)
        return
      }
      if (assetMutationActiveRef.current) {
        setAssetError(
          "Another image is still being prepared. Wait, then retry."
        )
        return
      }
      const anchor = captureReplaceAssetAnchor(readAssetMutationState(), nodeId)
      if (!anchor) {
        setAssetError(
          "That image layer is no longer available on the active page. Select it and retry."
        )
        return
      }
      assetMutationActiveRef.current = true
      setIsImportingAsset(true)
      try {
        await assertLocalAssetCapacity(file.size)
        const assetId = `asset-${crypto.randomUUID()}`
        let stagedSource: StagedLocalImageSource | null = null
        const result = await executeAssetMutation({
          anchor,
          readState: readAssetMutationState,
          prepare: () => decodeValidatedImageDimensions(file),
          persist: (dimensions) => saveLocalAsset(file, assetId, dimensions),
          activate: async (dimensions) => {
            stagedSource = await stageUsableLocalImageSource(file, dimensions)
            assetUrlsRef.current.set(assetId, stagedSource.src)
          },
          rollback: async () => {
            if (assetUrlsRef.current.get(assetId) === stagedSource?.src) {
              assetUrlsRef.current.delete(assetId)
            }
            stagedSource?.release()
            await rollbackLocalAsset(assetId)
          },
          commit: (dimensions) => {
            const node = findNode(historyRef.current.document, nodeId)
            if (node?.type !== "image") return false
            return commit(
              [
                reusableImageReplacementCommand(node, {
                  assetId,
                  name: file.name.replace(/\.[^.]+$/, "") || "Image",
                  description: file.name,
                  src: localAssetSource(assetId),
                  ...dimensions,
                }),
              ],
              { label: "Replace image" }
            )
          },
        })
        if (result.status === "committed") {
          setAssetVersion((current) => current + 1)
        } else {
          setAssetError(assetMutationMessage("replace", result))
        }
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The image could not be replaced: ${error.message}`
            : "The image could not be replaced. Retry after checking browser storage."
        )
      } finally {
        assetMutationActiveRef.current = false
        setIsImportingAsset(false)
      }
    },
    [allowMutation, commit, readAssetMutationState]
  )

  const reuseLocalAsset = useCallback(
    async (asset: LocalAssetSummary, replacementNodeId?: string) => {
      if (!allowMutation()) return false
      if (replacementNodeId) {
        const bindingImpact = imageReplacementBindingImpact(
          historyRef.current.document,
          replacementNodeId
        )
        if (bindingImpact) {
          setAssetError(bindingImpact.message)
          return false
        }
      }
      if (assetMutationActiveRef.current) {
        setAssetError(
          "Another image is still being prepared. Wait, then retry."
        )
        return false
      }
      const initialState = readAssetMutationState()
      const anchor = replacementNodeId
        ? captureReplaceAssetAnchor(initialState, replacementNodeId)
        : captureAddAssetAnchor(initialState)
      if (!anchor) {
        setAssetError(
          replacementNodeId
            ? "That image layer is no longer available on the active page. Select it and retry."
            : "The active page is unavailable. Choose a page and retry."
        )
        return false
      }
      assetMutationActiveRef.current = true
      setIsImportingAsset(true)
      setAssetError(null)
      let stagedReplacementSource: StagedLocalImageSource | null = null
      let previousPreviewSource: string | undefined
      let replacementCommitted = false
      try {
        const record = await getLocalAssetRecord(asset.id)
        if (!record) {
          setAssetError(
            `The file “${asset.name}” is missing on this device. Locate a replacement or remove its unused library entry.`
          )
          return false
        }
        const reusable = await reusableAssetFromLocalRecord(record)
        const abortReason = getAssetMutationAbortReason(
          anchor,
          readAssetMutationState()
        )
        if (abortReason) {
          setAssetError(
            assetMutationMessage(replacementNodeId ? "replace" : "add", {
              status: "aborted",
              reason: abortReason,
            })
          )
          return false
        }
        if (replacementNodeId) {
          stagedReplacementSource = await stageUsableLocalImageSource(
            record.blob,
            { width: reusable.width, height: reusable.height }
          )
          const sourceAbortReason = getAssetMutationAbortReason(
            anchor,
            readAssetMutationState()
          )
          if (sourceAbortReason) {
            stagedReplacementSource.release()
            setAssetError(
              assetMutationMessage("replace", {
                status: "aborted",
                reason: sourceAbortReason,
              })
            )
            return false
          }
          previousPreviewSource = assetUrlsRef.current.get(record.id)
          assetUrlsRef.current.set(record.id, stagedReplacementSource.src)
        }
        const committed = replacementNodeId
          ? replaceReusableImageAsset(replacementNodeId, reusable)
          : addReusableImageAsset(reusable)
        if (!committed) return false
        replacementCommitted = Boolean(stagedReplacementSource)
        try {
          if (stagedReplacementSource) {
            if (previousPreviewSource) {
              URL.revokeObjectURL(previousPreviewSource)
            }
            setAssetVersion((current) => current + 1)
          } else if (!assetUrlsRef.current.has(record.id)) {
            assetUrlsRef.current.set(
              record.id,
              URL.createObjectURL(record.blob)
            )
            setAssetVersion((current) => current + 1)
          }
        } catch {
          setAssetError(
            `The image was ${replacementNodeId ? "replaced" : "added"}, but its preview could not open. Reload Studio to restore it from local storage.`
          )
        }
        try {
          await markLocalAssetUsed(record.id)
        } catch {
          setAssetError(
            `The image was ${replacementNodeId ? "replaced" : "added"}, but Studio could not update its Recent position. The design change is safe.`
          )
        }
        return true
      } catch (error) {
        setAssetError(
          error instanceof Error
            ? `The saved image could not be used: ${error.message}`
            : "The saved image could not be used. Retry after checking browser storage."
        )
        return false
      } finally {
        if (stagedReplacementSource && !replacementCommitted) {
          if (previousPreviewSource) {
            assetUrlsRef.current.set(asset.id, previousPreviewSource)
          } else if (
            assetUrlsRef.current.get(asset.id) === stagedReplacementSource.src
          ) {
            assetUrlsRef.current.delete(asset.id)
          }
          stagedReplacementSource.release()
        }
        assetMutationActiveRef.current = false
        setIsImportingAsset(false)
      }
    },
    [
      addReusableImageAsset,
      allowMutation,
      readAssetMutationState,
      replaceReusableImageAsset,
    ]
  )

  const addLocalAsset = useCallback(
    (asset: LocalAssetSummary) => reuseLocalAsset(asset),
    [reuseLocalAsset]
  )

  const replaceImageWithLocalAsset = useCallback(
    (nodeId: string, asset: LocalAssetSummary) =>
      reuseLocalAsset(asset, nodeId),
    [reuseLocalAsset]
  )

  const imageReplacementBlock = useCallback(
    (nodeId: string) =>
      imageReplacementBindingImpact(historyRef.current.document, nodeId)
        ?.message ?? null,
    []
  )

  const importDocumentFile = useCallback(
    async (file: File) => {
      if (!allowMutation()) return false
      setDocumentError(null)
      const requestGeneration = sessionGenerationRef.current
      const requestDocumentId = historyRef.current.document.id
      const requestSnapshotId = historyRef.current.snapshotId
      const importRequestGeneration =
        documentImportRequestGenerationRef.current + 1
      documentImportRequestGenerationRef.current = importRequestGeneration
      const parsed = await parseDocumentImportFile(file)
      if (
        documentImportRequestGenerationRef.current !==
          importRequestGeneration ||
        sessionGenerationRef.current !== requestGeneration ||
        historyRef.current.document.id !== requestDocumentId ||
        historyRef.current.snapshotId !== requestSnapshotId
      ) {
        setDocumentError(
          "The active document changed while this file was being read. Import it again into the document now open."
        )
        return false
      }
      if (!allowMutation()) return false
      if (!parsed.ok) {
        setDocumentError(
          `The document could not be imported: ${parsed.failure.message}`
        )
        return false
      }
      const activeDocumentId =
        activePersistenceSessionRef.current?.controller.documentId ??
        historyRef.current.document.id
      if (parsed.document.id !== activeDocumentId) {
        setDocumentError(
          "This file belongs to a different Studio document. Return Home and open it as a separate document so the current draft keeps its identity."
        )
        return false
      }
      try {
        templateSourceBySnapshotRef.current.set(
          historyRef.current.snapshotId,
          templateSourceContextRef.current
        )
        const nextHistory = replaceDocument(
          historyRef.current,
          parsed.document,
          {
            label: "Import document",
          }
        )
        const sourceContext: TemplateSourceContext = {
          quotationSource: null,
          quotationTemplateId:
            templateSourceContextRef.current.quotationTemplateId,
          designTemplate: null,
        }
        historyRef.current = nextHistory
        templateSourceBySnapshotRef.current.set(
          nextHistory.snapshotId,
          sourceContext
        )
        setHistory(nextHistory)
        notifyHistoryCommit(nextHistory)
        installTemplateSourceContext(sourceContext)
        captureSettledDraft()
        const nextPageId = parsed.document.pages.some(
          (page) => page.id === activePageIdRef.current
        )
          ? activePageIdRef.current
          : (parsed.document.pages[0]?.id ?? activePageIdRef.current)
        activePageIdRef.current = nextPageId
        setActivePageId(nextPageId)
        setSelection(null)
        return true
      } catch (error) {
        setDocumentError(
          error instanceof Error
            ? `The document could not be imported: ${error.message}`
            : "The document could not be imported."
        )
        return false
      }
    },
    [
      allowMutation,
      captureSettledDraft,
      installTemplateSourceContext,
      notifyHistoryCommit,
    ]
  )

  const openDocumentFile = useCallback(
    async (file: File) => {
      if (draftRecoveryRef.current) return false
      setDocumentError(null)
      const parsed = await parseDocumentImportFile(file)
      if (!parsed.ok) {
        setDocumentError(
          `The document could not be opened: ${parsed.failure.message}`
        )
        return false
      }
      const envelope: CurrentDraftEnvelope = {
        schemaVersion: 1,
        document: parsed.document,
        sourceContext: null,
      }
      return persistAndInstallSession(envelope, { kind: "import" })
    },
    [persistAndInstallSession]
  )

  const importQuotationFile = useCallback(
    async (file: File) => {
      if (!allowMutation()) return
      setDocumentError(null)
      const requestGeneration = sessionGenerationRef.current
      const requestDocumentId = historyRef.current.document.id
      const requestSnapshotId = historyRef.current.snapshotId
      const importRequestGeneration =
        documentImportRequestGenerationRef.current + 1
      documentImportRequestGenerationRef.current = importRequestGeneration
      try {
        const input = JSON.parse(await file.text()) as unknown
        if (
          documentImportRequestGenerationRef.current !==
            importRequestGeneration ||
          sessionGenerationRef.current !== requestGeneration ||
          historyRef.current.document.id !== requestDocumentId ||
          historyRef.current.snapshotId !== requestSnapshotId
        ) {
          setDocumentError(
            "The active document changed while this quotation was being read. Import it again into the document now open."
          )
          return
        }
        if (!allowMutation()) return
        const composition = quotationCompositionRequestV1Schema.safeParse(input)
        const payloadResult = composition.success
          ? { success: true as const, data: composition.data.payload }
          : quotationRenderPayloadV1Schema.safeParse(input)
        if (!payloadResult.success) {
          const issue = payloadResult.error.issues.at(0)
          const location = issue?.path.length
            ? issue.path.join(".")
            : "quotation"
          throw new Error(`${location}: ${issue?.message ?? "Invalid payload"}`)
        }
        const requestedTemplateId = composition.success
          ? quotationTemplates.find(
              (template) => template.id === composition.data.templateId
            )?.id
          : undefined
        const templateId = requestedTemplateId ?? activeQuotationTemplateId
        const composedDocument = composeQuotationDocument(
          payloadResult.data,
          templateId
        )
        const document = {
          ...composedDocument,
          id:
            activePersistenceSessionRef.current?.controller.documentId ??
            historyRef.current.document.id,
        }
        templateSourceBySnapshotRef.current.set(
          historyRef.current.snapshotId,
          templateSourceContextRef.current
        )
        const nextHistory = replaceDocument(historyRef.current, document, {
          label: "Import quotation source",
        })
        const sourceContext: TemplateSourceContext = {
          quotationSource: payloadResult.data,
          quotationTemplateId: templateId,
          designTemplate: designTemplateForQuotation(templateId),
        }
        historyRef.current = nextHistory
        templateSourceBySnapshotRef.current.set(
          nextHistory.snapshotId,
          sourceContext
        )
        setHistory(nextHistory)
        notifyHistoryCommit(nextHistory)
        installTemplateSourceContext(sourceContext)
        captureSettledDraft()
        const firstPageId = document.pages[0]?.id ?? "quotation-page-1"
        activePageIdRef.current = firstPageId
        setActivePageId(firstPageId)
        setSelection(null)
        setPendingChangeSet(null)
        setLastResolvedChangeSet(null)
        setChangeSetError(null)
      } catch (error) {
        setDocumentError(
          error instanceof SyntaxError
            ? "This quotation file is not valid JSON."
            : error instanceof Error
              ? `The quotation could not be imported: ${error.message}`
              : "The quotation could not be imported."
        )
      }
    },
    [
      activeQuotationTemplateId,
      allowMutation,
      captureSettledDraft,
      installTemplateSourceContext,
      notifyHistoryCommit,
    ]
  )

  const deleteSelection = useCallback(() => {
    if (!selection?.nodeIds.length) return
    if (
      commit(
        selection.nodeIds.map((nodeId) => ({ type: "remove_node", nodeId }))
      )
    ) {
      setSelection(null)
    }
  }, [commit, selection])

  const duplicateSelection = useCallback(() => {
    const document = historyRef.current.document
    const page = document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (!page || !selection?.nodeIds.length) return
    const fragment = captureSemanticFragment(
      document,
      page.id,
      selection.nodeIds
    )
    const clone = cloneSemanticFragment(fragment, {
      targetPageId: page.id,
      offsetX: 24,
      offsetY: 24,
      nameSuffix: " copy",
    })
    if (
      commit(
        [
          {
            type: "duplicate_nodes",
            pageId: page.id,
            nodes: clone.nodes,
            groups: clone.groups,
            bindings: clone.bindings,
          },
        ],
        { label: "Duplicate layers" }
      )
    ) {
      setSelection({ pageId: page.id, nodeIds: clone.nodeIds })
    }
  }, [activePageId, commit, selection])

  const copySelection = useCallback(() => {
    if (!selection?.nodeIds.length) return
    clipboardRef.current = captureSemanticFragment(
      historyRef.current.document,
      selection.pageId,
      selection.nodeIds
    )
    setClipboardCount(clipboardRef.current.nodeIds.length)
  }, [selection])

  const pasteSelection = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    const clipboard = clipboardRef.current
    if (!page || !clipboard?.nodeIds.length) return
    const clone = cloneSemanticFragment(clipboard, {
      targetPageId: page.id,
      offsetX: 24,
      offsetY: 24,
      nameSuffix: " copy",
    })
    if (
      commit(
        [
          {
            type: "duplicate_nodes",
            pageId: page.id,
            nodes: clone.nodes,
            groups: clone.groups,
            bindings: clone.bindings,
          },
        ],
        { label: "Paste layers" }
      )
    ) {
      clipboardRef.current = captureSemanticFragment(
        historyRef.current.document,
        page.id,
        clone.nodeIds
      )
      setSelection({ pageId: page.id, nodeIds: clone.nodeIds })
    }
  }, [activePageId, commit])

  const alignSelection = useCallback(
    (alignment: Alignment) => {
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(alignNodes(nodes, alignment))
    },
    [selection, updateNodes]
  )

  const distributeSelection = useCallback(
    (distribution: Distribution) => {
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(distributeNodes(nodes, distribution))
    },
    [selection, updateNodes]
  )

  const alignSelectionToPage = useCallback(
    (alignment: Alignment) => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const nodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        return node && !node.locked ? [node] : []
      })
      updateNodes(
        alignNodesToBounds(nodes, alignment, {
          left: 0,
          top: 0,
          right: page.width,
          bottom: page.height,
          width: page.width,
          height: page.height,
          centerX: page.width / 2,
          centerY: page.height / 2,
        })
      )
    },
    [activePageId, selection, updateNodes]
  )

  const setSelectionLocked = useCallback(
    (locked: boolean) => {
      if (!selection?.nodeIds.length) return
      updateNodes(
        selection.nodeIds.map((nodeId) => ({ nodeId, patch: { locked } }))
      )
    },
    [selection, updateNodes]
  )

  const setSelectionVisible = useCallback(
    (visible: boolean) => {
      if (!selection?.nodeIds.length) return
      updateNodes(
        selection.nodeIds.map((nodeId) => ({ nodeId, patch: { visible } }))
      )
    },
    [selection, updateNodes]
  )

  const reorderSelection = useCallback(
    (edge: "front" | "back") => {
      const document = historyRef.current.document
      const page = document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page || !selection?.nodeIds.length) return
      const selectedGroupId = findSelectedGroupId(document, selection.nodeIds)
      const requestedNodeIds = selectedGroupId
        ? getGroupNodeIds(document, selectedGroupId)
        : selection.nodeIds
      if (
        selectedGroupId &&
        requestedNodeIds.some((nodeId) => findNode(document, nodeId)?.locked)
      ) {
        return
      }
      const selected = new Set(
        requestedNodeIds.filter((nodeId) => !findNode(document, nodeId)?.locked)
      )
      const nodeIds = page.nodeIds.filter((nodeId) => selected.has(nodeId))
      if (!nodeIds.length) return
      const remaining = page.nodeIds.filter((nodeId) => !selected.has(nodeId))
      const toIndex = edge === "front" ? remaining.length : 0
      const nextNodeIds =
        edge === "front"
          ? [...remaining, ...nodeIds]
          : [...nodeIds, ...remaining]
      if (
        nextNodeIds.every((nodeId, index) => nodeId === page.nodeIds[index])
      ) {
        return
      }
      commit([
        {
          type: "reorder_nodes",
          pageId: page.id,
          nodeIds,
          toIndex,
        },
      ])
    },
    [activePageId, commit, selection]
  )

  const reorderNode = useCallback(
    (nodeId: string, direction: "forward" | "backward") => {
      const page = historyRef.current.document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      if (!page) return
      const currentIndex = page.nodeIds.indexOf(nodeId)
      if (currentIndex < 0) return
      const toIndex =
        direction === "forward"
          ? Math.min(page.nodeIds.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
      if (toIndex === currentIndex) return
      commit([{ type: "reorder_node", pageId: page.id, nodeId, toIndex }])
    },
    [activePageId, commit]
  )

  const groupSelection = useCallback(() => {
    const nodeIds = selection?.nodeIds ?? []
    if (nodeIds.length < 2) return
    commit([
      {
        type: "group_nodes",
        groupId: `group-${crypto.randomUUID()}`,
        pageId: activePageId,
        name: "Group",
        nodeIds,
      },
    ])
  }, [activePageId, commit, selection])

  const selectedGroupId = findSelectedGroupId(
    history.document,
    selection?.nodeIds ?? []
  )

  const selectGroup = useCallback(
    (groupId: string, additive: boolean) => {
      const groupNodeIds = getGroupNodeIds(historyRef.current.document, groupId)
      if (!groupNodeIds.length) return
      const current = additive ? (selection?.nodeIds ?? []) : []
      const nodeIds = [...new Set([...current, ...groupNodeIds])]
      setEditorSelection({ pageId: activePageId, nodeIds })
    },
    [activePageId, selection, setEditorSelection]
  )

  const updateGroup = useCallback(
    (groupId: string, name: string) => {
      if (!name.trim()) return
      commit([{ type: "update_group", groupId, name: name.trim() }])
    },
    [commit]
  )

  const updateGroupNodes = useCallback(
    (groupId: string, patch: Partial<SceneNode>) => {
      updateNodes(
        getGroupNodeIds(historyRef.current.document, groupId).map((nodeId) => ({
          nodeId,
          patch,
        }))
      )
    },
    [updateNodes]
  )

  const setLayerSelection = useCallback(
    (nodeIds: string[]) => {
      const pageNodeIds = new Set(
        historyRef.current.document.pages.find(
          (page) => page.id === activePageId
        )?.nodeIds ?? []
      )
      const validNodeIds = [...new Set(nodeIds)].filter((nodeId) =>
        pageNodeIds.has(nodeId)
      )
      setEditorSelection(
        validNodeIds.length
          ? { pageId: activePageId, nodeIds: validNodeIds }
          : null
      )
    },
    [activePageId, setEditorSelection]
  )

  const renameLayerNode = useCallback(
    (nodeId: string, name: string) => {
      if (!name.trim()) return false
      return commit(
        [{ type: "update_node", nodeId, patch: { name: name.trim() } }],
        { label: "Rename layer" }
      )
    },
    [commit]
  )

  const updateLayerNodes = useCallback(
    (nodeIds: string[], patch: Partial<SceneNode>) => {
      const uniqueNodeIds = [...new Set(nodeIds)]
      if (!uniqueNodeIds.length) return false
      return commit(
        uniqueNodeIds.map((nodeId) => ({
          type: "update_node" as const,
          nodeId,
          patch,
        })),
        {
          label:
            "visible" in patch
              ? patch.visible
                ? "Show layers"
                : "Hide layers"
              : "locked" in patch
                ? patch.locked
                  ? "Lock layers"
                  : "Unlock layers"
                : "Update layers",
        }
      )
    },
    [commit]
  )

  const moveLayer = useCallback(
    (source: LayerTreeItem, target: LayerTreeItem, intent: LayerDropIntent) => {
      const commands = layerDropCommands(
        historyRef.current.document,
        activePageId,
        source,
        target,
        intent
      )
      if (!commands.length) return false
      return commit(commands, {
        label: intent === "inside" ? "Move layer into group" : "Reorder layers",
      })
    },
    [activePageId, commit]
  )

  const deleteLayerNodes = useCallback(
    (nodeIds: string[]) => {
      const document = historyRef.current.document
      const removable = [...new Set(nodeIds)].filter(
        (nodeId) => !findNode(document, nodeId)?.locked
      )
      if (!removable.length) return false
      const committed = commit(
        removable.map((nodeId) => ({
          type: "remove_node" as const,
          nodeId,
        })),
        { label: removable.length === 1 ? "Delete layer" : "Delete layers" }
      )
      if (committed) {
        setSelection((current) =>
          reconcileSelection(current, historyRef.current.document)
        )
      }
      return committed
    },
    [commit]
  )

  const ungroupSelection = useCallback(() => {
    if (!selectedGroupId) return
    commit([{ type: "ungroup_nodes", groupId: selectedGroupId }])
  }, [commit, selectedGroupId])

  const addPage = useCallback(
    (outputId: string) => {
      const document = historyRef.current.document
      const output = document.outputs.find(
        (candidate) => candidate.id === outputId
      )
      const referencePage = output
        ? document.pages.find((page) => page.id === output.pageIds.at(-1))
        : undefined
      if (!output) return
      const pageId = `page-${crypto.randomUUID()}`
      if (
        !commit([
          {
            type: "add_page",
            outputId,
            page: {
              id: pageId,
              outputId,
              name: `Page ${output.pageIds.length + 1}`,
              width: referencePage?.width ?? 1080,
              height: referencePage?.height ?? 1080,
              background: referencePage?.background ?? "#ffffff",
              nodeIds: [],
            },
          },
        ])
      )
        return
      setActivePageId(pageId)
      setSelection(null)
    },
    [commit]
  )

  const duplicatePage = useCallback(
    (pageId: string) => {
      const document = historyRef.current.document
      const page = document.pages.find((candidate) => candidate.id === pageId)
      if (!page) return
      const nextPageId = `page-${crypto.randomUUID()}`
      const clone = cloneSemanticFragment(
        captureSemanticFragment(document, page.id, page.nodeIds),
        { targetPageId: nextPageId }
      )
      if (
        !commit([
          {
            type: "duplicate_page",
            outputId: page.outputId,
            page: {
              ...page,
              id: nextPageId,
              name: `${page.name} copy`,
              nodeIds: clone.nodeIds,
            },
            nodes: clone.nodes,
            groups: clone.groups,
            bindings: clone.bindings,
          },
        ])
      )
        return
      setActivePageId(nextPageId)
      setSelection(null)
    },
    [commit]
  )

  const updatePage = useCallback(
    (
      pageId: string,
      patch: {
        name?: string
        width?: number
        height?: number
        background?: string
      }
    ) => commit([{ type: "update_page", pageId, patch }]),
    [commit]
  )

  const removePage = useCallback(
    (pageId: string) => {
      const document = historyRef.current.document
      const page = document.pages.find((candidate) => candidate.id === pageId)
      const output = page
        ? document.outputs.find((candidate) => candidate.id === page.outputId)
        : undefined
      if (!page || !output || output.pageIds.length <= 1) return
      const nextPageId =
        output.pageIds.find((candidate) => candidate !== pageId) ?? activePageId
      if (!commit([{ type: "remove_page", pageId }])) return
      if (activePageId === pageId) setActivePageId(nextPageId)
      setSelection(null)
    },
    [activePageId, commit]
  )

  const reorderPage = useCallback(
    (outputId: string, pageId: string, toIndex: number) =>
      commit([{ type: "reorder_page", outputId, pageId, toIndex }]),
    [commit]
  )

  const addOutput = useCallback(
    (options: { name: string; width: number; height: number }) => {
      const outputId = `output-${crypto.randomUUID()}`
      const pageId = `page-${crypto.randomUUID()}`
      if (
        !commit([
          {
            type: "add_output",
            output: {
              id: outputId,
              name: options.name.trim() || "Untitled output",
              kind: "square",
              pageIds: [pageId],
              exportFormats: ["png"],
            },
            page: {
              id: pageId,
              outputId,
              name: "Page 1",
              width: options.width,
              height: options.height,
              background: "#ffffff",
              nodeIds: [],
            },
          },
        ])
      )
        return
      setActivePageId(pageId)
      setSelection(null)
    },
    [commit]
  )

  const updateOutput = useCallback(
    (outputId: string, name: string) => {
      if (name.trim())
        commit([{ type: "update_output", outputId, name: name.trim() }])
    },
    [commit]
  )

  const removeOutput = useCallback(
    (outputId: string) => {
      const document = historyRef.current.document
      const output = document.outputs.find(
        (candidate) => candidate.id === outputId
      )
      if (!output || document.outputs.length <= 1) return
      const nextPageId = document.outputs.find(
        (candidate) => candidate.id !== outputId
      )?.pageIds[0]
      if (!commit([{ type: "remove_output", outputId }])) return
      if (output.pageIds.includes(activePageId) && nextPageId) {
        setActivePageId(nextPageId)
        setSelection(null)
      }
    },
    [activePageId, commit]
  )

  const getDesignTemplateImpact = useCallback(
    (templateId: string, version: number) =>
      prepareApplyTemplate({
        repository: builtInDesignTemplateRepository,
        templateId,
        version,
        currentDocument: historyRef.current.document,
        sourceContext: templateSourceContextRef.current,
      }).impact,
    []
  )

  const createDocumentFromTemplate = useCallback(
    async (templateId: string, version: number) => {
      if (!allowMutation()) return false
      try {
        const mutation = prepareCreateFromTemplate({
          repository: builtInDesignTemplateRepository,
          templateId,
          version,
          currentDocument: historyRef.current.document,
          sourceContext: templateSourceContextRef.current,
        })
        if (
          !(await persistAndInstallSession(
            {
              schemaVersion: 1,
              document: mutation.document,
              sourceContext: mutation.sourceContext,
            },
            { kind: "template", templateId, templateVersion: version }
          ))
        )
          return false
        setTemplateActionError(null)
        return true
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The selected template could not create a document."
        setTemplateActionError(message)
        setDocumentError(message)
        return false
      }
    },
    [allowMutation, persistAndInstallSession]
  )

  const applyDesignTemplate = useCallback(
    (templateId: string, version: number) => {
      if (!allowMutation()) return false
      try {
        const mutation = prepareApplyTemplate({
          repository: builtInDesignTemplateRepository,
          templateId,
          version,
          currentDocument: historyRef.current.document,
          sourceContext: templateSourceContextRef.current,
        })
        if (mutation.document === historyRef.current.document) return false
        templateSourceBySnapshotRef.current.set(
          historyRef.current.snapshotId,
          templateSourceContextRef.current
        )
        const nextHistory = replaceDocument(
          historyRef.current,
          mutation.document,
          { label: mutation.label }
        )
        historyRef.current = nextHistory
        templateSourceBySnapshotRef.current.set(
          nextHistory.snapshotId,
          mutation.sourceContext
        )
        setHistory(nextHistory)
        notifyHistoryCommit(nextHistory)
        installTemplateSourceContext(mutation.sourceContext)
        captureSettledDraft()
        const nextPageId = mutation.document.pages.some(
          (page) => page.id === activePageIdRef.current
        )
          ? activePageIdRef.current
          : mutation.document.pages[0].id
        activePageIdRef.current = nextPageId
        setActivePageId(nextPageId)
        setSelection((current) =>
          reconcileSelection(current, mutation.document)
        )
        setTemplateActionError(null)
        setDocumentError(null)
        return true
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The selected template could not be applied."
        setTemplateActionError(message)
        setDocumentError(message)
        return false
      }
    },
    [
      allowMutation,
      captureSettledDraft,
      installTemplateSourceContext,
      notifyHistoryCommit,
    ]
  )

  const createBlankDocument = useCallback(
    async (input: NewDocumentInput) => {
      if (!allowMutation()) return false
      const validation = validateNewDocumentOptions(input)
      if (!validation.ok) {
        setDocumentError(
          Object.values(validation.errors).join(" ") ||
            "The new document settings are invalid."
        )
        return false
      }
      const options = validation.options
      const now = new Date().toISOString()
      const outputId = `output-${crypto.randomUUID()}`
      const pageId = `page-${crypto.randomUUID()}`
      const document = documentSchema.parse({
        schemaVersion: 2,
        id: `document-${crypto.randomUUID()}`,
        name: options.name,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        outputs: [
          {
            id: outputId,
            name: options.name,
            kind: options.kind,
            pageIds: [pageId],
            exportFormats: [...options.exportFormats],
          },
        ],
        pages: [
          {
            id: pageId,
            outputId,
            name: "Page 1",
            width: options.width,
            height: options.height,
            background: "#ffffff",
            nodeIds: [],
          },
        ],
        nodes: [],
        groups: [],
        fields: [],
        fieldValues: {},
        bindings: [],
      })
      const sourceContext: TemplateSourceContext = {
        quotationSource: null,
        quotationTemplateId: activeQuotationTemplateId,
        designTemplate: null,
      }
      return persistAndInstallSession(
        {
          schemaVersion: 1,
          document,
          sourceContext,
        },
        { kind: "blank" }
      )
    },
    [activeQuotationTemplateId, allowMutation, persistAndInstallSession]
  )

  const restoreDemoDocument = useCallback(async () => {
    if (!allowMutation()) return false
    const document = cloneTemplateDocument(quotationStarter.document)
    const sourceContext: TemplateSourceContext = {
      quotationSource: quotationStarter.source,
      quotationTemplateId: quotationStarter.templateId,
      designTemplate: designTemplateForQuotation(quotationStarter.templateId),
    }
    if (
      !(await persistAndInstallSession(
        {
          schemaVersion: 1,
          document,
          sourceContext,
        },
        { kind: "quotation" }
      ))
    )
      return false
    try {
      localStorage.removeItem(PUBLISHED_STORAGE_KEY)
      setPublishError(null)
    } catch {
      setPublishError(
        "The starter opened, but stale local publication history could not be removed."
      )
    }
    attemptedVersionSyncRef.current.clear()
    publishedVersionsRef.current = []
    setPublishedVersions([])
    setPublishSyncStatus("idle")
    setPendingChangeSet(null)
    setLastResolvedChangeSet(null)
    setChangeSetError(null)
    void fetch("/v1/studio/session/reset", { method: "POST" })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Demo reset returned ${response.status}.`)
      })
      .catch((error: unknown) => {
        setDocumentError(
          error instanceof Error
            ? `${error.message} The starter was still restored locally.`
            : "The server session could not be reset. The starter was still restored locally."
        )
      })
    return true
  }, [allowMutation, persistAndInstallSession])

  const restoreTemplateSourceForSnapshot = useCallback(
    (nextHistory: DocumentHistory) => {
      const stored = templateSourceBySnapshotRef.current.get(
        nextHistory.snapshotId
      )
      if (stored) {
        installTemplateSourceContext(stored)
        return
      }
      const current = templateSourceContextRef.current
      if (!current.quotationSource) return
      installTemplateSourceContext({
        ...current,
        quotationTemplateId: inferQuotationTemplateId(
          nextHistory.document,
          current.quotationTemplateId
        ),
      })
    },
    [installTemplateSourceContext]
  )

  const undo = useCallback(() => {
    if (imageCropSessionRef.current) {
      settleImageCrop("cancel")
      return
    }
    if (!allowMutation()) return
    const next = undoDocument(historyRef.current)
    if (next === historyRef.current) return
    historyRef.current = next
    setHistory(next)
    const nextPageId = next.document.pages.some(
      (page) => page.id === activePageIdRef.current
    )
      ? activePageIdRef.current
      : next.document.pages[0].id
    activePageIdRef.current = nextPageId
    setActivePageId(nextPageId)
    setSelection((current) => reconcileSelection(current, next.document))
    restoreTemplateSourceForSnapshot(next)
    captureSettledDraft()
  }, [
    allowMutation,
    captureSettledDraft,
    restoreTemplateSourceForSnapshot,
    settleImageCrop,
  ])

  const clearRedo = useCallback(() => {
    const current = historyRef.current
    if (!current.future.length) return false
    const next = { ...current, future: [] }
    historyRef.current = next
    setHistory(next)
    return true
  }, [])

  const breakHistoryCoalescing = useCallback(() => {
    const current = historyRef.current
    const previous = current.past.at(-1)
    if (!previous?.coalesceKey) return false
    const next = {
      ...current,
      past: [
        ...current.past.slice(0, -1),
        { ...previous, coalesceKey: undefined },
      ],
    }
    historyRef.current = next
    setHistory(next)
    return true
  }, [])

  const redo = useCallback(() => {
    if (imageCropSessionRef.current) {
      settleImageCrop("cancel")
      return
    }
    if (!allowMutation()) return
    const next = redoDocument(historyRef.current)
    if (next === historyRef.current) return
    historyRef.current = next
    setHistory(next)
    const nextPageId = next.document.pages.some(
      (page) => page.id === activePageIdRef.current
    )
      ? activePageIdRef.current
      : next.document.pages[0].id
    activePageIdRef.current = nextPageId
    setActivePageId(nextPageId)
    setSelection((current) => reconcileSelection(current, next.document))
    restoreTemplateSourceForSnapshot(next)
    captureSettledDraft()
  }, [
    allowMutation,
    captureSettledDraft,
    restoreTemplateSourceForSnapshot,
    settleImageCrop,
  ])

  const selectAll = useCallback(() => {
    const page = historyRef.current.document.pages.find(
      (candidate) => candidate.id === activePageId
    )
    if (page?.nodeIds.length) {
      setEditorSelection({ pageId: page.id, nodeIds: [...page.nodeIds] })
    }
  }, [activePageId, setEditorSelection])

  const nudgeSelection = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!selection?.nodeIds.length) return
      const changes = selection.nodeIds.flatMap((nodeId) => {
        const node = findNode(historyRef.current.document, nodeId)
        if (!node || node.locked) return []
        return [
          {
            nodeId,
            patch: { x: node.x + deltaX, y: node.y + deltaY },
          },
        ]
      })
      commit(
        changes.map(({ nodeId, patch }) => ({
          type: "update_node",
          nodeId,
          patch,
        })),
        {
          label: "Nudge selection",
          coalesceKey: `nudge:${changes
            .map((change) => change.nodeId)
            .sort()
            .join(",")}`,
        }
      )
    },
    [commit, selection]
  )

  const selectedNodes = (selection?.nodeIds ?? []).flatMap((nodeId) => {
    const node = findNode(history.document, nodeId)
    return node ? [node] : []
  })

  const runImagePlacementCommand = useCallback(
    (commandId: EditorImagePlacementCommandId) => {
      const drafts = createImagePlacementCommandDrafts(commandId, selectedNodes)
      if (!drafts.length) return false
      return commit([...drafts], {
        label: editorCommandHistoryLabel(commandId),
      })
    },
    [commit, selectedNodes]
  )

  const runImageFrameCommand = useCallback(
    (commandId: EditorImageFrameCommandId) => {
      const drafts = createImageFrameCommandDrafts(commandId, selectedNodes)
      if (!drafts.length) return false
      return commit([...drafts], {
        label: editorCommandHistoryLabel(commandId),
      })
    },
    [commit, selectedNodes]
  )

  const currentTemplateId = quotationSource
    ? activeQuotationTemplateId
    : `template-${history.document.id}`
  const latestPublishedVersion = publishedVersionsForDocument(
    publishedVersions,
    currentTemplateId,
    history.document.id
  )
    .sort((a, b) => b.version - a.version)
    .at(0)

  useEffect(() => {
    const current = imageCropSessionRef.current
    if (!current) return
    const result = reconcileImageCropSession(
      current,
      history.document,
      activePageId
    )
    if (result.status === "active") return
    closeImageCropSession()
    setDocumentError(imageCropInvalidationMessage(result.reason))
  }, [activePageId, closeImageCropSession, history.document])

  const canonicalPreviewDocument = useMemo(
    () =>
      pendingChangeSet && !changeSetConflict
        ? previewChangeSet(
            history.document,
            pendingChangeSet,
            history.snapshotId
          )
        : history.document,
    [changeSetConflict, history.document, history.snapshotId, pendingChangeSet]
  )
  const previewDocument = useMemo(() => {
    const rendererReplacementPreview = pendingImageReplacement
      ? {
          ...canonicalPreviewDocument,
          nodes: canonicalPreviewDocument.nodes.map((node) =>
            node.type === "image" && node.id === pendingImageReplacement.nodeId
              ? {
                  ...node,
                  ...reusableImageReplacementPatch(
                    node,
                    pendingImageReplacement.payload.asset
                  ),
                  src: pendingImageReplacement.previewSrc,
                }
              : node
          ),
        }
      : canonicalPreviewDocument
    const localPreview = projectLocalAssetPreviewSources(
      rendererReplacementPreview,
      assetUrlsRef.current
    )
    return {
      ...localPreview,
      nodes: localPreview.nodes.map((node) => {
        if (node.type !== "image") return node
        const managedAssetId = managedMediaIdFromSource(node.src)
        const previewUrl = managedAssetId
          ? managedMediaContentUrl(managedAssetId)
          : null
        return previewUrl ? { ...node, src: previewUrl } : node
      }),
    }
  }, [assetVersion, canonicalPreviewDocument, pendingImageReplacement])

  return {
    sessionMode,
    startModel,
    document: history.document,
    starterMetadata: quotationStarter.metadata,
    snapshotId: history.snapshotId,
    documentSnapshotId,
    operationVersion: history.operationVersion,
    canonicalPreviewDocument,
    previewDocument,
    activePageId,
    selection,
    imageCropSession,
    imageCropPreviewStore,
    pendingImageReplacement,
    selectedNodes,
    selectedGroupId,
    localSaveState,
    repositoryLifecycle,
    canUndo: !pendingChangeSet && history.past.length > 0,
    canRedo: !pendingChangeSet && history.future.length > 0,
    documentUndoEntry: history.past.at(-1)
      ? {
          id: history.past.at(-1)!.id,
          committedAt: history.past.at(-1)!.committedAt,
          label: history.past.at(-1)!.label,
        }
      : null,
    documentRedoEntry: history.future[0]
      ? {
          id: history.future[0].id,
          committedAt: history.future[0].committedAt,
          label: history.future[0].label,
        }
      : null,
    canPaste: clipboardCount > 0,
    isImportingAsset,
    assetError,
    documentError,
    templateActionError,
    draftRecovery,
    draftRecoveryNotice,
    pendingChangeSet,
    lastResolvedChangeSet,
    changeSetConflict,
    changeSetError,
    isApplyingChangeSet,
    publishedVersions,
    latestPublishedVersion,
    currentTemplateId,
    quotationSource,
    activeQuotationTemplateId,
    activeDesignTemplate,
    designTemplateCatalog,
    publishError,
    publishSyncStatus,
    selectPage,
    setSelection: setEditorSelection,
    updateNodes,
    updateNode,
    setImagePlacement,
    setImageFrameMask,
    runImagePlacementCommand,
    runImageFrameCommand,
    updateSelectionNodes,
    beginImageCrop,
    reportImageCropReadiness,
    previewImageCrop,
    previewImageCropFrame,
    finishImageCrop,
    discardImageCrop,
    rejectUnavailableImageCrop,
    updateField,
    createField,
    updateFieldDefinition,
    removeField,
    bindField,
    unbindField,
    proposeChangeSet,
    decideOperation,
    decideAllOperations,
    applyChangeSet,
    discardChangeSet,
    publishTemplate,
    addText,
    addRectangle,
    addEllipse,
    addLine,
    addIcon,
    addImageFile,
    addLibraryAsset,
    addLocalAsset,
    addManagedMediaAsset,
    replaceImageFile,
    replaceImageWithLibraryAsset,
    replaceImageWithLocalAsset,
    replaceImageWithManagedMediaAsset,
    reportImageReplacementRendererState,
    imageReplacementBlock,
    importDocumentFile,
    openDocumentFile,
    importQuotationFile,
    deleteSelection,
    duplicateSelection,
    copySelection,
    pasteSelection,
    alignSelection,
    alignSelectionToPage,
    distributeSelection,
    setSelectionLocked,
    setSelectionVisible,
    reorderSelection,
    reorderNode,
    groupSelection,
    ungroupSelection,
    selectGroup,
    updateGroup,
    updateGroupNodes,
    setLayerSelection,
    renameLayerNode,
    updateLayerNodes,
    moveLayer,
    deleteLayerNodes,
    addPage,
    duplicatePage,
    updatePage,
    removePage,
    reorderPage,
    addOutput,
    updateOutput,
    removeOutput,
    createBlankDocument,
    createDocumentFromTemplate,
    applyDesignTemplate,
    getDesignTemplateImpact,
    reloadDesignTemplateCatalog: loadDesignTemplateCatalog,
    restoreDemoDocument,
    openStoredDocument,
    continueSessionDocument,
    flushActiveDraft,
    getCurrentDocumentSnapshot,
    retryActiveDraftSave,
    returnToStart,
    downloadDraftRecovery,
    downloadCurrentVersion,
    downloadCurrentDocument,
    retryDraftRecovery,
    resetDraftRecovery,
    selectAll,
    nudgeSelection,
    undo,
    redo,
    clearRedo,
    breakHistoryCoalescing,
  }
}
