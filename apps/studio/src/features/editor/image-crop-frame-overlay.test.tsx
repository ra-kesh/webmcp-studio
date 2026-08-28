import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderConformanceDocument } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import {
  ImageCropFrameOverlay,
  imageCropFrameHandleCursor,
} from "./image-crop-frame-overlay"

const image = renderConformanceDocument.nodes.find(
  (node) => node.type === "image"
)

if (!image) throw new Error("Expected image fixture")

describe("ImageCropFrameOverlay", () => {
  it("renders eight screen-stable 24px pointer targets", () => {
    const markup = renderToStaticMarkup(
      createElement(ImageCropFrameOverlay, {
        node: image,
        zoom: 0.4,
        getNaturalSize: () => ({ width: 1600, height: 900 }),
        onPreview: vi.fn(),
      })
    )

    expect(markup).toContain('data-image-crop-frame-handles="true"')
    expect(markup.match(/data-crop-frame-handle=/g)).toHaveLength(8)
    expect(markup.match(/size-6/g)).toHaveLength(8)
    expect(markup.match(/touch-none/g)).toHaveLength(8)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain("<button")
  })

  it("rotates native resize cursors with the frame", () => {
    expect(imageCropFrameHandleCursor("e", 0)).toBe("ew-resize")
    expect(imageCropFrameHandleCursor("e", 45)).toBe("nwse-resize")
    expect(imageCropFrameHandleCursor("e", 90)).toBe("ns-resize")
    expect(imageCropFrameHandleCursor("nw", 0)).toBe("nwse-resize")
    expect(imageCropFrameHandleCursor("nw", 90)).toBe("nesw-resize")
  })
})
