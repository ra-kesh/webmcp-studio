import { describe, expect, it } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import { positionTransformPatch } from "./position-transform"

describe("positionTransformPatch", () => {
  const node = renderConformanceDocument.nodes[0]

  it("toggles each layer flip independently without mutating the source", () => {
    const flipped = { ...node, flipX: true }

    expect(positionTransformPatch(node, "flip-horizontal")).toEqual({
      flipX: true,
    })
    expect(positionTransformPatch(flipped, "flip-horizontal")).toEqual({
      flipX: false,
    })
    expect(positionTransformPatch(flipped, "flip-vertical")).toEqual({
      flipY: true,
    })
    expect(node.flipX).toBeUndefined()
  })

  it("rotates clockwise using the editor's canonical angle range", () => {
    expect(
      positionTransformPatch({ ...node, rotation: 135 }, "rotate-90")
    ).toEqual({ rotation: -135 })
  })
})
