import type { Document } from "@webmcp/document"
import type { LayerTreeItem, Selection } from "@webmcp/editor"
import { deriveInspectorMaskCapabilities } from "@webmcp/editor/inspector"
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
  const maskGroupId =
    item.mask?.groupId ?? (item.kind === "group" ? item.id : null)
  const mask = deriveInspectorMaskCapabilities({
    document,
    pageId: base.activePageId,
    selectedNodeIds: nodeIds,
    selectedGroupId: maskGroupId,
    candidateSourceNodeIds:
      item.kind === "node" && item.mask?.role !== "source" ? [item.id] : [],
    documentEditable: !base.editor.reviewPending,
  })
  return {
    ...base,
    selection: {
      pageId: base.activePageId,
      nodeIds,
      nodeTypes: nodes.map((node) => node.type),
      groupId: mask.groupId ?? (item.kind === "group" ? item.id : null),
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
      mask: {
        canCreate: mask.create.enabled,
        createDisabledReason: mask.create.disabledReason,
        canRelease: mask.release.enabled,
        releaseDisabledReason: mask.release.disabledReason,
        canSetVector: mask.setVector.enabled,
        vectorDisabledReason: mask.setVector.disabledReason,
        canSetAlpha: mask.setAlpha.enabled,
        alphaDisabledReason: mask.setAlpha.disabledReason,
        canSetLuminance: mask.setLuminance.enabled,
        luminanceDisabledReason: mask.setLuminance.disabledReason,
        canSetSources: mask.setSources.enabled,
        sourcesDisabledReason: mask.setSources.disabledReason,
      },
    },
    mask,
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
