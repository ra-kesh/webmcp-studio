import { describe, expect, it } from "vitest"
import {
  assertRenderableDocument,
  isManagedRendererFont,
  isRenderSafeCssColor,
  isRenderSafeImageSource,
  managedRendererFonts,
  northstarSeed,
  renderPolicyLimits,
  validateRenderPolicy,
} from "../src"

const withImage = (src: string) => {
  const document = structuredClone(northstarSeed)
  const page = document.pages[0]!
  page.nodeIds.push("render-policy-image")
  document.nodes.push({
    id: "render-policy-image",
    type: "image",
    name: "Policy image",
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId: "policy-image",
    src,
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    alt: "",
    decorative: false,
  })
  return document
}

describe("renderer policy", () => {
  it("accepts the production starter and strict CSS colors", () => {
    expect(validateRenderPolicy(northstarSeed)).toEqual([])
    expect(() => assertRenderableDocument(northstarSeed)).not.toThrow()
    expect(isRenderSafeCssColor("#1f2923")).toBe(true)
    expect(isRenderSafeCssColor("rgb(10 20 30 / 50%)")).toBe(true)
  })

  it("exports one canonical managed-font policy for editors and renderers", () => {
    expect(managedRendererFonts).toEqual(["Geist Variable"])
    expect(isManagedRendererFont("Geist Variable")).toBe(true)
    expect(isManagedRendererFont("Unmanaged Brand Font")).toBe(false)

    const document = structuredClone(northstarSeed)
    const text = document.nodes.find((node) => node.type === "text")!
    if (text.type !== "text") throw new Error("Text fixture missing")
    text.fontFamily = "Unmanaged Brand Font"
    expect(validateRenderPolicy(document)).toContainEqual(
      expect.objectContaining({
        code: "unsupported_font",
        nodeId: text.id,
      })
    )
  })

  it("rejects CSS token injection separately from HTML escaping", () => {
    const document = structuredClone(northstarSeed)
    document.pages[0]!.background =
      "#fff; background:url(https://attacker.test/a)"
    const text = document.nodes.find((node) => node.type === "text")!
    if (text.type !== "text") throw new Error("Text fixture missing")
    text.color = "red;position:fixed"

    expect(validateRenderPolicy(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_render_value",
          pageId: document.pages[0]!.id,
        }),
        expect.objectContaining({
          code: "unsafe_render_value",
          nodeId: text.id,
        }),
      ])
    )
    expect(() => assertRenderableDocument(document)).toThrow(
      "unsafe page background"
    )
  })

  it("rejects unbounded geometry and aggregate pixel area", () => {
    const document = structuredClone(northstarSeed)
    document.pages[0]!.width = renderPolicyLimits.maxPageDimension + 1
    document.nodes[0]!.width = renderPolicyLimits.maxNodeDimension + 1

    expect(validateRenderPolicy(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "render_limit_exceeded",
          pageId: document.pages[0]!.id,
        }),
        expect.objectContaining({
          code: "render_limit_exceeded",
          nodeId: document.nodes[0]!.id,
        }),
      ])
    )
  })

  it("bounds aggregate inline image characters per page", () => {
    const prefix = "data:image/png;base64,"
    const source = `${prefix}${"A".repeat(
      renderPolicyLimits.maxInlineImageCharacters - prefix.length
    )}`
    const document = withImage(source)
    const template = document.nodes.at(-1)!
    const page = document.pages[0]!
    for (let index = 2; index <= 2; index += 1) {
      const node = {
        ...template,
        id: `render-policy-image-${index}`,
        name: `Policy image ${index}`,
      }
      document.nodes.push(node)
      page.nodeIds.push(node.id)
    }

    expect(validateRenderPolicy(document)).toContainEqual(
      expect.objectContaining({
        code: "render_limit_exceeded",
        pageId: page.id,
        message: expect.stringContaining("inline image render budget"),
      })
    )
  })

  it("allows network-isolated inline raster and simple SVG images", () => {
    expect(isRenderSafeImageSource("data:image/png;base64,iVBORw0KGgo=")).toBe(
      true
    )
    expect(
      isRenderSafeImageSource(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')}`
      )
    ).toBe(true)
    expect(
      isRenderSafeImageSource(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><path fill="url(#g)"/></svg>')}`
      )
    ).toBe(true)
  })

  it("rejects remote, malformed, nested-fetch, and active SVG images", () => {
    const sources = [
      "https://attacker.test/image.png",
      "data:image/png;base64,not base64",
      `data:image/svg+xml,${encodeURIComponent('<svg><image href="https://attacker.test/a"/></svg>')}`,
      `data:image/svg+xml,${encodeURIComponent("<svg><style>path{fill:url(https://attacker.test/a)}</style></svg>")}`,
      `data:image/svg+xml,${encodeURIComponent('<svg onload="alert(1)"/>')}`,
    ]

    for (const src of sources) {
      expect(isRenderSafeImageSource(src)).toBe(false)
      expect(validateRenderPolicy(withImage(src))).toContainEqual(
        expect.objectContaining({
          code: "unmanaged_asset",
          nodeId: "render-policy-image",
        })
      )
    }
  })
})
