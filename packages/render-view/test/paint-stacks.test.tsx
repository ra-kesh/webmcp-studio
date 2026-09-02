import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { northstarSeed, sceneNodeSchema, type Document } from "@webmcp/document"
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

  it("renders expanded vector geometry with gradient and affine image paints", () => {
    const page = northstarSeed.pages[0]!
    const common = {
      name: "Expanded shape",
      y: 40,
      width: 120,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#111827",
      strokeWidth: 0,
    }
    const polygon = sceneNodeSchema.parse({
      ...common,
      type: "polygon",
      id: "render-polygon",
      x: 40,
      pointCount: 6,
      fills: [
        {
          id: "linear",
          type: "linear_gradient",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          stops: [
            { position: 0, color: "#0ea5e9", opacity: 1 },
            { position: 1, color: "#312e81", opacity: 0.5 },
          ],
          opacity: 1,
          visible: true,
        },
      ],
    })
    const star = sceneNodeSchema.parse({
      ...common,
      type: "star",
      id: "render-star",
      x: 200,
      pointCount: 5,
      innerRadius: 0.42,
      fills: [
        {
          id: "radial",
          type: "radial_gradient",
          center: { x: 0.4, y: 0.6 },
          radiusX: 0.7,
          radiusY: 0.4,
          rotation: 30,
          stops: [
            { position: 0, color: "#fef3c7", opacity: 1 },
            { position: 1, color: "#dc2626", opacity: 1 },
          ],
          opacity: 1,
          visible: true,
        },
      ],
    })
    const vector = sceneNodeSchema.parse({
      ...common,
      type: "vector",
      id: "render-vector",
      x: 360,
      path: "M 0 0 H 100 V 100 H 0 Z",
      viewBox: "0 0 100 100",
      fillRule: "evenodd",
      fills: [
        {
          id: "image",
          type: "image",
          assetId: "inline-pattern",
          src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
          transform: { a: 0.8, b: 0.1, c: -0.1, d: 0.8, e: 0.1, f: 0.05 },
          opacity: 1,
          visible: true,
        },
      ],
    })
    const boolean = sceneNodeSchema.parse({
      ...common,
      type: "boolean_result",
      id: "render-boolean",
      x: 520,
      operation: "exclude",
      sourceNodeIds: [polygon.id, star.id],
      path: "M 0 0 H 100 V 100 H 0 Z M 25 25 H 75 V 75 H 25 Z",
      viewBox: "0 0 100 100",
      fillRule: "evenodd",
    })
    const document: Document = {
      ...structuredClone(northstarSeed),
      pages: northstarSeed.pages.map((candidate) =>
        candidate.id === page.id
          ? {
              ...candidate,
              nodeIds: [
                ...candidate.nodeIds,
                polygon.id,
                star.id,
                vector.id,
                boolean.id,
              ],
            }
          : candidate
      ),
      nodes: [
        ...structuredClone(northstarSeed.nodes),
        polygon,
        star,
        vector,
        boolean,
      ],
    }
    const markup = renderToStaticMarkup(
      createElement(Artboard, { document, pageId: page.id })
    )

    expect(markup).toContain("<linearGradient")
    expect(markup).toContain('stop-opacity="0.5"')
    expect(markup).toContain("<radialGradient")
    expect(markup).toContain("rotate(30) scale(0.7 0.4)")
    expect(markup).toContain("<pattern")
    expect(markup).toContain("matrix(0.8 0.1 -0.1 0.8 0.1 0.05)")
    expect(markup).toContain('fill-rule="evenodd"')
    expect(markup).toContain('data-node-id="render-polygon"')
    expect(markup).toContain('data-node-id="render-star"')
    expect(markup).toContain('data-node-id="render-vector"')
    expect(markup).toContain('data-node-id="render-boolean"')
  })
})
