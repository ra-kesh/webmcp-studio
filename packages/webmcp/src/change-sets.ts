import {
  analyzeFieldDeletion,
  changeSetSchema,
  fieldValueMatchesType,
  getChangeSetConflict,
  normalizeFieldValueForStorage,
  previewChangeSet,
  type ChangeSet,
  type Document,
  type ImageFrameMask,
  type ImagePlacement,
  type SceneNode,
} from "@webmcp/document"

export type FieldUpdateProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
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
  baseSnapshotId: string
  reason?: string
  edits: Array<{
    nodeType: SceneNode["type"]
    nodeId: string
    patch: Record<string, unknown>
    summary?: string
    assetId?: string
    replacementAsset?: {
      id: string
      src: string
    }
  }>
}

export type OutputVariantProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
  sourcePageId: string
  name: string
  pageName?: string
  kind: "proposal" | "whatsapp_portrait" | "square" | "custom"
  width: number
  height: number
  exportFormats: Array<"png" | "pdf">
  reason?: string
}

export type AssetInsertionProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
  pageId: string
  asset: { id: string; src: string; alt: string; name: string }
  x: number
  y: number
  width: number
  height: number
  placement: ImagePlacement
  frameMask?: ImageFrameMask
  decorative?: boolean
  values?: Record<string, string | number | boolean>
  reason?: string
}

export function canvasPatchValuesEqual(
  current: unknown,
  proposed: unknown
): boolean {
  if (Object.is(current, proposed)) return true
  if (
    current === null ||
    proposed === null ||
    typeof current !== "object" ||
    typeof proposed !== "object"
  ) {
    return false
  }
  if (Array.isArray(current) || Array.isArray(proposed)) {
    return (
      Array.isArray(current) &&
      Array.isArray(proposed) &&
      current.length === proposed.length &&
      current.every((value, index) =>
        canvasPatchValuesEqual(value, proposed[index])
      )
    )
  }
  const currentRecord = current as Record<string, unknown>
  const proposedRecord = proposed as Record<string, unknown>
  const currentKeys = Object.keys(currentRecord)
  const proposedKeys = Object.keys(proposedRecord)
  return (
    currentKeys.length === proposedKeys.length &&
    currentKeys.every(
      (key) =>
        Object.hasOwn(proposedRecord, key) &&
        canvasPatchValuesEqual(currentRecord[key], proposedRecord[key])
    )
  )
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
    "sizingMode",
  ]),
  rect: new Set(["fill", "radius", "stroke", "strokeWidth"]),
  ellipse: new Set(["fill", "stroke", "strokeWidth"]),
  line: new Set(["stroke", "strokeWidth"]),
  icon: new Set(["fill", "stroke", "strokeWidth"]),
  image: new Set(["placement", "frameMask", "alt", "decorative"]),
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
  const conflict = getChangeSetConflict(document, parsed, parsed.baseSnapshotId)
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
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || "Update shared content",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations: Object.entries(input.values).flatMap(([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field) throw new Error(`Unknown shared field: ${key}`)
      if (field.type === "currency" && typeof value !== "string") {
        throw new Error(
          `${field.label} must use an exact decimal string at the public API boundary`
        )
      }
      if (!fieldValueMatchesType(field, value)) {
        throw new Error(`Invalid value for ${field.label}`)
      }
      const normalizedValue = normalizeFieldValueForStorage(field, value)
      const currentValue = document.fieldValues[field.id]
      const normalizedCurrentValue =
        currentValue === undefined
          ? undefined
          : normalizeFieldValueForStorage(field, currentValue)
      if (normalizedCurrentValue === normalizedValue) return []
      const impact = analyzeFieldDeletion(document, field.id)
      const at = identity.now()
      return [
        {
          id: `operation-${identity.id()}`,
          status: "pending" as const,
          summary: `Update ${field.label} in ${impact.bindingCount} bound layer${impact.bindingCount === 1 ? "" : "s"} across ${impact.outputCount} output${impact.outputCount === 1 ? "" : "s"}`,
          command: {
            id: `command-${identity.id()}`,
            type: "set_field" as const,
            actor: "agent" as const,
            at,
            fieldId: field.id,
            value: normalizedValue,
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
    if (edit.nodeType !== node.type) {
      throw new Error(
        `${node.name} is a ${node.type} layer, not ${edit.nodeType}. Inspect the design again before proposing edits.`
      )
    }
    if (edit.assetId && !edit.replacementAsset) {
      throw new Error(`Asset ${edit.assetId} was not resolved by the studio.`)
    }
    const requestedPatch = edit.replacementAsset
      ? {
          ...edit.patch,
          assetId: edit.replacementAsset.id,
          src: edit.replacementAsset.src,
        }
      : edit.patch
    if (edit.replacementAsset && node.type !== "image") {
      throw new Error(`${node.name} is not an image layer.`)
    }
    const patch = Object.fromEntries(
      Object.entries(requestedPatch).filter(
        ([key, value]) =>
          !canvasPatchValuesEqual(node[key as keyof SceneNode], value)
      )
    )
    const keys = Object.keys(patch)
    if (!keys.length) throw new Error(`${node.name} already has those values.`)
    for (const key of keys) {
      if (
        document.bindings.some(
          (binding) => binding.nodeId === node.id && binding.property === key
        )
      ) {
        throw new Error(
          `${node.name}.${key} is bound. Use propose_field_updates instead.`
        )
      }
      const trustedAssetProperty =
        Boolean(edit.replacementAsset) &&
        node.type === "image" &&
        (key === "assetId" || key === "src")
      if (
        !trustedAssetProperty &&
        !commonCanvasProperties.has(key) &&
        !nodeCanvasProperties[node.type].has(key)
      ) {
        throw new Error(`${key} cannot be changed on ${node.name}.`)
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
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || "Refine canvas layout",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations,
  })
}

export function createAssetInsertionChangeSet(
  document: Document,
  input: AssetInsertionProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  const page = document.pages.find((candidate) => candidate.id === input.pageId)
  if (!page) throw new Error(`Unknown page: ${input.pageId}`)
  const geometry = [input.x, input.y, input.width, input.height]
  if (geometry.some((value) => !Number.isFinite(value))) {
    throw new Error("Asset geometry must contain finite numbers.")
  }
  if (
    input.x < 0 ||
    input.y < 0 ||
    input.width < 1 ||
    input.height < 1 ||
    input.x + input.width > page.width ||
    input.y + input.height > page.height
  ) {
    throw new Error(`Asset geometry must fit inside ${page.name}.`)
  }
  const node: SceneNode = {
    id: `image-${identity.id()}`,
    type: "image",
    name: input.asset.name,
    assetId: input.asset.id,
    src: input.asset.src,
    alt: input.asset.alt,
    placement: input.placement,
    frameMask: input.frameMask ?? { shape: "rectangle" },
    decorative: input.decorative ?? false,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
  const at = identity.now()
  const fieldOperations = input.values
    ? createFieldUpdateChangeSet(
        document,
        {
          documentId: input.documentId,
          baseRevision: input.baseRevision,
          baseSnapshotId: input.baseSnapshotId,
          values: input.values,
          reason: input.reason,
        },
        identity
      ).operations
    : []
  return checkedChangeSet(document, {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || `Add ${input.asset.name}`,
    createdAt: at,
    createdBy: "agent",
    status: "pending",
    operations: [
      ...fieldOperations,
      {
        id: `operation-${identity.id()}`,
        status: "pending",
        summary: `Add ${input.asset.name} to ${page.name}`,
        command: {
          id: `command-${identity.id()}`,
          type: "add_node",
          actor: "agent",
          at,
          pageId: page.id,
          node,
        },
      },
    ],
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
    baseSnapshotId: input.baseSnapshotId,
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
