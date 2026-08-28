import { describe, expect, it } from "vitest"
import {
  assertPageThumbnailSize,
  assertRenderableDocument,
  createPageThumbnailDocument,
  createPageThumbnailRevision,
  createPageThumbnailRenderResourcePlan,
  fitPageThumbnailSize,
  northstarSeed,
  PageThumbnailSizeError,
  pageThumbnailScale,
} from "../src"

describe("page thumbnail contract", () => {
  const cover = northstarSeed.pages.find((page) => page.id === "cover")!

  it("accepts nearest-pixel aspect dimensions and returns a uniform scale", () => {
    expect(assertPageThumbnailSize(cover, { width: 124, height: 175 })).toEqual(
      { width: 124, height: 175 }
    )
    expect(pageThumbnailScale(cover, { width: 124, height: 175 })).toBe(0.1)
  })

  it.each([
    {
      name: "extreme portrait at DPR 2",
      page: { width: 105, height: 1120 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 14, height: 144 },
    },
    {
      name: "near-square page at fractional DPR",
      page: { width: 100, height: 110 },
      bounds: { maxWidth: 52 * 1.3, maxHeight: 72 * 1.3 },
      expected: { width: 68, height: 75 },
    },
    {
      name: "extreme landscape at DPR 2",
      page: { width: 1120, height: 105 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 104, height: 10 },
    },
    {
      name: "standard portrait at DPR 2",
      page: { width: 1240, height: 1754 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 102, height: 144 },
    },
    {
      name: "standard landscape at DPR 2",
      page: { width: 1240, height: 800 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 104, height: 67 },
    },
    {
      name: "one-pixel-wide portrait at DPR 2",
      page: { width: 1, height: 8192 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 1, height: 144 },
    },
    {
      name: "one-pixel-high landscape at DPR 2",
      page: { width: 8192, height: 1 },
      bounds: { maxWidth: 52 * 2, maxHeight: 72 * 2 },
      expected: { width: 104, height: 1 },
    },
  ])("fits $name by deriving one axis", ({ page, bounds, expected }) => {
    const size = fitPageThumbnailSize(page, bounds)

    expect(size).toEqual(expected)
    expect(assertPageThumbnailSize(page, size)).toEqual(expected)
    expect(size.width).toBeLessThanOrEqual(Math.round(bounds.maxWidth))
    expect(size.height).toBeLessThanOrEqual(Math.round(bounds.maxHeight))
  })

  it("keeps one-pixel-clamped extreme pages on the limiting-axis scale", () => {
    expect(
      pageThumbnailScale({ width: 1, height: 8192 }, { width: 1, height: 144 })
    ).toBe(144 / 8192)
    expect(
      pageThumbnailScale({ width: 8192, height: 1 }, { width: 104, height: 1 })
    ).toBe(104 / 8192)
  })

  it.each([
    [{ width: 0, height: 1 }, "thumbnail_dimension_out_of_bounds"],
    [{ width: 513, height: 512 }, "thumbnail_dimension_out_of_bounds"],
    [{ width: 200, height: 200 }, "thumbnail_aspect_ratio_mismatch"],
  ] as const)("rejects invalid dimensions %o", (size, code) => {
    expect(() => assertPageThumbnailSize(cover, size)).toThrowError(
      expect.objectContaining({ code }) as PageThumbnailSizeError
    )
  })

  it("accounts for the requested raster instead of the full-size page", () => {
    expect(
      createPageThumbnailRenderResourcePlan(northstarSeed, {
        outputId: "proposal",
        pageId: "cover",
        size: { width: 124, height: 175 },
      })
    ).toEqual({
      outputId: "proposal",
      format: "png",
      pageIds: ["cover"],
      pageCount: 1,
      pixelArea: 21_700,
      estimatedStorageBytes: 86_800,
    })
  })

  it("projects only the selected page and its pixel-render dependencies", () => {
    const projected = createPageThumbnailDocument(northstarSeed, "cover")
    const page = projected.pages[0]
    const output = projected.outputs[0]
    if (!page || !output) throw new Error("Expected one projected page")
    const nodeIds = new Set(page.nodeIds)

    expect(projected.outputs).toHaveLength(1)
    expect(output.pageIds).toEqual(["cover"])
    expect(projected.pages).toHaveLength(1)
    expect(projected.nodes.every((node) => nodeIds.has(node.id))).toBe(true)
    expect(projected.groups.every((group) => group.pageId === "cover")).toBe(
      true
    )
    expect(projected.fields).toEqual([])
    expect(projected.fieldValues).toEqual({})
    expect(projected.bindings).toEqual([])
    expect(() => assertRenderableDocument(projected)).not.toThrow()
  })

  it("does not duplicate a bound asset value outside its already-applied image node", () => {
    const document = structuredClone(northstarSeed)
    const assetId = "asset-0123456789abcdef0123456789abcdef"
    const source = `asset:managed/${assetId}`
    const page = document.pages[0]!
    document.nodes.push({
      id: "bound-managed-image",
      name: "Bound managed image",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId,
      src: source,
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
      decorative: false,
      alt: "Bound image",
    })
    page.nodeIds.push("bound-managed-image")
    document.fields.push({
      id: "bound-asset-field",
      key: "bound_asset",
      label: "Bound asset",
      type: "asset",
      required: true,
      defaultValue: source,
      agentDescription: "The managed image rendered on this page.",
      validation: {},
    })
    document.fieldValues["bound-asset-field"] = source
    document.bindings.push({
      id: "bound-asset-binding",
      fieldId: "bound-asset-field",
      nodeId: "bound-managed-image",
      property: "src",
    })

    const projected = createPageThumbnailDocument(document, page.id)

    expect(projected.nodes.at(-1)).toMatchObject({
      id: "bound-managed-image",
      src: source,
    })
    expect(projected.fields).toEqual([])
    expect(projected.fieldValues).toEqual({})
    expect(projected.bindings).toEqual([])
    expect(JSON.stringify(projected).split(source)).toHaveLength(2)
  })

  it("keeps an unchanged page revision stable across unrelated edits", () => {
    const baseline = createPageThumbnailRevision(northstarSeed, "cover")
    const unrelated = {
      ...northstarSeed,
      revision: northstarSeed.revision + 1,
      updatedAt: "2026-08-28T13:00:00.000Z",
      pages: northstarSeed.pages.map((page) =>
        page.id === "story" ? { ...page, background: "#abcdef" } : page
      ),
    }
    const changedCover = {
      ...unrelated,
      pages: unrelated.pages.map((page) =>
        page.id === "cover" ? { ...page, background: "#fedcba" } : page
      ),
    }

    expect(createPageThumbnailRevision(unrelated, "cover")).toBe(baseline)
    expect(createPageThumbnailRevision(changedCover, "cover")).not.toBe(
      baseline
    )
  })
})
