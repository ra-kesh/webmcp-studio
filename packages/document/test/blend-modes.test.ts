import { describe, expect, it } from "vitest"
import {
  blendModeSchema,
  componentOverridePropertySchema,
  northstarSeed,
  projectNodeForRender,
  sceneNodePatchSchema,
} from "../src"

describe("layer blend modes", () => {
  it("admits the bounded CSS/Canvas blend vocabulary and rejects compositing operators", () => {
    expect(blendModeSchema.options).toEqual([
      "normal",
      "darken",
      "multiply",
      "color-burn",
      "lighten",
      "screen",
      "color-dodge",
      "overlay",
      "soft-light",
      "hard-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    expect(sceneNodePatchSchema.parse({ blendMode: "multiply" })).toEqual({
      blendMode: "multiply",
    })
    expect(() =>
      sceneNodePatchSchema.parse({ blendMode: "source-in" })
    ).toThrow()
    expect(() =>
      sceneNodePatchSchema.parse({ blendMode: "pass-through" })
    ).toThrow()
    expect(componentOverridePropertySchema.parse("blendMode")).toBe(
      "blendMode"
    )
  })

  it("resolves legacy absence to normal and preserves every admitted mode", () => {
    const node = northstarSeed.nodes[0]!
    expect(projectNodeForRender(node).frame.blendMode).toBe("normal")
    for (const blendMode of blendModeSchema.options) {
      expect(projectNodeForRender({ ...node, blendMode }).frame.blendMode).toBe(
        blendMode
      )
    }
  })
})
