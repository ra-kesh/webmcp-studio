import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImageIcon,
  Lock,
  Square,
  Type,
  Unlock,
} from "lucide-react"
import type { Document, SceneNode } from "@webmcp/document"
import type { Selection } from "@webmcp/editor"
import { Artboard } from "@webmcp/render-view"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Separator } from "@webmcp/ui/components/separator"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"

const nodeIcon = {
  text: Type,
  rect: Square,
  image: ImageIcon,
} as const

function OutputList({
  document,
  activePageId,
  onSelectPage,
}: {
  document: Document
  activePageId: string
  onSelectPage(pageId: string): void
}) {
  return (
    <div className="flex flex-col gap-3 p-2">
      {document.outputs.map((output) => (
        <section key={output.id}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] font-medium">{output.name}</span>
            <Badge variant="ghost">{output.pageIds.length}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            {output.pageIds.map((pageId) => {
              const page = document.pages.find(
                (candidate) => candidate.id === pageId
              )
              if (!page) return null
              const scale = 52 / page.width
              return (
                <Button
                  key={page.id}
                  className="h-auto w-full justify-start gap-3 p-2"
                  variant={activePageId === page.id ? "secondary" : "ghost"}
                  onClick={() => onSelectPage(page.id)}
                >
                  <Artboard
                    className="shrink-0 overflow-hidden rounded-[3px] border bg-white shadow-sm"
                    document={document}
                    pageId={page.id}
                    scale={scale}
                  />
                  <span className="min-w-0 truncate text-xs">{page.name}</span>
                </Button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function LayerRow({
  node,
  selected,
  onSelect,
  onUpdate,
}: {
  node: SceneNode
  selected: boolean
  onSelect(additive: boolean): void
  onUpdate(patch: Partial<SceneNode>): void
}) {
  const Icon = nodeIcon[node.type]
  return (
    <div
      className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-muted data-[selected=true]:bg-secondary"
      data-selected={selected}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        onClick={(event) =>
          onSelect(event.metaKey || event.ctrlKey || event.shiftKey)
        }
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      <span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
        <Button
          aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          size="icon-xs"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onUpdate({ visible: !node.visible })
          }}
        >
          {node.visible ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          size="icon-xs"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onUpdate({ locked: !node.locked })
          }}
        >
          {node.locked ? <Lock /> : <Unlock />}
        </Button>
      </span>
      {!node.visible || node.locked ? (
        <span className="flex items-center text-muted-foreground group-hover:hidden">
          {!node.visible ? <EyeOff className="size-3" /> : null}
          {node.locked ? <Lock className="size-3" /> : null}
        </span>
      ) : null}
    </div>
  )
}

export function DocumentSidebar({
  document,
  activePageId,
  selection,
  onSelectPage,
  onSelectNode,
  onUpdateNode,
  onReorderNode,
  className,
}: {
  document: Document
  activePageId: string
  selection: Selection | null
  onSelectPage(pageId: string): void
  onSelectNode(nodeId: string, additive: boolean): void
  onUpdateNode(nodeId: string, patch: Partial<SceneNode>): void
  onReorderNode(nodeId: string, direction: "forward" | "backward"): void
  className?: string
}) {
  const page = document.pages.find((candidate) => candidate.id === activePageId)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const layers = (page?.nodeIds ?? [])
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is SceneNode => Boolean(node))
    .reverse()
  const selectedNodeId = selection?.nodeIds.at(-1)

  return (
    <aside
      className={cn("flex min-h-0 flex-col border-r bg-background", className)}
    >
      <Tabs defaultValue="outputs" className="min-h-0 flex-1 gap-0">
        <div className="flex h-11 items-center px-3">
          <TabsList variant="line" className="h-8 w-full justify-start">
            <TabsTrigger value="outputs" className="flex-none px-2.5 text-xs">
              Outputs
            </TabsTrigger>
            <TabsTrigger value="layers" className="flex-none px-2.5 text-xs">
              Layers
            </TabsTrigger>
          </TabsList>
        </div>
        <Separator />
        <TabsContent value="outputs" className="min-h-0">
          <ScrollArea className="h-full">
            <OutputList
              document={document}
              activePageId={activePageId}
              onSelectPage={onSelectPage}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="layers" className="min-h-0">
          <div className="flex h-9 items-center border-b px-3">
            <span className="text-[11px] text-muted-foreground">
              {layers.length} objects
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                aria-label="Move layer forward"
                disabled={!selectedNodeId}
                size="icon-xs"
                variant="ghost"
                onClick={() =>
                  selectedNodeId && onReorderNode(selectedNodeId, "forward")
                }
              >
                <ChevronUp />
              </Button>
              <Button
                aria-label="Move layer backward"
                disabled={!selectedNodeId}
                size="icon-xs"
                variant="ghost"
                onClick={() =>
                  selectedNodeId && onReorderNode(selectedNodeId, "backward")
                }
              >
                <ChevronDown />
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-2.25rem)]">
            <div className="flex flex-col gap-0.5 p-2">
              {layers.map((node) => (
                <LayerRow
                  key={node.id}
                  node={node}
                  selected={selection?.nodeIds.includes(node.id) ?? false}
                  onSelect={(additive) => onSelectNode(node.id, additive)}
                  onUpdate={(patch) => onUpdateNode(node.id, patch)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
