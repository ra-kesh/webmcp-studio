import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  CheckIcon,
  ImageIcon,
  ImageOffIcon,
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
import { loadLocalAsset } from "./local-asset-store"
import type { LocalAssetSummary } from "./local-asset-store"

export type AssetLibraryCollection = "recent" | "uploads" | "library"
export type UploadPhase =
  "preparing" | "uploading" | "complete" | "failed" | "cancelled"

export type UploadQueueItem = {
  id: string
  file: File
  idempotencyKey: string
  phase: UploadPhase
  progress: number | null
  error: string | null
  asset: ManagedMediaAsset | null
}

export const uploadPhaseLabel: Record<UploadPhase, string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  complete: "Ready",
  failed: "Upload failed",
  cancelled: "Cancelled",
}

export const collectionLabels: Record<AssetLibraryCollection, string> = {
  recent: "Recent",
  uploads: "Uploads",
  library: "Library",
}

export function isUploadActive(item: UploadQueueItem) {
  return item.phase === "preparing" || item.phase === "uploading"
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
  onLocateMissing,
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
  onLocateMissing?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
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
        <Button
          className="h-11 w-full"
          disabled={mutationDisabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={onLocateMissing}
        >
          Locate replacement
        </Button>
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
              {item.phase === "uploading" ? (
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
              {isUploadActive(item) ? (
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
              {item.phase === "failed" || item.phase === "cancelled" ? (
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
