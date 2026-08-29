import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArchiveRestore,
  Copy,
  Download,
  Ellipsis,
  FileText,
  Grid2X2,
  List,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent, RefCallback } from "react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Input } from "@webmcp/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@webmcp/ui/components/input-group"
import { Label } from "@webmcp/ui/components/label"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"
import { useStudioPersistence } from "../persistence/studio-persistence-provider"
import { DocumentPreview } from "./document-preview"
import type {
  DocumentsCollection,
  DocumentsView,
} from "./recent-documents-controller"
import type { RecentDocumentsCommands } from "./recent-documents-provider"
import { useRecentDocuments } from "./recent-documents-provider"
import { projectRecentDocumentsModel } from "./recent-documents-model"
import type {
  RecentDocumentRowModel,
  RecentDocumentsCollectionBase,
  RecentDocumentsModel,
} from "./recent-documents-model"

type CollectionModel = Extract<
  RecentDocumentsModel,
  RecentDocumentsCollectionBase
>

export type RecentDocumentsProps = Readonly<{
  actionsEnabled: boolean
  initialFocusRequested?: boolean
  onCreateBlank: () => void
  onOpen: (documentId: string) => boolean | Promise<boolean>
}>

type RecentDocumentsViewProps = RecentDocumentsProps &
  Readonly<{
    commands: RecentDocumentsCommands
    model: RecentDocumentsModel
    onRetryPersistence: () => void
  }>

const actionTargetClass =
  "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"

function downloadStoredDocument(
  downloaded: Awaited<ReturnType<RecentDocumentsCommands["download"]>>
) {
  if (!downloaded || typeof document === "undefined") return
  const objectUrl = URL.createObjectURL(
    new Blob([downloaded.json], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.download = downloaded.fileName
  link.href = objectUrl
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function collectionStatusText(model: CollectionModel) {
  if (model.status === "refreshing") return "Refreshing documents…"
  if (model.status === "loading_more") return "Loading more documents…"
  return null
}

function actionFailureLabel(
  kind: CollectionModel["actionFailures"][number]["kind"]
) {
  if (kind === "trash") return "Move to Trash"
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`
}

function DocumentActionsMenu({
  actionRef,
  row,
  actionsEnabled,
  commands,
  onActionFailure,
  onDownload,
}: {
  actionRef: RefCallback<HTMLButtonElement>
  row: RecentDocumentRowModel
  actionsEnabled: boolean
  commands: RecentDocumentsCommands
  onActionFailure: (documentId: string) => void
  onDownload: (documentId: string) => Promise<boolean>
}) {
  const busy = row.action.status === "submitting"
  const commandOwnsReturnFocus = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={actionRef}
          aria-label={`Actions for ${row.name}`}
          className={cn(
            actionTargetClass,
            "opacity-100 sm:opacity-0 sm:group-focus-within/document:opacity-100 sm:group-hover/document:opacity-100 sm:aria-expanded:opacity-100"
          )}
          disabled={busy || !actionsEnabled}
          size="icon-sm"
          variant="ghost"
        >
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Ellipsis aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          if (!commandOwnsReturnFocus.current) return
          event.preventDefault()
          commandOwnsReturnFocus.current = false
        }}
      >
        <DropdownMenuGroup>
          {row.capabilities.rename.visible ? (
            <DropdownMenuItem
              className={actionTargetClass}
              disabled={!actionsEnabled || !row.capabilities.rename.enabled}
              onSelect={() => {
                commandOwnsReturnFocus.current = true
                commands.beginRename(row.documentId)
              }}
            >
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {row.capabilities.duplicate.visible ? (
            <DropdownMenuItem
              className={actionTargetClass}
              disabled={!actionsEnabled || !row.capabilities.duplicate.enabled}
              onSelect={() => void commands.duplicate(row.documentId)}
            >
              <Copy aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
          ) : null}
          {row.capabilities.download.visible ? (
            <DropdownMenuItem
              className={actionTargetClass}
              disabled={!actionsEnabled || !row.capabilities.download.enabled}
              onSelect={() => {
                commandOwnsReturnFocus.current = true
                void onDownload(row.documentId).then((downloaded) => {
                  if (!downloaded) onActionFailure(row.documentId)
                })
              }}
            >
              <Download aria-hidden="true" />
              Download JSON
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {row.capabilities.moveToTrash.visible ||
        row.capabilities.restore.visible ? (
          <DropdownMenuSeparator />
        ) : null}
        <DropdownMenuGroup>
          {row.capabilities.moveToTrash.visible ? (
            <DropdownMenuItem
              className={actionTargetClass}
              disabled={
                !actionsEnabled || !row.capabilities.moveToTrash.enabled
              }
              variant="destructive"
              onSelect={() => {
                commandOwnsReturnFocus.current = true
                void commands.moveToTrash(row.documentId).then((result) => {
                  if (!result) onActionFailure(row.documentId)
                })
              }}
            >
              <Trash2 aria-hidden="true" />
              Move to Trash
            </DropdownMenuItem>
          ) : null}
          {row.capabilities.restore.visible ? (
            <DropdownMenuItem
              className={actionTargetClass}
              disabled={!actionsEnabled || !row.capabilities.restore.enabled}
              onSelect={() => {
                commandOwnsReturnFocus.current = true
                void commands.restore(row.documentId).then((result) => {
                  if (!result) onActionFailure(row.documentId)
                })
              }}
            >
              <ArchiveRestore aria-hidden="true" />
              Restore
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DocumentCard({
  row,
  view,
  actionsEnabled,
  commands,
  openingDocumentId,
  actionRef,
  openRef,
  onActionFailure,
  onDownload,
  onOpen,
}: {
  row: RecentDocumentRowModel
  view: DocumentsView
  actionsEnabled: boolean
  commands: RecentDocumentsCommands
  openingDocumentId: string | null
  actionRef: RefCallback<HTMLButtonElement>
  openRef: RefCallback<HTMLButtonElement>
  onActionFailure: (documentId: string) => void
  onDownload: (documentId: string) => Promise<boolean>
  onOpen: (documentId: string) => void
}) {
  const grid = view === "grid"
  const openDisabled = !actionsEnabled || !row.capabilities.open.enabled
  const opening = openingDocumentId === row.documentId
  const actionError = row.action.status === "failed" ? row.action.error : null
  return (
    <article
      className={cn(
        "group/document min-w-0 border bg-background transition-[border-color,box-shadow,transform] duration-150 focus-within:border-foreground/20 hover:border-foreground/20 hover:shadow-sm motion-reduce:transition-none",
        grid ? "h-full" : "grid min-h-20 grid-cols-[5rem_minmax(0,1fr)]"
      )}
      data-document-id={row.documentId}
    >
      {grid ? (
        <DocumentPreview
          identity={row.previewIdentity}
          openDisabled={openDisabled}
          openLabel={`Open preview for ${row.name}`}
          view="grid"
          onOpen={() => onOpen(row.documentId)}
        />
      ) : (
        <DocumentPreview
          identity={row.previewIdentity}
          openDisabled={openDisabled}
          openLabel={`Open preview for ${row.name}`}
          view="list"
          onOpen={() => onOpen(row.documentId)}
        />
      )}
      <div
        className={cn("min-w-0", grid ? "p-4" : "flex items-center gap-3 p-3")}
      >
        <button
          ref={openRef}
          aria-label={`Open ${row.name}`}
          aria-busy={opening || undefined}
          className={cn(
            "min-h-11 min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            grid ? "block w-full" : "flex items-center gap-4"
          )}
          disabled={openDisabled}
          type="button"
          onClick={() => onOpen(row.documentId)}
        >
          {opening ? (
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 inline size-4 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold"
              title={row.name}
            >
              {row.name}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {row.originLabel}
            </span>
          </span>
          <span
            className={cn(
              "text-[11px] text-muted-foreground tabular-nums",
              grid ? "mt-3 block" : "hidden shrink-0 text-right sm:block"
            )}
          >
            {row.activity.status === "valid" ? (
              <time dateTime={row.activity.dateTime}>{row.activity.label}</time>
            ) : (
              row.activity.label
            )}
          </span>
          {!grid ? (
            <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums lg:block">
              {row.pageCountLabel} · {row.outputCountLabel}
            </span>
          ) : null}
        </button>
        <DocumentActionsMenu
          actionRef={actionRef}
          actionsEnabled={actionsEnabled}
          commands={commands}
          onActionFailure={onActionFailure}
          row={row}
          onDownload={onDownload}
        />
      </div>
      {grid ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>{row.pageCountLabel}</span>
          <span>{row.outputCountLabel}</span>
          <span>{row.dimensionsLabel}</span>
          <span>{row.sourceLabel}</span>
          <span>{row.exportFormatsLabel}</span>
        </div>
      ) : null}
      {actionError ? (
        <p
          className={cn(
            "border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive",
            !grid && "col-span-full"
          )}
          role="alert"
        >
          {actionError}
        </p>
      ) : null}
    </article>
  )
}

function StaticDocumentCollection({
  model,
  ...props
}: Omit<Parameters<typeof DocumentCard>[0], "row" | "actionRef" | "openRef"> & {
  model: CollectionModel
  registerActionRef: (documentId: string) => RefCallback<HTMLButtonElement>
  registerOpenRef: (documentId: string) => RefCallback<HTMLButtonElement>
}) {
  const { registerActionRef, registerOpenRef, ...cardProps } = props
  return (
    <ul
      aria-label={`${model.collectionLabel} documents`}
      className={cn(
        model.view === "grid"
          ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          : "flex flex-col gap-2"
      )}
    >
      {model.rows.map((row) => (
        <li className="min-w-0" key={row.documentId}>
          <DocumentCard
            {...cardProps}
            actionRef={registerActionRef(row.documentId)}
            openRef={registerOpenRef(row.documentId)}
            row={row}
            view={model.view}
          />
        </li>
      ))}
    </ul>
  )
}

function VirtualizedDocumentCollection({
  model,
  focusDocumentId,
  registerActionRef,
  registerOpenRef,
  onVirtualFocusReady,
  ...cardProps
}: Omit<
  Parameters<typeof DocumentCard>[0],
  "row" | "actionRef" | "openRef" | "view"
> & {
  model: CollectionModel
  focusDocumentId: string | null
  registerActionRef: (documentId: string) => RefCallback<HTMLButtonElement>
  registerOpenRef: (documentId: string) => RefCallback<HTMLButtonElement>
  onVirtualFocusReady: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const grid = model.view === "grid"
  const rowCount = grid
    ? Math.ceil(model.rows.length / columns)
    : model.rows.length
  const virtualizer = useVirtualizer({
    count: rowCount,
    estimateSize: () => (grid ? 282 : 90),
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => {
      const itemIndex = grid ? index * columns : index
      return model.rows[itemIndex]?.documentId ?? index
    },
    overscan: 4,
    useFlushSync: false,
  })

  useEffect(() => {
    if (!grid) {
      setColumns(1)
      return
    }
    const updateColumns = () => {
      const width = window.innerWidth
      setColumns(width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 640 ? 2 : 1)
    }
    updateColumns()
    window.addEventListener("resize", updateColumns)
    return () => window.removeEventListener("resize", updateColumns)
  }, [grid])

  useEffect(() => {
    if (!focusDocumentId) return
    const itemIndex = model.rows.findIndex(
      (row) => row.documentId === focusDocumentId
    )
    if (itemIndex < 0) return
    const targetIndex = grid ? Math.floor(itemIndex / columns) : itemIndex
    virtualizer.scrollToOffset(targetIndex * (grid ? 282 : 90), {
      align: "start",
    })
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetIndex, { align: "center" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [columns, focusDocumentId, grid, model.rows, virtualizer])

  const virtualRows = virtualizer.getVirtualItems()
  useEffect(() => {
    if (!focusDocumentId) return
    const itemIndex = model.rows.findIndex(
      (row) => row.documentId === focusDocumentId
    )
    if (itemIndex < 0) return
    const targetIndex = grid ? Math.floor(itemIndex / columns) : itemIndex
    if (!virtualRows.some((item) => item.index === targetIndex)) return
    const frame = window.requestAnimationFrame(onVirtualFocusReady)
    return () => window.cancelAnimationFrame(frame)
  }, [
    columns,
    focusDocumentId,
    grid,
    model.rows,
    onVirtualFocusReady,
    virtualRows,
  ])
  return (
    <div
      ref={scrollRef}
      className="max-h-[46rem] overflow-auto overscroll-contain pr-1"
      data-virtualized="true"
      tabIndex={-1}
    >
      <div
        aria-label={`${model.collectionLabel} documents`}
        className="relative w-full"
        role="list"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const firstIndex = grid
            ? virtualRow.index * columns
            : virtualRow.index
          const items = model.rows.slice(
            firstIndex,
            firstIndex + (grid ? columns : 1)
          )
          if (grid) {
            return (
              <div
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full pb-3"
                data-index={virtualRow.index}
                key={virtualRow.key}
                role="presentation"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
                >
                  {items.map((row) => (
                    <div
                      className="min-w-0"
                      key={row.documentId}
                      role="listitem"
                    >
                      <DocumentCard
                        {...cardProps}
                        actionRef={registerActionRef(row.documentId)}
                        openRef={registerOpenRef(row.documentId)}
                        row={row}
                        view={model.view}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          const row = items[0]
          return (
            <div
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full pb-3"
              data-index={virtualRow.index}
              key={virtualRow.key}
              role="listitem"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <DocumentCard
                {...cardProps}
                actionRef={registerActionRef(row.documentId)}
                openRef={registerOpenRef(row.documentId)}
                row={row}
                view={model.view}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DocumentCollectionSkeleton({ view }: { view: DocumentsView }) {
  const count = view === "grid" ? 4 : 5
  return (
    <div
      aria-label="Loading Studio documents"
      aria-busy="true"
      className={cn(
        view === "grid"
          ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          : "flex flex-col gap-2"
      )}
      role="status"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="border bg-background" key={index}>
          {view === "grid" ? <Skeleton className="h-32 rounded-none" /> : null}
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
      <span className="sr-only">Opening your document library…</span>
    </div>
  )
}

function LibraryEmptyState({
  actionsEnabled,
  model,
  onCreateBlank,
  onClear,
}: {
  actionsEnabled: boolean
  model: CollectionModel
  onCreateBlank: () => void
  onClear: () => void
}) {
  const noResults = model.status === "no_results"
  const recent = model.status === "empty_recent"
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {noResults ? (
            <Search aria-hidden="true" />
          ) : recent ? (
            <FileText aria-hidden="true" />
          ) : (
            <Trash2 aria-hidden="true" />
          )}
        </EmptyMedia>
        <EmptyTitle>
          {noResults
            ? "No matching documents"
            : recent
              ? "Create your first document"
              : "Trash is empty"}
        </EmptyTitle>
        <EmptyDescription>
          {noResults
            ? `No ${model.collectionLabel.toLowerCase()} document names match “${model.query.applied}”.`
            : recent
              ? "Blank, template, imported, and quotation-backed documents appear here."
              : "Documents you move to Trash stay available to restore."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {noResults ? (
          <Button
            className={actionTargetClass}
            variant="outline"
            onClick={onClear}
          >
            Clear search
          </Button>
        ) : recent ? (
          <Button
            className={actionTargetClass}
            disabled={!actionsEnabled}
            onClick={onCreateBlank}
          >
            Create blank document
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  )
}

function RenameDocumentDialog({
  actionsEnabled,
  model,
  commands,
  onCancel,
}: {
  actionsEnabled: boolean
  model: CollectionModel
  commands: RecentDocumentsCommands
  onCancel: (documentId: string) => void
}) {
  const rename = model.renameActions.find((action) => action.visible) ?? null
  const row = rename
    ? model.rows.find((candidate) => candidate.documentId === rename.documentId)
    : null
  const inputId = "recent-document-rename"
  const submitting = rename?.phase === "submitting"
  const close = () => {
    if (rename && !submitting) onCancel(rename.documentId)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rename && !submitting) void commands.submitRename(rename.documentId)
  }
  return (
    <Dialog open={rename !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        onEscapeKeyDown={(event) => submitting && event.preventDefault()}
      >
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>
              Change the library name for {row?.name ?? "this document"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Document name</Label>
            <Input
              autoFocus
              aria-invalid={Boolean(rename?.error)}
              autoComplete="off"
              disabled={submitting || !actionsEnabled}
              id={inputId}
              name="document-name"
              value={rename?.input ?? ""}
              onChange={(event) =>
                rename &&
                commands.updateRename(rename.documentId, event.target.value)
              }
            />
            {rename?.error ? (
              <p className="text-xs text-destructive" role="alert">
                {rename.error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              className={actionTargetClass}
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              className={actionTargetClass}
              disabled={submitting || !actionsEnabled}
              type="submit"
            >
              {submitting ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  data-icon="inline-start"
                />
              ) : null}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProviderBoundaryState({
  model,
  onRetryPersistence,
}: Pick<RecentDocumentsViewProps, "model" | "onRetryPersistence">) {
  if (model.status === "opening") {
    return <DocumentCollectionSkeleton view="grid" />
  }
  if (model.status === "recovery_required") {
    return (
      <Empty className="min-h-64 border" role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Stored documents need recovery</EmptyTitle>
          <EmptyDescription>{model.failure.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (model.status === "blocked" || model.status === "unavailable") {
    return (
      <Empty className="min-h-64 border" role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RefreshCw aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Document library unavailable</EmptyTitle>
          <EmptyDescription>{model.failure.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            className={actionTargetClass}
            variant="outline"
            onClick={onRetryPersistence}
          >
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return null
}

export function RecentDocumentsView({
  actionsEnabled,
  commands,
  initialFocusRequested = false,
  model,
  onCreateBlank,
  onOpen,
  onRetryPersistence,
}: RecentDocumentsViewProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const loadMoreRef = useRef<HTMLButtonElement>(null)
  const paginationStatusRef = useRef<HTMLParagraphElement>(null)
  const actionRefs = useRef(new Map<string, HTMLButtonElement>())
  const openRefs = useRef(new Map<string, HTMLButtonElement>())
  const openingDocumentRef = useRef<string | null>(null)
  const initialFocusHandledRef = useRef(false)
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(
    null
  )
  const [failedOpenFocusId, setFailedOpenFocusId] = useState<string | null>(
    null
  )
  const [failedActionFocusId, setFailedActionFocusId] = useState<string | null>(
    null
  )
  const [pendingVirtualFocus, setPendingVirtualFocus] = useState<string | null>(
    null
  )

  const collectionModel = "collection" in model ? model : null
  const registerOpenRef = useCallback(
    (documentId: string): RefCallback<HTMLButtonElement> =>
      (element) => {
        if (element) openRefs.current.set(documentId, element)
        else openRefs.current.delete(documentId)
      },
    []
  )
  const registerActionRef = useCallback(
    (documentId: string): RefCallback<HTMLButtonElement> =>
      (element) => {
        if (element) actionRefs.current.set(documentId, element)
        else actionRefs.current.delete(documentId)
      },
    []
  )
  const focusDocument = useCallback((documentId: string) => {
    const target = openRefs.current.get(documentId)
    if (!target || !target.isConnected) {
      openRefs.current.delete(documentId)
      return false
    }
    target.focus({ preventScroll: true })
    const scrollIntoView: unknown = Reflect.get(target, "scrollIntoView")
    if (typeof scrollIntoView === "function") {
      Reflect.apply(scrollIntoView, target, [{ block: "nearest" }])
    }
    return true
  }, [])
  const requestFailedActionFocus = useCallback((documentId: string) => {
    setFailedActionFocusId(documentId)
  }, [])

  useEffect(() => {
    if (openingDocumentId !== null || failedOpenFocusId === null) return
    if (!focusDocument(failedOpenFocusId)) {
      headingRef.current?.focus({ preventScroll: true })
    }
    setFailedOpenFocusId(null)
  }, [failedOpenFocusId, focusDocument, openingDocumentId])

  useEffect(() => {
    if (failedActionFocusId === null) return
    const actionTarget = actionRefs.current.get(failedActionFocusId)
    if (actionTarget?.isConnected) {
      actionTarget.focus({ preventScroll: true })
    } else if (!focusDocument(failedActionFocusId)) {
      headingRef.current?.focus({ preventScroll: true })
    }
    setFailedActionFocusId(null)
  }, [failedActionFocusId, focusDocument])

  useEffect(() => {
    if (
      !initialFocusRequested ||
      initialFocusHandledRef.current ||
      !collectionModel
    )
      return
    if (collectionModel.status === "opening") return
    initialFocusHandledRef.current = true
    if (collectionModel.rows.length > 0) {
      const firstDocumentId = collectionModel.rows[0].documentId
      if (focusDocument(firstDocumentId)) return
      if (collectionModel.virtualization.enabled) {
        setPendingVirtualFocus(firstDocumentId)
        return
      }
    }
    headingRef.current?.focus({ preventScroll: true })
  }, [collectionModel, focusDocument, initialFocusRequested])

  useEffect(() => {
    if (!collectionModel?.focusIntent) return
    const intent = collectionModel.focusIntent
    let completed = false
    if (intent.target === "search") {
      searchRef.current?.focus()
      searchRef.current?.select()
      completed = document.activeElement === searchRef.current
    } else if (intent.target === "collection-heading") {
      headingRef.current?.focus({ preventScroll: true })
      completed = document.activeElement === headingRef.current
    } else if (intent.target === "load-more") {
      loadMoreRef.current?.focus({ preventScroll: true })
      completed = document.activeElement === loadMoreRef.current
    } else if (intent.target === "pagination-status") {
      paginationStatusRef.current?.focus({ preventScroll: true })
      completed = document.activeElement === paginationStatusRef.current
    } else if (intent.documentId) {
      completed = focusDocument(intent.documentId)
      if (!completed && collectionModel.virtualization.enabled) {
        setPendingVirtualFocus(intent.documentId)
        return
      }
    }
    if (completed) commands.clearFocusIntent(intent.id)
  }, [collectionModel, commands, focusDocument])

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "f"
      )
        return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener("keydown", handleFind)
    return () => window.removeEventListener("keydown", handleFind)
  }, [])

  if (!collectionModel) {
    return (
      <section aria-labelledby="recent-documents-heading">
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground">Your work</p>
          <h2
            ref={headingRef}
            className="mt-1 text-lg leading-6 font-semibold tracking-tight"
            id="recent-documents-heading"
            tabIndex={-1}
          >
            Studio documents
          </h2>
        </div>
        <ProviderBoundaryState
          model={model}
          onRetryPersistence={onRetryPersistence}
        />
      </section>
    )
  }

  const openingCollection = collectionModel.status === "opening"
  const showEmpty =
    collectionModel.status === "empty_recent" ||
    collectionModel.status === "empty_trash" ||
    collectionModel.status === "no_results"
  const showRows = collectionModel.rows.length > 0
  const terminalError = collectionModel.status === "terminal_error"
  const retainedError = collectionModel.status === "retained_error"
  const loadMoreError = collectionModel.status === "load_more_failed"
  const detachedActionFailures = collectionModel.actionFailures.filter(
    (failure) =>
      failure.owner === collectionModel.collection && !failure.visible
  )
  const statusText = collectionStatusText(collectionModel)
  const libraryActionsEnabled = actionsEnabled && openingDocumentId === null

  const handleOpen = async (documentId: string) => {
    if (!actionsEnabled || openingDocumentRef.current !== null) return
    openingDocumentRef.current = documentId
    setOpeningDocumentId(documentId)
    let shouldRestoreFocus = false
    try {
      const opened = await onOpen(documentId)
      shouldRestoreFocus = !opened
    } catch {
      shouldRestoreFocus = true
    } finally {
      openingDocumentRef.current = null
      setOpeningDocumentId(null)
      if (shouldRestoreFocus) setFailedOpenFocusId(documentId)
    }
  }
  const handleDownload = async (documentId: string) => {
    const downloaded = await commands.download(documentId)
    if (!downloaded) return false
    downloadStoredDocument(downloaded)
    return true
  }
  const completeVirtualFocus = () => {
    if (!pendingVirtualFocus) return
    window.requestAnimationFrame(() => {
      if (!focusDocument(pendingVirtualFocus)) return
      const intent = collectionModel.focusIntent
      if (
        intent?.target === "document" &&
        intent.documentId === pendingVirtualFocus
      ) {
        commands.clearFocusIntent(intent.id)
      }
      setPendingVirtualFocus(null)
    })
  }

  return (
    <section aria-labelledby="recent-documents-heading">
      <div className="mb-4 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Your work
            </p>
            <h2
              ref={headingRef}
              className="mt-1 text-lg leading-6 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              id="recent-documents-heading"
              tabIndex={-1}
            >
              Studio documents
            </h2>
          </div>
          {collectionModel.page ? (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {collectionModel.page.lastConfirmedLabel}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-y py-3 lg:flex-row lg:items-end">
          <Tabs
            className="shrink-0"
            value={collectionModel.collection}
            onValueChange={(value) =>
              commands.setCollection(value as DocumentsCollection)
            }
          >
            <TabsList aria-label="Document collection" variant="line">
              <TabsTrigger className={actionTargetClass} value="recent">
                Recent
              </TabsTrigger>
              <TabsTrigger className={actionTargetClass} value="trash">
                Trash
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <form
            className="min-w-0 flex-1"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              commands.applyQueryInput()
            }}
          >
            <Label className="mb-1.5 block text-xs" htmlFor="document-search">
              Search document names
            </Label>
            <InputGroup className="h-11 sm:h-8">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                autoComplete="off"
                id="document-search"
                name="document-search"
                placeholder="Search document names…"
                type="search"
                value={collectionModel.query.input}
                onChange={(event) => commands.setQueryInput(event.target.value)}
              />
              {collectionModel.query.canClear ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label="Clear document search"
                    className={actionTargetClass}
                    size="icon-xs"
                    type="button"
                    onClick={() => commands.clearQuery()}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          </form>
          <div
            className="flex items-center gap-1 self-end"
            role="group"
            aria-label="Document view"
          >
            <Button
              aria-label="Grid view"
              aria-pressed={collectionModel.view === "grid"}
              className={actionTargetClass}
              size="icon-sm"
              variant={collectionModel.view === "grid" ? "secondary" : "ghost"}
              onClick={() => commands.setView("grid")}
            >
              <Grid2X2 aria-hidden="true" />
            </Button>
            <Button
              aria-label="List view"
              aria-pressed={collectionModel.view === "list"}
              className={actionTargetClass}
              size="icon-sm"
              variant={collectionModel.view === "list" ? "secondary" : "ghost"}
              onClick={() => commands.setView("list")}
            >
              <List aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {collectionModel.recoveryItems.length > 0 ? (
        <div
          className="mb-3 border border-destructive/20 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm font-medium">
            Some stored documents need recovery
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
            {collectionModel.recoveryItems.map((item) => (
              <li key={item.key}>
                {item.title}: {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {detachedActionFailures.length > 0 ? (
        <div
          className="mb-3 border border-destructive/20 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm font-medium">
            Some document actions need attention
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
            {detachedActionFailures.map((failure) => (
              <li
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                key={`${failure.documentId}:${failure.kind}`}
              >
                <span>
                  {failure.documentName} · {actionFailureLabel(failure.kind)}:{" "}
                  {failure.message}
                </span>
                <Button
                  className={actionTargetClass}
                  size="sm"
                  variant="outline"
                  onClick={() => commands.cancelAction(failure.documentId)}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {retainedError || terminalError ? (
        <div
          className="mb-3 flex flex-col gap-3 border border-destructive/20 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="text-sm font-medium">
              Documents could not be refreshed
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {collectionModel.failure.message}
              {collectionModel.page
                ? ` ${collectionModel.page.lastConfirmedLabel}.`
                : ""}
            </p>
          </div>
          <Button
            className={actionTargetClass}
            variant="outline"
            onClick={() => commands.retry()}
          >
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            Retry
          </Button>
        </div>
      ) : null}

      {openingCollection ? (
        <DocumentCollectionSkeleton view={collectionModel.view} />
      ) : null}
      {showEmpty ? (
        <LibraryEmptyState
          actionsEnabled={libraryActionsEnabled}
          model={collectionModel}
          onClear={() => commands.clearQuery()}
          onCreateBlank={onCreateBlank}
        />
      ) : null}
      {collectionModel.status === "recovery_only" ? (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No readable documents in this collection</EmptyTitle>
            <EmptyDescription>
              Review the recovery notice above before creating or restoring
              work.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {showRows ? (
        collectionModel.virtualization.enabled ? (
          <VirtualizedDocumentCollection
            actionsEnabled={libraryActionsEnabled}
            commands={commands}
            focusDocumentId={pendingVirtualFocus}
            model={collectionModel}
            openingDocumentId={openingDocumentId}
            registerActionRef={registerActionRef}
            registerOpenRef={registerOpenRef}
            onActionFailure={requestFailedActionFocus}
            onDownload={handleDownload}
            onOpen={(documentId) => void handleOpen(documentId)}
            onVirtualFocusReady={completeVirtualFocus}
          />
        ) : (
          <StaticDocumentCollection
            actionsEnabled={libraryActionsEnabled}
            commands={commands}
            model={collectionModel}
            openingDocumentId={openingDocumentId}
            registerActionRef={registerActionRef}
            registerOpenRef={registerOpenRef}
            onActionFailure={requestFailedActionFocus}
            onDownload={handleDownload}
            onOpen={(documentId) => void handleOpen(documentId)}
            view={collectionModel.view}
          />
        )
      ) : null}

      {showRows && collectionModel.page ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {loadMoreError ? (
            <p className="text-xs text-destructive" role="alert">
              {collectionModel.failure.message}
            </p>
          ) : null}
          {collectionModel.page.pagination.status === "available" ||
          loadMoreError ? (
            <Button
              ref={loadMoreRef}
              className={actionTargetClass}
              disabled={
                !libraryActionsEnabled ||
                collectionModel.status === "loading_more"
              }
              variant="outline"
              onClick={() => void commands.loadMore()}
            >
              {collectionModel.status === "loading_more" ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  data-icon="inline-start"
                />
              ) : null}
              {loadMoreError ? "Retry loading more" : "Load more"}
            </Button>
          ) : (
            <p
              ref={paginationStatusRef}
              className="min-h-8 rounded-md px-3 py-1.5 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              tabIndex={-1}
            >
              {collectionModel.page.pagination.label}
            </p>
          )}
        </div>
      ) : null}

      {collectionModel.undo ? (
        <div className="sticky bottom-4 z-10 mx-auto mt-4 flex max-w-xl items-center justify-between gap-3 rounded-lg border bg-popover p-3 shadow-lg">
          <p className="min-w-0 truncate text-sm">
            {collectionModel.undo.name} moved to Trash.
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              className={actionTargetClass}
              disabled={!libraryActionsEnabled}
              size="sm"
              variant="outline"
              onClick={() => void commands.restoreUndo()}
            >
              Restore
            </Button>
            <Button
              aria-label="Dismiss restore action"
              className={actionTargetClass}
              size="icon-sm"
              variant="ghost"
              onClick={() => commands.dismissUndo()}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {collectionModel.announcement?.message ?? statusText ?? ""}
      </p>
      <RenameDocumentDialog
        actionsEnabled={libraryActionsEnabled}
        commands={commands}
        model={collectionModel}
        onCancel={(documentId) => {
          commands.cancelAction(documentId)
          window.requestAnimationFrame(() => {
            const target =
              actionRefs.current.get(documentId) ??
              openRefs.current.get(documentId)
            if (target) target.focus({ preventScroll: true })
            else headingRef.current?.focus({ preventScroll: true })
          })
        }}
      />
    </section>
  )
}

export function RecentDocuments(props: RecentDocumentsProps) {
  const recent = useRecentDocuments()
  const persistence = useStudioPersistence()
  const model = useMemo(
    () =>
      projectRecentDocumentsModel(recent.state, {
        locale: typeof navigator === "undefined" ? "en" : navigator.language,
        now: Date.now(),
      }),
    [recent.state]
  )
  return (
    <RecentDocumentsView
      {...props}
      commands={recent.commands}
      model={model}
      onRetryPersistence={persistence.retry}
    />
  )
}
