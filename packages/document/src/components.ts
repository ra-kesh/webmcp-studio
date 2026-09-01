import { applyTextLayoutPatch } from "./text-layout"
import { normalizeRichTextContent } from "./rich-text"
import {
  sceneNodeSchema,
  type ComponentDefinition,
  type ComponentInstance,
  type Document,
  type GroupDefinition,
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

type ComponentDocumentIndex = {
  componentsById: Map<string, ComponentDefinition>
  groupsById: Map<string, Document["groups"][number]>
  childGroupIdsByParent: Map<string, string[]>
  nodesById: Map<string, SceneNode>
  pagesById: Map<string, Document["pages"][number]>
  pageNodeOrderById: Map<string, Map<string, number>>
  instancesByComponentId: Map<string, ComponentInstance[]>
  sourceSubtrees: Map<string, ComponentSourceSubtree | null>
}

function buildComponentDocumentIndex(
  document: Document
): ComponentDocumentIndex {
  const childGroupIdsByParent = new Map<string, string[]>()
  for (const group of document.groups) {
    if (!group.parentGroupId) continue
    const children = childGroupIdsByParent.get(group.parentGroupId)
    if (children) children.push(group.id)
    else childGroupIdsByParent.set(group.parentGroupId, [group.id])
  }
  const instancesByComponentId = new Map<string, ComponentInstance[]>()
  for (const instance of document.componentInstances) {
    const instances = instancesByComponentId.get(instance.componentId)
    if (instances) instances.push(instance)
    else instancesByComponentId.set(instance.componentId, [instance])
  }
  return {
    componentsById: new Map(
      document.components.map((component) => [component.id, component])
    ),
    groupsById: new Map(document.groups.map((group) => [group.id, group])),
    childGroupIdsByParent,
    nodesById: new Map(document.nodes.map((node) => [node.id, node])),
    pagesById: new Map(document.pages.map((page) => [page.id, page])),
    pageNodeOrderById: new Map(
      document.pages.map((page) => [
        page.id,
        new Map(page.nodeIds.map((nodeId, index) => [nodeId, index])),
      ])
    ),
    instancesByComponentId,
    sourceSubtrees: new Map(),
  }
}

const own = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key)

function mappedGroupNodeId(
  nodeMapping: ReadonlyMap<string, string>,
  sourceNodeId: string,
  sourceGroupId: string
) {
  const instanceNodeId = nodeMapping.get(sourceNodeId)
  if (!instanceNodeId) {
    throw new Error(
      `Component group ${sourceGroupId} has an unmapped layer ${sourceNodeId}`
    )
  }
  return instanceNodeId
}

function materializedGroupDefinition(
  sourceGroup: GroupDefinition,
  current: GroupDefinition,
  nodeMapping: ReadonlyMap<string, string>,
  name: string,
  parentGroupId: string | undefined
): GroupDefinition {
  const common = {
    id: current.id,
    pageId: current.pageId,
    name,
    nodeIds: sourceGroup.nodeIds.map((sourceNodeId) =>
      mappedGroupNodeId(nodeMapping, sourceNodeId, sourceGroup.id)
    ),
    ...(parentGroupId ? { parentGroupId } : {}),
  }
  if (sourceGroup.role === "organize") {
    return { ...common, role: "organize" }
  }
  return {
    ...common,
    role: "mask",
    mask: {
      type: sourceGroup.mask.type,
      sourceNodeIds: sourceGroup.mask.sourceNodeIds.map((sourceNodeId) =>
        mappedGroupNodeId(nodeMapping, sourceNodeId, sourceGroup.id)
      ) as [string, ...string[]],
    },
  }
}

function mappedMaskValue(
  sourceGroup: GroupDefinition,
  nodeMapping: ReadonlyMap<string, string>
) {
  if (sourceGroup.role === "organize") return undefined
  const sourceNodeIds = sourceGroup.mask.sourceNodeIds.map((sourceNodeId) =>
    nodeMapping.get(sourceNodeId)
  )
  if (sourceNodeIds.some((nodeId) => !nodeId)) return null
  return {
    type: sourceGroup.mask.type,
    sourceNodeIds,
  }
}

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

function rotatePoint(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

export function componentSourceSubtree(
  document: Document,
  sourceGroupId: string,
  index?: ComponentDocumentIndex
): ComponentSourceSubtree | null {
  const cached = index?.sourceSubtrees.get(sourceGroupId)
  if (cached !== undefined || index?.sourceSubtrees.has(sourceGroupId)) {
    return cached ?? null
  }
  const root =
    index?.groupsById.get(sourceGroupId) ??
    document.groups.find((group) => group.id === sourceGroupId)
  if (!root) return null

  const groupIds: string[] = []
  const nodeIds: string[] = []
  const visited = new Set<string>()
  const queue = [sourceGroupId]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const groupId = queue[cursor]
    if (!groupId || visited.has(groupId)) continue
    visited.add(groupId)
    const group =
      index?.groupsById.get(groupId) ??
      document.groups.find((candidate) => candidate.id === groupId)
    if (!group) continue
    groupIds.push(group.id)
    nodeIds.push(...group.nodeIds)
    if (index) {
      queue.push(...(index.childGroupIdsByParent.get(group.id) ?? []))
    } else {
      for (const child of document.groups) {
        if (child.parentGroupId === group.id) queue.push(child.id)
      }
    }
  }

  const subtree = {
    groupIds,
    nodeIds: [...new Set(nodeIds)],
  }
  index?.sourceSubtrees.set(sourceGroupId, subtree)
  return subtree
}

export function componentSourceNodes(
  document: Document,
  component: ComponentDefinition,
  index?: ComponentDocumentIndex
): SceneNode[] {
  const subtree = componentSourceSubtree(
    document,
    component.sourceGroupId,
    index
  )
  if (!subtree) return []
  const nodesById =
    index?.nodesById ?? new Map(document.nodes.map((node) => [node.id, node]))
  return subtree.nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId)
    return node ? [node] : []
  })
}

function applyComponentPatch(
  node: SceneNode,
  patch: Record<string, unknown> | undefined,
  removedProperties: readonly string[] = []
): SceneNode {
  if (!patch && !removedProperties.length) return node
  const remove = (value: SceneNode): SceneNode => {
    if (!removedProperties.length) return value
    const mutable = { ...value } as Record<string, unknown>
    for (const property of removedProperties) delete mutable[property]
    return sceneNodeSchema.parse(mutable)
  }
  if (node.type === "text") {
    const textPatch = (patch ?? {}) as TextNodePatch
    const text = textPatch.text ?? node.text
    const textChanged = textPatch.text !== undefined && text !== node.text
    const richText = normalizeRichTextContent(text, {
      runs: textPatch.runs ?? (textChanged ? [] : node.runs),
      paragraphs: textPatch.paragraphs ?? (textChanged ? [] : node.paragraphs),
      links: textPatch.links ?? (textChanged ? [] : node.links),
    })
    return remove(
      sceneNodeSchema.parse(
        applyTextLayoutPatch(node, {
          ...textPatch,
          text,
          ...richText,
        })
      )
    )
  }
  return remove(sceneNodeSchema.parse({ ...node, ...patch }))
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
  if (node.type === "rect" || node.type === "frame") {
    return sceneNodeSchema.parse({
      ...transformed,
      radius: node.radius * scale,
      strokeWidth: node.strokeWidth * scale,
      ...(node.type === "frame"
        ? {
            children: node.children.map((child) => ({
              ...child,
              offsetX: child.offsetX * scale,
              offsetY: child.offsetY * scale,
            })),
            autoLayout: node.autoLayout
              ? {
                  ...node.autoLayout,
                  gap: node.autoLayout.gap * scale,
                  padding: {
                    top: node.autoLayout.padding.top * scale,
                    right: node.autoLayout.padding.right * scale,
                    bottom: node.autoLayout.padding.bottom * scale,
                    left: node.autoLayout.padding.left * scale,
                  },
                }
              : null,
          }
        : {}),
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
  instance: ComponentInstance,
  index?: ComponentDocumentIndex
): SceneNode[] {
  const component =
    index?.componentsById.get(instance.componentId) ??
    document.components.find(
      (candidate) => candidate.id === instance.componentId
    )
  if (!component) return []
  const variant = component.variants.find(
    (candidate) => candidate.id === instance.variantId
  )
  if (!variant) return []
  const sourceNodes = componentSourceNodes(document, component, index)
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
      variant.overrides[sourceNode.id],
      variant.removedProperties?.[sourceNode.id]
    )
    const transformed = transformComponentNode(
      variantNode,
      sourceBounds,
      instance
    )
    const resolved = applyComponentPatch(
      transformed,
      instance.overrides[sourceNode.id],
      instance.removedProperties?.[sourceNode.id]
    )
    return [
      resolved.type === "frame"
        ? {
            ...resolved,
            id: instanceNodeId,
            children: resolved.children.map((child) => ({
              ...child,
              nodeId: mapping.get(child.nodeId) ?? child.nodeId,
            })),
          }
        : { ...resolved, id: instanceNodeId },
    ]
  })
}

/**
 * Keeps instance-owned visual overrides in the same local relationship when
 * the instance root is moved, scaled, or rotated. Overrides are stored as
 * resolved values, so the root transform must rebase the transform-sensitive
 * subset before materialization applies them again.
 */
export function rebaseComponentInstanceOverridesForTransform(
  document: Document,
  instance: ComponentInstance,
  transform: ComponentInstance["transform"]
): ComponentInstance {
  const scaleRatio = transform.scale / instance.transform.scale
  const rotationDelta = transform.rotation - instance.transform.rotation
  const nodeIdBySourceId = new Map(
    instance.nodeMappings.map((mapping) => [
      mapping.sourceNodeId,
      mapping.instanceNodeId,
    ])
  )
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const overrides = Object.fromEntries(
    Object.entries(instance.overrides).map(([sourceNodeId, patch]) => {
      const next = structuredClone(patch) as Record<string, unknown>
      const instanceNodeId = nodeIdBySourceId.get(sourceNodeId)
      const node = instanceNodeId ? nodeById.get(instanceNodeId) : undefined
      const ownsGeometry = ["x", "y", "width", "height", "rotation"].some(
        (property) => own(next, property)
      )
      if (node && ownsGeometry) {
        const oldCenter = {
          x: node.x + node.width / 2,
          y: node.y + node.height / 2,
        }
        const relative = rotatePoint(
          oldCenter.x - instance.transform.x,
          oldCenter.y - instance.transform.y,
          -instance.transform.rotation
        )
        const local = {
          x: relative.x / instance.transform.scale,
          y: relative.y / instance.transform.scale,
        }
        const transformedLocal = rotatePoint(
          local.x * transform.scale,
          local.y * transform.scale,
          transform.rotation
        )
        const width = node.width * scaleRatio
        const height = node.height * scaleRatio
        next.x = transform.x + transformedLocal.x - width / 2
        next.y = transform.y + transformedLocal.y - height / 2
        next.width = width
        next.height = height
        next.rotation = normalizedRotation(node.rotation + rotationDelta)
      }
      for (const property of [
        "fontSize",
        "letterSpacing",
        "strokeWidth",
        "radius",
      ]) {
        if (typeof next[property] === "number") {
          next[property] *= scaleRatio
        }
      }
      if (Array.isArray(next.runs)) {
        next.runs = next.runs.map((run) => {
          if (!run || typeof run !== "object") return run
          const value = structuredClone(run) as Record<string, unknown>
          if (!value.style || typeof value.style !== "object") return value
          const style = { ...(value.style as Record<string, unknown>) }
          if (typeof style.fontSize === "number") {
            style.fontSize *= scaleRatio
          }
          if (typeof style.letterSpacing === "number") {
            style.letterSpacing *= scaleRatio
          }
          value.style = style
          return value
        })
      }
      return [sourceNodeId, next]
    })
  ) as ComponentInstance["overrides"]
  return { ...instance, transform, overrides }
}

export function componentDifferingProperties(
  actual: SceneNode,
  expected: SceneNode
) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  keys.delete("id")
  return [...keys].filter(
    (key) =>
      stableValue(actual[key as keyof SceneNode]) !==
      stableValue(expected[key as keyof SceneNode])
  )
}

function findComponentGraphCycles(
  document: Document,
  index?: ComponentDocumentIndex
): string[][] {
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
    const subtree = componentSourceSubtree(
      document,
      component.sourceGroupId,
      index
    )
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

export function componentGraphCycles(document: Document): string[][] {
  return findComponentGraphCycles(document)
}

export function componentIntegrityIssues(
  document: Document
): ComponentIntegrityIssue[] {
  const issues: ComponentIntegrityIssue[] = []
  const index = buildComponentDocumentIndex(document)
  const groups = index.groupsById
  const nodes = index.nodesById
  const components = index.componentsById
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
    const subtree = componentSourceSubtree(
      document,
      component.sourceGroupId,
      index
    )
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
      const targetNodeIds = new Set([
        ...Object.keys(variant.overrides),
        ...Object.keys(variant.removedProperties ?? {}),
      ])
      for (const nodeId of targetNodeIds) {
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
    const source = componentSourceSubtree(
      document,
      component.sourceGroupId,
      index
    )
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
      const expectedName =
        mapping.sourceGroupId === component.sourceGroupId
          ? instance.name
          : sourceGroup?.name
      const expectedMask = sourceGroup
        ? mappedMaskValue(sourceGroup, nodeMappingBySource)
        : null
      const valid =
        sourceGroupIds.has(mapping.sourceGroupId) &&
        Boolean(sourceGroup) &&
        Boolean(instanceGroup) &&
        instanceGroup?.name === expectedName &&
        instanceGroup?.pageId === instanceRoot?.pageId &&
        (sourceParent && sourceGroupIds.has(sourceParent)
          ? instanceGroup?.parentGroupId === expectedParent
          : mapping.instanceGroupId === instance.rootGroupId) &&
        stableValue(instanceGroup?.nodeIds) === stableValue(expectedNodeIds) &&
        instanceGroup?.role === sourceGroup?.role &&
        expectedMask !== null &&
        stableValue(
          instanceGroup?.role === "mask" ? instanceGroup.mask : undefined
        ) === stableValue(expectedMask)
      if (valid) continue
      issues.push({
        code: "component_instance_mapping_invalid",
        instanceId: instance.id,
        groupId: mapping.instanceGroupId,
        message: `Instance ${instance.name} contains an invalid group hierarchy mapping`,
      })
    }

    const sourceRoot = groups.get(component.sourceGroupId)
    const instanceRootGroup = groups.get(instance.rootGroupId)
    const sourcePage = sourceRoot
      ? index.pagesById.get(sourceRoot.pageId)
      : undefined
    const instancePage = instanceRootGroup
      ? index.pagesById.get(instanceRootGroup.pageId)
      : undefined
    const mappedSourceNodeIds = new Set(source.nodeIds)
    const nodeMappingBySourceForOrder = new Map(
      instance.nodeMappings.map((mapping) => [
        mapping.sourceNodeId,
        mapping.instanceNodeId,
      ])
    )
    const expectedInstanceOrder = sourcePage?.nodeIds.flatMap((nodeId) => {
      if (!mappedSourceNodeIds.has(nodeId)) return []
      const instanceNodeId = nodeMappingBySourceForOrder.get(nodeId)
      return instanceNodeId ? [instanceNodeId] : []
    })
    const instanceNodeOrder = instancePage
      ? index.pageNodeOrderById.get(instancePage.id)
      : undefined
    const actualInstanceOrder = instancePage
      ? instance.nodeMappings
          .map((mapping) => mapping.instanceNodeId)
          .filter((nodeId) => instanceNodeOrder?.has(nodeId))
          .sort(
            (left, right) =>
              (instanceNodeOrder?.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (instanceNodeOrder?.get(right) ?? Number.MAX_SAFE_INTEGER)
          )
      : undefined
    if (
      stableValue(expectedInstanceOrder) !== stableValue(actualInstanceOrder)
    ) {
      issues.push({
        code: "component_instance_mapping_invalid",
        instanceId: instance.id,
        groupId: instance.rootGroupId,
        message: `Instance ${instance.name} has a stale materialized layer order`,
      })
    }

    const expectedNodes = resolveComponentInstanceNodes(
      document,
      instance,
      index
    )
    for (const expected of expectedNodes) {
      const actual = nodes.get(expected.id)
      if (!actual) continue
      for (const property of componentDifferingProperties(actual, expected)) {
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

  for (const cycle of findComponentGraphCycles(document, index)) {
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

  const initialIndex = buildComponentDocumentIndex(document)
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
    const subtree = componentSourceSubtree(
      document,
      component.sourceGroupId,
      initialIndex
    )
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
    const index = buildComponentDocumentIndex(materialized)
    const resolvedById = new Map<string, SceneNode>()
    const component = index.componentsById.get(componentId)
    const groupUpdates = new Map<string, Document["groups"][number]>()
    const pageOrderEntries = new Map<
      string,
      Array<{
        orderedNodeIds: string[]
        mappedNodeIds: Set<string>
        insertionIndex: number
      }>
    >()
    const source = component
      ? componentSourceSubtree(materialized, component.sourceGroupId, index)
      : null
    const sourceGroups = new Map(
      (source?.groupIds ?? []).flatMap((groupId) => {
        const group = index.groupsById.get(groupId)
        return group ? [[group.id, group] as const] : []
      })
    )
    const sourceRoot = component
      ? sourceGroups.get(component.sourceGroupId)
      : undefined
    const sourcePage = sourceRoot
      ? index.pagesById.get(sourceRoot.pageId)
      : undefined
    const sourceSet = new Set(source?.nodeIds ?? [])

    for (const instance of index.instancesByComponentId.get(componentId) ??
      []) {
      for (const node of resolveComponentInstanceNodes(
        materialized,
        instance,
        index
      )) {
        resolvedById.set(node.id, node)
      }
      if (!component || !source) continue
      const root = index.groupsById.get(instance.rootGroupId)
      if (!root) continue
      const nodeMapping = new Map(
        instance.nodeMappings.map((mapping) => [
          mapping.sourceNodeId,
          mapping.instanceNodeId,
        ])
      )
      const groupMapping = new Map(
        instance.groupMappings.map((mapping) => [
          mapping.sourceGroupId,
          mapping.instanceGroupId,
        ])
      )
      if (
        nodeMapping.size !== instance.nodeMappings.length ||
        source.nodeIds.some((sourceNodeId) => !nodeMapping.has(sourceNodeId)) ||
        groupMapping.size !== instance.groupMappings.length ||
        source.groupIds.some(
          (sourceGroupId) => !groupMapping.has(sourceGroupId)
        )
      ) {
        throw new Error(
          `Component instance ${instance.id} must map its complete source subtree`
        )
      }
      for (const mapping of instance.groupMappings) {
        const sourceGroup = sourceGroups.get(mapping.sourceGroupId)
        const current = index.groupsById.get(mapping.instanceGroupId)
        if (!sourceGroup || !current) continue
        const sourceParent = sourceGroup.parentGroupId
        const parentGroupId =
          sourceGroup.id === component.sourceGroupId
            ? current.parentGroupId
            : sourceParent
              ? groupMapping.get(sourceParent)
              : undefined
        groupUpdates.set(
          current.id,
          materializedGroupDefinition(
            sourceGroup,
            current,
            nodeMapping,
            sourceGroup.id === component.sourceGroupId
              ? instance.name
              : sourceGroup.name,
            parentGroupId
          )
        )
      }

      const targetPage = index.pagesById.get(root.pageId)
      if (!sourcePage || !targetPage) continue
      const orderedInstanceNodeIds = sourcePage.nodeIds.flatMap(
        (sourceNodeId) => {
          if (!sourceSet.has(sourceNodeId)) return []
          const instanceNodeId = nodeMapping.get(sourceNodeId)
          return instanceNodeId ? [instanceNodeId] : []
        }
      )
      const mapped = new Set(orderedInstanceNodeIds)
      const order = index.pageNodeOrderById.get(targetPage.id)
      const insertionIndex = Math.min(
        ...orderedInstanceNodeIds.map(
          (nodeId) => order?.get(nodeId) ?? Number.MAX_SAFE_INTEGER
        )
      )
      const entries = pageOrderEntries.get(targetPage.id)
      const entry = {
        orderedNodeIds: orderedInstanceNodeIds,
        mappedNodeIds: mapped,
        insertionIndex,
      }
      if (entries) entries.push(entry)
      else pageOrderEntries.set(targetPage.id, [entry])
    }
    const pageOrderUpdates = new Map<string, string[]>()
    for (const [pageId, entries] of pageOrderEntries) {
      const page = index.pagesById.get(pageId)
      if (!page) continue
      const mappedNodeIds = new Set(
        entries.flatMap((entry) => [...entry.mappedNodeIds])
      )
      const insertions = new Map<number, string[]>()
      const appended: string[] = []
      for (const entry of entries) {
        if (entry.insertionIndex === Number.MAX_SAFE_INTEGER) {
          appended.push(...entry.orderedNodeIds)
          continue
        }
        const insertion = insertions.get(entry.insertionIndex)
        if (insertion) insertion.push(...entry.orderedNodeIds)
        else insertions.set(entry.insertionIndex, [...entry.orderedNodeIds])
      }
      const nodeIds: string[] = []
      for (let position = 0; position < page.nodeIds.length; position += 1) {
        nodeIds.push(...(insertions.get(position) ?? []))
        const nodeId = page.nodeIds[position]
        if (nodeId && !mappedNodeIds.has(nodeId)) nodeIds.push(nodeId)
      }
      nodeIds.push(...appended)
      pageOrderUpdates.set(pageId, nodeIds)
    }
    if (!resolvedById.size && !groupUpdates.size && !pageOrderUpdates.size) {
      continue
    }
    materialized = {
      ...materialized,
      nodes: materialized.nodes.map(
        (node) => resolvedById.get(node.id) ?? node
      ),
      groups: materialized.groups.map(
        (group) => groupUpdates.get(group.id) ?? group
      ),
      pages: materialized.pages.map((page) => {
        const nodeIds = pageOrderUpdates.get(page.id)
        return nodeIds ? { ...page, nodeIds } : page
      }),
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
  return Boolean(
    (patch && own(patch, property)) ||
    instance.removedProperties?.[sourceNodeId]?.some(
      (candidate) => candidate === property
    )
  )
}
