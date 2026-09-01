import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  componentRenderConformanceCases,
  componentRenderConformanceDocument,
  createAdverseRichTextConformanceNode,
  imageRenderParityCases,
  imageRenderParityInput,
  imageRenderParityNode,
  imageRenderParityPixelRatios,
  northstarSeed,
  projectImagePaint,
  projectNodeForRender,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  type Document,
  type SceneNode,
} from "@webmcp/document"
import {
  maskRenderConformanceDocument,
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
  createAlphaImageMaskCommitState,
  Artboard,
  createImageResourceLoadState,
  alphaMaskGroupRenderModel,
  luminanceMaskGroupRenderModel,
  decodedImageNaturalSizeForSource,
  imageResourceIdentity,
  imageResourceStateChangeForFailure,
  imageResourceStateChangeForLoad,
  MaskGroupPaintEntry,
  maskGroupRenderModel,
  reduceAlphaImageMaskCommitState,
  reduceImageResourceLoadState,
  renderViewDevicePixelRatio,
  renderFrameStyle,
  renderImageFrameMaskStyle,
  renderImagePaintStyle,
  renderMaskGroupWrapperStyle,
  renderNodeDataAttributes,
  renderNodeStyle,
  renderTextLineStyle,
  renderTextSegmentStyle,
  renderVectorMaskSourceAttributes,
  shouldCompositeMaskGroup,
  luminanceConversionProbePixelsPass,
  srgbLuminanceMaskAlpha,
  unionMaskAlphas,
} from "../src"

function nestedMaskDocument(options: { hiddenChildSource?: boolean } = {}) {
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
        visible: !options.hiddenChildSource,
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
        mask: { type: "alpha" as const, sourceNodeIds: ["child-source"] },
      },
    ],
  }
}

describe("React render-view conformance", () => {
  it("wraps clipped frame children at canonical page-space bounds", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    const childId = "cover-title"
    page.nodeIds = [
      "react-layout-frame",
      childId,
      ...page.nodeIds.filter((nodeId) => nodeId !== childId),
    ]
    document.nodes.push({
      id: "react-layout-frame",
      type: "frame",
      name: "React layout frame",
      x: 90,
      y: 70,
      width: 300,
      height: 150,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#fff",
      radius: 14,
      strokeWidth: 0,
      children: [
        {
          nodeId: childId,
          positioning: "absolute",
          horizontalSizing: "fixed",
          verticalSizing: "fixed",
          offsetX: -20,
          offsetY: -10,
          grow: 0,
        },
      ],
      autoLayout: null,
      clipsContent: true,
    })

    const markup = renderToStaticMarkup(
      createElement(Artboard, { document, pageId: page.id })
    )

    expect(markup).toContain(`data-frame-clip-node-id="${childId}"`)
    expect(markup).toContain("overflow:hidden")
    expect(markup).toContain("border-radius:14px")
  })

  it("preserves frame clipping inside a retained mask subtree", () => {
    const document = structuredClone(nestedMaskDocument()) as Document
    const page = document.pages[0]!
    page.nodeIds.unshift("masked-content-frame")
    document.nodes.push({
      id: "masked-content-frame",
      type: "frame",
      name: "Masked content frame",
      x: 110,
      y: 0,
      width: 24,
      height: 24,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "transparent",
      radius: 4,
      strokeWidth: 0,
      children: [
        {
          nodeId: "child-content",
          positioning: "absolute",
          horizontalSizing: "fixed",
          verticalSizing: "fixed",
          offsetX: 10,
          offsetY: 10,
          grow: 0,
        },
      ],
      autoLayout: null,
      clipsContent: true,
    })

    const markup = renderToStaticMarkup(
      createElement(Artboard, { document, pageId: page.id })
    )

    expect(markup).toContain('data-mask-group-id="child-mask"')
    expect(markup).toContain('data-frame-clip-node-id="child-content"')
  })

  it("caps a 3x host at the shared 2x mask ratio", () => {
    vi.stubGlobal("devicePixelRatio", 3)
    expect(renderViewDevicePixelRatio()).toBe(2)
    vi.unstubAllGlobals()
  })
  it("consumes the shared Gate M0 vector-mask plan with bounded top-left geometry", () => {
    const nodesById = new Map(
      maskRenderConformanceNodes.map((node) => [node.id, node])
    )
    const entry = maskRenderConformancePlan.entries[1]!
    const model = maskGroupRenderModel(entry, nodesById)

    expect(
      model.content.map((contentEntry) =>
        contentEntry.kind === "node"
          ? contentEntry.nodeId
          : contentEntry.groupId
      )
    ).toEqual(
      entry.kind === "mask_group"
        ? entry.content.map((contentEntry) => contentEntry.nodeId)
        : []
    )
    expect(model.content).not.toContainEqual({
      kind: "node",
      nodeId: model.source.id,
    })
    expect(renderMaskGroupWrapperStyle(model.entry.bounds)).toEqual({
      position: "absolute",
      left: model.entry.bounds.x,
      top: model.entry.bounds.y,
      width: model.entry.bounds.width,
      height: model.entry.bounds.height,
      overflow: "hidden",
    })
    const source = renderVectorMaskSourceAttributes(
      model.source,
      model.entry.bounds
    )
    expect(source).toMatchObject({
      fill: "white",
      opacity: model.source.opacity,
      x: model.source.x - model.entry.bounds.x,
      y: model.source.y - model.entry.bounds.y,
      transform: `rotate(${model.source.rotation} ${model.source.x - model.entry.bounds.x} ${model.source.y - model.entry.bounds.y})`,
    })
    expect(shouldCompositeMaskGroup(entry)).toBe(true)
  })

  it("blends retained mask content before the vector mask is applied", () => {
    const entry = maskRenderConformancePlan.entries[1]!
    if (entry.kind !== "mask_group") throw new Error("Missing mask entry")
    const nodesById = new Map(
      maskRenderConformanceNodes.map((node) => [
        node.id,
        node.id === "mask-conformance-content"
          ? { ...node, blendMode: "multiply" as const }
          : node,
      ])
    )
    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, { entry, nodesById })
    )

    expect(markup).toContain("mix-blend-mode:multiply")
    expect(markup).toContain('data-mask-source-id="mask-conformance-source"')
    expect(markup.match(/mix-blend-mode:multiply/g)).toHaveLength(1)
  })

  it("falls through to ordinary bounded content when the shared source is hidden", () => {
    const entry = maskRenderConformanceHiddenSourcePlan.entries[1]!
    expect(entry).toMatchObject({
      kind: "mask_group",
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
    })
    expect(shouldCompositeMaskGroup(entry)).toBe(false)
  })

  it("renders a nested mask subtree in canonical order and page-local coordinates", () => {
    const document = nestedMaskDocument()
    const plan = projectPagePaintPlan(document, document.pages[0]!.id)
    const entry = plan.entries[0]!
    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry,
        nodesById: new Map(document.nodes.map((node) => [node.id, node])),
      })
    )

    expect(markup.match(/data-mask-group-id=/g)).toHaveLength(2)
    expect(markup.indexOf('data-mask-group-id="outer-mask"')).toBeLessThan(
      markup.indexOf('data-mask-group-id="child-mask"')
    )
    expect(markup).toContain("left:-100px;top:0;width:240px;height:30px")
    expect(markup).toContain("left:100px;top:0;width:100%;height:100%")
    expect(markup.indexOf('data-node-id="child-content"')).toBeLessThan(
      markup.indexOf('data-node-id="outer-content"')
    )
    expect(markup).not.toContain('data-node-id="child-source"')
    expect(markup).toContain('data-mask-source-id="child-source"')
    expect(markup.match(/<mask /g)).toHaveLength(2)
  })

  it("holds the outer subtree behind one descendant image readiness boundary", () => {
    const document = nestedMaskDocument()
    const plan = projectPagePaintPlan(document, document.pages[0]!.id)
    const outer = plan.entries[0]!
    if (outer.kind !== "mask_group") throw new Error("Missing outer mask")
    const child = outer.content[0]!
    if (child.kind !== "mask_group") throw new Error("Missing child mask")
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "child-source",
      name: "Nested image source",
    }
    const entry = {
      ...outer,
      content: [
        {
          ...child,
          maskType: "alpha" as const,
          sources: [
            {
              nodeId: image.id,
              kind: "image" as const,
              assetId: image.assetId,
            },
          ],
        },
        ...outer.content.slice(1),
      ],
    }
    const nodesById = new Map(
      document.nodes.map((node) => [
        node.id,
        node.id === image.id ? image : node,
      ])
    )

    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, { entry, nodesById })
    )

    expect(markup).toContain('data-mask-group-id="outer-mask"')
    expect(markup).toContain('data-mask-resource-state="loading"')
    expect(markup).toContain('data-alpha-mask-resource-probe="child-source"')
    expect(markup).not.toContain('data-mask-group-id="child-mask"')
    expect(markup.match(/data-alpha-mask-resource-probe=/g)).toHaveLength(1)
  })

  it("aggregates descendant font and luminance readiness at the outer boundary", () => {
    const document = nestedMaskDocument()
    const plan = projectPagePaintPlan(document, document.pages[0]!.id)
    const outer = plan.entries[0]!
    if (outer.kind !== "mask_group") throw new Error("Missing outer mask")
    const child = outer.content[0]!
    if (child.kind !== "mask_group") throw new Error("Missing child mask")
    const text = renderConformanceDocument.nodes.find(
      (node): node is Extract<SceneNode, { type: "text" }> =>
        node.type === "text"
    )!
    const textContent = {
      ...text,
      id: "child-content",
      name: "Nested text content",
      x: 120,
      y: 10,
      width: 20,
      height: 20,
    }
    const textMarkup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry: outer,
        nodesById: new Map(
          document.nodes.map((node) => [
            node.id,
            node.id === textContent.id ? textContent : node,
          ])
        ),
      })
    )
    expect(textMarkup).toContain('data-mask-resource-state="loading"')
    expect(textMarkup).toContain(
      'data-mask-font-resource-probe="child-content"'
    )
    expect(textMarkup).not.toContain('data-mask-group-id="child-mask"')

    const luminanceEntry = {
      ...outer,
      content: [
        { ...child, maskType: "luminance" as const },
        ...outer.content.slice(1),
      ],
    }
    const luminanceMarkup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry: luminanceEntry,
        nodesById: new Map(document.nodes.map((node) => [node.id, node])),
      })
    )
    expect(luminanceMarkup).toContain('data-mask-resource-state="loading"')
    expect(luminanceMarkup).toContain(
      'data-luminance-conversion-probe="child-source"'
    )
    expect(luminanceMarkup).not.toContain('data-mask-group-id="child-mask"')
  })

  it("keeps the committed outer model and attributes a failed descendant candidate", () => {
    const document = nestedMaskDocument()
    const outer = projectPagePaintPlan(document, document.pages[0]!.id)
      .entries[0]!
    const model = maskGroupRenderModel(
      outer,
      new Map(document.nodes.map((node) => [node.id, node]))
    )
    const committed = reduceAlphaImageMaskCommitState(
      createAlphaImageMaskCommitState("outer-a", model, ["image-a"]),
      {
        type: "ready",
        identity: "outer-a",
        resourceIdentity: "image-a",
      }
    )
    const replacing = reduceAlphaImageMaskCommitState(committed, {
      type: "request",
      identity: "outer-b",
      model,
      resourceIdentities: ["image-b", "font-b"],
    })
    const failed = reduceAlphaImageMaskCommitState(replacing, {
      type: "failed",
      identity: "outer-b",
      resourceIdentity: "image-b",
      errorCode: "image_load_failed",
      errorNodeId: "child-source",
    })

    expect(failed).toMatchObject({
      status: "error",
      committedIdentity: "outer-a",
      committedModel: model,
      errorCode: "image_load_failed",
      errorNodeId: "child-source",
    })
    expect(
      reduceAlphaImageMaskCommitState(failed, {
        type: "ready",
        identity: "stale-outer",
        resourceIdentity: "image-b",
      })
    ).toBe(failed)
  })

  it("mounts hidden alpha-image fallthrough without allocating its unavailable source", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]!
    if (baseEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-source",
      src: "https://cdn.example.com/unavailable-mask.png",
      visible: false,
    }
    const hiddenAlphaEntry = {
      ...baseEntry,
      maskType: "alpha" as const,
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
      sources: [
        { nodeId: image.id, kind: "image" as const, assetId: image.assetId },
      ],
    }
    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry: hiddenAlphaEntry,
        nodesById: new Map([
          [image.id, image],
          [content.id, content],
        ]),
        showImageRecoveryActions: false,
      })
    )

    expect(markup).toContain(`data-node-id="${content.id}"`)
    expect(markup).not.toContain("data-alpha-mask-resource-probe")
    expect(markup).not.toContain(image.src)
    expect(markup).not.toContain("data-mask-resource-state")
  })

  it("resolves image and text alpha sources through canonical node paint", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]!
    if (baseEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-source",
      opacity: 0.61,
      frameMask: { shape: "ellipse" as const },
    }
    const imageModel = alphaMaskGroupRenderModel(
      {
        ...baseEntry,
        maskType: "alpha",
        sources: [{ nodeId: image.id, kind: "image", assetId: image.assetId }],
      },
      new Map([
        [image.id, image],
        [content.id, content],
      ])
    )
    expect(imageModel.source).toMatchObject({
      type: "image",
      placement: image.placement,
      frameMask: image.frameMask,
      opacity: image.opacity,
    })

    const text = renderConformanceDocument.nodes.find(
      (node) => node.type === "text"
    )!
    const textSource = { ...text, id: "mask-conformance-source" }
    const textModel = alphaMaskGroupRenderModel(
      {
        ...baseEntry,
        maskType: "alpha",
        sources: [
          {
            nodeId: textSource.id,
            kind: "text",
            fontFamilies: ["Geist Variable"],
          },
        ],
      },
      new Map([
        [textSource.id, textSource],
        [content.id, content],
      ])
    )
    expect(textModel.source).toMatchObject({
      type: "text",
      opacity: textSource.opacity,
      text: textSource.text,
    })
  })

  it("keeps the previous alpha-image composite when a replacement fails", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]!
    if (baseEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-source",
    }
    const initialModel = alphaMaskGroupRenderModel(
      { ...baseEntry, maskType: "alpha" },
      new Map([
        [image.id, image],
        [content.id, content],
      ])
    )
    const initialIdentity = imageResourceIdentity(image.id, image.src, 1)
    const ready = reduceAlphaImageMaskCommitState(
      createAlphaImageMaskCommitState(initialIdentity, initialModel),
      { type: "ready", identity: initialIdentity }
    )

    const replacement = { ...image, src: "https://cdn.example.com/missing.png" }
    const replacementModel = alphaMaskGroupRenderModel(
      { ...baseEntry, maskType: "alpha" },
      new Map([
        [replacement.id, replacement],
        [content.id, content],
      ])
    )
    const replacementIdentity = imageResourceIdentity(
      replacement.id,
      replacement.src,
      2
    )
    const loading = reduceAlphaImageMaskCommitState(ready, {
      type: "request",
      identity: replacementIdentity,
      model: replacementModel,
    })
    const failed = reduceAlphaImageMaskCommitState(loading, {
      type: "failed",
      identity: replacementIdentity,
    })

    expect(loading.status).toBe("loading")
    expect(loading.committedModel).toBe(initialModel)
    expect(failed.status).toBe("error")
    expect(failed.committedIdentity).toBe(initialIdentity)
    expect(failed.committedModel).toBe(initialModel)
  })

  it("commits only the exact ready alpha-image replacement", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]!
    if (baseEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const content = maskRenderConformanceNodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const image = {
      ...imageRenderParityNode(imageRenderParityCases[0]!, 1),
      id: "mask-conformance-source",
    }
    const model = alphaMaskGroupRenderModel(
      { ...baseEntry, maskType: "alpha" },
      new Map([
        [image.id, image],
        [content.id, content],
      ])
    )
    const identity = imageResourceIdentity(image.id, image.src, 2)
    const initial = createAlphaImageMaskCommitState(identity, model)

    expect(
      reduceAlphaImageMaskCommitState(initial, {
        type: "ready",
        identity: "stale-resource",
      })
    ).toBe(initial)

    const ready = reduceAlphaImageMaskCommitState(initial, {
      type: "ready",
      identity,
    })
    expect(ready).toMatchObject({
      status: "ready",
      committedIdentity: identity,
      committedModel: model,
    })
  })

  it("keeps the last valid luminance composite and attributes conversion failure", () => {
    const baseEntry = maskRenderConformancePlan.entries[1]!
    if (baseEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const model = luminanceMaskGroupRenderModel(
      { ...baseEntry, maskType: "luminance" },
      new Map(maskRenderConformanceNodes.map((node) => [node.id, node]))
    )
    const ready = reduceAlphaImageMaskCommitState(
      createAlphaImageMaskCommitState("candidate-a", model),
      { type: "ready", identity: "candidate-a" }
    )
    const replacing = reduceAlphaImageMaskCommitState(ready, {
      type: "request",
      identity: "candidate-b",
      model,
      resourceIdentities: ["conversion-b"],
    })
    const failed = reduceAlphaImageMaskCommitState(replacing, {
      type: "failed",
      identity: "candidate-b",
      resourceIdentity: "conversion-b",
      errorCode: "luminance_conversion_failed",
      errorNodeId: model.sources[0]!.id,
    })

    expect(failed).toMatchObject({
      status: "error",
      committedIdentity: "candidate-a",
      committedModel: model,
      errorCode: "luminance_conversion_failed",
      errorNodeId: model.sources[0]!.id,
    })
    expect(
      reduceAlphaImageMaskCommitState(failed, {
        type: "ready",
        identity: "candidate-a",
      })
    ).toBe(failed)
  })

  it("preserves canonical multi-source union order and hidden fallthrough", () => {
    const visibleDocument = multiVectorMaskRenderConformanceDocument
    const visibleEntry = projectPagePaintPlan(
      visibleDocument,
      visibleDocument.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    const visibleModel = maskGroupRenderModel(
      visibleEntry,
      new Map(visibleDocument.nodes.map((node) => [node.id, node]))
    )
    expect(visibleModel.sources.map((source) => source.id)).toEqual(
      visibleEntry.kind === "mask_group" ? visibleEntry.sourceNodeIds : []
    )

    const oneHidden = multiVectorMaskRenderConformanceOneHiddenDocument
    const oneHiddenEntry = projectPagePaintPlan(
      oneHidden,
      oneHidden.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    expect(
      maskGroupRenderModel(
        oneHiddenEntry,
        new Map(oneHidden.nodes.map((node) => [node.id, node]))
      ).sources
    ).toHaveLength(1)

    const allHidden = multiVectorMaskRenderConformanceAllHiddenDocument
    const allHiddenEntry = projectPagePaintPlan(
      allHidden,
      allHidden.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    expect(shouldCompositeMaskGroup(allHiddenEntry)).toBe(false)
    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry: allHiddenEntry,
        nodesById: new Map(allHidden.nodes.map((node) => [node.id, node])),
      })
    )
    expect(markup).toContain('data-node-id="mask-conformance-content"')
    expect(markup).not.toContain("data-mask-source-id")
    expect(markup).not.toContain("data-alpha-mask-resource-probe")
  })

  it("uses the frozen sRGB Y*A coefficients before source-over union", () => {
    expect(srgbLuminanceMaskAlpha(0, 0, 0, 1)).toBe(0)
    expect(srgbLuminanceMaskAlpha(1, 1, 1, 1)).toBe(1)
    expect(srgbLuminanceMaskAlpha(0.5, 0.5, 0.5, 1)).toBeCloseTo(0.5, 10)
    expect(srgbLuminanceMaskAlpha(1, 0, 0, 1)).toBeCloseTo(0.2126, 10)
    expect(srgbLuminanceMaskAlpha(0, 1, 0, 1)).toBeCloseTo(0.7152, 10)
    expect(srgbLuminanceMaskAlpha(0, 0, 1, 1)).toBeCloseTo(0.0722, 10)
    expect(srgbLuminanceMaskAlpha(1, 1, 1, 0)).toBe(0)
    expect(srgbLuminanceMaskAlpha(1, 0, 0, 0.4)).toBeCloseTo(0.2126 * 0.4, 10)
    expect(unionMaskAlphas([0.25, 0.5])).toBeCloseTo(0.625, 10)
    const pixels = new Uint8ClampedArray(9 * 4)
    ;[0, 255, 128, 54, 182, 18, 0, 22, 68].forEach((alpha, index) => {
      pixels[index * 4 + 3] = alpha
    })
    expect(luminanceConversionProbePixelsPass(pixels)).toBe(true)
    pixels[3] = 8
    expect(luminanceConversionProbePixelsPass(pixels)).toBe(false)
  })

  it("isolates and converts each visible luminance source before union", () => {
    const document = multiVectorMaskRenderConformanceDocument
    const vectorEntry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (vectorEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const entry = { ...vectorEntry, maskType: "luminance" as const }
    const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
    const model = luminanceMaskGroupRenderModel(entry, nodesById)
    expect(model.sources.map((source) => source.id)).toEqual(
      entry.sourceNodeIds
    )

    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, { entry, nodesById })
    )
    expect(markup).toContain('data-mask-resource-state="loading"')
    expect(markup).toContain("data-luminance-conversion-probe")
    expect(markup).not.toContain("data-luminance-source-isolation")
  })

  it("falls through an all-hidden luminance relation without filters or sources", () => {
    const document = multiVectorMaskRenderConformanceAllHiddenDocument
    const vectorEntry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (vectorEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const entry = { ...vectorEntry, maskType: "luminance" as const }
    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, {
        entry,
        nodesById: new Map(document.nodes.map((node) => [node.id, node])),
      })
    )
    expect(markup).toContain('data-node-id="mask-conformance-content"')
    expect(markup).not.toContain("luminanceToAlpha")
    expect(markup).not.toContain("data-mask-source-id")
    expect(markup).not.toContain("data-alpha-mask-resource-probe")
  })

  it("keeps luminance image sources behind the existing atomic readiness barrier", () => {
    const document = multiAlphaMaskRenderConformanceDocument
    const alphaEntry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((entry) => entry.kind === "mask_group")!
    if (alphaEntry.kind !== "mask_group") throw new Error("Missing mask entry")
    const entry = { ...alphaEntry, maskType: "luminance" as const }
    const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
    const model = luminanceMaskGroupRenderModel(entry, nodesById)
    expect(model.sources.map((source) => source.type)).toEqual([
      "image",
      "image",
      "text",
    ])

    const markup = renderToStaticMarkup(
      createElement(MaskGroupPaintEntry, { entry, nodesById })
    )
    expect(markup).toContain('data-mask-resource-state="loading"')
    expect(markup.match(/data-alpha-mask-resource-probe=/g)).toHaveLength(2)
    expect(markup).not.toContain("luminanceToAlpha")
    expect(markup).not.toContain("data-luminance-source-isolation")
  })

  it("commits a multi-image/text alpha union only after every image is ready", () => {
    const document = multiAlphaMaskRenderConformanceDocument
    const entry = projectPagePaintPlan(
      document,
      document.pages[0]!.id
    ).entries.find((candidate) => candidate.kind === "mask_group")!
    const model = alphaMaskGroupRenderModel(
      entry,
      new Map(document.nodes.map((node) => [node.id, node]))
    )
    const imageIdentities = model.sources.flatMap((source) =>
      source.type === "image"
        ? [imageResourceIdentity(source.id, source.src, 1)]
        : []
    )
    const identity = JSON.stringify(imageIdentities)
    const initial = createAlphaImageMaskCommitState(
      identity,
      model,
      imageIdentities
    )
    const firstReady = reduceAlphaImageMaskCommitState(initial, {
      type: "ready",
      identity,
      resourceIdentity: imageIdentities[0],
    })
    expect(firstReady.status).toBe("loading")
    expect(firstReady.committedModel).toBeNull()
    const failed = reduceAlphaImageMaskCommitState(firstReady, {
      type: "failed",
      identity,
      resourceIdentity: imageIdentities[1],
    })
    expect(failed.status).toBe("error")
    expect(failed.committedModel).toBeNull()
    const ready = reduceAlphaImageMaskCommitState(firstReady, {
      type: "ready",
      identity,
      resourceIdentity: imageIdentities[1],
    })
    expect(ready.status).toBe("ready")
    expect(ready.committedModel).toBe(model)
    expect(model.sources.at(-1)?.type).toBe("text")
  })

  it("renders every component semantic case from its materialized ordinary nodes", () => {
    const nodesById = new Map(
      componentRenderConformanceDocument.nodes.map((node) => [node.id, node])
    )
    for (const fixture of componentRenderConformanceCases) {
      for (const nodeId of fixture.nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node || node.type !== "rect") throw new Error(`Missing ${nodeId}`)
        expect(renderNodeStyle(projectNodeForRender(node))).toMatchObject({
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          opacity: node.opacity,
          transform: `rotate(${node.rotation}deg)`,
          background: node.fill,
          borderRadius: node.radius,
          border: `${node.strokeWidth}px solid ${node.stroke}`,
        })
      }
    }
  })

  it("renders resource-bound values without consulting editor state", () => {
    const panel = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const label = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "auto-width-label"
    )!
    const body = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "long-text-only"
    )!
    const mixedText = textDesignSystemConformanceDocument.nodes.find(
      (node) => node.id === "text-typography"
    )!

    expect(renderNodeStyle(projectNodeForRender(panel))).toMatchObject({
      background: "#0f766e",
      borderRadius: 32,
      opacity: 0.63,
    })
    expect(renderNodeStyle(projectNodeForRender(label))).toMatchObject({
      width: label.width,
      height: label.height,
    })
    const bodyProjection = projectNodeForRender(body)
    expect(renderNodeStyle(bodyProjection)).toMatchObject({
      fontFamily: "Geist Variable, sans-serif",
      fontSize: 22,
      fontWeight: 510,
      lineHeight: 1.25,
      letterSpacing: 1.3,
    })
    if (bodyProjection.type !== "text") throw new Error("Missing body text")
    const firstLine = bodyProjection.content.layout.lines[0]!
    expect(
      renderTextSegmentStyle(firstLine.segments[0]!, firstLine)
    ).toMatchObject({
      fontStyle: "italic",
      textDecorationLine: "underline",
    })
    const mixedProjection = projectNodeForRender(mixedText)
    if (mixedProjection.type !== "text") throw new Error("Missing mixed text")
    const rangeLine = mixedProjection.content.layout.lines.find((line) =>
      line.segments.some(
        (segment) => segment.sourceStart === 18 && segment.sourceEnd === 30
      )
    )!
    const rangeSegment = rangeLine.segments.find(
      (segment) => segment.sourceStart === 18 && segment.sourceEnd === 30
    )!
    expect(renderTextSegmentStyle(rangeSegment, rangeLine)).toMatchObject({
      color: "#0e7490",
      textDecorationLine: "line-through",
    })
  })

  it("maps every golden frame to explicit host-independent CSS", () => {
    for (const node of renderConformanceDocument.nodes) {
      const projection = projectNodeForRender(node)
      expect(renderFrameStyle(projection.frame)).toMatchObject({
        position: "absolute",
        boxSizing: "border-box",
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        mixBlendMode: node.blendMode ?? "normal",
        transform: `rotate(${node.rotation}deg)`,
        transformOrigin: "top left",
      })
      expect(renderNodeStyle(projection).display).toBe(
        node.visible ? undefined : "none"
      )
      expect(renderNodeDataAttributes(projection)).toMatchObject({
        "data-node-id": node.id,
        "data-node-locked": node.locked ? "true" : "false",
      })
    }
  })

  it("applies blend mode to the final node frame after opacity", () => {
    const node = {
      ...renderConformanceDocument.nodes[0]!,
      blendMode: "multiply" as const,
    }
    const style = renderFrameStyle(projectNodeForRender(node).frame)
    expect(style).toMatchObject({
      opacity: node.opacity,
      mixBlendMode: "multiply",
    })
  })

  it("mirrors a layer around its own center without moving its frame", () => {
    const node = renderConformanceDocument.nodes[0]!
    const frame = projectNodeForRender({ ...node, flipX: true }).frame

    expect(renderFrameStyle(frame)).toMatchObject({
      left: node.x,
      top: node.y,
      width: node.width,
      height: node.height,
      transform: `rotate(${node.rotation}deg) translate(${node.width / 2}px, ${node.height / 2}px) scale(-1, 1) translate(${-node.width / 2}px, ${-node.height / 2}px)`,
      transformOrigin: "top left",
    })
  })

  it("does not collapse text whitespace or drop typography", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    expect(renderNodeStyle(projectNodeForRender(node))).toMatchObject({
      fontFamily: "Geist Variable, sans-serif",
      fontSize: 28,
      fontWeight: 650,
      lineHeight: 1.35,
      letterSpacing: 2.5,
      textRendering: "geometricPrecision",
      WebkitFontSmoothing: "antialiased",
      textAlign: "right",
      whiteSpace: "pre",
      overflowWrap: "normal",
      overflow: "hidden",
    })
  })

  it("maps mixed-run and paragraph projection to explicit React styles", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const node = {
      ...source,
      text: "Rich text",
      width: 500,
      sizingMode: "auto_width" as const,
      runs: [
        {
          start: 0,
          end: 4,
          style: {
            color: "#dc2626",
            fontSize: 36,
            fontWeight: 700,
            italic: true,
            decoration: "line_through" as const,
          },
        },
      ],
      paragraphs: [{ start: 0, end: 9, style: { align: "center" as const } }],
      links: [],
    }
    const projection = projectNodeForRender(node)
    if (projection.type !== "text") throw new Error("Expected text")
    const line = projection.content.layout.lines[0]!
    const segment = line.segments[0]!

    expect(renderTextLineStyle(line)).toMatchObject({
      display: "block",
      height: line.height,
      lineHeight: `${line.height}px`,
      textAlign: "center",
      whiteSpace: "pre",
    })
    expect(renderTextSegmentStyle(segment, line)).toMatchObject({
      color: "#dc2626",
      fontFamily: "Geist Variable, sans-serif",
      fontSize: 36,
      fontWeight: 700,
      fontStyle: "italic",
      textDecorationLine: "line-through",
      lineHeight: `${line.height}px`,
    })
  })

  it("projects every run in a late-wrapping unbroken token", () => {
    const node = createAdverseRichTextConformanceNode()

    const startedAt = performance.now()
    const projection = projectNodeForRender(node)
    if (projection.type !== "text") throw new Error("Expected text")
    const reactStyles = projection.content.layout.lines.flatMap((line) => [
      renderTextLineStyle(line),
      ...line.segments.map((segment) => renderTextSegmentStyle(segment, line)),
    ])
    const elapsed = performance.now() - startedAt

    expect(projection.content.layout.lines).toHaveLength(2)
    expect(
      projection.content.layout.lines.map((line) => line.sourceEnd)
    ).toEqual([6_301, 7_000])
    expect(
      projection.content.layout.lines.flatMap((line) => line.segments)
    ).toHaveLength(1_001)
    expect(reactStyles).toHaveLength(1_003)
    expect(elapsed).toBeLessThan(250)
  })

  it("makes fixed-box overflow observable without changing its frame", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    const projection = projectNodeForRender(node)
    if (projection.type !== "text") throw new Error("Expected text")

    expect(renderNodeDataAttributes(projection)).toMatchObject({
      "data-text-sizing-mode": "fixed",
      "data-text-measurement": projection.content.layout.measurement,
      "data-text-line-count": projection.content.layout.lineCount,
      "data-text-overflow": projection.content.layout.overflow
        ? "true"
        : "false",
      "data-text-overflow-x": projection.content.layout.overflowX
        ? "true"
        : "false",
      "data-text-overflow-y": projection.content.layout.overflowY
        ? "true"
        : "false",
    })
    expect(renderNodeStyle(projection)).toMatchObject({
      width: node.width,
      height: node.height,
      overflow: "hidden",
    })
  })

  it("uses canonical outer dimensions for bordered shapes", () => {
    const rect = renderConformanceDocument.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const ellipse = renderConformanceDocument.nodes.find(
      (node) => node.id === "ellipse-stroke"
    )!
    expect(renderNodeStyle(projectNodeForRender(rect))).toMatchObject({
      width: 220,
      height: 150,
      background: "#fef3c7",
      border: "8px solid #92400e",
      borderRadius: 24,
      boxSizing: "border-box",
    })
    expect(renderNodeStyle(projectNodeForRender(ellipse))).toMatchObject({
      width: 190,
      height: 120,
      border: "5px solid #1d4ed8",
      borderRadius: "50%",
      boxSizing: "border-box",
    })
  })

  it("projects canonical placement and clips through an overflow-safe frame", () => {
    for (const id of ["image-cover", "image-contain"] as const) {
      const node = renderConformanceDocument.nodes.find(
        (candidate) => candidate.id === id
      )!
      const projection = projectNodeForRender(node)
      if (projection.type !== "image") throw new Error("Expected image")
      expect(renderNodeStyle(projection)).toMatchObject({
        overflow: "hidden",
      })
      expect(projection.content.placement).toEqual(node.placement)
      expect(projection.content.frameMask).toEqual(node.frameMask)
    }
  })

  it("maps every retained 1x/2x image affine and frame mask into React CSS", () => {
    for (const fixture of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixture, pixelRatio)
        const paint = projectImagePaint(input)
        const imageStyle = renderImagePaintStyle(paint, input.naturalSize)
        const affine = paint.sourceToFrame
        expect(imageStyle).toEqual({
          position: "absolute",
          left: 0,
          top: 0,
          width: input.naturalSize.width,
          height: input.naturalSize.height,
          maxWidth: "none",
          maxHeight: "none",
          transform: `matrix(${affine.a}, ${affine.b}, ${affine.c}, ${affine.d}, ${affine.e}, ${affine.f})`,
          transformOrigin: "0 0",
        })

        const maskStyle = renderImageFrameMaskStyle(
          input.frame,
          input.frameMask
        )
        expect(maskStyle).toEqual({
          overflow: "hidden",
          borderRadius:
            paint.clip.shape === "ellipse"
              ? "50%"
              : paint.clip.shape === "rounded_rectangle"
                ? paint.clip.radius
                : undefined,
        })

        const projection = projectNodeForRender(
          imageRenderParityNode(fixture, pixelRatio)
        )
        expect(renderNodeStyle(projection)).toMatchObject(maskStyle)
      }
    }
  })

  it("invalidates decoded dimensions when a persistent image node changes source", () => {
    const decoded = {
      source: "https://cdn.example.com/old-image.jpg",
      width: 1600,
      height: 900,
    }

    expect(decodedImageNaturalSizeForSource(decoded, decoded.source)).toEqual({
      width: 1600,
      height: 900,
    })
    expect(
      decodedImageNaturalSizeForSource(
        decoded,
        "https://cdn.example.com/replacement.jpg"
      )
    ).toBeNull()
  })

  it("gives each source revision an independent React resource identity", () => {
    const oldIdentity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/old-image.jpg"
    )
    const replacementIdentity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/replacement.jpg"
    )

    expect(replacementIdentity).not.toBe(oldIdentity)
    expect(
      imageResourceIdentity(
        "image-node",
        "https://cdn.example.com/replacement.jpg",
        "managed-revision-2"
      )
    ).not.toBe(replacementIdentity)
  })

  it("ignores stale load and error events from replaced sources or attempts", () => {
    const identity = imageResourceIdentity(
      "image-node",
      "https://cdn.example.com/replacement.jpg",
      2
    )
    const initial = createImageResourceLoadState(
      identity,
      "https://cdn.example.com/replacement.jpg"
    )
    const retrying = reduceImageResourceLoadState(initial, { type: "retry" })

    expect(
      reduceImageResourceLoadState(retrying, {
        type: "failed",
        identity,
        attempt: 0,
      })
    ).toBe(retrying)
    expect(
      reduceImageResourceLoadState(retrying, {
        type: "loaded",
        identity: imageResourceIdentity(
          "image-node",
          "https://cdn.example.com/old.jpg",
          1
        ),
        attempt: 1,
        width: 1600,
        height: 900,
      })
    ).toBe(retrying)

    expect(
      reduceImageResourceLoadState(retrying, {
        type: "loaded",
        identity,
        attempt: 1,
        width: 1600,
        height: 900,
      })
    ).toMatchObject({
      status: "ready",
      displayed: {
        identity,
        source: "https://cdn.example.com/replacement.jpg",
        naturalSize: { width: 1600, height: 900 },
      },
      userRetried: true,
    })
  })

  it("reports exact token, source, and decoded dimensions for renderer acknowledgement", () => {
    expect(
      imageResourceStateChangeForLoad(
        "replacement-token",
        "image-node",
        "https://cdn.example.com/replacement.jpg",
        { width: 1600, height: 900 }
      )
    ).toEqual({
      token: "replacement-token",
      nodeId: "image-node",
      src: "https://cdn.example.com/replacement.jpg",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    expect(
      imageResourceStateChangeForFailure(
        "replacement-token",
        "image-node",
        "https://cdn.example.com/replacement.jpg"
      )
    ).toEqual({
      token: "replacement-token",
      nodeId: "image-node",
      src: "https://cdn.example.com/replacement.jpg",
      readiness: "unavailable",
      naturalSize: null,
    })
  })

  it("retains decoded pixels until a replacement candidate becomes ready", () => {
    const oldSource = "https://cdn.example.com/old.jpg"
    const replacementSource = "https://cdn.example.com/replacement.jpg"
    const oldIdentity = imageResourceIdentity("image-node", oldSource)
    const replacementIdentity = imageResourceIdentity(
      "image-node",
      replacementSource
    )
    const initial = createImageResourceLoadState(oldIdentity, oldSource)
    const oldReady = reduceImageResourceLoadState(initial, {
      type: "loaded",
      identity: oldIdentity,
      attempt: 0,
      width: 1600,
      height: 900,
    })
    const replacing = reduceImageResourceLoadState(oldReady, {
      type: "request",
      identity: replacementIdentity,
      source: replacementSource,
    })

    expect(replacing.status).toBe("loading")
    expect(replacing.displayed).toBe(oldReady.displayed)

    const failed = reduceImageResourceLoadState(replacing, {
      type: "failed",
      identity: replacementIdentity,
      attempt: 0,
    })
    expect(failed.status).toBe("error")
    expect(failed.displayed).toBe(oldReady.displayed)

    const undone = reduceImageResourceLoadState(failed, {
      type: "request",
      identity: oldIdentity,
      source: oldSource,
    })
    expect(undone.status).toBe("ready")
    expect(undone.displayed).toBe(oldReady.displayed)

    const retrying = reduceImageResourceLoadState(failed, { type: "retry" })
    expect(retrying.displayed).toBe(oldReady.displayed)
    const replacementReady = reduceImageResourceLoadState(retrying, {
      type: "loaded",
      identity: replacementIdentity,
      attempt: 1,
      width: 900,
      height: 1600,
    })
    expect(replacementReady).toMatchObject({
      status: "ready",
      displayed: {
        identity: replacementIdentity,
        source: replacementSource,
        attempt: 1,
        naturalSize: { width: 900, height: 1600 },
      },
    })
  })

  it("turns corrupt decodes into an explicit retryable error", () => {
    const identity = imageResourceIdentity("image-node", "broken://image")
    const initial = createImageResourceLoadState(identity, "broken://image")
    const failed = reduceImageResourceLoadState(initial, {
      type: "loaded",
      identity,
      attempt: 0,
      width: 0,
      height: 0,
    })

    expect(failed).toMatchObject({
      requestedIdentity: identity,
      status: "error",
      displayed: null,
      userRetried: false,
    })
    expect(
      reduceImageResourceLoadState(failed, { type: "retry" })
    ).toMatchObject({
      attempt: 1,
      status: "loading",
      displayed: null,
      userRetried: true,
    })
  })
})
