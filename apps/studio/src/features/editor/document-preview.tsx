import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { FileText, RefreshCw } from "lucide-react"
import { Artboard } from "@webmcp/render-view"
import { Button } from "@webmcp/ui/components/button"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { cn } from "@webmcp/ui/lib/utils"
import type { DocumentPreviewIdentity } from "./document-preview-contract"
import {
  createDocumentPreviewKey,
  serializeDocumentPreviewKey,
} from "./document-preview-contract"
import { useDocumentPreviewController } from "./document-preview-provider"

export function DocumentPreview({
  identity,
  onOpen,
  openDisabled = false,
  openLabel,
  view,
}: {
  identity: DocumentPreviewIdentity
  onOpen?: () => void
  openDisabled?: boolean
  openLabel?: string
  view: "grid" | "list"
}) {
  const controller = useDocumentPreviewController()
  const serialized = useMemo(
    () => serializeDocumentPreviewKey(createDocumentPreviewKey(identity)),
    [identity]
  )
  const stableIdentity = useMemo(() => identity, [serialized])
  const getSnapshot = useCallback(
    () => controller.getSnapshot(stableIdentity),
    [controller, serialized]
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    getSnapshot,
    getSnapshot
  )
  const hostRef = useRef<HTMLDivElement | null>(null)
  const releaseRef = useRef<(() => void) | null>(null)
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
    if (!nearVisible) {
      releaseRef.current?.()
      releaseRef.current = null
      return
    }
    releaseRef.current = controller.retain(stableIdentity)
    return () => {
      releaseRef.current?.()
      releaseRef.current = null
    }
  }, [controller, nearVisible, serialized, stableIdentity])

  const grid = view === "grid"
  const fallbackBounds = grid
    ? { maxWidth: 300, maxHeight: 220 }
    : { maxWidth: 58, maxHeight: 68 }
  const fallbackScale = Math.min(
    identity.pageWidth > 0 ? fallbackBounds.maxWidth / identity.pageWidth : 1,
    identity.pageHeight > 0 ? fallbackBounds.maxHeight / identity.pageHeight : 1
  )

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative grid place-items-center overflow-hidden bg-muted/35",
        grid ? "aspect-4/3 border-b p-3" : "h-full min-h-20 border-r p-1.5"
      )}
      aria-busy={state.status === "loading" || undefined}
      data-preview-state={state.status}
    >
      {state.status === "ready" ? (
        <img
          alt=""
          aria-hidden="true"
          className="block max-h-full max-w-full object-contain shadow-sm"
          draggable={false}
          src={state.url}
        />
      ) : state.status === "live_fallback" ? (
        <>
          <div
            aria-hidden="true"
            className="max-h-full max-w-full overflow-hidden border bg-background shadow-sm"
            style={{
              width: identity.pageWidth * fallbackScale,
              height: identity.pageHeight * fallbackScale,
            }}
          >
            <Artboard
              document={state.document}
              imageSemantics="thumbnail"
              pageId={state.pageId}
              scale={fallbackScale}
              showImageRecoveryActions={false}
            />
          </div>
          <span className="absolute right-2 bottom-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">
            Local preview
          </span>
        </>
      ) : state.status === "loading" ? (
        <Skeleton
          aria-hidden="true"
          className="h-[82%] w-[58%] rounded-[2px] motion-reduce:animate-none"
        />
      ) : state.status === "failed" ? (
        <div className="flex max-w-52 flex-col items-center gap-2 text-center">
          <FileText
            aria-hidden="true"
            className="size-5 text-muted-foreground"
          />
          {grid ? (
            <p className="line-clamp-2 text-[11px] text-muted-foreground">
              Preview unavailable
            </p>
          ) : null}
          {state.retryable ? (
            <Button
              aria-label="Retry preview"
              className="relative z-20 min-h-8 text-xs"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => controller.retry(stableIdentity)}
            >
              <RefreshCw aria-hidden="true" />
              {grid ? "Retry preview" : "Retry"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="flex items-center gap-2 rounded-md border bg-background/80 px-3 py-2 shadow-xs"
        >
          <FileText className="size-4 text-muted-foreground" />
          {grid ? (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {identity.pageWidth} × {identity.pageHeight}
            </span>
          ) : null}
        </div>
      )}
      {state.status === "ready" && !state.cached ? (
        <span className="absolute right-2 bottom-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">
          Preview not cached
        </span>
      ) : null}
      {onOpen && state.status !== "failed" ? (
        <button
          aria-label={openLabel ?? "Open document preview"}
          className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-default"
          disabled={openDisabled}
          type="button"
          onClick={onOpen}
        />
      ) : null}
    </div>
  )
}
