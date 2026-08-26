import { useEffect, useState } from "react"
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  ImageIcon,
  Lock,
  Minus,
  Plus,
  Settings2,
  Shapes,
  Square,
  Type,
  Trash2,
  Unlock,
} from "lucide-react"
import {
  getGroupNodeIds,
  type Document,
  type GroupDefinition,
  type SceneNode,
} from "@webmcp/document"
import type { Selection } from "@webmcp/editor"
import { Artboard } from "@webmcp/render-view"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { EditorPanelTabsList } from "@webmcp/ui/components/editor-chrome"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"

const nodeIcon = {
  text: Type,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  icon: Shapes,
  image: ImageIcon,
} as const

type LayerTreeEntry =
  { type: "node"; node: SceneNode } | { type: "group"; group: GroupDefinition }

function entryLayerIndex(
  entry: LayerTreeEntry,
  document: Document,
  layerIndex: Map<string, number>
) {
  return entry.type === "node"
    ? (layerIndex.get(entry.node.id) ?? -1)
    : Math.max(
        ...getGroupNodeIds(document, entry.group.id).map(
          (nodeId) => layerIndex.get(nodeId) ?? -1
        )
      )
}

function EditableLabel({
  value,
  ariaLabel,
  className,
  onCommit,
}: {
  value: string
  ariaLabel: string
  className?: string
  onCommit(value: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (!editing) {
    return (
      <span
        className={className}
        title="Double-click to rename"
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setEditing(true)
        }}
      >
        {value}
      </span>
    )
  }
  return (
    <Input
      aria-label={ariaLabel}
      autoFocus
      className="h-7 min-w-0 flex-1 px-2 text-xs"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== value) onCommit(draft.trim())
        else setDraft(value)
        setEditing(false)
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(value)
          setEditing(false)
        }
      }}
    />
  )
}

function OutputList({
  document,
  activePageId,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onUpdatePage,
  onRemovePage,
  onReorderPage,
  onAddOutput,
  onUpdateOutput,
  onRemoveOutput,
}: {
  document: Document
  activePageId: string
  onSelectPage(pageId: string): void
  onAddPage(outputId: string): void
  onDuplicatePage(pageId: string): void
  onUpdatePage(
    pageId: string,
    patch: {
      name?: string
      width?: number
      height?: number
      background?: string
    }
  ): void
  onRemovePage(pageId: string): void
  onReorderPage(outputId: string, pageId: string, toIndex: number): void
  onAddOutput(options: { name: string; width: number; height: number }): void
  onUpdateOutput(outputId: string, name: string): void
  onRemoveOutput(outputId: string): void
}) {
  const [settingsPageId, setSettingsPageId] = useState<string | null>(null)
  const [newOutputOpen, setNewOutputOpen] = useState(false)
  const [newOutputName, setNewOutputName] = useState("New output")
  const [newOutputWidth, setNewOutputWidth] = useState(1080)
  const [newOutputHeight, setNewOutputHeight] = useState(1080)
  const settingsPage = document.pages.find((page) => page.id === settingsPageId)

  return (
    <div className="flex flex-col gap-3 p-2 pb-4">
      {document.outputs.map((output) => (
        <section key={output.id}>
          <div className="group flex items-center gap-1 px-2 py-1.5">
            <EditableLabel
              ariaLabel={`Rename ${output.name}`}
              className="min-w-0 flex-1 truncate text-[11px] font-medium"
              value={output.name}
              onCommit={(name) => onUpdateOutput(output.id, name)}
            />
            <Badge variant="ghost">{output.pageIds.length}</Badge>
            <Button
              aria-label={`Add page to ${output.name}`}
              size="icon-xs"
              variant="ghost"
              onClick={() => onAddPage(output.id)}
            >
              <Plus />
            </Button>
            <Button
              aria-label={`Delete ${output.name}`}
              disabled={document.outputs.length <= 1}
              size="icon-xs"
              variant="ghost"
              onClick={() => onRemoveOutput(output.id)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {output.pageIds.map((pageId, pageIndex) => {
              const page = document.pages.find(
                (candidate) => candidate.id === pageId
              )
              if (!page) return null
              const scale = 52 / page.width
              return (
                <div
                  key={page.id}
                  className="group/page flex items-center rounded-lg data-[active=true]:bg-secondary"
                  data-active={activePageId === page.id}
                >
                  <button
                    type="button"
                    className="shrink-0 p-2 pr-1"
                    onClick={() => onSelectPage(page.id)}
                  >
                    <Artboard
                      className="shrink-0 overflow-hidden rounded-[3px] border bg-white shadow-sm"
                      document={document}
                      pageId={page.id}
                      scale={scale}
                    />
                  </button>
                  <div
                    className="flex min-w-0 flex-1 items-center self-stretch px-2"
                    onClick={() => onSelectPage(page.id)}
                  >
                    <EditableLabel
                      ariaLabel={`Rename ${page.name}`}
                      className="min-w-0 flex-1 truncate text-xs"
                      value={page.name}
                      onCommit={(name) => onUpdatePage(page.id, { name })}
                    />
                  </div>
                  <div className="mr-1 hidden items-center group-focus-within/page:flex group-hover/page:flex">
                    <Button
                      aria-label={`Move ${page.name} up`}
                      disabled={pageIndex === 0}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        onReorderPage(output.id, page.id, pageIndex - 1)
                      }
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      aria-label={`Move ${page.name} down`}
                      disabled={pageIndex === output.pageIds.length - 1}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        onReorderPage(output.id, page.id, pageIndex + 1)
                      }
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      aria-label={`Duplicate ${page.name}`}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onDuplicatePage(page.id)}
                    >
                      <Copy />
                    </Button>
                    <Button
                      aria-label={`Edit ${page.name} settings`}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setSettingsPageId(page.id)}
                    >
                      <Settings2 />
                    </Button>
                    <Button
                      aria-label={`Delete ${page.name}`}
                      disabled={output.pageIds.length <= 1}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onRemovePage(page.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setNewOutputOpen(true)}
      >
        <Plus data-icon="inline-start" />
        Add output
      </Button>

      <Dialog
        open={Boolean(settingsPage)}
        onOpenChange={(open) => !open && setSettingsPageId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Page settings</DialogTitle>
            <DialogDescription>
              Rename the page or change its canonical canvas dimensions.
            </DialogDescription>
          </DialogHeader>
          {settingsPage ? (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs">
                Name
                <Input
                  value={settingsPage.name}
                  onChange={(event) =>
                    onUpdatePage(settingsPage.id, { name: event.target.value })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1.5 text-xs">
                  Width
                  <Input
                    type="number"
                    min={1}
                    value={settingsPage.width}
                    onChange={(event) =>
                      onUpdatePage(settingsPage.id, {
                        width: Math.max(1, Number(event.target.value)),
                      })
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-xs">
                  Height
                  <Input
                    type="number"
                    min={1}
                    value={settingsPage.height}
                    onChange={(event) =>
                      onUpdatePage(settingsPage.id, {
                        height: Math.max(1, Number(event.target.value)),
                      })
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs">
                Background
                <Input
                  type="color"
                  className="p-1"
                  value={settingsPage.background}
                  onChange={(event) =>
                    onUpdatePage(settingsPage.id, {
                      background: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          ) : null}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <Dialog open={newOutputOpen} onOpenChange={setNewOutputOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New output</DialogTitle>
            <DialogDescription>
              Add a named output with its own page dimensions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs">
              Output name
              <Input
                value={newOutputName}
                onChange={(event) => setNewOutputName(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs">
                Width
                <Input
                  type="number"
                  min={1}
                  value={newOutputWidth}
                  onChange={(event) =>
                    setNewOutputWidth(Number(event.target.value))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                Height
                <Input
                  type="number"
                  min={1}
                  value={newOutputHeight}
                  onChange={(event) =>
                    setNewOutputHeight(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOutputOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !newOutputName.trim() ||
                newOutputWidth < 1 ||
                newOutputHeight < 1
              }
              onClick={() => {
                onAddOutput({
                  name: newOutputName,
                  width: newOutputWidth,
                  height: newOutputHeight,
                })
                setNewOutputOpen(false)
              }}
            >
              Create output
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LayerRow({
  node,
  selected,
  onSelect,
  onUpdate,
  depth = 0,
}: {
  node: SceneNode
  selected: boolean
  onSelect(additive: boolean): void
  onUpdate(patch: Partial<SceneNode>): void
  depth?: number
}) {
  const Icon = nodeIcon[node.type]
  return (
    <div
      className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-muted data-[selected=true]:bg-secondary"
      data-selected={selected}
      style={{ paddingLeft: 8 + depth * 18 }}
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

function GroupName({
  group,
  onCommit,
}: {
  group: GroupDefinition
  onCommit(name: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  useEffect(() => setDraft(group.name), [group.name])
  if (!editing) {
    return (
      <span
        className="min-w-0 flex-1 truncate"
        onDoubleClick={(event) => {
          event.stopPropagation()
          setEditing(true)
        }}
      >
        {group.name}
      </span>
    )
  }
  return (
    <input
      aria-label={`Rename ${group.name}`}
      autoFocus
      className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== group.name) onCommit(draft)
        else setDraft(group.name)
        setEditing(false)
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(group.name)
          setEditing(false)
        }
      }}
    />
  )
}

function GroupRow({
  document,
  group,
  depth,
  selection,
  nodesById,
  layerIndex,
  onSelectNode,
  onSelectGroup,
  onUpdateNode,
  onUpdateGroup,
  onUpdateGroupNodes,
}: {
  document: Document
  group: GroupDefinition
  depth: number
  selection: Selection | null
  nodesById: Map<string, SceneNode>
  layerIndex: Map<string, number>
  onSelectNode(nodeId: string, additive: boolean): void
  onSelectGroup(groupId: string, additive: boolean): void
  onUpdateNode(nodeId: string, patch: Partial<SceneNode>): void
  onUpdateGroup(groupId: string, name: string): void
  onUpdateGroupNodes(groupId: string, patch: Partial<SceneNode>): void
}) {
  const [expanded, setExpanded] = useState(true)
  const memberIds = getGroupNodeIds(document, group.id)
  const members = memberIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId)
    return node ? [node] : []
  })
  const selected =
    memberIds.length > 0 &&
    memberIds.every((nodeId) => selection?.nodeIds.includes(nodeId))
  const visible = members.every((node) => node.visible)
  const locked = members.every((node) => node.locked)
  const childGroups = document.groups.filter(
    (candidate) => candidate.parentGroupId === group.id
  )
  const entries: LayerTreeEntry[] = [
    ...childGroups.map((child) => ({ type: "group" as const, group: child })),
    ...group.nodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId)
      return node ? [{ type: "node" as const, node }] : []
    }),
  ].sort(
    (first, second) =>
      entryLayerIndex(second, document, layerIndex) -
      entryLayerIndex(first, document, layerIndex)
  )

  return (
    <div>
      <div
        className="group flex h-9 w-full items-center gap-1 rounded-lg pr-2 text-left text-xs transition-colors hover:bg-muted data-[selected=true]:bg-secondary"
        data-selected={selected}
        style={{ paddingLeft: 4 + depth * 18 }}
      >
        <Button
          aria-label={
            expanded ? `Collapse ${group.name}` : `Expand ${group.name}`
          }
          size="icon-xs"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </Button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
          onClick={(event) =>
            onSelectGroup(
              group.id,
              event.metaKey || event.ctrlKey || event.shiftKey
            )
          }
        >
          {expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <GroupName
            group={group}
            onCommit={(name) => onUpdateGroup(group.id, name)}
          />
        </button>
        <span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
          <Button
            aria-label={visible ? `Hide ${group.name}` : `Show ${group.name}`}
            size="icon-xs"
            variant="ghost"
            onClick={() => onUpdateGroupNodes(group.id, { visible: !visible })}
          >
            {visible ? <Eye /> : <EyeOff />}
          </Button>
          <Button
            aria-label={locked ? `Unlock ${group.name}` : `Lock ${group.name}`}
            size="icon-xs"
            variant="ghost"
            onClick={() => onUpdateGroupNodes(group.id, { locked: !locked })}
          >
            {locked ? <Lock /> : <Unlock />}
          </Button>
        </span>
      </div>
      {expanded ? (
        <div>
          {entries.map((entry) =>
            entry.type === "group" ? (
              <GroupRow
                key={entry.group.id}
                document={document}
                group={entry.group}
                depth={depth + 1}
                selection={selection}
                nodesById={nodesById}
                layerIndex={layerIndex}
                onSelectNode={onSelectNode}
                onSelectGroup={onSelectGroup}
                onUpdateNode={onUpdateNode}
                onUpdateGroup={onUpdateGroup}
                onUpdateGroupNodes={onUpdateGroupNodes}
              />
            ) : (
              <LayerRow
                key={entry.node.id}
                node={entry.node}
                depth={depth + 1}
                selected={selection?.nodeIds.includes(entry.node.id) ?? false}
                onSelect={(additive) => onSelectNode(entry.node.id, additive)}
                onUpdate={(patch) => onUpdateNode(entry.node.id, patch)}
              />
            )
          )}
        </div>
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
  onSelectGroup,
  onUpdateNode,
  onUpdateGroup,
  onUpdateGroupNodes,
  onReorderNode,
  onAddPage,
  onDuplicatePage,
  onUpdatePage,
  onRemovePage,
  onReorderPage,
  onAddOutput,
  onUpdateOutput,
  onRemoveOutput,
  className,
}: {
  document: Document
  activePageId: string
  selection: Selection | null
  onSelectPage(pageId: string): void
  onSelectNode(nodeId: string, additive: boolean): void
  onSelectGroup(groupId: string, additive: boolean): void
  onUpdateNode(nodeId: string, patch: Partial<SceneNode>): void
  onUpdateGroup(groupId: string, name: string): void
  onUpdateGroupNodes(groupId: string, patch: Partial<SceneNode>): void
  onReorderNode(nodeId: string, direction: "forward" | "backward"): void
  onAddPage(outputId: string): void
  onDuplicatePage(pageId: string): void
  onUpdatePage(
    pageId: string,
    patch: {
      name?: string
      width?: number
      height?: number
      background?: string
    }
  ): void
  onRemovePage(pageId: string): void
  onReorderPage(outputId: string, pageId: string, toIndex: number): void
  onAddOutput(options: { name: string; width: number; height: number }): void
  onUpdateOutput(outputId: string, name: string): void
  onRemoveOutput(outputId: string): void
  className?: string
}) {
  const page = document.pages.find((candidate) => candidate.id === activePageId)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const layerIndex = new Map(
    (page?.nodeIds ?? []).map((nodeId, index) => [nodeId, index])
  )
  const pageGroups = document.groups.filter(
    (group) => group.pageId === activePageId
  )
  const directlyGroupedNodeIds = new Set(
    pageGroups.flatMap((group) => group.nodeIds)
  )
  const rootEntries: LayerTreeEntry[] = [
    ...pageGroups
      .filter((group) => !group.parentGroupId)
      .map((group) => ({ type: "group" as const, group })),
    ...(page?.nodeIds ?? []).flatMap((nodeId) => {
      if (directlyGroupedNodeIds.has(nodeId)) return []
      const node = nodesById.get(nodeId)
      return node ? [{ type: "node" as const, node }] : []
    }),
  ].sort(
    (first, second) =>
      entryLayerIndex(second, document, layerIndex) -
      entryLayerIndex(first, document, layerIndex)
  )
  const selectedNodeId = selection?.nodeIds.at(-1)

  return (
    <aside
      className={cn("flex min-h-0 flex-col border-r bg-background", className)}
    >
      <Tabs defaultValue="outputs" className="min-h-0 flex-1 gap-0">
        <EditorPanelTabsList aria-label="Document panels">
          <TabsTrigger value="outputs" className="flex-none px-2.5 text-xs">
            Outputs
          </TabsTrigger>
          <TabsTrigger value="layers" className="flex-none px-2.5 text-xs">
            Layers
          </TabsTrigger>
        </EditorPanelTabsList>
        <TabsContent value="outputs" className="min-h-0">
          <ScrollArea className="h-full">
            <OutputList
              document={document}
              activePageId={activePageId}
              onSelectPage={onSelectPage}
              onAddPage={onAddPage}
              onDuplicatePage={onDuplicatePage}
              onUpdatePage={onUpdatePage}
              onRemovePage={onRemovePage}
              onReorderPage={onReorderPage}
              onAddOutput={onAddOutput}
              onUpdateOutput={onUpdateOutput}
              onRemoveOutput={onRemoveOutput}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="layers" className="min-h-0">
          <div className="flex h-9 items-center border-b px-3">
            <span className="text-[11px] text-muted-foreground">
              {page?.nodeIds.length ?? 0} objects
              {pageGroups.length ? ` · ${pageGroups.length} groups` : ""}
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
              {rootEntries.map((entry) =>
                entry.type === "group" ? (
                  <GroupRow
                    key={entry.group.id}
                    document={document}
                    group={entry.group}
                    depth={0}
                    selection={selection}
                    nodesById={nodesById}
                    layerIndex={layerIndex}
                    onSelectNode={onSelectNode}
                    onSelectGroup={onSelectGroup}
                    onUpdateNode={onUpdateNode}
                    onUpdateGroup={onUpdateGroup}
                    onUpdateGroupNodes={onUpdateGroupNodes}
                  />
                ) : (
                  <LayerRow
                    key={entry.node.id}
                    node={entry.node}
                    selected={
                      selection?.nodeIds.includes(entry.node.id) ?? false
                    }
                    onSelect={(additive) =>
                      onSelectNode(entry.node.id, additive)
                    }
                    onUpdate={(patch) => onUpdateNode(entry.node.id, patch)}
                  />
                )
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
