import { Group } from "fabric"
import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import { createFabricSyncObject } from "../src/fabric-adapter"

describe("Fabric paint stacks", () => {
  it("builds one ordered atomic group with per-paint compositing state", () => {
    const base = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!base || base.type !== "rect") throw new Error("Expected rectangle")
    const object = createFabricSyncObject({
      ...base,
      fills: [
        {
          id: "hidden-base",
          color: "#102030",
          opacity: 0.25,
          visible: false,
          blendMode: "multiply",
        },
        {
          id: "accent",
          color: "#abcdef",
          opacity: 0.75,
          visible: true,
          blendMode: "screen",
        },
      ],
      strokes: [
        {
          id: "edge",
          color: "#fedcba",
          width: 5,
          opacity: 0.5,
          visible: true,
          blendMode: "overlay",
        },
      ],
    })
    expect(object).toBeInstanceOf(Group)
    const children = (object as Group).getObjects()
    expect(children).toHaveLength(4)
    const paints = children.slice(1)
    expect(paints.map((paint) => paint.fill)).toEqual([
      "#102030",
      "#abcdef",
      "rgba(0,0,0,0)",
    ])
    expect(paints.map((paint) => paint.opacity)).toEqual([0.25, 0.75, 0.5])
    expect(paints.map((paint) => paint.visible)).toEqual([false, true, true])
    expect(paints.map((paint) => paint.globalCompositeOperation)).toEqual([
      "multiply",
      "screen",
      "overlay",
    ])
    expect(paints[2]?.stroke).toBe("#fedcba")
    expect(paints[2]?.strokeWidth).toBe(5)
  })

  it("projects partial outside strokes as dashed Fabric line children", () => {
    const base = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!base || base.type !== "rect") throw new Error("Expected rectangle")
    const object = createFabricSyncObject({
      ...base,
      fills: [],
      strokes: [
        {
          id: "partial",
          color: "#13579b",
          width: 8,
          opacity: 0.6,
          visible: true,
          alignment: "outside",
          sides: { top: true, right: false, bottom: true, left: false },
          dash: [12, 4],
          cap: "round",
          join: "bevel",
          miterLimit: 7,
        },
      ],
    }) as Group
    const children = object.getObjects()
    expect(children).toHaveLength(3)
    expect(children.slice(1).map((child) => child.type)).toEqual([
      "line",
      "line",
    ])
    expect(children.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stroke: "#13579b",
          strokeWidth: 8,
          strokeDashArray: [12, 4],
          strokeLineCap: "round",
          strokeLineJoin: "bevel",
          strokeMiterLimit: 7,
        }),
      ])
    )
  })

  it("applies the ordered effect filter to one atomic Fabric wrapper", () => {
    const base = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!base || base.type !== "rect") throw new Error("Expected rectangle")
    const object = createFabricSyncObject({
      ...base,
      effects: [
        {
          id: "shadow",
          type: "drop_shadow",
          color: "#00000040",
          offsetX: 6,
          offsetY: 8,
          blur: 10,
          visible: true,
        },
        { id: "blur", type: "layer_blur", radius: 4, visible: true },
      ],
    }) as Group & { effectFilter: string }
    expect(object).toBeInstanceOf(Group)
    expect(object.effectFilter).toBe(
      "drop-shadow(6px 8px 10px #00000040) blur(4px)"
    )
    expect(object.getObjects()).toHaveLength(1)
  })
})
