import { describe, expect, it } from "vitest"
import {
  applyCommand,
  imageRenderParityCases,
  imageRenderParityDocument,
  imageRenderParityInput,
  imageRenderParityNode,
  imageRenderParityPixelRatios,
  northstarSeed,
  projectImagePaint,
  projectNodeForRender,
  renderConformanceDocument,
  serializeImagePaintProjector,
  type ImageFrameMask,
  type ImagePaintProjectionInput,
  type ImagePlacement,
  type RenderImagePaintProjection,
  type SceneNode,
} from "@webmcp/document"
import {
  markRenderResourcesReady,
  renderDocumentThumbnailToHtml,
  renderDocumentToHtml,
  renderNodeToHtml,
  renderOutputToHtml,
} from "../src/html"

function renderResourceFixture(options?: {
  fontCheck?: boolean
  fontStatus?: string
  imageComplete?: boolean
  imageFrameHeight?: number
  imageFrameMask?: ImageFrameMask
  imageFrameWidth?: number
  imageNaturalHeight?: number
  imageNaturalWidth?: number
  imagePlacement?: ImagePlacement
  imageRejects?: boolean
  projectionRejects?: boolean
}) {
  const attributes = new Map<string, string>()
  const root = {
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  }
  const faces = Object.assign(
    [
      {
        family: "Geist Variable",
        status: options?.fontStatus ?? "loaded",
      },
    ],
    {
      ready: Promise.resolve(),
      check: () => options?.fontCheck ?? true,
    }
  )
  const imageStyle = new Map<string, string>()
  const frameStyle = new Map<string, string>()
  const images = [
    {
      complete: options?.imageComplete ?? true,
      dataset: {
        nodeId: "hero-image",
        imageFrameWidth: String(options?.imageFrameWidth ?? 320),
        imageFrameHeight: String(options?.imageFrameHeight ?? 180),
        imagePlacement: JSON.stringify(
          options?.imagePlacement ?? {
            mode: "fill",
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          }
        ),
        imageFrameMask: JSON.stringify(
          options?.imageFrameMask ?? { shape: "rectangle" }
        ),
      },
      decode: options?.imageRejects
        ? () => Promise.reject(new Error("corrupt image"))
        : () => Promise.resolve(),
      naturalWidth: options?.imageNaturalWidth ?? 1200,
      naturalHeight: options?.imageNaturalHeight ?? 800,
      parentElement: {
        style: {
          setProperty: (name: string, value: string) =>
            frameStyle.set(name, value),
        },
      },
      style: {
        setProperty: (name: string, value: string) =>
          imageStyle.set(name, value),
      },
    },
  ]
  return {
    attributes,
    frameStyle,
    imageStyle,
    input: {
      root,
      fonts: faces,
      images,
      projectImagePaint: options?.projectionRejects
        ? () => {
            throw new Error("invalid projection")
          }
        : projectImagePaint,
    },
  }
}

describe("renderer HTML", () => {
  it("scales thumbnail markup into the exact low-resolution viewport", () => {
    const html = renderDocumentThumbnailToHtml(northstarSeed, "cover", {
      width: 124,
      height: 175,
    })

    expect(html).toContain('data-thumbnail-width="124"')
    expect(html).toContain('data-thumbnail-height="175"')
    expect(html).toContain("width:124px;height:175px;overflow:hidden")
    expect(html).toContain("transform:scale(0.1)")
    expect(html).toContain('data-source-width="1240"')
    expect(html).toContain('data-source-height="1754"')
    expect(html).not.toContain(
      "width:1240px;height:1754px;overflow:hidden}body"
    )
  })

  it("marks ready only after the managed font and every image decode", async () => {
    const fixture = renderResourceFixture()
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-ready")).toBe("true")
    expect(fixture.attributes.has("data-render-error")).toBe(false)
  })

  it("marks an exact managed-font failure instead of accepting fallback", async () => {
    const fixture = renderResourceFixture({ fontStatus: "error" })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "managed_font_failed"
    )
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("marks the corrupt image node instead of accepting blank output", async () => {
    const fixture = renderResourceFixture({ imageRejects: true })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "image_decode_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe("hero-image")
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("marks the exact image node when projection fails after decode", async () => {
    const fixture = renderResourceFixture({ projectionRejects: true })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.attributes.get("data-render-error")).toBe(
      "image_projection_failed"
    )
    expect(fixture.attributes.get("data-render-error-node")).toBe("hero-image")
    expect(fixture.attributes.has("data-render-ready")).toBe(false)
  })

  it("applies the canonical manual affine before declaring resources ready", async () => {
    const placement: ImagePlacement = {
      mode: "manual",
      focalX: 0.2,
      focalY: 0.8,
      zoom: 1.7,
      rotation: 33,
      flipX: true,
      flipY: false,
    }
    const fixture = renderResourceFixture({
      imagePlacement: placement,
      imageFrameMask: { shape: "ellipse" },
    })
    await markRenderResourcesReady(fixture.input)

    const expected = projectImagePaint({
      frame: { width: 320, height: 180 },
      naturalSize: { width: 1200, height: 800 },
      placement,
      frameMask: { shape: "ellipse" },
    })
    const affine = expected.sourceToFrame
    expect(fixture.imageStyle.get("transform")).toBe(
      `matrix(${affine.a},${affine.b},${affine.c},${affine.d},${affine.e},${affine.f})`
    )
    expect(fixture.imageStyle.get("width")).toBe("1200px")
    expect(fixture.imageStyle.get("height")).toBe("800px")
    expect(fixture.frameStyle.get("clip-path")).toBe(
      "ellipse(160px 90px at 160px 90px)"
    )
    expect(fixture.attributes.get("data-render-ready")).toBe("true")
  })

  it.each([
    [{ shape: "rectangle" } as const, "inset(0)"],
    [
      { shape: "rounded_rectangle", radius: 0.25 } as const,
      "inset(0 round 45px)",
    ],
    [{ shape: "ellipse" } as const, "ellipse(160px 90px at 160px 90px)"],
  ])("applies the %s frame clip", async (imageFrameMask, expectedClip) => {
    const fixture = renderResourceFixture({ imageFrameMask })
    await markRenderResourcesReady(fixture.input)

    expect(fixture.frameStyle.get("clip-path")).toBe(expectedClip)
    expect(fixture.attributes.get("data-render-ready")).toBe("true")
  })

  it("maps every retained 1x/2x image affine and frame mask into export CSS", async () => {
    for (const fixtureCase of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixtureCase, pixelRatio)
        const fixture = renderResourceFixture({
          imageFrameWidth: input.frame.width,
          imageFrameHeight: input.frame.height,
          imageNaturalWidth: input.naturalSize.width,
          imageNaturalHeight: input.naturalSize.height,
          imagePlacement: input.placement,
          imageFrameMask: input.frameMask,
        })
        await markRenderResourcesReady(fixture.input)

        const expected = projectImagePaint(input)
        const { a, b, c, d, e, f } = expected.sourceToFrame
        expect(fixture.imageStyle.get("transform")).toBe(
          `matrix(${a},${b},${c},${d},${e},${f})`
        )
        expect(fixture.imageStyle.get("width")).toBe(
          `${input.naturalSize.width}px`
        )
        expect(fixture.imageStyle.get("height")).toBe(
          `${input.naturalSize.height}px`
        )
        expect(fixture.frameStyle.get("clip-path")).toBe(
          expected.clip.shape === "ellipse"
            ? `ellipse(${expected.clip.radiusX}px ${expected.clip.radiusY}px at ${expected.clip.centerX}px ${expected.clip.centerY}px)`
            : expected.clip.shape === "rounded_rectangle"
              ? `inset(0 round ${expected.clip.radius}px)`
              : "inset(0)"
        )
        expect(fixture.attributes.get("data-render-ready")).toBe("true")
      }
    }
  })

  it("retains placement and frame-mask inputs in PNG/PDF HTML structure", () => {
    for (const fixture of imageRenderParityCases) {
      for (const pixelRatio of imageRenderParityPixelRatios) {
        const input = imageRenderParityInput(fixture, pixelRatio)
        const markup = renderNodeToHtml(
          imageRenderParityNode(fixture, pixelRatio)
        )
        expect(markup).toContain(
          `data-image-frame-width="${input.frame.width}"`
        )
        expect(markup).toContain(
          `data-image-frame-height="${input.frame.height}"`
        )
        expect(markup).toContain("data-image-placement=")
        expect(markup).toContain("data-image-frame-mask=")
        expect(markup).toContain(
          input.frameMask.shape === "rounded_rectangle"
            ? "rounded_rectangle"
            : input.frameMask.shape
        )
      }
    }

    const pdfMarkup = renderOutputToHtml(
      imageRenderParityDocument,
      "image-parity-output"
    )
    for (const node of imageRenderParityDocument.nodes) {
      expect(pdfMarkup).toContain(`data-node-id="${node.id}"`)
    }
    for (const page of imageRenderParityDocument.pages) {
      const pngMarkup = renderDocumentToHtml(imageRenderParityDocument, page.id)
      expect(pngMarkup).toContain(`data-page-id="${page.id}"`)
      expect(pngMarkup).toContain(`data-node-id="${page.nodeIds[0]}"`)
    }
  })

  it("keeps the serialized browser projector equal to canonical randomized projections", () => {
    const runtimeProjector = Function(
      `"use strict";return ${serializeImagePaintProjector()}`
    )() as (input: ImagePaintProjectionInput) => RenderImagePaintProjection
    let state = 0x6d2b79f5
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 0x1_0000_0000
    }

    for (let index = 0; index < 250; index += 1) {
      const maskChoice = index % 3
      const input: ImagePaintProjectionInput = {
        frame: {
          width: 24 + random() * 1_976,
          height: 24 + random() * 1_976,
        },
        naturalSize: {
          width: 1 + random() * 5_999,
          height: 1 + random() * 5_999,
        },
        placement: {
          mode: (["fill", "fit", "manual"] as const)[index % 3],
          focalX: random(),
          focalY: random(),
          zoom: 0.05 + random() * 8,
          rotation: -180 + random() * 360,
          flipX: random() > 0.5,
          flipY: random() > 0.5,
        },
        frameMask:
          maskChoice === 0
            ? { shape: "rectangle" }
            : maskChoice === 1
              ? { shape: "rounded_rectangle", radius: random() * 0.5 }
              : { shape: "ellipse" },
      }

      expect(runtimeProjector(input)).toEqual(projectImagePaint(input))
    }
  })

  it("renders canonical nodes without a Fabric dependency", () => {
    const html = renderDocumentToHtml(northstarSeed, "cover")
    expect(html).toContain('data-node-id="cover-title"')
    expect(html).toContain("Aditi &amp; Kabir")
    expect(html).toContain("width:1240px")
  })

  it("keeps shape markup and rotation origin consistent with the editor", () => {
    const nodes: SceneNode[] = [
      {
        id: "test-ellipse",
        type: "ellipse",
        name: "Ellipse",
        x: 40,
        y: 50,
        width: 200,
        height: 160,
        rotation: 12,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#d9c9b2",
        stroke: "#1e2622",
        strokeWidth: 3,
      },
      {
        id: "test-line",
        type: "line",
        name: "Line",
        x: 60,
        y: 80,
        width: 320,
        height: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        stroke: "#1e2622",
        strokeWidth: 4,
      },
      {
        id: "test-icon",
        type: "icon",
        name: "Heart",
        x: 100,
        y: 120,
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        path: "M12 21 3 12 12 3 21 12Z",
        viewBox: "0 0 24 24",
        fill: "#8a5d38",
        strokeWidth: 0,
      },
    ]
    const document = nodes.reduce(
      (current, node, index) =>
        applyCommand(current, {
          id: `cmd-render-primitive-${index}`,
          type: "add_node",
          actor: "human",
          at: "2026-08-26T09:30:00.000Z",
          pageId: "cover",
          node,
        }),
      northstarSeed
    )

    const html = renderDocumentToHtml(document, "cover")
    expect(html).toContain('data-node-id="test-ellipse"')
    expect(html).toContain("border-radius:50%")
    expect(html).toContain('data-node-id="test-line"')
    expect(html).toContain('stroke-width="4"')
    expect(html).toContain('data-node-id="test-icon"')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain("transform-origin:top left")
  })

  it("renders image placement, frame clipping, and alternative text", () => {
    const document = applyCommand(northstarSeed, {
      id: "cmd-render-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      node: {
        id: "test-image",
        type: "image",
        name: "Editorial image",
        assetId: "asset-one",
        src: "https://example.com/image.jpg",
        alt: "Sandstone arches",
        placement: {
          mode: "fit",
          focalX: 0.25,
          focalY: 0.75,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rounded_rectangle", radius: 0.25 },
        decorative: false,
        x: 100,
        y: 120,
        width: 640,
        height: 480,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    })

    const html = renderDocumentToHtml(document, "cover")
    expect(html).toContain('alt="Sandstone arches"')
    expect(html).toContain('data-image-frame-width="640"')
    expect(html).toContain('data-image-frame-height="480"')
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fit&quot;'
    )
    expect(html).toContain(
      'data-image-frame-mask="{&quot;shape&quot;:&quot;rounded_rectangle&quot;,&quot;radius&quot;:0.25}"'
    )
    expect(html).toContain("projectImagePaint:")
    expect(html).toContain("image.style.setProperty")
    expect(html).not.toContain("object-fit")
  })

  it("renders every output page in canonical order for mixed-size PDFs", () => {
    const html = renderOutputToHtml(northstarSeed, "proposal")

    expect(html).toContain("@page studio-page-0{size:1240px 1754px;margin:0}")
    expect(html).toContain('data-page-id="cover"')
    expect(html).toContain('data-page-id="story"')
    expect(html).toContain('data-page-id="terms"')
    expect(html.indexOf('data-page-id="cover"')).toBeLessThan(
      html.indexOf('data-page-id="story"')
    )
    expect(html).toContain("break-after:page")
    expect(html).toContain("print-color-adjust:exact")
    expect(html).not.toContain('data-page-id="whatsapp-card"')
  })

  it("keeps canonical typography and stroke values in export HTML", () => {
    const withTypography = applyCommand(northstarSeed, {
      id: "cmd-render-typography",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      nodeId: "cover-title",
      patch: { lineHeight: 1.04, letterSpacing: -1.2 },
    })
    const document = applyCommand(withTypography, {
      id: "cmd-render-stroke",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      nodeId: "cover-panel",
      patch: { stroke: "#ffffff", strokeWidth: 3 },
    })
    const html = renderDocumentToHtml(document, "cover")

    expect(html).toContain("line-height:1.04")
    expect(html).toContain("letter-spacing:-1.2px")
    expect(html).toContain("text-rendering:geometricPrecision")
    expect(html).toContain("-webkit-font-smoothing:antialiased")
    expect(html).toContain("font-weight:600")
    expect(html).toContain("border:3px solid #ffffff")
    expect(html).toContain('@font-face{font-family:"Geist Variable"')
    const embeddedFont = html.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/)
    expect(embeddedFont?.[1]).toHaveLength(39_200)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).toContain("input.fonts.check(query)")
    expect(html).toMatch(/face\.status\s*===\s*"loaded"/)
    expect(html).toMatch(/await\s+image\.decode\(\)/)
    expect(html).toContain("image.naturalWidth <= 0")
    expect(html).toContain("image.naturalHeight <= 0")
    expect(html).toContain("data-render-error")
    expect(html).toContain("data-render-ready")
  })

  it("serializes every golden projection without dropping render properties", () => {
    for (const node of renderConformanceDocument.nodes) {
      const markup = renderNodeToHtml(node)
      expect(markup).toContain(`data-node-id="${node.id}"`)
      expect(markup).toContain(`data-node-locked="${node.locked}"`)
      expect(markup).toContain(`left:${node.x}px`)
      expect(markup).toContain(`top:${node.y}px`)
      expect(markup).toContain(`width:${node.width}px`)
      expect(markup).toContain(`height:${node.height}px`)
      expect(markup).toContain(`opacity:${node.opacity}`)
      expect(markup).toContain(`transform:rotate(${node.rotation}deg)`)
      expect(markup).toContain(`display:${node.visible ? "block" : "none"}`)
      expect(markup).toContain("box-sizing:border-box")
    }
  })

  it("preserves whitespace, icon viewport, image crop, and shape border policy", () => {
    const html = renderDocumentToHtml(
      renderConformanceDocument,
      "properties-page"
    )
    expect(html).toContain("white-space:pre")
    expect(html).toContain('data-text-sizing-mode="fixed"')
    expect(html).toContain(
      'data-text-measurement="managed_font_approximation_v1"'
    )
    expect(html).toMatch(/data-text-line-count="[1-9][0-9]*"/)
    expect(html).toMatch(/data-text-overflow="(?:true|false)"/)
    expect(html).toMatch(/data-text-overflow-x="(?:true|false)"/)
    expect(html).toMatch(/data-text-overflow-y="(?:true|false)"/)
    expect(html).toContain("overflow-wrap:normal")
    expect(html).toContain("overflow:hidden")
    const textNode = renderConformanceDocument.nodes.find(
      (node) => node.id === "text-typography"
    )!
    const textProjection = projectNodeForRender(textNode)
    if (textProjection.type !== "text") throw new Error("Expected text")
    expect(html).toContain(textProjection.content.displayText)
    expect(textProjection.content.displayText).not.toBe(
      textProjection.content.text
    )
    expect(html).not.toContain(textProjection.content.text)
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(html).toContain('data-image-frame-id="image-cover"')
    expect(html).toContain('data-image-frame-id="image-contain"')
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fill&quot;,&quot;focalX&quot;:0.2,&quot;focalY&quot;:0.8'
    )
    expect(html).toContain(
      'data-image-placement="{&quot;mode&quot;:&quot;fit&quot;,&quot;focalX&quot;:0.8,&quot;focalY&quot;:0.1'
    )
    expect(html).toContain("border-radius:24px;border:8px solid #92400e")
    expect(html).toContain("border-radius:50%;border:5px solid #1d4ed8")
  })

  it("serializes auto-height sizing separately from fixed overflow", () => {
    const source = renderConformanceDocument.nodes.find(
      (candidate) => candidate.id === "text-typography"
    )!
    if (source.type !== "text") throw new Error("Expected text")
    const autoHeight: SceneNode = {
      ...source,
      id: "auto-height-text",
      sizingMode: "auto_height",
      height: 400,
    }
    const markup = renderNodeToHtml(autoHeight)

    expect(markup).toContain('data-text-sizing-mode="auto_height"')
    expect(markup).toContain('data-text-overflow="false"')
    expect(markup).toContain("overflow:visible")
  })

  it("keeps mixed-size output order and page rules deterministic", () => {
    const html = renderOutputToHtml(renderConformanceDocument, "mixed-document")
    expect(html).toContain("@page studio-page-0{size:720px 960px;margin:0}")
    expect(html).toContain("@page studio-page-1{size:640px 360px;margin:0}")
    expect(html.indexOf('data-page-id="properties-page"')).toBeLessThan(
      html.indexOf('data-page-id="long-text-page"')
    )
    expect(html).not.toContain('data-page-id="square-page"')
  })
})
