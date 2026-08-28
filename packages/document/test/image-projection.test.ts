import { describe, expect, it } from "vitest"
import {
  IMAGE_PLACEMENT_MAX_ZOOM,
  projectImageLayout,
  projectImagePaint,
  type RenderImageAffine,
} from "../src/render-projection"
import type { ImagePlacement } from "../src/schema"

const centeredFill: ImagePlacement = {
  mode: "fill",
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

function applyTransform(
  transform: RenderImageAffine,
  point: { x: number; y: number }
) {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  }
}

function inverseTransform(
  transform: RenderImageAffine,
  point: { x: number; y: number }
) {
  const determinant = transform.a * transform.d - transform.b * transform.c
  return {
    x:
      (transform.d * (point.x - transform.e) -
        transform.c * (point.y - transform.f)) /
      determinant,
    y:
      (-transform.b * (point.x - transform.e) +
        transform.a * (point.y - transform.f)) /
      determinant,
  }
}

describe("image paint projection", () => {
  it("keeps the legacy cover and contain rectangle projection available", () => {
    expect(
      projectImageLayout(
        {
          width: 330,
          height: 180,
          fit: "cover",
          cropX: 0.2,
          cropY: 0.8,
        },
        { width: 400, height: 240 }
      )
    ).toEqual({
      source: {
        x: 0,
        y: 17.45454545454545,
        width: 400,
        height: 218.1818181818182,
      },
      destination: { x: 0, y: 0, width: 330, height: 180 },
      scale: 0.825,
    })
    expect(
      projectImageLayout(
        {
          width: 280,
          height: 200,
          fit: "contain",
          cropX: 0.8,
          cropY: 0.1,
        },
        { width: 400, height: 240 }
      )
    ).toEqual({
      source: { x: 0, y: 0, width: 400, height: 240 },
      destination: { x: 0, y: 3.2, width: 280, height: 168 },
      scale: 0.7,
    })
  })

  it("matches legacy cover geometry at zero inner rotation", () => {
    const projection = projectImagePaint({
      frame: { width: 330, height: 180 },
      naturalSize: { width: 400, height: 240 },
      placement: {
        ...centeredFill,
        focalX: 0.2,
        focalY: 0.8,
      },
      frameMask: { shape: "rectangle" },
    })

    expect(projection.scale).toBe(0.825)
    expect(projection.sourceToFrame.a).toBe(0.825)
    expect(projection.sourceToFrame.d).toBe(0.825)
    expect(projection.sourceToFrame.e).toBe(0)
    expect(projection.sourceToFrame.f).toBeCloseTo(-14.4)
    expect(-projection.sourceToFrame.f / projection.scale).toBeCloseTo(
      17.45454545454545
    )
  })

  it("fits the complete oriented source and aligns its free space", () => {
    const projection = projectImagePaint({
      frame: { width: 200, height: 100 },
      naturalSize: { width: 100, height: 100 },
      placement: {
        ...centeredFill,
        mode: "fit",
        focalX: 0.25,
      },
      frameMask: { shape: "rectangle" },
    })

    expect(projection.scale).toBe(1)
    expect(projection.sourceToFrame).toEqual({
      a: 1,
      b: 0,
      c: -0,
      d: 1,
      e: 25,
      f: 0,
    })
    expect(
      applyTransform(projection.sourceToFrame, { x: 100, y: 100 })
    ).toEqual({ x: 125, y: 100 })
  })

  it("keeps every frame corner covered in rotated manual mode", () => {
    const naturalSize = { width: 300, height: 200 }
    const frame = { width: 200, height: 100 }
    const projection = projectImagePaint({
      frame,
      naturalSize,
      placement: {
        ...centeredFill,
        mode: "manual",
        focalX: 1,
        focalY: 0,
        zoom: 1.5,
        rotation: 30,
      },
      frameMask: { shape: "rectangle" },
    })

    for (const point of [
      { x: 0, y: 0 },
      { x: frame.width, y: 0 },
      { x: frame.width, y: frame.height },
      { x: 0, y: frame.height },
    ]) {
      const sourcePoint = inverseTransform(projection.sourceToFrame, point)
      expect(sourcePoint.x).toBeGreaterThanOrEqual(-1e-9)
      expect(sourcePoint.y).toBeGreaterThanOrEqual(-1e-9)
      expect(sourcePoint.x).toBeLessThanOrEqual(naturalSize.width + 1e-9)
      expect(sourcePoint.y).toBeLessThanOrEqual(naturalSize.height + 1e-9)
    }
  })

  it("keeps cover geometry valid across rotation, focal, and flip cases", () => {
    const naturalSize = { width: 317, height: 191 }
    const frame = { width: 233, height: 127 }

    for (const rotation of [-179, -90, -37, 0, 42, 90, 179]) {
      for (const [focalX, focalY] of [
        [0, 0],
        [0.2, 0.8],
        [1, 1],
      ] as const) {
        for (const [flipX, flipY] of [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ] as const) {
          const projection = projectImagePaint({
            frame,
            naturalSize,
            placement: {
              mode: "manual",
              focalX,
              focalY,
              zoom: 1,
              rotation,
              flipX,
              flipY,
            },
            frameMask: { shape: "rectangle" },
          })

          for (const point of [
            { x: 0, y: 0 },
            { x: frame.width, y: 0 },
            { x: frame.width, y: frame.height },
            { x: 0, y: frame.height },
          ]) {
            const sourcePoint = inverseTransform(
              projection.sourceToFrame,
              point
            )
            expect(sourcePoint.x).toBeGreaterThanOrEqual(-1e-8)
            expect(sourcePoint.y).toBeGreaterThanOrEqual(-1e-8)
            expect(sourcePoint.x).toBeLessThanOrEqual(naturalSize.width + 1e-8)
            expect(sourcePoint.y).toBeLessThanOrEqual(naturalSize.height + 1e-8)
          }
        }
      }
    }
  })

  it("keeps every oriented source corner inside the frame in Fit mode", () => {
    const naturalSize = { width: 317, height: 191 }
    const frame = { width: 233, height: 127 }

    for (const rotation of [-179, -90, -37, 0, 42, 90, 179]) {
      const projection = projectImagePaint({
        frame,
        naturalSize,
        placement: {
          ...centeredFill,
          mode: "fit",
          focalX: 0.2,
          focalY: 0.8,
          rotation,
        },
        frameMask: { shape: "rectangle" },
      })

      for (const point of [
        { x: 0, y: 0 },
        { x: naturalSize.width, y: 0 },
        { x: naturalSize.width, y: naturalSize.height },
        { x: 0, y: naturalSize.height },
      ]) {
        const framePoint = applyTransform(projection.sourceToFrame, point)
        expect(framePoint.x).toBeGreaterThanOrEqual(-1e-8)
        expect(framePoint.y).toBeGreaterThanOrEqual(-1e-8)
        expect(framePoint.x).toBeLessThanOrEqual(frame.width + 1e-8)
        expect(framePoint.y).toBeLessThanOrEqual(frame.height + 1e-8)
      }
    }
  })

  it("preserves an oriented Fit view when it converts to Manual", () => {
    const frame = { width: 260, height: 140 }
    const naturalSize = { width: 400, height: 240 }
    const sharedPlacement = {
      ...centeredFill,
      focalX: 0.2,
      focalY: 0.8,
      rotation: 30,
    }
    const fit = projectImagePaint({
      frame,
      naturalSize,
      placement: { ...sharedPlacement, mode: "fit" },
      frameMask: { shape: "rectangle" },
    })
    const cover = projectImagePaint({
      frame,
      naturalSize,
      placement: { ...sharedPlacement, mode: "manual" },
      frameMask: { shape: "rectangle" },
    })
    const manual = projectImagePaint({
      frame,
      naturalSize,
      placement: {
        ...sharedPlacement,
        mode: "manual",
        zoom: fit.scale / cover.scale,
      },
      frameMask: { shape: "rectangle" },
    })

    expect(manual.scale).toBeCloseTo(fit.scale)
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(manual.sourceToFrame[key]).toBeCloseTo(fit.sourceToFrame[key], 12)
    }
  })

  it("projects flips around the source center without moving the frame", () => {
    const projection = projectImagePaint({
      frame: { width: 200, height: 100 },
      naturalSize: { width: 100, height: 100 },
      placement: { ...centeredFill, flipX: true },
      frameMask: { shape: "rectangle" },
    })

    expect(projection.sourceToFrame).toEqual({
      a: -2,
      b: -0,
      c: -0,
      d: 2,
      e: 200,
      f: -50,
    })
    expect(applyTransform(projection.sourceToFrame, { x: 0, y: 50 })).toEqual({
      x: 200,
      y: 50,
    })
    expect(applyTransform(projection.sourceToFrame, { x: 100, y: 50 })).toEqual(
      { x: 0, y: 50 }
    )
  })

  it("normalizes rotation and clamps finite focal and zoom values", () => {
    const projection = projectImagePaint({
      frame: { width: 100, height: 100 },
      naturalSize: { width: 100, height: 100 },
      placement: {
        ...centeredFill,
        mode: "manual",
        focalX: -4,
        focalY: 3,
        zoom: 100,
        rotation: 450,
      },
      frameMask: { shape: "rectangle" },
    })

    expect(projection.normalizedPlacement).toMatchObject({
      focalX: 0,
      focalY: 1,
      zoom: IMAGE_PLACEMENT_MAX_ZOOM,
      rotation: 90,
    })
  })

  it("projects renderer-ready rectangle, rounded, and ellipse clips", () => {
    const input = {
      frame: { width: 200, height: 100 },
      naturalSize: { width: 100, height: 100 },
      placement: centeredFill,
    }

    expect(
      projectImagePaint({
        ...input,
        frameMask: { shape: "rectangle" },
      }).clip
    ).toEqual({ shape: "rectangle", x: 0, y: 0, width: 200, height: 100 })
    expect(
      projectImagePaint({
        ...input,
        frameMask: { shape: "rounded_rectangle", radius: 0.375 },
      }).clip
    ).toEqual({
      shape: "rounded_rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      radius: 37.5,
    })
    expect(
      projectImagePaint({
        ...input,
        frameMask: { shape: "rounded_rectangle", radius: 2 },
      }).clip
    ).toMatchObject({ radius: 50 })
    expect(
      projectImagePaint({
        ...input,
        frameMask: { shape: "ellipse" },
      }).clip
    ).toEqual({
      shape: "ellipse",
      centerX: 100,
      centerY: 50,
      radiusX: 100,
      radiusY: 50,
    })
  })

  it("rejects non-finite values and non-positive dimensions", () => {
    expect(() =>
      projectImagePaint({
        frame: { width: 0, height: 100 },
        naturalSize: { width: 100, height: 100 },
        placement: centeredFill,
        frameMask: { shape: "rectangle" },
      })
    ).toThrow("Image frame width must be a finite positive number")

    expect(() =>
      projectImagePaint({
        frame: { width: 100, height: 100 },
        naturalSize: { width: 100, height: 100 },
        placement: { ...centeredFill, zoom: Number.POSITIVE_INFINITY },
        frameMask: { shape: "rectangle" },
      })
    ).toThrow("Image zoom must be a finite positive number")

    expect(() =>
      projectImagePaint({
        frame: { width: 100, height: 100 },
        naturalSize: { width: 100, height: 100 },
        placement: { ...centeredFill, zoom: 0 },
        frameMask: { shape: "rectangle" },
      })
    ).toThrow("Image zoom must be a finite positive number")

    expect(() =>
      projectImagePaint({
        frame: { width: 100, height: 100 },
        naturalSize: { width: 100, height: 100 },
        placement: centeredFill,
        frameMask: {
          shape: "rounded_rectangle",
          radius: Number.NaN,
        },
      })
    ).toThrow("Image frame mask radius must be finite")
  })
})
