import { documentSchema } from "../../schema"
import type { Document, SceneNode } from "../../schema"

export type TemplatePalette = Readonly<{
  background: string
  ink: string
  muted: string
  accent: string
  panel: string
}>

type NodeFrame = Readonly<{
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  group?: string
}>

export type TextBlock = NodeFrame &
  Readonly<{
    kind: "text"
    text: string
    role: "display" | "heading" | "body" | "label"
    color?: string
    fontSize?: number
    fontWeight?: number
    lineHeight?: number
    letterSpacing?: number
    align?: "left" | "center" | "right"
    fieldKey?: string
    fieldLabel?: string
  }>

export type RectBlock = NodeFrame &
  Readonly<{
    kind: "rect"
    fill: string
    radius?: number
    stroke?: string
    strokeWidth?: number
  }>

export type EllipseBlock = NodeFrame &
  Readonly<{
    kind: "ellipse"
    fill: string
    stroke?: string
    strokeWidth?: number
  }>

export type LineBlock = NodeFrame &
  Readonly<{
    kind: "line"
    stroke: string
    strokeWidth?: number
  }>

export type TemplateBlock = TextBlock | RectBlock | EllipseBlock | LineBlock

export type TemplatePagePlan = Readonly<{
  id: string
  name: string
  width: number
  height: number
  background?: string
  blocks: readonly TemplateBlock[]
}>

export type StarterDocumentPlan = Readonly<{
  id: string
  name: string
  outputName: string
  outputKind: "proposal" | "whatsapp_portrait" | "square" | "custom"
  exportFormats: readonly ("png" | "pdf")[]
  palette: TemplatePalette
  pages: readonly TemplatePagePlan[]
}>

export const text = (
  id: string,
  name: string,
  value: string,
  frame: Omit<NodeFrame, "id" | "name">,
  options: Omit<TextBlock, keyof NodeFrame | "kind" | "text"> = {
    role: "body",
  }
): TextBlock => ({
  kind: "text",
  id,
  name,
  text: value,
  ...frame,
  ...options,
})

export const rect = (
  id: string,
  name: string,
  frame: Omit<NodeFrame, "id" | "name">,
  fill: string,
  options: Pick<RectBlock, "radius" | "stroke" | "strokeWidth"> = {}
): RectBlock => ({ kind: "rect", id, name, ...frame, fill, ...options })

export const ellipse = (
  id: string,
  name: string,
  frame: Omit<NodeFrame, "id" | "name">,
  fill: string,
  options: Pick<EllipseBlock, "stroke" | "strokeWidth"> = {}
): EllipseBlock => ({ kind: "ellipse", id, name, ...frame, fill, ...options })

export const line = (
  id: string,
  name: string,
  frame: Omit<NodeFrame, "id" | "name">,
  stroke: string,
  strokeWidth = 2
): LineBlock => ({
  kind: "line",
  id,
  name,
  ...frame,
  stroke,
  strokeWidth,
})

const roleDefaults = {
  display: {
    fontSize: 76,
    fontWeight: 620,
    lineHeight: 1.02,
    letterSpacing: -2,
  },
  heading: {
    fontSize: 42,
    fontWeight: 600,
    lineHeight: 1.08,
    letterSpacing: -0.8,
  },
  body: { fontSize: 25, fontWeight: 430, lineHeight: 1.35, letterSpacing: 0 },
  label: {
    fontSize: 16,
    fontWeight: 660,
    lineHeight: 1.15,
    letterSpacing: 1.6,
  },
} as const

export function createStarterDocument(plan: StarterDocumentPlan): Document {
  const outputId = `${plan.id}-output`
  const typographyStyles = (
    ["display", "heading", "body", "label"] as const
  ).map((role) => ({
    id: `${plan.id}-type-${role}`,
    name: role[0]!.toUpperCase() + role.slice(1),
    fontFamily: "Geist Variable",
    ...roleDefaults[role],
    italic: false,
    decoration: "none" as const,
  }))
  const nodes: SceneNode[] = []
  const groups: Document["groups"] = []
  const fieldsByKey = new Map<string, Document["fields"][number]>()
  const fieldValues: Document["fieldValues"] = {}
  const bindings: Document["bindings"] = []

  const pages = plan.pages.map((page, pageIndex) => {
    const pageId = `${plan.id}-page-${pageIndex + 1}-${page.id}`
    const pageNodeIds: string[] = []
    const groupRuns: Array<{ name: string; nodeIds: string[] }> = []
    for (const block of page.blocks) {
      const nodeId = `${plan.id}-${page.id}-${block.id}`
      const node = blockToNode(plan, block, nodeId)
      nodes.push(node)
      pageNodeIds.push(nodeId)
      const groupName = block.group ?? "Page content"
      const currentRun = groupRuns.at(-1)
      if (currentRun?.name === groupName) currentRun.nodeIds.push(nodeId)
      else groupRuns.push({ name: groupName, nodeIds: [nodeId] })
      if (block.kind === "text" && block.fieldKey) {
        const fieldId = `${plan.id}-field-${block.fieldKey}`
        const existing = fieldsByKey.get(block.fieldKey)
        if (existing && fieldValues[fieldId] !== block.text) {
          throw new Error(
            `Template ${plan.id} field ${block.fieldKey} has conflicting seed values`
          )
        }
        if (!existing) {
          fieldsByKey.set(block.fieldKey, {
            id: fieldId,
            key: block.fieldKey,
            label: block.fieldLabel ?? block.name,
            type: "text",
            required: true,
            defaultValue: block.text,
            agentDescription: `Visible ${block.name.toLowerCase()} text`,
            validation: { maxLength: 500 },
          })
          fieldValues[fieldId] = block.text
        }
        bindings.push({
          id: `${plan.id}-binding-${block.fieldKey}-${pageIndex + 1}-${block.id}`,
          fieldId,
          nodeId,
          property: "text",
        })
      }
    }
    for (const [runIndex, { name, nodeIds }] of groupRuns.entries()) {
      groups.push({
        id: `${pageId}-group-${runIndex + 1}-${slug(name)}`,
        pageId,
        name,
        nodeIds,
      })
    }
    return {
      id: pageId,
      outputId,
      name: page.name,
      width: page.width,
      height: page.height,
      background: page.background ?? plan.palette.background,
      nodeIds: pageNodeIds,
    }
  })

  const paintStyles = [
    {
      id: `${plan.id}-paint-ink`,
      name: "Ink",
      color: plan.palette.ink,
      opacity: 1,
    },
    {
      id: `${plan.id}-paint-accent`,
      name: "Accent",
      color: plan.palette.accent,
      opacity: 1,
    },
    {
      id: `${plan.id}-paint-panel`,
      name: "Panel",
      color: plan.palette.panel,
      opacity: 1,
    },
  ].filter((style) =>
    nodes.some(
      (node) => "paintStyleId" in node && node.paintStyleId === style.id
    )
  )
  const paintStyleIds = new Set(paintStyles.map((style) => style.id))
  const variables = [
    {
      id: `${plan.id}-variable-accent`,
      name: "Accent",
      type: "color" as const,
      value: plan.palette.accent,
      styleId: `${plan.id}-paint-accent`,
    },
    {
      id: `${plan.id}-variable-ink`,
      name: "Ink",
      type: "color" as const,
      value: plan.palette.ink,
      styleId: `${plan.id}-paint-ink`,
    },
  ].filter((variable) => paintStyleIds.has(variable.styleId))

  return documentSchema.parse({
    schemaVersion: 4,
    id: `${plan.id}-template-document`,
    name: plan.name,
    revision: 0,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    outputs: [
      {
        id: outputId,
        name: plan.outputName,
        kind: plan.outputKind,
        pageIds: pages.map((page) => page.id),
        exportFormats: [...plan.exportFormats],
      },
    ],
    pages,
    nodes,
    groups,
    components: [],
    componentInstances: [],
    typographyStyles,
    paintStyles,
    variables: variables.map(({ styleId: _styleId, ...variable }) => variable),
    variableBindings: variables.map((variable) => ({
      id: `${plan.id}-binding-${slug(variable.name)}-style`,
      variableId: variable.id,
      target: {
        kind: "paint_style" as const,
        styleId: variable.styleId,
        property: "color" as const,
      },
    })),
    fields: [...fieldsByKey.values()],
    fieldValues,
    bindings,
  })
}

function blockToNode(
  plan: StarterDocumentPlan,
  block: TemplateBlock,
  id: string
): SceneNode {
  const base = {
    id,
    name: block.name,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
  if (block.kind === "text") {
    const defaults = roleDefaults[block.role]
    const color =
      block.color ??
      (block.role === "body" ? plan.palette.muted : plan.palette.ink)
    return {
      ...base,
      type: "text",
      text: block.text,
      runs: [],
      paragraphs: [],
      links: [],
      typographyStyleId: `${plan.id}-type-${block.role}`,
      paintStyleId: paintStyleIdFor(plan, color),
      color,
      fontFamily: "Geist Variable",
      fontSize: block.fontSize ?? defaults.fontSize,
      fontWeight: block.fontWeight ?? defaults.fontWeight,
      italic: false,
      decoration: "none",
      lineHeight: block.lineHeight ?? defaults.lineHeight,
      letterSpacing: block.letterSpacing ?? defaults.letterSpacing,
      align: block.align ?? "left",
      sizingMode: "fixed",
    }
  }
  if (block.kind === "rect") {
    return {
      ...base,
      type: "rect",
      paintStyleId: paintStyleIdFor(plan, block.fill),
      fill: block.fill,
      radius: block.radius ?? 0,
      stroke: block.stroke,
      strokeWidth: block.strokeWidth ?? 0,
    }
  }
  if (block.kind === "ellipse") {
    return {
      ...base,
      type: "ellipse",
      paintStyleId: paintStyleIdFor(plan, block.fill),
      fill: block.fill,
      stroke: block.stroke,
      strokeWidth: block.strokeWidth ?? 0,
    }
  }
  return {
    ...base,
    type: "line",
    paintStyleId: paintStyleIdFor(plan, block.stroke),
    stroke: block.stroke,
    strokeWidth: block.strokeWidth ?? 2,
  }
}

function paintStyleIdFor(plan: StarterDocumentPlan, color: string) {
  if (color === plan.palette.ink) return `${plan.id}-paint-ink`
  if (color === plan.palette.accent) return `${plan.id}-paint-accent`
  if (color === plan.palette.panel) return `${plan.id}-paint-panel`
  return undefined
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
