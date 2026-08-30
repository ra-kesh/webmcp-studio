import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { Document, LibraryPreviewDescriptor } from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import { Button } from "@webmcp/ui/components/button"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { cn } from "@webmcp/ui/lib/utils"
import { ImageOff, RefreshCw } from "lucide-react"
import { serializeLibraryPreviewDescriptor } from "./library-preview-controller"
import { useLibraryPreviewController } from "./library-preview-provider"

export type LibraryPreviewLiveFallback = Readonly<{
  document: Document
  pageId: string
}>

export function LibraryPreview({
  descriptor,
  label,
  className,
  liveFallback,
  onSelect,
  selected = false,
}: {
  descriptor: LibraryPreviewDescriptor
  label: string
  className?: string
  liveFallback?: LibraryPreviewLiveFallback
  onSelect?: () => void
  selected?: boolean
}) {
  const controller = useLibraryPreviewController()
  const serialized = useMemo(
    () => serializeLibraryPreviewDescriptor(descriptor),
    [descriptor]
  )
  const stableDescriptor = useMemo(() => descriptor, [serialized])
  const getSnapshot = useCallback(
    () => controller.getSnapshot(stableDescriptor),
    [controller, serialized, stableDescriptor]
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    getSnapshot,
    getSnapshot
  )
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [nearVisible, setNearVisible] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (typeof IntersectionObserver === "undefined") {
      setNearVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => setNearVisible(Boolean(entries[0]?.isIntersecting)),
      { rootMargin: "240px" }
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [serialized])

  useEffect(() => {
    if (!nearVisible) return
    return controller.retain(stableDescriptor)
  }, [controller, nearVisible, serialized, stableDescriptor])

  const liveScale = liveFallback
    ? Math.min(300 / descriptor.width, 220 / descriptor.height)
    : 1

  return (
    <div
      ref={hostRef}
      aria-busy={state.status === "loading" || undefined}
      className={cn(
        "relative grid aspect-4/3 w-full place-items-center overflow-hidden rounded-[5px] border border-border/70 bg-workspace/70 p-2",
        className
      )}
      data-preview-state={state.status}
    >
      {state.status === "ready" ? (
        <img
          alt=""
          aria-hidden="true"
          className="block max-h-full max-w-full object-contain shadow-sm"
          draggable={false}
          height={state.height}
          src={state.url}
          width={state.width}
        />
      ) : state.status === "live_fallback" && liveFallback ? (
        <>
          <div
            aria-hidden="true"
            className="max-h-full max-w-full overflow-hidden rounded-[3px] border bg-background shadow-sm"
            style={{
              width: descriptor.width * liveScale,
              height: descriptor.height * liveScale,
            }}
          >
            <Artboard
              document={liveFallback.document}
              imageSemantics="thumbnail"
              pageId={liveFallback.pageId}
              scale={liveScale}
              showImageRecoveryActions={false}
            />
          </div>
          <span className="absolute right-2 bottom-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs">
            Live preview
          </span>
        </>
      ) : state.status === "loading" ? (
        <Skeleton
          aria-hidden="true"
          className="h-[82%] w-[58%] rounded-[2px] motion-reduce:animate-none"
        />
      ) : state.status === "failed" ? (
        <div className="relative z-20 flex max-w-52 flex-col items-center gap-2 text-center">
          <ImageOff
            aria-hidden="true"
            className="size-5 text-muted-foreground"
          />
          <span className="text-[11px] text-muted-foreground">
            Preview unavailable
          </span>
          <Button
            aria-label={`Retry ${label}`}
            className="min-h-11 min-w-11 text-xs"
            size="sm"
            type="button"
            variant="outline"
            onClick={() => controller.retry(stableDescriptor)}
          >
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : state.status === "live_fallback" ? (
        <div className="flex flex-col items-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-5" />
          Live preview unavailable
        </div>
      ) : (
        <Skeleton
          aria-hidden="true"
          className="h-[82%] w-[58%] rounded-[2px] opacity-60 motion-reduce:animate-none"
        />
      )}

      {onSelect ? (
        <button
          aria-label={label}
          aria-pressed={selected}
          className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          type="button"
          onClick={onSelect}
        />
      ) : null}
    </div>
  )
}
