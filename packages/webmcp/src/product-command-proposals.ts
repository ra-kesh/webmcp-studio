import {
  captureSemanticFragment,
  changeSetSchema,
  cloneSemanticFragment,
  previewChangeSet,
  type ChangeSet,
  type Document,
  type DocumentCommand,
} from "@webmcp/document"
import {
  createImageFrameCommandDrafts,
  createImagePlacementCommandDrafts,
  type EditorImageFrameCommandId,
  type EditorImagePlacementCommandId,
} from "@webmcp/editor/commands"
import {
  alignNodes,
  alignNodesToBounds,
  distributeNodes,
} from "@webmcp/editor/geometry"
import type { ResolvedProductCommand } from "@webmcp/editor/product-commands"
import type { ChangeSetIdentityFactory } from "./change-sets"

export type ProductCommandAffectedIds = Readonly<{
  added: readonly string[]
  updated: readonly string[]
  removed: readonly string[]
}>

export type ProductCommandProposalAffected = Readonly<{
  nodes: ProductCommandAffectedIds
  groups: ProductCommandAffectedIds
  pages: ProductCommandAffectedIds
  outputs: ProductCommandAffectedIds
  fields: ProductCommandAffectedIds
  bindings: ProductCommandAffectedIds
}>

export type ProductCommandProposal = Readonly<{
  changeSet: ChangeSet
  affected: ProductCommandProposalAffected
}>

export class ProductCommandProposalError extends Error {
  constructor(
    readonly code:
      | "invalid_target"
      | "no_changes"
      | "operation_limit_exceeded"
      | "unsupported_command",
    message: string
  ) {
    super(message)
    this.name = "ProductCommandProposalError"
  }
}

type DocumentCommandDraft = DocumentCommand extends infer Command
  ? Command extends DocumentCommand
    ? Omit<Command, "id" | "at" | "actor">
    : never
  : never

const changedIds = <Value extends Readonly<{ id: string }>>(
  before: readonly Value[],
  after: readonly Value[],
  additionalChanged: ReadonlySet<string> = new Set()
): ProductCommandAffectedIds => {
  const beforeById = new Map(before.map((value) => [value.id, value]))
  const afterById = new Map(after.map((value) => [value.id, value]))
  return {
    added: after.flatMap((value) =>
      beforeById.has(value.id) ? [] : [value.id]
    ),
    updated: before.flatMap((value) => {
      const next = afterById.get(value.id)
      return next &&
        (additionalChanged.has(value.id) ||
          JSON.stringify(value) !== JSON.stringify(next))
        ? [value.id]
        : []
    }),
    removed: before.flatMap((value) =>
      afterById.has(value.id) ? [] : [value.id]
    ),
  }
}

export function createProductCommandProposal(
  document: Document,
  resolved: ResolvedProductCommand,
  identity: ChangeSetIdentityFactory
): ProductCommandProposal {
  const { invocation } = resolved
  const selection =
    invocation.target?.kind === "selection" ? invocation.target : null
  const selectedNodes = selection
    ? selection.nodeIds.map((nodeId) => {
        const node = document.nodes.find((candidate) => candidate.id === nodeId)
        if (!node)
          throw new ProductCommandProposalError(
            "invalid_target",
            `Unknown selected layer: ${nodeId}`
          )
        return node
      })
    : []
  const target = invocation.target
  const page = selection
    ? document.pages.find((candidate) => candidate.id === selection.pageId)
    : target?.kind === "page"
      ? document.pages.find((candidate) => candidate.id === target.pageId)
      : target?.kind === "group"
        ? document.pages.find((candidate) => candidate.id === target.pageId)
        : undefined
  const targetGroup =
    target?.kind === "group"
      ? document.groups.find((candidate) => candidate.id === target.groupId)
      : selection?.groupId
        ? document.groups.find(
            (candidate) => candidate.id === selection.groupId
          )
        : undefined
  const operations: Array<{
    command: DocumentCommandDraft
    summary: string
  }> = []

  const updateSelected = (
    patch: (
      node: (typeof selectedNodes)[number]
    ) => Partial<(typeof selectedNodes)[number]>,
    summary: string,
    nodes = selectedNodes
  ) => {
    for (const node of nodes) {
      operations.push({
        command: {
          type: "update_node",
          nodeId: node.id,
          patch: patch(node),
        },
        summary,
      })
    }
  }

  switch (invocation.commandId) {
    case "selection.nudge-left":
      updateSelected(
        (node) => ({ x: node.x - 1 }),
        "Move layer left",
        selectedNodes.filter((node) => !node.locked)
      )
      break
    case "selection.nudge-right":
      updateSelected(
        (node) => ({ x: node.x + 1 }),
        "Move layer right",
        selectedNodes.filter((node) => !node.locked)
      )
      break
    case "selection.nudge-up":
      updateSelected(
        (node) => ({ y: node.y - 1 }),
        "Move layer up",
        selectedNodes.filter((node) => !node.locked)
      )
      break
    case "selection.nudge-down":
      updateSelected(
        (node) => ({ y: node.y + 1 }),
        "Move layer down",
        selectedNodes.filter((node) => !node.locked)
      )
      break
    case "object.visibility.toggle":
      updateSelected(
        () => ({ visible: selectedNodes.every((node) => !node.visible) }),
        resolved.label
      )
      break
    case "object.lock.toggle":
      updateSelected(
        () => ({ locked: !selectedNodes.every((node) => node.locked) }),
        resolved.label
      )
      break
    case "object.delete":
      for (const node of selectedNodes) {
        operations.push({
          command: { type: "remove_node", nodeId: node.id },
          summary: `Delete ${node.name}`,
        })
      }
      break
    case "object.duplicate": {
      if (!page || !selection)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select layers to duplicate."
        )
      const fragment = captureSemanticFragment(
        document,
        page.id,
        selection.nodeIds
      )
      const clone = cloneSemanticFragment(fragment, {
        targetPageId: page.id,
        offsetX: 24,
        offsetY: 24,
        nameSuffix: " copy",
        createId: (kind, sourceId) => `${kind}-${sourceId}-${identity.id()}`,
      })
      operations.push({
        command: {
          type: "duplicate_nodes",
          pageId: page.id,
          nodes: clone.nodes,
          groups: clone.groups,
          componentInstances: clone.componentInstances,
          bindings: clone.bindings,
          variableBindings: clone.variableBindings,
        },
        summary: `Duplicate ${clone.nodes.length} layer${clone.nodes.length === 1 ? "" : "s"}`,
      })
      break
    }
    case "object.group":
      if (!page || !selection)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select layers to group."
        )
      operations.push({
        command: {
          type: "group_nodes",
          groupId: `group-${identity.id()}`,
          pageId: page.id,
          name: "Group",
          nodeIds: [...selection.nodeIds],
        },
        summary: `Group ${selection.nodeIds.length} layers`,
      })
      break
    case "object.ungroup":
      if (!selection?.groupId)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select a group to ungroup."
        )
      operations.push({
        command: { type: "ungroup_nodes", groupId: selection.groupId },
        summary: "Ungroup selected layers",
      })
      break
    case "mask.create": {
      if (!page || !selection || selectedNodes.length < 2) {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select at least two layers on one page to create a mask."
        )
      }
      if (invocation.arguments?.kind !== "mask-create") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose from one through four selected layers as mask sources."
        )
      }
      const sourceNodeIds = [...invocation.arguments.sourceNodeIds] as [
        string,
        ...string[],
      ]
      const parentGroupId = invocation.arguments.parentGroupId
      if (
        sourceNodeIds.length < 1 ||
        sourceNodeIds.length > 4 ||
        new Set(sourceNodeIds).size !== sourceNodeIds.length
      ) {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose from one through four unique selected layers as mask sources."
        )
      }
      if (
        !sourceNodeIds.every((nodeId) => selection.nodeIds.includes(nodeId))
      ) {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Every mask source must be one of the selected layers."
        )
      }
      operations.push({
        command: {
          type: "create_mask_group",
          expectedRevision: document.revision,
          pageId: page.id,
          groupId: `mask-${identity.id()}`,
          name: "Mask",
          nodeIds: [...selection.nodeIds],
          sourceNodeIds,
          maskType: "vector",
          ...(parentGroupId ? { parentGroupId } : {}),
        },
        summary: `Create a vector mask from ${sourceNodeIds.length} ordered source${sourceNodeIds.length === 1 ? "" : "s"} across ${selection.nodeIds.length} layers${parentGroupId ? ` inside ${parentGroupId}` : ""}`,
      })
      break
    }
    case "mask.release":
      if (!page || !targetGroup || targetGroup.role !== "mask") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select one mask group to release."
        )
      }
      operations.push({
        command: {
          type: "release_mask_group",
          expectedRevision: document.revision,
          pageId: page.id,
          groupId: targetGroup.id,
        },
        summary: `Release ${targetGroup.name}`,
      })
      break
    case "mask.type.vector":
    case "mask.type.alpha":
    case "mask.type.luminance": {
      if (!page || !targetGroup || targetGroup.role !== "mask") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select one mask group before changing its type."
        )
      }
      const maskType = invocation.commandId.slice("mask.type.".length) as
        "vector" | "alpha" | "luminance"
      operations.push({
        command: {
          type: "set_mask_type",
          expectedRevision: document.revision,
          pageId: page.id,
          groupId: targetGroup.id,
          maskType,
        },
        summary: `Set ${targetGroup.name} to ${maskType}`,
      })
      break
    }
    case "mask.sources.set":
      if (!page || !targetGroup || targetGroup.role !== "mask") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select one mask group before changing its source."
        )
      }
      if (invocation.arguments?.kind !== "mask-sources") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose from one through four layers in the mask group as its sources."
        )
      }
      const sourceNodeIds = [...invocation.arguments.sourceNodeIds] as [
        string,
        ...string[],
      ]
      operations.push({
        command: {
          type: "set_mask_sources",
          expectedRevision: document.revision,
          pageId: page.id,
          groupId: targetGroup.id,
          sourceNodeIds,
        },
        summary: `Set ${sourceNodeIds.length} ordered mask source${sourceNodeIds.length === 1 ? "" : "s"} for ${targetGroup.name}`,
      })
      break
    case "arrange.front":
    case "arrange.back": {
      if (!page || !selection)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select layers to reorder."
        )
      if (selection.groupId && selectedNodes.some((node) => node.locked)) {
        throw new ProductCommandProposalError(
          "no_changes",
          "Unlock every layer in the selected group before reordering it."
        )
      }
      const selected = new Set(
        selectedNodes.filter((node) => !node.locked).map((node) => node.id)
      )
      const ordered = page.nodeIds.filter((nodeId) => selected.has(nodeId))
      const remaining = page.nodeIds.filter((nodeId) => !selected.has(nodeId))
      operations.push({
        command: {
          type: "reorder_nodes",
          pageId: page.id,
          nodeIds: ordered,
          toIndex:
            invocation.commandId === "arrange.front" ? remaining.length : 0,
        },
        summary: resolved.label,
      })
      break
    }
    case "arrange.forward":
    case "arrange.backward": {
      const node = selectedNodes[0]
      if (!page || !node || selectedNodes.length !== 1) {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Select one layer to move it one step."
        )
      }
      if (node.locked) {
        throw new ProductCommandProposalError(
          "no_changes",
          "Unlock the selected layer before reordering it."
        )
      }
      const currentIndex = page.nodeIds.indexOf(node.id)
      const offset = invocation.commandId === "arrange.forward" ? 1 : -1
      operations.push({
        command: {
          type: "reorder_node",
          pageId: page.id,
          nodeId: node.id,
          toIndex: Math.max(
            0,
            Math.min(page.nodeIds.length - 1, currentIndex + offset)
          ),
        },
        summary: resolved.label,
      })
      break
    }
    case "arrange.align": {
      if (!page || invocation.arguments?.kind !== "alignment") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose an alignment."
        )
      }
      const editableNodes = selectedNodes.filter((node) => !node.locked)
      const changes =
        invocation.arguments.relativeTo === "page"
          ? alignNodesToBounds(editableNodes, invocation.arguments.alignment, {
              left: 0,
              top: 0,
              right: page.width,
              bottom: page.height,
              width: page.width,
              height: page.height,
              centerX: page.width / 2,
              centerY: page.height / 2,
            })
          : alignNodes(editableNodes, invocation.arguments.alignment)
      for (const change of changes) {
        operations.push({
          command: {
            type: "update_node",
            nodeId: change.nodeId,
            patch: change.patch,
          },
          summary: resolved.label,
        })
      }
      break
    }
    case "arrange.distribute": {
      if (invocation.arguments?.kind !== "distribution") {
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose a distribution direction."
        )
      }
      for (const change of distributeNodes(
        selectedNodes.filter((node) => !node.locked),
        invocation.arguments.distribution
      )) {
        operations.push({
          command: {
            type: "update_node",
            nodeId: change.nodeId,
            patch: change.patch,
          },
          summary: resolved.label,
        })
      }
      break
    }
    case "image.fit":
    case "image.fill":
    case "image.flip-horizontal":
    case "image.flip-vertical":
    case "image.rotate-left":
    case "image.rotate-right":
    case "image.rotation.reset":
    case "image.reset-placement":
      for (const draft of createImagePlacementCommandDrafts(
        invocation.commandId as EditorImagePlacementCommandId,
        selectedNodes
      )) {
        operations.push({ command: draft, summary: resolved.label })
      }
      break
    case "image.frame.rectangle":
    case "image.frame.rounded-rectangle":
    case "image.frame.ellipse":
      for (const draft of createImageFrameCommandDrafts(
        invocation.commandId as EditorImageFrameCommandId,
        selectedNodes
      )) {
        operations.push({ command: draft, summary: resolved.label })
      }
      break
    case "page.remove":
      if (!page)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose a page to delete."
        )
      operations.push({
        command: { type: "remove_page", pageId: page.id },
        summary: `Delete ${page.name}`,
      })
      break
    case "page.move-up":
    case "page.move-down": {
      if (!page)
        throw new ProductCommandProposalError(
          "invalid_target",
          "Choose a page to move."
        )
      const output = document.outputs.find(
        (candidate) => candidate.id === page.outputId
      )
      if (!output)
        throw new ProductCommandProposalError(
          "invalid_target",
          `Unknown output: ${page.outputId}`
        )
      const currentIndex = output.pageIds.indexOf(page.id)
      const offset = invocation.commandId === "page.move-up" ? -1 : 1
      operations.push({
        command: {
          type: "reorder_page",
          outputId: output.id,
          pageId: page.id,
          toIndex: Math.max(
            0,
            Math.min(output.pageIds.length - 1, currentIndex + offset)
          ),
        },
        summary: resolved.label,
      })
      break
    }
    default:
      throw new ProductCommandProposalError(
        "unsupported_command",
        "This command does not have a reviewable document-operation contract."
      )
  }

  if (!operations.length) {
    throw new ProductCommandProposalError(
      "no_changes",
      "The command would not change the document."
    )
  }
  if (operations.length > 100) {
    throw new ProductCommandProposalError(
      "operation_limit_exceeded",
      "A command proposal can contain at most 100 atomic operations."
    )
  }
  const changeSet = changeSetSchema.parse({
    id: `change-set-${identity.id()}`,
    documentId: document.id,
    baseRevision: document.revision,
    baseSnapshotId: resolved.invocation.target?.snapshotId ?? "",
    title: resolved.label,
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations: operations.map((operation) => {
      const at = identity.now()
      return {
        id: `operation-${identity.id()}`,
        command: {
          ...operation.command,
          id: `command-${identity.id()}`,
          at,
          actor: "agent" as const,
        },
        summary: operation.summary,
        status: "pending" as const,
      }
    }),
  })
  let preview: Document
  try {
    preview = previewChangeSet(document, changeSet, changeSet.baseSnapshotId)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid proposal."
    throw new ProductCommandProposalError(
      /already|would not change|nothing to/i.test(message)
        ? "no_changes"
        : "invalid_target",
      message
    )
  }
  const fieldValueChanges = new Set(
    document.fields.flatMap((field) =>
      Object.is(document.fieldValues[field.id], preview.fieldValues[field.id])
        ? []
        : [field.id]
    )
  )
  const affected: ProductCommandProposalAffected = {
    nodes: changedIds(document.nodes, preview.nodes),
    groups: changedIds(document.groups, preview.groups),
    pages: changedIds(document.pages, preview.pages),
    outputs: changedIds(document.outputs, preview.outputs),
    fields: changedIds(document.fields, preview.fields, fieldValueChanges),
    bindings: changedIds(document.bindings, preview.bindings),
  }
  const affectedCount = Object.values(affected).reduce(
    (total, entity) =>
      total +
      entity.added.length +
      entity.updated.length +
      entity.removed.length,
    0
  )
  if (affectedCount === 0) {
    throw new ProductCommandProposalError(
      "no_changes",
      "The command would not change the document."
    )
  }
  if (affectedCount > 100) {
    throw new ProductCommandProposalError(
      "operation_limit_exceeded",
      "A command proposal can affect at most 100 document entities."
    )
  }
  return { changeSet, affected }
}
