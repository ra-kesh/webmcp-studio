import {
  documentSchema,
  type Document,
  type ImageFrameMask,
  type ImagePlacement,
  type SceneNode,
} from "./schema"
import { applyCommand } from "./commands"
import { materializeComponentInstances } from "./components"

export const renderConformanceImageSource = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><path fill="#ef4444" d="M0 0h200v120H0z"/><path fill="#22c55e" d="M200 0h200v120H200z"/><path fill="#3b82f6" d="M0 120h200v120H0z"/><path fill="#facc15" d="M200 120h200v120H200z"/></svg>'
)}`

export type ImageRenderParityCase = Readonly<{
  id: string
  frame: Readonly<{ width: number; height: number; rotation: number }>
  naturalSize: Readonly<{ width: number; height: number }>
  placement: ImagePlacement
  frameMask: ImageFrameMask
}>

export const imageRenderParityPixelRatios = [1, 2] as const

/**
 * Retained structural corpus shared by the canonical projector, React,
 * Fabric, and the HTML/export renderer. It deliberately spans every placement
 * and frame-mask mode, landscape/portrait/square source and frame geometry,
 * focal corners, sub- and super-unit zoom, inner rotation, and both flips.
 */
export const imageRenderParityCases = [
  {
    id: "fill-landscape-portrait-top-left-rectangle",
    frame: { width: 240, height: 360, rotation: 7 },
    naturalSize: { width: 1600, height: 900 },
    placement: {
      mode: "fill",
      focalX: 0,
      focalY: 0,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
  },
  {
    id: "fill-portrait-landscape-bottom-right-rounded",
    frame: { width: 480, height: 240, rotation: -11 },
    naturalSize: { width: 900, height: 1600 },
    placement: {
      mode: "fill",
      focalX: 1,
      focalY: 1,
      zoom: 1.35,
      rotation: 15,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.2 },
  },
  {
    id: "fill-square-square-center-ellipse",
    frame: { width: 320, height: 320, rotation: 0 },
    naturalSize: { width: 1024, height: 1024 },
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 2,
      rotation: -30,
      flipX: false,
      flipY: true,
    },
    frameMask: { shape: "ellipse" },
  },
  {
    id: "fit-landscape-square-bottom-left-rectangle",
    frame: { width: 300, height: 300, rotation: 18 },
    naturalSize: { width: 1800, height: 1000 },
    placement: {
      mode: "fit",
      focalX: 0,
      focalY: 1,
      zoom: 0.65,
      rotation: 20,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
  },
  {
    id: "fit-portrait-portrait-top-right-rounded",
    frame: { width: 280, height: 420, rotation: -4 },
    naturalSize: { width: 1000, height: 1800 },
    placement: {
      mode: "fit",
      focalX: 1,
      focalY: 0,
      zoom: 1.6,
      rotation: -45,
      flipX: true,
      flipY: true,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.35 },
  },
  {
    id: "fit-square-landscape-center-ellipse",
    frame: { width: 500, height: 260, rotation: 3 },
    naturalSize: { width: 1200, height: 1200 },
    placement: {
      mode: "fit",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 90,
      flipX: false,
      flipY: true,
    },
    frameMask: { shape: "ellipse" },
  },
  {
    id: "manual-landscape-landscape-top-right-rectangle",
    frame: { width: 420, height: 220, rotation: -16 },
    naturalSize: { width: 1920, height: 1080 },
    placement: {
      mode: "manual",
      focalX: 1,
      focalY: 0,
      zoom: 0.55,
      rotation: 33,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
  },
  {
    id: "manual-portrait-square-bottom-left-rounded",
    frame: { width: 360, height: 360, rotation: 9 },
    naturalSize: { width: 1080, height: 1920 },
    placement: {
      mode: "manual",
      focalX: 0,
      focalY: 1,
      zoom: 2.4,
      rotation: -75,
      flipX: false,
      flipY: true,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.125 },
  },
  {
    id: "manual-square-portrait-bottom-right-ellipse",
    frame: { width: 260, height: 460, rotation: 27 },
    naturalSize: { width: 1400, height: 1400 },
    placement: {
      mode: "manual",
      focalX: 1,
      focalY: 1,
      zoom: 3.25,
      rotation: 137,
      flipX: true,
      flipY: true,
    },
    frameMask: { shape: "ellipse" },
  },
] satisfies readonly ImageRenderParityCase[]

export function imageRenderParityInput(
  fixture: ImageRenderParityCase,
  pixelRatio: (typeof imageRenderParityPixelRatios)[number]
) {
  return {
    frame: {
      width: fixture.frame.width * pixelRatio,
      height: fixture.frame.height * pixelRatio,
    },
    naturalSize: {
      width: fixture.naturalSize.width * pixelRatio,
      height: fixture.naturalSize.height * pixelRatio,
    },
    placement: fixture.placement,
    frameMask: fixture.frameMask,
  }
}

export function imageRenderParityNode(
  fixture: ImageRenderParityCase,
  pixelRatio: (typeof imageRenderParityPixelRatios)[number]
): Extract<SceneNode, { type: "image" }> {
  return {
    id: `parity-${fixture.id}-${pixelRatio}x`,
    type: "image",
    name: fixture.id,
    x: 17 * pixelRatio,
    y: 23 * pixelRatio,
    width: fixture.frame.width * pixelRatio,
    height: fixture.frame.height * pixelRatio,
    rotation: fixture.frame.rotation,
    opacity: 0.82,
    visible: true,
    locked: false,
    assetId: `asset-${fixture.id}`,
    src: renderConformanceImageSource,
    placement: fixture.placement,
    frameMask: fixture.frameMask,
    alt: fixture.id,
    decorative: false,
  }
}

const imageParityNodes = imageRenderParityCases.map((fixture) =>
  imageRenderParityNode(fixture, 1)
)

export const imageRenderParityDocument: Document = documentSchema.parse({
  schemaVersion: 4,
  id: "image-render-parity-v1",
  name: "Image renderer parity corpus",
  revision: 1,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  outputs: [
    {
      id: "image-parity-output",
      name: "Image parity output",
      kind: "proposal",
      pageIds: imageParityNodes.map((node) => `page-${node.id}`),
      exportFormats: ["png", "pdf"],
    },
  ],
  pages: imageParityNodes.map((node) => ({
    id: `page-${node.id}`,
    outputId: "image-parity-output",
    name: node.name,
    width: node.width + 40,
    height: node.height + 48,
    background: "#f4f4f5",
    nodeIds: [node.id],
  })),
  nodes: imageParityNodes,
  fields: [],
  fieldValues: {},
  bindings: [],
  groups: [],
  components: [],
  componentInstances: [],
  typographyStyles: [],
  paintStyles: [],
  variables: [],
  variableBindings: [],
})

const componentConformanceRect = (
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
  radius: 12,
  stroke: "#0f172a",
  strokeWidth: 2,
})

const componentConformanceInstances = [
  {
    id: "component-render-default",
    name: "Default card",
    variantId: "component-card-default",
    rootGroupId: "component-render-default-root",
    transform: { x: 40, y: 240, scale: 0.75, rotation: 0 },
    overrides: {},
  },
  {
    id: "component-render-variant",
    name: "Variant card",
    variantId: "component-card-accent",
    rootGroupId: "component-render-variant-root",
    transform: { x: 280, y: 240, scale: 1, rotation: 4 },
    overrides: {},
  },
  {
    id: "component-render-overridden",
    name: "Overridden card",
    variantId: "component-card-accent",
    rootGroupId: "component-render-overridden-root",
    transform: { x: 570, y: 250, scale: 0.8, rotation: -5 },
    overrides: {
      "component-card-source": { fill: "#be123c", opacity: 0.82 },
    },
  },
  {
    id: "component-render-detached",
    name: "Detached card",
    variantId: "component-card-accent",
    rootGroupId: "component-render-detached-root",
    transform: { x: 40, y: 470, scale: 1, rotation: 0 },
    overrides: {},
  },
] as const

const componentConformanceSourceNodes = [
  componentConformanceRect(
    "component-badge-source",
    "Badge source",
    20,
    20,
    80,
    24,
    "#334155"
  ),
  componentConformanceRect(
    "component-card-source",
    "Card source",
    120,
    20,
    240,
    160,
    "#e2e8f0"
  ),
  componentConformanceRect(
    "component-card-nested-badge",
    "Nested badge",
    260,
    130,
    80,
    24,
    "#334155"
  ),
]

const componentConformanceMappedNodes = componentConformanceInstances.flatMap(
  (instance) => [
    componentConformanceRect(
      `${instance.id}-card`,
      instance.name,
      instance.transform.x,
      instance.transform.y,
      240,
      160,
      "#e2e8f0"
    ),
    componentConformanceRect(
      `${instance.id}-badge`,
      `${instance.name} nested badge`,
      instance.transform.x,
      instance.transform.y,
      80,
      24,
      "#334155"
    ),
  ]
)

const componentConformanceDraft: Document = documentSchema.parse({
  schemaVersion: 4,
  id: "component-render-conformance-v1",
  name: "Component renderer conformance",
  revision: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  outputs: [
    {
      id: "component-render-output",
      name: "Component render output",
      kind: "proposal",
      pageIds: ["component-render-page"],
      exportFormats: ["png", "pdf"],
    },
  ],
  pages: [
    {
      id: "component-render-page",
      outputId: "component-render-output",
      name: "Component render cases",
      width: 900,
      height: 700,
      background: "#f8fafc",
      nodeIds: [
        ...componentConformanceSourceNodes.map((node) => node.id),
        ...componentConformanceMappedNodes.map((node) => node.id),
      ],
    },
  ],
  nodes: [
    ...componentConformanceSourceNodes,
    ...componentConformanceMappedNodes,
  ],
  groups: [
    {
      id: "component-badge-source-root",
      pageId: "component-render-page",
      name: "Badge source",
      nodeIds: ["component-badge-source"],
    },
    {
      id: "component-card-source-root",
      pageId: "component-render-page",
      name: "Card source",
      nodeIds: ["component-card-source"],
    },
    {
      id: "component-card-nested-badge-root",
      pageId: "component-render-page",
      name: "Badge nested in card",
      nodeIds: ["component-card-nested-badge"],
      parentGroupId: "component-card-source-root",
    },
    ...componentConformanceInstances.flatMap((instance) => [
      {
        id: instance.rootGroupId,
        pageId: "component-render-page",
        name: instance.name,
        nodeIds: [`${instance.id}-card`],
      },
      {
        id: `${instance.id}-nested-root`,
        pageId: "component-render-page",
        name: "Badge nested in card",
        nodeIds: [`${instance.id}-badge`],
        parentGroupId: instance.rootGroupId,
      },
    ]),
  ],
  components: [
    {
      id: "component-badge",
      name: "Badge",
      description: "Nested renderer conformance component",
      sourceGroupId: "component-badge-source-root",
      defaultVariantId: "component-badge-default",
      variants: [
        { id: "component-badge-default", name: "Default", overrides: {} },
      ],
    },
    {
      id: "component-card",
      name: "Card",
      description: "Renderer conformance component",
      sourceGroupId: "component-card-source-root",
      defaultVariantId: "component-card-default",
      variants: [
        { id: "component-card-default", name: "Default", overrides: {} },
        {
          id: "component-card-accent",
          name: "Accent",
          overrides: {
            "component-card-source": { fill: "#1d4ed8" },
            "component-card-nested-badge": { fill: "#facc15" },
          },
        },
      ],
    },
  ],
  componentInstances: [
    {
      id: "component-card-nested-badge-instance",
      name: "Badge nested in card",
      componentId: "component-badge",
      variantId: "component-badge-default",
      rootGroupId: "component-card-nested-badge-root",
      transform: { x: 260, y: 130, scale: 1, rotation: 0 },
      nodeMappings: [
        {
          sourceNodeId: "component-badge-source",
          instanceNodeId: "component-card-nested-badge",
        },
      ],
      groupMappings: [
        {
          sourceGroupId: "component-badge-source-root",
          instanceGroupId: "component-card-nested-badge-root",
        },
      ],
      overrides: {},
    },
    ...componentConformanceInstances.map((instance) => ({
      ...instance,
      componentId: "component-card",
      nodeMappings: [
        {
          sourceNodeId: "component-card-source",
          instanceNodeId: `${instance.id}-card`,
        },
        {
          sourceNodeId: "component-card-nested-badge",
          instanceNodeId: `${instance.id}-badge`,
        },
      ],
      groupMappings: [
        {
          sourceGroupId: "component-card-source-root",
          instanceGroupId: instance.rootGroupId,
        },
        {
          sourceGroupId: "component-card-nested-badge-root",
          instanceGroupId: `${instance.id}-nested-root`,
        },
      ],
    })),
  ],
  fields: [],
  fieldValues: {},
  bindings: [],
  typographyStyles: [],
  paintStyles: [],
  variables: [],
  variableBindings: [],
})

const materializedComponentConformanceDocument = materializeComponentInstances(
  componentConformanceDraft
)

/**
 * Retained component corpus shared by Fabric, React, Renderer HTML and the PDF
 * worker boundary. The detached case is produced by the canonical command so
 * it keeps ordinary scene nodes while surrendering all component authority.
 */
export const componentRenderConformanceDocument = applyCommand(
  materializedComponentConformanceDocument,
  {
    id: "component-render-detach",
    type: "detach_component_instance",
    actor: "human",
    at: "2026-08-30T00:01:00.000Z",
    instanceId: "component-render-detached",
  }
)

export const componentRenderConformanceCases = [
  {
    id: "default",
    rootGroupId: "component-render-default-root",
    nodeIds: [
      "component-render-default-card",
      "component-render-default-badge",
    ],
  },
  {
    id: "variant",
    rootGroupId: "component-render-variant-root",
    nodeIds: [
      "component-render-variant-card",
      "component-render-variant-badge",
    ],
  },
  {
    id: "overridden",
    rootGroupId: "component-render-overridden-root",
    nodeIds: [
      "component-render-overridden-card",
      "component-render-overridden-badge",
    ],
  },
  {
    id: "nested",
    rootGroupId: "component-render-default-nested-root",
    nodeIds: ["component-render-default-badge"],
  },
  {
    id: "detached",
    rootGroupId: "component-render-detached-root",
    nodeIds: [
      "component-render-detached-card",
      "component-render-detached-badge",
    ],
  },
] as const

const nodes = [
  {
    id: "text-typography",
    type: "text",
    name: "Typography and whitespace",
    x: 48,
    y: 52,
    width: 340,
    height: 190,
    rotation: 0,
    opacity: 0.72,
    visible: true,
    locked: false,
    text: "Spacing   stays\nA deliberately long line wraps against the same canonical width.",
    runs: [
      {
        start: 0,
        end: 7,
        style: {
          color: "#be123c",
          fontSize: 36,
          fontWeight: 780,
          italic: true,
          decoration: "underline",
          lineHeight: 1.45,
          letterSpacing: 1.2,
        },
      },
      {
        start: 18,
        end: 30,
        style: {
          color: "#166534",
          fontSize: 24,
          fontWeight: 520,
          decoration: "line_through",
          letterSpacing: -0.4,
        },
      },
    ],
    paragraphs: [
      { start: 0, end: 15, style: { align: "center" } },
      {
        start: 16,
        end: 80,
        style: {
          align: "left",
          list: { kind: "bulleted", level: 0 },
        },
      },
    ],
    links: [
      {
        start: 10,
        end: 15,
        target: "https://example.com/conformance",
        newTab: true,
      },
    ],
    color: "#172554",
    fontFamily: "Geist Variable",
    fontSize: 28,
    fontWeight: 650,
    italic: false,
    decoration: "none",
    lineHeight: 1.35,
    letterSpacing: 2.5,
    align: "right",
    sizingMode: "fixed",
  },
  {
    id: "rect-stroke-radius",
    type: "rect",
    name: "Rounded rectangle with border",
    x: 430,
    y: 44,
    width: 220,
    height: 150,
    rotation: -9,
    opacity: 0.86,
    visible: true,
    locked: true,
    fill: "#fef3c7",
    radius: 24,
    stroke: "#92400e",
    strokeWidth: 8,
  },
  {
    id: "ellipse-stroke",
    type: "ellipse",
    name: "Ellipse with border",
    x: 72,
    y: 300,
    width: 190,
    height: 120,
    rotation: 18,
    opacity: 0.61,
    visible: true,
    locked: false,
    fill: "#dbeafe",
    stroke: "#1d4ed8",
    strokeWidth: 5,
  },
  {
    id: "diagonal-line",
    type: "line",
    name: "Diagonal line",
    x: 330,
    y: 300,
    width: 250,
    height: 90,
    rotation: -4,
    opacity: 0.9,
    visible: true,
    locked: false,
    stroke: "#7c3aed",
    strokeWidth: 7,
  },
  {
    id: "icon-viewbox",
    type: "icon",
    name: "Non-square icon viewport",
    x: 70,
    y: 505,
    width: 180,
    height: 90,
    rotation: 13,
    opacity: 0.78,
    visible: true,
    locked: false,
    path: "M12 21 3 12 12 3 21 12Z",
    viewBox: "0 0 24 24",
    fill: "#be123c",
    stroke: "#4c0519",
    strokeWidth: 1.5,
  },
  {
    id: "image-cover",
    type: "image",
    name: "Cover image with focal point",
    x: 310,
    y: 470,
    width: 330,
    height: 180,
    rotation: 5,
    opacity: 0.83,
    visible: true,
    locked: false,
    assetId: "asset-conformance-cover",
    src: renderConformanceImageSource,
    placement: {
      mode: "fill",
      focalX: 0.2,
      focalY: 0.8,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    alt: "Four colored quadrants cropped to cover",
    decorative: false,
  },
  {
    id: "image-contain",
    type: "image",
    name: "Contained image with focal point",
    x: 70,
    y: 700,
    width: 280,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    assetId: "asset-conformance-contain",
    src: renderConformanceImageSource,
    placement: {
      mode: "fit",
      focalX: 0.8,
      focalY: 0.1,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    alt: "Four colored quadrants contained in frame",
    decorative: false,
  },
  {
    id: "hidden-node",
    type: "rect",
    name: "Hidden locked rectangle",
    x: 430,
    y: 720,
    width: 160,
    height: 100,
    rotation: 0,
    opacity: 0.4,
    visible: false,
    locked: true,
    fill: "#111827",
    radius: 12,
    strokeWidth: 0,
  },
] satisfies SceneNode[]

export const renderConformanceDocument: Document = documentSchema.parse({
  schemaVersion: 4,
  id: "render-conformance-golden-v3",
  name: "Render conformance golden corpus",
  revision: 2,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  outputs: [
    {
      id: "mixed-document",
      name: "Mixed document output",
      kind: "proposal",
      pageIds: ["properties-page", "long-text-page"],
      exportFormats: ["png", "pdf"],
    },
    {
      id: "square-image",
      name: "Square image output",
      kind: "square",
      pageIds: ["square-page"],
      exportFormats: ["png"],
    },
  ],
  pages: [
    {
      id: "properties-page",
      outputId: "mixed-document",
      name: "All node properties",
      width: 720,
      height: 960,
      background: "#f8fafc",
      nodeIds: nodes.map((node) => node.id),
    },
    {
      id: "long-text-page",
      outputId: "mixed-document",
      name: "Long text and alternate page size",
      width: 640,
      height: 360,
      background: "#fff7ed",
      nodeIds: ["long-text-only"],
    },
    {
      id: "square-page",
      outputId: "square-image",
      name: "Square output",
      width: 512,
      height: 512,
      background: "#ecfccb",
      nodeIds: ["square-accent", "auto-width-label"],
    },
  ],
  nodes: [
    ...nodes,
    {
      id: "long-text-only",
      type: "text",
      name: "Long centered paragraph",
      x: 40,
      y: 40,
      width: 560,
      height: 153.6,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      text: "A long paragraph must wrap deterministically without collapsing   intentional spaces.\nIts second line makes newline handling observable across thumbnail, editor, PNG, and PDF rendering.",
      runs: [],
      paragraphs: [],
      links: [],
      color: "#431407",
      fontFamily: "Geist Variable",
      fontSize: 24,
      fontWeight: 450,
      lineHeight: 1.6,
      letterSpacing: -0.5,
      align: "center",
      sizingMode: "auto_height",
    },
    {
      id: "square-accent",
      type: "rect",
      name: "Square output accent",
      x: 96,
      y: 96,
      width: 320,
      height: 320,
      rotation: 45,
      opacity: 0.67,
      visible: true,
      locked: false,
      fill: "#65a30d",
      radius: 40,
      stroke: "#365314",
      strokeWidth: 10,
    },
    {
      id: "auto-width-label",
      type: "text",
      name: "Auto width label",
      x: 96,
      y: 470,
      width: 196,
      height: 33,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      text: "AUTO WIDTH",
      runs: [],
      paragraphs: [],
      links: [],
      color: "#365314",
      fontFamily: "Geist Variable",
      fontSize: 30,
      fontWeight: 650,
      lineHeight: 1.1,
      letterSpacing: 2,
      align: "left",
      sizingMode: "auto_width",
    },
  ],
  groups: [],
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

/**
 * Shared adverse rich-text input for the retained interactive-scale gate. Its
 * wide unbroken token wraps once, late and inside run 901, which previously
 * forced quadratic line copying and blocked the editor thread for seconds.
 */
export function createAdverseRichTextConformanceNode(options?: {
  id?: string
  name?: string
  x?: number
  y?: number
}) {
  const source = renderConformanceDocument.nodes.find(
    (candidate) => candidate.type === "text"
  )
  if (!source || source.type !== "text") {
    throw new Error("Render conformance text source is missing")
  }
  const text = "A".repeat(7_000)
  return {
    ...source,
    id: options?.id ?? "adverse-rich-text",
    name: options?.name ?? "Adverse 1,000-run rich text",
    x: options?.x ?? source.x,
    y: options?.y ?? source.y,
    text,
    width: 80_652.8,
    height: 20_000,
    sizingMode: "auto_height" as const,
    fontSize: 20,
    fontWeight: 400,
    letterSpacing: 0,
    runs: Array.from({ length: 1_000 }, (_, index) => ({
      start: index * 7,
      end: index * 7 + 7,
      style: { color: index % 2 === 0 ? "#111111" : "#333333" },
    })),
    paragraphs: [],
    links: [],
  }
}

const conformanceCommand = (id: string) => ({
  id,
  actor: "human" as const,
  at: "2026-08-30T14:00:00.000Z",
})

/**
 * A resource-bearing variant of the golden scene. The resolved node values are
 * deliberately visible in every renderer while the document retains the
 * reusable-style and variable identities needed for round-trip assertions.
 */
export const textDesignSystemConformanceDocument: Document = [
  {
    type: "create_typography_style" as const,
    ...conformanceCommand("conformance-create-typography-style"),
    style: {
      id: "typography-conformance-body",
      name: "Conformance / Body",
      fontFamily: "Courier New",
      fontSize: 22,
      fontWeight: 510,
      italic: true,
      lineHeight: 1.25,
      letterSpacing: 1.3,
      decoration: "underline" as const,
    },
  },
  {
    type: "apply_typography_style" as const,
    ...conformanceCommand("conformance-apply-typography-style"),
    styleId: "typography-conformance-body",
    targets: [{ nodeId: "long-text-only" }],
  },
  {
    type: "create_paint_style" as const,
    ...conformanceCommand("conformance-create-paint-style"),
    style: {
      id: "paint-conformance-panel",
      name: "Conformance / Panel",
      color: "#fde68a",
      opacity: 0.63,
    },
  },
  {
    type: "apply_paint_style" as const,
    ...conformanceCommand("conformance-apply-paint-style"),
    styleId: "paint-conformance-panel",
    targets: [{ nodeId: "rect-stroke-radius" }],
  },
  ...[
    {
      id: "variable-conformance-font",
      name: "Conformance / Font",
      type: "font_family" as const,
      value: "Arial",
    },
    {
      id: "variable-conformance-panel",
      name: "Conformance / Panel color",
      type: "color" as const,
      value: "#f97316",
    },
    {
      id: "variable-conformance-label",
      name: "Conformance / Label",
      type: "string" as const,
      value: "BOUND LABEL",
    },
    {
      id: "variable-conformance-radius",
      name: "Conformance / Radius",
      type: "number" as const,
      value: 8,
    },
    {
      id: "variable-conformance-run-color",
      name: "Conformance / Run color",
      type: "color" as const,
      value: "#7c3aed",
    },
  ].map((variable, index) => ({
    type: "create_variable" as const,
    ...conformanceCommand(`conformance-create-variable-${index}`),
    variable,
  })),
  ...[
    {
      id: "binding-conformance-font",
      variableId: "variable-conformance-font",
      target: {
        kind: "typography_style" as const,
        styleId: "typography-conformance-body",
        property: "fontFamily" as const,
      },
    },
    {
      id: "binding-conformance-panel",
      variableId: "variable-conformance-panel",
      target: {
        kind: "paint_style" as const,
        styleId: "paint-conformance-panel",
        property: "color" as const,
      },
    },
    {
      id: "binding-conformance-label",
      variableId: "variable-conformance-label",
      target: {
        kind: "node" as const,
        nodeId: "auto-width-label",
        property: "text" as const,
      },
    },
    {
      id: "binding-conformance-radius",
      variableId: "variable-conformance-radius",
      target: {
        kind: "node" as const,
        nodeId: "rect-stroke-radius",
        property: "radius" as const,
      },
    },
    {
      id: "binding-conformance-run-color",
      variableId: "variable-conformance-run-color",
      target: {
        kind: "text_range" as const,
        nodeId: "text-typography",
        range: { start: 18, end: 30 },
        property: "color" as const,
      },
    },
  ].map((binding, index) => ({
    type: "bind_variable" as const,
    ...conformanceCommand(`conformance-bind-variable-${index}`),
    binding,
  })),
  ...[
    { variableId: "variable-conformance-font", value: "Geist Variable" },
    { variableId: "variable-conformance-panel", value: "#0f766e" },
    { variableId: "variable-conformance-label", value: "UPDATED LABEL" },
    { variableId: "variable-conformance-radius", value: 32 },
    { variableId: "variable-conformance-run-color", value: "#0e7490" },
  ].map(({ variableId, value }, index) => ({
    type: "update_variable" as const,
    ...conformanceCommand(`conformance-update-variable-${index}`),
    variableId,
    patch: { value },
  })),
].reduce(
  (document, command) => applyCommand(document, command),
  renderConformanceDocument
)
