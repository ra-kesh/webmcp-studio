import {
  documentCommandSchema,
  documentSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
} from "./schema"
import { fieldCanBindToProperty, fieldValueMatchesType } from "./fields"

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

function applyValue(
  node: SceneNode,
  property: string,
  value: FieldValue
): SceneNode {
  if (property === "text" && node.type === "text") {
    return { ...node, text: String(value) }
  }
  if (property === "src" && node.type === "image") {
    return { ...node, src: String(value) }
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
      if (value !== undefined) next = applyValue(next, binding.property, value)
    }
    return next
  })

  return { ...document, nodes }
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
      if (!fieldValueMatchesType(field, command.value)) {
        throw new Error(`Invalid value for ${field.label}`)
      }
      next = applyFieldValues({
        ...document,
        fieldValues: {
          ...document.fieldValues,
          [command.fieldId]: command.value,
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
      if (!fieldValueMatchesType(command.field, command.field.defaultValue)) {
        throw new Error(`Invalid default value for ${command.field.label}`)
      }
      next = {
        ...document,
        fields: [...document.fields, command.field],
        fieldValues: {
          ...document.fieldValues,
          [command.field.id]: command.field.defaultValue,
        },
      }
      break
    }
    case "update_field": {
      const field = document.fields.find(
        (candidate) => candidate.id === command.fieldId
      )
      if (!field) throw new Error(`Unknown field: ${command.fieldId}`)
      const updated = { ...field, ...command.patch, id: field.id }
      if (
        document.fields.some(
          (candidate) =>
            candidate.id !== field.id && candidate.key === updated.key
        )
      ) {
        throw new Error(`Field key already exists: ${updated.key}`)
      }
      if (!fieldValueMatchesType(updated, updated.defaultValue)) {
        throw new Error(`Invalid default value for ${updated.label}`)
      }
      const currentValue = document.fieldValues[field.id]
      next = {
        ...document,
        fields: document.fields.map((candidate) =>
          candidate.id === field.id ? updated : candidate
        ),
        fieldValues: {
          ...document.fieldValues,
          [field.id]:
            currentValue !== undefined &&
            fieldValueMatchesType(updated, currentValue)
              ? currentValue
              : updated.defaultValue,
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
      const updated = { ...current, ...command.patch, id: command.nodeId }
      const nodes = [...document.nodes]
      nodes[index] = updated as SceneNode
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
        groups: document.groups.map((group) => ({
          ...group,
          nodeIds: group.nodeIds.filter((nodeId) => nodeId !== command.nodeId),
        })),
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
        command.nodes.some((node) =>
          document.nodes.some((existing) => existing.id === node.id)
        ) ||
        command.groups.some((group) =>
          document.groups.some((existing) => existing.id === group.id)
        )
      ) {
        throw new Error("The duplicated page contains conflicting identifiers")
      }
      const nodeIds = new Set(command.nodes.map((node) => node.id))
      const groupIds = new Set(command.groups.map((group) => group.id))
      if (
        command.page.nodeIds.some((nodeId) => !nodeIds.has(nodeId)) ||
        command.groups.some(
          (group) =>
            group.pageId !== command.page.id ||
            group.nodeIds.some((nodeId) => !nodeIds.has(nodeId)) ||
            (group.parentGroupId && !groupIds.has(group.parentGroupId))
        )
      ) {
        throw new Error("The duplicated page contains invalid references")
      }
      next = {
        ...document,
        nodes: [...document.nodes, ...command.nodes],
        groups: [...document.groups, ...command.groups],
        pages: [...document.pages, command.page],
        outputs: document.outputs.map((candidate) =>
          candidate.id === output.id
            ? { ...candidate, pageIds: [...candidate.pageIds, command.page.id] }
            : candidate
        ),
      }
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

  return documentSchema.parse(
    applyFieldValues({
      ...next,
      revision: document.revision + 1,
      updatedAt: command.at,
    })
  )
}
