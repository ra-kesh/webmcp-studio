import {
  documentCommandSchema,
  documentSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
  type TemplateVersion,
} from "./schema"

type FieldValue = string | number | boolean

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
  if (property === "fill" && node.type === "rect") {
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
