import { describe, expect, it } from "vitest"
import {
  convertSrgbPixelsToLuminanceMask,
  srgbLuminanceMaskAlphaByte,
} from "../src/luminance-mask"

describe("sRGB luminance mask conversion", () => {
  it.each([
    ["black", 0, 0, 0, 255, 0],
    ["white", 255, 255, 255, 255, 255],
    ["red", 255, 0, 0, 255, 54],
    ["green", 0, 255, 0, 255, 182],
    ["blue", 0, 0, 255, 255, 18],
    ["half-alpha white", 255, 255, 255, 128, 128],
    ["transparent green", 0, 255, 0, 0, 0],
  ])(
    "converts coefficient-sensitive %s",
    (_, red, green, blue, alpha, wanted) => {
      expect(srgbLuminanceMaskAlphaByte(red, green, blue, alpha)).toBe(wanted)
    }
  )

  it("rewrites complete RGBA pixels to black Y times A masks", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
    ])
    const converted = convertSrgbPixelsToLuminanceMask(pixels)

    expect(converted).toBe(pixels)
    expect([...pixels]).toEqual([0, 0, 0, 54, 0, 0, 0, 92, 0, 0, 0, 0])
  })

  it("rejects partial pixels", () => {
    expect(() =>
      convertSrgbPixelsToLuminanceMask(new Uint8ClampedArray([1, 2, 3]))
    ).toThrow("complete RGBA")
  })
})
