import type { SceneNode } from "@webmcp/document"

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
          node.type === "ellipse" ||
          node.type === "icon"
      ),
    stroke:
      hasSelection &&
      nodes.every(
        (node) =>
          node.type === "rect" ||
          node.type === "ellipse" ||
          node.type === "line" ||
          node.type === "icon"
      ),
    cornerRadius: hasSelection && nodes.every((node) => node.type === "rect"),
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
