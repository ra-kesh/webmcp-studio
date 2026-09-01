import {
  analyzeFieldDeletion,
  changeSetSchema,
  fieldValueMatchesType,
  getChangeSetConflict,
  normalizeFieldValueForStorage,
  previewChangeSet,
  componentSourceSubtree,
  type ChangeSet,
  type ComponentTransform,
  type DesignStyleTarget,
  type DesignVariable,
  type DesignVariablePatch,
  type Document,
  type DocumentCommand,
  type ImageFrameMask,
  type ImagePlacement,
  type PaintStyle,
  type PaintStylePatch,
  type SceneNode,
  type TypographyStyle,
  type TypographyStylePatch,
  type VariableBindingTarget,
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

export type DesignStyleProposalChange =
  | {
      kind: "typography"
      action: "create"
      style: Omit<TypographyStyle, "id">
    }
  | {
      kind: "typography"
      action: "update"
      styleId: string
      patch: TypographyStylePatch
    }
  | {
      kind: "typography"
      action: "apply"
      styleId: string
      targets: DesignStyleTarget[]
    }
  | {
      kind: "typography"
      action: "detach"
      targets: DesignStyleTarget[]
    }
  | { kind: "typography"; action: "delete"; styleId: string }
  | { kind: "paint"; action: "create"; style: Omit<PaintStyle, "id"> }
  | {
      kind: "paint"
      action: "update"
      styleId: string
      patch: PaintStylePatch
    }
  | {
      kind: "paint"
      action: "apply"
      styleId: string
      targets: DesignStyleTarget[]
    }
  | { kind: "paint"; action: "detach"; targets: DesignStyleTarget[] }
  | { kind: "paint"; action: "delete"; styleId: string }

export type DesignStyleProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
  reason?: string
  changes: DesignStyleProposalChange[]
}

export type DesignVariableProposalChange =
  | { action: "create"; variable: Omit<DesignVariable, "id"> }
  | { action: "update"; variableId: string; patch: DesignVariablePatch }
  | {
      action: "bind"
      variableId: string
      target: VariableBindingTarget
    }
  | { action: "unbind"; bindingId: string }
  | { action: "delete"; variableId: string }

export type DesignVariableProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
  reason?: string
  changes: DesignVariableProposalChange[]
}

type CommandOf<Type extends DocumentCommand["type"]> = Extract<
  DocumentCommand,
  { type: Type }
>

export type ComponentProposalChange =
  | {
      action: "create_instance"
      componentId: string
      pageId: string
      parentGroupId?: string
      name?: string
      variantId?: string
      transform: ComponentTransform
    }
  | {
      action: "switch_variant"
      instanceId: string
      variantId: string
    }
  | {
      action: "update_instance"
      instanceId: string
      patch: CommandOf<"update_component_instance_metadata">["patch"]
    }
  | {
      action: "set_override"
      instanceId: string
      sourceNodeId: string
      patch: CommandOf<"update_component_instance">["patch"]
    }
  | {
      action: "reset_override"
      instanceId: string
      sourceNodeId: string
      properties?: CommandOf<"reset_component_override">["properties"]
    }
  | { action: "reset_all_overrides"; instanceId: string }
  | { action: "detach_instance"; instanceId: string }

export type ComponentProposalInput = {
  documentId: string
  baseRevision: number
  baseSnapshotId: string
  reason?: string
  changes: ComponentProposalChange[]
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
  "flipX",
  "flipY",
  "opacity",
  "visible",
  "locked",
  "constraints",
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
    constraints: { horizontal: "min", vertical: "min" },
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

const designStyleTargetSummary = (targets: readonly DesignStyleTarget[]) => {
  const rangeCount = targets.filter((target) => target.range).length
  return `${targets.length} layer target${targets.length === 1 ? "" : "s"}${rangeCount ? `, including ${rangeCount} text range${rangeCount === 1 ? "" : "s"}` : ""}`
}

export function createDesignStyleChangeSet(
  document: Document,
  input: DesignStyleProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  if (!input.changes.length) {
    throw new Error("Choose at least one design style change.")
  }
  const operations: ChangeSet["operations"] = input.changes.map((change) => {
    const at = identity.now()
    const base = {
      id: `operation-${identity.id()}`,
      status: "pending" as const,
    }
    if (change.kind === "typography") {
      if (change.action === "create") {
        const style = {
          ...change.style,
          id: `typography-style-${identity.id()}`,
        }
        return {
          ...base,
          summary: `Create text style ${style.name}`,
          command: {
            id: `command-${identity.id()}`,
            type: "create_typography_style",
            actor: "agent",
            at,
            style,
          },
        }
      }
      if (change.action === "update") {
        const style = document.typographyStyles.find(
          (candidate) => candidate.id === change.styleId
        )
        return {
          ...base,
          summary: `Update text style ${style?.name ?? change.styleId}`,
          command: {
            id: `command-${identity.id()}`,
            type: "update_typography_style",
            actor: "agent",
            at,
            styleId: change.styleId,
            patch: change.patch,
          },
        }
      }
      if (change.action === "apply") {
        const style = document.typographyStyles.find(
          (candidate) => candidate.id === change.styleId
        )
        return {
          ...base,
          summary: `Apply text style ${style?.name ?? change.styleId} to ${designStyleTargetSummary(change.targets)}`,
          command: {
            id: `command-${identity.id()}`,
            type: "apply_typography_style",
            actor: "agent",
            at,
            styleId: change.styleId,
            targets: change.targets,
          },
        }
      }
      if (change.action === "detach") {
        return {
          ...base,
          summary: `Detach text style from ${designStyleTargetSummary(change.targets)}`,
          command: {
            id: `command-${identity.id()}`,
            type: "detach_typography_style",
            actor: "agent",
            at,
            targets: change.targets,
          },
        }
      }
      const style = document.typographyStyles.find(
        (candidate) => candidate.id === change.styleId
      )
      return {
        ...base,
        summary: `Delete text style ${style?.name ?? change.styleId}`,
        command: {
          id: `command-${identity.id()}`,
          type: "delete_typography_style",
          actor: "agent",
          at,
          styleId: change.styleId,
        },
      }
    }

    if (change.action === "create") {
      const style = { ...change.style, id: `paint-style-${identity.id()}` }
      return {
        ...base,
        summary: `Create paint style ${style.name}`,
        command: {
          id: `command-${identity.id()}`,
          type: "create_paint_style",
          actor: "agent",
          at,
          style,
        },
      }
    }
    if (change.action === "update") {
      const style = document.paintStyles.find(
        (candidate) => candidate.id === change.styleId
      )
      return {
        ...base,
        summary: `Update paint style ${style?.name ?? change.styleId}`,
        command: {
          id: `command-${identity.id()}`,
          type: "update_paint_style",
          actor: "agent",
          at,
          styleId: change.styleId,
          patch: change.patch,
        },
      }
    }
    if (change.action === "apply") {
      const style = document.paintStyles.find(
        (candidate) => candidate.id === change.styleId
      )
      return {
        ...base,
        summary: `Apply paint style ${style?.name ?? change.styleId} to ${designStyleTargetSummary(change.targets)}`,
        command: {
          id: `command-${identity.id()}`,
          type: "apply_paint_style",
          actor: "agent",
          at,
          styleId: change.styleId,
          targets: change.targets,
        },
      }
    }
    if (change.action === "detach") {
      return {
        ...base,
        summary: `Detach paint style from ${designStyleTargetSummary(change.targets)}`,
        command: {
          id: `command-${identity.id()}`,
          type: "detach_paint_style",
          actor: "agent",
          at,
          targets: change.targets,
        },
      }
    }
    const style = document.paintStyles.find(
      (candidate) => candidate.id === change.styleId
    )
    return {
      ...base,
      summary: `Delete paint style ${style?.name ?? change.styleId}`,
      command: {
        id: `command-${identity.id()}`,
        type: "delete_paint_style",
        actor: "agent",
        at,
        styleId: change.styleId,
      },
    }
  })
  return checkedChangeSet(document, {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || "Update reusable design styles",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations,
  })
}

export function createDesignVariableChangeSet(
  document: Document,
  input: DesignVariableProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  if (!input.changes.length) {
    throw new Error("Choose at least one variable change.")
  }
  const operations: ChangeSet["operations"] = input.changes.map((change) => {
    const at = identity.now()
    const base = {
      id: `operation-${identity.id()}`,
      status: "pending" as const,
    }
    if (change.action === "create") {
      const variable = {
        ...change.variable,
        id: `variable-${identity.id()}`,
      } as DesignVariable
      return {
        ...base,
        summary: `Create ${variable.type.replace("_", " ")} variable ${variable.name}`,
        command: {
          id: `command-${identity.id()}`,
          type: "create_variable" as const,
          actor: "agent" as const,
          at,
          variable,
        },
      }
    }
    if (change.action === "update") {
      const variable = document.variables.find(
        (candidate) => candidate.id === change.variableId
      )
      return {
        ...base,
        summary: `Update variable ${variable?.name ?? change.variableId}`,
        command: {
          id: `command-${identity.id()}`,
          type: "update_variable" as const,
          actor: "agent" as const,
          at,
          variableId: change.variableId,
          patch: change.patch,
        },
      }
    }
    if (change.action === "bind") {
      const variable = document.variables.find(
        (candidate) => candidate.id === change.variableId
      )
      return {
        ...base,
        summary: `Bind variable ${variable?.name ?? change.variableId} to ${change.target.kind.replace("_", " ")}.${change.target.property}`,
        command: {
          id: `command-${identity.id()}`,
          type: "bind_variable" as const,
          actor: "agent" as const,
          at,
          binding: {
            id: `variable-binding-${identity.id()}`,
            variableId: change.variableId,
            target: change.target,
          },
        },
      }
    }
    if (change.action === "unbind") {
      return {
        ...base,
        summary: `Unbind variable relationship ${change.bindingId}`,
        command: {
          id: `command-${identity.id()}`,
          type: "unbind_variable" as const,
          actor: "agent" as const,
          at,
          bindingId: change.bindingId,
        },
      }
    }
    const variable = document.variables.find(
      (candidate) => candidate.id === change.variableId
    )
    return {
      ...base,
      summary: `Delete variable ${variable?.name ?? change.variableId}`,
      command: {
        id: `command-${identity.id()}`,
        type: "delete_variable" as const,
        actor: "agent" as const,
        at,
        variableId: change.variableId,
      },
    }
  })

  return checkedChangeSet(document, {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || "Update design variables",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations,
  })
}

export function createComponentChangeSet(
  document: Document,
  input: ComponentProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  if (!input.changes.length) {
    throw new Error("Choose at least one component change.")
  }
  const operations: ChangeSet["operations"] = input.changes.map((change) => {
    const at = identity.now()
    let command: DocumentCommand
    let summary: string

    if (change.action === "create_instance") {
      const component = document.components.find(
        (candidate) => candidate.id === change.componentId
      )
      const page = document.pages.find(
        (candidate) => candidate.id === change.pageId
      )
      if (!component)
        throw new Error(`Unknown component: ${change.componentId}`)
      if (!page) throw new Error(`Unknown page: ${change.pageId}`)
      const source = componentSourceSubtree(document, component.sourceGroupId)
      if (!source?.nodeIds.length) {
        throw new Error(`Component ${component.name} has no source layers.`)
      }
      const variantId = change.variantId ?? component.defaultVariantId
      if (!component.variants.some((variant) => variant.id === variantId)) {
        throw new Error(`Unknown component variant: ${variantId}`)
      }
      const groupMappings = source.groupIds.map((sourceGroupId) => ({
        sourceGroupId,
        instanceGroupId: `component-instance-group-${identity.id()}`,
      }))
      const nodeMappings = source.nodeIds.map((sourceNodeId) => ({
        sourceNodeId,
        instanceNodeId: `component-instance-node-${identity.id()}`,
      }))
      const rootGroupId = groupMappings.find(
        (mapping) => mapping.sourceGroupId === component.sourceGroupId
      )?.instanceGroupId
      if (!rootGroupId) {
        throw new Error(`Component ${component.name} has no root mapping.`)
      }
      const instanceNumber =
        document.componentInstances.filter(
          (instance) => instance.componentId === component.id
        ).length + 1
      command = {
        id: `command-${identity.id()}`,
        type: "create_component_instance",
        actor: "agent",
        at,
        pageId: page.id,
        ...(change.parentGroupId
          ? { parentGroupId: change.parentGroupId }
          : {}),
        instance: {
          id: `component-instance-${identity.id()}`,
          name: change.name?.trim() || `${component.name} ${instanceNumber}`,
          componentId: component.id,
          variantId,
          rootGroupId,
          transform: change.transform,
          nodeMappings,
          groupMappings,
          overrides: {},
        },
      }
      summary = `Insert ${component.name} instance on ${page.name}`
    } else if (change.action === "switch_variant") {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      if (instance?.variantId === change.variantId) {
        throw new Error(`${instance.name} already uses that variant.`)
      }
      command = {
        id: `command-${identity.id()}`,
        type: "switch_component_variant",
        actor: "agent",
        at,
        instanceId: change.instanceId,
        variantId: change.variantId,
      }
      summary = `Switch ${instance?.name ?? change.instanceId} variant`
    } else if (change.action === "update_instance") {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      command = {
        id: `command-${identity.id()}`,
        type: "update_component_instance_metadata",
        actor: "agent",
        at,
        instanceId: change.instanceId,
        patch: change.patch,
      }
      summary = `Update ${instance?.name ?? change.instanceId}`
    } else if (change.action === "set_override") {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      command = {
        id: `command-${identity.id()}`,
        type: "update_component_instance",
        actor: "agent",
        at,
        instanceId: change.instanceId,
        sourceNodeId: change.sourceNodeId,
        patch: change.patch,
      }
      summary = `Override ${instance?.name ?? change.instanceId}: ${Object.keys(change.patch).join(", ")}`
    } else if (change.action === "reset_override") {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      command = {
        id: `command-${identity.id()}`,
        type: "reset_component_override",
        actor: "agent",
        at,
        instanceId: change.instanceId,
        sourceNodeId: change.sourceNodeId,
        ...(change.properties ? { properties: change.properties } : {}),
      }
      summary = `Reset ${instance?.name ?? change.instanceId} layer overrides`
    } else if (change.action === "reset_all_overrides") {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      command = {
        id: `command-${identity.id()}`,
        type: "reset_all_component_overrides",
        actor: "agent",
        at,
        instanceId: change.instanceId,
      }
      summary = `Reset all ${instance?.name ?? change.instanceId} overrides`
    } else {
      const instance = document.componentInstances.find(
        (candidate) => candidate.id === change.instanceId
      )
      command = {
        id: `command-${identity.id()}`,
        type: "detach_component_instance",
        actor: "agent",
        at,
        instanceId: change.instanceId,
      }
      summary = `Detach ${instance?.name ?? change.instanceId}`
    }

    return {
      id: `operation-${identity.id()}`,
      status: "pending" as const,
      summary,
      command,
    }
  })
  return checkedChangeSet(document, {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    baseSnapshotId: input.baseSnapshotId,
    title: input.reason?.trim() || "Update reusable components",
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
  const variableBindings = document.variableBindings.flatMap((binding) => {
    const target = binding.target
    if (target.kind !== "node" && target.kind !== "text_range") return []
    const nodeId = nodeIdMap.get(target.nodeId)
    return nodeId
      ? [
          {
            ...binding,
            id: `variable-binding-${identity.id()}`,
            target: { ...target, nodeId },
          },
        ]
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
        summary: `Create ${input.name} at ${input.width} × ${input.height} with ${nodes.length} adapted layers, ${bindings.length} shared field binding${bindings.length === 1 ? "" : "s"}, and ${variableBindings.length} variable binding${variableBindings.length === 1 ? "" : "s"}`,
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
          componentInstances: [],
          bindings,
          variableBindings,
        },
      },
    ],
  }
  return checkedChangeSet(document, changeSet)
}
