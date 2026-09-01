import { useMemo } from "react"
import { previewChangeSet } from "@webmcp/document"
import type { ChangeSet, Document } from "@webmcp/document"
import { projectLocalAssetPreviewSources } from "./local-asset-preview"
import {
  managedMediaContentUrl,
  managedMediaIdFromSource,
} from "./managed-media-repository"
import { reusableImageReplacementPatch } from "./media-selection-model"
import type { ReusableImageAsset } from "./media-selection-model"

export type PendingRendererReplacementPreview = Readonly<{
  nodeId: string
  previewSrc: string
  payload: Readonly<{ asset: ReusableImageAsset }>
}>

export function projectCanonicalDocumentPreview({
  document,
  snapshotId,
  pendingChangeSet,
  changeSetConflict,
}: {
  document: Document
  snapshotId: string
  pendingChangeSet: ChangeSet | null
  changeSetConflict: unknown
}) {
  return pendingChangeSet && !changeSetConflict
    ? previewChangeSet(document, pendingChangeSet, snapshotId)
    : document
}

export function projectEditorDocumentPreview({
  canonicalDocument,
  pendingImageReplacement,
  localAssetPreviewUrls,
}: {
  canonicalDocument: Document
  pendingImageReplacement: PendingRendererReplacementPreview | null
  localAssetPreviewUrls: ReadonlyMap<string, string>
}) {
  const rendererReplacementPreview = pendingImageReplacement
    ? {
        ...canonicalDocument,
        nodes: canonicalDocument.nodes.map((node) =>
          node.type === "image" && node.id === pendingImageReplacement.nodeId
            ? {
                ...node,
                ...reusableImageReplacementPatch(
                  node,
                  pendingImageReplacement.payload.asset
                ),
                src: pendingImageReplacement.previewSrc,
              }
            : node
        ),
      }
    : canonicalDocument
  const localPreview = projectLocalAssetPreviewSources(
    rendererReplacementPreview,
    localAssetPreviewUrls
  )
  return {
    ...localPreview,
    nodes: localPreview.nodes.map((node) => {
      if (node.type !== "image") return node
      const managedAssetId = managedMediaIdFromSource(node.src)
      const previewUrl = managedAssetId
        ? managedMediaContentUrl(managedAssetId)
        : null
      return previewUrl ? { ...node, src: previewUrl } : node
    }),
  }
}

export function useDocumentPreviewProjection({
  document,
  snapshotId,
  pendingChangeSet,
  changeSetConflict,
  pendingImageReplacement,
  localAssetPreviewUrls,
  assetVersion,
}: {
  document: Document
  snapshotId: string
  pendingChangeSet: ChangeSet | null
  changeSetConflict: unknown
  pendingImageReplacement: PendingRendererReplacementPreview | null
  localAssetPreviewUrls: ReadonlyMap<string, string>
  assetVersion: number
}) {
  const canonicalPreviewDocument = useMemo(
    () =>
      projectCanonicalDocumentPreview({
        document,
        snapshotId,
        pendingChangeSet,
        changeSetConflict,
      }),
    [changeSetConflict, document, pendingChangeSet, snapshotId]
  )
  const previewDocument = useMemo(
    () =>
      projectEditorDocumentPreview({
        canonicalDocument: canonicalPreviewDocument,
        pendingImageReplacement,
        localAssetPreviewUrls,
      }),
    [
      assetVersion,
      canonicalPreviewDocument,
      localAssetPreviewUrls,
      pendingImageReplacement,
    ]
  )
  return { canonicalPreviewDocument, previewDocument }
}
