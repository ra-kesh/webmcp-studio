import {
  componentSourceSubtree,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
  type SceneNode,
} from "@webmcp/document"

type ComponentSelectionBase = {
  component: ComponentDefinition
  instanceCount: number
  selectedSourceNodeId: string | null
}

export type ComponentSelectionContext =
  | (ComponentSelectionBase & {
      kind: "source"
      instance: null
      selectedOverrideProperties: string[]
      totalOverrideProperties: string[]
    })
  | (ComponentSelectionBase & {
      kind: "instance"
      instance: ComponentInstance
      selectedOverrideProperties: string[]
      totalOverrideProperties: string[]
    })

function overrideProperties(
  instance: ComponentInstance,
  sourceNodeId?: string | null
) {
  const patches = sourceNodeId
    ? [instance.overrides[sourceNodeId]]
    : Object.values(instance.overrides)
  const removed = sourceNodeId
    ? [instance.removedProperties?.[sourceNodeId]]
    : Object.values(instance.removedProperties ?? {})
  return [
    ...new Set([
      ...patches.flatMap((patch) => Object.keys(patch ?? {})),
      ...removed.flatMap((properties) => properties ?? []),
    ]),
  ].sort()
}

export function projectComponentSelection(
  document: Document,
  selectedNodes: readonly SceneNode[],
  selectedGroupId: string | null
): ComponentSelectionContext | null {
  const componentById = new Map(
    document.components.map((component) => [component.id, component])
  )
  const instanceCountByComponentId = new Map<string, number>()
  for (const instance of document.componentInstances) {
    instanceCountByComponentId.set(
      instance.componentId,
      (instanceCountByComponentId.get(instance.componentId) ?? 0) + 1
    )
  }
  const instanceByRootGroupId = new Map(
    document.componentInstances.map((instance) => [
      instance.rootGroupId,
      instance,
    ])
  )
  const instanceNodeOwner = new Map<
    string,
    { instance: ComponentInstance; sourceNodeId: string }
  >()
  for (const instance of document.componentInstances) {
    for (const mapping of instance.nodeMappings) {
      instanceNodeOwner.set(mapping.instanceNodeId, {
        instance,
        sourceNodeId: mapping.sourceNodeId,
      })
    }
  }

  const selectedInstance = selectedGroupId
    ? instanceByRootGroupId.get(selectedGroupId)
    : undefined
  const nodeOwners = selectedNodes.flatMap((node) => {
    const owner = instanceNodeOwner.get(node.id)
    return owner ? [owner] : []
  })
  const sharedNodeInstance =
    nodeOwners.length === selectedNodes.length && nodeOwners.length
      ? nodeOwners.every(
          (owner) => owner.instance.id === nodeOwners[0]?.instance.id
        )
        ? nodeOwners[0]?.instance
        : undefined
      : undefined
  const instance = selectedInstance ?? sharedNodeInstance
  if (instance) {
    const component = componentById.get(instance.componentId)
    if (!component) return null
    const selectedSourceNodeId =
      selectedNodes.length === 1
        ? (instanceNodeOwner.get(selectedNodes[0]!.id)?.sourceNodeId ?? null)
        : null
    return {
      kind: "instance",
      component,
      instance,
      instanceCount: instanceCountByComponentId.get(component.id) ?? 0,
      selectedSourceNodeId,
      selectedOverrideProperties: selectedSourceNodeId
        ? overrideProperties(instance, selectedSourceNodeId)
        : [],
      totalOverrideProperties: overrideProperties(instance),
    }
  }

  const sourceComponent = selectedGroupId
    ? document.components.find(
        (component) => component.sourceGroupId === selectedGroupId
      )
    : document.components.find((component) => {
        if (!selectedNodes.length) return false
        const source = componentSourceSubtree(document, component.sourceGroupId)
        if (!source) return false
        const sourceNodeIds = new Set(source.nodeIds)
        return selectedNodes.every((node) => sourceNodeIds.has(node.id))
      })
  if (!sourceComponent) return null
  const source = componentSourceSubtree(document, sourceComponent.sourceGroupId)
  const selectedSourceNodeId =
    selectedNodes.length === 1 && source?.nodeIds.includes(selectedNodes[0]!.id)
      ? selectedNodes[0]!.id
      : null
  return {
    kind: "source",
    component: sourceComponent,
    instance: null,
    instanceCount: instanceCountByComponentId.get(sourceComponent.id) ?? 0,
    selectedSourceNodeId,
    selectedOverrideProperties: [],
    totalOverrideProperties: [],
  }
}
