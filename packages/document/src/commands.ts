import {
  documentCommandSchema,
  documentSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
  type TemplateVersion,
} from "./schema"

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
      if (!document.fields.some((field) => field.id === command.fieldId)) {
        throw new Error(`Unknown field: ${command.fieldId}`)
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
  }

  return documentSchema.parse({
    ...next,
    revision: document.revision + 1,
    updatedAt: command.at,
  })
}

export function createTemplateVersion(
  document: Document,
  options: {
    id: string
    templateId: string
    version: number
    publishedAt: string
  }
): TemplateVersion {
  return {
    id: options.id,
    templateId: options.templateId,
    version: options.version,
    publishedAt: options.publishedAt,
    document: documentSchema.parse(document),
  }
}
