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
})
