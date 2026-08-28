import { describe, expect, it } from "vitest"
import { projectImagePaint } from "@webmcp/document"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import {
  projectResizeFrameToImagePreview,
  resolveResizeFrameToImagePreview,
} from "./image-crop-resize-to-image"

const sourceToPage = (
  frame: ImageCropSession["draftFrame"],
  sourceToFrame: ReturnType<typeof projectImagePaint>["sourceToFrame"]
) => {
  const radians = (frame.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    a: cosine * sourceToFrame.a - sine * sourceToFrame.b,
    b: sine * sourceToFrame.a + cosine * sourceToFrame.b,
    c: cosine * sourceToFrame.c - sine * sourceToFrame.d,
    d: sine * sourceToFrame.c + cosine * sourceToFrame.d,
    e: frame.x + cosine * sourceToFrame.e - sine * sourceToFrame.f,
    f: frame.y + sine * sourceToFrame.e + cosine * sourceToFrame.f,
  }
}

const session = (): ImageCropSession => ({
  target: {
    documentId: "document-1",
    pageId: "page-1",
    nodeId: "image-1",
    assetId: "asset-1",
    src: "https://example.com/image.jpg",
  },
  baseline: {
    mode: "manual",
    focalX: 0.35,
    focalY: 0.68,
    zoom: 1.45,
    rotation: 22,
    flipX: true,
    flipY: false,
  },
  draft: {
    mode: "manual",
    focalX: 0.35,
    focalY: 0.68,
    zoom: 1.45,
    rotation: 22,
    flipX: true,
    flipY: false,
  },
  baselineFrame: {
    x: 160,
    y: 90,
    width: 420,
    height: 280,
    rotation: -18,
  },
  draftFrame: {
    x: 160,
    y: 90,
    width: 420,
    height: 280,
    rotation: -18,
  },
  baselineFrameMask: { shape: "rounded_rectangle", radius: 0.18 },
  draftFrameMask: { shape: "rounded_rectangle", radius: 0.18 },
  draftRevision: 4,
})

describe("resize frame to image Studio preview", () => {
  it("projects the live crop draft into one frame preview without moving source pixels", () => {
    const current = session()
    const naturalSize = { width: 1600, height: 900 }
    const beforePaint = projectImagePaint({
      frame: current.draftFrame,
      naturalSize,
      placement: current.draft,
      frameMask: current.draftFrameMask,
    })
    const preview = projectResizeFrameToImagePreview(current, naturalSize)
    const afterPaint = projectImagePaint({
      frame: preview.frame,
      naturalSize,
      placement: preview.placement,
      frameMask: preview.frameMask,
    })

    expect(preview.nodeId).toBe(current.target.nodeId)
    expect(preview.frameMask).toEqual(current.draftFrameMask)
    expect(preview.frame).not.toEqual(current.draftFrame)
    expect(afterPaint.scale).toBeCloseTo(beforePaint.scale, 10)

    const beforeSourceToPage = sourceToPage(
      current.draftFrame,
      beforePaint.sourceToFrame
    )
    const afterSourceToPage = sourceToPage(
      preview.frame,
      afterPaint.sourceToFrame
    )
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(afterSourceToPage[key]).toBeCloseTo(beforeSourceToPage[key], 8)
    }
  })

  it("does not advertise an action when the frame already matches the image", () => {
    const current = session()
    const exactPlacement = {
      mode: "fit" as const,
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    }
    const exact: ImageCropSession = {
      ...current,
      baseline: exactPlacement,
      draft: exactPlacement,
      baselineFrame: { ...current.baselineFrame, width: 320, height: 180 },
      draftFrame: { ...current.draftFrame, width: 320, height: 180 },
    }

    expect(
      resolveResizeFrameToImagePreview(exact, { width: 1600, height: 900 })
    ).toBeNull()
  })
})
