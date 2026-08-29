import { fitPageThumbnailSize } from "@webmcp/document"
import type { DocumentDraftSummary } from "./document-draft-repository"
import { studioPageThumbnailRendererRevision } from "./page-thumbnail-raster-producer"

export const DOCUMENT_PREVIEW_RASTER_BOUNDS = Object.freeze({
  maxWidth: 320,
  maxHeight: 240,
})

export const DOCUMENT_PREVIEW_RENDERER_REVISION =
  studioPageThumbnailRendererRevision

export type DocumentPreviewIdentity = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  documentRevision: number
  pageId: string
  pageWidth: number
  pageHeight: number
}>

export type DocumentPreviewKey = DocumentPreviewIdentity &
  Readonly<{
    rendererRevision: string
    pixelWidth: number
    pixelHeight: number
  }>

type DocumentPreviewIdentitySource = Pick<
  DocumentDraftSummary,
  | "documentId"
  | "recordVersion"
  | "contentSnapshotId"
  | "documentRevision"
  | "firstPageId"
  | "firstPageWidth"
  | "firstPageHeight"
>

const nonEmptyString = (value: string) => value.trim().length > 0

function assertDocumentPreviewIdentity(
  identity: DocumentPreviewIdentity
): void {
  if (
    !nonEmptyString(identity.documentId) ||
    !nonEmptyString(identity.contentSnapshotId) ||
    !nonEmptyString(identity.pageId)
  ) {
    throw new TypeError("Document preview identities cannot contain empty IDs.")
  }
  if (
    !Number.isSafeInteger(identity.recordVersion) ||
    identity.recordVersion < 1
  ) {
    throw new TypeError(
      "Document preview record versions must be positive integers."
    )
  }
  if (
    !Number.isSafeInteger(identity.documentRevision) ||
    identity.documentRevision < 0
  ) {
    throw new TypeError(
      "Document preview document revisions must be non-negative integers."
    )
  }
  if (
    !Number.isSafeInteger(identity.pageWidth) ||
    identity.pageWidth < 1 ||
    !Number.isSafeInteger(identity.pageHeight) ||
    identity.pageHeight < 1
  ) {
    throw new TypeError(
      "Document preview page dimensions must be positive integers."
    )
  }
}

export function createDocumentPreviewIdentity(
  summary: DocumentPreviewIdentitySource
): DocumentPreviewIdentity {
  const identity = {
    documentId: summary.documentId,
    recordVersion: summary.recordVersion,
    contentSnapshotId: summary.contentSnapshotId,
    documentRevision: summary.documentRevision,
    pageId: summary.firstPageId,
    pageWidth: summary.firstPageWidth,
    pageHeight: summary.firstPageHeight,
  } satisfies DocumentPreviewIdentity
  assertDocumentPreviewIdentity(identity)
  fitPageThumbnailSize(
    { width: identity.pageWidth, height: identity.pageHeight },
    DOCUMENT_PREVIEW_RASTER_BOUNDS
  )
  return Object.freeze(identity)
}

export function createDocumentPreviewKey(
  identity: DocumentPreviewIdentity,
  rendererRevision = DOCUMENT_PREVIEW_RENDERER_REVISION
): DocumentPreviewKey {
  assertDocumentPreviewIdentity(identity)
  if (!nonEmptyString(rendererRevision)) {
    throw new TypeError("Document preview renderer revisions cannot be empty.")
  }
  const size = fitPageThumbnailSize(
    { width: identity.pageWidth, height: identity.pageHeight },
    DOCUMENT_PREVIEW_RASTER_BOUNDS
  )
  return Object.freeze({
    ...identity,
    rendererRevision,
    pixelWidth: size.width,
    pixelHeight: size.height,
  })
}

export function serializeDocumentPreviewKey(key: DocumentPreviewKey): string {
  const canonical = createDocumentPreviewKey(key, key.rendererRevision)
  if (
    key.pixelWidth !== canonical.pixelWidth ||
    key.pixelHeight !== canonical.pixelHeight
  ) {
    throw new TypeError(
      "Document preview raster dimensions must match the canonical size."
    )
  }
  return JSON.stringify([
    canonical.documentId,
    canonical.recordVersion,
    canonical.contentSnapshotId,
    canonical.pageId,
    canonical.pageWidth,
    canonical.pageHeight,
    canonical.rendererRevision,
    canonical.pixelWidth,
    canonical.pixelHeight,
  ])
}

export function isSameDocumentPreviewKey(
  left: DocumentPreviewKey,
  right: DocumentPreviewKey
): boolean {
  return (
    serializeDocumentPreviewKey(left) === serializeDocumentPreviewKey(right)
  )
}
