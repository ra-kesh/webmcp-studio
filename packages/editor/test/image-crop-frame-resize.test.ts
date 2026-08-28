import {
  projectImagePaint,
  type ImageFrameMask,
  type ImagePlacement,
  type RenderImageAffine,
} from "@webmcp/document"
import { describe, expect, it } from "vitest"
import {
  projectImageCropFrameResize,
  projectImageCropLocalResizeRect,
  projectResizeImageFrameToImage,
  type ImageCropFrame,
  type ImageCropFrameHandle,
} from "../src"

const frame: ImageCropFrame = {
  x: 120,
  y: 80,
  width: 320,
  height: 180,
  rotation: 0,
}

const placement: ImagePlacement = {
  mode: "manual",
  focalX: 0.37,
  focalY: 0.68,
  zoom: 1.4,
  rotation: 23,
  flipX: true,
  flipY: false,
}

const naturalSize = { width: 1600, height: 900 }
const rectangle: ImageFrameMask = { shape: "rectangle" }

const pageAffine = (
  imageFrame: ImageCropFrame,
  imagePlacement: ImagePlacement,
  frameMask: ImageFrameMask = rectangle
): RenderImageAffine => {
  const local = projectImagePaint({
    frame: imageFrame,
    naturalSize,
    placement: imagePlacement,
    frameMask,
  }).sourceToFrame
  const radians = (imageFrame.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    a: cosine * local.a - sine * local.b,
    b: sine * local.a + cosine * local.b,
    c: cosine * local.c - sine * local.d,
    d: sine * local.c + cosine * local.d,
    e: imageFrame.x + cosine * local.e - sine * local.f,
    f: imageFrame.y + sine * local.e + cosine * local.f,
  }
}

const expectAffineClose = (
  actual: RenderImageAffine,
  expected: RenderImageAffine
) => {
  for (const key of Object.keys(expected) as Array<keyof RenderImageAffine>) {
    expect(actual[key]).toBeCloseTo(expected[key], 6)
  }
}

describe("image crop frame resize projection", () => {
  it("moves each edge or corner from one immutable local baseline", () => {
    const expected: Record<
      ImageCropFrameHandle,
      ReturnType<typeof projectImageCropLocalResizeRect>
    > = {
      nw: { left: 20, top: 10, right: 320, bottom: 180 },
      n: { left: 0, top: 10, right: 320, bottom: 180 },
      ne: { left: 0, top: 10, right: 340, bottom: 180 },
      e: { left: 0, top: 0, right: 340, bottom: 180 },
      se: { left: 0, top: 0, right: 340, bottom: 190 },
      s: { left: 0, top: 0, right: 320, bottom: 190 },
      sw: { left: 20, top: 0, right: 320, bottom: 190 },
      w: { left: 20, top: 0, right: 320, bottom: 180 },
    }

    for (const handle of Object.keys(expected) as ImageCropFrameHandle[]) {
      expect(
        projectImageCropLocalResizeRect(frame, handle, { x: 20, y: 10 })
      ).toEqual(expected[handle])
    }
  })

  it("keeps the current aspect ratio with Shift", () => {
    const corner = projectImageCropLocalResizeRect(
      frame,
      "se",
      { x: 80, y: 10 },
      { preserveAspectRatio: true }
    )
    const edge = projectImageCropLocalResizeRect(
      frame,
      "e",
      { x: 80, y: 0 },
      { preserveAspectRatio: true }
    )

    expect(
      (corner.right - corner.left) / (corner.bottom - corner.top)
    ).toBeCloseTo(frame.width / frame.height, 8)
    expect(edge).toEqual({ left: 0, right: 400, top: -22.5, bottom: 202.5 })
  })

  it("resizes symmetrically around the frame center with Alt", () => {
    expect(
      projectImageCropLocalResizeRect(
        frame,
        "w",
        { x: 30, y: 0 },
        { symmetric: true }
      )
    ).toEqual({ left: 30, right: 290, top: 0, bottom: 180 })
    expect(
      projectImageCropLocalResizeRect(
        frame,
        "se",
        { x: 40, y: 20 },
        { preserveAspectRatio: true, symmetric: true }
      )
    ).toEqual({ left: -40, right: 360, top: -22.5, bottom: 202.5 })
  })

  it("keeps at least the configured document-space frame size", () => {
    expect(
      projectImageCropLocalResizeRect(
        frame,
        "nw",
        { x: 500, y: 500 },
        { minimumFrameSize: 16 }
      )
    ).toEqual({ left: 304, right: 320, top: 164, bottom: 180 })
  })

  it("converts screen delta through camera zoom and outer-frame rotation", () => {
    const rotated = { ...frame, rotation: 90 }
    const next = projectImageCropFrameResize({
      handle: "e",
      frame: rotated,
      naturalSize,
      placement,
      frameMask: rectangle,
      screenDelta: { x: 0, y: 40 },
      cameraZoom: 2,
    })

    expect(next.frame).toMatchObject({
      x: rotated.x,
      y: rotated.y,
      width: 340,
      height: rotated.height,
      rotation: 90,
    })
  })

  it("preserves the exact source-to-page affine across placement modes, masks, and flips", () => {
    const placements: ImagePlacement[] = [
      { ...placement, mode: "fill", zoom: 1, rotation: 0, flipX: false },
      { ...placement, mode: "fit", zoom: 1, rotation: -37, flipY: true },
      placement,
    ]
    const masks: ImageFrameMask[] = [
      rectangle,
      { shape: "rounded_rectangle", radius: 0.22 },
      { shape: "ellipse" },
    ]
    const handles: ImageCropFrameHandle[] = ["nw", "e", "se", "s", "w"]

    for (const [index, currentPlacement] of placements.entries()) {
      for (const [maskIndex, frameMask] of masks.entries()) {
        for (const handle of handles) {
          const baseline = {
            ...frame,
            rotation: index * 31 - maskIndex * 17,
          }
          const before = pageAffine(baseline, currentPlacement, frameMask)
          const projection = projectImageCropFrameResize({
            handle,
            frame: baseline,
            naturalSize,
            placement: currentPlacement,
            frameMask,
            screenDelta: { x: 36 - index * 5, y: -18 + maskIndex * 7 },
            cameraZoom: 0.75 + index * 0.5,
            preserveAspectRatio: handle === "se",
            symmetric: handle === "w",
          })

          expect(projection.placement.mode).toBe("manual")
          expect(projection.frameMask).toEqual(frameMask)
          expectAffineClose(
            pageAffine(projection.frame, projection.placement, frameMask),
            before
          )
        }
      }
    }
  })

  it("does not mutate the drag baseline", () => {
    const input = {
      handle: "se" as const,
      frame,
      naturalSize,
      placement,
      frameMask: rectangle,
      screenDelta: { x: 50, y: 25 },
      cameraZoom: 1,
    }
    const snapshot = structuredClone(input)
    projectImageCropFrameResize(input)
    expect(input).toEqual(snapshot)
  })

  it("matches the frame to transformed source bounds without resampling", () => {
    const placements: ImagePlacement[] = [
      { ...placement, mode: "fill", zoom: 1, rotation: 0, flipX: false },
      { ...placement, mode: "fit", zoom: 1, rotation: -37, flipY: true },
      placement,
    ]
    const masks: ImageFrameMask[] = [
      rectangle,
      { shape: "rounded_rectangle", radius: 0.2 },
      { shape: "ellipse" },
    ]

    for (const [index, currentPlacement] of placements.entries()) {
      const currentFrame = { ...frame, rotation: index * 29 - 17 }
      const mask = masks[index]!
      const before = pageAffine(currentFrame, currentPlacement, mask)
      const beforePaint = projectImagePaint({
        frame: currentFrame,
        naturalSize,
        placement: currentPlacement,
        frameMask: mask,
      })
      const projection = projectResizeImageFrameToImage({
        frame: currentFrame,
        naturalSize,
        placement: currentPlacement,
        frameMask: mask,
      })
      const afterPaint = projectImagePaint({
        frame: projection.frame,
        naturalSize,
        placement: projection.placement,
        frameMask: mask,
      })

      expectAffineClose(
        pageAffine(projection.frame, projection.placement, mask),
        before
      )
      expect(afterPaint.scale).toBeCloseTo(beforePaint.scale, 8)
      expect(projection.frameMask).toEqual(mask)

      const { a, b, c, d, e, f } = afterPaint.sourceToFrame
      const corners = [
        { x: e, y: f },
        { x: a * naturalSize.width + e, y: b * naturalSize.width + f },
        { x: c * naturalSize.height + e, y: d * naturalSize.height + f },
        {
          x: a * naturalSize.width + c * naturalSize.height + e,
          y: b * naturalSize.width + d * naturalSize.height + f,
        },
      ]
      expect(Math.min(...corners.map((corner) => corner.x))).toBeCloseTo(0, 6)
      expect(Math.min(...corners.map((corner) => corner.y))).toBeCloseTo(0, 6)
      expect(Math.max(...corners.map((corner) => corner.x))).toBeCloseTo(
        projection.frame.width,
        6
      )
      expect(Math.max(...corners.map((corner) => corner.y))).toBeCloseTo(
        projection.frame.height,
        6
      )
    }
  })

  it("returns an exact no-op when the frame already matches the source", () => {
    const exactFrame = { ...frame, width: 320, height: 180 }
    const exactPlacement: ImagePlacement = {
      mode: "fit",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    }
    const projection = projectResizeImageFrameToImage({
      frame: exactFrame,
      naturalSize,
      placement: exactPlacement,
      frameMask: rectangle,
    })

    expect(projection.frame).toEqual(exactFrame)
    expect(projection.placement).toEqual(exactPlacement)
  })
})
