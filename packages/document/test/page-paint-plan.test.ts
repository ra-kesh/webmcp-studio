import { describe, expect, it } from "vitest"
import {
  initialMaskPaintAdmission,
  projectPagePaintPlan,
  supportedMaskPaintPixelRatio,
  type MaskPaintRelation,
} from "../src/page-paint-plan"
import { decodeDocument, northstarSeed } from "../src"
import {
  maskRenderConformanceHiddenSourcePlan,
  maskRenderConformancePlan,
} from "../src/mask-render-conformance"
import type { Document, Page, SceneNode } from "../src/schema"

const page: Page = {
  id: "page-1",
  outputId: "output-1",
  name: "Mask oracle",
  width: 640,
  height: 480,
  background: "#ffffff",
  nodeIds: ["below", "source", "content", "above"],
}

const rect = (
  id: string,
  values: Partial<Extract<SceneNode, { type: "rect" }>> = {}
): Extract<SceneNode, { type: "rect" }> => ({
  id,
  type: "rect",
  name: id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  constraints: { horizontal: "min", vertical: "min" },
  fill: "#000000",
  radius: 0,
  strokeWidth: 0,
  ...values,
})

const nodes = [
  rect("below", { x: 8, y: 8 }),
  rect("source", { x: 100, y: 120, width: 80, height: 40 }),
  rect("content", { x: 140, y: 90, width: 160, height: 180 }),
  rect("above", { x: 520, y: 320 }),
] satisfies SceneNode[]

const relation: MaskPaintRelation = {
  groupId: "mask-1",
  pageId: page.id,
  maskType: "vector",
  nodeIds: ["source", "content"],
  sourceNodeIds: ["source"],
}

describe("shared page paint plan mask oracle", () => {
  it("derives mask paint from canonical v6 groups while organize groups stay flat", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: "organize-1",
          role: "organize",
          pageId: page.id,
          name: "Organize only",
          nodeIds: ["below"],
        },
        {
          id: relation.groupId,
          role: "mask",
          pageId: page.id,
          name: "Canonical mask",
          nodeIds: relation.nodeIds,
          mask: { type: "vector", sourceNodeIds: relation.sourceNodeIds },
        },
      ],
    } as unknown as Document

    expect(projectPagePaintPlan(document, page.id)).toMatchObject({
      pageId: page.id,
      entries: [
        { kind: "node", nodeId: "below" },
        {
          kind: "mask_group",
          groupId: relation.groupId,
          sourceNodeIds: ["source"],
          content: [{ kind: "node", nodeId: "content" }],
        },
        { kind: "node", nodeId: "above" },
      ],
    })
  })

  it("projects canonical luminance masks through the shared paint plan", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: relation.groupId,
          role: "mask",
          pageId: page.id,
          name: "Luminance mask",
          nodeIds: relation.nodeIds,
          mask: { type: "luminance", sourceNodeIds: relation.sourceNodeIds },
        },
      ],
    } as unknown as Document

    expect(projectPagePaintPlan(document, page.id).entries[1]).toMatchObject({
      kind: "mask_group",
      maskType: "luminance",
      sourceNodeIds: ["source"],
      visibleSourceNodeIds: ["source"],
      sourceCombination: "source_over_union",
      maskEnabled: true,
      compositeRequired: true,
    })
  })

  it("projects alpha and luminance image readiness without renderer-private state", () => {
    const imageSource = {
      id: "alpha-image",
      type: "image" as const,
      name: "Alpha image",
      x: 20,
      y: 30,
      width: 120,
      height: 90,
      rotation: 0,
      opacity: 0.75,
      visible: true,
      locked: false,
      constraints: { horizontal: "min" as const, vertical: "min" as const },
      assetId: "alpha-image-asset",
      src: "https://cdn.example.com/alpha.png",
      placement: {
        mode: "fill" as const,
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "ellipse" as const },
      alt: "",
      decorative: true,
    }
    const alphaPage = {
      ...page,
      nodeIds: [imageSource.id, "content"],
    }
    for (const maskType of ["alpha", "luminance"] as const) {
      const plan = projectPagePaintPlan(
        alphaPage,
        [imageSource, nodes[2]!],
        [
          {
            ...relation,
            maskType,
            nodeIds: alphaPage.nodeIds,
            sourceNodeIds: [imageSource.id],
          },
        ]
      )
      expect(plan.entries[0]).toMatchObject({
        kind: "mask_group",
        maskType,
        sources: [
          {
            nodeId: imageSource.id,
            kind: "image",
            assetId: imageSource.assetId,
          },
        ],
      })
      expect(JSON.stringify(plan)).not.toContain(imageSource.src)
    }
  })

  it("projects every font required by alpha and luminance text sources", () => {
    const seedText = structuredClone(
      northstarSeed.nodes.find((node) => node.type === "text")!
    )
    if (seedText.type !== "text") throw new Error("Expected text fixture")
    seedText.id = "alpha-text"
    seedText.fontFamily = "Geist Variable"
    seedText.runs = [
      { start: 0, end: 1, style: { fontFamily: "Inter" } },
      { start: 1, end: 2, style: { fontFamily: "Geist Variable" } },
    ]
    const alphaPage = { ...page, nodeIds: [seedText.id, "content"] }
    for (const maskType of ["alpha", "luminance"] as const) {
      const plan = projectPagePaintPlan(
        alphaPage,
        [seedText, nodes[2]!],
        [
          {
            ...relation,
            maskType,
            nodeIds: alphaPage.nodeIds,
            sourceNodeIds: [seedText.id],
          },
        ]
      )
      expect(plan.entries[0]).toMatchObject({
        kind: "mask_group",
        maskType,
        sources: [
          {
            nodeId: seedText.id,
            kind: "text",
            fontFamilies: ["Geist Variable", "Inter"],
          },
        ],
      })
    }
  })

  it("projects one nested mask level bottom-up with separate output bounds", () => {
    const nestedPage = {
      ...page,
      nodeIds: [
        "outer-source",
        "child-source",
        "child-content",
        "outer-content",
      ],
    }
    const nestedNodes = [
      rect("outer-source", { x: 0, y: 0, width: 20, height: 20 }),
      rect("child-source", { x: -100, y: 0, width: 20, height: 20 }),
      rect("child-content", { x: 120, y: 10, width: 20, height: 20 }),
      rect("outer-content", { x: 200, y: 0, width: 20, height: 20 }),
    ]
    const document = {
      pages: [nestedPage],
      nodes: nestedNodes,
      groups: [
        {
          id: "outer-mask",
          role: "mask",
          pageId: nestedPage.id,
          name: "Outer mask",
          nodeIds: ["outer-source", "outer-content"],
          mask: { type: "vector", sourceNodeIds: ["outer-source"] },
        },
        {
          id: "child-mask",
          role: "mask",
          pageId: nestedPage.id,
          parentGroupId: "outer-mask",
          name: "Child mask",
          nodeIds: ["child-source", "child-content"],
          mask: { type: "alpha", sourceNodeIds: ["child-source"] },
        },
      ],
    } as unknown as Document

    expect(projectPagePaintPlan(document, nestedPage.id)).toEqual({
      pageId: nestedPage.id,
      entries: [
        {
          kind: "mask_group",
          groupId: "outer-mask",
          maskType: "vector",
          sourceNodeIds: ["outer-source"],
          visibleSourceNodeIds: ["outer-source"],
          sources: [{ nodeId: "outer-source", kind: "vector" }],
          sourceCombination: "source_over_union",
          content: [
            {
              kind: "mask_group",
              groupId: "child-mask",
              maskType: "alpha",
              sourceNodeIds: ["child-source"],
              visibleSourceNodeIds: ["child-source"],
              sources: [{ nodeId: "child-source", kind: "vector" }],
              sourceCombination: "source_over_union",
              content: [{ kind: "node", nodeId: "child-content" }],
              bounds: { x: -100, y: 0, width: 240, height: 30 },
              outputBounds: { x: 120, y: 10, width: 20, height: 20 },
              maskEnabled: true,
              compositeRequired: true,
            },
            { kind: "node", nodeId: "outer-content" },
          ],
          bounds: { x: 0, y: 0, width: 220, height: 30 },
          outputBounds: { x: 120, y: 0, width: 100, height: 30 },
          maskEnabled: true,
          compositeRequired: true,
        },
      ],
    })
  })

  it("retains nested output when the child or parent source is hidden", () => {
    const nestedPage = {
      ...page,
      nodeIds: ["outer-source", "child-source", "child-content"],
    }
    const nestedNodes = [
      rect("outer-source", { visible: false }),
      rect("child-source", { visible: false }),
      rect("child-content", { x: 40, y: 50, width: 20, height: 30 }),
    ]
    const document = {
      pages: [nestedPage],
      nodes: nestedNodes,
      groups: [
        {
          id: "outer-mask",
          role: "mask",
          pageId: nestedPage.id,
          name: "Outer mask",
          nodeIds: ["outer-source"],
          mask: { type: "vector", sourceNodeIds: ["outer-source"] },
        },
        {
          id: "child-mask",
          role: "mask",
          pageId: nestedPage.id,
          parentGroupId: "outer-mask",
          name: "Child mask",
          nodeIds: ["child-source", "child-content"],
          mask: { type: "luminance", sourceNodeIds: ["child-source"] },
        },
      ],
    } as unknown as Document
    const outer = projectPagePaintPlan(document, nestedPage.id).entries[0]
    expect(outer).toMatchObject({
      kind: "mask_group",
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
      bounds: { x: 40, y: 50, width: 20, height: 30 },
      outputBounds: { x: 40, y: 50, width: 20, height: 30 },
      content: [
        {
          kind: "mask_group",
          maskType: "luminance",
          visibleSourceNodeIds: [],
          maskEnabled: false,
          compositeRequired: false,
          outputBounds: { x: 40, y: 50, width: 20, height: 30 },
        },
      ],
    })
  })

  it("rejects a third mask depth before allocating", () => {
    const nestedPage = {
      ...page,
      nodeIds: ["outer-source", "child-source", "grand-source", "content"],
    }
    const document = {
      pages: [nestedPage],
      nodes: [
        rect("outer-source"),
        rect("child-source"),
        rect("grand-source"),
        rect("content"),
      ],
      groups: [
        {
          id: "outer-mask",
          role: "mask",
          pageId: nestedPage.id,
          name: "Outer",
          nodeIds: ["outer-source"],
          mask: { type: "vector", sourceNodeIds: ["outer-source"] },
        },
        {
          id: "child-mask",
          role: "mask",
          parentGroupId: "outer-mask",
          pageId: nestedPage.id,
          name: "Child",
          nodeIds: ["child-source"],
          mask: { type: "vector", sourceNodeIds: ["child-source"] },
        },
        {
          id: "grand-mask",
          role: "mask",
          parentGroupId: "child-mask",
          pageId: nestedPage.id,
          name: "Grandchild",
          nodeIds: ["grand-source", "content"],
          mask: { type: "vector", sourceNodeIds: ["grand-source"] },
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, nestedPage.id)).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_NESTING_UNSUPPORTED" })
    )
  })

  it("rejects a cyclic mask hierarchy before recursive projection", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: "cycle-a",
          role: "mask",
          parentGroupId: "cycle-b",
          pageId: page.id,
          name: "Cycle A",
          nodeIds: ["source", "content"],
          mask: { type: "vector", sourceNodeIds: ["source"] },
        },
        {
          id: "cycle-b",
          role: "mask",
          parentGroupId: "cycle-a",
          pageId: page.id,
          name: "Cycle B",
          nodeIds: ["below", "above"],
          mask: { type: "vector", sourceNodeIds: ["below"] },
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_NESTING_UNSUPPORTED" })
    )
  })

  it("rejects duplicate nested source IDs before projection", () => {
    const nestedPage = {
      ...page,
      nodeIds: ["outer-source", "child-source", "child-content"],
    }
    const document = {
      pages: [nestedPage],
      nodes: [
        rect("outer-source"),
        rect("child-source"),
        rect("child-content"),
      ],
      groups: [
        {
          id: "outer-mask",
          role: "mask",
          pageId: page.id,
          name: "Outer",
          nodeIds: ["outer-source"],
          mask: { type: "vector", sourceNodeIds: ["outer-source"] },
        },
        {
          id: "child-mask",
          role: "mask",
          parentGroupId: "outer-mask",
          pageId: page.id,
          name: "Child",
          nodeIds: ["child-source", "child-content"],
          mask: {
            type: "vector",
            sourceNodeIds: ["child-source", "child-source"],
          },
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({
        code: "MASK_GROUP_DUPLICATE_SOURCE",
        groupId: "child-mask",
        nodeId: "child-source",
      })
    )
  })

  it("rejects organize ownership that overlaps a nested mask", () => {
    const nestedPage = {
      ...page,
      nodeIds: ["outer-source", "child-source", "child-content"],
    }
    const document = {
      pages: [nestedPage],
      nodes: [
        rect("outer-source"),
        rect("child-source"),
        rect("child-content"),
      ],
      groups: [
        {
          id: "outer-mask",
          role: "mask",
          pageId: page.id,
          name: "Outer",
          nodeIds: ["outer-source"],
          mask: { type: "vector", sourceNodeIds: ["outer-source"] },
        },
        {
          id: "child-mask",
          role: "mask",
          parentGroupId: "outer-mask",
          pageId: page.id,
          name: "Child",
          nodeIds: ["child-source", "child-content"],
          mask: { type: "vector", sourceNodeIds: ["child-source"] },
        },
        {
          id: "ambiguous-organize",
          role: "organize",
          pageId: page.id,
          name: "Ambiguous organize",
          nodeIds: ["child-content"],
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({
        code: "MASK_GROUP_OVERLAP",
        groupId: "child-mask",
        nodeId: "child-content",
      })
    )
  })

  it("charges child and parent composites separately to the page area budget", () => {
    const childCount = 4
    const pageNodes = [rect("outer-source", { width: 2_000, height: 2_000 })]
    const groups: Document["groups"] = [
      {
        id: "budget-outer",
        role: "mask",
        pageId: page.id,
        name: "Budget outer",
        nodeIds: ["outer-source"],
        mask: { type: "vector", sourceNodeIds: ["outer-source"] },
      },
    ]
    for (let index = 0; index < childCount; index += 1) {
      const sourceId = `budget-source-${index}`
      const contentId = `budget-content-${index}`
      pageNodes.push(
        rect(sourceId, { width: 2_000, height: 2_000 }),
        rect(contentId, { width: 2_000, height: 2_000 })
      )
      groups.push({
        id: `budget-child-${index}`,
        role: "mask",
        parentGroupId: "budget-outer",
        pageId: page.id,
        name: `Budget child ${index}`,
        nodeIds: [sourceId, contentId],
        mask: { type: "vector", sourceNodeIds: [sourceId] },
      })
    }
    const budgetPage = { ...page, nodeIds: pageNodes.map((node) => node.id) }
    const document = {
      pages: [budgetPage],
      nodes: pageNodes,
      groups,
    } as unknown as Document

    expect(() =>
      projectPagePaintPlan(document, page.id, { pixelRatio: 2 })
    ).toThrowError(
      expect.objectContaining({ code: "MASK_PAGE_COMPOSITE_AREA_LIMIT" })
    )
  })

  it("rejects a canonical source hidden inside a child group", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: relation.groupId,
          role: "mask",
          pageId: page.id,
          name: "Nested source mask",
          nodeIds: ["content"],
          mask: { type: "vector", sourceNodeIds: ["source"] },
        },
        {
          id: "source-child",
          role: "organize",
          pageId: page.id,
          parentGroupId: relation.groupId,
          name: "Nested source",
          nodeIds: ["source"],
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_NESTING_UNSUPPORTED" })
    )
  })

  it("rejects a canonical mask group with an organize child", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: relation.groupId,
          role: "mask",
          pageId: page.id,
          name: "Nested canonical mask",
          nodeIds: relation.nodeIds,
          mask: { type: "vector", sourceNodeIds: relation.sourceNodeIds },
        },
        {
          id: "organize-child",
          role: "organize",
          pageId: page.id,
          parentGroupId: relation.groupId,
          name: "Nested organize child",
          nodeIds: ["above"],
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({
        code: "MASK_GROUP_NESTING_UNSUPPORTED",
        groupId: relation.groupId,
      })
    )
  })

  it("keeps migrated schema-v4 organize groups on the legacy flat paint path", () => {
    const legacy = structuredClone(northstarSeed) as unknown as {
      schemaVersion: number
      groups: Array<Record<string, unknown>>
    }
    legacy.schemaVersion = 4
    legacy.groups = legacy.groups.map(
      ({ role: _role, mask: _mask, ...group }) => group
    )

    const decoded = decodeDocument(legacy)
    const migratedPage = decoded.document.pages[0]!
    const legacyFlatPlan = projectPagePaintPlan(
      migratedPage,
      decoded.document.nodes,
      []
    )

    expect(
      decoded.document.groups.every((group) => group.role === "organize")
    ).toBe(true)
    expect(projectPagePaintPlan(decoded.document, migratedPage.id)).toEqual(
      legacyFlatPlan
    )
  })

  it("retains one shared scene for every renderer consumer", () => {
    expect(maskRenderConformancePlan.entries).toMatchObject([
      { kind: "node", nodeId: "mask-conformance-below" },
      {
        kind: "mask_group",
        groupId: "mask-conformance-group",
        sourceNodeIds: ["mask-conformance-source"],
        content: [{ kind: "node", nodeId: "mask-conformance-content" }],
        maskEnabled: true,
        compositeRequired: true,
      },
      { kind: "node", nodeId: "mask-conformance-above" },
    ])
    expect(maskRenderConformanceHiddenSourcePlan.entries[1]).toMatchObject({
      kind: "mask_group",
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
    })
  })

  it("retains page order, removes the source from ordinary paint, and bounds the composite", () => {
    expect(projectPagePaintPlan(page, nodes, [relation])).toEqual({
      pageId: page.id,
      entries: [
        { kind: "node", nodeId: "below" },
        {
          kind: "mask_group",
          groupId: "mask-1",
          maskType: "vector",
          sourceNodeIds: ["source"],
          visibleSourceNodeIds: ["source"],
          sources: [{ nodeId: "source", kind: "vector" }],
          sourceCombination: "source_over_union",
          content: [{ kind: "node", nodeId: "content" }],
          bounds: { x: 100, y: 90, width: 200, height: 180 },
          outputBounds: { x: 140, y: 90, width: 160, height: 180 },
          maskEnabled: true,
          compositeRequired: true,
        },
        { kind: "node", nodeId: "above" },
      ],
    })
  })

  it("keeps the explicit relation but paints content unmasked when its only source is hidden", () => {
    const hiddenNodes = nodes.map((node) =>
      node.id === "source" ? { ...node, visible: false } : node
    )
    expect(projectPagePaintPlan(page, hiddenNodes, [relation])).toMatchObject({
      entries: [
        { kind: "node", nodeId: "below" },
        {
          kind: "mask_group",
          sourceNodeIds: ["source"],
          visibleSourceNodeIds: [],
          content: [{ kind: "node", nodeId: "content" }],
          bounds: { x: 140, y: 90, width: 160, height: 180 },
          maskEnabled: false,
          compositeRequired: false,
        },
        { kind: "node", nodeId: "above" },
      ],
    })
  })

  it("does not allocate a composite when every content node is hidden", () => {
    const hiddenContentNodes = nodes.map((node) =>
      node.id === "content"
        ? {
            ...node,
            width: initialMaskPaintAdmission.maxCompositeDimension * 2,
            height: initialMaskPaintAdmission.maxCompositeDimension * 2,
            visible: false,
          }
        : node
    )
    expect(
      projectPagePaintPlan(page, hiddenContentNodes, [relation]).entries[1]
    ).toMatchObject({
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      maskEnabled: true,
      compositeRequired: false,
    })
  })

  it("derives masked content order from canonical page order", () => {
    const twoContentPage = {
      ...page,
      nodeIds: ["below", "source", "content", "content-2", "above"],
    }
    const twoContentNodes = [...nodes, rect("content-2", { x: 200, y: 100 })]
    const result = projectPagePaintPlan(twoContentPage, twoContentNodes, [
      {
        ...relation,
        nodeIds: ["content-2", "source", "content"],
      },
    ])
    expect(result.entries[1]).toMatchObject({
      content: [
        { kind: "node", nodeId: "content" },
        { kind: "node", nodeId: "content-2" },
      ],
    })
  })

  it("preserves explicit multi-source order and declares source-over union", () => {
    const multiSourceRelation = {
      ...relation,
      nodeIds: ["below", "source", "content"],
      sourceNodeIds: ["source", "below"],
    }
    const result = projectPagePaintPlan(page, nodes, [multiSourceRelation])
    expect(result.entries[0]).toMatchObject({
      kind: "mask_group",
      sourceNodeIds: ["source", "below"],
      visibleSourceNodeIds: ["source", "below"],
      sourceCombination: "source_over_union",
      content: [{ kind: "node", nodeId: "content" }],
    })

    const oneVisible = nodes.map((node) =>
      node.id === "source" ? { ...node, visible: false } : node
    )
    expect(
      projectPagePaintPlan(page, oneVisible, [multiSourceRelation]).entries[0]
    ).toMatchObject({
      visibleSourceNodeIds: ["below"],
      maskEnabled: true,
      compositeRequired: true,
    })
    const allHidden = oneVisible.map((node) =>
      node.id === "below" ? { ...node, visible: false } : node
    )
    expect(
      projectPagePaintPlan(page, allHidden, [multiSourceRelation]).entries[0]
    ).toMatchObject({
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
    })
  })

  it("preserves luminance source order and makes hidden sources contribute zero", () => {
    const luminanceRelation = {
      ...relation,
      maskType: "luminance" as const,
      nodeIds: ["below", "source", "content"],
      sourceNodeIds: ["source", "below"],
    }
    expect(
      projectPagePaintPlan(page, nodes, [luminanceRelation]).entries[0]
    ).toMatchObject({
      maskType: "luminance",
      sourceNodeIds: ["source", "below"],
      visibleSourceNodeIds: ["source", "below"],
      sources: [
        { nodeId: "source", kind: "vector" },
        { nodeId: "below", kind: "vector" },
      ],
      sourceCombination: "source_over_union",
      maskEnabled: true,
      compositeRequired: true,
    })

    const allHidden = nodes.map((node) =>
      node.id === "source" || node.id === "below"
        ? { ...node, visible: false }
        : node
    )
    expect(
      projectPagePaintPlan(page, allHidden, [luminanceRelation]).entries[0]
    ).toMatchObject({
      sourceNodeIds: ["source", "below"],
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
    })
  })

  it("rejects a fifth source before allocating a composite", () => {
    const sourceNodes = Array.from({ length: 5 }, (_, index) =>
      rect(`source-${index}`)
    )
    const content = rect("multi-content")
    const sourcePage = {
      ...page,
      nodeIds: [...sourceNodes.map((node) => node.id), content.id],
    }
    expect(() =>
      projectPagePaintPlan(
        sourcePage,
        [...sourceNodes, content],
        [
          {
            ...relation,
            nodeIds: sourcePage.nodeIds,
            sourceNodeIds: sourceNodes.map((node) => node.id),
          },
        ]
      )
    ).toThrowError(expect.objectContaining({ code: "MASK_GROUP_SOURCE_LIMIT" }))
  })

  it("uses conservative top-left-rotation bounds", () => {
    const rotatedNodes = nodes.map((node) =>
      node.id === "source"
        ? { ...node, x: 200, y: 200, width: 100, height: 50, rotation: 90 }
        : node.id === "content"
          ? { ...node, x: 160, y: 210, width: 20, height: 20 }
          : node
    )
    const result = projectPagePaintPlan(page, rotatedNodes, [relation])
    expect(result.entries[1]).toMatchObject({
      bounds: { x: 150, y: 200, width: 50, height: 100 },
    })
  })

  it.each([
    {
      expectedCode: "MASK_GROUP_SOURCE_NOT_MEMBER",
      relation: { ...relation, sourceNodeIds: ["above"] },
    },
    {
      expectedCode: "MASK_GROUP_NONCONTIGUOUS",
      relation: { ...relation, nodeIds: ["source", "above"] },
    },
    {
      expectedCode: "MASK_GROUP_NO_CONTENT",
      relation: { ...relation, nodeIds: ["source"] },
    },
  ] as const)(
    "rejects $expectedCode without returning a partial plan",
    (fixture) => {
      expect(() =>
        projectPagePaintPlan(page, nodes, [fixture.relation])
      ).toThrowError(
        expect.objectContaining({
          code: fixture.expectedCode,
        })
      )
    }
  )

  it("rejects duplicate relation identities before projecting either group", () => {
    expect(() =>
      projectPagePaintPlan(page, nodes, [
        relation,
        { ...relation, nodeIds: ["below", "source"] },
      ])
    ).toThrowError(expect.objectContaining({ code: "MASK_GROUP_DUPLICATE_ID" }))
  })

  it("admits rotated rectangle, ellipse, and icon sources and rejects non-vector or stroked vector sources", () => {
    const ellipseSourceNodes = nodes.map((node) =>
      node.id === "source"
        ? ({
            ...node,
            type: "ellipse",
            rotation: 37,
          } as SceneNode)
        : node
    )
    expect(() =>
      projectPagePaintPlan(page, ellipseSourceNodes, [relation])
    ).not.toThrow()

    const iconSourceNodes = nodes.map((node) =>
      node.id === "source"
        ? ({
            ...node,
            type: "icon",
            path: "M0 0h24v24H0z",
            viewBox: "0 0 24 24",
            rotation: -22,
          } as SceneNode)
        : node
    )
    expect(() =>
      projectPagePaintPlan(page, iconSourceNodes, [relation])
    ).not.toThrow()

    const lineSourceNodes = nodes.map((node) =>
      node.id === "source"
        ? ({
            ...node,
            type: "line",
            stroke: "#000000",
            strokeWidth: 2,
          } as SceneNode)
        : node
    )
    expect(() =>
      projectPagePaintPlan(page, lineSourceNodes, [relation])
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_UNSUPPORTED_SOURCE" })
    )

    const strokedSourceNodes = nodes.map((node) =>
      node.id === "source" ? { ...node, strokeWidth: 2 } : node
    )
    expect(() =>
      projectPagePaintPlan(page, strokedSourceNodes, [relation])
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_UNSUPPORTED_SOURCE" })
    )
  })

  it("rejects an over-budget device-pixel composite", () => {
    const oversizedNodes = nodes.map((node) =>
      node.id === "content"
        ? {
            ...node,
            x: 0,
            y: 0,
            width: initialMaskPaintAdmission.maxCompositeDimension,
            height: initialMaskPaintAdmission.maxCompositeDimension,
          }
        : node
    )
    expect(() =>
      projectPagePaintPlan(page, oversizedNodes, [relation], { pixelRatio: 2 })
    ).toThrowError(
      expect.objectContaining({
        code: "MASK_GROUP_COMPOSITE_LIMIT",
        groupId: relation.groupId,
      })
    )
  })

  it("admits a bounded composite at 1x and rejects the same geometry at 2x", () => {
    const scaledNodes = nodes.map((node) =>
      node.id === "source"
        ? { ...node, x: 0, y: 0, width: 10, height: 10 }
        : node.id === "content"
          ? { ...node, x: 0, y: 0, width: 3000, height: 2000 }
          : node
    )
    expect(() =>
      projectPagePaintPlan(page, scaledNodes, [relation], { pixelRatio: 1 })
    ).not.toThrow()
    expect(() =>
      projectPagePaintPlan(page, scaledNodes, [relation], { pixelRatio: 2 })
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_COMPOSITE_LIMIT" })
    )
  })

  it("uses ceil-rounded device bounds for fractional admission", () => {
    const fractionalNodes = nodes.map((node) =>
      node.id === "source"
        ? { ...node, x: 0, y: 0, width: 1, height: 1 }
        : node.id === "content"
          ? { ...node, x: 0, y: 0, width: 4096.1, height: 4095.1 }
          : node
    )
    expect(() =>
      projectPagePaintPlan(page, fractionalNodes, [relation])
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_COMPOSITE_LIMIT" })
    )
  })

  it("freezes the Gate M2 projector at a maximum 2x pixel ratio", () => {
    expect(supportedMaskPaintPixelRatio(3)).toBe(2)
    expect(supportedMaskPaintPixelRatio(1.5)).toBe(1.5)
    expect(supportedMaskPaintPixelRatio(Number.NaN)).toBe(1)
    expect(() =>
      projectPagePaintPlan(page, nodes, [relation], { pixelRatio: 2 })
    ).not.toThrow()
    expect(() =>
      projectPagePaintPlan(page, nodes, [relation], { pixelRatio: 2.01 })
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_PIXEL_RATIO_LIMIT" })
    )
  })

  it("rejects many small active composites at the shared per-page count cap", () => {
    const count = initialMaskPaintAdmission.maxActiveCompositesPerPage + 1
    const manyNodes = Array.from({ length: count * 2 }, (_, index) =>
      rect(`small-${index}`, { x: index * 2, width: 1, height: 1 })
    )
    const manyPage = {
      ...page,
      nodeIds: manyNodes.map((node) => node.id),
    }
    const relations = Array.from({ length: count }, (_, index) => ({
      groupId: `small-mask-${index}`,
      pageId: page.id,
      maskType: "vector" as const,
      nodeIds: [`small-${index * 2}`, `small-${index * 2 + 1}`],
      sourceNodeIds: [`small-${index * 2}`],
    }))
    expect(() =>
      projectPagePaintPlan(manyPage, manyNodes, relations, { pixelRatio: 2 })
    ).toThrowError(
      expect.objectContaining({ code: "MASK_PAGE_COMPOSITE_COUNT_LIMIT" })
    )
  })

  it("rejects summed 2x page area before any renderer allocates", () => {
    const count = 5
    const areaNodes = Array.from({ length: count * 2 }, (_, index) =>
      rect(`area-${index}`, {
        x: 0,
        y: 0,
        width: 2_000,
        height: 2_000,
      })
    )
    const areaPage = { ...page, nodeIds: areaNodes.map((node) => node.id) }
    const relations = Array.from({ length: count }, (_, index) => ({
      groupId: `area-mask-${index}`,
      pageId: page.id,
      maskType: "vector" as const,
      nodeIds: [`area-${index * 2}`, `area-${index * 2 + 1}`],
      sourceNodeIds: [`area-${index * 2}`],
    }))
    expect(() =>
      projectPagePaintPlan(areaPage, areaNodes, relations, { pixelRatio: 2 })
    ).toThrowError(
      expect.objectContaining({ code: "MASK_PAGE_COMPOSITE_AREA_LIMIT" })
    )
  })
})
