import { describe, expect, it } from "vitest"
import { chromium } from "playwright"
import {
  applyCommand,
  componentRenderConformanceCases,
  componentRenderConformanceDocument,
  createAdverseRichTextConformanceNode,
  imageRenderParityCases,
  imageRenderParityDocument,
  imageRenderParityInput,
  imageRenderParityNode,
  imageRenderParityPixelRatios,
  northstarSeed,
  projectImagePaint,
  projectNodeForRender,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  serializeImagePaintProjector,
  type Document,
  type ImageFrameMask,
  type ImagePaintProjectionInput,
  type ImagePlacement,
  type RenderImagePaintProjection,
  type SceneNode,
} from "@webmcp/document"
import {
  maskRenderConformanceDocument,
  maskRenderConformanceHiddenSourceNodes,
  maskRenderConformanceHiddenSourcePlan,
  maskRenderConformanceNodes,
  maskRenderConformancePlan,
  multiAlphaMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceAllHiddenDocument,
  multiVectorMaskRenderConformanceDocument,
  multiVectorMaskRenderConformanceOneHiddenDocument,
} from "@webmcp/document/internal/mask-render-conformance"
import { projectPagePaintPlan } from "@webmcp/document/internal/page-paint-plan"
import {
  markRenderResourcesReady,
  renderDocumentThumbnailToHtml,
  renderDocumentToHtml,
  renderNodeToHtml,
  renderOutputToHtml,
  renderPagePaintPlanEntryToHtml,
  verifyBrowserLuminanceConversion,
} from "../src/html"

function renderResourceFixture(options?: {
  fontCheck?: boolean
  fontRequirements?: readonly Readonly<{
    nodeId: string
    fontFamilies: readonly string[]
  }>[]
  fontLoadRejects?: boolean
  fontStatus?: string
  imageComplete?: boolean
  imageFrameHeight?: number
  imageFrameMask?: ImageFrameMask
  imageFrameWidth?: number
  imageNaturalHeight?: number
  imageNaturalWidth?: number
  imagePlacement?: ImagePlacement
  imageRejects?: boolean
  projectionRejects?: boolean
  luminanceSourceNodeIds?: readonly string[]
  luminanceConversionReady?: boolean
}) {
  const attributes = new Map<string, string>()
  const root = {
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  }
  const fontLoads: Array<{ query: string; text?: string }> = []
  const fontChecks: Array<{ query: string; text?: string }> = []
  const managedFace = {
    family: "Geist Variable",
    status: "unloaded",
  }
  const faces = Object.assign([managedFace], {
    ready: Promise.resolve(),
    check: (query: string, text?: string) => {
      fontChecks.push({ query, text })
      return options?.fontCheck ?? true
    },
    load: (query: string, text?: string) => {
      fontLoads.push({ query, text })
      if (options?.fontLoadRejects) {
        return Promise.reject(new Error("managed font failed"))
      }
      managedFace.status = options?.fontStatus ?? "loaded"
      return Promise.resolve([managedFace])
    },
  })
  let imageDecodeCalls = 0
  const imageStyle = new Map<string, string>()
  const frameStyle = new Map<string, string>()
  const images = [
    {
      complete: options?.imageComplete ?? true,
      dataset: {
        nodeId: "hero-image",
        imageFrameWidth: String(options?.imageFrameWidth ?? 320),
        imageFrameHeight: String(options?.imageFrameHeight ?? 180),
        imagePlacement: JSON.stringify(
          options?.imagePlacement ?? {
            mode: "fill",
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          }
        ),
        imageFrameMask: JSON.stringify(
          options?.imageFrameMask ?? { shape: "rectangle" }
        ),
      },
      decode: () => {
        imageDecodeCalls += 1
        return options?.imageRejects
          ? Promise.reject(new Error("corrupt image"))
          : Promise.resolve()
      },
      naturalWidth: options?.imageNaturalWidth ?? 1200,
      naturalHeight: options?.imageNaturalHeight ?? 800,
      src: "data:image/png;base64,render-fixture",
      parentElement: {
        style: {
          setProperty: (name: string, value: string) =>
            frameStyle.set(name, value),
        },
      },
      style: {
        setProperty: (name: string, value: string) =>
          imageStyle.set(name, value),
      },
    },
  ]
  return {
    attributes,
    fontChecks,
    fontLoads,
    frameStyle,
    get imageDecodeCalls() {
      return imageDecodeCalls
    },
    imageStyle,
    input: {
      root,
      fonts: faces,
      fontRequirements: options?.fontRequirements,
      images,
      projectImagePaint: options?.projectionRejects
        ? () => {
            throw new Error("invalid projection")
          }
        : projectImagePaint,
      luminanceSourceNodeIds: options?.luminanceSourceNodeIds,
      verifyLuminanceConversion: async () =>
        options?.luminanceConversionReady ?? true,
    },
  }
}

function nestedMaskDocument(
  options: { childType?: "alpha" | "luminance" } = {}
) {
  const seed = maskRenderConformanceNodes.find(
    (node): node is Extract<SceneNode, { type: "rect" }> => node.type === "rect"
  )!
  const rectangle = (
    id: string,
    values: Partial<Extract<SceneNode, { type: "rect" }>>
  ): Extract<SceneNode, { type: "rect" }> => ({
    ...seed,
    id,
    name: id,
    ...values,
  })
  const page = {
    ...maskRenderConformanceDocument.pages[0]!,
    nodeIds: ["outer-source", "child-source", "child-content", "outer-content"],
  }
  return {
    ...maskRenderConformanceDocument,
    pages: [page],
    nodes: [
      rectangle("outer-source", { x: 0, y: 0, width: 20, height: 20 }),
      rectangle("child-source", {
        x: -100,
        y: 0,
        width: 20,
        height: 20,
      }),
      rectangle("child-content", {
        x: 120,
        y: 10,
        width: 20,
        height: 20,
      }),
      rectangle("outer-content", {
        x: 200,
        y: 0,
        width: 20,
        height: 20,
      }),
    ],
    groups: [
      {
        id: "outer-mask",
        role: "mask" as const,
        pageId: page.id,
        name: "Outer mask",
        nodeIds: ["outer-source", "outer-content"],
        mask: { type: "vector" as const, sourceNodeIds: ["outer-source"] },
      },
      {
        id: "child-mask",
        role: "mask" as const,
        pageId: page.id,
        parentGroupId: "outer-mask",
        name: "Child mask",
        nodeIds: ["child-source", "child-content"],
        mask: {
          type: options.childType ?? ("alpha" as const),
          sourceNodeIds: ["child-source"],
        },
      },
    ],
  } as unknown as Document
}

describe("renderer HTML", () => {
  it("uses the canonical paint plan in document, thumbnail, and output HTML", () => {
    const pageId = "mask-conformance-page"
    const outputs = [
      renderDocumentToHtml(maskRenderConformanceDocument, pageId),
      renderDocumentThumbnailToHtml(maskRenderConformanceDocument, pageId, {
        width: 240,
        height: 180,
      }),
      renderOutputToHtml(
        maskRenderConformanceDocument,
        "mask-conformance-output"
      ),
    ]

    for (const html of outputs) {
      expect(html).toContain('data-mask-group-id="mask-conformance-group"')
      expect(html).toContain('data-mask-composite="true"')
      expect(html).toContain('data-mask-source-id="mask-conformance-source"')
      expect(html).not.toContain('data-node-id="mask-conformance-source"')
      expect(html).toContain('data-node-id="mask-conformance-content"')
    }
  })

  it("serializes nested composites with canonical order, local translation, and unique IDs", () => {
    const document = nestedMaskDocument({ childType: "luminance" })
    const html = renderDocumentToHtml(document, document.pages[0]!.id)
    const maskIds = [...html.matchAll(/<mask id="([^"]+)"/g)].map(
      (match) => match[1]
    )

    expect(maskIds).toHaveLength(2)
    expect(new Set(maskIds).size).toBe(2)
    expect(html.indexOf('data-mask-group-id="outer-mask"')).toBeLessThan(
      html.indexOf('data-mask-group-id="child-mask"')
    )
    expect(html).toContain(
      "left:-100px;top:0px;width:240px;height:30px;overflow:hidden"
    )
    expect(html).toContain("transform:translate(100px,0px)")
    expect(html.indexOf('data-node-id="child-content"')).toBeLessThan(
      html.indexOf('data-node-id="outer-content"')
    )
    expect(html.match(/data-luminance-source-isolation=/g)).toHaveLength(1)
    expect(html).toContain('data-luminance-source-id="child-source"')
  })

  it("includes descendant content fonts in the shared readiness scan", () => {
    const base = nestedMaskDocument()
    const text = renderConformanceDocument.nodes.find(
      (node): node is Extract<SceneNode, { type: "text" }> =>
        node.type === "text"
    )!
    const document: Document = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "child-content"
          ? {
              ...text,
              id: node.id,
              name: node.name,
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              runs: [
                {
                  start: 0,
                  end: Math.min(1, text.text.length),
                  style: { fontFamily: "Inter" },
                },
              ],
            }
          : node
      ),
    }

    const html = renderDocumentToHtml(document, document.pages[0]!.id)

    expect(html).toContain('data-mask-font-source-node="child-content"')
    expect(html).toContain(
      'data-mask-font-families="[&quot;Geist Variable&quot;,&quot;Inter&quot;]"'
    )
    expect(html).toContain(
      'document.querySelectorAll("[data-mask-font-families]")'
    )
  })

  it("serializes source-over union sources in canonical order and excludes hidden sources", () => {
    const visible = renderDocumentToHtml(
      multiVectorMaskRenderConformanceDocument,
      "mask-conformance-page"
    )
    const sourceIds =
      multiVectorMaskRenderConformanceDocument.groups[0]!.role === "mask"
        ? multiVectorMaskRenderConformanceDocument.groups[0]!.mask.sourceNodeIds
        : []
    const offsets = sourceIds.map((sourceId) =>
      visible.indexOf(`data-mask-source-id="${sourceId}"`)
    )
    expect(offsets.every((offset) => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))

    const oneHidden = renderDocumentToHtml(
      multiVectorMaskRenderConformanceOneHiddenDocument,
      "mask-conformance-page"
    )
    expect(oneHidden.match(/data-mask-source-id=/g)).toHaveLength(1)

    const allHidden = renderDocumentToHtml(
      multiVectorMaskRenderConformanceAllHiddenDocument,
      "mask-conformance-page"
    )
    expect(allHidden).toContain('data-mask-composite="false"')
    expect(allHidden).not.toContain("data-mask-source-id=")
  })

  it("includes every alpha image/text source in shared document, thumbnail, and PDF HTML", () => {
    const document = multiAlphaMaskRenderConformanceDocument
    const outputs = [
      renderDocumentToHtml(document, "mask-conformance-page"),
      renderDocumentThumbnailToHtml(document, "mask-conformance-page", {
        width: 240,
        height: 180,
      }),
      renderOutputToHtml(document, "mask-conformance-output"),
    ]
    const sourceIds =
      document.groups[0]!.role === "mask"
        ? document.groups[0]!.mask.sourceNodeIds
        : []
    for (const html of outputs) {
      for (const sourceId of sourceIds) {
        expect(html).toContain(`data-mask-source-id="${sourceId}"`)
      }
      expect(html.match(/data-mask-source-id=/g)).toHaveLength(3)
      expect(html.match(/<img data-node-id=/g)).toHaveLength(2)
      expect(html).toContain("data-mask-font-families=")
    }
  })

  it("isolates every luminance source and applies explicit sRGB Y*A conversion before union", () => {
    const document = multiVectorMaskRenderConformanceDocument
    const vectorEntry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (vectorEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const entry = { ...vectorEntry, maskType: "luminance" as const }
    const html = renderPagePaintPlanEntryToHtml(
      entry,
      new Map(document.nodes.map((node) => [node.id, node]))
    )

    expect(html.match(/data-luminance-source-id=/g)).toHaveLength(2)
    expect(html.match(/0\.2126 0\.7152 0\.0722 0 0/g)).toHaveLength(2)
    expect(html.match(/color-interpolation-filters="sRGB"/g)).toHaveLength(2)
    expect(html.match(/in2="SourceGraphic" operator="in"/g)).toHaveLength(2)
    const offsets = entry.sourceNodeIds.map((sourceId) =>
      html.indexOf(`data-luminance-source-isolation="${sourceId}"`)
    )
    expect(offsets.every((offset) => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
    expect(html).toContain('mask-type="alpha"')
    expect(html).not.toContain('mask-type="luminance"')
  })

  it("keeps hidden luminance sources out and all-hidden luminance allocation-free", () => {
    const oneHidden = multiVectorMaskRenderConformanceOneHiddenDocument
    const oneHiddenEntry = projectPagePaintPlan(
      oneHidden,
      oneHidden.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (oneHiddenEntry.kind !== "mask_group") {
      throw new Error("Missing mask entry")
    }
    const oneHiddenHtml = renderPagePaintPlanEntryToHtml(
      { ...oneHiddenEntry, maskType: "luminance" },
      new Map(oneHidden.nodes.map((node) => [node.id, node]))
    )
    expect(oneHiddenHtml.match(/0\.2126 0\.7152 0\.0722 0 0/g)).toHaveLength(1)
    expect(oneHiddenHtml.match(/data-mask-source-id=/g)).toHaveLength(1)

    const allHidden = multiVectorMaskRenderConformanceAllHiddenDocument
    const allHiddenEntry = projectPagePaintPlan(
      allHidden,
      allHidden.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (allHiddenEntry.kind !== "mask_group") {
      throw new Error("Missing mask entry")
    }
    const allHiddenHtml = renderPagePaintPlanEntryToHtml(
      { ...allHiddenEntry, maskType: "luminance" },
      new Map(allHidden.nodes.map((node) => [node.id, node]))
    )
    expect(allHiddenHtml).toContain('data-mask-composite="false"')
    expect(allHiddenHtml).not.toContain("0.2126 0.7152 0.0722 0 0")
    expect(allHiddenHtml).not.toContain("data-mask-source-id")
  })

  it("preserves image and text readiness metadata inside independent luminance sources", () => {
    const document = multiAlphaMaskRenderConformanceDocument
    const alphaEntry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (alphaEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const entry = { ...alphaEntry, maskType: "luminance" as const }
    const html = renderPagePaintPlanEntryToHtml(
      entry,
      new Map(document.nodes.map((node) => [node.id, node]))
    )

    expect(html.match(/0\.2126 0\.7152 0\.0722 0 0/g)).toHaveLength(3)
    expect(html.match(/data-luminance-source-isolation=/g)).toHaveLength(3)
    expect(html.match(/<img data-node-id=/g)).toHaveLength(2)
    expect(html).toContain("data-mask-font-source-node=")
    expect(html).toContain("data-mask-font-families=")
  })

  it("keeps negative, rotated, frame-masked image content inside the production mask composite", () => {
    const imageContent = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-content",
      name: "Frame-masked image content",
      x: -36,
      y: 54,
      rotation: -11,
      opacity: 0.74,
      frameMask: { shape: "ellipse" as const },
    }
    const document = {
      ...maskRenderConformanceDocument,
      nodes: maskRenderConformanceDocument.nodes.map((node) =>
        node.id === imageContent.id ? imageContent : node
      ),
    }
    const html = renderDocumentToHtml(document, "mask-conformance-page")

    expect(html).toContain('data-mask-group-id="mask-conformance-group"')
    expect(html).toContain('data-mask-composite="true"')
    expect(html).toContain('data-image-frame-id="mask-conformance-content"')
    expect(html).toContain("left:-36px")
    expect(html).toContain("transform:rotate(-11deg)")
    expect(html).toContain("&quot;shape&quot;:&quot;ellipse&quot;")
  })

  it("serializes the retained vector-mask paint entry for the shared PNG/PDF HTML source", () => {
    const entry = maskRenderConformancePlan.entries[1]
    if (!entry || entry.kind !== "mask_group") {
      throw new Error("Missing retained mask group")
    }
    const maskHtml = renderPagePaintPlanEntryToHtml(
      entry,
      new Map(maskRenderConformanceNodes.map((node) => [node.id, node]))
    )
    const pngHtml = `<body>${maskHtml}</body>`
    const pdfHtml = `<section class="studio-page">${maskHtml}</section>`
    const source = maskRenderConformanceNodes[1]
    const content = maskRenderConformanceNodes[2]

    expect(pngHtml).toContain(maskHtml)
    expect(pdfHtml).toContain(maskHtml)
    expect(maskHtml).toContain('data-mask-group-id="mask-conformance-group"')
    expect(maskHtml).toContain('data-mask-enabled="true"')
    expect(maskHtml).toContain('data-mask-composite="true"')
    expect(maskHtml).toContain("overflow:hidden")
    expect(maskHtml).toContain(`width:${entry.bounds.width}px`)
    expect(maskHtml).toContain(`height:${entry.bounds.height}px`)
    expect(maskHtml).toContain(
      `transform:translate(${-entry.bounds.x}px,${-entry.bounds.y}px)`
    )
    expect(maskHtml).toContain(
      `transform="rotate(${source.rotation} ${source.x - entry.bounds.x} ${source.y - entry.bounds.y})"`
    )
    expect(maskHtml).toContain(`data-mask-source-id="${source.id}"`)
    expect(maskHtml).toContain(`data-node-id="${content.id}"`)
    expect(maskHtml).not.toContain(`data-node-id="${source.id}"`)
    expect(maskHtml).toMatch(
      /data-mask-group-id="mask-conformance-group"[^>]+style="[^"]*mask:url\(/
    )
    expect(maskHtml).not.toMatch(
      /data-mask-content="mask-conformance-group"[^>]+style="[^"]*mask:/
    )
  })

  it("serializes admitted ellipse and icon sources with rotation and opacity", () => {
    const entry = maskRenderConformancePlan.entries[1]
    if (!entry || entry.kind !== "mask_group") {
      throw new Error("Missing retained mask group")
    }
    const baseSource = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-source"
    )!
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    if (baseSource.type !== "rect") throw new Error("Expected rectangle source")
    const { radius: _radius, ...sourceFrame } = baseSource
    const cases: Array<{ source: SceneNode; tag: string }> = [
      { source: { ...sourceFrame, type: "ellipse" }, tag: "ellipse" },
      {
        source: {
          ...sourceFrame,
          type: "icon",
          path: "M2 2h20v20H2z",
          viewBox: "0 0 24 24",
        },
        tag: "svg",
      },
    ]

    for (const { source, tag } of cases) {
      const html = renderPagePaintPlanEntryToHtml(
        entry,
        new Map([
          [source.id, source],
          [content.id, content],
        ])
      )
      expect(html).toContain(`<${tag} data-mask-source-id="${source.id}"`)
      expect(html).toContain(
        `${source.type === "icon" ? "opacity" : "fill-opacity"}="${source.opacity}"`
      )
      expect(html).toContain(
        `transform="rotate(${source.rotation} ${source.x - entry.bounds.x} ${source.y - entry.bounds.y})"`
      )
    }
  })

  it("serializes image and text alpha from ordinary canonical paint and readiness", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]
    if (!baseEntry || baseEntry.kind !== "mask_group") {
      throw new Error("Missing retained mask group")
    }
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-source",
      opacity: 0.57,
      frameMask: { shape: "ellipse" as const },
    }
    const imageHtml = renderPagePaintPlanEntryToHtml(
      {
        ...baseEntry,
        maskType: "alpha",
        sources: [{ nodeId: image.id, kind: "image", assetId: image.assetId }],
      },
      new Map<string, SceneNode>([
        [image.id, image],
        [content.id, content],
      ])
    )
    expect(imageHtml).toContain(`data-mask-source-id="${image.id}"`)
    expect(imageHtml).toContain('data-mask-coverage-kind="image"')
    expect(imageHtml).toMatch(
      /<g[^>]+clip-path="url\(#[^"]+-coverage-clip\)"[^>]*>/
    )
    expect(imageHtml).toContain('clipPathUnits="userSpaceOnUse"')
    expect(imageHtml).toMatch(/<image[^>]+preserveAspectRatio="none" \/>/)
    expect(imageHtml).not.toMatch(/<image[^>]+clip-path=/)
    expect(imageHtml).toContain(`data-node-id="${image.id}"`)
    expect(imageHtml).toContain(`data-image-frame-id="${image.id}"`)
    expect(imageHtml).toContain("&quot;shape&quot;:&quot;ellipse&quot;")
    expect(imageHtml).toContain(`opacity:${image.opacity}`)

    const text = renderConformanceDocument.nodes.find(
      (node) => node.type === "text"
    )!
    const textSource = { ...text, id: "mask-conformance-source" }
    const textHtml = renderPagePaintPlanEntryToHtml(
      {
        ...baseEntry,
        maskType: "alpha",
        sources: [
          {
            nodeId: textSource.id,
            kind: "text",
            fontFamilies: ["Geist Variable", "Inter"],
          },
        ],
      },
      new Map<string, SceneNode>([
        [textSource.id, textSource],
        [content.id, content],
      ])
    )
    expect(textHtml).toContain(`data-mask-source-id="${textSource.id}"`)
    expect(textHtml).toContain('data-mask-coverage-kind="html"')
    expect(textHtml).toContain(`data-node-id="${textSource.id}"`)
    expect(textHtml).toContain(`data-mask-font-source-node="${textSource.id}"`)
    expect(textHtml).toContain(
      'data-mask-font-families="[&quot;Geist Variable&quot;,&quot;Inter&quot;]"'
    )
    expect(textHtml).toContain("font-family:Geist Variable,sans-serif")
    expect(textHtml).toContain(`opacity:${textSource.opacity}`)
  })

  it("falls through to canonical content without an ordinary hidden mask source", () => {
    const entry = maskRenderConformanceHiddenSourcePlan.entries[1]
    if (!entry || entry.kind !== "mask_group") {
      throw new Error("Missing retained hidden-source mask group")
    }
    const maskHtml = renderPagePaintPlanEntryToHtml(
      entry,
      new Map(
        maskRenderConformanceHiddenSourceNodes.map((node) => [node.id, node])
      )
    )
    const content = maskRenderConformanceHiddenSourceNodes[2]
    const source = maskRenderConformanceHiddenSourceNodes[1]

    expect(maskHtml).toContain('data-mask-enabled="false"')
    expect(maskHtml).toContain('data-mask-composite="false"')
    expect(maskHtml).not.toContain("<mask ")
    expect(maskHtml).toContain(`data-node-id="${content.id}"`)
    expect(maskHtml).not.toContain(`data-node-id="${source.id}"`)
    expect(maskHtml).not.toContain(`data-mask-source-id="${source.id}"`)
  })

  it("serializes every component semantic case into the shared HTML/PDF source", () => {
    const html = renderOutputToHtml(
      componentRenderConformanceDocument,
      "component-render-output"
    )
    const nodesById = new Map(
      componentRenderConformanceDocument.nodes.map((node) => [node.id, node])
    )

    for (const fixture of componentRenderConformanceCases) {
      for (const nodeId of fixture.nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node || node.type !== "rect") throw new Error(`Missing ${nodeId}`)
        expect(html).toContain(`data-node-id="${node.id}"`)
        expect(html).toContain(`left:${node.x}px`)
        expect(html).toContain(`top:${node.y}px`)
        expect(html).toContain(`width:${node.width}px`)
        expect(html).toContain(`height:${node.height}px`)
        expect(html).toContain(`background:${node.fill}`)
        expect(html).toContain(`opacity:${node.opacity}`)
        expect(html).toContain(`transform:rotate(${node.rotation}deg)`)
      }
    }
    expect(html).toContain("input.fonts.load(")
  })

  it("serializes the same resolved style and variable values used by the editor", () => {
    const properties = renderDocumentToHtml(
      textDesignSystemConformanceDocument,
      "properties-page"
    )
    const longText = renderDocumentToHtml(
      textDesignSystemConformanceDocument,
      "long-text-page"
    )
    const square = renderDocumentToHtml(
      textDesignSystemConformanceDocument,
      "square-page"
    )

    expect(properties).toContain('data-node-id="rect-stroke-radius"')
    expect(properties).toContain("background:#0f766e")
    expect(properties).toContain("border-radius:32px")
    expect(properties).toContain("opacity:0.63")
    expect(longText).toContain("font-family:Geist Variable,sans-serif")
    expect(longText).toContain("font-size:22px")
    expect(longText).toContain("font-weight:510")
    expect(longText).toContain("font-style:italic")
    expect(square).toContain("UPDATED LABEL")
  })

  it("scales thumbnail markup into the exact low-resolution viewport", () => {
    const html = renderDocumentThumbnailToHtml(northstarSeed, "cover", {
      width: 124,
      height: 175,
    })

    expect(html).toContain('data-thumbnail-width="124"')
    expect(html).toContain('data-thumbnail-height="175"')
    expect(html).toContain("width:124px;height:175px;overflow:hidden")
    expect(html).toContain("transform:scale(0.1)")
    expect(html).toContain('data-source-width="1240"')
    expect(html).toContain('data-source-height="1754"')
    expect(html).not.toContain(
      "width:1240px;height:1754px;overflow:hidden}body"
    )
  })

  it("marks ready only after the managed font and every image decode", async () => {
    const fixture = renderResourceFixture()
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-ready")).toBe("true")
    expect(fixture.attributes.has("data-render-error")).toBe(false)
    expect(fixture.fontLoads).toEqual([
      { query: '16px "Geist Variable"', text: "WebMCP" },
    ])
    expect(fixture.fontChecks).toEqual([
      { query: '16px "Geist Variable"', text: "WebMCP" },
    ])
    expect(fixture.imageDecodeCalls).toBe(1)
  })

  it("marks an exact managed-font failure instead of accepting fallback", async () => {
    const fixture = renderResourceFixture({
      fontStatus: "error",
      fontRequirements: [
        {
          nodeId: "alpha-text-source",
          fontFamilies: ["Geist Variable"],
        },
      ],
    })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "managed_font_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe(
      "alpha-text-source"
    )
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("attributes a failed luminance conversion before declaring output ready", async () => {
    const fixture = renderResourceFixture({
      luminanceSourceNodeIds: ["luminance-source-a", "luminance-source-b"],
      luminanceConversionReady: false,
    })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "luminance_conversion_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe(
      "luminance-source-a"
    )
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("proves the production SVG filter coefficients, alpha, and overlap in Chrome pixels", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true })
    try {
      const page = await browser.newPage()
      expect(await page.evaluate(verifyBrowserLuminanceConversion)).toBe(true)
    } finally {
      await browser.close()
    }
  }, 20_000)

  it("loads every base and run font required by an alpha text source", async () => {
    const fixture = renderResourceFixture({
      fontRequirements: [
        {
          nodeId: "alpha-text-source",
          fontFamilies: ["Geist Variable", "Inter"],
        },
      ],
    })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.fontLoads).toEqual([
      { query: '16px "Geist Variable"', text: "WebMCP" },
      { query: '16px "Inter"', text: "WebMCP" },
    ])
    expect(fixture.fontChecks).toEqual([
      { query: '16px "Geist Variable"', text: "WebMCP" },
      { query: '16px "Inter"', text: "WebMCP" },
    ])
    expect(fixture.attributes.get("data-render-ready")).toBe("true")
  })

  it("marks a managed-font load rejection before decoding images", async () => {
    const fixture = renderResourceFixture({ fontLoadRejects: true })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "managed_font_failed"
    )
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
    expect(fixture.imageDecodeCalls).toBe(0)
  })

  it("marks the corrupt image node instead of accepting blank output", async () => {
    const fixture = renderResourceFixture({ imageRejects: true })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "image_decode_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe("hero-image")
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("marks the exact image node when projection fails after decode", async () => {
    const fixture = renderResourceFixture({ projectionRejects: true })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "image_projection_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe("hero-image")
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("applies the canonical manual affine before declaring resources ready", async () => {
    const placement: ImagePlacement = {
      mode: "manual",
      focalX: 0.2,
      focalY: 0.8,
      zoom: 1.7,
      rotation: 33,
      flipX: true,
      flipY: false,
    }
    const fixture = renderResourceFixture({
      imagePlacement: placement,
      imageFrameMask: { shape: "ellipse" },
    })
    await markRenderResourcesReady(fixture.input)

    const expected = projectImagePaint({
      frame: { width: 320, height: 180 },
      naturalSize: { width: 1200, height: 800 },
      placement,
      frameMask: { shape: "ellipse" },
    })
    const affine = expected.sourceToFrame
    expect(fixture.imageStyle.get("transform")).toBe(
      `matrix(${affine.a},${affine.b},${affine.c},${affine.d},${affine.e},${affine.f})`
    )
    expect(fixture.imageStyle.get("width")).toBe("1200px")
    expect(fixture.imageStyle.get("height")).toBe("800px")
    expect(fixture.frameStyle.get("clip-path")).toBe(
      "ellipse(160px 90px at 160px 90px)"
    )
    expect(fixture.attributes.get("data-render-ready")).toBe("true")
  })

  it.each([
    [{ shape: "rectangle" } as const, "inset(0)"],
    [
      { shape: "rounded_rectangle", radius: 0.25 } as const,
      "inset(0 round 45px)",
    ],
    [{ shape: "ellipse" } as const, "ellipse(160px 90px at 160px 90px)"],
  ])("applies the %s frame clip", async (imageFrameMask, expectedClip) => {
    const fixture = renderResourceFixture({ imageFrameMask })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.frameStyle.get("clip-path")).toBe(expectedClip)
    expect(fixture.attributes.get("data-render-ready")).toBe("true")
  })

  it("maps every retained 1x/2x image affine and frame mask into export CSS", async () => {
    for (const fixtureCase of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixtureCase, pixelRatio)
        const fixture = renderResourceFixture({
          imageFrameWidth: input.frame.width,
          imageFrameHeight: input.frame.height,
          imageNaturalWidth: input.naturalSize.width,
          imageNaturalHeight: input.naturalSize.height,
          imagePlacement: input.placement,
          imageFrameMask: input.frameMask,
        })
        await markRenderResourcesReady(fixture.input)

        const expected = projectImagePaint(input)
        const { a, b, c, d, e, f } = expected.sourceToFrame
        expect(fixture.imageStyle.get("transform")).toBe(
          `matrix(${a},${b},${c},${d},${e},${f})`
        )
        expect(fixture.imageStyle.get("width")).toBe(
          `${input.naturalSize.width}px`
        )
        expect(fixture.imageStyle.get("height")).toBe(
          `${input.naturalSize.height}px`
        )
        expect(fixture.frameStyle.get("clip-path")).toBe(
          expected.clip.shape === "ellipse"
            ? `ellipse(${expected.clip.radiusX}px ${expected.clip.radiusY}px at ${expected.clip.centerX}px ${expected.clip.centerY}px)`
            : expected.clip.shape === "rounded_rectangle"
              ? `inset(0 round ${expected.clip.radius}px)`
              : "inset(0)"
        )
        expect(fixture.attributes.get("data-render-ready")).toBe("true")
      }
    }
  })

  it("retains placement and frame-mask inputs in PNG/PDF HTML structure", () => {
    for (const fixture of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixture, pixelRatio)
        const markup = renderNodeToHtml(
          imageRenderParityNode(fixture, pixelRatio)
        )
        expect(markup).toContain(
          `data-image-frame-width="${input.frame.width}"`
        )
        expect(markup).toContain(
          `data-image-frame-height="${input.frame.height}"`
        )
        expect(markup).toContain("data-image-placement=")
        expect(markup).toContain("data-image-frame-mask=")
        expect(markup).toContain(
          input.frameMask.shape === "rounded_rectangle"
            ? "rounded_rectangle"
            : input.frameMask.shape
        )
      }
    }

    const pdfMarkup = renderOutputToHtml(
      imageRenderParityDocument,
      "image-parity-output"
    )
    for (const node of imageRenderParityDocument.nodes) {
      expect(pdfMarkup).toContain(`data-node-id="${node.id}"`)
    }
    for (const page of imageRenderParityDocument.pages) {
      const pngMarkup = renderDocumentToHtml(imageRenderParityDocument, page.id)
      expect(pngMarkup).toContain(`data-page-id="${page.id}"`)
      expect(pngMarkup).toContain(`data-node-id="${page.nodeIds[0]}"`)
    }
  })

  it("keeps the serialized browser projector equal to canonical randomized projections", () => {
    const runtimeProjector = Function(
      `"use strict";return ${serializeImagePaintProjector()}`
    )() as (input: ImagePaintProjectionInput) => RenderImagePaintProjection
    let state = 0x6d2b79f5
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 0x1_0000_0000
    }

    for (let index = 0; index < 250; index += 1) {
      const maskChoice = index % 3
      const input: ImagePaintProjectionInput = {
        frame: {
          width: 24 + random() * 1_976,
          height: 24 + random() * 1_976,
        },
        naturalSize: {
          width: 1 + random() * 5_999,
          height: 1 + random() * 5_999,
        },
        placement: {
          mode: (["fill", "fit", "manual"] as const)[index % 3],
          focalX: random(),
          focalY: random(),
          zoom: 0.05 + random() * 8,
          rotation: -180 + random() * 360,
          flipX: random() > 0.5,
          flipY: random() > 0.5,
        },
        frameMask:
          maskChoice === 0
            ? { shape: "rectangle" }
            : maskChoice === 1
              ? { shape: "rounded_rectangle", radius: random() * 0.5 }
              : { shape: "ellipse" },
      }

      expect(runtimeProjector(input)).toEqual(projectImagePaint(input))
    }
  })

  it("renders canonical nodes without a Fabric dependency", () => {
    const html = renderDocumentToHtml(northstarSeed, "cover")
    expect(html).toContain('data-node-id="cover-title"')
    expect(html).toContain("Aditi &amp; Kabir")
    expect(html).toContain("width:1240px")
  })

  it("keeps shape markup and rotation origin consistent with the editor", () => {
    const nodes: SceneNode[] = [
      {
        id: "test-ellipse",
        type: "ellipse",
        name: "Ellipse",
        x: 40,
        y: 50,
        width: 200,
        height: 160,
        rotation: 12,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#d9c9b2",
        stroke: "#1e2622",
        strokeWidth: 3,
      },
      {
        id: "test-line",
        type: "line",
        name: "Line",
        x: 60,
        y: 80,
        width: 320,
        height: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        stroke: "#1e2622",
        strokeWidth: 4,
      },
      {
        id: "test-icon",
        type: "icon",
        name: "Heart",
        x: 100,
        y: 120,
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        path: "M12 21 3 12 12 3 21 12Z",
        viewBox: "0 0 24 24",
        fill: "#8a5d38",
        strokeWidth: 0,
      },
    ]
    const document = nodes.reduce(
      (current, node, index) =>
        applyCommand(current, {
          id: `cmd-render-primitive-${index}`,
          type: "add_node",
          actor: "human",
          at: "2026-08-26T09:30:00.000Z",
          pageId: "cover",
          node,
        }),
      northstarSeed
    )

    const html = renderDocumentToHtml(document, "cover")
    expect(html).toContain('data-node-id="test-ellipse"')
    expect(html).toContain("border-radius:50%")
    expect(html).toContain('data-node-id="test-line"')
    expect(html).toContain('stroke-width="4"')
    expect(html).toContain('data-node-id="test-icon"')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain("transform-origin:top left")
  })

  it("renders image placement, frame clipping, and alternative text", () => {
    const document = applyCommand(northstarSeed, {
      id: "cmd-render-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: {
        id: "test-image",
        type: "image",
        name: "Editorial image",
        assetId: "asset-one",
        src: "https://example.com/image.jpg",
        alt: "Sandstone arches",
        placement: {
          mode: "fit",
          focalX: 0.25,
          focalY: 0.75,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rounded_rectangle", radius: 0.25 },
        decorative: false,
        x: 100,
        y: 120,
        width: 640,
        height: 480,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    })

    const html = renderDocumentToHtml(document, "cover")
    expect(html).toContain('alt="Sandstone arches"')
    expect(html).toContain('data-image-frame-width="640"')
    expect(html).toContain('data-image-frame-height="480"')
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fit&quot;'
    )
    expect(html).toContain(
      'data-image-frame-mask="{&quot;shape&quot;:&quot;rounded_rectangle&quot;,&quot;radius&quot;:0.25}"'
    )
    expect(html).toContain("projectImagePaint:")
    expect(html).toContain("image.style.setProperty")
    expect(html).not.toContain("object-fit")
  })

  it("renders every output page in canonical order for mixed-size PDFs", () => {
    const html = renderOutputToHtml(northstarSeed, "proposal")

    expect(html).toContain("@page studio-page-0{size:1240px 1754px;margin:0}")
    expect(html).toContain('data-page-id="cover"')
    expect(html).toContain('data-page-id="story"')
    expect(html).toContain('data-page-id="terms"')
    expect(html.indexOf('data-page-id="cover"')).toBeLessThan(
      html.indexOf('data-page-id="story"')
    )
    expect(html).toContain("break-after:page")
    expect(html).toContain("print-color-adjust:exact")
    expect(html).not.toContain('data-page-id="whatsapp-card"')
  })

  it("keeps canonical typography and stroke values in export HTML", () => {
    const withTypography = applyCommand(northstarSeed, {
      id: "cmd-render-typography",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      nodeId: "cover-title",
      patch: { lineHeight: 1.04, letterSpacing: -1.2 },
    })
    const document = applyCommand(withTypography, {
      id: "cmd-render-stroke",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      nodeId: "cover-panel",
      patch: { stroke: "#ffffff", strokeWidth: 3 },
    })
    const html = renderDocumentToHtml(document, "cover")

    expect(html).toContain("line-height:1.04")
    expect(html).toContain("letter-spacing:-1.2px")
    expect(html).toContain("text-rendering:geometricPrecision")
    expect(html).toContain("-webkit-font-smoothing:antialiased")
    expect(html).toContain("font-weight:600")
    expect(html).toContain("border:3px solid #ffffff")
    expect(html).toContain('@font-face{font-family:"Geist Variable"')
    const embeddedFont = html.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/)
    expect(embeddedFont?.[1]).toHaveLength(39_200)
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//)
    expect(html).toContain("input.fonts.load(")
    expect(html).toContain("input.fonts.check(")
    expect(html).toMatch(/face\.status\s*===\s*"loaded"/)
    expect(html).toMatch(/await\s+image\.decode\(\)/)
    expect(html).toContain("image.naturalWidth <= 0")
    expect(html).toContain("image.naturalHeight <= 0")
    expect(html).toContain("data-render-error")
    expect(html).toContain("data-render-ready")
  })

  it("serializes every golden projection without dropping render properties", () => {
    for (const node of renderConformanceDocument.nodes) {
      const markup = renderNodeToHtml(node)
      expect(markup).toContain(`data-node-id="${node.id}"`)
      expect(markup).toContain(`data-node-locked="${node.locked}"`)
      expect(markup).toContain(`left:${node.x}px`)
      expect(markup).toContain(`top:${node.y}px`)
      expect(markup).toContain(`width:${node.width}px`)
      expect(markup).toContain(`height:${node.height}px`)
      expect(markup).toContain(`opacity:${node.opacity}`)
      expect(markup).toContain(`transform:rotate(${node.rotation}deg)`)
      expect(markup).toContain(`display:${node.visible ? "block" : "none"}`)
      expect(markup).toContain("box-sizing:border-box")
    }
  })

  it("preserves whitespace, icon viewport, image crop, and shape border policy", () => {
    const html = renderDocumentToHtml(
      renderConformanceDocument,
      "properties-page"
    )
    expect(html).toContain("white-space:pre")
    expect(html).toContain('data-text-sizing-mode="fixed"')
    expect(html).toContain('data-text-measurement="managed_font_rich_text_v2"')
    expect(html).toMatch(/data-text-line-count="[1-9][0-9]*"/)
    expect(html).toMatch(/data-text-overflow="(?:true|false)"/)
    expect(html).toMatch(/data-text-overflow-x="(?:true|false)"/)
    expect(html).toMatch(/data-text-overflow-y="(?:true|false)"/)
    expect(html).toContain("overflow-wrap:normal")
    expect(html).toContain("overflow:hidden")
    const textNode = renderConformanceDocument.nodes.find(
      (node) => node.id === "text-typography"
    )!
    const textProjection = projectNodeForRender(textNode)
    if (textProjection.type !== "text") throw new Error("Expected text")
    for (const line of textProjection.content.layout.lines) {
      for (const segment of line.segments) {
        expect(html).toContain(segment.text)
      }
    }
    expect(textProjection.content.displayText).not.toBe(
      textProjection.content.text
    )
    expect(html).not.toContain(textProjection.content.text)
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(html).toContain('data-image-frame-id="image-cover"')
    expect(html).toContain('data-image-frame-id="image-contain"')
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fill&quot;,&quot;focalX&quot;:0.2,&quot;focalY&quot;:0.8'
    )
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fit&quot;,&quot;focalX&quot;:0.8,&quot;focalY&quot;:0.1'
    )
    expect(html).toContain("border-radius:24px;border:8px solid #92400e")
    expect(html).toContain("border-radius:50%;border:5px solid #1d4ed8")
  })

  it("serializes mixed character styles, paragraph alignment and safe links", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const node: SceneNode = {
      ...source,
      text: "Bold link",
      width: 500,
      sizingMode: "auto_width",
      runs: [
        {
          start: 0,
          end: 4,
          style: {
            color: "#dc2626",
            fontSize: 36,
            fontWeight: 700,
            italic: true,
            decoration: "underline",
            letterSpacing: 1,
          },
        },
      ],
      paragraphs: [{ start: 0, end: 9, style: { align: "center" } }],
      links: [
        {
          start: 5,
          end: 9,
          target: "https://example.com/path?a=1&b=2",
          newTab: true,
        },
      ],
    }

    const markup = renderNodeToHtml(node)

    expect(markup).toContain('data-text-line="0"')
    expect(markup).toContain("text-align:center")
    expect(markup).toContain("color:#dc2626")
    expect(markup).toContain("font-size:36px")
    expect(markup).toContain("font-style:italic")
    expect(markup).toContain("text-decoration-line:underline")
    expect(markup).toContain(
      'href="https://example.com/path?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"'
    )
    expect(markup).toContain(
      'data-text-source-start="5" data-text-source-end="9"'
    )
  })

  it("serializes a 1,000-run unbroken token with one late wrap", () => {
    const node = createAdverseRichTextConformanceNode()

    const startedAt = performance.now()
    const html = renderNodeToHtml(node)
    const elapsed = performance.now() - startedAt

    expect(html.match(/data-text-line=/g)).toHaveLength(2)
    expect(html.match(/data-text-source-start=/g)).toHaveLength(1_001)
    expect(html.length).toBeLessThan(500_000)
    expect(elapsed).toBeLessThan(250)
  })

  it("serializes auto-height sizing separately from fixed overflow", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const autoHeight: SceneNode = {
      ...source,
      id: "auto-height-text",
      sizingMode: "auto_height",
      height: 400,
    }
    const markup = renderNodeToHtml(autoHeight)

    expect(markup).toContain('data-text-sizing-mode="auto_height"')
    expect(markup).toContain('data-text-overflow="false"')
    expect(markup).toContain("overflow:visible")
  })

  it("keeps mixed-size output order and page rules deterministic", () => {
    const html = renderOutputToHtml(renderConformanceDocument, "mixed-document")
    expect(html).toContain("@page studio-page-0{size:720px 960px;margin:0}")
    expect(html).toContain("@page studio-page-1{size:640px 360px;margin:0}")
    expect(html.indexOf('data-page-id="properties-page"')).toBeLessThan(
      html.indexOf('data-page-id="long-text-page"')
    )
    expect(html).not.toContain('data-page-id="square-page"')
  })
})
