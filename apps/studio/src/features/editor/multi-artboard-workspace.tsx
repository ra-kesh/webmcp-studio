import { memo, type ReactNode } from "react"
import type { Document, Page } from "@webmcp/document"
import type {
  MultiArtboardLayoutController,
  PageWorldFrame,
} from "@webmcp/editor/multi-artboard"
import { cn } from "@webmcp/ui/lib/utils"

export type MultiArtboardWorkspaceProps = Readonly<{
  document: Document
  layout: MultiArtboardLayoutController
  zoom: number
  activePageId: string
  mountedPageIds: ReadonlySet<string>
  interactionPageIds: ReadonlySet<string>
  mutationDisabled?: boolean
  renderArtboard: (page: Page) => ReactNode
  onActivatePage: (pageId: string) => void
  onFocusPage: (pageId: string) => void
  onAddPage: (outputId: string) => void
}>

const MultiArtboardPageShell = memo(function MultiArtboardPageShell({
  page,
  frame,
  zoom,
  active,
  mounted,
  interactionOwner,
  mutationDisabled,
  artboard,
  onActivatePage,
  onFocusPage,
  onAddPage,
}: Readonly<{
  page: Page
  frame: PageWorldFrame
  zoom: number
  active: boolean
  mounted: boolean
  interactionOwner: boolean
  mutationDisabled: boolean
  artboard: ReactNode
  onActivatePage: (pageId: string) => void
  onFocusPage: (pageId: string) => void
  onAddPage: (outputId: string) => void
}>) {
  return (
    <section
      aria-label={`Page ${frame.index + 1}: ${page.name}`}
      className="absolute"
      data-active={active || undefined}
      data-artboard-mounted={mounted}
      data-interaction-owner={interactionOwner || undefined}
      data-page-world-frame={`${frame.left},${frame.top},${frame.width},${frame.height}`}
      style={{
        left: frame.left * zoom,
        top: frame.top * zoom,
        width: frame.width * zoom,
        height: frame.height * zoom,
        contain: "layout style paint",
      }}
      onPointerDownCapture={() => onActivatePage(page.id)}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className={cn(
          "absolute bottom-full left-0 mb-1 flex h-6 max-w-full items-center gap-1.5 rounded px-1.5 text-[11px] leading-none font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/45 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3",
          active
            ? "bg-studio-accent/12 text-studio-accent"
            : "bg-editor-panel/88 hover:bg-editor-panel"
        )}
        onClick={(event) => {
          event.stopPropagation()
          onFocusPage(page.id)
        }}
      >
        <span className="tabular-nums">{frame.index + 1}</span>
        <span className="truncate">{page.name}</span>
      </button>

      {mounted ? (
        artboard
      ) : (
        <div
          aria-hidden="true"
          className="size-full shadow-[0_24px_70px_rgba(35,31,25,0.12)] ring-1 ring-black/10"
          data-artboard-placeholder={page.id}
          style={{ background: page.background }}
        />
      )}

      {active ? (
        <button
          type="button"
          aria-label={`Add page after ${page.name}`}
          className="absolute top-full left-1/2 mt-3 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-border bg-editor-panel text-base text-muted-foreground shadow-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-studio-accent/45 disabled:pointer-events-none disabled:opacity-45 [@media(pointer:coarse)]:size-11"
          data-add-page-after={page.id}
          disabled={mutationDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onAddPage(page.outputId)
          }}
        >
          +
        </button>
      ) : null}
    </section>
  )
})

export const MultiArtboardWorkspace = memo(function MultiArtboardWorkspace({
  document,
  layout,
  zoom,
  activePageId,
  mountedPageIds,
  interactionPageIds,
  mutationDisabled = false,
  renderArtboard,
  onActivatePage,
  onFocusPage,
  onAddPage,
}: MultiArtboardWorkspaceProps) {
  const pagesById = new Map(document.pages.map((page) => [page.id, page]))
  return (
    <div
      className="relative"
      data-multi-artboard-workspace="true"
      style={{
        width: layout.documentBounds.width * zoom,
        height: layout.documentBounds.height * zoom,
      }}
    >
      {layout.frames.map((frame) => {
        const page = pagesById.get(frame.pageId)
        if (!page) return null
        const mounted = mountedPageIds.has(page.id)
        return (
          <MultiArtboardPageShell
            key={page.id}
            page={page}
            frame={frame}
            zoom={zoom}
            active={page.id === activePageId}
            mounted={mounted}
            interactionOwner={interactionPageIds.has(page.id)}
            mutationDisabled={mutationDisabled}
            artboard={mounted ? renderArtboard(page) : null}
            onActivatePage={onActivatePage}
            onFocusPage={onFocusPage}
            onAddPage={onAddPage}
          />
        )
      })}
    </div>
  )
})
