import type { ChangeOperation, Document } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import {
  assetValueDisplay,
  displayFieldChangeValue,
} from "./field-review-display"

export type ReviewOperationDetails = {
  label: string
  context: string
  before: string
  after: string
}

const displayChangeValue = (value: unknown) => {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function displayAssetId(value: unknown, source?: unknown): string {
  if (typeof value !== "string" || !value) return "No asset"
  if (typeof source === "string") return assetValueDisplay(source).label
  const catalogId = value.startsWith("library-")
    ? value.slice("library-".length)
    : value
  const catalogAsset = studioAssets.find((asset) => asset.id === catalogId)
  if (catalogAsset) {
    return value.startsWith("library-")
      ? `${catalogAsset.name} · Legacy curated value`
      : `${catalogAsset.name} · Curated Studio asset`
  }
  return value.startsWith("asset-")
    ? `Workspace-managed image (${value})`
    : "Legacy asset value"
}

function displayNodeProperty(
  key: string,
  value: unknown,
  source?: unknown
): string {
  return key === "assetId"
    ? displayAssetId(value, source)
    : displayChangeValue(value)
}

export function operationDetails(
  document: Document,
  operation: ChangeOperation
): ReviewOperationDetails {
  const command = operation.command
  const nodeNames = (nodeIds: readonly string[]) =>
    nodeIds.map(
      (nodeId) =>
        document.nodes.find((candidate) => candidate.id === nodeId)?.name ??
        nodeId
    )
  const groupFor = (groupId: string) =>
    document.groups.find((candidate) => candidate.id === groupId)
  const maskSourceNames = (groupId: string) => {
    const group = groupFor(groupId)
    return group?.role === "mask" ? nodeNames(group.mask.sourceNodeIds) : []
  }
  if (command.type === "create_mask_group") {
    const contentIds = command.nodeIds.filter(
      (nodeId) => !command.sourceNodeIds.includes(nodeId)
    )
    return {
      label: command.name,
      context: `${command.maskType} mask · ${command.sourceNodeIds.length} source${command.sourceNodeIds.length === 1 ? "" : "s"} · ${contentIds.length} content layer${contentIds.length === 1 ? "" : "s"}${command.parentGroupId ? ` · inside ${groupFor(command.parentGroupId)?.name ?? command.parentGroupId}` : " · top level"}`,
      before: `Separate layers: ${nodeNames(command.nodeIds).join(" · ")}`,
      after: `Mask source: ${nodeNames(command.sourceNodeIds).join(" · ")}${command.parentGroupId ? ` · Parent: ${groupFor(command.parentGroupId)?.name ?? command.parentGroupId}` : ""}`,
    }
  }
  if (command.type === "release_mask_group") {
    const group = groupFor(command.groupId)
    const parent = group?.parentGroupId
      ? groupFor(group.parentGroupId)
      : undefined
    return {
      label: group?.name ?? command.groupId,
      context: parent ? `Release nested mask · ${parent.name}` : "Release mask",
      before: `Mask source: ${maskSourceNames(command.groupId).join(" · ") || "Unknown layer"}`,
      after: parent
        ? `Mask group removed; layers return to ${parent.name}`
        : "Mask group removed; layers remain on the page",
    }
  }
  if (command.type === "set_mask_type") {
    const group = groupFor(command.groupId)
    return {
      label: group?.name ?? command.groupId,
      context: "Mask type",
      before: group?.role === "mask" ? group.mask.type : "Unknown type",
      after: command.maskType,
    }
  }
  if (command.type === "set_mask_sources") {
    const group = groupFor(command.groupId)
    return {
      label: group?.name ?? command.groupId,
      context: "Mask source",
      before: maskSourceNames(command.groupId).join(" · ") || "Unknown layer",
      after: nodeNames(command.sourceNodeIds).join(" · "),
    }
  }
  if (command.type === "set_field") {
    const field = document.fields.find(
      (candidate) => candidate.id === command.fieldId
    )
    const bindings = document.bindings.filter(
      (binding) => binding.fieldId === command.fieldId
    )
    const pageByNode = new Map(
      document.pages.flatMap((page) =>
        page.nodeIds.map((nodeId) => [nodeId, page] as const)
      )
    )
    const outputCount = new Set(
      bindings.flatMap((binding) => {
        const page = pageByNode.get(binding.nodeId)
        return page ? [page.outputId] : []
      })
    ).size
    return {
      label: field?.label ?? command.fieldId,
      context: `${bindings.length} layer${bindings.length === 1 ? "" : "s"} across ${outputCount} output${outputCount === 1 ? "" : "s"}`,
      before: displayFieldChangeValue(
        field,
        document.fieldValues[command.fieldId]
      ),
      after: displayFieldChangeValue(field, command.value),
    }
  }
  if (command.type === "update_node") {
    const node = document.nodes.find(
      (candidate) => candidate.id === command.nodeId
    )
    const keys = Object.keys(command.patch).filter((key) => key !== "src")
    const beforeSource = node?.type === "image" ? node.src : undefined
    const afterSource = "src" in command.patch ? command.patch.src : undefined
    const noReviewableProperties = "No public property changes"
    return {
      label: node?.name ?? command.nodeId,
      context: `${keys.length} public layer propert${keys.length === 1 ? "y" : "ies"}`,
      before:
        keys
          .map(
            (key) =>
              `${key}: ${displayNodeProperty(key, node?.[key as keyof typeof node], beforeSource)}`
          )
          .join(" · ") || noReviewableProperties,
      after:
        keys
          .map(
            (key) =>
              `${key}: ${displayNodeProperty(key, command.patch[key as keyof typeof command.patch], afterSource)}`
          )
          .join(" · ") || noReviewableProperties,
    }
  }
  if (command.type === "replace_image_source") {
    const node = document.nodes.find(
      (candidate) => candidate.id === command.nodeId
    )
    return {
      label: node?.name ?? command.nodeId,
      context: "Image source",
      before:
        node?.type === "image"
          ? displayAssetId(node.assetId, node.src)
          : "Current image",
      after: displayAssetId(command.assetId, command.src),
    }
  }
  if (command.type === "add_output_variant") {
    return {
      label: command.output.name,
      context: `${command.page.width} × ${command.page.height} · ${command.nodes.length} adapted layer${command.nodes.length === 1 ? "" : "s"}`,
      before: "Output does not exist",
      after: `${command.output.kind.replaceAll("_", " ")} · ${command.output.exportFormats.join(" + ").toUpperCase()}`,
    }
  }
  if (command.type === "add_node") {
    const after =
      command.node.type === "image"
        ? `${displayAssetId(command.node.assetId, command.node.src)} · Add to ${command.pageId} at ${command.node.x}, ${command.node.y}`
        : `Add to ${command.pageId} at ${command.node.x}, ${command.node.y}`
    return {
      label: command.node.name,
      context: `${command.node.width} × ${command.node.height} ${command.node.type.replaceAll("_", " ")} layer`,
      before: "Layer does not exist",
      after,
    }
  }
  return {
    label: command.type.replaceAll("_", " "),
    context: "Canonical document command",
    before: "Current document",
    after: operation.summary,
  }
}
