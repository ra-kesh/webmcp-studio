import { describe, expect, it } from "vitest"
import {
  compareHorizontalInkBands,
  extractHorizontalInkBands,
  type RgbaImage,
} from "./render-conformance-geometry"

const white = [255, 255, 255] as const
const black = [0, 0, 0] as const

function imageWithBands(
  bands: readonly Readonly<{
    left: number
    top: number
    right: number
    bottom: number
    value?: number
    color?: readonly [number, number, number]
    alpha?: number
    outerColumnsOnly?: boolean
  }>[]
): RgbaImage {
  const width = 32
  const height = 24
  const data = new Uint8Array(width * height * 4).fill(255)
  for (const band of bands) {
    for (let y = band.top; y <= band.bottom; y += 1) {
      for (let x = band.left; x <= band.right; x += 1) {
        if (band.outerColumnsOnly && x !== band.left && x !== band.right) {
          continue
        }
        const offset = (y * width + x) * 4
        const value = band.value ?? 0
        const color = band.color ?? [value, value, value]
        data[offset] = color[0]
        data[offset + 1] = color[1]
        data[offset + 2] = color[2]
        data[offset + 3] = band.alpha ?? 255
      }
    }
  }
  return { data, width, height }
}

function extract(image: RgbaImage) {
  return extractHorizontalInkBands(
    image,
    { left: 0, top: 0, right: image.width, bottom: image.height },
    {
      background: white,
      foreground: black,
      minimumContrastFraction: 0.2,
      minimumInkPixelsPerRow: 2,
    }
  )
}

const limits = {
  maximumEdgeDelta: 1,
  maximumInkMassRatioDelta: 0.1,
  maximumContrastFractionDelta: 0.1,
  minimumDirectionCosine: 0.98,
} as const

describe("render conformance ink geometry", () => {
  it("accepts small raster intensity changes while preserving semantics", () => {
    const baseline = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6 },
        { left: 7, top: 12, right: 24, bottom: 15 },
      ])
    )
    const candidate = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6, value: 10 },
        { left: 7, top: 12, right: 24, bottom: 15, value: 15 },
      ])
    )

    expect(
      compareHorizontalInkBands(baseline, candidate, {
        ...limits,
        maximumEdgeDelta: 0,
      })
    ).toMatchObject({
      passed: true,
      maximumEdgeDelta: 0,
      reason: null,
    })
  })

  it("accepts at most one edge pixel and reports every measured edge", () => {
    const baseline = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )
    const candidate = extract(
      imageWithBands([{ left: 3, top: 4, right: 17, bottom: 7 }])
    )
    const result = compareHorizontalInkBands(baseline, candidate, limits)

    expect(result.passed).toBe(true)
    expect(result.maximumEdgeDelta).toBe(1)
    expect(result.bands[0]?.edgeDeltas).toEqual({
      top: 1,
      bottom: 1,
      left: 1,
      right: 1,
    })
  })

  it("treats equal-energy underline rasterizations as equivalent", () => {
    const baseline = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 3, alpha: 128 },
        { left: 4, top: 4, right: 18, bottom: 4 },
        { left: 4, top: 5, right: 18, bottom: 5, alpha: 128 },
      ])
    )
    const candidate = extract(
      imageWithBands([{ left: 4, top: 4, right: 18, bottom: 5 }])
    )
    const result = compareHorizontalInkBands(baseline, candidate, limits)

    expect(result).toMatchObject({
      passed: true,
      maximumEdgeDelta: 1,
      reason: null,
    })
    expect(result.maximumInkMassRatioDelta).toBeLessThan(0.01)
  })

  it("rejects a two-pixel edge displacement", () => {
    const baseline = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )
    const candidate = extract(
      imageWithBands([{ left: 4, top: 5, right: 18, bottom: 8 }])
    )

    expect(
      compareHorizontalInkBands(baseline, candidate, limits)
    ).toMatchObject({
      passed: false,
      maximumEdgeDelta: 2,
    })
  })

  it("rejects changed wrapping and missing ink", () => {
    const twoLines = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6 },
        { left: 4, top: 12, right: 18, bottom: 15 },
      ])
    )
    const oneLine = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )

    expect(compareHorizontalInkBands(twoLines, oneLine, limits)).toMatchObject({
      passed: false,
      reason: "Text line-band count changed from 2 to 1.",
    })
    expect(compareHorizontalInkBands(twoLines, [], limits)).toMatchObject({
      passed: false,
      reason: "Text ink was not detected in both captures.",
    })
  })

  it("rejects missing glyph interiors even when every outer edge matches", () => {
    const baseline = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )
    const candidate = extract(
      imageWithBands([
        {
          left: 4,
          top: 3,
          right: 18,
          bottom: 6,
          outerColumnsOnly: true,
        },
      ])
    )

    expect(
      compareHorizontalInkBands(baseline, candidate, limits)
    ).toMatchObject({
      passed: false,
      maximumEdgeDelta: 0,
      reason: expect.stringContaining("ink mass changed"),
    })
  })

  it("rejects the wrong foreground hue with unchanged geometry", () => {
    const baseline = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )
    const candidate = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6, color: [255, 0, 0] },
      ])
    )

    expect(
      compareHorizontalInkBands(baseline, candidate, {
        ...limits,
        maximumContrastFractionDelta: 1,
      })
    ).toMatchObject({
      passed: false,
      maximumEdgeDelta: 0,
      reason: expect.stringContaining("direction cosine"),
    })
  })

  it("compares multicolor ink direction against its retained baseline", () => {
    const baseline = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6, color: [180, 20, 80] },
      ])
    )
    const unchanged = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6, color: [180, 20, 80] },
      ])
    )
    const changed = extract(
      imageWithBands([
        { left: 4, top: 3, right: 18, bottom: 6, color: [20, 140, 80] },
      ])
    )
    const multicolorLimits = {
      ...limits,
      minimumDirectionCosine: 0,
      maximumDirectionCosineDelta: 0.01,
    }

    expect(
      compareHorizontalInkBands(baseline, unchanged, multicolorLimits)
    ).toMatchObject({ passed: true, maximumDirectionCosineDelta: 0 })
    expect(
      compareHorizontalInkBands(baseline, changed, multicolorLimits)
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("direction cosine changed"),
    })
  })

  it("rejects materially reduced foreground opacity", () => {
    const baseline = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6 }])
    )
    const candidate = extract(
      imageWithBands([{ left: 4, top: 3, right: 18, bottom: 6, alpha: 128 }])
    )

    expect(
      compareHorizontalInkBands(baseline, candidate, limits)
    ).toMatchObject({
      passed: false,
      maximumEdgeDelta: 0,
      reason: expect.stringContaining("contrast changed"),
    })
  })
})
