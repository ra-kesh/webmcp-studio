import { useEffect, useMemo, useRef, useState } from "react"
import type { LibraryMediaSummary } from "@webmcp/document"
import { cn } from "@webmcp/ui/lib/utils"
import type { DeviceLocalMediaSelectionIdentity } from "./device-local-media-discovery-adapter"
import type { ExactDeviceLocalMediaPreview } from "./library-media-discovery"
import { libraryMediaUiIdentity } from "./library-media-discovery"

export const LIBRARY_MEDIA_PREVIEW_ROOT_MARGIN = "240px"

export type LibraryMediaPreviewLoader = (
  identity: DeviceLocalMediaSelectionIdentity,
  signal?: AbortSignal
) => Promise<ExactDeviceLocalMediaPreview>

export type LibraryMediaPreviewProps = Readonly<{
  item: LibraryMediaSummary
  loadLocalPreview: LibraryMediaPreviewLoader
  ownershipKey: string
  visibilityRoot?: Element | null
  className?: string
}>

export function libraryMediaPreviewPath(
  item: LibraryMediaSummary
): string | null {
  if (item.mediaSource === "local") return null
  const assetId = encodeURIComponent(item.id)
  return item.mediaSource === "curated"
    ? `/v1/studio/library/media/${assetId}/versions/${item.version}/content`
    : `/v1/studio/assets/${assetId}/content`
}

type LocalPreviewState = Readonly<{
  identity: string
  status: "idle" | "loading" | "ready" | "failed"
  src: string | null
}>

const initialLocalState = (identity: string): LocalPreviewState => ({
  identity,
  status: "idle",
  src: null,
})

type LocalPreviewContract = Readonly<{
  id: string
  revision: number
  mimeType: LibraryMediaSummary["mimeType"]
  bytes: number
  width: number
  height: number
}>

const isLocalSource = (source: unknown): source is "local" => source === "local"

const previewMatches = (
  preview: ExactDeviceLocalMediaPreview,
  contract: LocalPreviewContract
) =>
  isLocalSource(preview.identity.source) &&
  preview.identity.assetId === contract.id &&
  preview.identity.revision === contract.revision &&
  preview.mimeType === contract.mimeType &&
  preview.bytes === contract.bytes &&
  preview.width === contract.width &&
  preview.height === contract.height &&
  preview.blob.type === contract.mimeType &&
  preview.blob.size === contract.bytes

export function LibraryMediaPreview({
  item,
  loadLocalPreview,
  ownershipKey,
  visibilityRoot = null,
  className,
}: LibraryMediaPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const failLocalRef = useRef<() => void>(() => undefined)
  const identity = libraryMediaUiIdentity(item)
  const lifecycleIdentity = `${ownershipKey}:${identity}`
  const localContract = useMemo<LocalPreviewContract>(
    () => ({
      id: item.id,
      revision: item.version,
      mimeType: item.mimeType,
      bytes: item.bytes,
      width: item.dimensions.width,
      height: item.dimensions.height,
    }),
    [
      item.bytes,
      item.dimensions.height,
      item.dimensions.width,
      item.id,
      item.mimeType,
      item.version,
    ]
  )
  const [localState, setLocalState] = useState<LocalPreviewState>(() =>
    initialLocalState(lifecycleIdentity)
  )
  const [failedServerIdentity, setFailedServerIdentity] = useState<
    string | null
  >(null)
  const serverPath = libraryMediaPreviewPath(item)

  useEffect(() => {
    if (item.mediaSource !== "local") return
    const host = hostRef.current
    if (!host) return

    let mounted = true
    let generation = 0
    let requestController: AbortController | null = null
    let objectUrl: string | null = null

    const revoke = () => {
      if (!objectUrl) return
      const current = objectUrl
      objectUrl = null
      URL.revokeObjectURL(current)
    }
    const release = () => {
      generation += 1
      requestController?.abort(
        new DOMException("Media preview left its viewport owner.", "AbortError")
      )
      requestController = null
      revoke()
    }
    const fail = () => {
      release()
      if (mounted) {
        setLocalState({
          identity: lifecycleIdentity,
          status: "failed",
          src: null,
        })
      }
    }
    failLocalRef.current = fail

    const load = () => {
      if (requestController || objectUrl) return
      const requestGeneration = ++generation
      const controller = new AbortController()
      requestController = controller
      setLocalState({
        identity: lifecycleIdentity,
        status: "loading",
        src: null,
      })
      void loadLocalPreview(
        {
          source: "local",
          assetId: localContract.id,
          revision: localContract.revision,
        },
        controller.signal
      ).then(
        (preview) => {
          if (
            !mounted ||
            controller.signal.aborted ||
            generation !== requestGeneration
          ) {
            return
          }
          requestController = null
          if (!previewMatches(preview, localContract)) {
            fail()
            return
          }
          const nextUrl = URL.createObjectURL(preview.blob)
          revoke()
          objectUrl = nextUrl
          setLocalState({
            identity: lifecycleIdentity,
            status: "ready",
            src: nextUrl,
          })
        },
        () => {
          if (
            mounted &&
            !controller.signal.aborted &&
            generation === requestGeneration
          ) {
            requestController = null
            setLocalState({
              identity: lifecycleIdentity,
              status: "failed",
              src: null,
            })
          }
        }
      )
    }

    const updateVisibility = (nearViewport: boolean) => {
      if (nearViewport) {
        load()
        return
      }
      release()
      if (mounted) setLocalState(initialLocalState(lifecycleIdentity))
    }

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver === "undefined") {
      updateVisibility(true)
    } else {
      observer = new IntersectionObserver(
        (entries) =>
          updateVisibility(entries.some((entry) => entry.isIntersecting)),
        { root: visibilityRoot, rootMargin: LIBRARY_MEDIA_PREVIEW_ROOT_MARGIN }
      )
      observer.observe(host)
    }

    return () => {
      mounted = false
      observer?.disconnect()
      failLocalRef.current = () => undefined
      release()
    }
  }, [
    item.mediaSource,
    lifecycleIdentity,
    loadLocalPreview,
    localContract,
    visibilityRoot,
  ])

  const currentLocalState =
    localState.identity === lifecycleIdentity
      ? localState
      : initialLocalState(lifecycleIdentity)
  const serverFailed = failedServerIdentity === lifecycleIdentity
  const src = item.mediaSource === "local" ? currentLocalState.src : serverPath
  const failed =
    item.mediaSource === "local"
      ? currentLocalState.status === "failed"
      : serverFailed
  const status = failed
    ? "failed"
    : src
      ? "ready"
      : item.mediaSource === "local"
        ? currentLocalState.status
        : "failed"

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative aspect-4/3 w-full overflow-hidden rounded-[5px] border border-border/70 bg-workspace/70",
        className
      )}
      data-local-preview-state={
        item.mediaSource === "local" ? status : undefined
      }
      data-media-preview-state={status}
    >
      {src && !failed ? (
        <img
          alt={item.name}
          className="absolute inset-0 size-full object-contain"
          decoding="async"
          draggable={false}
          height={item.dimensions.height}
          loading="lazy"
          src={src}
          width={item.dimensions.width}
          onError={() => {
            if (item.mediaSource === "local") failLocalRef.current()
            else setFailedServerIdentity(lifecycleIdentity)
          }}
        />
      ) : (
        <div
          aria-label={`Preview unavailable for ${item.name}`}
          className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-muted-foreground"
          role="img"
        >
          {status === "loading" ? "Loading preview…" : "Preview unavailable"}
        </div>
      )}
    </div>
  )
}
