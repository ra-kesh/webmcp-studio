import { describe, expect, it } from "vitest"
import {
  layerEffectBounds,
  layerEffectFilter,
  scaleLayerEffects,
  sceneNodeSchema,
} from "../src"

const base = {
  id: "effects-rect",
  type: "rect" as const,
  name: "Effects",
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: "#ffffff",
  radius: 0,
  strokeWidth: 0,
}

const effects = [
  {
    id: "shadow",
    type: "drop_shadow" as const,
    color: "#00000040",
    offsetX: 6,
    offsetY: 8,
    blur: 10,
    visible: true,
  },
  { id: "blur", type: "layer_blur" as const, radius: 4, visible: true },
]

describe("ordered layer effects", () => {
  it("validates strict unique bounded effects and resource budgets", () => {
    expect(sceneNodeSchema.parse({ ...base, effects })).toMatchObject({
      effects,
    })
    expect(() =>
      sceneNodeSchema.parse({ ...base, effects: [effects[0], effects[0]] })
    ).toThrow("Effect IDs must be unique")
    expect(() =>
      sceneNodeSchema.parse({
        ...base,
        effects: [
          { ...effects[1], id: "a", radius: 64 },
          { ...effects[1], id: "b", radius: 64 },
          { ...effects[1], id: "c", radius: 1 },
        ],
      })
    ).toThrow("blur budget")
  })

  it("preserves authored filter order and computes deterministic bounds", () => {
    expect(layerEffectFilter(effects)).toBe(
      "drop-shadow(6px 8px 10px #00000040) blur(4px)"
    )
    expect(
      layerEffectBounds({ x: 10, y: 20, width: 100, height: 80 }, effects)
    ).toEqual({
      x: -12,
      y: 0,
      width: 156,
      height: 136,
    })
  })

  it("scales every dimensional effect field", () => {
    expect(scaleLayerEffects(effects, 2)).toEqual([
      { ...effects[0], offsetX: 12, offsetY: 16, blur: 20 },
      { ...effects[1], radius: 8 },
    ])
  })
})
