import { describe, expect, it } from "vitest"
import {
  projectNodeForRender,
  scaleStrokePaints,
  sceneNodeSchema,
  strokeStackBounds,
  type StrokePaint,
} from "../src"

const rectangle = {
  id: "advanced-stroke-rect",
  type: "rect" as const,
  name: "Advanced stroke",
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  flipX: false,
  flipY: false,
  blendMode: "normal" as const,
  fill: "#fff",
  radius: 0,
  strokeWidth: 0,
}

describe("advanced strokes", () => {
  it("validates strict advanced records and rejects unsupported geometry", () => {
    const { radius: _radius, ...ellipse } = rectangle
    expect(() =>
      sceneNodeSchema.parse({
        ...rectangle,
        strokes: [
          {
            id: "invalid",
            color: "#000",
            width: 2,
            opacity: 1,
            visible: true,
            dash: [0, 0],
          },
        ],
      })
    ).toThrow("positive segment")
    expect(() =>
      sceneNodeSchema.parse({
        ...ellipse,
        type: "ellipse",
        strokes: [
          {
            id: "partial",
            color: "#000",
            width: 2,
            opacity: 1,
            visible: true,
            sides: { top: true, right: false, bottom: true, left: false },
          },
        ],
      })
    ).toThrow("Independent stroke sides")
  })

  it("projects complete defaults and preserves authored stroke semantics", () => {
    const node = sceneNodeSchema.parse({
      ...rectangle,
      strokes: [
        {
          id: "advanced",
          color: "#123456",
          width: 6,
          opacity: 0.8,
          visible: true,
          alignment: "outside",
          sides: { top: true, right: false, bottom: true, left: false },
          dash: [8, 3],
          cap: "round",
          join: "bevel",
          miterLimit: 9,
        },
      ],
    })
    const projection = projectNodeForRender(node)
    if (projection.type !== "rect") throw new Error("Expected rectangle")
    expect(projection.content.strokes[0]).toMatchObject({
      alignment: "outside",
      sides: { top: true, right: false, bottom: true, left: false },
      dash: [8, 3],
      cap: "round",
      join: "bevel",
      miterLimit: 9,
    })
  })

  it("computes deterministic paint bounds and scales dimensional fields", () => {
    const strokes: StrokePaint[] = [
      {
        id: "hidden-large",
        color: "#000",
        width: 20,
        opacity: 1,
        visible: false,
        alignment: "outside",
      },
      {
        id: "visible",
        color: "#000",
        width: 6,
        opacity: 1,
        visible: true,
        alignment: "outside",
        dash: [8, 4],
      },
    ]
    expect(
      strokeStackBounds({ x: 10, y: 20, width: 100, height: 80 }, strokes)
    ).toEqual({
      x: 4,
      y: 14,
      width: 112,
      height: 92,
    })
    expect(scaleStrokePaints(strokes, 2)?.[1]).toMatchObject({
      width: 12,
      dash: [16, 8],
    })
  })
})
