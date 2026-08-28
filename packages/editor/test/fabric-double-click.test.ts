import { Rect, Textbox } from "fabric"
import { describe, expect, it, vi } from "vitest"
import type { SceneNode } from "@webmcp/document"
import { renderConformanceDocument } from "@webmcp/document"
import { FabricCanvasAdapter } from "../src/fabric-adapter"

type DoubleClickInternals = {
  nodeIdByObject: WeakMap<Rect, string>
  nodeByNodeId: Map<string, SceneNode>
  onMouseDoubleClick: (event: {
    e: { clientX: number; clientY: number }
    target?: Rect | Textbox
  }) => void
}

describe("Fabric double-click intent routing", () => {
  it("keeps image crop, text editing, and empty-canvas zoom distinct", () => {
    const onImageDoubleClick = vi.fn()
    const onCanvasDoubleClick = vi.fn()
    const adapter = new FabricCanvasAdapter({
      onSelectionChange: vi.fn(),
      onNodesChange: vi.fn(),
      onImageDoubleClick,
      onCanvasDoubleClick,
    })
    const internals = adapter as unknown as DoubleClickInternals
    const imageNode = renderConformanceDocument.nodes.find(
      (node) => node.type === "image"
    )
    if (!imageNode) throw new Error("Expected conformance image node")

    const imageTarget = new Rect()
    internals.nodeIdByObject.set(imageTarget, imageNode.id)
    internals.nodeByNodeId.set(imageNode.id, imageNode)
    internals.onMouseDoubleClick({
      e: { clientX: 40, clientY: 60 },
      target: imageTarget,
    })

    expect(onImageDoubleClick).toHaveBeenCalledOnce()
    expect(onImageDoubleClick).toHaveBeenCalledWith(imageNode.id)
    expect(onCanvasDoubleClick).not.toHaveBeenCalled()

    internals.onMouseDoubleClick({
      e: { clientX: 80, clientY: 120 },
      target: Object.create(Textbox.prototype) as Textbox,
    })
    expect(onImageDoubleClick).toHaveBeenCalledOnce()
    expect(onCanvasDoubleClick).not.toHaveBeenCalled()

    internals.onMouseDoubleClick({ e: { clientX: 160, clientY: 220 } })
    expect(onCanvasDoubleClick).toHaveBeenCalledOnce()
    expect(onCanvasDoubleClick).toHaveBeenCalledWith({
      clientX: 160,
      clientY: 220,
    })
  })
})
