import {
  changeSetSchema,
  fieldValueMatchesType,
  getChangeSetConflict,
  previewChangeSet,
  type ChangeSet,
  type Document,
  type SceneNode,
} from "@webmcp/document"

export type FieldUpdateProposalInput = {
  documentId: string
  baseRevision: number
  values: Record<string, string | number | boolean>
  reason?: string
}

export type ChangeSetIdentityFactory = {
  id(): string
  now(): string
}

export type CanvasEditProposalInput = {
  documentId: string
  baseRevision: number
  reason?: string
  edits: Array<{
    nodeId: string
    patch: Record<string, unknown>
    summary?: string
  }>
}

export type OutputVariantProposalInput = {
  documentId: string
  baseRevision: number
  sourcePageId: string
  name: string
  pageName?: string
  kind: "proposal" | "whatsapp_portrait" | "square"
  width: number
  height: number
  exportFormats: Array<"png" | "pdf">
  reason?: string
}

const commonCanvasProperties = new Set([
  "name",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "visible",
  "locked",
])

const nodeCanvasProperties: Record<SceneNode["type"], Set<string>> = {
  text: new Set([
    "text",
    "color",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "align",
  ]),
  rect: new Set(["fill", "radius", "stroke", "strokeWidth"]),
  ellipse: new Set(["fill", "stroke", "strokeWidth"]),
  line: new Set(["stroke", "strokeWidth"]),
  icon: new Set(["fill", "stroke", "strokeWidth"]),
  image: new Set(["fit", "cropX", "cropY", "alt"]),
}

const rounded = (value: number) => Math.round(value * 100) / 100

function scaleNode(
  node: SceneNode,
  id: string,
  scaleX: number,
  scaleY: number
): SceneNode {
  const scale = Math.min(scaleX, scaleY)
  const geometry = {
    id,
    x: rounded(node.x * scaleX),
    y: rounded(node.y * scaleY),
    width: Math.max(1, rounded(node.width * scaleX)),
    height: Math.max(1, rounded(node.height * scaleY)),
  }
  switch (node.type) {
    case "text":
      return {
        ...node,
        ...geometry,
        fontSize: Math.max(1, rounded(node.fontSize * scale)),
        letterSpacing: rounded(node.letterSpacing * scale),
      }
    case "rect":
      return {
        ...node,
        ...geometry,
        radius: rounded(node.radius * scale),
        strokeWidth: rounded(node.strokeWidth * scale),
      }
    case "ellipse":
      return {
        ...node,
        ...geometry,
        strokeWidth: rounded(node.strokeWidth * scale),
      }
    case "line":
      return {
        ...node,
        ...geometry,
        strokeWidth: Math.max(0.1, rounded(node.strokeWidth * scale)),
      }
    case "icon":
      return {
        ...node,
        ...geometry,
        strokeWidth: rounded(node.strokeWidth * scale),
      }
    case "image":
      return { ...node, ...geometry }
  }
}

function checkedChangeSet(document: Document, changeSet: ChangeSet) {
  const parsed = changeSetSchema.parse(changeSet)
  const conflict = getChangeSetConflict(document, parsed)
  if (conflict) throw new Error(conflict.message)
  previewChangeSet(document, parsed)
  return parsed
}

export function createFieldUpdateChangeSet(
  document: Document,
  input: FieldUpdateProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  const shell: ChangeSet = {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    title: input.reason?.trim() || "Update shared content",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations: Object.entries(input.values).flatMap(([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field) throw new Error(`Unknown shared field: ${key}`)
      if (!fieldValueMatchesType(field, value)) {
        throw new Error(`Invalid value for ${field.label}`)
      }
      if (document.fieldValues[field.id] === value) return []
      const bindingCount = document.bindings.filter(
        (binding) => binding.fieldId === field.id
      ).length
      const at = identity.now()
      return [
        {
          id: `operation-${identity.id()}`,
          status: "pending" as const,
          summary: `Update ${field.label} in ${bindingCount} bound layer${bindingCount === 1 ? "" : "s"}`,
          command: {
            id: `command-${identity.id()}`,
            type: "set_field" as const,
            actor: "agent" as const,
            at,
            fieldId: field.id,
            value,
          },
        },
      ]
    }),
  }
  if (!shell.operations.length) {
    throw new Error("The proposed values already match the document.")
  }
  return checkedChangeSet(document, shell)
}

export function createCanvasEditChangeSet(
  document: Document,
  input: CanvasEditProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  if (!input.edits.length || input.edits.length > 24) {
    throw new Error("Propose between 1 and 24 canvas edits at a time.")
  }
  const seen = new Set<string>()
  const operations = input.edits.map((edit) => {
    if (seen.has(edit.nodeId)) {
      throw new Error(`Combine duplicate edits for node ${edit.nodeId}.`)
    }
    seen.add(edit.nodeId)
    const node = document.nodes.find(
      (candidate) => candidate.id === edit.nodeId
    )
    if (!node) throw new Error(`Unknown node: ${edit.nodeId}`)
    const patch = Object.fromEntries(
      Object.entries(edit.patch).filter(
        ([key, value]) => node[key as keyof SceneNode] !== value
      )
    )
    const keys = Object.keys(patch)
    if (!keys.length) throw new Error(`${node.name} already has those values.`)
    for (const key of keys) {
      if (
        !commonCanvasProperties.has(key) &&
        !nodeCanvasProperties[node.type].has(key)
      ) {
        throw new Error(`${key} cannot be changed on ${node.name}.`)
      }
      if (
        document.bindings.some(
          (binding) => binding.nodeId === node.id && binding.property === key
        )
      ) {
        throw new Error(
          `${node.name}.${key} is bound. Use propose_field_updates instead.`
        )
      }
    }
    return {
      id: `operation-${identity.id()}`,
      status: "pending" as const,
      summary:
        edit.summary?.trim() || `Update ${node.name}: ${keys.join(", ")}`,
      command: {
        id: `command-${identity.id()}`,
        type: "update_node" as const,
        actor: "agent" as const,
        at: identity.now(),
        nodeId: node.id,
        patch,
      },
    }
  })
  return checkedChangeSet(document, {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    title: input.reason?.trim() || "Refine canvas layout",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations,
  })
}

export function createOutputVariantChangeSet(
  document: Document,
  input: OutputVariantProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  if (!input.name.trim()) throw new Error("Output name is required.")
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 256 ||
    input.height < 256 ||
    input.width > 4096 ||
    input.height > 4096
  ) {
    throw new Error("Output dimensions must be whole pixels from 256 to 4096.")
  }
  const formats = [...new Set(input.exportFormats)]
  if (!formats.length) throw new Error("Choose at least one export format.")
  const sourcePage = document.pages.find(
    (candidate) => candidate.id === input.sourcePageId
  )
  if (!sourcePage) throw new Error(`Unknown source page: ${input.sourcePageId}`)

  const outputId = `output-${identity.id()}`
  const pageId = `page-${identity.id()}`
  const sourceNodes = sourcePage.nodeIds.map((nodeId) => {
    const node = document.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`Source page contains missing node: ${nodeId}`)
    return node
  })
  const nodeIdMap = new Map(
    sourceNodes.map((node) => [node.id, `node-${identity.id()}`])
  )
  const scaleX = input.width / sourcePage.width
  const scaleY = input.height / sourcePage.height
  const nodes = sourceNodes.map((node) =>
    scaleNode(node, nodeIdMap.get(node.id)!, scaleX, scaleY)
  )
  const sourceGroups = document.groups.filter(
    (group) => group.pageId === sourcePage.id
  )
  const groupIdMap = new Map(
    sourceGroups.map((group) => [group.id, `group-${identity.id()}`])
  )
  const groups = sourceGroups.map((group) => ({
    ...group,
    id: groupIdMap.get(group.id)!,
    pageId,
    nodeIds: group.nodeIds.map((nodeId) => nodeIdMap.get(nodeId)!),
    parentGroupId: group.parentGroupId
      ? groupIdMap.get(group.parentGroupId)
      : undefined,
  }))
  const bindings = document.bindings.flatMap((binding) => {
    const nodeId = nodeIdMap.get(binding.nodeId)
    return nodeId
      ? [{ ...binding, id: `binding-${identity.id()}`, nodeId }]
      : []
  })
  const changeSet: ChangeSet = {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    title: input.reason?.trim() || `Adapt ${sourcePage.name} to ${input.name}`,
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations: [
      {
        id: `operation-${identity.id()}`,
        status: "pending",
        summary: `Create ${input.name} at ${input.width} × ${input.height} with ${nodes.length} adapted layers and ${bindings.length} shared binding${bindings.length === 1 ? "" : "s"}`,
        command: {
          id: `command-${identity.id()}`,
          type: "add_output_variant",
          actor: "agent",
          at: identity.now(),
          output: {
            id: outputId,
            name: input.name.trim(),
            kind: input.kind,
            pageIds: [pageId],
            exportFormats: formats,
          },
          page: {
            id: pageId,
            outputId,
            name: input.pageName?.trim() || input.name.trim(),
            width: input.width,
            height: input.height,
            background: sourcePage.background,
            nodeIds: nodes.map((node) => node.id),
          },
          nodes,
          groups,
          bindings,
        },
      },
    ],
  }
  return checkedChangeSet(document, changeSet)
}
