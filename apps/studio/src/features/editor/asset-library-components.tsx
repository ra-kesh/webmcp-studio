import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  CheckIcon,
  ImageIcon,
  ImageOffIcon,
  LibraryIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@webmcp/ui/components/empty"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import type { ManagedMediaAsset } from "./managed-media-repository"
import type { UnresolvedLocalMediaAdmission } from "@webmcp/document"
import { loadLocalAsset } from "./local-asset-store"
import type { LocalAssetSummary } from "./local-asset-store"
import type { LocalAssetPromotionViewState } from "./use-document-editor"
import type { LocalMediaRecoveryImpact } from "./asset-library-model"
import { localMediaRecoveryImpactSummary } from "./asset-library-model"

export type AssetLibraryCollection = "recent" | "uploads" | "library"
export type UploadPhase =
  | "queued"
  | "preparing"
  | "uploading"
  | "cancelling"
  | "reconciling"
  | "complete"
  | "status_unknown"
  | "failed"
  | "cancelled"

export type UploadQueueItem = {
  id: string
  file: File
  idempotencyKey: string
  phase: UploadPhase
  progress: number | null
  error: string | null
  asset: ManagedMediaAsset | null
  retryable: boolean
  attempt: number
}

export type LocalMediaRecoveryMappingState =
  "checking" | "ready" | "archived" | "unmapped" | "unavailable"

export type LocalMediaRecoveryDeviceState =
  "ready" | "missing_bytes" | "absent" | "quarantined" | "unavailable"

export type LocalMediaRecoveryOperationState = Readonly<{
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

export function MissingLocalAssetRecoveryCard({
  localAssetId,
  impact,
  deviceState = "absent",
  mappingState,
  operation,
  admissionOutcome,
  disabled = false,
  removeDisabledReason = null,
  onUseStudioCopy,
  onRetryMapping,
  onRetryRecovery,
  onCancelRecovery,
  onLocateFile,
  onKeepLocatedFile,
  onChooseStudioImage,
  onRemove,
  references = [],
  onNavigateToReference,
  onClearReference,
  reviewOnly = false,
  actionDisabledReason = null,
}: {
  localAssetId: string
  impact: LocalMediaRecoveryImpact
  deviceState?: LocalMediaRecoveryDeviceState
  mappingState: LocalMediaRecoveryMappingState
  operation?: LocalMediaRecoveryOperationState
  admissionOutcome?: UnresolvedLocalMediaAdmission["outcome"]
  disabled?: boolean
  removeDisabledReason?: string | null
  onUseStudioCopy?: () => void
  onRetryMapping?: () => void
  onRetryRecovery?: () => void
  onCancelRecovery?: () => void
  onLocateFile: (file: File) => void
  onKeepLocatedFile?: () => void
  onChooseStudioImage: () => void
  onRemove?: () => void
  references?: readonly Readonly<{
    key: string
    label: string
    detail: string
    nodeId: string | null
    pageId: string | null
    fieldId: string | null
    outputId?: string | null
    clearReferenceKey?: string | null
    clearDisabledReason?: string | null
  }>[]
  onNavigateToReference?: (reference: {
    nodeId: string | null
    pageId: string | null
    fieldId: string | null
    outputId?: string | null
  }) => void
  onClearReference?: (referenceKey: string) => void
  reviewOnly?: boolean
  actionDisabledReason?: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const recoveryActionRef = useRef<HTMLButtonElement>(null)
  const previousOperationPhaseRef = useRef(operation?.phase)
  const busy =
    operation?.phase === "preparing" ||
    operation?.phase === "cancelling" ||
    operation?.phase === "saving"
  const mappingLabel =
    mappingState === "checking"
      ? "Checking Studio copies…"
      : mappingState === "ready"
        ? "Studio copy available"
        : mappingState === "archived"
          ? "Studio backup found"
          : mappingState === "unmapped"
            ? "No Studio copy found"
            : "Backup status unknown"
  const deviceLabel =
    deviceState === "ready"
      ? "On this device"
      : deviceState === "missing_bytes"
        ? "File bytes are missing from this device"
        : deviceState === "quarantined"
          ? "A damaged local copy was quarantined"
          : deviceState === "unavailable"
            ? "Device media status unknown"
            : "File missing on this device"
  const statusMessage =
    operation?.message ??
    (admissionOutcome === "identity_conflict"
      ? "The device file and Studio copy have different contents."
      : mappingLabel)
  const useCopyAvailable =
    (mappingState === "ready" || mappingState === "archived") &&
    Boolean(onUseStudioCopy)
  const finishSavingOnly =
    operation?.phase === "failed" &&
    operation.retryable &&
    operation.retryAction === "finish_saving"

  useEffect(() => {
    const previous = previousOperationPhaseRef.current
    previousOperationPhaseRef.current = operation?.phase
    if (
      previous !== operation?.phase &&
      (operation?.phase === "identity_conflict" ||
        (operation?.phase === "failed" &&
          operation.retryAction === "finish_saving"))
    ) {
      recoveryActionRef.current?.focus()
    }
  }, [operation?.phase, operation?.retryAction])

  return (
    <section
      aria-labelledby={`missing-media-${localAssetId}`}
      className="grid gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
      data-missing-local-asset-id={localAssetId}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <ImageOffIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            id={`missing-media-${localAssetId}`}
            className="text-sm font-medium"
          >
            {deviceLabel}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {localMediaRecoveryImpactSummary(impact)}
          </p>
          <p
            className="mt-1 text-xs leading-5 text-muted-foreground"
            role={
              operation?.phase === "failed" ||
              operation?.phase === "identity_conflict"
                ? "alert"
                : "status"
            }
            aria-live="polite"
          >
            {statusMessage}
          </p>
        </div>
      </div>

      {!reviewOnly && useCopyAvailable && deviceState !== "ready" ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Undo restores the device-only reference. If its file is still
          unavailable on this device, the placeholder returns until you locate
          it.
        </p>
      ) : null}

      {references.length ? (
        <div className="grid gap-1" aria-label="Affected document uses">
          {references.map((reference) => (
            <div
              key={reference.key}
              className="flex min-h-11 items-center gap-1 rounded-lg border bg-background p-1"
            >
              <button
                className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                type="button"
                onClick={() => onNavigateToReference?.(reference)}
              >
                <span className="min-w-0 truncate font-medium">
                  {reference.label}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {reference.detail}
                </span>
              </button>
              {!reviewOnly &&
              !finishSavingOnly &&
              reference.clearReferenceKey &&
              onClearReference ? (
                <Button
                  className="h-9 shrink-0"
                  disabled={
                    disabled || busy || Boolean(reference.clearDisabledReason)
                  }
                  size="sm"
                  title={reference.clearDisabledReason ?? undefined}
                  type="button"
                  variant="ghost"
                  onClick={() => onClearReference(reference.clearReferenceKey!)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!reviewOnly ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {operation?.phase === "preparing" && onCancelRecovery ? (
            <Button
              className="h-11"
              size="sm"
              type="button"
              variant="outline"
              onClick={onCancelRecovery}
            >
              Cancel recovery
            </Button>
          ) : null}
          {finishSavingOnly && onRetryRecovery ? (
            <Button
              ref={recoveryActionRef}
              className="h-11"
              disabled={disabled || busy}
              size="sm"
              type="button"
              onClick={onRetryRecovery}
            >
              <RefreshCwIcon />
              Finish saving
            </Button>
          ) : null}
          {!finishSavingOnly && useCopyAvailable ? (
            <Button
              ref={
                operation?.phase === "identity_conflict"
                  ? recoveryActionRef
                  : undefined
              }
              className="h-11"
              disabled={disabled || busy}
              size="sm"
              type="button"
              onClick={onUseStudioCopy}
            >
              {busy ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CheckIcon />
              )}
              {operation?.phase === "identity_conflict"
                ? "Replace with Studio copy"
                : `Use Studio ${mappingState === "archived" ? "backup" : "copy"}`}
            </Button>
          ) : null}
          {operation?.phase === "identity_conflict" && onKeepLocatedFile ? (
            <Button
              ref={useCopyAvailable ? undefined : recoveryActionRef}
              className="h-11"
              disabled={disabled || busy}
              size="sm"
              type="button"
              variant="outline"
              onClick={onKeepLocatedFile}
            >
              <UploadIcon />
              Keep as new upload
            </Button>
          ) : null}
          {!finishSavingOnly &&
          mappingState === "unavailable" &&
          onRetryMapping ? (
            <Button
              className="h-11"
              disabled={disabled || busy}
              size="sm"
              type="button"
              variant="outline"
              onClick={onRetryMapping}
            >
              <RefreshCwIcon />
              Retry Studio check
            </Button>
          ) : null}
          {!finishSavingOnly ? (
            <>
              <Button
                className="h-11"
                disabled={disabled || busy}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                <UploadIcon />
                Locate file
              </Button>
              <input
                ref={inputRef}
                accept="image/png,image/jpeg,image/webp"
                aria-hidden="true"
                hidden
                tabIndex={-1}
                type="file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) onLocateFile(file)
                  event.currentTarget.value = ""
                }}
              />
              <Button
                className="h-11"
                disabled={disabled || busy}
                size="sm"
                type="button"
                variant="outline"
                onClick={onChooseStudioImage}
              >
                <LibraryIcon />
                Choose Studio image
              </Button>
              {onRemove && references.length === 0 ? (
                <Button
                  className="h-11"
                  disabled={disabled || busy || Boolean(removeDisabledReason)}
                  size="sm"
                  title={removeDisabledReason ?? undefined}
                  type="button"
                  variant="outline"
                  onClick={onRemove}
                >
                  <Trash2Icon />
                  Clear from document
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {!reviewOnly && removeDisabledReason ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {removeDisabledReason}
        </p>
      ) : null}
      {!reviewOnly && actionDisabledReason ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {actionDisabledReason}
        </p>
      ) : null}
    </section>
  )
}

export const uploadPhaseLabel: Record<UploadPhase, string> = {
  queued: "Queued",
  preparing: "Preparing",
  uploading: "Uploading",
  cancelling: "Stopping",
  reconciling: "Checking server",
  complete: "Ready",
  status_unknown: "Status unknown",
  failed: "Upload failed",
  cancelled: "Cancelled",
}

export function isUploadActive(item: UploadQueueItem) {
  return (
    item.phase === "queued" ||
    item.phase === "preparing" ||
    item.phase === "uploading" ||
    item.phase === "cancelling" ||
    item.phase === "reconciling"
  )
}

export const isUploadInFlight = (item: UploadQueueItem) =>
  item.phase === "preparing" ||
  item.phase === "uploading" ||
  item.phase === "cancelling" ||
  item.phase === "reconciling"

export const nextManagedUploadClaims = (
  items: readonly UploadQueueItem[],
  claimedIds: ReadonlySet<string>,
  concurrency: number
) => {
  const ownedIds = new Set(
    items.filter(isUploadInFlight).map((item) => item.id)
  )
  for (const queueId of claimedIds) ownedIds.add(queueId)
  const available = Math.max(0, concurrency - ownedIds.size)
  if (available === 0) return []
  return items
    .filter((item) => item.phase === "queued" && !ownedIds.has(item.id))
    .slice(0, available)
}

function AssetPreview({
  assetKey,
  src,
  width,
  height,
  failed,
  onFailure,
  state = "ready",
}: {
  assetKey: string
  src: string | null
  width: number | null
  height: number | null
  failed: boolean
  onFailure: (assetKey: string) => void
  state?: "pending" | "ready" | "missing"
}) {
  if (state === "pending") {
    return <Skeleton className="size-full rounded-none" />
  }

  if (failed || state === "missing" || !src) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
        <ImageOffIcon className="size-5" />
        <span className="text-[11px] font-medium">
          {state === "missing"
            ? "File missing on this device"
            : "Preview unavailable"}
        </span>
      </div>
    )
  }

  return (
    <img
      alt=""
      className="size-full object-cover"
      decoding="async"
      height={height ?? 900}
      loading="lazy"
      src={src}
      width={width ?? 1200}
      onError={() => onFailure(assetKey)}
    />
  )
}

export function AssetCard({
  assetKey,
  name,
  detail,
  sourceLabel,
  src,
  width,
  height,
  previewFailed,
  disabled,
  actionLabel,
  onPreviewFailure,
  onChoose,
  onDelete,
  previewState = "ready",
  busy = false,
  mutationDisabled = false,
}: {
  assetKey: string
  name: string
  detail: string
  sourceLabel: string
  src: string | null
  width: number | null
  height: number | null
  previewFailed: boolean
  disabled: boolean
  actionLabel: string
  onPreviewFailure: (assetKey: string) => void
  onChoose: () => void
  onDelete?: () => void
  previewState?: "pending" | "ready" | "missing"
  busy?: boolean
  mutationDisabled?: boolean
}) {
  return (
    <div
      className="group/asset relative min-w-0 overflow-hidden rounded-xl border bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 hover:border-foreground/25"
      style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
    >
      <button
        aria-label={actionLabel}
        className="block w-full text-left outline-none disabled:cursor-not-allowed disabled:opacity-55"
        disabled={disabled}
        type="button"
        onClick={onChoose}
      >
        <div className="relative aspect-4/3 overflow-hidden bg-muted">
          <AssetPreview
            assetKey={assetKey}
            failed={previewFailed}
            height={height}
            src={src}
            state={previewState}
            width={width}
            onFailure={onPreviewFailure}
          />
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/65 backdrop-blur-[1px]">
              <LoaderCircleIcon className="size-5 animate-spin" />
              <span className="sr-only">Applying image</span>
            </div>
          ) : null}
        </div>
        <div className="min-w-0 px-3 py-2.5 pr-10">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail}
          </p>
          <p className="mt-1 text-[11px] font-medium text-muted-foreground/80">
            {sourceLabel}
          </p>
        </div>
      </button>
      {onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`More actions for ${name}`}
              className="absolute right-1.5 bottom-1.5 size-11 bg-background/90 opacity-100 shadow-xs backdrop-blur-sm sm:opacity-0 sm:group-focus-within/asset:opacity-100 sm:group-hover/asset:opacity-100"
              disabled={mutationDisabled}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="min-h-11"
              variant="destructive"
              onSelect={onDelete}
            >
              <Trash2Icon />
              Remove from uploads
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

export function LocalAssetPromotionControl({
  promotion,
  referenceCount,
  mutationDisabled,
  blockedByOtherPromotion = false,
  onPromote,
  onCancelPromotion,
}: {
  promotion?: LocalAssetPromotionViewState
  referenceCount: number
  mutationDisabled: boolean
  blockedByOtherPromotion?: boolean
  onPromote: () => void
  onCancelPromotion?: () => void
}) {
  const cancellable =
    promotion &&
    [
      "preparing",
      "queued",
      "hashing",
      "reconciling",
      "uploading",
      "relinking",
    ].includes(promotion.phase)
  const finishing =
    promotion?.phase === "saving" || promotion?.phase === "updating_recent"
  const stopping = promotion?.phase === "cancelling"
  const label = !promotion
    ? blockedByOtherPromotion
      ? "Another image is being made available."
      : `${referenceCount} ${referenceCount === 1 ? "use" : "uses"} in this document`
    : promotion.phase === "preparing" || promotion.phase === "queued"
      ? "Preparing image…"
      : promotion.phase === "hashing"
        ? "Verifying image bytes…"
        : promotion.phase === "reconciling"
          ? (promotion.message ?? "Checking workspace copy…")
          : promotion.phase === "uploading"
            ? promotion.total && promotion.loaded !== null
              ? `Uploading ${Math.round((promotion.loaded / promotion.total) * 100)}%…`
              : "Uploading…"
            : promotion.phase === "relinking"
              ? "Relinking this document…"
              : promotion.phase === "saving"
                ? "Saving everywhere…"
                : promotion.phase === "updating_recent"
                  ? "Updating Recent…"
                  : promotion.phase === "complete"
                    ? promotion.undoable
                      ? "Available everywhere. Undo restores the device-only reference."
                      : "Available everywhere. No new Undo step is available."
                    : promotion.phase === "backed_up"
                      ? "Backed up, relink not applied"
                      : promotion.message
                        ? promotion.message
                        : promotion.phase === "cancelling"
                          ? "Stopping…"
                          : promotion.phase === "cancelled"
                            ? "Backup cancelled"
                            : promotion.phase === "status_unknown"
                              ? "Backup status unknown"
                              : promotion.phase === "conflict"
                                ? "This image conflicts with its workspace copy"
                                : "Backup needs attention"

  return (
    <div
      aria-busy={Boolean(cancellable || finishing || stopping)}
      className="grid gap-2 rounded-lg border bg-muted/30 p-2.5"
    >
      <div
        className="text-xs leading-5 text-muted-foreground"
        role={promotion?.phase === "conflict" ? "alert" : "status"}
        aria-live="polite"
      >
        {label}
      </div>
      {!promotion ? (
        <Button
          className="h-11 w-full"
          disabled={mutationDisabled || blockedByOtherPromotion}
          size="sm"
          type="button"
          variant="outline"
          onClick={onPromote}
        >
          <UploadIcon />
          Make available everywhere
        </Button>
      ) : cancellable && onCancelPromotion ? (
        <Button
          className="h-11 w-full"
          size="sm"
          type="button"
          variant="outline"
          onClick={onCancelPromotion}
        >
          <XIcon />
          Cancel
        </Button>
      ) : stopping ? (
        <Button
          className="h-11 w-full"
          disabled
          size="sm"
          type="button"
          variant="outline"
        >
          <LoaderCircleIcon className="animate-spin" />
          Stopping…
        </Button>
      ) : promotion.retryable ? (
        <Button
          className="h-11 w-full"
          size="sm"
          type="button"
          variant="outline"
          onClick={onPromote}
        >
          <RefreshCwIcon />
          {promotion.phase === "backed_up" ? "Retry relink" : "Retry"}
        </Button>
      ) : null}
    </div>
  )
}

export function LocalAssetCard({
  asset,
  actionLabel,
  detail,
  disabled,
  previewFailed,
  onChoose,
  onDelete,
  onPreviewFailure,
  busy,
  mutationDisabled,
  promotionBlockedByOther,
  onLocateMissing,
  promotion,
  referenceCount,
  onPromote,
  onCancelPromotion,
}: {
  asset: LocalAssetSummary
  actionLabel: string
  detail: string
  disabled: boolean
  previewFailed: boolean
  onChoose: () => void
  onDelete: () => void
  onPreviewFailure: (assetKey: string) => void
  busy: boolean
  mutationDisabled: boolean
  promotionBlockedByOther?: boolean
  onLocateMissing?: (file: File) => void
  promotion?: LocalAssetPromotionViewState
  referenceCount: number
  onPromote?: () => void
  onCancelPromotion?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const locateInputRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<{
    state: "pending" | "ready" | "missing"
    url: string | null
  }>({ state: "pending", url: null })
  const assetKey = `local:${asset.id}`
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    if (!("IntersectionObserver" in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "240px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      setPreview({ state: "pending", url: null })
      return
    }
    let disposed = false
    let objectUrl: string | null = null
    void loadLocalAsset(asset.id)
      .then((blob) => {
        if (disposed) return
        if (!blob) {
          setPreview({ state: "missing", url: null })
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setPreview({ state: "ready", url: objectUrl })
      })
      .catch(() => {
        if (!disposed) setPreview({ state: "missing", url: null })
      })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset.id, visible])

  return (
    <div
      ref={containerRef}
      className="grid gap-2"
      data-local-asset-id={asset.id}
    >
      <AssetCard
        actionLabel={actionLabel}
        assetKey={assetKey}
        busy={busy}
        detail={
          preview.state === "missing"
            ? "Locate a replacement from the canvas inspector"
            : detail
        }
        disabled={disabled || preview.state !== "ready"}
        height={asset.height}
        name={asset.name}
        previewFailed={previewFailed}
        previewState={preview.state}
        mutationDisabled={mutationDisabled}
        sourceLabel="This device"
        src={preview.url}
        width={asset.width}
        onChoose={onChoose}
        onDelete={onDelete}
        onPreviewFailure={onPreviewFailure}
      />
      {preview.state === "missing" && onLocateMissing ? (
        <>
          <Button
            className="h-11 w-full"
            disabled={mutationDisabled}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => locateInputRef.current?.click()}
          >
            Locate replacement
          </Button>
          <input
            ref={locateInputRef}
            accept="image/png,image/jpeg,image/webp"
            aria-hidden="true"
            hidden
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) onLocateMissing(file)
              event.currentTarget.value = ""
            }}
          />
        </>
      ) : null}
      {(preview.state === "ready" || promotion) &&
      (referenceCount > 0 || promotion) &&
      onPromote ? (
        <LocalAssetPromotionControl
          blockedByOtherPromotion={promotionBlockedByOther}
          mutationDisabled={mutationDisabled}
          promotion={promotion}
          referenceCount={referenceCount}
          onCancelPromotion={onCancelPromotion}
          onPromote={onPromote}
        />
      ) : null}
    </div>
  )
}

export function UploadQueue({
  items,
  selectingId,
  onCancel,
  onRetry,
  onUse,
  onDismiss,
  disabled,
}: {
  items: UploadQueueItem[]
  selectingId: string | null
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onUse: (item: UploadQueueItem) => void
  onDismiss: (id: string) => void
  disabled: boolean
}) {
  if (!items.length) return null

  return (
    <section
      aria-busy={items.some(isUploadActive)}
      aria-labelledby="upload-queue-title"
      aria-live="polite"
      className="border-b p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="upload-queue-title" className="text-sm font-medium">
            Upload queue
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            You can keep browsing while images upload.
          </p>
        </div>
        <Badge variant="secondary">
          {items.filter(isUploadActive).length} active
        </Badge>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/25 px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {isUploadActive(item) ? (
                  <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : item.phase === "complete" ? (
                  <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
                )}
                <p className="truncate text-xs font-medium">{item.file.name}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {uploadPhaseLabel[item.phase]}
                </span>
              </div>
              {item.phase === "uploading" || item.phase === "reconciling" ? (
                <div className="mt-2 flex items-center gap-2">
                  <progress
                    aria-label={`Uploading ${item.file.name}`}
                    aria-valuetext={
                      item.progress === null
                        ? `Uploading ${item.file.name}`
                        : `${item.progress}% uploaded`
                    }
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full accent-foreground"
                    max={100}
                    value={item.progress ?? undefined}
                  />
                  <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">
                    {item.progress === null ? "—" : `${item.progress}%`}
                  </span>
                </div>
              ) : null}
              {item.error ? (
                <p className="mt-1.5 text-xs text-destructive">{item.error}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {item.phase === "queued" ||
              item.phase === "preparing" ||
              item.phase === "uploading" ? (
                <Button
                  aria-label={`Cancel upload of ${item.file.name}`}
                  className="size-11"
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onCancel(item.id)}
                >
                  <XIcon />
                </Button>
              ) : null}
              {(item.phase === "failed" ||
                item.phase === "cancelled" ||
                item.phase === "status_unknown") &&
              item.retryable ? (
                <Button
                  className="h-11"
                  disabled={disabled}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onRetry(item.id)}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              ) : null}
              {item.phase === "complete" && item.asset ? (
                <Button
                  className="h-11"
                  disabled={
                    disabled || selectingId === `managed:${item.asset.id}`
                  }
                  size="sm"
                  type="button"
                  onClick={() => onUse(item)}
                >
                  Use image
                </Button>
              ) : null}
              {!isUploadActive(item) ? (
                <Button
                  aria-label={`Dismiss ${item.file.name}`}
                  className="size-11"
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onDismiss(item.id)}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function RepositoryNotice({
  title = "Cloud media is unavailable",
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry: () => void
}) {
  return (
    <div
      className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-xs font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button className="h-11" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCwIcon data-icon="inline-start" />
        Retry
      </Button>
    </div>
  )
}

export function EmptyCollection({
  collection,
  searching,
  query,
  onUpload,
  onClearSearch,
}: {
  collection: AssetLibraryCollection
  searching: boolean
  query: string
  onUpload: () => void
  onClearSearch: () => void
}) {
  const isLibrary = collection === "library"
  return (
    <Empty className="min-h-72 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {searching ? <SearchIcon /> : <ImageIcon />}
        </EmptyMedia>
        <EmptyTitle>
          {searching
            ? `No images match “${query}”`
            : collection === "recent"
              ? "No recently used media"
              : isLibrary
                ? "The curated library is empty"
                : "No uploads yet"}
        </EmptyTitle>
        <EmptyDescription>
          {searching
            ? "Try a broader name, file type, or keyword."
            : collection === "recent"
              ? "Images you use will stay within reach here."
              : isLibrary
                ? "Original Studio artwork will appear here when available."
                : "Upload PNG, JPEG, or WebP images. Up to 25 MB each."}
        </EmptyDescription>
      </EmptyHeader>
      {searching ? (
        <EmptyContent>
          <Button className="h-11" variant="outline" onClick={onClearSearch}>
            <XIcon data-icon="inline-start" />
            Clear search
          </Button>
        </EmptyContent>
      ) : !isLibrary ? (
        <EmptyContent>
          <Button className="h-11" onClick={onUpload}>
            <UploadIcon data-icon="inline-start" />
            Upload images
          </Button>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, or WebP. Up to 25 MB each.
          </p>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

export function LoadingGrid() {
  return (
    <div
      aria-label="Loading media"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border">
          <Skeleton className="aspect-4/3 rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
