import { describe, expect, it } from "vitest"
import {
  applyCommand,
  assetReferenceKeysForSource,
  documentCommandSchema,
  documentSchema,
  executeSceneTransaction,
  northstarSeed,
  projectNodeForRender,
  regularPolygonPath,
  regularStarPath,
  sceneNodeSchema,
  validateDocument,
  type DocumentCommand,
  type SceneNode,
} from "../src"

const pageId = northstarSeed.pages[0]!.id
const at = "2026-09-02T10:00:00.000Z"
const imageSource =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3Cpath fill='%23f97316' d='M0 0h2v2H0z'/%3E%3C/svg%3E"

const baseNode = (id: string, name: string, x: number) => ({
  id,
  name,
  x,
  y: 80,
  width: 120,
  height: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  constraints: { horizontal: "min" as const, vertical: "min" as const },
  fill: "#d9c9b2",
  strokeWidth: 0,
})

const addNode = (node: SceneNode, id = `add-${node.id}`): DocumentCommand => ({
  id,
  at,
  actor: "agent",
  type: "add_node",
  pageId,
  node,
})

const polygon = sceneNodeSchema.parse({
  ...baseNode("parity-polygon", "Parity polygon", 80),
  type: "polygon",
  pointCount: 6,
  fills: [
    {
      id: "linear",
      type: "linear_gradient",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      stops: [
        { position: 0, color: "#0ea5e9", opacity: 1 },
        { position: 1, color: "#312e81", opacity: 0.7 },
      ],
      opacity: 1,
      visible: true,
    },
  ],
}) as Extract<SceneNode, { type: "polygon" }>

const star = sceneNodeSchema.parse({
  ...baseNode("parity-star", "Parity star", 240),
  type: "star",
  pointCount: 7,
  innerRadius: 0.42,
  fills: [
    {
      id: "radial",
      type: "radial_gradient",
      center: { x: 0.42, y: 0.58 },
      radiusX: 0.7,
      radiusY: 0.45,
      rotation: 24,
      stops: [
        { position: 0, color: "#fef3c7", opacity: 1 },
        { position: 1, color: "#dc2626", opacity: 1 },
      ],
      opacity: 1,
      visible: true,
    },
  ],
}) as Extract<SceneNode, { type: "star" }>

const vector = sceneNodeSchema.parse({
  ...baseNode("parity-vector", "Parity vector", 400),
  type: "vector",
  path: "M 0 50 C 25 0 75 100 100 50 L 100 100 L 0 100 Z",
  viewBox: "0 0 100 100",
  fillRule: "evenodd",
  fills: [
    {
      id: "image",
      type: "image",
      assetId: "inline-pattern",
      src: imageSource,
      transform: { a: 0.8, b: 0.1, c: -0.1, d: 0.8, e: 0.1, f: 0.05 },
      opacity: 0.9,
      visible: true,
    },
  ],
}) as Extract<SceneNode, { type: "vector" }>

describe("expanded canonical scene model", () => {
  it("round-trips sections, polygons, stars, vectors, boolean results, and every fill kind", () => {
    const nodes = [
      sceneNodeSchema.parse({
        ...baseNode("parity-section", "Parity section", 40),
        type: "section",
        width: 520,
        height: 180,
        radius: 16,
        childNodeIds: [polygon.id, star.id, vector.id],
      }),
      polygon,
      star,
      vector,
      sceneNodeSchema.parse({
        ...baseNode("parity-boolean", "Parity boolean", 560),
        type: "boolean_result",
        operation: "exclude",
        sourceNodeIds: [polygon.id, star.id],
        path: "M 0 0 H 100 V 100 H 0 Z M 25 25 H 75 V 75 H 25 Z",
        viewBox: "0 0 100 100",
        fillRule: "evenodd",
      }),
    ]

    expect(
      nodes.map((node) =>
        sceneNodeSchema.parse(JSON.parse(JSON.stringify(node)))
      )
    ).toEqual(nodes)
    expect(nodes.map((node) => projectNodeForRender(node).type)).toEqual([
      "section",
      "polygon",
      "star",
      "vector",
      "boolean_result",
    ])
    const vectorProjection = projectNodeForRender(vector)
    expect(vectorProjection.type).toBe("vector")
    if (vectorProjection.type !== "vector") return
    expect(vectorProjection.content.fills[0]).toMatchObject({
      type: "image",
      assetId: "inline-pattern",
      transform: { a: 0.8, d: 0.8 },
    })
  })

  it("rejects malformed gradient geometry and singular image transforms", () => {
    expect(() =>
      sceneNodeSchema.parse({
        ...polygon,
        fills: [
          {
            id: "bad-gradient",
            type: "linear_gradient",
            from: { x: 0.5, y: 0.5 },
            to: { x: 0.5, y: 0.5 },
            stops: [
              { position: 1, color: "#000", opacity: 1 },
              { position: 0, color: "#fff", opacity: 1 },
            ],
            opacity: 1,
            visible: true,
          },
        ],
      })
    ).toThrow()
    expect(() =>
      sceneNodeSchema.parse({
        ...vector,
        fills: [
          {
            id: "bad-image",
            type: "image",
            assetId: "inline-pattern",
            src: imageSource,
            transform: { a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 },
            opacity: 1,
            visible: true,
          },
        ],
      })
    ).toThrow("invertible")
  })

  it("projects deterministic polygon and star paths", () => {
    expect(regularPolygonPath(120, 100, 6)).toBe(
      regularPolygonPath(120, 100, 6)
    )
    expect(regularStarPath(120, 100, 7, 0.42)).toBe(
      regularStarPath(120, 100, 7, 0.42)
    )
    expect(regularPolygonPath(120, 100, 6)).toMatch(/^M60 0 L/)
    expect(regularStarPath(120, 100, 7, 0.42).split("L")).toHaveLength(14)
  })

  it("commits the expanded scene as one durable transaction and replays it exactly", () => {
    const section = sceneNodeSchema.parse({
      ...baseNode("transaction-section", "Transaction section", 40),
      type: "section",
      width: 520,
      height: 180,
      radius: 12,
      childNodeIds: [],
    })
    const commands: DocumentCommand[] = [
      addNode(section),
      addNode(polygon),
      addNode(star),
      addNode(vector),
      {
        id: "section-children",
        at,
        actor: "agent",
        type: "update_node",
        nodeId: section.id,
        patch: { childNodeIds: [polygon.id, star.id, vector.id] },
      },
    ]
    const request = {
      version: 1 as const,
      id: "expanded-scene-transaction",
      idempotencyKey: "expanded-scene-transaction",
      title: "Create expanded scene",
      mode: "commit" as const,
      expected: {
        documentId: northstarSeed.id,
        revision: northstarSeed.revision,
        snapshotId: "expanded-scene-snapshot",
        operationVersion: 1,
      },
      commands,
    }
    const first = executeSceneTransaction(
      {
        document: structuredClone(northstarSeed),
        snapshotId: "expanded-scene-snapshot",
        operationVersion: 1,
      },
      request
    )
    expect(first).toMatchObject({
      ok: true,
      changed: true,
      replayed: false,
      commandCount: 5,
    })
    if (!first.ok) return
    const persisted = documentSchema.parse(
      JSON.parse(JSON.stringify(first.document))
    )
    expect(
      persisted.nodes.find((node) => node.id === section.id)
    ).toMatchObject({
      type: "section",
      childNodeIds: [polygon.id, star.id, vector.id],
    })
    const replay = executeSceneTransaction(
      {
        document: persisted,
        snapshotId: "stale-after-save",
        operationVersion: 99,
      },
      request
    )
    expect(replay).toMatchObject({ ok: true, changed: false, replayed: true })
    expect(replay.document).toBe(persisted)
  })

  it("creates an atomic boolean result with remove, hide, and preserve dispositions", () => {
    const withSources = [polygon, star].reduce(
      (document, node) => applyCommand(document, addNode(node)),
      structuredClone(northstarSeed)
    )
    for (const disposition of ["remove", "hide", "preserve"] as const) {
      const resultId = `boolean-${disposition}`
      const result = applyCommand(withSources, {
        id: `create-${resultId}`,
        at,
        actor: "agent",
        type: "create_boolean_result",
        pageId,
        sourceNodeIds: [polygon.id, star.id],
        sourceDisposition: disposition,
        result: {
          ...baseNode(resultId, `Boolean ${disposition}`, 560),
          type: "boolean_result",
          operation: "union",
          sourceNodeIds: [polygon.id, star.id],
          path: "M 0 0 H 120 V 100 H 0 Z",
          viewBox: "0 0 120 100",
          fillRule: "nonzero",
        },
      })
      expect(result.nodes.find((node) => node.id === resultId)?.type).toBe(
        "boolean_result"
      )
      const sources = result.nodes.filter((node) =>
        [polygon.id, star.id].includes(node.id)
      )
      expect(sources).toHaveLength(disposition === "remove" ? 0 : 2)
      if (disposition === "hide") {
        expect(sources.every((node) => !node.visible)).toBe(true)
      }
      if (disposition === "preserve") {
        expect(sources.every((node) => node.visible)).toBe(true)
      }
    }
  })

  it("converts authored geometry to a same-identity vector", () => {
    let document = applyCommand(structuredClone(northstarSeed), addNode(star))
    document = applyCommand(document, {
      id: "convert-star",
      at,
      actor: "agent",
      type: "convert_node_to_vector",
      nodeId: star.id,
    })
    const converted = document.nodes.find((node) => node.id === star.id)
    expect(converted).toMatchObject({
      id: star.id,
      name: star.name,
      type: "vector",
      viewBox: `0 0 ${star.width} ${star.height}`,
      path: regularStarPath(
        star.width,
        star.height,
        star.pointCount,
        star.innerRadius
      ),
    })
    expect(
      documentCommandSchema.parse({
        id: "convert-schema",
        at,
        actor: "agent",
        type: "convert_node_to_vector",
        nodeId: star.id,
      }).type
    ).toBe("convert_node_to_vector")
  })

  it("rejects conversion while a removed property remains variable-bound", () => {
    let document = applyCommand(structuredClone(northstarSeed), {
      id: "create-radius-variable",
      at,
      actor: "agent",
      type: "create_variable",
      variable: {
        id: "radius-variable",
        name: "Corner radius",
        type: "number",
        value: 20,
      },
    })
    document = applyCommand(document, {
      id: "bind-radius-variable",
      at,
      actor: "agent",
      type: "bind_variable",
      binding: {
        id: "radius-binding",
        variableId: "radius-variable",
        target: { kind: "node", nodeId: "cover-panel", property: "radius" },
      },
    })

    expect(() =>
      applyCommand(document, {
        id: "convert-bound-rect",
        at,
        actor: "agent",
        type: "convert_node_to_vector",
        nodeId: "cover-panel",
      })
    ).toThrow("does not support variable property radius")
  })

  it("rejects a child owned by both a frame and a section", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === pageId)!
    page.nodeIds.unshift("ownership-section", "ownership-frame")
    document.nodes.push(
      {
        ...baseNode("ownership-section", "Ownership section", 20),
        type: "section",
        width: 640,
        height: 240,
        radius: 12,
        childNodeIds: ["cover-panel"],
      },
      {
        ...baseNode("ownership-frame", "Ownership frame", 40),
        type: "frame",
        width: 600,
        height: 200,
        radius: 12,
        children: [
          {
            nodeId: "cover-panel",
            positioning: "absolute",
            horizontalSizing: "fixed",
            verticalSizing: "fixed",
            offsetX: 0,
            offsetY: 0,
            grow: 0,
          },
        ],
        autoLayout: null,
        clipsContent: false,
      }
    )

    expect(
      validateDocument(document).map((issue) => [issue.code, issue.message])
    ).toEqual(
      expect.arrayContaining([
        [
          "invalid_layout",
          expect.stringContaining("multiply owned child cover-panel"),
        ],
      ])
    )
  })

  it("tracks and atomically relinks managed image-fill references", () => {
    const fromAssetId = "local-pattern"
    const from = `asset:local/${fromAssetId}`
    const toAssetId = "asset-abcdefghij"
    const to = `asset:managed/${toAssetId}`
    const painted = sceneNodeSchema.parse({
      ...vector,
      id: "managed-fill-vector",
      fills: [
        {
          id: "managed-image-fill",
          type: "image",
          assetId: fromAssetId,
          src: from,
          transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          opacity: 1,
          visible: true,
        },
      ],
    })
    let document = applyCommand(
      structuredClone(northstarSeed),
      addNode(painted)
    )
    const keys = assetReferenceKeysForSource(document, from)
    expect(keys).toEqual([`node/${painted.id}/fills/managed-image-fill/src`])
    document = applyCommand(document, {
      id: "relink-image-fill",
      at,
      actor: "agent",
      type: "relink_asset_references",
      from,
      toAssetId,
      toSource: to,
      expectedReferenceKeys: keys,
    })
    const relinked = document.nodes.find((node) => node.id === painted.id)
    expect(relinked).toMatchObject({
      fills: [
        {
          id: "managed-image-fill",
          assetId: toAssetId,
          src: to,
        },
      ],
    })
  })
})
