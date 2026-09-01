import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CanvasZoomControls } from "./canvas-zoom-controls"

describe("CanvasZoomControls", () => {
  it("keeps the frequent zoom actions visible and moves the full range into the percentage menu", () => {
    const markup = renderToStaticMarkup(
      <CanvasZoomControls
        zoom={0.34}
        hasSelection={false}
        canvasTools={
          <div aria-label="Canvas tools" role="toolbar">
            <button type="button">Select</button>
          </div>
        }
        onZoomChange={vi.fn()}
        onFit={vi.fn()}
        onFitAll={vi.fn()}
        onZoomToSelection={vi.fn()}
      />
    )

    expect(markup).toContain('data-canvas-zoom-controls="true"')
    expect(markup).toContain('aria-label="Canvas controls"')
    expect(markup).toContain('aria-label="Canvas tools"')
    expect(markup).toContain('aria-label="Canvas zoom controls"')
    expect(markup.indexOf("Select")).toBeLessThan(
      markup.indexOf('aria-label="Zoom out"')
    )
    expect(markup).toContain('aria-label="Canvas zoom: 34%"')
    expect(markup).toContain('aria-label="Zoom out"')
    expect(markup).toContain('aria-label="Zoom in"')
    expect(markup).toContain('aria-label="Fit page"')
    expect(markup).toContain("Fit all pages")
    expect(markup).toContain('aria-label="Zoom to selection"')
    expect(markup).toContain("disabled")
  })
})
