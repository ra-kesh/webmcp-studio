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
