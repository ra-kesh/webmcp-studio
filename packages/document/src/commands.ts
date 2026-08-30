import {
  designVariableSchema,
  documentCommandSchema,
  documentSchema,
  fieldDefinitionSchema,
  sceneNodePatchSchema,
  textNodePatchSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
  type TextNodePatch,
} from "./schema"
import {
  fieldCanBindToProperty,
  fieldDefinitionValidationMessage,
  fieldValueSatisfiesDefinition,
  formatFieldValueForText,
  normalizeFieldValueForStorage,
} from "./fields"
import {
  assetReferenceKeysForSource,
  localAssetIdFromSource,
  managedAssetIdFromSource,
} from "./media"
import { applyTextLayoutPatch } from "./text-layout"
import { normalizeRichTextContent } from "./rich-text"
import {
  applyPaintStyleToTarget,
  applyTypographyStyleToTarget,
  designStyleUsage,
  detachPaintStyleFromTarget,
  detachStyleForDirectNodePatch,
  detachTypographyStyleFromTarget,
  propagatePaintStyle,
  propagateTypographyStyle,
} from "./design-styles"
import {
  applyVariableToBinding,
  assertVariableBindingCompatible,
  detachVariableBindingsForNodePatch,
  detachVariableBindingsForStyleTargets,
  detachVariableBindingsForStylePatch,
  variableUsage,
} from "./variables"
import {
  componentSourceSubtree,
  materializeComponentInstances,
  resolveComponentInstanceNodes,
} from "./components"
import { assertValidCanonicalDocument, assertValidDocument } from "./validation"

type FieldValue = string | number | boolean

function normalizeTextNodePatch(
  node: Extract<SceneNode, { type: "text" }>,
  patch: TextNodePatch
): TextNodePatch {
  const text = patch.text ?? node.text
  const textChanged = patch.text !== undefined && patch.text !== node.text
  const content = normalizeRichTextContent(text, {
    runs: patch.runs ?? (textChanged ? [] : node.runs),
    paragraphs: patch.paragraphs ?? (textChanged ? [] : node.paragraphs),
    links: patch.links ?? (textChanged ? [] : node.links),
  })
  return {
    ...patch,
    runs: content.runs,
    paragraphs: content.paragraphs,
    links: content.links,
  }
}

function groupNodeIds(
  groups: Document["groups"],
  groupId: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(groupId)) return []
  visited.add(groupId)
  const group = groups.find((candidate) => candidate.id === groupId)
  if (!group) return []
  return [
    ...group.nodeIds,
    ...groups
      .filter((candidate) => candidate.parentGroupId === groupId)
      .flatMap((candidate) => groupNodeIds(groups, candidate.id, visited)),
  ]
}

function compactNodeBlock(
  pageNodeIds: readonly string[],
  blockNodeIds: readonly string[],
  edge: "front" | "back" = "front"
) {
  const block = new Set(blockNodeIds)
  const orderedBlock = pageNodeIds.filter((nodeId) => block.has(nodeId))
  const remaining = pageNodeIds.filter((nodeId) => !block.has(nodeId))
  const originalIndexes = orderedBlock.map((nodeId) =>
    pageNodeIds.indexOf(nodeId)
  )
  const edgeIndex =
    edge === "front"
      ? Math.max(...originalIndexes)
      : Math.min(...originalIndexes)
  const toIndex = remaining.filter((nodeId) => {
    const index = pageNodeIds.indexOf(nodeId)
    return edge === "front" ? index < edgeIndex : index <= edgeIndex
  }).length
  return [
    ...remaining.slice(0, toIndex),
    ...orderedBlock,
    ...remaining.slice(toIndex),
  ]
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

function pruneEmptyGroups(groups: Document["groups"]): Document["groups"] {
  let remaining = groups

  while (true) {
    const groupsWithChildren = new Set(
      remaining.flatMap((group) =>
        group.parentGroupId ? [group.parentGroupId] : []
      )
    )
    const pruned = remaining.filter(
      (group) => group.nodeIds.length > 0 || groupsWithChildren.has(group.id)
    )

    if (pruned.length === remaining.length) return remaining
    remaining = pruned
  }
}

function applyValue(
  node: SceneNode,
  property: string,
  value: FieldValue,
  field: Pick<Document["fields"][number], "type">
): SceneNode {
  if (property === "text" && node.type === "text") {
    const text = formatFieldValueForText(field, value)
    if (node.text === text) return node
    return applyTextLayoutPatch(node, normalizeTextNodePatch(node, { text }))
  }
  if (property === "src" && node.type === "image") {
    const src = String(value)
    const projectedAssetId =
      managedAssetIdFromSource(src) ?? localAssetIdFromSource(src)
    if (
      node.src === src &&
      (!projectedAssetId || node.assetId === projectedAssetId)
    ) {
      return node
    }
    return {
      ...node,
      ...(projectedAssetId ? { assetId: projectedAssetId } : {}),
      src,
    }
  }
  if (property === "visible") {
    const visible = Boolean(value)
    return node.visible === visible ? node : { ...node, visible }
  }
  if (
    property === "fill" &&
    (node.type === "rect" || node.type === "ellipse" || node.type === "icon")
  ) {
    const fill = String(value)
    return node.fill === fill ? node : { ...node, fill }
  }
  return node
}

export function applyFieldValues(document: Document): Document {
  const fields = new Map(document.fields.map((field) => [field.id, field]))
  const bindingsByNode = new Map<string, typeof document.bindings>()
  for (const binding of document.bindings) {
    const bindings = bindingsByNode.get(binding.nodeId) ?? []
    bindings.push(binding)
    bindingsByNode.set(binding.nodeId, bindings)
  }

  let changed = false
  const nodes = document.nodes.map((node) => {
    let next = node
    for (const binding of bindingsByNode.get(node.id) ?? []) {
      const value = document.fieldValues[binding.fieldId]
      const field = fields.get(binding.fieldId)
      if (value !== undefined && field) {
        next = applyValue(next, binding.property, value, field)
      }
    }
    if (next !== node) changed = true
    return next
  })

  return changed ? { ...document, nodes } : document
}

type SemanticClonePayload = {
  pageId: string
  nodes: Document["nodes"]
  groups: Document["groups"]
  componentInstances: Document["componentInstances"]
  bindings: Document["bindings"]
  variableBindings: Document["variableBindings"]
}

function appendSemanticClone(
  document: Document,
  payload: SemanticClonePayload
): Document {
  const page = document.pages.find(
    (candidate) => candidate.id === payload.pageId
  )
  if (!page) throw new Error(`Unknown page: ${payload.pageId}`)

  const nodeIds = new Set(payload.nodes.map((node) => node.id))
  const groupIds = new Set(payload.groups.map((group) => group.id))
  const bindingIds = new Set(payload.bindings.map((binding) => binding.id))
  const variableBindingIds = new Set(
    payload.variableBindings.map((binding) => binding.id)
  )
  const componentInstanceIds = new Set(
    payload.componentInstances.map((instance) => instance.id)
  )
  if (
    nodeIds.size !== payload.nodes.length ||
    groupIds.size !== payload.groups.length ||
    bindingIds.size !== payload.bindings.length ||
    variableBindingIds.size !== payload.variableBindings.length ||
    componentInstanceIds.size !== payload.componentInstances.length ||
    payload.nodes.some((node) =>
      document.nodes.some((existing) => existing.id === node.id)
    ) ||
    payload.groups.some((group) =>
      document.groups.some((existing) => existing.id === group.id)
    ) ||
    payload.bindings.some((binding) =>
      document.bindings.some((existing) => existing.id === binding.id)
    ) ||
    payload.variableBindings.some((binding) =>
      document.variableBindings.some((existing) => existing.id === binding.id)
    ) ||
    payload.componentInstances.some((instance) =>
      document.componentInstances.some(
        (existing) => existing.id === instance.id
      )
    )
  ) {
    throw new Error("The semantic clone contains conflicting identifiers")
  }

  if (
    payload.groups.some(
      (group) =>
        group.pageId !== page.id ||
        group.nodeIds.some((nodeId) => !nodeIds.has(nodeId)) ||
        (group.parentGroupId && !groupIds.has(group.parentGroupId))
    )
  ) {
    throw new Error("The semantic clone contains invalid group references")
  }

  if (
    payload.componentInstances.some(
      (instance) =>
        !document.components.some(
          (component) => component.id === instance.componentId
        ) ||
        instance.nodeMappings.some(
          (mapping) => !nodeIds.has(mapping.instanceNodeId)
        ) ||
        instance.groupMappings.some(
          (mapping) => !groupIds.has(mapping.instanceGroupId)
        )
    )
  ) {
    throw new Error("The semantic clone contains an invalid component instance")
  }

  for (const binding of payload.bindings) {
    const field = document.fields.find(
      (candidate) => candidate.id === binding.fieldId
    )
    const node = payload.nodes.find(
      (candidate) => candidate.id === binding.nodeId
    )
    const targetAlreadyBound =
      document.bindings.some(
        (existing) =>
          existing.nodeId === binding.nodeId &&
          existing.property === binding.property
      ) ||
      payload.bindings.some(
        (candidate) =>
          candidate.id !== binding.id &&
          candidate.nodeId === binding.nodeId &&
          candidate.property === binding.property
      )
    if (
      !field ||
      !node ||
      targetAlreadyBound ||
      !fieldCanBindToProperty(field, node, binding.property)
    ) {
      throw new Error("The semantic clone contains an invalid binding")
    }
  }

  let next = applyFieldValues({
    ...document,
    pages: document.pages.map((candidate) =>
      candidate.id === page.id
        ? {
            ...candidate,
            nodeIds: [
              ...candidate.nodeIds,
              ...payload.nodes.map((node) => node.id),
            ],
          }
        : candidate
    ),
    nodes: [...document.nodes, ...payload.nodes],
    groups: [...document.groups, ...payload.groups],
    componentInstances: [
      ...document.componentInstances,
      ...payload.componentInstances,
    ],
    bindings: [...document.bindings, ...payload.bindings],
  })
  for (const binding of payload.variableBindings) {
    const target = binding.target
    if (
      (target.kind !== "node" && target.kind !== "text_range") ||
      !nodeIds.has(target.nodeId)
    ) {
      throw new Error("The semantic clone contains an invalid variable target")
    }
    const variable = next.variables.find(
      (candidate) => candidate.id === binding.variableId
    )
    if (!variable) {
      throw new Error("The semantic clone contains an unknown variable")
    }
    assertVariableBindingCompatible(next, binding, variable)
    next = applyVariableToBinding(
      {
        ...next,
        variableBindings: [...next.variableBindings, binding],
      },
      binding,
      variable
    )
  }
  return next
}

type AssetReferenceRelink = Readonly<{
  from: string
  toAssetId: string
  toSource: string
  expectedReferenceKeys: readonly string[]
}>

/**
 * Shared aggregate boundary for local-to-managed promotion and local-to-local
 * reidentity. Target identity policy stays with each command, while the exact
 * source preflight and canonical field/binding projection cannot drift.
 */
function relinkAssetReferences(
  document: Document,
  command: AssetReferenceRelink
): Document {
  const localAssetId = localAssetIdFromSource(command.from)
  if (!localAssetId) {
    throw new Error("The source is not a valid local asset identity")
  }

  const currentReferenceKeys = assetReferenceKeysForSource(
    document,
    command.from
  )
  if (!currentReferenceKeys.length) {
    throw new Error("The local asset has no references to relink")
  }
  if (
    currentReferenceKeys.length !== command.expectedReferenceKeys.length ||
    currentReferenceKeys.some(
      (key, index) => key !== command.expectedReferenceKeys[index]
    )
  ) {
    throw new Error("The local asset reference set changed after preflight")
  }

  const fieldsById = new Map(
    document.fields.map((field) => [field.id, field] as const)
  )
  const sourceBindingByNodeId = new Map(
    document.bindings
      .filter((binding) => binding.property === "src")
      .map((binding) => [binding.nodeId, binding] as const)
  )
  for (const node of document.nodes) {
    if (node.type !== "image") continue
    const binding = sourceBindingByNodeId.get(node.id)
    const boundValue = binding
      ? document.fieldValues[binding.fieldId]
      : undefined
    const sourceMatches = node.src === command.from
    const identityMatches = node.assetId === localAssetId

    if (sourceMatches !== identityMatches) {
      throw new Error(`Image ${node.id} has an incoherent local identity`)
    }
    if (binding) {
      const field = fieldsById.get(binding.fieldId)
      const fieldProjectsSource =
        field?.type === "asset" && boundValue === command.from
      if (sourceMatches !== fieldProjectsSource) {
        throw new Error(
          `Bound image ${node.id} is not an exact projection of its asset field`
        )
      }
    }
  }
  if (applyFieldValues(document) !== document) {
    throw new Error(
      "The document has unrelated field projection changes to resolve before relinking this asset"
    )
  }

  const fields = document.fields.map((field) =>
    field.type === "asset" && field.defaultValue === command.from
      ? { ...field, defaultValue: command.toSource }
      : field
  )
  const fieldValues = { ...document.fieldValues }
  for (const field of document.fields) {
    if (field.type === "asset" && fieldValues[field.id] === command.from) {
      fieldValues[field.id] = command.toSource
    }
  }
  const nodes = document.nodes.map((node) => {
    if (node.type !== "image" || node.src !== command.from) return node
    if (sourceBindingByNodeId.has(node.id)) return node
    return {
      ...node,
      assetId: command.toAssetId,
      src: command.toSource,
    }
  })
  return { ...document, fields, fieldValues, nodes }
}

function createMaterializedComponentInstance(
  document: Document,
  command: Extract<DocumentCommand, { type: "create_component_instance" }>
): Document {
  const component = document.components.find(
    (candidate) => candidate.id === command.instance.componentId
  )
  if (!component) {
    throw new Error(`Unknown component: ${command.instance.componentId}`)
  }
  if (
    document.componentInstances.some(
      (instance) => instance.id === command.instance.id
    )
  ) {
    throw new Error(`Component instance already exists: ${command.instance.id}`)
  }
  const page = document.pages.find(
    (candidate) => candidate.id === command.pageId
  )
  if (!page) throw new Error(`Unknown page: ${command.pageId}`)
  const parent = command.parentGroupId
    ? document.groups.find((group) => group.id === command.parentGroupId)
    : undefined
  if (command.parentGroupId && (!parent || parent.pageId !== page.id)) {
    throw new Error(
      "A component instance parent must belong to its target page"
    )
  }
  if (
    command.parentGroupId &&
    document.componentInstances.some((instance) =>
      componentSourceSubtree(document, instance.rootGroupId)?.groupIds.includes(
        command.parentGroupId!
      )
    )
  ) {
    throw new Error(
      "Structural insertion inside a component instance is blocked"
    )
  }

  const source = componentSourceSubtree(document, component.sourceGroupId)
  if (!source)
    throw new Error(`Component ${component.name} has no source group`)
  const groupMapping = new Map(
    command.instance.groupMappings.map((mapping) => [
      mapping.sourceGroupId,
      mapping.instanceGroupId,
    ])
  )
  const nodeMapping = new Map(
    command.instance.nodeMappings.map((mapping) => [
      mapping.sourceNodeId,
      mapping.instanceNodeId,
    ])
  )
  const createdGroupIds = new Set(groupMapping.values())
  const createdNodeIds = new Set(nodeMapping.values())
  if (
    document.groups.some((group) => createdGroupIds.has(group.id)) ||
    document.nodes.some((node) => createdNodeIds.has(node.id))
  ) {
    throw new Error("A component instance layer or group ID is already in use")
  }
  const sourceGroups = new Map(
    document.groups
      .filter((group) => source.groupIds.includes(group.id))
      .map((group) => [group.id, group])
  )
  const groups = source.groupIds.map((sourceGroupId) => {
    const sourceGroup = sourceGroups.get(sourceGroupId)
    const instanceGroupId = groupMapping.get(sourceGroupId)
    if (!sourceGroup || !instanceGroupId) {
      throw new Error("A component instance must map every source group")
    }
    const parentGroupId =
      sourceGroupId === component.sourceGroupId
        ? command.parentGroupId
        : sourceGroup.parentGroupId
          ? groupMapping.get(sourceGroup.parentGroupId)
          : undefined
    return {
      id: instanceGroupId,
      pageId: page.id,
      name:
        sourceGroupId === component.sourceGroupId
          ? command.instance.name
          : sourceGroup.name,
      nodeIds: sourceGroup.nodeIds.map((sourceNodeId) => {
        const instanceNodeId = nodeMapping.get(sourceNodeId)
        if (!instanceNodeId) {
          throw new Error("A component instance must map every source layer")
        }
        return instanceNodeId
      }),
      ...(parentGroupId ? { parentGroupId } : {}),
    }
  })
  const nodes = resolveComponentInstanceNodes(document, command.instance)
  if (nodes.length !== source.nodeIds.length) {
    throw new Error("A component instance must resolve every source layer")
  }
  return materializeComponentInstances({
    ...document,
    nodes: [...document.nodes, ...nodes],
    pages: document.pages.map((candidate) =>
      candidate.id === page.id
        ? {
            ...candidate,
            nodeIds: [...candidate.nodeIds, ...nodes.map((node) => node.id)],
          }
        : candidate
    ),
    groups: [...document.groups, ...groups],
    componentInstances: [...document.componentInstances, command.instance],
  })
}

function withComponentInstanceOverride(
  document: Document,
  instanceId: string,
  sourceNodeId: string,
  patch: Readonly<Record<string, unknown>>
): Document {
  const instance = document.componentInstances.find(
    (candidate) => candidate.id === instanceId
  )
  if (!instance) throw new Error(`Unknown component instance: ${instanceId}`)
  if (
    !instance.nodeMappings.some(
      (mapping) => mapping.sourceNodeId === sourceNodeId
    )
  ) {
    throw new Error(
      `Layer ${sourceNodeId} is not part of instance ${instance.name}`
    )
  }
  return {
    ...document,
    componentInstances: document.componentInstances.map((candidate) =>
      candidate.id === instance.id
        ? {
            ...candidate,
            overrides: {
              ...candidate.overrides,
              [sourceNodeId]: {
                ...candidate.overrides[sourceNodeId],
                ...patch,
              },
            },
          }
        : candidate
    ),
  }
}

function synchronizeAfterDirectNodeUpdate(
  before: Document,
  updated: Document,
  command: Extract<DocumentCommand, { type: "update_node" }>
): Document {
  const owningInstance = before.componentInstances.find((instance) =>
    instance.nodeMappings.some(
      (mapping) => mapping.instanceNodeId === command.nodeId
    )
  )
  let synchronized = updated
  if (owningInstance) {
    const mapping = owningInstance.nodeMappings.find(
      (candidate) => candidate.instanceNodeId === command.nodeId
    )
    if (mapping) {
      synchronized = withComponentInstanceOverride(
        synchronized,
        owningInstance.id,
        mapping.sourceNodeId,
        command.patch
      )
    }
  }
  const sourceChanged = before.components.some((component) =>
    componentSourceSubtree(before, component.sourceGroupId)?.nodeIds.includes(
      command.nodeId
    )
  )
  return owningInstance || sourceChanged
    ? materializeComponentInstances(synchronized)
    : synchronized
}

function applyParsedCommand(
  document: Document,
  command: DocumentCommand,
  validateResult: (document: Document) => Document
): Document {
  let next: Document

  switch (command.type) {
    case "set_field": {
      const field = document.fields.find(
        (candidate) => candidate.id === command.fieldId
      )
      if (!field) {
        throw new Error(`Unknown field: ${command.fieldId}`)
      }
      if (!fieldValueSatisfiesDefinition(field, command.value)) {
        throw new Error(`Invalid value for ${field.label}`)
      }
      if (
        field.type === "asset" &&
        command.value === "" &&
        document.bindings.some(
          (binding) =>
            binding.fieldId === field.id && binding.property === "src"
        )
      ) {
        throw new Error(
          `${field.label} cannot be cleared while it is bound to an image layer`
        )
      }
      const value = normalizeFieldValueForStorage(field, command.value)
      next = applyFieldValues({
        ...document,
        fieldValues: {
          ...document.fieldValues,
          [command.fieldId]: value,
        },
      })
      break
    }
    case "add_field": {
      if (
        document.fields.some(
          (field) =>
            field.id === command.field.id || field.key === command.field.key
        )
      ) {
        throw new Error(`Field already exists: ${command.field.key}`)
      }
      if (fieldDefinitionValidationMessage(command.field)) {
        throw new Error(`Invalid default value for ${command.field.label}`)
      }
      const defaultValue = normalizeFieldValueForStorage(
        command.field,
        command.field.defaultValue
      )
      const field = { ...command.field, defaultValue }
      next = {
        ...document,
        fields: [...document.fields, field],
        fieldValues: {
          ...document.fieldValues,
          [command.field.id]: defaultValue,
        },
      }
      break
    }
    case "update_field": {
      const field = document.fields.find(
        (candidate) => candidate.id === command.fieldId
      )
      if (!field) throw new Error(`Unknown field: ${command.fieldId}`)
      const updatedDraft = fieldDefinitionSchema.parse({
        ...field,
        ...command.patch,
        id: field.id,
      })
      const updated = fieldDefinitionSchema.parse({
        ...updatedDraft,
        defaultValue:
          command.patch.defaultValue !== undefined ||
          command.patch.type !== undefined
            ? normalizeFieldValueForStorage(
                updatedDraft,
                updatedDraft.defaultValue
              )
            : updatedDraft.defaultValue,
      })
      if (
        document.fields.some(
          (candidate) =>
            candidate.id !== field.id && candidate.key === updated.key
        )
      ) {
        throw new Error(`Field key already exists: ${updated.key}`)
      }
      if (fieldDefinitionValidationMessage(updated)) {
        throw new Error(`Invalid default value for ${updated.label}`)
      }
      const currentValue = document.fieldValues[field.id]
      const canPreserveCurrentValue =
        currentValue !== undefined &&
        fieldValueSatisfiesDefinition(updated, currentValue)
      const nextFieldValue = canPreserveCurrentValue
        ? normalizeFieldValueForStorage(updated, currentValue)
        : updated.defaultValue
      next = {
        ...document,
        fields: document.fields.map((candidate) =>
          candidate.id === field.id ? updated : candidate
        ),
        fieldValues: {
          ...document.fieldValues,
          [field.id]: nextFieldValue,
        },
        bindings: document.bindings.filter((binding) => {
          if (binding.fieldId !== field.id) return true
          const node = document.nodes.find(
            (candidate) => candidate.id === binding.nodeId
          )
          return node
            ? fieldCanBindToProperty(updated, node, binding.property)
            : false
        }),
      }
      break
    }
    case "remove_field": {
      if (!document.fields.some((field) => field.id === command.fieldId)) {
        throw new Error(`Unknown field: ${command.fieldId}`)
      }
      const fieldValues = { ...document.fieldValues }
      delete fieldValues[command.fieldId]
      next = {
        ...document,
        fields: document.fields.filter((field) => field.id !== command.fieldId),
        fieldValues,
        bindings: document.bindings.filter(
          (binding) => binding.fieldId !== command.fieldId
        ),
      }
      break
    }
    case "bind_field": {
      const field = document.fields.find(
        (candidate) => candidate.id === command.binding.fieldId
      )
      const node = document.nodes.find(
        (candidate) => candidate.id === command.binding.nodeId
      )
      if (!field || !node) throw new Error("The field or layer does not exist")
      if (
        document.bindings.some(
          (binding) =>
            binding.id === command.binding.id ||
            (binding.nodeId === command.binding.nodeId &&
              binding.property === command.binding.property)
        )
      ) {
        throw new Error("That layer property is already bound")
      }
      if (
        document.variableBindings.some(
          (binding) =>
            binding.target.kind === "node" &&
            binding.target.nodeId === command.binding.nodeId &&
            binding.target.property === command.binding.property
        )
      ) {
        throw new Error(
          "That layer property is already controlled by a variable"
        )
      }
      if (!fieldCanBindToProperty(field, node, command.binding.property)) {
        throw new Error(`${field.label} cannot bind to ${node.name}`)
      }
      const currentValue = document.fieldValues[field.id]
      if (
        currentValue === undefined ||
        !fieldValueSatisfiesDefinition(field, currentValue) ||
        (field.type === "asset" && currentValue === "")
      ) {
        throw new Error(`${field.label} needs a valid value before binding`)
      }
      next = applyFieldValues({
        ...document,
        bindings: [...document.bindings, command.binding],
      })
      break
    }
    case "unbind_field": {
      if (
        !document.bindings.some((binding) => binding.id === command.bindingId)
      ) {
        throw new Error(`Unknown binding: ${command.bindingId}`)
      }
      next = {
        ...document,
        bindings: document.bindings.filter(
          (binding) => binding.id !== command.bindingId
        ),
      }
      break
    }
    case "add_node": {
      if (document.nodes.some((node) => node.id === command.node.id)) {
        throw new Error(`Node already exists: ${command.node.id}`)
      }
      const pageExists = document.pages.some(
        (page) => page.id === command.pageId
      )
      if (!pageExists) throw new Error(`Unknown page: ${command.pageId}`)
      next = {
        ...document,
        nodes: [...document.nodes, command.node],
        pages: document.pages.map((page) =>
          page.id === command.pageId
            ? { ...page, nodeIds: [...page.nodeIds, command.node.id] }
            : page
        ),
      }
      break
    }
    case "update_node": {
      const index = document.nodes.findIndex(
        (node) => node.id === command.nodeId
      )
      if (index < 0) throw new Error(`Unknown node: ${command.nodeId}`)
      const current = document.nodes[index]
      if (
        current?.type === "image" &&
        ("src" in command.patch || "assetId" in command.patch) &&
        document.bindings.some(
          (binding) =>
            binding.nodeId === current.id && binding.property === "src"
        )
      ) {
        throw new Error(
          `Image source is bound to a field. Update the field or unbind Source before replacing this layer.`
        )
      }
      const directPatchBase = current
        ? detachStyleForDirectNodePatch(current, command.patch)
        : current
      const updated =
        current?.type === "text"
          ? applyTextLayoutPatch(
              directPatchBase as Extract<SceneNode, { type: "text" }>,
              normalizeTextNodePatch(
                current,
                textNodePatchSchema.parse(command.patch)
              )
            )
          : current?.type === "image" && "alt" in command.patch
            ? {
                ...current,
                ...command.patch,
                id: command.nodeId,
                altProvenance: command.patch.altProvenance ?? "authored",
              }
            : { ...directPatchBase, ...command.patch, id: command.nodeId }
      const nodes = [...document.nodes]
      nodes[index] = updated as SceneNode
      next = {
        ...document,
        nodes,
        variableBindings: detachVariableBindingsForNodePatch(
          document,
          command.nodeId,
          command.patch
        ),
      }
      next = synchronizeAfterDirectNodeUpdate(document, next, command)
      break
    }
    case "create_component": {
      if (
        document.components.some(
          (component) =>
            component.id === command.component.id ||
            component.sourceGroupId === command.component.sourceGroupId
        )
      ) {
        throw new Error("The component ID or source group is already in use")
      }
      if (
        !document.groups.some(
          (group) => group.id === command.component.sourceGroupId
        )
      ) {
        throw new Error(
          `Unknown component source group: ${command.component.sourceGroupId}`
        )
      }
      next = {
        ...document,
        components: [...document.components, command.component],
      }
      break
    }
    case "update_component": {
      const component = document.components.find(
        (candidate) => candidate.id === command.componentId
      )
      if (!component)
        throw new Error(`Unknown component: ${command.componentId}`)
      const updated = { ...component, ...command.patch, id: component.id }
      if (
        !updated.variants.some(
          (variant) => variant.id === updated.defaultVariantId
        )
      ) {
        throw new Error("The default variant must belong to the component")
      }
      next = {
        ...document,
        components: document.components.map((candidate) =>
          candidate.id === component.id ? updated : candidate
        ),
      }
      break
    }
    case "delete_component": {
      const component = document.components.find(
        (candidate) => candidate.id === command.componentId
      )
      if (!component)
        throw new Error(`Unknown component: ${command.componentId}`)
      const dependants = document.componentInstances.filter(
        (instance) => instance.componentId === component.id
      )
      if (dependants.length && command.dependentPolicy === "reject") {
        throw new Error(
          `Component ${component.name} still has ${dependants.length} instance${
            dependants.length === 1 ? "" : "s"
          }`
        )
      }
      const dependantIds = new Set(dependants.map((instance) => instance.id))
      next = {
        ...document,
        components: document.components.filter(
          (candidate) => candidate.id !== component.id
        ),
        componentInstances: document.componentInstances.filter(
          (instance) => !dependantIds.has(instance.id)
        ),
      }
      break
    }
    case "create_component_variant": {
      const component = document.components.find(
        (candidate) => candidate.id === command.componentId
      )
      if (!component)
        throw new Error(`Unknown component: ${command.componentId}`)
      if (
        component.variants.some(
          (variant) =>
            variant.id === command.variant.id ||
            variant.name === command.variant.name
        )
      ) {
        throw new Error(
          `Component variant already exists: ${command.variant.name}`
        )
      }
      next = {
        ...document,
        components: document.components.map((candidate) =>
          candidate.id === component.id
            ? {
                ...candidate,
                variants: [...candidate.variants, command.variant],
              }
            : candidate
        ),
      }
      break
    }
    case "update_component_variant": {
      const component = document.components.find(
        (candidate) => candidate.id === command.componentId
      )
      const variant = component?.variants.find(
        (candidate) => candidate.id === command.variantId
      )
      if (!component || !variant) {
        throw new Error(`Unknown component variant: ${command.variantId}`)
      }
      const updatedVariant = { ...variant, ...command.patch, id: variant.id }
      if (
        component.variants.some(
          (candidate) =>
            candidate.id !== variant.id &&
            candidate.name === updatedVariant.name
        )
      ) {
        throw new Error(
          `Component variant already exists: ${updatedVariant.name}`
        )
      }
      next = materializeComponentInstances({
        ...document,
        components: document.components.map((candidate) =>
          candidate.id === component.id
            ? {
                ...candidate,
                variants: candidate.variants.map((entry) =>
                  entry.id === variant.id ? updatedVariant : entry
                ),
              }
            : candidate
        ),
      })
      break
    }
    case "delete_component_variant": {
      const component = document.components.find(
        (candidate) => candidate.id === command.componentId
      )
      const variant = component?.variants.find(
        (candidate) => candidate.id === command.variantId
      )
      if (!component || !variant) {
        throw new Error(`Unknown component variant: ${command.variantId}`)
      }
      if (component.variants.length === 1) {
        throw new Error("A component must keep at least one variant")
      }
      const dependants = document.componentInstances.filter(
        (instance) =>
          instance.componentId === component.id &&
          instance.variantId === variant.id
      )
      const replacement = command.replacementVariantId
        ? component.variants.find(
            (candidate) => candidate.id === command.replacementVariantId
          )
        : undefined
      if (
        (dependants.length || component.defaultVariantId === variant.id) &&
        !replacement
      ) {
        throw new Error("A used or default variant needs a replacement")
      }
      if (replacement?.id === variant.id) {
        throw new Error("A variant cannot replace itself")
      }
      next = materializeComponentInstances({
        ...document,
        components: document.components.map((candidate) =>
          candidate.id === component.id
            ? {
                ...candidate,
                defaultVariantId:
                  candidate.defaultVariantId === variant.id
                    ? replacement!.id
                    : candidate.defaultVariantId,
                variants: candidate.variants.filter(
                  (entry) => entry.id !== variant.id
                ),
              }
            : candidate
        ),
        componentInstances: document.componentInstances.map((instance) =>
          instance.componentId === component.id &&
          instance.variantId === variant.id
            ? { ...instance, variantId: replacement!.id }
            : instance
        ),
      })
      break
    }
    case "create_component_instance": {
      next = createMaterializedComponentInstance(document, command)
      break
    }
    case "switch_component_variant": {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === command.instanceId
      )
      if (!instance) {
        throw new Error(`Unknown component instance: ${command.instanceId}`)
      }
      const component = document.components.find(
        (candidate) => candidate.id === instance.componentId
      )
      if (
        !component?.variants.some((variant) => variant.id === command.variantId)
      ) {
        throw new Error(`Unknown component variant: ${command.variantId}`)
      }
      next = materializeComponentInstances({
        ...document,
        componentInstances: document.componentInstances.map((candidate) =>
          candidate.id === instance.id
            ? { ...candidate, variantId: command.variantId }
            : candidate
        ),
      })
      break
    }
    case "update_component_instance": {
      next = materializeComponentInstances(
        withComponentInstanceOverride(
          document,
          command.instanceId,
          command.sourceNodeId,
          command.patch
        )
      )
      break
    }
    case "reset_component_override": {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === command.instanceId
      )
      if (!instance) {
        throw new Error(`Unknown component instance: ${command.instanceId}`)
      }
      if (!instance.overrides[command.sourceNodeId]) {
        throw new Error("The selected component layer has no overrides")
      }
      const overrides = structuredClone(instance.overrides)
      if (!command.properties) {
        delete overrides[command.sourceNodeId]
      } else {
        const patch: Record<string, unknown> = {
          ...overrides[command.sourceNodeId],
        }
        for (const property of command.properties) delete patch[property]
        if (Object.keys(patch).length) {
          overrides[command.sourceNodeId] = sceneNodePatchSchema.parse(patch)
        } else delete overrides[command.sourceNodeId]
      }
      next = materializeComponentInstances({
        ...document,
        componentInstances: document.componentInstances.map((candidate) =>
          candidate.id === instance.id ? { ...candidate, overrides } : candidate
        ),
      })
      break
    }
    case "reset_all_component_overrides": {
      if (
        !document.componentInstances.some(
          (instance) => instance.id === command.instanceId
        )
      ) {
        throw new Error(`Unknown component instance: ${command.instanceId}`)
      }
      next = materializeComponentInstances({
        ...document,
        componentInstances: document.componentInstances.map((instance) =>
          instance.id === command.instanceId
            ? { ...instance, overrides: {} }
            : instance
        ),
      })
      break
    }
    case "detach_component_instance": {
      if (
        !document.componentInstances.some(
          (instance) => instance.id === command.instanceId
        )
      ) {
        throw new Error(`Unknown component instance: ${command.instanceId}`)
      }
      next = {
        ...document,
        componentInstances: document.componentInstances.filter(
          (instance) => instance.id !== command.instanceId
        ),
      }
      break
    }
    case "synchronize_component_instances": {
      next = materializeComponentInstances(document)
      break
    }
    case "create_typography_style": {
      if (
        document.typographyStyles.some(
          (style) =>
            style.id === command.style.id || style.name === command.style.name
        )
      ) {
        throw new Error(
          `Typography style already exists: ${command.style.name}`
        )
      }
      next = {
        ...document,
        typographyStyles: [...document.typographyStyles, command.style],
      }
      break
    }
    case "update_typography_style": {
      const current = document.typographyStyles.find(
        (style) => style.id === command.styleId
      )
      if (!current) {
        throw new Error(`Unknown typography style: ${command.styleId}`)
      }
      const updated = { ...current, ...command.patch, id: current.id }
      if (
        document.typographyStyles.some(
          (style) => style.id !== current.id && style.name === updated.name
        )
      ) {
        throw new Error(`Typography style already exists: ${updated.name}`)
      }
      next = {
        ...document,
        typographyStyles: document.typographyStyles.map((style) =>
          style.id === current.id ? updated : style
        ),
        nodes: document.nodes.map((node) =>
          propagateTypographyStyle(node, updated)
        ),
        variableBindings: detachVariableBindingsForStylePatch(
          document,
          "typography_style",
          current.id,
          command.patch
        ),
      }
      break
    }
    case "delete_typography_style": {
      const style = document.typographyStyles.find(
        (candidate) => candidate.id === command.styleId
      )
      if (!style) {
        throw new Error(`Unknown typography style: ${command.styleId}`)
      }
      const usage = designStyleUsage(document, "typography", style.id)
      if (usage.totalAttachmentCount > 0) {
        throw new Error(
          `${style.name} is used in ${usage.totalAttachmentCount} place${usage.totalAttachmentCount === 1 ? "" : "s"}. Detach it before deleting.`
        )
      }
      if (
        document.variableBindings.some(
          (binding) =>
            binding.target.kind === "typography_style" &&
            binding.target.styleId === style.id
        )
      ) {
        throw new Error(
          `${style.name} has variable bindings. Unbind it before deleting.`
        )
      }
      next = {
        ...document,
        typographyStyles: document.typographyStyles.filter(
          (candidate) => candidate.id !== style.id
        ),
      }
      break
    }
    case "apply_typography_style": {
      const style = document.typographyStyles.find(
        (candidate) => candidate.id === command.styleId
      )
      if (!style) {
        throw new Error(`Unknown typography style: ${command.styleId}`)
      }
      const targets = new Map(
        command.targets.map((target) => [target.nodeId, target])
      )
      if (targets.size !== command.targets.length) {
        throw new Error("A style command cannot target the same layer twice")
      }
      for (const target of command.targets) {
        if (!document.nodes.some((node) => node.id === target.nodeId)) {
          throw new Error(`Unknown node: ${target.nodeId}`)
        }
      }
      next = {
        ...document,
        nodes: document.nodes.map((node) => {
          const target = targets.get(node.id)
          return target
            ? applyTypographyStyleToTarget(node, target, style)
            : node
        }),
        variableBindings: detachVariableBindingsForStyleTargets(
          document,
          "typography",
          command.targets
        ),
      }
      break
    }
    case "detach_typography_style": {
      const targets = new Map(
        command.targets.map((target) => [target.nodeId, target])
      )
      if (targets.size !== command.targets.length) {
        throw new Error("A style command cannot target the same layer twice")
      }
      for (const target of command.targets) {
        if (!document.nodes.some((node) => node.id === target.nodeId)) {
          throw new Error(`Unknown node: ${target.nodeId}`)
        }
      }
      next = {
        ...document,
        nodes: document.nodes.map((node) => {
          const target = targets.get(node.id)
          return target ? detachTypographyStyleFromTarget(node, target) : node
        }),
      }
      break
    }
    case "create_paint_style": {
      if (
        document.paintStyles.some(
          (style) =>
            style.id === command.style.id || style.name === command.style.name
        )
      ) {
        throw new Error(`Paint style already exists: ${command.style.name}`)
      }
      next = {
        ...document,
        paintStyles: [...document.paintStyles, command.style],
      }
      break
    }
    case "update_paint_style": {
      const current = document.paintStyles.find(
        (style) => style.id === command.styleId
      )
      if (!current) throw new Error(`Unknown paint style: ${command.styleId}`)
      const updated = { ...current, ...command.patch, id: current.id }
      if (
        document.paintStyles.some(
          (style) => style.id !== current.id && style.name === updated.name
        )
      ) {
        throw new Error(`Paint style already exists: ${updated.name}`)
      }
      next = {
        ...document,
        paintStyles: document.paintStyles.map((style) =>
          style.id === current.id ? updated : style
        ),
        nodes: document.nodes.map((node) => propagatePaintStyle(node, updated)),
        variableBindings: detachVariableBindingsForStylePatch(
          document,
          "paint_style",
          current.id,
          command.patch
        ),
      }
      break
    }
    case "delete_paint_style": {
      const style = document.paintStyles.find(
        (candidate) => candidate.id === command.styleId
      )
      if (!style) throw new Error(`Unknown paint style: ${command.styleId}`)
      const usage = designStyleUsage(document, "paint", style.id)
      if (usage.totalAttachmentCount > 0) {
        throw new Error(
          `${style.name} is used in ${usage.totalAttachmentCount} place${usage.totalAttachmentCount === 1 ? "" : "s"}. Detach it before deleting.`
        )
      }
      if (
        document.variableBindings.some(
          (binding) =>
            binding.target.kind === "paint_style" &&
            binding.target.styleId === style.id
        )
      ) {
        throw new Error(
          `${style.name} has variable bindings. Unbind it before deleting.`
        )
      }
      next = {
        ...document,
        paintStyles: document.paintStyles.filter(
          (candidate) => candidate.id !== style.id
        ),
      }
      break
    }
    case "apply_paint_style": {
      const style = document.paintStyles.find(
        (candidate) => candidate.id === command.styleId
      )
      if (!style) throw new Error(`Unknown paint style: ${command.styleId}`)
      const targets = new Map(
        command.targets.map((target) => [target.nodeId, target])
      )
      if (targets.size !== command.targets.length) {
        throw new Error("A style command cannot target the same layer twice")
      }
      for (const target of command.targets) {
        if (!document.nodes.some((node) => node.id === target.nodeId)) {
          throw new Error(`Unknown node: ${target.nodeId}`)
        }
      }
      next = {
        ...document,
        nodes: document.nodes.map((node) => {
          const target = targets.get(node.id)
          return target ? applyPaintStyleToTarget(node, target, style) : node
        }),
        variableBindings: detachVariableBindingsForStyleTargets(
          document,
          "paint",
          command.targets
        ),
      }
      break
    }
    case "detach_paint_style": {
      const targets = new Map(
        command.targets.map((target) => [target.nodeId, target])
      )
      if (targets.size !== command.targets.length) {
        throw new Error("A style command cannot target the same layer twice")
      }
      for (const target of command.targets) {
        if (!document.nodes.some((node) => node.id === target.nodeId)) {
          throw new Error(`Unknown node: ${target.nodeId}`)
        }
      }
      next = {
        ...document,
        nodes: document.nodes.map((node) => {
          const target = targets.get(node.id)
          return target ? detachPaintStyleFromTarget(node, target) : node
        }),
      }
      break
    }
    case "create_variable": {
      if (
        document.variables.some(
          (variable) =>
            variable.id === command.variable.id ||
            variable.name.trim().toLocaleLowerCase() ===
              command.variable.name.trim().toLocaleLowerCase()
        )
      ) {
        throw new Error(`Variable already exists: ${command.variable.name}`)
      }
      next = {
        ...document,
        variables: [...document.variables, command.variable],
      }
      break
    }
    case "update_variable": {
      const current = document.variables.find(
        (variable) => variable.id === command.variableId
      )
      if (!current) throw new Error(`Unknown variable: ${command.variableId}`)
      const updated = designVariableSchema.parse({
        ...current,
        ...command.patch,
        id: current.id,
      })
      if (
        document.variables.some(
          (variable) =>
            variable.id !== current.id &&
            variable.name.trim().toLocaleLowerCase() ===
              updated.name.trim().toLocaleLowerCase()
        )
      ) {
        throw new Error(`Variable already exists: ${updated.name}`)
      }
      let propagated: Document = {
        ...document,
        variables: document.variables.map((variable) =>
          variable.id === current.id ? updated : variable
        ),
      }
      for (const binding of document.variableBindings.filter(
        (candidate) => candidate.variableId === current.id
      )) {
        propagated = applyVariableToBinding(propagated, binding, updated)
      }
      next = propagated
      break
    }
    case "delete_variable": {
      const variable = document.variables.find(
        (candidate) => candidate.id === command.variableId
      )
      if (!variable) throw new Error(`Unknown variable: ${command.variableId}`)
      const usage = variableUsage(document, variable.id)
      if (usage.totalBindingCount > 0) {
        throw new Error(
          `${variable.name} is used by ${usage.totalBindingCount} binding${usage.totalBindingCount === 1 ? "" : "s"}. Unbind it before deleting.`
        )
      }
      next = {
        ...document,
        variables: document.variables.filter(
          (candidate) => candidate.id !== variable.id
        ),
      }
      break
    }
    case "bind_variable": {
      if (
        document.variableBindings.some(
          (binding) => binding.id === command.binding.id
        )
      ) {
        throw new Error(
          `Variable binding already exists: ${command.binding.id}`
        )
      }
      const variable = document.variables.find(
        (candidate) => candidate.id === command.binding.variableId
      )
      if (!variable) {
        throw new Error(`Unknown variable: ${command.binding.variableId}`)
      }
      assertVariableBindingCompatible(document, command.binding, variable)
      next = applyVariableToBinding(
        {
          ...document,
          variableBindings: [...document.variableBindings, command.binding],
        },
        command.binding,
        variable
      )
      break
    }
    case "unbind_variable": {
      if (
        !document.variableBindings.some(
          (binding) => binding.id === command.bindingId
        )
      ) {
        throw new Error(`Unknown variable binding: ${command.bindingId}`)
      }
      next = {
        ...document,
        variableBindings: document.variableBindings.filter(
          (binding) => binding.id !== command.bindingId
        ),
      }
      break
    }
    case "set_image_placement": {
      const index = document.nodes.findIndex(
        (node) => node.id === command.nodeId
      )
      const current = document.nodes[index]
      if (!current) throw new Error(`Unknown node: ${command.nodeId}`)
      if (current.type !== "image") {
        throw new Error(`Node ${command.nodeId} is not an image`)
      }
      const nodes = [...document.nodes]
      nodes[index] = { ...current, placement: command.placement }
      next = { ...document, nodes }
      break
    }
    case "set_image_frame_mask": {
      const index = document.nodes.findIndex(
        (node) => node.id === command.nodeId
      )
      const current = document.nodes[index]
      if (!current) throw new Error(`Unknown node: ${command.nodeId}`)
      if (current.type !== "image") {
        throw new Error(`Node ${command.nodeId} is not an image`)
      }
      const nodes = [...document.nodes]
      nodes[index] = { ...current, frameMask: command.frameMask }
      next = { ...document, nodes }
      break
    }
    case "replace_image_source": {
      const index = document.nodes.findIndex(
        (node) => node.id === command.nodeId
      )
      const current = document.nodes[index]
      if (!current) throw new Error(`Unknown node: ${command.nodeId}`)
      if (current.type !== "image") {
        throw new Error(`Node ${command.nodeId} is not an image`)
      }
      const sourceBinding = document.bindings.find(
        (binding) => binding.nodeId === current.id && binding.property === "src"
      )
      if (sourceBinding) {
        const field = document.fields.find(
          (candidate) => candidate.id === sourceBinding.fieldId
        )
        throw new Error(
          `${field?.label ?? "Image source"} controls this layer. Update it in Fields or unbind Source before replacing only this layer.`
        )
      }
      const nodes = [...document.nodes]
      nodes[index] = {
        ...current,
        assetId: command.assetId,
        src: command.src,
        ...(command.alt === undefined
          ? {}
          : {
              alt: command.alt,
              altProvenance: command.altProvenance ?? "authored",
            }),
      }
      next = { ...document, nodes }
      break
    }
    case "relink_asset_references": {
      if (managedAssetIdFromSource(command.toSource) !== command.toAssetId) {
        throw new Error("The managed asset identity is incoherent")
      }
      next = relinkAssetReferences(document, command)
      break
    }
    case "relink_local_asset_references": {
      const localAssetId = localAssetIdFromSource(command.from)
      if (!localAssetId) {
        throw new Error("The source is not a valid local asset identity")
      }
      const nextLocalAssetId = localAssetIdFromSource(command.toSource)
      if (nextLocalAssetId !== command.toAssetId) {
        throw new Error("The new local asset identity is incoherent")
      }
      if (nextLocalAssetId === localAssetId) {
        throw new Error("The new local asset identity must be distinct")
      }
      if (
        assetReferenceKeysForSource(document, command.toSource).length > 0 ||
        document.nodes.some(
          (node) => node.type === "image" && node.assetId === command.toAssetId
        )
      ) {
        throw new Error("The new local asset identity is already in use")
      }
      next = relinkAssetReferences(document, command)
      break
    }
    case "remove_node": {
      if (!document.nodes.some((node) => node.id === command.nodeId)) {
        throw new Error(`Unknown node: ${command.nodeId}`)
      }
      next = {
        ...document,
        nodes: document.nodes.filter((node) => node.id !== command.nodeId),
        pages: document.pages.map((page) => ({
          ...page,
          nodeIds: page.nodeIds.filter((nodeId) => nodeId !== command.nodeId),
        })),
        bindings: document.bindings.filter(
          (binding) => binding.nodeId !== command.nodeId
        ),
        variableBindings: document.variableBindings.filter((binding) => {
          const target = binding.target
          return !(
            (target.kind === "node" || target.kind === "text_range") &&
            target.nodeId === command.nodeId
          )
        }),
        groups: pruneEmptyGroups(
          document.groups.map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter(
              (nodeId) => nodeId !== command.nodeId
            ),
          }))
        ),
      }
      break
    }
    case "reorder_node": {
      const page = document.pages.find(
        (candidate) => candidate.id === command.pageId
      )
      if (!page) throw new Error(`Unknown page: ${command.pageId}`)
      const currentIndex = page.nodeIds.indexOf(command.nodeId)
      if (currentIndex < 0) {
        throw new Error(
          `Node ${command.nodeId} is not on page ${command.pageId}`
        )
      }
      const nodeIds = [...page.nodeIds]
      const [nodeId] = nodeIds.splice(currentIndex, 1)
      if (!nodeId) throw new Error(`Unknown node: ${command.nodeId}`)
      nodeIds.splice(Math.min(command.toIndex, nodeIds.length), 0, nodeId)
      next = {
        ...document,
        pages: document.pages.map((candidate) =>
          candidate.id === command.pageId
            ? { ...candidate, nodeIds }
            : candidate
        ),
      }
      break
    }
    case "reorder_nodes": {
      const page = document.pages.find(
        (candidate) => candidate.id === command.pageId
      )
      if (!page) throw new Error(`Unknown page: ${command.pageId}`)
      const requested = new Set(command.nodeIds)
      if (requested.size !== command.nodeIds.length) {
        throw new Error("A layer block cannot contain duplicate nodes")
      }
      if (command.nodeIds.some((nodeId) => !page.nodeIds.includes(nodeId))) {
        throw new Error("Every reordered layer must belong to the page")
      }
      const orderedBlock = page.nodeIds.filter((nodeId) =>
        requested.has(nodeId)
      )
      const remaining = page.nodeIds.filter((nodeId) => !requested.has(nodeId))
      const targetIndex = Math.min(command.toIndex, remaining.length)
      const nodeIds = [
        ...remaining.slice(0, targetIndex),
        ...orderedBlock,
        ...remaining.slice(targetIndex),
      ]
      if (nodeIds.every((nodeId, index) => nodeId === page.nodeIds[index])) {
        throw new Error("The layer block is already in that position")
      }
      next = {
        ...document,
        pages: document.pages.map((candidate) =>
          candidate.id === page.id ? { ...candidate, nodeIds } : candidate
        ),
      }
      break
    }
    case "reparent_node": {
      const page = document.pages.find(
        (candidate) => candidate.id === command.pageId
      )
      if (!page) throw new Error(`Unknown page: ${command.pageId}`)
      if (!page.nodeIds.includes(command.nodeId)) {
        throw new Error(`Node ${command.nodeId} is not on page ${page.id}`)
      }
      const currentGroup = document.groups.find((group) =>
        group.nodeIds.includes(command.nodeId)
      )
      const targetGroup = command.targetGroupId
        ? document.groups.find((group) => group.id === command.targetGroupId)
        : undefined
      if (command.targetGroupId && !targetGroup) {
        throw new Error(`Unknown group: ${command.targetGroupId}`)
      }
      if (targetGroup && targetGroup.pageId !== page.id) {
        throw new Error("A layer cannot move into a group on another page")
      }
      if ((currentGroup?.id ?? undefined) === targetGroup?.id) {
        throw new Error("The layer already belongs to that group")
      }
      next = {
        ...document,
        pages: targetGroup
          ? document.pages.map((candidate) =>
              candidate.id === page.id
                ? {
                    ...candidate,
                    nodeIds: moveNodeBlockBesideTarget(
                      candidate.nodeIds,
                      [command.nodeId],
                      groupNodeIds(document.groups, targetGroup.id)
                    ),
                  }
                : candidate
            )
          : document.pages,
        groups: pruneEmptyGroups(
          document.groups.map((group) => {
            const withoutNode = group.nodeIds.filter(
              (nodeId) => nodeId !== command.nodeId
            )
            return group.id === targetGroup?.id
              ? { ...group, nodeIds: [...withoutNode, command.nodeId] }
              : withoutNode.length === group.nodeIds.length
                ? group
                : { ...group, nodeIds: withoutNode }
          })
        ),
      }
      break
    }
    case "reparent_group": {
      const group = document.groups.find(
        (candidate) => candidate.id === command.groupId
      )
      if (!group) throw new Error(`Unknown group: ${command.groupId}`)
      if (group.pageId !== command.pageId) {
        throw new Error(`Group ${group.id} is not on page ${command.pageId}`)
      }
      const targetGroup = command.targetGroupId
        ? document.groups.find(
            (candidate) => candidate.id === command.targetGroupId
          )
        : undefined
      if (command.targetGroupId && !targetGroup) {
        throw new Error(`Unknown group: ${command.targetGroupId}`)
      }
      if (targetGroup && targetGroup.pageId !== group.pageId) {
        throw new Error("A group cannot move into a group on another page")
      }
      if (targetGroup?.id === group.id) {
        throw new Error("A group cannot contain itself")
      }
      let ancestorId = targetGroup?.id
      while (ancestorId) {
        if (ancestorId === group.id) {
          throw new Error("A group cannot move inside one of its descendants")
        }
        ancestorId = document.groups.find(
          (candidate) => candidate.id === ancestorId
        )?.parentGroupId
      }
      if (group.parentGroupId === targetGroup?.id) {
        throw new Error("The group already has that parent")
      }
      next = {
        ...document,
        pages: targetGroup
          ? document.pages.map((page) =>
              page.id === group.pageId
                ? {
                    ...page,
                    nodeIds: moveNodeBlockBesideTarget(
                      page.nodeIds,
                      groupNodeIds(document.groups, group.id),
                      groupNodeIds(document.groups, targetGroup.id)
                    ),
                  }
                : page
            )
          : document.pages,
        groups: pruneEmptyGroups(
          document.groups.map((candidate) =>
            candidate.id === group.id
              ? {
                  ...candidate,
                  parentGroupId: targetGroup?.id,
                }
              : candidate
          )
        ),
      }
      break
    }
    case "group_nodes": {
      if (document.groups.some((group) => group.id === command.groupId)) {
        throw new Error(`Group already exists: ${command.groupId}`)
      }
      const page = document.pages.find(
        (candidate) => candidate.id === command.pageId
      )
      if (!page) throw new Error(`Unknown page: ${command.pageId}`)
      const selected = new Set(command.nodeIds)
      if (command.nodeIds.some((nodeId) => !page.nodeIds.includes(nodeId))) {
        throw new Error("Every grouped node must belong to the same page")
      }

      const memberships = new Map(
        document.groups.map((group) => [
          group.id,
          groupNodeIds(document.groups, group.id),
        ])
      )
      const containedGroups = document.groups.filter((group) => {
        const nodeIds = memberships.get(group.id) ?? []
        return (
          group.pageId === command.pageId &&
          nodeIds.length > 0 &&
          nodeIds.every((nodeId) => selected.has(nodeId))
        )
      })
      const partiallySelectedGroup = document.groups.find((group) => {
        const nodeIds = memberships.get(group.id) ?? []
        return (
          group.pageId === command.pageId &&
          nodeIds.some((nodeId) => selected.has(nodeId)) &&
          !nodeIds.every((nodeId) => selected.has(nodeId))
        )
      })
      if (partiallySelectedGroup) {
        throw new Error(
          `Select every member of ${partiallySelectedGroup.name} before nesting it`
        )
      }
      const containedNodeIds = new Set(
        containedGroups.flatMap((group) => memberships.get(group.id) ?? [])
      )
      const directNodeIds = command.nodeIds.filter(
        (nodeId) => !containedNodeIds.has(nodeId)
      )
      const childGroups = containedGroups.filter(
        (group) =>
          !containedGroups.some(
            (candidate) => candidate.id === group.parentGroupId
          )
      )
      if (directNodeIds.length + childGroups.length < 2) {
        throw new Error("A group needs at least two layers or child groups")
      }
      next = {
        ...document,
        pages: document.pages.map((candidate) =>
          candidate.id === page.id
            ? {
                ...candidate,
                nodeIds: compactNodeBlock(candidate.nodeIds, command.nodeIds),
              }
            : candidate
        ),
        groups: [
          ...document.groups.map((group) =>
            childGroups.some((child) => child.id === group.id)
              ? { ...group, parentGroupId: command.groupId }
              : group
          ),
          {
            id: command.groupId,
            pageId: command.pageId,
            name: command.name,
            nodeIds: directNodeIds,
          },
        ],
      }
      break
    }
    case "update_group": {
      if (!document.groups.some((group) => group.id === command.groupId)) {
        throw new Error(`Unknown group: ${command.groupId}`)
      }
      next = {
        ...document,
        groups: document.groups.map((group) =>
          group.id === command.groupId
            ? { ...group, name: command.name }
            : group
        ),
      }
      break
    }
    case "ungroup_nodes": {
      const group = document.groups.find(
        (candidate) => candidate.id === command.groupId
      )
      if (!group) throw new Error(`Unknown group: ${command.groupId}`)
      next = {
        ...document,
        groups: document.groups
          .filter((candidate) => candidate.id !== group.id)
          .map((candidate) => {
            if (candidate.id === group.parentGroupId) {
              return {
                ...candidate,
                nodeIds: [...new Set([...candidate.nodeIds, ...group.nodeIds])],
              }
            }
            if (candidate.parentGroupId === group.id) {
              return {
                ...candidate,
                parentGroupId: group.parentGroupId,
              }
            }
            return candidate
          }),
      }
      break
    }
    case "add_page": {
      const output = document.outputs.find(
        (candidate) => candidate.id === command.outputId
      )
      if (!output) throw new Error(`Unknown output: ${command.outputId}`)
      if (document.pages.some((page) => page.id === command.page.id)) {
        throw new Error(`Page already exists: ${command.page.id}`)
      }
      if (command.page.outputId !== output.id || command.page.nodeIds.length) {
        throw new Error("A new page must be empty and belong to its output")
      }
      next = {
        ...document,
        pages: [...document.pages, command.page],
        outputs: document.outputs.map((candidate) =>
          candidate.id === output.id
            ? { ...candidate, pageIds: [...candidate.pageIds, command.page.id] }
            : candidate
        ),
      }
      break
    }
    case "duplicate_page": {
      const output = document.outputs.find(
        (candidate) => candidate.id === command.outputId
      )
      if (!output) throw new Error(`Unknown output: ${command.outputId}`)
      if (
        command.page.outputId !== output.id ||
        document.pages.some((page) => page.id === command.page.id) ||
        command.page.nodeIds.length !== command.nodes.length ||
        command.page.nodeIds.some(
          (nodeId, index) => command.nodes[index]?.id !== nodeId
        )
      ) {
        throw new Error("The duplicated page contains conflicting identifiers")
      }
      const withPage: Document = {
        ...document,
        pages: [...document.pages, { ...command.page, nodeIds: [] }],
        outputs: document.outputs.map((candidate) =>
          candidate.id === output.id
            ? { ...candidate, pageIds: [...candidate.pageIds, command.page.id] }
            : candidate
        ),
      }
      next = appendSemanticClone(withPage, {
        pageId: command.page.id,
        nodes: command.nodes,
        groups: command.groups,
        componentInstances: command.componentInstances,
        bindings: command.bindings,
        variableBindings: command.variableBindings,
      })
      break
    }
    case "duplicate_nodes": {
      next = appendSemanticClone(document, {
        pageId: command.pageId,
        nodes: command.nodes,
        groups: command.groups,
        componentInstances: command.componentInstances,
        bindings: command.bindings,
        variableBindings: command.variableBindings,
      })
      break
    }
    case "update_page": {
      if (!document.pages.some((page) => page.id === command.pageId)) {
        throw new Error(`Unknown page: ${command.pageId}`)
      }
      next = {
        ...document,
        pages: document.pages.map((page) =>
          page.id === command.pageId ? { ...page, ...command.patch } : page
        ),
      }
      break
    }
    case "remove_page": {
      const page = document.pages.find(
        (candidate) => candidate.id === command.pageId
      )
      if (!page) throw new Error(`Unknown page: ${command.pageId}`)
      const output = document.outputs.find(
        (candidate) => candidate.id === page.outputId
      )
      if (!output || output.pageIds.length <= 1) {
        throw new Error("An output must keep at least one page")
      }
      const removedNodeIds = new Set(page.nodeIds)
      next = {
        ...document,
        pages: document.pages.filter((candidate) => candidate.id !== page.id),
        nodes: document.nodes.filter((node) => !removedNodeIds.has(node.id)),
        groups: document.groups.filter((group) => group.pageId !== page.id),
        bindings: document.bindings.filter(
          (binding) => !removedNodeIds.has(binding.nodeId)
        ),
        variableBindings: document.variableBindings.filter((binding) => {
          const target = binding.target
          return !(
            (target.kind === "node" || target.kind === "text_range") &&
            removedNodeIds.has(target.nodeId)
          )
        }),
        outputs: document.outputs.map((candidate) =>
          candidate.id === output.id
            ? {
                ...candidate,
                pageIds: candidate.pageIds.filter(
                  (pageId) => pageId !== page.id
                ),
              }
            : candidate
        ),
      }
      break
    }
    case "reorder_page": {
      const output = document.outputs.find(
        (candidate) => candidate.id === command.outputId
      )
      if (!output || !output.pageIds.includes(command.pageId)) {
        throw new Error("The page does not belong to this output")
      }
      const pageIds = output.pageIds.filter(
        (pageId) => pageId !== command.pageId
      )
      pageIds.splice(
        Math.min(command.toIndex, pageIds.length),
        0,
        command.pageId
      )
      next = {
        ...document,
        outputs: document.outputs.map((candidate) =>
          candidate.id === output.id ? { ...candidate, pageIds } : candidate
        ),
      }
      break
    }
    case "add_output": {
      if (
        document.outputs.some((output) => output.id === command.output.id) ||
        document.pages.some((page) => page.id === command.page.id) ||
        command.page.outputId !== command.output.id ||
        command.output.pageIds.length !== 1 ||
        command.output.pageIds[0] !== command.page.id ||
        command.page.nodeIds.length
      ) {
        throw new Error("The new output or its first page is invalid")
      }
      next = {
        ...document,
        outputs: [...document.outputs, command.output],
        pages: [...document.pages, command.page],
      }
      break
    }
    case "add_output_variant": {
      if (
        document.outputs.some((output) => output.id === command.output.id) ||
        document.pages.some((page) => page.id === command.page.id) ||
        command.page.outputId !== command.output.id ||
        command.output.pageIds.length !== 1 ||
        command.output.pageIds[0] !== command.page.id ||
        command.page.nodeIds.length !== command.nodes.length ||
        command.page.nodeIds.some(
          (nodeId, index) => command.nodes[index]?.id !== nodeId
        )
      ) {
        throw new Error("The adapted output contains conflicting identifiers")
      }
      const withOutput: Document = {
        ...document,
        outputs: [...document.outputs, command.output],
        pages: [...document.pages, { ...command.page, nodeIds: [] }],
      }
      next = appendSemanticClone(withOutput, {
        pageId: command.page.id,
        nodes: command.nodes,
        groups: command.groups,
        componentInstances: command.componentInstances,
        bindings: command.bindings,
        variableBindings: command.variableBindings,
      })
      break
    }
    case "update_output": {
      if (!document.outputs.some((output) => output.id === command.outputId)) {
        throw new Error(`Unknown output: ${command.outputId}`)
      }
      next = {
        ...document,
        outputs: document.outputs.map((output) =>
          output.id === command.outputId
            ? { ...output, name: command.name }
            : output
        ),
      }
      break
    }
    case "remove_output": {
      const output = document.outputs.find(
        (candidate) => candidate.id === command.outputId
      )
      if (!output) throw new Error(`Unknown output: ${command.outputId}`)
      if (document.outputs.length <= 1) {
        throw new Error("A document must keep at least one output")
      }
      const removedPageIds = new Set(output.pageIds)
      const removedNodeIds = new Set(
        document.pages
          .filter((page) => removedPageIds.has(page.id))
          .flatMap((page) => page.nodeIds)
      )
      next = {
        ...document,
        outputs: document.outputs.filter(
          (candidate) => candidate.id !== output.id
        ),
        pages: document.pages.filter((page) => !removedPageIds.has(page.id)),
        nodes: document.nodes.filter((node) => !removedNodeIds.has(node.id)),
        groups: document.groups.filter(
          (group) => !removedPageIds.has(group.pageId)
        ),
        bindings: document.bindings.filter(
          (binding) => !removedNodeIds.has(binding.nodeId)
        ),
        variableBindings: document.variableBindings.filter((binding) => {
          const target = binding.target
          return !(
            (target.kind === "node" || target.kind === "text_range") &&
            removedNodeIds.has(target.nodeId)
          )
        }),
      }
      break
    }
  }

  return validateResult(
    applyFieldValues({
      ...next,
      revision: document.revision + 1,
      updatedAt: command.at,
    })
  )
}

/** Public, untrusted command boundary. Both inputs and output are reparsed. */
export function applyCommand(
  input: Document,
  commandInput: DocumentCommand
): Document {
  return applyParsedCommand(
    documentSchema.parse(input),
    documentCommandSchema.parse(commandInput),
    assertValidDocument
  )
}

/**
 * Internal transaction boundary for a document already admitted by the
 * canonical decoder. The command remains schema-validated, while semantic
 * validation deliberately preserves unchanged object identities.
 */
export function applyCommandToCanonicalDocumentUnchecked(
  document: Document,
  commandInput: DocumentCommand
): Document {
  return applyParsedCommand(
    document,
    documentCommandSchema.parse(commandInput),
    assertValidCanonicalDocument
  )
}
