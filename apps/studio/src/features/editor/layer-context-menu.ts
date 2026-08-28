import type { Document } from "@webmcp/document"
import type { LayerTreeItem, Selection } from "@webmcp/editor"
import type {
  ProductCommandRuntimeContext,
  ProductCommandTarget,
} from "@webmcp/editor/product-commands"

export function layerContextSelectionNodeIds(
  item: LayerTreeItem,
  selection: Selection | null,
  activePageId: string
) {
  const selected = new Set(
    selection?.pageId === activePageId ? selection.nodeIds : []
  )
  const targetIsSelected =
    item.kind === "node"
      ? selected.has(item.id)
      : item.nodeIds.length > 0 &&
        item.nodeIds.every((nodeId) => selected.has(nodeId))
  return targetIsSelected ? [...selected] : [...item.nodeIds]
}

export function createLayerProductCommandContext(
  base: ProductCommandRuntimeContext,
  document: Document,
  item: LayerTreeItem,
  selection: Selection | null
): ProductCommandRuntimeContext {
  const nodeIds = layerContextSelectionNodeIds(
    item,
    selection,
    base.activePageId
  )
  const nodes = nodeIds.flatMap((nodeId) => {
    const node = document.nodes.find((candidate) => candidate.id === nodeId)
    return node ? [node] : []
  })
  return {
    ...base,
    selection: {
      pageId: base.activePageId,
      nodeIds,
      nodeTypes: nodes.map((node) => node.type),
      groupId: item.kind === "group" ? item.id : null,
      anyLocked: nodes.some((node) => node.locked),
      allLocked: nodes.length > 0 && nodes.every((node) => node.locked),
      allVisible: nodes.length > 0 && nodes.every((node) => node.visible),
      allHidden: nodes.length > 0 && nodes.every((node) => !node.visible),
    },
    editor: {
      ...base.editor,
      hasSelection: nodeIds.length > 0,
      selectedNodeCount: nodeIds.length,
      hasSelectedGroup: item.kind === "group",
      hasZoomSelection: nodeIds.length > 0,
    },
  }
}

export function createLayerProductCommandTarget(
  context: ProductCommandRuntimeContext,
  item: LayerTreeItem
): Extract<ProductCommandTarget, { kind: "node" | "group" }> {
  const identity = {
    documentId: context.documentId,
    snapshotId: context.snapshotId,
    displayName: item.name,
    pageId: context.activePageId,
  }
  return item.kind === "group"
    ? { ...identity, kind: "group", groupId: item.id }
    : { ...identity, kind: "node", nodeId: item.id }
}
