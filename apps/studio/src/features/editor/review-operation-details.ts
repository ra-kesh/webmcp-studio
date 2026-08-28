import type { ChangeOperation, Document } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import { displayFieldChangeValue } from "./field-review-display"

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

function displayAssetId(value: unknown): string {
  if (typeof value !== "string" || !value) return "No asset"
  const catalogId = value.startsWith("library-")
    ? value.slice("library-".length)
    : value
  const catalogAsset = studioAssets.find((asset) => asset.id === catalogId)
  if (catalogAsset) return `${catalogAsset.name} (${catalogAsset.id})`
  return value.startsWith("asset-")
    ? `Uploaded Studio asset (${value})`
    : `Asset ${value}`
}

function displayNodeProperty(key: string, value: unknown): string {
  return key === "assetId" ? displayAssetId(value) : displayChangeValue(value)
}

export function operationDetails(
  document: Document,
  operation: ChangeOperation
): ReviewOperationDetails {
  const command = operation.command
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
    const noReviewableProperties = "No public property changes"
    return {
      label: node?.name ?? command.nodeId,
      context: `${keys.length} public layer propert${keys.length === 1 ? "y" : "ies"}`,
      before:
        keys
          .map(
            (key) =>
              `${key}: ${displayNodeProperty(key, node?.[key as keyof typeof node])}`
          )
          .join(" · ") || noReviewableProperties,
      after:
        keys
          .map(
            (key) =>
              `${key}: ${displayNodeProperty(key, command.patch[key as keyof typeof command.patch])}`
          )
          .join(" · ") || noReviewableProperties,
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
    return {
      label: command.node.name,
      context: `${command.node.width} × ${command.node.height} image layer`,
      before: "Layer does not exist",
      after: `Add to ${command.pageId} at ${command.node.x}, ${command.node.y}`,
    }
  }
  return {
    label: command.type.replaceAll("_", " "),
    context: "Canonical document command",
    before: "Current document",
    after: operation.summary,
  }
}
