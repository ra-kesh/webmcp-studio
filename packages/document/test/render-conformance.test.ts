import { describe, expect, it } from "vitest"
import {
  imageRenderParityCases,
  imageRenderParityDocument,
  imageRenderParityInput,
  imageRenderParityPixelRatios,
  projectImagePaint,
  projectNodeForRender,
  projectPageForRender,
  projectSvgViewport,
  renderConformanceDocument,
  textDesignSystemConformanceDocument,
  validateDocument,
  validateRenderPolicy,
} from "../src"

const roundParityNumber = (value: number) => {
  const rounded = Number(value.toFixed(6))
  return Object.is(rounded, -0) ? 0 : rounded
}

const parityFingerprint = (
  projection: ReturnType<typeof projectImagePaint>
) => ({
  matrix: Object.fromEntries(
    Object.entries(projection.sourceToFrame).map(([key, value]) => [
      key,
      roundParityNumber(value),
    ])
  ),
  clip: Object.fromEntries(
    Object.entries(projection.clip).map(([key, value]) => [
      key,
      typeof value === "number" ? roundParityNumber(value) : value,
    ])
  ),
})

describe("render conformance corpus", () => {
  it("round-trips reusable styles and all typed variable targets with resolved values", () => {
    const document = textDesignSystemConformanceDocument
    expect(
      validateDocument(document).filter((issue) => issue.severity === "error")
    ).toEqual([])
    expect(document.typographyStyles).toHaveLength(1)
    expect(document.paintStyles).toHaveLength(1)
    expect(
      new Set(document.variables.map((variable) => variable.type))
    ).toEqual(new Set(["color", "number", "string", "font_family"]))
    expect(
      new Set(document.variableBindings.map((binding) => binding.target.kind))
    ).toEqual(
      new Set(["node", "text_range", "typography_style", "paint_style"])
    )
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)

    const panel = document.nodes.find(
      (node) => node.id === "rect-stroke-radius"
    )!
    const label = document.nodes.find((node) => node.id === "auto-width-label")!
    const body = document.nodes.find((node) => node.id === "long-text-only")!
    expect(projectNodeForRender(panel)).toMatchObject({
      content: { fill: "#fef3c7", radius: 24 },
      frame: { opacity: 0.86 },
    })
    expect(projectNodeForRender(label)).toMatchObject({
      content: { text: "AUTO WIDTH" },
    })
    expect(projectNodeForRender(body)).toMatchObject({
      content: {
        fontFamily: "Geist Variable",
        fontSize: 24,
        fontWeight: 450,
      },
    })
  })

  it("is a valid, render-safe mixed-output canonical document", () => {
    expect(
      validateDocument(renderConformanceDocument).filter(
        (issue) => issue.severity === "error"
      )
    ).toEqual([])
    expect(validateRenderPolicy(renderConformanceDocument)).toEqual([])
    expect(renderConformanceDocument.outputs).toEqual([
      expect.objectContaining({
        id: "mixed-document",
        pageIds: ["properties-page", "long-text-page"],
        exportFormats: ["png", "pdf"],
      }),
      expect.objectContaining({
        id: "square-image",
        pageIds: ["square-page"],
        exportFormats: ["png"],
      }),
    ])
    expect(
      new Set(renderConformanceDocument.nodes.map((node) => node.type))
    ).toEqual(new Set(["text", "rect", "ellipse", "line", "icon", "image"]))
  })

  it("projects every canonical frame property without normalization loss", () => {
    for (const node of renderConformanceDocument.nodes) {
      expect(projectNodeForRender(node).frame).toEqual({
        id: node.id,
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
        opacity: node.opacity,
        visible: node.visible,
        locked: node.locked,
      })
    }
    expect(
      projectNodeForRender(
        renderConformanceDocument.nodes.find(
          (node) => node.id === "hidden-node"
        )!
      ).frame
    ).toMatchObject({ visible: false, locked: true, opacity: 0.4 })
  })

  it("keeps typography and intentional whitespace explicit", () => {
    const node = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    const projection = projectNodeForRender(node)
    expect(projection).toEqual(
      expect.objectContaining({
        type: "text",
        content: expect.objectContaining({
          text: expect.stringContaining("Spacing   stays\n"),
          displayText: expect.stringContaining("Spacing   stays\n"),
          fontSize: 28,
          fontWeight: 650,
          lineHeight: 1.35,
          letterSpacing: 2.5,
          align: "right",
          whiteSpace: "pre",
          overflowWrap: "normal",
        }),
      })
    )
    if (projection.type !== "text") throw new Error("Expected text")
    expect(projection.content.displayText).toBe(
      projection.content.layout.displayText
    )
    expect(projection.content.displayText).not.toBe(projection.content.text)
    expect(projection.content.layout.lines[0]).toMatchObject({
      align: "center",
      height: 52.2,
    })
    expect(
      projection.content.layout.lines.flatMap((line) => line.segments)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Spacing",
          styled: true,
          style: expect.objectContaining({
            color: "#be123c",
            fontSize: 36,
            fontWeight: 780,
            italic: true,
            decoration: "underline",
          }),
        }),
        expect.objectContaining({
          text: "• ",
          synthetic: true,
        }),
        expect.objectContaining({
          text: "stays",
          link: expect.objectContaining({
            target: "https://example.com/conformance",
            newTab: true,
          }),
        }),
      ])
    )
  })

  it("covers all text sizing modes with derived auto geometry", () => {
    const textNodes = renderConformanceDocument.nodes.filter(
      (node) => node.type === "text"
    )
    expect(new Set(textNodes.map((node) => node.sizingMode))).toEqual(
      new Set(["fixed", "auto_height", "auto_width"])
    )
    for (const node of textNodes) {
      if (node.sizingMode === "fixed") continue
      const projection = projectNodeForRender(node)
      if (projection.type !== "text") throw new Error("Expected text")
      expect(node.height).toBe(projection.content.layout.requiredHeight)
      if (node.sizingMode === "auto_width") {
        expect(node.width).toBe(projection.content.layout.intrinsicWidth)
      }
    }
  })

  it("defines deterministic fill and fit image geometry", () => {
    const cover = renderConformanceDocument.nodes.find(
      (node) => node.id === "image-cover"
    )!
    const contain = renderConformanceDocument.nodes.find(
      (node) => node.id === "image-contain"
    )!
    if (cover.type !== "image" || contain.type !== "image") {
      throw new Error("Conformance image cases are missing")
    }

    const coverPaint = projectImagePaint({
      frame: cover,
      naturalSize: { width: 400, height: 240 },
      placement: cover.placement,
      frameMask: cover.frameMask,
    })
    expect(coverPaint).toMatchObject({
      sourceToFrame: { a: 0.825, b: 0, c: -0, d: 0.825, e: 0 },
      clip: { shape: "rectangle", x: 0, y: 0, width: 330, height: 180 },
      scale: 0.825,
      normalizedPlacement: cover.placement,
    })
    expect(coverPaint.sourceToFrame.f).toBeCloseTo(-14.4, 10)

    const fitPaint = projectImagePaint({
      frame: contain,
      naturalSize: { width: 400, height: 240 },
      placement: contain.placement,
      frameMask: contain.frameMask,
    })
    expect(fitPaint).toMatchObject({
      sourceToFrame: { a: 0.7, b: 0, c: -0, d: 0.7, e: 0 },
      clip: { shape: "rectangle", x: 0, y: 0, width: 280, height: 200 },
      scale: 0.7,
      normalizedPlacement: contain.placement,
    })
    expect(fitPaint.sourceToFrame.f).toBeCloseTo(3.2, 10)
  })

  it("retains a broad image placement and frame-mask parity corpus", () => {
    const aspect = (size: { width: number; height: number }) =>
      size.width === size.height
        ? "square"
        : size.width > size.height
          ? "landscape"
          : "portrait"

    expect(
      new Set(imageRenderParityCases.map((fixture) => fixture.placement.mode))
    ).toEqual(new Set(["fill", "fit", "manual"]))
    expect(
      new Set(imageRenderParityCases.map((fixture) => fixture.frameMask.shape))
    ).toEqual(new Set(["rectangle", "rounded_rectangle", "ellipse"]))
    expect(
      new Set(
        imageRenderParityCases.map((fixture) => aspect(fixture.naturalSize))
      )
    ).toEqual(new Set(["landscape", "portrait", "square"]))
    expect(
      new Set(imageRenderParityCases.map((fixture) => aspect(fixture.frame)))
    ).toEqual(new Set(["landscape", "portrait", "square"]))
    expect(
      imageRenderParityCases.map(
        (fixture) => `${fixture.placement.focalX}:${fixture.placement.focalY}`
      )
    ).toEqual(expect.arrayContaining(["0:0", "1:0", "0:1", "1:1"]))
    expect(
      new Set(
        imageRenderParityCases.map(
          (fixture) => `${fixture.placement.flipX}:${fixture.placement.flipY}`
        )
      )
    ).toEqual(new Set(["false:false", "true:false", "false:true", "true:true"]))
    expect(
      Math.min(
        ...imageRenderParityCases.map((fixture) => fixture.placement.zoom)
      )
    ).toBeLessThan(1)
    expect(
      Math.max(
        ...imageRenderParityCases.map((fixture) => fixture.placement.zoom)
      )
    ).toBeGreaterThan(3)
    expect(
      validateDocument(imageRenderParityDocument).filter(
        (issue) => issue.severity === "error"
      )
    ).toEqual([])
    expect(validateRenderPolicy(imageRenderParityDocument)).toEqual([])
    expect(imageRenderParityDocument.nodes).toHaveLength(
      imageRenderParityCases.length
    )
    expect(imageRenderParityDocument.outputs[0]).toMatchObject({
      id: "image-parity-output",
      exportFormats: ["png", "pdf"],
    })
  })

  it("locks the canonical 1x affine and clip fingerprints", () => {
    expect(
      imageRenderParityCases.map((fixture) => ({
        id: fixture.id,
        ...parityFingerprint(
          projectImagePaint(imageRenderParityInput(fixture, 1))
        ),
      }))
    ).toEqual([
      {
        id: "fill-landscape-portrait-top-left-rectangle",
        matrix: { a: 0.4, b: 0, c: 0, d: 0.4, e: 0, f: 0 },
        clip: { shape: "rectangle", x: 0, y: 0, width: 240, height: 360 },
      },
      {
        id: "fill-portrait-landscape-bottom-right-rounded",
        matrix: {
          a: -0.761769,
          b: -0.204115,
          c: -0.204115,
          d: 0.761769,
          e: 774.430781,
          f: -858.830633,
        },
        clip: {
          shape: "rounded_rectangle",
          x: 0,
          y: 0,
          width: 480,
          height: 240,
          radius: 48,
        },
      },
      {
        id: "fill-square-square-center-ellipse",
        matrix: {
          a: 0.739383,
          b: -0.426883,
          c: -0.426883,
          d: -0.739383,
          e: 0,
          f: 757.128129,
        },
        clip: {
          shape: "ellipse",
          centerX: 160,
          centerY: 160,
          radiusX: 160,
          radiusY: 160,
        },
      },
      {
        id: "fit-landscape-square-bottom-left-rectangle",
        matrix: {
          a: 0.090112,
          b: 0.032798,
          c: -0.032798,
          d: 0.090112,
          e: 32.798139,
          f: 150.851205,
        },
        clip: { shape: "rectangle", x: 0, y: 0, width: 300, height: 300 },
      },
      {
        id: "fit-portrait-portrait-top-right-rounded",
        matrix: { a: -0.16, b: 0.16, c: -0.16, d: -0.16, e: 280, f: 288 },
        clip: {
          shape: "rounded_rectangle",
          x: 0,
          y: 0,
          width: 280,
          height: 420,
          radius: 98,
        },
      },
      {
        id: "fit-square-landscape-center-ellipse",
        matrix: { a: 0, b: 0.216667, c: 0.216667, d: 0, e: 120, f: 0 },
        clip: {
          shape: "ellipse",
          centerX: 250,
          centerY: 130,
          radiusX: 250,
          radiusY: 130,
        },
      },
      {
        id: "manual-landscape-landscape-top-right-rectangle",
        matrix: {
          a: -0.176502,
          b: -0.114622,
          c: -0.114622,
          d: 0.176502,
          e: 420,
          f: 220.073632,
        },
        clip: { shape: "rectangle", x: 0, y: 0, width: 420, height: 220 },
      },
      {
        id: "manual-portrait-square-bottom-left-rounded",
        matrix: {
          a: 0.25359,
          b: -0.94641,
          c: -0.94641,
          d: -0.25359,
          e: 335.884573,
          f: 450,
        },
        clip: {
          shape: "rounded_rectangle",
          x: 0,
          y: 0,
          width: 360,
          height: 360,
          radius: 45,
        },
      },
      {
        id: "manual-square-portrait-bottom-right-ellipse",
        matrix: {
          a: 0.872224,
          b: -0.813362,
          c: 0.813362,
          d: 0.872224,
          e: -229.439732,
          f: 213.956011,
        },
        clip: {
          shape: "ellipse",
          centerX: 130,
          centerY: 230,
          radiusX: 130,
          radiusY: 230,
        },
      },
    ])
  })

  it("preserves affine and clip geometry structurally at 1x and 2x", () => {
    expect(imageRenderParityPixelRatios).toEqual([1, 2])
    for (const fixture of imageRenderParityCases) {
      const one = projectImagePaint(imageRenderParityInput(fixture, 1))
      const two = projectImagePaint(imageRenderParityInput(fixture, 2))
      for (const key of ["a", "b", "c", "d"] as const) {
        expect(two.sourceToFrame[key]).toBeCloseTo(one.sourceToFrame[key], 12)
      }
      for (const key of ["e", "f"] as const) {
        expect(two.sourceToFrame[key]).toBeCloseTo(
          one.sourceToFrame[key] * 2,
          10
        )
      }
      expect(two.clip.shape).toBe(one.clip.shape)
      for (const [key, value] of Object.entries(one.clip)) {
        if (key === "shape" || typeof value !== "number") continue
        expect(Reflect.get(two.clip, key)).toBeCloseTo(value * 2, 10)
      }
    }
  })

  it("defines meet semantics for a non-square icon viewport", () => {
    expect(projectSvgViewport({ width: 180, height: 90 }, "0 0 24 24")).toEqual(
      {
        viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
        scale: 3.75,
        offsetX: 45,
        offsetY: 0,
      }
    )
  })

  it("projects page sizes, backgrounds, and paint order exactly", () => {
    expect(renderConformanceDocument.pages.map(projectPageForRender)).toEqual(
      renderConformanceDocument.pages.map((page) => ({
        ...page,
        nodeIds: [...page.nodeIds],
      }))
    )
  })
})
