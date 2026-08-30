import { useMemo, useState } from "react"
import {
  Component as ComponentIcon,
  Crosshair,
  Plus,
  Search,
} from "lucide-react"
import {
  componentSourceSubtree,
  type ComponentDefinition,
  type Document,
  type SceneNode,
} from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import { Button } from "@webmcp/ui/components/button"
import {
  EditorPanelSectionHeader,
  EditorPanelState,
} from "@webmcp/ui/components/editor-chrome"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"

type ComponentAsset = {
  component: ComponentDefinition
  pageId: string
  pageName: string
  instanceCount: number
  previewDocument: Document | null
  previewPageId: string | null
  previewScale: number
}

function componentPreview(
  document: Document,
  component: ComponentDefinition
): Pick<ComponentAsset, "previewDocument" | "previewPageId" | "previewScale"> {
  const source = componentSourceSubtree(document, component.sourceGroupId)
  if (!source?.nodeIds.length) {
    return { previewDocument: null, previewPageId: null, previewScale: 1 }
  }
  const sourceNodeIds = new Set(source.nodeIds)
  const sourceGroup = document.groups.find(
    (group) => group.id === component.sourceGroupId
  )
  const sourcePage = sourceGroup
    ? document.pages.find((page) => page.id === sourceGroup.pageId)
    : undefined
  const nodes = document.nodes.filter((node) => sourceNodeIds.has(node.id))
  if (!nodes.length) {
    return { previewDocument: null, previewPageId: null, previewScale: 1 }
  }
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...nodes.map((node) => node.y + node.height))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const padding = Math.max(4, Math.min(width, height) * 0.06)
  const pageId = `component-preview-${component.id}`
  const previewNodes = nodes.map((node): SceneNode => ({
    ...node,
    x: node.x - left + padding,
    y: node.y - top + padding,
  }))
  const pageWidth = width + padding * 2
  const pageHeight = height + padding * 2
  return {
    previewPageId: pageId,
    previewScale: Math.min(144 / pageWidth, 84 / pageHeight),
    previewDocument: {
      ...document,
      pages: [
        {
          id: pageId,
          outputId: sourcePage?.outputId ?? "component-preview-output",
          name: component.name,
          width: pageWidth,
          height: pageHeight,
          background: sourcePage?.background ?? "#ffffff",
          nodeIds: previewNodes.map((node) => node.id),
        },
      ],
      nodes: previewNodes,
      groups: [],
      components: [],
      componentInstances: [],
      outputs: [],
      bindings: document.bindings.filter((binding) =>
        sourceNodeIds.has(binding.nodeId)
      ),
      variableBindings: document.variableBindings.filter((binding) => {
        const target = binding.target
        return (
          (target.kind === "node" || target.kind === "text_range") &&
          sourceNodeIds.has(target.nodeId)
        )
      }),
    },
  }
}

export function componentAssetItems(document: Document): ComponentAsset[] {
  const pageById = new Map(document.pages.map((page) => [page.id, page]))
  const groupById = new Map(document.groups.map((group) => [group.id, group]))
  const instanceCountByComponentId = new Map<string, number>()
  for (const instance of document.componentInstances) {
    instanceCountByComponentId.set(
      instance.componentId,
      (instanceCountByComponentId.get(instance.componentId) ?? 0) + 1
    )
  }
  return document.components
    .flatMap((component) => {
      const sourceGroup = groupById.get(component.sourceGroupId)
      const page = sourceGroup ? pageById.get(sourceGroup.pageId) : undefined
      if (!sourceGroup || !page) return []
      return [
        {
          component,
          pageId: page.id,
          pageName: page.name,
          instanceCount: instanceCountByComponentId.get(component.id) ?? 0,
          ...componentPreview(document, component),
        },
      ]
    })
    .sort(
      (left, right) =>
        left.pageName.localeCompare(right.pageName) ||
        left.component.name.localeCompare(right.component.name)
    )
}

function ComponentThumbnail({ asset }: { asset: ComponentAsset }) {
  return (
    <div className="grid h-24 place-items-center overflow-hidden rounded-[4px] border border-border/75 bg-workspace">
      {asset.previewDocument && asset.previewPageId ? (
        <div className="overflow-hidden rounded-[2px] bg-background shadow-xs">
          <Artboard
            document={asset.previewDocument}
            imageSemantics="thumbnail"
            pageId={asset.previewPageId}
            scale={asset.previewScale}
            showImageRecoveryActions={false}
          />
        </div>
      ) : (
        <ComponentIcon className="size-5 text-studio-accent" />
      )}
    </div>
  )
}

export function ComponentAssetsPanel({
  document,
  canCreateFromSelection,
  reviewPending,
  onCreateFromSelection,
  onInsert,
  onFocusSource,
}: {
  document: Document
  canCreateFromSelection: boolean
  reviewPending: boolean
  onCreateFromSelection: () => void
  onInsert: (componentId: string) => void
  onFocusSource: (componentId: string) => void
}) {
  const [query, setQuery] = useState("")
  const items = useMemo(() => componentAssetItems(document), [document])
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter(
      (item) =>
        item.component.name.toLocaleLowerCase().includes(normalized) ||
        item.component.description.toLocaleLowerCase().includes(normalized) ||
        item.pageName.toLocaleLowerCase().includes(normalized)
    )
  }, [items, query])
  const groups = useMemo(() => {
    const grouped = new Map<string, ComponentAsset[]>()
    for (const item of filteredItems) {
      const current = grouped.get(item.pageName) ?? []
      current.push(item)
      grouped.set(item.pageName, current)
    }
    return [...grouped.entries()]
  }, [filteredItems])

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Components">
      <EditorPanelSectionHeader>
        <span>Components</span>
        <span className="text-muted-foreground tabular-nums">
          {items.length}
        </span>
        <span className="ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={!canCreateFromSelection || reviewPending}
                aria-label="Create component from selection"
                onClick={onCreateFromSelection}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canCreateFromSelection
                ? "Create component from selection"
                : "Select a complete group or at least two layers"}
            </TooltipContent>
          </Tooltip>
        </span>
      </EditorPanelSectionHeader>
      <div className="border-b px-2 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            aria-label="Search components"
            placeholder="Search components…"
            className="h-8 pl-8 text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {groups.length ? (
          <div className="space-y-4 p-2">
            {groups.map(([pageName, assets]) => (
              <section key={pageName}>
                <h2 className="mb-1.5 px-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {pageName}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {assets.map((asset) => (
                    <article
                      key={asset.component.id}
                      className="group/component min-w-0 rounded-md border border-border/80 bg-background p-1.5 transition-[border-color,background-color] hover:border-foreground/20 hover:bg-muted/25"
                      data-component-asset-id={asset.component.id}
                    >
                      <button
                        type="button"
                        className="block w-full rounded-[4px] text-left outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40"
                        disabled={reviewPending}
                        aria-label={`Insert ${asset.component.name}`}
                        onClick={() => onInsert(asset.component.id)}
                      >
                        <ComponentThumbnail asset={asset} />
                        <span className="mt-1.5 block truncate text-[11px] font-medium">
                          {asset.component.name}
                        </span>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {asset.component.variants.length} variant
                          {asset.component.variants.length === 1
                            ? ""
                            : "s"} · {asset.instanceCount} instance
                          {asset.instanceCount === 1 ? "" : "s"}
                        </span>
                      </button>
                      <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-1">
                        <span className="inline-flex items-center gap-1 text-[9px] font-medium text-studio-accent">
                          <ComponentIcon className="size-3" /> Component
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              disabled={reviewPending}
                              aria-label={`Go to ${asset.component.name} source`}
                              onClick={() => onFocusSource(asset.component.id)}
                            >
                              <Crosshair />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Go to main component</TooltipContent>
                        </Tooltip>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EditorPanelState
            icon={<ComponentIcon />}
            title={query ? "No matching components" : "No components yet"}
            description={
              query
                ? "Try a different name or page."
                : "Select a complete group or at least two layers, then create a reusable component."
            }
          >
            {!query && canCreateFromSelection ? (
              <Button
                type="button"
                size="sm"
                disabled={reviewPending}
                onClick={onCreateFromSelection}
              >
                <Plus /> Create component
              </Button>
            ) : null}
          </EditorPanelState>
        )}
      </ScrollArea>
    </section>
  )
}
