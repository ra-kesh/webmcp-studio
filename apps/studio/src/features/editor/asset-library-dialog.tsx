import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Document } from "@webmcp/document"
import {
  AlertCircleIcon,
  CloudIcon,
  HardDriveIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
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
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@webmcp/ui/components/tabs"
import {
  AssetCard,
  EmptyCollection,
  isUploadActive,
  LocalAssetCard,
  LoadingGrid,
  RepositoryNotice,
  UploadQueue,
} from "./asset-library-components"
import type {
  AssetLibraryCollection,
  UploadQueueItem,
} from "./asset-library-components"
import {
  assetReferenceUsage,
  formatStoragePercentage,
  healthyLocalAssetIds,
  matchesAssetSearch,
  missingLocalAssetIds,
  parseRecentLibraryUse,
  readableMediaError,
  recordRecentLibraryUse,
  sortLocalUploadsByCreatedAt,
  sortManagedMediaAssets,
  wasMediaAssetUsed,
} from "./asset-library-model"
import { studioAssets } from "./asset-catalog"
import type { StudioAsset } from "./asset-catalog"
import { formatAssetBytes } from "./local-asset-model"
import {
  archiveLocalAsset,
  hasLocalAssetBlob,
  listLocalAssetInventory,
  localAssetStorageSummary,
} from "./local-asset-store"
import type {
  LocalAssetStorageSummary,
  LocalAssetSummary,
} from "./local-asset-store"
import { MEDIA_UPLOAD_ACCEPT, validateMediaFile } from "./media-file-policy"
import {
  archiveManagedMedia,
  getManagedMediaDeletionImpact,
  listManagedMedia,
  managedMediaContentUrl,
  uploadManagedMedia,
} from "./managed-media-repository"
import type {
  ManagedMediaAsset,
  ManagedMediaCollection,
  ManagedMediaDeletionImpact,
  ManagedMediaList,
} from "./managed-media-repository"

export type AssetLibrarySelection =
  | { kind: "library"; asset: StudioAsset }
  | { kind: "local"; asset: LocalAssetSummary }
  | { kind: "managed"; asset: ManagedMediaAsset }

export type AssetLibrarySelectionResult =
  boolean | { ok: boolean; message?: string }

export type AssetLibraryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "insert" | "replace"
  targetName?: string
  document: Document
  initialCollection?: AssetLibraryCollection
  onSelect: (
    selection: AssetLibrarySelection
  ) => Promise<AssetLibrarySelectionResult> | AssetLibrarySelectionResult
  onLocateMissingLocalAsset?: (assetId: string) => void
  onNavigateToReference?: (reference: {
    nodeId: string | null
    pageId: string | null
    fieldId: string | null
  }) => void
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

const recentLibraryStorageKey = "webmcp-studio:recent-library-assets:v1"

export function AssetLibraryDialog({
  open,
  onOpenChange,
  mode,
  targetName,
  document,
  initialCollection = "recent",
  onSelect,
  onLocateMissingLocalAsset,
  onNavigateToReference,
}: AssetLibraryDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadCancelsRef = useRef(new Map<string, () => void>())
  const managedRequestRef = useRef<AbortController | null>(null)
  const managedPaginationRequestRef = useRef<
    Record<ManagedMediaCollection, AbortController | null>
  >({ recent: null, uploads: null })
  const managedRequestGenerationRef = useRef(0)
  const [collection, setCollection] =
    useState<AssetLibraryCollection>(initialCollection)
  const [query, setQuery] = useState("")
  const [localAssets, setLocalAssets] = useState<LocalAssetSummary[]>([])
  const [knownLocalAssetIds, setKnownLocalAssetIds] = useState<string[]>([])
  const [healthyReferencedLocalAssetIds, setHealthyReferencedLocalAssetIds] =
    useState<string[]>([])
  const [localIntegrityReady, setLocalIntegrityReady] = useState(false)
  const [localStorage, setLocalStorage] =
    useState<LocalAssetStorageSummary | null>(null)
  const [localStatus, setLocalStatus] = useState<RepositoryStatus>("idle")
  const [localError, setLocalError] = useState<string | null>(null)
  const [managedRecent, setManagedRecent] =
    useState<ManagedRepositoryState>(emptyManagedState)
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
  const [recentLibraryUse, setRecentLibraryUse] = useState<
    Record<string, number>
  >({})

  const normalizedQuery = query.trim()
  const normalizedQueryRef = useRef(normalizedQuery)
  normalizedQueryRef.current = normalizedQuery
  const hasActiveUploads = uploadQueue.some(isUploadActive)

  const refreshLocalAssets = useCallback(async () => {
    setLocalStatus("loading")
    setLocalError(null)
    try {
      const inventory = await listLocalAssetInventory({
        includeArchived: true,
      })
      const records = inventory.assets
      const storage = await localAssetStorageSummary(records)
      setKnownLocalAssetIds(records.map((record) => record.id))
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

  const refreshManagedAssets = useCallback(async (searchQuery: string) => {
    managedRequestRef.current?.abort()
    managedPaginationRequestRef.current.recent?.abort()
    managedPaginationRequestRef.current.uploads?.abort()
    const generation = managedRequestGenerationRef.current + 1
    managedRequestGenerationRef.current = generation
    const controller = new AbortController()
    managedRequestRef.current = controller
    const markLoading = (current: ManagedRepositoryState) => ({
      ...current,
      status: "loading" as const,
      error: null,
    })
    setManagedRecent(markLoading)
    setManagedUploads(markLoading)
    const load = (kind: ManagedMediaCollection) =>
      listManagedMedia({
        collection: kind,
        query: searchQuery,
        signal: controller.signal,
      })
    const [recentResult, uploadsResult] = await Promise.allSettled([
      load("recent"),
      load("uploads"),
    ])
    if (
      controller.signal.aborted ||
      managedRequestGenerationRef.current !== generation
    ) {
      return
    }
    if (recentResult.status === "fulfilled") {
      setManagedRecent({
        ...recentResult.value,
        assets: sortManagedMediaAssets(
          recentResult.value.assets.filter(wasMediaAssetUsed),
          "recent"
        ),
        status: "ready",
        error: null,
      })
    } else {
      setManagedRecent((current) => ({
        ...current,
        status: "error",
        error: readableMediaError(recentResult.reason),
      }))
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
    setCollection(initialCollection)
    setRecentLibraryUse(
      parseRecentLibraryUse(
        window.localStorage.getItem(recentLibraryStorageKey)
      )
    )
    void refreshLocalAssets()
  }, [initialCollection, open, refreshLocalAssets])

  useEffect(() => {
    if (!open) return
    const timeout = window.setTimeout(
      () => void refreshManagedAssets(normalizedQuery),
      normalizedQuery ? 180 : 0
    )
    return () => {
      window.clearTimeout(timeout)
      managedRequestRef.current?.abort()
    }
  }, [normalizedQuery, open, refreshManagedAssets])

  const referencedLocalAssetIds = useMemo(
    () => missingLocalAssetIds(document, []),
    [document]
  )
  const referencedLocalAssetSignature = referencedLocalAssetIds.join("\u0000")
  const knownLocalAssetSignature = knownLocalAssetIds.join("\u0000")

  useEffect(() => {
    if (!open || localStatus !== "ready") {
      setLocalIntegrityReady(false)
      return
    }
    let cancelled = false
    setLocalIntegrityReady(false)
    const metadataIds = new Set(knownLocalAssetIds)
    const candidates = referencedLocalAssetIds.filter((assetId) =>
      metadataIds.has(assetId)
    )
    void Promise.all(
      candidates.map(async (assetId) => ({
        assetId,
        hasBlob: await hasLocalAssetBlob(assetId),
      }))
    )
      .then((results) => {
        if (cancelled) return
        setHealthyReferencedLocalAssetIds(
          healthyLocalAssetIds(
            candidates,
            results
              .filter((result) => result.hasBlob)
              .map((result) => result.assetId)
          )
        )
        setLocalIntegrityReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setHealthyReferencedLocalAssetIds([])
        setLocalIntegrityReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [
    knownLocalAssetSignature,
    knownLocalAssetIds,
    localStatus,
    open,
    referencedLocalAssetIds,
    referencedLocalAssetSignature,
  ])

  useEffect(
    () => () => {
      managedRequestRef.current?.abort()
      managedPaginationRequestRef.current.recent?.abort()
      managedPaginationRequestRef.current.uploads?.abort()
      for (const cancel of uploadCancelsRef.current.values()) cancel()
      uploadCancelsRef.current.clear()
    },
    []
  )

  const markPreviewFailed = useCallback((assetKey: string) => {
    setPreviewFailures((current) => new Set(current).add(assetKey))
  }, [])

  const chooseAsset = useCallback(
    async (selection: AssetLibrarySelection, selectionId: string) => {
      setSelectingId(selectionId)
      setSelectionError(null)
      try {
        const result = await onSelect(selection)
        const succeeded = typeof result === "boolean" ? result : result.ok
        if (!succeeded) {
          setSelectionError(
            typeof result === "object" && result.message
              ? result.message
              : mode === "replace"
                ? "That image could not be replaced. The design was not changed."
                : "That image could not be added. The design was not changed."
          )
          return
        }
        if (selection.kind === "library") {
          setRecentLibraryUse((current) => {
            const next = recordRecentLibraryUse(
              current,
              selection.asset.id,
              Date.now()
            )
            window.localStorage.setItem(
              recentLibraryStorageKey,
              JSON.stringify(next)
            )
            return next
          })
        } else if (selection.kind === "managed") {
          const used = {
            ...selection.asset,
            lastUsedAt: new Date().toISOString(),
          }
          setManagedRecent((current) => ({
            ...current,
            assets: sortManagedMediaAssets(
              [used, ...current.assets.filter((item) => item.id !== used.id)],
              "recent"
            ),
          }))
        } else {
          const usedAt = new Date().toISOString()
          setLocalAssets((current) =>
            current.map((asset) =>
              asset.id === selection.asset.id
                ? { ...asset, lastUsedAt: usedAt }
                : asset
            )
          )
        }
        if (hasActiveUploads) {
          setDialogNotice(
            mode === "replace"
              ? "Image replaced. Uploads are still in progress."
              : "Image added. Uploads are still in progress."
          )
          return
        }
        onOpenChange(false)
      } catch (error) {
        setSelectionError(readableMediaError(error))
      } finally {
        setSelectingId(null)
      }
    },
    [hasActiveUploads, mode, onOpenChange, onSelect]
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
    async (queueId: string, file: File, idempotencyKey: string) => {
      const validationError = validateMediaFile(file)
      if (validationError) {
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: "failed",
                  progress: null,
                  error: validationError,
                  asset: null,
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
                phase: "preparing",
                progress: null,
                error: null,
                asset: null,
              }
            : item
        )
      )
      const request = uploadManagedMedia(file, {
        idempotencyKey,
        onProgress: (loaded, total) =>
          setUploadQueue((current) =>
            current.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    phase: "uploading",
                    progress: total
                      ? Math.min(100, Math.round((loaded / total) * 100))
                      : null,
                  }
                : item
            )
          ),
      })
      uploadCancelsRef.current.set(queueId, request.cancel)
      setUploadQueue((current) =>
        current.map((item) =>
          item.id === queueId
            ? { ...item, phase: "uploading", progress: null }
            : item
        )
      )
      try {
        const asset = await request.promise
        uploadCancelsRef.current.delete(queueId)
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: "complete",
                  progress: 100,
                  asset,
                  error: null,
                }
              : item
          )
        )
        upsertManagedUpload(asset)
        void refreshManagedAssets(normalizedQueryRef.current)
        setDialogNotice(`“${file.name}” is ready to use.`)
      } catch (error) {
        uploadCancelsRef.current.delete(queueId)
        const cancelled =
          error instanceof Error && error.message === "Upload cancelled."
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  phase: cancelled ? "cancelled" : "failed",
                  progress: null,
                  error: cancelled ? null : readableMediaError(error),
                }
              : item
          )
        )
      }
    },
    [refreshManagedAssets, upsertManagedUpload]
  )

  const queueFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      if (selectingId) {
        setDialogNotice("Wait for the current image change to finish.")
        return
      }
      setCollection("uploads")
      setDialogNotice(null)
      const items = files.map<UploadQueueItem>((file) => ({
        id: crypto.randomUUID(),
        file,
        idempotencyKey: crypto.randomUUID(),
        phase: "preparing",
        progress: null,
        error: null,
        asset: null,
      }))
      setUploadQueue((current) => [...items, ...current])
      for (const item of items) {
        void runUpload(item.id, item.file, item.idempotencyKey)
      }
    },
    [runUpload, selectingId]
  )

  const retryUpload = useCallback(
    (queueId: string) => {
      const item = uploadQueue.find((candidate) => candidate.id === queueId)
      if (item) void runUpload(item.id, item.file, item.idempotencyKey)
    },
    [runUpload, uploadQueue]
  )

  const loadMoreManaged = useCallback(
    async (kind: ManagedMediaCollection) => {
      const current = kind === "recent" ? managedRecent : managedUploads
      if (selectingId || !current.nextCursor || current.status === "loading") {
        return
      }
      managedPaginationRequestRef.current[kind]?.abort()
      const controller = new AbortController()
      managedPaginationRequestRef.current[kind] = controller
      const generation = managedRequestGenerationRef.current
      const queryAtStart = normalizedQuery
      const setState = kind === "recent" ? setManagedRecent : setManagedUploads
      setState((state) => ({ ...state, status: "loading", error: null }))
      try {
        const next = await listManagedMedia({
          collection: kind,
          query: queryAtStart,
          cursor: current.nextCursor,
          signal: controller.signal,
        })
        if (
          controller.signal.aborted ||
          managedPaginationRequestRef.current[kind] !== controller ||
          managedRequestGenerationRef.current !== generation
        ) {
          return
        }
        setState((state) => ({
          ...next,
          assets: sortManagedMediaAssets(
            [
              ...state.assets,
              ...next.assets.filter(
                (asset) =>
                  (kind !== "recent" || wasMediaAssetUsed(asset)) &&
                  !state.assets.some((item) => item.id === asset.id)
              ),
            ],
            kind
          ),
          status: "ready",
          error: null,
        }))
      } catch (error) {
        if (controller.signal.aborted) return
        setState((state) => ({
          ...state,
          status: "error",
          error: readableMediaError(error),
        }))
      } finally {
        if (managedPaginationRequestRef.current[kind] === controller) {
          managedPaginationRequestRef.current[kind] = null
        }
      }
    },
    [managedRecent, managedUploads, normalizedQuery, selectingId]
  )

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
        setManagedRecent(remove)
        setManagedUploads(remove)
        await refreshManagedAssets(normalizedQuery)
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
    normalizedQuery,
    refreshLocalAssets,
    refreshManagedAssets,
    selectingId,
  ])

  const visibleLibraryAssets = useMemo(
    () =>
      studioAssets.filter((asset) =>
        matchesAssetSearch(
          query,
          asset.name,
          asset.description,
          asset.tags.join(" ")
        )
      ),
    [query]
  )
  const visibleLocalAssets = useMemo(
    () =>
      localAssets.filter((asset) =>
        matchesAssetSearch(query, asset.name, asset.mediaType)
      ),
    [localAssets, query]
  )
  const missingAssetIds = useMemo(
    () =>
      localIntegrityReady
        ? missingLocalAssetIds(document, healthyReferencedLocalAssetIds).filter(
            (assetId) => matchesAssetSearch(query, assetId, "missing")
          )
        : [],
    [document, healthyReferencedLocalAssetIds, localIntegrityReady, query]
  )
  const recentAssets = useMemo(() => {
    const managed = managedRecent.assets.map((asset) => ({
      kind: "managed" as const,
      sortAt: Date.parse(asset.lastUsedAt || asset.updatedAt),
      asset,
    }))
    const local = visibleLocalAssets.filter(wasMediaAssetUsed).map((asset) => ({
      kind: "local" as const,
      sortAt: Date.parse(asset.lastUsedAt),
      asset,
    }))
    const library = visibleLibraryAssets
      .filter((asset) => recentLibraryUse[asset.id])
      .map((asset) => ({
        kind: "library" as const,
        sortAt: recentLibraryUse[asset.id] ?? 0,
        asset,
      }))
    return [...managed, ...local, ...library].sort(
      (left, right) => right.sortAt - left.sortAt
    )
  }, [
    managedRecent.assets,
    recentLibraryUse,
    visibleLibraryAssets,
    visibleLocalAssets,
  ])
  const collectionCounts = {
    recent: recentAssets.length,
    uploads: managedUploads.assets.length + visibleLocalAssets.length,
    library: visibleLibraryAssets.length,
  }
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
  const interactionLocked = selectingId !== null
  const actionPrefix =
    mode === "replace"
      ? `Replace ${targetName ? `“${targetName}”` : "selected image"} with`
      : "Insert"

  const renderLibraryCard = (asset: StudioAsset) => {
    const assetKey = `library:${asset.id}`
    return (
      <AssetCard
        key={assetKey}
        actionLabel={`${actionPrefix} ${asset.name}`}
        assetKey={assetKey}
        busy={selectingId === assetKey}
        detail={asset.description}
        disabled={selectingId !== null}
        height={asset.height}
        name={asset.name}
        previewFailed={previewFailures.has(assetKey)}
        mutationDisabled={selectingId !== null}
        sourceLabel="Studio original"
        src={asset.src}
        width={asset.width}
        onChoose={() => void chooseAsset({ kind: "library", asset }, assetKey)}
        onPreviewFailure={markPreviewFailed}
      />
    )
  }

  const renderLocalCard = (asset: LocalAssetSummary) => {
    const assetKey = `local:${asset.id}`
    return (
      <LocalAssetCard
        key={assetKey}
        actionLabel={`${actionPrefix} ${asset.name}`}
        asset={asset}
        busy={selectingId === assetKey}
        detail={`${formatAssetBytes(asset.size)} · ${asset.mediaType.replace("image/", "").toLocaleUpperCase()}`}
        disabled={selectingId !== null}
        mutationDisabled={selectingId !== null}
        previewFailed={previewFailures.has(assetKey)}
        onChoose={() => void chooseAsset({ kind: "local", asset }, assetKey)}
        onDelete={() => startLocalDeleteReview(asset)}
        onLocateMissing={
          onLocateMissingLocalAsset
            ? () => onLocateMissingLocalAsset(asset.id)
            : undefined
        }
        onPreviewFailure={markPreviewFailed}
      />
    )
  }

  const renderManagedCard = (asset: ManagedMediaAsset) => {
    const assetKey = `managed:${asset.id}`
    return (
      <AssetCard
        key={assetKey}
        actionLabel={`${actionPrefix} ${asset.name}`}
        assetKey={assetKey}
        busy={selectingId === assetKey}
        detail={`${formatAssetBytes(asset.bytes)} · ${asset.width} × ${asset.height}`}
        disabled={selectingId !== null}
        height={asset.height}
        name={asset.name}
        previewFailed={previewFailures.has(assetKey)}
        mutationDisabled={selectingId !== null}
        sourceLabel="Workspace upload"
        src={managedMediaContentUrl(asset.id)}
        width={asset.width}
        onChoose={() => void chooseAsset({ kind: "managed", asset }, assetKey)}
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
    if (!nextOpen && hasActiveUploads) {
      setDialogNotice(
        "Uploads are still in progress. Cancel them before closing."
      )
      return false
    }
    onOpenChange(nextOpen)
    return true
  }
  const retryRepositories = () => {
    void refreshManagedAssets(normalizedQuery)
    if (localStatus === "error") void refreshLocalAssets()
  }
  const statusMessage = selectionError ?? dialogNotice ?? ""
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

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        aria-describedby="asset-library-description"
        className="top-0 left-0 grid h-[100dvh] max-h-none max-w-none translate-x-0 translate-y-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(800px,calc(100dvh-2rem))] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        showCloseButton={false}
      >
        <DialogHeader className="border-b px-4 pt-[max(1rem,env(safe-area-inset-top))] pr-16 pb-3 sm:px-5 sm:py-4 sm:pr-16">
          <DialogTitle>
            {mode === "replace" ? "Replace image" : "Add image"}
          </DialogTitle>
          <DialogDescription id="asset-library-description" className="text-xs">
            {mode === "replace"
              ? `Choose a replacement${targetName ? ` for “${targetName}”` : ""}. Your crop and layer position stay intact.`
              : "Choose from recent media, reusable uploads, or original Studio artwork."}
          </DialogDescription>
        </DialogHeader>
        <Button
          aria-label="Close media library"
          className="absolute top-[max(.65rem,env(safe-area-inset-top))] right-3 size-11 sm:top-2.5"
          disabled={hasActiveUploads || interactionLocked}
          size="icon"
          variant="ghost"
          onClick={() => requestClose(false)}
        >
          <XIcon />
        </Button>

        <div
          className={`flex flex-col gap-2 border-b px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:px-4 ${dragActive ? "bg-muted ring-2 ring-foreground/20 ring-inset" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!interactionLocked) setDragActive(true)
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
            if (!interactionLocked)
              queueFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search media"
              autoComplete="off"
              className="h-11 pl-9"
              placeholder="Search by name, type, or keyword"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <input
            ref={fileInputRef}
            accept={MEDIA_UPLOAD_ACCEPT}
            aria-label="Choose media files to upload"
            className="sr-only"
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
            className="h-11 shrink-0"
            disabled={interactionLocked}
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon data-icon="inline-start" />
            Upload images
          </Button>
          <span className="text-[11px] text-muted-foreground sm:max-w-44">
            {dragActive
              ? "Drop images to upload"
              : "PNG, JPEG, or WebP · 25 MB max"}
          </span>
        </div>

        <div
          className={`border-b px-4 py-2 text-xs empty:hidden ${selectionError ? "bg-destructive/5 text-destructive" : "bg-muted/45 text-muted-foreground"}`}
          role="status"
        >
          {statusMessage}
        </div>

        <Tabs
          className="min-h-0 gap-0 overflow-hidden"
          value={collection}
          onValueChange={(value) =>
            setCollection(value as AssetLibraryCollection)
          }
        >
          <TabsList
            aria-label="Media collections"
            className="h-12 w-full justify-start gap-5 border-b px-4"
            variant="line"
          >
            <TabsTrigger className="h-full flex-none px-0" value="recent">
              Recent <span aria-hidden="true">{collectionCounts.recent}</span>
            </TabsTrigger>
            <TabsTrigger className="h-full flex-none px-0" value="uploads">
              Uploads <span aria-hidden="true">{collectionCounts.uploads}</span>
            </TabsTrigger>
            <TabsTrigger className="h-full flex-none px-0" value="library">
              Library <span aria-hidden="true">{collectionCounts.library}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent
            aria-busy={managedRecent.status === "loading"}
            className="flex min-h-0 flex-col overflow-hidden"
            value="recent"
          >
            {managedRecent.status === "error" ? (
              <RepositoryNotice
                message={
                  managedRecent.error ?? "Recent cloud media could not load."
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
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 pb-8">
                {recentAssets.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {recentAssets.map((item) =>
                      item.kind === "managed"
                        ? renderManagedCard(item.asset)
                        : item.kind === "local"
                          ? renderLocalCard(item.asset)
                          : renderLibraryCard(item.asset)
                    )}
                  </div>
                ) : managedRecent.status === "loading" ||
                  localStatus === "loading" ? (
                  <LoadingGrid />
                ) : (
                  <EmptyCollection
                    collection="recent"
                    query={normalizedQuery}
                    searching={Boolean(normalizedQuery)}
                    onClearSearch={() => setQuery("")}
                    onUpload={() => fileInputRef.current?.click()}
                  />
                )}
                {managedRecent.nextCursor ? (
                  <div className="mt-4 flex justify-center">
                    <Button
                      className="h-11"
                      disabled={
                        interactionLocked || managedRecent.status === "loading"
                      }
                      variant="outline"
                      onClick={() => void loadMoreManaged("recent")}
                    >
                      {managedRecent.status === "loading" ? (
                        <LoaderCircleIcon
                          className="animate-spin"
                          data-icon="inline-start"
                        />
                      ) : null}
                      Load more
                    </Button>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            aria-busy={
              managedUploads.status === "loading" || localStatus === "loading"
            }
            className="flex min-h-0 flex-col overflow-hidden"
            value="uploads"
          >
            <ScrollArea className="min-h-0 flex-1">
              <UploadQueue
                disabled={interactionLocked}
                items={uploadQueue}
                selectingId={selectingId}
                onCancel={(id) => uploadCancelsRef.current.get(id)?.()}
                onDismiss={(id) =>
                  setUploadQueue((current) =>
                    current.filter((item) => item.id !== id)
                  )
                }
                onRetry={retryUpload}
                onUse={(item) => {
                  if (item.asset) {
                    void chooseAsset(
                      { kind: "managed", asset: item.asset },
                      `managed:${item.asset.id}`
                    )
                  }
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
                    Device storage is nearly full. Local history files stay
                    retained for Undo, so free browser or device storage if a
                    local restore fails.
                  </p>
                </div>
              ) : null}
              <div className="p-4 pb-8">
                {missingAssetIds.length ? (
                  <div className="mb-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <div>
                        <p className="text-xs font-medium">
                          {missingAssetIds.length} local{" "}
                          {missingAssetIds.length === 1
                            ? "file is"
                            : "files are"}{" "}
                          missing
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          This design still references files that are not
                          available on this device. Locate a replacement to
                          preserve each layer's geometry.
                        </p>
                        <div className="mt-2 grid gap-1.5">
                          {missingAssetIds.map((assetId) => (
                            <Button
                              key={assetId}
                              className="h-11 justify-start"
                              disabled={
                                interactionLocked || !onLocateMissingLocalAsset
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                              onClick={() =>
                                onLocateMissingLocalAsset?.(assetId)
                              }
                            >
                              Locate replacement for {assetId}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {managedUploads.assets.length || visibleLocalAssets.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {managedUploads.assets.map(renderManagedCard)}
                    {visibleLocalAssets.map(renderLocalCard)}
                  </div>
                ) : managedUploads.status === "loading" ||
                  localStatus === "loading" ? (
                  <LoadingGrid />
                ) : uploadQueue.length === 0 ? (
                  <EmptyCollection
                    collection="uploads"
                    query={normalizedQuery}
                    searching={Boolean(normalizedQuery)}
                    onClearSearch={() => setQuery("")}
                    onUpload={() => fileInputRef.current?.click()}
                  />
                ) : null}
                {managedUploads.nextCursor ? (
                  <div className="mt-4 flex justify-center">
                    <Button
                      className="h-11"
                      disabled={
                        interactionLocked || managedUploads.status === "loading"
                      }
                      variant="outline"
                      onClick={() => void loadMoreManaged("uploads")}
                    >
                      {managedUploads.status === "loading" ? (
                        <LoaderCircleIcon
                          className="animate-spin"
                          data-icon="inline-start"
                        />
                      ) : null}
                      Load more
                    </Button>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            className="flex min-h-0 flex-col overflow-hidden"
            value="library"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 pb-8">
                {visibleLibraryAssets.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {visibleLibraryAssets.map(renderLibraryCard)}
                  </div>
                ) : (
                  <EmptyCollection
                    collection="library"
                    query={normalizedQuery}
                    searching={Boolean(normalizedQuery)}
                    onClearSearch={() => setQuery("")}
                    onUpload={() => fileInputRef.current?.click()}
                  />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <footer className="grid gap-2 border-t bg-muted/35 px-4 py-2.5 text-[11px] text-muted-foreground sm:grid-cols-2 sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <CloudIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              Workspace:{" "}
              {managedStorage
                ? `${managedStorage.count} files · ${formatAssetBytes(managedStorage.bytes)}`
                : "—"}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:justify-end">
            <HardDriveIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              This device:{" "}
              {localStorage
                ? `${localStorage.activeAssetCount} available · ${formatAssetBytes(localStorage.activeAssetBytes)}${localStorage.archivedAssetCount ? ` · ${localStorage.archivedAssetCount} retained for history (${formatAssetBytes(localStorage.archivedAssetBytes)})` : ""}`
                : "—"}
            </span>
          </div>
        </footer>
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
                disabled={interactionLocked}
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
