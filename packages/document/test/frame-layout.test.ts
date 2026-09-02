import { describe, expect, it } from "vitest"
import {
  applyCommand,
  applyFrameAutoLayout,
  assertValidDocument,
  northstarSeed,
  projectFrameClipBounds,
  projectFrameClipStack,
  reconcileFrameChildPaintOrder,
  validateDocument,
  type Document,
  type SceneNode,
} from "../src"

type FrameNode = Extract<SceneNode, { type: "frame" }>

const frame = (
  id: string,
  children: FrameNode["children"],
  patch: Partial<FrameNode> = {}
): FrameNode => ({
  id,
  type: "frame",
  name: id,
  x: 100,
  y: 80,
  width: 400,
  height: 200,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  constraints: { horizontal: "min", vertical: "min" },
  fill: "#ffffff",
  radius: 16,
  strokeWidth: 0,
  children,
  autoLayout: {
    direction: "horizontal",
    horizontalSizing: "fixed",
    verticalSizing: "fixed",
    gap: 20,
    padding: { top: 10, right: 20, bottom: 10, left: 20 },
    primaryAlign: "start",
    counterAlign: "center",
  },
  clipsContent: false,
  ...patch,
})

const childLayout = (
  nodeId: string,
  patch: Partial<FrameNode["children"][number]> = {}
): FrameNode["children"][number] => ({
  nodeId,
  positioning: "auto",
  horizontalSizing: "fixed",
  verticalSizing: "fixed",
  offsetX: 0,
  offsetY: 0,
  grow: 0,
  ...patch,
})

function addFrame(
  source: Document,
  container: FrameNode,
  childIds: string[]
): Document {
  const document = structuredClone(source)
  const page = document.pages.find((candidate) =>
    childIds.some((childId) => candidate.nodeIds.includes(childId))
  )!
  const children = new Set(childIds)
  page.nodeIds = [
    container.id,
    ...childIds,
    ...page.nodeIds.filter((nodeId) => !children.has(nodeId)),
  ]
  document.nodes.push(container)
  return document
}

describe("canonical frame auto layout", () => {
  it("preserves ordinary flat documents by identity", () => {
    expect(applyFrameAutoLayout(northstarSeed)).toBe(northstarSeed)
    expect(reconcileFrameChildPaintOrder(northstarSeed)).toBe(northstarSeed)
  })

  it("lays out ordered children with fill sizing, padding, gap and alignment", () => {
    const document = structuredClone(northstarSeed)
    const first = document.nodes.find((node) => node.id === "cover-eyebrow")!
    const second = document.nodes.find((node) => node.id === "cover-title")!
    first.width = 60
    first.height = 40
    second.width = 80
    second.height = 60
    const input = addFrame(
      document,
      frame("layout-frame", [
        childLayout(first.id),
        childLayout(second.id, { horizontalSizing: "fill", grow: 2 }),
      ]),
      [first.id, second.id]
    )

    const result = applyFrameAutoLayout(assertValidDocument(input))
    const laidOutFirst = result.nodes.find((node) => node.id === first.id)!
    const laidOutSecond = result.nodes.find((node) => node.id === second.id)!

    expect(laidOutFirst).toMatchObject({
      x: 120,
      y: 160,
      width: 60,
      height: 40,
    })
    expect(laidOutSecond).toMatchObject({
      x: 200,
      y: 150,
      width: 280,
      height: 60,
    })
  })

  it("reorders frame metadata and page paint slots atomically", () => {
    const firstId = "cover-eyebrow"
    const secondId = "cover-title"
    const input = assertValidDocument(
      addFrame(
        northstarSeed,
        frame("reorder-frame", [childLayout(firstId), childLayout(secondId)]),
        [firstId, secondId]
      )
    )

    const result = applyCommand(input, {
      id: "reorder-frame-children",
      type: "update_node",
      actor: "human",
      at: "2026-09-01T12:00:00.000Z",
      nodeId: "reorder-frame",
      patch: {
        children: [childLayout(secondId), childLayout(firstId)],
      },
    })

    expect(
      result.pages.find((page) => page.id === "cover")?.nodeIds.slice(0, 3)
    ).toEqual(["reorder-frame", secondId, firstId])
    expect(
      result.nodes
        .find(
          (node): node is FrameNode =>
            node.id === "reorder-frame" && node.type === "frame"
        )
        ?.children.map((child) => child.nodeId)
    ).toEqual([secondId, firstId])
  })

  it("measures nested hug frames before arranging their descendants", () => {
    const document = structuredClone(northstarSeed)
    const leaf = document.nodes.find((node) => node.id === "cover-eyebrow")!
    leaf.width = 90
    leaf.height = 30
    const inner = frame("inner-frame", [childLayout(leaf.id)], {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      autoLayout: {
        direction: "vertical",
        horizontalSizing: "hug",
        verticalSizing: "hug",
        gap: 0,
        padding: { top: 5, right: 7, bottom: 5, left: 7 },
        primaryAlign: "start",
        counterAlign: "start",
      },
    })
    const outer = frame("outer-frame", [childLayout(inner.id)], {
      x: 40,
      y: 50,
      width: 300,
      height: 160,
    })
    const input = addFrame(document, outer, [inner.id, leaf.id])
    input.nodes.push(inner)

    const result = applyFrameAutoLayout(assertValidDocument(input))

    expect(result.nodes.find((node) => node.id === inner.id)).toMatchObject({
      x: 60,
      y: 110,
      width: 104,
      height: 40,
    })
    expect(result.nodes.find((node) => node.id === leaf.id)).toMatchObject({
      x: 67,
      y: 115,
      width: 90,
      height: 30,
    })
  })

  it("projects clipping only when an owning frame enables it", () => {
    const childId = "cover-title"
    const unclipped = addFrame(
      northstarSeed,
      frame("clip-frame", [childLayout(childId)]),
      [childId]
    )
    expect(projectFrameClipBounds(unclipped, childId)).toBeNull()

    const clipping = structuredClone(unclipped)
    const container = clipping.nodes.find(
      (node): node is FrameNode =>
        node.id === "clip-frame" && node.type === "frame"
    )!
    container.clipsContent = true
    expect(projectFrameClipBounds(clipping, childId)).toEqual({
      x: 100,
      y: 80,
      width: 400,
      height: 200,
      radius: 16,
    })

    const page = clipping.pages.find((candidate) =>
      candidate.nodeIds.includes("clip-frame")
    )!
    page.nodeIds.unshift("outer-clip-frame")
    clipping.nodes.push(
      frame("outer-clip-frame", [childLayout("clip-frame")], {
        x: 80,
        y: 60,
        width: 460,
        height: 260,
        radius: 28,
        autoLayout: null,
        clipsContent: true,
      })
    )
    expect(projectFrameClipStack(clipping, childId)).toEqual([
      { x: 100, y: 80, width: 400, height: 200, radius: 16 },
      { x: 80, y: 60, width: 460, height: 260, radius: 28 },
    ])

    container.independentCorners = true
    container.cornerRadii = {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    }
    container.cornerSmoothing = 0.5
    expect(projectFrameClipStack(clipping, childId)[0]).toMatchObject({
      cornerRadii: container.cornerRadii,
      cornerSmoothing: 0.5,
    })
    expect(projectFrameClipStack(clipping, childId)[0]?.path).toContain(" C ")
  })

  it("rejects cross-page child ownership", () => {
    const document = structuredClone(northstarSeed)
    const cover = document.pages.find((page) => page.id === "cover")!
    const otherPage = document.pages.find((page) => page.id !== cover.id)!
    const otherNodeId = otherPage.nodeIds[0]!
    const container = frame("cross-page-frame", [childLayout(otherNodeId)])
    cover.nodeIds.unshift(container.id)
    document.nodes.push(container)

    expect(
      validateDocument(document).some(
        (issue) =>
          issue.code === "invalid_layout" && issue.nodeId === container.id
      )
    ).toBe(true)
    expect(() => assertValidDocument(document)).toThrow("invalid")
  })

  it("rejects frame ownership of a mask source at admission", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    page.nodeIds.unshift("mask-owner-frame")
    document.nodes.push(
      frame("mask-owner-frame", [childLayout("cover-panel")], {
        autoLayout: null,
      })
    )
    document.groups.push({
      id: "frame-mask-source",
      pageId: page.id,
      name: "Frame mask source",
      role: "mask",
      nodeIds: ["cover-panel", "cover-title"],
      mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
    })

    expect(validateDocument(document)).toContainEqual(
      expect.objectContaining({
        code: "invalid_layout",
        nodeId: "mask-owner-frame",
      })
    )
  })
})
