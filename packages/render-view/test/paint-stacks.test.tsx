import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { northstarSeed, type Document } from "@webmcp/document"
import { Artboard } from "../src"

describe("paint-stack render parity", () => {
  it("emits ordered SVG paints with per-paint visibility, opacity, and blend mode", () => {
    const target = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!target || target.type !== "rect") throw new Error("Expected rectangle")
    const document: Document = {
      ...structuredClone(northstarSeed),
      nodes: northstarSeed.nodes.map((node) =>
        node.id === target.id
          ? {
              ...target,
              fills: [
                {
                  id: "base",
                  color: "#102030",
                  opacity: 0.35,
                  visible: false,
                  blendMode: "multiply" as const,
                },
                {
                  id: "accent",
                  color: "#abcdef",
                  opacity: 0.8,
                  visible: true,
                  blendMode: "screen" as const,
                },
              ],
              strokes: [
                {
                  id: "edge",
                  color: "#fedcba",
                  width: 3,
                  opacity: 0.6,
                  visible: true,
                  blendMode: "overlay" as const,
                },
              ],
            }
          : node
      ),
    }
    const page = document.pages.find((candidate) =>
      candidate.nodeIds.includes(target.id)
    )!
    const markup = renderToStaticMarkup(
      createElement(Artboard, { document, pageId: page.id })
    )
    expect(markup.indexOf("#102030")).toBeLessThan(markup.indexOf("#abcdef"))
    expect(markup.indexOf("#abcdef")).toBeLessThan(markup.indexOf("#fedcba"))
    expect(markup).toContain("display:none")
    expect(markup).toContain("opacity:0.35")
    expect(markup).toContain("mix-blend-mode:multiply")
    expect(markup).toContain("mix-blend-mode:screen")
    expect(markup).toContain("mix-blend-mode:overlay")
    expect(markup).toContain('stroke-width="3"')
  })
})
