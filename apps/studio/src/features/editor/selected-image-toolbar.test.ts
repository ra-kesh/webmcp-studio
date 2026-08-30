import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderConformanceDocument } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"

import {
  SelectedImageToolbar,
  selectedImageCompactOverflowActionIds,
  selectedImageFrameActionIds,
  selectedImageMoreActions,
} from "./selected-image-toolbar"

const image = renderConformanceDocument.nodes.find(
  (node) => node.type === "image"
)

if (!image) throw new Error("Expected an image fixture")

describe("SelectedImageToolbar", () => {
  it("keeps the common image workflow beside the selected image", () => {
    const markup = renderToStaticMarkup(
      createElement(SelectedImageToolbar, {
        image,
        onRunCommand: vi.fn(),
        isCommandEnabled: () => true,
      })
    )

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain(`Image actions for ${image.name}`)
    expect(markup).toContain("Crop image")
    expect(markup).toContain("Replace image…")
    expect(markup).toContain("Fit image")
    expect(markup).toContain("Fill frame")
    expect(markup).toContain('aria-label="Flip image horizontally"')
    expect(markup).toContain('aria-label="Flip image vertically"')
    expect(markup).toContain('aria-label="More image actions"')
    expect(markup).toContain('data-command-id="image.crop"')
    expect(markup).toContain('data-command-id="image.replace"')
    expect(markup).toContain("size-11")
    expect(markup).toContain("min-[1280px]:size-7")
  })

  it("keeps the complete transform list in the shared command registry", () => {
    expect(selectedImageMoreActions.map((action) => action.id)).toEqual([
      "image.rotate-left",
      "image.rotate-right",
      "image.rotation.reset",
      "image.reset-placement",
    ])
  })

  it("keeps compact disclosure and every accepted frame command reachable", () => {
    expect(selectedImageCompactOverflowActionIds).toEqual([
      "image.fit",
      "image.fill",
      "image.flip-horizontal",
      "image.flip-vertical",
    ])
    expect(selectedImageFrameActionIds).toEqual([
      "image.frame.rectangle",
      "image.frame.rounded-rectangle",
      "image.frame.ellipse",
    ])
  })

  it("does not present Manual placement as Fill", () => {
    const markup = renderToStaticMarkup(
      createElement(SelectedImageToolbar, {
        image: {
          ...image,
          placement: { ...image.placement, mode: "manual" },
        },
        onRunCommand: vi.fn(),
        isCommandEnabled: () => true,
      })
    )

    expect(markup).toMatch(
      /aria-pressed="false"[^>]*data-command-id="image\.fill"/
    )
  })

  it("projects command enablement into disabled controls", () => {
    const markup = renderToStaticMarkup(
      createElement(SelectedImageToolbar, {
        image,
        onRunCommand: vi.fn(),
        isCommandEnabled: (commandId) => commandId !== "image.replace",
      })
    )

    expect(markup).toMatch(/disabled=""[^>]*>.*Replace/s)
  })

  it("does not mislabel a manual crop as Fit or Fill", () => {
    const markup = renderToStaticMarkup(
      createElement(SelectedImageToolbar, {
        image: {
          ...image,
          placement: { ...image.placement, mode: "manual" },
        },
        onRunCommand: vi.fn(),
        isCommandEnabled: () => true,
      })
    )

    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(4)
  })
})
