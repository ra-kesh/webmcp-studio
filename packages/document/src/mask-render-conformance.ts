import { projectPagePaintPlan, type MaskPaintRelation } from "./page-paint-plan"
import { documentSchema, type Page, type SceneNode } from "./schema"

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

const alphaImageSource = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><circle cx="200" cy="120" r="104" fill="#111827" fill-opacity="0.82"/><rect x="166" y="0" width="68" height="240" rx="34" fill="#111827"/></svg>'
)}`

export const alphaImageMaskRenderConformanceNodes = [
  maskRenderConformanceNodes[0]!,
  {
    id: "mask-conformance-source",
    type: "image",
    name: "Alpha image mask source",
    x: 116,
    y: 82,
    width: 184,
    height: 144,
    rotation: 7,
    opacity: 0.78,
    visible: true,
    locked: false,
    assetId: "asset-alpha-mask-conformance",
    src: alphaImageSource,
    placement: {
      mode: "manual",
      focalX: 0.58,
      focalY: 0.44,
      zoom: 1.22,
      rotation: -13,
      flipX: false,
      flipY: true,
    },
    frameMask: { shape: "ellipse" },
    alt: "Transparent alpha mask fixture",
    decorative: false,
  },
  maskRenderConformanceNodes[2]!,
  maskRenderConformanceNodes[3]!,
] satisfies readonly SceneNode[]

export const alphaImageMaskRenderConformanceHiddenSourceNodes =
  alphaImageMaskRenderConformanceNodes.map((node) =>
    node.id === "mask-conformance-source" ? { ...node, visible: false } : node
  )

export const alphaTextMaskRenderConformanceNodes = [
  maskRenderConformanceNodes[0]!,
  {
    id: "mask-conformance-source",
    type: "text",
    name: "Alpha text mask source",
    x: 104,
    y: 102,
    width: 232,
    height: 98,
    rotation: -4,
    opacity: 0.72,
    visible: true,
    locked: false,
    text: "ALPHA",
    runs: [],
    paragraphs: [],
    links: [],
    color: "#111827",
    fontFamily: "Geist Variable",
    fontSize: 64,
    fontWeight: 760,
    italic: false,
    decoration: "none",
    lineHeight: 1.05,
    letterSpacing: 2,
    align: "center",
    sizingMode: "fixed",
  },
  maskRenderConformanceNodes[2]!,
  maskRenderConformanceNodes[3]!,
] satisfies readonly SceneNode[]

const alphaMaskDocument = (
  id: string,
  name: string,
  nodes: readonly SceneNode[]
) =>
  documentSchema.parse({
    ...maskRenderConformanceDocument,
    id,
    name,
    nodes,
    groups: [
      {
        ...maskRenderConformanceDocument.groups[0],
        name,
        mask: {
          type: "alpha",
          sourceNodeIds: ["mask-conformance-source"],
        },
      },
    ],
  })

/** Canonical schema-v5 carrier for the retained renderer fixture. */
export const maskRenderConformanceDocument = documentSchema.parse({
  schemaVersion: 5,
  id: "mask-render-conformance-v1",
  name: "Mask renderer conformance carrier",
  revision: 1,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
  outputs: [
    {
      id: "mask-conformance-output",
      name: "Mask conformance output",
      kind: "proposal",
      pageIds: [maskRenderConformancePage.id],
      exportFormats: ["png", "pdf"],
    },
  ],
  pages: [maskRenderConformancePage],
  nodes: maskRenderConformanceNodes,
  groups: [
    {
      id: maskRenderConformanceRelation.groupId,
      pageId: maskRenderConformanceRelation.pageId,
      name: "Vector mask conformance",
      nodeIds: [...maskRenderConformanceRelation.nodeIds],
      role: "mask",
      mask: {
        type: maskRenderConformanceRelation.maskType,
        sourceNodeIds: [...maskRenderConformanceRelation.sourceNodeIds] as [
          string,
          ...string[],
        ],
      },
    },
  ],
  components: [],
  componentInstances: [],
  typographyStyles: [],
  paintStyles: [],
  variables: [],
  variableBindings: [],
  fields: [],
  fieldValues: {},
  bindings: [],
})

export const alphaImageMaskRenderConformanceDocument = alphaMaskDocument(
  "alpha-image-mask-render-conformance-v1",
  "Alpha image mask renderer conformance carrier",
  alphaImageMaskRenderConformanceNodes
)

export const alphaImageMaskRenderConformanceHiddenSourceDocument =
  alphaMaskDocument(
    "alpha-image-hidden-mask-render-conformance-v1",
    "Hidden alpha image mask renderer conformance carrier",
    alphaImageMaskRenderConformanceHiddenSourceNodes
  )

export const alphaTextMaskRenderConformanceDocument = alphaMaskDocument(
  "alpha-text-mask-render-conformance-v1",
  "Alpha text mask renderer conformance carrier",
  alphaTextMaskRenderConformanceNodes
)
