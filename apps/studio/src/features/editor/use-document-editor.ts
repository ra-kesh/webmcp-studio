import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import {
  builtInDesignTemplateRepository,
  changeSetSchema,
  captureSemanticFragment,
  cloneTemplateDocument,
  cloneSemanticFragment,
  componentSourceSubtree,
  analyzeQuotationGroupOrganization,
  applyQuotationGroupOrganization,
  createTemplateVersion,
  deriveDocumentSnapshotId,
  assetReferenceKeysForSource,
  extractAssetReferences,
  documentSchema,
  findSelectedGroupId,
  getChangeSetConflict,
  getGroupNodeIds,
  composeQuotationDocument,
  prepareQuotationRefresh,
  quotationSourceFingerprint,
  QUOTATION_COMPOSER_VERSION,
  inferQuotationTemplateId,
  libraryMediaDetailSchema,
  libraryTemplateDetailSchema,
  previewChangeSet,
  quotationCompositionRequestV1Schema,
  QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID,
  quotationRenderPayloadV1Schema,
  quotationTemplates,
  managedAssetSource,
  templateVersionSchema,
} from "@webmcp/document"
import type {
  ChangeOperation,
  ChangeSet,
  Document,
  DocumentCommand,
  DesignStyleTarget,
  DesignVariable,
  DesignVariablePatch,
  FieldBinding,
  FieldDefinition,
  GeneratedDocumentPlan,
  ImageFrameMask,
  PaintStyle,
  PaintStylePatch,
  QuotationRenderPayloadV1,
  QuotationGroupOrganizationAnalysis,
  QuotationTemplateId,
  SceneNode,
  SemanticFragment,
  TemplateVersion,
  TypographyStyle,
  TypographyStylePatch,
  VariableBindingTarget,
  QuotationRefreshConflictPolicy,
} from "@webmcp/document"
import { layerDropCommands } from "@webmcp/editor/layer-tree"
import type { LayerDropIntent, LayerTreeItem } from "@webmcp/editor/layer-tree"
import {
  applyImageCropSession,
  cancelImageCropSession,
  startImageCropSession,
} from "@webmcp/editor"
import type {
  CanvasNodeChange,
  CommandDraft,
  ImageCropSession,
  Selection,
} from "@webmcp/editor"
import {
  alignNodes,
  alignNodesToBounds,
  distributeNodes,
} from "@webmcp/editor/geometry"
import {
  positionTransformLabel,
  positionTransformPatch,
  type PositionTransformAction,
} from "./position-transform"
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
  breakDocumentHistoryCoalescing,
  clearDocumentRedoHistory,
  commitCommandsWithResult,
  createDocumentHistory,
  redoDocument,
  replaceDocumentWithResult,
  undoDocument,
} from "@webmcp/editor/history"
import { createLibraryTemplateActions } from "../../content/library/library-template-actions"
import type {
  ResolvedTemplateAction,
  TemplateActionIntent,
  TemplateActionPorts,
  TemplateActionSnapshot,
  TemplateMutation,
} from "../../content/library/library-template-actions"
import { studioLibraryDiscoveryAdapter } from "../../content/library/library-discovery-adapter"
import { deviceLocalMediaDiscoveryAdapter } from "../../content/library/device-local-media-discovery-adapter"
import type {
  DocumentHistoryCommit,
  DocumentHistory,
  DocumentHistoryOptions,
  HistoryCommitOptions,
} from "@webmcp/editor/history"
import {
  assertLocalAssetCapacity,
  getLocalAssetRecord,
  getImageDimensions,
  inspectRequestedLocalAssets,
  loadLocalAsset,
  localAssetIdFromSource,
  localAssetSource,
  markLocalAssetUsed,
  rollbackLocalAsset,
  restoreLocalAssetBlob,
  saveLocalAsset,
} from "./local-asset-store"
import type {
  LocalAssetAdmissionState,
  LocalAssetBlobRestoreExpectation,
} from "./local-asset-store"
import { stageUsableLocalImageSource } from "./local-image-source-stage"
import type { StagedLocalImageSource } from "./local-image-source-stage"
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
import { canvasNodeChangeCommands } from "./canvas-node-change-commands"
import {
  projectCanvasComponentSelection,
  projectComponentInstanceCanvasTransform,
} from "./component-canvas-interaction"
import { resolveStudioAssetContent } from "./asset-catalog"
import type { LibraryPreferenceCommands } from "../../content/library/library-preference-provider"
import {
  getManagedMedia,
  managedMediaContentUrl,
  markManagedMediaUsed,
} from "./managed-media-repository"
import { managedAssetIdsInCommands } from "./managed-asset-command-accounting"
import type { ManagedMediaAsset } from "./managed-media-repository"
import {
  LocalAssetPromotionStartGate,
  startActiveLocalAssetPromotion,
} from "./active-local-asset-promotion"
import type {
  ActiveLocalAssetPromotionProgress,
  ActiveRelinkResult,
  DurableRelinkReceipt,
} from "./active-local-asset-promotion"
import {
  checkpointReleasedLocalAssetPromotionConflict,
  readLocalAssetPromotionJournal,
} from "./local-asset-promotion-journal"
import type { LocalAssetPromotionJournal } from "./local-asset-promotion-journal"
import { resolveLocalAssetPromotions } from "./local-asset-promotion-client"
import { hashLocalAssetBlobSha256 } from "./local-asset-promotion-owner"
import type { DocumentRouteMediaAdmission } from "./document-route-admission"
import { MountedMediaRecoveryRepository } from "./mounted-media-recovery-repository"
import type { MountedMediaRecoveryRecord } from "./mounted-media-recovery-repository"
import {
  hasCurrentRelinkUndo,
  hasExactManagedProjection,
  isLiveLocalAssetPromotionVisible,
  sameReferenceKeys,
} from "./local-asset-relink-projection"
import { verifyManagedBrowserImageResource } from "./managed-image-resource"
import { validateMediaDimensions, validateMediaFile } from "./media-file-policy"
import { reusableImageReplacementCommand } from "./media-selection-model"
import type { ReusableImageAsset } from "./media-selection-model"
import { ImageReplacementCoordinator } from "./image-replacement-coordinator"
import type { PreparedImageReplacement } from "./image-replacement-coordinator"
import type {
  ImageReplacementRenderer,
  ImageReplacementRendererEvent,
} from "./image-replacement-readiness"
import { imageReplacementBindingImpact } from "./image-replacement-binding"
import {
  captureLibraryMediaActionAnchor,
  commandForPreparedLibraryMediaAction,
  libraryMediaActionAnchorError,
  libraryMediaCommandIsNoOp,
  libraryMediaFinalAdmissionError,
  runLibraryMediaPostCommitUsage,
} from "./library-media-action-executor"
import type { LibraryMediaUsageWarning } from "./library-media-action-executor"
import { prepareExactLibraryMediaAction } from "./library-media-action-preparation"
import type {
  LibraryMediaActionPreparationPorts,
  LibraryMediaActionPreparationRequest,
} from "./library-media-action-preparation"
import { decodeStoredDraft, DRAFT_RECOVERY_STORAGE_KEY } from "./draft-recovery"
import type { DraftRecoveryRecord } from "./draft-recovery"
import {
  CURRENT_DRAFT_STORAGE_KEY,
  decodeCurrentDraftEnvelope,
  LEGACY_DOCUMENT_STORAGE_KEY,
  validateCurrentDraftSnapshot,
} from "./current-draft-repository"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import {
  createEmptyReviewJournal,
  createReviewProposal,
  resolveAppliedReview,
  resolveDiscardedReview,
  reviewJournalForStorage,
  reviewJournalOrEmpty,
  updateAllReviewOperationDecisions,
  updateReviewOperationDecision,
} from "./review-journal"
import type { ReviewJournal, ReviewProposalProvenance } from "./review-journal"
import {
  chooseQuotationRefreshCollision,
  emptyQuotationRefreshJournal,
  quotationRefreshCandidateIdentity,
  quotationRefreshJournalOrEmpty,
  quotationRefreshJournalForStorage,
  quotationRefreshProposalId,
  replacePendingQuotationRefresh,
  resolveQuotationRefresh,
  resolvedImpact,
  setPendingQuotationRefresh,
} from "./quotation-refresh-journal"
import type {
  PendingQuotationRefresh,
  QuotationRefreshJournal,
  QuotationSourceIdentity,
} from "./quotation-refresh-journal"
import type {
  DocumentDraftConflict,
  DocumentDraftHeadExpectation,
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftOrigin,
  DraftRepositoryEvent,
} from "./document-draft-repository"
import {
  completedLibraryTemplateCreate,
  failedLibraryTemplateCreate,
} from "./library-template-create-completion"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import type { LocalSaveState } from "./document-draft-save-controller"
import { projectDocumentConflictModel } from "./document-conflict-model"
import type { DocumentConflictOperation } from "./document-conflict-model"
import type { StudioPersistenceApi } from "../persistence/studio-persistence-provider"
import type { StudioStartModel } from "./studio-start-model"
import {
  parseDocumentImportFile,
  readBoundedDocumentImportText,
  waitForDocumentImportOperation,
} from "./document-import"
import type { DocumentImportRecoveryManifest } from "./document-import"
import { createStudioTextNode, defaultStudioTextPresetId } from "./text-presets"
import type { StudioTextPresetId } from "./text-presets"
import { quotationStarter } from "./quotation-starter"
import { validateNewDocumentOptions } from "./new-document-model"
import type { NewDocumentInput } from "./new-document-model"
import {
  prepareApplyTemplate,
  prepareCreateFromTemplate,
} from "./template-lifecycle"
import type {
  PreparedTemplateMutation,
  TemplateSourceContext,
} from "./template-lifecycle"
import { createKnownQuotationComposition } from "./quotation-composition-context"
import type { QuotationCompositionContext } from "./quotation-composition-context"
import {
  publishedVersionsForDocument,
  replaceAuthoritativePublishedVersions,
} from "./published-version-state"
import { retainReachableHistorySnapshotContexts } from "./history-snapshot-context"
import { useImageCropSessionController } from "./use-image-crop-session-controller"
import { useDocumentPreviewProjection } from "./use-document-preview-projection"
import {
  assertImageReplacementOutputAdmission,
  captureImageReplacementOutputAdmission,
  imageReplacementOutputAdmission,
} from "./image-replacement-output-admission"
import type { ImageReplacementOutputAdmissionLease } from "./image-replacement-output-admission"

export const DOCUMENT_TRANSITION_DISABLED_REASON =
  "Wait for the new document to finish opening before editing this one."

const QUOTATION_IMPORT_MAX_JSON_BYTES = 2_000_000
const PUBLICATION_TIMEOUT_MS = 45_000

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

const requiredDesignTemplateForQuotation = (
  templateId: QuotationTemplateId
) => {
  const identity = designTemplateForQuotation(templateId)
  if (!identity) {
    throw new Error(
      `Studio has no active immutable design template for ${templateId}.`
    )
  }
  return identity
}

const quotationTemplateForDesignTemplate = (identity: {
  id: string
  version: number
}) => {
  const template = builtInDesignTemplateRepository.get(
    identity.id,
    identity.version
  )
  if (template.kind !== "quotation_style") {
    throw new Error(
      `The composition template ${identity.id}@${identity.version} is not a quotation style.`
    )
  }
  return template.quotationTemplateId
}

type RepositoryLifecycle =
  | Readonly<{ status: "opening" }>
  | Readonly<{ status: "ready" }>
  | Readonly<{
      status: "blocked" | "unavailable"
      failure: Readonly<{ kind: string; message: string }>
    }>
type PublishSyncStatus =
  "idle" | "syncing" | "cancelling" | "synced" | "status_unknown" | "error"
type PublicationOperation = {
  id: string
  documentId: string
  sessionGeneration: number
  sourceSnapshotId: string | null
  expected: Readonly<{
    documentId: string
    revision: number
    snapshotId: string
  }> | null
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  timedOut: boolean
  serverCommitted: boolean
  promise: Promise<TemplateVersion>
}
type RendererReplacementPayload = Readonly<{
  anchor: AssetMutationAnchor
  asset: ReusableImageAsset
  historyLabel: string
}>

export type PerformLibraryMediaActionOptions = Readonly<{
  signal?: AbortSignal
  recordUsed?: LibraryPreferenceCommands["recordUsed"]
  refreshLocal?: () => Promise<unknown>
  onUsageWarning?: (warning: LibraryMediaUsageWarning) => void
  historyLabel?: string
  admitCommit?: () => boolean
}>

export type ApplyLibraryTemplateOptions = Readonly<{
  admitCommit?: () => boolean
}>

export type PerformLibraryMediaActionOutcome =
  "committed" | "no_op" | "rejected"

type ActivePersistenceSession = Readonly<{
  generation: number
  controller: DocumentDraftSaveController
  unsubscribe: () => void
  releaseLease: () => void
}>

type SessionTransition = Readonly<{
  token: number
  kind: "continue" | "replace" | "recovery" | "home" | "route"
}>

export type RouteSessionStatus =
  "not_requested" | "installing" | "ready" | "failed"

export type DocumentConflictRecoveryAction =
  "materialize" | "reload_saved" | "save_copy" | "accept_deletion"

export type DocumentConflictRecoveryState =
  | Readonly<{ status: "inactive" }>
  | Readonly<{ status: "discovering"; documentId: string }>
  | Readonly<{
      status: "external_change"
      documentId: string
      reason: "saved_elsewhere" | "deleted_elsewhere" | "quarantined_elsewhere"
      observedRecordVersion: number
    }>
  | Readonly<{
      status: "conflict"
      documentId: string
      conflict: DocumentDraftConflict
    }>
  | Readonly<{
      status: "working"
      documentId: string
      action: DocumentConflictRecoveryAction
      conflict: DocumentDraftConflict | null
    }>
  | Readonly<{
      status: "failed"
      documentId: string
      action: DocumentConflictRecoveryAction | "discover"
      conflict: DocumentDraftConflict | null
      message: string
      retryable: boolean
      createdDocumentId?: string
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
      right.designTemplate === null &&
      right.composition === undefined
    )
  }
  return (
    left.quotationSource === right.quotationSource &&
    left.quotationTemplateId === right.quotationTemplateId &&
    left.designTemplate?.id === right.designTemplate?.id &&
    left.designTemplate?.version === right.designTemplate?.version &&
    JSON.stringify(left.composition) === JSON.stringify(right.composition)
  )
}

async function quotationSourceIdentity(
  source: QuotationRenderPayloadV1
): Promise<QuotationSourceIdentity> {
  return {
    quotationId: source.source.quotationId,
    sourceRevision: source.source.revision,
    quoteVersion: source.quote.quoteVersion,
    contractVersion: source.contractVersion,
    sourceSnapshotId: await quotationSourceFingerprint(source),
  }
}

export type PendingRendererReplacement =
  PreparedImageReplacement<RendererReplacementPayload>

export type StudioSessionMode = "start" | "workspace"

export type PendingDocumentImportMediaReview = Readonly<{
  kind: "import" | "open"
  fileName: string
  originalDocument: Document
  studioCandidateDocument: Document | null
  manifest: DocumentImportRecoveryManifest
  anchor: Readonly<{
    sessionGeneration: number
    documentId: string
    historySnapshotId: string
  }> | null
}>

export type LocalAssetPromotionViewState = ActiveLocalAssetPromotionProgress &
  Readonly<{
    operationId: string
    sourceDocumentId: string
    expectedReferenceKeys: readonly string[]
    managedAssetId: string | null
    relinkCommitId: string | null
  }>

export type LocalMediaRecoveryOperationViewState = Readonly<{
  phase:
    | "preparing"
    | "cancelling"
    | "saving"
    | "identity_conflict"
    | "complete"
    | "failed"
  message: string
  retryable: boolean
  retryAction?: "repeat_action" | "finish_saving"
  completionKind?: "restored" | "relinked" | "cancelled"
}>

type PreparedMountedMediaRecoveryTarget =
  | Readonly<{
      assetId: string
      source: `asset:local/${string}`
      kind: "local"
      recentUseIdempotencyKey: null
    }>
  | Readonly<{
      assetId: string
      source: `asset:managed/${string}`
      kind: "managed"
      recentUseIdempotencyKey: string | null
      preexistingTargetReferenceKeys?: readonly string[]
    }>
  | Readonly<{
      assetId: string
      source: `asset:local/${string}`
      kind: "restored"
      recentUseIdempotencyKey: null
    }>
  | Readonly<{
      assetId: string
      source: `asset:local/${string}`
      kind: "remove"
      nodeIds: readonly string[]
      bindingIds: readonly string[]
      clearCurrentFieldIds: readonly string[]
      clearDefaultFieldIds: readonly string[]
      removedReferenceKeys: readonly string[]
      recentUseIdempotencyKey: null
    }>

type MountedLocalMediaRecovery = Readonly<{
  token: string
  localAssetId: string
  documentId: string
  session: ActivePersistenceSession
  sessionGeneration: number
  critical: boolean
  controller: AbortController
  criticalSettlement: Promise<void>
}>

type MountedLocalMediaRecoveryCheckpoint = Readonly<{
  localAssetId: string
  source: string
  target: PreparedMountedMediaRecoveryTarget
  expectedReferenceKeys: readonly string[]
  documentId: string
  session: ActivePersistenceSession
  sessionGeneration: number
  undoable: boolean
  commitId: string
  resultHistorySnapshotId: string
  resultOperationVersion: number
  durableOperation: MountedMediaRecoveryRecord | null
}>

type PendingLocatedMediaConflict = Readonly<{
  file: File
  contentSha256: string
  expectedContentSha256: string
}>

class LocalMediaIdentityConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalMediaIdentityConflictError"
  }
}

const localRestoreExpectation = (
  state: Exclude<LocalAssetAdmissionState, { status: "ready" | "unavailable" }>
): LocalAssetBlobRestoreExpectation => {
  switch (state.status) {
    case "missing_bytes":
      return {
        status: "missing_bytes",
        revision: state.summary.revision,
        updatedAt: state.summary.updatedAt,
      }
    case "quarantined":
      return { status: "quarantined", quarantine: state.expectation }
    case "absent":
      return { status: "absent" }
  }
}

const localAdmissionStateFingerprint = async (
  state: LocalAssetAdmissionState,
  signal: AbortSignal,
  allowUnavailable = false
) => {
  signal.throwIfAborted()
  switch (state.status) {
    case "ready":
      return `ready:${state.record.revision}:${state.record.updatedAt}:${await hashLocalAssetBlobSha256(state.record.blob, signal)}`
    case "missing_bytes":
      return `missing_bytes:${state.summary.revision}:${state.summary.updatedAt}`
    case "absent":
      return "absent"
    case "quarantined":
      return `quarantined:${JSON.stringify(state.expectation)}`
    case "unavailable":
      if (allowUnavailable) return "unavailable"
      throw new Error(state.message)
  }
}

const stableMediaRecoveryHash = async (input: string) => {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return hash
}

const stableMountedMediaRecoveryOperationId = async (input: string) =>
  `mounted-recovery:${await stableMediaRecoveryHash(input)}`

const hasExactRecoveredProjection = (
  document: Document,
  source: string,
  target: Exclude<PreparedMountedMediaRecoveryTarget, { kind: "restored" }>,
  expectedReferenceKeys: readonly string[]
) => {
  if (target.kind === "remove") {
    const removed = new Set(target.removedReferenceKeys)
    return sameReferenceKeys(
      assetReferenceKeysForSource(document, source),
      expectedReferenceKeys.filter((key) => !removed.has(key))
    )
  }
  if (assetReferenceKeysForSource(document, source).length > 0) return false
  const expectedTargetReferenceKeys =
    target.kind === "managed"
      ? [
          ...new Set([
            ...(target.preexistingTargetReferenceKeys ?? []),
            ...expectedReferenceKeys,
          ]),
        ].sort()
      : expectedReferenceKeys
  return sameReferenceKeys(
    assetReferenceKeysForSource(document, target.source),
    expectedTargetReferenceKeys
  )
}

type MountedLocalAssetPromotion = Readonly<{
  operationId: string
  localAssetId: string
  documentId: string
  session: ActivePersistenceSession
  sessionGeneration: number
  critical: boolean
  blocksPromotionStart: boolean
  criticalSettlement: Promise<void>
  cancel: () => boolean
}>

type MountedLocalAssetPromotionReservation = Readonly<{
  key: string
  token: string
  localAssetId: string
  documentId: string
  session: ActivePersistenceSession
  sessionGeneration: number
  cancel: () => boolean
}>

function createNeutralBootstrapDocument(): Document {
  return documentSchema.parse({
    schemaVersion: 5,
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
    components: [],
    componentInstances: [],
    typographyStyles: [],
    paintStyles: [],
    variables: [],
    variableBindings: [],
    fields: [],
    fieldValues: {},
    bindings: [],
  })
}

async function syncPublishedVersion(
  version: TemplateVersion,
  signal?: AbortSignal,
  assertOutputAdmission: () => void = () => undefined
) {
  let candidate = version
  for (let ordinalAttempt = 0; ordinalAttempt < 4; ordinalAttempt += 1) {
    assertOutputAdmission()
    signal?.throwIfAborted()
    const response = await fetch("/v1/studio/templates/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: candidate.id,
        templateId: candidate.templateId,
        version: candidate.version,
        publishedAt: candidate.publishedAt,
        document: candidate.document,
      }),
      signal,
    })
    assertOutputAdmission()
    if (response.ok) {
      const payload = await response.json()
      assertOutputAdmission()
      return templateVersionSchema.parse(payload)
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; expectedVersion?: number }
    } | null
    assertOutputAdmission()
    const expectedVersion = payload?.error?.expectedVersion
    if (
      response.status === 409 &&
      payload?.error?.code === "version_conflict" &&
      typeof expectedVersion === "number" &&
      Number.isInteger(expectedVersion) &&
      expectedVersion > candidate.version
    ) {
      candidate = { ...candidate, version: expectedVersion }
      continue
    }
    const detail = payload?.error?.code
      ? payload.error.code.replaceAll("_", " ")
      : `status ${response.status}`
    throw new Error(`Publishing service: ${detail}.`)
  }
  throw new Error(
    "Publishing service: the version stream changed repeatedly. Retry after the current publications settle."
  )
}

async function readLatestPublishedVersion(
  templateId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `/v1/studio/templates/${encodeURIComponent(templateId)}?missing=empty`,
    { signal }
  )
  if (response.status === 204 || response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Publishing service: status ${response.status}.`)
  }
  const payload = z.record(z.string(), z.unknown()).parse(await response.json())
  return templateVersionSchema.parse({
    id: payload.versionId,
    templateId: payload.templateId,
    version: payload.version,
    sourceRevision: payload.sourceRevision,
    sourceSnapshotId: payload.sourceSnapshotId,
    publishedAt: payload.publishedAt,
    document: payload.document,
    manifest: payload.manifest,
  })
}

const waitForPublicationStep = <T>(
  operation: Promise<T>,
  signal: AbortSignal
) => {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
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

const sameDraftHead = (left: DocumentDraftRecord, right: DocumentDraftRecord) =>
  left.summary.documentId === right.summary.documentId &&
  left.summary.recordVersion === right.summary.recordVersion &&
  left.summary.contentSnapshotId === right.summary.contentSnapshotId &&
  left.summary.draftSnapshotId === right.summary.draftSnapshotId &&
  left.summary.deletedAt === right.summary.deletedAt

const expectedHeadForSummary = (
  summary: DocumentDraftSummary
): DocumentDraftHeadExpectation => ({
  status: "found",
  recordVersion: summary.recordVersion,
  contentSnapshotId: summary.contentSnapshotId,
  draftSnapshotId: summary.draftSnapshotId,
  deletedAt: summary.deletedAt,
})

const expectedHeadForRecord = (record: DocumentDraftRecord) =>
  expectedHeadForSummary(record.summary)

const serverLibraryTemplateDetailPort: TemplateActionPorts["getDetail"] =
  async (kind, id, version, signal) => {
    const detail = await studioLibraryDiscoveryAdapter.getDetail(
      { itemKind: kind, id, version },
      signal
    )
    return detail.summary.itemKind === "template"
      ? libraryTemplateDetailSchema.parse(detail)
      : null
  }

const serverLibraryMediaPreparationPorts: LibraryMediaActionPreparationPorts =
  Object.freeze({
    async getExactDetail(identity, signal) {
      const detail = await studioLibraryDiscoveryAdapter.getDetail(
        identity,
        signal
      )
      return libraryMediaDetailSchema.parse(detail)
    },
    resolveCurated: (identity, signal) =>
      resolveStudioAssetContent(
        identity.assetId,
        identity.version,
        (resourcePath, requestSignal) =>
          globalThis.fetch(resourcePath, { signal: requestSignal }),
        signal
      ),
    getManagedRecord: (assetId, signal) => getManagedMedia(assetId, signal),
    verifyManagedResource: (record, signal) =>
      verifyManagedBrowserImageResource(
        record,
        decodeValidatedImageDimensions,
        (input, init) =>
          globalThis.fetch(input, {
            ...init,
            signal,
          })
      ),
    recheckLocal: (identity, signal) =>
      deviceLocalMediaDiscoveryAdapter.recheckSelection(identity, signal),
  })

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

export function useDocumentEditor({
  initialRecord = null,
  initialRecordWarning = null,
  initialMediaAdmission = null,
  onInitialRecordInstalled,
  onHistoryCommit,
  historyOptions,
  imageReplacementTimeoutMs,
  persistence,
  libraryTemplateDetailPort = serverLibraryTemplateDetailPort,
  libraryMediaPreparationPorts = serverLibraryMediaPreparationPorts,
}: {
  initialRecord?: DocumentDraftRecord | null
  initialRecordWarning?: string | null
  initialMediaAdmission?: DocumentRouteMediaAdmission | null
  onInitialRecordInstalled?: (record: DocumentDraftRecord) => void
  onHistoryCommit?: (entry: DocumentHistoryCommit) => void
  historyOptions?: DocumentHistoryOptions
  imageReplacementTimeoutMs?: number
  persistence: StudioPersistenceApi
  libraryTemplateDetailPort?: TemplateActionPorts["getDetail"]
  libraryMediaPreparationPorts?: LibraryMediaActionPreparationPorts
}) {
  const persistenceRef = useRef(persistence)
  persistenceRef.current = persistence
  const historyOptionsRef = useRef(historyOptions)
  historyOptionsRef.current = historyOptions
  const getDraftRepository = useCallback(
    () => persistenceRef.current.repository,
    []
  )
  const [sessionMode, setSessionMode] = useState<StudioSessionMode>("start")
  const sessionModeRef = useRef<StudioSessionMode>(sessionMode)
  sessionModeRef.current = sessionMode
  const [routeSessionStatus, setRouteSessionStatus] =
    useState<RouteSessionStatus>(initialRecord ? "installing" : "not_requested")
  const [documentMediaAdmission, setDocumentMediaAdmission] =
    useState<DocumentRouteMediaAdmission | null>(initialMediaAdmission)
  const [
    documentMediaAdmissionRestoreUnavailable,
    setDocumentMediaAdmissionRestoreUnavailable,
  ] = useState(false)
  const [
    pendingDocumentImportMediaReview,
    setPendingDocumentImportMediaReview,
  ] = useState<PendingDocumentImportMediaReview | null>(null)
  const onInitialRecordInstalledRef = useRef(onInitialRecordInstalled)
  onInitialRecordInstalledRef.current = onInitialRecordInstalled
  const initialInstallNotificationRef = useRef<string | null>(null)
  const [history, setHistory] = useState<DocumentHistory>(() =>
    createDocumentHistory(
      createNeutralBootstrapDocument(),
      undefined,
      historyOptions
    )
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
  const [activeQuotationComposition, setActiveQuotationComposition] = useState<
    QuotationCompositionContext | undefined
  >(undefined)
  const [selection, setSelection] = useState<Selection | null>(null)
  const {
    controller: imageCropController,
    previewStore: imageCropPreviewStore,
    session: imageCropSession,
  } = useImageCropSessionController()
  const [localSaveState, setLocalSaveState] = useState<LocalSaveState>({
    status: "opening",
  })
  const localSaveStateRef = useRef<LocalSaveState>(localSaveState)
  localSaveStateRef.current = localSaveState
  const [conflictRecoveryState, setConflictRecoveryState] =
    useState<DocumentConflictRecoveryState>({ status: "inactive" })
  const conflictRecoveryStateRef = useRef(conflictRecoveryState)
  conflictRecoveryStateRef.current = conflictRecoveryState
  const conflictRecoveryOperationRef = useRef<{
    token: number
    action: DocumentConflictRecoveryAction | "discover"
    documentId: string
  } | null>(null)
  const conflictRecoveryOperationSequenceRef = useRef(0)
  const liveConflictIdRef = useRef<string | null>(null)
  const [repositoryLifecycle, setRepositoryLifecycle] =
    useState<RepositoryLifecycle>({ status: "opening" })
  const [clipboardCount, setClipboardCount] = useState(0)
  const [assetVersion, setAssetVersion] = useState(0)
  const [isImportingAsset, setIsImportingAsset] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [localAssetPromotions, setLocalAssetPromotions] = useState<
    Partial<Record<string, LocalAssetPromotionViewState>>
  >({})
  const [localMediaRecoveryOperations, setLocalMediaRecoveryOperations] =
    useState<Partial<Record<string, LocalMediaRecoveryOperationViewState>>>({})
  const [pendingImageReplacement, setPendingImageReplacement] =
    useState<PendingRendererReplacement | null>(null)
  const pendingImageReplacementRef = useRef<PendingRendererReplacement | null>(
    null
  )
  const imageReplacementOutputGenerationRef = useRef(0)
  const publishPendingImageReplacement = useCallback(
    (pending: PendingRendererReplacement | null) => {
      imageReplacementOutputGenerationRef.current += 1
      pendingImageReplacementRef.current = pending
      setPendingImageReplacement(pending)
    },
    []
  )
  const getImageReplacementOutputAdmission = useCallback(
    () =>
      imageReplacementOutputAdmission(
        Boolean(pendingImageReplacementRef.current),
        imageReplacementOutputGenerationRef.current
      ),
    []
  )
  const captureImageReplacementOutputAdmissionLease = useCallback(
    () =>
      captureImageReplacementOutputAdmission(
        getImageReplacementOutputAdmission()
      ),
    [getImageReplacementOutputAdmission]
  )
  const assertImageReplacementOutputAdmissionLease = useCallback(
    (lease: ImageReplacementOutputAdmissionLease) =>
      assertImageReplacementOutputAdmission(
        getImageReplacementOutputAdmission(),
        lease
      ),
    [getImageReplacementOutputAdmission]
  )
  const [documentError, setDocumentError] = useState<string | null>(
    initialRecordWarning
  )
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
  const [pendingGeneratedDocument, setPendingGeneratedDocument] =
    useState<GeneratedDocumentPlan | null>(null)
  const pendingGeneratedDocumentRef = useRef<GeneratedDocumentPlan | null>(null)
  const generationReplacementConsumedRef = useRef(false)
  const generationApprovalInFlightRef = useRef(false)
  const [generatedDocumentError, setGeneratedDocumentError] = useState<
    string | null
  >(null)
  const [isCreatingGeneratedDocument, setIsCreatingGeneratedDocument] =
    useState(false)
  const [reviewJournal, setReviewJournal] = useState<ReviewJournal>(() =>
    createEmptyReviewJournal()
  )
  const [quotationRefreshJournal, setQuotationRefreshJournal] =
    useState<QuotationRefreshJournal>(() => emptyQuotationRefreshJournal())
  const lastResolvedChangeSet = reviewJournal.resolved[0]?.changeSet ?? null
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
  const publicationOperationRef = useRef<PublicationOperation | null>(null)
  const publicationRepositoryTailRef = useRef<Promise<void>>(Promise.resolve())
  const [publicationHistoryGeneration, setPublicationHistoryGeneration] =
    useState(0)

  const [documentSnapshotId, setDocumentSnapshotId] = useState<string | null>(
    null
  )
  const documentSnapshotIdRef = useRef(documentSnapshotId)
  documentSnapshotIdRef.current = documentSnapshotId
  const quotationGroupOrganization =
    useMemo<QuotationGroupOrganizationAnalysis>(() => {
      if (activeQuotationComposition?.status === "known") {
        return { status: "already_current" }
      }
      if (
        activeQuotationComposition?.status === "legacy_unknown" &&
        activeQuotationComposition.appliedMigrations.includes(
          QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID
        )
      ) {
        return { status: "already_current" }
      }
      return analyzeQuotationGroupOrganization(
        history.document,
        quotationSource,
        activeQuotationTemplateId
      )
    }, [
      activeQuotationComposition,
      activeQuotationTemplateId,
      history.document,
      quotationSource,
    ])
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
  const separateDocumentTransitionRef = useRef(false)
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
  const activeLocalAssetPromotionRef =
    useRef<MountedLocalAssetPromotion | null>(null)
  const activeLocalMediaRecoveryRef = useRef<MountedLocalMediaRecovery | null>(
    null
  )
  const localMediaRecoveryCheckpointRef = useRef(
    new Map<string, MountedLocalMediaRecoveryCheckpoint>()
  )
  const pendingLocatedMediaConflictRef = useRef(
    new Map<string, PendingLocatedMediaConflict>()
  )
  const mountedMediaRecoveryRepositoryRef = useRef(
    new MountedMediaRecoveryRepository()
  )
  const mountedMediaRecoveryReconciledSessionRef = useRef<string | null>(null)
  const [
    mountedMediaRecoveryReconciliation,
    setMountedMediaRecoveryReconciliation,
  ] = useState<{
    status: "idle" | "checking" | "ready" | "error"
    sessionKey: string | null
    message: string | null
  }>({ status: "idle", sessionKey: null, message: null })
  const mountedMediaRecoveryReconciliationRef = useRef(
    mountedMediaRecoveryReconciliation
  )
  mountedMediaRecoveryReconciliationRef.current =
    mountedMediaRecoveryReconciliation
  const [
    mountedMediaRecoveryRetryGeneration,
    setMountedMediaRecoveryRetryGeneration,
  ] = useState(0)
  const localAssetPromotionStartGateRef = useRef(
    new LocalAssetPromotionStartGate()
  )
  const localAssetPromotionReservationRef =
    useRef<MountedLocalAssetPromotionReservation | null>(null)
  const draftRecoveryRef = useRef(draftRecovery)
  draftRecoveryRef.current = draftRecovery
  const clipboardRef = useRef<SemanticFragment | null>(null)
  const assetUrlsRef = useRef(new Map<string, string>())
  const assetLoadPromisesRef = useRef(
    new Map<
      string,
      {
        promise: Promise<Blob | null>
        consumerGenerations: Set<number>
      }
    >()
  )
  const referencedLocalAssetIdsRef = useRef(new Set<string>())
  const assetLifecycleGenerationRef = useRef(0)
  const activeAssetLifecycleGenerationRef = useRef<number | null>(null)
  const attemptedVersionSyncRef = useRef(new Set<string>())
  const historyRef = useRef(history)
  historyRef.current = history
  const lastCapturedDocumentRef = useRef<Document | null>(null)
  const lastCapturedSourceContextRef = useRef<TemplateSourceContext | null>(
    null
  )
  const reviewJournalRef = useRef(reviewJournal)
  reviewJournalRef.current = reviewJournal
  const reviewGenerationRef = useRef(0)
  const quotationRefreshJournalRef = useRef(quotationRefreshJournal)
  quotationRefreshJournalRef.current = quotationRefreshJournal
  const lastCapturedReviewJournalRef = useRef<ReviewJournal | null>(null)
  const lastCapturedQuotationRefreshJournalRef =
    useRef<QuotationRefreshJournal | null>(null)
  const onHistoryCommitRef = useRef(onHistoryCommit)
  onHistoryCommitRef.current = onHistoryCommit
  const notifyHistoryCommit = useCallback(
    (commit: DocumentHistoryCommit) => onHistoryCommitRef.current?.(commit),
    []
  )
  const templateSourceContextRef = useRef<TemplateSourceContext>({
    quotationSource,
    quotationTemplateId: activeQuotationTemplateId,
    designTemplate: activeDesignTemplate,
    ...(activeQuotationComposition
      ? { composition: activeQuotationComposition }
      : {}),
  })
  templateSourceContextRef.current = {
    quotationSource,
    quotationTemplateId: activeQuotationTemplateId,
    designTemplate: activeDesignTemplate,
    ...(activeQuotationComposition
      ? { composition: activeQuotationComposition }
      : {}),
  }
  const templateSourceGenerationRef = useRef(0)
  const templateSourceBySnapshotRef = useRef(
    new Map<string, TemplateSourceContext>()
  )
  const pruneTemplateSourceContexts = useCallback((next: DocumentHistory) => {
    templateSourceBySnapshotRef.current =
      retainReachableHistorySnapshotContexts(
        templateSourceBySnapshotRef.current,
        next
      )
  }, [])
  templateSourceBySnapshotRef.current.set(
    history.snapshotId,
    templateSourceContextRef.current
  )
  const activePageIdRef = useRef(activePageId)
  activePageIdRef.current = activePageId
  const pendingChangeSetRef = useRef(pendingChangeSet)
  pendingChangeSetRef.current = pendingChangeSet

  const projectReviewJournal = useCallback((journalInput: ReviewJournal) => {
    const journal = reviewJournalOrEmpty(journalInput)
    reviewGenerationRef.current += 1
    reviewJournalRef.current = journal
    setReviewJournal(journal)
    pendingChangeSetRef.current = journal.pending?.changeSet ?? null
    setPendingChangeSet(journal.pending?.changeSet ?? null)
    return journal
  }, [])

  const clearReviewJournal = useCallback(() => {
    projectReviewJournal(createEmptyReviewJournal())
  }, [projectReviewJournal])
  const projectQuotationRefreshJournal = useCallback(
    (journalInput: QuotationRefreshJournal) => {
      const journal = quotationRefreshJournalOrEmpty(journalInput)
      quotationRefreshJournalRef.current = journal
      setQuotationRefreshJournal(journal)
      return journal
    },
    []
  )
  const applyingChangeSetRef = useRef(false)
  const assetMutationActiveRef = useRef(false)
  const activeLibraryMediaActionRef = useRef<{
    correlationId: string
    controller: AbortController
  } | null>(null)
  const imageReplacementCoordinatorRef =
    useRef<ImageReplacementCoordinator<RendererReplacementPayload> | null>(null)

  const installPublishedVersions = useCallback(
    (versions: TemplateVersion[]) => {
      publishedVersionsRef.current = versions
      setPublishedVersions(versions)
    },
    []
  )

  const installTemplateSourceContext = useCallback(
    (context: TemplateSourceContext) => {
      templateSourceGenerationRef.current += 1
      templateSourceContextRef.current = context
      setQuotationSource(context.quotationSource)
      setActiveQuotationTemplateId(context.quotationTemplateId)
      setActiveDesignTemplate(context.designTemplate)
      setActiveQuotationComposition(context.composition)
      return true
    },
    []
  )

  const readTemplateActionSnapshot = useCallback(
    (): TemplateActionSnapshot => ({
      document: historyRef.current.document,
      documentGeneration: historyRef.current.operationVersion,
      sourceGeneration: templateSourceGenerationRef.current,
      reviewGeneration: reviewGenerationRef.current,
      hasQuotationSource: Boolean(
        templateSourceContextRef.current.quotationSource
      ),
    }),
    []
  )

  const libraryTemplateActionsRef = useRef<ReturnType<
    typeof createLibraryTemplateActions
  > | null>(null)
  if (!libraryTemplateActionsRef.current) {
    libraryTemplateActionsRef.current = createLibraryTemplateActions({
      getDetail: libraryTemplateDetailPort,
      getCurrent: readTemplateActionSnapshot,
      prepareCreate(identity, current) {
        return prepareCreateFromTemplate({
          repository: builtInDesignTemplateRepository,
          templateId: identity.id,
          version: identity.version,
          currentDocument: current.document,
          sourceContext: templateSourceContextRef.current,
        })
      },
      prepareApply(identity, current) {
        return prepareApplyTemplate({
          repository: builtInDesignTemplateRepository,
          templateId: identity.id,
          version: identity.version,
          currentDocument: current.document,
          sourceContext: templateSourceContextRef.current,
        })
      },
    })
  }
  const libraryTemplateActions = libraryTemplateActionsRef.current
  const activeLibraryTemplateInstallRef = useRef<symbol | null>(null)

  useEffect(
    () => () => {
      libraryTemplateActions.cancel()
    },
    [libraryTemplateActions]
  )

  useEffect(() => {
    libraryTemplateActions.cancel()
  }, [history.document.id, libraryTemplateActions])

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

  const projectConflictRecoveryState = useCallback(
    (state: DocumentConflictRecoveryState) => {
      conflictRecoveryStateRef.current = state
      setConflictRecoveryState(state)
    },
    []
  )

  const claimConflictRecoveryOperation = useCallback(
    (
      action: DocumentConflictRecoveryAction | "discover",
      documentId: string
    ) => {
      if (conflictRecoveryOperationRef.current) return null
      const operation = {
        token: conflictRecoveryOperationSequenceRef.current + 1,
        action,
        documentId,
      }
      conflictRecoveryOperationSequenceRef.current = operation.token
      conflictRecoveryOperationRef.current = operation
      return operation
    },
    []
  )

  const ownsConflictRecoveryOperation = useCallback(
    (operation: NonNullable<typeof conflictRecoveryOperationRef.current>) =>
      mountedRef.current &&
      conflictRecoveryOperationRef.current?.token === operation.token,
    []
  )

  const releaseConflictRecoveryOperation = useCallback(
    (operation: NonNullable<typeof conflictRecoveryOperationRef.current>) => {
      if (conflictRecoveryOperationRef.current?.token === operation.token) {
        conflictRecoveryOperationRef.current = null
      }
    },
    []
  )

  const projectLocalSaveState = useCallback(
    (state: LocalSaveState) => {
      localSaveStateRef.current = state
      setLocalSaveState(state)
      if (
        state.status === "saving" &&
        conflictRecoveryStateRef.current.status === "external_change"
      ) {
        projectConflictRecoveryState({
          status: "working",
          documentId: conflictRecoveryStateRef.current.documentId,
          action: "materialize",
          conflict: null,
        })
      }
      if (state.status === "failed") setDocumentError(state.message)
      if (state.status === "conflict") {
        setDocumentError(
          state.reason === "deleted_elsewhere"
            ? "This document was deleted in another Studio session. Your local version is still available to download."
            : "This document changed in another Studio session. Your local version is still available to download."
        )
      }
    },
    [projectConflictRecoveryState]
  )

  const projectForeignActiveDocumentEvent = useCallback(
    (event: DraftRepositoryEvent, forceOpeningInvalidation = false) => {
      const recovery = conflictRecoveryStateRef.current
      const preservedConflict =
        recovery.status === "conflict"
          ? recovery.conflict
          : recovery.status === "working" || recovery.status === "failed"
            ? recovery.conflict
            : null
      if (
        preservedConflict &&
        (event.type === "saved" ||
          event.type === "restored" ||
          event.type === "deleted" ||
          event.type === "quarantined")
      ) {
        setDocumentError(
          event.type === "deleted"
            ? "The saved document was deleted after Studio preserved your version. Recovery is still required."
            : event.type === "quarantined"
              ? "The saved document was quarantined after Studio preserved your version. Recovery is still required."
              : "The saved document changed again. Your preserved recovery candidate remains unchanged."
        )
        return true
      }
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
        const state: Extract<LocalSaveState, { status: "external_change" }> = {
          status: "external_change",
          reason: "saved_elsewhere",
          observedRecordVersion: event.recordVersion,
        }
        projectLocalSaveState(state)
        projectConflictRecoveryState({
          ...state,
          documentId: event.documentId,
        })
        setDocumentError(
          "This document changed in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "restored") {
        const state: Extract<LocalSaveState, { status: "external_change" }> = {
          status: "external_change",
          reason: "saved_elsewhere",
          observedRecordVersion: event.recordVersion,
        }
        projectLocalSaveState(state)
        projectConflictRecoveryState({
          ...state,
          documentId: event.documentId,
        })
        setDocumentError(
          "This document changed in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "deleted") {
        const state: Extract<LocalSaveState, { status: "external_change" }> = {
          status: "external_change",
          reason: "deleted_elsewhere",
          observedRecordVersion: event.recordVersion,
        }
        projectLocalSaveState(state)
        projectConflictRecoveryState({
          ...state,
          documentId: event.documentId,
        })
        setDocumentError(
          "This document was deleted in another Studio session. Your open version has not been discarded."
        )
        return true
      }
      if (event.type === "quarantined") {
        const state: Extract<LocalSaveState, { status: "external_change" }> = {
          status: "external_change",
          reason: "quarantined_elsewhere",
          observedRecordVersion:
            activeRecordRef.current?.summary.recordVersion ?? 0,
        }
        projectLocalSaveState(state)
        projectConflictRecoveryState({
          ...state,
          documentId: event.documentId,
        })
        setDocumentError(
          "This document was quarantined after another Studio session found corrupt local data. Your open version has not been discarded."
        )
        return true
      }
      return false
    },
    [projectConflictRecoveryState, projectLocalSaveState]
  )

  const installEditorSession = useCallback(
    (envelope: CurrentDraftEnvelope) => {
      const installedReviewJournal = reviewJournalOrEmpty(
        envelope.reviewJournal
      )
      const installedQuotationRefreshJournal = quotationRefreshJournalOrEmpty(
        envelope.quotationRefresh
      )
      const nextHistory = createDocumentHistory(
        envelope.document,
        installedReviewJournal.pending?.changeSet.baseSnapshotId,
        historyOptionsRef.current
      )
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
      pruneTemplateSourceContexts(nextHistory)
      installTemplateSourceContext(sourceContext)
      const projectedReviewJournal = projectReviewJournal(
        installedReviewJournal
      )
      lastCapturedReviewJournalRef.current = projectedReviewJournal
      const projectedQuotationRefreshJournal = projectQuotationRefreshJournal(
        installedQuotationRefreshJournal
      )
      lastCapturedQuotationRefreshJournalRef.current =
        projectedQuotationRefreshJournal
      const firstPageId = envelope.document.pages[0].id
      activePageIdRef.current = firstPageId
      setActivePageId(firstPageId)
      setSelection(null)
      setDocumentError(null)
      setTemplateActionError(null)
      setSessionMode("workspace")
    },
    [
      installTemplateSourceContext,
      projectReviewJournal,
      projectQuotationRefreshJournal,
      pruneTemplateSourceContexts,
    ]
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
      const currentReviewJournal = reviewJournalRef.current
      const currentQuotationRefreshJournal = quotationRefreshJournalRef.current
      if (
        lastCapturedDocumentRef.current === document &&
        sourceContextsMatch(
          lastCapturedSourceContextRef.current,
          sourceContext
        ) &&
        lastCapturedReviewJournalRef.current === currentReviewJournal &&
        lastCapturedQuotationRefreshJournalRef.current ===
          currentQuotationRefreshJournal
      )
        return true
      try {
        if (session.controller.documentId !== document.id) {
          throw new Error(
            `Studio refused to save document ${document.id} through the controller for ${session.controller.documentId}.`
          )
        }
        session.controller.capture({
          document,
          sourceContext,
          reviewJournal: reviewJournalForStorage(currentReviewJournal),
          quotationRefresh: quotationRefreshJournalForStorage(
            currentQuotationRefreshJournal
          ),
        })
        lastCapturedDocumentRef.current = document
        lastCapturedSourceContextRef.current = sourceContext
        lastCapturedReviewJournalRef.current = currentReviewJournal
        lastCapturedQuotationRefreshJournalRef.current =
          currentQuotationRefreshJournal
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
          const mediaRecovery = activeLocalMediaRecoveryRef.current
          if (mediaRecovery?.session === session) {
            if (!mediaRecovery.critical) {
              mediaRecovery.controller.abort(
                new DOMException(
                  "Studio changed documents before image recovery committed.",
                  "AbortError"
                )
              )
            }
            await mediaRecovery.criticalSettlement
          }
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

  const cancelLibraryMediaActionForTransition = useCallback(() => {
    const activeAction = activeLibraryMediaActionRef.current
    if (activeAction) {
      activeAction.controller.abort(
        new DOMException(
          "Studio changed documents before the image action committed.",
          "AbortError"
        )
      )
      activeLibraryMediaActionRef.current = null
    }
    const replacementCancelled =
      imageReplacementCoordinatorRef.current?.cancel() ?? false
    if (activeAction || replacementCancelled) {
      assetMutationActiveRef.current = false
      setIsImportingAsset(false)
    }
  }, [])

  const claimSessionTransition = useCallback(
    (kind: SessionTransition["kind"]): SessionTransition | null => {
      if (!mountedRef.current) return null
      if (activeSessionTransitionRef.current) return null
      if (activeLocalAssetPromotionRef.current?.critical) {
        setDocumentError(
          "Wait for the image to finish saving everywhere before opening another document."
        )
        return null
      }
      if (activeLocalMediaRecoveryRef.current?.critical) {
        setDocumentError(
          "Wait for the recovered image references to finish saving before opening another document."
        )
        return null
      }
      if (publicationOperationRef.current) {
        setDocumentError(
          "Wait for publication to finish or cancel it before opening another document."
        )
        return null
      }
      cancelLibraryMediaActionForTransition()
      const transition: SessionTransition = {
        token: sessionTransitionSequenceRef.current + 1,
        kind,
      }
      const promotion = activeLocalAssetPromotionRef.current
      if (promotion) {
        promotion.cancel()
        activeLocalAssetPromotionRef.current = null
        setLocalAssetPromotions((current) => {
          if (
            current[promotion.localAssetId]?.operationId !==
            promotion.operationId
          ) {
            return current
          }
          const next = { ...current }
          delete next[promotion.localAssetId]
          return next
        })
      }
      const mediaRecovery = activeLocalMediaRecoveryRef.current
      if (mediaRecovery && !mediaRecovery.critical) {
        mediaRecovery.controller.abort(
          new DOMException(
            "Studio changed documents before image recovery committed.",
            "AbortError"
          )
        )
      }
      const reservation = localAssetPromotionReservationRef.current
      if (reservation) {
        reservation.cancel()
        localAssetPromotionStartGateRef.current.release(
          reservation.key,
          reservation.token
        )
        localAssetPromotionReservationRef.current = null
        setLocalAssetPromotions((current) => {
          if (
            current[reservation.localAssetId]?.operationId !== reservation.token
          ) {
            return current
          }
          const next = { ...current }
          delete next[reservation.localAssetId]
          return next
        })
      }
      sessionTransitionSequenceRef.current = transition.token
      activeSessionTransitionRef.current = transition
      return transition
    },
    [cancelLibraryMediaActionForTransition]
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
      canInstall: () => boolean = () => true,
      replacement:
        "settle" | "preserved_recovery" | "repository_replaced" = "settle"
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
      if (activeLocalMediaRecoveryRef.current) {
        setDocumentError(
          activeLocalMediaRecoveryRef.current.critical
            ? "Wait for the recovered image references to finish saving."
            : "Wait for the current document-image recovery to finish."
        )
        return false
      }
      if (localMediaRecoveryCheckpointRef.current.size > 0) {
        setDocumentError(
          "Finish saving the recovered document image before making another edit."
        )
        return false
      }
      if (pendingDocumentImportMediaReview) {
        setDocumentError(
          "Finish or cancel the document image review before editing this document."
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
          if (state.status === "conflict") {
            liveConflictIdRef.current = state.conflictId
          }
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
      const mountedRecoveryPreflight =
        await mountedMediaRecoveryRepositoryRef.current.listPendingByDocument(
          record.summary.documentId
        )
      if (!ownsSessionTransition(transition) || !canInstall()) {
        nextSession.unsubscribe()
        nextSession.controller.close()
        nextSession.releaseLease()
        return false
      }
      if (previousSession) {
        if (replacement === "settle") {
          if (!(await retirePersistenceSession(previousSession, canInstall))) {
            nextSession.unsubscribe()
            nextSession.controller.close()
            nextSession.releaseLease()
            return false
          }
        } else {
          const recovery = conflictRecoveryStateRef.current
          const preservesCurrentDocument =
            replacement === "repository_replaced"
              ? previousSession.controller.documentId ===
                record.summary.documentId
              : recovery.status !== "inactive" &&
                recovery.status !== "discovering" &&
                recovery.documentId === previousSession.controller.documentId
          if (
            !preservesCurrentDocument ||
            !ownsSessionTransition(transition) ||
            !canInstall()
          ) {
            nextSession.unsubscribe()
            nextSession.controller.close()
            nextSession.releaseLease()
            return false
          }
          previousSession.unsubscribe()
          previousSession.controller.close()
          previousSession.releaseLease()
          if (activePersistenceSessionRef.current === previousSession) {
            activePersistenceSessionRef.current = null
            activeRecordRef.current = null
          }
        }
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
      setPublicationHistoryGeneration(nextSession.generation)
      liveConflictIdRef.current = null
      activeRecordRef.current = record
      activePersistenceSessionRef.current = nextSession
      const mountedRecoverySessionKey = `${record.summary.documentId}:${nextSession.generation}`
      if (!mountedRecoveryPreflight.ok) {
        mountedMediaRecoveryReconciledSessionRef.current = null
        setMountedMediaRecoveryReconciliation({
          status: "error",
          sessionKey: mountedRecoverySessionKey,
          message: mountedRecoveryPreflight.failure.message,
        })
      } else if (mountedRecoveryPreflight.records.length === 0) {
        mountedMediaRecoveryReconciledSessionRef.current =
          mountedRecoverySessionKey
        setMountedMediaRecoveryReconciliation({
          status: "ready",
          sessionKey: mountedRecoverySessionKey,
          message: null,
        })
      } else {
        mountedMediaRecoveryReconciledSessionRef.current = null
        setMountedMediaRecoveryReconciliation({
          status: "checking",
          sessionKey: mountedRecoverySessionKey,
          message: null,
        })
      }
      lastCapturedDocumentRef.current = record.envelope.document
      lastCapturedSourceContextRef.current =
        record.envelope.sourceContext ?? null
      lastCapturedReviewJournalRef.current = reviewJournalOrEmpty(
        record.envelope.reviewJournal
      )
      lastCapturedQuotationRefreshJournalRef.current =
        quotationRefreshJournalOrEmpty(record.envelope.quotationRefresh)
      projectLocalSaveState(nextSession.controller.state)
      installEditorSession(record.envelope)
      if (initialRecordWarning) setDocumentError(initialRecordWarning)
      return true
    },
    [
      getDraftRepository,
      installEditorSession,
      ownsSessionTransition,
      projectLocalSaveState,
      retirePersistenceSession,
      initialRecordWarning,
    ]
  )

  const readUnresolvedConflict = useCallback(
    async (documentId: string, preferredConflictId?: string) => {
      const listed = await getDraftRepository().listConflicts(documentId)
      if (!listed.ok) {
        return {
          ok: false as const,
          message:
            "failure" in listed
              ? listed.failure.message
              : "The preserved conflict no longer exists.",
          retryable: listed.reason === "storage_unavailable",
        }
      }
      const unresolved = listed.value.filter(
        (conflict) => conflict.resolvedAt === null
      )
      const conflict = preferredConflictId
        ? (unresolved.find(
            (candidate) => candidate.conflictId === preferredConflictId
          ) ?? null)
        : (unresolved[0] ?? null)
      if (preferredConflictId && !conflict) {
        return {
          ok: false as const,
          message:
            "The preserved conflict changed before Studio could open its recovery actions.",
          retryable: true,
        }
      }
      return { ok: true as const, conflict }
    },
    [getDraftRepository]
  )

  const discoverDocumentConflict = useCallback(
    async (documentId: string, preferredConflictId?: string) => {
      const operation = claimConflictRecoveryOperation("discover", documentId)
      if (!operation) return false
      projectConflictRecoveryState({ status: "discovering", documentId })
      try {
        const result = await readUnresolvedConflict(
          documentId,
          preferredConflictId
        )
        if (!ownsConflictRecoveryOperation(operation)) return false
        if (!result.ok) {
          projectConflictRecoveryState({
            status: "failed",
            documentId,
            action: "discover",
            conflict: null,
            message: result.message,
            retryable: result.retryable,
          })
          projectLocalSaveState({
            status: "failed",
            message: result.message,
            retryable: result.retryable,
          })
          return false
        }
        if (!result.conflict) {
          projectConflictRecoveryState({ status: "inactive" })
          return true
        }
        projectConflictRecoveryState({
          status: "conflict",
          documentId,
          conflict: result.conflict,
        })
        projectLocalSaveState({
          status: "conflict",
          conflictId: result.conflict.conflictId,
          reason: result.conflict.reason,
        })
        return true
      } finally {
        releaseConflictRecoveryOperation(operation)
      }
    },
    [
      claimConflictRecoveryOperation,
      ownsConflictRecoveryOperation,
      projectConflictRecoveryState,
      projectLocalSaveState,
      readUnresolvedConflict,
      releaseConflictRecoveryOperation,
    ]
  )

  useEffect(() => {
    if (localSaveState.status !== "conflict") return
    const documentId = activeRecordRef.current?.summary.documentId
    if (!documentId) return
    const recovery = conflictRecoveryStateRef.current
    if (
      recovery.status === "conflict" &&
      recovery.conflict.conflictId === localSaveState.conflictId
    ) {
      return
    }
    void discoverDocumentConflict(documentId, localSaveState.conflictId)
  }, [discoverDocumentConflict, localSaveState])

  const persistAndInstallSession = useCallback(
    async (
      envelope: CurrentDraftEnvelope,
      origin: DraftOrigin,
      canInstall: () => boolean = () => true
    ) => {
      const transition = claimSessionTransition("replace")
      if (!transition) return false
      if (!canInstall()) {
        releaseSessionTransition(transition)
        return false
      }
      try {
        if (persistenceBlockedRef.current || !repositoryReadyRef.current) {
          const validated = validateCurrentDraftSnapshot({
            document: envelope.document,
            sourceContext: envelope.sourceContext,
            reviewJournal: envelope.reviewJournal,
            quotationRefresh: envelope.quotationRefresh,
          })
          if (!validated.ok) {
            setDocumentError(validated.failure.message)
            return false
          }
          if (!ownsSessionTransition(transition) || !canInstall()) return false
          const previousSession = activePersistenceSessionRef.current
          if (
            previousSession &&
            !(await retirePersistenceSession(previousSession))
          )
            return false
          if (!ownsSessionTransition(transition) || !canInstall()) return false
          activeRecordRef.current = null
          lastCapturedDocumentRef.current = validated.envelope.document
          lastCapturedSourceContextRef.current =
            validated.envelope.sourceContext ?? null
          lastCapturedReviewJournalRef.current = reviewJournalOrEmpty(
            validated.envelope.reviewJournal
          )
          lastCapturedQuotationRefreshJournalRef.current =
            quotationRefreshJournalOrEmpty(validated.envelope.quotationRefresh)
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
        if (!ownsSessionTransition(transition) || !canInstall()) return false

        const draftRepository = getDraftRepository()
        const created = await draftRepository.create(
          {
            document: envelope.document,
            sourceContext: envelope.sourceContext,
            reviewJournal: envelope.reviewJournal,
            quotationRefresh: envelope.quotationRefresh,
          },
          origin
        )
        if (!ownsSessionTransition(transition) || !canInstall()) return false
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
        const installed = await installDraftRecord(
          created.record,
          transition,
          canInstall
        )
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
        if (!installed) return false
        return discoverDocumentConflict(record.summary.documentId)
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
      discoverDocumentConflict,
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
    const currentReviewJournal = reviewJournalRef.current
    const currentQuotationRefreshJournal = quotationRefreshJournalRef.current
    if (
      lastCapturedDocumentRef.current === document &&
      sourceContextsMatch(
        lastCapturedSourceContextRef.current,
        sourceContext
      ) &&
      lastCapturedReviewJournalRef.current === currentReviewJournal &&
      lastCapturedQuotationRefreshJournalRef.current ===
        currentQuotationRefreshJournal
    )
      return true

    const session = activePersistenceSessionRef.current
    if (!session) {
      const validated = validateCurrentDraftSnapshot({
        document,
        sourceContext,
        reviewJournal: reviewJournalForStorage(currentReviewJournal),
        quotationRefresh: quotationRefreshJournalForStorage(
          currentQuotationRefreshJournal
        ),
      })
      if (!validated.ok) {
        setDocumentError(validated.failure.message)
        return false
      }
      lastCapturedDocumentRef.current = document
      lastCapturedSourceContextRef.current = sourceContext
      lastCapturedReviewJournalRef.current = currentReviewJournal
      lastCapturedQuotationRefreshJournalRef.current =
        currentQuotationRefreshJournal
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

  const flushActiveDraft = useCallback(
    async (signal?: AbortSignal) => {
      signal?.throwIfAborted()
      if (sessionModeRef.current !== "workspace") return true
      if (!captureSettledDraft()) return false
      if (localSaveStateRef.current.status === "external_change") return false
      const session = activePersistenceSessionRef.current
      if (!session) return true
      await session.controller.flush(signal)
      signal?.throwIfAborted()
      return session.controller.state.status === "saved"
    },
    [captureSettledDraft]
  )

  const retryActiveDraftSave = useCallback(async () => {
    const controller = activePersistenceSessionRef.current?.controller
    if (!controller || controller.state.status !== "failed") return false
    await controller.retry()
    return (controller.state as LocalSaveState).status === "saved"
  }, [])

  const conflictFromRecoveryState = useCallback(
    (state = conflictRecoveryStateRef.current) =>
      state.status === "conflict" ||
      state.status === "working" ||
      state.status === "failed"
        ? state.conflict
        : null,
    []
  )

  const materializeExternalChangeForOperation = useCallback(
    async (
      operation: NonNullable<typeof conflictRecoveryOperationRef.current>,
      action: DocumentConflictRecoveryAction
    ) => {
      const session = activePersistenceSessionRef.current
      const documentId = activeRecordRef.current?.summary.documentId
      if (
        !session ||
        !documentId ||
        documentId !== operation.documentId ||
        !ownsConflictRecoveryOperation(operation)
      ) {
        return null
      }
      const state = conflictRecoveryStateRef.current
      if (
        localSaveStateRef.current.status !== "external_change" &&
        state.status !== "external_change"
      ) {
        return conflictFromRecoveryState(state)
      }
      projectConflictRecoveryState({
        status: "working",
        documentId,
        action,
        conflict: null,
      })
      const exactSnapshot = {
        document: structuredClone(historyRef.current.document),
        sourceContext: structuredClone(templateSourceContextRef.current),
      }
      try {
        session.controller.capture(exactSnapshot)
        await session.controller.flush()
      } catch (error) {
        if (!ownsConflictRecoveryOperation(operation)) return null
        const message =
          error instanceof Error
            ? error.message
            : "Studio could not preserve this version as a conflict candidate."
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action,
          conflict: null,
          message,
          retryable: true,
        })
        return null
      }
      if (!ownsConflictRecoveryOperation(operation)) return null
      const controllerState = session.controller.state
      if (controllerState.status !== "conflict") {
        const message =
          controllerState.status === "failed"
            ? controllerState.message
            : "The external change could not be converted into a preserved recovery candidate."
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action,
          conflict: null,
          message,
          retryable:
            controllerState.status === "failed"
              ? controllerState.retryable
              : true,
        })
        return null
      }
      const recovered = await readUnresolvedConflict(
        documentId,
        controllerState.conflictId
      )
      if (!ownsConflictRecoveryOperation(operation)) return null
      if (!recovered.ok || !recovered.conflict) {
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action,
          conflict: null,
          message: recovered.ok
            ? "Studio could not find the preserved conflict candidate."
            : recovered.message,
          retryable: recovered.ok ? true : recovered.retryable,
        })
        return null
      }
      return recovered.conflict
    },
    [
      conflictFromRecoveryState,
      ownsConflictRecoveryOperation,
      projectConflictRecoveryState,
      readUnresolvedConflict,
    ]
  )

  const materializeExternalChangeConflict = useCallback(async () => {
    const documentId = activeRecordRef.current?.summary.documentId
    if (!documentId) return false
    const operation = claimConflictRecoveryOperation("materialize", documentId)
    if (!operation) return false
    try {
      const conflict = await materializeExternalChangeForOperation(
        operation,
        "materialize"
      )
      if (!conflict || !ownsConflictRecoveryOperation(operation)) return false
      projectConflictRecoveryState({
        status: "conflict",
        documentId,
        conflict,
      })
      return true
    } finally {
      releaseConflictRecoveryOperation(operation)
    }
  }, [
    claimConflictRecoveryOperation,
    materializeExternalChangeForOperation,
    ownsConflictRecoveryOperation,
    projectConflictRecoveryState,
    releaseConflictRecoveryOperation,
  ])

  const closePreservedPersistenceSession = useCallback(() => {
    const session = activePersistenceSessionRef.current
    if (!session) return
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
  }, [])

  const reloadSavedAfterConflict = useCallback(async () => {
    const documentId = activeRecordRef.current?.summary.documentId
    if (!documentId) return { ok: false as const }
    const operation = claimConflictRecoveryOperation("reload_saved", documentId)
    if (!operation) return { ok: false as const }
    const startingState = conflictRecoveryStateRef.current
    const conflict = conflictFromRecoveryState(startingState)
    const restoreExternalRecovery = () => {
      if (conflict || startingState.status !== "external_change") return
      projectLocalSaveState({
        status: "external_change",
        reason: startingState.reason,
        observedRecordVersion: startingState.observedRecordVersion,
      })
    }
    projectConflictRecoveryState({
      status: "working",
      documentId,
      action:
        conflict?.reason === "deleted_elsewhere"
          ? "accept_deletion"
          : "reload_saved",
      conflict,
    })
    try {
      const admitted =
        await persistenceRef.current.documentRouteAdmission.admit(documentId)
      if (!ownsConflictRecoveryOperation(operation)) {
        return { ok: false as const }
      }
      if (admitted.status === "unavailable") {
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action: "reload_saved",
          conflict,
          message: admitted.failure.message,
          retryable: true,
        })
        return { ok: false as const }
      }
      if (admitted.status === "recovery_required") {
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action: "reload_saved",
          conflict,
          message:
            "The saved document could not be verified. Return to Documents to use recovery tools.",
          retryable: false,
        })
        return { ok: false as const }
      }
      if (admitted.status === "superseded") return { ok: false as const }
      if (startingState.status === "external_change") {
        if (startingState.reason === "quarantined_elsewhere") {
          projectConflictRecoveryState({
            status: "failed",
            documentId,
            action: "reload_saved",
            conflict,
            message:
              "This document was quarantined because its stored data could not be verified. Return to Documents to use recovery tools.",
            retryable: false,
          })
          return { ok: false as const }
        }
      }
      const transition = claimSessionTransition("recovery")
      if (!transition) return { ok: false as const }
      try {
        const canInstall = () =>
          ownsConflictRecoveryOperation(operation) &&
          ownsSessionTransition(transition)
        type ReloadHead =
          | Readonly<{
              status: "active"
              record: DocumentDraftRecord
            }>
          | Readonly<{
              status: "deleted"
              expectation: DocumentDraftHeadExpectation
            }>
          | Readonly<{ status: "missing" }>
        const headFromRecord = (record: DocumentDraftRecord): ReloadHead =>
          record.summary.deletedAt === null
            ? { status: "active", record }
            : {
                status: "deleted",
                expectation: expectedHeadForRecord(record),
              }
        const headFromResolution = (
          current:
            | Readonly<{ status: "missing" }>
            | Readonly<{ status: "found"; record: DocumentDraftRecord }>
        ): ReloadHead =>
          current.status === "missing"
            ? { status: "missing" }
            : headFromRecord(current.record)
        let head: ReloadHead =
          admitted.status === "missing"
            ? { status: "missing" }
            : admitted.status === "deleted"
              ? {
                  status: "deleted",
                  expectation: expectedHeadForSummary(admitted.summary),
                }
              : headFromRecord(admitted.record)
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (head.status !== "active") {
            if (conflict) {
              const resolved = await getDraftRepository().resolveConflict(
                conflict.conflictId,
                "reload_saved",
                conflict.candidateDraftSnapshotId,
                head.status === "missing"
                  ? { status: "missing" }
                  : head.expectation
              )
              if (!canInstall()) return { ok: false as const }
              if (!resolved.ok && resolved.reason === "head_changed") {
                head = headFromResolution(resolved.current)
                continue
              }
              if (!resolved.ok) {
                projectConflictRecoveryState({
                  status: "failed",
                  documentId,
                  action: "accept_deletion",
                  conflict,
                  message:
                    "failure" in resolved
                      ? resolved.failure.message
                      : "The preserved conflict no longer exists.",
                  retryable: resolved.reason === "storage_unavailable",
                })
                projectLocalSaveState({
                  status: "conflict",
                  conflictId: conflict.conflictId,
                  reason: conflict.reason,
                })
                return { ok: false as const }
              }
            }
            closePreservedPersistenceSession()
            projectConflictRecoveryState({ status: "inactive" })
            setSessionMode("start")
            return { ok: true as const, destination: "home" as const }
          }
          const installed = await installDraftRecord(
            head.record,
            transition,
            canInstall,
            "preserved_recovery"
          )
          if (!installed || !canInstall()) return { ok: false as const }
          const confirmed = await getDraftRepository().get(documentId)
          if (!canInstall()) return { ok: false as const }
          if (!confirmed.ok) {
            projectConflictRecoveryState({
              status: "failed",
              documentId,
              action: "reload_saved",
              conflict,
              message: confirmed.failure.message,
              retryable: confirmed.reason === "storage_unavailable",
            })
            if (conflict) {
              projectLocalSaveState({
                status: "conflict",
                conflictId: conflict.conflictId,
                reason: conflict.reason,
              })
            } else {
              restoreExternalRecovery()
            }
            return { ok: false as const }
          }
          if (
            confirmed.status === "missing" ||
            confirmed.record.summary.deletedAt !== null
          ) {
            head =
              confirmed.status === "missing"
                ? { status: "missing" }
                : headFromRecord(confirmed.record)
            continue
          }
          if (!sameDraftHead(head.record, confirmed.record)) {
            head = headFromRecord(confirmed.record)
            continue
          }
          if (
            admitted.status === "opened" &&
            sameDraftHead(admitted.record, confirmed.record)
          ) {
            const touch =
              await persistenceRef.current.documentRouteAdmission.confirmInstalled(
                admitted,
                confirmed.record
              )
            if (!canInstall()) return { ok: false as const }
            if (touch.status === "confirmed" && touch.warning) {
              setDocumentError(touch.warning.message)
            }
          }
          if (conflict) {
            const resolved = await getDraftRepository().resolveConflict(
              conflict.conflictId,
              "reload_saved",
              conflict.candidateDraftSnapshotId,
              expectedHeadForRecord(confirmed.record)
            )
            if (!canInstall()) return { ok: false as const }
            if (!resolved.ok && resolved.reason === "head_changed") {
              head = headFromResolution(resolved.current)
              continue
            }
            if (!resolved.ok) {
              projectConflictRecoveryState({
                status: "failed",
                documentId,
                action: "reload_saved",
                conflict,
                message:
                  "failure" in resolved
                    ? resolved.failure.message
                    : "The preserved conflict no longer exists.",
                retryable: resolved.reason === "storage_unavailable",
              })
              projectLocalSaveState({
                status: "conflict",
                conflictId: conflict.conflictId,
                reason: conflict.reason,
              })
              return { ok: false as const }
            }
          }
          projectConflictRecoveryState({ status: "inactive" })
          return { ok: true as const, destination: "document" as const }
        }
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action: "reload_saved",
          conflict,
          message:
            "The saved document kept changing before Studio could verify it. Try again when the other edit is finished.",
          retryable: true,
        })
        if (conflict) {
          projectLocalSaveState({
            status: "conflict",
            conflictId: conflict.conflictId,
            reason: conflict.reason,
          })
        } else {
          restoreExternalRecovery()
        }
        return { ok: false as const }
      } finally {
        releaseSessionTransition(transition)
      }
    } finally {
      releaseConflictRecoveryOperation(operation)
    }
  }, [
    claimConflictRecoveryOperation,
    claimSessionTransition,
    closePreservedPersistenceSession,
    conflictFromRecoveryState,
    getDraftRepository,
    installDraftRecord,
    ownsConflictRecoveryOperation,
    ownsSessionTransition,
    projectConflictRecoveryState,
    projectLocalSaveState,
    releaseConflictRecoveryOperation,
    releaseSessionTransition,
  ])

  const saveConflictAsCopy = useCallback(async () => {
    const initialConflict = conflictFromRecoveryState()
    const documentId =
      initialConflict?.documentId ?? activeRecordRef.current?.summary.documentId
    if (!documentId) return { ok: false as const }
    const operation = claimConflictRecoveryOperation("save_copy", documentId)
    if (!operation) return { ok: false as const }
    try {
      let conflict = initialConflict
      if (!conflict) {
        conflict = await materializeExternalChangeForOperation(
          operation,
          "save_copy"
        )
      }
      if (!conflict || !ownsConflictRecoveryOperation(operation)) {
        return { ok: false as const }
      }
      projectConflictRecoveryState({
        status: "working",
        documentId,
        action: "save_copy",
        conflict,
      })
      const newDocumentId = `document-${crypto.randomUUID()}`
      const copySnapshot =
        conflict.conflictId === liveConflictIdRef.current
          ? {
              document: structuredClone(historyRef.current.document),
              sourceContext: structuredClone(templateSourceContextRef.current),
            }
          : undefined
      const copied = await getDraftRepository().saveConflictAsCopy({
        conflictId: conflict.conflictId,
        expectedCandidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
        newDocumentId,
        copySnapshot,
      })
      if (!ownsConflictRecoveryOperation(operation)) {
        return { ok: false as const }
      }
      if (!copied.ok) {
        const message =
          "failure" in copied
            ? copied.failure.message
            : copied.reason === "stale_conflict"
              ? "A newer preserved version replaced this conflict. Review it before trying again."
              : copied.reason === "target_exists"
                ? "The generated copy identifier is already in use. Try again."
                : copied.reason === "resolved_without_copy"
                  ? "This conflict was already resolved without creating a copy."
                  : "The preserved conflict no longer exists."
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action: "save_copy",
          conflict:
            copied.reason === "stale_conflict" ? copied.current : conflict,
          message,
          retryable:
            copied.reason === "storage_unavailable" ||
            copied.reason === "target_exists" ||
            copied.reason === "stale_conflict",
        })
        return { ok: false as const }
      }
      if (
        activeRecordRef.current?.summary.documentId ===
          copied.record.summary.documentId &&
        sameDraftHead(activeRecordRef.current, copied.record)
      ) {
        projectConflictRecoveryState({
          status: "failed",
          documentId: conflict.documentId,
          action: "save_copy",
          conflict,
          message:
            "The copy is saved. Studio still needs to open its canonical route.",
          retryable: true,
          createdDocumentId: copied.record.summary.documentId,
        })
        return {
          ok: true as const,
          documentId: copied.record.summary.documentId,
        }
      }
      const transition = claimSessionTransition("recovery")
      if (!transition) {
        projectConflictRecoveryState({
          status: "failed",
          documentId,
          action: "save_copy",
          conflict,
          message:
            "The copy was saved, but Studio could not open it. It is available from Documents.",
          retryable: true,
          createdDocumentId: copied.record.summary.documentId,
        })
        return {
          ok: false as const,
          createdDocumentId: copied.record.summary.documentId,
        }
      }
      try {
        const canInstall = () =>
          ownsConflictRecoveryOperation(operation) &&
          ownsSessionTransition(transition)
        const installed = await installDraftRecord(
          copied.record,
          transition,
          canInstall,
          "preserved_recovery"
        )
        if (!installed || !canInstall()) {
          projectConflictRecoveryState({
            status: "failed",
            documentId,
            action: "save_copy",
            conflict,
            message:
              "The copy was saved, but Studio could not open it. It is available from Documents.",
            retryable: true,
            createdDocumentId: copied.record.summary.documentId,
          })
          return {
            ok: false as const,
            createdDocumentId: copied.record.summary.documentId,
          }
        }
        projectConflictRecoveryState({
          status: "failed",
          documentId: conflict.documentId,
          action: "save_copy",
          conflict,
          message:
            "The copy is saved. Studio still needs to open its canonical route.",
          retryable: true,
          createdDocumentId: copied.record.summary.documentId,
        })
        return {
          ok: true as const,
          documentId: copied.record.summary.documentId,
        }
      } finally {
        releaseSessionTransition(transition)
      }
    } finally {
      releaseConflictRecoveryOperation(operation)
    }
  }, [
    claimConflictRecoveryOperation,
    claimSessionTransition,
    conflictFromRecoveryState,
    getDraftRepository,
    installDraftRecord,
    materializeExternalChangeForOperation,
    ownsConflictRecoveryOperation,
    ownsSessionTransition,
    projectConflictRecoveryState,
    releaseConflictRecoveryOperation,
    releaseSessionTransition,
  ])

  const returnToDocumentsFromConflictRecovery = useCallback(() => {
    const recovery = conflictRecoveryStateRef.current
    const canLeave =
      (recovery.status === "external_change" &&
        recovery.reason === "quarantined_elsewhere") ||
      (recovery.status === "failed" && recovery.conflict === null)
    if (!canLeave) return false
    cancelLibraryMediaActionForTransition()
    closePreservedPersistenceSession()
    projectConflictRecoveryState({ status: "inactive" })
    setSessionMode("start")
    return true
  }, [
    cancelLibraryMediaActionForTransition,
    closePreservedPersistenceSession,
    projectConflictRecoveryState,
  ])

  const getCurrentDocumentSnapshot = useCallback(
    () => structuredClone(historyRef.current.document),
    []
  )
  const getActiveDocumentId = useCallback(
    () => activeRecordRef.current?.summary.documentId ?? null,
    []
  )

  const returnToStart = useCallback(async () => {
    if (imageCropController.hasActiveSession) {
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
    if (pendingGeneratedDocumentRef.current) {
      setGeneratedDocumentError(
        "Create or discard the generated document before going home."
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
    imageCropController,
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
      pendingLocatedMediaConflictRef.current.clear()
      const publication = publicationOperationRef.current
      if (publication) {
        clearTimeout(publication.timer)
        publication.controller.abort(
          new DOMException(
            "Studio closed before publication finished.",
            "AbortError"
          )
        )
      }
      const promotion = activeLocalAssetPromotionRef.current
      if (promotion && !promotion.critical) promotion.cancel()
      const criticalPromotionSettlement = promotion?.critical
        ? promotion.criticalSettlement
        : null
      const mediaRecovery = activeLocalMediaRecoveryRef.current
      if (mediaRecovery && !mediaRecovery.critical) {
        mediaRecovery.controller.abort(
          new DOMException(
            "Studio closed before image recovery committed.",
            "AbortError"
          )
        )
      }
      const mediaRecoverySettlement = mediaRecovery?.criticalSettlement ?? null
      const reservation = localAssetPromotionReservationRef.current
      if (reservation) {
        reservation.cancel()
        localAssetPromotionStartGateRef.current.release(
          reservation.key,
          reservation.token
        )
        localAssetPromotionReservationRef.current = null
      }
      sessionTransitionSequenceRef.current += 1
      activeSessionTransitionRef.current = null
      const session = activePersistenceSessionRef.current
      if (!session) return
      const document = historyRef.current.document
      const sourceContext = templateSourceContextRef.current
      const currentReviewJournal = reviewJournalRef.current
      const currentQuotationRefreshJournal = quotationRefreshJournalRef.current
      if (
        session.controller.documentId === document.id &&
        (lastCapturedDocumentRef.current !== document ||
          !sourceContextsMatch(
            lastCapturedSourceContextRef.current,
            sourceContext
          ) ||
          lastCapturedReviewJournalRef.current !== currentReviewJournal ||
          lastCapturedQuotationRefreshJournalRef.current !==
            currentQuotationRefreshJournal)
      ) {
        try {
          session.controller.capture({
            document,
            sourceContext,
            reviewJournal: reviewJournalForStorage(currentReviewJournal),
            quotationRefresh: quotationRefreshJournalForStorage(
              currentQuotationRefreshJournal
            ),
          })
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
          if (criticalPromotionSettlement) {
            await criticalPromotionSettlement
          }
          if (mediaRecoverySettlement) await mediaRecoverySettlement
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

  useEffect(() => {
    if (!initialRecord) {
      setRouteSessionStatus("not_requested")
      setDocumentMediaAdmission(null)
      setDocumentMediaAdmissionRestoreUnavailable(false)
      return
    }
    let active = true
    let transition: SessionTransition | null = null
    setRouteSessionStatus("installing")
    void Promise.resolve().then(async () => {
      if (!active) return
      transition = claimSessionTransition("route")
      if (!transition) {
        setRouteSessionStatus("failed")
        return
      }
      const canInstall = () => active && ownsSessionTransition(transition!)
      try {
        const authoritative = await getDraftRepository().get(
          initialRecord.summary.documentId
        )
        if (!canInstall()) return
        if (
          !authoritative.ok ||
          authoritative.status !== "found" ||
          authoritative.record.summary.deletedAt !== null ||
          !sameDraftHead(initialRecord, authoritative.record)
        ) {
          setDocumentError(
            !authoritative.ok
              ? authoritative.failure.message
              : "The saved document advanced before this route could install it. Reload to open the authoritative version."
          )
          setRouteSessionStatus("failed")
          return
        }
        const installed = await installDraftRecord(
          authoritative.record,
          transition,
          canInstall
        )
        if (!canInstall()) return
        if (!installed) {
          setRouteSessionStatus("failed")
          return
        }
        const conflictsReady = await discoverDocumentConflict(
          authoritative.record.summary.documentId
        )
        if (!canInstall()) return
        releaseSessionTransition(transition)
        transition = null
        setRouteSessionStatus(conflictsReady ? "ready" : "failed")
        if (conflictsReady) {
          setDocumentMediaAdmission(initialMediaAdmission)
          setDocumentMediaAdmissionRestoreUnavailable(false)
          const notificationKey = [
            authoritative.record.summary.documentId,
            authoritative.record.summary.recordVersion,
            authoritative.record.summary.contentSnapshotId,
            authoritative.record.summary.draftSnapshotId,
          ].join(":")
          if (initialInstallNotificationRef.current !== notificationKey) {
            initialInstallNotificationRef.current = notificationKey
            onInitialRecordInstalledRef.current?.(authoritative.record)
          }
        }
      } catch (error: unknown) {
        if (!transition || !canInstall()) return
        setDocumentError(
          error instanceof Error
            ? error.message
            : "Studio could not start the routed document session."
        )
        setRouteSessionStatus("failed")
      } finally {
        if (transition) releaseSessionTransition(transition)
      }
    })
    return () => {
      active = false
      if (transition) releaseSessionTransition(transition)
    }
  }, [
    claimSessionTransition,
    discoverDocumentConflict,
    getDraftRepository,
    initialRecord,
    initialMediaAdmission,
    installDraftRecord,
    ownsSessionTransition,
    releaseSessionTransition,
  ])

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
  const downloadCurrentVersion = useCallback(() => {
    const conflict = conflictFromRecoveryState()
    const usesStoredCandidate =
      conflict && conflict.conflictId !== liveConflictIdRef.current
    return downloadEnvelope(
      usesStoredCandidate
        ? { schemaVersion: 1, ...conflict.candidate }
        : {
            schemaVersion: 1,
            document: historyRef.current.document,
            sourceContext: templateSourceContextRef.current,
            reviewJournal: reviewJournalForStorage(reviewJournalRef.current),
            quotationRefresh: quotationRefreshJournalForStorage(
              quotationRefreshJournalRef.current
            ),
          },
      "-my-version"
    )
  }, [conflictFromRecoveryState, downloadEnvelope])

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
          reviewJournal:
            "reviewJournal" in decoded.envelope
              ? decoded.envelope.reviewJournal
              : undefined,
          quotationRefresh:
            "quotationRefresh" in decoded.envelope
              ? decoded.envelope.quotationRefresh
              : undefined,
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
      const designTemplate = requiredDesignTemplateForQuotation(
        quotationStarter.templateId
      )
      const envelope: CurrentDraftEnvelope = {
        schemaVersion: 1,
        document: quotationStarter.document,
        sourceContext: {
          quotationSource: quotationStarter.source,
          quotationTemplateId: quotationStarter.templateId,
          designTemplate,
          composition: await createKnownQuotationComposition(
            quotationStarter.source,
            designTemplate
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
    const generation = assetLifecycleGenerationRef.current + 1
    assetLifecycleGenerationRef.current = generation
    activeAssetLifecycleGenerationRef.current = generation
    return () => {
      if (activeAssetLifecycleGenerationRef.current !== generation) return
      activeAssetLifecycleGenerationRef.current = null
      referencedLocalAssetIdsRef.current.clear()
      for (const url of assetUrlsRef.current.values()) URL.revokeObjectURL(url)
      assetUrlsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const lifecycleGeneration = activeAssetLifecycleGenerationRef.current
    if (lifecycleGeneration === null) return
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
      return assetId && !assetUrlsRef.current.has(assetId) ? [assetId] : []
    })
    if (!missingAssetIds.length) return
    const uniqueAssetIds = [...new Set(missingAssetIds)]
    for (const assetId of uniqueAssetIds) {
      let load = assetLoadPromisesRef.current.get(assetId)
      if (!load) {
        load = {
          promise: Promise.resolve().then(() => loadLocalAsset(assetId)),
          consumerGenerations: new Set<number>(),
        }
        assetLoadPromisesRef.current.set(assetId, load)
        void load.promise.then(
          () => {
            if (assetLoadPromisesRef.current.get(assetId) === load) {
              assetLoadPromisesRef.current.delete(assetId)
            }
          },
          () => {
            if (assetLoadPromisesRef.current.get(assetId) === load) {
              assetLoadPromisesRef.current.delete(assetId)
            }
          }
        )
      }
      if (load.consumerGenerations.has(lifecycleGeneration)) continue
      load.consumerGenerations.add(lifecycleGeneration)
      void load.promise.then(
        (blob) => {
          if (
            activeAssetLifecycleGenerationRef.current !== lifecycleGeneration ||
            !referencedLocalAssetIdsRef.current.has(assetId)
          ) {
            return
          }
          if (!blob) {
            setAssetError("A saved image is missing on this device.")
            setAssetVersion((current) => current + 1)
            return
          }
          if (assetUrlsRef.current.has(assetId)) return
          const url = URL.createObjectURL(blob)
          if (
            activeAssetLifecycleGenerationRef.current !== lifecycleGeneration ||
            !referencedLocalAssetIdsRef.current.has(assetId) ||
            assetUrlsRef.current.has(assetId)
          ) {
            URL.revokeObjectURL(url)
            return
          }
          assetUrlsRef.current.set(assetId, url)
          setAssetVersion((current) => current + 1)
        },
        () => {
          if (
            activeAssetLifecycleGenerationRef.current !== lifecycleGeneration ||
            !referencedLocalAssetIdsRef.current.has(assetId)
          ) {
            return
          }
          setAssetError("A saved image could not be restored on this device.")
        }
      )
    }
  }, [changeSetConflict, history.document, pendingChangeSet])

  const allowMutation = useCallback(
    (
      allowActiveImageCrop = false,
      allowSeparateDocumentTransition = false,
      allowMediaAdmissionDecision = false,
      allowGeneratedDocumentDecision = false
    ) => {
      if (
        separateDocumentTransitionRef.current &&
        !allowSeparateDocumentTransition
      ) {
        setDocumentError(DOCUMENT_TRANSITION_DISABLED_REASON)
        return false
      }
      const persistenceSession = activePersistenceSessionRef.current
      if (sessionModeRef.current === "workspace" && persistenceSession) {
        const expectedRecoverySessionKey = `${historyRef.current.document.id}:${persistenceSession.generation}`
        const reconciliation = mountedMediaRecoveryReconciliationRef.current
        if (
          reconciliation.status !== "ready" ||
          reconciliation.sessionKey !== expectedRecoverySessionKey
        ) {
          setDocumentError(
            reconciliation.status === "error"
              ? "Retry the interrupted image-recovery check before editing this document."
              : "Wait while Studio checks interrupted image recovery before editing this document."
          )
          return false
        }
      }
      if (activeLocalAssetPromotionRef.current?.critical) {
        setDocumentError(
          "Wait for the image to finish saving everywhere before editing this document."
        )
        return false
      }
      const mediaRecovery = activeLocalMediaRecoveryRef.current
      if (mediaRecovery) {
        setDocumentError(
          mediaRecovery.critical
            ? "Wait for the recovered image references to finish saving before editing this document."
            : "Wait for the current document-image recovery to finish before editing this document."
        )
        return false
      }
      if (localMediaRecoveryCheckpointRef.current.size > 0) {
        setDocumentError(
          "Finish saving the recovered document image before making another edit."
        )
        return false
      }
      const mediaAdmissionReceipt = documentMediaAdmission?.receipt
      if (mediaAdmissionReceipt && !allowMediaAdmissionDecision) {
        setDocumentError(
          mediaAdmissionReceipt.restoredAt
            ? "Keep the restored device-only document before editing it."
            : "Keep or restore the recovered document images before editing this document."
        )
        return false
      }
      const recovery = conflictRecoveryStateRef.current
      if (
        recovery.status !== "inactive" &&
        recovery.status !== "external_change"
      ) {
        setDocumentError(
          "Resolve the saved-version conflict before editing this document."
        )
        return false
      }
      if (draftRecoveryRef.current) {
        setDocumentError(
          "Resolve the unreadable local draft before editing this document."
        )
        return false
      }
      if (imageCropController.hasActiveSession && !allowActiveImageCrop) {
        setDocumentError("Finish or cancel the active image crop first.")
        return false
      }
      if (quotationRefreshJournalRef.current.pending) {
        setDocumentError(
          "Accept or reject the pending quotation refresh before editing the document."
        )
        return false
      }
      if (
        pendingGeneratedDocumentRef.current &&
        !allowGeneratedDocumentDecision
      ) {
        setGeneratedDocumentError(
          "Create or discard the generated document before editing the current document."
        )
        return false
      }
      if (!pendingChangeSetRef.current) return true
      setChangeSetError("Resolve or discard the preview before editing.")
      return false
    },
    [
      documentMediaAdmission,
      imageCropController,
      pendingDocumentImportMediaReview,
    ]
  )

  const keepDocumentMediaAdmission = useCallback(async () => {
    if (!allowMutation(false, false, true)) return false
    const receipt = documentMediaAdmission?.receipt
    if (!receipt) {
      return false
    }
    const acknowledged =
      await getDraftRepository().acknowledgeLocalMediaAdmissionReceipt(
        receipt.receiptId
      )
    if (!acknowledged.ok) {
      setDocumentError(
        "failure" in acknowledged
          ? acknowledged.failure.message
          : "The saved document changed before Studio could keep this image decision. Reload and review it again."
      )
      return false
    }
    setDocumentMediaAdmission({
      status: "unchanged",
      aliasCount: documentMediaAdmission.aliasCount,
      migratedLocalAssetIds: [],
      unresolved: [],
      receipt: null,
      message: "Document image recovery was reviewed and kept.",
    })
    setDocumentMediaAdmissionRestoreUnavailable(false)
    return true
  }, [allowMutation, documentMediaAdmission, getDraftRepository])

  const restoreDocumentMediaAdmission = useCallback(async () => {
    if (!allowMutation(false, false, true)) return false
    const receipt = documentMediaAdmission?.receipt
    if (!receipt || receipt.restoredAt !== null) {
      return false
    }
    const transition = claimSessionTransition("recovery")
    if (!transition) return false
    try {
      const session = activePersistenceSessionRef.current
      if (session && !(await settlePersistenceSession(session))) return false
      if (!ownsSessionTransition(transition)) return false
      const restored =
        await getDraftRepository().restoreLocalMediaAdmissionReceipt(
          receipt.receiptId
        )
      if (!ownsSessionTransition(transition)) return false
      if (!restored.ok) {
        if (!("failure" in restored)) {
          setDocumentMediaAdmissionRestoreUnavailable(true)
        }
        setDocumentError(
          "failure" in restored
            ? restored.failure.message
            : restored.reason === "preimage_unavailable"
              ? "The device-only preimage is no longer available. Keep the recovered document instead."
              : "The saved document changed before Studio could restore its device-only version. Reload and review it again."
        )
        return false
      }
      const installed = await installDraftRecord(
        restored.record,
        transition,
        () => ownsSessionTransition(transition),
        "repository_replaced"
      )
      if (!installed || !ownsSessionTransition(transition)) return false
      const conflictsReady = await discoverDocumentConflict(
        restored.record.summary.documentId
      )
      if (!conflictsReady || !ownsSessionTransition(transition)) return false
      setDocumentMediaAdmission({
        status: "receipt_pending",
        aliasCount: restored.receipt.aliases.length,
        migratedLocalAssetIds: [],
        unresolved: [],
        receipt: restored.receipt,
        message:
          "The device-only version was restored. Review it, then choose Keep restored version.",
      })
      setDocumentMediaAdmissionRestoreUnavailable(false)
      return true
    } finally {
      releaseSessionTransition(transition)
    }
  }, [
    allowMutation,
    claimSessionTransition,
    discoverDocumentConflict,
    documentMediaAdmission,
    getDraftRepository,
    installDraftRecord,
    ownsSessionTransition,
    releaseSessionTransition,
    settlePersistenceSession,
  ])

  const downloadDocumentMediaAdmissionPreimage = useCallback(() => {
    const receipt = documentMediaAdmission?.receipt
    if (!receipt) return false
    return downloadEnvelope(receipt.preimage, "-device-only-version")
  }, [documentMediaAdmission, downloadEnvelope])

  const saveDocumentMediaAdmissionPreimageAsCopy = useCallback(async () => {
    const receipt = documentMediaAdmission?.receipt
    if (!receipt) return { ok: false as const }
    const now = new Date().toISOString()
    const newDocumentId = `document-${crypto.randomUUID()}`
    const preimage = receipt.preimage
    const created = await getDraftRepository().create(
      {
        document: {
          ...structuredClone(preimage.document),
          id: newDocumentId,
          name: `${preimage.document.name} device-only copy`,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        },
        sourceContext: structuredClone(preimage.sourceContext),
        ...(preimage.reviewJournal
          ? { reviewJournal: structuredClone(preimage.reviewJournal) }
          : {}),
        ...(preimage.quotationRefresh
          ? { quotationRefresh: structuredClone(preimage.quotationRefresh) }
          : {}),
      },
      { kind: "duplicate", sourceDocumentId: receipt.documentId }
    )
    if (!created.ok) {
      setDocumentError(
        "failure" in created
          ? created.failure.message
          : "Studio could not preserve the device-only version as a copy."
      )
      return { ok: false as const }
    }
    setDocumentError(
      `Saved “${created.record.envelope.document.name}” without changing the current document.`
    )
    return {
      ok: true as const,
      documentId: created.record.summary.documentId,
    }
  }, [documentMediaAdmission, getDraftRepository])

  const setSeparateDocumentTransition = useCallback((active: boolean) => {
    separateDocumentTransitionRef.current = active
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
        const result = commitCommandsWithResult(
          historyRef.current,
          drafts.map(commandFromDraft),
          options
        )
        if (!result) return false
        const next = result.history
        historyRef.current = next
        setHistory(next)
        pruneTemplateSourceContexts(next)
        notifyHistoryCommit(result.commit)
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
    [
      allowMutation,
      captureSettledDraft,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const commitImageReplacementRef = useRef(commit)
  commitImageReplacementRef.current = commit
  const readImageReplacementStateRef = useRef(readAssetMutationState)
  readImageReplacementStateRef.current = readAssetMutationState
  const [imageReplacementCoordinator] = useState(
    () =>
      new ImageReplacementCoordinator<RendererReplacementPayload>({
        validate: (replacement) => {
          const abortReason = getAssetMutationAbortReason(
            replacement.payload.anchor,
            readImageReplacementStateRef.current()
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
          return commitImageReplacementRef.current(
            [reusableImageReplacementCommand(node, replacement.payload.asset)],
            { label: replacement.payload.historyLabel }
          )
        },
        onPendingChange: publishPendingImageReplacement,
        onFailure: setAssetError,
        ...(imageReplacementTimeoutMs === undefined
          ? {}
          : { timeoutMs: imageReplacementTimeoutMs }),
      })
  )
  imageReplacementCoordinatorRef.current = imageReplacementCoordinator

  useEffect(
    () => () => {
      activeLibraryMediaActionRef.current?.controller.abort()
      activeLibraryMediaActionRef.current = null
      imageReplacementCoordinator.cancel()
    },
    [imageReplacementCoordinator]
  )

  const reportImageReplacementRendererState = useCallback(
    (event: ImageReplacementRendererEvent) =>
      imageReplacementCoordinatorRef.current?.report(event) ?? "stale",
    []
  )
  const registerImageReplacementRendererOwner = useCallback(
    (renderer: ImageReplacementRenderer) =>
      imageReplacementCoordinator.registerOwner(renderer),
    [imageReplacementCoordinator]
  )

  const settleImageCrop = useCallback(
    (decision: "apply" | "cancel") => {
      const session = imageCropController.currentSession
      if (!session) return true
      if (decision === "cancel") {
        cancelImageCropSession(session)
        imageCropController.close()
        return true
      }
      const result = applyImageCropSession(
        session,
        historyRef.current.document,
        activePageIdRef.current
      )
      if (result.status === "cancelled") {
        imageCropController.close()
        setDocumentError(
          "Crop was cancelled because the image changed somewhere else."
        )
        return false
      }
      if (result.status === "unchanged") {
        imageCropController.close()
        return true
      }
      const committed = commit(
        [...result.transaction.commands],
        { label: result.transaction.label },
        true
      )
      if (committed) {
        imageCropController.close()
      }
      return committed
    },
    [commit, imageCropController]
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
      const document = historyRef.current.document
      const instanceTransform = projectComponentInstanceCanvasTransform(
        document,
        changes
      )
      if (instanceTransform) {
        return commit(
          [
            {
              type: "update_component_instance_metadata",
              instanceId: instanceTransform.instanceId,
              patch: { transform: instanceTransform.transform },
            },
          ],
          canvasChangeHistoryOptions(changes, document.nodes)
        )
      }
      return commit(
        canvasNodeChangeCommands(document, changes),
        canvasChangeHistoryOptions(changes, document.nodes)
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
      if (imageCropController.currentSession?.target.nodeId === nodeId) {
        return imageCropController.preview(nodeId, { frameMask })
      }
      return commit([{ type: "set_image_frame_mask", nodeId, frameMask }], {
        label: "Change image frame",
      })
    },
    [commit, imageCropController]
  )

  const setImagePlacement = useCallback(
    (
      nodeId: string,
      placement: Extract<SceneNode, { type: "image" }>["placement"],
      label = "Change image placement"
    ) => {
      if (imageCropController.currentSession?.target.nodeId === nodeId) {
        return imageCropController.preview(nodeId, { placement })
      }
      return commit([{ type: "set_image_placement", nodeId, placement }], {
        label,
      })
    },
    [commit, imageCropController]
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

  const transformSelectionNodes = useCallback(
    (action: PositionTransformAction) => {
      const editableNodes = (selection?.nodeIds ?? [])
        .map((nodeId) => findNode(historyRef.current.document, nodeId))
        .filter((node): node is SceneNode => node !== undefined && !node.locked)
      if (!editableNodes.length) return false
      return commit(
        editableNodes.map((node) => ({
          type: "update_node" as const,
          nodeId: node.id,
          patch: positionTransformPatch(node, action),
        })),
        { label: positionTransformLabel(action) }
      )
    },
    [commit, selection]
  )

  const createTypographyStyle = useCallback(
    (style: Omit<TypographyStyle, "id">, targets: DesignStyleTarget[] = []) => {
      const id = `typography-style-${crypto.randomUUID()}`
      return commit(
        [
          { type: "create_typography_style", style: { ...style, id } },
          ...(targets.length
            ? ([
                { type: "apply_typography_style", styleId: id, targets },
              ] as const)
            : []),
        ],
        { label: `Create ${style.name}` }
      )
        ? id
        : null
    },
    [commit]
  )

  const updateTypographyStyle = useCallback(
    (styleId: string, patch: TypographyStylePatch) =>
      commit([{ type: "update_typography_style", styleId, patch }], {
        label: "Update text style",
      }),
    [commit]
  )

  const deleteTypographyStyle = useCallback(
    (styleId: string) =>
      commit([{ type: "delete_typography_style", styleId }], {
        label: "Delete text style",
      }),
    [commit]
  )

  const applyTypographyStyle = useCallback(
    (styleId: string, targets: DesignStyleTarget[]) =>
      commit([{ type: "apply_typography_style", styleId, targets }], {
        label: "Apply text style",
      }),
    [commit]
  )

  const detachTypographyStyle = useCallback(
    (targets: DesignStyleTarget[]) =>
      commit([{ type: "detach_typography_style", targets }], {
        label: "Detach text style",
      }),
    [commit]
  )

  const createPaintStyle = useCallback(
    (style: Omit<PaintStyle, "id">, targets: DesignStyleTarget[] = []) => {
      const id = `paint-style-${crypto.randomUUID()}`
      return commit(
        [
          { type: "create_paint_style", style: { ...style, id } },
          ...(targets.length
            ? ([{ type: "apply_paint_style", styleId: id, targets }] as const)
            : []),
        ],
        { label: `Create ${style.name}` }
      )
        ? id
        : null
    },
    [commit]
  )

  const updatePaintStyle = useCallback(
    (styleId: string, patch: PaintStylePatch) =>
      commit([{ type: "update_paint_style", styleId, patch }], {
        label: "Update paint style",
      }),
    [commit]
  )

  const deletePaintStyle = useCallback(
    (styleId: string) =>
      commit([{ type: "delete_paint_style", styleId }], {
        label: "Delete paint style",
      }),
    [commit]
  )

  const applyPaintStyle = useCallback(
    (styleId: string, targets: DesignStyleTarget[]) =>
      commit([{ type: "apply_paint_style", styleId, targets }], {
        label: "Apply paint style",
      }),
    [commit]
  )

  const detachPaintStyle = useCallback(
    (targets: DesignStyleTarget[]) =>
      commit([{ type: "detach_paint_style", targets }], {
        label: "Detach paint style",
      }),
    [commit]
  )

  const createVariable = useCallback(
    (variable: DesignVariable) =>
      commit([{ type: "create_variable", variable }], {
        label: `Create ${variable.name}`,
      }),
    [commit]
  )

  const updateVariable = useCallback(
    (variableId: string, patch: DesignVariablePatch) =>
      commit([{ type: "update_variable", variableId, patch }], {
        label: "Update variable",
      }),
    [commit]
  )

  const deleteVariable = useCallback(
    (variableId: string) =>
      commit([{ type: "delete_variable", variableId }], {
        label: "Delete variable",
      }),
    [commit]
  )

  const bindVariable = useCallback(
    (variableId: string, target: VariableBindingTarget) =>
      commit(
        [
          {
            type: "bind_variable",
            binding: {
              id: `variable-binding-${crypto.randomUUID()}`,
              variableId,
              target,
            },
          },
        ],
        { label: "Bind variable" }
      ),
    [commit]
  )

  const unbindVariable = useCallback(
    (bindingId: string) =>
      commit([{ type: "unbind_variable", bindingId }], {
        label: "Unbind variable",
      }),
    [commit]
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
      imageCropController.open(result.session)
      setDocumentError(null)
      return true
    },
    [allowMutation, imageCropController]
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
    (patch: Partial<Extract<SceneNode, { type: "image" }>["placement"]>) =>
      imageCropController.currentSession
        ? imageCropController.preview(
            imageCropController.currentSession.target.nodeId,
            { placement: patch }
          )
        : false,
    [imageCropController]
  )

  const previewImageCropFrame = useCallback(
    (preview: {
      nodeId: string
      frame: ImageCropSession["draftFrame"]
      placement: ImageCropSession["draft"]
      frameMask: ImageCropSession["draftFrameMask"]
    }) => {
      return imageCropController.preview(preview.nodeId, {
        frame: preview.frame,
        placement: preview.placement,
        frameMask: preview.frameMask,
      })
    },
    [imageCropController]
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
      const error = imageCropController.rejectUnavailable(nodeId)
      if (!error) return false
      setDocumentError(error)
      return true
    },
    [imageCropController]
  )

  const setEditorSelection = useCallback(
    (nextSelection: Selection | null) => {
      const cropTargetId = imageCropController.currentSession?.target.nodeId
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
    [imageCropController, settleImageCrop]
  )

  const setCanvasSelection = useCallback(
    (nextSelection: Selection | null) => {
      setEditorSelection(
        projectCanvasComponentSelection(
          historyRef.current.document,
          nextSelection
        )
      )
    },
    [setEditorSelection]
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
    (changeSetInput: ChangeSet, provenanceInput?: ReviewProposalProvenance) => {
      if (
        separateDocumentTransitionRef.current ||
        activeSessionTransitionRef.current
      ) {
        throw new Error(DOCUMENT_TRANSITION_DISABLED_REASON)
      }
      if (draftRecoveryRef.current) {
        throw new Error(
          "Resolve the unreadable local draft before proposing changes."
        )
      }
      if (pendingChangeSetRef.current) {
        throw new Error("Resolve or discard the pending change set first.")
      }
      if (imageCropController.hasActiveSession) settleImageCrop("cancel")
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
      const nextJournal = createReviewProposal(
        reviewJournalRef.current,
        historyRef.current.document,
        changeSet,
        provenanceInput
      )
      projectReviewJournal(nextJournal)
      setChangeSetError(null)
      setSelection(null)
      if (proposedPage?.type === "add_output_variant") {
        activePageIdRef.current = proposedPage.page.id
        setActivePageId(proposedPage.page.id)
      }
      captureSettledDraft()
      return changeSet
    },
    [
      captureSettledDraft,
      imageCropController,
      projectReviewJournal,
      settleImageCrop,
    ]
  )

  const decideOperation = useCallback(
    (operationId: string, status: ChangeOperation["status"]) => {
      const nextJournal = updateReviewOperationDecision(
        reviewJournalRef.current,
        operationId,
        status
      )
      projectReviewJournal(nextJournal)
      setChangeSetError(null)
      captureSettledDraft()
    },
    [captureSettledDraft, projectReviewJournal]
  )

  const decideAllOperations = useCallback(
    (status: Exclude<ChangeOperation["status"], "pending">) => {
      const nextJournal = updateAllReviewOperationDecisions(
        reviewJournalRef.current,
        status
      )
      projectReviewJournal(nextJournal)
      setChangeSetError(null)
      captureSettledDraft()
    },
    [captureSettledDraft, projectReviewJournal]
  )

  const discardChangeSet = useCallback(() => {
    const current = pendingChangeSetRef.current
    if (!current) return
    const nextJournal = resolveDiscardedReview(reviewJournalRef.current, {
      resolvedAt: new Date().toISOString(),
      resultRevision: historyRef.current.document.revision,
      resultSnapshotId: historyRef.current.snapshotId,
    })
    projectReviewJournal(nextJournal)
    setChangeSetError(null)
    if (
      !historyRef.current.document.pages.some(
        (page) => page.id === activePageId
      )
    ) {
      setActivePageId(historyRef.current.document.pages[0].id)
    }
    captureSettledDraft()
  }, [activePageId, captureSettledDraft, projectReviewJournal])

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
      const result = commitCommandsWithResult(historyRef.current, commands, {
        label: current.title,
      })
      if (!result) return
      const next = result.history
      historyRef.current = next
      setHistory(next)
      pruneTemplateSourceContexts(next)
      notifyHistoryCommit(result.commit)
      const nextJournal = resolveAppliedReview(reviewJournalRef.current, {
        resolvedAt: new Date().toISOString(),
        resultRevision: next.document.revision,
        resultSnapshotId: next.snapshotId,
      })
      projectReviewJournal(nextJournal)
      captureSettledDraft()
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
  }, [
    captureSettledDraft,
    notifyHistoryCommit,
    projectReviewJournal,
    pruneTemplateSourceContexts,
  ])

  const publishTemplate = useCallback(
    (
      expected?: Readonly<{
        documentId: string
        revision: number
        snapshotId: string
      }>,
      options?: Readonly<{ signal?: AbortSignal }>
    ) => {
      let outputAdmissionLease: ImageReplacementOutputAdmissionLease
      const requireOutputAdmission = () => {
        const admission = getImageReplacementOutputAdmission()
        if (!admission.admitted) setPublishError(admission.disabledReason)
        assertImageReplacementOutputAdmission(admission, outputAdmissionLease)
      }
      try {
        outputAdmissionLease = captureImageReplacementOutputAdmissionLease()
      } catch (error) {
        return Promise.reject(error)
      }
      const active = publicationOperationRef.current
      if (active) {
        if (
          expected &&
          (!active.expected ||
            active.expected.documentId !== expected.documentId ||
            active.expected.revision !== expected.revision ||
            active.expected.snapshotId !== expected.snapshotId)
        ) {
          return Promise.reject(
            new Error(
              "Another publication owns a different document snapshot. Wait for it to finish, then inspect and publish again."
            )
          )
        }
        return options?.signal
          ? waitForPublicationStep(active.promise, options.signal)
          : active.promise
      }

      options?.signal?.throwIfAborted()
      const publicationController = new AbortController()
      const abortFromExternalSignal = () =>
        publicationController.abort(
          options?.signal?.reason ??
            new DOMException(
              "Publication caller stopped waiting.",
              "AbortError"
            )
        )
      options?.signal?.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      })
      const operation: PublicationOperation = {
        id: crypto.randomUUID(),
        documentId: historyRef.current.document.id,
        sessionGeneration: sessionGenerationRef.current,
        sourceSnapshotId: null,
        expected: expected ? { ...expected } : null,
        controller: publicationController,
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        timedOut: false,
        serverCommitted: false,
        promise: null as unknown as Promise<TemplateVersion>,
      }
      const ownsOperation = () => publicationOperationRef.current === operation
      const ownsPresentation = () =>
        ownsOperation() &&
        mountedRef.current &&
        historyRef.current.document.id === operation.documentId &&
        sessionGenerationRef.current === operation.sessionGeneration
      const ownsSourcePresentation = () =>
        ownsPresentation() &&
        (operation.sourceSnapshotId === null ||
          documentSnapshotIdRef.current === operation.sourceSnapshotId)
      const reserveRepositoryStep = <T>(step: () => Promise<T>) => {
        const predecessor = publicationRepositoryTailRef.current
        const pending = predecessor.then(() => {
          requireOutputAdmission()
          publicationController.signal.throwIfAborted()
          return step()
        })
        publicationRepositoryTailRef.current = pending.then(
          () => undefined,
          () => undefined
        )
        return waitForPublicationStep(pending, publicationController.signal)
      }

      const run = async () => {
        publicationController.signal.throwIfAborted()
        requireOutputAdmission()
        if (separateDocumentTransitionRef.current) {
          setPublishError(DOCUMENT_TRANSITION_DISABLED_REASON)
          throw new Error(DOCUMENT_TRANSITION_DISABLED_REASON)
        }
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
        if (imageCropController.hasActiveSession) {
          const message =
            "Finish or cancel the active image crop before publishing."
          setPublishError(message)
          throw new Error(message)
        }
        if (!(await flushActiveDraft(publicationController.signal))) {
          const message =
            "Studio could not durably save the current document before publishing."
          setPublishError(message)
          throw new Error(message)
        }
        requireOutputAdmission()
        publicationController.signal.throwIfAborted()
        const controller =
          activePersistenceSessionRef.current?.controller ?? null
        if (!controller) {
          const message =
            "Publishing requires durable browser document storage. Download your version and restore storage access before publishing."
          setPublishError(message)
          throw new Error(message)
        }
        const document = structuredClone(historyRef.current.document)
        const approvedSnapshotId = historyRef.current.snapshotId
        const sourceSnapshotId = await deriveDocumentSnapshotId(document)
        operation.sourceSnapshotId = sourceSnapshotId
        requireOutputAdmission()
        publicationController.signal.throwIfAborted()
        if (
          expected &&
          (document.id !== expected.documentId ||
            document.revision !== expected.revision ||
            approvedSnapshotId !== expected.snapshotId)
        ) {
          throw new Error(
            "The document changed after publication approval. Inspect the current snapshot and publish again."
          )
        }
        const draftRepository = getDraftRepository()
        const durableRead = await reserveRepositoryStep(() =>
          draftRepository.get(document.id)
        )
        requireOutputAdmission()
        publicationController.signal.throwIfAborted()
        if (!durableRead.ok || durableRead.status !== "found") {
          const message = !durableRead.ok
            ? durableRead.failure.message
            : "The saved document disappeared before publication could begin."
          setPublishError(message)
          throw new Error(message)
        }
        const durableHead = durableRead.record
        const templateId = `template-${document.id}`
        const remoteLatest = await readLatestPublishedVersion(
          templateId,
          publicationController.signal
        )
        requireOutputAdmission()
        const withoutCurrentStream = publishedVersionsRef.current.filter(
          (version) =>
            version.templateId !== templateId ||
            version.document.id !== document.id
        )
        const authoritativeHistory = remoteLatest
          ? replaceAuthoritativePublishedVersions(withoutCurrentStream, [
              remoteLatest,
            ])
          : withoutCurrentStream
        installPublishedVersions(authoritativeHistory)
        const existing = publishedVersionsForDocument(
          authoritativeHistory,
          templateId,
          document.id
        ).sort((a, b) => b.version - a.version)
        const latest = existing.at(0)
        if (
          durableHead.summary.documentId !== document.id ||
          durableHead.summary.recordVersion !== controller.recordVersion ||
          durableHead.summary.contentSnapshotId !==
            controller.contentSnapshotId ||
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
          const linked = await reserveRepositoryStep(() =>
            draftRepository.linkPublication({
              documentId: durableHead.summary.documentId,
              recordVersion: durableHead.summary.recordVersion,
              contentSnapshotId: durableHead.summary.contentSnapshotId,
              templateId: authoritative.templateId,
              templateVersionId: authoritative.id,
              templateVersion: authoritative.version,
              publishedAt: authoritative.publishedAt,
            })
          )
          requireOutputAdmission()
          if (linked.ok) {
            const currentRecord = activeRecordRef.current
            if (
              currentRecord?.summary.documentId === linked.summary.documentId &&
              currentRecord.summary.recordVersion ===
                linked.summary.recordVersion &&
              currentRecord.summary.contentSnapshotId ===
                linked.summary.contentSnapshotId
            ) {
              const nextRecord = { ...currentRecord, summary: linked.summary }
              activeRecordRef.current = nextRecord
            }
            return
          }
          if (linked.reason === "stale_head") {
            if (ownsPresentation()) {
              setDocumentError(
                "Publication succeeded, and newer local edits remain unpublished."
              )
            }
            return
          }
          const message =
            "failure" in linked
              ? linked.failure.message
              : linked.reason === "deleted"
                ? "Publication succeeded, but the local draft was deleted before it could be linked."
                : "Publication succeeded, but its local draft link could not be recorded."
          if (ownsPresentation()) setDocumentError(message)
        }
        const contentMatch = existing.find(
          (version) => version.sourceSnapshotId === sourceSnapshotId
        )
        if (contentMatch) {
          let authoritative = contentMatch
          const synchronized: TemplateVersion[] = []
          for (const version of [...existing].sort(
            (a, b) => a.version - b.version
          )) {
            requireOutputAdmission()
            const synced = await syncPublishedVersion(
              version,
              publicationController.signal,
              requireOutputAdmission
            )
            requireOutputAdmission()
            synchronized.push(synced)
            if (version.id === contentMatch.id) authoritative = synced
          }
          const next = replaceAuthoritativePublishedVersions(
            publishedVersionsRef.current,
            synchronized
          )
          operation.serverCommitted = true
          installPublishedVersions(next)
          for (const version of [...existing, ...synchronized]) {
            attemptedVersionSyncRef.current.add(version.id)
          }
          await linkAuthoritativePublication(authoritative)
          if (ownsSourcePresentation()) {
            setPublishSyncStatus("synced")
            setPublishError(null)
          } else if (ownsPresentation()) {
            setPublishSyncStatus("idle")
          }
          return authoritative
        }
        const version = createTemplateVersion(document, {
          id: `template-version-${crypto.randomUUID()}`,
          templateId,
          version: (latest?.version ?? 0) + 1,
          sourceSnapshotId,
          publishedAt: new Date().toISOString(),
        })
        let authoritative = version
        const synchronized: TemplateVersion[] = []
        for (const candidate of [...existing, version].sort(
          (a, b) => a.version - b.version
        )) {
          requireOutputAdmission()
          const synced = await syncPublishedVersion(
            candidate,
            publicationController.signal,
            requireOutputAdmission
          )
          requireOutputAdmission()
          synchronized.push(synced)
          if (candidate.id === version.id) authoritative = synced
        }
        const next = replaceAuthoritativePublishedVersions(
          publishedVersionsRef.current,
          synchronized
        )
        operation.serverCommitted = true
        installPublishedVersions(next)
        for (const candidate of [...existing, ...synchronized]) {
          attemptedVersionSyncRef.current.add(candidate.id)
        }
        await linkAuthoritativePublication(authoritative)
        if (ownsSourcePresentation()) {
          setPublishSyncStatus("synced")
          setPublishError(null)
        } else if (ownsPresentation()) {
          setPublishSyncStatus("idle")
        }
        return authoritative
      }

      operation.timer = setTimeout(() => {
        if (!ownsOperation()) return
        operation.timedOut = true
        if (ownsPresentation()) setPublishSyncStatus("cancelling")
        publicationController.abort(
          new DOMException(
            "Publishing took too long. Studio is checking that the request has stopped before Retry becomes available.",
            "TimeoutError"
          )
        )
      }, PUBLICATION_TIMEOUT_MS)
      const promise = Promise.resolve()
        .then(run)
        .catch((error: unknown) => {
          if (ownsSourcePresentation()) {
            const caughtMessage =
              error &&
              typeof error === "object" &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : null
            const stoppedWaiting = publicationController.signal.aborted
            const message = stoppedWaiting
              ? operation.serverCommitted
                ? "Studio stopped waiting after the server accepted the immutable snapshot. The local publication status is unknown; Retry checks the same snapshot before creating anything new."
                : "Studio stopped waiting before publication was confirmed. Server status is unknown; Retry checks the same immutable snapshot before creating anything new."
              : (caughtMessage ?? "Publishing failed.")
            setPublishError(message)
            setPublishSyncStatus(stoppedWaiting ? "status_unknown" : "error")
          } else if (ownsPresentation()) {
            setPublishSyncStatus("idle")
          }
          throw error
        })
        .finally(() => {
          clearTimeout(operation.timer)
          options?.signal?.removeEventListener("abort", abortFromExternalSignal)
          if (ownsOperation()) publicationOperationRef.current = null
        })
      operation.promise = promise
      publicationOperationRef.current = operation
      setPublishError(null)
      setPublishSyncStatus("syncing")
      return promise
    },
    [
      flushActiveDraft,
      captureImageReplacementOutputAdmissionLease,
      getDraftRepository,
      getImageReplacementOutputAdmission,
      imageCropController,
      installPublishedVersions,
    ]
  )

  const cancelPublication = useCallback(() => {
    const operation = publicationOperationRef.current
    if (!operation || operation.controller.signal.aborted) return false
    if (
      mountedRef.current &&
      historyRef.current.document.id === operation.documentId
    ) {
      setPublishSyncStatus("cancelling")
    }
    operation.controller.abort(
      new DOMException(
        "Studio stopped waiting for publication status.",
        "AbortError"
      )
    )
    return true
  }, [])

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

  const performLibraryMediaAction = useCallback(
    async (
      request: LibraryMediaActionPreparationRequest,
      options: PerformLibraryMediaActionOptions = {}
    ): Promise<PerformLibraryMediaActionOutcome> => {
      if (!allowMutation()) return "rejected" as const
      if (
        assetMutationActiveRef.current ||
        activeLibraryMediaActionRef.current
      ) {
        setAssetError(
          "Another image is still being prepared. Wait, then retry."
        )
        return "rejected" as const
      }
      if (options.signal?.aborted) return "rejected" as const

      const controller = new AbortController()
      const active = {
        correlationId: request.correlationId,
        controller,
      }
      const actionDocumentId = historyRef.current.document.id
      activeLibraryMediaActionRef.current = active
      assetMutationActiveRef.current = true
      setIsImportingAsset(true)
      setAssetError(null)
      const abortActiveReplacement = () => {
        controller.abort()
        imageReplacementCoordinator.cancel()
      }
      options.signal?.addEventListener("abort", abortActiveReplacement, {
        once: true,
      })

      let mutationLifetimeReleased = false
      const releaseMutationLifetime = () => {
        if (mutationLifetimeReleased) return
        mutationLifetimeReleased = true
        options.signal?.removeEventListener("abort", abortActiveReplacement)
        if (activeLibraryMediaActionRef.current === active) {
          activeLibraryMediaActionRef.current = null
          assetMutationActiveRef.current = false
          setIsImportingAsset(false)
        }
      }

      const localPreviewState: {
        url: string | null
        installed: boolean
      } = { url: null, installed: false }
      try {
        controller.signal.throwIfAborted()
        const prepared = await prepareExactLibraryMediaAction(
          request,
          libraryMediaPreparationPorts,
          controller.signal
        )
        controller.signal.throwIfAborted()
        const anchor = captureLibraryMediaActionAnchor(
          prepared,
          readAssetMutationState()
        )
        let committed = false
        let insertedNodeId: string | null = null

        if (prepared.target.type === "replace") {
          if (anchor.kind !== "replace") return "rejected" as const
          const currentState = readAssetMutationState()
          const replacementCommand = commandForPreparedLibraryMediaAction(
            prepared,
            anchor,
            currentState,
            () => "unused-image-node-id"
          ).command
          if (libraryMediaCommandIsNoOp(replacementCommand, currentState)) {
            return "no_op" as const
          }
          let previewSrc: string
          if (prepared.source === "curated") {
            previewSrc = prepared.rendererPreviewSource
          } else if (prepared.source === "managed") {
            previewSrc = managedMediaContentUrl(prepared.asset.assetId)
          } else {
            localPreviewState.url = URL.createObjectURL(prepared.previewBlob)
            previewSrc = localPreviewState.url
          }
          const mutableAdmission =
            prepared.source === "curated"
              ? undefined
              : async (signal: AbortSignal) => {
                  const admitted = await prepareExactLibraryMediaAction(
                    request,
                    libraryMediaPreparationPorts,
                    signal
                  )
                  signal.throwIfAborted()
                  const admissionReason = libraryMediaFinalAdmissionError(
                    prepared,
                    admitted
                  )
                  if (admissionReason) return admissionReason
                  const reason = libraryMediaActionAnchorError(
                    anchor,
                    readAssetMutationState()
                  )
                  return reason
                }
          committed = await imageReplacementCoordinator.start({
            token: `image-replacement-${prepared.correlationId}`,
            documentId: anchor.assetAnchor.documentId,
            pageId: anchor.assetAnchor.pageId,
            nodeId: prepared.target.nodeId,
            previewSrc,
            naturalSize: {
              width: prepared.asset.width,
              height: prepared.asset.height,
            },
            payload: {
              anchor: anchor.assetAnchor,
              asset: prepared.asset,
              historyLabel: options.historyLabel ?? "Replace image",
            },
            commitAdmission: () =>
              options.admitCommit?.() === false
                ? "The editor canvas changed before the image was ready. The original image was kept."
                : null,
            ...(mutableAdmission ? { finalAdmission: mutableAdmission } : {}),
          })
        } else {
          controller.signal.throwIfAborted()
          const anchorReason = libraryMediaActionAnchorError(
            anchor,
            readAssetMutationState()
          )
          if (anchorReason) {
            setAssetError(anchorReason)
            return "rejected"
          }
          const preparedCommand = commandForPreparedLibraryMediaAction(
            prepared,
            anchor,
            readAssetMutationState(),
            () => `image-${crypto.randomUUID()}`
          )
          if (
            libraryMediaCommandIsNoOp(
              preparedCommand.command,
              readAssetMutationState()
            )
          ) {
            return "no_op" as const
          }
          controller.signal.throwIfAborted()
          if (options.admitCommit?.() === false) return "rejected" as const
          committed = commit([preparedCommand.command], {
            label:
              prepared.target.type === "insert"
                ? "Add image"
                : "Assign image field",
          })
          insertedNodeId = preparedCommand.insertedNodeId
        }

        if (!committed) return "rejected" as const
        if (prepared.source === "local") {
          const installLocalPreview = async () => {
            if (
              !mountedRef.current ||
              historyRef.current.document.id !== actionDocumentId
            ) {
              return false
            }
            try {
              const previewUrl =
                localPreviewState.url ??
                URL.createObjectURL(prepared.previewBlob)
              localPreviewState.url = previewUrl
              const previousUrl = assetUrlsRef.current.get(
                prepared.asset.assetId
              )
              assetUrlsRef.current.set(prepared.asset.assetId, previewUrl)
              localPreviewState.installed = true
              if (previousUrl && previousUrl !== previewUrl) {
                URL.revokeObjectURL(previousUrl)
              }
              setAssetVersion((current) => current + 1)
              return true
            } catch {
              if (localPreviewState.url && !localPreviewState.installed) {
                try {
                  URL.revokeObjectURL(localPreviewState.url)
                } catch {
                  // The preview never became canonical; retry creates a new URL.
                }
                localPreviewState.url = null
              }
              return false
            }
          }
          if (!(await installLocalPreview())) {
            const warning: LibraryMediaUsageWarning = {
              key: "local_preview",
              message:
                "The image change was saved, but its device preview could not open. Retry the preview without repeating the edit.",
              retry: installLocalPreview,
            }
            setAssetError(warning.message)
            options.onUsageWarning?.(warning)
          }
        }
        if (insertedNodeId && prepared.target.type === "insert") {
          setSelection({
            pageId: prepared.target.pageId,
            nodeIds: [insertedNodeId],
          })
        }
        releaseMutationLifetime()
        await runLibraryMediaPostCommitUsage(prepared, prepared.correlationId, {
          recordUsed: options.recordUsed,
          markManagedUsed: (assetId, idempotencyKey) =>
            markManagedMediaUsed(assetId, { idempotencyKey }),
          markLocalUsed: (assetId) => markLocalAssetUsed(assetId),
          refreshLocal: options.refreshLocal,
          onWarning: (warning) => {
            if (
              mountedRef.current &&
              historyRef.current.document.id === actionDocumentId
            ) {
              setAssetError(warning.message)
            }
            options.onUsageWarning?.(warning)
          },
        })
        return "committed" as const
      } catch (error) {
        if (controller.signal.aborted) return "rejected" as const
        setAssetError(
          error instanceof Error
            ? error.message
            : "The selected image could not be applied. Retry in the current design."
        )
        return "rejected" as const
      } finally {
        const unusedPreviewUrl = localPreviewState.installed
          ? null
          : localPreviewState.url
        if (unusedPreviewUrl) {
          try {
            URL.revokeObjectURL(unusedPreviewUrl)
          } catch {
            // This URL was never installed as canonical preview state.
          }
        }
        releaseMutationLifetime()
      }
    },
    [
      allowMutation,
      commit,
      imageReplacementCoordinator,
      libraryMediaPreparationPorts,
      readAssetMutationState,
    ]
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

  const startLocalAssetPromotion = useCallback(
    async (localAssetId: string) => {
      if (activeLocalAssetPromotionRef.current?.blocksPromotionStart) {
        return false
      }
      if (!allowMutation()) return false
      const session = activePersistenceSessionRef.current
      if (!session || sessionModeRef.current !== "workspace") {
        setAssetError(
          "Save this document in Studio before making its images available everywhere."
        )
        return false
      }
      if (!captureSettledDraft()) return false
      const generation = sessionGenerationRef.current
      const sourceDocument = historyRef.current.document
      const sourceHistorySnapshotId = historyRef.current.snapshotId
      const sourceOperationVersion = historyRef.current.operationVersion
      const source = localAssetSource(localAssetId)
      const sourceReferenceKeys = assetReferenceKeysForSource(
        sourceDocument,
        source
      )
      const reservationKey = `${generation}\0${sourceDocument.id}\0${localAssetId}`
      const reservationToken =
        localAssetPromotionStartGateRef.current.reserve(reservationKey)
      if (!reservationToken) return false
      const reservationSignal = localAssetPromotionStartGateRef.current.signal(
        reservationKey,
        reservationToken
      )
      if (!reservationSignal) return false
      localAssetPromotionReservationRef.current = {
        key: reservationKey,
        token: reservationToken,
        localAssetId,
        documentId: sourceDocument.id,
        session,
        sessionGeneration: generation,
        cancel: () =>
          localAssetPromotionStartGateRef.current.cancel(
            reservationKey,
            reservationToken
          ),
      }
      const ownsReservation = () =>
        !reservationSignal.aborted &&
        mountedRef.current &&
        localAssetPromotionReservationRef.current?.token === reservationToken &&
        localAssetPromotionStartGateRef.current.owns(
          reservationKey,
          reservationToken
        ) &&
        activePersistenceSessionRef.current === session &&
        sessionGenerationRef.current === generation &&
        historyRef.current.document.id === sourceDocument.id
      const reservationStillInstalled = () =>
        localAssetPromotionReservationRef.current?.token === reservationToken
      const reservationDisposition = { preserve: false }
      const failReservation = (
        message: string,
        retryable = true,
        options: {
          phase?: LocalAssetPromotionViewState["phase"]
          expectedReferenceKeys?: readonly string[]
          managedAssetId?: string | null
        } = {}
      ) => {
        if (!ownsReservation()) return false
        reservationDisposition.preserve = true
        setAssetError(message)
        setLocalAssetPromotions((current) => ({
          ...current,
          [localAssetId]: {
            operationId: reservationToken,
            localAssetId,
            sourceDocumentId: sourceDocument.id,
            expectedReferenceKeys:
              options.expectedReferenceKeys ?? sourceReferenceKeys,
            managedAssetId: options.managedAssetId ?? null,
            relinkCommitId: null,
            phase: options.phase ?? "failed",
            loaded: null,
            total: null,
            message,
            retryable,
            undoable: null,
          },
        }))
        return false
      }
      setLocalAssetPromotions((current) => ({
        ...current,
        [localAssetId]: {
          operationId: reservationToken,
          localAssetId,
          sourceDocumentId: sourceDocument.id,
          expectedReferenceKeys: sourceReferenceKeys,
          managedAssetId: null,
          relinkCommitId: null,
          phase: "preparing",
          loaded: null,
          total: null,
          message: null,
          retryable: false,
          undoable: null,
        },
      }))
      try {
        const previous = await readLocalAssetPromotionJournal(
          localAssetId,
          reservationSignal
        )
        if (!ownsReservation()) return false
        if (previous.status === "corrupt") {
          return failReservation(
            "Saved image backup progress is unreadable. Keep the local image and contact support before retrying.",
            false
          )
        }
        const previousJournal =
          previous.status === "ready" ? previous.journal : null
        const hasUnpersistedRelinkResult =
          previousJournal?.state === "relinking" &&
          previousJournal.relinkResultKind !== null &&
          previousJournal.relinkResultDraftSnapshotId === null &&
          previousJournal.recentUseUsedAt === null
        const deferRelinkRetryUntilCritical =
          hasUnpersistedRelinkResult &&
          session.controller.state.status === "failed"
        const initialFlush = deferRelinkRetryUntilCritical
          ? {
              ok: true as const,
              receipt: {
                documentId: previousJournal.sourceDocumentId,
                recordVersion: previousJournal.sourceDraftRecordVersion,
                contentSnapshotId: previousJournal.sourceContentSnapshotId,
                draftSnapshotId: previousJournal.sourceDraftSnapshotId,
                savedAt: previousJournal.updatedAt,
              },
            }
          : await session.controller.flushWithReceipt()
        if (!ownsReservation()) return false
        if (!initialFlush.ok) {
          return failReservation(
            "Finish saving this document, then retry the image backup."
          )
        }
        const verifiedJournal =
          previousJournal &&
          (previousJournal.state === "mapped" ||
            previousJournal.state === "relinking" ||
            previousJournal.state === "marking_used" ||
            previousJournal.state === "complete") &&
          previousJournal.managedAssetId !== null
            ? previousJournal
            : null
        const verifiedManagedAssetId = verifiedJournal?.managedAssetId ?? null
        const hasVerifiedMapping = verifiedManagedAssetId !== null
        const canRecoverTargetOnly =
          verifiedJournal !== null &&
          verifiedManagedAssetId !== null &&
          hasExactManagedProjection(
            sourceDocument,
            verifiedManagedAssetId,
            verifiedJournal.expectedReferenceKeys
          )
        const expectedReferenceKeys = sourceReferenceKeys.length
          ? sourceReferenceKeys
          : canRecoverTargetOnly
            ? verifiedJournal.expectedReferenceKeys
            : verifiedJournal &&
                verifiedJournal.sourceDocumentId === sourceDocument.id
              ? verifiedJournal.expectedReferenceKeys
              : []
        if (!expectedReferenceKeys.length) {
          return failReservation(
            "This image is not used by the open document.",
            false
          )
        }
        const localRecord = await getLocalAssetRecord(
          localAssetId,
          reservationSignal
        )
        if (!ownsReservation()) return false
        if (!localRecord && !hasVerifiedMapping) {
          return failReservation(
            "The image bytes are missing on this device. Locate a replacement first.",
            false
          )
        }
        const sourceLocalAssetRevision =
          localRecord?.revision ??
          previousJournal?.sourceLocalAssetRevision ??
          null
        if (sourceLocalAssetRevision === null) {
          return failReservation(
            "Studio could not verify this device-only image.",
            false
          )
        }
        const sourceContentSnapshotId =
          await deriveDocumentSnapshotId(sourceDocument)
        if (!ownsReservation()) return false
        if (
          !mountedRef.current ||
          activePersistenceSessionRef.current !== session ||
          sessionGenerationRef.current !== generation ||
          historyRef.current.document !== sourceDocument ||
          historyRef.current.snapshotId !== sourceHistorySnapshotId ||
          historyRef.current.operationVersion !== sourceOperationVersion ||
          session.controller.recordVersion !==
            initialFlush.receipt.recordVersion ||
          session.controller.draftSnapshotId !==
            initialFlush.receipt.draftSnapshotId ||
          (!deferRelinkRetryUntilCritical &&
            session.controller.contentSnapshotId !== sourceContentSnapshotId)
        ) {
          return failReservation(
            "The document changed while Studio prepared the image. Retry from its current version."
          )
        }

        if (
          verifiedJournal &&
          verifiedJournal.sourceDocumentId === sourceDocument.id &&
          sourceReferenceKeys.length === 0 &&
          !canRecoverTargetOnly
        ) {
          await checkpointReleasedLocalAssetPromotionConflict(
            {
              localAssetId,
              expectedRevision: verifiedJournal.revision,
            },
            reservationSignal
          )
          if (!ownsReservation()) return false
          return failReservation(
            "Backed up, relink not applied. The managed image references no longer match this document.",
            false,
            {
              phase: "conflict",
              expectedReferenceKeys,
              managedAssetId: verifiedManagedAssetId,
            }
          )
        }

        const checkpointedRelinkResult =
          previousJournal?.state === "relinking" &&
          previousJournal.relinkResultKind !== null &&
          previousJournal.relinkResultDraftSnapshotId === null &&
          previousJournal.recentUseUsedAt === null
        const originalCommitInPast = Boolean(
          previousJournal?.relinkCommitId &&
          historyRef.current.past.some(
            (entry) => entry.id === previousJournal.relinkCommitId
          )
        )
        const currentMatchesCheckpointedResult = Boolean(
          checkpointedRelinkResult &&
          previousJournal.relinkResultContentSnapshotId ===
            sourceContentSnapshotId &&
          previousJournal.relinkResultHistorySnapshotId ===
            sourceHistorySnapshotId &&
          previousJournal.relinkResultOperationVersion ===
            sourceOperationVersion &&
          originalCommitInPast
        )
        const exactCurrentSource = sameReferenceKeys(
          sourceReferenceKeys,
          expectedReferenceKeys
        )
        const supersedeUnpersistedRelinkRevision =
          checkpointedRelinkResult &&
          previousJournal.sourceDocumentId === sourceDocument.id &&
          (exactCurrentSource ||
            (canRecoverTargetOnly && !currentMatchesCheckpointedResult))
            ? previousJournal.revision
            : undefined
        const resumeCheckpointedTarget =
          canRecoverTargetOnly &&
          supersedeUnpersistedRelinkRevision === undefined &&
          ((verifiedJournal.state === "relinking" &&
            verifiedJournal.relinkResultKind !== null) ||
            verifiedJournal.state === "marking_used" ||
            verifiedJournal.state === "complete")
        const resumeJournal = resumeCheckpointedTarget ? verifiedJournal : null

        const sameAnchor =
          previousJournal !== null &&
          previousJournal.sourceDocumentId === sourceDocument.id &&
          previousJournal.sourceContentSnapshotId === sourceContentSnapshotId &&
          previousJournal.sourceHistorySnapshotId === sourceHistorySnapshotId &&
          previousJournal.sourceOperationVersion === sourceOperationVersion &&
          previousJournal.sourceDraftRecordVersion ===
            initialFlush.receipt.recordVersion &&
          previousJournal.sourceDraftSnapshotId ===
            initialFlush.receipt.draftSnapshotId &&
          previousJournal.sourceLocalAssetRevision ===
            sourceLocalAssetRevision &&
          sameReferenceKeys(
            previousJournal.expectedReferenceKeys,
            expectedReferenceKeys
          )
        const supersedeCompletedRevision =
          previousJournal && !sameAnchor && previousJournal.state === "complete"
            ? previousJournal.revision
            : undefined
        const supersedeUnrelinkedRevision =
          previousJournal &&
          !sameAnchor &&
          (previousJournal.state === "mapped" ||
            (previousJournal.state === "relinking" &&
              previousJournal.relinkResultKind === null))
            ? previousJournal.revision
            : undefined

        let promotionManagedAssetId = verifiedManagedAssetId
        let mountedOperationId: string | null = null
        let criticalSettlementResolved = false
        let resolveCriticalSettlement!: () => void
        const criticalSettlement = new Promise<void>((resolve) => {
          resolveCriticalSettlement = resolve
        })
        const finishCriticalSettlement = () => {
          if (criticalSettlementResolved) return
          criticalSettlementResolved = true
          resolveCriticalSettlement()
        }
        const operation = startActiveLocalAssetPromotion(
          {
            localAssetId,
            sourceDocumentId: resumeJournal
              ? resumeJournal.sourceDocumentId
              : sourceDocument.id,
            sourceContentSnapshotId: resumeJournal
              ? resumeJournal.sourceContentSnapshotId
              : sourceContentSnapshotId,
            sourceHistorySnapshotId: resumeJournal
              ? resumeJournal.sourceHistorySnapshotId
              : sourceHistorySnapshotId,
            sourceOperationVersion: resumeJournal
              ? resumeJournal.sourceOperationVersion
              : sourceOperationVersion,
            sourceDraftRecordVersion: resumeJournal
              ? resumeJournal.sourceDraftRecordVersion
              : initialFlush.receipt.recordVersion,
            sourceDraftSnapshotId: resumeJournal
              ? resumeJournal.sourceDraftSnapshotId
              : initialFlush.receipt.draftSnapshotId,
            sourceLocalAssetRevision: resumeJournal
              ? resumeJournal.sourceLocalAssetRevision
              : sourceLocalAssetRevision,
            expectedReferenceKeys: resumeJournal
              ? resumeJournal.expectedReferenceKeys
              : expectedReferenceKeys,
            ...(supersedeCompletedRevision === undefined
              ? {}
              : { supersedeCompletedRevision }),
            ...(supersedeUnrelinkedRevision === undefined
              ? {}
              : { supersedeUnrelinkedRevision }),
            ...(supersedeUnpersistedRelinkRevision === undefined
              ? {}
              : { supersedeUnpersistedRelinkRevision }),
          },
          {
            onProgress: (progress) => {
              const active = activeLocalAssetPromotionRef.current
              if (
                !mountedRef.current ||
                !active ||
                active.operationId !== mountedOperationId ||
                active.localAssetId !== localAssetId ||
                active.session !== session ||
                active.sessionGeneration !== generation ||
                active.documentId !== sourceDocument.id ||
                activePersistenceSessionRef.current !== session ||
                sessionGenerationRef.current !== generation ||
                historyRef.current.document.id !== sourceDocument.id
              )
                return
              if (progress.phase === "saving") {
                activeLocalAssetPromotionRef.current = {
                  ...active,
                  critical: true,
                  blocksPromotionStart: true,
                }
              } else if (progress.phase === "updating_recent") {
                finishCriticalSettlement()
                activeLocalAssetPromotionRef.current = {
                  ...active,
                  critical: false,
                  blocksPromotionStart: false,
                }
              }
              setLocalAssetPromotions((current) => ({
                ...current,
                [localAssetId]: {
                  ...progress,
                  operationId: active.operationId,
                  sourceDocumentId: sourceDocument.id,
                  expectedReferenceKeys,
                  managedAssetId: promotionManagedAssetId,
                  relinkCommitId: null,
                },
              }))
            },
            dependencies: {
              mayPublish: (operationId) => {
                const active = activeLocalAssetPromotionRef.current
                return (
                  mountedRef.current &&
                  active?.operationId === operationId &&
                  active.session === session &&
                  active.sessionGeneration === generation &&
                  active.documentId === sourceDocument.id &&
                  activePersistenceSessionRef.current === session &&
                  sessionGenerationRef.current === generation &&
                  historyRef.current.document.id === sourceDocument.id
                )
              },
              applyOrRecognizeRelink: async (
                journal,
                signal,
                enterCritical,
                reassertOwned
              ): Promise<ActiveRelinkResult | null> => {
                promotionManagedAssetId = journal.managedAssetId
                const relinkContextIsCurrent = () =>
                  mountedRef.current &&
                  activePersistenceSessionRef.current === session &&
                  sessionGenerationRef.current === generation &&
                  sessionModeRef.current === "workspace" &&
                  !activeSessionTransitionRef.current &&
                  conflictRecoveryStateRef.current.status === "inactive" &&
                  !draftRecoveryRef.current &&
                  !imageCropController.hasActiveSession &&
                  !pendingChangeSetRef.current &&
                  !quotationRefreshJournalRef.current.pending &&
                  session.controller.recordVersion ===
                    journal.sourceDraftRecordVersion &&
                  session.controller.draftSnapshotId ===
                    journal.sourceDraftSnapshotId
                signal.throwIfAborted()
                const currentLocal = await getLocalAssetRecord(
                  localAssetId,
                  signal
                )
                signal.throwIfAborted()
                if (
                  !relinkContextIsCurrent() ||
                  (currentLocal &&
                    currentLocal.revision !== journal.sourceLocalAssetRevision)
                ) {
                  return null
                }
                const currentHistory = historyRef.current
                const currentContentSnapshotId = await deriveDocumentSnapshotId(
                  currentHistory.document
                )
                signal.throwIfAborted()
                if (
                  currentContentSnapshotId !==
                    journal.sourceContentSnapshotId ||
                  currentHistory.snapshotId !==
                    journal.sourceHistorySnapshotId ||
                  currentHistory.operationVersion !==
                    journal.sourceOperationVersion
                ) {
                  return null
                }
                await reassertOwned()
                signal.throwIfAborted()
                if (
                  !relinkContextIsCurrent() ||
                  historyRef.current !== currentHistory
                ) {
                  return null
                }
                const sourceKeys = assetReferenceKeysForSource(
                  currentHistory.document,
                  source
                )
                if (!sourceKeys.length) {
                  if (
                    !journal.managedAssetId ||
                    !hasExactManagedProjection(
                      currentHistory.document,
                      journal.managedAssetId,
                      journal.expectedReferenceKeys
                    )
                  ) {
                    return null
                  }
                  enterCritical(false)
                  const active = activeLocalAssetPromotionRef.current
                  if (active) {
                    activeLocalAssetPromotionRef.current = {
                      ...active,
                      critical: true,
                      blocksPromotionStart: true,
                    }
                  }
                  return {
                    kind: "already_applied",
                    contentSnapshotId: currentContentSnapshotId,
                    historySnapshotId: currentHistory.snapshotId,
                    operationVersion: currentHistory.operationVersion,
                    commitId: null,
                    undoable: false,
                  }
                }
                if (
                  !journal.managedAssetId ||
                  !sameReferenceKeys(sourceKeys, journal.expectedReferenceKeys)
                ) {
                  return null
                }
                signal.throwIfAborted()
                const result = commitCommandsWithResult(
                  currentHistory,
                  [
                    commandFromDraft({
                      type: "relink_asset_references",
                      from: source,
                      toAssetId: journal.managedAssetId,
                      toSource: managedAssetSource(journal.managedAssetId),
                      expectedReferenceKeys: journal.expectedReferenceKeys,
                    }),
                  ],
                  { label: "Make image available everywhere" }
                )
                if (!result) return null
                historyRef.current = result.history
                setHistory(result.history)
                pruneTemplateSourceContexts(result.history)
                notifyHistoryCommit(result.commit)
                captureSettledDraft()
                enterCritical(result.commit.undoable)
                const active = activeLocalAssetPromotionRef.current
                if (active) {
                  activeLocalAssetPromotionRef.current = {
                    ...active,
                    critical: true,
                    blocksPromotionStart: true,
                  }
                }
                const resultContentSnapshotId = await deriveDocumentSnapshotId(
                  result.history.document
                )
                if (
                  !hasExactManagedProjection(
                    result.history.document,
                    journal.managedAssetId,
                    journal.expectedReferenceKeys
                  )
                ) {
                  throw new Error(
                    "The relink result did not retain the exact image reference set."
                  )
                }
                return {
                  kind: "committed",
                  contentSnapshotId: resultContentSnapshotId,
                  historySnapshotId: result.history.snapshotId,
                  operationVersion: result.history.operationVersion,
                  commitId: result.commit.id,
                  undoable: result.commit.undoable,
                }
              },
              flushRelink: async (
                journal: LocalAssetPromotionJournal,
                relink: ActiveRelinkResult
              ): Promise<DurableRelinkReceipt | null> => {
                if (
                  session.controller.documentId !== journal.sourceDocumentId ||
                  historyRef.current.document.id !== journal.sourceDocumentId ||
                  historyRef.current.snapshotId !== relink.historySnapshotId ||
                  historyRef.current.operationVersion !==
                    relink.operationVersion
                ) {
                  return null
                }
                if (!capturePersistenceSession(session)) return null
                if (session.controller.state.status === "failed") {
                  await session.controller.retry()
                }
                const flushed = await session.controller.flushWithReceipt()
                if (!flushed.ok) return null
                const readBack = await getDraftRepository().get(
                  flushed.receipt.documentId
                )
                if (
                  !readBack.ok ||
                  readBack.status !== "found" ||
                  readBack.record.summary.recordVersion !==
                    flushed.receipt.recordVersion ||
                  readBack.record.summary.documentId !==
                    flushed.receipt.documentId ||
                  readBack.record.summary.contentSnapshotId !==
                    flushed.receipt.contentSnapshotId ||
                  readBack.record.summary.draftSnapshotId !==
                    flushed.receipt.draftSnapshotId ||
                  readBack.record.summary.savedAt !== flushed.receipt.savedAt ||
                  !hasExactManagedProjection(
                    readBack.record.envelope.document,
                    journal.managedAssetId!,
                    journal.expectedReferenceKeys
                  ) ||
                  assetReferenceKeysForSource(
                    readBack.record.envelope.document,
                    source
                  ).length
                ) {
                  return null
                }
                const storedContentSnapshotId = await deriveDocumentSnapshotId(
                  readBack.record.envelope.document
                )
                if (
                  storedContentSnapshotId !== flushed.receipt.contentSnapshotId
                ) {
                  return null
                }
                return {
                  documentId: flushed.receipt.documentId,
                  contentSnapshotId: flushed.receipt.contentSnapshotId,
                  draftSnapshotId: flushed.receipt.draftSnapshotId,
                  recordVersion: flushed.receipt.recordVersion,
                  savedAt: flushed.receipt.savedAt,
                }
              },
              markManagedUsed: (assetId, idempotencyKey) =>
                markManagedMediaUsed(assetId, { idempotencyKey }),
              onDurableRelink: finishCriticalSettlement,
            },
          }
        )
        mountedOperationId = operation.operationId
        activeLocalAssetPromotionRef.current = {
          operationId: operation.operationId,
          localAssetId,
          documentId: sourceDocument.id,
          session,
          sessionGeneration: generation,
          critical: false,
          blocksPromotionStart: true,
          criticalSettlement,
          cancel: operation.cancel,
        }
        localAssetPromotionStartGateRef.current.release(
          reservationKey,
          reservationToken
        )
        setLocalAssetPromotions((current) => ({
          ...current,
          [localAssetId]: {
            operationId: operation.operationId,
            localAssetId,
            sourceDocumentId: sourceDocument.id,
            expectedReferenceKeys,
            managedAssetId: promotionManagedAssetId,
            relinkCommitId: null,
            phase: "preparing",
            loaded: null,
            total: null,
            message: null,
            retryable: false,
            undoable: null,
          },
        }))
        void operation.promise.then(
          (result) => {
            finishCriticalSettlement()
            const active = activeLocalAssetPromotionRef.current
            const ownsPresentation =
              mountedRef.current &&
              active?.operationId === operation.operationId &&
              active.session === session &&
              active.sessionGeneration === generation &&
              active.documentId === sourceDocument.id &&
              activePersistenceSessionRef.current === session &&
              sessionGenerationRef.current === generation &&
              historyRef.current.document.id === sourceDocument.id
            if (active?.operationId === operation.operationId) {
              activeLocalAssetPromotionRef.current = null
            }
            if (!ownsPresentation) return
            const phase =
              result.status === "complete"
                ? "complete"
                : result.status === "backed_up"
                  ? "backed_up"
                  : result.status
            setLocalAssetPromotions((current) => ({
              ...current,
              [localAssetId]: {
                operationId: operation.operationId,
                localAssetId,
                sourceDocumentId: sourceDocument.id,
                expectedReferenceKeys,
                managedAssetId:
                  result.journal?.managedAssetId ?? promotionManagedAssetId,
                relinkCommitId: result.journal?.relinkCommitId ?? null,
                phase,
                loaded: null,
                total: null,
                message: result.status === "complete" ? null : result.message,
                retryable:
                  result.status === "complete" ? false : result.retryable,
                undoable:
                  result.status === "complete"
                    ? result.journal.relinkUndoable
                    : (result.journal?.relinkUndoable ?? null),
              },
            }))
          },
          (error: unknown) => {
            finishCriticalSettlement()
            const active = activeLocalAssetPromotionRef.current
            const ownsPresentation =
              mountedRef.current &&
              active?.operationId === operation.operationId &&
              active.session === session &&
              active.sessionGeneration === generation &&
              active.documentId === sourceDocument.id &&
              activePersistenceSessionRef.current === session &&
              sessionGenerationRef.current === generation &&
              historyRef.current.document.id === sourceDocument.id
            if (active?.operationId === operation.operationId) {
              activeLocalAssetPromotionRef.current = null
            }
            if (!ownsPresentation) return
            setLocalAssetPromotions((current) => ({
              ...current,
              [localAssetId]: {
                operationId: operation.operationId,
                localAssetId,
                sourceDocumentId: sourceDocument.id,
                expectedReferenceKeys,
                managedAssetId: promotionManagedAssetId,
                relinkCommitId: null,
                phase: "failed",
                loaded: null,
                total: null,
                message:
                  error instanceof Error
                    ? error.message
                    : "Studio could not finish making this image available everywhere.",
                retryable: true,
                undoable: null,
              },
            }))
          }
        )
        return true
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : null
        const retryable =
          code !== "local_asset_alias_conflict" &&
          code !== "local_promotion_conflict"
        return failReservation(
          error instanceof Error && error.message
            ? error.message
            : "Studio could not prepare this image for shared use.",
          retryable
        )
      } finally {
        const wasCancelled = reservationSignal.aborted
        const stillMountedForReservation =
          mountedRef.current &&
          reservationStillInstalled() &&
          activePersistenceSessionRef.current === session &&
          sessionGenerationRef.current === generation &&
          historyRef.current.document.id === sourceDocument.id
        if (reservationStillInstalled()) {
          localAssetPromotionReservationRef.current = null
        }
        localAssetPromotionStartGateRef.current.release(
          reservationKey,
          reservationToken
        )
        if (wasCancelled && stillMountedForReservation) {
          setLocalAssetPromotions((current) => {
            const promotion = current[localAssetId]
            if (promotion?.operationId !== reservationToken) return current
            return {
              ...current,
              [localAssetId]: {
                ...promotion,
                phase: "cancelled",
                message:
                  "Making this image available everywhere was cancelled.",
                retryable: true,
              },
            }
          })
        } else if (!reservationDisposition.preserve)
          setLocalAssetPromotions((current) => {
            if (current[localAssetId]?.operationId !== reservationToken) {
              return current
            }
            const next = { ...current }
            delete next[localAssetId]
            return next
          })
      }
    },
    [
      allowMutation,
      capturePersistenceSession,
      captureSettledDraft,
      getDraftRepository,
      imageCropController,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const cancelLocalAssetPromotion = useCallback((localAssetId: string) => {
    const active = activeLocalAssetPromotionRef.current
    if (!active || active.localAssetId !== localAssetId) {
      const reservation = localAssetPromotionReservationRef.current
      if (!reservation || reservation.localAssetId !== localAssetId) {
        return false
      }
      const accepted = reservation.cancel()
      if (!accepted) return false
      setLocalAssetPromotions((current) => {
        const promotion = current[localAssetId]
        if (!promotion || promotion.operationId !== reservation.token) {
          return current
        }
        return {
          ...current,
          [localAssetId]: {
            ...promotion,
            phase: "cancelling",
            message: "Stopping…",
            retryable: false,
          },
        }
      })
      return true
    }
    const accepted = active.cancel()
    if (
      !accepted ||
      !mountedRef.current ||
      activeLocalAssetPromotionRef.current?.operationId !==
        active.operationId ||
      activePersistenceSessionRef.current !== active.session ||
      sessionGenerationRef.current !== active.sessionGeneration ||
      historyRef.current.document.id !== active.documentId
    ) {
      return accepted
    }
    setLocalAssetPromotions((current) => {
      const promotion = current[localAssetId]
      if (!promotion || promotion.operationId !== active.operationId) {
        return current
      }
      return {
        ...current,
        [localAssetId]: {
          ...promotion,
          phase: "cancelling",
          message: "Stopping…",
          retryable: false,
        },
      }
    })
    return true
  }, [])

  const runMountedLocalMediaRelink = useCallback(
    async (
      localAssetId: string,
      label: string,
      prepareTarget: (
        signal: AbortSignal
      ) => Promise<PreparedMountedMediaRecoveryTarget>,
      options: Readonly<{ allowUnavailableLocalState?: boolean }> = {}
    ) => {
      if (activeLocalMediaRecoveryRef.current) return false
      if (!allowMutation()) return false
      const session = activePersistenceSessionRef.current
      if (!session || sessionModeRef.current !== "workspace") {
        setAssetError(
          "Save this document in Studio before recovering its missing images."
        )
        return false
      }
      if (!captureSettledDraft()) return false
      const source = localAssetSource(localAssetId)
      const sourceDocument = historyRef.current.document
      const expectedReferenceKeys = assetReferenceKeysForSource(
        sourceDocument,
        source
      )
      if (!expectedReferenceKeys.length) {
        setAssetError("This missing image is no longer used by the document.")
        return false
      }
      const sourceHistorySnapshotId = historyRef.current.snapshotId
      const sourceOperationVersion = historyRef.current.operationVersion
      const generation = sessionGenerationRef.current
      const token = crypto.randomUUID()
      const controller = new AbortController()
      let settleCritical!: () => void
      const criticalSettlement = new Promise<void>((resolve) => {
        settleCritical = resolve
      })
      const operation: MountedLocalMediaRecovery = {
        token,
        localAssetId,
        documentId: sourceDocument.id,
        session,
        sessionGeneration: generation,
        critical: false,
        controller,
        criticalSettlement,
      }
      activeLocalMediaRecoveryRef.current = operation
      const owns = () =>
        mountedRef.current &&
        activeLocalMediaRecoveryRef.current?.token === token &&
        activePersistenceSessionRef.current === session &&
        sessionGenerationRef.current === generation &&
        historyRef.current.document.id === sourceDocument.id
      const publish = (state: LocalMediaRecoveryOperationViewState) => {
        if (!owns()) return
        setLocalMediaRecoveryOperations((current) => ({
          ...current,
          [localAssetId]: state,
        }))
      }
      publish({
        phase: "preparing",
        message: "Reviewing every use of this image…",
        retryable: false,
      })
      let reservedDurableOperation: MountedMediaRecoveryRecord | null = null
      const abandonReservedOperation = async () => {
        if (!reservedDurableOperation) return true
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const candidate = reservedDurableOperation
          const abandoned =
            await mountedMediaRecoveryRepositoryRef.current.abandonPrecommitIntent(
              {
                operationId: candidate.operationId,
                expectedRevision: candidate.revision,
                source: {
                  contentSnapshotId: candidate.sourceContentSnapshotId,
                  historySnapshotId: candidate.sourceHistorySnapshotId,
                  operationVersion: candidate.sourceOperationVersion,
                  draftRecordVersion: candidate.sourceDraftRecordVersion,
                  draftSnapshotId: candidate.sourceDraftSnapshotId,
                },
                code: "prepared_recovery_not_installed",
                message:
                  "The prepared image recovery stopped before changing the document.",
                requestId: null,
                updatedAt: new Date().toISOString(),
              }
            )
          if (abandoned.ok) {
            reservedDurableOperation = abandoned.record
            return true
          }
          if (
            abandoned.reason !== "cas_conflict" ||
            abandoned.current.operationId !== candidate.operationId ||
            abandoned.current.documentCommit !== null
          ) {
            return false
          }
          reservedDurableOperation = abandoned.current
        }
        return false
      }
      try {
        const initialFlush = await session.controller.flushWithReceipt()
        controller.signal.throwIfAborted()
        if (!owns()) return false
        if (!initialFlush.ok) {
          throw new Error(
            "Finish saving the current document, then retry image recovery."
          )
        }
        const sourceContentSnapshotId =
          await deriveDocumentSnapshotId(sourceDocument)
        if (!owns()) return false
        const initialLocalInspection = await inspectRequestedLocalAssets(
          [localAssetId],
          { signal: controller.signal }
        )
        const initialLocalState = initialLocalInspection[0]
        if (!initialLocalState || initialLocalInspection.length !== 1) {
          throw new Error(
            "Studio could not capture this device image identity before recovery. Retry."
          )
        }
        const initialLocalFingerprint = await localAdmissionStateFingerprint(
          initialLocalState,
          controller.signal,
          options.allowUnavailableLocalState
        )
        const target = await prepareTarget(controller.signal)
        controller.signal.throwIfAborted()
        if (!owns()) return false
        if (
          historyRef.current.document !== sourceDocument ||
          historyRef.current.snapshotId !== sourceHistorySnapshotId ||
          historyRef.current.operationVersion !== sourceOperationVersion ||
          session.controller.recordVersion !==
            initialFlush.receipt.recordVersion ||
          session.controller.draftSnapshotId !==
            initialFlush.receipt.draftSnapshotId ||
          session.controller.contentSnapshotId !== sourceContentSnapshotId ||
          !sameReferenceKeys(
            assetReferenceKeysForSource(historyRef.current.document, source),
            expectedReferenceKeys
          )
        ) {
          throw new Error(
            "The document changed while Studio prepared image recovery. Review its current uses and retry."
          )
        }
        if (target.kind !== "restored") {
          const currentLocalInspection = await inspectRequestedLocalAssets(
            [localAssetId],
            { signal: controller.signal }
          )
          const currentLocalState = currentLocalInspection[0]
          if (
            !currentLocalState ||
            currentLocalInspection.length !== 1 ||
            (await localAdmissionStateFingerprint(
              currentLocalState,
              controller.signal,
              options.allowUnavailableLocalState
            )) !== initialLocalFingerprint
          ) {
            throw new Error(
              "The device image identity changed while Studio prepared recovery. Review the current file and retry."
            )
          }
        }
        if (target.kind === "restored") {
          pendingLocatedMediaConflictRef.current.delete(localAssetId)
          publish({
            phase: "complete",
            message:
              "The exact file was restored to its existing device identity. The document did not need a new Undo step.",
            retryable: false,
            completionKind: "restored",
          })
          setAssetVersion((current) => current + 1)
          return true
        }
        let durableOperation: MountedMediaRecoveryRecord | null = null
        let normalizedTarget =
          target.kind === "managed"
            ? {
                ...target,
                preexistingTargetReferenceKeys: assetReferenceKeysForSource(
                  sourceDocument,
                  target.source
                ),
              }
            : target
        if (target.kind === "managed") {
          const operationId = await stableMountedMediaRecoveryOperationId(
            [
              sourceDocument.id,
              localAssetId,
              target.assetId,
              token,
              normalizedTarget.kind === "managed"
                ? normalizedTarget.preexistingTargetReferenceKeys.join(",")
                : "",
              sourceContentSnapshotId,
              sourceHistorySnapshotId,
              sourceOperationVersion,
              initialFlush.receipt.recordVersion,
              initialFlush.receipt.draftSnapshotId,
            ].join("\u0000")
          )
          const intent =
            await mountedMediaRecoveryRepositoryRef.current.createIntent({
              operationId,
              documentId: sourceDocument.id,
              localAssetId,
              localSource: source,
              managedAssetId: target.assetId,
              managedSource: target.source,
              preexistingTargetReferenceKeys:
                normalizedTarget.kind === "managed"
                  ? normalizedTarget.preexistingTargetReferenceKeys
                  : [],
              expectedReferenceKeys,
              sourceContentSnapshotId,
              sourceHistorySnapshotId,
              sourceOperationVersion,
              sourceDraftRecordVersion: initialFlush.receipt.recordVersion,
              sourceDraftSnapshotId: initialFlush.receipt.draftSnapshotId,
              createdAt: new Date().toISOString(),
            })
          if (!intent.ok) {
            throw new Error(
              "failure" in intent
                ? intent.failure.message
                : "Studio could not reserve this exact image recovery operation."
            )
          }
          if (
            intent.record.documentCommit !== null ||
            intent.record.status === "complete" ||
            intent.record.status === "conflict" ||
            intent.record.status === "abandoned"
          ) {
            throw new Error(
              "A durable recovery receipt already exists for another document state. Reload this document before retrying."
            )
          }
          durableOperation = intent.record
          reservedDurableOperation = intent.record
          normalizedTarget = {
            assetId: target.assetId,
            source: target.source,
            kind: "managed",
            preexistingTargetReferenceKeys:
              normalizedTarget.kind === "managed"
                ? [...normalizedTarget.preexistingTargetReferenceKeys]
                : [],
            recentUseIdempotencyKey: intent.record.recentUseIdempotencyKey,
          }
        }
        const recoveryDrafts: CommandDraft[] =
          normalizedTarget.kind === "remove"
            ? [
                ...normalizedTarget.bindingIds.map(
                  (bindingId): CommandDraft => ({
                    type: "unbind_field",
                    bindingId,
                  })
                ),
                ...normalizedTarget.nodeIds.map((nodeId): CommandDraft => ({
                  type: "remove_node",
                  nodeId,
                })),
                ...normalizedTarget.clearDefaultFieldIds.map(
                  (fieldId): CommandDraft => ({
                    type: "update_field",
                    fieldId,
                    patch: { defaultValue: "" },
                  })
                ),
                ...normalizedTarget.clearCurrentFieldIds.map(
                  (fieldId): CommandDraft => ({
                    type: "set_field",
                    fieldId,
                    value: "",
                  })
                ),
              ]
            : [
                normalizedTarget.kind === "managed"
                  ? {
                      type: "relink_asset_references",
                      from: source,
                      toAssetId: normalizedTarget.assetId,
                      toSource: normalizedTarget.source,
                      expectedReferenceKeys,
                    }
                  : {
                      type: "relink_local_asset_references",
                      from: source,
                      toAssetId: normalizedTarget.assetId,
                      toSource: normalizedTarget.source,
                      expectedReferenceKeys,
                    },
              ]
        const result = commitCommandsWithResult(
          historyRef.current,
          recoveryDrafts.map(commandFromDraft),
          { label }
        )
        if (!result) throw new Error("The image recovery made no change.")
        if (durableOperation) {
          const preparedContentSnapshotId = await deriveDocumentSnapshotId(
            result.history.document
          )
          controller.signal.throwIfAborted()
          if (!owns()) {
            await abandonReservedOperation()
            return false
          }
          const prepared =
            await mountedMediaRecoveryRepositoryRef.current.recordHistoryPrepared(
              {
                operationId: durableOperation.operationId,
                expectedRevision: durableOperation.revision,
                historyCheckpoint: {
                  resultContentSnapshotId: preparedContentSnapshotId,
                  resultHistorySnapshotId: result.history.snapshotId,
                  resultOperationVersion: result.history.operationVersion,
                  commitId: result.commit.id,
                  undoable: result.commit.undoable,
                },
                updatedAt: new Date().toISOString(),
              }
            )
          if (!prepared.ok) {
            throw new Error(
              "failure" in prepared
                ? prepared.failure.message
                : "Studio could not checkpoint the prepared image recovery."
            )
          }
          durableOperation = prepared.record
          reservedDurableOperation = prepared.record
          controller.signal.throwIfAborted()
          if (!owns()) {
            await abandonReservedOperation()
            return false
          }
        }
        historyRef.current = result.history
        setHistory(result.history)
        pruneTemplateSourceContexts(result.history)
        localMediaRecoveryCheckpointRef.current.set(localAssetId, {
          localAssetId,
          source,
          target: normalizedTarget,
          expectedReferenceKeys,
          documentId: sourceDocument.id,
          session,
          sessionGeneration: generation,
          undoable: result.commit.undoable,
          commitId: result.commit.id,
          resultHistorySnapshotId: result.history.snapshotId,
          resultOperationVersion: result.history.operationVersion,
          durableOperation,
        })
        activeLocalMediaRecoveryRef.current = { ...operation, critical: true }
        notifyHistoryCommit(result.commit)
        publish({
          phase: "saving",
          message: "Saving recovered image references…",
          retryable: false,
          completionKind: "relinked",
        })
        if (!captureSettledDraft()) {
          throw new Error(
            "The recovered document could not be queued for save."
          )
        }
        if (session.controller.state.status === "failed") {
          await session.controller.retry()
        }
        const flushed = await session.controller.flushWithReceipt()
        if (!flushed.ok) {
          throw new Error(
            "The image was recovered in this tab, but its durable save did not finish. Keep this tab open and retry saving."
          )
        }
        const readBack = await getDraftRepository().get(
          flushed.receipt.documentId
        )
        if (
          !readBack.ok ||
          readBack.status !== "found" ||
          readBack.record.summary.documentId !== sourceDocument.id ||
          readBack.record.summary.recordVersion !==
            flushed.receipt.recordVersion ||
          readBack.record.summary.contentSnapshotId !==
            flushed.receipt.contentSnapshotId ||
          readBack.record.summary.draftSnapshotId !==
            flushed.receipt.draftSnapshotId ||
          !hasExactRecoveredProjection(
            readBack.record.envelope.document,
            source,
            normalizedTarget,
            expectedReferenceKeys
          )
        ) {
          throw new Error(
            "Studio could not verify the durable recovered image references."
          )
        }
        if (durableOperation) {
          const recorded =
            await mountedMediaRecoveryRepositoryRef.current.recordDocumentCommitted(
              {
                operationId: durableOperation.operationId,
                expectedRevision: durableOperation.revision,
                documentCommit: {
                  kind: "committed",
                  resultContentSnapshotId: flushed.receipt.contentSnapshotId,
                  resultHistorySnapshotId: result.history.snapshotId,
                  resultOperationVersion: result.history.operationVersion,
                  commitId: result.commit.id,
                  undoable: result.commit.undoable,
                  durable: {
                    documentId: flushed.receipt.documentId,
                    recordVersion: flushed.receipt.recordVersion,
                    contentSnapshotId: flushed.receipt.contentSnapshotId,
                    draftSnapshotId: flushed.receipt.draftSnapshotId,
                    savedAt: flushed.receipt.savedAt,
                  },
                },
                updatedAt: new Date().toISOString(),
              }
            )
          if (!recorded.ok) {
            throw new Error(
              "failure" in recorded
                ? recorded.failure.message
                : "Studio saved the recovered document but could not checkpoint its exact recovery receipt."
            )
          }
          durableOperation = recorded.record
          localMediaRecoveryCheckpointRef.current.set(localAssetId, {
            ...localMediaRecoveryCheckpointRef.current.get(localAssetId)!,
            durableOperation,
          })
        }
        let recentWarning = false
        if (
          normalizedTarget.kind === "managed" &&
          normalizedTarget.recentUseIdempotencyKey
        ) {
          try {
            const recent = await markManagedMediaUsed(
              normalizedTarget.assetId,
              {
                idempotencyKey: normalizedTarget.recentUseIdempotencyKey,
              }
            )
            if (durableOperation) {
              const completed =
                await mountedMediaRecoveryRepositoryRef.current.recordRecentComplete(
                  {
                    operationId: durableOperation.operationId,
                    expectedRevision: durableOperation.revision,
                    idempotencyKey: durableOperation.recentUseIdempotencyKey,
                    requestId: recent.requestId,
                    usedAt: recent.usedAt,
                    assetRevision: recent.assetRevision,
                    updatedAt: new Date().toISOString(),
                  }
                )
              if (!completed.ok) {
                throw new Error(
                  "failure" in completed
                    ? completed.failure.message
                    : "Studio could not store the Recent receipt."
                )
              }
            }
          } catch {
            recentWarning = true
          }
        }
        if (recentWarning && durableOperation) {
          throw new Error(
            "The document recovery is saved, but Studio still needs to finish the durable Recent receipt."
          )
        }
        publish({
          phase: "complete",
          message: recentWarning
            ? "Image recovered and saved. Studio could not update its Recent position."
            : result.commit.undoable
              ? "Image recovered and saved. Undo restores the device-only reference."
              : "Image recovered and saved. No new Undo step is available.",
          retryable: false,
          completionKind: "relinked",
        })
        localMediaRecoveryCheckpointRef.current.delete(localAssetId)
        setAssetVersion((current) => current + 1)
        return true
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Studio could not recover this image."
        const hasCheckpoint =
          localMediaRecoveryCheckpointRef.current.has(localAssetId)
        const checkpoint =
          localMediaRecoveryCheckpointRef.current.get(localAssetId)
        if (checkpoint?.durableOperation) {
          const retry =
            await mountedMediaRecoveryRepositoryRef.current.markRetry({
              operationId: checkpoint.durableOperation.operationId,
              expectedRevision: checkpoint.durableOperation.revision,
              code: "mounted_recovery_incomplete",
              message,
              requestId: null,
              updatedAt: new Date().toISOString(),
            })
          if (retry.ok) {
            localMediaRecoveryCheckpointRef.current.set(localAssetId, {
              ...checkpoint,
              durableOperation: retry.record,
            })
          }
        }
        if (!hasCheckpoint && reservedDurableOperation) {
          if (!(await abandonReservedOperation())) {
            const dispositionMessage =
              "Studio could not close the unused recovery checkpoint. Retry the recovery check before editing."
            if (owns()) {
              mountedMediaRecoveryReconciledSessionRef.current = null
              setMountedMediaRecoveryReconciliation({
                status: "error",
                sessionKey: `${sourceDocument.id}:${generation}`,
                message: dispositionMessage,
              })
              publish({
                phase: "failed",
                message: dispositionMessage,
                retryable: false,
              })
              setAssetError(dispositionMessage)
            }
            return false
          }
        }
        if (controller.signal.aborted && !hasCheckpoint) {
          publish({
            phase: "complete",
            message:
              "Image recovery was cancelled before the document changed.",
            retryable: false,
            completionKind: "cancelled",
          })
          return false
        }
        publish({
          phase:
            error instanceof LocalMediaIdentityConflictError
              ? "identity_conflict"
              : "failed",
          message,
          retryable:
            !(error instanceof LocalMediaIdentityConflictError) &&
            hasCheckpoint,
          ...(hasCheckpoint ? { retryAction: "finish_saving" as const } : {}),
        })
        setAssetError(message)
        return false
      } finally {
        settleCritical()
        if (activeLocalMediaRecoveryRef.current?.token === token) {
          activeLocalMediaRecoveryRef.current = null
        }
      }
    },
    [
      allowMutation,
      captureSettledDraft,
      getDraftRepository,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const cancelLocalMediaRecovery = useCallback((localAssetId: string) => {
    const operation = activeLocalMediaRecoveryRef.current
    if (!operation || operation.localAssetId !== localAssetId) return false
    if (operation.critical) {
      setAssetError(
        "This recovery is already saving. Keep Media open until the durable save finishes."
      )
      return false
    }
    setLocalMediaRecoveryOperations((current) => ({
      ...current,
      [localAssetId]: {
        phase: "cancelling",
        message: "Cancelling before the document changes…",
        retryable: false,
      },
    }))
    operation.controller.abort(
      new DOMException("Image recovery cancelled", "AbortError")
    )
    return true
  }, [])

  const useStudioCopyForLocalAsset = useCallback(
    (localAssetId: string, confirmIdentityConflict = false) =>
      runMountedLocalMediaRelink(
        localAssetId,
        "Use Studio image copy",
        async (signal) => {
          const resolved = await resolveLocalAssetPromotions([localAssetId], {
            signal,
          })
          const resolution = resolved.results[0]
          const promotion = resolution?.promotion
          if (
            resolved.results.length !== 1 ||
            resolution?.localAssetId !== localAssetId ||
            !promotion ||
            promotion.localAssetId !== localAssetId
          ) {
            throw new Error(
              "No exact Studio copy is available for this missing image."
            )
          }
          const inspected = await inspectRequestedLocalAssets([localAssetId], {
            signal,
          })
          const localState = inspected[0]
          if (!localState || inspected.length !== 1) {
            throw new Error(
              "Studio could not verify the current device file state."
            )
          }
          if (localState.status === "unavailable") {
            if (!confirmIdentityConflict) {
              throw new LocalMediaIdentityConflictError(
                "This device's image storage cannot be verified. Review every affected use, then choose Replace with Studio copy to use the exact saved Studio identity without changing unknown device bytes."
              )
            }
          }
          if (localState.status === "ready") {
            const localHash = await hashLocalAssetBlobSha256(
              localState.record.blob,
              signal
            )
            if (localHash !== promotion.contentSha256) {
              if (!confirmIdentityConflict) {
                throw new LocalMediaIdentityConflictError(
                  "A different file now exists under this device identity. Review every affected use, then choose Replace with Studio copy to keep both files without overwriting the device copy."
                )
              }
            }
            const confirmed = await inspectRequestedLocalAssets(
              [localAssetId],
              { signal }
            )
            if (
              confirmed[0]?.status !== "ready" ||
              confirmed[0].record.revision !== localState.record.revision
            ) {
              throw new Error(
                "The device file changed while Studio prepared recovery. Retry."
              )
            }
          }
          const mappingConfirmation = await resolveLocalAssetPromotions(
            [localAssetId],
            { signal }
          )
          const confirmedPromotion =
            mappingConfirmation.results[0]?.promotion ?? null
          if (
            mappingConfirmation.results.length !== 1 ||
            mappingConfirmation.results[0]?.localAssetId !== localAssetId ||
            !confirmedPromotion ||
            confirmedPromotion.localAssetId !== localAssetId ||
            confirmedPromotion.asset.id !== promotion.asset.id ||
            confirmedPromotion.asset.status !== promotion.asset.status ||
            confirmedPromotion.asset.revision !== promotion.asset.revision ||
            confirmedPromotion.contentSha256 !== promotion.contentSha256
          ) {
            throw new Error(
              "The Studio copy changed while recovery was prepared. Retry."
            )
          }
          const managed = await getManagedMedia(promotion.asset.id, signal)
          if (
            !managed ||
            managed.id !== promotion.asset.id ||
            managed.status !== promotion.asset.status
          ) {
            throw new Error(
              "The saved Studio copy changed while recovery was prepared. Retry."
            )
          }
          return {
            assetId: managed.id,
            source: managedAssetSource(managed.id),
            kind: "managed" as const,
            recentUseIdempotencyKey: `media-recovery-${crypto.randomUUID()}`,
          }
        },
        { allowUnavailableLocalState: true }
      ),
    [runMountedLocalMediaRelink]
  )

  const locateMissingLocalAsset = useCallback(
    (localAssetId: string, file: File) =>
      runMountedLocalMediaRelink(
        localAssetId,
        "Locate missing image",
        async (signal) => {
          const validationError = validateMediaFile(file)
          if (validationError) throw new Error(validationError)
          await assertLocalAssetCapacity(file.size)
          const [dimensions, contentSha256, resolved, inspected] =
            await Promise.all([
              decodeValidatedImageDimensions(file),
              hashLocalAssetBlobSha256(file, signal),
              resolveLocalAssetPromotions([localAssetId], { signal }),
              inspectRequestedLocalAssets([localAssetId], { signal }),
            ])
          signal.throwIfAborted()
          const resolution = resolved.results[0]
          const localState = inspected[0]
          if (
            resolved.results.length !== 1 ||
            resolution?.localAssetId !== localAssetId ||
            !localState ||
            inspected.length !== 1
          ) {
            throw new Error(
              "Studio could not verify the selected file against this exact image identity. Retry."
            )
          }
          if (localState.status === "unavailable") {
            throw new Error(localState.message)
          }
          const promotion = resolution.promotion
          if (promotion && promotion.localAssetId !== localAssetId) {
            throw new Error(
              "Studio returned a saved copy for another image identity. Retry."
            )
          }
          if (promotion && contentSha256 !== promotion.contentSha256) {
            pendingLocatedMediaConflictRef.current.set(localAssetId, {
              file,
              contentSha256,
              expectedContentSha256: promotion.contentSha256,
            })
            throw new LocalMediaIdentityConflictError(
              "This file is different from the saved Studio copy. Use the Studio copy to keep the old identity, or keep this file as a new upload."
            )
          }
          if (promotion) {
            if (localState.status === "ready") {
              const currentHash = await hashLocalAssetBlobSha256(
                localState.record.blob,
                signal
              )
              const confirmed = await inspectRequestedLocalAssets(
                [localAssetId],
                { signal }
              )
              if (
                confirmed[0]?.status !== "ready" ||
                confirmed[0].record.revision !== localState.record.revision
              ) {
                throw new Error(
                  "The device file changed while Studio checked it. Retry."
                )
              }
              if (currentHash !== promotion.contentSha256) {
                pendingLocatedMediaConflictRef.current.set(localAssetId, {
                  file,
                  contentSha256,
                  expectedContentSha256: promotion.contentSha256,
                })
                throw new LocalMediaIdentityConflictError(
                  "A different file now exists under this device identity. Use the Studio copy to keep the old identity, or keep the located file as a new upload."
                )
              }
              return {
                assetId: localAssetId,
                source: localAssetSource(localAssetId),
                kind: "restored" as const,
                recentUseIdempotencyKey: null,
              }
            }
            const restored = await restoreLocalAssetBlob(
              {
                assetId: localAssetId,
                file,
                expected: localRestoreExpectation(localState),
                expectedContentSha256: promotion.contentSha256,
                contentSha256,
                width: dimensions.width,
                height: dimensions.height,
              },
              signal
            )
            if (!restored.ok) throw new Error(restored.message)
            return {
              assetId: localAssetId,
              source: localAssetSource(localAssetId),
              kind: "restored" as const,
              recentUseIdempotencyKey: null,
            }
          }
          if (localState.status === "ready") {
            const currentHash = await hashLocalAssetBlobSha256(
              localState.record.blob,
              signal
            )
            if (currentHash === contentSha256) {
              return {
                assetId: localAssetId,
                source: localAssetSource(localAssetId),
                kind: "restored" as const,
                recentUseIdempotencyKey: null,
              }
            }
            pendingLocatedMediaConflictRef.current.set(localAssetId, {
              file,
              contentSha256,
              expectedContentSha256: currentHash,
            })
            throw new LocalMediaIdentityConflictError(
              "A different file now exists under this device identity. Keep the located file as a new upload to preserve both."
            )
          }
          const nextAssetId = `asset-${crypto.randomUUID()}`
          await saveLocalAsset(file, nextAssetId, dimensions)
          const saved = await getLocalAssetRecord(nextAssetId, signal)
          if (!saved || saved.revision < 1) {
            throw new Error(
              "Studio saved the located file but could not verify its new local identity."
            )
          }
          return {
            assetId: nextAssetId,
            source: localAssetSource(nextAssetId),
            kind: "local" as const,
            recentUseIdempotencyKey: null,
          }
        }
      ),
    [runMountedLocalMediaRelink]
  )

  const keepLocatedFileAsNewLocalAsset = useCallback(
    (localAssetId: string) => {
      const pending = pendingLocatedMediaConflictRef.current.get(localAssetId)
      if (!pending) {
        setAssetError(
          "Choose Locate file again before keeping it as a new upload."
        )
        return Promise.resolve(false)
      }
      return runMountedLocalMediaRelink(
        localAssetId,
        "Keep located image as new upload",
        async (signal) => {
          const file = pending.file
          const validationError = validateMediaFile(file)
          if (validationError) throw new Error(validationError)
          const [dimensions, confirmedHash] = await Promise.all([
            decodeValidatedImageDimensions(file),
            hashLocalAssetBlobSha256(file, signal),
          ])
          if (confirmedHash !== pending.contentSha256) {
            throw new Error(
              "The selected file changed before Studio could keep it. Locate it again."
            )
          }
          await assertLocalAssetCapacity(file.size)
          signal.throwIfAborted()
          const nextAssetId = `asset-${crypto.randomUUID()}`
          await saveLocalAsset(file, nextAssetId, dimensions)
          const saved = await getLocalAssetRecord(nextAssetId, signal)
          if (!saved || saved.revision < 1) {
            throw new Error(
              "Studio saved the located file but could not verify its new local identity."
            )
          }
          pendingLocatedMediaConflictRef.current.delete(localAssetId)
          return {
            assetId: nextAssetId,
            source: localAssetSource(nextAssetId),
            kind: "local" as const,
            recentUseIdempotencyKey: null,
          }
        }
      )
    },
    [runMountedLocalMediaRelink]
  )

  const chooseManagedImageForLocalAsset = useCallback(
    (localAssetId: string, asset: ManagedMediaAsset) =>
      runMountedLocalMediaRelink(
        localAssetId,
        "Choose Studio image",
        async (signal) => {
          const current = await getManagedMedia(asset.id, signal)
          if (!current?.selectable || current.status !== "ready") {
            throw new Error(
              "That Studio image is no longer selectable. Refresh Media and choose another."
            )
          }
          return {
            assetId: current.id,
            source: managedAssetSource(current.id),
            kind: "managed" as const,
            recentUseIdempotencyKey: `media-recovery-${crypto.randomUUID()}`,
          }
        }
      ),
    [runMountedLocalMediaRelink]
  )

  const removeMissingLocalAsset = useCallback(
    (localAssetId: string, referenceKey?: string) =>
      runMountedLocalMediaRelink(
        localAssetId,
        referenceKey?.startsWith("field/")
          ? "Clear image field value"
          : "Remove missing image layer",
        async (signal) => {
          signal.throwIfAborted()
          const document = historyRef.current.document
          const source = localAssetSource(localAssetId)
          const references = extractAssetReferences(document).filter(
            (reference) => reference.source === source
          )
          const chosen = referenceKey
            ? references.find((reference) => reference.key === referenceKey)
            : references.length === 1
              ? references[0]
              : null
          if (!chosen) {
            throw new Error(
              "Choose one exact optional field slot or image layer to clear."
            )
          }
          if (chosen.location === "node" && chosen.fieldId) {
            throw new Error(
              "This layer is field-bound. Clear its optional current field slot instead."
            )
          }
          if (!references.length) {
            throw new Error("The affected image uses are no longer available.")
          }
          const nodeIds = [
            ...new Set(
              chosen.location === "field_current"
                ? chosen.projectedNodeIds
                : chosen.nodeId
                  ? [chosen.nodeId]
                  : []
            ),
          ].sort()
          const affectedNodes = document.nodes.filter((node) =>
            nodeIds.includes(node.id)
          )
          if (affectedNodes.length !== nodeIds.length) {
            throw new Error("An affected image layer is no longer available.")
          }
          if (affectedNodes.some((node) => node.locked)) {
            throw new Error(
              "Unlock every affected image layer before clearing this image."
            )
          }
          const fieldIds = chosen.fieldId ? [chosen.fieldId] : []
          const affectedFields = document.fields.filter((field) =>
            fieldIds.includes(field.id)
          )
          if (affectedFields.some((field) => field.required)) {
            throw new Error(
              "A required field uses this image. Choose a replacement instead of clearing it."
            )
          }
          const clearCurrentFieldIds = affectedFields
            .filter(
              (field) =>
                chosen.location === "field_current" &&
                document.fieldValues[field.id] === source
            )
            .map((field) => field.id)
          const clearDefaultFieldIds = affectedFields
            .filter(
              (field) =>
                field.type === "asset" &&
                field.defaultValue === source &&
                chosen.location === "field_default"
            )
            .map((field) => field.id)
          const bindingIds = document.bindings
            .filter(
              (binding) =>
                binding.property === "src" &&
                fieldIds.includes(binding.fieldId) &&
                nodeIds.includes(binding.nodeId)
            )
            .map((binding) => binding.id)
            .sort()
          const removedReferenceKeys = [
            chosen.key,
            ...references
              .filter(
                (reference) =>
                  reference.location === "node" &&
                  reference.nodeId !== null &&
                  nodeIds.includes(reference.nodeId)
              )
              .map((reference) => reference.key),
          ].sort()
          return {
            assetId: localAssetId,
            source,
            kind: "remove" as const,
            nodeIds,
            bindingIds,
            clearCurrentFieldIds,
            clearDefaultFieldIds,
            removedReferenceKeys,
            recentUseIdempotencyKey: null,
          }
        }
      ),
    [runMountedLocalMediaRelink]
  )

  const retryLocalMediaRecoverySave = useCallback(
    async (localAssetId: string) => {
      if (activeLocalMediaRecoveryRef.current) return false
      const checkpoint =
        localMediaRecoveryCheckpointRef.current.get(localAssetId)
      if (!checkpoint) return false
      const session = checkpoint.session
      if (
        !mountedRef.current ||
        activePersistenceSessionRef.current !== session ||
        sessionGenerationRef.current !== checkpoint.sessionGeneration ||
        historyRef.current.document.id !== checkpoint.documentId ||
        checkpoint.target.kind === "restored" ||
        !hasExactRecoveredProjection(
          historyRef.current.document,
          checkpoint.source,
          checkpoint.target,
          checkpoint.expectedReferenceKeys
        )
      ) {
        setAssetError(
          "The document changed after image recovery. Reload its durable version before retrying."
        )
        return false
      }
      const token = crypto.randomUUID()
      const controller = new AbortController()
      let settle!: () => void
      const criticalSettlement = new Promise<void>((resolve) => {
        settle = resolve
      })
      const operation: MountedLocalMediaRecovery = {
        token,
        localAssetId,
        documentId: checkpoint.documentId,
        session,
        sessionGeneration: checkpoint.sessionGeneration,
        critical: true,
        controller,
        criticalSettlement,
      }
      activeLocalMediaRecoveryRef.current = operation
      const owns = () =>
        mountedRef.current &&
        activeLocalMediaRecoveryRef.current?.token === token &&
        activePersistenceSessionRef.current === session &&
        sessionGenerationRef.current === checkpoint.sessionGeneration &&
        historyRef.current.document.id === checkpoint.documentId
      if (owns()) {
        setLocalMediaRecoveryOperations((current) => ({
          ...current,
          [localAssetId]: {
            phase: "saving",
            message: "Finishing the recovered document save…",
            retryable: false,
          },
        }))
      }
      try {
        let durableOperation = checkpoint.durableOperation
        if (
          durableOperation &&
          durableOperation.documentCommit === null &&
          durableOperation.historyCheckpoint === null
        ) {
          const preparedContentSnapshotId = await deriveDocumentSnapshotId(
            historyRef.current.document
          )
          const prepared =
            await mountedMediaRecoveryRepositoryRef.current.recordHistoryPrepared(
              {
                operationId: durableOperation.operationId,
                expectedRevision: durableOperation.revision,
                historyCheckpoint: {
                  resultContentSnapshotId: preparedContentSnapshotId,
                  resultHistorySnapshotId: checkpoint.resultHistorySnapshotId,
                  resultOperationVersion: checkpoint.resultOperationVersion,
                  commitId: checkpoint.commitId,
                  undoable: checkpoint.undoable,
                },
                updatedAt: new Date().toISOString(),
              }
            )
          if (!prepared.ok) {
            throw new Error(
              "failure" in prepared
                ? prepared.failure.message
                : "Studio could not checkpoint the prepared image recovery."
            )
          }
          durableOperation = prepared.record
          localMediaRecoveryCheckpointRef.current.set(localAssetId, {
            ...checkpoint,
            durableOperation,
          })
        }
        if (!captureSettledDraft()) {
          throw new Error(
            "The recovered document could not be queued for its retry save."
          )
        }
        if (session.controller.state.status === "failed") {
          await session.controller.retry()
        }
        const flushed = await session.controller.flushWithReceipt()
        if (!flushed.ok) throw new Error("The recovered save is not finished.")
        const readBack = await getDraftRepository().get(checkpoint.documentId)
        if (
          !readBack.ok ||
          readBack.status !== "found" ||
          readBack.record.summary.recordVersion !==
            flushed.receipt.recordVersion ||
          readBack.record.summary.contentSnapshotId !==
            flushed.receipt.contentSnapshotId ||
          readBack.record.summary.draftSnapshotId !==
            flushed.receipt.draftSnapshotId ||
          !hasExactRecoveredProjection(
            readBack.record.envelope.document,
            checkpoint.source,
            checkpoint.target,
            checkpoint.expectedReferenceKeys
          )
        ) {
          throw new Error(
            "Studio could not verify the recovered document save."
          )
        }
        if (durableOperation && durableOperation.documentCommit === null) {
          const recorded =
            await mountedMediaRecoveryRepositoryRef.current.recordDocumentCommitted(
              {
                operationId: durableOperation.operationId,
                expectedRevision: durableOperation.revision,
                documentCommit: {
                  kind: "committed",
                  resultContentSnapshotId: flushed.receipt.contentSnapshotId,
                  resultHistorySnapshotId: checkpoint.resultHistorySnapshotId,
                  resultOperationVersion: checkpoint.resultOperationVersion,
                  commitId: checkpoint.commitId,
                  undoable: checkpoint.undoable,
                  durable: {
                    documentId: flushed.receipt.documentId,
                    recordVersion: flushed.receipt.recordVersion,
                    contentSnapshotId: flushed.receipt.contentSnapshotId,
                    draftSnapshotId: flushed.receipt.draftSnapshotId,
                    savedAt: flushed.receipt.savedAt,
                  },
                },
                updatedAt: new Date().toISOString(),
              }
            )
          if (!recorded.ok) {
            throw new Error(
              "failure" in recorded
                ? recorded.failure.message
                : "Studio could not checkpoint the recovered document receipt."
            )
          }
          durableOperation = recorded.record
          localMediaRecoveryCheckpointRef.current.set(localAssetId, {
            ...checkpoint,
            durableOperation,
          })
        }
        let recentWarning = false
        if (
          checkpoint.target.kind === "managed" &&
          checkpoint.target.recentUseIdempotencyKey
        ) {
          try {
            const recent = await markManagedMediaUsed(
              checkpoint.target.assetId,
              {
                idempotencyKey: checkpoint.target.recentUseIdempotencyKey,
              }
            )
            if (durableOperation) {
              const completed =
                await mountedMediaRecoveryRepositoryRef.current.recordRecentComplete(
                  {
                    operationId: durableOperation.operationId,
                    expectedRevision: durableOperation.revision,
                    idempotencyKey: durableOperation.recentUseIdempotencyKey,
                    requestId: recent.requestId,
                    usedAt: recent.usedAt,
                    assetRevision: recent.assetRevision,
                    updatedAt: new Date().toISOString(),
                  }
                )
              if (!completed.ok) {
                throw new Error(
                  "failure" in completed
                    ? completed.failure.message
                    : "Studio could not store the Recent receipt."
                )
              }
            }
          } catch {
            recentWarning = true
          }
        }
        if (recentWarning && durableOperation) {
          throw new Error(
            "The document recovery is saved, but Studio still needs to finish the durable Recent receipt."
          )
        }
        localMediaRecoveryCheckpointRef.current.delete(localAssetId)
        if (owns()) {
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [localAssetId]: {
              phase: "complete",
              message: recentWarning
                ? "Image recovery is saved. Studio could not update Recent."
                : checkpoint.undoable
                  ? "Image recovered and saved. Undo restores the device-only reference."
                  : "Image recovered and saved. No new Undo step is available.",
              retryable: false,
              completionKind: "relinked",
            },
          }))
        }
        return true
      } catch (error) {
        const message =
          error instanceof Error
            ? `${error.message} Choose Finish saving to retry without relinking again.`
            : "The recovered save is not finished. Choose Finish saving to retry."
        if (owns()) {
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [localAssetId]: {
              phase: "failed",
              message,
              retryable: true,
              retryAction: "finish_saving",
            },
          }))
        }
        setAssetError(message)
        return false
      } finally {
        settle()
        if (activeLocalMediaRecoveryRef.current?.token === token) {
          activeLocalMediaRecoveryRef.current = null
        }
      }
    },
    [captureSettledDraft, getDraftRepository]
  )

  useEffect(() => {
    const session = activePersistenceSessionRef.current
    if (!session || sessionMode !== "workspace") return
    const document = historyRef.current.document
    const reconciliationKey = `${document.id}:${session.generation}`
    if (
      mountedMediaRecoveryReconciledSessionRef.current === reconciliationKey
    ) {
      setMountedMediaRecoveryReconciliation({
        status: "ready",
        sessionKey: reconciliationKey,
        message: null,
      })
      return
    }
    setMountedMediaRecoveryReconciliation({
      status: "checking",
      sessionKey: reconciliationKey,
      message: null,
    })
    let active = true
    void (async () => {
      const listed =
        await mountedMediaRecoveryRepositoryRef.current.listPendingByDocument(
          document.id
        )
      if (!active || !mountedRef.current) return
      if (!listed.ok) {
        mountedMediaRecoveryReconciledSessionRef.current = null
        setMountedMediaRecoveryReconciliation({
          status: "error",
          sessionKey: reconciliationKey,
          message: listed.failure.message,
        })
        setAssetError(listed.failure.message)
        return
      }
      const finishDurableRecent = async (
        durable: MountedMediaRecoveryRecord
      ) => {
        try {
          const recent = await markManagedMediaUsed(durable.managedAssetId, {
            idempotencyKey: durable.recentUseIdempotencyKey,
          })
          const completed =
            await mountedMediaRecoveryRepositoryRef.current.recordRecentComplete(
              {
                operationId: durable.operationId,
                expectedRevision: durable.revision,
                idempotencyKey: durable.recentUseIdempotencyKey,
                requestId: recent.requestId,
                usedAt: recent.usedAt,
                assetRevision: recent.assetRevision,
                updatedAt: new Date().toISOString(),
              }
            )
          if (!completed.ok) {
            throw new Error(
              "failure" in completed
                ? completed.failure.message
                : "Studio could not store the durable Recent receipt."
            )
          }
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [durable.localAssetId]: {
              phase: "complete",
              message:
                "The recovered document and its durable Recent receipt are complete.",
              retryable: false,
              completionKind: "relinked",
            },
          }))
          return true
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Studio could not finish the durable Recent receipt."
          await mountedMediaRecoveryRepositoryRef.current.markRetry({
            operationId: durable.operationId,
            expectedRevision: durable.revision,
            code: "recent_receipt_incomplete",
            message,
            requestId: null,
            updatedAt: new Date().toISOString(),
          })
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [durable.localAssetId]: {
              phase: "failed",
              message,
              retryable: true,
              retryAction: "finish_saving",
            },
          }))
          return false
        }
      }
      let reconciliationFailed = false
      for (const pending of listed.records) {
        if (!active || !mountedRef.current) return
        const currentSession = activePersistenceSessionRef.current
        const currentDocument = historyRef.current.document
        if (
          currentSession !== session ||
          currentDocument.id !== pending.documentId ||
          sessionGenerationRef.current !== session.generation
        ) {
          return
        }
        if (pending.documentCommit !== null) {
          if (!(await finishDurableRecent(pending))) reconciliationFailed = true
          continue
        }
        const sourceKeys = assetReferenceKeysForSource(
          currentDocument,
          pending.localSource
        )
        const targetKeys = assetReferenceKeysForSource(
          currentDocument,
          pending.managedSource
        )
        const sourceIsExact = sameReferenceKeys(
          sourceKeys,
          pending.expectedReferenceKeys
        )
        const targetIsExact =
          !sourceKeys.some((key) =>
            pending.expectedReferenceKeys.includes(key)
          ) &&
          pending.expectedReferenceKeys.every((key) => targetKeys.includes(key))
        if (sourceIsExact && pending.documentCommit === null) {
          const abandoned =
            await mountedMediaRecoveryRepositoryRef.current.abandonPrecommitIntent(
              {
                operationId: pending.operationId,
                expectedRevision: pending.revision,
                source: {
                  contentSnapshotId: pending.sourceContentSnapshotId,
                  historySnapshotId: pending.sourceHistorySnapshotId,
                  operationVersion: pending.sourceOperationVersion,
                  draftRecordVersion: pending.sourceDraftRecordVersion,
                  draftSnapshotId: pending.sourceDraftSnapshotId,
                },
                code: "precommit_recovery_stopped",
                message:
                  "The prior recovery stopped before changing the document and can be reviewed again.",
                requestId: null,
                updatedAt: new Date().toISOString(),
              }
            )
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [pending.localAssetId]: {
              phase: "failed",
              message:
                "A previous recovery stopped before changing the document. Review the current uses and choose the recovery action again.",
              retryable: false,
              retryAction: "repeat_action",
            },
          }))
          if (!abandoned.ok) {
            reconciliationFailed = true
            setAssetError(
              "failure" in abandoned
                ? abandoned.failure.message
                : "Studio could not close an interrupted image recovery checkpoint. Retry the recovery check."
            )
          }
          continue
        }
        if (!targetIsExact) {
          const conflicted =
            await mountedMediaRecoveryRepositoryRef.current.markConflict({
              operationId: pending.operationId,
              expectedRevision: pending.revision,
              code: "document_projection_changed",
              message:
                "The document image references changed after this recovery checkpoint.",
              requestId: null,
              updatedAt: new Date().toISOString(),
            })
          if (!active || !mountedRef.current) return
          setLocalMediaRecoveryOperations((current) => ({
            ...current,
            [pending.localAssetId]: {
              phase: "failed",
              message: conflicted.ok
                ? "The document changed after this image recovery. Review its current references before choosing another action."
                : "Studio could not reconcile an earlier image recovery receipt.",
              retryable: false,
            },
          }))
          if (!conflicted.ok) reconciliationFailed = true
          continue
        }
        let durable = pending
        if (durable.documentCommit === null) {
          const historyCheckpoint = pending.historyCheckpoint
          if (!historyCheckpoint) {
            const conflicted =
              await mountedMediaRecoveryRepositoryRef.current.markConflict({
                operationId: pending.operationId,
                expectedRevision: pending.revision,
                code: "history_checkpoint_missing",
                message:
                  "The recovered document has no durable history checkpoint proving this recovery.",
                requestId: null,
                updatedAt: new Date().toISOString(),
              })
            if (!conflicted.ok) reconciliationFailed = true
            continue
          }
          const contentSnapshotId =
            await deriveDocumentSnapshotId(currentDocument)
          if (!active || !mountedRef.current) return
          const observedLater =
            currentSession.controller.recordVersion >
            pending.sourceDraftRecordVersion + 1
          const exactAdvancedHead =
            currentSession.controller.recordVersion ===
            pending.sourceDraftRecordVersion + 1
          if (
            (!observedLater && !exactAdvancedHead) ||
            (exactAdvancedHead &&
              contentSnapshotId !== historyCheckpoint.resultContentSnapshotId)
          ) {
            const conflicted =
              await mountedMediaRecoveryRepositoryRef.current.markConflict({
                operationId: pending.operationId,
                expectedRevision: pending.revision,
                code: "durable_head_not_advanced",
                message:
                  "The durable document and history heads do not prove the interrupted recovery advance.",
                requestId: null,
                updatedAt: new Date().toISOString(),
              })
            if (!conflicted.ok) reconciliationFailed = true
            continue
          }
          const recorded =
            await mountedMediaRecoveryRepositoryRef.current.recordDocumentCommitted(
              {
                operationId: durable.operationId,
                expectedRevision: durable.revision,
                documentCommit: {
                  kind: observedLater ? "observed_later" : "already_applied",
                  resultContentSnapshotId: contentSnapshotId,
                  resultHistorySnapshotId:
                    historyCheckpoint.resultHistorySnapshotId,
                  resultOperationVersion:
                    historyCheckpoint.resultOperationVersion,
                  commitId: historyCheckpoint.commitId,
                  undoable: historyCheckpoint.undoable,
                  durable: {
                    documentId: currentDocument.id,
                    recordVersion: currentSession.controller.recordVersion,
                    contentSnapshotId,
                    draftSnapshotId: currentSession.controller.draftSnapshotId,
                    savedAt:
                      currentSession.controller.state.status === "saved"
                        ? currentSession.controller.state.savedAt
                        : new Date().toISOString(),
                  },
                },
                updatedAt: new Date().toISOString(),
              }
            )
          if (!recorded.ok) {
            setAssetError(
              "failure" in recorded
                ? recorded.failure.message
                : "Studio could not reconcile the recovered document receipt."
            )
            reconciliationFailed = true
            continue
          }
          durable = recorded.record
        }
        if (!(await finishDurableRecent(durable))) reconciliationFailed = true
      }
      if (!active || !mountedRef.current) return
      if (reconciliationFailed) {
        mountedMediaRecoveryReconciledSessionRef.current = null
        setMountedMediaRecoveryReconciliation({
          status: "error",
          sessionKey: reconciliationKey,
          message:
            "Studio could not finish an interrupted image recovery receipt.",
        })
        return
      }
      mountedMediaRecoveryReconciledSessionRef.current = reconciliationKey
      setMountedMediaRecoveryReconciliation({
        status: "ready",
        sessionKey: reconciliationKey,
        message: null,
      })
    })()
    return () => {
      active = false
    }
  }, [history.document.id, mountedMediaRecoveryRetryGeneration, sessionMode])

  const retryMountedMediaRecoveryReconciliation = useCallback(() => {
    mountedMediaRecoveryReconciledSessionRef.current = null
    setMountedMediaRecoveryRetryGeneration((current) => current + 1)
  }, [])

  const imageReplacementBlock = useCallback(
    (nodeId: string) =>
      imageReplacementBindingImpact(historyRef.current.document, nodeId)
        ?.message ?? null,
    []
  )

  const installImportedDocumentIntoCurrent = useCallback(
    (document: Document) => {
      templateSourceBySnapshotRef.current.set(
        historyRef.current.snapshotId,
        templateSourceContextRef.current
      )
      const result = replaceDocumentWithResult(historyRef.current, document, {
        label: "Import document",
      })
      const nextHistory = result.history
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
      pruneTemplateSourceContexts(nextHistory)
      notifyHistoryCommit(result.commit)
      installTemplateSourceContext(sourceContext)
      clearReviewJournal()
      captureSettledDraft()
      const nextPageId = document.pages.some(
        (page) => page.id === activePageIdRef.current
      )
        ? activePageIdRef.current
        : (document.pages[0]?.id ?? activePageIdRef.current)
      activePageIdRef.current = nextPageId
      setActivePageId(nextPageId)
      setSelection(null)
      return true
    },
    [
      captureSettledDraft,
      clearReviewJournal,
      installTemplateSourceContext,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const importDocumentFile = useCallback(
    async (file: File, signal?: AbortSignal) => {
      if (!allowMutation()) return false
      signal?.throwIfAborted()
      setDocumentError(null)
      const requestGeneration = sessionGenerationRef.current
      const requestDocumentId = historyRef.current.document.id
      const requestSnapshotId = historyRef.current.snapshotId
      const importRequestGeneration =
        documentImportRequestGenerationRef.current + 1
      documentImportRequestGenerationRef.current = importRequestGeneration
      const parsed = await parseDocumentImportFile(file, undefined, { signal })
      if (
        !mountedRef.current ||
        documentImportRequestGenerationRef.current !==
          importRequestGeneration ||
        sessionGenerationRef.current !== requestGeneration ||
        historyRef.current.document.id !== requestDocumentId
      ) {
        return false
      }
      if (historyRef.current.snapshotId !== requestSnapshotId) {
        setDocumentError(
          "The document changed while the import file was being read, so the import was not applied."
        )
        return false
      }
      signal?.throwIfAborted()
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
      if (parsed.recoveryManifest.requiresReview) {
        setPendingDocumentImportMediaReview({
          kind: "import",
          fileName: file.name,
          originalDocument: parsed.document,
          studioCandidateDocument: parsed.candidateDocument,
          manifest: parsed.recoveryManifest,
          anchor: {
            sessionGeneration: requestGeneration,
            documentId: requestDocumentId,
            historySnapshotId: requestSnapshotId,
          },
        })
        return true
      }
      try {
        return installImportedDocumentIntoCurrent(parsed.document)
      } catch (error) {
        setDocumentError(
          error instanceof Error
            ? `The document could not be imported: ${error.message}`
            : "The document could not be imported."
        )
        return false
      }
    },
    [allowMutation, installImportedDocumentIntoCurrent]
  )

  const openDocumentFile = useCallback(
    async (
      file: File,
      signal?: AbortSignal,
      onAdmissionComplete?: () => void
    ) => {
      if (draftRecoveryRef.current) return false
      signal?.throwIfAborted()
      setDocumentError(null)
      const requestGeneration = sessionGenerationRef.current
      const requestDocumentId = historyRef.current.document.id
      const requestSnapshotId = historyRef.current.snapshotId
      const importRequestGeneration =
        documentImportRequestGenerationRef.current + 1
      documentImportRequestGenerationRef.current = importRequestGeneration
      const parsed = await parseDocumentImportFile(file, undefined, { signal })
      if (
        !mountedRef.current ||
        documentImportRequestGenerationRef.current !==
          importRequestGeneration ||
        sessionGenerationRef.current !== requestGeneration ||
        historyRef.current.document.id !== requestDocumentId ||
        historyRef.current.snapshotId !== requestSnapshotId
      ) {
        setDocumentError(
          "The active document changed while the file was being reviewed, so it was not opened."
        )
        return false
      }
      signal?.throwIfAborted()
      if (!parsed.ok) {
        setDocumentError(
          `The document could not be opened: ${parsed.failure.message}`
        )
        return false
      }
      onAdmissionComplete?.()
      if (parsed.recoveryManifest.requiresReview) {
        setPendingDocumentImportMediaReview({
          kind: "open",
          fileName: file.name,
          originalDocument: parsed.document,
          studioCandidateDocument: parsed.candidateDocument,
          manifest: parsed.recoveryManifest,
          anchor: {
            sessionGeneration: requestGeneration,
            documentId: requestDocumentId,
            historySnapshotId: requestSnapshotId,
          },
        })
        return true
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

  const resolveDocumentImportMediaReview = useCallback(
    async (useStudioCopies: boolean) => {
      const pending = pendingDocumentImportMediaReview
      if (!pending) return false
      if (pending.kind === "import") {
        const anchor = pending.anchor
        if (
          !anchor ||
          sessionGenerationRef.current !== anchor.sessionGeneration ||
          historyRef.current.document.id !== anchor.documentId ||
          historyRef.current.snapshotId !== anchor.historySnapshotId
        ) {
          setDocumentError(
            "The document changed while its imported images were being reviewed. Start the import again."
          )
          setPendingDocumentImportMediaReview(null)
          return false
        }
        try {
          installImportedDocumentIntoCurrent(
            useStudioCopies
              ? (pending.studioCandidateDocument ?? pending.originalDocument)
              : pending.originalDocument
          )
          setPendingDocumentImportMediaReview(null)
          return true
        } catch (error) {
          setDocumentError(
            error instanceof Error
              ? `The document could not be imported: ${error.message}`
              : "The document could not be imported."
          )
          return false
        }
      }
      const anchor = pending.anchor
      if (
        !anchor ||
        sessionGenerationRef.current !== anchor.sessionGeneration ||
        historyRef.current.document.id !== anchor.documentId ||
        historyRef.current.snapshotId !== anchor.historySnapshotId
      ) {
        setDocumentError(
          "The active document changed while its imported images were being reviewed. Open the file again."
        )
        setPendingDocumentImportMediaReview(null)
        return false
      }
      const envelope: CurrentDraftEnvelope = {
        schemaVersion: 1,
        document: useStudioCopies
          ? (pending.studioCandidateDocument ?? pending.originalDocument)
          : pending.originalDocument,
        sourceContext: null,
      }
      const installed = await persistAndInstallSession(envelope, {
        kind: "import",
      })
      if (installed) setPendingDocumentImportMediaReview(null)
      return installed
    },
    [
      installImportedDocumentIntoCurrent,
      pendingDocumentImportMediaReview,
      persistAndInstallSession,
    ]
  )

  const cancelDocumentImportMediaReview = useCallback(() => {
    setPendingDocumentImportMediaReview(null)
  }, [])

  const importQuotationFile = useCallback(
    async (file: File, signal?: AbortSignal) => {
      if (!allowMutation()) return false
      signal?.throwIfAborted()
      setDocumentError(null)
      const requestGeneration = sessionGenerationRef.current
      const requestDocumentId = historyRef.current.document.id
      const requestSnapshotId = historyRef.current.snapshotId
      const importRequestGeneration =
        documentImportRequestGenerationRef.current + 1
      documentImportRequestGenerationRef.current = importRequestGeneration
      const importOwnershipChanged = () =>
        !mountedRef.current ||
        documentImportRequestGenerationRef.current !==
          importRequestGeneration ||
        sessionGenerationRef.current !== requestGeneration ||
        historyRef.current.document.id !== requestDocumentId
      try {
        const input = JSON.parse(
          await readBoundedDocumentImportText(
            file,
            signal,
            QUOTATION_IMPORT_MAX_JSON_BYTES
          )
        ) as unknown
        if (importOwnershipChanged()) {
          return false
        }
        if (historyRef.current.snapshotId !== requestSnapshotId) {
          setDocumentError(
            "The document changed while the quotation file was being read, so the import was not applied."
          )
          return false
        }
        signal?.throwIfAborted()
        if (!allowMutation()) return false
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
        const currentSource = templateSourceContextRef.current.quotationSource
        const isSameQuotation =
          currentSource?.source.quotationId ===
          payloadResult.data.source.quotationId
        const templateId = isSameQuotation
          ? templateSourceContextRef.current.quotationTemplateId
          : (requestedTemplateId ?? activeQuotationTemplateId)
        if (isSameQuotation && currentSource) {
          const activeComposition = templateSourceContextRef.current.composition
          if (activeComposition?.status !== "known") {
            throw new Error(
              "This quotation predates reliable composition tracking. Upgrade or replace it before refreshing from Stuwiz."
            )
          }
          if (
            activeComposition.composerVersion !== QUOTATION_COMPOSER_VERSION
          ) {
            throw new Error(
              "This quotation was generated by an older composer and cannot be refreshed automatically."
            )
          }
          if (quotationRefreshJournalRef.current.pending) {
            throw new Error(
              "Resolve or reject the pending quotation refresh before importing another source revision."
            )
          }
          if (pendingChangeSetRef.current) {
            throw new Error(
              "Resolve or discard the current Review proposal before refreshing quotation data."
            )
          }
          if (!activePersistenceSessionRef.current) {
            throw new Error(
              "Stuwiz refresh requires durable browser document storage. Save or reopen this document in a durable workspace first."
            )
          }
          const compositionTemplateId = quotationTemplateForDesignTemplate(
            activeComposition.template
          )
          const [baseIdentity, incomingIdentity] = await Promise.all([
            quotationSourceIdentity(currentSource),
            quotationSourceIdentity(payloadResult.data),
          ])
          if (incomingIdentity.sourceRevision < baseIdentity.sourceRevision) {
            throw new Error(
              `Stuwiz revision ${incomingIdentity.sourceRevision} is older than the linked revision ${baseIdentity.sourceRevision}.`
            )
          }
          if (incomingIdentity.sourceRevision === baseIdentity.sourceRevision) {
            if (
              incomingIdentity.sourceSnapshotId ===
              baseIdentity.sourceSnapshotId
            ) {
              setDocumentError(
                "This quotation is already linked to that exact Stuwiz revision."
              )
              return true
            }
            throw new Error(
              "Stuwiz returned different quotation data without advancing its source revision. The current document was preserved."
            )
          }
          const preparedAt = new Date().toISOString()
          const prepared = prepareQuotationRefresh({
            currentDocument: historyRef.current.document,
            currentSource,
            incomingSource: payloadResult.data,
            templateId,
            compositionTemplateId,
            now: preparedAt,
          })
          const baseDraftSnapshotId =
            activePersistenceSessionRef.current?.controller.draftSnapshotId ??
            activeRecordRef.current?.summary.draftSnapshotId ??
            requestSnapshotId
          const [baseContentSnapshotId, candidateContentSnapshotId] =
            await Promise.all([
              deriveDocumentSnapshotId(historyRef.current.document),
              quotationRefreshCandidateIdentity(prepared.document),
            ])
          const impact = {
            ...prepared.impact,
            changedSourcePaths: [...prepared.impact.changedSourcePaths],
            changedCategories: [...prepared.impact.changedCategories],
            businessChanges: prepared.impact.businessChanges.map((change) => ({
              ...change,
            })),
            conflicts: prepared.impact.conflicts.map((conflict) => ({
              ...conflict,
              properties: [...conflict.properties],
            })),
          }
          const collisionChoices = {}
          const proposalCoordinates = {
            documentId: historyRef.current.document.id,
            baseDocumentRevision: historyRef.current.document.revision,
            baseHistorySnapshotId: requestSnapshotId,
            baseDraftSnapshotId,
            base: baseIdentity,
            incoming: incomingIdentity,
            composerVersion: activeComposition.composerVersion,
            template: activeComposition.template,
            appearanceTemplateId: templateId,
            baseContentSnapshotId,
            candidateContentSnapshotId,
            impact,
            collisionChoices,
          }
          const pending: PendingQuotationRefresh = {
            id: `quotation-refresh-${crypto.randomUUID()}`,
            preparedAt,
            ...proposalCoordinates,
            incomingSource: payloadResult.data,
            candidateDocument: prepared.document,
            proposalId: await quotationRefreshProposalId(proposalCoordinates),
          }
          if (importOwnershipChanged()) return false
          if (historyRef.current.snapshotId !== requestSnapshotId) {
            setDocumentError(
              "The document changed while the quotation refresh was being prepared, so the preview was not installed."
            )
            return false
          }
          projectQuotationRefreshJournal(
            setPendingQuotationRefresh(
              quotationRefreshJournalRef.current,
              pending
            )
          )
          captureSettledDraft()
          return await flushActiveDraft()
        }
        if (currentSource) {
          throw new Error(
            "This file belongs to another Stuwiz quotation. Open it as a separate document instead of replacing this linked quotation."
          )
        }
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
        const designTemplate = requiredDesignTemplateForQuotation(templateId)
        const compositionContext = await waitForDocumentImportOperation(
          createKnownQuotationComposition(payloadResult.data, designTemplate),
          signal
        )
        if (importOwnershipChanged()) {
          return false
        }
        if (historyRef.current.snapshotId !== requestSnapshotId) {
          setDocumentError(
            "The document changed while the quotation was being prepared, so the import was not applied."
          )
          return false
        }
        signal?.throwIfAborted()
        if (!allowMutation()) return false
        templateSourceBySnapshotRef.current.set(
          historyRef.current.snapshotId,
          templateSourceContextRef.current
        )
        const result = replaceDocumentWithResult(historyRef.current, document, {
          label: "Import quotation source",
        })
        const nextHistory = result.history
        const sourceContext: TemplateSourceContext = {
          quotationSource: payloadResult.data,
          quotationTemplateId: templateId,
          designTemplate,
          composition: compositionContext,
        }
        historyRef.current = nextHistory
        templateSourceBySnapshotRef.current.set(
          nextHistory.snapshotId,
          sourceContext
        )
        setHistory(nextHistory)
        pruneTemplateSourceContexts(nextHistory)
        notifyHistoryCommit(result.commit)
        installTemplateSourceContext(sourceContext)
        clearReviewJournal()
        captureSettledDraft()
        const firstPageId = document.pages[0]?.id ?? "quotation-page-1"
        activePageIdRef.current = firstPageId
        setActivePageId(firstPageId)
        setSelection(null)
        setChangeSetError(null)
        return true
      } catch (error) {
        signal?.throwIfAborted()
        setDocumentError(
          error instanceof SyntaxError
            ? "This quotation file is not valid JSON."
            : error instanceof Error
              ? `The quotation could not be imported: ${error.message}`
              : "The quotation could not be imported."
        )
        return false
      }
    },
    [
      activeQuotationTemplateId,
      allowMutation,
      captureSettledDraft,
      clearReviewJournal,
      installTemplateSourceContext,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const chooseQuotationRefreshConflict = useCallback(
    async (semanticKey: string, choice: QuotationRefreshConflictPolicy) => {
      try {
        const currentJournal = quotationRefreshJournalRef.current
        const currentPending = currentJournal.pending
        const currentSource = templateSourceContextRef.current.quotationSource
        if (!currentPending || !currentSource) return false
        const journalWithChoice = chooseQuotationRefreshCollision(
          currentJournal,
          semanticKey,
          choice
        )
        const pendingWithChoice = journalWithChoice.pending
        if (!pendingWithChoice) return false
        const prepared = prepareQuotationRefresh({
          currentDocument: historyRef.current.document,
          currentSource,
          incomingSource: pendingWithChoice.incomingSource,
          templateId: pendingWithChoice.appearanceTemplateId,
          compositionTemplateId: quotationTemplateForDesignTemplate(
            pendingWithChoice.template
          ),
          collisionChoices: pendingWithChoice.collisionChoices,
          now: pendingWithChoice.preparedAt,
        })
        const candidateContentSnapshotId =
          await quotationRefreshCandidateIdentity(prepared.document)
        const impact = {
          ...prepared.impact,
          changedSourcePaths: [...prepared.impact.changedSourcePaths],
          changedCategories: [...prepared.impact.changedCategories],
          businessChanges: prepared.impact.businessChanges.map((change) => ({
            ...change,
          })),
          conflicts: prepared.impact.conflicts.map((conflict) => ({
            ...conflict,
            properties: [...conflict.properties],
          })),
        }
        const proposalCoordinates = {
          documentId: pendingWithChoice.documentId,
          baseDocumentRevision: pendingWithChoice.baseDocumentRevision,
          baseHistorySnapshotId: pendingWithChoice.baseHistorySnapshotId,
          baseDraftSnapshotId: pendingWithChoice.baseDraftSnapshotId,
          baseContentSnapshotId: pendingWithChoice.baseContentSnapshotId,
          candidateContentSnapshotId,
          base: pendingWithChoice.base,
          incoming: pendingWithChoice.incoming,
          composerVersion: pendingWithChoice.composerVersion,
          template: pendingWithChoice.template,
          appearanceTemplateId: pendingWithChoice.appearanceTemplateId,
          impact,
          collisionChoices: pendingWithChoice.collisionChoices,
        }
        const nextPending: PendingQuotationRefresh = {
          ...pendingWithChoice,
          candidateDocument: prepared.document,
          candidateContentSnapshotId,
          impact,
          proposalId: await quotationRefreshProposalId(proposalCoordinates),
        }
        if (
          quotationRefreshJournalRef.current.pending?.id !==
            currentPending.id ||
          historyRef.current.snapshotId !== currentPending.baseHistorySnapshotId
        ) {
          setDocumentError(
            "The quotation refresh changed while Studio was saving that choice."
          )
          return false
        }
        projectQuotationRefreshJournal(
          replacePendingQuotationRefresh(
            quotationRefreshJournalRef.current,
            nextPending
          )
        )
        setDocumentError(null)
        captureSettledDraft()
        return await flushActiveDraft()
      } catch (error) {
        setDocumentError(
          error instanceof Error
            ? error.message
            : "Studio could not save that refresh choice."
        )
        return false
      }
    },
    [captureSettledDraft, flushActiveDraft, projectQuotationRefreshJournal]
  )

  const rejectQuotationRefresh = useCallback(async () => {
    const pending = quotationRefreshJournalRef.current.pending
    if (!pending) return false
    try {
      if (quotationRefreshJournalRef.current.pending?.id !== pending.id) {
        return false
      }
      projectQuotationRefreshJournal(
        resolveQuotationRefresh(quotationRefreshJournalRef.current, {
          id: pending.id,
          decision: "rejected",
          decidedAt: new Date().toISOString(),
          base: pending.base,
          incoming: pending.incoming,
          composerVersion: pending.composerVersion,
          template: pending.template,
          appearanceTemplateId: pending.appearanceTemplateId,
          proposalId: pending.proposalId,
          impact: resolvedImpact(pending.impact),
          collisionChoices: pending.collisionChoices,
          baseContentSnapshotId: pending.baseContentSnapshotId,
          resultContentSnapshotId: null,
          resultDocumentRevision: null,
        })
      )
      setDocumentError(null)
      captureSettledDraft()
      return await flushActiveDraft()
    } catch (error) {
      setDocumentError(
        error instanceof Error
          ? error.message
          : "Studio could not reject the quotation refresh."
      )
      return false
    }
  }, [captureSettledDraft, flushActiveDraft, projectQuotationRefreshJournal])

  const acceptQuotationRefresh = useCallback(async () => {
    const pending = quotationRefreshJournalRef.current.pending
    const currentSource = templateSourceContextRef.current.quotationSource
    const activeComposition = templateSourceContextRef.current.composition
    if (!pending || !currentSource || activeComposition?.status !== "known") {
      return false
    }
    const unresolved = [
      ...new Set(
        pending.impact.conflicts
          .map((conflict) => conflict.semanticKey)
          .filter((semanticKey) => !pending.collisionChoices[semanticKey])
      ),
    ]
    if (unresolved.length) {
      setDocumentError(
        `Choose how to resolve ${unresolved.length} quotation refresh ${unresolved.length === 1 ? "collision" : "collisions"} before accepting.`
      )
      return false
    }
    if (
      historyRef.current.document.id !== pending.documentId ||
      historyRef.current.document.revision !== pending.baseDocumentRevision ||
      historyRef.current.snapshotId !== pending.baseHistorySnapshotId
    ) {
      setDocumentError(
        "The document changed after this quotation refresh was prepared. Reject it and import the latest Stuwiz revision again."
      )
      return false
    }
    try {
      const currentIdentity = await quotationSourceIdentity(currentSource)
      if (
        currentIdentity.sourceSnapshotId !== pending.base.sourceSnapshotId ||
        activeComposition.composerVersion !== pending.composerVersion ||
        activeComposition.template.id !== pending.template.id ||
        activeComposition.template.version !== pending.template.version ||
        templateSourceContextRef.current.quotationTemplateId !==
          pending.appearanceTemplateId
      ) {
        setDocumentError(
          "The linked quotation source or composer changed after this refresh was prepared."
        )
        return false
      }
      const proposalCoordinates = {
        documentId: pending.documentId,
        baseDocumentRevision: pending.baseDocumentRevision,
        baseHistorySnapshotId: pending.baseHistorySnapshotId,
        baseDraftSnapshotId: pending.baseDraftSnapshotId,
        baseContentSnapshotId: pending.baseContentSnapshotId,
        candidateContentSnapshotId: pending.candidateContentSnapshotId,
        base: pending.base,
        incoming: pending.incoming,
        composerVersion: pending.composerVersion,
        template: pending.template,
        appearanceTemplateId: pending.appearanceTemplateId,
        impact: pending.impact,
        collisionChoices: pending.collisionChoices,
      }
      if (
        (await quotationRefreshProposalId(proposalCoordinates)) !==
        pending.proposalId
      ) {
        setDocumentError(
          "The saved quotation refresh no longer matches its approval coordinates."
        )
        return false
      }
      const [baseContentSnapshotId, resultContentSnapshotId] =
        await Promise.all([
          deriveDocumentSnapshotId(historyRef.current.document),
          quotationRefreshCandidateIdentity(pending.candidateDocument),
        ])
      if (
        baseContentSnapshotId !== pending.baseContentSnapshotId ||
        resultContentSnapshotId !== pending.candidateContentSnapshotId
      ) {
        setDocumentError(
          "The saved quotation refresh candidate no longer matches its approved content."
        )
        return false
      }
      if (
        quotationRefreshJournalRef.current.pending?.id !== pending.id ||
        historyRef.current.snapshotId !== pending.baseHistorySnapshotId
      ) {
        setDocumentError(
          "The quotation refresh changed while Studio was verifying it."
        )
        return false
      }
      const composition = await createKnownQuotationComposition(
        pending.incomingSource,
        pending.template,
        pending.composerVersion
      )
      templateSourceBySnapshotRef.current.set(
        historyRef.current.snapshotId,
        templateSourceContextRef.current
      )
      const result = replaceDocumentWithResult(
        historyRef.current,
        pending.candidateDocument,
        {
          label: `Refresh quotation from Stuwiz revision ${pending.incoming.sourceRevision}`,
        }
      )
      const sourceContext: TemplateSourceContext = {
        quotationSource: pending.incomingSource,
        quotationTemplateId:
          templateSourceContextRef.current.quotationTemplateId,
        designTemplate: templateSourceContextRef.current.designTemplate,
        composition,
      }
      historyRef.current = result.history
      templateSourceBySnapshotRef.current.set(
        result.history.snapshotId,
        sourceContext
      )
      setHistory(result.history)
      pruneTemplateSourceContexts(result.history)
      notifyHistoryCommit(result.commit)
      installTemplateSourceContext(sourceContext)
      projectQuotationRefreshJournal(
        resolveQuotationRefresh(quotationRefreshJournalRef.current, {
          id: pending.id,
          decision: "accepted",
          decidedAt: new Date().toISOString(),
          base: pending.base,
          incoming: pending.incoming,
          composerVersion: pending.composerVersion,
          template: pending.template,
          appearanceTemplateId: pending.appearanceTemplateId,
          proposalId: pending.proposalId,
          impact: resolvedImpact(pending.impact),
          collisionChoices: pending.collisionChoices,
          baseContentSnapshotId,
          resultContentSnapshotId,
          resultDocumentRevision: result.history.document.revision,
        })
      )
      const nextPageId = result.history.document.pages.some(
        (page) => page.id === activePageIdRef.current
      )
        ? activePageIdRef.current
        : result.history.document.pages[0]?.id
      if (nextPageId) {
        activePageIdRef.current = nextPageId
        setActivePageId(nextPageId)
      }
      setSelection(null)
      setDocumentError(null)
      captureSettledDraft()
      return await flushActiveDraft()
    } catch (error) {
      setDocumentError(
        error instanceof Error
          ? error.message
          : "Studio could not apply the quotation refresh."
      )
      return false
    }
  }, [
    captureSettledDraft,
    flushActiveDraft,
    installTemplateSourceContext,
    notifyHistoryCommit,
    projectQuotationRefreshJournal,
    pruneTemplateSourceContexts,
  ])

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
            componentInstances: clone.componentInstances,
            bindings: clone.bindings,
            variableBindings: clone.variableBindings,
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
            componentInstances: clone.componentInstances,
            bindings: clone.bindings,
            variableBindings: clone.variableBindings,
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

  const createMaskGroup = useCallback(
    (
      sourceNodeIds: readonly [string, ...string[]],
      parentGroupId: string | null
    ) => {
      const document = historyRef.current.document
      const nodeIds =
        selection?.pageId === activePageId ? selection.nodeIds : []
      if (nodeIds.length < 2) return false
      const groupId = `mask-${crypto.randomUUID()}`
      const committed = commit(
        [
          {
            type: "create_mask_group",
            expectedRevision: document.revision,
            pageId: activePageId,
            groupId,
            name: "Mask",
            nodeIds,
            sourceNodeIds: [...sourceNodeIds] as [string, ...string[]],
            maskType: "vector",
            ...(parentGroupId ? { parentGroupId } : {}),
          },
        ],
        { label: "Create mask" }
      )
      if (committed) setEditorSelection({ pageId: activePageId, nodeIds })
      return committed
    },
    [activePageId, commit, selection, setEditorSelection]
  )

  const releaseMaskGroup = useCallback(
    (groupId: string) => {
      const document = historyRef.current.document
      return commit(
        [
          {
            type: "release_mask_group",
            expectedRevision: document.revision,
            pageId: activePageId,
            groupId,
          },
        ],
        { label: "Release mask" }
      )
    },
    [activePageId, commit]
  )

  const setMaskType = useCallback(
    (groupId: string, maskType: "vector" | "alpha" | "luminance") => {
      const document = historyRef.current.document
      return commit(
        [
          {
            type: "set_mask_type",
            expectedRevision: document.revision,
            pageId: activePageId,
            groupId,
            maskType,
          },
        ],
        { label: "Change mask type" }
      )
    },
    [activePageId, commit]
  )

  const setMaskSources = useCallback(
    (groupId: string, sourceNodeIds: readonly [string, ...string[]]) => {
      const document = historyRef.current.document
      return commit(
        [
          {
            type: "set_mask_sources",
            expectedRevision: document.revision,
            pageId: activePageId,
            groupId,
            sourceNodeIds: [...sourceNodeIds] as [string, ...string[]],
          },
        ],
        { label: "Change mask sources" }
      )
    },
    [activePageId, commit]
  )

  const selectedGroupId = findSelectedGroupId(
    history.document,
    selection?.nodeIds ?? []
  )

  const createComponentFromSelection = useCallback(
    (requestedName?: string) => {
      const document = historyRef.current.document
      const nodeIds = selection?.nodeIds ?? []
      if (!nodeIds.length || selection?.pageId !== activePageId) return null
      let sourceGroupId = selectedGroupId
      const sourceGroup = sourceGroupId
        ? document.groups.find((group) => group.id === sourceGroupId)
        : undefined
      const name =
        requestedName?.trim() || sourceGroup?.name.trim() || "Component"
      const drafts: CommandDraft[] = []
      if (!sourceGroupId) {
        if (nodeIds.length < 2) {
          setDocumentError(
            "Select a complete group or at least two layers to create a component."
          )
          return null
        }
        sourceGroupId = `group-${crypto.randomUUID()}`
        drafts.push({
          type: "group_nodes",
          groupId: sourceGroupId,
          pageId: activePageId,
          name,
          nodeIds,
        })
      }
      const existing = document.components.find(
        (component) => component.sourceGroupId === sourceGroupId
      )
      if (existing) {
        setDocumentError(`${existing.name} is already a main component.`)
        return existing.id
      }
      const componentId = `component-${crypto.randomUUID()}`
      const variantId = `component-variant-${crypto.randomUUID()}`
      drafts.push({
        type: "create_component",
        component: {
          id: componentId,
          name,
          description: "",
          sourceGroupId,
          defaultVariantId: variantId,
          variants: [{ id: variantId, name: "Default", overrides: {} }],
        },
      })
      if (!commit(drafts, { label: `Create component “${name}”` })) return null
      setDocumentError(null)
      return componentId
    },
    [activePageId, commit, selectedGroupId, selection]
  )

  const createComponentInstance = useCallback(
    (componentId: string, center?: { x: number; y: number }) => {
      const document = historyRef.current.document
      const component = document.components.find(
        (candidate) => candidate.id === componentId
      )
      const page = document.pages.find(
        (candidate) => candidate.id === activePageId
      )
      const source = component
        ? componentSourceSubtree(document, component.sourceGroupId)
        : null
      if (!component || !page || !source?.nodeIds.length) {
        setDocumentError("This component is not available for insertion.")
        return null
      }
      const sourceNodes = source.nodeIds.flatMap((nodeId) => {
        const node = document.nodes.find((candidate) => candidate.id === nodeId)
        return node ? [node] : []
      })
      if (!sourceNodes.length) {
        setDocumentError("This component has no visible source layers.")
        return null
      }
      const left = Math.min(...sourceNodes.map((node) => node.x))
      const top = Math.min(...sourceNodes.map((node) => node.y))
      const right = Math.max(...sourceNodes.map((node) => node.x + node.width))
      const bottom = Math.max(
        ...sourceNodes.map((node) => node.y + node.height)
      )
      const width = right - left
      const height = bottom - top
      const placement = center ?? { x: page.width / 2, y: page.height / 2 }
      const instanceId = `component-instance-${crypto.randomUUID()}`
      const groupMappings = source.groupIds.map((sourceGroupId) => ({
        sourceGroupId,
        instanceGroupId: `component-instance-group-${crypto.randomUUID()}`,
      }))
      const nodeMappings = source.nodeIds.map((sourceNodeId) => ({
        sourceNodeId,
        instanceNodeId: `component-instance-node-${crypto.randomUUID()}`,
      }))
      const rootGroupId = groupMappings.find(
        (mapping) => mapping.sourceGroupId === component.sourceGroupId
      )?.instanceGroupId
      if (!rootGroupId) {
        setDocumentError("This component has an incomplete source hierarchy.")
        return null
      }
      const instanceNumber =
        document.componentInstances.filter(
          (instance) => instance.componentId === component.id
        ).length + 1
      const name = `${component.name} ${instanceNumber}`
      const instance = {
        id: instanceId,
        name,
        componentId: component.id,
        variantId: component.defaultVariantId,
        rootGroupId,
        transform: {
          x: Math.max(0, Math.min(page.width - width, placement.x - width / 2)),
          y: Math.max(
            0,
            Math.min(page.height - height, placement.y - height / 2)
          ),
          scale: 1,
          rotation: 0,
        },
        nodeMappings,
        groupMappings,
        overrides: {},
      }
      if (
        !commit(
          [
            {
              type: "create_component_instance",
              pageId: page.id,
              instance,
            },
          ],
          { label: `Insert “${component.name}” instance` }
        )
      ) {
        return null
      }
      setEditorSelection({
        pageId: page.id,
        nodeIds: nodeMappings.map((mapping) => mapping.instanceNodeId),
      })
      setDocumentError(null)
      return instanceId
    },
    [activePageId, commit, setEditorSelection]
  )

  const switchComponentVariant = useCallback(
    (instanceId: string, variantId: string) =>
      commit([{ type: "switch_component_variant", instanceId, variantId }], {
        label: "Switch component variant",
      }),
    [commit]
  )

  const updateComponent = useCallback(
    (
      componentId: string,
      patch: {
        name?: string
        description?: string
        defaultVariantId?: string
      }
    ) =>
      commit([{ type: "update_component", componentId, patch }], {
        label: "Update component",
      }),
    [commit]
  )

  const resetComponentLayerOverrides = useCallback(
    (instanceId: string, sourceNodeId: string) =>
      commit([{ type: "reset_component_override", instanceId, sourceNodeId }], {
        label: "Reset component layer overrides",
      }),
    [commit]
  )

  const resetAllComponentOverrides = useCallback(
    (instanceId: string) =>
      commit([{ type: "reset_all_component_overrides", instanceId }], {
        label: "Reset all component overrides",
      }),
    [commit]
  )

  const detachComponentInstance = useCallback(
    (instanceId: string) =>
      commit([{ type: "detach_component_instance", instanceId }], {
        label: "Detach component instance",
      }),
    [commit]
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
            componentInstances: clone.componentInstances,
            bindings: clone.bindings,
            variableBindings: clone.variableBindings,
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

  const reportTemplateActionFailure = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback
      if (
        (error instanceof DOMException && error.name === "AbortError") ||
        message === "Template action was superseded"
      ) {
        return
      }
      setTemplateActionError(message)
    },
    []
  )

  const isCurrentTemplateActionSnapshot = useCallback(
    (snapshot: TemplateActionSnapshot) =>
      historyRef.current.document.id === snapshot.document.id &&
      historyRef.current.document.revision === snapshot.document.revision &&
      historyRef.current.operationVersion === snapshot.documentGeneration &&
      templateSourceGenerationRef.current === snapshot.sourceGeneration &&
      reviewGenerationRef.current === snapshot.reviewGeneration &&
      Boolean(templateSourceContextRef.current.quotationSource) ===
        snapshot.hasQuotationSource,
    []
  )

  const installCreatedTemplateMutation = useCallback(
    async (
      mutationInput: TemplateMutation,
      intent: TemplateActionIntent,
      expected: TemplateActionSnapshot,
      ownsInstallation: () => boolean
    ) => {
      const canInstall = () =>
        ownsInstallation() && isCurrentTemplateActionSnapshot(expected)
      if (!canInstall()) {
        setDocumentError(
          "The active document changed while this template was being prepared. Choose the template again for the document now open."
        )
        return failedLibraryTemplateCreate()
      }
      const mutation = mutationInput as PreparedTemplateMutation
      const definition = builtInDesignTemplateRepository.get(
        intent.id,
        intent.version
      )
      const sourceContext =
        definition.kind === "quotation_style" &&
        mutation.sourceContext.quotationSource
          ? {
              ...mutation.sourceContext,
              composition: await createKnownQuotationComposition(
                mutation.sourceContext.quotationSource,
                { id: intent.id, version: intent.version },
                definition.composerVersion
              ),
            }
          : mutation.sourceContext
      if (!canInstall()) {
        setDocumentError(
          "The active document changed while this template was being prepared. Choose the template again for the document now open."
        )
        return failedLibraryTemplateCreate()
      }
      const installed = await persistAndInstallSession(
        {
          schemaVersion: 1,
          document: mutation.document,
          sourceContext,
        },
        {
          kind: "template",
          templateId: intent.id,
          templateVersion: intent.version,
        },
        canInstall
      )
      if (!installed) return failedLibraryTemplateCreate()
      setTemplateActionError(null)
      setDocumentError(null)
      return completedLibraryTemplateCreate(
        activeRecordRef.current,
        mutation.document.id
      )
    },
    [isCurrentTemplateActionSnapshot, persistAndInstallSession]
  )

  const installAppliedTemplateMutation = useCallback(
    (mutationInput: TemplateMutation) => {
      const mutation = mutationInput as PreparedTemplateMutation
      if (mutation.document === historyRef.current.document) return false
      templateSourceBySnapshotRef.current.set(
        historyRef.current.snapshotId,
        templateSourceContextRef.current
      )
      const result = replaceDocumentWithResult(
        historyRef.current,
        mutation.document,
        { label: mutation.label }
      )
      const nextHistory = result.history
      historyRef.current = nextHistory
      templateSourceBySnapshotRef.current.set(
        nextHistory.snapshotId,
        mutation.sourceContext
      )
      setHistory(nextHistory)
      pruneTemplateSourceContexts(nextHistory)
      notifyHistoryCommit(result.commit)
      installTemplateSourceContext(mutation.sourceContext)
      captureSettledDraft()
      const nextPageId = mutation.document.pages.some(
        (page) => page.id === activePageIdRef.current
      )
        ? activePageIdRef.current
        : mutation.document.pages[0].id
      activePageIdRef.current = nextPageId
      setActivePageId(nextPageId)
      setSelection((current) => reconcileSelection(current, mutation.document))
      setTemplateActionError(null)
      setDocumentError(null)
      return true
    },
    [
      captureSettledDraft,
      installTemplateSourceContext,
      notifyHistoryCommit,
      pruneTemplateSourceContexts,
    ]
  )

  const resolveCreateFromLibraryTemplate = useCallback(
    async (intent: TemplateActionIntent) => {
      if (!allowMutation(false, true)) return null
      if (activeLibraryTemplateInstallRef.current) {
        setTemplateActionError(
          "Wait for the current template document to finish opening."
        )
        return null
      }
      try {
        const resolved = await libraryTemplateActions.resolveCreate(intent)
        setTemplateActionError(null)
        return resolved
      } catch (error) {
        reportTemplateActionFailure(
          error,
          "The selected template could not create a document."
        )
        return null
      }
    },
    [allowMutation, libraryTemplateActions, reportTemplateActionFailure]
  )

  const confirmCreateFromLibraryTemplate = useCallback(
    async (resolved: ResolvedTemplateAction) => {
      if (!allowMutation(false, true)) return failedLibraryTemplateCreate()
      if (activeLibraryTemplateInstallRef.current)
        return failedLibraryTemplateCreate()
      try {
        const mutation = await libraryTemplateActions.confirmCreate(resolved)
        const token = Symbol("library-template-create")
        activeLibraryTemplateInstallRef.current = token
        const expected = readTemplateActionSnapshot()
        const ownsInstallation = () =>
          mountedRef.current &&
          activeLibraryTemplateInstallRef.current === token
        try {
          return await installCreatedTemplateMutation(
            mutation,
            resolved.intent,
            expected,
            ownsInstallation
          )
        } finally {
          if (activeLibraryTemplateInstallRef.current === token) {
            activeLibraryTemplateInstallRef.current = null
          }
        }
      } catch (error) {
        reportTemplateActionFailure(
          error,
          "The selected template could not create a document."
        )
        return failedLibraryTemplateCreate()
      }
    },
    [
      allowMutation,
      installCreatedTemplateMutation,
      libraryTemplateActions,
      readTemplateActionSnapshot,
      reportTemplateActionFailure,
    ]
  )

  const resolveApplyLibraryTemplate = useCallback(
    async (intent: TemplateActionIntent) => {
      if (!allowMutation()) return null
      if (activeLibraryTemplateInstallRef.current) {
        setTemplateActionError(
          "Wait for the current template document to finish opening."
        )
        return null
      }
      try {
        const resolved = await libraryTemplateActions.resolveApply(intent)
        setTemplateActionError(null)
        return resolved
      } catch (error) {
        reportTemplateActionFailure(
          error,
          "The selected template could not be applied."
        )
        return null
      }
    },
    [allowMutation, libraryTemplateActions, reportTemplateActionFailure]
  )

  const confirmApplyLibraryTemplate = useCallback(
    async (
      resolved: ResolvedTemplateAction,
      options: ApplyLibraryTemplateOptions = {}
    ) => {
      if (!allowMutation()) return false
      try {
        const mutation = await libraryTemplateActions.confirmApply(resolved)
        if (options.admitCommit?.() === false) return false
        return installAppliedTemplateMutation(mutation)
      } catch (error) {
        reportTemplateActionFailure(
          error,
          "The selected template could not be applied."
        )
        return false
      }
    },
    [
      allowMutation,
      installAppliedTemplateMutation,
      libraryTemplateActions,
      reportTemplateActionFailure,
    ]
  )

  const cancelLibraryTemplateAction = useCallback(() => {
    if (activeLibraryTemplateInstallRef.current) return
    libraryTemplateActions.cancel()
  }, [libraryTemplateActions])

  const createDocumentFromTemplate = useCallback(
    async (templateId: string, version: number) => {
      const resolved = await resolveCreateFromLibraryTemplate({
        itemKind: "template",
        id: templateId,
        version,
      })
      return resolved
        ? (await confirmCreateFromLibraryTemplate(resolved)).succeeded
        : false
    },
    [confirmCreateFromLibraryTemplate, resolveCreateFromLibraryTemplate]
  )

  const upgradeQuotationLayerOrganization = useCallback(() => {
    if (!allowMutation()) return false
    const currentSourceContext = templateSourceContextRef.current
    if (
      !currentSourceContext.quotationSource ||
      currentSourceContext.composition?.status === "known" ||
      (currentSourceContext.composition?.status === "legacy_unknown" &&
        currentSourceContext.composition.appliedMigrations.includes(
          QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID
        ))
    ) {
      setTemplateActionError(
        "This quotation does not need the legacy layer-organization update."
      )
      return false
    }
    const analysis = analyzeQuotationGroupOrganization(
      historyRef.current.document,
      currentSourceContext.quotationSource,
      currentSourceContext.quotationTemplateId
    )
    if (analysis.status !== "available") {
      setTemplateActionError(
        analysis.status === "blocked"
          ? analysis.reason
          : "This quotation does not need the legacy layer-organization update."
      )
      return false
    }
    try {
      templateSourceBySnapshotRef.current.set(
        historyRef.current.snapshotId,
        currentSourceContext
      )
      const document = applyQuotationGroupOrganization(
        historyRef.current.document,
        analysis
      )
      const appliedMigrations =
        currentSourceContext.composition?.status === "legacy_unknown"
          ? currentSourceContext.composition.appliedMigrations
          : []
      const sourceContext: TemplateSourceContext = {
        ...currentSourceContext,
        composition: {
          status: "legacy_unknown",
          appliedMigrations: [
            ...new Set([
              ...appliedMigrations,
              QUOTATION_GROUP_ORGANIZATION_MIGRATION_ID,
            ]),
          ],
        },
      }
      const result = replaceDocumentWithResult(historyRef.current, document, {
        label: "Organize quotation layers",
      })
      const nextHistory = result.history
      historyRef.current = nextHistory
      templateSourceBySnapshotRef.current.set(
        nextHistory.snapshotId,
        sourceContext
      )
      setHistory(nextHistory)
      pruneTemplateSourceContexts(nextHistory)
      notifyHistoryCommit(result.commit)
      installTemplateSourceContext(sourceContext)
      setSelection((current) => reconcileSelection(current, document))
      setTemplateActionError(null)
      setDocumentError(null)
      captureSettledDraft()
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Studio could not organize the quotation layers."
      setTemplateActionError(message)
      setDocumentError(message)
      return false
    }
  }, [
    allowMutation,
    captureSettledDraft,
    installTemplateSourceContext,
    notifyHistoryCommit,
    pruneTemplateSourceContexts,
  ])

  const createBlankDocument = useCallback(
    async (input: NewDocumentInput) => {
      if (!allowMutation(false, true)) return false
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
        schemaVersion: 5,
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
        components: [],
        componentInstances: [],
        typographyStyles: [],
        paintStyles: [],
        variables: [],
        variableBindings: [],
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

  const proposeDocumentGeneration = useCallback(
    (plan: GeneratedDocumentPlan) => {
      const current = pendingGeneratedDocumentRef.current
      if (current?.requestHash === plan.requestHash) return current
      if (pendingChangeSetRef.current) {
        throw new Error(
          "Resolve or discard the current change-set preview before reviewing a generated document."
        )
      }
      if (current) {
        if (plan.replacementForRequestId !== current.requestId) {
          throw new Error(
            "A generated document is already waiting in Review. Discard it or submit one explicit replacement."
          )
        }
        if (generationReplacementConsumedRef.current) {
          throw new Error(
            "This generated document has already been replaced once. Review or discard the replacement."
          )
        }
        generationReplacementConsumedRef.current = true
      } else {
        generationReplacementConsumedRef.current = false
      }
      pendingGeneratedDocumentRef.current = plan
      setPendingGeneratedDocument(plan)
      setGeneratedDocumentError(null)
      return plan
    },
    []
  )

  const discardGeneratedDocument = useCallback(() => {
    if (generationApprovalInFlightRef.current) return false
    pendingGeneratedDocumentRef.current = null
    generationReplacementConsumedRef.current = false
    setPendingGeneratedDocument(null)
    setGeneratedDocumentError(null)
    return true
  }, [])

  const createGeneratedDocument = useCallback(async () => {
    const plan = pendingGeneratedDocumentRef.current
    if (!plan || generationApprovalInFlightRef.current) return false
    if (!repositoryReadyRef.current || persistenceBlockedRef.current) {
      setGeneratedDocumentError(
        "Durable browser storage is unavailable. Studio kept the generated candidate in Review and did not create a session-only document."
      )
      return false
    }
    if (!allowMutation(false, true, false, true)) return false
    generationApprovalInFlightRef.current = true
    setIsCreatingGeneratedDocument(true)
    setGeneratedDocumentError(null)
    try {
      const designTemplate =
        plan.start.kind === "template"
          ? { id: plan.start.template.id, version: plan.start.template.version }
          : null
      const sourceContext: TemplateSourceContext = {
        quotationSource: null,
        quotationTemplateId: activeQuotationTemplateId,
        designTemplate,
      }
      const origin: DraftOrigin = designTemplate
        ? {
            kind: "template",
            templateId: designTemplate.id,
            templateVersion: designTemplate.version,
          }
        : { kind: "blank" }
      const installed = await persistAndInstallSession(
        {
          schemaVersion: 1,
          document: plan.candidate,
          sourceContext,
        },
        origin,
        () =>
          pendingGeneratedDocumentRef.current?.requestHash === plan.requestHash
      )
      if (!installed) {
        setGeneratedDocumentError(
          "Studio could not create the generated document. The candidate remains in Review."
        )
        return false
      }
      if (
        pendingGeneratedDocumentRef.current?.requestHash === plan.requestHash
      ) {
        pendingGeneratedDocumentRef.current = null
        generationReplacementConsumedRef.current = false
        setPendingGeneratedDocument(null)
      }
      return true
    } finally {
      generationApprovalInFlightRef.current = false
      setIsCreatingGeneratedDocument(false)
    }
  }, [activeQuotationTemplateId, allowMutation, persistAndInstallSession])

  const restoreDemoDocument = useCallback(async () => {
    if (!allowMutation(false, true)) return false
    const requestGeneration = sessionGenerationRef.current
    const requestDocumentId = historyRef.current.document.id
    const requestSnapshotId = historyRef.current.snapshotId
    const document = cloneTemplateDocument(quotationStarter.document)
    const designTemplate = requiredDesignTemplateForQuotation(
      quotationStarter.templateId
    )
    const composition = await createKnownQuotationComposition(
      quotationStarter.source,
      designTemplate
    )
    if (
      sessionGenerationRef.current !== requestGeneration ||
      historyRef.current.document.id !== requestDocumentId ||
      historyRef.current.snapshotId !== requestSnapshotId
    ) {
      setDocumentError(
        "The active document changed while the sample was being prepared. Open the sample again."
      )
      return false
    }
    const sourceContext: TemplateSourceContext = {
      quotationSource: quotationStarter.source,
      quotationTemplateId: quotationStarter.templateId,
      designTemplate,
      composition,
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
    setPublishError(null)
    attemptedVersionSyncRef.current.clear()
    publishedVersionsRef.current = []
    setPublishedVersions([])
    setPublishSyncStatus("idle")
    clearReviewJournal()
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
  }, [allowMutation, clearReviewJournal, persistAndInstallSession])

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
    if (imageCropController.hasActiveSession) {
      settleImageCrop("cancel")
      return
    }
    if (!allowMutation()) return
    const next = undoDocument(historyRef.current)
    if (next === historyRef.current) return
    historyRef.current = next
    setHistory(next)
    pruneTemplateSourceContexts(next)
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
    imageCropController,
    pruneTemplateSourceContexts,
    restoreTemplateSourceForSnapshot,
    settleImageCrop,
  ])

  const clearRedo = useCallback(() => {
    const current = historyRef.current
    const next = clearDocumentRedoHistory(current)
    if (next === current) return false
    historyRef.current = next
    setHistory(next)
    pruneTemplateSourceContexts(next)
    return true
  }, [pruneTemplateSourceContexts])

  const breakHistoryCoalescing = useCallback(() => {
    const current = historyRef.current
    const next = breakDocumentHistoryCoalescing(current)
    if (next === current) return false
    historyRef.current = next
    setHistory(next)
    pruneTemplateSourceContexts(next)
    return true
  }, [pruneTemplateSourceContexts])

  const redo = useCallback(() => {
    if (imageCropController.hasActiveSession) {
      settleImageCrop("cancel")
      return
    }
    if (!allowMutation()) return
    const next = redoDocument(historyRef.current)
    if (next === historyRef.current) return
    historyRef.current = next
    setHistory(next)
    pruneTemplateSourceContexts(next)
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
    imageCropController,
    pruneTemplateSourceContexts,
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

  // Public API identity belongs to the document. Quotation styles remain
  // composition metadata and must not merge or fork immutable API streams.
  const currentTemplateId = `template-${history.document.id}`
  const latestPublishedVersion = publishedVersionsForDocument(
    publishedVersions,
    currentTemplateId,
    history.document.id
  )
    .sort((a, b) => b.version - a.version)
    .at(0)
  const currentSnapshotPublishedVersion = publishedVersionsForDocument(
    publishedVersions,
    currentTemplateId,
    history.document.id
  ).find((version) => version.sourceSnapshotId === documentSnapshotId)

  useEffect(() => {
    if (sessionMode !== "workspace") return
    const controller = new AbortController()
    const documentId = history.document.id
    const sessionGeneration = sessionGenerationRef.current
    installPublishedVersions(
      publishedVersionsRef.current.filter(
        (version) =>
          version.templateId !== currentTemplateId ||
          version.document.id !== documentId
      )
    )
    if (!publicationOperationRef.current) {
      setPublishSyncStatus("idle")
      setPublishError(null)
    }
    void readLatestPublishedVersion(currentTemplateId, controller.signal)
      .then((version) => {
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          historyRef.current.document.id !== documentId ||
          sessionGenerationRef.current !== sessionGeneration
        ) {
          return
        }
        if (!version) return
        installPublishedVersions(
          replaceAuthoritativePublishedVersions(publishedVersionsRef.current, [
            version,
          ])
        )
        attemptedVersionSyncRef.current.add(version.id)
        if (!publicationOperationRef.current) {
          setPublishSyncStatus("synced")
          setPublishError(null)
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          historyRef.current.document.id !== documentId ||
          sessionGenerationRef.current !== sessionGeneration ||
          publicationOperationRef.current
        ) {
          return
        }
        setPublishError(
          error instanceof Error
            ? `Published version history could not be loaded: ${error.message}`
            : "Published version history could not be loaded."
        )
      })
    return () => controller.abort()
  }, [
    currentTemplateId,
    history.document.id,
    installPublishedVersions,
    publicationHistoryGeneration,
    sessionMode,
  ])

  useEffect(() => {
    const invalidationMessage = imageCropController.reconcile(
      history.document,
      activePageId
    )
    if (invalidationMessage) setDocumentError(invalidationMessage)
  }, [activePageId, history.document, imageCropController])

  const { canonicalPreviewDocument, previewDocument } =
    useDocumentPreviewProjection({
      document: history.document,
      snapshotId: history.snapshotId,
      pendingChangeSet,
      changeSetConflict,
      pendingImageReplacement,
      localAssetPreviewUrls: assetUrlsRef.current,
      assetVersion,
    })

  const conflictRecoveryModel = useMemo(() => {
    const conflict = conflictFromRecoveryState(conflictRecoveryState)
    const recoveryDocumentId =
      conflict?.documentId ??
      (conflictRecoveryState.status === "inactive"
        ? history.document.id
        : conflictRecoveryState.documentId)
    const recoveryDocumentName =
      conflict?.candidate.document.name ?? history.document.name
    let operation: DocumentConflictOperation = { status: "idle" }
    if (conflictRecoveryState.status === "working") {
      operation = {
        status: "running",
        action:
          conflictRecoveryState.action === "save_copy" ? "save_copy" : "reload",
        identity: conflict
          ? {
              conflictId: conflict.conflictId,
              candidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
            }
          : null,
        message:
          conflictRecoveryState.action === "save_copy"
            ? "Saving the preserved version as a new document…"
            : conflictRecoveryState.action === "materialize"
              ? "Preserving the open version…"
              : "Loading the saved version…",
      }
    } else if (conflictRecoveryState.status === "failed") {
      const safeFailureMessage =
        conflictRecoveryState.action === "save_copy" &&
        conflictRecoveryState.createdDocumentId
          ? "The copy is saved. Open it to continue editing on its canonical route."
          : conflictRecoveryState.action === "save_copy"
            ? "Studio could not save the copy. Your preserved version is still available."
            : conflictRecoveryState.action === "discover"
              ? "Studio could not verify the stored recovery information."
              : "Studio could not load the saved version. Your preserved version is still available."
      operation = {
        status: "failed",
        action:
          conflictRecoveryState.action === "save_copy" ? "save_copy" : "reload",
        identity: conflict
          ? {
              conflictId: conflict.conflictId,
              candidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
            }
          : null,
        message: safeFailureMessage,
        retryable: conflictRecoveryState.retryable,
        createdDocumentId: conflictRecoveryState.createdDocumentId,
      }
    }
    return projectDocumentConflictModel({
      documentId: recoveryDocumentId,
      documentName: recoveryDocumentName,
      saveState: localSaveState,
      verifiedConflicts: conflict ? [conflict] : [],
      discoveryFailure:
        conflictRecoveryState.status === "failed" &&
        conflictRecoveryState.action === "discover"
          ? {
              kind: "storage_unavailable",
              message: conflictRecoveryState.message,
            }
          : null,
      operation,
    })
  }, [
    conflictFromRecoveryState,
    conflictRecoveryState,
    history.document.id,
    history.document.name,
    localSaveState,
  ])

  const projectedLocalAssetPromotions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(localAssetPromotions).flatMap(([assetId, promotion]) =>
          promotion &&
          isLiveLocalAssetPromotionVisible(history.document, promotion)
            ? [
                [
                  assetId,
                  {
                    ...promotion,
                    undoable: hasCurrentRelinkUndo(
                      promotion.phase,
                      promotion.relinkCommitId,
                      history.past.map((entry) => entry.id)
                    ),
                  },
                ] as const,
              ]
            : []
        )
      ),
    [history.document, history.past, localAssetPromotions]
  )
  const mediaAdmissionReceipt = documentMediaAdmission?.receipt ?? null
  const activeAdmissionHead = activeRecordRef.current?.summary ?? null
  const isDocumentMediaAdmissionRestoreUnavailable = Boolean(
    mediaAdmissionReceipt?.restoredAt === null &&
    (documentMediaAdmissionRestoreUnavailable ||
      localSaveState.status === "external_change" ||
      localSaveState.status === "conflict" ||
      !activeAdmissionHead ||
      activeAdmissionHead.documentId !==
        mediaAdmissionReceipt.result.documentId ||
      activeAdmissionHead.recordVersion !==
        mediaAdmissionReceipt.result.recordVersion ||
      activeAdmissionHead.contentSnapshotId !==
        mediaAdmissionReceipt.result.contentSnapshotId ||
      activeAdmissionHead.draftSnapshotId !==
        mediaAdmissionReceipt.result.draftSnapshotId ||
      activeAdmissionHead.deletedAt !== mediaAdmissionReceipt.result.deletedAt)
  )

  return {
    sessionMode,
    routeSessionStatus,
    documentMediaAdmission,
    assetVersion,
    pendingDocumentImportMediaReview,
    resolveDocumentImportMediaReview,
    cancelDocumentImportMediaReview,
    mountedMediaRecoveryReconciliation,
    retryMountedMediaRecoveryReconciliation,
    keepDocumentMediaAdmission,
    restoreDocumentMediaAdmission,
    documentMediaAdmissionRestoreUnavailable:
      isDocumentMediaAdmissionRestoreUnavailable,
    downloadDocumentMediaAdmissionPreimage,
    saveDocumentMediaAdmissionPreimageAsCopy,
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
    getImageReplacementOutputAdmission,
    captureImageReplacementOutputAdmissionLease,
    assertImageReplacementOutputAdmissionLease,
    selectedNodes,
    selectedGroupId,
    localSaveState,
    setSeparateDocumentTransition,
    conflictRecoveryState,
    conflictRecoveryModel,
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
    localAssetPromotions: projectedLocalAssetPromotions,
    localMediaRecoveryOperations,
    documentError,
    templateActionError,
    draftRecovery,
    draftRecoveryNotice,
    pendingChangeSet,
    pendingGeneratedDocument,
    generatedDocumentError,
    isCreatingGeneratedDocument,
    lastResolvedChangeSet,
    reviewJournal,
    quotationRefreshJournal,
    changeSetConflict,
    changeSetError,
    isApplyingChangeSet,
    publishedVersions,
    latestPublishedVersion,
    currentSnapshotPublishedVersion,
    currentTemplateId,
    quotationSource,
    activeQuotationTemplateId,
    activeDesignTemplate,
    activeQuotationComposition,
    quotationGroupOrganization,
    publishError,
    publishSyncStatus,
    selectPage,
    setSelection: setEditorSelection,
    setCanvasSelection,
    updateNodes,
    updateNode,
    setImagePlacement,
    setImageFrameMask,
    runImagePlacementCommand,
    runImageFrameCommand,
    updateSelectionNodes,
    transformSelectionNodes,
    createTypographyStyle,
    updateTypographyStyle,
    deleteTypographyStyle,
    applyTypographyStyle,
    detachTypographyStyle,
    createPaintStyle,
    updatePaintStyle,
    deletePaintStyle,
    applyPaintStyle,
    detachPaintStyle,
    createVariable,
    updateVariable,
    deleteVariable,
    bindVariable,
    unbindVariable,
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
    proposeDocumentGeneration,
    discardGeneratedDocument,
    createGeneratedDocument,
    decideOperation,
    decideAllOperations,
    applyChangeSet,
    discardChangeSet,
    publishTemplate,
    cancelPublication,
    addText,
    addRectangle,
    addEllipse,
    addLine,
    addIcon,
    addImageFile,
    performLibraryMediaAction,
    replaceImageFile,
    startLocalAssetPromotion,
    cancelLocalAssetPromotion,
    useStudioCopyForLocalAsset,
    locateMissingLocalAsset,
    keepLocatedFileAsNewLocalAsset,
    chooseManagedImageForLocalAsset,
    removeMissingLocalAsset,
    retryLocalMediaRecoverySave,
    cancelLocalMediaRecovery,
    reportImageReplacementRendererState,
    registerImageReplacementRendererOwner,
    imageReplacementBlock,
    importDocumentFile,
    openDocumentFile,
    importQuotationFile,
    chooseQuotationRefreshConflict,
    acceptQuotationRefresh,
    rejectQuotationRefresh,
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
    createMaskGroup,
    releaseMaskGroup,
    setMaskType,
    setMaskSources,
    createComponentFromSelection,
    createComponentInstance,
    switchComponentVariant,
    updateComponent,
    resetComponentLayerOverrides,
    resetAllComponentOverrides,
    detachComponentInstance,
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
    resolveCreateFromLibraryTemplate,
    confirmCreateFromLibraryTemplate,
    resolveApplyLibraryTemplate,
    confirmApplyLibraryTemplate,
    cancelLibraryTemplateAction,
    createDocumentFromTemplate,
    upgradeQuotationLayerOrganization,
    restoreDemoDocument,
    openStoredDocument,
    continueSessionDocument,
    flushActiveDraft,
    getActiveDocumentId,
    getCurrentDocumentSnapshot,
    retryActiveDraftSave,
    discoverDocumentConflict,
    materializeExternalChangeConflict,
    reloadSavedAfterConflict,
    saveConflictAsCopy,
    returnToDocumentsFromConflictRecovery,
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
