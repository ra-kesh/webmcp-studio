import { layerEffectBounds, scaleLayerEffects } from "./effect-stack"
import { scaleStrokePaints } from "./paint-stack"
import {
  sceneNodeSchema,
  type Document,
  type LayerExportSetting,
  type SceneNode,
} from "./schema"

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "layer"

export const layerExportFilename = (
  nodeName: string,
  setting: LayerExportSetting
) =>
  `${slug(nodeName)}${setting.suffix}${setting.scale === 1 ? "" : `@${setting.scale}x`}.${setting.format}`

export type LayerExportRoute = Readonly<{
  nodeId: string
  pageId: string
  outputId: string
  setting: LayerExportSetting
  filename: string
}>

export const resolveLayerExportRoutes = (
  document: Document,
  nodeId?: string
): LayerExportRoute[] => {
  const nodes = nodeId
    ? document.nodes.filter((node) => node.id === nodeId)
    : document.nodes
  return nodes.flatMap((node) => {
    const page = document.pages.find((candidate) =>
      candidate.nodeIds.includes(node.id)
    )
    if (!page) return []
    const output = document.outputs.find((candidate) =>
      candidate.pageIds.includes(page.id)
    )
    if (!output) return []
    return (node.exportSettings ?? []).map((setting) => ({
      nodeId: node.id,
      pageId: page.id,
      outputId: output.id,
      setting,
      filename: layerExportFilename(node.name, setting),
    }))
  })
}

const nodePaintBounds = (node: SceneNode) => {
  let bounds = { x: node.x, y: node.y, width: node.width, height: node.height }
  if ("strokes" in node && node.strokes) {
    const outset = node.strokes.reduce((maximum, stroke) => {
      if (!stroke.visible) return maximum
      return Math.max(
        maximum,
        stroke.alignment === "outside"
          ? stroke.width
          : stroke.alignment === "center"
            ? stroke.width / 2
            : 0
      )
    }, 0)
    bounds = {
      x: bounds.x - outset,
      y: bounds.y - outset,
      width: bounds.width + outset * 2,
      height: bounds.height + outset * 2,
    }
  }
  return layerEffectBounds(bounds, node.effects)
}

const scaleNode = (
  node: SceneNode,
  bounds: { x: number; y: number },
  scale: number
): SceneNode => {
  const base = {
    ...node,
    x: (node.x - bounds.x) * scale,
    y: (node.y - bounds.y) * scale,
    width: node.width * scale,
    height: node.height * scale,
    effects: scaleLayerEffects(node.effects, scale)
      ? [...scaleLayerEffects(node.effects, scale)!]
      : undefined,
  }
  if (node.type === "text") {
    return sceneNodeSchema.parse({
      ...base,
      fontSize: node.fontSize * scale,
      letterSpacing: node.letterSpacing * scale,
      runs: node.runs.map((run) => ({
        ...run,
        style: {
          ...run.style,
          ...(run.style.fontSize === undefined
            ? {}
            : { fontSize: run.style.fontSize * scale }),
          ...(run.style.letterSpacing === undefined
            ? {}
            : { letterSpacing: run.style.letterSpacing * scale }),
        },
      })),
    })
  }
  if (node.type === "image") return sceneNodeSchema.parse(base)
  const painted = {
    ...base,
    strokeWidth: node.strokeWidth * scale,
    strokes: scaleStrokePaints(node.strokes, scale)
      ? [...scaleStrokePaints(node.strokes, scale)!]
      : undefined,
  }
  if (node.type === "rect") {
    return sceneNodeSchema.parse({
      ...painted,
      radius: node.radius * scale,
      cornerRadii: node.cornerRadii
        ? {
            topLeft: node.cornerRadii.topLeft * scale,
            topRight: node.cornerRadii.topRight * scale,
            bottomRight: node.cornerRadii.bottomRight * scale,
            bottomLeft: node.cornerRadii.bottomLeft * scale,
          }
        : undefined,
    })
  }
  if (node.type === "frame") {
    return sceneNodeSchema.parse({
      ...painted,
      radius: node.radius * scale,
      cornerRadii: node.cornerRadii
        ? {
            topLeft: node.cornerRadii.topLeft * scale,
            topRight: node.cornerRadii.topRight * scale,
            bottomRight: node.cornerRadii.bottomRight * scale,
            bottomLeft: node.cornerRadii.bottomLeft * scale,
          }
        : undefined,
      children: [],
      autoLayout: null,
      layoutGrids: [],
    })
  }
  return sceneNodeSchema.parse(painted)
}

export const projectLayerExportDocument = (
  document: Document,
  route: LayerExportRoute
): Document => {
  const node = document.nodes.find((candidate) => candidate.id === route.nodeId)
  const page = document.pages.find((candidate) => candidate.id === route.pageId)
  const output = document.outputs.find(
    (candidate) => candidate.id === route.outputId
  )
  if (!node || !page || !output) throw new Error("Layer export route is stale")
  const bounds = nodePaintBounds(node)
  const scaledNode = scaleNode(node, bounds, route.setting.scale)
  const removedGroupIds = new Set(
    document.groups
      .filter((group) => group.pageId === page.id)
      .map((group) => group.id)
  )
  return {
    ...document,
    pages: document.pages.map((candidate) =>
      candidate.id === page.id
        ? {
            ...candidate,
            width: Math.max(1, Math.ceil(bounds.width * route.setting.scale)),
            height: Math.max(1, Math.ceil(bounds.height * route.setting.scale)),
            background: "transparent",
            nodeIds: [node.id],
          }
        : candidate
    ),
    outputs: document.outputs.map((candidate) =>
      candidate.id === output.id
        ? {
            ...candidate,
            pageIds: [page.id],
            exportFormats: [route.setting.format],
          }
        : candidate
    ),
    nodes: document.nodes.map((candidate) =>
      candidate.id === node.id ? scaledNode : candidate
    ),
    groups: document.groups.filter((group) => group.pageId !== page.id),
    componentInstances: document.componentInstances.filter(
      (instance) => !removedGroupIds.has(instance.rootGroupId)
    ),
  }
}
