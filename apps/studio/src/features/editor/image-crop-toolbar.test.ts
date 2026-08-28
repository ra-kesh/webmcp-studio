import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { defaultImagePlacement } from "@webmcp/document"
import { createImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"

import {
  createImageCropToolbarExitGate,
  imageCropSliderValueToZoom,
  ImageCropToolbar,
  imageCropZoomPreview,
  imageCropZoomToSliderValue,
  isDefaultImageCropPlacement,
  normalizeImageCropRotation,
  resolveImageCropToolbarKeyAction,
  validateImageCropNumber,
} from "./image-crop-toolbar"

const session = (): ImageCropSession => {
  const placement = Object.freeze(defaultImagePlacement())
  const frame = Object.freeze({
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
  })
  const frameMask = Object.freeze({ shape: "rectangle" as const })
  return Object.freeze({
    target: Object.freeze({
      documentId: "document-1",
      pageId: "page-1",
      nodeId: "image-1",
      assetId: "asset-1",
      src: "https://example.com/portrait.jpg",
    }),
    baseline: placement,
    draft: placement,
    baselineFrame: frame,
    draftFrame: frame,
    baselineFrameMask: frameMask,
    draftFrameMask: frameMask,
    draftRevision: 0,
  })
}

describe("ImageCropToolbar", () => {
  it("renders a named non-modal toolbar with the complete crop action set", () => {
    const previewStore = createImageCropPreviewStore(session())
    const markup = renderToStaticMarkup(
      createElement(ImageCropToolbar, {
        previewStore,
        imageName: "Ceremony portrait",
        onPreview: () => undefined,
        onRunCommand: () => undefined,
        isCommandEnabled: () => true,
        onCancel: () => undefined,
        onDone: () => undefined,
      })
    )
    previewStore.destroy()

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="Crop image: Ceremony portrait"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup.match(/Crop image\. Drag to reposition\./g)).toHaveLength(1)
    expect(markup).toContain('data-crop-primary-action="true"')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).toContain("Crop image")
    expect(markup).toContain("Ceremony portrait")
    expect(markup).toContain('aria-label="Fit image"')
    expect(markup).toContain('aria-label="Fill frame"')
    expect(markup).toContain('aria-label="Image zoom"')
    expect(markup).toContain('aria-label="Image zoom percentage"')
    expect(markup).toContain('aria-label="Image rotation degrees"')
    expect(markup).toContain('aria-label="Rotate image left"')
    expect(markup).toContain('aria-label="Rotate image right"')
    expect(markup).toContain('aria-label="Flip image horizontally"')
    expect(markup).toContain('aria-label="Flip image vertically"')
    expect(markup).toContain('aria-label="Resize frame to image"')
    expect(markup).toContain('aria-label="Reset image crop"')
    expect(markup).toContain("Cancel")
    expect(markup).toContain("Done")
    expect(markup).toContain("size-11")
    expect(markup).toContain("h-11")
  })
})

describe("crop toolbar keyboard arbitration", () => {
  const plainTarget = { tagName: "SECTION", closest: () => null }

  it("resolves unmodified Enter and Escape from the toolbar surface", () => {
    expect(
      resolveImageCropToolbarKeyAction({
        key: "Enter",
        target: plainTarget as unknown as EventTarget,
      })
    ).toBe("done")
    expect(
      resolveImageCropToolbarKeyAction({
        key: "Escape",
        target: plainTarget as unknown as EventTarget,
      })
    ).toBe("cancel")
  })

  it.each([
    { tagName: "INPUT", closest: () => null },
    { tagName: "BUTTON", closest: () => null },
    { tagName: "DIV", isContentEditable: true, closest: () => null },
    { tagName: "SPAN", closest: () => ({ role: "slider" }) },
  ])("does not steal keys from an interactive target", (target) => {
    expect(
      resolveImageCropToolbarKeyAction({
        key: "Enter",
        target: target as unknown as EventTarget,
      })
    ).toBeNull()
    expect(
      resolveImageCropToolbarKeyAction({
        key: "Escape",
        target: target as unknown as EventTarget,
      })
    ).toBeNull()
  })

  it("ignores repeats, composition, handled events, and modified keys", () => {
    for (const ignored of [
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect(
        resolveImageCropToolbarKeyAction({
          key: "Enter",
          target: plainTarget as unknown as EventTarget,
          ...ignored,
        })
      ).toBeNull()
    }
  })

  it("allows only one exit callback until a new session resets the gate", () => {
    const onCancel = vi.fn()
    const onDone = vi.fn()
    const gate = createImageCropToolbarExitGate({ onCancel, onDone })

    expect(gate.request("done")).toBe(true)
    expect(gate.request("cancel")).toBe(false)
    expect(gate.request("done")).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    gate.reset()
    expect(gate.request("cancel")).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe("crop toolbar preview values", () => {
  it("validates exact numeric crop alternatives without silent clamping", () => {
    expect(
      validateImageCropNumber("125.5", {
        label: "Image zoom percentage",
        min: 5,
        max: 6400,
      })
    ).toEqual({ ok: true, value: 125.5 })
    expect(
      validateImageCropNumber("6401", {
        label: "Image zoom percentage",
        min: 5,
        max: 6400,
      })
    ).toEqual({
      ok: false,
      message: "Image zoom percentage must be between 5 and 6400.",
    })
    expect(
      validateImageCropNumber("not a number", {
        label: "Image rotation degrees",
        min: -180,
        max: 180,
      }).ok
    ).toBe(false)
  })

  it("round-trips the logarithmic image zoom slider", () => {
    for (const zoom of [0.05, 0.5, 1, 8, 64]) {
      expect(
        imageCropSliderValueToZoom(imageCropZoomToSliderValue(zoom))
      ).toBeCloseTo(zoom, 10)
    }
  })

  it("turns explicit scale input into a manual content preview", () => {
    const patch = imageCropZoomPreview(imageCropZoomToSliderValue(2.25))

    expect(patch.mode).toBe("manual")
    expect(patch.zoom).toBeCloseTo(2.25, 10)
  })

  it("keeps the Fit projection base while zooming so the image does not jump", () => {
    const patch = imageCropZoomPreview(imageCropZoomToSliderValue(1.25), "fit")

    expect(patch.mode).toBe("fit")
    expect(patch.zoom).toBeCloseTo(1.25, 10)
  })

  it("normalizes image rotation to the canonical range", () => {
    expect(normalizeImageCropRotation(270)).toBe(-90)
    expect(normalizeImageCropRotation(-270)).toBe(90)
    expect(normalizeImageCropRotation(360)).toBe(0)
  })

  it("recognizes only the canonical reset placement", () => {
    expect(isDefaultImageCropPlacement(defaultImagePlacement())).toBe(true)
    expect(
      isDefaultImageCropPlacement({
        ...defaultImagePlacement(),
        flipX: true,
      })
    ).toBe(false)
  })
})
