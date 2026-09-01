import { describe, expect, it } from "vitest"
import {
  imageFrameMaskSchema,
  componentOverridePropertySchema,
  northstarSeed,
  projectImagePaint,
  projectNodeForRender,
  resolveCornerRadii,
  roundedRectanglePath,
  sceneNodePatchSchema,
  sceneNodeSchema,
  scaleCornerRadii,
} from "../src"

describe("independent corner geometry", () => {
  it("keeps legacy uniform-radius documents byte-compatible at the schema boundary", () => {
    const legacy = northstarSeed.nodes.find((node) => node.type === "rect")!
    const parsed = sceneNodeSchema.parse(legacy)
    expect(parsed).not.toHaveProperty("independentCorners")
    expect(parsed).not.toHaveProperty("cornerRadii")
    expect(parsed).not.toHaveProperty("cornerSmoothing")
    if (parsed.type !== "rect") throw new Error("Expected rectangle")
    const projection = projectNodeForRender(parsed)
    if (projection.type !== "rect") throw new Error("Expected rectangle")
    expect(projection.content.corners).toMatchObject({
      independent: false,
      smoothing: 0,
      radii: resolveCornerRadii(parsed.radius),
    })
  })

  it("admits a complete four-corner patch and rejects partial or unbounded values", () => {
    const patch = {
      independentCorners: true,
      cornerRadii: {
        topLeft: 4,
        topRight: 12,
        bottomRight: 20,
        bottomLeft: 28,
      },
      cornerSmoothing: 0.6,
    }
    expect(sceneNodePatchSchema.parse(patch)).toEqual(patch)
    expect(() =>
      sceneNodePatchSchema.parse({ cornerRadii: { topLeft: 4 } })
    ).toThrow()
    expect(() =>
      sceneNodePatchSchema.parse({ cornerSmoothing: 1.01 })
    ).toThrow()
    const rect = northstarSeed.nodes.find((node) => node.type === "rect")!
    expect(() =>
      sceneNodeSchema.parse({ ...rect, independentCorners: true })
    ).toThrow("Independent corners require all four corner radii")
    expect(componentOverridePropertySchema.parse("cornerRadii")).toBe(
      "cornerRadii"
    )
    expect(componentOverridePropertySchema.parse("independentCorners")).toBe(
      "independentCorners"
    )
    expect(componentOverridePropertySchema.parse("cornerSmoothing")).toBe(
      "cornerSmoothing"
    )
  })

  it("builds deterministic budget-clamped smooth paths without invalid coordinates", () => {
    const input = {
      width: 200,
      height: 120,
      cornerRadii: {
        topLeft: 80,
        topRight: 40,
        bottomRight: 24,
        bottomLeft: 12,
      },
      cornerSmoothing: 0.75,
    }
    const first = roundedRectanglePath(input)
    expect(roundedRectanglePath(input)).toBe(first)
    expect(first).toMatch(/^M /)
    expect(first).toMatch(/ C /)
    expect(first).toMatch(/ Z$/)
    expect(first).not.toMatch(/NaN|Infinity/)
    const coordinates = [...first.matchAll(/-?\d+(?:\.\d+)?/g)].map(
      (match) => Number(match[0])
    )
    expect(coordinates.length).toBeGreaterThan(20)
    expect(coordinates.length % 2).toBe(0)
    coordinates.forEach((coordinate, index) => {
      expect(coordinate).toBeGreaterThanOrEqual(0)
      expect(coordinate).toBeLessThanOrEqual(index % 2 === 0 ? 200 : 120)
    })
    expect(first).not.toBe(
      roundedRectanglePath({ ...input, cornerSmoothing: 0 })
    )
  })

  it("scales absolute shape corners and projects normalized image corners", () => {
    expect(
      scaleCornerRadii(
        { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
        1.5
      )
    ).toEqual({ topLeft: 6, topRight: 12, bottomRight: 18, bottomLeft: 24 })

    const frameMask = imageFrameMaskSchema.parse({
      shape: "rounded_rectangle",
      radius: 0.1,
      cornerRadii: {
        topLeft: 0.05,
        topRight: 0.1,
        bottomRight: 0.15,
        bottomLeft: 0.2,
      },
      cornerSmoothing: 0.5,
    })
    const paint = projectImagePaint({
      frame: { width: 200, height: 100 },
      naturalSize: { width: 400, height: 200 },
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask,
    })
    expect(paint.clip).toMatchObject({
      shape: "rounded_rectangle",
      radius: 10,
      cornerRadii: {
        topLeft: 5,
        topRight: 10,
        bottomRight: 15,
        bottomLeft: 20,
      },
      cornerSmoothing: 0.5,
    })
  })
})
