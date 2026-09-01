// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import {
  isCanvasInteractionIsland,
  shouldZoomFromViewportDoubleClick,
} from "./canvas-viewport-event-policy"

describe("canvas viewport event policy", () => {
  it("reserves double-click zoom for genuine workspace background", () => {
    const workspace = document.createElement("div")
    const cameraBackground = document.createElement("div")
    workspace.appendChild(cameraBackground)

    expect(shouldZoomFromViewportDoubleClick(workspace)).toBe(true)
    expect(shouldZoomFromViewportDoubleClick(cameraBackground)).toBe(true)
  })

  it("keeps canvas chrome and editing islands out of pan and zoom routing", () => {
    const overlay = document.createElement("div")
    overlay.dataset.editorOverlayControl = "true"
    const button = document.createElement("button")
    overlay.appendChild(button)

    const canvas = document.createElement("canvas")
    canvas.className = "upper-canvas"

    const splitter = document.createElement("div")
    splitter.setAttribute("role", "separator")

    for (const target of [overlay, button, canvas, splitter]) {
      expect(isCanvasInteractionIsland(target)).toBe(true)
      expect(shouldZoomFromViewportDoubleClick(target)).toBe(false)
    }
  })
})
