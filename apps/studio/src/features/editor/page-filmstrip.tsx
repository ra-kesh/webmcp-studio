import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  GalleryHorizontal,
  Plus,
  Trash2,
} from "lucide-react"
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { KeyboardEvent, RefCallback } from "react"
import type { Document } from "@webmcp/document"
import {
  createPageThumbnailRevision,
  fitPageThumbnailSize,
} from "@webmcp/document"
import { isDocumentStructureCommandEnabled } from "@webmcp/editor/structure-commands"
import { buildPageContextMenu } from "@webmcp/editor/product-commands"
import type {
  ProductCommandRuntimeContext,
  ProductMenuGroup,
} from "@webmcp/editor/product-commands"
import { Artboard } from "@webmcp/render-view"
import type { ImageResourceStateChange } from "@webmcp/render-view"
import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { ScrollArea, ScrollBar } from "@webmcp/ui/components/scroll-area"
import { cn } from "@webmcp/ui/lib/utils"
import {
  createPageProductCommandTarget,
  dispatchKeyboardContextMenu,
} from "./page-output-command-context"
import {
  ProductCommandContextMenu,
  ProductCommandDropdownItems,
} from "./product-command-menu"
import type { ProductCommandMenuRuntime } from "./product-command-menu"
import {
  createPageThumbnailRasterCache,
  isSamePageThumbnailRasterCacheKey,
} from "./page-thumbnail-raster-cache"
import type {
  PageThumbnailRasterEntry,
  PageThumbnailRasterKey,
  PageThumbnailRasterProducer,
} from "./page-thumbnail-raster-cache"
import { pageThumbnailRasterRetryDelay } from "./page-thumbnail-raster-producer"

const menuItemClass = "min-h-11 min-[1280px]:min-h-0"
const DESKTOP_FILMSTRIP_QUERY = "(min-width: 1280px)"
const FILMSTRIP_THUMBNAIL_BOUNDS = {
  compact: { width: 44, height: 56 },
  comfortable: { width: 52, height: 72 },
} as const

export const PAGE_FILMSTRIP_DENSITY_HEIGHTS = {
  compact: { compact: 88, desktop: 96 },
  comfortable: { compact: 88, desktop: 120 },
} as const

export type PageFilmstripDensity = keyof typeof PAGE_FILMSTRIP_DENSITY_HEIGHTS
export const PAGE_FILMSTRIP_COMPACT_HEIGHT =
  PAGE_FILMSTRIP_DENSITY_HEIGHTS.compact.compact
export const PAGE_FILMSTRIP_DESKTOP_HEIGHT =
  PAGE_FILMSTRIP_DENSITY_HEIGHTS.compact.desktop

const getDesktopFilmstripQuery = (): MediaQueryList | null => {
  if (typeof window === "undefined") return null
  const matchMedia: unknown = Reflect.get(window, "matchMedia")
  if (typeof matchMedia !== "function") return null
  return Reflect.apply(matchMedia, window, [
    DESKTOP_FILMSTRIP_QUERY,
  ]) as MediaQueryList
}

const subscribeToDesktopFilmstrip = (onChange: () => void) => {
  const query = getDesktopFilmstripQuery()
  if (!query) return () => {}
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

const isDesktopFilmstrip = () => Boolean(getDesktopFilmstripQuery()?.matches)

const isServerDesktopFilmstrip = () => false

type RasterRetryState = {
  key: PageThumbnailRasterKey
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
}

export type PageFilmstripRasterOptions = Readonly<{
  canonicalDocument: Document
  documentSnapshotId: string
  rendererRevision: string
  producer: PageThumbnailRasterProducer
  pixelRatio?: number
  admissionDelayMs?: number
}>

export function filmstripThumbnailGeometry(
  page: { width: number; height: number },
  density: PageFilmstripDensity = "compact"
) {
  const bounds = FILMSTRIP_THUMBNAIL_BOUNDS[density]
  const widthScale = bounds.width / page.width
  const heightScale = bounds.height / page.height
  const widthLimited = widthScale <= heightScale
  const scale = widthLimited ? widthScale : heightScale
  return {
    scale,
    width: Math.min(bounds.width, page.width * scale),
    height: Math.min(bounds.height, page.height * scale),
  }
}

export function filmstripThumbnailRasterSize(
  page: { width: number; height: number },
  pixelRatio: number,
  density: PageFilmstripDensity = "compact"
) {
  const bounds = FILMSTRIP_THUMBNAIL_BOUNDS[density]
  return fitPageThumbnailSize(page, {
    maxWidth: bounds.width * pixelRatio,
    maxHeight: bounds.height * pixelRatio,
  })
}

export type PageFilmstripProps = Readonly<{
  document: Document
  activePageId: string
  reviewPending: boolean
  onSelectPage: (pageId: string) => void
  onAddPage: (outputId: string) => void
  onDuplicatePage: (pageId: string) => void
  onRemovePage: (pageId: string) => void
  onReorderPage: (outputId: string, pageId: string, toIndex: number) => void
  imageResourceTokens?: Readonly<Record<string, string>>
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
  raster?: PageFilmstripRasterOptions
  productCommandContext?: ProductCommandRuntimeContext
  productCommandRuntime?: ProductCommandMenuRuntime
  density?: PageFilmstripDensity
  onDensityChange?: (density: PageFilmstripDensity) => void
  className?: string
}>

type PageFilmstripItemProps = Readonly<{
  document: Document
  page: Document["pages"][number]
  index: number
  active: boolean
  outputId: string
  canDuplicate: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  canRemove: boolean
  onlyPage: boolean
  imageResourceTokens?: Readonly<Record<string, string>>
  onImageResourceStateChange?: (state: ImageResourceStateChange) => void
  onSelectPage: (pageId: string) => void
  onDuplicatePage: (pageId: string) => void
  onRemovePage: (pageId: string) => void
  onReorderPage: (outputId: string, pageId: string, toIndex: number) => void
  onSelectorKeyDown: (
    pageId: string,
    event: KeyboardEvent<HTMLButtonElement>
  ) => void
  renderThumbnail: boolean
  rasterEntry: PageThumbnailRasterEntry | null
  rasterState: "disabled" | "deferred" | "loading" | "ready" | "error"
  selectorRef: RefCallback<HTMLButtonElement>
  thumbnailRef: RefCallback<HTMLSpanElement>
  productMenuGroups?: readonly ProductMenuGroup[]
  productCommandRuntime?: ProductCommandMenuRuntime
  density: PageFilmstripDensity
}>

const PageFilmstripItem = memo(function PageFilmstripItem({
  document,
  page,
  index,
  active,
  outputId,
  canDuplicate,
  canMoveLeft,
  canMoveRight,
  canRemove,
  onlyPage,
  imageResourceTokens,
  onImageResourceStateChange,
  onSelectPage,
  onDuplicatePage,
  onRemovePage,
  onReorderPage,
  onSelectorKeyDown,
  renderThumbnail,
  rasterEntry,
  rasterState,
  selectorRef,
  thumbnailRef,
  productMenuGroups,
  productCommandRuntime,
  density,
}: PageFilmstripItemProps) {
  const thumbnail = filmstripThumbnailGeometry(page, density)
  const compactDensity = density === "compact"

  const item = (
    <div
      className={cn(
        "group relative flex shrink-0 flex-col items-center",
        compactDensity ? "w-[60px] min-[1280px]:w-[68px]" : "w-[76px]"
      )}
      data-active={active}
      data-page-filmstrip-item={page.id}
      onContextMenu={() => onSelectPage(page.id)}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: compactDensity ? "68px 88px" : "76px 112px",
      }}
    >
      <button
        type="button"
        id={`page-filmstrip-selector-${page.id.replaceAll(":", "-")}`}
        aria-keyshortcuts="Shift+F10"
        aria-label={`Open page ${index + 1}: ${page.name}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full flex-col items-center rounded-md p-1 text-center transition-colors outline-none group-data-[active=true]:bg-secondary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          compactDensity ? "min-[1280px]:gap-1" : "gap-1"
        )}
        data-page-selector-id={page.id}
        onClick={() => onSelectPage(page.id)}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey)
          ) {
            onSelectPage(page.id)
            const itemElement = event.currentTarget.closest<HTMLElement>(
              "[data-page-filmstrip-item]"
            )
            if (itemElement) dispatchKeyboardContextMenu(event, itemElement)
            return
          }
          onSelectorKeyDown(page.id, event)
        }}
        ref={selectorRef}
        tabIndex={active ? 0 : -1}
      >
        <span
          ref={thumbnailRef}
          className={cn(
            "relative grid place-items-center",
            compactDensity ? "h-[60px] w-[48px]" : "h-[76px] w-[58px]"
          )}
          data-page-thumbnail-id={page.id}
        >
          <span className="overflow-hidden rounded-[2px] border bg-white shadow-xs group-data-[active=true]:border-foreground group-data-[active=true]:ring-1 group-data-[active=true]:ring-foreground">
            {active ||
            (renderThumbnail &&
              (rasterState === "disabled" || rasterState === "error")) ? (
              <Artboard
                document={document}
                imageSemantics="thumbnail"
                imageResourceTokens={imageResourceTokens}
                onImageResourceStateChange={onImageResourceStateChange}
                pageId={page.id}
                scale={thumbnail.scale}
                showImageRecoveryActions={false}
              />
            ) : rasterEntry && rasterState === "ready" ? (
              <img
                alt=""
                aria-hidden="true"
                className="block size-full object-contain"
                data-thumbnail-state="ready"
                draggable={false}
                height={Math.max(1, Math.round(thumbnail.height))}
                src={rasterEntry.url}
                style={{
                  width: thumbnail.width,
                  height: thumbnail.height,
                }}
                width={Math.max(1, Math.round(thumbnail.width))}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "block bg-muted",
                  rasterState === "loading" &&
                    "animate-pulse motion-reduce:animate-none"
                )}
                data-thumbnail-state={rasterState}
                style={{
                  width: thumbnail.width,
                  height: thumbnail.height,
                }}
              />
            )}
          </span>
        </span>
        <span
          className={cn(
            "w-full truncate text-[10px] leading-3 text-muted-foreground group-data-[active=true]:font-medium group-data-[active=true]:text-foreground",
            compactDensity && "hidden min-[1280px]:block"
          )}
        >
          {index + 1}. {page.name}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`More actions for ${page.name}`}
            className="absolute top-0.5 right-0.5 size-11 border bg-background/95 opacity-0 shadow-xs backdrop-blur-sm group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 min-[1280px]:top-1 min-[1280px]:right-1 min-[1280px]:size-7"
            size="icon-sm"
            tabIndex={active ? 0 : -1}
            variant="ghost"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>{page.name}</DropdownMenuLabel>
          {productMenuGroups && productCommandRuntime ? (
            <ProductCommandDropdownItems
              groups={productMenuGroups}
              runtime={productCommandRuntime}
            />
          ) : (
            <>
              <DropdownMenuItem
                className={menuItemClass}
                data-command-id="page.duplicate"
                disabled={!canDuplicate}
                onSelect={() => onDuplicatePage(page.id)}
              >
                <Copy />
                Duplicate page
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={menuItemClass}
                data-command-id="page.move-up"
                disabled={!canMoveLeft}
                onSelect={() => onReorderPage(outputId, page.id, index - 1)}
              >
                <ChevronLeft />
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                className={menuItemClass}
                data-command-id="page.move-down"
                disabled={!canMoveRight}
                onSelect={() => onReorderPage(outputId, page.id, index + 1)}
              >
                <ChevronRight />
                Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={menuItemClass}
                data-command-id="page.remove"
                disabled={!canRemove}
                variant="destructive"
                onSelect={() => onRemovePage(page.id)}
              >
                <Trash2 />
                Delete page
              </DropdownMenuItem>
              {onlyPage ? (
                <p className="px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                  Every output must keep at least one page.
                </p>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
  return productMenuGroups && productCommandRuntime ? (
    <ProductCommandContextMenu
      groups={productMenuGroups}
      runtime={productCommandRuntime}
      onOpenChange={(open) => {
        if (!open) {
          requestAnimationFrame(() => {
            globalThis.document
              .getElementById(
                `page-filmstrip-selector-${page.id.replaceAll(":", "-")}`
              )
              ?.focus()
          })
        }
      }}
    >
      {item}
    </ProductCommandContextMenu>
  ) : (
    item
  )
})

export const PageFilmstrip = memo(function PageFilmstrip({
  document,
  activePageId,
  reviewPending,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onRemovePage,
  onReorderPage,
  imageResourceTokens,
  onImageResourceStateChange,
  raster,
  productCommandContext,
  productCommandRuntime,
  density = "compact",
  onDensityChange,
  className,
}: PageFilmstripProps) {
  const desktopFilmstrip = useSyncExternalStore(
    subscribeToDesktopFilmstrip,
    isDesktopFilmstrip,
    isServerDesktopFilmstrip
  )
  const thumbnailDensity = desktopFilmstrip ? density : "compact"
  const rasterAdmissionDelayMs = Math.min(
    1_000,
    Math.max(0, Math.round(raster?.admissionDelayMs ?? 0))
  )
  const regionRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const selectorElementsRef = useRef(new Map<string, HTMLButtonElement>())
  const selectorRefCallbacksRef = useRef(
    new Map<string, RefCallback<HTMLButtonElement>>()
  )
  const thumbnailElementsRef = useRef(new Map<string, HTMLSpanElement>())
  const pageIdByThumbnailElementRef = useRef(new WeakMap<Element, string>())
  const thumbnailRefCallbacksRef = useRef(
    new Map<string, RefCallback<HTMLSpanElement>>()
  )
  const [visiblePageIds, setVisiblePageIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const observedVisiblePageIdsRef = useRef(new Set<string>())
  const [admittedRasterPageIds, setAdmittedRasterPageIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const admittedRasterPageIdsRef = useRef<ReadonlySet<string>>(
    admittedRasterPageIds
  )
  admittedRasterPageIdsRef.current = admittedRasterPageIds
  const rasterAdmissionTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  )
  const lastFilmstripScrollAtRef = useRef(Date.now())
  const [rasterEntries, setRasterEntries] = useState<
    ReadonlyMap<string, PageThumbnailRasterEntry>
  >(() => new Map())
  const [rasterErrors, setRasterErrors] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [rasterRetryEpoch, setRasterRetryEpoch] = useState(0)
  const rasterRetriesRef = useRef(new Map<string, RasterRetryState>())
  const clearRasterRetry = useCallback((pageId: string) => {
    const retry = rasterRetriesRef.current.get(pageId)
    if (retry?.timer !== null && retry?.timer !== undefined) {
      clearTimeout(retry.timer)
    }
    rasterRetriesRef.current.delete(pageId)
  }, [])
  const clearAllRasterRetries = useCallback(() => {
    for (const retry of rasterRetriesRef.current.values()) {
      if (retry.timer !== null) clearTimeout(retry.timer)
    }
    rasterRetriesRef.current.clear()
  }, [])
  const callbacksRef = useRef({
    onSelectPage,
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onReorderPage,
  })
  callbacksRef.current = {
    onSelectPage,
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onReorderPage,
  }
  const stableCallbacks = useRef({
    onSelectPage: (pageId: string) => callbacksRef.current.onSelectPage(pageId),
    onAddPage: (outputId: string) => callbacksRef.current.onAddPage(outputId),
    onDuplicatePage: (pageId: string) =>
      callbacksRef.current.onDuplicatePage(pageId),
    onRemovePage: (pageId: string) => callbacksRef.current.onRemovePage(pageId),
    onReorderPage: (outputId: string, pageId: string, toIndex: number) =>
      callbacksRef.current.onReorderPage(outputId, pageId, toIndex),
  }).current
  const activePage =
    document.pages.find((page) => page.id === activePageId) ?? document.pages[0]
  const effectiveActivePageId = activePage.id
  const effectiveActivePageIdRef = useRef(effectiveActivePageId)
  effectiveActivePageIdRef.current = effectiveActivePageId
  const output = document.outputs.find(
    (candidate) => candidate.id === activePage.outputId
  )
  const pagesById = useMemo(
    () => new Map(document.pages.map((page) => [page.id, page])),
    [document.pages]
  )
  const nodesById = useMemo(
    () => new Map(document.nodes.map((node) => [node.id, node])),
    [document.nodes]
  )
  const pages = useMemo(
    () =>
      (output?.pageIds ?? []).flatMap((pageId) => {
        const page = pagesById.get(pageId)
        return page ? [page] : []
      }),
    [output?.pageIds, pagesById]
  )
  const thumbnailDocumentsByPageId = useMemo(
    () =>
      new Map(
        pages.map((page) => [
          page.id,
          {
            ...document,
            pages: [page],
            nodes: page.nodeIds.flatMap((nodeId) => {
              const node = nodesById.get(nodeId)
              return node ? [node] : []
            }),
          },
        ])
      ),
    [document, nodesById, output?.id]
  )
  const [rasterCacheState, setRasterCacheState] = useState<{
    producer: PageThumbnailRasterProducer
    cache: ReturnType<typeof createPageThumbnailRasterCache>
  } | null>(null)
  const rasterCache =
    raster && rasterCacheState?.producer === raster.producer
      ? rasterCacheState.cache
      : null
  const rasterCacheRef = useRef(rasterCache)
  rasterCacheRef.current = rasterCache
  const reconciledRasterKeysRef = useRef<{
    cache: ReturnType<typeof createPageThumbnailRasterCache>
    keys: ReadonlyMap<string, PageThumbnailRasterKey>
  } | null>(null)
  useEffect(() => {
    if (!raster) {
      setRasterCacheState(null)
      return
    }
    const cache = createPageThumbnailRasterCache({
      producer: raster.producer,
      concurrency: 3,
      maxEntries: 64,
    })
    setRasterCacheState({ producer: raster.producer, cache })
    return () => cache.dispose()
  }, [raster?.producer])
  const rasterKeysByPageId = useMemo(() => {
    if (!raster) return new Map<string, PageThumbnailRasterKey>()
    const requestedPixelRatio = raster.pixelRatio ?? 2
    const pixelRatio = Number.isFinite(requestedPixelRatio)
      ? Math.min(3, Math.max(1, requestedPixelRatio))
      : 2
    return new Map(
      pages.map((page) => {
        const rasterSize = filmstripThumbnailRasterSize(
          page,
          pixelRatio,
          thumbnailDensity
        )
        const pageRevision = createPageThumbnailRevision(
          raster.canonicalDocument,
          page.id
        )
        return [
          page.id,
          {
            documentId: raster.canonicalDocument.id,
            documentRevision: raster.canonicalDocument.revision,
            documentSnapshotId: raster.documentSnapshotId,
            pageId: page.id,
            pageRevision,
            rendererRevision: raster.rendererRevision,
            pixelWidth: rasterSize.width,
            pixelHeight: rasterSize.height,
          },
        ]
      })
    )
  }, [document.id, document.revision, pages, raster, thumbnailDensity])
  const rasterKeysByPageIdRef = useRef(rasterKeysByPageId)
  rasterKeysByPageIdRef.current = rasterKeysByPageId
  const pageIdentity = pages.map((page) => page.id).join("\u0000")
  const pageIdsRef = useRef<readonly string[]>([])
  pageIdsRef.current = pages.map((page) => page.id)
  const selectorRefFor = (pageId: string) => {
    const existing = selectorRefCallbacksRef.current.get(pageId)
    if (existing) return existing
    const callback: RefCallback<HTMLButtonElement> = (element) => {
      if (!element) {
        selectorElementsRef.current.delete(pageId)
        return
      }
      selectorElementsRef.current.set(pageId, element)
    }
    selectorRefCallbacksRef.current.set(pageId, callback)
    return callback
  }
  const onSelectorKeyDown = useRef(
    (pageId: string, event: KeyboardEvent<HTMLButtonElement>) => {
      const pageIds = pageIdsRef.current
      const currentIndex = pageIds.indexOf(pageId)
      if (currentIndex < 0) return

      let targetIndex: number | null = null
      switch (event.key) {
        case "ArrowLeft":
          targetIndex = Math.max(0, currentIndex - 1)
          break
        case "ArrowRight":
          targetIndex = Math.min(pageIds.length - 1, currentIndex + 1)
          break
        case "Home":
          targetIndex = 0
          break
        case "End":
          targetIndex = pageIds.length - 1
          break
        default:
          return
      }

      event.preventDefault()
      if (targetIndex === currentIndex) return
      const targetPageId = pageIds[targetIndex]
      if (!targetPageId) return
      callbacksRef.current.onSelectPage(targetPageId)
      selectorElementsRef.current.get(targetPageId)?.focus()
    }
  ).current
  const thumbnailRefFor = (pageId: string) => {
    const existing = thumbnailRefCallbacksRef.current.get(pageId)
    if (existing) return existing
    const callback: RefCallback<HTMLSpanElement> = (element) => {
      const previous = thumbnailElementsRef.current.get(pageId)
      if (previous && previous !== element) {
        observerRef.current?.unobserve(previous)
      }
      if (!element) {
        thumbnailElementsRef.current.delete(pageId)
        return
      }
      thumbnailElementsRef.current.set(pageId, element)
      pageIdByThumbnailElementRef.current.set(element, pageId)
      observerRef.current?.observe(element)
    }
    thumbnailRefCallbacksRef.current.set(pageId, callback)
    return callback
  }

  useEffect(() => {
    const pageIds = new Set(pageIdentity ? pageIdentity.split("\u0000") : [])
    observedVisiblePageIdsRef.current = new Set(
      [...observedVisiblePageIdsRef.current].filter((id) => pageIds.has(id))
    )
    for (const pageId of thumbnailRefCallbacksRef.current.keys()) {
      if (!pageIds.has(pageId)) {
        thumbnailRefCallbacksRef.current.delete(pageId)
      }
    }
    for (const pageId of selectorRefCallbacksRef.current.keys()) {
      if (!pageIds.has(pageId)) {
        selectorRefCallbacksRef.current.delete(pageId)
        selectorElementsRef.current.delete(pageId)
      }
    }
    setVisiblePageIds((current) => {
      const retained = new Set([...current].filter((id) => pageIds.has(id)))
      return retained.size === current.size ? current : retained
    })
    observerRef.current?.disconnect()
    observerRef.current = null
    if (typeof IntersectionObserver === "undefined") {
      observedVisiblePageIdsRef.current = new Set(pageIds)
      setVisiblePageIds(pageIds)
      return
    }
    const root = regionRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    const recordScroll = () => {
      lastFilmstripScrollAtRef.current = Date.now()
    }
    root?.addEventListener("scroll", recordScroll, { passive: true })
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return
        const observedEntries = entries.flatMap((entry) => {
          const pageId = pageIdByThumbnailElementRef.current.get(entry.target)
          return pageId && pageIds.has(pageId)
            ? [{ pageId, isIntersecting: entry.isIntersecting }]
            : []
        })
        for (const entry of observedEntries) {
          if (entry.isIntersecting) {
            observedVisiblePageIdsRef.current.add(entry.pageId)
            continue
          }
          observedVisiblePageIdsRef.current.delete(entry.pageId)
          const admissionTimer = rasterAdmissionTimersRef.current.get(
            entry.pageId
          )
          if (admissionTimer) {
            clearTimeout(admissionTimer)
            rasterAdmissionTimersRef.current.delete(entry.pageId)
          }
          const rasterKey = rasterKeysByPageIdRef.current.get(entry.pageId)
          if (rasterKey) rasterCacheRef.current?.cancel(rasterKey)
        }
        startTransition(() => {
          setVisiblePageIds((current) => {
            const next = new Set(current)
            let changed = false
            for (const entry of observedEntries) {
              if (entry.isIntersecting) {
                if (!next.has(entry.pageId)) {
                  next.add(entry.pageId)
                  changed = true
                }
              } else if (next.delete(entry.pageId)) {
                changed = true
              }
            }
            return changed ? next : current
          })
        })
      },
      { root: root ?? null, rootMargin: "0px 240px" }
    )
    observerRef.current = observer
    for (const [pageId, element] of thumbnailElementsRef.current) {
      if (pageIds.has(pageId)) observer.observe(element)
    }
    return () => {
      cancelled = true
      root?.removeEventListener("scroll", recordScroll)
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [pageIdentity])

  useEffect(() => {
    rasterCache?.clear()
    clearAllRasterRetries()
    setRasterEntries(new Map())
    setRasterErrors(new Set())
  }, [
    clearAllRasterRetries,
    document.id,
    raster?.rendererRevision,
    rasterCache,
  ])

  useEffect(() => clearAllRasterRetries, [clearAllRasterRetries])

  useEffect(
    () => () => {
      for (const timer of rasterAdmissionTimersRef.current.values()) {
        clearTimeout(timer)
      }
      rasterAdmissionTimersRef.current.clear()
    },
    []
  )

  useEffect(() => {
    const desiredPageIds = new Set(
      [...visiblePageIds].filter((pageId) => pageId !== effectiveActivePageId)
    )
    for (const [pageId, timer] of rasterAdmissionTimersRef.current) {
      if (rasterCache && desiredPageIds.has(pageId)) continue
      clearTimeout(timer)
      rasterAdmissionTimersRef.current.delete(pageId)
    }
    setAdmittedRasterPageIds((current) => {
      if (!rasterCache || rasterAdmissionDelayMs === 0) {
        return current.size === 0 ? current : new Set()
      }
      const retained = new Set(
        [...current].filter((pageId) => desiredPageIds.has(pageId))
      )
      return retained.size === current.size ? current : retained
    })
    if (!rasterCache || rasterAdmissionDelayMs === 0) return
    for (const pageId of desiredPageIds) {
      if (
        admittedRasterPageIdsRef.current.has(pageId) ||
        rasterAdmissionTimersRef.current.has(pageId)
      ) {
        continue
      }
      const admitAfterScrollSettles = () => {
        const remainingDelay = Math.max(
          0,
          rasterAdmissionDelayMs -
            (Date.now() - lastFilmstripScrollAtRef.current)
        )
        if (remainingDelay > 0) {
          const nextTimer = setTimeout(admitAfterScrollSettles, remainingDelay)
          rasterAdmissionTimersRef.current.set(pageId, nextTimer)
          return
        }
        rasterAdmissionTimersRef.current.delete(pageId)
        if (
          !observedVisiblePageIdsRef.current.has(pageId) ||
          effectiveActivePageIdRef.current === pageId
        ) {
          return
        }
        setAdmittedRasterPageIds((current) =>
          current.has(pageId) ? current : new Set(current).add(pageId)
        )
      }
      const timer = setTimeout(admitAfterScrollSettles, rasterAdmissionDelayMs)
      rasterAdmissionTimersRef.current.set(pageId, timer)
    }
  }, [
    effectiveActivePageId,
    rasterAdmissionDelayMs,
    rasterCache,
    visiblePageIds,
  ])

  useEffect(() => {
    if (!rasterCache) {
      reconciledRasterKeysRef.current = null
      return
    }

    const previous = reconciledRasterKeysRef.current
    const invalidatedPageIds = new Set<string>()
    if (previous?.cache === rasterCache) {
      for (const [pageId, previousKey] of previous.keys) {
        const currentKey = rasterKeysByPageId.get(pageId)
        if (!currentKey) {
          rasterCache.invalidatePage(previousKey.documentId, pageId)
          invalidatedPageIds.add(pageId)
          continue
        }
        if (!isSamePageThumbnailRasterCacheKey(previousKey, currentKey)) {
          rasterCache.invalidate(previousKey)
          invalidatedPageIds.add(pageId)
        }
      }
    }
    reconciledRasterKeysRef.current = {
      cache: rasterCache,
      keys: rasterKeysByPageId,
    }

    if (invalidatedPageIds.size === 0) return
    setRasterEntries((current) => {
      const next = new Map(current)
      let changed = false
      for (const pageId of invalidatedPageIds) {
        clearRasterRetry(pageId)
        changed = next.delete(pageId) || changed
      }
      return changed ? next : current
    })
    setRasterErrors((current) => {
      const next = new Set(current)
      let changed = false
      for (const pageId of invalidatedPageIds) {
        changed = next.delete(pageId) || changed
      }
      return changed ? next : current
    })
  }, [clearRasterRetry, rasterCache, rasterKeysByPageId])

  useEffect(() => {
    if (!rasterCache) return
    let cancelled = false
    for (const [pageId, key] of rasterKeysByPageId) {
      if (
        pageId === effectiveActivePageId ||
        !visiblePageIds.has(pageId) ||
        !observedVisiblePageIdsRef.current.has(pageId)
      ) {
        clearRasterRetry(pageId)
        rasterCache.cancel(key)
      }
    }
    const requestPageIds =
      rasterAdmissionDelayMs === 0 ? visiblePageIds : admittedRasterPageIds
    for (const pageId of requestPageIds) {
      if (
        pageId === effectiveActivePageId ||
        !observedVisiblePageIdsRef.current.has(pageId)
      ) {
        continue
      }
      const key = rasterKeysByPageId.get(pageId)
      if (!key) continue
      const request = rasterCache.request(key)
      void request.then(
        (entry) => {
          if (cancelled) return
          clearRasterRetry(pageId)
          setRasterErrors((current) => {
            if (!current.has(pageId)) return current
            const next = new Set(current)
            next.delete(pageId)
            return next
          })
          setRasterEntries((current) => {
            if (current.get(pageId) === entry) return current
            const next = new Map(current)
            next.set(pageId, entry)
            return next
          })
        },
        (error: unknown) => {
          if (cancelled) return
          setRasterErrors((current) => {
            if (current.has(pageId)) return current
            return new Set(current).add(pageId)
          })
          const previousRetry = rasterRetriesRef.current.get(pageId)
          const attempt =
            previousRetry &&
            isSamePageThumbnailRasterCacheKey(previousRetry.key, key)
              ? previousRetry.attempt + 1
              : 1
          const delay = pageThumbnailRasterRetryDelay(error, attempt)
          clearRasterRetry(pageId)
          if (delay === null) return
          const retry: RasterRetryState = { key, attempt, timer: null }
          const timer = setTimeout(() => {
            const current = rasterRetriesRef.current.get(pageId)
            if (current?.timer !== timer) return
            rasterRetriesRef.current.set(pageId, { ...current, timer: null })
            setRasterRetryEpoch((currentEpoch) => currentEpoch + 1)
          }, delay)
          retry.timer = timer
          rasterRetriesRef.current.set(pageId, retry)
        }
      )
    }
    return () => {
      cancelled = true
    }
  }, [
    clearRasterRetry,
    admittedRasterPageIds,
    effectiveActivePageId,
    rasterCache,
    rasterAdmissionDelayMs,
    rasterKeysByPageId,
    rasterRetryEpoch,
    visiblePageIds,
  ])

  useEffect(() => {
    const element = thumbnailElementsRef.current.get(effectiveActivePageId)
    const scrollIntoView: unknown = element
      ? Reflect.get(element, "scrollIntoView")
      : null
    if (typeof scrollIntoView !== "function") return
    scrollIntoView.call(element, {
      block: "nearest",
      inline: "nearest",
    })
  }, [effectiveActivePageId])
  const enabled = (
    commandId:
      | "page.add"
      | "page.duplicate"
      | "page.remove"
      | "page.move-up"
      | "page.move-down",
    pageIndex?: number
  ) =>
    isDocumentStructureCommandEnabled(commandId, {
      reviewPending,
      outputCount: document.outputs.length,
      outputPageCount: pages.length,
      pageIndex,
    })

  return (
    <div
      aria-label={`${output?.name ?? "Current output"} pages`}
      className={cn(
        "flex shrink-0 border-t bg-background",
        density === "compact"
          ? "h-[88px] min-[1280px]:h-24"
          : "h-[88px] min-[1280px]:h-[120px]",
        className
      )}
      data-compact-height={PAGE_FILMSTRIP_DENSITY_HEIGHTS[density].compact}
      data-density={density}
      data-desktop-height={PAGE_FILMSTRIP_DENSITY_HEIGHTS[density].desktop}
      data-page-filmstrip="gallery"
      data-thumbnail-density={thumbnailDensity}
      ref={regionRef}
      role="region"
    >
      <ScrollArea className="h-full min-w-0 flex-1">
        <div className="flex min-w-max items-start gap-1.5 px-2 py-1 min-[1280px]:gap-2 min-[1280px]:px-3">
          {pages.map((page, index) => {
            const active = page.id === effectiveActivePageId
            const productMenuGroups = productCommandContext
              ? buildPageContextMenu(
                  productCommandContext,
                  createPageProductCommandTarget(productCommandContext, page)
                )
              : undefined
            const rasterKey = rasterKeysByPageId.get(page.id)
            const rasterEntry =
              rasterKey && rasterEntries.has(page.id)
                ? (rasterCache?.peek(rasterKey) ?? null)
                : null
            const rasterState = !rasterCache
              ? active || visiblePageIds.has(page.id)
                ? "disabled"
                : "deferred"
              : !visiblePageIds.has(page.id) && !active
                ? "deferred"
                : active
                  ? "disabled"
                  : rasterEntry
                    ? "ready"
                    : rasterErrors.has(page.id)
                      ? "error"
                      : "loading"
            return (
              <PageFilmstripItem
                key={page.id}
                active={active}
                canDuplicate={enabled("page.duplicate", index)}
                canMoveLeft={enabled("page.move-up", index)}
                canMoveRight={enabled("page.move-down", index)}
                canRemove={enabled("page.remove", index)}
                document={thumbnailDocumentsByPageId.get(page.id) ?? document}
                density={thumbnailDensity}
                imageResourceTokens={imageResourceTokens}
                index={index}
                onDuplicatePage={stableCallbacks.onDuplicatePage}
                onImageResourceStateChange={onImageResourceStateChange}
                onRemovePage={stableCallbacks.onRemovePage}
                onReorderPage={stableCallbacks.onReorderPage}
                onSelectPage={stableCallbacks.onSelectPage}
                onSelectorKeyDown={onSelectorKeyDown}
                onlyPage={pages.length === 1}
                outputId={output?.id ?? page.outputId}
                page={page}
                productCommandRuntime={productCommandRuntime}
                productMenuGroups={productMenuGroups}
                renderThumbnail={active || visiblePageIds.has(page.id)}
                rasterEntry={rasterEntry}
                rasterState={rasterState}
                selectorRef={selectorRefFor(page.id)}
                thumbnailRef={thumbnailRefFor(page.id)}
              />
            )
          })}
          {output ? (
            <Button
              aria-label={`Add page to ${output.name}`}
              className={cn(
                "mt-0.5 shrink-0 flex-col border-dashed text-[10px] font-normal text-muted-foreground",
                density === "compact"
                  ? "h-[68px] w-14 gap-1 min-[1280px]:h-[84px] min-[1280px]:w-[60px] min-[1280px]:gap-2"
                  : "h-[68px] w-14 gap-1 min-[1280px]:h-[108px] min-[1280px]:w-[68px] min-[1280px]:gap-2"
              )}
              data-command-id="page.add"
              disabled={!enabled("page.add")}
              variant="outline"
              onClick={() => stableCallbacks.onAddPage(output.id)}
            >
              <Plus className="size-4" />
              Add page
            </Button>
          ) : null}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {onDensityChange && desktopFilmstrip ? (
        <div className="flex w-10 shrink-0 items-start justify-center border-l pt-2">
          <Button
            aria-label="Comfortable page strip density"
            aria-pressed={density === "comfortable"}
            className="size-7 text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            data-density-control
            data-state={density === "comfortable" ? "on" : "off"}
            onClick={() =>
              onDensityChange(density === "compact" ? "comfortable" : "compact")
            }
            size="icon-sm"
            title="Comfortable page strip density"
            variant="ghost"
          >
            <GalleryHorizontal />
          </Button>
        </div>
      ) : null}
    </div>
  )
})

type ProductPageFilmstripProps = PageFilmstripProps &
  Required<
    Pick<PageFilmstripProps, "productCommandContext" | "productCommandRuntime">
  >

export const ProductPageFilmstrip = memo(function ProductPageFilmstrip(
  props: ProductPageFilmstripProps
) {
  return <PageFilmstrip {...props} />
})
