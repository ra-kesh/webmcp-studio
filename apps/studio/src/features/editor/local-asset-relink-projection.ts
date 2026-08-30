import {
  assetReferenceKeysForSource,
  extractAssetReferences,
  localAssetSource,
  managedAssetSource,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"

export const sameReferenceKeys = (
  left: readonly string[],
  right: readonly string[]
) =>
  left.length === right.length &&
  left.every((referenceKey, index) => referenceKey === right[index])

export const hasCurrentRelinkUndo = (
  phase: string,
  relinkCommitId: string | null,
  pastCommitIds: readonly string[]
) =>
  phase === "complete" &&
  relinkCommitId !== null &&
  pastCommitIds.includes(relinkCommitId)

export const hasExactManagedProjection = (
  document: Document,
  managedAssetId: string,
  expectedReferenceKeys: readonly string[]
) => {
  const source = managedAssetSource(managedAssetId)
  if (
    !sameReferenceKeys(
      assetReferenceKeysForSource(document, source),
      expectedReferenceKeys
    )
  ) {
    return false
  }
  return extractAssetReferences(document)
    .filter((reference) => reference.source === source)
    .every(
      (reference) =>
        reference.location !== "node" || reference.assetId === managedAssetId
    )
}

export const isLiveLocalAssetPromotionVisible = (
  document: Document,
  promotion: Readonly<{
    localAssetId: string
    sourceDocumentId: string
    expectedReferenceKeys: readonly string[]
    managedAssetId: string | null
    phase: string
  }>
) => {
  if (promotion.sourceDocumentId !== document.id) return false
  const localReferenceKeys = assetReferenceKeysForSource(
    document,
    localAssetSource(promotion.localAssetId)
  )
  const exactLocalSource =
    promotion.expectedReferenceKeys.length === 0
      ? promotion.phase === "preparing"
      : sameReferenceKeys(localReferenceKeys, promotion.expectedReferenceKeys)
  const exactManagedTarget =
    promotion.managedAssetId !== null &&
    localReferenceKeys.length === 0 &&
    hasExactManagedProjection(
      document,
      promotion.managedAssetId,
      promotion.expectedReferenceKeys
    )
  if (
    promotion.phase === "saving" ||
    promotion.phase === "updating_recent" ||
    promotion.phase === "complete"
  ) {
    return exactManagedTarget
  }
  if (promotion.phase === "failed") {
    return exactLocalSource || exactManagedTarget
  }
  if (promotion.phase === "conflict") {
    return !exactLocalSource && !exactManagedTarget
  }
  return exactLocalSource
}
