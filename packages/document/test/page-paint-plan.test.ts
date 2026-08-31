import { describe, expect, it } from "vitest"
import {
  initialMaskPaintAdmission,
  projectPagePaintPlan,
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
  it("derives mask paint from canonical v5 groups while organize groups stay flat", () => {
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

  it("rejects unsupported canonical mask modes instead of painting them flat", () => {
    const document = {
      pages: [page],
      nodes,
      groups: [
        {
          id: relation.groupId,
          role: "mask",
          pageId: page.id,
          name: "Unsupported alpha mask",
          nodeIds: relation.nodeIds,
          mask: { type: "alpha", sourceNodeIds: relation.sourceNodeIds },
        },
      ],
    } as unknown as Document

    expect(() => projectPagePaintPlan(document, page.id)).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_UNSUPPORTED_TYPE" })
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
          content: [{ kind: "node", nodeId: "content" }],
          bounds: { x: 100, y: 90, width: 200, height: 180 },
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

  it("rejects mask modes and source shapes outside the Gate M0 contract", () => {
    expect(() =>
      projectPagePaintPlan(page, nodes, [
        { ...relation, maskType: "alpha" as "vector" },
      ])
    ).toThrowError(
      expect.objectContaining({ code: "MASK_GROUP_UNSUPPORTED_TYPE" })
    )

    const ellipseSourceNodes = nodes.map((node) =>
      node.id === "source"
        ? ({
            ...node,
            type: "ellipse",
          } as SceneNode)
        : node
    )
    expect(() =>
      projectPagePaintPlan(page, ellipseSourceNodes, [relation])
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
})
