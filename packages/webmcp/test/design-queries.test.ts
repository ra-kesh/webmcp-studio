import { describe, expect, it } from "vitest"
import { northstarSeed, type SceneNode } from "@webmcp/document"
import {
  DesignQueryError,
  publicDesignNode,
  readDesignComponents,
  readDesignNode,
  readDesignTree,
  searchDesignNodes,
} from "../src"
import { componentDocumentFixture } from "./component-fixture"

const identity = {
  documentId: northstarSeed.id,
  revision: northstarSeed.revision,
  snapshotId: "snapshot-query-test",
  operationVersion: 7,
}

describe("design queries", () => {
  it("reads and paginates the complete document tree", () => {
    const first = readDesignTree(northstarSeed, identity, {
      depth: 4,
      limit: 2,
      cursor: null,
    })
    expect(first.identity).toEqual(identity)
    expect(first.items).toEqual([
      expect.objectContaining({ id: "cover", kind: "page", depth: 0 }),
      expect.objectContaining({
        id: "cover-studio",
        kind: "node",
        parentId: "cover",
        depth: 1,
      }),
    ])
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = readDesignTree(northstarSeed, identity, {
      depth: 4,
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(2)
    expect(second.items.map((item) => item.id)).toEqual([
      "cover-date",
      "cover-title",
    ])
  })

  it("reads one node with page, output, and field-binding context", () => {
    const result = readDesignNode(northstarSeed, identity, "package-price")
    expect(result).toMatchObject({
      identity,
      page: { id: "package" },
      output: { id: "proposal" },
      node: { id: "package-price", type: "text" },
      bindings: [
        {
          property: "text",
          field: { key: "package_price", type: "currency" },
        },
      ],
    })
  })

  it("exposes safe mask roles and identities without renderer-private state", () => {
    const document = structuredClone(northstarSeed)
    document.nodes = document.nodes.map((node) =>
      node.id === "cover-date" ? { ...node, visible: false } : node
    )
    document.groups.push({
      id: "cover-mask",
      role: "mask",
      pageId: "cover",
      name: "Cover mask",
      nodeIds: ["cover-panel", "cover-date", "cover-eyebrow"],
      mask: {
        type: "vector",
        sourceNodeIds: ["cover-date", "cover-panel"],
      },
    })

    const tree = readDesignTree(document, identity, {
      pageId: "cover",
      depth: 4,
      limit: 100,
      cursor: null,
    })
    expect(tree.items.find((item) => item.id === "cover-mask")).toMatchObject({
      mask: {
        role: "group",
        groupId: "cover-mask",
        type: "vector",
        sourceNodeIds: ["cover-date", "cover-panel"],
      },
    })
    expect(tree.items.find((item) => item.id === "cover-panel")).toMatchObject({
      mask: { role: "source", groupId: "cover-mask" },
    })
    expect(
      tree.items.find((item) => item.id === "cover-eyebrow")
    ).toMatchObject({ mask: { role: "content", groupId: "cover-mask" } })

    expect(readDesignNode(document, identity, "cover-panel").mask).toEqual({
      groupId: "cover-mask",
      groupName: "Cover mask",
      type: "vector",
      role: "source",
      sourceNodeIds: ["cover-date", "cover-panel"],
      contentNodeIds: ["cover-eyebrow"],
      visibleSourceNodeIds: ["cover-panel"],
      locked: false,
    })
    expect(
      JSON.stringify(readDesignNode(document, identity, "cover-panel"))
    ).not.toContain("composite")
  })

  it("searches names and text across pages with query-bound cursors", () => {
    const result = searchDesignNodes(northstarSeed, identity, {
      query: "package",
      types: ["text"],
      limit: 1,
      cursor: null,
    })
    expect(result.matches).toHaveLength(1)
    expect(result.nextCursor).toEqual(expect.any(String))
    expect(() =>
      searchDesignNodes(northstarSeed, identity, {
        query: "studio",
        types: ["text"],
        limit: 1,
        cursor: result.nextCursor,
      })
    ).toThrow(DesignQueryError)
  })

  it("never exposes private image sources", () => {
    const image = {
      id: "image-private",
      type: "image",
      name: "Private image",
      src: "asset:managed/asset-abcdefghij",
      assetId: "legacy-private-id",
    } as SceneNode
    expect(publicDesignNode(image)).toMatchObject({
      id: "image-private",
      assetId: "asset-abcdefghij",
    })
    expect(publicDesignNode(image)).not.toHaveProperty("src")
  })

  it("never exposes private image-fill sources", () => {
    const shape = structuredClone(
      northstarSeed.nodes.find((node) => node.type === "rect")
    )
    if (!shape || shape.type !== "rect") throw new Error("Rect fixture missing")
    shape.fills = [
      {
        id: "private-fill",
        type: "image",
        assetId: "legacy-private-fill-id",
        src: "asset:managed/asset-privatefill01",
        opacity: 1,
        visible: true,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ]

    const publicNode = publicDesignNode(shape)
    const publicFill = "fills" in publicNode ? publicNode.fills?.[0] : undefined

    expect(publicFill).toMatchObject({ assetId: "asset-privatefill01" })
    expect(publicFill).not.toHaveProperty("src")
  })

  it("reads component relationships and capabilities without private override values", () => {
    const document = componentDocumentFixture()
    const result = readDesignComponents(document, identity, "component-hero")

    expect(result.components).toEqual([
      expect.objectContaining({
        id: "component-hero",
        sourcePageId: "cover",
        instanceIds: ["instance-hero"],
        capabilities: { createInstance: true },
      }),
    ])
    expect(result.components[0]?.variants[1]).toMatchObject({
      id: "variant-compact",
      overriddenLayers: [
        {
          sourceNodeId: "cover-eyebrow",
          properties: expect.arrayContaining(["fontSize", "height"]),
          removedProperties: [],
        },
      ],
    })
    expect(result.instances[0]).toMatchObject({
      id: "instance-hero",
      pageId: "story",
      overrides: [
        {
          sourceNodeId: "cover-eyebrow",
          properties: ["text"],
          removedProperties: [],
        },
      ],
      capabilities: {
        switchVariant: true,
        setOverride: true,
        resetOverrides: true,
        detach: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain("Private instance value")
    expect(() =>
      readDesignComponents(document, identity, "missing-component")
    ).toThrow(DesignQueryError)
  })
})
