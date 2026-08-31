import { getGroupNodeIds } from "./groups"
import type {
  Document,
  ComponentInstance,
  FieldBinding,
  GroupDefinition,
  SceneNode,
  VariableBinding,
} from "./schema"

export type SemanticFragment = {
  sourcePageId: string
  nodeIds: string[]
  nodes: SceneNode[]
  groups: GroupDefinition[]
  bindings: FieldBinding[]
  variableBindings: VariableBinding[]
  componentInstances: ComponentInstance[]
}

export type SemanticCloneIdKind =
  "node" | "group" | "binding" | "variable_binding" | "component_instance"

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
  variableBindings: VariableBinding[]
  componentInstances: ComponentInstance[]
  nodeIdMap: ReadonlyMap<string, string>
  groupIdMap: ReadonlyMap<string, string>
  bindingIdMap: ReadonlyMap<string, string>
  variableBindingIdMap: ReadonlyMap<string, string>
  componentInstanceIdMap: ReadonlyMap<string, string>
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
  const groups = includedGroups.map((group) => {
    if (
      group.role === "mask" &&
      group.mask.sourceNodeIds.some(
        (sourceNodeId) =>
          !requested.has(sourceNodeId) || !group.nodeIds.includes(sourceNodeId)
      )
    ) {
      throw new Error(
        `Semantic mask group ${group.id} contains an incomplete source capture`
      )
    }
    return {
      ...copy(group),
      parentGroupId:
        group.parentGroupId && includedGroupIds.has(group.parentGroupId)
          ? group.parentGroupId
          : undefined,
    }
  })
  const bindings = document.bindings
    .filter((binding) => requested.has(binding.nodeId))
    .map(copy)
  const variableBindings = document.variableBindings
    .filter((binding) => {
      const target = binding.target
      return (
        (target.kind === "node" || target.kind === "text_range") &&
        requested.has(target.nodeId)
      )
    })
    .map(copy)
  const componentInstances = document.componentInstances
    .filter(
      (instance) =>
        instance.nodeMappings.every((mapping) =>
          requested.has(mapping.instanceNodeId)
        ) &&
        instance.groupMappings.every((mapping) =>
          includedGroupIds.has(mapping.instanceGroupId)
        )
    )
    .map(copy)

  return {
    sourcePageId,
    nodeIds,
    nodes,
    groups,
    bindings,
    variableBindings,
    componentInstances,
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
  const variableBindingIdMap = new Map(
    fragment.variableBindings.map((binding) => [
      binding.id,
      createId("variable_binding", binding.id),
    ])
  )
  const componentInstanceIdMap = new Map(
    fragment.componentInstances.map((instance) => [
      instance.id,
      createId("component_instance", instance.id),
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
    const nodeIds = source.nodeIds.map((nodeId) => {
      const clonedNodeId = nodeIdMap.get(nodeId)
      if (!clonedNodeId) {
        throw new Error(`Incomplete semantic group member: ${nodeId}`)
      }
      return clonedNodeId
    })
    const parentGroupId = source.parentGroupId
      ? groupIdMap.get(source.parentGroupId)
      : undefined
    if (source.parentGroupId && !parentGroupId) {
      throw new Error(
        `Incomplete semantic parent group: ${source.parentGroupId}`
      )
    }
    const common = {
      ...copy(source),
      id,
      pageId: options.targetPageId,
      nodeIds,
      parentGroupId,
    }
    if (source.role === "organize") return common
    return {
      ...common,
      mask: {
        ...copy(source.mask),
        sourceNodeIds: source.mask.sourceNodeIds.map((sourceNodeId) => {
          if (!source.nodeIds.includes(sourceNodeId)) {
            throw new Error(
              `Semantic mask source is not a direct member: ${sourceNodeId}`
            )
          }
          const clonedSourceNodeId = nodeIdMap.get(sourceNodeId)
          if (!clonedSourceNodeId) {
            throw new Error(`Incomplete semantic mask source: ${sourceNodeId}`)
          }
          return clonedSourceNodeId
        }) as [string, ...string[]],
      },
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
  const variableBindings = fragment.variableBindings.map((source) => {
    const id = variableBindingIdMap.get(source.id)
    const target = source.target
    if (!id || (target.kind !== "node" && target.kind !== "text_range")) {
      throw new Error(`Incomplete semantic variable binding: ${source.id}`)
    }
    const nodeId = nodeIdMap.get(target.nodeId)
    if (!nodeId) {
      throw new Error(`Incomplete semantic variable target: ${source.id}`)
    }
    return {
      ...copy(source),
      id,
      target: { ...copy(target), nodeId },
    }
  })
  const componentInstances = fragment.componentInstances.map((source) => {
    const id = componentInstanceIdMap.get(source.id)
    const rootGroupId = groupIdMap.get(source.rootGroupId)
    if (!id || !rootGroupId) {
      throw new Error(`Incomplete component instance clone: ${source.id}`)
    }
    return {
      ...copy(source),
      id,
      name: options.nameSuffix
        ? `${source.name}${options.nameSuffix}`
        : source.name,
      rootGroupId,
      transform: {
        ...copy(source.transform),
        x: source.transform.x + offsetX,
        y: source.transform.y + offsetY,
      },
      nodeMappings: source.nodeMappings.map((mapping) => {
        const instanceNodeId = nodeIdMap.get(mapping.instanceNodeId)
        if (!instanceNodeId) {
          throw new Error(
            `Incomplete component instance layer: ${mapping.instanceNodeId}`
          )
        }
        return { ...copy(mapping), instanceNodeId }
      }),
      groupMappings: source.groupMappings.map((mapping) => {
        const instanceGroupId = groupIdMap.get(mapping.instanceGroupId)
        if (!instanceGroupId) {
          throw new Error(
            `Incomplete component instance group: ${mapping.instanceGroupId}`
          )
        }
        return { ...copy(mapping), instanceGroupId }
      }),
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
    variableBindings,
    componentInstances,
    nodeIdMap,
    groupIdMap,
    bindingIdMap,
    variableBindingIdMap,
    componentInstanceIdMap,
  }
}
