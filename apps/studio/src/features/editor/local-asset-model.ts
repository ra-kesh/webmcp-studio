import type { Document } from "@webmcp/document"
import { localAssetIdFromSource } from "./local-asset-store"

export type LocalAssetUsage = {
  assetId: string
  nodeIds: string[]
  pageIds: string[]
  fieldIds: string[]
  referenceCount: number
}

export function localAssetUsage(
  document: Document,
  assetId: string
): LocalAssetUsage {
  const nodeIds = document.nodes
    .filter(
      (node) =>
        node.type === "image" && localAssetIdFromSource(node.src) === assetId
    )
    .map((node) => node.id)
  const nodeIdSet = new Set(nodeIds)
  const pageIds = document.pages
    .filter((page) => page.nodeIds.some((nodeId) => nodeIdSet.has(nodeId)))
    .map((page) => page.id)
  const source = `asset:local/${assetId}`
  const fieldIds = document.fields
    .filter(
      (field) =>
        field.type === "asset" &&
        (field.defaultValue === source ||
          document.fieldValues[field.id] === source)
    )
    .map((field) => field.id)

  return {
    assetId,
    nodeIds,
    pageIds,
    fieldIds,
    referenceCount: nodeIds.length + fieldIds.length,
  }
}

export function formatAssetBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** unitIndex
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function localAssetUsageLabel(usage: LocalAssetUsage) {
  if (usage.referenceCount === 0) return "Unused"
  const parts = [
    usage.nodeIds.length
      ? `${usage.nodeIds.length} ${usage.nodeIds.length === 1 ? "layer" : "layers"}`
      : null,
    usage.fieldIds.length
      ? `${usage.fieldIds.length} ${usage.fieldIds.length === 1 ? "field" : "fields"}`
      : null,
  ].filter(Boolean)
  return `Used by ${parts.join(" and ")}`
}
