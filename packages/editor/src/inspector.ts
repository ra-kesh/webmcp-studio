import type { Document, SceneNode } from "@webmcp/document"
import {
  initialMaskPaintAdmission,
  PagePaintPlanError,
  projectPagePaintPlan,
  supportedMaskPaintPixelRatio,
} from "@webmcp/document/internal/page-paint-plan"

export type InspectorSharedValue<T> =
  { kind: "empty" } | { kind: "value"; value: T } | { kind: "mixed" }

export type InspectorNodeCapabilities = {
  text: boolean
  fill: boolean
  stroke: boolean
  cornerRadius: boolean
  image: boolean
  canEnterCrop: boolean
  canReplaceImage: boolean
  replaceImageDisabledReason: string | null
  canFlipImage: boolean
  canApplyFrameMask: boolean
  hasMissingSource: boolean
}

export type MaskCommandCapability = Readonly<{
  enabled: boolean
  disabledReason: string | null
}>

export type InspectorMaskCapabilities = Readonly<{
  groupId: string | null
  createParentGroupId: string | null
  type: "vector" | "alpha" | "luminance" | null
  sourceNodeIds: readonly string[]
  eligibleSourceNodeIds: readonly string[]
  createSourceNodeIds: readonly string[]
  reassignmentSourceNodeIds: readonly string[]
  create: MaskCommandCapability
  release: MaskCommandCapability
  setVector: MaskCommandCapability
  setAlpha: MaskCommandCapability
  setLuminance: MaskCommandCapability
  setSources: MaskCommandCapability
}>

export type InspectorMaskCapabilityContext = Readonly<{
  document: Document
  pageId: string
  selectedNodeIds: readonly string[]
  selectedGroupId?: string | null
  candidateSourceNodeIds?: readonly string[]
  documentEditable?: boolean
}>

const MASK_REVIEW_REASON = "Resolve the pending review before editing masks."
const MASK_LOCKED_REASON = "Unlock the selected layers before editing masks."
const MASK_COMPONENT_REASON =
  "Mask structure cannot be changed inside a component or instance. Detach the instance or use layers outside the component."

const maskCapability = (
  enabled: boolean,
  disabledReason: string | null
): MaskCommandCapability => ({
  enabled,
  disabledReason: enabled ? null : disabledReason,
})

const vectorMaskSource = (node: SceneNode | undefined) =>
  node?.type === "rect" || node?.type === "ellipse" || node?.type === "icon"

function maskComponentOwnership(document: Document) {
  const sourceNodeIds = new Set<string>()
  const sourceGroupIds = new Set<string>()
  const collect = (groupId: string, visited = new Set<string>()) => {
    if (visited.has(groupId)) return
    visited.add(groupId)
    const group = document.groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    sourceGroupIds.add(group.id)
    for (const nodeId of group.nodeIds) sourceNodeIds.add(nodeId)
    for (const child of document.groups.filter(
      (candidate) => candidate.parentGroupId === group.id
    )) {
      collect(child.id, visited)
    }
  }
  for (const component of document.components) collect(component.sourceGroupId)
  return {
    sourceNodeIds,
    sourceGroupIds,
    instanceNodeIds: new Set(
      document.componentInstances.flatMap((instance) =>
        instance.nodeMappings.map((mapping) => mapping.instanceNodeId)
      )
    ),
    instanceGroupIds: new Set(
      document.componentInstances.flatMap((instance) =>
        instance.groupMappings.map((mapping) => mapping.instanceGroupId)
      )
    ),
  }
}

function groupSubtreeIds(
  document: Document,
  groupId: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(groupId)) return []
  visited.add(groupId)
  return [
    groupId,
    ...document.groups
      .filter((candidate) => candidate.parentGroupId === groupId)
      .flatMap((candidate) => groupSubtreeIds(document, candidate.id, visited)),
  ]
}

function maskSourceAdmissionReason(
  document: Document,
  node: SceneNode | undefined,
  maskType: "vector" | "alpha" | "luminance"
): string | null {
  if (
    maskType !== "vector" &&
    node &&
    (vectorMaskSource(node) || node.type === "image" || node.type === "text")
  ) {
    if (document.bindings.some((binding) => binding.nodeId === node.id)) {
      return "A field-bound layer cannot be a mask source. Unbind it first."
    }
    return null
  }
  if (!vectorMaskSource(node)) {
    return "The back layer must be an unlocked rectangle, ellipse, or icon for a vector mask."
  }
  if (node.strokeWidth !== 0) {
    return "Vector mask sources must not have a stroke."
  }
  if (document.bindings.some((binding) => binding.nodeId === node.id)) {
    return "A field-bound layer cannot be a mask source. Unbind it first."
  }
  return null
}

/**
 * Canonical human-facing mask policy. Every menu, shortcut and inspector
 * projects these exact results instead of recreating selection rules.
 * The backmost selected layer is the deterministic source, matching the
 * established Figma/OpenPencil stack convention while storing its exact ID.
 */
export function deriveInspectorMaskCapabilities({
  document,
  pageId,
  selectedNodeIds,
  selectedGroupId = null,
  candidateSourceNodeIds = [],
  documentEditable = true,
}: InspectorMaskCapabilityContext): InspectorMaskCapabilities {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const selected = new Set(selectedNodeIds)
  const orderedSelectedNodeIds = (page?.nodeIds ?? []).filter((nodeId) =>
    selected.has(nodeId)
  )
  const nodes = orderedSelectedNodeIds.flatMap((nodeId) => {
    const node = nodeById.get(nodeId)
    return node ? [node] : []
  })
  const group = selectedGroupId
    ? document.groups.find((candidate) => candidate.id === selectedGroupId)
    : undefined
  const maskGroup = group?.role === "mask" ? group : undefined
  const mutationGroupIds = maskGroup
    ? groupSubtreeIds(document, maskGroup.id)
    : []
  const mutationNodeIds = new Set(
    mutationGroupIds.flatMap(
      (groupId) =>
        document.groups.find((candidate) => candidate.id === groupId)
          ?.nodeIds ?? []
    )
  )
  const componentOwnership = maskComponentOwnership(document)
  const inComponentInstance =
    nodes.some(
      (node) =>
        componentOwnership.sourceNodeIds.has(node.id) ||
        componentOwnership.instanceNodeIds.has(node.id)
    ) ||
    mutationGroupIds.some(
      (groupId) =>
        componentOwnership.sourceGroupIds.has(groupId) ||
        componentOwnership.instanceGroupIds.has(groupId)
    ) ||
    [...mutationNodeIds].some(
      (nodeId) =>
        componentOwnership.sourceNodeIds.has(nodeId) ||
        componentOwnership.instanceNodeIds.has(nodeId)
    )
  const anyLocked = nodes.some((node) => node.locked)
  const createSourceNodeIds = orderedSelectedNodeIds.slice(0, 1)
  const source = nodeById.get(createSourceNodeIds[0] ?? "")
  const directParentIds = orderedSelectedNodeIds.map(
    (nodeId) =>
      document.groups.find((candidate) => candidate.nodeIds.includes(nodeId))
        ?.id
  )
  const mixedParents = new Set(directParentIds).size > 1
  const nestedParentId = directParentIds[0]
  const nestedParent = nestedParentId
    ? document.groups.find((candidate) => candidate.id === nestedParentId)
    : undefined
  const sourceAdmissionReason = maskSourceAdmissionReason(
    document,
    source,
    "vector"
  )

  let createReason: string | null = null
  if (!documentEditable) createReason = MASK_REVIEW_REASON
  else if (!page) createReason = "The active page is no longer available."
  else if (orderedSelectedNodeIds.length < 2)
    createReason =
      "Select at least two layers. The back layer becomes the mask source."
  else if (orderedSelectedNodeIds.length !== selected.size)
    createReason = "Select layers from one page to create a mask."
  else if (anyLocked) createReason = MASK_LOCKED_REASON
  else if (inComponentInstance) createReason = MASK_COMPONENT_REASON
  else if (mixedParents)
    createReason = "Select layers that share the same parent."
  else if (
    nestedParent?.role === "mask" &&
    nestedParent.parentGroupId &&
    document.groups.find(
      (candidate) => candidate.id === nestedParent.parentGroupId
    )?.role === "mask"
  )
    createReason = "A mask can contain only one nested mask level."
  else if (
    nestedParent?.role === "mask" &&
    orderedSelectedNodeIds.some((nodeId) =>
      nestedParent.mask.sourceNodeIds.includes(nodeId)
    )
  )
    createReason = "A parent mask source cannot move into its child mask."
  else if (
    nestedParent?.role === "mask" &&
    orderedSelectedNodeIds.some(
      (nodeId, index) =>
        index > 0 &&
        page!.nodeIds.indexOf(nodeId) !==
          page!.nodeIds.indexOf(orderedSelectedNodeIds[index - 1]!) + 1
    )
  )
    createReason = "Nested mask layers must be contiguous in page order."
  else if (sourceAdmissionReason) createReason = sourceAdmissionReason
  else if (
    orderedSelectedNodeIds.length - createSourceNodeIds.length >
    initialMaskPaintAdmission.maxMaskedDescendants
  )
    createReason = `A mask can contain at most ${initialMaskPaintAdmission.maxMaskedDescendants} content layers. Select ${initialMaskPaintAdmission.maxMaskedDescendants + 1} layers or fewer.`
  else {
    const preflightGroupId = "__inspector-mask-admission-preflight__"
    const candidate: Document = {
      ...document,
      pages: document.pages.map((candidatePage) => {
        if (candidatePage.id !== pageId) return candidatePage
        const block = new Set(orderedSelectedNodeIds)
        const remaining = candidatePage.nodeIds.filter(
          (nodeId) => !block.has(nodeId)
        )
        const edgeIndex = Math.max(
          ...orderedSelectedNodeIds.map((nodeId) =>
            candidatePage.nodeIds.indexOf(nodeId)
          )
        )
        const toIndex = remaining.filter(
          (nodeId) => candidatePage.nodeIds.indexOf(nodeId) < edgeIndex
        ).length
        return {
          ...candidatePage,
          nodeIds: [
            ...remaining.slice(0, toIndex),
            ...orderedSelectedNodeIds,
            ...remaining.slice(toIndex),
          ],
        }
      }),
      groups: [
        ...document.groups.map((candidateGroup) =>
          candidateGroup.id === nestedParent?.id
            ? {
                ...candidateGroup,
                nodeIds: candidateGroup.nodeIds.filter(
                  (nodeId) => !selected.has(nodeId)
                ),
              }
            : candidateGroup
        ),
        {
          id: preflightGroupId,
          pageId,
          name: "Mask admission preflight",
          role: "mask",
          nodeIds: orderedSelectedNodeIds,
          ...(nestedParent ? { parentGroupId: nestedParent.id } : {}),
          mask: { type: "vector", sourceNodeIds: [createSourceNodeIds[0]!] },
        },
      ],
    }
    try {
      projectPagePaintPlan(candidate, pageId, {
        pixelRatio: supportedMaskPaintPixelRatio(
          initialMaskPaintAdmission.maxPixelRatio
        ),
      })
    } catch (error) {
      if (error instanceof PagePaintPlanError) {
        if (error.code === "MASK_GROUP_COMPOSITE_LIMIT")
          createReason =
            "The selected mask exceeds the Gate M2 composite bounds at 2x. Reduce or move the selected layers."
        else if (error.code === "MASK_PAGE_COMPOSITE_COUNT_LIMIT")
          createReason = `This page already has ${initialMaskPaintAdmission.maxActiveCompositesPerPage} active mask composites. Release a mask before creating another.`
        else if (error.code === "MASK_PAGE_COMPOSITE_AREA_LIMIT")
          createReason =
            "The selected mask would exceed the page's summed 2x composite area budget. Reduce its bounds or release another mask."
      }
    }
  }

  const groupNodes = maskGroup
    ? maskGroup.nodeIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId)
        return node ? [node] : []
      })
    : []
  const eligibleSourceNodeIds = (maskGroup ? groupNodes : nodes)
    .filter(
      (node) =>
        !node.locked &&
        maskSourceAdmissionReason(
          document,
          node,
          maskGroup?.mask.type === "vector"
            ? "vector"
            : (maskGroup?.mask.type ?? "vector")
        ) === null
    )
    .map((node) => node.id)
  let groupMutationReason: string | null = null
  if (!documentEditable) groupMutationReason = MASK_REVIEW_REASON
  else if (!maskGroup) groupMutationReason = "Select one mask group first."
  else if (maskGroup.pageId !== pageId)
    groupMutationReason = "Select a mask group on the active page."
  else if ([...mutationNodeIds].some((nodeId) => nodeById.get(nodeId)?.locked))
    groupMutationReason = MASK_LOCKED_REASON
  else if (inComponentInstance) groupMutationReason = MASK_COMPONENT_REASON

  const requestedSources = [...candidateSourceNodeIds]
  const uniqueRequestedSources = [...new Set(requestedSources)]
  let sourceReason = groupMutationReason
  if (!sourceReason && requestedSources.length === 0)
    sourceReason = "Choose at least one layer in this mask group as a source."
  else if (
    !sourceReason &&
    requestedSources.length > initialMaskPaintAdmission.maxSources
  )
    sourceReason = `A mask can use at most ${initialMaskPaintAdmission.maxSources} source layers.`
  else if (
    !sourceReason &&
    uniqueRequestedSources.length !== requestedSources.length
  )
    sourceReason = "Choose each mask source only once."
  else if (
    !sourceReason &&
    requestedSources.length >= (maskGroup?.nodeIds.length ?? 0)
  )
    sourceReason = "Keep at least one layer as masked content."
  if (!sourceReason) {
    for (const sourceNodeId of requestedSources) {
      const requestedSource = nodeById.get(sourceNodeId)
      if (!requestedSource || !maskGroup?.nodeIds.includes(sourceNodeId)) {
        sourceReason = "Choose direct layers in this mask group as sources."
        break
      }
      sourceReason = maskSourceAdmissionReason(
        document,
        requestedSource,
        maskGroup?.mask.type === "vector"
          ? "vector"
          : (maskGroup?.mask.type ?? "vector")
      )
      if (sourceReason) break
    }
  }
  if (
    !sourceReason &&
    maskGroup?.mask.sourceNodeIds.length === requestedSources.length &&
    maskGroup.mask.sourceNodeIds.every(
      (sourceNodeId, index) => sourceNodeId === requestedSources[index]
    )
  ) {
    sourceReason = "Those layers are already the mask sources in that order."
  }

  const currentSourcesAdmittedFor = (
    maskType: "vector" | "alpha" | "luminance"
  ) =>
    Boolean(
      maskGroup?.mask.sourceNodeIds.every(
        (sourceNodeId) =>
          maskSourceAdmissionReason(
            document,
            nodeById.get(sourceNodeId),
            maskType
          ) === null
      )
    )

  return {
    groupId: maskGroup?.id ?? null,
    createParentGroupId: nestedParent?.id ?? null,
    type: maskGroup?.mask.type ?? null,
    sourceNodeIds: maskGroup ? [...maskGroup.mask.sourceNodeIds] : [],
    eligibleSourceNodeIds,
    createSourceNodeIds,
    reassignmentSourceNodeIds: requestedSources,
    create: maskCapability(createReason === null, createReason),
    release: maskCapability(groupMutationReason === null, groupMutationReason),
    setVector: maskCapability(
      groupMutationReason === null &&
        maskGroup?.mask.type !== "vector" &&
        currentSourcesAdmittedFor("vector"),
      groupMutationReason ??
        (maskGroup?.mask.type === "vector"
          ? "This mask already uses Vector."
          : "Every current source must be an unstroked vector layer.")
    ),
    setAlpha: maskCapability(
      groupMutationReason === null &&
        maskGroup?.mask.type !== "alpha" &&
        currentSourcesAdmittedFor("alpha"),
      groupMutationReason ??
        (maskGroup?.mask.type === "alpha"
          ? "This mask already uses Alpha."
          : "Every current source must provide alpha coverage.")
    ),
    setLuminance: maskCapability(
      groupMutationReason === null &&
        maskGroup?.mask.type !== "luminance" &&
        currentSourcesAdmittedFor("luminance"),
      groupMutationReason ??
        (maskGroup?.mask.type === "luminance"
          ? "This mask already uses Luminance."
          : "Every current source must provide luminance coverage.")
    ),
    setSources: maskCapability(
      groupMutationReason === null &&
        (requestedSources.length === 0 || sourceReason === null),
      requestedSources.length === 0 ? groupMutationReason : sourceReason
    ),
  }
}

/**
 * Image decode state belongs to the host that resolves assets, not to the
 * document or renderer-neutral inspector model. `unknown` is intentionally
 * not treated as ready: callers must positively establish that pixels can be
 * decoded before exposing direct image transforms.
 */
export type InspectorImageSourceReadiness =
  "unknown" | "loading" | "ready" | "unavailable"

export type InspectorImageSourceState = Readonly<{
  /** The exact source whose readiness was observed. */
  src: string
  readiness: InspectorImageSourceReadiness
}>

export type InspectorImageReplacementConstraint = Readonly<{
  reason: string
}>

export type InspectorCapabilityContext = {
  /** False while review or another product-level read-only mode is active. */
  documentEditable?: boolean
  /** The active crop target, if an ephemeral crop session currently owns edits. */
  activeImageCropNodeId?: string | null
  /** Runtime asset/decode state keyed by canonical scene-node ID. */
  imageSourceStateByNodeId?: Readonly<
    Partial<Record<string, InspectorImageSourceState>>
  >
  /** Host-derived source-binding constraints keyed by canonical scene-node ID. */
  imageReplacementConstraintByNodeId?: Readonly<
    Partial<Record<string, InspectorImageReplacementConstraint>>
  >
}

export type InspectorSelectionModel = {
  mode: "none" | "single" | "multiple"
  count: number
  editableCount: number
  lockedCount: number
  allLocked: boolean
  someLocked: boolean
  nodeType: InspectorSharedValue<SceneNode["type"]>
  capabilities: InspectorNodeCapabilities
  values: {
    x: InspectorSharedValue<number>
    y: InspectorSharedValue<number>
    width: InspectorSharedValue<number>
    height: InspectorSharedValue<number>
    rotation: InspectorSharedValue<number>
    opacity: InspectorSharedValue<number>
    blendMode: InspectorSharedValue<NonNullable<SceneNode["blendMode"]>>
    visible: InspectorSharedValue<boolean>
    locked: InspectorSharedValue<boolean>
  }
}

const sharedValue = <Node, Value>(
  nodes: readonly Node[],
  read: (node: Node) => Value
): InspectorSharedValue<Value> => {
  const first = nodes[0]
  if (first === undefined) return { kind: "empty" }
  const value = read(first)
  return nodes.every((node) => Object.is(read(node), value))
    ? { kind: "value", value }
    : { kind: "mixed" }
}

export const capabilitiesForNodes = (
  nodes: readonly SceneNode[],
  context: InspectorCapabilityContext = {}
): InspectorNodeCapabilities => {
  const hasSelection = nodes.length > 0
  const imageNodes = nodes.filter(
    (node): node is Extract<SceneNode, { type: "image" }> =>
      node.type === "image"
  )
  const allImages = hasSelection && imageNodes.length === nodes.length
  const singleImage = allImages && imageNodes.length === 1
  const documentEditable = context.documentEditable ?? true
  const allSelectionEditable =
    documentEditable && nodes.every((node) => node.visible && !node.locked)
  const activeCropNodeId = context.activeImageCropNodeId ?? null
  const activeCropMatchesSelection =
    activeCropNodeId !== null &&
    singleImage &&
    imageNodes[0]?.id === activeCropNodeId
  const noCropActive = activeCropNodeId === null

  const imageSourceReadiness = imageNodes.map((node) => {
    if (node.src.trim().length === 0) return "unavailable"
    const sourceState = context.imageSourceStateByNodeId?.[node.id]
    return sourceState?.src === node.src ? sourceState.readiness : "unknown"
  })
  const allImageSourcesReady =
    allImages &&
    imageSourceReadiness.every((readiness) => readiness === "ready")
  const hasMissingSource = imageSourceReadiness.some(
    (readiness) => readiness === "unavailable"
  )
  const canMutateSelectedImages = allImages && allSelectionEditable
  const imageTransformModeAvailable = noCropActive || activeCropMatchesSelection
  const replacementConstraint = singleImage
    ? context.imageReplacementConstraintByNodeId?.[imageNodes[0]!.id]
    : undefined
  const replacementOtherwiseAvailable =
    singleImage && canMutateSelectedImages && noCropActive

  return {
    text: hasSelection && nodes.every((node) => node.type === "text"),
    fill:
      hasSelection &&
      nodes.every(
        (node) =>
          node.type === "rect" ||
          node.type === "frame" ||
          node.type === "ellipse" ||
          node.type === "icon"
      ),
    stroke:
      hasSelection &&
      nodes.every(
        (node) =>
          node.type === "rect" ||
          node.type === "frame" ||
          node.type === "ellipse" ||
          node.type === "line" ||
          node.type === "icon"
      ),
    cornerRadius:
      hasSelection &&
      nodes.every((node) => node.type === "rect" || node.type === "frame"),
    image: allImages,
    canEnterCrop:
      singleImage &&
      canMutateSelectedImages &&
      allImageSourcesReady &&
      noCropActive,
    canReplaceImage: replacementOtherwiseAvailable && !replacementConstraint,
    replaceImageDisabledReason:
      replacementOtherwiseAvailable && replacementConstraint
        ? replacementConstraint.reason
        : null,
    canFlipImage:
      canMutateSelectedImages &&
      allImageSourcesReady &&
      imageTransformModeAvailable,
    canApplyFrameMask:
      canMutateSelectedImages &&
      allImageSourcesReady &&
      imageTransformModeAvailable,
    hasMissingSource,
  }
}

export const createInspectorSelectionModel = (
  nodes: readonly SceneNode[],
  context: InspectorCapabilityContext = {}
): InspectorSelectionModel => {
  const lockedCount = nodes.filter((node) => node.locked).length
  const count = nodes.length
  return {
    mode: count === 0 ? "none" : count === 1 ? "single" : "multiple",
    count,
    editableCount: count - lockedCount,
    lockedCount,
    allLocked: count > 0 && lockedCount === count,
    someLocked: lockedCount > 0 && lockedCount < count,
    nodeType: sharedValue(nodes, (node) => node.type),
    capabilities: capabilitiesForNodes(nodes, context),
    values: {
      x: sharedValue(nodes, (node) => node.x),
      y: sharedValue(nodes, (node) => node.y),
      width: sharedValue(nodes, (node) => node.width),
      height: sharedValue(nodes, (node) => node.height),
      rotation: sharedValue(nodes, (node) => node.rotation),
      opacity: sharedValue(nodes, (node) => node.opacity),
      blendMode: sharedValue(nodes, (node) => node.blendMode ?? "normal"),
      visible: sharedValue(nodes, (node) => node.visible),
      locked: sharedValue(nodes, (node) => node.locked),
    },
  }
}

export type InspectorNumberConstraints = {
  label: string
  min?: number
  max?: number
  integer?: boolean
}

export type InspectorNumberResult =
  { ok: true; value: number } | { ok: false; message: string }

const finiteNumber = (value: string) => {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseInspectorNumber = (
  draft: string,
  current: number | undefined,
  constraints: InspectorNumberConstraints
): InspectorNumberResult => {
  const normalized = draft.trim()
  let value: number | null = null

  const relative = normalized.match(/^([+*/])\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/)
  if (relative && current !== undefined) {
    const operand = finiteNumber(relative[2] ?? "")
    if (operand !== null) {
      if (relative[1] === "+") value = current + operand
      if (relative[1] === "*") value = current * operand
      if (relative[1] === "/" && operand !== 0) value = current / operand
    }
  } else {
    value = finiteNumber(normalized)
  }

  if (value === null) {
    return {
      ok: false,
      message: `${constraints.label} must be a valid number.`,
    }
  }

  if (constraints.integer && !Number.isInteger(value)) {
    return {
      ok: false,
      message: `${constraints.label} must be a whole number.`,
    }
  }
  if (constraints.min !== undefined && value < constraints.min) {
    return {
      ok: false,
      message: `${constraints.label} must be at least ${constraints.min}.`,
    }
  }
  if (constraints.max !== undefined && value > constraints.max) {
    return {
      ok: false,
      message: `${constraints.label} must be at most ${constraints.max}.`,
    }
  }
  return { ok: true, value }
}

export const formatInspectorNumber = (value: number) =>
  String(Math.round(value * 100) / 100)
