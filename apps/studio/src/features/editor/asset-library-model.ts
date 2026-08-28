import type { Document, PublicMediaAsset } from "@webmcp/document"
import { localAssetIdFromSource } from "./local-asset-store"
import { managedMediaIdFromSource } from "./managed-media-repository"

export type AssetReferenceUsage = {
  assetId: string
  nodeIds: string[]
  pageIds: string[]
  fieldIds: string[]
  referenceCount: number
}

export type AssetReferenceKind = "local" | "managed"

const assetIdFromSource = (kind: AssetReferenceKind, source: string) =>
  kind === "local"
    ? localAssetIdFromSource(source)
    : managedMediaIdFromSource(source)

export function assetReferenceUsage(
  document: Document,
  kind: AssetReferenceKind,
  assetId: string
): AssetReferenceUsage {
  const nodeIds = document.nodes
    .filter(
      (node) =>
        node.type === "image" &&
        (node.assetId === assetId ||
          assetIdFromSource(kind, node.src) === assetId)
    )
    .map((node) => node.id)
  const nodeIdSet = new Set(nodeIds)
  const pageIds = document.pages
    .filter((page) => page.nodeIds.some((nodeId) => nodeIdSet.has(nodeId)))
    .map((page) => page.id)
  const fieldIds = document.fields
    .filter((field) => {
      if (field.type !== "asset") return false
      return [field.defaultValue, document.fieldValues[field.id]].some(
        (value) =>
          typeof value === "string" &&
          assetIdFromSource(kind, value) === assetId
      )
    })
    .map((field) => field.id)

  return {
    assetId,
    nodeIds,
    pageIds,
    fieldIds,
    referenceCount: nodeIds.length + fieldIds.length,
  }
}

export function missingLocalAssetIds(
  document: Document,
  availableAssetIds: Iterable<string>
) {
  const available = new Set(availableAssetIds)
  const referenced = new Set<string>()

  for (const node of document.nodes) {
    if (node.type !== "image") continue
    const assetId = localAssetIdFromSource(node.src)
    if (assetId) referenced.add(assetId)
  }
  for (const field of document.fields) {
    if (field.type !== "asset") continue
    for (const value of [field.defaultValue, document.fieldValues[field.id]]) {
      if (typeof value !== "string") continue
      const assetId = localAssetIdFromSource(value)
      if (assetId) referenced.add(assetId)
    }
  }

  return [...referenced].filter((assetId) => !available.has(assetId)).sort()
}

export function healthyLocalAssetIds(
  metadataAssetIds: Iterable<string>,
  blobAssetIds: Iterable<string>
) {
  const blobs = new Set(blobAssetIds)
  return [...metadataAssetIds].filter((assetId) => blobs.has(assetId)).sort()
}

export function matchesAssetSearch(
  query: string,
  ...values: Array<string | undefined>
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return values.some((value) => value?.toLocaleLowerCase().includes(normalized))
}

export function formatStoragePercentage(
  usedBytes: number,
  quotaBytes: number | null
) {
  if (!quotaBytes || quotaBytes <= 0) return null
  return Math.min(100, Math.max(0, Math.round((usedBytes / quotaBytes) * 100)))
}

export function sortManagedMediaAssets(
  assets: PublicMediaAsset[],
  collection: "uploads" | "recent"
) {
  const timestamp = (asset: PublicMediaAsset) =>
    collection === "uploads" ? asset.createdAt : asset.lastUsedAt
  return [...assets].sort(
    (left, right) =>
      timestamp(right).localeCompare(timestamp(left)) ||
      right.id.localeCompare(left.id)
  )
}

export const wasMediaAssetUsed = (asset: {
  createdAt: string
  lastUsedAt: string
}) => asset.lastUsedAt !== asset.createdAt

export function sortLocalUploadsByCreatedAt<
  TAsset extends { id: string; createdAt: string },
>(assets: TAsset[]) {
  return [...assets].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id)
  )
}

export function parseRecentLibraryUse(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, number] =>
            Boolean(entry[0]) &&
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] > 0
        )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 48)
    )
  } catch {
    return {}
  }
}

export function recordRecentLibraryUse(
  current: Record<string, number>,
  assetId: string,
  usedAt: number
) {
  return parseRecentLibraryUse(
    JSON.stringify({ ...current, [assetId]: usedAt })
  )
}

export function readableMediaError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return "Studio could not load your media. Check your connection and retry."
}
