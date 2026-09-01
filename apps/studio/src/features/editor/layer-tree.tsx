// @refresh reset

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ChevronRight,
  Circle,
  Component as ComponentIcon,
  Diamond,
  Eye,
  EyeOff,
  Folder,
  GripVertical,
  ImageIcon,
  Lock,
  Minus,
  Search,
  Shapes,
  Square,
  Type,
  Unlock,
  X,
} from "lucide-react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter"
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item"
import type {
  Instruction,
  ItemMode,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item"
import type { Document, SceneNode } from "@webmcp/document"
import {
  buildLayerTreeModel,
  layerKey,
  layerSelectionForTarget,
  layerSelectionState,
  visibleLayerRows,
} from "@webmcp/editor/layer-tree"
import type {
  LayerDropIntent,
  LayerTreeItem,
  LayerTreeRow,
} from "@webmcp/editor/layer-tree"
import type { Selection } from "@webmcp/editor"
import { buildLayerContextMenu } from "@webmcp/editor/product-commands"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { Button } from "@webmcp/ui/components/button"
import { Badge } from "@webmcp/ui/components/badge"
import { EditorPanelState } from "@webmcp/ui/components/editor-chrome"
import { Input } from "@webmcp/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"
import { ProductCommandContextMenu } from "./product-command-menu"
import type { ProductCommandMenuRuntime } from "./product-command-menu"
import {
  createLayerProductCommandContext,
  createLayerProductCommandTarget,
  layerContextSelectionNodeIds,
} from "./layer-context-menu"

const DESKTOP_ROW_HEIGHT = 28
const COMPACT_ROW_HEIGHT = 44
const INDENT = 14

const nodeIcon = {
  text: Type,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  icon: Shapes,
  image: ImageIcon,
  group: Folder,
} as const

type RenameState = {
  key: string
  original: string
  draft: string
}

type DropState = {
  targetKey: string
  intent: LayerDropIntent
} | null

type LayerTreeProps = {
  document: Document
  activePageId: string
  selection: Selection | null
  reviewPending: boolean
  onSelectionChange: (nodeIds: string[]) => void
  onFocusNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
  onRenameNode: (nodeId: string, name: string) => void
  onRenameGroup: (groupId: string, name: string) => void
  onUpdateNodes: (nodeIds: string[], patch: Partial<SceneNode>) => void
  onMoveLayer: (
    source: LayerTreeItem,
    target: LayerTreeItem,
    intent: LayerDropIntent
  ) => boolean
  onDeleteNodes: (nodeIds: string[]) => boolean
  productCommandContext?: ProductCommandRuntimeContext
  productCommandRuntime?: ProductCommandMenuRuntime
  compact?: boolean
  integrated?: boolean
}

function instructionIntent(
  instruction: Instruction | null
): LayerDropIntent | null {
  switch (instruction?.type) {
    case "reorder-above":
      return "above"
    case "reorder-below":
      return "below"
    case "make-child":
      return "inside"
    default:
      return null
  }
}

function useLayerRowDrag({
  row,
  rowElement,
  dragHandle,
  disabled,
  setDraggingKey,
  setDropState,
}: {
  row: LayerTreeRow
  rowElement: HTMLDivElement | null
  dragHandle: HTMLButtonElement | null
  disabled: boolean
  setDraggingKey: (key: string | null) => void
  setDropState: (state: DropState) => void
}) {
  useEffect(() => {
    if (!rowElement || !dragHandle || disabled) return
    const mode: ItemMode = row.item.children.length ? "expanded" : "standard"
    const cleanupDrag = draggable({
      element: rowElement,
      dragHandle,
      getInitialData: () => ({ layerKey: row.item.key }),
      onDragStart: () => setDraggingKey(row.item.key),
      onDrop: () => setDraggingKey(null),
    })
    const cleanupTarget = dropTargetForElements({
      element: rowElement,
      canDrop: ({ source }) => source.data.layerKey !== row.item.key,
      getData: ({ input, element }) =>
        attachInstruction(
          { layerKey: row.item.key },
          {
            input,
            element,
            currentLevel: row.depth,
            indentPerLevel: INDENT,
            mode,
            block:
              row.item.kind === "group"
                ? ["reparent"]
                : ["make-child", "reparent"],
          }
        ),
      onDrag: ({ self }) => {
        const instruction = extractInstruction(self.data)
        const intent = instructionIntent(instruction)
        setDropState(intent ? { targetKey: row.item.key, intent } : null)
      },
      onDragLeave: () => setDropState(null),
      onDrop: () => setDropState(null),
      getIsSticky: () => true,
    })
    return () => {
      cleanupDrag()
      cleanupTarget()
    }
  }, [disabled, dragHandle, row, rowElement, setDraggingKey, setDropState])
}

function LayerRow({
  row,
  active,
  selectedState,
  expanded,
  dragging,
  dropState,
  reviewPending,
  filtering,
  ownedChildIds,
  rename,
  onActivate,
  onSelect,
  onToggleExpanded,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onFocusNode,
  onHoverNode,
  onToggleVisibility,
  onToggleLock,
  onRequestContextMenu,
  setDraggingKey,
  setDropState,
  compact,
}: {
  row: LayerTreeRow
  active: boolean
  selectedState: "none" | "partial" | "all"
  expanded: boolean
  dragging: boolean
  dropState: DropState
  reviewPending: boolean
  filtering: boolean
  ownedChildIds: string[]
  rename: RenameState | null
  onActivate: (key: string) => void
  onSelect: (event: React.MouseEvent, key: string) => void
  onToggleExpanded: (key: string) => void
  onStartRename: (item: LayerTreeItem) => void
  onRenameDraftChange: (value: string) => void
  onCommitRename: (restoreFocus?: boolean) => void
  onCancelRename: () => void
  onFocusNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
  onToggleVisibility: (item: LayerTreeItem) => void
  onToggleLock: (item: LayerTreeItem) => void
  onRequestContextMenu: (item: LayerTreeItem) => void
  setDraggingKey: (key: string | null) => void
  setDropState: (state: DropState) => void
  compact: boolean
}) {
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null)
  const [dragHandle, setDragHandle] = useState<HTMLButtonElement | null>(null)
  const componentRole = row.item.component?.role
  const Icon =
    componentRole === "source"
      ? ComponentIcon
      : componentRole === "instance"
        ? Diamond
        : nodeIcon[row.item.nodeType]
  const overrideCount = new Set([
    ...(row.item.component?.overrideProperties ?? []),
    ...(row.item.component?.removedProperties ?? []),
  ]).size
  const componentDescription =
    componentRole === "source"
      ? "main component"
      : componentRole === "instance"
        ? "component instance"
        : componentRole === "source-child"
          ? "main component layer"
          : componentRole === "instance-child"
            ? "component instance layer"
            : null
  const maskDescription =
    row.item.mask?.role === "group"
      ? `${row.item.mask.type} mask group`
      : row.item.mask?.role === "source"
        ? `${row.item.mask.type} mask source for ${row.item.mask.groupName}`
        : row.item.mask?.role === "content"
          ? `masked content in ${row.item.mask.groupName}`
          : null
  const isRename = rename?.key === row.item.key
  const isDropTarget = dropState?.targetKey === row.item.key

  useLayerRowDrag({
    row,
    rowElement,
    dragHandle,
    disabled: reviewPending || isRename,
    setDraggingKey,
    setDropState,
  })

  return (
    <div
      ref={(element) => {
        setRowElement(element)
      }}
      id={`layer-tree-item-${row.item.key.replaceAll(":", "-")}`}
      role="treeitem"
      aria-label={[row.item.name, componentDescription, maskDescription]
        .filter(Boolean)
        .join(", ")}
      aria-expanded={row.item.children.length ? expanded : undefined}
      aria-level={row.depth}
      aria-posinset={row.positionInSet}
      aria-selected={selectedState === "all"}
      aria-setsize={row.setSize}
      aria-keyshortcuts="F2 Delete H L Shift+F10 Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
      data-layer-key={row.item.key}
      data-layer-kind={row.item.kind}
      data-component-role={componentRole}
      data-component-id={row.item.component?.componentId}
      data-component-overridden={overrideCount ? "true" : undefined}
      data-mask-role={row.item.mask?.role}
      data-mask-group-id={row.item.mask?.groupId}
      data-mask-type={row.item.mask?.type}
      data-selected={selectedState === "all" ? "true" : undefined}
      data-selection-mixed={selectedState === "partial" ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-hidden={!row.item.visible ? "true" : undefined}
      data-locked={row.item.locked ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-drop-intent={isDropTarget ? dropState.intent : undefined}
      tabIndex={-1}
      className={cn(
        "group/layer relative flex w-full cursor-default items-center overflow-hidden rounded-sm pr-1 text-[11px] outline-none select-none",
        compact ? "h-(--studio-compact-target)" : "h-(--studio-row-height)",
        "hover:bg-editor-panel-hover focus-visible:ring-2 focus-visible:ring-studio-accent/45 focus-visible:ring-inset data-[active=true]:ring-1 data-[active=true]:ring-border data-[active=true]:ring-inset",
        "data-[selected=true]:bg-studio-accent/10 data-[selected=true]:text-foreground",
        "data-[selection-mixed=true]:bg-editor-field",
        "data-[dragging=true]:opacity-30 data-[hidden=true]:opacity-50",
        "data-[drop-intent=inside]:bg-studio-accent/12 data-[drop-intent=inside]:ring-1 data-[drop-intent=inside]:ring-studio-accent",
        "after:pointer-events-none after:absolute after:right-1 after:left-[var(--drop-left)] after:z-10 after:hidden after:h-0.5 after:rounded-full after:bg-studio-accent data-[drop-intent=above]:after:top-0 data-[drop-intent=above]:after:block data-[drop-intent=below]:after:bottom-0 data-[drop-intent=below]:after:block"
      )}
      style={
        {
          paddingLeft: `${Math.max(4, (row.depth - 1) * INDENT + 4)}px`,
          "--drop-left": `${Math.max(4, (row.depth - 1) * INDENT + 4)}px`,
        } as React.CSSProperties
      }
      onClick={(event) => onSelect(event, row.item.key)}
      onDoubleClick={() => onFocusNode(row.item.nodeIds[0] ?? row.item.id)}
      onFocus={() => onActivate(row.item.key)}
      onPointerEnter={() => onHoverNode(row.item.nodeIds[0] ?? null)}
      onPointerLeave={() => onHoverNode(null)}
      onContextMenu={() => onRequestContextMenu(row.item)}
    >
      {row.item.children.length ? (
        <button
          type="button"
          aria-label={
            filtering
              ? `${row.item.name} expanded by search`
              : `${expanded ? "Collapse" : "Expand"} ${row.item.name}`
          }
          disabled={filtering}
          tabIndex={-1}
          className={cn(
            "grid shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
            compact ? "size-11" : "size-6"
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded(row.item.key)
          }}
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform duration-100 motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
          />
        </button>
      ) : (
        <span
          className={cn("shrink-0", compact ? "size-11" : "size-6")}
          aria-hidden="true"
        />
      )}

      <Icon
        className={cn(
          "mr-1 size-3.5 shrink-0 text-muted-foreground",
          selectedState === "all" && "text-studio-accent",
          componentRole && "text-studio-accent",
          componentRole === "source" && "fill-studio-accent/15"
        )}
      />

      {isRename ? (
        <Input
          autoFocus
          data-testid="layer-rename-input"
          aria-label={`Rename ${rename.original}`}
          value={rename.draft}
          className="h-6 min-w-0 flex-1 rounded-[4px] border-studio-accent bg-background px-1.5 text-[11px] ring-2 ring-studio-accent/20"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onBlur={() => onCommitRename(false)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "Enter") {
              event.preventDefault()
              onCommitRename(true)
            } else if (event.key === "Escape") {
              event.preventDefault()
              onCancelRename()
            }
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate py-1 leading-5"
          title={row.item.name}
          onDoubleClick={(event) => {
            event.stopPropagation()
            if (!reviewPending) onStartRename(row.item)
          }}
        >
          {row.item.name}
        </span>
      )}

      {overrideCount ? (
        <span
          className="mr-1 size-1.5 shrink-0 rounded-full bg-studio-accent"
          title={`${overrideCount} component override${overrideCount === 1 ? "" : "s"}`}
          aria-label={`${overrideCount} component override${overrideCount === 1 ? "" : "s"}`}
        />
      ) : null}

      {row.item.mask?.role === "group" ? (
        <Badge
          variant="secondary"
          className="mr-1 h-5 shrink-0 px-1.5 text-[11px] font-medium"
          aria-label={`${row.item.mask.type} mask`}
        >
          Mask
        </Badge>
      ) : row.item.mask?.role === "source" ? (
        <Badge
          variant="outline"
          className="mr-1 h-5 shrink-0 px-1.5 text-[11px] font-medium"
          aria-label={`Mask source for ${row.item.mask.groupName}`}
        >
          Mask source
        </Badge>
      ) : null}

      {!isRename ? (
        <div className="ml-1 flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                tabIndex={-1}
                disabled={reviewPending}
                aria-label={`${row.item.locked ? "Unlock" : "Lock"} ${row.item.name}`}
                className={cn(
                  "rounded-[4px] text-muted-foreground transition-opacity hover:text-foreground",
                  !row.item.locked &&
                    !row.item.lockMixed &&
                    "opacity-0 group-focus-within/layer:opacity-100 group-hover/layer:opacity-100",
                  compact ? "size-11" : "size-6"
                )}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleLock(row.item)
                }}
              >
                {row.item.locked ? (
                  <Lock className="size-3" />
                ) : row.item.lockMixed ? (
                  <Unlock className="size-3 text-amber-600" />
                ) : (
                  <Unlock className="size-3 opacity-45" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {row.item.locked ? "Unlock" : "Lock"} · L
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                tabIndex={-1}
                disabled={reviewPending}
                aria-label={`${row.item.visible ? "Hide" : "Show"} ${row.item.name}`}
                className={cn(
                  "rounded-[4px] text-muted-foreground transition-opacity hover:text-foreground",
                  row.item.visible &&
                    !row.item.visibilityMixed &&
                    "opacity-0 group-focus-within/layer:opacity-100 group-hover/layer:opacity-100",
                  compact ? "size-11" : "size-6"
                )}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleVisibility(row.item)
                }}
              >
                {row.item.visible && !row.item.visibilityMixed ? (
                  <Eye className="size-3 opacity-45" />
                ) : row.item.visibilityMixed ? (
                  <Eye className="size-3 text-amber-600" />
                ) : (
                  <EyeOff className="size-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {row.item.visible ? "Hide" : "Show"} · H
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={setDragHandle}
                type="button"
                size="icon-xs"
                variant="ghost"
                tabIndex={-1}
                disabled={reviewPending}
                aria-label={`Drag ${row.item.name}`}
                className={cn(
                  "cursor-grab rounded-[4px] text-muted-foreground opacity-0 transition-opacity group-focus-within/layer:opacity-100 group-hover/layer:opacity-100 active:cursor-grabbing",
                  compact ? "size-11" : "size-6"
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <GripVertical className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Drag to reorder or group</TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {row.item.children.length ? (
        <div
          id={`layer-tree-group-${row.item.key.replaceAll(":", "-")}`}
          role="group"
          aria-owns={ownedChildIds.join(" ") || undefined}
          className="sr-only"
        />
      ) : null}
    </div>
  )
}

export function LayerTree({
  document,
  activePageId,
  selection,
  reviewPending,
  onSelectionChange,
  onFocusNode,
  onHoverNode,
  onRenameNode,
  onRenameGroup,
  onUpdateNodes,
  onMoveLayer,
  onDeleteNodes,
  productCommandContext,
  productCommandRuntime,
  compact = false,
  integrated = false,
}: LayerTreeProps) {
  const rowHeight = compact ? COMPACT_ROW_HEIGHT : DESKTOP_ROW_HEIGHT
  const model = useMemo(
    () => buildLayerTreeModel(document, activePageId),
    [activePageId, document]
  )
  const storageKey = `webmcp-studio:layer-expansion:${document.id}:${activePageId}`
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      return new Set(JSON.parse(sessionStorage.getItem(storageKey) ?? "[]"))
    } catch {
      return new Set()
    }
  })
  const [query, setQuery] = useState("")
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [anchorKey, setAnchorKey] = useState<string | null>(null)
  const [rename, setRename] = useState<RenameState | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropState, setDropState] = useState<DropState>(null)
  const [announcement, setAnnouncement] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const localSelectionSignatureRef = useRef<string | null>(null)
  const handledSelectionContextRef = useRef<string | null>(null)
  const previousQueryRef = useRef(query)
  const pendingQueryClearScrollRef = useRef<string | null>(null)
  const selectedNodeIds = useMemo(
    () => new Set(selection?.pageId === activePageId ? selection.nodeIds : []),
    [activePageId, selection]
  )
  const rows = useMemo(
    () => visibleLayerRows(model.items, expandedKeys, query),
    [expandedKeys, model.items, query]
  )
  const rowByKey = useMemo(
    () => new Map(rows.map((row) => [row.item.key, row])),
    [rows]
  )
  const childKeysByParent = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const row of rows) {
      if (!row.parentKey) continue
      const children = result.get(row.parentKey) ?? []
      children.push(row.item.key)
      result.set(row.parentKey, children)
    }
    return result
  }, [rows])
  const rowIndexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.item.key, index])),
    [rows]
  )
  const matchCount = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return 0
    return [...model.byKey.values()].filter(
      (item) =>
        item.name.toLocaleLowerCase().includes(normalized) ||
        item.nodeType.toLocaleLowerCase().includes(normalized) ||
        Boolean(item.mask?.role.includes(normalized)) ||
        Boolean(item.mask?.type.includes(normalized))
    ).length
  }, [model.byKey, query])
  const activeRowIndex = activeKey
    ? rows.findIndex((row) => row.item.key === activeKey)
    : -1

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.item.key ?? index,
    overscan: 8,
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range))
      if (activeRowIndex >= 0) indexes.add(activeRowIndex)
      for (const index of [...indexes]) {
        let parentKey = rows.at(index)?.parentKey
        while (parentKey) {
          const parentIndex = rowIndexByKey.get(parentKey)
          if (parentIndex === undefined) break
          indexes.add(parentIndex)
          parentKey = rows.at(parentIndex)?.parentKey ?? null
        }
      }
      return [...indexes].sort((left, right) => left - right)
    },
    useFlushSync: false,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const mountedRowKeys = new Set(
    virtualRows.flatMap((virtualRow) => {
      const row = rows.at(virtualRow.index)
      return row ? [row.item.key] : []
    })
  )

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...expandedKeys]))
    } catch {
      // Expansion persistence is a convenience; the editor remains usable without it.
    }
  }, [expandedKeys, storageKey])

  useEffect(() => {
    const cleanup = monitorForElements({
      canMonitor: ({ source }) => typeof source.data.layerKey === "string",
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets.at(0)
        const sourceKey = source.data.layerKey
        const targetKey = target?.data.layerKey
        const instruction = target ? extractInstruction(target.data) : null
        const intent = instructionIntent(instruction)
        setDraggingKey(null)
        setDropState(null)
        if (
          typeof sourceKey !== "string" ||
          typeof targetKey !== "string" ||
          !intent
        ) {
          return
        }
        const sourceItem = model.byKey.get(sourceKey)
        const targetItem = model.byKey.get(targetKey)
        if (!sourceItem || !targetItem) return
        if (onMoveLayer(sourceItem, targetItem, intent)) {
          setActiveKey(sourceKey)
          if (intent === "inside") {
            setExpandedKeys((current) => new Set(current).add(targetKey))
          }
          setAnnouncement(
            `${sourceItem.name} moved ${intent === "inside" ? `inside ${targetItem.name}` : `${intent} ${targetItem.name}`}.`
          )
        }
      },
    })
    return cleanup
  }, [model.byKey, onMoveLayer])

  const scrollAndFocus = useCallback(
    (key: string, focus = true) => {
      const index = rows.findIndex((row) => row.item.key === key)
      if (index < 0) return
      virtualizer.scrollToIndex(index, { align: "auto" })
      if (!focus) return
      requestAnimationFrame(() => treeRef.current?.focus())
    },
    [rows, virtualizer]
  )

  useLayoutEffect(() => {
    if (!selection?.nodeIds.length || selection.pageId !== activePageId) return
    const selectionSignature = `${selection.pageId}:${[...selection.nodeIds].sort().join(",")}`
    const groupsById = new Map(
      document.groups.map((group) => [group.id, group])
    )
    const ancestrySignature = selection.nodeIds
      .map((nodeId) => {
        const ancestors: string[] = []
        let parentId = model.byKey.get(layerKey("node", nodeId))?.parentGroupId
        while (parentId) {
          ancestors.push(parentId)
          parentId = groupsById.get(parentId)?.parentGroupId ?? null
        }
        return `${nodeId}:${ancestors.join("/")}`
      })
      .sort()
      .join("|")
    const selectionContext = `${selectionSignature}:${ancestrySignature}`
    if (localSelectionSignatureRef.current === selectionSignature) {
      localSelectionSignatureRef.current = null
      handledSelectionContextRef.current = selectionContext
      return
    }
    if (handledSelectionContextRef.current === selectionContext) return
    handledSelectionContextRef.current = selectionContext
    const next = new Set(expandedKeys)
    let changed = false
    for (const nodeId of selection.nodeIds) {
      let parentId = model.byKey.get(layerKey("node", nodeId))?.parentGroupId
      while (parentId) {
        const key = layerKey("group", parentId)
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
        parentId = groupsById.get(parentId)?.parentGroupId ?? null
      }
    }
    if (changed) {
      setExpandedKeys(next)
      return
    }
    const onlySelectedNodeId =
      selection.nodeIds.length === 1 ? selection.nodeIds[0] : null
    const exactLeafKey = onlySelectedNodeId
      ? layerKey("node", onlySelectedNodeId)
      : null
    const exactGroupKey = rows.find(
      (row) =>
        row.item.kind === "group" &&
        row.item.nodeIds.length === selectedNodeIds.size &&
        row.item.nodeIds.every((nodeId) => selectedNodeIds.has(nodeId))
    )?.item.key
    const selectedKey =
      (exactLeafKey && rowByKey.has(exactLeafKey) ? exactLeafKey : null) ??
      exactGroupKey ??
      rows.find((row) =>
        row.item.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId))
      )?.item.key
    if (selectedKey) {
      setActiveKey(selectedKey)
      scrollAndFocus(selectedKey, false)
    }
  }, [
    activePageId,
    document.groups,
    expandedKeys,
    model.byKey,
    rowByKey,
    rows,
    scrollAndFocus,
    selectedNodeIds,
    selection,
  ])

  useEffect(() => {
    if (activeKey && rowByKey.has(activeKey)) return
    const selected = rows.find(
      (row) => layerSelectionState(row.item, selectedNodeIds) !== "none"
    )
    setActiveKey(selected?.item.key ?? rows.at(0)?.item.key ?? null)
  }, [activeKey, rowByKey, rows, selectedNodeIds])

  useLayoutEffect(() => {
    const previousQuery = previousQueryRef.current
    previousQueryRef.current = query
    if (previousQuery && !query && activeKey) {
      pendingQueryClearScrollRef.current = activeKey
    }
    const pendingKey = pendingQueryClearScrollRef.current
    if (query || !pendingKey) return
    if (rowByKey.has(pendingKey)) {
      pendingQueryClearScrollRef.current = null
      scrollAndFocus(pendingKey, false)
      return
    }
    const item = model.byKey.get(pendingKey)
    if (!item?.parentGroupId) return
    const groupsById = new Map(
      document.groups.map((group) => [group.id, group])
    )
    setExpandedKeys((current) => {
      const next = new Set(current)
      let parentId: string | null = item.parentGroupId
      while (parentId) {
        next.add(layerKey("group", parentId))
        parentId = groupsById.get(parentId)?.parentGroupId ?? null
      }
      return next
    })
  }, [activeKey, document.groups, model.byKey, query, rowByKey, scrollAndFocus])

  const selectKey = useCallback(
    (
      key: string,
      mode: { additive: boolean; range: boolean },
      focus = true
    ) => {
      const next = layerSelectionForTarget(
        rows,
        selectedNodeIds,
        anchorKey,
        key,
        mode
      )
      setActiveKey(key)
      if (!mode.range) setAnchorKey(key)
      localSelectionSignatureRef.current = `${activePageId}:${[...next].sort().join(",")}`
      onSelectionChange([...next])
      if (focus) scrollAndFocus(key)
    },
    [
      activePageId,
      anchorKey,
      onSelectionChange,
      rows,
      scrollAndFocus,
      selectedNodeIds,
    ]
  )

  const requestContextMenu = useCallback(
    (item: LayerTreeItem) => {
      const nodeIds = layerContextSelectionNodeIds(
        item,
        selection,
        activePageId
      )
      const currentNodeIds =
        selection?.pageId === activePageId ? selection.nodeIds : []
      const selectionChanged =
        nodeIds.length !== currentNodeIds.length ||
        nodeIds.some((nodeId, index) => nodeId !== currentNodeIds[index])
      setActiveKey(item.key)
      setAnchorKey(item.key)
      if (selectionChanged) {
        localSelectionSignatureRef.current = `${activePageId}:${[...nodeIds].sort().join(",")}`
        onSelectionChange(nodeIds)
      }
    },
    [activePageId, onSelectionChange, selection]
  )

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const startRename = useCallback((item: LayerTreeItem) => {
    setRename({ key: item.key, original: item.name, draft: item.name })
  }, [])

  const commitRename = useCallback(
    (restoreFocus = false) => {
      if (!rename) return
      const item = model.byKey.get(rename.key)
      const name = rename.draft.trim()
      setRename(null)
      if (item && name && name !== rename.original) {
        if (item.kind === "group") onRenameGroup(item.id, name)
        else onRenameNode(item.id, name)
        setAnnouncement(`${rename.original} renamed to ${name}.`)
      }
      if (restoreFocus) {
        requestAnimationFrame(() => treeRef.current?.focus())
      }
    },
    [model.byKey, onRenameGroup, onRenameNode, rename]
  )

  const cancelRename = useCallback(() => {
    if (!rename) return
    const key = rename.key
    setRename(null)
    requestAnimationFrame(() => {
      if (rowByKey.has(key)) treeRef.current?.focus()
    })
  }, [rename, rowByKey])

  const moveByKeyboard = useCallback(
    (source: LayerTreeItem, target: LayerTreeItem, intent: LayerDropIntent) => {
      if (reviewPending) return
      if (onMoveLayer(source, target, intent)) {
        setAnnouncement(
          `${source.name} moved ${intent === "inside" ? `inside ${target.name}` : `${intent} ${target.name}`}.`
        )
      }
    },
    [onMoveLayer, reviewPending]
  )

  const onTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (rename) return
      const currentIndex = rows.findIndex((row) => row.item.key === activeKey)
      const current = rows.at(currentIndex)
      if (!current) return
      const primary = event.metaKey || event.ctrlKey
      const focusedIsSelected =
        layerSelectionState(current.item, selectedNodeIds) !== "none"
      const actionNodeIds = focusedIsSelected
        ? [...selectedNodeIds]
        : current.item.nodeIds

      if (
        event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)
      ) {
        event.preventDefault()
        event.stopPropagation()
        requestContextMenu(current.item)
        const rowElement = globalThis.document.getElementById(
          `layer-tree-item-${current.item.key.replaceAll(":", "-")}`
        )
        if (rowElement) {
          const bounds = rowElement.getBoundingClientRect()
          rowElement.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + Math.min(32, bounds.width / 2),
              clientY: bounds.top + bounds.height / 2,
              button: 2,
            })
          )
        }
        return
      }

      const activateIndex = (index: number) => {
        const next = rows.at(Math.max(0, Math.min(rows.length - 1, index)))
        if (!next) return
        setActiveKey(next.item.key)
        scrollAndFocus(next.item.key)
      }

      if (event.altKey && !primary) {
        if (
          reviewPending &&
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
            event.key
          )
        ) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault()
          event.stopPropagation()
          const direction = event.key === "ArrowUp" ? -1 : 1
          const sibling = rows
            .slice(
              event.key === "ArrowUp" ? 0 : currentIndex + 1,
              event.key === "ArrowUp" ? currentIndex : undefined
            )
            .filter((row) => row.parentKey === current.parentKey)
            .at(direction < 0 ? -1 : 0)
          if (sibling) {
            moveByKeyboard(
              current.item,
              sibling.item,
              direction < 0 ? "above" : "below"
            )
          }
          return
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          event.stopPropagation()
          const previousGroup = rows
            .slice(0, currentIndex)
            .filter(
              (row) =>
                row.parentKey === current.parentKey && row.item.kind === "group"
            )
            .at(-1)
          if (previousGroup) {
            moveByKeyboard(current.item, previousGroup.item, "inside")
            setExpandedKeys((keys) => new Set(keys).add(previousGroup.item.key))
          }
          return
        }
        if (event.key === "ArrowLeft" && current.parentKey) {
          event.preventDefault()
          event.stopPropagation()
          const parent = model.byKey.get(current.parentKey)
          if (parent) moveByKeyboard(current.item, parent, "below")
          return
        }
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          event.stopPropagation()
          activateIndex(currentIndex + 1)
          break
        case "ArrowUp":
          event.preventDefault()
          event.stopPropagation()
          activateIndex(currentIndex - 1)
          break
        case "Home":
          event.preventDefault()
          event.stopPropagation()
          activateIndex(0)
          break
        case "End":
          event.preventDefault()
          event.stopPropagation()
          activateIndex(rows.length - 1)
          break
        case "ArrowRight":
          event.preventDefault()
          event.stopPropagation()
          if (
            !query &&
            current.item.children.length &&
            !expandedKeys.has(current.item.key)
          ) {
            toggleExpanded(current.item.key)
          } else if (current.item.children.length) {
            activateIndex(currentIndex + 1)
          }
          break
        case "ArrowLeft":
          event.preventDefault()
          event.stopPropagation()
          if (
            !query &&
            current.item.children.length &&
            expandedKeys.has(current.item.key)
          ) {
            toggleExpanded(current.item.key)
          } else if (current.parentKey) {
            setActiveKey(current.parentKey)
            scrollAndFocus(current.parentKey)
          }
          break
        case " ":
        case "Enter":
          event.preventDefault()
          event.stopPropagation()
          selectKey(current.item.key, {
            additive: event.key === " " && !event.shiftKey ? true : primary,
            range: event.shiftKey,
          })
          break
        case "F2":
          event.preventDefault()
          event.stopPropagation()
          if (!reviewPending) startRename(current.item)
          break
        case "Delete":
        case "Backspace":
          event.preventDefault()
          event.stopPropagation()
          if (!reviewPending && !onDeleteNodes(actionNodeIds)) {
            setAnnouncement("Unlock the selected layers before deleting them.")
          }
          break
        default:
          if (
            !primary &&
            !event.altKey &&
            event.key.toLocaleLowerCase() === "h"
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (!reviewPending) {
              onUpdateNodes(actionNodeIds, {
                visible: !current.item.visible,
              })
              setAnnouncement(
                `${current.item.name} ${current.item.visible ? "hidden" : "shown"}.`
              )
            }
          } else if (
            !primary &&
            !event.altKey &&
            event.key.toLocaleLowerCase() === "l"
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (!reviewPending) {
              onUpdateNodes(actionNodeIds, {
                locked: !current.item.locked,
              })
              setAnnouncement(
                `${current.item.name} ${current.item.locked ? "unlocked" : "locked"}.`
              )
            }
          }
      }
    },
    [
      activeKey,
      expandedKeys,
      model.byKey,
      moveByKeyboard,
      onDeleteNodes,
      onUpdateNodes,
      rename,
      reviewPending,
      rows,
      query,
      requestContextMenu,
      scrollAndFocus,
      selectedNodeIds,
      selectKey,
      startRename,
      toggleExpanded,
    ]
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Layers">
      <div className={cn("p-2", !integrated && "border-b border-border")}>
        <div className="flex min-w-0 items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="layer-search"
              autoComplete="off"
              aria-label="Search layers"
              value={query}
              placeholder="Search layers…"
              className={cn(
                "appearance-none rounded-sm border-transparent bg-editor-field pr-2.5 pl-7 text-[11px] hover:bg-editor-field-hover focus-visible:bg-background [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
                compact
                  ? "h-(--studio-compact-target)"
                  : "h-(--studio-control-sm)"
              )}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          {query ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Clear layer search"
              className={cn("shrink-0", compact ? "size-11" : "size-7")}
              onClick={() => setQuery("")}
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px] leading-4 text-muted-foreground">
          <span role="status" aria-live="polite" aria-atomic="true">
            {query
              ? `${matchCount} ${matchCount === 1 ? "result" : "results"}`
              : `${model.byKey.size} ${model.byKey.size === 1 ? "layer" : "layers"}`}
          </span>
          <span>Front to back</span>
        </div>
      </div>

      {rows.length ? (
        <div
          ref={scrollRef}
          data-testid="layer-tree-scroll"
          className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain p-1"
        >
          <div
            ref={treeRef}
            role="tree"
            aria-label="Document layers"
            aria-describedby="layer-tree-keyboard-help"
            aria-multiselectable="true"
            aria-activedescendant={
              activeKey
                ? `layer-tree-item-${activeKey.replaceAll(":", "-")}`
                : undefined
            }
            tabIndex={0}
            className="relative w-full outline-none focus-visible:[&_[data-active=true]]:ring-2 focus-visible:[&_[data-active=true]]:ring-studio-accent/45"
            style={{ height: `${rows.length * rowHeight}px` }}
            onKeyDown={onTreeKeyDown}
          >
            {virtualRows.map((virtualRow) => {
              const row = rows.at(virtualRow.index)
              if (!row) return null
              const rowCommandContext = productCommandContext
                ? createLayerProductCommandContext(
                    productCommandContext,
                    document,
                    row.item,
                    selection
                  )
                : null
              const rowContextMenuGroups = rowCommandContext
                ? buildLayerContextMenu(
                    rowCommandContext,
                    createLayerProductCommandTarget(rowCommandContext, row.item)
                  )
                : null
              const rowContainer = (
                <div
                  key={row.item.key}
                  role="presentation"
                  data-index={virtualRow.index}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    // The tree has a canonical fixed row height. Keeping its
                    // geometry independent from transient DOM measurements
                    // prevents every virtual row collapsing to y=0 during HMR
                    // while retaining virtual range selection and scrolling.
                    height: `${rowHeight}px`,
                    transform: `translate3d(0, ${virtualRow.index * rowHeight}px, 0)`,
                  }}
                >
                  <LayerRow
                    row={row}
                    active={activeKey === row.item.key}
                    selectedState={layerSelectionState(
                      row.item,
                      selectedNodeIds
                    )}
                    expanded={expandedKeys.has(row.item.key) || Boolean(query)}
                    dragging={draggingKey === row.item.key}
                    dropState={dropState}
                    reviewPending={reviewPending}
                    filtering={Boolean(query)}
                    ownedChildIds={(childKeysByParent.get(row.item.key) ?? [])
                      .filter((key) => mountedRowKeys.has(key))
                      .map(
                        (key) => `layer-tree-item-${key.replaceAll(":", "-")}`
                      )}
                    rename={rename}
                    onActivate={setActiveKey}
                    onSelect={(event, key) =>
                      selectKey(
                        key,
                        {
                          additive: event.metaKey || event.ctrlKey,
                          range: event.shiftKey,
                        },
                        true
                      )
                    }
                    onToggleExpanded={toggleExpanded}
                    onStartRename={startRename}
                    onRenameDraftChange={(draft) =>
                      setRename((current) =>
                        current ? { ...current, draft } : current
                      )
                    }
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
                    onFocusNode={onFocusNode}
                    onHoverNode={onHoverNode}
                    onToggleVisibility={(item) => {
                      onUpdateNodes(item.nodeIds, { visible: !item.visible })
                      setAnnouncement(
                        `${item.name} ${item.visible ? "hidden" : "shown"}.`
                      )
                    }}
                    onToggleLock={(item) => {
                      onUpdateNodes(item.nodeIds, { locked: !item.locked })
                      setAnnouncement(
                        `${item.name} ${item.locked ? "unlocked" : "locked"}.`
                      )
                    }}
                    onRequestContextMenu={requestContextMenu}
                    setDraggingKey={setDraggingKey}
                    setDropState={setDropState}
                    compact={compact}
                  />
                </div>
              )
              return rowContextMenuGroups && productCommandRuntime ? (
                <ProductCommandContextMenu
                  key={row.item.key}
                  groups={rowContextMenuGroups}
                  runtime={productCommandRuntime}
                  onOpenChange={(open) => {
                    if (!open) {
                      requestAnimationFrame(() => treeRef.current?.focus())
                    }
                  }}
                >
                  {rowContainer}
                </ProductCommandContextMenu>
              ) : (
                rowContainer
              )
            })}
          </div>
        </div>
      ) : (
        <EditorPanelState
          className="min-h-0"
          description={
            query
              ? "Try a layer name or object type."
              : "Add text, shapes, or an image to start designing."
          }
          icon={query ? <Search /> : <Square />}
          title={query ? "No matching layers" : "This page is empty"}
        />
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <p id="layer-tree-keyboard-help" className="sr-only">
        Use arrow keys to move through layers, Space to toggle selection, F2 to
        rename, H to show or hide, L to lock or unlock, Delete to remove, and
        Shift plus F10 or the Context Menu key to open layer commands, and Alt
        plus arrow keys to reorder or reparent.
      </p>
    </section>
  )
}
