import { describe, expect, it } from "vitest"
import type { SceneNode } from "@webmcp/document"
import { alignNodes, distributeNodes, getNodeBounds } from "../src/geometry"

const rect = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0
): SceneNode => ({
  id,
  type: "rect",
  name: id,
  x,
  y,
  width,
  height,
  rotation,
  opacity: 1,
  visible: true,
  locked: false,
  fill: "#ffffff",
  radius: 0,
})

describe("editor geometry", () => {
  it("uses the rendered bounds for rotated nodes", () => {
    expect(getNodeBounds(rect("a", 100, 200, 80, 40, 90))).toMatchObject({
      left: 60,
      top: 200,
      right: 100,
      bottom: 280,
    })
  })

  it("aligns nodes to the selection bounds", () => {
    const changes = alignNodes(
      [rect("a", 20, 40, 100, 80), rect("b", 240, 160, 60, 30)],
      "horizontal-center"
    )
    expect(changes).toEqual([
      { nodeId: "a", patch: { x: 110, y: 40 } },
      { nodeId: "b", patch: { x: 130, y: 160 } },
    ])
  })

  it("distributes the gaps between three nodes", () => {
    const changes = distributeNodes(
      [
        rect("a", 0, 0, 50, 20),
        rect("b", 80, 10, 20, 20),
        rect("c", 200, 20, 50, 20),
      ],
      "horizontal"
    )
    expect(changes).toEqual([
      { nodeId: "a", patch: { x: 0, y: 0 } },
      { nodeId: "b", patch: { x: 115, y: 10 } },
      { nodeId: "c", patch: { x: 200, y: 20 } },
    ])
  })
})
