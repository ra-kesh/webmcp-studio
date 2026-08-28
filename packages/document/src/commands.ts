import {
  documentCommandSchema,
  documentSchema,
  fieldDefinitionSchema,
  textNodePatchSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
} from "./schema"
import {
  fieldCanBindToProperty,
  fieldDefinitionValidationMessage,
  fieldValueSatisfiesDefinition,
  formatFieldValueForText,
  normalizeFieldValueForStorage,
} from "./fields"
import { managedAssetIdFromSource } from "./media"
import { applyTextLayoutPatch } from "./text-layout"
import { assertValidDocument } from "./validation"

type FieldValue = string | number | boolean

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
    return applyTextLayoutPatch(node, {
      text: formatFieldValueForText(field, value),
    })
  }
  if (property === "src" && node.type === "image") {
    const src = String(value)
    const managedAssetId = managedAssetIdFromSource(src)
    return {
      ...node,
      ...(managedAssetId ? { assetId: managedAssetId } : {}),
      src,
    }
  }
  if (property === "visible") {
    return { ...node, visible: Boolean(value) }
  }
  if (
    property === "fill" &&
    (node.type === "rect" || node.type === "ellipse" || node.type === "icon")
  ) {
    return { ...node, fill: String(value) }
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

  const nodes = document.nodes.map((node) => {
    let next = node
    for (const binding of bindingsByNode.get(node.id) ?? []) {
      const value = document.fieldValues[binding.fieldId]
      const field = fields.get(binding.fieldId)
      if (value !== undefined && field) {
        next = applyValue(next, binding.property, value, field)
      }
    }
    return next
  })

  return { ...document, nodes }
}

type SemanticClonePayload = {
  pageId: string
  nodes: Document["nodes"]
  groups: Document["groups"]
  bindings: Document["bindings"]
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
  if (
    nodeIds.size !== payload.nodes.length ||
    groupIds.size !== payload.groups.length ||
    bindingIds.size !== payload.bindings.length ||
    payload.nodes.some((node) =>
      document.nodes.some((existing) => existing.id === node.id)
    ) ||
    payload.groups.some((group) =>
      document.groups.some((existing) => existing.id === group.id)
    ) ||
    payload.bindings.some((binding) =>
      document.bindings.some((existing) => existing.id === binding.id)
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

  return applyFieldValues({
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
    bindings: [...document.bindings, ...payload.bindings],
  })
}

export function applyCommand(
  input: Document,
  commandInput: DocumentCommand
): Document {
  const document = documentSchema.parse(input)
  const command = documentCommandSchema.parse(commandInput)
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
      const updated =
        current?.type === "text"
          ? applyTextLayoutPatch(
              current,
              textNodePatchSchema.parse(command.patch)
            )
          : current?.type === "image" && "alt" in command.patch
            ? {
                ...current,
                ...command.patch,
                id: command.nodeId,
                altProvenance: command.patch.altProvenance ?? "authored",
              }
            : { ...current, ...command.patch, id: command.nodeId }
      const nodes = [...document.nodes]
      nodes[index] = updated as SceneNode
      next = { ...document, nodes }
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
        bindings: command.bindings,
      })
      break
    }
    case "duplicate_nodes": {
      next = appendSemanticClone(document, {
        pageId: command.pageId,
        nodes: command.nodes,
        groups: command.groups,
        bindings: command.bindings,
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
        bindings: command.bindings,
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
      }
      break
    }
  }

  return assertValidDocument(
    applyFieldValues({
      ...next,
      revision: document.revision + 1,
      updatedAt: command.at,
    })
  )
}
