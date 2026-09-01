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

  it("emits aligned, dashed, side-specific SVG stroke geometry", () => {
    const target = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!target || target.type !== "rect") throw new Error("Expected rectangle")
    const document: Document = {
      ...structuredClone(northstarSeed),
      nodes: northstarSeed.nodes.map((node) =>
        node.id === target.id
          ? {
              ...target,
              strokes: [
                {
                  id: "advanced-edge",
                  color: "#13579b",
                  width: 8,
                  opacity: 1,
                  visible: true,
                  alignment: "outside" as const,
                  sides: {
                    top: true,
                    right: false,
                    bottom: true,
                    left: false,
                  },
                  dash: [12, 4],
                  cap: "round" as const,
                  join: "bevel" as const,
                  miterLimit: 7,
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
    expect(markup.match(/stroke="#13579b"/g)).toHaveLength(2)
    expect(markup).toContain('stroke-dasharray="12 4"')
    expect(markup).toContain('stroke-linecap="round"')
    expect(markup).toContain('stroke-linejoin="bevel"')
    expect(markup).toContain('stroke-miterlimit="7"')
    expect(markup).toContain('x1="-4"')
  })

  it("emits ordered drop-shadow and blur filters on the composited layer", () => {
    const target = northstarSeed.nodes.find((node) => node.type === "rect")
    if (!target || target.type !== "rect") throw new Error("Expected rectangle")
    const document: Document = {
      ...structuredClone(northstarSeed),
      nodes: northstarSeed.nodes.map((node) =>
        node.id === target.id
          ? {
              ...target,
              effects: [
                {
                  id: "shadow",
                  type: "drop_shadow" as const,
                  color: "#00000040",
                  offsetX: 6,
                  offsetY: 8,
                  blur: 10,
                  visible: true,
                },
                {
                  id: "blur",
                  type: "layer_blur" as const,
                  radius: 4,
                  visible: true,
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
    expect(markup).toContain(
      "filter:drop-shadow(6px 8px 10px #00000040) blur(4px)"
    )
  })
})
