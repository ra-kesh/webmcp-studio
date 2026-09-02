import { Gradient, Group, Path } from "fabric"
import { describe, expect, it } from "vitest"
import { northstarSeed, sceneNodeSchema } from "@webmcp/document"
import {
  createFabricSyncObject,
  syncFabricObjectFromNode,
} from "../src/fabric-adapter"

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

  it("builds expanded vector geometry with native Fabric gradients", () => {
    const polygon = sceneNodeSchema.parse({
      id: "fabric-gradient-polygon",
      type: "polygon",
      name: "Fabric gradient polygon",
      x: 20,
      y: 30,
      width: 160,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      pointCount: 6,
      fill: "#111827",
      strokeWidth: 0,
      fills: [
        {
          id: "linear",
          type: "linear_gradient",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          stops: [
            { position: 0, color: "#0ea5e9", opacity: 1 },
            { position: 1, color: "#312e81", opacity: 0.5 },
          ],
          opacity: 1,
          visible: true,
        },
        {
          id: "radial",
          type: "radial_gradient",
          center: { x: 0.4, y: 0.6 },
          radiusX: 0.7,
          radiusY: 0.4,
          rotation: 30,
          stops: [
            { position: 0, color: "#fef3c7", opacity: 1 },
            { position: 1, color: "#dc2626", opacity: 1 },
          ],
          opacity: 1,
          visible: true,
        },
      ],
    })
    if (polygon.type !== "polygon") throw new Error("Expected polygon")
    const object = createFabricSyncObject(polygon) as Group
    const paintPaths = object
      .getObjects()
      .slice(1)
      .map((paint) =>
        paint instanceof Group
          ? paint.getObjects().find((child) => child instanceof Path)
          : paint
      )
    expect(paintPaths).toHaveLength(2)
    expect(paintPaths.every((paint) => paint instanceof Path)).toBe(true)
    expect(paintPaths.map((paint) => paint?.fill instanceof Gradient)).toEqual([
      true,
      true,
    ])
    const [linear, radial] = paintPaths.map(
      (paint) => paint?.fill as Gradient<"linear" | "radial">
    )
    expect(linear.type).toBe("linear")
    expect(linear.gradientUnits).toBe("percentage")
    expect(linear.colorStops[1]?.color).toContain("rgba")
    expect(radial.type).toBe("radial")
    expect(radial.gradientTransform).toHaveLength(6)
  })

  it("recomputes Fabric path bounds when vector geometry changes", () => {
    const vector = sceneNodeSchema.parse({
      id: "fabric-resizable-vector",
      type: "vector",
      name: "Fabric resizable vector",
      x: 20,
      y: 30,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      path: "M 0 0 H 100 V 100 H 0 Z",
      viewBox: "0 0 100 100",
      fillRule: "nonzero",
      fill: "#111827",
      strokeWidth: 0,
    })
    if (vector.type !== "vector") throw new Error("Expected vector")
    const object = createFabricSyncObject(vector) as Group
    const path = object
      .getObjects()
      .find((child): child is Path => child instanceof Path)!
    expect(path.width).toBe(100)

    syncFabricObjectFromNode(object, {
      ...vector,
      path: "M 0 0 H 40 V 100 H 0 Z",
    })

    expect(path.width).toBe(40)
    expect(path.pathOffset.x).toBe(20)
    expect(object.width).toBe(200)
    expect(object.height).toBe(100)
  })
})
