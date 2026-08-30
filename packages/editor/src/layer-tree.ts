import {
  componentSourceSubtree,
  getGroupNodeIds,
  type Document,
  type GroupDefinition,
  type SceneNode,
} from "@webmcp/document"
import type { CommandDraft } from "./index"

export type LayerTreeItem = {
  key: string
  id: string
  kind: "node" | "group"
  name: string
  nodeType: SceneNode["type"] | "group"
  pageId: string
  parentGroupId: string | null
  nodeIds: string[]
  visible: boolean
  locked: boolean
  visibilityMixed: boolean
  lockMixed: boolean
  component: LayerComponentMetadata | null
  children: LayerTreeItem[]
}

export type LayerComponentMetadata = {
  role: "source" | "source-child" | "instance" | "instance-child"
  componentId: string
  componentName: string
  instanceId: string | null
  instanceName: string | null
  sourceNodeId: string | null
  sourceGroupId: string | null
  overrideProperties: string[]
  removedProperties: string[]
}

export type LayerTreeRow = {
  item: LayerTreeItem
  depth: number
  index: number
  parentKey: string | null
  positionInSet: number
  setSize: number
}

export type LayerSelectionMode = {
  additive: boolean
  range: boolean
}

export type LayerDropIntent = "above" | "below" | "inside"

export type LayerTreeModel = {
  items: LayerTreeItem[]
  byKey: Map<string, LayerTreeItem>
}

export function layerKey(kind: LayerTreeItem["kind"], id: string) {
  return `${kind}:${id}`
}

function groupDescendantNodeIds(
  group: GroupDefinition,
  childGroups: ReadonlyMap<string, GroupDefinition[]>,
  visited = new Set<string>()
): string[] {
  if (visited.has(group.id)) return []
  visited.add(group.id)
  return [
    ...group.nodeIds,
    ...(childGroups.get(group.id) ?? []).flatMap((child) =>
      groupDescendantNodeIds(child, childGroups, visited)
    ),
  ]
}

export function buildLayerTreeModel(
  document: Document,
  pageId: string
): LayerTreeModel {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) return { items: [], byKey: new Map() }

  const pageNodes = new Set(page.nodeIds)
  const nodeById = new Map(
    document.nodes
      .filter((node) => pageNodes.has(node.id))
      .map((node) => [node.id, node])
  )
  const groups = document.groups.filter((group) => group.pageId === pageId)
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const childGroups = new Map<string, GroupDefinition[]>()
  const directMembership = new Map<string, string>()
  const componentById = new Map(
    document.components.map((component) => [component.id, component])
  )
  const componentBySourceGroupId = new Map(
    document.components.map((component) => [component.sourceGroupId, component])
  )
  const sourceComponentByGroupId = new Map<
    string,
    Document["components"][number]
  >()
  const sourceComponentByNodeId = new Map<
    string,
    Document["components"][number]
  >()
  for (const component of document.components) {
    const source = componentSourceSubtree(document, component.sourceGroupId)
    if (!source) continue
    for (const groupId of source.groupIds) {
      sourceComponentByGroupId.set(groupId, component)
    }
    for (const nodeId of source.nodeIds) {
      sourceComponentByNodeId.set(nodeId, component)
    }
  }
  const instanceByGroupId = new Map<
    string,
    {
      instance: Document["componentInstances"][number]
      sourceGroupId: string
    }
  >()
  const instanceByNodeId = new Map<
    string,
    {
      instance: Document["componentInstances"][number]
      sourceNodeId: string
    }
  >()
  for (const instance of document.componentInstances) {
    for (const mapping of instance.groupMappings) {
      instanceByGroupId.set(mapping.instanceGroupId, {
        instance,
        sourceGroupId: mapping.sourceGroupId,
      })
    }
    for (const mapping of instance.nodeMappings) {
      instanceByNodeId.set(mapping.instanceNodeId, {
        instance,
        sourceNodeId: mapping.sourceNodeId,
      })
    }
  }

  const instanceMetadata = (
    instance: Document["componentInstances"][number],
    role: LayerComponentMetadata["role"],
    sourceNodeId: string | null,
    sourceGroupId: string | null
  ): LayerComponentMetadata | null => {
    const component = componentById.get(instance.componentId)
    if (!component) return null
    return {
      role,
      componentId: component.id,
      componentName: component.name,
      instanceId: instance.id,
      instanceName: instance.name,
      sourceNodeId,
      sourceGroupId,
      overrideProperties: sourceNodeId
        ? Object.keys(instance.overrides[sourceNodeId] ?? {}).sort()
        : Object.values(instance.overrides).flatMap((patch) =>
            Object.keys(patch)
          ),
      removedProperties: sourceNodeId
        ? [...(instance.removedProperties?.[sourceNodeId] ?? [])].sort()
        : Object.values(instance.removedProperties ?? {}).flat(),
    }
  }

  const sourceMetadata = (
    component: Document["components"][number],
    role: LayerComponentMetadata["role"],
    sourceNodeId: string | null,
    sourceGroupId: string | null
  ): LayerComponentMetadata => ({
    role,
    componentId: component.id,
    componentName: component.name,
    instanceId: null,
    instanceName: null,
    sourceNodeId,
    sourceGroupId,
    overrideProperties: [],
    removedProperties: [],
  })

  const componentMetadataForNode = (
    nodeId: string
  ): LayerComponentMetadata | null => {
    const instanceEntry = instanceByNodeId.get(nodeId)
    if (instanceEntry) {
      return instanceMetadata(
        instanceEntry.instance,
        "instance-child",
        instanceEntry.sourceNodeId,
        null
      )
    }
    const component = sourceComponentByNodeId.get(nodeId)
    return component
      ? sourceMetadata(component, "source-child", nodeId, null)
      : null
  }

  const componentMetadataForGroup = (
    groupId: string
  ): LayerComponentMetadata | null => {
    const instanceEntry = instanceByGroupId.get(groupId)
    if (instanceEntry) {
      return instanceMetadata(
        instanceEntry.instance,
        instanceEntry.instance.rootGroupId === groupId
          ? "instance"
          : "instance-child",
        null,
        instanceEntry.sourceGroupId
      )
    }
    const component = sourceComponentByGroupId.get(groupId)
    if (!component) return null
    return sourceMetadata(
      component,
      componentBySourceGroupId.has(groupId) ? "source" : "source-child",
      null,
      groupId
    )
  }

  for (const group of groups) {
    if (group.parentGroupId && groupById.has(group.parentGroupId)) {
      const children = childGroups.get(group.parentGroupId) ?? []
      children.push(group)
      childGroups.set(group.parentGroupId, children)
    }
    for (const nodeId of group.nodeIds) {
      if (pageNodes.has(nodeId)) directMembership.set(nodeId, group.id)
    }
  }

  const zIndex = new Map(page.nodeIds.map((nodeId, index) => [nodeId, index]))
  const byKey = new Map<string, LayerTreeItem>()
  const frontZByKey = new Map<string, number>()

  const nodeItem = (node: SceneNode, parentGroupId: string | null) => {
    const item: LayerTreeItem = {
      key: layerKey("node", node.id),
      id: node.id,
      kind: "node",
      name: node.name,
      nodeType: node.type,
      pageId,
      parentGroupId,
      nodeIds: [node.id],
      visible: node.visible,
      locked: node.locked,
      visibilityMixed: false,
      lockMixed: false,
      component: componentMetadataForNode(node.id),
      children: [],
    }
    byKey.set(item.key, item)
    frontZByKey.set(item.key, zIndex.get(node.id) ?? -1)
    return item
  }

  const sortFrontToBack = (items: LayerTreeItem[]) =>
    items.sort(
      (left, right) =>
        (frontZByKey.get(right.key) ?? -1) - (frontZByKey.get(left.key) ?? -1)
    )

  const buildGroup = (
    group: GroupDefinition,
    ancestors = new Set<string>()
  ): LayerTreeItem | null => {
    if (ancestors.has(group.id)) return null
    const nextAncestors = new Set(ancestors).add(group.id)
    const children = [
      ...group.nodeIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId)
        return node ? [nodeItem(node, group.id)] : []
      }),
      ...(childGroups.get(group.id) ?? []).flatMap((child) => {
        const item = buildGroup(child, nextAncestors)
        return item ? [item] : []
      }),
    ]
    sortFrontToBack(children)
    const nodeIds = groupDescendantNodeIds(group, childGroups).filter(
      (nodeId) => pageNodes.has(nodeId)
    )
    const descendants = nodeIds.flatMap((nodeId) => {
      const node = nodeById.get(nodeId)
      return node ? [node] : []
    })
    const visibleCount = descendants.filter((node) => node.visible).length
    const lockedCount = descendants.filter((node) => node.locked).length
    const item: LayerTreeItem = {
      key: layerKey("group", group.id),
      id: group.id,
      kind: "group",
      name: group.name,
      nodeType: "group",
      pageId,
      parentGroupId: group.parentGroupId ?? null,
      nodeIds,
      visible: descendants.length === 0 || visibleCount === descendants.length,
      locked: descendants.length > 0 && lockedCount === descendants.length,
      visibilityMixed: visibleCount > 0 && visibleCount < descendants.length,
      lockMixed: lockedCount > 0 && lockedCount < descendants.length,
      component: componentMetadataForGroup(group.id),
      children,
    }
    byKey.set(item.key, item)
    frontZByKey.set(
      item.key,
      Math.max(-1, ...nodeIds.map((nodeId) => zIndex.get(nodeId) ?? -1))
    )
    return item
  }

  const items = [
    ...page.nodeIds.flatMap((nodeId) => {
      if (directMembership.has(nodeId)) return []
      const node = nodeById.get(nodeId)
      return node ? [nodeItem(node, null)] : []
    }),
    ...groups.flatMap((group) => {
      if (group.parentGroupId && groupById.has(group.parentGroupId)) return []
      const item = buildGroup(group)
      return item ? [item] : []
    }),
  ]
  sortFrontToBack(items)
  return { items, byKey }
}

function filterLayerItems(
  items: readonly LayerTreeItem[],
  normalizedQuery: string
): LayerTreeItem[] {
  if (!normalizedQuery) return [...items]
  return items.flatMap((item) => {
    const children = filterLayerItems(item.children, normalizedQuery)
    const matches =
      item.name.toLocaleLowerCase().includes(normalizedQuery) ||
      item.nodeType.toLocaleLowerCase().includes(normalizedQuery)
    return matches || children.length ? [{ ...item, children }] : []
  })
}

export function visibleLayerRows(
  items: readonly LayerTreeItem[],
  expandedKeys: ReadonlySet<string>,
  query = ""
): LayerTreeRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredItems = filterLayerItems(items, normalizedQuery)
  const rows: LayerTreeRow[] = []

  const append = (
    siblings: readonly LayerTreeItem[],
    depth: number,
    parentKey: string | null
  ) => {
    siblings.forEach((item, siblingIndex) => {
      rows.push({
        item,
        depth,
        index: rows.length,
        parentKey,
        positionInSet: siblingIndex + 1,
        setSize: siblings.length,
      })
      if (
        item.children.length &&
        (normalizedQuery || expandedKeys.has(item.key))
      ) {
        append(item.children, depth + 1, item.key)
      }
    })
  }

  append(filteredItems, 1, null)
  return rows
}

export function layerSelectionState(
  item: LayerTreeItem,
  selectedNodeIds: ReadonlySet<string>
): "none" | "partial" | "all" {
  const selectedCount = item.nodeIds.filter((nodeId) =>
    selectedNodeIds.has(nodeId)
  ).length
  if (!selectedCount) return "none"
  return selectedCount === item.nodeIds.length ? "all" : "partial"
}

export function layerSelectionForTarget(
  rows: readonly LayerTreeRow[],
  currentNodeIds: ReadonlySet<string>,
  anchorKey: string | null,
  targetKey: string,
  mode: LayerSelectionMode
): Set<string> {
  const targetIndex = rows.findIndex((row) => row.item.key === targetKey)
  if (targetIndex < 0) return new Set(currentNodeIds)
  const target = rows[targetIndex]?.item
  if (!target) return new Set(currentNodeIds)

  if (mode.range && anchorKey) {
    const anchorIndex = rows.findIndex((row) => row.item.key === anchorKey)
    if (anchorIndex >= 0) {
      const next = mode.additive ? new Set(currentNodeIds) : new Set<string>()
      const start = Math.min(anchorIndex, targetIndex)
      const end = Math.max(anchorIndex, targetIndex)
      for (let index = start; index <= end; index++) {
        for (const nodeId of rows[index]?.item.nodeIds ?? []) next.add(nodeId)
      }
      return next
    }
  }

  if (!mode.additive) return new Set(target.nodeIds)
  const next = new Set(currentNodeIds)
  const fullySelected = target.nodeIds.every((nodeId) => next.has(nodeId))
  for (const nodeId of target.nodeIds) {
    if (fullySelected) next.delete(nodeId)
    else next.add(nodeId)
  }
  return next
}

function directParentGroupId(document: Document, item: LayerTreeItem) {
  if (item.kind === "group") return item.parentGroupId
  return (
    document.groups.find((group) => group.nodeIds.includes(item.id))?.id ?? null
  )
}

function reorderedNodeIds(
  pageNodeIds: readonly string[],
  sourceNodeIds: readonly string[],
  targetNodeIds: readonly string[],
  intent: Exclude<LayerDropIntent, "inside">
) {
  const sourceSet = new Set(sourceNodeIds)
  const remaining = pageNodeIds.filter((nodeId) => !sourceSet.has(nodeId))
  const targetIndexes = targetNodeIds.flatMap((nodeId) => {
    const index = remaining.indexOf(nodeId)
    return index >= 0 ? [index] : []
  })
  if (!targetIndexes.length) return null
  const toIndex =
    intent === "above"
      ? Math.max(...targetIndexes) + 1
      : Math.min(...targetIndexes)
  const orderedSource = pageNodeIds.filter((nodeId) => sourceSet.has(nodeId))
  return {
    nodeIds: [
      ...remaining.slice(0, toIndex),
      ...orderedSource,
      ...remaining.slice(toIndex),
    ],
    toIndex,
  }
}

function moveNodeBlockBesideTarget(
  pageNodeIds: readonly string[],
  sourceNodeIds: readonly string[],
  targetNodeIds: readonly string[]
) {
  const source = new Set(sourceNodeIds)
  const remaining = pageNodeIds.filter((nodeId) => !source.has(nodeId))
  const targetIndexes = targetNodeIds.flatMap((nodeId) => {
    const index = remaining.indexOf(nodeId)
    return index >= 0 ? [index] : []
  })
  if (!targetIndexes.length) return [...pageNodeIds]
  const toIndex = Math.max(...targetIndexes) + 1
  const orderedSource = pageNodeIds.filter((nodeId) => source.has(nodeId))
  return [
    ...remaining.slice(0, toIndex),
    ...orderedSource,
    ...remaining.slice(toIndex),
  ]
}

export function layerDropCommands(
  document: Document,
  pageId: string,
  source: LayerTreeItem,
  target: LayerTreeItem,
  intent: LayerDropIntent
): CommandDraft[] {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page || source.pageId !== pageId || target.pageId !== pageId) return []
  if (source.key === target.key) return []
  if (
    source.kind === "group" &&
    target.nodeIds.every((id) => source.nodeIds.includes(id))
  ) {
    return []
  }

  const targetParentGroupId =
    intent === "inside"
      ? target.kind === "group"
        ? target.id
        : null
      : directParentGroupId(document, target)
  if (intent === "inside" && target.kind !== "group") return []

  const commands: CommandDraft[] = []
  const sourceParentGroupId = directParentGroupId(document, source)
  if (sourceParentGroupId !== targetParentGroupId) {
    commands.push(
      source.kind === "group"
        ? {
            type: "reparent_group",
            pageId,
            groupId: source.id,
            ...(targetParentGroupId
              ? { targetGroupId: targetParentGroupId }
              : {}),
          }
        : {
            type: "reparent_node",
            pageId,
            nodeId: source.id,
            ...(targetParentGroupId
              ? { targetGroupId: targetParentGroupId }
              : {}),
          }
    )
  }

  if (intent !== "inside") {
    const orderAfterReparent =
      sourceParentGroupId !== targetParentGroupId && targetParentGroupId
        ? moveNodeBlockBesideTarget(
            page.nodeIds,
            source.nodeIds,
            getGroupNodeIds(document, targetParentGroupId)
          )
        : page.nodeIds
    const reordered = reorderedNodeIds(
      orderAfterReparent,
      source.nodeIds,
      target.nodeIds,
      intent
    )
    if (
      reordered &&
      reordered.nodeIds.some(
        (nodeId, index) => nodeId !== orderAfterReparent[index]
      )
    ) {
      commands.push({
        type: "reorder_nodes",
        pageId,
        nodeIds: source.nodeIds,
        toIndex: reordered.toIndex,
      })
    }
  }

  return commands
}
