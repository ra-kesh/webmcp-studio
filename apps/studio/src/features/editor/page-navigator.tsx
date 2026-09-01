import { useMemo, useRef } from "react"
import type { Document } from "@webmcp/document"
import { pageIdForNavigationKey } from "@webmcp/editor/multi-artboard"
import { buildPageContextMenu } from "@webmcp/editor/product-commands"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { Button } from "@webmcp/ui/components/button"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { cn } from "@webmcp/ui/lib/utils"
import { Plus } from "lucide-react"
import {
  createPageProductCommandTarget,
  dispatchKeyboardContextMenu,
} from "./page-output-command-context"
import { ProductCommandContextMenu } from "./product-command-menu"
import type { ProductCommandMenuRuntime } from "./product-command-menu"

export function PageNavigator({
  document,
  activePageId,
  disabled = false,
  compact = false,
  onSelectPage,
  onAddPage,
  productCommandContext,
  productCommandRuntime,
}: Readonly<{
  document: Document
  activePageId: string
  disabled?: boolean
  compact?: boolean
  onSelectPage: (pageId: string) => void
  onAddPage: (outputId: string) => void
  productCommandContext?: ProductCommandRuntimeContext
  productCommandRuntime?: ProductCommandMenuRuntime
}>) {
  const pageIds = useMemo(
    () => document.pages.map((page) => page.id),
    [document.pages]
  )
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>())
  const activePage =
    document.pages.find((page) => page.id === activePageId) ?? document.pages[0]

  const move = (key: string) => {
    const nextPageId = pageIdForNavigationKey(pageIds, activePage.id, key)
    if (!nextPageId) return false
    onSelectPage(nextPageId)
    requestAnimationFrame(() => buttonsRef.current.get(nextPageId)?.focus())
    return true
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-navigator="true">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="text-xs font-semibold">Pages</p>
          <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {document.pages.length} total
          </p>
        </div>
        <Button
          type="button"
          aria-label="Add page"
          className="size-8 [@media(pointer:coarse)]:size-11"
          data-command-id="page.add"
          disabled={disabled}
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            onAddPage(activePage.outputId)
          }}
        >
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          aria-label="Document pages"
          className="grid gap-1 px-2 pb-2"
          role="listbox"
        >
          {document.pages.map((page, index) => {
            const active = page.id === activePage.id
            const commandMenuAvailable =
              productCommandContext &&
              typeof productCommandRuntime?.run === "function" &&
              typeof productCommandRuntime.shortcut === "function"
            const commandGroups = commandMenuAvailable
              ? buildPageContextMenu(
                  productCommandContext,
                  createPageProductCommandTarget(productCommandContext, page)
                )
              : null
            const pageRow = (
              <button
                key={page.id}
                ref={(element) => {
                  if (element) buttonsRef.current.set(page.id, element)
                  else buttonsRef.current.delete(page.id)
                }}
                type="button"
                aria-label={`Center page ${index + 1}: ${page.name}`}
                aria-keyshortcuts="Shift+F10"
                aria-selected={active}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2.5 text-left outline-none hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-studio-accent/45 focus-visible:ring-inset",
                  compact ? "min-h-11" : "min-h-9",
                  active && "bg-studio-accent/10 text-studio-accent"
                )}
                data-page-command-target={page.id}
                role="option"
                tabIndex={active ? 0 : -1}
                onClick={() => onSelectPage(page.id)}
                onContextMenu={() => onSelectPage(page.id)}
                onKeyDown={(event) => {
                  if (move(event.key)) event.preventDefault()
                  if (
                    event.key === "ContextMenu" ||
                    (event.key === "F10" && event.shiftKey)
                  ) {
                    onSelectPage(page.id)
                    dispatchKeyboardContextMenu(event, event.currentTarget)
                  }
                }}
              >
                <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {page.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {page.width} × {page.height}
                </span>
              </button>
            )
            return commandGroups && productCommandRuntime ? (
              <ProductCommandContextMenu
                key={page.id}
                groups={commandGroups}
                runtime={productCommandRuntime}
              >
                {pageRow}
              </ProductCommandContextMenu>
            ) : (
              pageRow
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
