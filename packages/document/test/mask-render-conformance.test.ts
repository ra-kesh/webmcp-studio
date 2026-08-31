import { describe, expect, it } from "vitest"
import {
  luminanceAllHiddenRenderConformanceDocument,
  luminanceOneHiddenRenderConformanceDocument,
  luminancePrimaryCoefficientRenderConformanceDocument,
} from "../src/mask-render-conformance"

describe("luminance mask render conformance fixtures", () => {
  it("retains ordered coefficient sources and keeps destination content visible", () => {
    const mask = luminancePrimaryCoefficientRenderConformanceDocument.groups[0]

    expect(mask?.role).toBe("mask")
    if (!mask || mask.role !== "mask") throw new Error("Expected mask group")
    expect(mask.mask).toEqual({
      type: "luminance",
      sourceNodeIds: [
        "luminance-black",
        "luminance-white",
        "luminance-red",
        "luminance-green",
      ],
    })
    expect(
      luminancePrimaryCoefficientRenderConformanceDocument.nodes.find(
        (node) => node.id === "luminance-primary-coefficients-v1-content"
      )?.visible
    ).toBe(true)
  })

  it("models one-hidden and all-hidden fallthrough without hiding content", () => {
    const visibility = (
      document: typeof luminanceOneHiddenRenderConformanceDocument
    ) =>
      Object.fromEntries(document.nodes.map((node) => [node.id, node.visible]))

    expect(
      visibility(luminanceOneHiddenRenderConformanceDocument)
    ).toMatchObject({
      "luminance-overlap-red": true,
      "luminance-overlap-green": false,
      "luminance-overlap-v1-content": true,
    })
    expect(
      visibility(luminanceAllHiddenRenderConformanceDocument)
    ).toMatchObject({
      "luminance-overlap-red": false,
      "luminance-overlap-green": false,
      "luminance-overlap-v1-content": true,
    })
  })
})
