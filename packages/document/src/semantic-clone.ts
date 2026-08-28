import { getGroupNodeIds } from "./groups"
import type {
  Document,
  FieldBinding,
  GroupDefinition,
  SceneNode,
} from "./schema"

export type SemanticFragment = {
  sourcePageId: string
  nodeIds: string[]
  nodes: SceneNode[]
  groups: GroupDefinition[]
  bindings: FieldBinding[]
}

export type SemanticCloneIdKind = "node" | "group" | "binding"

export type SemanticCloneOptions = {
  targetPageId: string
  offsetX?: number
  offsetY?: number
  nameSuffix?: string
  createId?: (kind: SemanticCloneIdKind, sourceId: string) => string
}

export type SemanticClone = {
  nodeIds: string[]
  nodes: SceneNode[]
  groups: GroupDefinition[]
  bindings: FieldBinding[]
  nodeIdMap: ReadonlyMap<string, string>
  groupIdMap: ReadonlyMap<string, string>
  bindingIdMap: ReadonlyMap<string, string>
}

const defaultCreateId = (kind: SemanticCloneIdKind) =>
  `${kind}-${crypto.randomUUID()}`

const copy = <Value>(value: Value): Value => structuredClone(value)

export function captureSemanticFragment(
  document: Document,
  sourcePageId: string,
  requestedNodeIds: readonly string[]
): SemanticFragment {
  const page = document.pages.find((candidate) => candidate.id === sourcePageId)
  if (!page) throw new Error(`Unknown page: ${sourcePageId}`)

  const requested = new Set(requestedNodeIds)
  if (requested.size !== requestedNodeIds.length) {
    throw new Error("A semantic fragment cannot contain duplicate layers")
  }
  if ([...requested].some((nodeId) => !page.nodeIds.includes(nodeId))) {
    throw new Error(
      "Every semantic fragment layer must belong to its source page"
    )
  }

  const nodeIds = page.nodeIds.filter((nodeId) => requested.has(nodeId))
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const nodes = nodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId)
    if (!node) throw new Error(`Missing semantic fragment layer: ${nodeId}`)
    return copy(node)
  })

  const includedGroups = document.groups.filter((group) => {
    if (group.pageId !== page.id) return false
    const descendants = getGroupNodeIds(document, group.id)
    return (
      descendants.length > 0 &&
      descendants.every((nodeId) => requested.has(nodeId))
    )
  })
  const includedGroupIds = new Set(includedGroups.map((group) => group.id))
  const groups = includedGroups.map((group) => ({
    ...copy(group),
    parentGroupId:
      group.parentGroupId && includedGroupIds.has(group.parentGroupId)
        ? group.parentGroupId
        : undefined,
  }))
  const bindings = document.bindings
    .filter((binding) => requested.has(binding.nodeId))
    .map(copy)

  return {
    sourcePageId,
    nodeIds,
    nodes,
    groups,
    bindings,
  }
}

export function cloneSemanticFragment(
  fragment: SemanticFragment,
  options: SemanticCloneOptions
): SemanticClone {
  const offsetX = options.offsetX ?? 0
  const offsetY = options.offsetY ?? 0
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error("Semantic clone offsets must be finite")
  }
  const createId = options.createId ?? defaultCreateId

  const nodeIdMap = new Map(
    fragment.nodeIds.map((nodeId) => [nodeId, createId("node", nodeId)])
  )
  const groupIdMap = new Map(
    fragment.groups.map((group) => [group.id, createId("group", group.id)])
  )
  const bindingIdMap = new Map(
    fragment.bindings.map((binding) => [
      binding.id,
      createId("binding", binding.id),
    ])
  )
  const sourceNodeById = new Map(fragment.nodes.map((node) => [node.id, node]))

  const nodes = fragment.nodeIds.map((sourceNodeId) => {
    const source = sourceNodeById.get(sourceNodeId)
    const id = nodeIdMap.get(sourceNodeId)
    if (!source || !id) {
      throw new Error(`Incomplete semantic fragment layer: ${sourceNodeId}`)
    }
    return {
      ...copy(source),
      id,
      name: options.nameSuffix
        ? `${source.name}${options.nameSuffix}`
        : source.name,
      x: source.x + offsetX,
      y: source.y + offsetY,
    }
  })

  const groups = fragment.groups.map((source) => {
    const id = groupIdMap.get(source.id)
    if (!id) throw new Error(`Incomplete semantic fragment group: ${source.id}`)
    return {
      ...copy(source),
      id,
      pageId: options.targetPageId,
      nodeIds: source.nodeIds.map((nodeId) => {
        const clonedNodeId = nodeIdMap.get(nodeId)
        if (!clonedNodeId) {
          throw new Error(`Incomplete semantic group member: ${nodeId}`)
        }
        return clonedNodeId
      }),
      parentGroupId: source.parentGroupId
        ? groupIdMap.get(source.parentGroupId)
        : undefined,
    }
  })

  const bindings = fragment.bindings.map((source) => {
    const id = bindingIdMap.get(source.id)
    const nodeId = nodeIdMap.get(source.nodeId)
    if (!id || !nodeId) {
      throw new Error(`Incomplete semantic fragment binding: ${source.id}`)
    }
    return {
      ...copy(source),
      id,
      nodeId,
    }
  })

  return {
    nodeIds: fragment.nodeIds.map((nodeId) => {
      const id = nodeIdMap.get(nodeId)
      if (!id) throw new Error(`Incomplete semantic fragment layer: ${nodeId}`)
      return id
    }),
    nodes,
    groups,
    bindings,
    nodeIdMap,
    groupIdMap,
    bindingIdMap,
  }
}
