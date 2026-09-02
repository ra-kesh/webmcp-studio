import { describe, expect, it } from "vitest"
import {
  applyCommand,
  buildComponentPublicationJourney,
  componentOverridePropertySchema,
  northstarSeed,
  projectNodeForRender,
  sceneNodePatchSchema,
  sceneNodeSchema,
  type DocumentCommand,
} from "../src"

const rect = () => {
  const node = northstarSeed.nodes.find(
    (candidate) => candidate.type === "rect"
  )
  if (!node || node.type !== "rect") throw new Error("Expected seed rectangle")
  return structuredClone(node)
}

const update = (
  patch: Extract<DocumentCommand, { type: "update_node" }>["patch"]
) =>
  applyCommand(structuredClone(northstarSeed), {
    id: "paint-stack-update",
    at: "2026-09-02T00:00:00.000Z",
    actor: "human",
    type: "update_node",
    nodeId: rect().id,
    patch,
  })

describe("ordered fill and stroke stacks", () => {
  it("preserves legacy schema bytes while projecting one compatible paint", () => {
    const legacy = rect()
    const serialized = JSON.stringify(legacy)
    const parsed = sceneNodeSchema.parse(JSON.parse(serialized))
    expect(JSON.stringify(parsed)).toBe(serialized)
    expect(parsed).not.toHaveProperty("fills")
    expect(parsed).not.toHaveProperty("strokes")
    if (parsed.type !== "rect") throw new Error("Expected rectangle")
    const projection = projectNodeForRender(parsed)
    if (projection.type !== "rect") throw new Error("Expected rectangle")
    expect(projection.content.fills).toEqual([
      {
        id: "legacy-fill",
        color: parsed.fill,
        opacity: 1,
        visible: true,
        blendMode: "normal",
      },
    ])
  })

  it("treats explicit empty arrays as no paint and validates strict unique records", () => {
    expect(sceneNodePatchSchema.parse({ fills: [], strokes: [] })).toEqual({
      fills: [],
      strokes: [],
    })
    const parsed = sceneNodeSchema.parse({ ...rect(), fills: [], strokes: [] })
    const projection = projectNodeForRender(parsed)
    if (projection.type !== "rect") throw new Error("Expected rectangle")
    expect(projection.content.fills).toEqual([])
    expect(projection.content.strokes).toEqual([])
    expect(() =>
      sceneNodePatchSchema.parse({
        fills: [
          { id: "same", color: "#000", opacity: 1, visible: true },
          { id: "same", color: "#fff", opacity: 1, visible: true },
        ],
      })
    ).toThrow("Paint IDs must be unique")
    expect(() =>
      sceneNodePatchSchema.parse({
        fills: [
          {
            id: "fill-1",
            color: "#000",
            opacity: 1,
            visible: true,
            rendererPaint: "unsafe",
          },
        ],
      })
    ).toThrow()
  })

  it("preserves author order, visibility, opacity, and blend semantics", () => {
    const fills = [
      {
        id: "base",
        color: "#0f172a",
        opacity: 0.4,
        visible: false,
        blendMode: "multiply" as const,
      },
      {
        id: "accent",
        color: "#f97316",
        opacity: 0.8,
        visible: true,
        blendMode: "screen" as const,
      },
    ]
    const strokes = [
      {
        id: "outer",
        color: "#fff",
        width: 6,
        opacity: 0.25,
        visible: true,
        blendMode: "overlay" as const,
      },
      {
        id: "inner",
        color: "#000",
        width: 2,
        opacity: 1,
        visible: false,
      },
    ]
    const document = update({ fills, strokes })
    const node = document.nodes.find((candidate) => candidate.id === rect().id)!
    const projection = projectNodeForRender(node)
    if (projection.type !== "rect") throw new Error("Expected rectangle")
    expect(projection.content.fills.map((paint) => paint.id)).toEqual([
      "base",
      "accent",
    ])
    expect(projection.content.fills).toMatchObject(fills)
    expect(projection.content.strokes).toMatchObject(strokes)
    expect(node).toMatchObject({
      fill: "#0f172a",
      stroke: "#fff",
      strokeWidth: 6,
    })
  })

  it("synchronizes legacy primary-paint edits without losing later paints", () => {
    const stacked = update({
      fills: [
        { id: "hidden", color: "#111", opacity: 1, visible: false },
        { id: "kept", color: "#222", opacity: 0.5, visible: true },
      ],
      strokes: [
        { id: "primary", color: "#333", width: 4, opacity: 1, visible: true },
        {
          id: "kept-stroke",
          color: "#444",
          width: 2,
          opacity: 1,
          visible: true,
        },
      ],
    })
    const next = applyCommand(stacked, {
      id: "legacy-primary-edit",
      at: "2026-09-02T00:01:00.000Z",
      actor: "human",
      type: "update_node",
      nodeId: rect().id,
      patch: { fill: "#abc", stroke: "#def", strokeWidth: 9 },
    })
    const node = next.nodes.find((candidate) => candidate.id === rect().id)
    expect(node).toMatchObject({
      fill: "#abc",
      fills: [
        { id: "hidden", color: "#abc", visible: false },
        { id: "kept", color: "#222" },
      ],
      stroke: "#def",
      strokeWidth: 9,
      strokes: [
        { id: "primary", color: "#def", width: 9 },
        { id: "kept-stroke", color: "#444", width: 2 },
      ],
    })

    const empty = update({ fills: [] })
    const afterLegacyEdit = applyCommand(empty, {
      id: "empty-primary-edit",
      at: "2026-09-02T00:02:00.000Z",
      actor: "human",
      type: "update_node",
      nodeId: rect().id,
      patch: { fill: "#123" },
    })
    const emptyNode = afterLegacyEdit.nodes.find(
      (candidate) => candidate.id === rect().id
    )!
    expect(emptyNode).toMatchObject({ fill: "#123", fills: [] })
    const emptyProjection = projectNodeForRender(emptyNode)
    if (emptyProjection.type !== "rect") throw new Error("Expected rectangle")
    expect(emptyProjection.content.fills).toEqual([])
  })

  it("admits paint stacks as component override properties", () => {
    expect(componentOverridePropertySchema.parse("fills")).toBe("fills")
    expect(componentOverridePropertySchema.parse("strokes")).toBe("strokes")
  })

  it("propagates primary paint styles and variables without flattening the stack", () => {
    let document = update({
      fills: [
        { id: "primary", color: "#111", opacity: 1, visible: true },
        { id: "secondary", color: "#222", opacity: 0.5, visible: true },
      ],
    })
    document = applyCommand(document, {
      id: "create-stack-style",
      at: "2026-09-02T00:03:00.000Z",
      actor: "human",
      type: "create_paint_style",
      style: {
        id: "stack-style",
        name: "Stack primary",
        color: "#f97316",
        opacity: 0.7,
      },
    })
    document = applyCommand(document, {
      id: "apply-stack-style",
      at: "2026-09-02T00:04:00.000Z",
      actor: "human",
      type: "apply_paint_style",
      styleId: "stack-style",
      targets: [{ nodeId: rect().id }],
    })
    expect(document.nodes.find((node) => node.id === rect().id)).toMatchObject({
      fills: [
        { id: "primary", color: "#f97316", opacity: 0.7 },
        { id: "secondary", color: "#222", opacity: 0.5 },
      ],
    })
    document = applyCommand(document, {
      id: "create-stack-variable",
      at: "2026-09-02T00:05:00.000Z",
      actor: "human",
      type: "create_variable",
      variable: {
        id: "stack-color",
        name: "Stack color",
        type: "color",
        value: "#0ea5e9",
      },
    })
    document = applyCommand(document, {
      id: "bind-stack-variable",
      at: "2026-09-02T00:06:00.000Z",
      actor: "human",
      type: "bind_variable",
      binding: {
        id: "stack-color-binding",
        variableId: "stack-color",
        target: { kind: "node", nodeId: rect().id, property: "fill" },
      },
    })
    expect(document.nodes.find((node) => node.id === rect().id)).toMatchObject({
      fill: "#0ea5e9",
      fills: [
        { id: "primary", color: "#0ea5e9" },
        { id: "secondary", color: "#222" },
      ],
    })
  })

  it("preserves ordered stacks through component instance overrides", () => {
    const journey = buildComponentPublicationJourney()
    const instance = journey.instanceCreated.componentInstances[0]!
    const updated = applyCommand(journey.instanceCreated, {
      id: "component-stack-override",
      at: "2026-09-02T00:07:00.000Z",
      actor: "human",
      type: "update_component_instance",
      instanceId: instance.id,
      sourceNodeId: "cover-panel",
      patch: {
        fills: [
          { id: "base", color: "#111", opacity: 1, visible: true },
          { id: "accent", color: "#f60", opacity: 0.5, visible: true },
        ],
        strokes: [
          { id: "edge", color: "#fff", width: 4, opacity: 1, visible: true },
        ],
      },
    })
    expect(instance.overrides["cover-panel"]).toBeUndefined()
    expect(
      updated.componentInstances[0]?.overrides["cover-panel"]
    ).toMatchObject({
      fills: [{ id: "base" }, { id: "accent" }],
      strokes: [{ id: "edge", width: 4 }],
    })
    const instanceNodeId = instance.nodeMappings.find(
      (mapping) => mapping.sourceNodeId === "cover-panel"
    )!.instanceNodeId
    expect(
      updated.nodes.find((node) => node.id === instanceNodeId)
    ).toMatchObject({
      fills: [{ id: "base" }, { id: "accent" }],
      strokes: [{ id: "edge", width: 4 }],
    })
  })
})
