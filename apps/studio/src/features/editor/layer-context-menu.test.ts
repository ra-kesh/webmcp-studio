import { describe, expect, it } from "vitest"
import { buildLayerTreeModel } from "@webmcp/editor/layer-tree"
import { renderConformanceDocument } from "@webmcp/document"
import { layerContextSelectionNodeIds } from "./layer-context-menu"

describe("layer context selection policy", () => {
  const page = renderConformanceDocument.pages[0]
  const model = buildLayerTreeModel(renderConformanceDocument, page.id)
  const firstNode = [...model.byKey.values()].find(
    (item) => item.kind === "node"
  )!
  const secondNode = [...model.byKey.values()].find(
    (item) => item.kind === "node" && item.id !== firstNode.id
  )!

  it("preserves a multi-selection when the clicked node belongs to it", () => {
    expect(
      layerContextSelectionNodeIds(
        firstNode,
        {
          pageId: page.id,
          nodeIds: [firstNode.id, secondNode.id],
        },
        page.id
      )
    ).toEqual([firstNode.id, secondNode.id])
  })

  it("replaces selection when the clicked node is outside it", () => {
    expect(
      layerContextSelectionNodeIds(
        firstNode,
        { pageId: page.id, nodeIds: [secondNode.id] },
        page.id
      )
    ).toEqual(firstNode.nodeIds)
  })
})
