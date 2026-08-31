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

const multiSourceMaskDocument = (
  id: string,
  name: string,
  maskType: "vector" | "alpha" | "luminance",
  sources: readonly SceneNode[]
) => {
  const content = maskRenderConformanceNodes[2]!
  const below = maskRenderConformanceNodes[0]!
  const above = maskRenderConformanceNodes[3]!
  const sourceNodeIds = sources.map((source) => source.id) as [
    string,
    ...string[],
  ]
  return documentSchema.parse({
    ...maskRenderConformanceDocument,
    id,
    name,
    pages: [
      {
        ...maskRenderConformancePage,
        nodeIds: [below.id, ...sourceNodeIds, content.id, above.id],
      },
    ],
    nodes: [below, ...sources, content, above],
    groups: [
      {
        ...maskRenderConformanceDocument.groups[0],
        name,
        nodeIds: [...sourceNodeIds, content.id],
        mask: { type: maskType, sourceNodeIds },
      },
    ],
  })
}

const secondVectorMaskSource = {
  ...(maskRenderConformanceNodes[1] as Extract<SceneNode, { type: "rect" }>),
  id: "mask-conformance-source-two",
  name: "Second vector mask source",
  x: 232,
  y: 128,
  width: 144,
  height: 104,
  rotation: -6,
  opacity: 0.64,
}

export const multiVectorMaskRenderConformanceDocument = multiSourceMaskDocument(
  "multi-vector-mask-render-conformance-v1",
  "Multi-vector mask renderer conformance carrier",
  "vector",
  [maskRenderConformanceNodes[1]!, secondVectorMaskSource]
)

export const multiVectorMaskRenderConformanceOneHiddenDocument =
  multiSourceMaskDocument(
    "multi-vector-one-hidden-mask-render-conformance-v1",
    "Multi-vector one-hidden renderer conformance carrier",
    "vector",
    [
      maskRenderConformanceNodes[1]!,
      { ...secondVectorMaskSource, visible: false },
    ]
  )

export const multiVectorMaskRenderConformanceAllHiddenDocument =
  multiSourceMaskDocument(
    "multi-vector-all-hidden-mask-render-conformance-v1",
    "Multi-vector all-hidden renderer conformance carrier",
    "vector",
    [
      { ...maskRenderConformanceNodes[1]!, visible: false },
      { ...secondVectorMaskSource, visible: false },
    ]
  )

const secondAlphaImageSource = {
  ...(alphaImageMaskRenderConformanceNodes[1] as Extract<
    SceneNode,
    { type: "image" }
  >),
  id: "mask-conformance-source-image-two",
  name: "Second alpha image mask source",
  x: 220,
  y: 112,
  opacity: 0.57,
}
const alphaTextSource = {
  ...(alphaTextMaskRenderConformanceNodes[1] as Extract<
    SceneNode,
    { type: "text" }
  >),
  id: "mask-conformance-source-text",
}

export const multiAlphaMaskRenderConformanceDocument = multiSourceMaskDocument(
  "multi-alpha-mask-render-conformance-v1",
  "Multi-alpha mask renderer conformance carrier",
  "alpha",
  [
    {
      ...(alphaImageMaskRenderConformanceNodes[1] as Extract<
        SceneNode,
        { type: "image" }
      >),
      id: "mask-conformance-source-image-one",
    },
    secondAlphaImageSource,
    alphaTextSource,
  ]
)

const luminanceCoefficientDocument = (
  id: string,
  name: string,
  sources: readonly Extract<SceneNode, { type: "rect" }>[]
) => {
  const content = rect(
    `${id}-content`,
    "Luminance coefficient content",
    48,
    80,
    288,
    80,
    "#ffffff"
  )
  const sourceNodeIds = sources.map((source) => source.id) as [
    string,
    ...string[],
  ]
  return documentSchema.parse({
    ...maskRenderConformanceDocument,
    id,
    name,
    pages: [
      {
        ...maskRenderConformancePage,
        name,
        background: "#000000",
        nodeIds: [...sourceNodeIds, content.id],
      },
    ],
    nodes: [...sources, content],
    groups: [
      {
        id: `${id}-group`,
        pageId: maskRenderConformancePage.id,
        name,
        nodeIds: [...sourceNodeIds, content.id],
        role: "mask",
        mask: { type: "luminance", sourceNodeIds },
      },
    ],
  })
}

const coefficientSource = (
  id: string,
  x: number,
  fill: string,
  opacity = 1
) => ({
  ...rect(id, id, x, 80, 48, 80, fill),
  opacity,
})

export const luminancePrimaryCoefficientRenderConformanceDocument =
  luminanceCoefficientDocument(
    "luminance-primary-coefficients-v1",
    "Luminance black white red green coefficients",
    [
      coefficientSource("luminance-black", 48, "#000000"),
      coefficientSource("luminance-white", 112, "#ffffff"),
      coefficientSource("luminance-red", 176, "#ff0000"),
      coefficientSource("luminance-green", 240, "#00ff00"),
    ]
  )

export const luminanceSecondaryCoefficientRenderConformanceDocument =
  luminanceCoefficientDocument(
    "luminance-secondary-coefficients-v1",
    "Luminance grey blue transparent opacity coefficients",
    [
      coefficientSource("luminance-grey", 48, "#808080"),
      coefficientSource("luminance-blue", 112, "#0000ff"),
      coefficientSource("luminance-transparent-red", 176, "#ff0000", 0),
      coefficientSource("luminance-opacity-red", 240, "#ff0000", 0.4),
    ]
  )

export const luminanceOverlapRenderConformanceDocument =
  luminanceCoefficientDocument(
    "luminance-overlap-v1",
    "Luminance independently converted source overlap",
    [
      coefficientSource("luminance-overlap-red", 176, "#ff0000", 0.5),
      coefficientSource("luminance-overlap-green", 176, "#00ff00", 0.25),
    ]
  )

export const luminanceImageTextRenderConformanceDocument = documentSchema.parse(
  {
    ...multiAlphaMaskRenderConformanceDocument,
    id: "luminance-image-text-v1",
    name: "Luminance image and text source conformance",
    groups: multiAlphaMaskRenderConformanceDocument.groups.map((group) =>
      group.role === "mask"
        ? { ...group, mask: { ...group.mask, type: "luminance" } }
        : group
    ),
  }
)

export const luminanceOneHiddenRenderConformanceDocument = documentSchema.parse(
  {
    ...luminanceOverlapRenderConformanceDocument,
    id: "luminance-one-hidden-v1",
    name: "Luminance one hidden source conformance",
    nodes: luminanceOverlapRenderConformanceDocument.nodes.map((node) =>
      node.id === "luminance-overlap-green" ? { ...node, visible: false } : node
    ),
  }
)

export const luminanceAllHiddenRenderConformanceDocument = documentSchema.parse(
  {
    ...luminanceOverlapRenderConformanceDocument,
    id: "luminance-all-hidden-v1",
    name: "Luminance all hidden source conformance",
    nodes: luminanceOverlapRenderConformanceDocument.nodes.map((node) =>
      node.id === "luminance-overlap-red" ||
      node.id === "luminance-overlap-green"
        ? { ...node, visible: false }
        : node.id === "luminance-overlap-v1-content"
          ? { ...node, x: 176, width: 48 }
          : node
    ),
  }
)

const nestedRichText = (id: string, name: string): SceneNode => ({
  id,
  type: "text",
  name,
  x: 106,
  y: 116,
  width: 268,
  height: 112,
  rotation: -3,
  opacity: 0.9,
  visible: true,
  locked: false,
  text: "NESTED\nMASK",
  runs: [
    {
      start: 0,
      end: 6,
      style: {
        fontFamily: "Geist Variable",
        fontSize: 48,
        fontWeight: 800,
        color: "#fef3c7",
        letterSpacing: 1.5,
      },
    },
    {
      start: 7,
      end: 11,
      style: {
        fontFamily: "Geist Variable",
        fontSize: 38,
        fontWeight: 700,
        color: "#dbeafe",
      },
    },
  ],
  paragraphs: [
    { start: 0, end: 6, style: { align: "center" } },
    { start: 7, end: 11, style: { align: "right" } },
  ],
  links: [],
  color: "#ffffff",
  fontFamily: "Geist Variable",
  fontSize: 42,
  fontWeight: 700,
  italic: false,
  decoration: "none",
  lineHeight: 1.05,
  letterSpacing: 0,
  align: "left",
  sizingMode: "fixed",
})

const nestedImage = (id: string, name: string, x: number): SceneNode => ({
  ...(alphaImageMaskRenderConformanceNodes[1] as Extract<
    SceneNode,
    { type: "image" }
  >),
  id,
  name,
  x,
  y: 82,
  width: 184,
  height: 144,
  placement: {
    mode: "manual",
    focalX: 0.64,
    focalY: 0.38,
    zoom: 1.35,
    rotation: -17,
    flipX: true,
    flipY: false,
  },
  frameMask: { shape: "rounded_rectangle", radius: 0.22 },
})

const nestedMaskDocument = (
  id: string,
  name: string,
  outerType: "vector" | "alpha" | "luminance",
  outerSources: readonly SceneNode[],
  childType: "vector" | "alpha" | "luminance",
  childSources: readonly SceneNode[],
  childContents: readonly SceneNode[]
) => {
  const below = rect(
    `${id}-below`,
    "Nested fixture background",
    16,
    16,
    448,
    328,
    "#172554"
  )
  const outerContent = rect(
    `${id}-outer-content`,
    "Outer direct content",
    48,
    54,
    368,
    252,
    "#7c3aed"
  )
  const above = rect(
    `${id}-above`,
    "Nested fixture foreground",
    392,
    292,
    56,
    40,
    "#f97316"
  )
  const outerSourceNodeIds = outerSources.map((node) => node.id) as [
    string,
    ...string[],
  ]
  const childSourceNodeIds = childSources.map((node) => node.id) as [
    string,
    ...string[],
  ]
  const childNodeIds = [
    ...childSourceNodeIds,
    ...childContents.map((node) => node.id),
  ]
  const outerGroupId = `${id}-outer-mask`
  return documentSchema.parse({
    ...maskRenderConformanceDocument,
    id,
    name,
    pages: [
      {
        ...maskRenderConformancePage,
        name,
        background: "#0f172a",
        nodeIds: [
          below.id,
          ...outerSourceNodeIds,
          ...childNodeIds,
          outerContent.id,
          above.id,
        ],
      },
    ],
    nodes: [
      below,
      ...outerSources,
      ...childSources,
      ...childContents,
      outerContent,
      above,
    ],
    groups: [
      {
        id: outerGroupId,
        pageId: maskRenderConformancePage.id,
        name: `${name} outer mask`,
        nodeIds: [...outerSourceNodeIds, outerContent.id],
        role: "mask",
        mask: { type: outerType, sourceNodeIds: outerSourceNodeIds },
      },
      {
        id: `${id}-child-mask`,
        pageId: maskRenderConformancePage.id,
        parentGroupId: outerGroupId,
        name: `${name} child mask`,
        nodeIds: childNodeIds,
        role: "mask",
        mask: { type: childType, sourceNodeIds: childSourceNodeIds },
      },
    ],
  })
}

const nestedOuterVectorOne = {
  ...rect(
    "nested-vector-alpha-outer-source-one",
    "Outer vector source one",
    54,
    48,
    320,
    250,
    "#111827"
  ),
  rotation: 5,
  opacity: 0.82,
}
const nestedOuterVectorTwo = {
  ...rect(
    "nested-vector-alpha-outer-source-two",
    "Outer vector source two",
    188,
    36,
    236,
    278,
    "#111827"
  ),
  rotation: -7,
  opacity: 0.58,
}

export const nestedVectorAlphaRenderConformanceDocument = nestedMaskDocument(
  "nested-vector-alpha-v1",
  "Nested vector alpha crop and run font",
  "vector",
  [nestedOuterVectorOne, nestedOuterVectorTwo],
  "alpha",
  [
    nestedImage(
      "nested-vector-alpha-child-image",
      "Child alpha cropped image",
      132
    ),
  ],
  [
    nestedRichText(
      "nested-vector-alpha-rich-text",
      "Child rich run-font content"
    ),
  ]
)

const nestedLuminanceRed = {
  ...rect(
    "nested-luminance-vector-outer-red",
    "Outer luminance red source",
    52,
    48,
    250,
    258,
    "#ff0000"
  ),
  opacity: 0.72,
}
const nestedLuminanceGreenHidden = {
  ...rect(
    "nested-luminance-vector-outer-green",
    "Hidden outer luminance green source",
    178,
    42,
    248,
    266,
    "#00ff00"
  ),
  opacity: 0.48,
  visible: false,
}
const nestedChildVectorOne = rect(
  "nested-luminance-vector-child-one",
  "Child vector source one",
  94,
  88,
  210,
  164,
  "#111827"
)
const nestedChildVectorTwo = {
  ...rect(
    "nested-luminance-vector-child-two",
    "Child vector source two",
    214,
    104,
    154,
    142,
    "#111827"
  ),
  rotation: 11,
  opacity: 0.64,
}

export const nestedLuminanceVectorOneHiddenRenderConformanceDocument =
  nestedMaskDocument(
    "nested-luminance-vector-one-hidden-v1",
    "Nested luminance vector one hidden",
    "luminance",
    [nestedLuminanceRed, nestedLuminanceGreenHidden],
    "vector",
    [nestedChildVectorOne, nestedChildVectorTwo],
    [
      nestedImage(
        "nested-luminance-vector-child-image",
        "Child cropped image content",
        146
      ),
      nestedRichText(
        "nested-luminance-vector-rich-text",
        "Child rich run-font content"
      ),
    ]
  )

const nestedOuterAlphaImage = nestedImage(
  "nested-alpha-luminance-outer-image",
  "Outer alpha cropped image source",
  72
)
const nestedOuterAlphaText = {
  ...(alphaTextMaskRenderConformanceNodes[1] as Extract<
    SceneNode,
    { type: "text" }
  >),
  id: "nested-alpha-luminance-outer-text",
  name: "Outer alpha text source",
  x: 174,
  y: 118,
  width: 244,
  opacity: 0.58,
}
const nestedChildLuminanceBlack = {
  ...rect(
    "nested-alpha-luminance-child-black",
    "Hidden child luminance black source",
    88,
    92,
    176,
    150,
    "#000000"
  ),
  visible: false,
}
const nestedChildLuminanceWhite = {
  ...rect(
    "nested-alpha-luminance-child-white",
    "Hidden child luminance white source",
    216,
    104,
    166,
    144,
    "#ffffff"
  ),
  visible: false,
}

export const nestedAlphaLuminanceAllHiddenRenderConformanceDocument =
  nestedMaskDocument(
    "nested-alpha-luminance-all-hidden-v1",
    "Nested alpha luminance all hidden",
    "alpha",
    [nestedOuterAlphaImage, nestedOuterAlphaText],
    "luminance",
    [nestedChildLuminanceBlack, nestedChildLuminanceWhite],
    [
      nestedRichText(
        "nested-alpha-luminance-rich-text",
        "All-hidden child promoted run-font content"
      ),
    ]
  )

export const nestedImageFailureRenderConformanceDocument = documentSchema.parse(
  {
    ...nestedVectorAlphaRenderConformanceDocument,
    id: "nested-image-failure-v1",
    name: "Nested descendant image decode failure",
    nodes: nestedVectorAlphaRenderConformanceDocument.nodes.map((node) =>
      node.id === "nested-vector-alpha-child-image"
        ? { ...node, src: "data:image/png;base64,AA==" }
        : node
    ),
  }
)

const nestedOverDepthGrandchildSource = rect(
  "nested-over-depth-grandchild-source",
  "Over-depth grandchild source",
  132,
  96,
  116,
  96,
  "#111827"
)
const nestedOverDepthGrandchildContent = rect(
  "nested-over-depth-grandchild-content",
  "Over-depth grandchild content",
  164,
  118,
  108,
  92,
  "#f8fafc"
)

export const nestedOverDepthRenderConformanceDocument = documentSchema.parse({
  ...nestedVectorAlphaRenderConformanceDocument,
  id: "nested-over-depth-v1",
  name: "Nested third-level admission failure",
  pages: nestedVectorAlphaRenderConformanceDocument.pages.map((page) => ({
    ...page,
    nodeIds: page.nodeIds.flatMap((nodeId) =>
      nodeId === "nested-vector-alpha-child-image"
        ? [
            nodeId,
            nestedOverDepthGrandchildSource.id,
            nestedOverDepthGrandchildContent.id,
          ]
        : [nodeId]
    ),
  })),
  nodes: [
    ...nestedVectorAlphaRenderConformanceDocument.nodes,
    nestedOverDepthGrandchildSource,
    nestedOverDepthGrandchildContent,
  ],
  groups: [
    ...nestedVectorAlphaRenderConformanceDocument.groups,
    {
      id: "nested-over-depth-grandchild-mask",
      pageId: maskRenderConformancePage.id,
      parentGroupId: "nested-vector-alpha-v1-child-mask",
      name: "Over-depth grandchild mask",
      nodeIds: [
        nestedOverDepthGrandchildSource.id,
        nestedOverDepthGrandchildContent.id,
      ],
      role: "mask",
      mask: {
        type: "vector",
        sourceNodeIds: [nestedOverDepthGrandchildSource.id],
      },
    },
  ],
})

const nestedCompositeAreaChildren = Array.from({ length: 4 }, (_, index) => {
  const source = rect(
    `nested-area-limit-source-${index}`,
    `Area-limit child ${index + 1} source`,
    0,
    0,
    2_000,
    2_000,
    "#111827"
  )
  const content = rect(
    `nested-area-limit-content-${index}`,
    `Area-limit child ${index + 1} content`,
    0,
    0,
    2_000,
    2_000,
    "#f8fafc"
  )
  return { source, content }
})
const nestedCompositeAreaOuterSource = rect(
  "nested-area-limit-outer-source",
  "Area-limit outer source",
  0,
  0,
  2_000,
  2_000,
  "#111827"
)

export const nestedCompositeAreaLimitRenderConformanceDocument =
  documentSchema.parse({
    ...maskRenderConformanceDocument,
    id: "nested-composite-area-limit-v1",
    name: "Nested summed composite area admission failure",
    pages: [
      {
        ...maskRenderConformancePage,
        name: "Nested summed composite area admission failure",
        nodeIds: [
          nestedCompositeAreaOuterSource.id,
          ...nestedCompositeAreaChildren.flatMap(({ source, content }) => [
            source.id,
            content.id,
          ]),
        ],
      },
    ],
    nodes: [
      nestedCompositeAreaOuterSource,
      ...nestedCompositeAreaChildren.flatMap(({ source, content }) => [
        source,
        content,
      ]),
    ],
    groups: [
      {
        id: "nested-area-limit-outer-mask",
        pageId: maskRenderConformancePage.id,
        name: "Area-limit outer mask",
        nodeIds: [nestedCompositeAreaOuterSource.id],
        role: "mask",
        mask: {
          type: "vector",
          sourceNodeIds: [nestedCompositeAreaOuterSource.id],
        },
      },
      ...nestedCompositeAreaChildren.map(({ source, content }, index) => ({
        id: `nested-area-limit-child-mask-${index}`,
        pageId: maskRenderConformancePage.id,
        parentGroupId: "nested-area-limit-outer-mask",
        name: `Area-limit child mask ${index + 1}`,
        nodeIds: [source.id, content.id],
        role: "mask" as const,
        mask: { type: "vector" as const, sourceNodeIds: [source.id] },
      })),
    ],
  })
