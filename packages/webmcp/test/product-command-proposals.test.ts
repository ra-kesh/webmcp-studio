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
import { deriveInspectorMaskCapabilities } from "@webmcp/editor/inspector"
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

  it("creates one atomic mask proposal from ordered selected source identities", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    const panel = document.nodes.find((node) => node.id === "cover-panel")!
    document.nodes.push({
      ...panel,
      id: "cover-mask-alternate",
      name: "Alternate mask",
      x: panel.x + 20,
    })
    page.nodeIds.splice(1, 0, "cover-mask-alternate")
    const nodeIds = ["cover-panel", "cover-mask-alternate", "cover-eyebrow"]
    const runtime = context(document, nodeIds)
    const mask = deriveInspectorMaskCapabilities({
      document,
      pageId: "cover",
      selectedNodeIds: nodeIds,
    })
    const resolvedMask = resolveProductCommand(
      {
        commandId: "mask.create",
        target: {
          kind: "selection",
          documentId: document.id,
          snapshotId: runtime.snapshotId,
          displayName: "Selected layers",
          pageId: "cover",
          nodeIds,
          groupId: null,
        },
        arguments: {
          kind: "mask-create",
          sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
        },
      },
      { ...runtime, mask }
    )

    const proposal = createProductCommandProposal(
      document,
      resolvedMask,
      identity()
    )

    expect(proposal.changeSet.operations).toHaveLength(1)
    expect(proposal.changeSet.operations[0]?.command).toMatchObject({
      type: "create_mask_group",
      expectedRevision: document.revision,
      pageId: "cover",
      nodeIds,
      sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
      maskType: "vector",
    })
    expect(
      previewChangeSet(document, proposal.changeSet, "snapshot-proposal").groups
    ).toContainEqual(
      expect.objectContaining({
        role: "mask",
        nodeIds,
        mask: {
          type: "vector",
          sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
        },
      })
    )
    expect(proposal.changeSet.operations[0]?.summary).toBe(
      "Create a vector mask from 2 ordered sources across 3 layers"
    )
  })

  it("reassigns and releases a mask through one typed operation each", () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages.find((candidate) => candidate.id === "cover")!
    const originalSource = document.nodes.find(
      (node) => node.id === "cover-panel"
    )!
    document.nodes.push({
      ...originalSource,
      id: "cover-mask-alternate",
      name: "Alternate mask",
      x: originalSource.x + 20,
    })
    page.nodeIds.splice(1, 0, "cover-mask-alternate")
    document.groups.push({
      id: "cover-mask",
      role: "mask",
      pageId: page.id,
      name: "Cover mask",
      nodeIds: ["cover-panel", "cover-mask-alternate", "cover-eyebrow"],
      mask: { type: "vector", sourceNodeIds: ["cover-panel"] },
    })
    const nodeIds = ["cover-panel", "cover-mask-alternate", "cover-eyebrow"]
    const base = context(document, nodeIds, { groupId: "cover-mask" })
    const mask = deriveInspectorMaskCapabilities({
      document,
      pageId: page.id,
      selectedNodeIds: nodeIds,
      selectedGroupId: "cover-mask",
      candidateSourceNodeIds: ["cover-mask-alternate", "cover-panel"],
    })
    const runtime = {
      ...base,
      mask,
      editor: { ...base.editor, hasSelectedGroup: true },
    }
    const target = {
      kind: "group" as const,
      documentId: document.id,
      snapshotId: runtime.snapshotId,
      displayName: "Cover mask",
      pageId: page.id,
      groupId: "cover-mask",
    }
    const sourceProposal = createProductCommandProposal(
      document,
      resolveProductCommand(
        {
          commandId: "mask.sources.set",
          target,
          arguments: {
            kind: "mask-sources",
            sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
          },
        },
        runtime
      ),
      identity()
    )
    expect(sourceProposal.changeSet.operations).toHaveLength(1)
    expect(sourceProposal.changeSet.operations[0]?.command).toMatchObject({
      type: "set_mask_sources",
      groupId: "cover-mask",
      sourceNodeIds: ["cover-mask-alternate", "cover-panel"],
    })
    expect(sourceProposal.changeSet.operations[0]?.summary).toBe(
      "Set 2 ordered mask sources for Cover mask"
    )

    const luminanceProposal = createProductCommandProposal(
      document,
      resolveProductCommand(
        { commandId: "mask.type.luminance", target },
        runtime
      ),
      identity()
    )
    expect(luminanceProposal.changeSet.operations).toHaveLength(1)
    expect(luminanceProposal.changeSet.operations[0]?.command).toMatchObject({
      type: "set_mask_type",
      groupId: "cover-mask",
      maskType: "luminance",
    })
    expect(
      previewChangeSet(
        document,
        luminanceProposal.changeSet,
        "snapshot-proposal"
      ).groups.find((group) => group.id === "cover-mask")
    ).toMatchObject({ mask: { type: "luminance" } })

    const releaseProposal = createProductCommandProposal(
      document,
      resolveProductCommand({ commandId: "mask.release", target }, runtime),
      identity()
    )
    expect(releaseProposal.changeSet.operations).toHaveLength(1)
    expect(releaseProposal.changeSet.operations[0]?.command).toMatchObject({
      type: "release_mask_group",
      groupId: "cover-mask",
    })
    const releasedDocument = previewChangeSet(
      document,
      releaseProposal.changeSet,
      "snapshot-proposal"
    )
    expect(
      releasedDocument.groups.find((group) => group.id === "cover-mask")
    ).toBeUndefined()
    expect(
      releasedDocument.nodes.some((node) => node.id === "cover-panel")
    ).toBe(true)
  })
})
