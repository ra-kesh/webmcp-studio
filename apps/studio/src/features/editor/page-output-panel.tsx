import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Ellipsis,
  FilePlus2,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react"
import type { Document, Page } from "@webmcp/document"
import {
  buildOutputContextMenu,
  buildPageContextMenu,
} from "@webmcp/editor/product-commands"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { isDocumentStructureCommandEnabled } from "@webmcp/editor/structure-commands"
import type { DocumentStructureCommandId } from "@webmcp/editor/structure-commands"
import { Artboard } from "@webmcp/render-view"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import { Badge } from "@webmcp/ui/components/badge"
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  createOutputProductCommandTarget,
  createPageProductCommandTarget,
  dispatchKeyboardContextMenu,
} from "./page-output-command-context"
import {
  ProductCommandContextMenu,
  ProductCommandDropdownItems,
} from "./product-command-menu"
import type { ProductCommandMenuRuntime } from "./product-command-menu"

type PagePatch = {
  name?: string
  width?: number
  height?: number
  background?: string
}

export type PageOutputPanelProps = {
  document: Document
  activePageId: string
  reviewPending: boolean
  onSelectPage: (pageId: string) => void
  onAddPage: (outputId: string) => void
  onDuplicatePage: (pageId: string) => void
  onUpdatePage: (pageId: string, patch: PagePatch) => void
  onRemovePage: (pageId: string) => void
  onReorderPage: (outputId: string, pageId: string, toIndex: number) => void
  onAddOutput: (options: {
    name: string
    width: number
    height: number
  }) => void
  onUpdateOutput: (outputId: string, name: string) => void
  onRemoveOutput: (outputId: string) => void
  productCommandContext?: ProductCommandRuntimeContext
  productCommandRuntime?: ProductCommandMenuRuntime
}

type PageDraft = Pick<Page, "name" | "width" | "height" | "background">

type DeleteTarget =
  | { type: "page"; id: string; name: string; childCount: number }
  | { type: "output"; id: string; name: string; childCount: number }

const controlClass = "size-11 min-[1280px]:size-7"
const menuItemClass = "min-h-11 min-[1280px]:min-h-0"

function numericDimension(value: string) {
  const next = Math.round(Number(value))
  return Number.isFinite(next) ? next : 0
}

export function PageOutputPanel({
  document,
  activePageId,
  reviewPending,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onUpdatePage,
  onRemovePage,
  onReorderPage,
  onAddOutput,
  onUpdateOutput,
  onRemoveOutput,
  productCommandContext,
  productCommandRuntime,
}: PageOutputPanelProps) {
  const [settingsPageId, setSettingsPageId] = useState<string | null>(null)
  const [pageDraft, setPageDraft] = useState<PageDraft | null>(null)
  const [renameOutputId, setRenameOutputId] = useState<string | null>(null)
  const [outputNameDraft, setOutputNameDraft] = useState("")
  const [newOutputOpen, setNewOutputOpen] = useState(false)
  const [newOutputName, setNewOutputName] = useState("New output")
  const [newOutputWidth, setNewOutputWidth] = useState(1080)
  const [newOutputHeight, setNewOutputHeight] = useState(1080)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const pagesById = useMemo(
    () => new Map(document.pages.map((page) => [page.id, page])),
    [document.pages]
  )
  const settingsPage = settingsPageId
    ? pagesById.get(settingsPageId)
    : undefined
  const renameOutput = document.outputs.find(
    (output) => output.id === renameOutputId
  )

  useEffect(() => {
    if (!settingsPage) return
    setPageDraft({
      name: settingsPage.name,
      width: settingsPage.width,
      height: settingsPage.height,
      background: settingsPage.background,
    })
  }, [settingsPage])

  useEffect(() => {
    if (renameOutput) setOutputNameDraft(renameOutput.name)
  }, [renameOutput])

  const enabled = (
    commandId: DocumentStructureCommandId,
    outputPageCount: number,
    pageIndex?: number
  ) =>
    isDocumentStructureCommandEnabled(commandId, {
      reviewPending,
      outputCount: document.outputs.length,
      outputPageCount,
      pageIndex,
    })

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-4 p-2 pb-6">
          <div className="flex items-start justify-between gap-3 px-1 pt-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Pages & outputs</p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Output order and page order are shared by preview, API, and
                export.
              </p>
            </div>
            <Button
              aria-label="Add output"
              className={`${controlClass} shrink-0`}
              data-command-id="output.add"
              disabled={!enabled("output.add", 1)}
              size="icon-sm"
              variant="ghost"
              onClick={() => setNewOutputOpen(true)}
            >
              <FilePlus2 />
            </Button>
          </div>

          {document.outputs.map((output) => {
            const pages = output.pageIds.flatMap((pageId) => {
              const page = pagesById.get(pageId)
              return page ? [page] : []
            })
            const outputMenuGroups = productCommandContext
              ? buildOutputContextMenu(
                  productCommandContext,
                  createOutputProductCommandTarget(
                    productCommandContext,
                    output
                  )
                )
              : null
            const outputHeader = (
              <div
                className="flex min-h-11 items-center gap-1 border-b bg-muted/35 px-2 min-[1280px]:min-h-9"
                data-output-command-target={output.id}
              >
                <div className="min-w-0 flex-1">
                  <p
                    id={`output-${output.id}`}
                    className="truncate text-[11px] font-medium"
                  >
                    {output.name}
                  </p>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  {pages.length}
                </Badge>
                <Button
                  aria-label={`Add page to ${output.name}`}
                  className={controlClass}
                  data-command-id="page.add"
                  disabled={!enabled("page.add", pages.length)}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onAddPage(output.id)}
                >
                  <Plus />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-keyshortcuts="Shift+F10"
                      aria-label={`More actions for ${output.name}`}
                      className={controlClass}
                      size="icon-sm"
                      variant="ghost"
                      onKeyDown={(event) => {
                        const header = event.currentTarget.closest<HTMLElement>(
                          "[data-output-command-target]"
                        )
                        if (header) dispatchKeyboardContextMenu(event, header)
                      }}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>{output.name}</DropdownMenuLabel>
                    {outputMenuGroups && productCommandRuntime ? (
                      <ProductCommandDropdownItems
                        groups={outputMenuGroups}
                        runtime={productCommandRuntime}
                      />
                    ) : (
                      <>
                        <DropdownMenuItem
                          className={menuItemClass}
                          data-command-id="output.update"
                          disabled={!enabled("output.update", pages.length)}
                          onSelect={() => setRenameOutputId(output.id)}
                        >
                          <Settings2 />
                          Rename output
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className={menuItemClass}
                          data-command-id="page.add"
                          disabled={!enabled("page.add", pages.length)}
                          onSelect={() => onAddPage(output.id)}
                        >
                          <Plus />
                          Add page
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className={menuItemClass}
                          data-command-id="output.remove"
                          disabled={!enabled("output.remove", pages.length)}
                          variant="destructive"
                          onSelect={() =>
                            setDeleteTarget({
                              type: "output",
                              id: output.id,
                              name: output.name,
                              childCount: pages.length,
                            })
                          }
                        >
                          <Trash2 />
                          Delete output
                        </DropdownMenuItem>
                        {document.outputs.length === 1 ? (
                          <p className="px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                            A document must keep at least one output.
                          </p>
                        ) : null}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
            return (
              <section
                key={output.id}
                aria-labelledby={`output-${output.id}`}
                className="overflow-hidden rounded-lg border bg-background"
              >
                {outputMenuGroups && productCommandRuntime ? (
                  <ProductCommandContextMenu
                    groups={outputMenuGroups}
                    runtime={productCommandRuntime}
                  >
                    {outputHeader}
                  </ProductCommandContextMenu>
                ) : (
                  outputHeader
                )}

                <div className="p-1">
                  {pages.map((page, pageIndex) => {
                    const active = page.id === activePageId
                    const scale = 48 / page.height
                    const pageMenuGroups = productCommandContext
                      ? buildPageContextMenu(
                          productCommandContext,
                          createPageProductCommandTarget(
                            productCommandContext,
                            page
                          )
                        )
                      : null
                    const pageRow = (
                      <div
                        key={page.id}
                        className="group/page flex min-h-14 items-center gap-1 rounded-md px-1 data-[active=true]:bg-secondary"
                        data-active={active}
                        data-page-command-target={page.id}
                        onContextMenu={() => onSelectPage(page.id)}
                      >
                        <button
                          type="button"
                          id={`page-output-selector-${page.id.replaceAll(":", "-")}`}
                          aria-keyshortcuts="Shift+F10"
                          aria-current={active ? "page" : undefined}
                          aria-label={`Open page ${pageIndex + 1}: ${page.name}`}
                          className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-sm px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={() => onSelectPage(page.id)}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ContextMenu" ||
                              (event.key === "F10" && event.shiftKey)
                            ) {
                              onSelectPage(page.id)
                              const row =
                                event.currentTarget.closest<HTMLElement>(
                                  "[data-page-command-target]"
                                )
                              if (row) dispatchKeyboardContextMenu(event, row)
                            }
                          }}
                        >
                          <span className="grid h-[48px] w-[40px] shrink-0 place-items-center overflow-hidden">
                            <Artboard
                              className="overflow-hidden rounded-[2px] border bg-white shadow-xs"
                              document={document}
                              imageSemantics="thumbnail"
                              pageId={page.id}
                              scale={scale}
                              showImageRecoveryActions={false}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {pageIndex + 1}. {page.name}
                            </span>
                            <span className="mt-0.5 block text-[9px] text-muted-foreground tabular-nums">
                              {page.width} × {page.height}
                            </span>
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`More actions for ${page.name}`}
                              className={`${controlClass} opacity-100 min-[1280px]:opacity-0 min-[1280px]:group-focus-within/page:opacity-100 min-[1280px]:group-hover/page:opacity-100`}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <Ellipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>{page.name}</DropdownMenuLabel>
                            {pageMenuGroups && productCommandRuntime ? (
                              <ProductCommandDropdownItems
                                groups={pageMenuGroups}
                                runtime={productCommandRuntime}
                              />
                            ) : (
                              <>
                                <DropdownMenuItem
                                  className={menuItemClass}
                                  data-command-id="page.update"
                                  disabled={
                                    !enabled("page.update", pages.length)
                                  }
                                  onSelect={() => setSettingsPageId(page.id)}
                                >
                                  <Settings2 />
                                  Page settings
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className={menuItemClass}
                                  data-command-id="page.duplicate"
                                  disabled={
                                    !enabled("page.duplicate", pages.length)
                                  }
                                  onSelect={() => onDuplicatePage(page.id)}
                                >
                                  <Copy />
                                  Duplicate page
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className={menuItemClass}
                                  data-command-id="page.move-up"
                                  disabled={
                                    !enabled(
                                      "page.move-up",
                                      pages.length,
                                      pageIndex
                                    )
                                  }
                                  onSelect={() =>
                                    onReorderPage(
                                      output.id,
                                      page.id,
                                      pageIndex - 1
                                    )
                                  }
                                >
                                  <ChevronUp />
                                  Move up
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className={menuItemClass}
                                  data-command-id="page.move-down"
                                  disabled={
                                    !enabled(
                                      "page.move-down",
                                      pages.length,
                                      pageIndex
                                    )
                                  }
                                  onSelect={() =>
                                    onReorderPage(
                                      output.id,
                                      page.id,
                                      pageIndex + 1
                                    )
                                  }
                                >
                                  <ChevronDown />
                                  Move down
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className={menuItemClass}
                                  data-command-id="page.remove"
                                  disabled={
                                    !enabled("page.remove", pages.length)
                                  }
                                  variant="destructive"
                                  onSelect={() =>
                                    setDeleteTarget({
                                      type: "page",
                                      id: page.id,
                                      name: page.name,
                                      childCount: page.nodeIds.length,
                                    })
                                  }
                                >
                                  <Trash2 />
                                  Delete page
                                </DropdownMenuItem>
                                {pages.length === 1 ? (
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
                    return pageMenuGroups && productCommandRuntime ? (
                      <ProductCommandContextMenu
                        key={page.id}
                        groups={pageMenuGroups}
                        runtime={productCommandRuntime}
                        onOpenChange={(open) => {
                          if (!open) {
                            requestAnimationFrame(() => {
                              globalThis.document
                                .getElementById(
                                  `page-output-selector-${page.id.replaceAll(":", "-")}`
                                )
                                ?.focus()
                            })
                          }
                        }}
                      >
                        {pageRow}
                      </ProductCommandContextMenu>
                    ) : (
                      pageRow
                    )
                  })}
                </div>
              </section>
            )
          })}

          <Button
            className="h-11 w-full min-[1280px]:h-8"
            data-command-id="output.add"
            disabled={!enabled("output.add", 1)}
            size="sm"
            variant="outline"
            onClick={() => setNewOutputOpen(true)}
          >
            <Plus data-icon="inline-start" />
            Add output
          </Button>
        </div>
      </ScrollArea>

      <Dialog
        open={Boolean(settingsPage && pageDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsPageId(null)
            setPageDraft(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Page settings</DialogTitle>
            <DialogDescription>
              Rename the page or change its canonical canvas. The update is
              saved as one undoable action.
            </DialogDescription>
          </DialogHeader>
          {settingsPage && pageDraft ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                const name = pageDraft.name.trim()
                if (!name || pageDraft.width < 1 || pageDraft.height < 1) return
                onUpdatePage(settingsPage.id, { ...pageDraft, name })
                setSettingsPageId(null)
                setPageDraft(null)
              }}
            >
              <label className="grid gap-1.5 text-xs">
                Name
                <Input
                  autoComplete="off"
                  value={pageDraft.name}
                  onChange={(event) =>
                    setPageDraft((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current
                    )
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-xs">
                  Width
                  <Input
                    inputMode="numeric"
                    min={1}
                    type="number"
                    value={pageDraft.width}
                    onChange={(event) =>
                      setPageDraft((current) =>
                        current
                          ? {
                              ...current,
                              width: numericDimension(event.target.value),
                            }
                          : current
                      )
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-xs">
                  Height
                  <Input
                    inputMode="numeric"
                    min={1}
                    type="number"
                    value={pageDraft.height}
                    onChange={(event) =>
                      setPageDraft((current) =>
                        current
                          ? {
                              ...current,
                              height: numericDimension(event.target.value),
                            }
                          : current
                      )
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs">
                Background
                <span className="flex gap-2">
                  <Input
                    aria-label="Background color"
                    className="w-12 shrink-0 p-1"
                    type="color"
                    value={pageDraft.background}
                    onChange={(event) =>
                      setPageDraft((current) =>
                        current
                          ? { ...current, background: event.target.value }
                          : current
                      )
                    }
                  />
                  <Input
                    aria-label="Background color value"
                    className="font-mono"
                    value={pageDraft.background}
                    onChange={(event) =>
                      setPageDraft((current) =>
                        current
                          ? { ...current, background: event.target.value }
                          : current
                      )
                    }
                  />
                </span>
              </label>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSettingsPageId(null)
                    setPageDraft(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  data-command-id="page.update"
                  disabled={
                    !pageDraft.name.trim() ||
                    pageDraft.width < 1 ||
                    pageDraft.height < 1
                  }
                  type="submit"
                >
                  Save page
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameOutput)}
        onOpenChange={(open) => !open && setRenameOutputId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename output</DialogTitle>
            <DialogDescription>
              This name appears in the API, export, and output picker.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!renameOutput || !outputNameDraft.trim()) return
              onUpdateOutput(renameOutput.id, outputNameDraft.trim())
              setRenameOutputId(null)
            }}
          >
            <label className="grid gap-1.5 text-xs">
              Output name
              <Input
                autoComplete="off"
                value={outputNameDraft}
                onChange={(event) => setOutputNameDraft(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOutputId(null)}
              >
                Cancel
              </Button>
              <Button
                data-command-id="output.update"
                disabled={!outputNameDraft.trim()}
                type="submit"
              >
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newOutputOpen} onOpenChange={setNewOutputOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New output</DialogTitle>
            <DialogDescription>
              Create an output with one blank page. More pages can be added
              afterward.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (
                !newOutputName.trim() ||
                newOutputWidth < 1 ||
                newOutputHeight < 1
              )
                return
              onAddOutput({
                name: newOutputName.trim(),
                width: newOutputWidth,
                height: newOutputHeight,
              })
              setNewOutputOpen(false)
              setNewOutputName("New output")
              setNewOutputWidth(1080)
              setNewOutputHeight(1080)
            }}
          >
            <label className="grid gap-1.5 text-xs">
              Output name
              <Input
                autoComplete="off"
                value={newOutputName}
                onChange={(event) => setNewOutputName(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-xs">
                Width
                <Input
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={newOutputWidth}
                  onChange={(event) =>
                    setNewOutputWidth(numericDimension(event.target.value))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                Height
                <Input
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={newOutputHeight}
                  onChange={(event) =>
                    setNewOutputHeight(numericDimension(event.target.value))
                  }
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewOutputOpen(false)}
              >
                Cancel
              </Button>
              <Button
                data-command-id="output.add"
                disabled={
                  !newOutputName.trim() ||
                  newOutputWidth < 1 ||
                  newOutputHeight < 1
                }
                type="submit"
              >
                Create output
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === "output" ? "output" : "page"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "output"
                ? `“${deleteTarget.name}” and its ${deleteTarget.childCount} page${deleteTarget.childCount === 1 ? "" : "s"} will be removed. You can undo this action from the editor history.`
                : `“${deleteTarget?.name}” and its ${deleteTarget?.childCount ?? 0} object${deleteTarget?.childCount === 1 ? "" : "s"} will be removed. You can undo this action from the editor history.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-command-id={
                deleteTarget?.type === "output"
                  ? "output.remove"
                  : "page.remove"
              }
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
                if (deleteTarget.type === "output")
                  onRemoveOutput(deleteTarget.id)
                else onRemovePage(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
