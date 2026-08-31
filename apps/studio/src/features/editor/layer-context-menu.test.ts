import { describe, expect, it } from "vitest"
import { buildLayerTreeModel } from "@webmcp/editor/layer-tree"
import {
  buildLayerContextMenu,
  type ProductCommandRuntimeContext,
} from "@webmcp/editor/product-commands"
import { renderConformanceDocument } from "@webmcp/document"
import { maskRenderConformanceDocument } from "@webmcp/document/internal/mask-render-conformance"
import {
  createLayerProductCommandContext,
  createLayerProductCommandTarget,
  layerContextSelectionNodeIds,
} from "./layer-context-menu"

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

describe("layer mask command context", () => {
  const page = maskRenderConformanceDocument.pages[0]!
  const model = buildLayerTreeModel(maskRenderConformanceDocument, page.id)
  const content = [...model.byKey.values()].find(
    (item) => item.kind === "node" && item.mask?.role === "content"
  )!
  const base = {
    documentId: maskRenderConformanceDocument.id,
    snapshotId: "snapshot-mask",
    activePageId: page.id,
    activeOutputId: maskRenderConformanceDocument.outputs[0]!.id,
    pageIds: [page.id],
    outputIds: [maskRenderConformanceDocument.outputs[0]!.id],
    nodeIds: page.nodeIds,
    groupIds: maskRenderConformanceDocument.groups.map((group) => group.id),
    selection: null,
    activeTool: "select",
    editor: {
      reviewPending: false,
      hasSelection: false,
      selectedNodeCount: 0,
      hasSelectedGroup: false,
      hasClipboard: false,
      hasUndo: false,
      hasRedo: false,
      hasZoomSelection: false,
      canCropImage: false,
      imageCropActive: false,
    },
  } satisfies ProductCommandRuntimeContext

  it("deep-selects mask content as an explicit replacement source", () => {
    const context = createLayerProductCommandContext(
      base,
      maskRenderConformanceDocument,
      content,
      null
    )

    expect(context.selection?.nodeIds).toEqual([content.id])
    expect(context.mask?.groupId).toBe("mask-conformance-group")
    expect(context.mask?.reassignmentSourceNodeIds).toEqual([content.id])
    expect(context.mask?.setSources).toEqual({
      enabled: true,
      disabledReason: null,
    })
  })

  it("carries the exact parent mask from a nested Layers selection", () => {
    const document = structuredClone(maskRenderConformanceDocument)
    const outer = document.groups.find(
      (group) => group.id === "mask-conformance-group"
    )!
    const originalContent = document.nodes.find(
      (node) => node.id === "mask-conformance-content"
    )!
    const secondContent = {
      ...structuredClone(originalContent),
      id: "mask-conformance-content-two",
      name: "Second masked content",
    }
    document.nodes.push(secondContent)
    document.pages[0]!.nodeIds.splice(
      document.pages[0]!.nodeIds.indexOf(originalContent.id) + 1,
      0,
      secondContent.id
    )
    outer.nodeIds.push(secondContent.id)
    const nestedSelection = {
      pageId: page.id,
      nodeIds: [originalContent.id, secondContent.id],
    }
    const nestedModel = buildLayerTreeModel(document, page.id)
    const nestedContent = nestedModel.byKey.get(`node:${originalContent.id}`)!
    const context = createLayerProductCommandContext(
      {
        ...base,
        nodeIds: document.nodes.map((node) => node.id),
        groupIds: document.groups.map((group) => group.id),
      },
      document,
      nestedContent,
      nestedSelection
    )
    const menu = buildLayerContextMenu(
      context,
      createLayerProductCommandTarget(context, nestedContent)
    )
    const create = menu
      .flatMap((group) => group.items)
      .find(
        (item) =>
          item.type === "command" &&
          item.command.invocation.commandId === "mask.create"
      )

    expect(context.mask?.createParentGroupId).toBe(outer.id)
    expect(create).toMatchObject({
      type: "command",
      command: {
        enabled: true,
        invocation: {
          arguments: {
            kind: "mask-create",
            sourceNodeIds: [originalContent.id],
            parentGroupId: outer.id,
          },
        },
      },
    })
  })
})
