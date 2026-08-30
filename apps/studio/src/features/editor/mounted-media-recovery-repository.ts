import { z } from "zod"
import {
  localAssetIdSchema,
  localAssetSourceSchema,
  managedAssetSourceSchema,
  mediaAssetIdSchema,
  mediaIdempotencyKeySchema,
  mediaRequestIdSchema,
} from "@webmcp/document"

export const MOUNTED_MEDIA_RECOVERY_DATABASE_NAME =
  "webmcp-studio-mounted-media-recovery"
export const MOUNTED_MEDIA_RECOVERY_DATABASE_VERSION = 1
export const MOUNTED_MEDIA_RECOVERY_STORE_NAME = "mounted-media-recovery"
export const MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME =
  "mounted-media-recovery-quarantine"

const DOCUMENT_UPDATED_AT_INDEX = "documentIdUpdatedAt"
const STATUS_UPDATED_AT_INDEX = "statusUpdatedAt"
const QUARANTINE_DETECTED_AT_INDEX = "detectedAt"
const MAX_TERMINAL_RECORDS = 64

const boundedIdentitySchema = z.string().min(1).max(256)
const snapshotIdSchema = z.string().regex(/^sha256-[0-9a-f]{64}$/)
const timestampSchema = z.string().datetime()
const errorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*$/)

export const mountedMediaRecoveryStatusSchema = z.enum([
  "intent",
  "history_prepared",
  "document_committed",
  "retry",
  "conflict",
  "abandoned",
  "complete",
])

const recoveryErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().min(1).max(1_000),
    requestId: boundedIdentitySchema.nullable(),
    retryable: z.boolean(),
  })
  .strict()

const durableDraftReceiptSchema = z
  .object({
    documentId: boundedIdentitySchema,
    recordVersion: z.number().int().positive(),
    contentSnapshotId: snapshotIdSchema,
    draftSnapshotId: snapshotIdSchema,
    savedAt: timestampSchema,
  })
  .strict()

const historyCheckpointSchema = z
  .object({
    resultContentSnapshotId: snapshotIdSchema,
    resultHistorySnapshotId: boundedIdentitySchema,
    resultOperationVersion: z.number().int().nonnegative(),
    commitId: boundedIdentitySchema,
    undoable: z.boolean(),
  })
  .strict()

const documentCommitSchema = z
  .object({
    kind: z.enum(["committed", "already_applied", "observed_later"]),
    resultContentSnapshotId: snapshotIdSchema,
    resultHistorySnapshotId: boundedIdentitySchema,
    resultOperationVersion: z.number().int().nonnegative(),
    commitId: boundedIdentitySchema,
    undoable: z.boolean(),
    durable: durableDraftReceiptSchema,
  })
  .strict()

const recentReceiptSchema = z
  .object({
    requestId: mediaRequestIdSchema,
    usedAt: timestampSchema,
    assetRevision: z.number().int().positive(),
  })
  .strict()

export const mountedMediaRecoveryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: boundedIdentitySchema,
    revision: z.number().int().positive(),
    status: mountedMediaRecoveryStatusSchema,
    documentId: boundedIdentitySchema,
    localAssetId: localAssetIdSchema,
    localSource: localAssetSourceSchema,
    managedAssetId: mediaAssetIdSchema,
    managedSource: managedAssetSourceSchema,
    expectedReferenceKeys: z.array(boundedIdentitySchema).min(1).max(10_000),
    preexistingTargetReferenceKeys: z.array(boundedIdentitySchema).max(10_000),
    recentUseIdempotencyKey: mediaIdempotencyKeySchema,
    sourceContentSnapshotId: snapshotIdSchema,
    sourceHistorySnapshotId: boundedIdentitySchema,
    sourceOperationVersion: z.number().int().nonnegative(),
    sourceDraftRecordVersion: z.number().int().positive(),
    sourceDraftSnapshotId: snapshotIdSchema,
    historyCheckpoint: historyCheckpointSchema.nullable(),
    documentCommit: documentCommitSchema.nullable(),
    recentReceipt: recentReceiptSchema.nullable(),
    error: recoveryErrorSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.localSource !== `asset:local/${record.localAssetId}`) {
      context.addIssue({
        code: "custom",
        path: ["localSource"],
        message: "The local source must match the local asset identity.",
      })
    }
    if (record.managedSource !== `asset:managed/${record.managedAssetId}`) {
      context.addIssue({
        code: "custom",
        path: ["managedSource"],
        message: "The managed source must match the managed asset identity.",
      })
    }
    const checkpoint = record.historyCheckpoint
    const checkpointDoesNotMatchSource =
      checkpoint !== null &&
      (checkpoint.resultContentSnapshotId === record.sourceContentSnapshotId ||
        checkpoint.resultHistorySnapshotId === record.sourceHistorySnapshotId ||
        checkpoint.resultOperationVersion !== record.sourceOperationVersion + 1)
    const commit = record.documentCommit
    const commitDoesNotMatchCheckpoint =
      commit !== null &&
      (checkpoint === null ||
        (commit.kind !== "observed_later" &&
          commit.resultContentSnapshotId !==
            checkpoint.resultContentSnapshotId) ||
        commit.resultHistorySnapshotId !== checkpoint.resultHistorySnapshotId ||
        commit.resultOperationVersion !== checkpoint.resultOperationVersion ||
        commit.commitId !== checkpoint.commitId ||
        commit.undoable !== checkpoint.undoable)
    const receiptDoesNotMatchDocument =
      commit !== null &&
      (commit.durable.documentId !== record.documentId ||
        commit.resultContentSnapshotId !== commit.durable.contentSnapshotId ||
        commit.durable.draftSnapshotId === record.sourceDraftSnapshotId)
    const receiptDoesNotMatchExactHead =
      commit !== null &&
      commit.kind !== "observed_later" &&
      (commit.resultOperationVersion !== record.sourceOperationVersion + 1 ||
        commit.durable.recordVersion !== record.sourceDraftRecordVersion + 1)
    const receiptDoesNotMatchLaterHead =
      commit?.kind === "observed_later" &&
      (commit.resultOperationVersion < record.sourceOperationVersion + 1 ||
        commit.durable.recordVersion <= record.sourceDraftRecordVersion + 1)
    if (
      checkpointDoesNotMatchSource ||
      commitDoesNotMatchCheckpoint ||
      receiptDoesNotMatchDocument ||
      receiptDoesNotMatchExactHead ||
      receiptDoesNotMatchLaterHead
    ) {
      context.addIssue({
        code: "custom",
        path: ["documentCommit", "durable"],
        message:
          "The durable recovery receipt must be the exact advanced head for this document and relink result.",
      })
    }
    const canonicalKeys = [...new Set(record.expectedReferenceKeys)].sort()
    if (
      canonicalKeys.length !== record.expectedReferenceKeys.length ||
      canonicalKeys.some(
        (referenceKey, index) =>
          referenceKey !== record.expectedReferenceKeys[index]
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedReferenceKeys"],
        message: "Recovery reference keys must be unique and sorted.",
      })
    }
    const canonicalTargetKeys = [
      ...new Set(record.preexistingTargetReferenceKeys),
    ].sort()
    const canonicalTargetKeySet = new Set(canonicalTargetKeys)
    if (
      canonicalTargetKeys.length !==
        record.preexistingTargetReferenceKeys.length ||
      canonicalTargetKeys.some(
        (referenceKey, index) =>
          referenceKey !== record.preexistingTargetReferenceKeys[index]
      ) ||
      record.expectedReferenceKeys.some((referenceKey) =>
        canonicalTargetKeySet.has(referenceKey)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["preexistingTargetReferenceKeys"],
        message:
          "Preexisting target reference keys must be unique, sorted, and disjoint from source references.",
      })
    }
    const hasCommit = record.documentCommit !== null
    const hasRecent = record.recentReceipt !== null
    const hasError = record.error !== null
    if (
      (record.status === "intent" &&
        (checkpoint !== null || hasCommit || hasRecent || hasError)) ||
      (record.status === "history_prepared" &&
        (checkpoint === null || hasCommit || hasRecent || hasError)) ||
      (record.status === "document_committed" &&
        (checkpoint === null || !hasCommit || hasRecent || hasError)) ||
      (record.status === "complete" &&
        (checkpoint === null || !hasCommit || !hasRecent || hasError)) ||
      ((record.status === "retry" ||
        record.status === "conflict" ||
        record.status === "abandoned") &&
        (hasRecent || !hasError)) ||
      (hasCommit && checkpoint === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "The mounted recovery status and receipts are incoherent.",
      })
    }
    if (
      record.status === "retry" &&
      record.error !== null &&
      !record.error.retryable
    ) {
      context.addIssue({
        code: "custom",
        path: ["error", "retryable"],
        message: "A retry checkpoint requires a retryable error.",
      })
    }
    if (
      (record.status === "conflict" || record.status === "abandoned") &&
      record.error !== null &&
      record.error.retryable
    ) {
      context.addIssue({
        code: "custom",
        path: ["error", "retryable"],
        message: "A deterministic conflict cannot be marked retryable.",
      })
    }
    if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Recovery updates cannot predate their durable intent.",
      })
    }
  })

export type MountedMediaRecoveryStatus = z.infer<
  typeof mountedMediaRecoveryStatusSchema
>
export type MountedMediaRecoveryRecord = z.infer<
  typeof mountedMediaRecoveryRecordSchema
>
export type MountedMediaRecoveryDocumentCommit = z.infer<
  typeof documentCommitSchema
>
export type MountedMediaRecoveryHistoryCheckpoint = z.infer<
  typeof historyCheckpointSchema
>
export type MountedMediaRecoveryRecentReceipt = z.infer<
  typeof recentReceiptSchema
>
export type MountedMediaRecoveryError = z.infer<typeof recoveryErrorSchema>

export type MountedMediaRecoverySourceAnchor = Readonly<{
  contentSnapshotId: string
  historySnapshotId: string
  operationVersion: number
  draftRecordVersion: number
  draftSnapshotId: string
}>

export type CreateMountedMediaRecoveryIntentInput = Readonly<{
  operationId: string
  documentId: string
  localAssetId: string
  localSource: `asset:local/${string}`
  managedAssetId: string
  managedSource: `asset:managed/${string}`
  expectedReferenceKeys: readonly string[]
  preexistingTargetReferenceKeys: readonly string[]
  sourceContentSnapshotId: string
  sourceHistorySnapshotId: string
  sourceOperationVersion: number
  sourceDraftRecordVersion: number
  sourceDraftSnapshotId: string
  createdAt: string
}>

export type RecordMountedMediaRecoveryDocumentCommitInput = Readonly<{
  operationId: string
  expectedRevision: number
  documentCommit: MountedMediaRecoveryDocumentCommit
  updatedAt: string
}>

export type RecordMountedMediaRecoveryHistoryPreparedInput = Readonly<{
  operationId: string
  expectedRevision: number
  historyCheckpoint: MountedMediaRecoveryHistoryCheckpoint
  updatedAt: string
}>

export type CompleteMountedMediaRecoveryRecentInput = Readonly<{
  operationId: string
  expectedRevision: number
  idempotencyKey: string
  requestId: string
  usedAt: string
  assetRevision: number
  updatedAt: string
}>

export type MarkMountedMediaRecoveryFailureInput = Readonly<{
  operationId: string
  expectedRevision: number
  code: string
  message: string
  requestId: string | null
  updatedAt: string
}>

export type AbandonMountedMediaRecoveryIntentInput = Readonly<{
  operationId: string
  expectedRevision: number
  source: MountedMediaRecoverySourceAnchor
  code: string
  message: string
  requestId: string | null
  updatedAt: string
}>

export type MountedMediaRecoveryFailure = Readonly<{
  kind: "validation_failed" | "corrupt_record" | "storage_unavailable"
  message: string
}>

type MutationResult =
  | Readonly<{
      ok: true
      status: "created" | "updated" | "replayed" | "adopted"
      record: MountedMediaRecoveryRecord
    }>
  | Readonly<{
      ok: false
      reason: "missing" | "invalid_transition"
    }>
  | Readonly<{
      ok: false
      reason: "operation_conflict" | "cas_conflict"
      current: MountedMediaRecoveryRecord
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      quarantineId?: string
      failure: MountedMediaRecoveryFailure
    }>

export type CreateMountedMediaRecoveryIntentResult = MutationResult
export type MountedMediaRecoveryMutationResult = MutationResult

export type MountedMediaRecoveryReadResult =
  | Readonly<{
      ok: true
      status: "found"
      record: MountedMediaRecoveryRecord
    }>
  | Readonly<{ ok: true; status: "missing" }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      quarantineId?: string
      failure: MountedMediaRecoveryFailure
    }>

export type MountedMediaRecoveryListResult =
  | Readonly<{
      ok: true
      records: readonly MountedMediaRecoveryRecord[]
    }>
  | Readonly<{
      ok: false
      reason: "validation_failed" | "corrupt_record" | "storage_unavailable"
      quarantineIds?: readonly string[]
      failure: MountedMediaRecoveryFailure
    }>

export type MountedMediaRecoveryRepositoryOptions = Readonly<{
  databaseName?: string
  indexedDB?: IDBFactory
  now?: () => string
  createId?: () => string
}>

const createIntentInputSchema = z
  .object({
    operationId: boundedIdentitySchema,
    documentId: boundedIdentitySchema,
    localAssetId: localAssetIdSchema,
    localSource: localAssetSourceSchema,
    managedAssetId: mediaAssetIdSchema,
    managedSource: managedAssetSourceSchema,
    expectedReferenceKeys: z.array(boundedIdentitySchema).min(1).max(10_000),
    preexistingTargetReferenceKeys: z.array(boundedIdentitySchema).max(10_000),
    sourceContentSnapshotId: snapshotIdSchema,
    sourceHistorySnapshotId: boundedIdentitySchema,
    sourceOperationVersion: z.number().int().nonnegative(),
    sourceDraftRecordVersion: z.number().int().positive(),
    sourceDraftSnapshotId: snapshotIdSchema,
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.localSource !== `asset:local/${input.localAssetId}`) {
      context.addIssue({
        code: "custom",
        path: ["localSource"],
        message: "The local source must match the local asset identity.",
      })
    }
    if (input.managedSource !== `asset:managed/${input.managedAssetId}`) {
      context.addIssue({
        code: "custom",
        path: ["managedSource"],
        message: "The managed source must match the managed asset identity.",
      })
    }
    const canonical = [...new Set(input.expectedReferenceKeys)].sort()
    if (
      canonical.length !== input.expectedReferenceKeys.length ||
      canonical.some(
        (referenceKey, index) =>
          referenceKey !== input.expectedReferenceKeys[index]
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedReferenceKeys"],
        message: "Recovery reference keys must be unique and sorted.",
      })
    }
    const canonicalTargetKeys = [
      ...new Set(input.preexistingTargetReferenceKeys),
    ].sort()
    const canonicalTargetKeySet = new Set(canonicalTargetKeys)
    if (
      canonicalTargetKeys.length !==
        input.preexistingTargetReferenceKeys.length ||
      canonicalTargetKeys.some(
        (referenceKey, index) =>
          referenceKey !== input.preexistingTargetReferenceKeys[index]
      ) ||
      input.expectedReferenceKeys.some((referenceKey) =>
        canonicalTargetKeySet.has(referenceKey)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["preexistingTargetReferenceKeys"],
        message:
          "Preexisting target reference keys must be unique, sorted, and disjoint from source references.",
      })
    }
  })

const documentCommitInputSchema = z
  .object({
    operationId: boundedIdentitySchema,
    expectedRevision: z.number().int().positive(),
    documentCommit: documentCommitSchema,
    updatedAt: timestampSchema,
  })
  .strict()

const historyPreparedInputSchema = z
  .object({
    operationId: boundedIdentitySchema,
    expectedRevision: z.number().int().positive(),
    historyCheckpoint: historyCheckpointSchema,
    updatedAt: timestampSchema,
  })
  .strict()

const recentCompleteInputSchema = z
  .object({
    operationId: boundedIdentitySchema,
    expectedRevision: z.number().int().positive(),
    idempotencyKey: mediaIdempotencyKeySchema,
    requestId: mediaRequestIdSchema,
    usedAt: timestampSchema,
    assetRevision: z.number().int().positive(),
    updatedAt: timestampSchema,
  })
  .strict()

const failureInputSchema = z
  .object({
    operationId: boundedIdentitySchema,
    expectedRevision: z.number().int().positive(),
    code: errorCodeSchema,
    message: z.string().min(1).max(1_000),
    requestId: boundedIdentitySchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict()

const sourceAnchorSchema = z
  .object({
    contentSnapshotId: snapshotIdSchema,
    historySnapshotId: boundedIdentitySchema,
    operationVersion: z.number().int().nonnegative(),
    draftRecordVersion: z.number().int().positive(),
    draftSnapshotId: snapshotIdSchema,
  })
  .strict()

const abandonInputSchema = failureInputSchema
  .extend({ source: sourceAnchorSchema })
  .strict()

type QuarantineRecord = Readonly<{
  schemaVersion: 1
  quarantineId: string
  operationId: string
  documentId: string
  detectedAt: string
  failure: string
  record: unknown
}>

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Mounted recovery request failed"))
  })

const transactionDone = (transaction: IDBTransaction) => {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => undefined
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Mounted recovery transaction was aborted")
      )
  })
  void completion.catch(() => undefined)
  return completion
}

const storedValueEqual = (left: unknown, right: unknown) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
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

const latestTimestamp = (...values: readonly string[]) =>
  values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest
  )

const storageFailure = (error: unknown): MountedMediaRecoveryFailure => ({
  kind: "storage_unavailable",
  message:
    error instanceof Error && error.message
      ? `Mounted media recovery storage is unavailable. ${error.message}`
      : "Mounted media recovery storage is unavailable.",
})

const validationFailure = (message: string): MutationResult => ({
  ok: false,
  reason: "validation_failed",
  failure: { kind: "validation_failed", message },
})

const intentIdentity = (record: MountedMediaRecoveryRecord) => ({
  operationId: record.operationId,
  documentId: record.documentId,
  localAssetId: record.localAssetId,
  localSource: record.localSource,
  managedAssetId: record.managedAssetId,
  managedSource: record.managedSource,
  expectedReferenceKeys: record.expectedReferenceKeys,
  preexistingTargetReferenceKeys: record.preexistingTargetReferenceKeys,
  sourceContentSnapshotId: record.sourceContentSnapshotId,
  sourceHistorySnapshotId: record.sourceHistorySnapshotId,
  sourceOperationVersion: record.sourceOperationVersion,
  sourceDraftRecordVersion: record.sourceDraftRecordVersion,
  sourceDraftSnapshotId: record.sourceDraftSnapshotId,
})

const sourceAnchorFor = (
  record: MountedMediaRecoveryRecord
): MountedMediaRecoverySourceAnchor => ({
  contentSnapshotId: record.sourceContentSnapshotId,
  historySnapshotId: record.sourceHistorySnapshotId,
  operationVersion: record.sourceOperationVersion,
  draftRecordVersion: record.sourceDraftRecordVersion,
  draftSnapshotId: record.sourceDraftSnapshotId,
})

export const isEquivalentMountedMediaRecoveryDocumentCommit = (
  current: MountedMediaRecoveryDocumentCommit,
  candidate: MountedMediaRecoveryDocumentCommit
) =>
  current.kind === candidate.kind &&
  current.undoable === candidate.undoable &&
  current.commitId === candidate.commitId &&
  current.resultHistorySnapshotId === candidate.resultHistorySnapshotId &&
  current.resultContentSnapshotId === candidate.resultContentSnapshotId &&
  current.resultOperationVersion === candidate.resultOperationVersion &&
  current.durable.documentId === candidate.durable.documentId &&
  current.durable.recordVersion === candidate.durable.recordVersion &&
  current.durable.contentSnapshotId === candidate.durable.contentSnapshotId &&
  current.durable.draftSnapshotId === candidate.durable.draftSnapshotId

const documentCommitMatchesHistoryCheckpoint = (
  commit: MountedMediaRecoveryDocumentCommit,
  checkpoint: MountedMediaRecoveryHistoryCheckpoint | null
) =>
  checkpoint !== null &&
  (commit.kind === "observed_later" ||
    commit.resultContentSnapshotId === checkpoint.resultContentSnapshotId) &&
  commit.resultHistorySnapshotId === checkpoint.resultHistorySnapshotId &&
  commit.resultOperationVersion === checkpoint.resultOperationVersion &&
  commit.commitId === checkpoint.commitId &&
  commit.undoable === checkpoint.undoable

export class MountedMediaRecoveryRepository {
  readonly #databaseName: string
  readonly #indexedDB: IDBFactory
  readonly #now: () => string
  readonly #createId: () => string

  constructor(options: MountedMediaRecoveryRepositoryOptions = {}) {
    this.#databaseName =
      options.databaseName ?? MOUNTED_MEDIA_RECOVERY_DATABASE_NAME
    this.#indexedDB = options.indexedDB ?? globalThis.indexedDB
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#createId = options.createId ?? (() => crypto.randomUUID())
  }

  async #open() {
    const request = this.#indexedDB.open(
      this.#databaseName,
      MOUNTED_MEDIA_RECOVERY_DATABASE_VERSION
    )
    request.onupgradeneeded = () => {
      const database = request.result
      const records = database.objectStoreNames.contains(
        MOUNTED_MEDIA_RECOVERY_STORE_NAME
      )
        ? request.transaction?.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME)
        : database.createObjectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME, {
            keyPath: "operationId",
          })
      const quarantine = database.objectStoreNames.contains(
        MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
      )
        ? request.transaction?.objectStore(
            MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
          )
        : database.createObjectStore(
            MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
            { keyPath: "quarantineId" }
          )
      if (records && !records.indexNames.contains(DOCUMENT_UPDATED_AT_INDEX)) {
        records.createIndex(DOCUMENT_UPDATED_AT_INDEX, [
          "documentId",
          "updatedAt",
        ])
      }
      if (records && !records.indexNames.contains(STATUS_UPDATED_AT_INDEX)) {
        records.createIndex(STATUS_UPDATED_AT_INDEX, ["status", "updatedAt"])
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
        reject(
          request.error ?? new Error("Mounted recovery database failed to open")
        )
      request.onblocked = () => {
        blocked = true
        reject(
          new Error(
            "Mounted recovery storage is blocked by another Studio tab. Close the other tab and retry."
          )
        )
      }
    })
  }

  #quarantine(
    records: IDBObjectStore,
    quarantine: IDBObjectStore,
    operationId: string,
    raw: unknown,
    failure: string
  ) {
    const quarantineId = `mounted-recovery-quarantine-${this.#createId()}`
    const record: QuarantineRecord = {
      schemaVersion: 1,
      quarantineId,
      operationId,
      documentId:
        raw &&
        typeof raw === "object" &&
        "documentId" in raw &&
        typeof raw.documentId === "string"
          ? raw.documentId
          : "unknown-document",
      detectedAt: this.#now(),
      failure,
      record: raw,
    }
    quarantine.put(record)
    records.delete(operationId)
    return quarantineId
  }

  async createIntent(
    input: CreateMountedMediaRecoveryIntentInput
  ): Promise<CreateMountedMediaRecoveryIntentResult> {
    const parsed = createIntentInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure(
        "A canonical mounted-media recovery intent is required."
      )
    }
    const recentUseIdempotencyKey = mediaIdempotencyKeySchema.parse(
      `mounted-recovery-use:${await sha256Hex(
        `mounted-media-recovery-use\0${parsed.data.operationId}\0${parsed.data.managedAssetId}`
      )}`
    )
    const candidate: MountedMediaRecoveryRecord = {
      schemaVersion: 1,
      ...parsed.data,
      revision: 1,
      status: "intent",
      recentUseIdempotencyKey,
      historyCheckpoint: null,
      documentCommit: null,
      recentReceipt: null,
      error: null,
      updatedAt: parsed.data.createdAt,
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [
          MOUNTED_MEDIA_RECOVERY_STORE_NAME,
          MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
        ],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const records = transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME)
      const quarantine = transaction.objectStore(
        MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
      )
      const raw = await requestResult(records.get(candidate.operationId))
      if (raw !== undefined) {
        const current = mountedMediaRecoveryRecordSchema.safeParse(raw)
        if (!current.success) {
          const quarantineId = this.#quarantine(
            records,
            quarantine,
            candidate.operationId,
            raw,
            "The mounted-media recovery operation could not be decoded."
          )
          await done
          return {
            ok: false,
            reason: "corrupt_record",
            quarantineId,
            failure: {
              kind: "corrupt_record",
              message:
                "The mounted-media recovery operation was corrupt and was quarantined.",
            },
          }
        }
        await done
        return storedValueEqual(
          intentIdentity(current.data),
          intentIdentity(candidate)
        )
          ? { ok: true, status: "replayed", record: current.data }
          : {
              ok: false,
              reason: "operation_conflict",
              current: current.data,
            }
      }
      await requestResult(records.add(candidate))
      await done
      return { ok: true, status: "created", record: candidate }
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

  async recordHistoryPrepared(
    input: RecordMountedMediaRecoveryHistoryPreparedInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    const parsed = historyPreparedInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure(
        "A valid mounted recovery history checkpoint is required."
      )
    }
    return this.#mutate(parsed.data.operationId, (current) => {
      if (
        storedValueEqual(
          current.historyCheckpoint,
          parsed.data.historyCheckpoint
        )
      ) {
        return current.revision === parsed.data.expectedRevision
          ? { kind: "replay" }
          : { kind: "adopt" }
      }
      if (current.historyCheckpoint !== null) {
        return { kind: "operation_conflict" }
      }
      if (current.revision !== parsed.data.expectedRevision) {
        return { kind: "cas_conflict" }
      }
      if (
        current.documentCommit !== null ||
        current.status === "complete" ||
        current.status === "conflict" ||
        current.status === "abandoned"
      ) {
        return { kind: "invalid_transition" }
      }
      return {
        kind: "update",
        record: {
          ...current,
          revision: current.revision + 1,
          status: "history_prepared",
          historyCheckpoint: parsed.data.historyCheckpoint,
          error: null,
          updatedAt: parsed.data.updatedAt,
        },
      }
    })
  }

  async recordDocumentCommitted(
    input: RecordMountedMediaRecoveryDocumentCommitInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    const parsed = documentCommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure("A valid durable document receipt is required.")
    }
    return this.#mutate(parsed.data.operationId, (current) => {
      if (
        !documentCommitMatchesHistoryCheckpoint(
          parsed.data.documentCommit,
          current.historyCheckpoint
        )
      ) {
        return { kind: "operation_conflict" }
      }
      if (
        storedValueEqual(current.documentCommit, parsed.data.documentCommit)
      ) {
        return { kind: "replay" }
      }
      if (
        current.documentCommit !== null &&
        (current.status === "document_committed" ||
          current.status === "retry" ||
          current.status === "complete") &&
        isEquivalentMountedMediaRecoveryDocumentCommit(
          current.documentCommit,
          parsed.data.documentCommit
        )
      ) {
        return { kind: "adopt" }
      }
      if (current.revision !== parsed.data.expectedRevision) {
        return { kind: "cas_conflict" }
      }
      if (
        current.documentCommit !== null ||
        current.status === "complete" ||
        current.status === "conflict" ||
        current.status === "abandoned"
      ) {
        return { kind: "invalid_transition" }
      }
      return {
        kind: "update",
        record: {
          ...current,
          revision: current.revision + 1,
          status: "document_committed",
          documentCommit: parsed.data.documentCommit,
          error: null,
          updatedAt: parsed.data.updatedAt,
        },
      }
    })
  }

  async recordRecentComplete(
    input: CompleteMountedMediaRecoveryRecentInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    const parsed = recentCompleteInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure("A valid managed Recent receipt is required.")
    }
    const recentReceipt: MountedMediaRecoveryRecentReceipt = {
      requestId: parsed.data.requestId,
      usedAt: parsed.data.usedAt,
      assetRevision: parsed.data.assetRevision,
    }
    return this.#mutate(
      parsed.data.operationId,
      (current) => {
        if (
          current.recentUseIdempotencyKey === parsed.data.idempotencyKey &&
          storedValueEqual(current.recentReceipt, recentReceipt)
        ) {
          return { kind: "replay" }
        }
        if (current.recentUseIdempotencyKey !== parsed.data.idempotencyKey) {
          return { kind: "operation_conflict" }
        }
        if (current.revision !== parsed.data.expectedRevision) {
          return { kind: "cas_conflict" }
        }
        if (
          current.documentCommit === null ||
          current.status === "intent" ||
          current.status === "conflict" ||
          current.status === "complete"
        ) {
          return { kind: "invalid_transition" }
        }
        return {
          kind: "update",
          record: {
            ...current,
            revision: current.revision + 1,
            status: "complete",
            recentReceipt,
            error: null,
            updatedAt: latestTimestamp(
              current.updatedAt,
              parsed.data.updatedAt,
              this.#now()
            ),
          },
        }
      },
      true
    )
  }

  async markRetry(
    input: MarkMountedMediaRecoveryFailureInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    return this.#markFailure(input, true)
  }

  async markConflict(
    input: MarkMountedMediaRecoveryFailureInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    return this.#markFailure(input, false)
  }

  async abandonPrecommitIntent(
    input: AbandonMountedMediaRecoveryIntentInput
  ): Promise<MountedMediaRecoveryMutationResult> {
    const parsed = abandonInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure(
        "A valid source-anchored abandonment disposition is required."
      )
    }
    const failure: MountedMediaRecoveryError = {
      code: parsed.data.code,
      message: parsed.data.message,
      requestId: parsed.data.requestId,
      retryable: false,
    }
    return this.#mutate(
      parsed.data.operationId,
      (current) => {
        if (!storedValueEqual(sourceAnchorFor(current), parsed.data.source)) {
          return { kind: "operation_conflict" }
        }
        if (
          current.status === "abandoned" &&
          storedValueEqual(current.error, failure)
        ) {
          return { kind: "replay" }
        }
        if (current.revision !== parsed.data.expectedRevision) {
          return { kind: "cas_conflict" }
        }
        if (
          current.documentCommit !== null ||
          (current.status !== "intent" &&
            current.status !== "history_prepared" &&
            current.status !== "retry")
        ) {
          return { kind: "invalid_transition" }
        }
        return {
          kind: "update",
          record: {
            ...current,
            revision: current.revision + 1,
            status: "abandoned",
            recentReceipt: null,
            error: failure,
            updatedAt: parsed.data.updatedAt,
          },
        }
      },
      true
    )
  }

  async #markFailure(
    input: MarkMountedMediaRecoveryFailureInput,
    retryable: boolean
  ): Promise<MountedMediaRecoveryMutationResult> {
    const parsed = failureInputSchema.safeParse(input)
    if (!parsed.success) {
      return validationFailure("A valid mounted recovery failure is required.")
    }
    const failure: MountedMediaRecoveryError = {
      code: parsed.data.code,
      message: parsed.data.message,
      requestId: parsed.data.requestId,
      retryable,
    }
    return this.#mutate(
      parsed.data.operationId,
      (current) => {
        const status = retryable ? "retry" : "conflict"
        if (
          current.status === status &&
          storedValueEqual(current.error, failure)
        ) {
          return { kind: "replay" }
        }
        if (current.revision !== parsed.data.expectedRevision) {
          return { kind: "cas_conflict" }
        }
        if (
          current.status === "complete" ||
          current.status === "conflict" ||
          current.status === "abandoned"
        ) {
          return { kind: "invalid_transition" }
        }
        return {
          kind: "update",
          record: {
            ...current,
            revision: current.revision + 1,
            status,
            recentReceipt: null,
            error: failure,
            updatedAt: parsed.data.updatedAt,
          },
        }
      },
      !retryable
    )
  }

  async #mutate(
    operationId: string,
    decide: (
      current: MountedMediaRecoveryRecord
    ) =>
      | Readonly<{ kind: "replay" }>
      | Readonly<{ kind: "adopt" }>
      | Readonly<{ kind: "cas_conflict" }>
      | Readonly<{ kind: "operation_conflict" }>
      | Readonly<{ kind: "invalid_transition" }>
      | Readonly<{ kind: "update"; record: MountedMediaRecoveryRecord }>,
    pruneTerminal = false
  ): Promise<MountedMediaRecoveryMutationResult> {
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [
          MOUNTED_MEDIA_RECOVERY_STORE_NAME,
          MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
        ],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const records = transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME)
      const quarantine = transaction.objectStore(
        MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
      )
      const raw = await requestResult(records.get(operationId))
      if (raw === undefined) {
        await done
        return { ok: false, reason: "missing" }
      }
      const parsed = mountedMediaRecoveryRecordSchema.safeParse(raw)
      if (!parsed.success) {
        const quarantineId = this.#quarantine(
          records,
          quarantine,
          operationId,
          raw,
          "The mounted-media recovery operation could not be decoded."
        )
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The mounted-media recovery operation was corrupt and was quarantined.",
          },
        }
      }
      const decision = decide(parsed.data)
      if (decision.kind === "replay") {
        await done
        return { ok: true, status: "replayed", record: parsed.data }
      }
      if (decision.kind === "adopt") {
        await done
        return { ok: true, status: "adopted", record: parsed.data }
      }
      if (decision.kind === "cas_conflict") {
        await done
        return { ok: false, reason: "cas_conflict", current: parsed.data }
      }
      if (decision.kind === "operation_conflict") {
        await done
        return {
          ok: false,
          reason: "operation_conflict",
          current: parsed.data,
        }
      }
      if (decision.kind === "invalid_transition") {
        await done
        return { ok: false, reason: "invalid_transition" }
      }
      if (
        Date.parse(decision.record.updatedAt) <
        Date.parse(parsed.data.updatedAt)
      ) {
        transaction.abort()
        await done.catch(() => undefined)
        return validationFailure(
          "A mounted recovery transition cannot move its durable clock backward."
        )
      }
      const verified = mountedMediaRecoveryRecordSchema.safeParse(
        decision.record
      )
      if (!verified.success) {
        transaction.abort()
        await done.catch(() => undefined)
        return validationFailure(
          "The mounted recovery transition would create an invalid record."
        )
      }
      await requestResult(records.put(verified.data))
      if (pruneTerminal) {
        const terminal: MountedMediaRecoveryRecord[] = []
        for (const terminalStatus of [
          "complete",
          "conflict",
          "abandoned",
        ] as const) {
          const rawTerminal = await requestResult(
            records
              .index(STATUS_UPDATED_AT_INDEX)
              .getAll(
                IDBKeyRange.bound(
                  [terminalStatus, ""],
                  [terminalStatus, "\uffff"]
                )
              )
          )
          for (const rawRecord of rawTerminal) {
            const parsedRecord =
              mountedMediaRecoveryRecordSchema.safeParse(rawRecord)
            if (parsedRecord.success) {
              terminal.push(parsedRecord.data)
              continue
            }
            const corruptOperationId =
              rawRecord &&
              typeof rawRecord === "object" &&
              "operationId" in rawRecord &&
              typeof rawRecord.operationId === "string"
                ? rawRecord.operationId
                : `unknown-${this.#createId()}`
            this.#quarantine(
              records,
              quarantine,
              corruptOperationId,
              rawRecord,
              "A terminal mounted-media recovery operation could not be decoded."
            )
          }
        }
        terminal.sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) ||
            left.operationId.localeCompare(right.operationId)
        )
        for (const expired of terminal.slice(
          0,
          Math.max(0, terminal.length - MAX_TERMINAL_RECORDS)
        )) {
          await requestResult(records.delete(expired.operationId))
        }
      }
      await done
      return { ok: true, status: "updated", record: verified.data }
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

  async get(operationId: string): Promise<MountedMediaRecoveryReadResult> {
    if (!boundedIdentitySchema.safeParse(operationId).success) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid mounted recovery operation ID is required.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [
          MOUNTED_MEDIA_RECOVERY_STORE_NAME,
          MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
        ],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const records = transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME)
      const raw = await requestResult(records.get(operationId))
      if (raw === undefined) {
        await done
        return { ok: true, status: "missing" }
      }
      const parsed = mountedMediaRecoveryRecordSchema.safeParse(raw)
      if (!parsed.success) {
        const quarantineId = this.#quarantine(
          records,
          transaction.objectStore(MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME),
          operationId,
          raw,
          "The mounted-media recovery operation could not be decoded."
        )
        await done
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineId,
          failure: {
            kind: "corrupt_record",
            message:
              "The mounted-media recovery operation was corrupt and was quarantined.",
          },
        }
      }
      await done
      return { ok: true, status: "found", record: parsed.data }
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

  async listPendingByDocument(
    documentId: string
  ): Promise<MountedMediaRecoveryListResult> {
    if (!boundedIdentitySchema.safeParse(documentId).success) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "A valid document ID is required.",
        },
      }
    }
    let database: IDBDatabase | null = null
    try {
      database = await this.#open()
      const transaction = database.transaction(
        [
          MOUNTED_MEDIA_RECOVERY_STORE_NAME,
          MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME,
        ],
        "readwrite"
      )
      const done = transactionDone(transaction)
      const records = transaction.objectStore(MOUNTED_MEDIA_RECOVERY_STORE_NAME)
      const quarantine = transaction.objectStore(
        MOUNTED_MEDIA_RECOVERY_QUARANTINE_STORE_NAME
      )
      const rawValues = await requestResult(
        records
          .index(DOCUMENT_UPDATED_AT_INDEX)
          .getAll(IDBKeyRange.bound([documentId, ""], [documentId, "\uffff"]))
      )
      const pending: MountedMediaRecoveryRecord[] = []
      const quarantineIds: string[] = []
      for (const raw of rawValues) {
        const parsed = mountedMediaRecoveryRecordSchema.safeParse(raw)
        if (!parsed.success) {
          const operationId =
            raw &&
            typeof raw === "object" &&
            "operationId" in raw &&
            typeof raw.operationId === "string"
              ? raw.operationId
              : `unknown-${this.#createId()}`
          quarantineIds.push(
            this.#quarantine(
              records,
              quarantine,
              operationId,
              raw,
              "A mounted-media recovery operation could not be decoded."
            )
          )
          continue
        }
        if (
          parsed.data.status !== "complete" &&
          parsed.data.status !== "conflict" &&
          parsed.data.status !== "abandoned"
        ) {
          pending.push(parsed.data)
        }
      }
      await done
      if (quarantineIds.length > 0) {
        return {
          ok: false,
          reason: "corrupt_record",
          quarantineIds,
          failure: {
            kind: "corrupt_record",
            message:
              "One or more mounted-media recovery operations were corrupt and were quarantined.",
          },
        }
      }
      pending.sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.operationId.localeCompare(right.operationId)
      )
      return { ok: true, records: pending }
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
}
