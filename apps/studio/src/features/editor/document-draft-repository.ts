import {
  assertPageThumbnailSize,
  assetReferenceKeysForSource,
  extractAssetReferences,
  localAssetIdSchema,
  managedAssetSourceSchema,
  mediaAssetIdSchema,
  mediaIdempotencyKeySchema,
  mediaRequestIdSchema,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { validateCurrentDraftSnapshot } from "./current-draft-repository"
import type {
  CurrentDraftEnvelope,
  CurrentDraftSnapshot,
} from "./current-draft-repository"
import { prepareDraftAdmission } from "./draft-admission"

const DATABASE_NAME = "webmcp-studio-documents"
const DATABASE_VERSION = 2
const BODY_STORE = "draft-body"
const METADATA_STORE = "draft-meta"
const PREVIEW_STORE = "draft-previews"
const QUARANTINE_STORE = "draft-quarantine"
const CONFLICT_STORE = "draft-conflicts"
const SETTINGS_STORE = "repository-settings"
const MEDIA_MIGRATION_STORE = "draft-media-migrations"
const ACTIVITY_AT_INDEX = "activityAt"
const SAVED_AT_INDEX = "savedAt"
const LAST_OPENED_AT_INDEX = "lastOpenedAt"
const DELETED_AT_INDEX = "deletedAt"
const CONFLICT_DOCUMENT_INDEX = "documentId"
const CONFLICT_DETECTED_AT_INDEX = "detectedAt"
const QUARANTINE_DOCUMENT_INDEX = "documentId"
const QUARANTINE_DETECTED_AT_INDEX = "detectedAt"
const MEDIA_MIGRATION_DOCUMENT_CREATED_AT_INDEX = "documentIdCreatedAt"
const MEDIA_MIGRATION_ACKNOWLEDGED_CREATED_AT_INDEX = "acknowledgedAtCreatedAt"
const MAX_ACKNOWLEDGED_MEDIA_MIGRATION_RECEIPTS = 32

export type DraftOrigin =
  | Readonly<{ kind: "blank" }>
  | Readonly<{ kind: "template"; templateId: string; templateVersion: number }>
  | Readonly<{ kind: "quotation" }>
  | Readonly<{ kind: "import" }>
  | Readonly<{ kind: "duplicate"; sourceDocumentId: string }>
  | Readonly<{ kind: "current-draft-migration" }>

export type DraftSourceKind = "quotation" | "template" | null

export type DraftPublicationLink = Readonly<{
  templateId: string
  templateVersionId: string
  templateVersion: number
  contentSnapshotId: string
  publishedAt: string
}>

export type DocumentDraftSummary = Readonly<{
  schemaVersion: 1
  documentId: string
  name: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  documentRevision: number
  createdAt: string
  savedAt: string
  lastOpenedAt: string
  activityAt: string
  deletedAt: string | null
  pageCount: number
  outputCount: number
  firstPageId: string
  firstPageName: string
  firstPageWidth: number
  firstPageHeight: number
  encodedByteLength: number
  exportFormats: readonly ("png" | "pdf")[]
  sourceKind: DraftSourceKind
  origin: DraftOrigin
  lastPublished: DraftPublicationLink | null
}>

export type LinkDraftPublicationInput = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  templateId: string
  templateVersionId: string
  templateVersion: number
  publishedAt: string
}>

export type DraftPublicationLinkResult =
  | Readonly<{
      ok: true
      status: "linked"
      summary: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "stale_head" | "deleted"
      current: DocumentDraftSummary
    }>
  | Readonly<{ ok: false; reason: "missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type DocumentDraftRecord = Readonly<{
  summary: DocumentDraftSummary
  envelope: CurrentDraftEnvelope
}>

export type DraftListPage = Readonly<{
  items: readonly DocumentDraftSummary[]
  nextCursor: string | null
  recoveryItems: readonly DraftListRecoveryItem[]
}>

export type DraftListRecoveryItem = Readonly<{
  documentId: string | null
  quarantineId: string | null
  status: "quarantined" | "retained"
  failure: DraftRepositoryFailure
}>

export type DraftListState = "active" | "deleted" | "all"

const isDraftListState = (value: unknown): value is DraftListState =>
  value === "active" || value === "deleted" || value === "all"

export type DocumentDraftReadResult =
  | Readonly<{ ok: true; status: "found"; record: DocumentDraftRecord }>
  | Readonly<{ ok: true; status: "missing" }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "storage_unavailable"
      failure: DraftRepositoryFailure
    }>

export type DraftListResult =
  | Readonly<{ ok: true; page: DraftListPage }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>

export type DraftQuarantineResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      reason: "missing" | "corrupt_record" | "storage_unavailable"
      failure?: DraftRepositoryFailure
    }>

export type DraftValueResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: "missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId?: string
      failure: DraftRepositoryFailure
    }>

export type DraftRepositoryEvent =
  | Readonly<{
      type: "saved"
      reason: "content_saved" | "opened" | "publication_linked"
      documentId: string
      recordVersion: number
      contentSnapshotId: string
      draftSnapshotId: string
      sessionId: string
    }>
  | Readonly<{
      type: "deleted" | "restored"
      documentId: string
      recordVersion: number
      sessionId: string
    }>
  | Readonly<{
      type: "preview"
      documentId: string
      contentSnapshotId: string
      sessionId: string
    }>
  | Readonly<{
      type: "conflict_resolved"
      conflictId: string
      documentId: string
      resolution: "reload_saved" | "save_copy"
      resolutionDocumentId: string | null
      sessionId: string
    }>
  | Readonly<{
      type: "quarantined"
      documentId: string
      quarantineId: string
      sessionId: string
    }>

export type DocumentDraftPreview = Readonly<{
  schemaVersion: 1
  documentId: string
  contentSnapshotId: string
  pageId: string
  rendererRevision: string
  width: number
  height: number
  mimeType: "image/png"
  byteLength: number
  createdAt: string
  blob: Blob
}>

export type DraftPreviewIdentity = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  pageId: string
  pageWidth: number
  pageHeight: number
  rendererRevision: string
  width: number
  height: number
}>

export type DraftPreviewReadResult =
  | Readonly<{
      ok: true
      status: "ready"
      preview: DocumentDraftPreview
    }>
  | Readonly<{
      ok: true
      status: "missing" | "stale_preview" | "not_active"
    }>
  | Readonly<{
      ok: false
      reason: "stale_head"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_preview" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>

export type DocumentDraftConflict = Readonly<{
  schemaVersion: 1
  conflictId: string
  documentId: string
  sessionId: string
  expectedRecordVersion: number
  observedRecordVersion: number | null
  baseDraftSnapshotId: string
  observedContentSnapshotId: string | null
  observedDraftSnapshotId: string | null
  candidateContentSnapshotId: string
  candidateDraftSnapshotId: string
  candidate: CurrentDraftSnapshot
  reason: "stale_write" | "deleted_elsewhere" | "migration_collision"
  detectedAt: string
  resolvedAt: string | null
  resolution: "reload_saved" | "save_copy" | null
  resolutionDocumentId: string | null
}>

type StoredDocumentDraftConflictV1 = Omit<
  DocumentDraftConflict,
  "resolutionDocumentId"
> &
  Readonly<{ resolutionDocumentId?: string | null }>

export type SaveConflictAsCopyInput = Readonly<{
  conflictId: string
  expectedCandidateDraftSnapshotId: string
  newDocumentId: string
  name?: string
  copySnapshot?: CurrentDraftSnapshot
}>

export type SaveConflictAsCopyResult =
  | Readonly<{
      ok: true
      status: "created" | "replayed"
      record: DocumentDraftRecord
      conflict: DocumentDraftConflict
    }>
  | Readonly<{ ok: false; reason: "missing_conflict" }>
  | Readonly<{
      ok: false
      reason: "stale_conflict"
      current: DocumentDraftConflict
    }>
  | Readonly<{
      ok: false
      reason: "resolved_without_copy"
      current: DocumentDraftConflict
    }>
  | Readonly<{
      ok: false
      reason: "target_exists"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      failure: DraftRepositoryFailure
    }>

export type DocumentDraftHeadExpectation =
  | Readonly<{ status: "missing" }>
  | Readonly<{
      status: "found"
      recordVersion: number
      contentSnapshotId: string
      draftSnapshotId: string
      deletedAt: string | null
    }>

export type DraftHeadIdentity = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  deletedAt: string | null
}>

export type AdmissionMigrationAlias = Readonly<{
  localAssetId: string
  managedAssetId: string
  managedSource: `asset:managed/${string}`
  contentSha256: string
  managedStatus: "ready" | "archived"
  expectedReferenceKeys: readonly string[]
  localState: "ready" | "missing_bytes" | "absent" | "quarantined"
  relationship: "same_hash" | "no_local_bytes"
  mappingRequestId: string
}>

export type LocalMediaAdmissionManagedUse = Readonly<{
  assetId: string
  idempotencyKey: string
  requestId: string | null
  usedAt: string | null
  assetRevision: number | null
}>

type LocalMediaAdmissionReceiptBase = Readonly<{
  schemaVersion: 1
  receiptId: string
  kind: "local_media_admission"
  documentId: string
  createdAt: string
  acknowledgedAt: string | null
  restoredAt: string | null
  source: DraftHeadIdentity
  result: DraftHeadIdentity
  aliases: readonly AdmissionMigrationAlias[]
  managedUses: readonly LocalMediaAdmissionManagedUse[]
}>

export type LocalMediaAdmissionReceipt = LocalMediaAdmissionReceiptBase &
  Readonly<{ preimage: CurrentDraftEnvelope }>

export type LocalMediaAdmissionAuditReceipt = LocalMediaAdmissionReceiptBase &
  Readonly<{ acknowledgedAt: string; preimage: null }>

export type LocalMediaAdmissionReceiptRecord =
  LocalMediaAdmissionReceipt | LocalMediaAdmissionAuditReceipt

export type MigrateLocalMediaInput = Readonly<{
  source: DraftHeadIdentity
  resultEnvelope: CurrentDraftEnvelope
  aliases: readonly AdmissionMigrationAlias[]
  receiptId: string
  createdAt: string
}>

export type MigrateLocalMediaResult =
  | Readonly<{
      ok: true
      status: "migrated" | "replayed"
      record: DocumentDraftRecord
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{
      ok: false
      reason: "stale_head" | "deleted"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "receipt_pending"
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type LocalMediaAdmissionReceiptReadResult =
  | Readonly<{
      ok: true
      status: "found"
      receipt: LocalMediaAdmissionReceiptRecord
    }>
  | Readonly<{ ok: true; status: "missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      quarantineId?: string
      failure: DraftRepositoryFailure
    }>

export type PendingLocalMediaAdmissionReceiptReadResult =
  | Readonly<{
      ok: true
      status: "found"
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{ ok: true; status: "missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type AcknowledgeLocalMediaAdmissionReceiptResult =
  | Readonly<{
      ok: true
      status: "acknowledged" | "replayed"
      receipt: LocalMediaAdmissionAuditReceipt
    }>
  | Readonly<{ ok: false; reason: "missing" }>
  | Readonly<{
      ok: false
      reason: "advanced_head" | "deleted"
      current: DocumentDraftSummary
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable" | "corrupt_record"
      quarantineId?: string
      failure: DraftRepositoryFailure
    }>

export type RestoreLocalMediaAdmissionReceiptResult =
  | Readonly<{
      ok: true
      status: "restored" | "replayed"
      record: DocumentDraftRecord
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{ ok: false; reason: "missing" | "preimage_unavailable" }>
  | Readonly<{
      ok: false
      reason: "advanced_head" | "deleted"
      current: DocumentDraftSummary
      receipt: LocalMediaAdmissionReceipt
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable" | "corrupt_record"
      quarantineId?: string
      failure: DraftRepositoryFailure
    }>

export type MarkLocalMediaAdmissionManagedUseInput = Readonly<{
  receiptId: string
  assetId: string
  idempotencyKey: string
  requestId: string
  usedAt: string
  assetRevision: number
}>

export type MarkLocalMediaAdmissionManagedUseResult =
  | Readonly<{
      ok: true
      status: "updated" | "replayed"
      receipt: LocalMediaAdmissionReceiptRecord
    }>
  | Readonly<{ ok: false; reason: "missing" | "asset_missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      quarantineId?: string
      failure: DraftRepositoryFailure
    }>

export type ResolveDocumentDraftConflictResult =
  | DraftValueResult<DocumentDraftConflict>
  | Readonly<{
      ok: false
      reason: "head_changed"
      current:
        | Readonly<{ status: "missing" }>
        | Readonly<{ status: "found"; record: DocumentDraftRecord }>
    }>

export type DraftRepositoryFailure = Readonly<{
  kind:
    | "storage_unavailable"
    | "blocked"
    | "request_failed"
    | "transaction_aborted"
    | "quota_exceeded"
    | "validation_failed"
    | "corrupt_record"
  message: string
}>

export type DraftWriteResult =
  | Readonly<{
      ok: true
      record: DocumentDraftRecord
      created: boolean
      unchanged: boolean
    }>
  | Readonly<{
      ok: false
      reason: "exists"
      current: DocumentDraftSummary
    }>
  | Readonly<{ ok: false; reason: "missing" }>
  | Readonly<{
      ok: false
      reason: "conflict"
      conflict: DocumentDraftConflict
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "deleted"
      conflict: DocumentDraftConflict
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type DraftDeleteResult =
  | Readonly<{ ok: true; deletedId: string }>
  | Readonly<{ ok: false; reason: "missing" }>
  | Readonly<{
      ok: false
      reason: "conflict"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type DraftMigrationResult =
  | Readonly<{
      ok: true
      status: "created" | "identical" | "already_migrated"
      record: DocumentDraftRecord
    }>
  | Readonly<{
      ok: false
      reason: "collision"
      conflict: DocumentDraftConflict
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_record"
      quarantineId: string
      failure: DraftRepositoryFailure
    }>

export type DraftMigrationCleanupResult =
  | Readonly<{ ok: true; pendingCleanupKeys: readonly string[] }>
  | Readonly<{ ok: false; reason: "missing" | "marker_mismatch" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>

type StoredDraftBody = {
  schemaVersion: 1
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  encodedByteLength: number
  document: Document
  sourceContext: CurrentDraftEnvelope["sourceContext"]
  reviewJournal: CurrentDraftEnvelope["reviewJournal"]
  quotationRefresh?: CurrentDraftEnvelope["quotationRefresh"]
}

export type DocumentDraftQuarantineRecord = Readonly<{
  schemaVersion: 1
  quarantineId: string
  documentId: string
  detectedAt: string
  failure: Readonly<{
    store: "draft-meta" | "draft-body" | "paired-record"
    key: string
    code:
      | "missing_body"
      | "missing_metadata"
      | "pair_mismatch"
      | "integrity_mismatch"
      | "schema_invalid"
    message: string
  }>
  body: unknown
  metadata: unknown
  activeRowsRemoved: boolean
}>

type CurrentDraftMigrationSetting = Readonly<{
  key: "migration.currentDraftV1"
  value: Readonly<{
    documentId: string
    draftSnapshotId: string
    completedAt: string
    pendingCleanupKeys: readonly string[]
  }>
}>

type DraftMetadataIntegrityScanSetting = Readonly<{
  key: "integrityScan.draftMetaV1"
  value: Readonly<{
    afterPrimaryKey: IDBValidKey | null
    completedAt: string | null
  }>
}>

type LocalMediaAdmissionReceiptQuarantineRecord = Readonly<{
  schemaVersion: 1
  receiptId: string
  kind: "local_media_admission_quarantine"
  documentId: string
  createdAt: string
  acknowledgedAt: string
  originalReceiptId: string
  detectedAt: string
  failure: string
  receipt: unknown
}>

type DraftListCorruptObservation = Readonly<{
  documentId: string | null
  primaryKey: IDBValidKey
  metadata: unknown
  failure: DraftRepositoryFailure
}>

export type DocumentDraftRepositoryOptions = Readonly<{
  databaseName?: string
  indexedDB?: IDBFactory
  now?: () => string
  createId?: () => string
  sessionId?: string
  createBroadcastChannel?: (name: string) => BroadcastChannel
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value))

const validRequiredString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const parsePublicationLink = (value: unknown): DraftPublicationLink | null => {
  if (!isRecord(value)) return null
  if (
    !validRequiredString(value.templateId) ||
    !validRequiredString(value.templateVersionId) ||
    !validPositiveInteger(value.templateVersion) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validTimestamp(value.publishedAt)
  )
    return null
  return {
    templateId: value.templateId,
    templateVersionId: value.templateVersionId,
    templateVersion: value.templateVersion,
    contentSnapshotId: value.contentSnapshotId,
    publishedAt: value.publishedAt,
  }
}

const validSnapshotId = (value: unknown): value is string =>
  typeof value === "string" && /^sha256-[0-9a-f]{64}$/.test(value)

const validOrigin = (value: unknown): value is DraftOrigin => {
  if (!isRecord(value) || typeof value.kind !== "string") return false
  if (
    value.kind === "blank" ||
    value.kind === "quotation" ||
    value.kind === "import" ||
    value.kind === "current-draft-migration"
  )
    return true
  if (value.kind === "duplicate")
    return (
      typeof value.sourceDocumentId === "string" &&
      Boolean(value.sourceDocumentId)
    )
  return (
    value.kind === "template" &&
    typeof value.templateId === "string" &&
    Boolean(value.templateId) &&
    validPositiveInteger(value.templateVersion)
  )
}

const validPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1

const validNonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

const validIndexedDbKey = (value: unknown): value is IDBValidKey => {
  if (typeof value === "string") return value.length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true
  return Array.isArray(value) && value.every(validIndexedDbKey)
}

const isBlob = (value: unknown): value is Blob =>
  isRecord(value) &&
  typeof value.size === "number" &&
  typeof value.type === "string" &&
  typeof value.slice === "function"

const validPreviewIdentity = (value: DraftPreviewIdentity) => {
  if (
    !isRecord(value) ||
    !validRequiredString(value.documentId) ||
    !validPositiveInteger(value.recordVersion) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validRequiredString(value.pageId) ||
    !validPositiveInteger(value.pageWidth) ||
    !validPositiveInteger(value.pageHeight) ||
    !validRequiredString(value.rendererRevision) ||
    !validPositiveInteger(value.width) ||
    !validPositiveInteger(value.height)
  ) {
    return false
  }
  try {
    assertPageThumbnailSize(
      { width: value.pageWidth, height: value.pageHeight },
      { width: value.width, height: value.height }
    )
    return true
  } catch {
    return false
  }
}

const parsePreview = (value: unknown): DocumentDraftPreview | null => {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    !validRequiredString(value.documentId) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validRequiredString(value.pageId) ||
    !validRequiredString(value.rendererRevision) ||
    !validPositiveInteger(value.width) ||
    !validPositiveInteger(value.height) ||
    value.mimeType !== "image/png" ||
    !validPositiveInteger(value.byteLength) ||
    !validTimestamp(value.createdAt) ||
    !isBlob(value.blob) ||
    value.blob.type !== "image/png" ||
    value.blob.size !== value.byteLength
  ) {
    return null
  }
  return value as DocumentDraftPreview
}

const storedValueEqual = (left: unknown, right: unknown) => {
  if (left === undefined || right === undefined) return left === right
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

const admissionFailure = (
  prepared: Exclude<
    Awaited<ReturnType<typeof prepareDraftAdmission>>,
    { ok: true }
  >
): DraftRepositoryFailure => ({
  kind: "validation_failed",
  message:
    prepared.reason === "validation_failed"
      ? prepared.failure.message
      : `This draft is ${prepared.encodedByteLength.toLocaleString("en-US")} bytes. Studio drafts must be ${prepared.maximumEncodedByteLength.toLocaleString("en-US")} bytes or smaller.`,
})

const listCursor = (summary: DocumentDraftSummary) =>
  `${encodeURIComponent(summary.activityAt)}~${encodeURIComponent(summary.documentId)}`

const parseListCursor = (cursor: string | undefined) => {
  if (!cursor) return null
  const separator = cursor.indexOf("~")
  if (separator < 1) throw new Error("The document list cursor is invalid.")
  const activityAt = decodeURIComponent(cursor.slice(0, separator))
  const documentId = decodeURIComponent(cursor.slice(separator + 1))
  if (!validTimestamp(activityAt) || !documentId) {
    throw new Error("The document list cursor is invalid.")
  }
  return [activityAt, documentId] as const
}

const parseRepositoryEvent = (value: unknown): DraftRepositoryEvent | null => {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    !value.documentId ||
    typeof value.sessionId !== "string" ||
    !value.sessionId
  )
    return null
  if (value.type === "saved") {
    return (value.reason === "content_saved" ||
      value.reason === "opened" ||
      value.reason === "publication_linked") &&
      validPositiveInteger(value.recordVersion) &&
      validSnapshotId(value.contentSnapshotId) &&
      validSnapshotId(value.draftSnapshotId)
      ? (value as DraftRepositoryEvent)
      : null
  }
  if (value.type === "deleted" || value.type === "restored") {
    return validPositiveInteger(value.recordVersion)
      ? (value as DraftRepositoryEvent)
      : null
  }
  if (value.type === "preview") {
    return validSnapshotId(value.contentSnapshotId)
      ? (value as DraftRepositoryEvent)
      : null
  }
  if (value.type === "conflict_resolved") {
    const validResolution =
      value.resolution === "reload_saved" || value.resolution === "save_copy"
    const validResolutionDocumentId =
      value.resolution === "save_copy"
        ? validRequiredString(value.resolutionDocumentId)
        : value.resolutionDocumentId === null
    return validResolution &&
      validRequiredString(value.conflictId) &&
      validResolutionDocumentId
      ? (value as DraftRepositoryEvent)
      : null
  }
  if (value.type === "quarantined") {
    return validRequiredString(value.quarantineId)
      ? (value as DraftRepositoryEvent)
      : null
  }
  return null
}

const sourceKind = (envelope: CurrentDraftEnvelope): DraftSourceKind =>
  envelope.sourceContext?.quotationSource
    ? "quotation"
    : envelope.sourceContext?.designTemplate
      ? "template"
      : null

const firstPage = (document: Document) => {
  const firstOutput = document.outputs[0]
  const firstPageId = firstOutput.pageIds[0]
  return (
    document.pages.find((page) => page.id === firstPageId) ?? document.pages[0]
  )
}

const summaryFor = ({
  envelope,
  recordVersion,
  contentSnapshotId,
  draftSnapshotId,
  encodedByteLength,
  createdAt,
  savedAt,
  lastOpenedAt,
  activityAt,
  deletedAt,
  origin,
  lastPublished = null,
}: {
  envelope: CurrentDraftEnvelope
  recordVersion: number
  contentSnapshotId: string
  draftSnapshotId: string
  encodedByteLength: number
  createdAt: string
  savedAt: string
  lastOpenedAt: string
  activityAt: string
  deletedAt: string | null
  origin: DraftOrigin
  lastPublished?: DraftPublicationLink | null
}): DocumentDraftSummary => {
  const page = firstPage(envelope.document)
  return {
    schemaVersion: 1,
    documentId: envelope.document.id,
    name: envelope.document.name,
    recordVersion,
    contentSnapshotId,
    draftSnapshotId,
    documentRevision: envelope.document.revision,
    createdAt,
    savedAt,
    lastOpenedAt,
    activityAt,
    deletedAt,
    pageCount: envelope.document.pages.length,
    outputCount: envelope.document.outputs.length,
    firstPageId: page.id,
    firstPageName: page.name,
    firstPageWidth: page.width,
    firstPageHeight: page.height,
    encodedByteLength,
    exportFormats: [
      ...new Set(
        envelope.document.outputs.flatMap((output) => output.exportFormats)
      ),
    ],
    sourceKind: sourceKind(envelope),
    origin,
    lastPublished,
  }
}

const parseSummary = (value: unknown): DocumentDraftSummary | null => {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    typeof value.documentId !== "string" ||
    value.documentId.length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    !validPositiveInteger(value.recordVersion) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validSnapshotId(value.draftSnapshotId) ||
    typeof value.documentRevision !== "number" ||
    !Number.isSafeInteger(value.documentRevision) ||
    value.documentRevision < 0 ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.savedAt) ||
    !validTimestamp(value.lastOpenedAt) ||
    !validTimestamp(value.activityAt) ||
    (value.deletedAt !== null && !validTimestamp(value.deletedAt)) ||
    !validPositiveInteger(value.pageCount) ||
    !validPositiveInteger(value.outputCount) ||
    typeof value.firstPageId !== "string" ||
    value.firstPageId.length === 0 ||
    typeof value.firstPageName !== "string" ||
    value.firstPageName.length === 0 ||
    !validPositiveInteger(value.firstPageWidth) ||
    !validPositiveInteger(value.firstPageHeight) ||
    !validPositiveInteger(value.encodedByteLength) ||
    !Array.isArray(value.exportFormats) ||
    value.exportFormats.length === 0 ||
    value.exportFormats.some(
      (format) => format !== "png" && format !== "pdf"
    ) ||
    (value.sourceKind !== null &&
      value.sourceKind !== "quotation" &&
      value.sourceKind !== "template") ||
    !validOrigin(value.origin) ||
    (value.lastPublished !== null &&
      parsePublicationLink(value.lastPublished) === null)
  ) {
    return null
  }
  return value as DocumentDraftSummary
}

const parseBody = (value: unknown): StoredDraftBody | null => {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    typeof value.documentId !== "string" ||
    value.documentId.length === 0 ||
    !validPositiveInteger(value.recordVersion) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validSnapshotId(value.draftSnapshotId) ||
    !validPositiveInteger(value.encodedByteLength)
  ) {
    return null
  }
  const validated = validateCurrentDraftSnapshot({
    document: value.document,
    sourceContext: value.sourceContext,
    reviewJournal: value.reviewJournal,
    quotationRefresh: value.quotationRefresh,
  })
  if (!validated.ok) return null
  if (validated.envelope.document.id !== value.documentId) return null
  return {
    schemaVersion: 1,
    documentId: value.documentId,
    recordVersion: value.recordVersion,
    contentSnapshotId: value.contentSnapshotId,
    draftSnapshotId: value.draftSnapshotId,
    encodedByteLength: value.encodedByteLength,
    document: validated.envelope.document,
    sourceContext: validated.envelope.sourceContext,
    reviewJournal: validated.envelope.reviewJournal,
    ...(validated.envelope.quotationRefresh
      ? { quotationRefresh: validated.envelope.quotationRefresh }
      : {}),
  }
}

const requiresStoredDocumentSchemaRewrite = (
  rawBody: unknown,
  body: StoredDraftBody
) => {
  if (!isRecord(rawBody) || !isRecord(rawBody.document)) return false
  const storedDocument = rawBody.document
  if (
    storedDocument.schemaVersion !== body.document.schemaVersion ||
    !Array.isArray(storedDocument.typographyStyles) ||
    !Array.isArray(storedDocument.paintStyles) ||
    !Array.isArray(storedDocument.variables) ||
    !Array.isArray(storedDocument.variableBindings)
  ) {
    return true
  }
  if (!Array.isArray(storedDocument.nodes)) return false
  return storedDocument.nodes.some(
    (node) =>
      isRecord(node) &&
      node.type === "text" &&
      (!Array.isArray(node.runs) ||
        !Array.isArray(node.paragraphs) ||
        !Array.isArray(node.links))
  )
}

const quarantineFailureFor = (
  documentId: string,
  body: unknown,
  metadata: unknown
): DocumentDraftQuarantineRecord["failure"] => {
  if (body === undefined) {
    return {
      store: "draft-body",
      key: documentId,
      code: "missing_body",
      message: "The draft body is missing.",
    }
  }
  if (metadata === undefined) {
    return {
      store: "draft-meta",
      key: documentId,
      code: "missing_metadata",
      message: "The draft metadata is missing.",
    }
  }
  if (!parseBody(body)) {
    const unsupportedSchema =
      isRecord(body) &&
      typeof body.schemaVersion === "number" &&
      body.schemaVersion !== 1
        ? `The draft body uses unsupported schema version ${body.schemaVersion}.`
        : null
    const aggregate =
      isRecord(body) &&
      body.schemaVersion === 1 &&
      "document" in body &&
      "sourceContext" in body
    return {
      store: "draft-body",
      key: documentId,
      code: "schema_invalid",
      message:
        unsupportedSchema ??
        (aggregate
          ? "The draft document aggregate is invalid."
          : "The draft body could not be decoded."),
    }
  }
  if (!parseSummary(metadata)) {
    return {
      store: "draft-meta",
      key: documentId,
      code: "schema_invalid",
      message: "The draft metadata could not be decoded.",
    }
  }
  return {
    store: "paired-record",
    key: documentId,
    code: "pair_mismatch",
    message: "The draft metadata and body do not describe the same revision.",
  }
}

const parseQuarantineRecord = (
  value: unknown
): DocumentDraftQuarantineRecord | null => {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const failure = value.failure
  if (
    typeof value.quarantineId !== "string" ||
    !value.quarantineId ||
    typeof value.documentId !== "string" ||
    !value.documentId ||
    !validTimestamp(value.detectedAt) ||
    typeof value.activeRowsRemoved !== "boolean" ||
    !isRecord(failure) ||
    (failure.store !== "draft-meta" &&
      failure.store !== "draft-body" &&
      failure.store !== "paired-record") ||
    typeof failure.key !== "string" ||
    !failure.key ||
    (failure.code !== "missing_body" &&
      failure.code !== "missing_metadata" &&
      failure.code !== "pair_mismatch" &&
      failure.code !== "integrity_mismatch" &&
      failure.code !== "schema_invalid") ||
    typeof failure.message !== "string" ||
    !failure.message
  ) {
    return null
  }
  return value as DocumentDraftQuarantineRecord
}

const parseCurrentDraftMigrationSetting = (
  value: unknown
): CurrentDraftMigrationSetting | null => {
  if (!isRecord(value) || value.key !== "migration.currentDraftV1") return null
  const setting = value.value
  if (
    !isRecord(setting) ||
    typeof setting.documentId !== "string" ||
    !setting.documentId ||
    !validSnapshotId(setting.draftSnapshotId) ||
    !validTimestamp(setting.completedAt) ||
    !Array.isArray(setting.pendingCleanupKeys) ||
    setting.pendingCleanupKeys.some(
      (key) => typeof key !== "string" || key.length === 0
    )
  ) {
    return null
  }
  return value as CurrentDraftMigrationSetting
}

const parseDraftMetadataIntegrityScanSetting = (
  value: unknown
): DraftMetadataIntegrityScanSetting | null => {
  if (!isRecord(value) || value.key !== "integrityScan.draftMetaV1") return null
  const setting = value.value
  if (
    !isRecord(setting) ||
    (setting.afterPrimaryKey !== null &&
      !validIndexedDbKey(setting.afterPrimaryKey)) ||
    (setting.completedAt !== null && !validTimestamp(setting.completedAt))
  ) {
    return null
  }
  return value as DraftMetadataIntegrityScanSetting
}

const parseConflict = (value: unknown): DocumentDraftConflict | null => {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const hasResolutionDocumentId = Object.hasOwn(value, "resolutionDocumentId")
  const resolutionDocumentId = hasResolutionDocumentId
    ? value.resolutionDocumentId
    : null
  if (
    typeof value.conflictId !== "string" ||
    !value.conflictId ||
    typeof value.documentId !== "string" ||
    !value.documentId ||
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    !validNonnegativeInteger(value.expectedRecordVersion) ||
    (value.observedRecordVersion !== null &&
      !validPositiveInteger(value.observedRecordVersion)) ||
    !validSnapshotId(value.baseDraftSnapshotId) ||
    (value.observedContentSnapshotId !== null &&
      !validSnapshotId(value.observedContentSnapshotId)) ||
    (value.observedDraftSnapshotId !== null &&
      !validSnapshotId(value.observedDraftSnapshotId)) ||
    !validSnapshotId(value.candidateContentSnapshotId) ||
    !validSnapshotId(value.candidateDraftSnapshotId) ||
    (value.reason !== "stale_write" &&
      value.reason !== "deleted_elsewhere" &&
      value.reason !== "migration_collision") ||
    !validTimestamp(value.detectedAt) ||
    (value.resolvedAt !== null && !validTimestamp(value.resolvedAt)) ||
    (value.resolution !== null &&
      value.resolution !== "reload_saved" &&
      value.resolution !== "save_copy") ||
    (resolutionDocumentId !== null &&
      !validRequiredString(resolutionDocumentId))
  )
    return null
  const unresolved = value.resolvedAt === null && value.resolution === null
  const reloadSaved =
    value.resolvedAt !== null &&
    value.resolution === "reload_saved" &&
    resolutionDocumentId === null
  const saveCopy =
    value.resolvedAt !== null &&
    value.resolution === "save_copy" &&
    validRequiredString(resolutionDocumentId)
  const legacySaveCopyWithoutResult =
    !hasResolutionDocumentId &&
    value.resolvedAt !== null &&
    value.resolution === "save_copy"
  if (
    (!unresolved &&
      !reloadSaved &&
      !saveCopy &&
      !legacySaveCopyWithoutResult) ||
    (unresolved && resolutionDocumentId !== null)
  ) {
    return null
  }
  const candidate = validateCurrentDraftSnapshot(value.candidate)
  if (!candidate.ok || candidate.envelope.document.id !== value.documentId)
    return null
  return {
    ...(value as Omit<
      StoredDocumentDraftConflictV1,
      "candidate" | "resolutionDocumentId"
    >),
    candidate: snapshotForEnvelope(candidate.envelope),
    resolutionDocumentId,
  }
}

const headIdentityFor = (summary: DocumentDraftSummary): DraftHeadIdentity => ({
  documentId: summary.documentId,
  recordVersion: summary.recordVersion,
  contentSnapshotId: summary.contentSnapshotId,
  draftSnapshotId: summary.draftSnapshotId,
  deletedAt: summary.deletedAt,
})

const parseHeadIdentity = (value: unknown): DraftHeadIdentity | null => {
  if (
    !isRecord(value) ||
    !validRequiredString(value.documentId) ||
    !validPositiveInteger(value.recordVersion) ||
    !validSnapshotId(value.contentSnapshotId) ||
    !validSnapshotId(value.draftSnapshotId) ||
    (value.deletedAt !== null && !validTimestamp(value.deletedAt))
  )
    return null
  return value as DraftHeadIdentity
}

const headIdentityMatches = (
  summary: DocumentDraftSummary,
  expected: DraftHeadIdentity
) => storedValueEqual(headIdentityFor(summary), expected)

const parseAdmissionMigrationAlias = (
  value: unknown
): AdmissionMigrationAlias | null => {
  if (!isRecord(value)) return null
  const localAssetId = localAssetIdSchema.safeParse(value.localAssetId)
  const managedAssetId = mediaAssetIdSchema.safeParse(value.managedAssetId)
  const managedSource = managedAssetSourceSchema.safeParse(value.managedSource)
  const mappingRequestId = mediaRequestIdSchema.safeParse(
    value.mappingRequestId
  )
  if (
    !localAssetId.success ||
    !managedAssetId.success ||
    !managedSource.success ||
    managedSource.data !== `asset:managed/${managedAssetId.data}` ||
    typeof value.contentSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.contentSha256) ||
    (value.managedStatus !== "ready" && value.managedStatus !== "archived") ||
    !Array.isArray(value.expectedReferenceKeys) ||
    value.expectedReferenceKeys.length === 0 ||
    value.expectedReferenceKeys.some(
      (key) => typeof key !== "string" || key.length === 0
    ) ||
    (value.localState !== "ready" &&
      value.localState !== "missing_bytes" &&
      value.localState !== "absent" &&
      value.localState !== "quarantined") ||
    (value.relationship !== "same_hash" &&
      value.relationship !== "no_local_bytes") ||
    (value.localState === "ready"
      ? value.relationship !== "same_hash"
      : value.relationship !== "no_local_bytes") ||
    !mappingRequestId.success
  ) {
    return null
  }
  const expectedReferenceKeys = [...value.expectedReferenceKeys] as string[]
  if (
    new Set(expectedReferenceKeys).size !== expectedReferenceKeys.length ||
    expectedReferenceKeys.some(
      (key, index) => index > 0 && expectedReferenceKeys[index - 1] >= key
    )
  ) {
    return null
  }
  return {
    localAssetId: localAssetId.data,
    managedAssetId: managedAssetId.data,
    managedSource: managedSource.data as `asset:managed/${string}`,
    contentSha256: value.contentSha256,
    managedStatus: value.managedStatus,
    expectedReferenceKeys,
    localState: value.localState,
    relationship: value.relationship,
    mappingRequestId: mappingRequestId.data,
  }
}

const parseAdmissionMigrationAliases = (
  value: unknown
): readonly AdmissionMigrationAlias[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null
  const aliases: AdmissionMigrationAlias[] = []
  for (const candidate of value) {
    const alias = parseAdmissionMigrationAlias(candidate)
    if (!alias) return null
    aliases.push(alias)
  }
  if (
    new Set(aliases.map((alias) => alias.localAssetId)).size !==
      aliases.length ||
    aliases.some(
      (alias, index) =>
        index > 0 && aliases[index - 1].localAssetId >= alias.localAssetId
    )
  ) {
    return null
  }
  return aliases
}

const parseLocalMediaAdmissionManagedUses = (
  value: unknown
): readonly LocalMediaAdmissionManagedUse[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null
  const uses: LocalMediaAdmissionManagedUse[] = []
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !mediaAssetIdSchema.safeParse(candidate.assetId).success ||
      typeof candidate.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.idempotencyKey) ||
      (candidate.requestId !== null &&
        !mediaRequestIdSchema.safeParse(candidate.requestId).success) ||
      (candidate.usedAt !== null && !validTimestamp(candidate.usedAt)) ||
      (candidate.assetRevision !== null &&
        !validPositiveInteger(candidate.assetRevision))
    ) {
      return null
    }
    const settled =
      candidate.requestId !== null &&
      candidate.usedAt !== null &&
      candidate.assetRevision !== null
    const pending =
      candidate.requestId === null &&
      candidate.usedAt === null &&
      candidate.assetRevision === null
    if (!settled && !pending) return null
    uses.push(candidate as LocalMediaAdmissionManagedUse)
  }
  if (
    new Set(uses.map((use) => use.assetId)).size !== uses.length ||
    uses.some(
      (use, index) => index > 0 && uses[index - 1].assetId >= use.assetId
    )
  ) {
    return null
  }
  return uses
}

const parseLocalMediaAdmissionReceipt = (
  value: unknown
): LocalMediaAdmissionReceiptRecord | null => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "local_media_admission" ||
    !validRequiredString(value.receiptId) ||
    value.receiptId.length > 128 ||
    !validRequiredString(value.documentId) ||
    !validTimestamp(value.createdAt) ||
    (value.acknowledgedAt !== null && !validTimestamp(value.acknowledgedAt)) ||
    (value.restoredAt !== null && !validTimestamp(value.restoredAt))
  ) {
    return null
  }
  const source = parseHeadIdentity(value.source)
  const result = parseHeadIdentity(value.result)
  const aliases = parseAdmissionMigrationAliases(value.aliases)
  const managedUses = parseLocalMediaAdmissionManagedUses(value.managedUses)
  if (
    !source ||
    !result ||
    !aliases ||
    !managedUses ||
    source.documentId !== value.documentId ||
    result.documentId !== value.documentId ||
    source.deletedAt !== null ||
    result.deletedAt !== null ||
    result.recordVersion !== source.recordVersion + 1 ||
    new Set(aliases.map((alias) => alias.managedAssetId)).size !==
      managedUses.length ||
    aliases.some(
      (alias) =>
        !managedUses.some((use) => use.assetId === alias.managedAssetId)
    )
  ) {
    return null
  }
  if (value.acknowledgedAt !== null) {
    if (value.preimage !== null) return null
    return {
      ...(value as Omit<
        LocalMediaAdmissionAuditReceipt,
        "aliases" | "managedUses"
      >),
      aliases,
      managedUses,
      acknowledgedAt: value.acknowledgedAt,
      preimage: null,
    }
  }
  if (!isRecord(value.preimage) || value.preimage.schemaVersion !== 1) {
    return null
  }
  const preimage = validateCurrentDraftSnapshot({
    document: value.preimage.document,
    sourceContext: value.preimage.sourceContext,
    reviewJournal: value.preimage.reviewJournal,
    quotationRefresh: value.preimage.quotationRefresh,
  })
  if (!preimage.ok || preimage.envelope.document.id !== value.documentId) {
    return null
  }
  return {
    ...(value as Omit<
      LocalMediaAdmissionReceipt,
      "aliases" | "managedUses" | "preimage"
    >),
    aliases,
    managedUses,
    preimage: preimage.envelope,
  }
}

const isPendingLocalMediaAdmissionReceipt = (
  receipt: LocalMediaAdmissionReceiptRecord
): receipt is LocalMediaAdmissionReceipt =>
  receipt.acknowledgedAt === null && receipt.preimage !== null

const receiptPreimageMatchesSource = async (
  receipt: LocalMediaAdmissionReceiptRecord
) => {
  if (receipt.preimage === null) return true
  const prepared = await prepareDraftAdmission(
    snapshotForEnvelope(receipt.preimage)
  )
  return (
    prepared.ok &&
    prepared.envelope.document.id === receipt.documentId &&
    prepared.contentSnapshotId === receipt.source.contentSnapshotId &&
    prepared.draftSnapshotId === receipt.source.draftSnapshotId
  )
}

const exactMigrationEnvelope = (
  source: CurrentDraftEnvelope,
  result: CurrentDraftEnvelope,
  aliases: readonly AdmissionMigrationAlias[]
) => {
  const sourceRest = { ...source, document: null }
  const resultRest = { ...result, document: null }
  if (!storedValueEqual(sourceRest, resultRest)) return false
  if (
    source.document.id !== result.document.id ||
    result.document.revision !== source.document.revision + aliases.length
  ) {
    return false
  }
  const projected = structuredClone(source.document)
  const sourceReferences = new Map(
    extractAssetReferences(source.document).map((reference) => [
      reference.key,
      reference,
    ])
  )
  const resultReferences = new Map(
    extractAssetReferences(result.document).map((reference) => [
      reference.key,
      reference,
    ])
  )
  for (const alias of aliases) {
    const localSource = `asset:local/${alias.localAssetId}`
    if (
      !storedValueEqual(
        assetReferenceKeysForSource(source.document, localSource),
        alias.expectedReferenceKeys
      ) ||
      assetReferenceKeysForSource(result.document, localSource).length > 0
    ) {
      return false
    }
    for (const key of alias.expectedReferenceKeys) {
      const before = sourceReferences.get(key)
      const after = resultReferences.get(key)
      if (
        before?.source !== localSource ||
        after?.source !== alias.managedSource ||
        ((after.location === "node" || after.location === "node_fill") &&
          after.assetId !== alias.managedAssetId)
      ) {
        return false
      }
    }
    for (const field of projected.fields) {
      if (field.type === "asset" && field.defaultValue === localSource) {
        field.defaultValue = alias.managedSource
      }
      if (projected.fieldValues[field.id] === localSource) {
        projected.fieldValues[field.id] = alias.managedSource
      }
    }
    for (const node of projected.nodes) {
      if (node.type === "image" && node.src === localSource) {
        node.src = alias.managedSource
        node.assetId = alias.managedAssetId
      } else if ("fills" in node && node.fills) {
        node.fills = node.fills.map((paint) =>
          paint.type === "image" && paint.src === localSource
            ? {
                ...paint,
                src: alias.managedSource,
                assetId: alias.managedAssetId,
              }
            : paint
        )
      }
    }
  }
  projected.revision = result.document.revision
  projected.updatedAt = result.document.updatedAt
  return storedValueEqual(projected, result.document)
}

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError")

const pairMatches = (body: StoredDraftBody, summary: DocumentDraftSummary) => {
  if (
    body.documentId !== summary.documentId ||
    body.recordVersion !== summary.recordVersion ||
    body.contentSnapshotId !== summary.contentSnapshotId ||
    body.draftSnapshotId !== summary.draftSnapshotId ||
    body.encodedByteLength !== summary.encodedByteLength
  )
    return false
  const projected = summaryFor({
    envelope: envelopeForBody(body),
    recordVersion: body.recordVersion,
    contentSnapshotId: body.contentSnapshotId,
    draftSnapshotId: body.draftSnapshotId,
    encodedByteLength: body.encodedByteLength,
    createdAt: summary.createdAt,
    savedAt: summary.savedAt,
    lastOpenedAt: summary.lastOpenedAt,
    activityAt: summary.activityAt,
    deletedAt: summary.deletedAt,
    origin: summary.origin,
    lastPublished: summary.lastPublished,
  })
  return JSON.stringify(projected) === JSON.stringify(summary)
}

const envelopeForBody = (body: StoredDraftBody): CurrentDraftEnvelope => ({
  schemaVersion: 1,
  document: body.document,
  sourceContext: body.sourceContext,
  reviewJournal: body.reviewJournal,
  ...(body.quotationRefresh ? { quotationRefresh: body.quotationRefresh } : {}),
})

const snapshotForEnvelope = (
  envelope: CurrentDraftEnvelope
): CurrentDraftSnapshot => ({
  document: envelope.document,
  sourceContext: envelope.sourceContext,
  reviewJournal: envelope.reviewJournal,
  ...(envelope.quotationRefresh
    ? { quotationRefresh: envelope.quotationRefresh }
    : {}),
})

const verifiedRecordForPair = async (
  rawBody: unknown,
  rawSummary: unknown
): Promise<DocumentDraftRecord | null> => {
  const body = parseBody(rawBody)
  const summary = parseSummary(rawSummary)
  if (!body || !summary || !pairMatches(body, summary)) return null
  const admission = await prepareDraftAdmission(
    snapshotForEnvelope(envelopeForBody(body))
  )
  if (
    !admission.ok ||
    admission.contentSnapshotId !== body.contentSnapshotId ||
    admission.draftSnapshotId !== body.draftSnapshotId ||
    admission.encodedByteLength !== body.encodedByteLength
  ) {
    return null
  }
  return {
    summary,
    envelope: admission.envelope,
  }
}

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Document storage request failed"))
  })

const transactionDone = (transaction: IDBTransaction) => {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    // A request error is observed by its request promise. The transaction then
    // reaches `abort`, which carries the truthful terminal outcome.
    transaction.onerror = () => undefined
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Document storage transaction was aborted")
      )
  })
  // A request can fail before its caller reaches `await completion`. Attach a
  // rejection observer immediately so the transaction abort never becomes an
  // unhandled promise while the public operation maps the request failure.
  void completion.catch(() => undefined)
  return completion
}

const cursorSummaries = (
  index: IDBIndex,
  range: IDBKeyRange | null,
  count: number,
  include: (summary: DocumentDraftSummary) => boolean
) =>
  new Promise<
    Readonly<{
      values: readonly DocumentDraftSummary[]
      observations: readonly DraftListCorruptObservation[]
    }>
  >((resolve, reject) => {
    const values: DocumentDraftSummary[] = []
    const observations: DraftListCorruptObservation[] = []
    const request = index.openCursor(range, "prev")
    request.onerror = () =>
      reject(request.error ?? new Error("Document list cursor failed"))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve({ values, observations })
        return
      }
      const summary = parseSummary(cursor.value)
      const documentId =
        typeof cursor.primaryKey === "string" && cursor.primaryKey.length > 0
          ? cursor.primaryKey
          : null
      if (!summary || summary.documentId !== documentId) {
        observations.push({
          documentId,
          primaryKey: cursor.primaryKey,
          metadata: cursor.value,
          failure: {
            kind: "corrupt_record",
            message: "Stored document metadata could not be decoded.",
          },
        })
      } else if (include(summary)) {
        values.push(summary)
      }
      if (values.length >= count) {
        resolve({ values, observations })
        return
      }
      cursor.continue()
    }
  })

const scanMetadataPrimaryKeys = (
  metadata: IDBObjectStore,
  afterPrimaryKey: IDBValidKey | null,
  count: number
) =>
  new Promise<
    Readonly<{
      observations: readonly DraftListCorruptObservation[]
      lastPrimaryKey: IDBValidKey | null
      reachedEnd: boolean
    }>
  >((resolve, reject) => {
    const observations: DraftListCorruptObservation[] = []
    let visited = 0
    let lastPrimaryKey: IDBValidKey | null = null
    const range =
      afterPrimaryKey === null
        ? null
        : IDBKeyRange.lowerBound(afterPrimaryKey, true)
    const request = metadata.openCursor(range, "next")
    request.onerror = () =>
      reject(
        request.error ?? new Error("Document metadata integrity scan failed")
      )
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve({ observations, lastPrimaryKey, reachedEnd: true })
        return
      }
      visited += 1
      lastPrimaryKey = cursor.primaryKey
      const summary = parseSummary(cursor.value)
      const documentId =
        typeof cursor.primaryKey === "string" && cursor.primaryKey.length > 0
          ? cursor.primaryKey
          : null
      if (!summary || summary.documentId !== documentId) {
        observations.push({
          documentId,
          primaryKey: cursor.primaryKey,
          metadata: cursor.value,
          failure: {
            kind: "corrupt_record",
            message: "Stored document metadata could not be decoded.",
          },
        })
      }
      if (visited >= count) {
        resolve({ observations, lastPrimaryKey, reachedEnd: false })
        return
      }
      cursor.continue()
    }
  })

const storageFailure = (error: unknown): DraftRepositoryFailure => {
  const name =
    isRecord(error) && typeof error.name === "string" ? error.name : ""
  const detail =
    error instanceof Error && error.message.trim() ? error.message.trim() : ""
  const kind: DraftRepositoryFailure["kind"] = detail.includes(
    "upgrade is blocked"
  )
    ? "blocked"
    : name === "QuotaExceededError"
      ? "quota_exceeded"
      : name === "AbortError" || /transaction.*aborted/i.test(detail)
        ? "transaction_aborted"
        : /request.*(?:fail|error)/i.test(detail)
          ? "request_failed"
          : "storage_unavailable"
  return {
    kind,
    message: detail
      ? `Studio document storage is unavailable. ${detail}`
      : "Studio document storage is unavailable.",
  }
}

export class DocumentDraftRepository {
  readonly #databaseName: string
  readonly #indexedDB: IDBFactory
  readonly #now: () => string
  readonly #createId: () => string
  readonly #sessionId: string
  readonly #createBroadcastChannel: ((name: string) => BroadcastChannel) | null
  readonly #listeners = new Set<(event: DraftRepositoryEvent) => void>()
  #channel: BroadcastChannel | null = null
  #channelInitialized = false

  get sessionId() {
    return this.#sessionId
  }

  constructor(options: DocumentDraftRepositoryOptions = {}) {
    this.#databaseName = options.databaseName ?? DATABASE_NAME
    this.#indexedDB = options.indexedDB ?? globalThis.indexedDB
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#createId = options.createId ?? (() => crypto.randomUUID())
    this.#sessionId = options.sessionId ?? `session-${crypto.randomUUID()}`
    this.#createBroadcastChannel =
      options.createBroadcastChannel ??
      (typeof window !== "undefined" && "BroadcastChannel" in globalThis
        ? (name: string) => new BroadcastChannel(name)
        : null)
  }

  #initializeChannel() {
    if (this.#channelInitialized) return
    this.#channelInitialized = true
    let channel: BroadcastChannel | null = null
    try {
      channel = this.#createBroadcastChannel
        ? this.#createBroadcastChannel(`${this.#databaseName}:events:v1`)
        : null
    } catch {
      // Compare-and-swap remains authoritative when invalidation is unavailable.
    }
    if (channel) {
      try {
        channel.onmessage = (message: MessageEvent<unknown>) => {
          const event = parseRepositoryEvent(message.data)
          if (event && event.sessionId !== this.#sessionId) this.#emit(event)
        }
      } catch {
        try {
          channel.close()
        } catch {
          // The optional invalidation channel cannot affect repository startup.
        }
        channel = null
      }
    }
    this.#channel = channel
  }

  subscribe(listener: (event: DraftRepositoryEvent) => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  close() {
    try {
      this.#channel?.close()
    } catch {
      // Storage correctness does not depend on invalidation channel teardown.
    }
    this.#listeners.clear()
  }

  #emit(event: DraftRepositoryEvent) {
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // Observers cannot roll back an already committed repository mutation.
      }
    }
  }

  #publish(event: DraftRepositoryEvent) {
    this.#emit(event)
    try {
      this.#channel?.postMessage(event)
    } catch {
      // Broadcast is an invalidation hint, never the source of correctness.
    }
  }

  async open(): Promise<
    | Readonly<{ ok: true; databaseName: string; schemaVersion: number }>
    | Readonly<{
        ok: false
        reason: "storage_unavailable" | "blocked"
        failure: DraftRepositoryFailure
      }>
  > {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      return {
        ok: true,
        databaseName: this.#databaseName,
        schemaVersion: DATABASE_VERSION,
      }
    } catch (error) {
      return {
        ok: false,
        reason:
          storageFailure(error).kind === "blocked"
            ? "blocked"
            : "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async #open() {
    this.#initializeChannel()
    const request = this.#indexedDB.open(this.#databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const transaction = request.transaction
      const metadata = database.objectStoreNames.contains(METADATA_STORE)
        ? transaction?.objectStore(METADATA_STORE)
        : database.createObjectStore(METADATA_STORE, { keyPath: "documentId" })
      if (!database.objectStoreNames.contains(BODY_STORE)) {
        database.createObjectStore(BODY_STORE, { keyPath: "documentId" })
      }
      if (!database.objectStoreNames.contains(PREVIEW_STORE)) {
        database.createObjectStore(PREVIEW_STORE, { keyPath: "documentId" })
      }
      const quarantine = database.objectStoreNames.contains(QUARANTINE_STORE)
        ? transaction?.objectStore(QUARANTINE_STORE)
        : database.createObjectStore(QUARANTINE_STORE, {
            keyPath: "quarantineId",
          })
      const conflicts = database.objectStoreNames.contains(CONFLICT_STORE)
        ? transaction?.objectStore(CONFLICT_STORE)
        : database.createObjectStore(CONFLICT_STORE, { keyPath: "conflictId" })
      const mediaMigrations = database.objectStoreNames.contains(
        MEDIA_MIGRATION_STORE
      )
        ? transaction?.objectStore(MEDIA_MIGRATION_STORE)
        : database.createObjectStore(MEDIA_MIGRATION_STORE, {
            keyPath: "receiptId",
          })
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" })
      }
      if (metadata && !metadata.indexNames.contains(ACTIVITY_AT_INDEX)) {
        metadata.createIndex(ACTIVITY_AT_INDEX, [
          ACTIVITY_AT_INDEX,
          "documentId",
        ])
      }
      if (metadata && !metadata.indexNames.contains(SAVED_AT_INDEX)) {
        metadata.createIndex(SAVED_AT_INDEX, SAVED_AT_INDEX)
      }
      if (metadata && !metadata.indexNames.contains(LAST_OPENED_AT_INDEX)) {
        metadata.createIndex(LAST_OPENED_AT_INDEX, LAST_OPENED_AT_INDEX)
      }
      if (metadata && !metadata.indexNames.contains(DELETED_AT_INDEX)) {
        metadata.createIndex(DELETED_AT_INDEX, DELETED_AT_INDEX)
      }
      if (
        conflicts &&
        !conflicts.indexNames.contains(CONFLICT_DOCUMENT_INDEX)
      ) {
        conflicts.createIndex(CONFLICT_DOCUMENT_INDEX, CONFLICT_DOCUMENT_INDEX)
      }
      if (
        conflicts &&
        !conflicts.indexNames.contains(CONFLICT_DETECTED_AT_INDEX)
      ) {
        conflicts.createIndex(
          CONFLICT_DETECTED_AT_INDEX,
          CONFLICT_DETECTED_AT_INDEX
        )
      }
      if (
        quarantine &&
        !quarantine.indexNames.contains(QUARANTINE_DOCUMENT_INDEX)
      ) {
        quarantine.createIndex(
          QUARANTINE_DOCUMENT_INDEX,
          QUARANTINE_DOCUMENT_INDEX
        )
      }
      if (
        quarantine &&
        !quarantine.indexNames.contains(QUARANTINE_DETECTED_AT_INDEX)
      ) {
        quarantine.createIndex(
          QUARANTINE_DETECTED_AT_INDEX,
          QUARANTINE_DETECTED_AT_INDEX
        )
      }
      if (
        mediaMigrations &&
        !mediaMigrations.indexNames.contains(
          MEDIA_MIGRATION_DOCUMENT_CREATED_AT_INDEX
        )
      ) {
        mediaMigrations.createIndex(MEDIA_MIGRATION_DOCUMENT_CREATED_AT_INDEX, [
          "documentId",
          "createdAt",
        ])
      }
      if (
        mediaMigrations &&
        !mediaMigrations.indexNames.contains(
          MEDIA_MIGRATION_ACKNOWLEDGED_CREATED_AT_INDEX
        )
      ) {
        mediaMigrations.createIndex(
          MEDIA_MIGRATION_ACKNOWLEDGED_CREATED_AT_INDEX,
          ["acknowledgedAt", "createdAt"]
        )
      }
    }
    let blocked = false
    return new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => {
        if (blocked) {
          request.result.close()
          return
        }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () =>
        reject(request.error ?? new Error("Document database failed to open"))
      request.onblocked = () => {
        blocked = true
        reject(
          new Error(
            "A document storage upgrade is blocked by another Studio tab. Close the other tab and retry."
          )
        )
      }
    })
  }

  async #prepared(snapshot: CurrentDraftSnapshot) {
    return prepareDraftAdmission(snapshot)
  }

  async #conflictIdForWrite(
    conflicts: IDBObjectStore,
    preferredConflictId: string
  ) {
    const preferred = await requestResult(conflicts.get(preferredConflictId))
    if (
      preferred === undefined ||
      parseConflict(preferred)?.resolvedAt === null
    )
      return preferredConflictId

    const generatedBase = `${preferredConflictId}:${this.#createId()}`
    let generatedConflictId = generatedBase
    let collision = 1
    while (
      (await requestResult(conflicts.get(generatedConflictId))) !== undefined
    ) {
      collision += 1
      generatedConflictId = `${generatedBase}:${collision}`
    }
    return generatedConflictId
  }

  async create(
    snapshot: CurrentDraftSnapshot,
    origin: DraftOrigin = { kind: "blank" }
  ): Promise<DraftWriteResult> {
    const prepared = await this.#prepared(snapshot)
    if (!prepared.ok) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: admissionFailure(prepared),
      }
    }
    const now = this.#now()
    const body: StoredDraftBody = {
      schemaVersion: 1,
      documentId: prepared.envelope.document.id,
      recordVersion: 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      encodedByteLength: prepared.encodedByteLength,
      document: prepared.envelope.document,
      sourceContext: prepared.envelope.sourceContext,
      reviewJournal: prepared.envelope.reviewJournal,
      ...(prepared.envelope.quotationRefresh
        ? { quotationRefresh: prepared.envelope.quotationRefresh }
        : {}),
    }
    const summary = summaryFor({
      envelope: prepared.envelope,
      recordVersion: 1,
      contentSnapshotId: body.contentSnapshotId,
      draftSnapshotId: body.draftSnapshotId,
      encodedByteLength: body.encodedByteLength,
      createdAt: now,
      savedAt: now,
      lastOpenedAt: now,
      activityAt: now,
      deletedAt: null,
      origin,
    })
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [existingBody, existingMetadata] = await Promise.all([
        requestResult(bodies.get(summary.documentId)),
        requestResult(metadata.get(summary.documentId)),
      ])
      if (existingBody !== undefined || existingMetadata !== undefined) {
        const currentBody = parseBody(existingBody)
        const current = parseSummary(existingMetadata)
        await done
        if (!currentBody || !current || !pairMatches(currentBody, current)) {
          const quarantined = await this.#quarantine(
            summary.documentId,
            existingBody,
            existingMetadata
          )
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId: quarantined.quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "The existing document metadata is corrupt and was quarantined.",
            },
          }
        }
        const verified = await prepareDraftAdmission(
          snapshotForEnvelope(envelopeForBody(currentBody))
        )
        if (
          !verified.ok ||
          verified.contentSnapshotId !== current.contentSnapshotId ||
          verified.draftSnapshotId !== current.draftSnapshotId ||
          verified.encodedByteLength !== current.encodedByteLength
        ) {
          const quarantined = await this.#quarantine(
            summary.documentId,
            existingBody,
            existingMetadata
          )
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId: quarantined.quarantineId,
            failure: {
              kind: "corrupt_record",
              message: "The existing document failed its integrity check.",
            },
          }
        }
        return { ok: false, reason: "exists", current }
      }
      bodies.put(body)
      metadata.put(summary)
      await done
      this.#publish({
        type: "saved",
        reason: "content_saved",
        documentId: summary.documentId,
        recordVersion: summary.recordVersion,
        contentSnapshotId: summary.contentSnapshotId,
        draftSnapshotId: summary.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      return {
        ok: true,
        created: true,
        unchanged: false,
        record: { summary, envelope: prepared.envelope },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async migrateCurrentDraft(
    snapshot: CurrentDraftSnapshot,
    {
      completedAt = this.#now(),
      pendingCleanupKeys = [],
    }: { completedAt?: string; pendingCleanupKeys?: readonly string[] } = {}
  ): Promise<DraftMigrationResult> {
    const prepared = await this.#prepared(snapshot)
    if (!prepared.ok) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: admissionFailure(prepared),
      }
    }
    const documentId = prepared.envelope.document.id
    const setting: CurrentDraftMigrationSetting = {
      key: "migration.currentDraftV1",
      value: {
        documentId,
        draftSnapshotId: prepared.draftSnapshotId,
        completedAt,
        pendingCleanupKeys: [...pendingCleanupKeys],
      },
    }
    const body: StoredDraftBody = {
      schemaVersion: 1,
      documentId,
      recordVersion: 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      encodedByteLength: prepared.encodedByteLength,
      document: prepared.envelope.document,
      sourceContext: prepared.envelope.sourceContext,
      reviewJournal: prepared.envelope.reviewJournal,
      ...(prepared.envelope.quotationRefresh
        ? { quotationRefresh: prepared.envelope.quotationRefresh }
        : {}),
    }
    const createdSummary = summaryFor({
      envelope: prepared.envelope,
      recordVersion: 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      encodedByteLength: prepared.encodedByteLength,
      createdAt: completedAt,
      savedAt: completedAt,
      lastOpenedAt: completedAt,
      activityAt: completedAt,
      deletedAt: null,
      origin: { kind: "current-draft-migration" },
    })

    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, CONFLICT_STORE, SETTINGS_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const settings = transaction.objectStore(SETTINGS_STORE)
      const [rawBody, rawSummary, rawMigrationSetting] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
        requestResult(settings.get("migration.currentDraftV1")),
      ])

      if (rawBody === undefined && rawSummary === undefined) {
        bodies.put(body)
        metadata.put(createdSummary)
        settings.put(setting)
        await done
        this.#publish({
          type: "saved",
          reason: "content_saved",
          documentId,
          recordVersion: 1,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          sessionId: this.#sessionId,
        })
        return {
          ok: true,
          status: "created",
          record: { summary: createdSummary, envelope: prepared.envelope },
        }
      }

      const currentBody = parseBody(rawBody)
      const current = parseSummary(rawSummary)
      if (!currentBody || !current || !pairMatches(currentBody, current)) {
        await done
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary
        )
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The existing document is corrupt and migration was stopped.",
          },
        }
      }

      const migrationSetting =
        parseCurrentDraftMigrationSetting(rawMigrationSetting)
      if (
        migrationSetting?.value.documentId === documentId &&
        migrationSetting.value.draftSnapshotId === prepared.draftSnapshotId
      ) {
        settings.put(setting)
        await done
        return {
          ok: true,
          status: "already_migrated",
          record: { summary: current, envelope: envelopeForBody(currentBody) },
        }
      }

      if (current.draftSnapshotId === prepared.draftSnapshotId) {
        settings.put(setting)
        await done
        return {
          ok: true,
          status: "identical",
          record: { summary: current, envelope: envelopeForBody(currentBody) },
        }
      }

      const conflictStore = transaction.objectStore(CONFLICT_STORE)
      const conflict: DocumentDraftConflict = {
        schemaVersion: 1,
        conflictId: await this.#conflictIdForWrite(
          conflictStore,
          `migration-conflict:${documentId}:${this.#sessionId}`
        ),
        documentId,
        sessionId: this.#sessionId,
        expectedRecordVersion: 0,
        observedRecordVersion: current.recordVersion,
        baseDraftSnapshotId: prepared.draftSnapshotId,
        observedContentSnapshotId: current.contentSnapshotId,
        observedDraftSnapshotId: current.draftSnapshotId,
        candidateContentSnapshotId: prepared.contentSnapshotId,
        candidateDraftSnapshotId: prepared.draftSnapshotId,
        candidate: snapshotForEnvelope(prepared.envelope),
        reason: "migration_collision",
        detectedAt: completedAt,
        resolvedAt: null,
        resolution: null,
        resolutionDocumentId: null,
      }
      conflictStore.put(conflict)
      await done
      return { ok: false, reason: "collision", conflict, current }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async updateCurrentDraftMigrationCleanup(
    documentId: string,
    draftSnapshotId: string,
    pendingCleanupKeys: readonly string[]
  ): Promise<DraftMigrationCleanupResult> {
    if (
      !documentId ||
      !validSnapshotId(draftSnapshotId) ||
      pendingCleanupKeys.some((key) => typeof key !== "string" || !key)
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Migration cleanup identity or pending keys are invalid.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(SETTINGS_STORE, "readwrite")
      const done = transactionDone(transaction)
      const settings = transaction.objectStore(SETTINGS_STORE)
      const raw = await requestResult(settings.get("migration.currentDraftV1"))
      if (raw === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const current = parseCurrentDraftMigrationSetting(raw)
      if (
        !current ||
        current.value.documentId !== documentId ||
        current.value.draftSnapshotId !== draftSnapshotId
      ) {
        await done
        return { ok: false, reason: "marker_mismatch" }
      }
      const nextPending = [...new Set(pendingCleanupKeys)]
      settings.put({
        ...current,
        value: { ...current.value, pendingCleanupKeys: nextPending },
      } satisfies CurrentDraftMigrationSetting)
      await done
      return { ok: true, pendingCleanupKeys: nextPending }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async save(
    snapshot: CurrentDraftSnapshot,
    expectedVersion: number,
    baseDraftSnapshotId: string
  ): Promise<DraftWriteResult> {
    if (!validPositiveInteger(expectedVersion)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A positive expected repository version is required to save.",
        },
      }
    }
    if (!validSnapshotId(baseDraftSnapshotId)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid base draft snapshot ID is required to save.",
        },
      }
    }
    const prepared = await this.#prepared(snapshot)
    if (!prepared.ok) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: admissionFailure(prepared),
      }
    }
    const documentId = prepared.envelope.document.id
    const baseRead = await this.get(documentId)
    if (!baseRead.ok) {
      if (baseRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: baseRead.quarantineId,
          failure: baseRead.failure,
        }
      }
      return {
        ok: false,
        reason: baseRead.reason,
        failure: baseRead.failure,
      }
    }
    if (baseRead.status === "missing") return { ok: false, reason: "missing" }
    const verifiedBase = baseRead.record
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, CONFLICT_STORE, PREVIEW_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const conflicts = transaction.objectStore(CONFLICT_STORE)
      const previews = transaction.objectStore(PREVIEW_STORE)
      const [rawBody, rawSummary] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
      ])
      if (rawBody === undefined && rawSummary === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const currentBody = parseBody(rawBody)
      const currentSummary = parseSummary(rawSummary)
      if (
        !currentBody ||
        !currentSummary ||
        !pairMatches(currentBody, currentSummary) ||
        (currentSummary.recordVersion === verifiedBase.summary.recordVersion &&
          (currentSummary.contentSnapshotId !==
            verifiedBase.summary.contentSnapshotId ||
            currentSummary.draftSnapshotId !==
              verifiedBase.summary.draftSnapshotId ||
            currentSummary.encodedByteLength !==
              verifiedBase.summary.encodedByteLength))
      ) {
        await done
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary
        )
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message: "The stored document is corrupt and was quarantined.",
          },
        }
      }
      if (
        currentSummary.deletedAt !== null ||
        currentSummary.recordVersion !== expectedVersion
      ) {
        const deleted = currentSummary.deletedAt !== null
        const conflict: DocumentDraftConflict = {
          schemaVersion: 1,
          conflictId: await this.#conflictIdForWrite(
            conflicts,
            `conflict:${documentId}:${this.#sessionId}`
          ),
          documentId,
          sessionId: this.#sessionId,
          expectedRecordVersion: expectedVersion,
          observedRecordVersion: currentSummary.recordVersion,
          baseDraftSnapshotId,
          observedContentSnapshotId: currentSummary.contentSnapshotId,
          observedDraftSnapshotId: currentSummary.draftSnapshotId,
          candidateContentSnapshotId: prepared.contentSnapshotId,
          candidateDraftSnapshotId: prepared.draftSnapshotId,
          candidate: snapshotForEnvelope(prepared.envelope),
          reason: deleted ? "deleted_elsewhere" : "stale_write",
          detectedAt: this.#now(),
          resolvedAt: null,
          resolution: null,
          resolutionDocumentId: null,
        }
        conflicts.put(conflict)
        await done
        return {
          ok: false,
          reason: deleted ? "deleted" : "conflict",
          conflict,
          current: currentSummary,
        }
      }
      if (currentBody.draftSnapshotId === prepared.draftSnapshotId) {
        await done
        return {
          ok: true,
          created: false,
          unchanged: true,
          record: {
            summary: currentSummary,
            envelope: envelopeForBody(currentBody),
          },
        }
      }
      const recordVersion = currentSummary.recordVersion + 1
      const now = this.#now()
      const body: StoredDraftBody = {
        schemaVersion: 1,
        documentId,
        recordVersion,
        contentSnapshotId: prepared.contentSnapshotId,
        draftSnapshotId: prepared.draftSnapshotId,
        encodedByteLength: prepared.encodedByteLength,
        document: prepared.envelope.document,
        sourceContext: prepared.envelope.sourceContext,
        reviewJournal: prepared.envelope.reviewJournal,
        ...(prepared.envelope.quotationRefresh
          ? { quotationRefresh: prepared.envelope.quotationRefresh }
          : {}),
      }
      const summary = summaryFor({
        envelope: prepared.envelope,
        recordVersion,
        contentSnapshotId: body.contentSnapshotId,
        draftSnapshotId: body.draftSnapshotId,
        encodedByteLength: body.encodedByteLength,
        createdAt: currentSummary.createdAt,
        savedAt: now,
        lastOpenedAt: currentSummary.lastOpenedAt,
        activityAt: now,
        deletedAt: null,
        origin: currentSummary.origin,
      })
      bodies.put(body)
      metadata.put(summary)
      if (currentSummary.contentSnapshotId !== prepared.contentSnapshotId)
        previews.delete(documentId)
      await done
      this.#publish({
        type: "saved",
        reason: "content_saved",
        documentId,
        recordVersion,
        contentSnapshotId: summary.contentSnapshotId,
        draftSnapshotId: summary.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      return {
        ok: true,
        created: false,
        unchanged: false,
        record: { summary, envelope: prepared.envelope },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async migrateLocalMedia(
    input: MigrateLocalMediaInput,
    signal?: AbortSignal
  ): Promise<MigrateLocalMediaResult> {
    const candidate: unknown = input
    if (!isRecord(candidate)) {
      return this.#invalidMediaMigration(
        "A complete local-media migration request is required."
      )
    }
    const source = parseHeadIdentity(candidate.source)
    const aliases = parseAdmissionMigrationAliases(candidate.aliases)
    const receiptId = candidate.receiptId
    const createdAt = candidate.createdAt
    if (
      !source ||
      source.deletedAt !== null ||
      !aliases ||
      !validRequiredString(receiptId) ||
      receiptId.length > 128 ||
      !validTimestamp(createdAt) ||
      !isRecord(candidate.resultEnvelope)
    ) {
      return this.#invalidMediaMigration(
        "The local-media source head, aliases, receipt, or timestamp is invalid."
      )
    }
    if (signal?.aborted) throw abortReason(signal)
    const prepared = await this.#prepared(
      snapshotForEnvelope(candidate.resultEnvelope as CurrentDraftEnvelope)
    )
    if (!prepared.ok) {
      return this.#invalidMediaMigration(admissionFailure(prepared).message)
    }
    if (prepared.envelope.document.id !== source.documentId) {
      return this.#invalidMediaMigration(
        "The local-media result belongs to a different document."
      )
    }
    if (signal?.aborted) throw abortReason(signal)

    const resultHead: DraftHeadIdentity = {
      documentId: source.documentId,
      recordVersion: source.recordVersion + 1,
      contentSnapshotId: prepared.contentSnapshotId,
      draftSnapshotId: prepared.draftSnapshotId,
      deletedAt: null,
    }
    const managedAssetIds = [
      ...new Set(aliases.map((alias) => alias.managedAssetId)),
    ].sort()
    const managedUses = await Promise.all(
      managedAssetIds.map(async (assetId) => ({
        assetId,
        idempotencyKey: `admission-use:${await sha256Hex(
          `local-media-admission-use\0${receiptId}\0${assetId}`
        )}`,
        requestId: null,
        usedAt: null,
        assetRevision: null,
      }))
    )
    if (signal?.aborted) throw abortReason(signal)

    const baseRead = await this.get(source.documentId)
    if (!baseRead.ok) {
      return baseRead.reason === "corrupt_record"
        ? {
            ok: false,
            reason: "corrupt_record",
            quarantineId: baseRead.quarantineId,
            failure: baseRead.failure,
          }
        : {
            ok: false,
            reason: "storage_unavailable",
            failure: baseRead.failure,
          }
    }
    if (signal?.aborted) throw abortReason(signal)

    const pendingRead =
      await this.getPendingLocalMediaAdmissionReceiptForDocument(
        source.documentId,
        signal
      )
    if (!pendingRead.ok) {
      return pendingRead.reason === "corrupt_record"
        ? {
            ok: false,
            reason: "corrupt_record",
            quarantineId: pendingRead.quarantineId,
            failure: pendingRead.failure,
          }
        : {
            ok: false,
            reason: pendingRead.reason,
            failure: pendingRead.failure,
          }
    }
    if (pendingRead.status === "found") {
      const pending = pendingRead.receipt
      const exactReceipt =
        pending.receiptId === receiptId &&
        storedValueEqual(pending.source, source) &&
        storedValueEqual(pending.result, resultHead) &&
        storedValueEqual(pending.aliases, aliases) &&
        exactMigrationEnvelope(pending.preimage, prepared.envelope, aliases)
      if (!exactReceipt) {
        return pending.receiptId === receiptId
          ? this.#invalidMediaMigration(
              "The admission receipt ID is already bound to another migration."
            )
          : { ok: false, reason: "receipt_pending", receipt: pending }
      }
      if (
        baseRead.status === "found" &&
        headIdentityMatches(baseRead.record.summary, pending.result)
      ) {
        return {
          ok: true,
          status: "replayed",
          record: baseRead.record,
          receipt: pending,
        }
      }
      return { ok: false, reason: "receipt_pending", receipt: pending }
    }

    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      if (signal?.aborted) throw abortReason(signal)
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, PREVIEW_STORE, MEDIA_MIGRATION_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const abort = () => {
        try {
          transaction.abort()
        } catch {
          // A commit that already won cancellation is acknowledged by `done`.
        }
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        const bodies = transaction.objectStore(BODY_STORE)
        const metadata = transaction.objectStore(METADATA_STORE)
        const previews = transaction.objectStore(PREVIEW_STORE)
        const receipts = transaction.objectStore(MEDIA_MIGRATION_STORE)
        const [rawBody, rawSummary, rawReceipt, rawDocumentReceipts] =
          await Promise.all([
            requestResult(bodies.get(source.documentId)),
            requestResult(metadata.get(source.documentId)),
            requestResult(receipts.get(receiptId)),
            requestResult(
              receipts
                .index(MEDIA_MIGRATION_DOCUMENT_CREATED_AT_INDEX)
                .getAll(
                  IDBKeyRange.bound(
                    [source.documentId, ""],
                    [source.documentId, "\uffff"]
                  )
                )
            ),
          ])
        if (rawBody === undefined && rawSummary === undefined) {
          await done
          return this.#invalidMediaMigration(
            "The document no longer exists in Studio storage."
          )
        }
        const body = parseBody(rawBody)
        const summary = parseSummary(rawSummary)
        if (!body || !summary || !pairMatches(body, summary)) {
          await done
          const quarantined = await this.#quarantine(
            source.documentId,
            rawBody,
            rawSummary
          )
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId: quarantined.quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "The stored document is corrupt and media migration was stopped.",
            },
          }
        }

        const existingReceipt =
          rawReceipt === undefined
            ? null
            : parseLocalMediaAdmissionReceipt(rawReceipt)
        if (rawReceipt !== undefined && !existingReceipt) {
          const quarantineId = this.#quarantineMediaReceipt(
            receipts,
            receiptId,
            rawReceipt,
            "The admission receipt could not be decoded."
          )
          await done
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "A media migration receipt was corrupt and was quarantined.",
            },
          }
        }
        if (existingReceipt) {
          const exactReceipt =
            existingReceipt.preimage !== null &&
            storedValueEqual(existingReceipt.source, source) &&
            storedValueEqual(existingReceipt.result, resultHead) &&
            storedValueEqual(existingReceipt.aliases, aliases) &&
            exactMigrationEnvelope(
              existingReceipt.preimage,
              prepared.envelope,
              aliases
            )
          if (!exactReceipt) {
            await done
            return this.#invalidMediaMigration(
              "The admission receipt ID is already bound to another migration."
            )
          }
          if (
            isPendingLocalMediaAdmissionReceipt(existingReceipt) &&
            headIdentityMatches(summary, existingReceipt.result)
          ) {
            await done
            return {
              ok: true,
              status: "replayed",
              record: {
                summary,
                envelope: envelopeForBody(body),
              },
              receipt: existingReceipt,
            }
          }
        }

        for (const raw of rawDocumentReceipts) {
          if (
            isRecord(raw) &&
            raw.kind === "local_media_admission_quarantine"
          ) {
            continue
          }
          const receipt = parseLocalMediaAdmissionReceipt(raw)
          if (!receipt) {
            const originalReceiptId =
              isRecord(raw) && validRequiredString(raw.receiptId)
                ? raw.receiptId
                : `unknown-${this.#createId()}`
            const quarantineId = this.#quarantineMediaReceipt(
              receipts,
              originalReceiptId,
              raw,
              "A document admission receipt could not be decoded."
            )
            await done
            return {
              ok: false,
              reason: "corrupt_record",
              quarantineId,
              failure: {
                kind: "corrupt_record",
                message:
                  "A media migration receipt was corrupt and was quarantined.",
              },
            }
          }
          if (isPendingLocalMediaAdmissionReceipt(receipt)) {
            await done
            return { ok: false, reason: "receipt_pending", receipt }
          }
        }

        if (summary.deletedAt !== null) {
          await done
          return { ok: false, reason: "deleted", current: summary }
        }
        if (!headIdentityMatches(summary, source)) {
          await done
          return { ok: false, reason: "stale_head", current: summary }
        }
        if (
          baseRead.status !== "found" ||
          !headIdentityMatches(baseRead.record.summary, source) ||
          !storedValueEqual(baseRead.record.envelope, envelopeForBody(body))
        ) {
          await done
          return { ok: false, reason: "stale_head", current: summary }
        }
        if (
          !exactMigrationEnvelope(
            envelopeForBody(body),
            prepared.envelope,
            aliases
          )
        ) {
          await done
          return this.#invalidMediaMigration(
            "The media migration result is not an exact identity-only transformation of the source head."
          )
        }

        const now = createdAt
        const nextBody: StoredDraftBody = {
          schemaVersion: 1,
          documentId: source.documentId,
          recordVersion: resultHead.recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          document: prepared.envelope.document,
          sourceContext: prepared.envelope.sourceContext,
          reviewJournal: prepared.envelope.reviewJournal,
          ...(prepared.envelope.quotationRefresh
            ? { quotationRefresh: prepared.envelope.quotationRefresh }
            : {}),
        }
        const nextSummary = summaryFor({
          envelope: prepared.envelope,
          recordVersion: resultHead.recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          createdAt: summary.createdAt,
          savedAt: now,
          lastOpenedAt: summary.lastOpenedAt,
          activityAt: now,
          deletedAt: null,
          origin: summary.origin,
          lastPublished: summary.lastPublished,
        })
        const receipt: LocalMediaAdmissionReceipt = {
          schemaVersion: 1,
          receiptId,
          kind: "local_media_admission",
          documentId: source.documentId,
          createdAt,
          acknowledgedAt: null,
          restoredAt: null,
          source,
          result: resultHead,
          aliases,
          preimage: envelopeForBody(body),
          managedUses,
        }
        const writes: Promise<unknown>[] = []
        const enqueue = <T>(request: IDBRequest<T>) => {
          const write = requestResult(request)
          void write.catch(() => undefined)
          const observedWrite = write.then((value) => value as unknown)
          void observedWrite.catch(() => undefined)
          writes.push(observedWrite)
        }
        enqueue(bodies.put(nextBody))
        enqueue(metadata.put(nextSummary))
        enqueue(previews.delete(source.documentId))
        enqueue(receipts.put(receipt))
        await Promise.all(writes)
        await done
        this.#publish({
          type: "saved",
          reason: "content_saved",
          documentId: source.documentId,
          recordVersion: nextSummary.recordVersion,
          contentSnapshotId: nextSummary.contentSnapshotId,
          draftSnapshotId: nextSummary.draftSnapshotId,
          sessionId: this.#sessionId,
        })
        return {
          ok: true,
          status: "migrated",
          record: { summary: nextSummary, envelope: prepared.envelope },
          receipt,
        }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // A request may already have aborted the transaction.
        }
        await done.catch(() => undefined)
        throw error
      } finally {
        signal?.removeEventListener("abort", abort)
      }
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async getLocalMediaAdmissionReceipt(
    receiptId: string
  ): Promise<LocalMediaAdmissionReceiptReadResult> {
    if (!validRequiredString(receiptId) || receiptId.length > 128) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid admission receipt ID is required.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        MEDIA_MIGRATION_STORE,
        "readwrite"
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
      const raw = await requestResult(store.get(receiptId))
      if (raw === undefined) {
        await done
        return { ok: true, status: "missing" }
      }
      const receipt = parseLocalMediaAdmissionReceipt(raw)
      if (!receipt) {
        const quarantineId = this.#quarantineMediaReceipt(
          store,
          receiptId,
          raw,
          "The admission receipt could not be decoded."
        )
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The media migration receipt was corrupt and was quarantined.",
          },
        }
      }
      await done
      if (!(await receiptPreimageMatchesSource(receipt))) {
        const quarantined = await this.#quarantineStoredMediaReceipt(
          receiptId,
          raw,
          "The admission preimage does not match its stored source identity."
        )
        return {
          ok: false,
          reason: "corrupt_record",
          ...(quarantined.quarantineId
            ? { quarantineId: quarantined.quarantineId }
            : {}),
          failure: {
            kind: "corrupt_record",
            message:
              "The media migration receipt failed its canonical integrity check.",
          },
        }
      }
      return { ok: true, status: "found", receipt }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async getPendingLocalMediaAdmissionReceiptForDocument(
    documentId: string,
    signal?: AbortSignal
  ): Promise<PendingLocalMediaAdmissionReceiptReadResult> {
    if (!validRequiredString(documentId)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid document ID is required to read admission state.",
        },
      }
    }
    if (signal?.aborted) throw abortReason(signal)
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      if (signal?.aborted) throw abortReason(signal)
      const transaction = database.transaction(
        MEDIA_MIGRATION_STORE,
        "readwrite"
      )
      const done = transactionDone(transaction)
      const abort = () => {
        try {
          transaction.abort()
        } catch {
          // A settled transaction already acknowledged the read.
        }
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
        const rawValues = await requestResult(
          store
            .index(MEDIA_MIGRATION_DOCUMENT_CREATED_AT_INDEX)
            .getAll(IDBKeyRange.bound([documentId, ""], [documentId, "\uffff"]))
        )
        const pending: Array<{
          receipt: LocalMediaAdmissionReceipt
          raw: unknown
        }> = []
        for (const raw of rawValues) {
          if (
            isRecord(raw) &&
            raw.kind === "local_media_admission_quarantine"
          ) {
            continue
          }
          const receipt = parseLocalMediaAdmissionReceipt(raw)
          if (!receipt) {
            const originalReceiptId =
              isRecord(raw) && validRequiredString(raw.receiptId)
                ? raw.receiptId
                : `unknown-${this.#createId()}`
            const quarantineId = this.#quarantineMediaReceipt(
              store,
              originalReceiptId,
              raw,
              "A document admission receipt could not be decoded."
            )
            await done
            return {
              ok: false,
              reason: "corrupt_record",
              quarantineId,
              failure: {
                kind: "corrupt_record",
                message:
                  "A media migration receipt was corrupt and was quarantined.",
              },
            }
          }
          if (isPendingLocalMediaAdmissionReceipt(receipt)) {
            pending.push({ receipt, raw })
          }
        }
        await done
        if (pending.length === 0) return { ok: true, status: "missing" }
        if (pending.length > 1) {
          const quarantineId = await this.#recordMediaReceiptInvariant(
            documentId,
            pending.map((candidate) => candidate.raw),
            "The document has more than one pending media recovery receipt."
          )
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "The document has more than one pending media recovery receipt.",
            },
          }
        }
        const found = pending[0]
        if (!(await receiptPreimageMatchesSource(found.receipt))) {
          const quarantined = await this.#quarantineStoredMediaReceipt(
            found.receipt.receiptId,
            found.raw,
            "The admission preimage does not match its stored source identity."
          )
          const quarantineId =
            quarantined.quarantineId ??
            (await this.#recordMediaReceiptInvariant(
              documentId,
              found.raw,
              "The invalid admission receipt changed while it was being quarantined."
            ))
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "The media migration receipt failed its canonical integrity check.",
            },
          }
        }
        return { ok: true, status: "found", receipt: found.receipt }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // A request may already have aborted the transaction.
        }
        await done.catch(() => undefined)
        throw error
      } finally {
        signal?.removeEventListener("abort", abort)
      }
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async markLocalMediaAdmissionManagedUse(
    input: MarkLocalMediaAdmissionManagedUseInput
  ): Promise<MarkLocalMediaAdmissionManagedUseResult> {
    const candidate: unknown = input
    if (
      !isRecord(candidate) ||
      !validRequiredString(candidate.receiptId) ||
      candidate.receiptId.length > 128 ||
      !mediaAssetIdSchema.safeParse(candidate.assetId).success ||
      !mediaIdempotencyKeySchema.safeParse(candidate.idempotencyKey).success ||
      !mediaRequestIdSchema.safeParse(candidate.requestId).success ||
      !validTimestamp(candidate.usedAt) ||
      !validPositiveInteger(candidate.assetRevision)
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A valid receipt, managed asset, idempotency key, and use receipt are required.",
        },
      }
    }
    const receiptId = candidate.receiptId
    const assetId = candidate.assetId as string
    const idempotencyKey = candidate.idempotencyKey as string
    const requestId = candidate.requestId as string
    const usedAt = candidate.usedAt
    const assetRevision = candidate.assetRevision
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        MEDIA_MIGRATION_STORE,
        "readwrite"
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
      const raw = await requestResult(store.get(receiptId))
      if (raw === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const receipt = parseLocalMediaAdmissionReceipt(raw)
      if (!receipt) {
        const quarantineId = this.#quarantineMediaReceipt(
          store,
          receiptId,
          raw,
          "The admission receipt could not be decoded."
        )
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The media migration receipt was corrupt and was quarantined.",
          },
        }
      }
      const useIndex = receipt.managedUses.findIndex(
        (use) => use.assetId === assetId
      )
      if (useIndex < 0) {
        await done
        return { ok: false, reason: "asset_missing" }
      }
      const currentUse = receipt.managedUses[useIndex]
      if (currentUse.idempotencyKey !== idempotencyKey) {
        await done
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "The managed-use idempotency key does not match the admission receipt.",
          },
        }
      }
      const settled: LocalMediaAdmissionManagedUse = {
        assetId,
        idempotencyKey,
        requestId,
        usedAt,
        assetRevision,
      }
      if (currentUse.requestId !== null) {
        await done
        if (storedValueEqual(currentUse, settled)) {
          return { ok: true, status: "replayed", receipt }
        }
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "This managed use was already recorded with another server receipt.",
          },
        }
      }
      const managedUses = [...receipt.managedUses]
      managedUses[useIndex] = settled
      const updated: LocalMediaAdmissionReceiptRecord = {
        ...receipt,
        managedUses,
      }
      await requestResult(store.put(updated))
      await done
      return { ok: true, status: "updated", receipt: updated }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async acknowledgeLocalMediaAdmissionReceipt(
    receiptId: string,
    acknowledgedAt = this.#now()
  ): Promise<AcknowledgeLocalMediaAdmissionReceiptResult> {
    if (
      !validRequiredString(receiptId) ||
      receiptId.length > 128 ||
      !validTimestamp(acknowledgedAt)
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A valid receipt ID and acknowledgement timestamp are required.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, MEDIA_MIGRATION_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
      const raw = await requestResult(store.get(receiptId))
      if (raw === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const receipt = parseLocalMediaAdmissionReceipt(raw)
      if (!receipt) {
        const quarantineId = this.#quarantineMediaReceipt(
          store,
          receiptId,
          raw,
          "The admission receipt could not be decoded."
        )
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The media migration receipt was corrupt and was quarantined.",
          },
        }
      }
      if (receipt.preimage === null) {
        await done
        return { ok: true, status: "replayed", receipt }
      }
      const unsettledManagedUse = receipt.managedUses.find(
        (use) =>
          use.requestId === null ||
          use.usedAt === null ||
          use.assetRevision === null
      )
      if (receipt.restoredAt === null && unsettledManagedUse) {
        await done
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "Finish adding every recovered image to Recent before keeping this version.",
          },
        }
      }
      const [rawBody, rawSummary] = await Promise.all([
        requestResult(
          transaction.objectStore(BODY_STORE).get(receipt.documentId)
        ),
        requestResult(
          transaction.objectStore(METADATA_STORE).get(receipt.documentId)
        ),
      ])
      const body = parseBody(rawBody)
      const summary = parseSummary(rawSummary)
      if (!body || !summary || !pairMatches(body, summary)) {
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message:
              "The saved document head could not be verified before acknowledgement.",
          },
        }
      }
      if (summary.deletedAt !== null) {
        await done
        return { ok: false, reason: "deleted", current: summary, receipt }
      }
      const audit: LocalMediaAdmissionAuditReceipt = {
        ...receipt,
        acknowledgedAt,
        restoredAt: receipt.restoredAt,
        preimage: null,
      }
      await requestResult(store.put(audit))
      const acknowledged = (
        await requestResult(
          store.index(MEDIA_MIGRATION_ACKNOWLEDGED_CREATED_AT_INDEX).getAll()
        )
      )
        .map(parseLocalMediaAdmissionReceipt)
        .filter(
          (candidate): candidate is LocalMediaAdmissionAuditReceipt =>
            candidate?.preimage === null
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      for (const expired of acknowledged.slice(
        0,
        Math.max(
          0,
          acknowledged.length - MAX_ACKNOWLEDGED_MEDIA_MIGRATION_RECEIPTS
        )
      )) {
        await requestResult(store.delete(expired.receiptId))
      }
      await done
      return { ok: true, status: "acknowledged", receipt: audit }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async restoreLocalMediaAdmissionReceipt(
    receiptId: string,
    restoredAt = this.#now(),
    signal?: AbortSignal
  ): Promise<RestoreLocalMediaAdmissionReceiptResult> {
    if (
      !validRequiredString(receiptId) ||
      receiptId.length > 128 ||
      !validTimestamp(restoredAt)
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid receipt ID and restoration timestamp are required.",
        },
      }
    }
    if (signal?.aborted) throw abortReason(signal)
    const receiptRead = await this.getLocalMediaAdmissionReceipt(receiptId)
    if (!receiptRead.ok) {
      return {
        ok: false,
        reason: receiptRead.reason,
        ...(receiptRead.quarantineId
          ? { quarantineId: receiptRead.quarantineId }
          : {}),
        failure: receiptRead.failure,
      }
    }
    if (receiptRead.status === "missing") {
      return { ok: false, reason: "missing" }
    }
    if (receiptRead.receipt.preimage === null) {
      return { ok: false, reason: "preimage_unavailable" }
    }
    const preimageReceipt = receiptRead.receipt
    const prepared = await this.#prepared(
      snapshotForEnvelope(preimageReceipt.preimage)
    )
    if (!prepared.ok) {
      return {
        ok: false,
        reason: "corrupt_record",
        failure: {
          kind: "corrupt_record",
          message: "The admission preimage failed canonical validation.",
        },
      }
    }
    if (signal?.aborted) throw abortReason(signal)
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      if (signal?.aborted) throw abortReason(signal)
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, PREVIEW_STORE, MEDIA_MIGRATION_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const abort = () => {
        try {
          transaction.abort()
        } catch {
          // Commit already won; `done` is the acknowledgement.
        }
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        const receipts = transaction.objectStore(MEDIA_MIGRATION_STORE)
        const rawReceipt = await requestResult(receipts.get(receiptId))
        const receipt = parseLocalMediaAdmissionReceipt(rawReceipt)
        if (!receipt || receipt.preimage === null) {
          await done
          return receipt
            ? { ok: false, reason: "preimage_unavailable" }
            : {
                ok: false,
                reason: "corrupt_record",
                failure: {
                  kind: "corrupt_record",
                  message: "The admission receipt changed or became corrupt.",
                },
              }
        }
        const bodies = transaction.objectStore(BODY_STORE)
        const metadata = transaction.objectStore(METADATA_STORE)
        const [rawBody, rawSummary] = await Promise.all([
          requestResult(bodies.get(receipt.documentId)),
          requestResult(metadata.get(receipt.documentId)),
        ])
        const body = parseBody(rawBody)
        const summary = parseSummary(rawSummary)
        if (!body || !summary || !pairMatches(body, summary)) {
          await done
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message:
                "The saved document head could not be verified before restoration.",
            },
          }
        }
        if (summary.deletedAt !== null) {
          await done
          return { ok: false, reason: "deleted", current: summary, receipt }
        }
        if (receipt.restoredAt !== null) {
          if (
            summary.draftSnapshotId === prepared.draftSnapshotId &&
            summary.contentSnapshotId === prepared.contentSnapshotId &&
            summary.recordVersion > receipt.result.recordVersion
          ) {
            await done
            return {
              ok: true,
              status: "replayed",
              record: { summary, envelope: envelopeForBody(body) },
              receipt,
            }
          }
          await done
          return {
            ok: false,
            reason: "advanced_head",
            current: summary,
            receipt,
          }
        }
        if (!headIdentityMatches(summary, receipt.result)) {
          await done
          return {
            ok: false,
            reason: "advanced_head",
            current: summary,
            receipt,
          }
        }
        const recordVersion = summary.recordVersion + 1
        const nextBody: StoredDraftBody = {
          schemaVersion: 1,
          documentId: receipt.documentId,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          document: prepared.envelope.document,
          sourceContext: prepared.envelope.sourceContext,
          reviewJournal: prepared.envelope.reviewJournal,
          ...(prepared.envelope.quotationRefresh
            ? { quotationRefresh: prepared.envelope.quotationRefresh }
            : {}),
        }
        const nextSummary = summaryFor({
          envelope: prepared.envelope,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          createdAt: summary.createdAt,
          savedAt: restoredAt,
          lastOpenedAt: summary.lastOpenedAt,
          activityAt: restoredAt,
          deletedAt: null,
          origin: summary.origin,
          lastPublished: summary.lastPublished,
        })
        const restoredReceipt: LocalMediaAdmissionReceipt = {
          ...receipt,
          restoredAt,
        }
        const writes: Promise<unknown>[] = []
        const enqueue = <T>(request: IDBRequest<T>) => {
          const write = requestResult(request)
          void write.catch(() => undefined)
          const observedWrite = write.then((value) => value as unknown)
          void observedWrite.catch(() => undefined)
          writes.push(observedWrite)
        }
        enqueue(bodies.put(nextBody))
        enqueue(metadata.put(nextSummary))
        enqueue(
          transaction.objectStore(PREVIEW_STORE).delete(receipt.documentId)
        )
        enqueue(receipts.put(restoredReceipt))
        await Promise.all(writes)
        await done
        this.#publish({
          type: "saved",
          reason: "content_saved",
          documentId: receipt.documentId,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          sessionId: this.#sessionId,
        })
        return {
          ok: true,
          status: "restored",
          record: { summary: nextSummary, envelope: prepared.envelope },
          receipt: restoredReceipt,
        }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // A request may already have aborted the transaction.
        }
        await done.catch(() => undefined)
        throw error
      } finally {
        signal?.removeEventListener("abort", abort)
      }
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  #invalidMediaMigration(message: string): MigrateLocalMediaResult {
    return {
      ok: false,
      reason: "validation_failed",
      failure: { kind: "validation_failed", message },
    }
  }

  async #quarantineStoredMediaReceipt(
    receiptId: string,
    observed: unknown,
    failure: string
  ) {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        MEDIA_MIGRATION_STORE,
        "readwrite"
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
      const current = await requestResult(store.get(receiptId))
      if (!storedValueEqual(current, observed)) {
        await done
        return { status: "superseded" as const, quarantineId: null }
      }
      const quarantineId = this.#quarantineMediaReceipt(
        store,
        receiptId,
        observed,
        failure
      )
      await done
      return { status: "quarantined" as const, quarantineId }
    } finally {
      database?.close()
    }
  }

  async #recordMediaReceiptInvariant(
    documentId: string,
    observed: unknown,
    failure: string
  ) {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        MEDIA_MIGRATION_STORE,
        "readwrite"
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(MEDIA_MIGRATION_STORE)
      const quarantineId = `receipt-quarantine-${this.#createId()}`
      const now = this.#now()
      store.put({
        schemaVersion: 1,
        receiptId: quarantineId,
        kind: "local_media_admission_quarantine",
        documentId,
        createdAt: now,
        acknowledgedAt: now,
        originalReceiptId: "multiple-pending-receipts",
        detectedAt: now,
        failure,
        receipt: observed,
      } satisfies LocalMediaAdmissionReceiptQuarantineRecord)
      await done
      return quarantineId
    } finally {
      database?.close()
    }
  }

  #quarantineMediaReceipt(
    store: IDBObjectStore,
    originalReceiptId: string,
    receipt: unknown,
    failure: string
  ) {
    const quarantineId = `receipt-quarantine-${this.#createId()}`
    store.put({
      schemaVersion: 1,
      receiptId: quarantineId,
      kind: "local_media_admission_quarantine",
      documentId:
        isRecord(receipt) && validRequiredString(receipt.documentId)
          ? receipt.documentId
          : "unknown-document",
      createdAt: this.#now(),
      acknowledgedAt: this.#now(),
      originalReceiptId,
      detectedAt: this.#now(),
      failure,
      receipt,
    } satisfies LocalMediaAdmissionReceiptQuarantineRecord)
    store.delete(originalReceiptId)
    return quarantineId
  }

  async linkPublication(
    input: LinkDraftPublicationInput
  ): Promise<DraftPublicationLinkResult> {
    const candidate: unknown = input
    if (
      !isRecord(candidate) ||
      !validRequiredString(candidate.documentId) ||
      !validPositiveInteger(candidate.recordVersion) ||
      !validSnapshotId(candidate.contentSnapshotId) ||
      !validRequiredString(candidate.templateId) ||
      !validRequiredString(candidate.templateVersionId) ||
      !validPositiveInteger(candidate.templateVersion) ||
      !validTimestamp(candidate.publishedAt)
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A valid document head and publication identity are required to link publication.",
        },
      }
    }

    const documentId = candidate.documentId
    const recordVersion = candidate.recordVersion
    const contentSnapshotId = candidate.contentSnapshotId
    const link: DraftPublicationLink = {
      templateId: candidate.templateId,
      templateVersionId: candidate.templateVersionId,
      templateVersion: candidate.templateVersion,
      contentSnapshotId,
      publishedAt: candidate.publishedAt,
    }
    const baseRead = await this.get(documentId)
    if (!baseRead.ok) {
      if (baseRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: baseRead.quarantineId,
          failure: baseRead.failure,
        }
      }
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: baseRead.failure,
      }
    }
    if (baseRead.status === "missing") return { ok: false, reason: "missing" }
    const verifiedBase = baseRead.record

    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [rawBody, rawSummary] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
      ])
      if (rawBody === undefined && rawSummary === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const body = parseBody(rawBody)
      const summary = parseSummary(rawSummary)
      if (
        !body ||
        !summary ||
        !pairMatches(body, summary) ||
        (summary.recordVersion === verifiedBase.summary.recordVersion &&
          (summary.contentSnapshotId !==
            verifiedBase.summary.contentSnapshotId ||
            summary.draftSnapshotId !== verifiedBase.summary.draftSnapshotId ||
            summary.encodedByteLength !==
              verifiedBase.summary.encodedByteLength))
      ) {
        await done
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary
        )
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message: "The stored document is corrupt and was quarantined.",
          },
        }
      }
      if (summary.deletedAt !== null) {
        await done
        return { ok: false, reason: "deleted", current: summary }
      }
      if (
        summary.recordVersion !== recordVersion ||
        summary.contentSnapshotId !== contentSnapshotId
      ) {
        await done
        return { ok: false, reason: "stale_head", current: summary }
      }

      const linkedSummary: DocumentDraftSummary = {
        ...summary,
        lastPublished: link,
      }
      metadata.put(linkedSummary)
      await done
      this.#publish({
        type: "saved",
        reason: "publication_linked",
        documentId,
        recordVersion: summary.recordVersion,
        contentSnapshotId: summary.contentSnapshotId,
        draftSnapshotId: summary.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      return { ok: true, status: "linked", summary: linkedSummary }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async rename(
    documentId: string,
    expectedVersion: number,
    name: string
  ): Promise<DraftWriteResult> {
    const normalizedName = name.trim()
    if (!normalizedName) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document name is required.",
        },
      }
    }
    const currentRead = await this.get(documentId)
    if (!currentRead.ok) {
      if (currentRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: currentRead.quarantineId,
          failure: currentRead.failure,
        }
      }
      return {
        ok: false,
        reason: currentRead.reason,
        failure: currentRead.failure,
      }
    }
    if (currentRead.status === "missing")
      return { ok: false, reason: "missing" }
    const current = currentRead.record
    return this.save(
      {
        document: {
          ...current.envelope.document,
          name: normalizedName,
          updatedAt: this.#now(),
        },
        sourceContext: current.envelope.sourceContext,
        reviewJournal: current.envelope.reviewJournal,
        ...(current.envelope.quotationRefresh
          ? { quotationRefresh: current.envelope.quotationRefresh }
          : {}),
      },
      expectedVersion,
      current.summary.draftSnapshotId
    )
  }

  async duplicate(
    documentId: string,
    {
      name,
      newDocumentId = `document-${this.#createId()}`,
    }: { name?: string; newDocumentId?: string } = {}
  ): Promise<DraftWriteResult> {
    const currentRead = await this.get(documentId)
    if (!currentRead.ok) {
      if (currentRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: currentRead.quarantineId,
          failure: currentRead.failure,
        }
      }
      return {
        ok: false,
        reason: currentRead.reason,
        failure: currentRead.failure,
      }
    }
    if (currentRead.status === "missing")
      return { ok: false, reason: "missing" }
    const current = currentRead.record
    const now = this.#now()
    return this.create(
      {
        document: {
          ...structuredClone(current.envelope.document),
          id: newDocumentId,
          name: name?.trim() || `${current.envelope.document.name} copy`,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          commandReceipts: undefined,
          sceneTransactionMetadata: undefined,
        },
        sourceContext: structuredClone(current.envelope.sourceContext),
      },
      { kind: "duplicate", sourceDocumentId: documentId }
    )
  }

  async saveConflictAsCopy(
    input: SaveConflictAsCopyInput
  ): Promise<SaveConflictAsCopyResult> {
    const candidate: unknown = input
    if (
      !isRecord(candidate) ||
      !validRequiredString(candidate.conflictId) ||
      !validSnapshotId(candidate.expectedCandidateDraftSnapshotId) ||
      !validRequiredString(candidate.newDocumentId) ||
      (candidate.name !== undefined && typeof candidate.name !== "string") ||
      (candidate.copySnapshot !== undefined &&
        !isRecord(candidate.copySnapshot))
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A conflict ID, candidate snapshot ID, and new document ID are required to save a conflict as a copy.",
        },
      }
    }

    const conflictId = candidate.conflictId
    const expectedCandidateDraftSnapshotId =
      candidate.expectedCandidateDraftSnapshotId
    const newDocumentId = candidate.newDocumentId
    const requestedName = candidate.name
    let preflightConflict: DocumentDraftConflict
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(CONFLICT_STORE)
      const done = transactionDone(transaction)
      const rawConflict = await requestResult(
        transaction.objectStore(CONFLICT_STORE).get(conflictId)
      )
      await done
      if (rawConflict === undefined) {
        return { ok: false, reason: "missing_conflict" }
      }
      const parsedConflict = parseConflict(rawConflict)
      if (!parsedConflict) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored document conflict could not be decoded.",
          },
        }
      }
      preflightConflict = parsedConflict
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
      database = null
    }

    if (
      preflightConflict.candidateDraftSnapshotId !==
      expectedCandidateDraftSnapshotId
    ) {
      return {
        ok: false,
        reason: "stale_conflict",
        current: preflightConflict,
      }
    }
    if (
      preflightConflict.resolvedAt !== null &&
      preflightConflict.resolutionDocumentId === null
    ) {
      return {
        ok: false,
        reason: "resolved_without_copy",
        current: preflightConflict,
      }
    }

    const candidateAdmission = await prepareDraftAdmission(
      preflightConflict.candidate
    )
    if (!candidateAdmission.ok) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: admissionFailure(candidateAdmission),
      }
    }
    if (
      candidateAdmission.contentSnapshotId !==
        preflightConflict.candidateContentSnapshotId ||
      candidateAdmission.draftSnapshotId !==
        preflightConflict.candidateDraftSnapshotId
    ) {
      return {
        ok: false,
        reason: "corrupt_record",
        failure: {
          kind: "corrupt_record",
          message: "The stored conflict candidate failed its integrity check.",
        },
      }
    }

    let now: string | null = null
    let copyAdmission: Extract<
      Awaited<ReturnType<typeof prepareDraftAdmission>>,
      { ok: true }
    > | null = null
    let copyBody: StoredDraftBody | null = null
    let copySummary: DocumentDraftSummary | null = null
    if (preflightConflict.resolvedAt === null) {
      now = this.#now()
      const copySource =
        input.copySnapshot === undefined
          ? snapshotForEnvelope(candidateAdmission.envelope)
          : input.copySnapshot
      const copySourceAdmission = await prepareDraftAdmission(copySource)
      if (!copySourceAdmission.ok) {
        return {
          ok: false,
          reason: "validation_failed",
          failure: admissionFailure(copySourceAdmission),
        }
      }
      if (
        copySourceAdmission.envelope.document.id !==
        preflightConflict.documentId
      ) {
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "The live conflict copy must belong to the conflicted document.",
          },
        }
      }
      if (copySourceAdmission.envelope.quotationRefresh?.pending) {
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "Reject the pending source refresh before saving this conflicted document as a copy. The pending source and decisions were preserved.",
          },
        }
      }
      const copySnapshot: CurrentDraftSnapshot = {
        document: {
          ...structuredClone(copySourceAdmission.envelope.document),
          id: newDocumentId,
          name:
            requestedName?.trim() ||
            `${copySourceAdmission.envelope.document.name} copy`,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          commandReceipts: undefined,
          sceneTransactionMetadata: undefined,
        },
        sourceContext: structuredClone(
          copySourceAdmission.envelope.sourceContext
        ),
        reviewJournal: structuredClone(
          copySourceAdmission.envelope.reviewJournal
        ),
        quotationRefresh: structuredClone(
          copySourceAdmission.envelope.quotationRefresh
        ),
      }
      const preparedCopy = await prepareDraftAdmission(copySnapshot)
      if (!preparedCopy.ok) {
        return {
          ok: false,
          reason: "validation_failed",
          failure: admissionFailure(preparedCopy),
        }
      }
      copyAdmission = preparedCopy
      copyBody = {
        schemaVersion: 1,
        documentId: newDocumentId,
        recordVersion: 1,
        contentSnapshotId: preparedCopy.contentSnapshotId,
        draftSnapshotId: preparedCopy.draftSnapshotId,
        encodedByteLength: preparedCopy.encodedByteLength,
        document: preparedCopy.envelope.document,
        sourceContext: preparedCopy.envelope.sourceContext,
        reviewJournal: preparedCopy.envelope.reviewJournal,
        ...(preparedCopy.envelope.quotationRefresh
          ? { quotationRefresh: preparedCopy.envelope.quotationRefresh }
          : {}),
      }
      copySummary = summaryFor({
        envelope: preparedCopy.envelope,
        recordVersion: 1,
        contentSnapshotId: preparedCopy.contentSnapshotId,
        draftSnapshotId: preparedCopy.draftSnapshotId,
        encodedByteLength: preparedCopy.encodedByteLength,
        createdAt: now,
        savedAt: now,
        lastOpenedAt: now,
        activityAt: now,
        deletedAt: null,
        origin: {
          kind: "duplicate",
          sourceDocumentId: preflightConflict.documentId,
        },
      })
    }

    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, CONFLICT_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const conflicts = transaction.objectStore(CONFLICT_STORE)
      const rawCurrentConflict = await requestResult(conflicts.get(conflictId))
      if (rawCurrentConflict === undefined) {
        await done
        return { ok: false, reason: "missing_conflict" }
      }
      const currentConflict = parseConflict(rawCurrentConflict)
      if (!currentConflict) {
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored document conflict could not be decoded.",
          },
        }
      }
      if (
        currentConflict.candidateDraftSnapshotId !==
        expectedCandidateDraftSnapshotId
      ) {
        await done
        return {
          ok: false,
          reason: "stale_conflict",
          current: currentConflict,
        }
      }
      if (
        currentConflict.resolution === "save_copy" &&
        currentConflict.resolutionDocumentId !== null
      ) {
        const [rawReplayBody, rawReplaySummary] = await Promise.all([
          requestResult(bodies.get(currentConflict.resolutionDocumentId)),
          requestResult(metadata.get(currentConflict.resolutionDocumentId)),
        ])
        await done
        const replayedRecord = await verifiedRecordForPair(
          rawReplayBody,
          rawReplaySummary
        )
        if (!replayedRecord) {
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message:
                "The resolved conflict copy is missing or failed its integrity check.",
            },
          }
        }
        return {
          ok: true,
          status: "replayed",
          record: replayedRecord,
          conflict: currentConflict,
        }
      }
      if (currentConflict.resolvedAt !== null) {
        await done
        return {
          ok: false,
          reason: "resolved_without_copy",
          current: currentConflict,
        }
      }
      if (!now || !copyAdmission || !copyBody || !copySummary) {
        await done
        return {
          ok: false,
          reason: "stale_conflict",
          current: currentConflict,
        }
      }

      const [rawTargetBody, rawTargetSummary] = await Promise.all([
        requestResult(bodies.get(newDocumentId)),
        requestResult(metadata.get(newDocumentId)),
      ])
      if (rawTargetBody !== undefined || rawTargetSummary !== undefined) {
        await done
        const targetRecord = await verifiedRecordForPair(
          rawTargetBody,
          rawTargetSummary
        )
        if (!targetRecord) {
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message:
                "The requested copy target exists but failed its integrity check.",
            },
          }
        }
        return {
          ok: false,
          reason: "target_exists",
          current: targetRecord.summary,
        }
      }

      const resolvedConflict: DocumentDraftConflict = {
        ...currentConflict,
        resolvedAt: now,
        resolution: "save_copy",
        resolutionDocumentId: newDocumentId,
      }
      bodies.put(copyBody)
      metadata.put(copySummary)
      conflicts.put(resolvedConflict)
      await done
      this.#publish({
        type: "saved",
        reason: "content_saved",
        documentId: newDocumentId,
        recordVersion: 1,
        contentSnapshotId: copySummary.contentSnapshotId,
        draftSnapshotId: copySummary.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      this.#publish({
        type: "conflict_resolved",
        conflictId,
        documentId: currentConflict.documentId,
        resolution: "save_copy",
        resolutionDocumentId: newDocumentId,
        sessionId: this.#sessionId,
      })
      return {
        ok: true,
        status: "created",
        record: { summary: copySummary, envelope: copyAdmission.envelope },
        conflict: resolvedConflict,
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async softDelete(
    documentId: string,
    expectedVersion: number
  ): Promise<DraftWriteResult> {
    return this.#setDeleted(documentId, expectedVersion, true)
  }

  async restore(
    documentId: string,
    expectedVersion: number
  ): Promise<DraftWriteResult> {
    return this.#setDeleted(documentId, expectedVersion, false)
  }

  async #setDeleted(
    documentId: string,
    expectedVersion: number,
    deleted: boolean
  ): Promise<DraftWriteResult> {
    if (!validPositiveInteger(expectedVersion)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A positive expected repository version is required to change deletion state.",
        },
      }
    }
    const baseRead = await this.get(documentId)
    if (!baseRead.ok) {
      if (baseRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: baseRead.quarantineId,
          failure: baseRead.failure,
        }
      }
      return {
        ok: false,
        reason: baseRead.reason,
        failure: baseRead.failure,
      }
    }
    if (baseRead.status === "missing") return { ok: false, reason: "missing" }
    const verifiedBase = baseRead.record
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, CONFLICT_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [rawBody, rawSummary] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
      ])
      if (rawBody === undefined && rawSummary === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const body = parseBody(rawBody)
      const current = parseSummary(rawSummary)
      if (
        !body ||
        !current ||
        !pairMatches(body, current) ||
        (current.recordVersion === verifiedBase.summary.recordVersion &&
          current.draftSnapshotId !== verifiedBase.summary.draftSnapshotId)
      ) {
        await done
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary
        )
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message: "The stored document is corrupt and was quarantined.",
          },
        }
      }
      if (current.recordVersion !== expectedVersion) {
        const conflictStore = transaction.objectStore(CONFLICT_STORE)
        const conflict: DocumentDraftConflict = {
          schemaVersion: 1,
          conflictId: await this.#conflictIdForWrite(
            conflictStore,
            `conflict:${documentId}:${this.#sessionId}`
          ),
          documentId,
          sessionId: this.#sessionId,
          expectedRecordVersion: expectedVersion,
          observedRecordVersion: current.recordVersion,
          baseDraftSnapshotId: body.draftSnapshotId,
          observedContentSnapshotId: current.contentSnapshotId,
          observedDraftSnapshotId: current.draftSnapshotId,
          candidateContentSnapshotId: body.contentSnapshotId,
          candidateDraftSnapshotId: body.draftSnapshotId,
          candidate: {
            document: body.document,
            sourceContext: body.sourceContext,
            reviewJournal: body.reviewJournal,
            ...(body.quotationRefresh
              ? { quotationRefresh: body.quotationRefresh }
              : {}),
          },
          reason: current.deletedAt ? "deleted_elsewhere" : "stale_write",
          detectedAt: this.#now(),
          resolvedAt: null,
          resolution: null,
          resolutionDocumentId: null,
        }
        conflictStore.put(conflict)
        await done
        return { ok: false, reason: "conflict", conflict, current }
      }
      if ((current.deletedAt !== null) === deleted) {
        await done
        return {
          ok: true,
          created: false,
          unchanged: true,
          record: { summary: current, envelope: envelopeForBody(body) },
        }
      }
      const now = this.#now()
      const nextBody: StoredDraftBody = {
        ...body,
        recordVersion: body.recordVersion + 1,
      }
      const nextSummary: DocumentDraftSummary = {
        ...current,
        recordVersion: nextBody.recordVersion,
        savedAt: now,
        activityAt: now,
        deletedAt: deleted ? now : null,
      }
      bodies.put(nextBody)
      metadata.put(nextSummary)
      await done
      this.#publish({
        type: deleted ? "deleted" : "restored",
        documentId,
        recordVersion: nextSummary.recordVersion,
        sessionId: this.#sessionId,
      })
      return {
        ok: true,
        created: false,
        unchanged: false,
        record: { summary: nextSummary, envelope: envelopeForBody(nextBody) },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async purge(
    documentId: string,
    expectedVersion: number
  ): Promise<DraftDeleteResult> {
    if (!validPositiveInteger(expectedVersion)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "A positive expected repository version is required to purge a document.",
        },
      }
    }
    const baseRead = await this.get(documentId)
    if (!baseRead.ok) {
      if (baseRead.reason === "corrupt_record") {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: baseRead.quarantineId,
          failure: baseRead.failure,
        }
      }
      return {
        ok: false,
        reason: baseRead.reason,
        failure: baseRead.failure,
      }
    }
    if (baseRead.status === "missing") return { ok: false, reason: "missing" }
    const verifiedBase = baseRead.record
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, PREVIEW_STORE, CONFLICT_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const conflicts = transaction.objectStore(CONFLICT_STORE)
      const conflictIndex = conflicts.index(CONFLICT_DOCUMENT_INDEX)
      const [rawBody, rawSummary, documentConflicts] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
        requestResult(conflictIndex.getAll(documentId)),
      ])
      if (rawBody === undefined && rawSummary === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const body = parseBody(rawBody)
      const current = parseSummary(rawSummary)
      if (
        !body ||
        !current ||
        !pairMatches(body, current) ||
        (current.recordVersion === verifiedBase.summary.recordVersion &&
          current.draftSnapshotId !== verifiedBase.summary.draftSnapshotId)
      ) {
        await done
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary
        )
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message: "The stored document is corrupt and was quarantined.",
          },
        }
      }
      if (current.recordVersion !== expectedVersion) {
        await done
        return { ok: false, reason: "conflict", current }
      }
      bodies.delete(documentId)
      metadata.delete(documentId)
      transaction.objectStore(PREVIEW_STORE).delete(documentId)
      for (const conflict of documentConflicts) {
        if (
          isRecord(conflict) &&
          typeof conflict.conflictId === "string" &&
          conflict.resolvedAt !== null
        ) {
          conflicts.delete(conflict.conflictId)
        }
      }
      await done
      return { ok: true, deletedId: documentId }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async touchOpened(
    documentId: string
  ): Promise<DraftValueResult<DocumentDraftRecord>> {
    const baseRead = await this.get(documentId)
    if (!baseRead.ok) {
      return {
        ok: false,
        reason: baseRead.reason,
        ...(baseRead.reason === "corrupt_record"
          ? { quarantineId: baseRead.quarantineId }
          : {}),
        failure: baseRead.failure,
      }
    }
    if (baseRead.status === "missing") return { ok: false, reason: "missing" }
    const verifiedBase = baseRead.record
    if (verifiedBase.summary.deletedAt !== null) {
      return { ok: false, reason: "missing" }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [METADATA_STORE, BODY_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [rawSummary, rawBody] = await Promise.all([
        requestResult(metadata.get(documentId)),
        requestResult(transaction.objectStore(BODY_STORE).get(documentId)),
      ])
      const summary = parseSummary(rawSummary)
      const body = parseBody(rawBody)
      if (
        !summary ||
        !body ||
        !pairMatches(body, summary) ||
        (summary.recordVersion === verifiedBase.summary.recordVersion &&
          summary.draftSnapshotId !== verifiedBase.summary.draftSnapshotId)
      ) {
        await done
        if (rawSummary !== undefined || rawBody !== undefined) {
          const quarantined = await this.#quarantine(
            documentId,
            rawBody,
            rawSummary
          )
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId: quarantined.quarantineId,
            failure: {
              kind: "corrupt_record",
              message: "The stored document is corrupt and was quarantined.",
            },
          }
        }
        return { ok: false, reason: "missing" }
      }
      if (summary.deletedAt !== null) {
        await done
        return { ok: false, reason: "missing" }
      }
      const now = this.#now()
      const nextSummary = { ...summary, lastOpenedAt: now, activityAt: now }
      metadata.put(nextSummary)
      await done
      this.#publish({
        type: "saved",
        reason: "opened",
        documentId,
        recordVersion: summary.recordVersion,
        contentSnapshotId: summary.contentSnapshotId,
        draftSnapshotId: summary.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      return {
        ok: true,
        value: { summary: nextSummary, envelope: envelopeForBody(body) },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async get(documentId: string): Promise<DocumentDraftReadResult> {
    return this.#get(documentId, 0)
  }

  async #rewriteMigratedDocument({
    documentId,
    observedBody,
    observedSummary,
    body,
    summary,
  }: Readonly<{
    documentId: string
    observedBody: unknown
    observedSummary: unknown
    body: StoredDraftBody
    summary: DocumentDraftSummary
  }>): Promise<"rewritten" | "superseded"> {
    const prepared = await prepareDraftAdmission(
      snapshotForEnvelope(envelopeForBody(body))
    )
    if (!prepared.ok) return "superseded"

    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, PREVIEW_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [currentBody, currentSummary] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadata.get(documentId)),
      ])
      if (
        !storedValueEqual(currentBody, observedBody) ||
        !storedValueEqual(currentSummary, observedSummary)
      ) {
        await done
        return "superseded"
      }

      const migratedAt = this.#now()
      const recordVersion = summary.recordVersion + 1
      const nextBody: StoredDraftBody = {
        schemaVersion: 1,
        documentId,
        recordVersion,
        contentSnapshotId: prepared.contentSnapshotId,
        draftSnapshotId: prepared.draftSnapshotId,
        encodedByteLength: prepared.encodedByteLength,
        document: prepared.envelope.document,
        sourceContext: prepared.envelope.sourceContext,
        reviewJournal: prepared.envelope.reviewJournal,
        ...(prepared.envelope.quotationRefresh
          ? { quotationRefresh: prepared.envelope.quotationRefresh }
          : {}),
      }
      const nextSummary = summaryFor({
        envelope: prepared.envelope,
        recordVersion,
        contentSnapshotId: prepared.contentSnapshotId,
        draftSnapshotId: prepared.draftSnapshotId,
        encodedByteLength: prepared.encodedByteLength,
        createdAt: summary.createdAt,
        savedAt: migratedAt,
        lastOpenedAt: summary.lastOpenedAt,
        activityAt: migratedAt,
        deletedAt: summary.deletedAt,
        origin: summary.origin,
        lastPublished: summary.lastPublished,
      })
      bodies.put(nextBody)
      metadata.put(nextSummary)
      transaction.objectStore(PREVIEW_STORE).delete(documentId)
      await done
      this.#publish({
        type: "saved",
        reason: "content_saved",
        documentId,
        recordVersion,
        contentSnapshotId: prepared.contentSnapshotId,
        draftSnapshotId: prepared.draftSnapshotId,
        sessionId: this.#sessionId,
      })
      return "rewritten"
    } finally {
      database?.close()
    }
  }

  async #restoreMigratableSchemaQuarantine(documentId: string) {
    const quarantines = await this.listQuarantine(documentId)
    if (!quarantines.ok) return false
    for (const quarantine of quarantines.value) {
      if (!quarantine.activeRowsRemoved) continue
      const body = parseBody(quarantine.body)
      const summary = parseSummary(quarantine.metadata)
      if (
        !body ||
        !summary ||
        !pairMatches(body, summary) ||
        !requiresStoredDocumentSchemaRewrite(quarantine.body, body)
      ) {
        continue
      }
      const prepared = await prepareDraftAdmission(
        snapshotForEnvelope(envelopeForBody(body))
      )
      if (!prepared.ok) continue

      let database: IDBDatabase | null = null
      try {
        database = await this.#open()
        const transaction = database.transaction(
          [BODY_STORE, METADATA_STORE, PREVIEW_STORE, QUARANTINE_STORE],
          "readwrite"
        )
        const done = transactionDone(transaction)
        const bodies = transaction.objectStore(BODY_STORE)
        const metadata = transaction.objectStore(METADATA_STORE)
        const [currentBody, currentSummary, currentQuarantine] =
          await Promise.all([
            requestResult(bodies.get(documentId)),
            requestResult(metadata.get(documentId)),
            requestResult(
              transaction
                .objectStore(QUARANTINE_STORE)
                .get(quarantine.quarantineId)
            ),
          ])
        if (
          currentBody !== undefined ||
          currentSummary !== undefined ||
          !storedValueEqual(currentQuarantine, quarantine)
        ) {
          await done
          continue
        }
        const migratedAt = this.#now()
        const recordVersion = summary.recordVersion + 1
        const nextBody: StoredDraftBody = {
          schemaVersion: 1,
          documentId,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          document: prepared.envelope.document,
          sourceContext: prepared.envelope.sourceContext,
          reviewJournal: prepared.envelope.reviewJournal,
          ...(prepared.envelope.quotationRefresh
            ? { quotationRefresh: prepared.envelope.quotationRefresh }
            : {}),
        }
        const nextSummary = summaryFor({
          envelope: prepared.envelope,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          encodedByteLength: prepared.encodedByteLength,
          createdAt: summary.createdAt,
          savedAt: migratedAt,
          lastOpenedAt: summary.lastOpenedAt,
          activityAt: migratedAt,
          deletedAt: summary.deletedAt,
          origin: summary.origin,
          lastPublished: summary.lastPublished,
        })
        bodies.put(nextBody)
        metadata.put(nextSummary)
        transaction.objectStore(PREVIEW_STORE).delete(documentId)
        transaction
          .objectStore(QUARANTINE_STORE)
          .delete(quarantine.quarantineId)
        await done
        this.#publish({
          type: "saved",
          reason: "content_saved",
          documentId,
          recordVersion,
          contentSnapshotId: prepared.contentSnapshotId,
          draftSnapshotId: prepared.draftSnapshotId,
          sessionId: this.#sessionId,
        })
        return true
      } finally {
        database?.close()
      }
    }
    return false
  }

  async #get(
    documentId: string,
    retryCount: number
  ): Promise<DocumentDraftReadResult> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction([BODY_STORE, METADATA_STORE])
      const done = transactionDone(transaction)
      const [rawBody, rawSummary] = await Promise.all([
        requestResult(transaction.objectStore(BODY_STORE).get(documentId)),
        requestResult(transaction.objectStore(METADATA_STORE).get(documentId)),
      ])
      await done
      if (rawBody === undefined && rawSummary === undefined) {
        if (
          retryCount < 2 &&
          (await this.#restoreMigratableSchemaQuarantine(documentId))
        ) {
          return this.#get(documentId, retryCount + 1)
        }
        return { ok: true, status: "missing" }
      }
      const body = parseBody(rawBody)
      const summary = parseSummary(rawSummary)
      if (!body || !summary || !pairMatches(body, summary)) {
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary,
          quarantineFailureFor(documentId, rawBody, rawSummary)
        )
        if (quarantined.status === "superseded" && retryCount < 2) {
          return this.#get(documentId, retryCount + 1)
        }
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The stored document metadata and body failed validation and were quarantined.",
          },
        }
      }
      if (requiresStoredDocumentSchemaRewrite(rawBody, body)) {
        const rewrite = await this.#rewriteMigratedDocument({
          documentId,
          observedBody: rawBody,
          observedSummary: rawSummary,
          body,
          summary,
        })
        if (rewrite === "rewritten" || retryCount < 2) {
          return this.#get(documentId, retryCount + 1)
        }
      }
      const verified = await prepareDraftAdmission(
        snapshotForEnvelope(envelopeForBody(body))
      )
      if (
        !verified.ok ||
        verified.contentSnapshotId !== body.contentSnapshotId ||
        verified.draftSnapshotId !== body.draftSnapshotId ||
        verified.encodedByteLength !== body.encodedByteLength
      ) {
        const quarantined = await this.#quarantine(
          documentId,
          rawBody,
          rawSummary,
          {
            store: "paired-record",
            key: documentId,
            code: verified.ok ? "integrity_mismatch" : "schema_invalid",
            message: verified.ok
              ? "The draft body does not match its stored content snapshot hash."
              : admissionFailure(verified).message,
          }
        )
        if (quarantined.status === "superseded" && retryCount < 2) {
          return this.#get(documentId, retryCount + 1)
        }
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId: quarantined.quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The stored document failed its canonical integrity check.",
          },
        }
      }
      return {
        ok: true,
        status: "found",
        record: { summary, envelope: verified.envelope },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async list(
    options: {
      state?: DraftListState
      query?: string
      limit?: number
      cursor?: string
    } = {}
  ): Promise<DraftListResult> {
    const candidate: unknown = options
    if (!isRecord(candidate)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document list options must be an object.",
        },
      }
    }
    const state = candidate.state === undefined ? "active" : candidate.state
    const query = candidate.query === undefined ? "" : candidate.query
    const limit = candidate.limit === undefined ? 50 : candidate.limit
    const cursor = candidate.cursor
    if (!isDraftListState(state)) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document list state must be active, deleted, or all.",
        },
      }
    }
    if (typeof query !== "string") {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document list query must be a string.",
        },
      }
    }
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "Document list limit must be an integer from 1 to 100.",
        },
      }
    }
    if (cursor !== undefined && typeof cursor !== "string") {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "The document list cursor is invalid.",
        },
      }
    }
    let decodedCursor: ReturnType<typeof parseListCursor>
    try {
      decodedCursor = parseListCursor(cursor)
    } catch (error) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            error instanceof Error
              ? error.message
              : "The document list cursor is invalid.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(METADATA_STORE)
      const done = transactionDone(transaction)
      const range = decodedCursor
        ? IDBKeyRange.upperBound(decodedCursor, true)
        : null
      const normalizedQuery = query.trim().toLocaleLowerCase()
      const scan = await cursorSummaries(
        transaction.objectStore(METADATA_STORE).index(ACTIVITY_AT_INDEX),
        range,
        limit + 1,
        (summary) =>
          (state === "all" ||
            (state === "active" && summary.deletedAt === null) ||
            (state === "deleted" && summary.deletedAt !== null)) &&
          (!normalizedQuery ||
            summary.name.toLocaleLowerCase().includes(normalizedQuery))
      )
      await done
      database.close()
      database = null
      const observations = [...scan.observations]
      if (decodedCursor === null) {
        const sweepObservations = await this.#metadataIntegritySweep()
        for (const observation of sweepObservations) {
          if (
            observations.some(
              (indexedObservation) =>
                storedValueEqual(
                  indexedObservation.primaryKey,
                  observation.primaryKey
                ) &&
                storedValueEqual(
                  indexedObservation.metadata,
                  observation.metadata
                )
            )
          ) {
            continue
          }
          observations.push(observation)
        }
      }
      const recoveryItems: DraftListRecoveryItem[] = []
      for (const observation of observations) {
        const recovery = await this.#recoverListObservation(observation)
        if (recovery) recoveryItems.push(recovery)
      }
      const bounded = scan.values.slice(0, limit)
      return {
        ok: true,
        page: {
          items: bounded,
          nextCursor:
            scan.values.length > limit && bounded.length
              ? listCursor(bounded[bounded.length - 1])
              : null,
          recoveryItems,
        },
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async #metadataIntegritySweep() {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [METADATA_STORE, SETTINGS_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const metadata = transaction.objectStore(METADATA_STORE)
      const settings = transaction.objectStore(SETTINGS_STORE)
      const rawSetting = await requestResult(
        settings.get("integrityScan.draftMetaV1")
      )
      const setting = parseDraftMetadataIntegrityScanSetting(rawSetting)
      const batch = await scanMetadataPrimaryKeys(
        metadata,
        setting?.value.afterPrimaryKey ?? null,
        50
      )
      settings.put({
        key: "integrityScan.draftMetaV1",
        value: {
          afterPrimaryKey: batch.reachedEnd ? null : batch.lastPrimaryKey,
          completedAt: batch.reachedEnd ? this.#now() : null,
        },
      } satisfies DraftMetadataIntegrityScanSetting)
      await done
      return batch.observations
    } finally {
      database?.close()
    }
  }

  async #recoverListObservation(
    observation: DraftListCorruptObservation
  ): Promise<DraftListRecoveryItem | null> {
    if (observation.documentId === null) {
      return {
        documentId: null,
        quarantineId: null,
        status: "retained",
        failure: observation.failure,
      }
    }

    const documentId = observation.documentId
    let database: IDBDatabase | null = null
    let currentBody: unknown
    let currentMetadata: unknown
    try {
      database = await this.#open()
      const transaction = database.transaction([BODY_STORE, METADATA_STORE])
      const done = transactionDone(transaction)
      ;[currentBody, currentMetadata] = await Promise.all([
        requestResult(transaction.objectStore(BODY_STORE).get(documentId)),
        requestResult(transaction.objectStore(METADATA_STORE).get(documentId)),
      ])
      await done
    } catch (error) {
      return {
        documentId,
        quarantineId: null,
        status: "retained",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }

    if (!storedValueEqual(currentMetadata, observation.metadata)) return null
    if (await verifiedRecordForPair(currentBody, currentMetadata)) return null
    const quarantineFailure = quarantineFailureFor(
      documentId,
      currentBody,
      currentMetadata
    )
    try {
      const quarantined = await this.#quarantine(
        documentId,
        currentBody,
        currentMetadata,
        quarantineFailure
      )
      if (quarantined.status === "superseded") return null
      return {
        documentId,
        quarantineId: quarantined.quarantineId,
        status: "quarantined",
        failure: {
          kind: "corrupt_record",
          message: quarantineFailure.message,
        },
      }
    } catch (error) {
      return {
        documentId,
        quarantineId: null,
        status: "retained",
        failure: storageFailure(error),
      }
    }
  }

  async putPreview(
    preview: Omit<DocumentDraftPreview, "schemaVersion" | "createdAt">
  ): Promise<DraftValueResult<DocumentDraftPreview>> {
    if (
      !validPositiveInteger(preview.width) ||
      !validPositiveInteger(preview.height) ||
      !validPositiveInteger(preview.byteLength) ||
      typeof preview.pageId !== "string" ||
      !preview.pageId ||
      typeof preview.rendererRevision !== "string" ||
      !preview.rendererRevision ||
      !isBlob(preview.blob) ||
      preview.blob.size < 1 ||
      preview.blob.type !== "image/png" ||
      preview.blob.size !== preview.byteLength
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "The document preview payload is invalid.",
        },
      }
    }
    const previewRead = await this.get(preview.documentId)
    if (!previewRead.ok) {
      return {
        ok: false,
        reason: previewRead.reason,
        ...(previewRead.reason === "corrupt_record"
          ? { quarantineId: previewRead.quarantineId }
          : {}),
        failure: previewRead.failure,
      }
    }
    if (previewRead.status === "missing")
      return { ok: false, reason: "missing" }
    const verifiedRecord = previewRead.record
    if (verifiedRecord.summary.contentSnapshotId !== preview.contentSnapshotId)
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "The preview does not match the current document content.",
        },
      }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [METADATA_STORE, BODY_STORE, PREVIEW_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const metadata = transaction.objectStore(METADATA_STORE)
      const [rawSummary, rawBody] = await Promise.all([
        requestResult(metadata.get(preview.documentId)),
        requestResult(
          transaction.objectStore(BODY_STORE).get(preview.documentId)
        ),
      ])
      const summary = parseSummary(rawSummary)
      const body = parseBody(rawBody)
      if (
        !summary ||
        !body ||
        !pairMatches(body, summary) ||
        summary.deletedAt !== null ||
        summary.contentSnapshotId !== preview.contentSnapshotId
      ) {
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message:
              "The document changed or became invalid before preview storage.",
          },
        }
      }
      const page = body.document.pages.find(
        (candidate) => candidate.id === preview.pageId
      )
      if (!page) {
        await done
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message: "The preview page does not exist in this document.",
          },
        }
      }
      try {
        assertPageThumbnailSize(page, {
          width: preview.width,
          height: preview.height,
        })
      } catch {
        await done
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "The preview dimensions do not match the page aspect ratio.",
          },
        }
      }
      const storedPreview = {
        schemaVersion: 1,
        ...preview,
        createdAt: this.#now(),
      } satisfies DocumentDraftPreview
      transaction.objectStore(PREVIEW_STORE).put(storedPreview)
      await done
      this.#publish({
        type: "preview",
        documentId: preview.documentId,
        contentSnapshotId: preview.contentSnapshotId,
        sessionId: this.#sessionId,
      })
      return { ok: true, value: storedPreview }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async getPreview(
    documentId: string,
    contentSnapshotId?: string
  ): Promise<DraftValueResult<DocumentDraftPreview>> {
    const previewRead = await this.get(documentId)
    if (!previewRead.ok) {
      return {
        ok: false,
        reason: previewRead.reason,
        ...(previewRead.reason === "corrupt_record"
          ? { quarantineId: previewRead.quarantineId }
          : {}),
        failure: previewRead.failure,
      }
    }
    if (previewRead.status === "missing")
      return { ok: false, reason: "missing" }
    const verifiedRecord = previewRead.record
    if (
      contentSnapshotId !== undefined &&
      verifiedRecord.summary.contentSnapshotId !== contentSnapshotId
    )
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "The requested preview is for an older document snapshot.",
        },
      }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction([
        PREVIEW_STORE,
        METADATA_STORE,
        BODY_STORE,
      ])
      const done = transactionDone(transaction)
      const [value, rawSummary, rawBody] = await Promise.all([
        requestResult(transaction.objectStore(PREVIEW_STORE).get(documentId)),
        requestResult(transaction.objectStore(METADATA_STORE).get(documentId)),
        requestResult(transaction.objectStore(BODY_STORE).get(documentId)),
      ])
      await done
      if (value === undefined) return { ok: false, reason: "missing" }
      const summary = parseSummary(rawSummary)
      const body = parseBody(rawBody)
      if (!isRecord(value) || value.schemaVersion !== 1) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored preview could not be decoded.",
          },
        }
      }
      if (
        !summary ||
        !body ||
        !pairMatches(body, summary) ||
        summary.deletedAt !== null ||
        value.contentSnapshotId !== summary.contentSnapshotId ||
        value.contentSnapshotId !== verifiedRecord.summary.contentSnapshotId ||
        value.documentId !== documentId ||
        (contentSnapshotId !== undefined &&
          value.contentSnapshotId !== contentSnapshotId) ||
        typeof value.pageId !== "string" ||
        !value.pageId ||
        typeof value.rendererRevision !== "string" ||
        !value.rendererRevision ||
        value.mimeType !== "image/png" ||
        !validPositiveInteger(value.width) ||
        !validPositiveInteger(value.height) ||
        !validPositiveInteger(value.byteLength) ||
        !validTimestamp(value.createdAt) ||
        !isBlob(value.blob) ||
        value.blob.type !== "image/png" ||
        value.blob.size !== value.byteLength
      ) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored preview does not match its document.",
          },
        }
      }
      const page = body.document.pages.find(
        (candidate) => candidate.id === value.pageId
      )
      if (!page) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored preview references a missing page.",
          },
        }
      }
      try {
        assertPageThumbnailSize(page, {
          width: value.width,
          height: value.height,
        })
      } catch {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The stored preview dimensions are invalid.",
          },
        }
      }
      return { ok: true, value: value as DocumentDraftPreview }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async getPreviewForSummary(
    identity: DraftPreviewIdentity
  ): Promise<DraftPreviewReadResult> {
    if (!validPreviewIdentity(identity)) {
      return {
        ok: false,
        reason: "corrupt_preview",
        failure: {
          kind: "validation_failed",
          message: "The document preview request identity is invalid.",
        },
      }
    }

    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction([METADATA_STORE, PREVIEW_STORE])
      const done = transactionDone(transaction)
      const [rawSummary, rawPreview] = await Promise.all([
        requestResult(
          transaction.objectStore(METADATA_STORE).get(identity.documentId)
        ),
        requestResult(
          transaction.objectStore(PREVIEW_STORE).get(identity.documentId)
        ),
      ])
      await done

      if (rawSummary === undefined) return { ok: true, status: "not_active" }
      const summary = parseSummary(rawSummary)
      if (!summary || summary.documentId !== identity.documentId) {
        return {
          ok: false,
          reason: "corrupt_preview",
          failure: {
            kind: "corrupt_record",
            message:
              "The document metadata could not be verified for preview loading.",
          },
        }
      }
      if (summary.deletedAt !== null) return { ok: true, status: "not_active" }
      if (
        summary.recordVersion !== identity.recordVersion ||
        summary.contentSnapshotId !== identity.contentSnapshotId ||
        summary.firstPageId !== identity.pageId ||
        summary.firstPageWidth !== identity.pageWidth ||
        summary.firstPageHeight !== identity.pageHeight
      ) {
        return { ok: false, reason: "stale_head", current: summary }
      }
      if (rawPreview === undefined) return { ok: true, status: "missing" }

      const preview = parsePreview(rawPreview)
      if (!preview || preview.documentId !== identity.documentId) {
        return {
          ok: false,
          reason: "corrupt_preview",
          failure: {
            kind: "corrupt_record",
            message: "The stored document preview could not be decoded.",
          },
        }
      }
      if (
        preview.contentSnapshotId !== identity.contentSnapshotId ||
        preview.pageId !== identity.pageId
      ) {
        return { ok: true, status: "stale_preview" }
      }
      try {
        assertPageThumbnailSize(
          { width: identity.pageWidth, height: identity.pageHeight },
          { width: preview.width, height: preview.height }
        )
      } catch {
        return {
          ok: false,
          reason: "corrupt_preview",
          failure: {
            kind: "corrupt_record",
            message: "The stored document preview dimensions are invalid.",
          },
        }
      }
      if (
        preview.rendererRevision !== identity.rendererRevision ||
        preview.width !== identity.width ||
        preview.height !== identity.height
      ) {
        return { ok: true, status: "stale_preview" }
      }
      return { ok: true, status: "ready", preview }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async listQuarantine(
    documentId?: string
  ): Promise<DraftQuarantineResult<readonly DocumentDraftQuarantineRecord[]>> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(QUARANTINE_STORE)
      const done = transactionDone(transaction)
      const store = transaction.objectStore(QUARANTINE_STORE)
      const values = await requestResult(
        documentId
          ? store.index(QUARANTINE_DOCUMENT_INDEX).getAll(documentId)
          : store.getAll()
      )
      await done
      const records: DocumentDraftQuarantineRecord[] = []
      for (const value of values) {
        const record = parseQuarantineRecord(value)
        if (!record) {
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message: "A quarantine record could not be decoded.",
            },
          }
        }
        records.push(record)
      }
      records.sort((left, right) =>
        right.detectedAt.localeCompare(left.detectedAt)
      )
      return { ok: true, value: records }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async getQuarantine(
    quarantineId: string
  ): Promise<DraftQuarantineResult<DocumentDraftQuarantineRecord>> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(QUARANTINE_STORE)
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(QUARANTINE_STORE).get(quarantineId)
      )
      await done
      if (value === undefined) return { ok: false, reason: "missing" }
      const record = parseQuarantineRecord(value)
      if (!record) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "The quarantine record could not be decoded.",
          },
        }
      }
      return { ok: true, value: record }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async deleteQuarantine(
    quarantineId: string
  ): Promise<DraftQuarantineResult<Readonly<{ deletedId: string }>>> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(QUARANTINE_STORE, "readwrite")
      const done = transactionDone(transaction)
      const store = transaction.objectStore(QUARANTINE_STORE)
      const value = await requestResult(store.get(quarantineId))
      if (value === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      store.delete(quarantineId)
      await done
      return { ok: true, value: { deletedId: quarantineId } }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async listConflicts(
    documentId: string
  ): Promise<DraftValueResult<readonly DocumentDraftConflict[]>> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(CONFLICT_STORE)
      const done = transactionDone(transaction)
      const values = await requestResult(
        transaction
          .objectStore(CONFLICT_STORE)
          .index(CONFLICT_DOCUMENT_INDEX)
          .getAll(documentId)
      )
      await done
      const conflicts: DocumentDraftConflict[] = []
      for (const value of values) {
        const conflict = parseConflict(value)
        if (!conflict) {
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message: "A stored document conflict could not be decoded.",
            },
          }
        }
        conflicts.push(conflict)
      }
      const verified = await Promise.all(
        conflicts.map(async (conflict) => {
          const admission = await prepareDraftAdmission(conflict.candidate)
          return admission.ok &&
            admission.contentSnapshotId ===
              conflict.candidateContentSnapshotId &&
            admission.draftSnapshotId === conflict.candidateDraftSnapshotId
            ? conflict
            : null
        })
      )
      if (verified.some((conflict) => conflict === null)) {
        return {
          ok: false,
          reason: "corrupt_record",
          failure: {
            kind: "corrupt_record",
            message: "A stored conflict candidate failed its integrity check.",
          },
        }
      }
      return {
        ok: true,
        value: verified
          .filter(
            (conflict): conflict is DocumentDraftConflict => conflict !== null
          )
          .sort((left, right) =>
            right.detectedAt.localeCompare(left.detectedAt)
          ),
      }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async resolveConflict(
    conflictId: string,
    resolution: "reload_saved" | "save_copy",
    expectedCandidateDraftSnapshotId: string,
    expectedHead: DocumentDraftHeadExpectation
  ): Promise<ResolveDocumentDraftConflictResult> {
    const expectedHeadCandidate: unknown = expectedHead
    const validExpectedHead =
      isRecord(expectedHeadCandidate) &&
      (expectedHeadCandidate.status === "missing" ||
        (expectedHeadCandidate.status === "found" &&
          validPositiveInteger(expectedHeadCandidate.recordVersion) &&
          validSnapshotId(expectedHeadCandidate.contentSnapshotId) &&
          validSnapshotId(expectedHeadCandidate.draftSnapshotId) &&
          (expectedHeadCandidate.deletedAt === null ||
            validTimestamp(expectedHeadCandidate.deletedAt))))
    if (
      !validSnapshotId(expectedCandidateDraftSnapshotId) ||
      !validExpectedHead
    ) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "The expected conflict candidate and exact saved document head are required to resolve a conflict.",
        },
      }
    }
    if (resolution !== "reload_saved") {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message:
            "Save-copy resolution requires the atomic saveConflictAsCopy operation.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [CONFLICT_STORE, BODY_STORE, METADATA_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const conflicts = transaction.objectStore(CONFLICT_STORE)
      const raw = await requestResult(conflicts.get(conflictId))
      const conflict = parseConflict(raw)
      if (!conflict) {
        await done
        return { ok: false, reason: "missing" }
      }
      const [currentBody, currentSummary] = await Promise.all([
        requestResult(
          transaction.objectStore(BODY_STORE).get(conflict.documentId)
        ),
        requestResult(
          transaction.objectStore(METADATA_STORE).get(conflict.documentId)
        ),
      ])
      if (
        conflict.candidateDraftSnapshotId !== expectedCandidateDraftSnapshotId
      ) {
        await done
        return {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "validation_failed",
            message:
              "A newer preserved conflict candidate replaced this recovery action.",
          },
        }
      }
      const currentMissing =
        currentBody === undefined && currentSummary === undefined
      const parsedBody = parseBody(currentBody)
      const parsedSummary = parseSummary(currentSummary)
      const currentPairValid =
        parsedBody !== null &&
        parsedSummary !== null &&
        pairMatches(parsedBody, parsedSummary)
      const headMatches =
        expectedHead.status === "missing"
          ? currentMissing
          : currentPairValid &&
            parsedSummary.recordVersion === expectedHead.recordVersion &&
            parsedSummary.contentSnapshotId ===
              expectedHead.contentSnapshotId &&
            parsedSummary.draftSnapshotId === expectedHead.draftSnapshotId &&
            parsedSummary.deletedAt === expectedHead.deletedAt
      if (!headMatches) {
        await done
        if (currentMissing) {
          return {
            ok: false,
            reason: "head_changed",
            current: { status: "missing" },
          }
        }
        const current = await verifiedRecordForPair(currentBody, currentSummary)
        if (!current) {
          return {
            ok: false,
            reason: "corrupt_record",
            failure: {
              kind: "corrupt_record",
              message:
                "The saved document changed to a head that failed its integrity check.",
            },
          }
        }
        return {
          ok: false,
          reason: "head_changed",
          current: { status: "found", record: current },
        }
      }
      if (conflict.resolvedAt !== null) {
        await done
        if (conflict.resolution !== resolution) {
          return {
            ok: false,
            reason: "validation_failed",
            failure: {
              kind: "validation_failed",
              message:
                "This conflict was already resolved with a different recovery action.",
            },
          }
        }
        return { ok: true, value: conflict }
      }
      const resolved: DocumentDraftConflict = {
        ...conflict,
        resolvedAt: this.#now(),
        resolution,
        resolutionDocumentId: null,
      }
      conflicts.put(resolved)
      await done
      this.#publish({
        type: "conflict_resolved",
        conflictId,
        documentId: resolved.documentId,
        resolution,
        resolutionDocumentId: null,
        sessionId: this.#sessionId,
      })
      return { ok: true, value: resolved }
    } catch (error) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: storageFailure(error),
      }
    } finally {
      database?.close()
    }
  }

  async #quarantine(
    documentId: string,
    observedBody: unknown,
    observedMetadata: unknown,
    failure: DocumentDraftQuarantineRecord["failure"] = {
      ...quarantineFailureFor(documentId, observedBody, observedMetadata),
    }
  ) {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [BODY_STORE, METADATA_STORE, PREVIEW_STORE, QUARANTINE_STORE],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const bodies = transaction.objectStore(BODY_STORE)
      const metadataStore = transaction.objectStore(METADATA_STORE)
      const [currentBody, currentMetadata] = await Promise.all([
        requestResult(bodies.get(documentId)),
        requestResult(metadataStore.get(documentId)),
      ])
      const observationStillCurrent =
        storedValueEqual(currentBody, observedBody) &&
        storedValueEqual(currentMetadata, observedMetadata)
      const quarantineId = `quarantine-${this.#createId()}`
      transaction.objectStore(QUARANTINE_STORE).put({
        schemaVersion: 1,
        quarantineId,
        documentId,
        detectedAt: this.#now(),
        failure,
        body: observedBody,
        metadata: observedMetadata,
        activeRowsRemoved: observationStillCurrent,
      } satisfies DocumentDraftQuarantineRecord)
      if (observationStillCurrent) {
        bodies.delete(documentId)
        metadataStore.delete(documentId)
        transaction.objectStore(PREVIEW_STORE).delete(documentId)
      }
      await done
      if (observationStillCurrent) {
        this.#publish({
          type: "quarantined",
          documentId,
          quarantineId,
          sessionId: this.#sessionId,
        })
      }
      return {
        status: observationStillCurrent
          ? ("quarantined" as const)
          : ("superseded" as const),
        quarantineId,
      }
    } finally {
      database?.close()
    }
  }
}
