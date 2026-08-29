import { describe, expect, it } from "vitest"
import {
  CAMERA_BAR_COMPACT_HEIGHT,
  CAMERA_BAR_SECTION_BOTTOM,
  CONTEXT_BAR_CAMERA_GAP,
  PAGE_FILMSTRIP_HEIGHT,
  SELECTED_IMAGE_TOOLBAR_BOTTOM_INSET,
  SELECTED_IMAGE_TOOLBAR_HEIGHT,
  applySelectedImageToolbarCameraProjection,
  resolveSelectedImageToolbarPlacement,
} from "./selected-image-toolbar-placement"

const horizontal = {
  frameLeft: 300,
  frameRight: 500,
  viewportWidth: 800,
}

describe("selected image toolbar placement", () => {
  it("uses the larger clear side when both sides fit", () => {
    expect(
      resolveSelectedImageToolbarPlacement({
        ...horizontal,
        frameTop: 90,
        frameBottom: 220,
        viewportHeight: 700,
      })
    ).toEqual({
      mode: "overlay",
      edge: "bottom",
      top: 232,
      left: 160,
      width: 480,
    })
    expect(
      resolveSelectedImageToolbarPlacement({
        ...horizontal,
        frameTop: 430,
        frameBottom: 570,
        viewportHeight: 700,
      })
    ).toEqual({
      mode: "overlay",
      edge: "top",
      top: 370,
      left: 160,
      width: 480,
    })
  })

  it("keeps the bottom placement above the zoom HUD reserve", () => {
    expect(
      resolveSelectedImageToolbarPlacement({
        ...horizontal,
        frameTop: 280,
        frameBottom: 590,
        viewportHeight: 700,
      })
    ).toEqual({
      mode: "overlay",
      edge: "top",
      top: 220,
      left: 160,
      width: 480,
    })
  })

  it("derives the workspace inset from the section camera bar and filmstrip", () => {
    expect(SELECTED_IMAGE_TOOLBAR_BOTTOM_INSET).toBe(
      CAMERA_BAR_SECTION_BOTTOM -
        PAGE_FILMSTRIP_HEIGHT +
        CAMERA_BAR_COMPACT_HEIGHT +
        CONTEXT_BAR_CAMERA_GAP
    )
    expect(SELECTED_IMAGE_TOOLBAR_BOTTOM_INSET).toBe(68)

    const viewportHeight = 700
    const placement = resolveSelectedImageToolbarPlacement({
      ...horizontal,
      frameTop: 20,
      frameBottom: 572,
      viewportHeight,
    })
    expect(placement).toEqual({
      mode: "overlay",
      edge: "bottom",
      top: 584,
      left: 160,
      width: 480,
    })
    if (placement.mode !== "overlay") return

    const contextBarBottom = placement.top + SELECTED_IMAGE_TOOLBAR_HEIGHT
    const cameraBarTop =
      viewportHeight -
      (CAMERA_BAR_SECTION_BOTTOM - PAGE_FILMSTRIP_HEIGHT) -
      CAMERA_BAR_COMPACT_HEIGHT
    expect(cameraBarTop - contextBarBottom).toBe(CONTEXT_BAR_CAMERA_GAP)
  })

  it("never returns an overlay that intersects the selected frame", () => {
    const input = {
      ...horizontal,
      frameTop: 210,
      frameBottom: 390,
      viewportHeight: 720,
      toolbarHeight: 48,
      gap: 12,
    }
    const placement = resolveSelectedImageToolbarPlacement(input)

    expect(placement.mode).toBe("overlay")
    if (placement.mode !== "overlay") return
    const toolbarBottom = placement.top + input.toolbarHeight
    expect(
      toolbarBottom <= input.frameTop - input.gap ||
        placement.top >= input.frameBottom + input.gap
    ).toBe(true)
  })

  it("centers on the selected frame and clamps inside the viewport", () => {
    expect(
      resolveSelectedImageToolbarPlacement({
        frameLeft: 340,
        frameRight: 460,
        frameTop: 100,
        frameBottom: 220,
        viewportWidth: 800,
        viewportHeight: 700,
      })
    ).toMatchObject({ mode: "overlay", left: 160, width: 480 })
    expect(
      resolveSelectedImageToolbarPlacement({
        frameLeft: -40,
        frameRight: 80,
        frameTop: 100,
        frameBottom: 220,
        viewportWidth: 800,
        viewportHeight: 700,
      })
    ).toMatchObject({ mode: "overlay", left: 8, width: 480 })
    expect(
      resolveSelectedImageToolbarPlacement({
        frameLeft: 720,
        frameRight: 840,
        frameTop: 100,
        frameBottom: 220,
        viewportWidth: 800,
        viewportHeight: 700,
      })
    ).toMatchObject({ mode: "overlay", left: 312, width: 480 })
    expect(
      resolveSelectedImageToolbarPlacement({
        frameLeft: 120,
        frameRight: 200,
        frameTop: 100,
        frameBottom: 220,
        viewportWidth: 320,
        viewportHeight: 700,
      })
    ).toMatchObject({ mode: "overlay", left: 8, width: 304 })
  })

  it("docks outside the canvas when neither side can stay clear", () => {
    expect(
      resolveSelectedImageToolbarPlacement({
        ...horizontal,
        frameTop: 20,
        frameBottom: 610,
        viewportHeight: 700,
      })
    ).toEqual({ mode: "docked", edge: "top" })
  })

  it("docks safely before the viewport has a usable measurement", () => {
    expect(
      resolveSelectedImageToolbarPlacement({
        ...horizontal,
        frameTop: 100,
        frameBottom: 240,
        viewportHeight: 0,
      })
    ).toEqual({ mode: "docked", edge: "top" })
  })

  it("projects the floating toolbar immediately from each live camera", () => {
    const target = {
      hidden: false,
      style: { top: "", left: "", width: "" },
    }
    const bounds = { left: 300, right: 500, top: 240, bottom: 360 }
    const viewport = { width: 900, height: 760 }

    applySelectedImageToolbarCameraProjection(target, {
      bounds,
      viewport,
      camera: { x: 0, y: 0, zoom: 1 },
    })
    expect(target).toEqual({
      hidden: false,
      style: { top: "372px", left: "160px", width: "480px" },
    })

    applySelectedImageToolbarCameraProjection(target, {
      bounds,
      viewport,
      camera: { x: 80, y: 40, zoom: 1.25 },
    })
    expect(target).toEqual({
      hidden: false,
      style: { top: "280px", left: "340px", width: "480px" },
    })
  })
})
