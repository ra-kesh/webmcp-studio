import { Rect } from "fabric"
import { describe, expect, it } from "vitest"
import { fabricObjectToNodePatch } from "../src/fabric-adapter"

describe("Fabric document boundary", () => {
  it("normalizes Fabric transforms into canonical top-left geometry", () => {
    const object = new Rect({
      left: 12.25,
      top: 40.75,
      width: 100,
      height: 80,
      scaleX: 1.5,
      scaleY: 0.5,
      angle: 15,
      originX: "left",
      originY: "top",
      strokeWidth: 0,
    })

    expect(fabricObjectToNodePatch(object)).toEqual({
      x: 12.3,
      y: 40.8,
      width: 150,
      height: 40,
      rotation: 15,
    })
  })

  it("uses a standalone object's canonical origin instead of control bounds", () => {
    const object = new Rect({
      left: 470,
      top: 727,
      width: 300,
      height: 300,
      originX: "left",
      originY: "top",
      padding: 10,
      strokeWidth: 0,
    })

    expect(fabricObjectToNodePatch(object)).toMatchObject({ x: 470, y: 727 })
  })
})
