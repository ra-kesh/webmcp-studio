import { extractAssetReferences, localAssetSource } from "@webmcp/document"
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

export type LocalMediaRecoveryImpact = Readonly<{
  localAssetId: string
  source: `asset:local/${string}`
  referenceKeys: readonly string[]
  directNodeIds: readonly string[]
  projectedNodeIds: readonly string[]
  fieldIds: readonly string[]
  pageIds: readonly string[]
  outputIds: readonly string[]
  lockedNodeIds: readonly string[]
  requiredFieldIds: readonly string[]
  referenceCount: number
}>

export type NamedDocumentMediaUse = Readonly<{
  key: string
  label: string
  kind: "Layer" | "Field" | "Page" | "Output"
}>

export function namedDocumentMediaUses(
  document: Document,
  impact: Readonly<{
    nodeIds: readonly string[]
    fieldIds: readonly string[]
    pageIds: readonly string[]
    outputIds: readonly string[]
  }>
): NamedDocumentMediaUse[] {
  return [
    ...impact.nodeIds.map((nodeId) => ({
      key: `node:${nodeId}`,
      label:
        document.nodes.find((node) => node.id === nodeId)?.name ??
        "Unnamed layer",
      kind: "Layer" as const,
    })),
    ...impact.fieldIds.map((fieldId) => ({
      key: `field:${fieldId}`,
      label:
        document.fields.find((field) => field.id === fieldId)?.label ??
        "Unnamed field",
      kind: "Field" as const,
    })),
    ...impact.pageIds.map((pageId) => ({
      key: `page:${pageId}`,
      label:
        document.pages.find((page) => page.id === pageId)?.name ??
        "Unnamed page",
      kind: "Page" as const,
    })),
    ...impact.outputIds.map((outputId) => ({
      key: `output:${outputId}`,
      label:
        document.outputs.find((output) => output.id === outputId)?.name ??
        "Unnamed output",
      kind: "Output" as const,
    })),
  ]
}

const sortedUnique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

/**
 * Canonical alias-wide impact used by every missing-media action. A field
 * source is counted once even when it projects into several bound layers;
 * projected layers are still listed so review and navigation never collapse
 * to the first node using the alias.
 */
export function localMediaRecoveryImpact(
  document: Document,
  localAssetId: string
): LocalMediaRecoveryImpact {
  const source = localAssetSource(localAssetId)
  const references = extractAssetReferences(document).filter(
    (reference) => reference.source === source
  )
  return localMediaRecoveryImpactFromReferences(
    document,
    localAssetId,
    source,
    references
  )
}

export function localMediaRecoveryImpactForReferenceKeys(
  document: Document,
  localAssetId: string,
  referenceKeys: readonly string[]
): LocalMediaRecoveryImpact {
  const keySet = new Set(referenceKeys)
  return localMediaRecoveryImpactFromReferences(
    document,
    localAssetId,
    localAssetSource(localAssetId),
    extractAssetReferences(document).filter((reference) =>
      keySet.has(reference.key)
    )
  )
}

function localMediaRecoveryImpactFromReferences(
  document: Document,
  localAssetId: string,
  source: `asset:local/${string}`,
  references: ReturnType<typeof extractAssetReferences>
): LocalMediaRecoveryImpact {
  const directNodeIds = sortedUnique(
    references.flatMap((reference) =>
      reference.location === "node" && reference.nodeId
        ? [reference.nodeId]
        : []
    )
  )
  const projectedNodeIds = sortedUnique(
    references.flatMap((reference) => reference.projectedNodeIds)
  )
  const allNodeIds = new Set([...directNodeIds, ...projectedNodeIds])
  const fieldIds = sortedUnique(
    references.flatMap((reference) =>
      reference.fieldId ? [reference.fieldId] : []
    )
  )
  return {
    localAssetId,
    source,
    referenceKeys: references.map((reference) => reference.key),
    directNodeIds,
    projectedNodeIds,
    fieldIds,
    pageIds: sortedUnique(references.flatMap((reference) => reference.pageIds)),
    outputIds: sortedUnique(
      references.flatMap((reference) => reference.outputIds)
    ),
    lockedNodeIds: sortedUnique(
      document.nodes
        .filter((node) => allNodeIds.has(node.id) && node.locked)
        .map((node) => node.id)
    ),
    requiredFieldIds: sortedUnique(
      document.fields
        .filter((field) => fieldIds.includes(field.id) && field.required)
        .map((field) => field.id)
    ),
    referenceCount: references.length,
  }
}

export const localMediaRecoveryImpactSummary = (
  impact: LocalMediaRecoveryImpact
) => {
  const parts = [
    `${impact.referenceCount} ${impact.referenceCount === 1 ? "use" : "uses"}`,
  ]
  if (impact.pageIds.length) {
    parts.push(
      `${impact.pageIds.length} ${impact.pageIds.length === 1 ? "page" : "pages"}`
    )
  }
  if (impact.directNodeIds.length || impact.projectedNodeIds.length) {
    const layerCount = new Set([
      ...impact.directNodeIds,
      ...impact.projectedNodeIds,
    ]).size
    parts.push(`${layerCount} ${layerCount === 1 ? "layer" : "layers"}`)
  }
  if (impact.fieldIds.length) {
    parts.push(
      `${impact.fieldIds.length} ${impact.fieldIds.length === 1 ? "field" : "fields"}`
    )
  }
  if (impact.outputIds.length) {
    parts.push(
      `${impact.outputIds.length} ${impact.outputIds.length === 1 ? "output" : "outputs"}`
    )
  }
  return parts.join(" · ")
}

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
