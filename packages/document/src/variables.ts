import type {
  DesignVariable,
  DesignStyleTarget,
  Document,
  SceneNode,
  VariableBinding,
  VariableBindingTarget,
} from "./schema"
import { applyTextStyleToRange } from "./text-range-editing"
import { applyTextLayoutPatch } from "./text-layout"
import {
  detachStyleForDirectNodePatch,
  propagatePaintStyle,
  propagateTypographyStyle,
} from "./design-styles"
import { synchronizeLegacyPaintFields } from "./paint-stack"

export type VariableUsage = Readonly<{
  variableId: string
  bindingIds: readonly string[]
  nodeIds: readonly string[]
  typographyStyleIds: readonly string[]
  paintStyleIds: readonly string[]
  totalBindingCount: number
}>

const colorProperties = new Set(["color", "fill", "stroke"])
const numberProperties = new Set([
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "strokeWidth",
  "radius",
])

export const variableTypeForTarget = (
  target: VariableBindingTarget
): DesignVariable["type"] => {
  if (target.property === "fontFamily") return "font_family"
  if (target.property === "text") return "string"
  if (colorProperties.has(target.property)) return "color"
  if (numberProperties.has(target.property)) return "number"
  throw new Error(`Unsupported variable property: ${target.property}`)
}

const targetKey = (target: VariableBindingTarget) => {
  if (target.kind === "node") {
    return `node:${target.nodeId}:${target.property}`
  }
  if (target.kind === "text_range") {
    return `text_range:${target.nodeId}:${target.range.start}:${target.range.end}:${target.property}`
  }
  return `${target.kind}:${target.styleId}:${target.property}`
}

const nodeForTarget = (document: Document, nodeId: string) => {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  return node
}

const assertNodeSupportsProperty = (
  node: SceneNode,
  property: string,
  range: boolean
) => {
  if (range && node.type !== "text") {
    throw new Error("Text-range variables can only target text layers")
  }
  if (!(property in node)) {
    throw new Error(
      `${node.name} does not support variable property ${property}`
    )
  }
}

export function assertVariableBindingCompatible(
  document: Document,
  binding: VariableBinding,
  variable?: DesignVariable
) {
  const resolved =
    variable ??
    document.variables.find((candidate) => candidate.id === binding.variableId)
  if (!resolved) throw new Error(`Unknown variable: ${binding.variableId}`)
  const expected = variableTypeForTarget(binding.target)
  if (resolved.type !== expected) {
    throw new Error(
      `${resolved.name} is ${resolved.type}, but ${binding.target.property} requires ${expected}`
    )
  }
  const duplicate = document.variableBindings.find(
    (candidate) =>
      candidate.id !== binding.id &&
      targetKey(candidate.target) === targetKey(binding.target)
  )
  if (duplicate) {
    throw new Error(`Variable target is already bound by ${duplicate.id}`)
  }

  if (binding.target.kind === "text_range") {
    const bindingTarget = binding.target
    const overlap = document.variableBindings.find((candidate) => {
      const target = candidate.target
      return (
        candidate.id !== binding.id &&
        target.kind === "text_range" &&
        target.nodeId === bindingTarget.nodeId &&
        target.property === bindingTarget.property &&
        rangesOverlap(target.range, bindingTarget.range)
      )
    })
    if (overlap) {
      throw new Error(`Variable range overlaps binding ${overlap.id}`)
    }
  }

  const target = binding.target
  if (target.kind === "node" || target.kind === "text_range") {
    const node = nodeForTarget(document, target.nodeId)
    assertNodeSupportsProperty(
      node,
      target.property,
      target.kind === "text_range"
    )
    if (
      target.kind === "text_range" &&
      node.type === "text" &&
      target.range.end > node.text.length
    ) {
      throw new Error(
        `Variable range [${target.range.start}, ${target.range.end}) exceeds ${node.name}`
      )
    }
    if (target.kind === "node") {
      const fieldConflict = document.bindings.find(
        (candidate) =>
          candidate.nodeId === target.nodeId &&
          candidate.property === target.property
      )
      if (fieldConflict) {
        throw new Error(
          `${node.name}.${target.property} is already controlled by a shared field`
        )
      }
    }
    return
  }
  if (target.kind === "typography_style") {
    if (
      !document.typographyStyles.some((style) => style.id === target.styleId)
    ) {
      throw new Error(`Unknown typography style: ${target.styleId}`)
    }
    return
  }
  if (!document.paintStyles.some((style) => style.id === target.styleId)) {
    throw new Error(`Unknown paint style: ${target.styleId}`)
  }
}

const applyVariableToNode = (
  node: SceneNode,
  target: Extract<VariableBindingTarget, { kind: "node" }>,
  value: string | number
): SceneNode => {
  assertNodeSupportsProperty(node, target.property, false)
  const rawPatch = {
    [target.property]: value,
  }
  const patch =
    node.type === "rect" ||
    node.type === "frame" ||
    node.type === "ellipse" ||
    node.type === "line" ||
    node.type === "icon" ||
    node.type === "section" ||
    node.type === "polygon" ||
    node.type === "star" ||
    node.type === "vector" ||
    node.type === "boolean_result"
      ? synchronizeLegacyPaintFields(node, rawPatch)
      : rawPatch
  const detached = detachStyleForDirectNodePatch(node, patch)
  if (
    detached.type === "text" &&
    [
      "text",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "width",
      "height",
    ].includes(target.property)
  ) {
    return applyTextLayoutPatch(detached, { [target.property]: value })
  }
  return { ...detached, ...patch } as SceneNode
}

export function applyVariableToBinding(
  document: Document,
  binding: VariableBinding,
  variable: DesignVariable
): Document {
  assertVariableBindingCompatible(document, binding, variable)
  const target = binding.target
  if (target.kind === "node") {
    return {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === target.nodeId
          ? applyVariableToNode(node, target, variable.value)
          : node
      ),
    }
  }
  if (target.kind === "text_range") {
    return {
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== target.nodeId || node.type !== "text") return node
        const runs = applyTextStyleToRange(
          node.text,
          node.runs,
          { anchor: target.range.start, focus: target.range.end },
          { [target.property]: variable.value }
        )
        return target.property === "color"
          ? { ...node, runs }
          : applyTextLayoutPatch(node, { runs })
      }),
    }
  }
  if (target.kind === "typography_style") {
    const style = document.typographyStyles.find(
      (candidate) => candidate.id === target.styleId
    )!
    const updated = { ...style, [target.property]: variable.value }
    return {
      ...document,
      typographyStyles: document.typographyStyles.map((candidate) =>
        candidate.id === style.id ? updated : candidate
      ),
      nodes: document.nodes.map((node) =>
        propagateTypographyStyle(node, updated)
      ),
    }
  }
  const style = document.paintStyles.find(
    (candidate) => candidate.id === target.styleId
  )!
  const updated = { ...style, [target.property]: variable.value }
  return {
    ...document,
    paintStyles: document.paintStyles.map((candidate) =>
      candidate.id === style.id ? updated : candidate
    ),
    nodes: document.nodes.map((node) => propagatePaintStyle(node, updated)),
  }
}

export function variableUsage(
  document: Document,
  variableId: string
): VariableUsage {
  const bindings = document.variableBindings.filter(
    (binding) => binding.variableId === variableId
  )
  const nodeIds = new Set<string>()
  const typographyStyleIds = new Set<string>()
  const paintStyleIds = new Set<string>()
  for (const { target } of bindings) {
    if (target.kind === "node" || target.kind === "text_range") {
      nodeIds.add(target.nodeId)
    } else if (target.kind === "typography_style") {
      typographyStyleIds.add(target.styleId)
    } else {
      paintStyleIds.add(target.styleId)
    }
  }
  return {
    variableId,
    bindingIds: bindings.map((binding) => binding.id),
    nodeIds: [...nodeIds],
    typographyStyleIds: [...typographyStyleIds],
    paintStyleIds: [...paintStyleIds],
    totalBindingCount: bindings.length,
  }
}

const rangesOverlap = (
  left: Readonly<{ start: number; end: number }>,
  right: Readonly<{ start: number; end: number }>
) => left.start < right.end && right.start < left.end

export function detachVariableBindingsForStyleTargets(
  document: Document,
  kind: "typography" | "paint",
  targets: readonly DesignStyleTarget[]
): Document["variableBindings"] {
  const controlledTypographyProperties = new Set([
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
  ])
  return document.variableBindings.filter((binding) => {
    const bindingTarget = binding.target
    if (bindingTarget.kind !== "node" && bindingTarget.kind !== "text_range") {
      return true
    }
    const styleTarget = targets.find(
      (candidate) => candidate.nodeId === bindingTarget.nodeId
    )
    if (!styleTarget) return true
    if (styleTarget.range) {
      if (bindingTarget.kind !== "text_range") return true
      const controlsProperty =
        kind === "typography"
          ? controlledTypographyProperties.has(bindingTarget.property)
          : bindingTarget.property === "color"
      return !(
        controlsProperty &&
        rangesOverlap(styleTarget.range, bindingTarget.range)
      )
    }
    if (bindingTarget.kind !== "node") return true
    if (kind === "typography") {
      return !controlledTypographyProperties.has(bindingTarget.property)
    }
    const node = document.nodes.find(
      (candidate) => candidate.id === bindingTarget.nodeId
    )
    const paintProperty =
      node?.type === "text"
        ? "color"
        : node?.type === "line"
          ? "stroke"
          : node?.type === "rect" ||
              node?.type === "ellipse" ||
              node?.type === "icon"
            ? "fill"
            : null
    return (
      bindingTarget.property !== paintProperty &&
      bindingTarget.property !== "opacity"
    )
  })
}

export function detachVariableBindingsForNodePatch(
  document: Document,
  nodeId: string,
  patch: Readonly<Record<string, unknown>>
) {
  return document.variableBindings.filter((binding) => {
    const target = binding.target
    if (target.kind === "node" && target.nodeId === nodeId) {
      return !(target.property in patch)
    }
    if (target.kind === "text_range" && target.nodeId === nodeId) {
      return !("runs" in patch || "text" in patch)
    }
    return true
  })
}

export function detachVariableBindingsForStylePatch(
  document: Document,
  kind: "typography_style" | "paint_style",
  styleId: string,
  patch: Readonly<Record<string, unknown>>
) {
  return document.variableBindings.filter((binding) => {
    const target = binding.target
    return !(
      target.kind === kind &&
      target.styleId === styleId &&
      target.property in patch
    )
  })
}
