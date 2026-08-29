import { describe, expect, it } from "vitest"
import {
  northstarSeed,
  previewChangeSet,
  type Document,
} from "@webmcp/document"
import {
  resolveProductCommand,
  type ProductCommandInvocation,
  type ProductCommandRuntimeContext,
} from "@webmcp/editor/product-commands"
import {
  createProductCommandProposal,
  ProductCommandProposalError,
} from "../src/product-command-proposals"

const identity = () => {
  let sequence = 0
  return {
    id: () => String(++sequence),
    now: () => "2026-08-29T10:00:00.000Z",
  }
}

function context(
  document: Document,
  nodeIds: readonly string[],
  overrides: Partial<ProductCommandRuntimeContext["selection"]> = {}
): ProductCommandRuntimeContext {
  const selected = nodeIds.map((nodeId) =>
    document.nodes.find((node) => node.id === nodeId)!
  )
  return {
    documentId: document.id,
    snapshotId: "snapshot-proposal",
    activePageId: "cover",
    activeOutputId: "proposal",
    pageIds: document.pages.map((page) => page.id),
    outputIds: document.outputs.map((output) => output.id),
    nodeIds: document.nodes.map((node) => node.id),
    groupIds: document.groups.map((group) => group.id),
    selection: {
      pageId: "cover",
      nodeIds,
      nodeTypes: selected.map((node) => node.type),
      groupId: null,
      anyLocked: selected.some((node) => node.locked),
      allLocked: selected.every((node) => node.locked),
      allVisible: selected.every((node) => node.visible),
      allHidden: selected.every((node) => !node.visible),
      ...overrides,
    },
    activeTool: "select",
    editor: {
      reviewPending: false,
      hasSelection: true,
      selectedNodeCount: nodeIds.length,
      hasSelectedGroup: false,
      hasClipboard: false,
      hasUndo: false,
      hasRedo: false,
      hasZoomSelection: true,
      canCropImage: false,
      canTransformImage: false,
      imageCropActive: false,
    },
  }
}

function resolved(
  document: Document,
  commandId: ProductCommandInvocation["commandId"],
  nodeIds: readonly string[],
  overrides: Partial<ProductCommandRuntimeContext["selection"]> = {}
) {
  const runtime = context(document, nodeIds, overrides)
  return resolveProductCommand(
    {
      commandId,
      target: {
        kind: "selection",
        documentId: document.id,
        snapshotId: runtime.snapshotId,
        displayName: "Selected layers",
        pageId: "cover",
        nodeIds,
        groupId: overrides?.groupId ?? null,
      },
    },
    runtime
  )
}

describe("canonical product command proposals", () => {
  it("matches Studio mixed-visibility behavior by hiding the mixed selection", () => {
    const ids = ["cover-eyebrow", "cover-title"]
    const document: Document = {
      ...northstarSeed,
      nodes: northstarSeed.nodes.map((node) =>
        node.id === ids[0] ? { ...node, visible: false } : node
      ),
    }
    const proposal = createProductCommandProposal(
      document,
      resolved(document, "object.visibility.toggle", ids),
      identity()
    )
    const preview = previewChangeSet(
      document,
      proposal.changeSet,
      "snapshot-proposal"
    )
    expect(
      preview.nodes
        .filter((node) => ids.includes(node.id))
        .map((node) => node.visible)
    ).toEqual([false, false])
    expect(proposal.affected.nodes.updated).toEqual(["cover-title"])
  })

  it("does not create geometry work when locked-node filtering leaves one layer", () => {
    const ids = ["cover-eyebrow", "cover-title"]
    const document: Document = {
      ...northstarSeed,
      nodes: northstarSeed.nodes.map((node) =>
        node.id === ids[1] ? { ...node, locked: true } : node
      ),
    }
    const runtime = context(document, ids)
    const command = resolveProductCommand(
      {
        commandId: "arrange.align",
        target: {
          kind: "selection",
          documentId: document.id,
          snapshotId: runtime.snapshotId,
          displayName: "Selected layers",
          pageId: "cover",
          nodeIds: ids,
          groupId: null,
        },
        arguments: {
          kind: "alignment",
          alignment: "left",
          relativeTo: "selection",
        },
      },
      runtime
    )
    expect(() =>
      createProductCommandProposal(document, command, identity())
    ).toThrowError(ProductCommandProposalError)
    try {
      createProductCommandProposal(document, command, identity())
    } catch (error) {
      expect(error).toMatchObject({ code: "no_changes" })
    }
  })

  it("rejects edge reorders that would only increment revision", () => {
    const nodeId = northstarSeed.pages[0]!.nodeIds.at(-1)!
    expect(() =>
      createProductCommandProposal(
        northstarSeed,
        resolved(northstarSeed, "arrange.front", [nodeId]),
        identity()
      )
    ).toThrowError(ProductCommandProposalError)
  })
})
