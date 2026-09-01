import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { northstarSeed, type Document } from "@webmcp/document"
import { describe, expect, it } from "vitest"
import { FrameLayoutGridOverlay } from "./frame-layout-grid-overlay"

const fixture = (): Document => {
  const document = structuredClone(northstarSeed)
  document.pages[0]!.nodeIds.unshift("grid-frame")
  document.nodes.push({
    id: "grid-frame",
    type: "frame",
    name: "Grid frame",
    x: 40,
    y: 60,
    width: 240,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    constraints: { horizontal: "min", vertical: "min" },
    fill: "#ffffff",
    radius: 12,
    strokeWidth: 0,
    children: [],
    autoLayout: null,
    clipsContent: false,
    layoutGrids: [
      {
        id: "twelve-columns",
        pattern: "columns",
        visible: true,
        color: "#2563eb",
        opacity: 0.12,
        alignment: "stretch",
        count: 12,
        offset: 16,
        sectionSize: 1,
        gutter: 8,
      },
    ],
  })
  return document
}

describe("FrameLayoutGridOverlay", () => {
  it("renders frame-space guide chrome with an explicit editor-only marker", () => {
    const document = fixture()
    const markup = renderToStaticMarkup(
      createElement(FrameLayoutGridOverlay, {
        document,
        pageId: document.pages[0]!.id,
        zoom: 1.5,
      })
    )
    expect(markup).toContain('data-editor-overlay="frame-layout-grids"')
    expect(markup).toContain('data-frame-layout-grid-owner="grid-frame"')
    expect(markup.match(/data-layout-grid-id="twelve-columns"/g)).toHaveLength(
      12
    )
    expect(markup).toContain("pointer-events-none")
  })

  it("obeys the global guide visibility command state", () => {
    const document = fixture()
    expect(
      renderToStaticMarkup(
        createElement(FrameLayoutGridOverlay, {
          document,
          pageId: document.pages[0]!.id,
          zoom: 1,
          visible: false,
        })
      )
    ).toBe("")
  })
})
