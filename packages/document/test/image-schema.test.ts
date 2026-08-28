import { describe, expect, it } from "vitest"
import {
  imageFrameMaskSchema,
  imagePlacementSchema,
  sceneNodeSchema,
} from "../src"

const placement = {
  mode: "manual" as const,
  focalX: 0.2,
  focalY: 0.8,
  zoom: 0.75,
  rotation: -35,
  flipX: true,
  flipY: false,
}

describe("image schema version 2", () => {
  it("accepts readable non-destructive placement and every honest frame mask", () => {
    expect(imagePlacementSchema.parse(placement)).toEqual(placement)
    expect(imageFrameMaskSchema.parse({ shape: "rectangle" })).toEqual({
      shape: "rectangle",
    })
    expect(imageFrameMaskSchema.parse({ shape: "ellipse" })).toEqual({
      shape: "ellipse",
    })
    expect(
      imageFrameMaskSchema.parse({
        shape: "rounded_rectangle",
        radius: 0.25,
      })
    ).toEqual({ shape: "rounded_rectangle", radius: 0.25 })
  })

  it("rejects invalid placement bounds, unknown transform keys, and unsafe masks", () => {
    expect(
      imagePlacementSchema.safeParse({ ...placement, focalX: 1.01 }).success
    ).toBe(false)
    expect(
      imagePlacementSchema.safeParse({ ...placement, zoom: 0 }).success
    ).toBe(false)
    expect(
      imagePlacementSchema.safeParse({ ...placement, rotation: 181 }).success
    ).toBe(false)
    expect(
      imagePlacementSchema.safeParse({ ...placement, skewX: 0.2 }).success
    ).toBe(false)
    expect(
      imageFrameMaskSchema.safeParse({
        shape: "rounded_rectangle",
        radius: 0.51,
      }).success
    ).toBe(false)
    expect(
      imageFrameMaskSchema.safeParse({ shape: "path", path: "M0 0" }).success
    ).toBe(false)
  })

  it("defaults new image nodes without retaining legacy fit/crop truth", () => {
    const image = sceneNodeSchema.parse({
      id: "image-default",
      type: "image",
      name: "Default image",
      assetId: "asset-default",
      src: "https://assets.example.test/default.png",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })

    expect(image).toMatchObject({
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      decorative: false,
      alt: "",
    })
    expect(image).not.toHaveProperty("fit")
    expect(image).not.toHaveProperty("cropX")
    expect(image).not.toHaveProperty("cropY")
  })

  it("requires decorative images to use an empty alternative description", () => {
    const base = {
      id: "decorative-image",
      type: "image" as const,
      name: "Decorative image",
      assetId: "asset-decorative",
      src: "https://assets.example.test/decorative.png",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      decorative: true,
    }
    expect(sceneNodeSchema.safeParse({ ...base, alt: "" }).success).toBe(true)
    expect(
      sceneNodeSchema.safeParse({ ...base, alt: "A visible description" })
        .success
    ).toBe(false)
  })
})
