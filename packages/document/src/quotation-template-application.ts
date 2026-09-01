import {
  quotationTemplates,
  type QuotationTemplate,
  type QuotationTemplateId,
} from "./quotation-composer"
import type { Document, SceneNode } from "./schema"
import { propagatePaintStyle } from "./design-styles"
import { assertValidDocument } from "./validation"
import { applyVariableToBinding } from "./variables"

const getTemplate = (templateId: QuotationTemplateId) => {
  const template = quotationTemplates.find(
    (candidate) => candidate.id === templateId
  )
  if (!template) throw new Error(`Unknown quotation template: ${templateId}`)
  return template
}

const createPaletteMap = (
  current: QuotationTemplate,
  next: QuotationTemplate
) =>
  new Map(
    (
      Object.keys(current.palette) as Array<keyof QuotationTemplate["palette"]>
    ).map((token) => [
      current.palette[token].toLowerCase(),
      next.palette[token],
    ])
  )

const replacePaint = (value: string, palette: Map<string, string>) =>
  palette.get(value.toLowerCase()) ?? value

const applyNodePalette = (
  node: SceneNode,
  palette: Map<string, string>
): SceneNode => {
  switch (node.type) {
    case "text":
      return {
        ...node,
        color: replacePaint(node.color, palette),
        runs: node.runs.map((run) => ({
          ...run,
          style: run.style.color
            ? {
                ...run.style,
                color: replacePaint(run.style.color, palette),
              }
            : run.style,
        })),
      }
    case "rect":
    case "frame":
    case "ellipse":
      return {
        ...node,
        fill: replacePaint(node.fill, palette),
        stroke: node.stroke ? replacePaint(node.stroke, palette) : node.stroke,
      }
    case "line":
      return { ...node, stroke: replacePaint(node.stroke, palette) }
    case "icon":
      return {
        ...node,
        fill: replacePaint(node.fill, palette),
        stroke: node.stroke ? replacePaint(node.stroke, palette) : node.stroke,
      }
    case "image":
      return { ...node }
  }
}

const nodePaints = (node: SceneNode) => {
  switch (node.type) {
    case "text":
      return [node.color]
    case "rect":
    case "frame":
    case "ellipse":
    case "icon":
      return [node.fill, node.stroke].filter(
        (paint): paint is string => paint !== undefined
      )
    case "line":
      return [node.stroke]
    case "image":
      return []
  }
}

export function inferQuotationTemplateId(
  document: Document,
  fallback: QuotationTemplateId
): QuotationTemplateId {
  const paints = [
    ...document.pages.map((page) => page.background),
    ...document.nodes.flatMap(nodePaints),
  ].map((paint) => paint.toLowerCase())
  const scores = quotationTemplates.map((template) => {
    const palette = new Set(
      Object.values(template.palette).map((paint) => paint.toLowerCase())
    )
    return {
      id: template.id,
      score: paints.reduce(
        (total, paint) => total + Number(palette.has(paint)),
        0
      ),
    }
  })
  const best = scores.sort((left, right) => right.score - left.score)[0]
  return best && best.score > 0 ? best.id : fallback
}

export type ApplyQuotationTemplateOptions = {
  now?: string
}

/**
 * Applies only the quotation visual-token delta to an existing aggregate.
 * It deliberately does not recompose from source data: user content,
 * structure, semantic bindings, output settings, and stable IDs remain intact.
 */
export function applyQuotationTemplate(
  document: Document,
  currentTemplateId: QuotationTemplateId,
  nextTemplateId: QuotationTemplateId,
  options: ApplyQuotationTemplateOptions = {}
): Document {
  if (currentTemplateId === nextTemplateId) return document

  const palette = createPaletteMap(
    getTemplate(currentTemplateId),
    getTemplate(nextTemplateId)
  )

  let next: Document = {
    ...document,
    revision: document.revision + 1,
    updatedAt: options.now ?? new Date().toISOString(),
    pages: document.pages.map((page) => ({
      ...page,
      background: replacePaint(page.background, palette),
    })),
    nodes: document.nodes.map((node) => applyNodePalette(node, palette)),
    paintStyles: document.paintStyles.map((style) => ({
      ...style,
      color: replacePaint(style.color, palette),
    })),
    variables: document.variables.map((variable) =>
      variable.type === "color"
        ? { ...variable, value: replacePaint(variable.value, palette) }
        : variable
    ),
  }

  for (const style of next.paintStyles) {
    next = {
      ...next,
      nodes: next.nodes.map((node) => propagatePaintStyle(node, style)),
    }
  }
  for (const binding of next.variableBindings) {
    const variable = next.variables.find(
      (candidate) => candidate.id === binding.variableId
    )
    if (!variable) continue
    next = applyVariableToBinding(next, binding, variable)
  }

  return assertValidDocument(next)
}
