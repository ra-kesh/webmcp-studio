import { projectPagePaintPlan, type MaskPaintRelation } from "./page-paint-plan"
import type { Page, SceneNode } from "./schema"

export const maskRenderConformancePage: Page = {
  id: "mask-conformance-page",
  outputId: "mask-conformance-output",
  name: "Vector mask conformance",
  width: 480,
  height: 360,
  background: "#f8fafc",
  nodeIds: [
    "mask-conformance-below",
    "mask-conformance-source",
    "mask-conformance-content",
    "mask-conformance-above",
  ],
}

const rect = (
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string
): Extract<SceneNode, { type: "rect" }> => ({
  id,
  type: "rect",
  name,
  x,
  y,
  width,
  height,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill,
  radius: 0,
  strokeWidth: 0,
})

export const maskRenderConformanceNodes = [
  rect("mask-conformance-below", "Below mask", 24, 24, 80, 48, "#cbd5e1"),
  {
    ...rect(
      "mask-conformance-source",
      "Vector mask source",
      120,
      96,
      176,
      112,
      "#000000"
    ),
    rotation: 8,
    opacity: 0.86,
  },
  {
    ...rect(
      "mask-conformance-content",
      "Masked content",
      88,
      72,
      264,
      184,
      "#2563eb"
    ),
    rotation: -5,
    opacity: 0.92,
  },
  rect("mask-conformance-above", "Above mask", 376, 288, 64, 40, "#f97316"),
] satisfies readonly SceneNode[]

export const maskRenderConformanceRelation: MaskPaintRelation = {
  groupId: "mask-conformance-group",
  pageId: maskRenderConformancePage.id,
  maskType: "vector",
  nodeIds: ["mask-conformance-source", "mask-conformance-content"],
  sourceNodeIds: ["mask-conformance-source"],
}

export const maskRenderConformancePlan = projectPagePaintPlan(
  maskRenderConformancePage,
  maskRenderConformanceNodes,
  [maskRenderConformanceRelation]
)

export const maskRenderConformanceHiddenSourceNodes =
  maskRenderConformanceNodes.map((node) =>
    node.id === "mask-conformance-source" ? { ...node, visible: false } : node
  )

export const maskRenderConformanceHiddenSourcePlan = projectPagePaintPlan(
  maskRenderConformancePage,
  maskRenderConformanceHiddenSourceNodes,
  [maskRenderConformanceRelation]
)
