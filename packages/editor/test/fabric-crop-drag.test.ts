import { describe, expect, it } from "vitest"
import { projectImagePaint, renderConformanceDocument } from "@webmcp/document"
import {
  isPagePointInsideImageFrame,
  projectFabricImageCropDrag,
  projectFabricImageCropPinch,
  projectFabricImageCropScreenNudge,
  twoTouchGestureMetrics,
} from "../src/fabric-adapter"

const projectedCenter = (
  node: Extract<
    (typeof renderConformanceDocument.nodes)[number],
    { type: "image" }
  >,
  naturalSize: { width: number; height: number }
) => {
  const paint = projectImagePaint({
    frame: node,
    naturalSize,
    placement: node.placement,
    frameMask: node.frameMask,
  })
  return {
    x:
      paint.sourceToFrame.a * (naturalSize.width / 2) +
      paint.sourceToFrame.c * (naturalSize.height / 2) +
      paint.sourceToFrame.e,
    y:
      paint.sourceToFrame.b * (naturalSize.width / 2) +
      paint.sourceToFrame.d * (naturalSize.height / 2) +
      paint.sourceToFrame.f,
  }
}

describe("Fabric crop drag projection", () => {
  it("tracks page-space drag through outer rotation, inner rotation, and flips", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (node) => node.type === "image"
    )
    if (!fixture || fixture.type !== "image") {
      throw new Error("Expected conformance image")
    }
    const naturalSize = { width: 720, height: 480 }
    const placement = {
      ...fixture.placement,
      mode: "manual" as const,
      focalX: 0.5,
      focalY: 0.5,
      zoom: 2.4,
      rotation: 31,
      flipX: true,
      flipY: true,
    }
    const node = { ...fixture, rotation: 37, placement }
    const pageDelta = { x: 12, y: -9 }
    const nextPlacement = projectFabricImageCropDrag(
      node,
      naturalSize,
      placement,
      pageDelta
    )
    const before = projectedCenter(node, naturalSize)
    const after = projectedCenter(
      { ...node, placement: nextPlacement },
      naturalSize
    )
    const radians = (node.rotation * Math.PI) / 180
    const expectedFrameDelta = {
      x: Math.cos(radians) * pageDelta.x + Math.sin(radians) * pageDelta.y,
      y: -Math.sin(radians) * pageDelta.x + Math.cos(radians) * pageDelta.y,
    }

    expect(nextPlacement.mode).toBe("manual")
    expect(after.x - before.x).toBeCloseTo(expectedFrameDelta.x, 8)
    expect(after.y - before.y).toBeCloseTo(expectedFrameDelta.y, 8)
  })

  it.each([0.25, 0.5, 1, 2, 4])(
    "keeps a keyboard nudge exact in screen pixels at %sx camera zoom",
    (cameraZoom) => {
      const fixture = renderConformanceDocument.nodes.find(
        (node) => node.type === "image"
      )
      if (!fixture || fixture.type !== "image") {
        throw new Error("Expected conformance image")
      }
      const naturalSize = { width: 720, height: 480 }
      const placement = {
        ...fixture.placement,
        mode: "manual" as const,
        focalX: 0.5,
        focalY: 0.5,
        zoom: 2.4,
        rotation: 31,
        flipX: true,
        flipY: true,
      }
      const node = { ...fixture, rotation: 37, placement }
      const screenDelta = { x: -10, y: 1 }
      const nextPlacement = projectFabricImageCropScreenNudge(
        node,
        naturalSize,
        placement,
        screenDelta,
        cameraZoom
      )
      const before = projectedCenter(node, naturalSize)
      const after = projectedCenter(
        { ...node, placement: nextPlacement },
        naturalSize
      )
      const radians = (node.rotation * Math.PI) / 180
      const pageDelta = {
        x:
          Math.cos(radians) * (after.x - before.x) -
          Math.sin(radians) * (after.y - before.y),
        y:
          Math.sin(radians) * (after.x - before.x) +
          Math.cos(radians) * (after.y - before.y),
      }

      expect(pageDelta.x * cameraZoom).toBeCloseTo(screenDelta.x, 8)
      expect(pageDelta.y * cameraZoom).toBeCloseTo(screenDelta.y, 8)
    }
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid camera zoom of %s",
    (cameraZoom) => {
      const fixture = renderConformanceDocument.nodes.find(
        (node) => node.type === "image"
      )
      if (!fixture || fixture.type !== "image") {
        throw new Error("Expected conformance image")
      }
      expect(() =>
        projectFabricImageCropScreenNudge(
          fixture,
          { width: 720, height: 480 },
          fixture.placement,
          { x: 1, y: 0 },
          cameraZoom
        )
      ).toThrow("positive number")
    }
  )

  it("keeps the touched source point anchored while pinch-scaling and translating", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (node) => node.type === "image"
    )
    if (!fixture || fixture.type !== "image") {
      throw new Error("Expected conformance image")
    }
    const naturalSize = { width: 720, height: 480 }
    const placement = {
      ...fixture.placement,
      mode: "manual" as const,
      focalX: 0.5,
      focalY: 0.5,
      zoom: 2.4,
      rotation: 23,
      flipX: true,
    }
    const node = { ...fixture, rotation: 37, placement }
    const radians = (node.rotation * Math.PI) / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const anchorFrame = { x: node.width * 0.35, y: node.height * 0.6 }
    const anchorPage = {
      x: node.x + cosine * anchorFrame.x - sine * anchorFrame.y,
      y: node.y + sine * anchorFrame.x + cosine * anchorFrame.y,
    }
    const cameraZoom = 0.5
    const screenTranslation = { x: 12, y: -7 }
    const before = projectedCenter(node, naturalSize)
    const nextPlacement = projectFabricImageCropPinch(
      node,
      naturalSize,
      placement,
      {
        scale: 1.4,
        anchorPage,
        screenTranslation,
        cameraZoom,
      }
    )
    const after = projectedCenter(
      { ...node, placement: nextPlacement },
      naturalSize
    )
    const translationPage = {
      x: screenTranslation.x / cameraZoom,
      y: screenTranslation.y / cameraZoom,
    }
    const translationFrame = {
      x: cosine * translationPage.x + sine * translationPage.y,
      y: -sine * translationPage.x + cosine * translationPage.y,
    }

    expect(nextPlacement.mode).toBe("manual")
    expect(nextPlacement.zoom).toBeCloseTo(placement.zoom * 1.4, 8)
    expect(after.x).toBeCloseTo(
      anchorFrame.x + (before.x - anchorFrame.x) * 1.4 + translationFrame.x,
      8
    )
    expect(after.y).toBeCloseTo(
      anchorFrame.y + (before.y - anchorFrame.y) * 1.4 + translationFrame.y,
      8
    )
  })

  it("arbitrates two-touch start against the exact rotated frame mask", () => {
    const fixture = renderConformanceDocument.nodes.find(
      (node) => node.type === "image"
    )
    if (!fixture || fixture.type !== "image") {
      throw new Error("Expected conformance image")
    }
    const node = {
      ...fixture,
      x: 100,
      y: 80,
      width: 200,
      height: 100,
      rotation: 90,
      frameMask: { shape: "ellipse" as const },
    }
    const pagePoint = (x: number, y: number) => ({
      x: node.x - y,
      y: node.y + x,
    })

    expect(isPagePointInsideImageFrame(node, pagePoint(100, 50))).toBe(true)
    expect(isPagePointInsideImageFrame(node, pagePoint(0, 0))).toBe(false)
    expect(isPagePointInsideImageFrame(node, pagePoint(201, 50))).toBe(false)
    expect(
      twoTouchGestureMetrics({
        0: { clientX: 10, clientY: 20 },
        1: { clientX: 16, clientY: 28 },
        length: 2,
      })
    ).toEqual({ distance: 10, midpoint: { x: 13, y: 24 } })
  })
})
