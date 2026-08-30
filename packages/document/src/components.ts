import { applyTextLayoutPatch } from "./text-layout"
import { normalizeRichTextContent } from "./rich-text"
import {
  sceneNodeSchema,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
  type SceneNode,
  type TextNodePatch,
} from "./schema"

export type ComponentIntegrityIssue = {
  code:
    | "component_source_missing"
    | "component_variant_target_outside_source"
    | "component_instance_component_missing"
    | "component_instance_variant_missing"
    | "component_instance_root_missing"
    | "component_instance_mapping_incomplete"
    | "component_instance_mapping_invalid"
    | "component_instance_stale"
    | "component_cycle"
  message: string
  componentId?: string
  instanceId?: string
  nodeId?: string
  groupId?: string
  property?: string
}

export type ComponentSourceSubtree = {
  groupIds: string[]
  nodeIds: string[]
}

const own = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key)

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(",")}}`
}

function normalizedRotation(value: number) {
  const rotation = ((value % 360) + 360) % 360
  return rotation > 180 ? rotation - 360 : rotation
}

export function componentSourceSubtree(
  document: Document,
  sourceGroupId: string
): ComponentSourceSubtree | null {
  const root = document.groups.find((group) => group.id === sourceGroupId)
  if (!root) return null

  const groupIds: string[] = []
  const nodeIds: string[] = []
  const visited = new Set<string>()
  const queue = [sourceGroupId]
  for (let index = 0; index < queue.length; index += 1) {
    const groupId = queue[index]
    if (!groupId || visited.has(groupId)) continue
    visited.add(groupId)
    const group = document.groups.find((candidate) => candidate.id === groupId)
    if (!group) continue
    groupIds.push(group.id)
    nodeIds.push(...group.nodeIds)
    for (const child of document.groups) {
      if (child.parentGroupId === group.id) queue.push(child.id)
    }
  }

  return {
    groupIds,
    nodeIds: [...new Set(nodeIds)],
  }
}

export function componentSourceNodes(
  document: Document,
  component: ComponentDefinition
): SceneNode[] {
  const subtree = componentSourceSubtree(document, component.sourceGroupId)
  if (!subtree) return []
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  return subtree.nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId)
    return node ? [node] : []
  })
}

function applyComponentPatch(
  node: SceneNode,
  patch: Record<string, unknown> | undefined
): SceneNode {
  if (!patch) return node
  if (node.type === "text") {
    const textPatch = patch as TextNodePatch
    const text = textPatch.text ?? node.text
    const textChanged = textPatch.text !== undefined && text !== node.text
    const richText = normalizeRichTextContent(text, {
      runs: textPatch.runs ?? (textChanged ? [] : node.runs),
      paragraphs: textPatch.paragraphs ?? (textChanged ? [] : node.paragraphs),
      links: textPatch.links ?? (textChanged ? [] : node.links),
    })
    return sceneNodeSchema.parse(
      applyTextLayoutPatch(node, {
        ...textPatch,
        text,
        ...richText,
      })
    )
  }
  return sceneNodeSchema.parse({ ...node, ...patch })
}

function boundsForNodes(nodes: readonly SceneNode[]) {
  if (!nodes.length) return null
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...nodes.map((node) => node.y + node.height))
  return { left, top, width: right - left, height: bottom - top }
}

function transformComponentNode(
  node: SceneNode,
  sourceBounds: NonNullable<ReturnType<typeof boundsForNodes>>,
  instance: ComponentInstance
): SceneNode {
  const sourceCenterX = node.x + node.width / 2
  const sourceCenterY = node.y + node.height / 2
  const localX = (sourceCenterX - sourceBounds.left) * instance.transform.scale
  const localY = (sourceCenterY - sourceBounds.top) * instance.transform.scale
  const radians = (instance.transform.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const centerX = instance.transform.x + localX * cos - localY * sin
  const centerY = instance.transform.y + localX * sin + localY * cos
  const width = node.width * instance.transform.scale
  const height = node.height * instance.transform.scale
  const transformed = {
    ...node,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation: normalizedRotation(node.rotation + instance.transform.rotation),
  }
  const scale = instance.transform.scale
  if (node.type === "text") {
    return sceneNodeSchema.parse({
      ...transformed,
      fontSize: node.fontSize * scale,
      letterSpacing: node.letterSpacing * scale,
      runs: node.runs.map((run) => ({
        ...run,
        style: {
          ...run.style,
          ...(run.style.fontSize !== undefined
            ? { fontSize: run.style.fontSize * scale }
            : {}),
          ...(run.style.letterSpacing !== undefined
            ? { letterSpacing: run.style.letterSpacing * scale }
            : {}),
        },
      })),
    })
  }
  if (node.type === "rect") {
    return sceneNodeSchema.parse({
      ...transformed,
      radius: node.radius * scale,
      strokeWidth: node.strokeWidth * scale,
    })
  }
  if (node.type === "ellipse" || node.type === "line" || node.type === "icon") {
    return sceneNodeSchema.parse({
      ...transformed,
      strokeWidth: node.strokeWidth * scale,
    })
  }
  return sceneNodeSchema.parse(transformed)
}

export function resolveComponentInstanceNodes(
  document: Document,
  instance: ComponentInstance
): SceneNode[] {
  const component = document.components.find(
    (candidate) => candidate.id === instance.componentId
  )
  if (!component) return []
  const variant = component.variants.find(
    (candidate) => candidate.id === instance.variantId
  )
  if (!variant) return []
  const sourceNodes = componentSourceNodes(document, component)
  const sourceBounds = boundsForNodes(sourceNodes)
  if (!sourceBounds) return []
  const mapping = new Map(
    instance.nodeMappings.map((entry) => [
      entry.sourceNodeId,
      entry.instanceNodeId,
    ])
  )

  return sourceNodes.flatMap((sourceNode) => {
    const instanceNodeId = mapping.get(sourceNode.id)
    if (!instanceNodeId) return []
    const variantNode = applyComponentPatch(
      sourceNode,
      variant.overrides[sourceNode.id]
    )
    const transformed = transformComponentNode(
      variantNode,
      sourceBounds,
      instance
    )
    const resolved = applyComponentPatch(
      transformed,
      instance.overrides[sourceNode.id]
    )
    return [{ ...resolved, id: instanceNodeId }]
  })
}

function differingProperties(actual: SceneNode, expected: SceneNode) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  keys.delete("id")
  return [...keys].filter(
    (key) =>
      stableValue(actual[key as keyof SceneNode]) !==
      stableValue(expected[key as keyof SceneNode])
  )
}

export function componentGraphCycles(document: Document): string[][] {
  const edges = new Map(
    document.components.map((component) => [component.id, new Set<string>()])
  )
  const instanceByRootGroup = new Map(
    document.componentInstances.map((instance) => [
      instance.rootGroupId,
      instance,
    ])
  )
  for (const component of document.components) {
    const subtree = componentSourceSubtree(document, component.sourceGroupId)
    if (!subtree) continue
    for (const groupId of subtree.groupIds) {
      const nested = instanceByRootGroup.get(groupId)
      if (nested) edges.get(component.id)?.add(nested.componentId)
    }
  }

  const cycles: string[][] = []
  const state = new Map<string, "active" | "done">()
  for (const componentId of edges.keys()) {
    if (state.has(componentId)) continue
    const stack: Array<{ id: string; edgeIndex: number; path: string[] }> = [
      { id: componentId, edgeIndex: 0, path: [componentId] },
    ]
    state.set(componentId, "active")
    while (stack.length) {
      const frame = stack.at(-1)
      if (!frame) break
      const targets = [...(edges.get(frame.id) ?? [])]
      if (frame.edgeIndex >= targets.length) {
        state.set(frame.id, "done")
        stack.pop()
        continue
      }
      const target = targets[frame.edgeIndex]
      frame.edgeIndex += 1
      if (!target || !edges.has(target)) continue
      if (state.get(target) === "active") {
        const start = frame.path.indexOf(target)
        cycles.push([...frame.path.slice(Math.max(0, start)), target])
        continue
      }
      if (state.get(target) === "done") continue
      state.set(target, "active")
      stack.push({ id: target, edgeIndex: 0, path: [...frame.path, target] })
    }
  }
  return cycles
}

export function componentIntegrityIssues(
  document: Document
): ComponentIntegrityIssue[] {
  const issues: ComponentIntegrityIssue[] = []
  const groups = new Map(document.groups.map((group) => [group.id, group]))
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const components = new Map(
    document.components.map((component) => [component.id, component])
  )
  const sourceGroupOwners = new Map<string, string>()
  const instanceNodeOwners = new Map<string, string>()
  const instanceGroupOwners = new Map<string, string>()

  for (const component of document.components) {
    const existingSourceOwner = sourceGroupOwners.get(component.sourceGroupId)
    if (existingSourceOwner) {
      issues.push({
        code: "component_source_missing",
        componentId: component.id,
        groupId: component.sourceGroupId,
        message: `Components ${existingSourceOwner} and ${component.id} share one source group`,
      })
      continue
    }
    sourceGroupOwners.set(component.sourceGroupId, component.id)
    const subtree = componentSourceSubtree(document, component.sourceGroupId)
    if (!subtree) {
      issues.push({
        code: "component_source_missing",
        componentId: component.id,
        groupId: component.sourceGroupId,
        message: `Component ${component.name} has no source group`,
      })
      continue
    }
    const sourceNodes = new Set(subtree.nodeIds)
    for (const variant of component.variants) {
      for (const nodeId of Object.keys(variant.overrides)) {
        if (sourceNodes.has(nodeId)) continue
        issues.push({
          code: "component_variant_target_outside_source",
          componentId: component.id,
          nodeId,
          message: `Variant ${variant.name} targets a layer outside ${component.name}`,
        })
      }
    }
  }

  for (const instance of document.componentInstances) {
    for (const mapping of instance.nodeMappings) {
      const owner = instanceNodeOwners.get(mapping.instanceNodeId)
      if (owner) {
        issues.push({
          code: "component_instance_mapping_invalid",
          instanceId: instance.id,
          nodeId: mapping.instanceNodeId,
          message: `Instances ${owner} and ${instance.id} claim one materialized layer`,
        })
      } else {
        instanceNodeOwners.set(mapping.instanceNodeId, instance.id)
      }
    }
    for (const mapping of instance.groupMappings) {
      const owner = instanceGroupOwners.get(mapping.instanceGroupId)
      if (owner) {
        issues.push({
          code: "component_instance_mapping_invalid",
          instanceId: instance.id,
          groupId: mapping.instanceGroupId,
          message: `Instances ${owner} and ${instance.id} claim one materialized group`,
        })
      } else {
        instanceGroupOwners.set(mapping.instanceGroupId, instance.id)
      }
    }
    const component = components.get(instance.componentId)
    if (!component) {
      issues.push({
        code: "component_instance_component_missing",
        instanceId: instance.id,
        componentId: instance.componentId,
        message: `Instance ${instance.name} references a missing component`,
      })
      continue
    }
    if (
      !component.variants.some((variant) => variant.id === instance.variantId)
    ) {
      issues.push({
        code: "component_instance_variant_missing",
        instanceId: instance.id,
        componentId: component.id,
        message: `Instance ${instance.name} references a missing variant`,
      })
      continue
    }
    if (!groups.has(instance.rootGroupId)) {
      issues.push({
        code: "component_instance_root_missing",
        instanceId: instance.id,
        groupId: instance.rootGroupId,
        message: `Instance ${instance.name} has no materialized root group`,
      })
      continue
    }
    const source = componentSourceSubtree(document, component.sourceGroupId)
    if (!source) continue
    const sourceNodeIds = new Set(source.nodeIds)
    const sourceGroupIds = new Set(source.groupIds)
    const mappedSourceNodes = new Set(
      instance.nodeMappings.map((mapping) => mapping.sourceNodeId)
    )
    const mappedSourceGroups = new Set(
      instance.groupMappings.map((mapping) => mapping.sourceGroupId)
    )
    if (
      mappedSourceNodes.size !== sourceNodeIds.size ||
      [...sourceNodeIds].some((nodeId) => !mappedSourceNodes.has(nodeId)) ||
      mappedSourceGroups.size !== sourceGroupIds.size ||
      [...sourceGroupIds].some((groupId) => !mappedSourceGroups.has(groupId))
    ) {
      issues.push({
        code: "component_instance_mapping_incomplete",
        instanceId: instance.id,
        componentId: component.id,
        message: `Instance ${instance.name} does not map the complete component subtree`,
      })
      continue
    }
    const nodeMappingBySource = new Map(
      instance.nodeMappings.map((mapping) => [
        mapping.sourceNodeId,
        mapping.instanceNodeId,
      ])
    )
    const groupMappingBySource = new Map(
      instance.groupMappings.map((mapping) => [
        mapping.sourceGroupId,
        mapping.instanceGroupId,
      ])
    )
    if (
      groupMappingBySource.get(component.sourceGroupId) !== instance.rootGroupId
    ) {
      issues.push({
        code: "component_instance_mapping_invalid",
        instanceId: instance.id,
        groupId: instance.rootGroupId,
        message: `Instance ${instance.name} root does not map the component source root`,
      })
    }
    const instanceRoot = groups.get(instance.rootGroupId)
    for (const mapping of instance.nodeMappings) {
      if (
        sourceNodeIds.has(mapping.sourceNodeId) &&
        nodes.has(mapping.instanceNodeId)
      ) {
        continue
      }
      issues.push({
        code: "component_instance_mapping_invalid",
        instanceId: instance.id,
        nodeId: mapping.instanceNodeId,
        message: `Instance ${instance.name} contains an invalid layer mapping`,
      })
    }
    for (const mapping of instance.groupMappings) {
      const sourceGroup = groups.get(mapping.sourceGroupId)
      const instanceGroup = groups.get(mapping.instanceGroupId)
      const sourceParent = sourceGroup?.parentGroupId
      const expectedParent =
        sourceParent && sourceGroupIds.has(sourceParent)
          ? groupMappingBySource.get(sourceParent)
          : undefined
      const expectedNodeIds = (sourceGroup?.nodeIds ?? []).flatMap(
        (sourceNodeId) => {
          const instanceNodeId = nodeMappingBySource.get(sourceNodeId)
          return instanceNodeId ? [instanceNodeId] : []
        }
      )
      const valid =
        sourceGroupIds.has(mapping.sourceGroupId) &&
        Boolean(sourceGroup) &&
        Boolean(instanceGroup) &&
        instanceGroup?.pageId === instanceRoot?.pageId &&
        (sourceParent && sourceGroupIds.has(sourceParent)
          ? instanceGroup?.parentGroupId === expectedParent
          : mapping.instanceGroupId === instance.rootGroupId) &&
        stableValue(instanceGroup?.nodeIds) === stableValue(expectedNodeIds)
      if (valid) continue
      issues.push({
        code: "component_instance_mapping_invalid",
        instanceId: instance.id,
        groupId: mapping.instanceGroupId,
        message: `Instance ${instance.name} contains an invalid group hierarchy mapping`,
      })
    }

    const expectedNodes = resolveComponentInstanceNodes(document, instance)
    for (const expected of expectedNodes) {
      const actual = nodes.get(expected.id)
      if (!actual) continue
      for (const property of differingProperties(actual, expected)) {
        issues.push({
          code: "component_instance_stale",
          instanceId: instance.id,
          nodeId: actual.id,
          property,
          message: `Instance ${instance.name} has stale ${property} on ${actual.name}`,
        })
      }
    }
  }

  for (const cycle of componentGraphCycles(document)) {
    issues.push({
      code: "component_cycle",
      componentId: cycle[0],
      message: `Component graph contains a recursive cycle: ${cycle.join(" -> ")}`,
    })
  }

  return issues
}

export function materializeComponentInstances(document: Document): Document {
  if (!document.componentInstances.length) return document

  const dependencies = new Map(
    document.components.map((component) => [component.id, new Set<string>()])
  )
  const instanceByRootGroup = new Map(
    document.componentInstances.map((instance) => [
      instance.rootGroupId,
      instance,
    ])
  )
  for (const component of document.components) {
    const subtree = componentSourceSubtree(document, component.sourceGroupId)
    if (!subtree) continue
    for (const groupId of subtree.groupIds) {
      const nested = instanceByRootGroup.get(groupId)
      if (nested) dependencies.get(component.id)?.add(nested.componentId)
    }
  }

  const orderedComponentIds: string[] = []
  const state = new Map<string, "active" | "done">()
  for (const componentId of dependencies.keys()) {
    if (state.has(componentId)) continue
    const stack: Array<{ id: string; index: number }> = [
      { id: componentId, index: 0 },
    ]
    state.set(componentId, "active")
    while (stack.length) {
      const frame = stack.at(-1)
      if (!frame) break
      const targets = [...(dependencies.get(frame.id) ?? [])]
      const target = targets[frame.index]
      if (target) {
        frame.index += 1
        if (!dependencies.has(target) || state.get(target) === "done") continue
        if (state.get(target) === "active") continue
        state.set(target, "active")
        stack.push({ id: target, index: 0 })
        continue
      }
      state.set(frame.id, "done")
      orderedComponentIds.push(frame.id)
      stack.pop()
    }
  }

  let materialized = document
  for (const componentId of orderedComponentIds) {
    const resolvedById = new Map<string, SceneNode>()
    for (const instance of materialized.componentInstances) {
      if (instance.componentId !== componentId) continue
      for (const node of resolveComponentInstanceNodes(
        materialized,
        instance
      )) {
        resolvedById.set(node.id, node)
      }
    }
    if (!resolvedById.size) continue
    materialized = {
      ...materialized,
      nodes: materialized.nodes.map(
        (node) => resolvedById.get(node.id) ?? node
      ),
    }
  }
  return materialized
}

export function componentOwnsProperty(
  instance: ComponentInstance,
  sourceNodeId: string,
  property: string
) {
  const patch = instance.overrides[sourceNodeId]
  return Boolean(patch && own(patch, property))
}
