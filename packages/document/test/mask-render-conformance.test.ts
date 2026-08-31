import { describe, expect, it } from "vitest"
import {
  nestedAlphaLuminanceAllHiddenRenderConformanceDocument,
  nestedCompositeAreaLimitRenderConformanceDocument,
  nestedImageFailureRenderConformanceDocument,
  nestedLuminanceVectorOneHiddenRenderConformanceDocument,
  nestedOverDepthRenderConformanceDocument,
  nestedVectorAlphaRenderConformanceDocument,
} from "../src/mask-render-conformance"
import {
  PagePaintPlanError,
  projectPagePaintPlan,
  type PagePaintPlanEntry,
} from "../src/page-paint-plan"

type MaskGroupPaintPlanEntry = Extract<
  PagePaintPlanEntry,
  { kind: "mask_group" }
>

const nestedEntries = (
  document: typeof nestedVectorAlphaRenderConformanceDocument
) => {
  const page = document.pages[0]!
  const root = projectPagePaintPlan(document, page.id).entries.find(
    (entry): entry is MaskGroupPaintPlanEntry => entry.kind === "mask_group"
  )!
  const child = root.content.find(
    (entry): entry is MaskGroupPaintPlanEntry => entry.kind === "mask_group"
  )!
  return { root, child }
}

describe("nested mask retained conformance fixtures", () => {
  it("covers vector to alpha with multi-source, crop, rich text, and run fonts", () => {
    const document = nestedVectorAlphaRenderConformanceDocument
    const { root, child } = nestedEntries(document)

    expect(root).toMatchObject({
      maskType: "vector",
      sourceNodeIds: [
        "nested-vector-alpha-outer-source-one",
        "nested-vector-alpha-outer-source-two",
      ],
      compositeRequired: true,
    })
    expect(child).toMatchObject({
      maskType: "alpha",
      sourceNodeIds: ["nested-vector-alpha-child-image"],
      compositeRequired: true,
    })
    expect(
      document.nodes.find(
        (node) => node.id === "nested-vector-alpha-child-image"
      )
    ).toMatchObject({
      type: "image",
      placement: { mode: "manual", rotation: -17, flipX: true },
      frameMask: { shape: "rounded_rectangle", radius: 0.22 },
    })
    expect(
      document.nodes.find((node) => node.id === "nested-vector-alpha-rich-text")
    ).toMatchObject({
      type: "text",
      runs: [
        { style: { fontFamily: "Geist Variable" } },
        { style: { fontFamily: "Geist Variable" } },
      ],
    })
  })

  it("covers luminance to multi-vector with one hidden parent source", () => {
    const { root, child } = nestedEntries(
      nestedLuminanceVectorOneHiddenRenderConformanceDocument
    )

    expect(root).toMatchObject({
      maskType: "luminance",
      sourceNodeIds: [
        "nested-luminance-vector-outer-red",
        "nested-luminance-vector-outer-green",
      ],
      visibleSourceNodeIds: ["nested-luminance-vector-outer-red"],
      compositeRequired: true,
    })
    expect(child).toMatchObject({
      maskType: "vector",
      sourceNodeIds: [
        "nested-luminance-vector-child-one",
        "nested-luminance-vector-child-two",
      ],
      compositeRequired: true,
    })
  })

  it("covers multi-alpha to all-hidden luminance fallthrough", () => {
    const { root, child } = nestedEntries(
      nestedAlphaLuminanceAllHiddenRenderConformanceDocument
    )

    expect(root).toMatchObject({
      maskType: "alpha",
      sourceNodeIds: [
        "nested-alpha-luminance-outer-image",
        "nested-alpha-luminance-outer-text",
      ],
      compositeRequired: true,
    })
    expect(child).toMatchObject({
      maskType: "luminance",
      visibleSourceNodeIds: [],
      maskEnabled: false,
      compositeRequired: false,
    })
  })

  it("retains an exact nested descendant image-decode failure fixture", () => {
    expect(
      nestedImageFailureRenderConformanceDocument.nodes.find(
        (node) => node.id === "nested-vector-alpha-child-image"
      )
    ).toMatchObject({
      type: "image",
      src: "data:image/png;base64,AA==",
    })
    expect(
      projectPagePaintPlan(
        nestedImageFailureRenderConformanceDocument,
        nestedImageFailureRenderConformanceDocument.pages[0]!.id
      ).entries
    ).toHaveLength(3)
  })

  it.each([
    {
      label: "third mask depth",
      document: nestedOverDepthRenderConformanceDocument,
      code: "MASK_GROUP_NESTING_UNSUPPORTED",
    },
    {
      label: "summed 2x composite area",
      document: nestedCompositeAreaLimitRenderConformanceDocument,
      code: "MASK_PAGE_COMPOSITE_AREA_LIMIT",
    },
  ] as const)("retains the $label rejection fixture", ({ document, code }) => {
    try {
      projectPagePaintPlan(document, document.pages[0]!.id, { pixelRatio: 2 })
      throw new Error(`Expected ${code}`)
    } catch (error) {
      expect(error).toBeInstanceOf(PagePaintPlanError)
      expect(error).toMatchObject({ code })
    }
  })
})
