import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT,
  assetReferenceKeysForSource,
  extractAssetReferences,
  libraryMediaDetailSchema,
  localAssetSource,
} from "@webmcp/document"
import type { Document, LibraryMediaDetail } from "@webmcp/document"
import {
  AlertCircleIcon,
  CloudIcon,
  HardDriveIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@webmcp/ui/components/sheet"
import {
  AssetCard,
  isUploadActive,
  LocalAssetCard,
  MissingLocalAssetRecoveryCard,
  nextManagedUploadClaims,
  RepositoryNotice,
  UploadQueue,
} from "./asset-library-components"
import type {
  LocalMediaRecoveryMappingState,
  LocalMediaRecoveryDeviceState,
  LocalMediaRecoveryOperationState,
  UploadQueueItem,
} from "./asset-library-components"
import {
  assetReferenceUsage,
  formatStoragePercentage,
  localMediaRecoveryImpact,
  localMediaRecoveryImpactForReferenceKeys,
  missingLocalAssetIds,
  readableMediaError,
  sortLocalUploadsByCreatedAt,
  sortManagedMediaAssets,
} from "./asset-library-model"
import type { LocalMediaRecoveryImpact } from "./asset-library-model"
import { LibraryMediaBrowser } from "../../content/library/library-media-browser"
import type {
  LibraryMediaIntent,
  LibraryMediaScope,
} from "../../content/library/library-media-browser"
import { formatAssetBytes } from "./local-asset-model"
import {
  archiveLocalAsset,
  inspectRequestedLocalAssets,
  listLocalAssetInventory,
  localAssetStorageSummary,
} from "./local-asset-store"
import type {
  LocalAssetAdmissionState,
  LocalAssetStorageSummary,
  LocalAssetSummary,
} from "./local-asset-store"
import type { LocalAssetPromotionViewState } from "./use-document-editor"
import type { DocumentRouteMediaAdmission } from "./document-route-admission"
import {
  readLocalAssetPromotionJournal,
  subscribeToLocalAssetPromotionJournal,
} from "./local-asset-promotion-journal"
import type { LocalAssetPromotionJournal } from "./local-asset-promotion-journal"
import { resolveLocalAssetPromotions } from "./local-asset-promotion-client"
import { hashLocalAssetBlobSha256 } from "./local-asset-promotion-owner"
import {
  hasExactManagedProjection,
  isLiveLocalAssetPromotionVisible,
  sameReferenceKeys,
} from "./local-asset-relink-projection"
import { MEDIA_UPLOAD_ACCEPT, validateMediaFile } from "./media-file-policy"
import {
  archiveManagedMedia,
  getManagedMediaDeletionImpact,
  listManagedMedia,
  managedMediaErrorHasUnknownCommitStatus,
  managedMediaErrorIsRetryable,
  managedMediaContentUrl,
  ManagedMediaError,
  subscribeManagedMediaMutations,
  uploadManagedMedia,
} from "./managed-media-repository"
import type {
  ManagedMediaAsset,
  ManagedMediaDeletionImpact,
  ManagedMediaList,
} from "./managed-media-repository"

export type ManagedRecoverySelectionResult =
  boolean | { ok: boolean; message?: string }

export type AssetLibraryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "insert" | "replace" | "assign_field" | "recover-local"
  targetName?: string
  document: Document
  documentMediaAdmission?: DocumentRouteMediaAdmission | null
  localAssetRevision?: number
  recoveryMutationDisabledReason?: string | null
  mediaScope: LibraryMediaScope
  pendingIdentity?: string | null
  actionError?: string | null
  actionsEnabled?: boolean
  onMediaScopeChange: (scope: LibraryMediaScope) => void
  onMediaSelect: (intent: LibraryMediaIntent) => void
  resolveUploadedMediaDetail: (
    asset: ManagedMediaAsset,
    signal: AbortSignal
  ) => Promise<LibraryMediaDetail | null>
  onRecoveryManagedSelect?: (
    asset: ManagedMediaAsset
  ) => Promise<ManagedRecoverySelectionResult> | ManagedRecoverySelectionResult
  onLocateMissingLocalAsset?: (assetId: string, file: File) => void
  onKeepLocatedFileAsNewLocalAsset?: (assetId: string) => void
  onUseStudioCopyForLocalAsset?: (
    assetId: string,
    confirmIdentityConflict?: boolean
  ) => void
  onChooseStudioImageForLocalAsset?: (assetId: string) => void
  onRemoveMissingLocalAsset?: (assetId: string, referenceKey?: string) => void
  onRetryLocalMediaRecovery?: (assetId: string) => void
  onCancelLocalMediaRecovery?: (assetId: string) => void
  localMediaRecoveryOperations?: Readonly<
    Partial<Record<string, LocalMediaRecoveryOperationState>>
  >
  onNavigateToReference?: (reference: {
    nodeId: string | null
    pageId: string | null
    fieldId: string | null
    outputId?: string | null
  }) => void
  localAssetPromotions?: Readonly<
    Partial<Record<string, LocalAssetPromotionViewState>>
  >
  onPromoteLocalAsset?: (assetId: string) => void
  onCancelLocalAssetPromotion?: (assetId: string) => void
}

export type LocalMediaRecoveryReferenceRow = Readonly<{
  key: string
  label: string
  detail: string
  nodeId: string | null
  pageId: string | null
  fieldId: string | null
  outputId?: string | null
  clearReferenceKey?: string | null
  clearDisabledReason?: string | null
}>

export function localMediaRecoveryReferenceRows(
  document: Document,
  impact: LocalMediaRecoveryImpact
): LocalMediaRecoveryReferenceRow[] {
  const canonicalReferences = extractAssetReferences(document).filter(
    (reference) => reference.source === impact.source
  )
  return [
    ...impact.referenceKeys
      .filter((key) => key.startsWith("field/"))
      .map((referenceKey) => {
        const [, fieldId, slot] = referenceKey.split("/")
        const canonicalReference = canonicalReferences.find(
          (reference) => reference.key === referenceKey
        )
        const field = document.fields.find(
          (candidate) => candidate.id === fieldId
        )
        return {
          key: `field:${fieldId}:${slot}`,
          label: field?.label ?? fieldId,
          detail:
            slot === "current" ? "Current field value" : "Default field value",
          nodeId: null,
          pageId: null,
          fieldId,
          clearReferenceKey: referenceKey,
          clearDisabledReason: field?.required
            ? "Required fields need a replacement and cannot be cleared."
            : slot === "current" &&
                canonicalReference?.projectedNodeIds.some((nodeId) =>
                  impact.lockedNodeIds.includes(nodeId)
                )
              ? "Unlock every projected layer before clearing this current field value."
              : null,
        }
      }),
    ...impact.directNodeIds.map((nodeId) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId)
      const page = document.pages.find((candidate) =>
        candidate.nodeIds.includes(nodeId)
      )
      return {
        key: `node:${nodeId}`,
        label: node?.name ?? nodeId,
        detail: impact.projectedNodeIds.includes(nodeId)
          ? `Bound layer${page ? ` on ${page.name}` : ""}`
          : (page?.name ?? "Document layer"),
        nodeId,
        pageId: page?.id ?? null,
        fieldId: null,
        clearReferenceKey: impact.referenceKeys.includes(`node/${nodeId}/src`)
          ? `node/${nodeId}/src`
          : null,
        clearDisabledReason: impact.projectedNodeIds.includes(nodeId)
          ? "Clear the owning current field value for this bound layer."
          : impact.lockedNodeIds.includes(nodeId)
            ? "Unlock this layer before removing it."
            : null,
      }
    }),
    ...impact.pageIds.map((pageId) => ({
      key: `page:${pageId}`,
      label:
        document.pages.find((candidate) => candidate.id === pageId)?.name ??
        pageId,
      detail: "Affected page",
      nodeId: null,
      pageId,
      fieldId: null,
    })),
    ...impact.outputIds.map((outputId) => {
      const output = document.outputs.find(
        (candidate) => candidate.id === outputId
      )
      return {
        key: `output:${outputId}`,
        label: output?.name ?? outputId,
        detail: "Affected output",
        nodeId: null,
        pageId:
          output?.pageIds.find((candidate) =>
            impact.pageIds.includes(candidate)
          ) ?? null,
        fieldId: null,
        outputId,
      }
    }),
  ]
}

export function displayedLocalMediaRecoveryOperation(
  operation: LocalMediaRecoveryOperationState | undefined,
  liveReferenceCount: number
) {
  return operation?.completionKind === "relinked" && liveReferenceCount > 0
    ? undefined
    : operation
}

type RepositoryStatus = "idle" | "loading" | "ready" | "error"
type ManagedRepositoryState = Omit<ManagedMediaList, "storage"> & {
  storage?: ManagedMediaList["storage"]
  status: RepositoryStatus
  error: string | null
}
type DeleteReview = {
  kind: "local" | "managed"
  id: string
  name: string
  status: "checking" | "blocked" | "ready" | "deleting" | "error"
  nodeIds: string[]
  pageIds: string[]
  fieldIds: string[]
  serverImpact: ManagedMediaDeletionImpact | null
  error: string | null
}

const emptyManagedState = (): ManagedRepositoryState => ({
  assets: [],
  nextCursor: null,
  storage: undefined,
  status: "idle",
  error: null,
})

const serverReferenceCount = (impact: ManagedMediaDeletionImpact | null) =>
  impact ? impact.currentReferences + impact.publishedReferences : 0

const exactUploadedMediaDetail = (
  asset: ManagedMediaAsset,
  input: LibraryMediaDetail | null
) => {
  if (!input) return null
  const parsed = libraryMediaDetailSchema.safeParse(structuredClone(input))
  if (!parsed.success) return null
  const detail = parsed.data
  return detail.summary.mediaSource === "managed" &&
    detail.summary.id === asset.id &&
    detail.summary.mimeType === asset.mediaType &&
    detail.summary.bytes === asset.bytes &&
    detail.summary.dimensions.width === asset.width &&
    detail.summary.dimensions.height === asset.height &&
    detail.selectionIdentity.source === "managed" &&
    detail.selectionIdentity.assetId === asset.id
    ? detail
    : null
}

const mediaIntentFromDetail = (
  detail: LibraryMediaDetail
): LibraryMediaIntent =>
  Object.freeze({
    itemKind: "media",
    id: detail.summary.id,
    version: detail.summary.version,
    mediaSource: detail.summary.mediaSource,
    detail,
    selectionIdentity: detail.selectionIdentity,
  })

const MAX_CONCURRENT_MANAGED_UPLOADS = 3
const activePromotionPhases = new Set<LocalAssetPromotionViewState["phase"]>([
  "preparing",
  "queued",
  "hashing",
  "reconciling",
  "uploading",
  "relinking",
  "saving",
  "cancelling",
])
const locallyAuthoritativePromotionPhases = new Set<
  LocalAssetPromotionViewState["phase"]
>([...activePromotionPhases, "updating_recent", "complete"])

export const chooseLocalAssetPromotionProjection = (
  live: LocalAssetPromotionViewState | null,
  persisted: LocalAssetPromotionViewState | null
) =>
  live && locallyAuthoritativePromotionPhases.has(live.phase)
    ? live
    : (persisted ?? live)

export const projectLiveLocalAssetPromotion = (
  promotion: LocalAssetPromotionViewState,
  document: Document,
  localAssetId: string
): LocalAssetPromotionViewState | null => {
  return isLiveLocalAssetPromotionVisible(document, {
    ...promotion,
    localAssetId,
  })
    ? promotion
    : null
}

export const projectPersistedLocalAssetPromotion = (
  journal: LocalAssetPromotionJournal,
  document: Document,
  localAssetId: string,
  now = Date.now()
): LocalAssetPromotionViewState | null => {
  const complete = journal.state === "complete"
  const localReferenceKeys = assetReferenceKeysForSource(
    document,
    localAssetSource(localAssetId)
  )
  const exactLocalSource = sameReferenceKeys(
    localReferenceKeys,
    journal.expectedReferenceKeys
  )
  const exactSourceTarget =
    document.id === journal.sourceDocumentId &&
    localReferenceKeys.length === 0 &&
    journal.managedAssetId !== null &&
    hasExactManagedProjection(
      document,
      journal.managedAssetId,
      journal.expectedReferenceKeys
    )
  if (
    journal.errorCode === "local_relink_conflict" &&
    document.id === journal.sourceDocumentId &&
    !exactLocalSource &&
    !exactSourceTarget
  ) {
    return {
      operationId: `journal-${journal.revision}`,
      localAssetId,
      sourceDocumentId: journal.sourceDocumentId,
      expectedReferenceKeys: journal.expectedReferenceKeys,
      managedAssetId: journal.managedAssetId,
      relinkCommitId: null,
      phase: "conflict",
      loaded: null,
      total: null,
      message:
        "Backed up, relink not applied. The managed image references no longer match this document.",
      retryable: false,
      undoable: false,
    }
  }
  const activelyOwnedElsewhere =
    journal.lease !== null && Date.parse(journal.lease.expiresAt) > now
  if (activelyOwnedElsewhere && localReferenceKeys.length > 0) {
    return {
      operationId: `journal-${journal.revision}`,
      localAssetId,
      sourceDocumentId: journal.sourceDocumentId,
      expectedReferenceKeys: journal.expectedReferenceKeys,
      managedAssetId: journal.managedAssetId,
      relinkCommitId: null,
      phase: "reconciling",
      loaded: null,
      total: null,
      message: "Another Studio tab is continuing this image.",
      retryable: false,
      undoable: false,
    }
  }
  if (complete && !exactSourceTarget) return null
  const backedUp = journal.state === "mapped" || journal.state === "relinking"
  const needsRecent = journal.state === "marking_used"
  const checkpointedRelink =
    journal.state === "relinking" && journal.relinkResultKind !== null
  if (backedUp && !checkpointedRelink && !exactLocalSource) return null
  if ((checkpointedRelink || needsRecent) && !exactSourceTarget) return null
  if (!complete && !backedUp && !needsRecent) return null
  return {
    operationId: `journal-${journal.revision}`,
    localAssetId,
    sourceDocumentId: journal.sourceDocumentId,
    expectedReferenceKeys: journal.expectedReferenceKeys,
    managedAssetId: journal.managedAssetId,
    relinkCommitId: null,
    phase: complete
      ? "complete"
      : activelyOwnedElsewhere
        ? "reconciling"
        : backedUp
          ? "backed_up"
          : "failed",
    loaded: null,
    total: null,
    message: complete
      ? null
      : activelyOwnedElsewhere
        ? "Another Studio tab is continuing this image."
        : needsRecent
          ? "The design is safely relinked. Retry to finish updating Recent."
          : "Backed up, relink not applied",
    retryable: !complete && !activelyOwnedElsewhere,
    undoable: false,
  }
}

export function AssetLibraryDialog({
  open,
  onOpenChange,
  mode,
  targetName,
  document,
  documentMediaAdmission = null,
  localAssetRevision = 0,
  recoveryMutationDisabledReason = null,
  mediaScope,
  pendingIdentity = null,
  actionError = null,
  actionsEnabled = true,
  onMediaScopeChange,
  onMediaSelect,
  resolveUploadedMediaDetail,
  onRecoveryManagedSelect,
  onLocateMissingLocalAsset,
  onKeepLocatedFileAsNewLocalAsset,
  onUseStudioCopyForLocalAsset,
  onChooseStudioImageForLocalAsset,
  onRemoveMissingLocalAsset,
  onRetryLocalMediaRecovery,
  onCancelLocalMediaRecovery,
  localMediaRecoveryOperations = {},
  onNavigateToReference,
  localAssetPromotions = {},
  onPromoteLocalAsset,
  onCancelLocalAssetPromotion,
}: AssetLibraryDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadCancelsRef = useRef(new Map<string, () => void>())
  const claimedUploadIdsRef = useRef(new Set<string>())
  const uploadAttemptByQueueIdRef = useRef(new Map<string, number>())
  const managedRequestRef = useRef<AbortController | null>(null)
  const managedPaginationRequestRef = useRef<AbortController | null>(null)
  const managedRequestGenerationRef = useRef(0)
  const [managementOpen, setManagementOpen] = useState(false)
  const [localAssets, setLocalAssets] = useState<LocalAssetSummary[]>([])
  const [healthyReferencedLocalAssetIds, setHealthyReferencedLocalAssetIds] =
    useState<string[]>([])
  const [localInspectionStates, setLocalInspectionStates] = useState<
    Partial<Record<string, LocalAssetAdmissionState>>
  >({})
  const [localRecoveryDeviceStates, setLocalRecoveryDeviceStates] = useState<
    Partial<Record<string, LocalMediaRecoveryDeviceState>>
  >({})
  const [localIntegrityReady, setLocalIntegrityReady] = useState(false)
  const [localStorage, setLocalStorage] =
    useState<LocalAssetStorageSummary | null>(null)
  const [localStatus, setLocalStatus] = useState<RepositoryStatus>("idle")
  const [localError, setLocalError] = useState<string | null>(null)
  const [managedUploads, setManagedUploads] =
    useState<ManagedRepositoryState>(emptyManagedState)
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [previewFailures, setPreviewFailures] = useState<Set<string>>(
    () => new Set()
  )
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [dialogNotice, setDialogNotice] = useState<string | null>(null)
  const [deleteReview, setDeleteReview] = useState<DeleteReview | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [resolvedUploadedMedia, setResolvedUploadedMedia] = useState<
    Readonly<Partial<Record<string, LibraryMediaDetail>>>
  >({})
  const [persistedLocalAssetPromotionJournals, setPersistedPromotionJournals] =
    useState<Partial<Record<string, LocalAssetPromotionJournal>>>({})
  const [missingMappingStates, setMissingMappingStates] = useState<
    Partial<Record<string, LocalMediaRecoveryMappingState>>
  >({})
  const [missingMappingGeneration, setMissingMappingGeneration] = useState(0)
  const retainedRecoveryImpactsRef = useRef(
    new Map<string, ReturnType<typeof localMediaRecoveryImpact>>()
  )

  const hasActiveUploads = uploadQueue.some(isUploadActive)
  const hasCriticalPromotion = Object.values(localAssetPromotions).some(
    (promotion) => promotion?.phase === "saving"
  )
  const hasActiveRecovery = Object.values(localMediaRecoveryOperations).some(
    (operation) =>
      operation?.phase === "preparing" ||
      operation?.phase === "cancelling" ||
      operation?.phase === "saving"
  )
  const exactActionPending =
    mode !== "recover-local" && (pendingIdentity !== null || !actionsEnabled)

  useEffect(() => {
    if (!open || mode === "recover-local") setManagementOpen(false)
  }, [mode, open])

  useEffect(() => {
    if (!open || !localAssets.length) return
    let disposed = false
    let generation = 0
    let leaseExpiryTimer: number | null = null
    const refresh = async () => {
      const requestedGeneration = generation + 1
      generation = requestedGeneration
      const entries = await Promise.all(
        localAssets.map(async (asset) => {
          try {
            const read = await readLocalAssetPromotionJournal(asset.id)
            if (read.status !== "ready") return null
            return {
              journal: read.journal,
              leaseExpiresAt: read.journal.lease?.expiresAt ?? null,
            }
          } catch {
            return null
          }
        })
      )
      if (disposed || requestedGeneration !== generation) return
      if (leaseExpiryTimer !== null) window.clearTimeout(leaseExpiryTimer)
      const now = Date.now()
      const nearestLeaseExpiry = entries
        .map((entry) =>
          entry?.leaseExpiresAt ? Date.parse(entry.leaseExpiresAt) : NaN
        )
        .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > now)
        .sort((left, right) => left - right)
        .at(0)
      if (nearestLeaseExpiry !== undefined) {
        leaseExpiryTimer = window.setTimeout(
          () => void refresh(),
          Math.max(1, nearestLeaseExpiry - now + 1)
        )
      }
      setPersistedPromotionJournals(
        Object.fromEntries(
          entries
            .map((entry) => entry?.journal ?? null)
            .filter((entry) => entry !== null)
            .map((entry) => [entry.localAssetId, entry])
        )
      )
    }
    void refresh()
    const unsubscribe = subscribeToLocalAssetPromotionJournal(() => {
      void refresh()
      setMissingMappingGeneration((current) => current + 1)
    })
    return () => {
      disposed = true
      generation += 1
      if (leaseExpiryTimer !== null) window.clearTimeout(leaseExpiryTimer)
      unsubscribe()
    }
  }, [localAssets, open])

  const refreshLocalAssets = useCallback(async () => {
    setLocalStatus("loading")
    setLocalError(null)
    try {
      const inventory = await listLocalAssetInventory({
        includeArchived: true,
      })
      const records = inventory.assets
      const storage = await localAssetStorageSummary(records)
      setLocalAssets(
        sortLocalUploadsByCreatedAt(
          records.filter((record) => record.archivedAt === null)
        )
      )
      setLocalStorage(storage)
      setLocalStatus("ready")
    } catch (error) {
      setLocalStatus("error")
      setLocalError(readableMediaError(error))
    }
  }, [])

  const refreshManagedAssets = useCallback(async () => {
    managedRequestRef.current?.abort()
    managedPaginationRequestRef.current?.abort()
    const generation = managedRequestGenerationRef.current + 1
    managedRequestGenerationRef.current = generation
    const controller = new AbortController()
    managedRequestRef.current = controller
    setManagedUploads((current) => ({
      ...current,
      status: "loading",
      error: null,
    }))
    const uploadsResult = await listManagedMedia({
      collection: "uploads",
      query: "",
      signal: controller.signal,
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    )
    if (
      controller.signal.aborted ||
      managedRequestGenerationRef.current !== generation
    ) {
      return
    }
    if (uploadsResult.status === "fulfilled") {
      setManagedUploads({
        ...uploadsResult.value,
        assets: sortManagedMediaAssets(uploadsResult.value.assets, "uploads"),
        status: "ready",
        error: null,
      })
    } else {
      setManagedUploads((current) => ({
        ...current,
        status: "error",
        error: readableMediaError(uploadsResult.reason),
      }))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refreshLocalAssets()
    void refreshManagedAssets()
  }, [open, refreshLocalAssets, refreshManagedAssets])

  useEffect(() => {
    if (!open) return
    let latestRevision = 0
    const unsubscribe = subscribeManagedMediaMutations((mutation, revision) => {
      if (mutation !== "used" || revision <= latestRevision) return
      latestRevision = revision
      void refreshManagedAssets()
    })
    return () => {
      unsubscribe()
    }
  }, [open, refreshManagedAssets])

  const referencedLocalAssetIds = useMemo(
    () => missingLocalAssetIds(document, []),
    [document]
  )
  const referencedLocalAssetSignature = referencedLocalAssetIds.join("\u0000")
  useEffect(() => {
    if (!open) {
      setLocalIntegrityReady(false)
      setLocalInspectionStates({})
      return
    }
    const controller = new AbortController()
    setLocalIntegrityReady(false)
    if (referencedLocalAssetIds.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT) {
      setHealthyReferencedLocalAssetIds([])
      setLocalInspectionStates({})
      setLocalRecoveryDeviceStates(
        Object.fromEntries(
          referencedLocalAssetIds.map((assetId) => [assetId, "unavailable"])
        )
      )
      setLocalIntegrityReady(true)
      return () => controller.abort()
    }
    void inspectRequestedLocalAssets(referencedLocalAssetIds, {
      signal: controller.signal,
    })
      .then((states) => {
        if (controller.signal.aborted) return
        const exact =
          states.length === referencedLocalAssetIds.length &&
          states.every((state: LocalAssetAdmissionState, index) => {
            const expectedId = referencedLocalAssetIds[index]
            return state.status === "ready"
              ? state.record.id === expectedId
              : state.status === "missing_bytes"
                ? state.summary.id === expectedId
                : state.status === "quarantined"
                  ? state.issue.assetId === expectedId
                  : true
          })
        const normalized = exact
          ? states
          : referencedLocalAssetIds.map(
              () => ({ status: "unavailable" }) as LocalAssetAdmissionState
            )
        setHealthyReferencedLocalAssetIds([])
        setLocalInspectionStates(
          Object.fromEntries(
            referencedLocalAssetIds.map((assetId, index) => [
              assetId,
              normalized[index],
            ])
          )
        )
        setLocalRecoveryDeviceStates(
          Object.fromEntries(
            referencedLocalAssetIds.map((assetId, index) => [
              assetId,
              normalized[index]?.status ?? "unavailable",
            ])
          )
        )
        setLocalIntegrityReady(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setHealthyReferencedLocalAssetIds([])
        setLocalInspectionStates({})
        setLocalRecoveryDeviceStates(
          Object.fromEntries(
            referencedLocalAssetIds.map((assetId) => [assetId, "unavailable"])
          )
        )
        setLocalIntegrityReady(true)
      })
    return () => controller.abort()
  }, [
    localAssetRevision,
    open,
    referencedLocalAssetIds,
    referencedLocalAssetSignature,
  ])

  useEffect(
    () => () => {
      managedRequestRef.current?.abort()
      managedPaginationRequestRef.current?.abort()
      for (const cancel of uploadCancelsRef.current.values()) cancel()
      uploadCancelsRef.current.clear()
      claimedUploadIdsRef.current.clear()
      uploadAttemptByQueueIdRef.current.clear()
    },
    []
  )

  const markPreviewFailed = useCallback((assetKey: string) => {
    setPreviewFailures((current) => new Set(current).add(assetKey))
  }, [])

  const chooseRecoveryManagedAsset = useCallback(
    async (asset: ManagedMediaAsset) => {
      const selectionId = `managed:${asset.id}`
      setSelectingId(selectionId)
      setSelectionError(null)
      try {
        if (!onRecoveryManagedSelect) {
          setSelectionError(
            "Managed recovery is not available in this editor session."
          )
          return
        }
        const result = await onRecoveryManagedSelect(asset)
        const succeeded = typeof result === "boolean" ? result : result.ok
        if (!succeeded) {
          setSelectionError(
            typeof result === "object" && result.message
              ? result.message
              : "That Studio image could not recover the missing media. The design was not changed."
          )
          return
        }
        setDialogNotice(
          "Every reviewed use now points to the selected Studio image. The Media dialog stayed open so you can verify the result."
        )
      } catch (error) {
        setSelectionError(readableMediaError(error))
      } finally {
        setSelectingId(null)
      }
    },
    [onRecoveryManagedSelect]
  )

  const upsertManagedUpload = useCallback((asset: ManagedMediaAsset) => {
    setManagedUploads((current) => ({
      ...current,
      assets: sortManagedMediaAssets(
        [asset, ...current.assets.filter((item) => item.id !== asset.id)],
        "uploads"
      ),
    }))
  }, [])

  const runUpload = useCallback(
    async (
      queueId: string,
      file: File,
      idempotencyKey: string,
      reconciling: boolean
    ) => {
      const attempt = (uploadAttemptByQueueIdRef.current.get(queueId) ?? 0) + 1
      uploadAttemptByQueueIdRef.current.set(queueId, attempt)
      const ownsAttempt = () =>
        uploadAttemptByQueueIdRef.current.get(queueId) === attempt
      const validationError = validateMediaFile(file)
      if (validationError) {
        claimedUploadIdsRef.current.delete(queueId)
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: "failed",
                  progress: null,
                  error: validationError,
                  asset: null,
                  retryable: false,
                  attempt,
                }
              : item
          )
        )
        return
      }
      setUploadQueue((current) =>
        current.map((item) =>
          item.id === queueId
            ? {
                ...item,
                phase: reconciling ? "reconciling" : "preparing",
                progress: null,
                error: null,
                asset: null,
                retryable: false,
                attempt,
              }
            : item
        )
      )
      const request = uploadManagedMedia(file, {
        idempotencyKey,
        onProgress: (loaded, total) => {
          if (!ownsAttempt()) return
          setUploadQueue((current) =>
            current.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    phase: reconciling ? "reconciling" : "uploading",
                    progress: total
                      ? Math.min(100, Math.round((loaded / total) * 100))
                      : null,
                  }
                : item
            )
          )
        },
      })
      let reconciliationController: AbortController | null = null
      uploadCancelsRef.current.set(queueId, request.cancel)
      setUploadQueue((current) =>
        current.map((item) =>
          item.id === queueId
            ? {
                ...item,
                phase: reconciling ? "reconciling" : "uploading",
                progress: null,
              }
            : item
        )
      )
      try {
        const asset = await request.promise
        if (!ownsAttempt()) return
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: "preparing",
                  progress: null,
                  asset,
                  error: null,
                  retryable: false,
                }
              : item
          )
        )
        upsertManagedUpload(asset)
        const detailController = new AbortController()
        reconciliationController = detailController
        uploadCancelsRef.current.set(queueId, () => detailController.abort())
        void refreshManagedAssets()
        if (!ownsAttempt()) return
        const detail = exactUploadedMediaDetail(
          asset,
          await resolveUploadedMediaDetail(asset, detailController.signal)
        )
        detailController.signal.throwIfAborted()
        if (!detail) {
          throw new Error(
            "The upload is saved, but its exact library version is not discoverable yet. Retry checks the same upload without creating a duplicate."
          )
        }
        setResolvedUploadedMedia((current) => ({
          ...current,
          [asset.id]: detail,
        }))
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: "complete",
                  progress: 100,
                  asset,
                  error: null,
                  retryable: false,
                }
              : item
          )
        )
        setDialogNotice(`“${file.name}” is ready to use.`)
      } catch (error) {
        if (!ownsAttempt()) return
        const cancelled =
          reconciliationController?.signal.aborted === true ||
          (error instanceof ManagedMediaError &&
            error.code === "media_upload_cancelled")
        const statusUnknown = managedMediaErrorHasUnknownCommitStatus(error)
        const retryable =
          !(error instanceof ManagedMediaError) ||
          managedMediaErrorIsRetryable(error)
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: cancelled
                    ? "cancelled"
                    : statusUnknown
                      ? "status_unknown"
                      : "failed",
                  progress: null,
                  error: cancelled
                    ? "Stopped on this device. Retry checks the server with the same request key before creating anything new."
                    : statusUnknown
                      ? "Studio lost contact before it could confirm the result. Retry checks the server with the same request key before creating anything new."
                      : readableMediaError(error),
                  retryable,
                }
              : item
          )
        )
      } finally {
        if (ownsAttempt()) {
          uploadCancelsRef.current.delete(queueId)
          claimedUploadIdsRef.current.delete(queueId)
        }
      }
    },
    [refreshManagedAssets, resolveUploadedMediaDetail, upsertManagedUpload]
  )

  const queueFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      if (selectingId || exactActionPending) {
        setDialogNotice("Wait for the current image change to finish.")
        return
      }
      setManagementOpen(true)
      setDialogNotice(null)
      const items = files.map<UploadQueueItem>((file) => ({
        id: crypto.randomUUID(),
        file,
        idempotencyKey: crypto.randomUUID(),
        phase: "queued",
        progress: null,
        error: null,
        asset: null,
        retryable: false,
        attempt: 0,
      }))
      setUploadQueue((current) => [...items, ...current])
    },
    [exactActionPending, selectingId]
  )

  const retryUpload = useCallback(
    (queueId: string) => {
      const item = uploadQueue.find((candidate) => candidate.id === queueId)
      if (!item?.retryable) return
      claimedUploadIdsRef.current.delete(queueId)
      setUploadQueue((current) =>
        current.map((candidate) =>
          candidate.id === queueId
            ? {
                ...candidate,
                phase: "queued",
                progress: null,
                error: null,
                retryable: false,
              }
            : candidate
        )
      )
    },
    [uploadQueue]
  )

  const cancelUpload = useCallback((queueId: string) => {
    const cancel = uploadCancelsRef.current.get(queueId)
    if (cancel) {
      setUploadQueue((current) =>
        current.map((item) =>
          item.id === queueId ? { ...item, phase: "cancelling" } : item
        )
      )
      cancel()
      return
    }
    uploadAttemptByQueueIdRef.current.set(
      queueId,
      (uploadAttemptByQueueIdRef.current.get(queueId) ?? 0) + 1
    )
    claimedUploadIdsRef.current.delete(queueId)
    setUploadQueue((current) =>
      current.map((item) =>
        item.id === queueId
          ? {
              ...item,
              phase: "cancelled",
              progress: null,
              error: null,
              retryable: true,
            }
          : item
      )
    )
  }, [])

  const dismissUpload = useCallback((queueId: string) => {
    uploadCancelsRef.current.delete(queueId)
    claimedUploadIdsRef.current.delete(queueId)
    uploadAttemptByQueueIdRef.current.delete(queueId)
    setUploadQueue((current) => current.filter((item) => item.id !== queueId))
  }, [])

  useEffect(() => {
    const claims = nextManagedUploadClaims(
      uploadQueue,
      claimedUploadIdsRef.current,
      MAX_CONCURRENT_MANAGED_UPLOADS
    )
    for (const item of claims) {
      claimedUploadIdsRef.current.add(item.id)
      void runUpload(item.id, item.file, item.idempotencyKey, item.attempt > 0)
    }
  }, [runUpload, uploadQueue])

  const loadMoreManaged = useCallback(async () => {
    const current = managedUploads
    if (selectingId || !current.nextCursor || current.status === "loading") {
      return
    }
    managedPaginationRequestRef.current?.abort()
    const controller = new AbortController()
    managedPaginationRequestRef.current = controller
    const generation = managedRequestGenerationRef.current
    setManagedUploads((state) => ({
      ...state,
      status: "loading",
      error: null,
    }))
    try {
      const next = await listManagedMedia({
        collection: "uploads",
        query: "",
        cursor: current.nextCursor,
        signal: controller.signal,
      })
      if (
        controller.signal.aborted ||
        managedPaginationRequestRef.current !== controller ||
        managedRequestGenerationRef.current !== generation
      ) {
        return
      }
      setManagedUploads((state) => ({
        ...next,
        assets: sortManagedMediaAssets(
          [
            ...state.assets,
            ...next.assets.filter(
              (asset) => !state.assets.some((item) => item.id === asset.id)
            ),
          ],
          "uploads"
        ),
        status: "ready",
        error: null,
      }))
    } catch (error) {
      if (controller.signal.aborted) return
      setManagedUploads((state) => ({
        ...state,
        status: "error",
        error: readableMediaError(error),
      }))
    } finally {
      if (managedPaginationRequestRef.current === controller) {
        managedPaginationRequestRef.current = null
      }
    }
  }, [managedUploads, selectingId])

  const startLocalDeleteReview = useCallback(
    (asset: LocalAssetSummary) => {
      const usage = assetReferenceUsage(document, "local", asset.id)
      setDeleteReview({
        kind: "local",
        id: asset.id,
        name: asset.name,
        status: usage.referenceCount ? "blocked" : "ready",
        nodeIds: usage.nodeIds,
        pageIds: usage.pageIds,
        fieldIds: usage.fieldIds,
        serverImpact: null,
        error: null,
      })
    },
    [document]
  )

  const startManagedDeleteReview = useCallback(
    async (asset: ManagedMediaAsset) => {
      const usage = assetReferenceUsage(document, "managed", asset.id)
      setDeleteReview({
        kind: "managed",
        id: asset.id,
        name: asset.name,
        status: "checking",
        nodeIds: usage.nodeIds,
        pageIds: usage.pageIds,
        fieldIds: usage.fieldIds,
        serverImpact: null,
        error: null,
      })
      try {
        const impact = await getManagedMediaDeletionImpact(asset.id)
        setDeleteReview((current) =>
          current?.kind === "managed" && current.id === asset.id
            ? {
                ...current,
                status:
                  current.nodeIds.length +
                    current.fieldIds.length +
                    serverReferenceCount(impact) >
                    0 || !impact.canArchive
                    ? "blocked"
                    : "ready",
                serverImpact: impact,
              }
            : current
        )
      } catch (error) {
        setDeleteReview((current) =>
          current?.kind === "managed" && current.id === asset.id
            ? {
                ...current,
                status: "error",
                error: readableMediaError(error),
              }
            : current
        )
      }
    },
    [document]
  )

  const confirmDelete = useCallback(async () => {
    if (selectingId || !deleteReview || deleteReview.status !== "ready") return
    const review = deleteReview
    setDeleteReview({ ...review, status: "deleting", error: null })
    try {
      const currentUsage = assetReferenceUsage(document, review.kind, review.id)
      if (currentUsage.referenceCount > 0) {
        setDeleteReview({
          ...review,
          status: "blocked",
          nodeIds: currentUsage.nodeIds,
          pageIds: currentUsage.pageIds,
          fieldIds: currentUsage.fieldIds,
          error: null,
        })
        return
      }
      if (review.kind === "local") {
        const asset = localAssets.find(
          (candidate) => candidate.id === review.id
        )
        if (!asset) throw new Error("This upload is no longer in the library.")
        await archiveLocalAsset(review.id, asset.revision)
        await refreshLocalAssets()
      } else {
        const freshImpact = await getManagedMediaDeletionImpact(review.id)
        if (!freshImpact.canArchive || serverReferenceCount(freshImpact) > 0) {
          setDeleteReview({
            ...review,
            status: "blocked",
            nodeIds: currentUsage.nodeIds,
            pageIds: currentUsage.pageIds,
            fieldIds: currentUsage.fieldIds,
            serverImpact: freshImpact,
            error: null,
          })
          return
        }
        await archiveManagedMedia(review.id, freshImpact)
        const remove = (current: ManagedRepositoryState) => ({
          ...current,
          assets: current.assets.filter((asset) => asset.id !== review.id),
        })
        setManagedUploads(remove)
        await refreshManagedAssets()
      }
      setUploadQueue((current) =>
        current.filter((item) => item.asset?.id !== review.id)
      )
      setDeleteReview(null)
      setDialogNotice(`“${review.name}” was removed from uploads.`)
    } catch (error) {
      setDeleteReview((current) =>
        current
          ? { ...current, status: "error", error: readableMediaError(error) }
          : current
      )
    }
  }, [
    deleteReview,
    document,
    localAssets,
    refreshLocalAssets,
    refreshManagedAssets,
    selectingId,
  ])

  const allMissingAssetIds = useMemo(
    () =>
      localIntegrityReady
        ? missingLocalAssetIds(document, healthyReferencedLocalAssetIds)
        : [],
    [document, healthyReferencedLocalAssetIds, localIntegrityReady]
  )
  const missingAssetIds = allMissingAssetIds
  const recoveryCardAssetIds = useMemo(
    () =>
      [
        ...new Set([
          ...missingAssetIds,
          ...(documentMediaAdmission?.unresolved.map(
            (item) => item.localAssetId
          ) ?? []),
          ...(documentMediaAdmission?.receipt?.aliases.map(
            (item) => item.localAssetId
          ) ?? []),
          ...Object.entries(localMediaRecoveryOperations).flatMap(
            ([assetId, operation]) => (operation ? [assetId] : [])
          ),
        ]),
      ].sort(),
    [documentMediaAdmission, localMediaRecoveryOperations, missingAssetIds]
  )
  useEffect(() => {
    if (!open || !localIntegrityReady || !referencedLocalAssetIds.length) {
      setMissingMappingStates({})
      setHealthyReferencedLocalAssetIds([])
      return
    }
    const controller = new AbortController()
    const aliases = [...referencedLocalAssetIds]
    if (aliases.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT) {
      setMissingMappingStates(
        Object.fromEntries(aliases.map((assetId) => [assetId, "unavailable"]))
      )
      setHealthyReferencedLocalAssetIds(
        aliases.filter(
          (assetId) => localInspectionStates[assetId]?.status === "ready"
        )
      )
      return
    }
    setMissingMappingStates(
      Object.fromEntries(aliases.map((assetId) => [assetId, "checking"]))
    )
    void (async () => {
      try {
        const resolutions = []
        for (let index = 0; index < aliases.length; index += 100) {
          controller.signal.throwIfAborted()
          const chunk = aliases.slice(index, index + 100)
          const result = await resolveLocalAssetPromotions(chunk, {
            signal: controller.signal,
          })
          resolutions.push(...result.results)
        }
        controller.signal.throwIfAborted()
        if (
          resolutions.length !== aliases.length ||
          resolutions.some(
            (resolution, index) =>
              resolution.localAssetId !== aliases[index] ||
              (resolution.promotion !== null &&
                resolution.promotion.localAssetId !== aliases[index])
          )
        ) {
          throw new Error("Studio returned a different image mapping order.")
        }
        const healthy = await Promise.all(
          resolutions.map(async (resolution) => {
            const localState = localInspectionStates[resolution.localAssetId]
            if (localState?.status !== "ready") return null
            if (!resolution.promotion) return resolution.localAssetId
            const hash = await hashLocalAssetBlobSha256(
              localState.record.blob,
              controller.signal
            )
            return hash === resolution.promotion.contentSha256
              ? resolution.localAssetId
              : null
          })
        )
        controller.signal.throwIfAborted()
        setHealthyReferencedLocalAssetIds(
          healthy.filter((assetId): assetId is string => assetId !== null)
        )
        setMissingMappingStates(
          Object.fromEntries(
            resolutions.map((resolution) => [
              resolution.localAssetId,
              resolution.promotion?.asset.status ?? "unmapped",
            ])
          )
        )
      } catch {
        if (controller.signal.aborted) return
        setHealthyReferencedLocalAssetIds(
          aliases.filter(
            (assetId) => localInspectionStates[assetId]?.status === "ready"
          )
        )
        setMissingMappingStates(
          Object.fromEntries(aliases.map((assetId) => [assetId, "unavailable"]))
        )
      }
    })()
    return () => controller.abort()
  }, [
    localIntegrityReady,
    localInspectionStates,
    missingMappingGeneration,
    open,
    referencedLocalAssetIds,
    referencedLocalAssetSignature,
  ])
  const deleteReferenceRows = useMemo(() => {
    if (!deleteReview) return []
    const rows: Array<{
      key: string
      label: string
      detail: string
      nodeId: string | null
      pageId: string | null
      fieldId: string | null
    }> = []
    for (const nodeId of deleteReview.nodeIds) {
      const node = document.nodes.find((candidate) => candidate.id === nodeId)
      const page = document.pages.find((candidate) =>
        candidate.nodeIds.includes(nodeId)
      )
      rows.push({
        key: `node:${nodeId}`,
        label: node?.name ?? nodeId,
        detail: page ? `Layer on ${page.name}` : "Layer in this design",
        nodeId,
        pageId: page?.id ?? null,
        fieldId: null,
      })
    }
    for (const fieldId of deleteReview.fieldIds) {
      const field = document.fields.find(
        (candidate) => candidate.id === fieldId
      )
      rows.push({
        key: `field:${fieldId}`,
        label: field?.label ?? fieldId,
        detail: "Shared asset field in this design",
        nodeId: null,
        pageId: null,
        fieldId,
      })
    }
    for (const [index, reference] of (
      deleteReview.serverImpact?.references ?? []
    ).entries()) {
      const key = `server:${reference.referenceKind}:${reference.sourceId}:${index}`
      if (
        reference.nodeId &&
        rows.some((row) => row.nodeId === reference.nodeId)
      ) {
        continue
      }
      rows.push({
        key,
        label:
          reference.referenceKind === "published_version"
            ? `Published version ${reference.sourceId}`
            : `Saved document ${reference.sourceId}`,
        detail: [
          reference.documentId,
          reference.pageId,
          reference.nodeId,
          reference.fieldId,
          reference.property,
        ]
          .filter(Boolean)
          .join(" · "),
        nodeId: reference.nodeId,
        pageId: reference.pageId,
        fieldId: reference.fieldId,
      })
    }
    return rows
  }, [deleteReview, document])

  const managedStorage = managedUploads.storage
  const localStoragePercent = localStorage
    ? formatStoragePercentage(
        localStorage.browserUsageBytes ?? localStorage.retainedAssetBytes,
        localStorage.browserQuotaBytes
      )
    : null
  const atLocalQuota = localStoragePercent !== null && localStoragePercent >= 95
  const interactionLocked = selectingId !== null || hasActiveRecovery
  const managementMutationLocked = interactionLocked || exactActionPending
  const actionPrefix =
    mode === "replace"
      ? `Replace ${targetName ? `“${targetName}”` : "selected image"} with`
      : mode === "recover-local"
        ? "Recover every use with"
        : mode === "assign_field"
          ? `Assign ${targetName ? `“${targetName}”` : "image field"} to`
          : "Insert"

  const renderLocalCard = (asset: LocalAssetSummary) => {
    const assetKey = `local:${asset.id}`
    const livePromotion = localAssetPromotions[asset.id]
    const projectedLivePromotion = livePromotion
      ? projectLiveLocalAssetPromotion(livePromotion, document, asset.id)
      : null
    const persistedJournal = persistedLocalAssetPromotionJournals[asset.id]
    const projectedPersistedPromotion = persistedJournal
      ? projectPersistedLocalAssetPromotion(
          persistedJournal,
          document,
          asset.id
        )
      : null
    const projectedPromotion = chooseLocalAssetPromotionProjection(
      projectedLivePromotion,
      projectedPersistedPromotion
    )
    const promotionBlockedByOther = Object.entries(localAssetPromotions).some(
      ([otherAssetId, otherPromotion]) => {
        if (otherAssetId === asset.id || !otherPromotion) return false
        const projected = projectLiveLocalAssetPromotion(
          otherPromotion,
          document,
          otherAssetId
        )
        return projected ? activePromotionPhases.has(projected.phase) : false
      }
    )
    return (
      <LocalAssetCard
        key={assetKey}
        actionLabel={`Manage device image ${asset.name}`}
        asset={asset}
        busy={selectingId === assetKey}
        detail={`${formatAssetBytes(asset.size)} · ${asset.mediaType.replace("image/", "").toLocaleUpperCase()}`}
        disabled
        mutationDisabled={managementMutationLocked}
        promotionBlockedByOther={promotionBlockedByOther}
        promotion={projectedPromotion ?? undefined}
        referenceCount={
          assetReferenceKeysForSource(document, localAssetSource(asset.id))
            .length
        }
        previewFailed={previewFailures.has(assetKey)}
        onChoose={() => undefined}
        onDelete={() => startLocalDeleteReview(asset)}
        onLocateMissing={
          onLocateMissingLocalAsset
            ? (file) => onLocateMissingLocalAsset(asset.id, file)
            : undefined
        }
        onPreviewFailure={markPreviewFailed}
        onPromote={
          onPromoteLocalAsset ? () => onPromoteLocalAsset(asset.id) : undefined
        }
        onCancelPromotion={
          onCancelLocalAssetPromotion && projectedLivePromotion
            ? () => onCancelLocalAssetPromotion(asset.id)
            : undefined
        }
      />
    )
  }

  const renderManagedCard = (asset: ManagedMediaAsset) => {
    const assetKey = `managed:${asset.id}`
    const recoverySelectable = mode === "recover-local"
    return (
      <AssetCard
        key={assetKey}
        actionLabel={
          recoverySelectable
            ? `${actionPrefix} ${asset.name}`
            : `Manage workspace image ${asset.name}`
        }
        assetKey={assetKey}
        busy={selectingId === assetKey}
        detail={`${formatAssetBytes(asset.bytes)} · ${asset.width} × ${asset.height}`}
        disabled={!recoverySelectable || selectingId !== null}
        height={asset.height}
        name={asset.name}
        previewFailed={previewFailures.has(assetKey)}
        mutationDisabled={managementMutationLocked}
        sourceLabel="Workspace upload"
        src={managedMediaContentUrl(asset.id)}
        width={asset.width}
        onChoose={() => void chooseRecoveryManagedAsset(asset)}
        onDelete={() => void startManagedDeleteReview(asset)}
        onPreviewFailure={markPreviewFailed}
      />
    )
  }

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && selectingId) {
      setDialogNotice("Wait for the current image change to finish.")
      return false
    }
    if (
      !nextOpen &&
      (hasActiveUploads || hasCriticalPromotion || hasActiveRecovery)
    ) {
      setDialogNotice(
        hasCriticalPromotion || hasActiveRecovery
          ? "Wait for the image to finish saving everywhere before closing Media."
          : "Uploads are still in progress. Cancel them before closing."
      )
      return false
    }
    if (!nextOpen) setManagementOpen(false)
    onOpenChange(nextOpen)
    return true
  }
  const retryRepositories = () => {
    void refreshManagedAssets()
    if (localStatus === "error") void refreshLocalAssets()
  }
  const statusMessage = actionError ?? selectionError ?? dialogNotice ?? ""
  const navigateToReference = (reference: {
    nodeId: string | null
    pageId: string | null
    fieldId: string | null
  }) => {
    if (!onNavigateToReference) return
    setDeleteReview(null)
    if (!requestClose(false)) return
    window.requestAnimationFrame(() => onNavigateToReference(reference))
  }

  const renderRecoveryCard = (assetId: string) => {
    const receiptAlias = documentMediaAdmission?.receipt?.aliases.find(
      (item) => item.localAssetId === assetId
    )
    const liveImpact = receiptAlias
      ? localMediaRecoveryImpactForReferenceKeys(
          document,
          assetId,
          receiptAlias.expectedReferenceKeys
        )
      : localMediaRecoveryImpact(document, assetId)
    if (liveImpact.referenceCount > 0) {
      retainedRecoveryImpactsRef.current.set(assetId, liveImpact)
    }
    const impact =
      liveImpact.referenceCount > 0
        ? liveImpact
        : (retainedRecoveryImpactsRef.current.get(assetId) ?? liveImpact)
    const storedOperation = localMediaRecoveryOperations[assetId]
    const displayedOperation = displayedLocalMediaRecoveryOperation(
      storedOperation,
      liveImpact.referenceCount
    )
    const removable =
      impact.referenceCount > 0 &&
      impact.lockedNodeIds.length === 0 &&
      impact.requiredFieldIds.length === 0
    const removeDisabledReason = removable
      ? null
      : impact.lockedNodeIds.length
        ? "Unlock the affected layer before removing it."
        : impact.requiredFieldIds.length
          ? "A required field uses this image, so it cannot be cleared or removed."
          : "Choose a replacement before clearing protected image uses."
    return (
      <MissingLocalAssetRecoveryCard
        key={assetId}
        disabled={
          managementMutationLocked || Boolean(recoveryMutationDisabledReason)
        }
        actionDisabledReason={recoveryMutationDisabledReason}
        admissionOutcome={
          documentMediaAdmission?.unresolved.find(
            (item) => item.localAssetId === assetId
          )?.outcome
        }
        deviceState={
          receiptAlias?.localState ??
          localRecoveryDeviceStates[assetId] ??
          "unavailable"
        }
        impact={impact}
        localAssetId={assetId}
        mappingState={
          receiptAlias?.managedStatus ??
          missingMappingStates[assetId] ??
          "checking"
        }
        operation={displayedOperation}
        reviewOnly={
          Boolean(receiptAlias) ||
          (displayedOperation?.completionKind === "relinked" &&
            liveImpact.referenceCount === 0)
        }
        references={localMediaRecoveryReferenceRows(document, impact)}
        onNavigateToReference={onNavigateToReference}
        onClearReference={(referenceKey) =>
          onRemoveMissingLocalAsset?.(assetId, referenceKey)
        }
        removeDisabledReason={
          impact.referenceKeys.length ? null : removeDisabledReason
        }
        onChooseStudioImage={() => onChooseStudioImageForLocalAsset?.(assetId)}
        onLocateFile={(file) => onLocateMissingLocalAsset?.(assetId, file)}
        onKeepLocatedFile={
          onKeepLocatedFileAsNewLocalAsset
            ? () => onKeepLocatedFileAsNewLocalAsset(assetId)
            : undefined
        }
        onRemove={
          onRemoveMissingLocalAsset
            ? () => onRemoveMissingLocalAsset(assetId)
            : undefined
        }
        onRetryMapping={() =>
          setMissingMappingGeneration((current) => current + 1)
        }
        onRetryRecovery={
          onRetryLocalMediaRecovery
            ? () => onRetryLocalMediaRecovery(assetId)
            : undefined
        }
        onCancelRecovery={
          onCancelLocalMediaRecovery
            ? () => onCancelLocalMediaRecovery(assetId)
            : undefined
        }
        onUseStudioCopy={
          onUseStudioCopyForLocalAsset
            ? () =>
                onUseStudioCopyForLocalAsset(
                  assetId,
                  localMediaRecoveryOperations[assetId]?.phase ===
                    "identity_conflict"
                )
            : undefined
        }
      />
    )
  }

  const managementContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={`flex shrink-0 flex-col gap-2 border-b px-3 py-3 transition-colors ${dragActive ? "bg-muted ring-2 ring-foreground/20 ring-inset" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!managementMutationLocked) setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false)
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          if (!managementMutationLocked) {
            queueFiles(Array.from(event.dataTransfer.files))
          }
        }}
      >
        <input
          ref={fileInputRef}
          accept={MEDIA_UPLOAD_ACCEPT}
          aria-hidden="true"
          hidden
          multiple
          name="media-upload-files"
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            queueFiles(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ""
          }}
        />
        <Button
          className="h-11 w-full"
          disabled={managementMutationLocked}
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon data-icon="inline-start" />
          Upload images
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {dragActive
            ? "Drop images to upload"
            : "PNG, JPEG, or WebP · 25 MB max. Uploads become usable only after their exact library version is ready."}
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <UploadQueue
          disabled={managementMutationLocked}
          items={uploadQueue}
          selectingId={selectingId}
          onCancel={cancelUpload}
          onDismiss={dismissUpload}
          onRetry={retryUpload}
          onUse={(item) => {
            if (!item.asset) return
            if (mode === "recover-local") {
              void chooseRecoveryManagedAsset(item.asset)
              return
            }
            const detail = resolvedUploadedMedia[item.asset.id]
            if (!detail) {
              setDialogNotice(
                "Wait for the upload's exact library version before using it."
              )
              return
            }
            setManagementOpen(false)
            onMediaSelect(mediaIntentFromDetail(detail))
          }}
        />
        {managedUploads.status === "error" ? (
          <RepositoryNotice
            message={
              managedUploads.error ?? "Workspace uploads could not load."
            }
            onRetry={retryRepositories}
          />
        ) : null}
        {localStatus === "error" ? (
          <RepositoryNotice
            message={localError ?? "Local media could not load."}
            title="Device media is unavailable"
            onRetry={retryRepositories}
          />
        ) : null}
        {atLocalQuota ? (
          <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <p>
              Device storage is nearly full. Local history files stay retained
              for Undo, so free browser or device storage if a restore fails.
            </p>
          </div>
        ) : null}
        <div className="grid gap-5 p-4 pb-8">
          {recoveryCardAssetIds.length ? (
            <section
              aria-labelledby="document-media-management"
              className="grid gap-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />
                <div>
                  <h3
                    id="document-media-management"
                    className="text-xs font-medium"
                  >
                    Document media
                  </h3>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Review missing files and recovery operations independently
                    from library search.
                  </p>
                </div>
              </div>
              {recoveryCardAssetIds.map(renderRecoveryCard)}
            </section>
          ) : null}
          {managedUploads.assets.length ? (
            <section
              aria-labelledby="workspace-media-management"
              className="grid gap-3"
            >
              <h3
                id="workspace-media-management"
                className="text-xs font-medium"
              >
                Workspace uploads
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {managedUploads.assets.map(renderManagedCard)}
              </div>
              {managedUploads.nextCursor ? (
                <Button
                  className="h-11"
                  disabled={
                    interactionLocked || managedUploads.status === "loading"
                  }
                  variant="outline"
                  onClick={() => void loadMoreManaged()}
                >
                  {managedUploads.status === "loading" ? (
                    <LoaderCircleIcon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : null}
                  Load more uploads
                </Button>
              ) : null}
            </section>
          ) : null}
          {mode !== "recover-local" && localAssets.length ? (
            <section
              aria-labelledby="device-media-management"
              className="grid gap-3"
            >
              <h3 id="device-media-management" className="text-xs font-medium">
                Device media management
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {localAssets.map(renderLocalCard)}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <footer className="grid shrink-0 gap-2 border-t bg-muted/35 px-4 py-2.5 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <CloudIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            Workspace:{" "}
            {managedStorage
              ? `${managedStorage.count} files · ${formatAssetBytes(managedStorage.bytes)}`
              : "—"}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            This device:{" "}
            {localStorage
              ? `${localStorage.activeAssetCount} available · ${formatAssetBytes(localStorage.activeAssetBytes)}${localStorage.archivedAssetCount ? ` · ${localStorage.archivedAssetCount} retained for history (${formatAssetBytes(localStorage.archivedAssetBytes)})` : ""}`
              : "—"}
          </span>
        </div>
      </footer>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        aria-describedby="asset-library-description"
        className="top-0 left-0 grid h-[100dvh] max-h-none max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(800px,calc(100dvh-2rem))] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        showCloseButton={false}
      >
        <DialogHeader className="border-b px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>
                {mode === "replace"
                  ? "Replace image"
                  : mode === "assign_field"
                    ? "Choose field image"
                    : mode === "recover-local"
                      ? "Choose Studio image"
                      : "Add image"}
              </DialogTitle>
              <DialogDescription
                id="asset-library-description"
                className="mt-1 text-xs"
              >
                {mode === "replace"
                  ? `Choose a replacement${targetName ? ` for “${targetName}”` : ""}. Your crop and layer position stay intact.`
                  : mode === "assign_field"
                    ? `Choose an image${targetName ? ` for “${targetName}”` : ""}. Every bound layer updates together.`
                    : mode === "recover-local"
                      ? "Choose a ready Studio upload for every reviewed use of the missing image. Device files and Studio originals are not selectable in recovery."
                      : "Choose exact media from Recent, Uploads, Library, Favorites, or your collections."}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {mode !== "recover-local" ? (
                <Button
                  className="h-11"
                  disabled={
                    hasCriticalPromotion ||
                    hasActiveRecovery ||
                    exactActionPending
                  }
                  type="button"
                  variant="outline"
                  onClick={() => setManagementOpen(true)}
                >
                  Manage
                </Button>
              ) : null}
              <Button
                aria-label="Close media library"
                className="size-11"
                disabled={
                  hasActiveUploads || hasCriticalPromotion || interactionLocked
                }
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => requestClose(false)}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {mode === "recover-local" ? (
          managementContent
        ) : (
          <LibraryMediaBrowser
            action={mode}
            actionError={actionError}
            actionsEnabled={actionsEnabled && !interactionLocked}
            density="compact"
            pendingIdentity={pendingIdentity}
            scope={mediaScope}
            targetName={targetName}
            visible={open}
            onScopeChange={onMediaScopeChange}
            onSelect={onMediaSelect}
          />
        )}

        <Sheet
          open={mode !== "recover-local" && managementOpen}
          onOpenChange={setManagementOpen}
        >
          <SheetContent
            aria-describedby="media-management-description"
            className="flex w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
            side="right"
          >
            <SheetHeader className="shrink-0 border-b px-4 py-4 pr-14">
              <SheetTitle>Manage media</SheetTitle>
              <SheetDescription
                id="media-management-description"
                className="text-xs"
              >
                Upload, recover, archive, or promote media without changing the
                active library search.
              </SheetDescription>
            </SheetHeader>
            {statusMessage ? (
              <div
                className={`shrink-0 border-b px-4 py-2 text-xs ${
                  selectionError
                    ? "bg-destructive/5 text-destructive"
                    : "bg-muted/45 text-muted-foreground"
                }`}
                role="status"
              >
                {statusMessage}
              </div>
            ) : null}
            {managementContent}
          </SheetContent>
        </Sheet>
      </DialogContent>

      <AlertDialog
        open={Boolean(deleteReview)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && deleteReview?.status !== "deleting") {
            setDeleteReview(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              {deleteReview?.status === "checking" ||
              deleteReview?.status === "deleting" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {deleteReview?.status === "checking"
                ? "Checking where this image is used"
                : deleteReview?.status === "blocked"
                  ? "This image is still in use"
                  : deleteReview?.status === "error"
                    ? "Could not verify this image"
                    : `Remove “${deleteReview?.name ?? "image"}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {deleteReview?.status === "checking" ? (
                  <p>
                    Studio is checking drafts, published templates, and this
                    open design.
                  </p>
                ) : deleteReview?.status === "blocked" ? (
                  <>
                    <p>
                      Remove its references before deleting it. This prevents
                      broken images in drafts and published outputs.
                    </p>
                    <ul className="list-disc space-y-1 pl-4">
                      {deleteReview.nodeIds.length ? (
                        <li>
                          {deleteReview.nodeIds.length} layer{" "}
                          {deleteReview.nodeIds.length === 1
                            ? "reference"
                            : "references"}{" "}
                          in this design
                        </li>
                      ) : null}
                      {deleteReview.fieldIds.length ? (
                        <li>
                          {deleteReview.fieldIds.length} field{" "}
                          {deleteReview.fieldIds.length === 1
                            ? "reference"
                            : "references"}{" "}
                          in this design
                        </li>
                      ) : null}
                      {deleteReview.serverImpact?.currentReferences ? (
                        <li>
                          {deleteReview.serverImpact.currentReferences} saved
                          draft{" "}
                          {deleteReview.serverImpact.currentReferences === 1
                            ? "reference"
                            : "references"}
                        </li>
                      ) : null}
                      {deleteReview.serverImpact?.publishedReferences ? (
                        <li>
                          {deleteReview.serverImpact.publishedReferences}{" "}
                          published{" "}
                          {deleteReview.serverImpact.publishedReferences === 1
                            ? "reference"
                            : "references"}
                        </li>
                      ) : null}
                    </ul>
                    {deleteReferenceRows.length ? (
                      <div className="grid gap-2 pt-1">
                        <p className="text-xs font-medium text-foreground">
                          References
                        </p>
                        {deleteReferenceRows.map((reference) =>
                          onNavigateToReference &&
                          (reference.nodeId || reference.pageId) ? (
                            <Button
                              key={reference.key}
                              className="h-auto min-h-11 justify-start px-3 py-2 text-left"
                              type="button"
                              variant="outline"
                              onClick={() => navigateToReference(reference)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-medium">
                                  {reference.label}
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {reference.detail}
                                </span>
                              </span>
                            </Button>
                          ) : (
                            <div
                              key={reference.key}
                              className="rounded-md border px-3 py-2"
                            >
                              <p className="text-xs font-medium text-foreground">
                                {reference.label}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {reference.detail}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    ) : null}
                  </>
                ) : deleteReview?.status === "error" ? (
                  <p>{deleteReview.error}</p>
                ) : (
                  <p>
                    {deleteReview?.kind === "local"
                      ? "This hides the upload from the library. Studio retains its file data so document history and Undo remain safe."
                      : "This archives the workspace upload and hides it from the library. Its private file remains available to existing drafts, history, and published versions."}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11"
              disabled={deleteReview?.status === "deleting"}
            >
              {deleteReview?.status === "blocked" ||
              deleteReview?.status === "error"
                ? "Close"
                : "Cancel"}
            </AlertDialogCancel>
            {deleteReview?.status === "ready" ? (
              <Button
                className="h-11"
                disabled={managementMutationLocked}
                variant="destructive"
                onClick={() => void confirmDelete()}
              >
                Hide from uploads
              </Button>
            ) : null}
            {deleteReview?.status === "error" &&
            deleteReview.kind === "managed" ? (
              <Button
                className="h-11"
                variant="outline"
                onClick={() => {
                  const asset = managedUploads.assets.find(
                    (item) => item.id === deleteReview.id
                  )
                  if (asset) void startManagedDeleteReview(asset)
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Retry check
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
