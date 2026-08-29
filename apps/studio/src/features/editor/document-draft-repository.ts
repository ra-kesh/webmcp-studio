import { assertPageThumbnailSize } from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { validateCurrentDraftSnapshot } from "./current-draft-repository"
import type {
  CurrentDraftEnvelope,
  CurrentDraftSnapshot,
} from "./current-draft-repository"
import { prepareDraftAdmission } from "./draft-admission"

const DATABASE_NAME = "webmcp-studio-documents"
const DATABASE_VERSION = 1
const BODY_STORE = "draft-body"
const METADATA_STORE = "draft-meta"
const PREVIEW_STORE = "draft-previews"
const QUARANTINE_STORE = "draft-quarantine"
const CONFLICT_STORE = "draft-conflicts"
const SETTINGS_STORE = "repository-settings"
const ACTIVITY_AT_INDEX = "activityAt"
const SAVED_AT_INDEX = "savedAt"
const LAST_OPENED_AT_INDEX = "lastOpenedAt"
const DELETED_AT_INDEX = "deletedAt"
const CONFLICT_DOCUMENT_INDEX = "documentId"
const CONFLICT_DETECTED_AT_INDEX = "detectedAt"
const QUARANTINE_DOCUMENT_INDEX = "documentId"
const QUARANTINE_DETECTED_AT_INDEX = "detectedAt"

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
  }
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
})

const snapshotForEnvelope = (
  envelope: CurrentDraftEnvelope
): CurrentDraftSnapshot => ({
  document: envelope.document,
  sourceContext: envelope.sourceContext,
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
        },
        sourceContext: structuredClone(
          copySourceAdmission.envelope.sourceContext
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
