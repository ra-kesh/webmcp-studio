import {
  bootstrapCurrentDraft,
  CURRENT_DRAFT_STORAGE_KEY,
  LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
  LEGACY_DOCUMENT_STORAGE_KEY,
  LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
  LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
} from "./current-draft-repository"
import type {
  CurrentDraftBootstrapResult,
  CurrentDraftSnapshot,
  DraftStorage,
  DraftStorageFailure,
  DraftStorageProvider,
} from "./current-draft-repository"
import { prepareDraftAdmission } from "./draft-admission"
import type { DraftAdmissionFailure } from "./draft-admission"
import { DRAFT_RECOVERY_STORAGE_KEY } from "./draft-recovery"
import type {
  DocumentDraftConflict,
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftMigrationResult,
  DraftMigrationCleanupResult,
  DraftRepositoryFailure,
} from "./document-draft-repository"

const migratedStorageKeys = [
  CURRENT_DRAFT_STORAGE_KEY,
  LEGACY_DOCUMENT_STORAGE_KEY,
  LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
  LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
  LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
] as const

type RepositoryOpenResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      reason: "storage_unavailable" | "blocked"
      failure: DraftRepositoryFailure
    }>

export type CurrentDraftMigrationRepository = Readonly<{
  open: () => Promise<RepositoryOpenResult>
  migrateCurrentDraft: (
    snapshot: CurrentDraftSnapshot,
    options: Readonly<{
      completedAt: string
      pendingCleanupKeys: readonly string[]
    }>
  ) => Promise<DraftMigrationResult>
  updateCurrentDraftMigrationCleanup: (
    documentId: string,
    draftSnapshotId: string,
    pendingCleanupKeys: readonly string[]
  ) => Promise<DraftMigrationCleanupResult>
  get: (documentId: string) => Promise<DocumentDraftReadResult>
}>

export type LegacyDraftCleanupFailure = Readonly<{
  key: (typeof migratedStorageKeys)[number] | "repository-settings"
  message: string
}>

export type CurrentDraftRepositoryMigrationResult =
  | Readonly<{ status: "empty" }>
  | Readonly<{
      status: "migrated"
      disposition: "created" | "identical" | "already_migrated"
      source: "envelope" | "legacy"
      record: DocumentDraftRecord
      bootstrapWarnings: readonly DraftStorageFailure[]
      cleanupFailures: readonly LegacyDraftCleanupFailure[]
    }>
  | Readonly<{
      status: "collision"
      conflict: DocumentDraftConflict
      current: DocumentDraftSummary
    }>
  | Extract<CurrentDraftBootstrapResult, { status: "recovery_required" }>
  | Readonly<{
      status: "blocked" | "repository_unavailable"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      status: "legacy_storage_unavailable"
      failure: DraftStorageFailure
      recoverableDraft?: Extract<
        CurrentDraftBootstrapResult,
        { status: "storage_unavailable" }
      >["recoverableDraft"]
    }>
  | Readonly<{
      status: "validation_failed"
      failure: DraftAdmissionFailure
    }>
  | Readonly<{
      status: "migration_failed"
      failure: DraftRepositoryFailure
    }>
  | Readonly<{
      status: "verification_failed"
      message: string
    }>

class BufferedMigrationStorage implements DraftStorage {
  readonly #source: DraftStorage
  readonly #overlay = new Map<string, string | null>()

  constructor(source: DraftStorage) {
    this.#source = source
  }

  getItem(key: string) {
    if (this.#overlay.has(key)) return this.#overlay.get(key) ?? null
    return this.#source.getItem(key)
  }

  setItem(key: string, value: string) {
    // Recovery copies must remain durable. Envelope rewrites are held until
    // IndexedDB migration and public read-back both succeed.
    if (key === DRAFT_RECOVERY_STORAGE_KEY) {
      this.#source.setItem(key, value)
      return
    }
    this.#overlay.set(key, value)
  }

  removeItem(key: string) {
    this.#overlay.set(key, null)
  }
}

const browserStorage: DraftStorageProvider = () => globalThis.localStorage

function cleanupFailure(key: LegacyDraftCleanupFailure["key"], error: unknown) {
  const detail =
    error instanceof Error && error.message.trim()
      ? ` ${error.message.trim()}`
      : ""
  return {
    key,
    message:
      key === "repository-settings"
        ? `Studio removed a legacy key but could not advance its cleanup journal.${detail}`
        : `Studio migrated the draft but could not remove legacy key ${key}.${detail}`,
  }
}

function exactReadBack(
  record: DocumentDraftRecord,
  expected: {
    documentId: string
    contentSnapshotId: string
    draftSnapshotId: string
  }
): boolean {
  return Boolean(
    record.summary.documentId === expected.documentId &&
    record.envelope.document.id === expected.documentId &&
    record.summary.contentSnapshotId === expected.contentSnapshotId &&
    record.summary.draftSnapshotId === expected.draftSnapshotId
  )
}

function cleanupOrder(source: "envelope" | "legacy") {
  const identityKey =
    source === "envelope"
      ? CURRENT_DRAFT_STORAGE_KEY
      : LEGACY_DOCUMENT_STORAGE_KEY
  return [
    ...migratedStorageKeys.filter((key) => key !== identityKey),
    identityKey,
  ] as const
}

/**
 * Moves START-01's single atomic browser draft into the multi-document
 * repository without allowing legacy cleanup to become the commit point.
 */
export async function migrateCurrentDraftToRepository({
  repository,
  getStorage = browserStorage,
  now = () => new Date().toISOString(),
}: Readonly<{
  repository: CurrentDraftMigrationRepository
  getStorage?: DraftStorageProvider
  now?: () => string
}>): Promise<CurrentDraftRepositoryMigrationResult> {
  const opened = await repository.open()
  if (!opened.ok) {
    return {
      status:
        opened.reason === "blocked" ? "blocked" : "repository_unavailable",
      failure: opened.failure,
    }
  }

  let sourceStorage: DraftStorage | null = null
  const acquireSourceStorage = () => {
    sourceStorage ??= getStorage()
    return sourceStorage
  }
  const bootstrap = bootstrapCurrentDraft({
    getStorage: () => new BufferedMigrationStorage(acquireSourceStorage()),
    now,
  })

  if (bootstrap.status === "empty") return bootstrap
  if (bootstrap.status === "recovery_required") return bootstrap
  if (bootstrap.status === "storage_unavailable") {
    return {
      status: "legacy_storage_unavailable",
      failure: bootstrap.failure,
      ...(bootstrap.recoverableDraft
        ? { recoverableDraft: bootstrap.recoverableDraft }
        : {}),
    }
  }

  const prepared = await prepareDraftAdmission({
    document: bootstrap.envelope.document,
    sourceContext: bootstrap.envelope.sourceContext,
  })
  if (!prepared.ok) {
    return { status: "validation_failed", failure: prepared }
  }

  const completedAt = now()
  const migrated = await repository.migrateCurrentDraft(
    {
      document: prepared.envelope.document,
      sourceContext: prepared.envelope.sourceContext,
    },
    {
      completedAt,
      pendingCleanupKeys: cleanupOrder(bootstrap.source),
    }
  )
  if (!migrated.ok) {
    if (migrated.reason === "collision") {
      return {
        status: "collision",
        conflict: migrated.conflict,
        current: migrated.current,
      }
    }
    return { status: "migration_failed", failure: migrated.failure }
  }

  const readBack = await repository.get(prepared.envelope.document.id)
  if (!readBack.ok || readBack.status !== "found") {
    return {
      status: "verification_failed",
      message:
        "The migrated draft could not be verified exactly. Legacy browser bytes were preserved.",
    }
  }
  const record = readBack.record
  const exact = exactReadBack(record, {
    documentId: prepared.envelope.document.id,
    contentSnapshotId: prepared.contentSnapshotId,
    draftSnapshotId: prepared.draftSnapshotId,
  })
  const healthyPreviouslyMigrated =
    migrated.status === "already_migrated" &&
    record.summary.documentId === prepared.envelope.document.id &&
    record.envelope.document.id === prepared.envelope.document.id
  if (!exact && !healthyPreviouslyMigrated) {
    return {
      status: "verification_failed",
      message:
        "The migrated draft could not be verified exactly. Legacy browser bytes were preserved.",
    }
  }

  const cleanupFailures: LegacyDraftCleanupFailure[] = []
  const cleanupStorage = acquireSourceStorage()
  const orderedCleanupKeys = cleanupOrder(bootstrap.source)
  for (const [index, key] of orderedCleanupKeys.entries()) {
    try {
      cleanupStorage.removeItem(key)
    } catch (error) {
      cleanupFailures.push(cleanupFailure(key, error))
      // Preserve the source identity key until every dependent context key has
      // been removed, so a later run can reconstruct and resume cleanup.
      break
    }
    const journal = await repository.updateCurrentDraftMigrationCleanup(
      prepared.envelope.document.id,
      prepared.draftSnapshotId,
      orderedCleanupKeys.slice(index + 1)
    )
    if (!journal.ok) {
      cleanupFailures.push(
        cleanupFailure(
          "repository-settings",
          "failure" in journal
            ? new Error(journal.failure.message)
            : new Error(`Migration cleanup marker ${journal.reason}.`)
        )
      )
      break
    }
  }

  return {
    status: "migrated",
    disposition: migrated.status,
    source: bootstrap.source,
    record,
    bootstrapWarnings: bootstrap.warnings,
    cleanupFailures,
  }
}
