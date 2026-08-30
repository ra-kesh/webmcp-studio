import { z } from "zod"
import {
  localAssetIdSchema,
  mediaAssetIdSchema,
  mediaIdempotencyKeySchema,
} from "@webmcp/document"
import {
  LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
  openLocalAssetDatabase,
} from "./local-asset-database"

const sha256Schema = z.string().regex(/^sha256-[0-9a-f]{64}$/)
const contentSha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const boundedIdentitySchema = z.string().min(1).max(256)
const nullableManagedAssetIdSchema = mediaAssetIdSchema.nullable()
const nullableContentSha256Schema = contentSha256Schema.nullable()
const BROADCAST_CHANNEL_NAME = "webmcp-studio-asset-promotion-journal-v1"
const MINIMUM_LEASE_MILLISECONDS = 1_000
const MAXIMUM_LEASE_MILLISECONDS = 5 * 60_000

const leaseSchema = z
  .object({
    ownerId: boundedIdentitySchema,
    token: boundedIdentitySchema,
    expiresAt: z.string().datetime(),
  })
  .strict()

export const localAssetPromotionStateSchema = z.enum([
  "queued",
  "hashing",
  "reconciling",
  "uploading",
  "status_unknown",
  "mapped",
  "relinking",
  "marking_used",
  "complete",
  "cancelled",
  "failed",
  "conflict",
])

export const localAssetPromotionJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    localAssetId: localAssetIdSchema,
    revision: z.number().int().positive(),
    contentSha256: nullableContentSha256Schema,
    idempotencyKey: mediaIdempotencyKeySchema,
    recentUseIdempotencyKey: mediaIdempotencyKeySchema,
    attempt: z.number().int().nonnegative(),
    state: localAssetPromotionStateSchema,
    managedAssetId: nullableManagedAssetIdSchema,
    managedContentSha256: nullableContentSha256Schema,
    managedStatus: z.enum(["ready", "archived"]).nullable(),
    managedAssetRevision: z.number().int().positive().nullable(),
    sourceDocumentId: boundedIdentitySchema,
    sourceContentSnapshotId: sha256Schema,
    sourceHistorySnapshotId: boundedIdentitySchema,
    sourceOperationVersion: z.number().int().nonnegative(),
    sourceDraftRecordVersion: z.number().int().positive(),
    sourceDraftSnapshotId: sha256Schema,
    sourceLocalAssetRevision: z.number().int().positive(),
    expectedReferenceKeys: z.array(boundedIdentitySchema).min(1).max(10_000),
    mappingRequestId: boundedIdentitySchema.nullable(),
    relinkResultContentSnapshotId: sha256Schema.nullable(),
    relinkResultHistorySnapshotId: boundedIdentitySchema.nullable(),
    relinkResultOperationVersion: z.number().int().nonnegative().nullable(),
    relinkResultKind: z.enum(["committed", "already_applied"]).nullable(),
    relinkResultDraftContentSnapshotId: sha256Schema.nullable(),
    relinkResultDraftSnapshotId: sha256Schema.nullable(),
    relinkResultDraftRecordVersion: z.number().int().positive().nullable(),
    relinkCommitId: boundedIdentitySchema.nullable(),
    relinkUndoable: z.boolean().nullable(),
    recentUseUsedAt: z.string().datetime().nullable(),
    recentUseAssetRevision: z.number().int().positive().nullable(),
    recentUseRequestId: boundedIdentitySchema.nullable(),
    errorCode: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9_]*$/)
      .nullable(),
    errorRequestId: boundedIdentitySchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lease: leaseSchema.nullable(),
  })
  .strict()
  .superRefine((journal, context) => {
    const canonicalKeys = [...new Set(journal.expectedReferenceKeys)].sort()
    if (
      canonicalKeys.length !== journal.expectedReferenceKeys.length ||
      canonicalKeys.some(
        (referenceKey, index) =>
          referenceKey !== journal.expectedReferenceKeys[index]
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedReferenceKeys"],
        message: "Promotion reference keys must be unique and sorted.",
      })
    }
    if (
      (journal.managedAssetId === null) !==
        (journal.managedContentSha256 === null) ||
      (journal.managedAssetId === null) !== (journal.managedStatus === null) ||
      (journal.managedAssetId === null) !==
        (journal.managedAssetRevision === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["managedAssetId"],
        message:
          "Managed promotion identity, content hash, and status must be checkpointed together.",
      })
    }
    const contentRequiredStates: readonly LocalAssetPromotionState[] = [
      "reconciling",
      "uploading",
      "status_unknown",
      "conflict",
      "mapped",
      "relinking",
      "marking_used",
      "complete",
    ]
    if (
      contentRequiredStates.includes(journal.state) &&
      journal.contentSha256 === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["contentSha256"],
        message: "This promotion state requires the verified local byte hash.",
      })
    }
    const mappingStates: readonly LocalAssetPromotionState[] = [
      "conflict",
      "mapped",
      "relinking",
      "marking_used",
      "complete",
    ]
    const hasManagedMapping = journal.managedAssetId !== null
    if (mappingStates.includes(journal.state) !== hasManagedMapping) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message:
          "Managed mapping details are valid only after exact reconciliation.",
      })
    }
    if (hasManagedMapping && journal.mappingRequestId === null) {
      context.addIssue({
        code: "custom",
        path: ["mappingRequestId"],
        message: "A committed mapping requires its server request identity.",
      })
    }
    if (
      journal.state === "conflict" &&
      journal.contentSha256 !== null &&
      journal.managedContentSha256 === journal.contentSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["managedContentSha256"],
        message: "An alias conflict requires two different content hashes.",
      })
    }
    if (
      ["mapped", "relinking", "marking_used", "complete"].includes(
        journal.state
      ) &&
      journal.contentSha256 !== null &&
      journal.managedContentSha256 !== journal.contentSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["managedContentSha256"],
        message: "A local alias cannot map to different image bytes.",
      })
    }
    const relinkCommitFields = [
      journal.relinkResultContentSnapshotId,
      journal.relinkResultHistorySnapshotId,
      journal.relinkResultOperationVersion,
      journal.relinkResultKind,
      journal.relinkUndoable,
    ]
    const hasAnyRelinkCommitField = relinkCommitFields.some(
      (value) => value !== null
    )
    const hasEveryRelinkCommitField = relinkCommitFields.every(
      (value) => value !== null
    )
    if (hasAnyRelinkCommitField && !hasEveryRelinkCommitField) {
      context.addIssue({
        code: "custom",
        path: ["relinkResultKind"],
        message:
          "A relink commit requires its content, history, and Undo identities.",
      })
    }
    if (
      hasEveryRelinkCommitField &&
      journal.state !== "relinking" &&
      journal.state !== "marking_used" &&
      journal.state !== "complete"
    ) {
      context.addIssue({
        code: "custom",
        path: ["relinkCommitId"],
        message:
          "A relink commit checkpoint is valid only while relinking or complete.",
      })
    }
    if (
      hasEveryRelinkCommitField &&
      journal.relinkResultKind === "committed" &&
      journal.relinkCommitId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["relinkCommitId"],
        message: "A committed relink requires its history commit identity.",
      })
    }
    if (
      hasEveryRelinkCommitField &&
      journal.relinkResultKind === "already_applied" &&
      (journal.relinkCommitId !== null || journal.relinkUndoable !== false)
    ) {
      context.addIssue({
        code: "custom",
        path: ["relinkResultKind"],
        message:
          "An already-applied relink has no new history commit or Undo promise.",
      })
    }
    if (!hasEveryRelinkCommitField && journal.relinkCommitId !== null) {
      context.addIssue({
        code: "custom",
        path: ["relinkCommitId"],
        message: "A relink commit identity requires a complete relink result.",
      })
    }
    const durableDraftFields = [
      journal.relinkResultDraftContentSnapshotId,
      journal.relinkResultDraftSnapshotId,
      journal.relinkResultDraftRecordVersion,
    ]
    const hasAnyDurableDraftField = durableDraftFields.some(
      (value) => value !== null
    )
    const hasEveryDurableDraftField = durableDraftFields.every(
      (value) => value !== null
    )
    if (hasAnyDurableDraftField && !hasEveryDurableDraftField) {
      context.addIssue({
        code: "custom",
        path: ["relinkResultDraftSnapshotId"],
        message:
          "A durable relink draft requires both snapshot and record version.",
      })
    }
    if (hasEveryDurableDraftField && !hasEveryRelinkCommitField) {
      context.addIssue({
        code: "custom",
        path: ["relinkResultDraftSnapshotId"],
        message: "A durable relink draft requires its editor commit outcome.",
      })
    }
    if (
      hasEveryDurableDraftField &&
      journal.state !== "marking_used" &&
      journal.state !== "complete"
    ) {
      context.addIssue({
        code: "custom",
        path: ["relinkResultDraftSnapshotId"],
        message:
          "A durable draft receipt belongs only to Recent accounting or a completed promotion.",
      })
    }
    const recentUseFields = [
      journal.recentUseUsedAt,
      journal.recentUseAssetRevision,
      journal.recentUseRequestId,
    ]
    const hasAnyRecentUseField = recentUseFields.some((value) => value !== null)
    const hasEveryRecentUseField = recentUseFields.every(
      (value) => value !== null
    )
    if (hasAnyRecentUseField && !hasEveryRecentUseField) {
      context.addIssue({
        code: "custom",
        path: ["recentUseUsedAt"],
        message:
          "Managed Recent accounting requires one complete server receipt.",
      })
    }
    if (hasEveryRecentUseField && journal.state !== "complete") {
      context.addIssue({
        code: "custom",
        path: ["recentUseUsedAt"],
        message: "Managed Recent accounting is final only on completion.",
      })
    }
    if (
      journal.state === "marking_used" &&
      journal.relinkResultDraftSnapshotId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Recent accounting requires an exact durable relink receipt.",
      })
    }
    if (
      journal.state === "complete" &&
      (journal.relinkResultContentSnapshotId === null ||
        journal.relinkResultHistorySnapshotId === null ||
        journal.relinkResultOperationVersion === null ||
        journal.relinkResultDraftContentSnapshotId === null ||
        journal.relinkResultDraftSnapshotId === null ||
        journal.relinkResultDraftRecordVersion === null ||
        journal.relinkResultKind === null ||
        journal.relinkUndoable === null ||
        journal.recentUseUsedAt === null ||
        journal.recentUseAssetRevision === null ||
        journal.recentUseRequestId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A completed promotion requires its durable relink outcome.",
      })
    }
    const createdAt = Date.parse(journal.createdAt)
    const updatedAt = Date.parse(journal.updatedAt)
    if (updatedAt < createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Promotion progress cannot predate its creation.",
      })
    }
    if (journal.lease) {
      const leaseDuration = Date.parse(journal.lease.expiresAt) - updatedAt
      if (leaseDuration <= 0 || leaseDuration > MAXIMUM_LEASE_MILLISECONDS) {
        context.addIssue({
          code: "custom",
          path: ["lease", "expiresAt"],
          message:
            "A stored promotion lease must expire within the bounded lease window.",
        })
      }
    }
  })

export type LocalAssetPromotionJournal = z.infer<
  typeof localAssetPromotionJournalSchema
>
export type LocalAssetPromotionState = z.infer<
  typeof localAssetPromotionStateSchema
>

export type LocalAssetPromotionJournalReadResult =
  | { status: "missing" }
  | { status: "ready"; journal: LocalAssetPromotionJournal }
  | { status: "corrupt"; localAssetId: string }

export type CreateLocalAssetPromotionJournalInput = Readonly<{
  localAssetId: string
  idempotencyKey: string
  recentUseIdempotencyKey: string
  sourceDocumentId: string
  sourceContentSnapshotId: string
  sourceHistorySnapshotId: string
  sourceOperationVersion: number
  sourceDraftRecordVersion: number
  sourceDraftSnapshotId: string
  sourceLocalAssetRevision: number
  expectedReferenceKeys: readonly string[]
  supersedeCompletedRevision?: number
  supersedeUnrelinkedRevision?: number
  supersedeUnpersistedRelinkRevision?: number
  now?: string
}>

export const localAssetPromotionJournalPatchSchema = z
  .object({
    contentSha256: nullableContentSha256Schema.optional(),
    attempt: z.number().int().nonnegative().optional(),
    state: localAssetPromotionStateSchema.optional(),
    managedAssetId: nullableManagedAssetIdSchema.optional(),
    managedContentSha256: nullableContentSha256Schema.optional(),
    managedStatus: z.enum(["ready", "archived"]).nullable().optional(),
    managedAssetRevision: z.number().int().positive().nullable().optional(),
    mappingRequestId: boundedIdentitySchema.nullable().optional(),
    relinkResultContentSnapshotId: sha256Schema.nullable().optional(),
    relinkResultHistorySnapshotId: boundedIdentitySchema.nullable().optional(),
    relinkResultOperationVersion: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    relinkResultKind: z
      .enum(["committed", "already_applied"])
      .nullable()
      .optional(),
    relinkResultDraftSnapshotId: sha256Schema.nullable().optional(),
    relinkResultDraftContentSnapshotId: sha256Schema.nullable().optional(),
    relinkResultDraftRecordVersion: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),
    relinkCommitId: boundedIdentitySchema.nullable().optional(),
    relinkUndoable: z.boolean().nullable().optional(),
    recentUseUsedAt: z.string().datetime().nullable().optional(),
    recentUseAssetRevision: z.number().int().positive().nullable().optional(),
    recentUseRequestId: boundedIdentitySchema.nullable().optional(),
    errorCode: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9_]*$/)
      .nullable()
      .optional(),
    errorRequestId: boundedIdentitySchema.nullable().optional(),
  })
  .strict()

export type LocalAssetPromotionJournalPatch = z.infer<
  typeof localAssetPromotionJournalPatchSchema
>

const localAssetPromotionJournalChangedEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("changed"),
    localAssetId: localAssetIdSchema,
    revision: z.number().int().positive(),
  })
  .strict()

export type LocalAssetPromotionJournalChangedEvent = Readonly<
  z.infer<typeof localAssetPromotionJournalChangedEventSchema>
>

export class LocalAssetPromotionJournalCorruptError extends Error {
  readonly code = "local_promotion_journal_corrupt"

  constructor() {
    super("Saved image promotion progress could not be validated.")
    this.name = "LocalAssetPromotionJournalCorruptError"
  }
}

export class LocalAssetPromotionJournalRevisionError extends Error {
  readonly code = "local_promotion_revision_conflict"

  constructor() {
    super("Image promotion progress changed in another Studio tab.")
    this.name = "LocalAssetPromotionJournalRevisionError"
  }
}

export class LocalAssetPromotionBusyError extends Error {
  readonly code = "local_promotion_busy"

  constructor() {
    super("Another Studio tab is already working on this image.")
    this.name = "LocalAssetPromotionBusyError"
  }
}

export class LocalAssetPromotionLeaseError extends Error {
  readonly code = "local_promotion_lease_lost"

  constructor() {
    super("This tab no longer owns the image promotion.")
    this.name = "LocalAssetPromotionLeaseError"
  }
}

export class LocalAssetPromotionCheckpointError extends Error {
  readonly code = "local_promotion_checkpoint_failed"

  constructor(cause?: unknown) {
    super("Image promotion progress could not be saved.", { cause })
    this.name = "LocalAssetPromotionCheckpointError"
  }
}

const parseTimestamp = (value: string) => {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError("A valid ISO timestamp is required.")
  }
  return parsed
}

const assertLeaseDuration = (leaseMilliseconds: number) => {
  if (
    !Number.isSafeInteger(leaseMilliseconds) ||
    leaseMilliseconds < MINIMUM_LEASE_MILLISECONDS ||
    leaseMilliseconds > MAXIMUM_LEASE_MILLISECONDS
  ) {
    throw new RangeError(
      "Promotion leases must last from 1 second to 5 minutes."
    )
  }
}

const broadcastJournalChange = (journal: LocalAssetPromotionJournal) => {
  if (typeof BroadcastChannel === "undefined") return
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    const event: LocalAssetPromotionJournalChangedEvent = {
      schemaVersion: 1,
      type: "changed",
      localAssetId: journal.localAssetId,
      revision: journal.revision,
    }
    channel.postMessage(event)
    channel.close()
  } catch {
    // A notification is advisory. The committed IndexedDB checkpoint remains
    // authoritative even when this browser disables BroadcastChannel.
  }
}

export const subscribeToLocalAssetPromotionJournal = (
  listener: (event: LocalAssetPromotionJournalChangedEvent) => void
) => {
  if (typeof BroadcastChannel === "undefined") return () => {}
  let channel: BroadcastChannel
  try {
    channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
  } catch {
    return () => {}
  }
  channel.onmessage = (message: MessageEvent<unknown>) => {
    const event = localAssetPromotionJournalChangedEventSchema.safeParse(
      message.data
    )
    if (event.success) listener(event.data)
  }
  return () => channel.close()
}

const waitForJournalOperation = <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  disposeLateResult?: (value: T) => void
) => {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const settle = (value: T) => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) {
        disposeLateResult?.(value)
        reject(signal.reason)
      } else resolve(value)
    }
    const fail = (error: unknown) => {
      signal.removeEventListener("abort", abort)
      reject(signal.aborted ? signal.reason : error)
    }
    const abort = () => {}
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(settle, fail)
  })
}

const openJournalDatabase = async (signal?: AbortSignal) => {
  if (!signal) return openLocalAssetDatabase()
  signal.throwIfAborted()
  return waitForJournalOperation(openLocalAssetDatabase(), signal, (database) =>
    database.close()
  )
}

let journalOperationTail: Promise<void> = Promise.resolve()

const serializeJournalOperation = async <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
) => {
  const predecessor = journalOperationTail
  let releaseReservation: () => void = () => {}
  const reservation = new Promise<void>((resolve) => {
    releaseReservation = resolve
  })
  journalOperationTail = predecessor.then(() => reservation)
  try {
    await waitForJournalOperation(predecessor, signal)
    signal?.throwIfAborted()
    return await operation()
  } finally {
    releaseReservation()
  }
}

const readJournalValue = async (localAssetId: string, signal?: AbortSignal) =>
  serializeJournalOperation(async () => {
    const database = await openJournalDatabase(signal)
    return new Promise<unknown>((resolve, reject) => {
      let transaction: IDBTransaction | null = null
      let request: IDBRequest<unknown>
      try {
        transaction = database.transaction(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
          "readonly"
        )
        request = transaction
          .objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME)
          .get(localAssetId)
      } catch (error) {
        if (!transaction) {
          database.close()
          reject(error)
          return
        }
        transaction.onerror = () => {
          // Wait for abort acknowledgement before releasing the operation.
        }
        transaction.onabort = () => {
          database.close()
          reject(error)
        }
        try {
          transaction.abort()
        } catch {
          database.close()
          reject(error)
        }
        return
      }
      const cleanUp = () => signal?.removeEventListener("abort", abort)
      const abort = () => abortTransaction(transaction)
      let value: unknown
      request.onsuccess = () => {
        value = request.result
      }
      transaction.oncomplete = () => {
        cleanUp()
        database.close()
        if (signal?.aborted) reject(signal.reason)
        else resolve(value)
      }
      transaction.onerror = () => {
        // Wait for abort acknowledgement before releasing the serialized
        // operation and allowing a retry to open another transaction.
      }
      transaction.onabort = () => {
        cleanUp()
        database.close()
        reject(
          signal?.aborted
            ? signal.reason
            : (transaction.error ??
                new Error("Promotion journal read was aborted"))
        )
      }
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    })
  }, signal)

export async function readLocalAssetPromotionJournal(
  localAssetId: string,
  signal?: AbortSignal
): Promise<LocalAssetPromotionJournalReadResult> {
  const validLocalAssetId = localAssetIdSchema.parse(localAssetId)
  const value = await readJournalValue(validLocalAssetId, signal)
  if (value === undefined) return { status: "missing" }
  const parsed = localAssetPromotionJournalSchema.safeParse(value)
  return parsed.success
    ? { status: "ready", journal: parsed.data }
    : { status: "corrupt", localAssetId: validLocalAssetId }
}

const abortTransaction = (transaction: IDBTransaction) => {
  try {
    transaction.abort()
  } catch {
    // A completion that wins this race has already made the result durable.
  }
}

const mutateJournal = async (
  localAssetId: string,
  mutation: (
    current: LocalAssetPromotionJournal | null
  ) => LocalAssetPromotionJournal,
  signal?: AbortSignal
) => {
  const validLocalAssetId = localAssetIdSchema.parse(localAssetId)
  return serializeJournalOperation(async () => {
    const database = await openJournalDatabase(signal)
    return new Promise<LocalAssetPromotionJournal>((resolve, reject) => {
      let result: LocalAssetPromotionJournal | null = null
      let changed = false
      let operationError: unknown = null
      let transaction: IDBTransaction | null = null
      let request: IDBRequest<unknown>
      try {
        transaction = database.transaction(
          LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME,
          "readwrite"
        )
        request = transaction
          .objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME)
          .get(validLocalAssetId)
      } catch (error) {
        const failure = new LocalAssetPromotionCheckpointError(error)
        if (!transaction) {
          database.close()
          reject(failure)
          return
        }
        transaction.onerror = () => {
          // Wait for abort acknowledgement before releasing the operation.
        }
        transaction.onabort = () => {
          database.close()
          reject(failure)
        }
        try {
          transaction.abort()
        } catch {
          database.close()
          reject(failure)
        }
        return
      }
      const cleanUp = () => signal?.removeEventListener("abort", abort)
      const abort = () => abortTransaction(transaction)
      request.onsuccess = () => {
        try {
          const currentValue: unknown = request.result
          let current: LocalAssetPromotionJournal | null = null
          if (currentValue !== undefined) {
            const parsed =
              localAssetPromotionJournalSchema.safeParse(currentValue)
            if (!parsed.success) {
              throw new LocalAssetPromotionJournalCorruptError()
            }
            current = parsed.data
          }
          result = localAssetPromotionJournalSchema.parse(mutation(current))
          changed = result !== current
          if (changed) {
            transaction
              .objectStore(LOCAL_ASSET_PROMOTION_JOURNAL_STORE_NAME)
              .put(result)
          }
        } catch (error) {
          operationError = error
          abortTransaction(transaction)
        }
      }
      transaction.oncomplete = () => {
        cleanUp()
        database.close()
        if (!result) {
          reject(new LocalAssetPromotionCheckpointError())
          return
        }
        if (changed) broadcastJournalChange(result)
        // A committed mutation wins the cancellation race. Returning the exact
        // checkpoint lets the owner settle or release a claimed lease.
        resolve(result)
      }
      transaction.onerror = () => {
        // Wait for abort acknowledgement so another owner cannot overlap the
        // IndexedDB transaction that just failed.
      }
      transaction.onabort = () => {
        cleanUp()
        database.close()
        if (
          operationError instanceof LocalAssetPromotionJournalCorruptError ||
          operationError instanceof LocalAssetPromotionJournalRevisionError ||
          operationError instanceof LocalAssetPromotionBusyError ||
          operationError instanceof LocalAssetPromotionLeaseError
        ) {
          reject(operationError)
          return
        }
        reject(
          signal?.aborted
            ? signal.reason
            : new LocalAssetPromotionCheckpointError(
                operationError ?? transaction.error
              )
        )
      }
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    })
  }, signal)
}

const sameStringArray = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const matchesCreationAnchor = (
  journal: LocalAssetPromotionJournal,
  input: CreateLocalAssetPromotionJournalInput
) =>
  journal.idempotencyKey === input.idempotencyKey &&
  journal.recentUseIdempotencyKey === input.recentUseIdempotencyKey &&
  journal.sourceDocumentId === input.sourceDocumentId &&
  journal.sourceContentSnapshotId === input.sourceContentSnapshotId &&
  journal.sourceHistorySnapshotId === input.sourceHistorySnapshotId &&
  journal.sourceOperationVersion === input.sourceOperationVersion &&
  journal.sourceDraftRecordVersion === input.sourceDraftRecordVersion &&
  journal.sourceDraftSnapshotId === input.sourceDraftSnapshotId &&
  journal.sourceLocalAssetRevision === input.sourceLocalAssetRevision &&
  sameStringArray(journal.expectedReferenceKeys, input.expectedReferenceKeys)

export const createOrResumeLocalAssetPromotionJournal = async (
  input: CreateLocalAssetPromotionJournalInput,
  signal?: AbortSignal
) => {
  const now = input.now ?? new Date().toISOString()
  parseTimestamp(now)
  const idempotencyKey = mediaIdempotencyKeySchema.parse(input.idempotencyKey)
  return mutateJournal(
    input.localAssetId,
    (current) => {
      if (current) {
        if (!matchesCreationAnchor(current, input)) {
          const canReanchorUnrelinked =
            input.supersedeUnrelinkedRevision === current.revision &&
            (current.state === "mapped" ||
              (current.state === "relinking" &&
                current.relinkResultKind === null)) &&
            current.relinkResultDraftSnapshotId === null &&
            current.recentUseUsedAt === null &&
            current.sourceLocalAssetRevision ===
              input.sourceLocalAssetRevision &&
            current.idempotencyKey === input.idempotencyKey &&
            current.recentUseIdempotencyKey === input.recentUseIdempotencyKey &&
            current.managedAssetId !== null &&
            current.managedContentSha256 !== null &&
            current.managedStatus !== null &&
            current.managedAssetRevision !== null &&
            current.mappingRequestId !== null &&
            current.contentSha256 !== null &&
            current.managedContentSha256 === current.contentSha256
          const canReanchorUnpersistedRelink =
            input.supersedeUnpersistedRelinkRevision === current.revision &&
            current.state === "relinking" &&
            current.relinkResultKind !== null &&
            current.relinkResultDraftContentSnapshotId === null &&
            current.relinkResultDraftSnapshotId === null &&
            current.relinkResultDraftRecordVersion === null &&
            current.recentUseUsedAt === null &&
            current.recentUseAssetRevision === null &&
            current.recentUseRequestId === null &&
            current.sourceLocalAssetRevision ===
              input.sourceLocalAssetRevision &&
            current.idempotencyKey === input.idempotencyKey &&
            current.recentUseIdempotencyKey === input.recentUseIdempotencyKey &&
            sameStringArray(
              current.expectedReferenceKeys,
              input.expectedReferenceKeys
            ) &&
            current.managedAssetId !== null &&
            current.managedContentSha256 !== null &&
            current.managedStatus !== null &&
            current.managedAssetRevision !== null &&
            current.mappingRequestId !== null &&
            current.contentSha256 !== null &&
            current.managedContentSha256 === current.contentSha256
          if (canReanchorUnrelinked || canReanchorUnpersistedRelink) {
            if (
              current.lease &&
              parseTimestamp(current.lease.expiresAt) > parseTimestamp(now)
            ) {
              throw new LocalAssetPromotionBusyError()
            }
            if (parseTimestamp(now) < parseTimestamp(current.updatedAt)) {
              throw new LocalAssetPromotionJournalRevisionError()
            }
            return {
              ...current,
              revision: current.revision + 1,
              state: "mapped",
              sourceDocumentId: input.sourceDocumentId,
              sourceContentSnapshotId: input.sourceContentSnapshotId,
              sourceHistorySnapshotId: input.sourceHistorySnapshotId,
              sourceOperationVersion: input.sourceOperationVersion,
              sourceDraftRecordVersion: input.sourceDraftRecordVersion,
              sourceDraftSnapshotId: input.sourceDraftSnapshotId,
              expectedReferenceKeys: [...input.expectedReferenceKeys],
              relinkResultContentSnapshotId: null,
              relinkResultHistorySnapshotId: null,
              relinkResultOperationVersion: null,
              relinkResultKind: null,
              relinkResultDraftContentSnapshotId: null,
              relinkResultDraftSnapshotId: null,
              relinkResultDraftRecordVersion: null,
              relinkCommitId: null,
              relinkUndoable: null,
              recentUseUsedAt: null,
              recentUseAssetRevision: null,
              recentUseRequestId: null,
              errorCode: null,
              errorRequestId: null,
              updatedAt: now,
              lease: null,
            }
          }
          if (
            current.state !== "complete" ||
            input.supersedeCompletedRevision !== current.revision
          ) {
            throw new LocalAssetPromotionJournalRevisionError()
          }
          if (
            current.lease &&
            parseTimestamp(current.lease.expiresAt) > parseTimestamp(now)
          ) {
            throw new LocalAssetPromotionBusyError()
          }
          if (parseTimestamp(now) < parseTimestamp(current.updatedAt)) {
            throw new LocalAssetPromotionJournalRevisionError()
          }
          if (
            current.sourceLocalAssetRevision !== input.sourceLocalAssetRevision
          ) {
            throw new LocalAssetPromotionJournalRevisionError()
          }
          return {
            ...current,
            revision: current.revision + 1,
            idempotencyKey,
            recentUseIdempotencyKey: mediaIdempotencyKeySchema.parse(
              input.recentUseIdempotencyKey
            ),
            attempt: 0,
            state: "mapped",
            sourceDocumentId: input.sourceDocumentId,
            sourceContentSnapshotId: input.sourceContentSnapshotId,
            sourceHistorySnapshotId: input.sourceHistorySnapshotId,
            sourceOperationVersion: input.sourceOperationVersion,
            sourceDraftRecordVersion: input.sourceDraftRecordVersion,
            sourceDraftSnapshotId: input.sourceDraftSnapshotId,
            sourceLocalAssetRevision: input.sourceLocalAssetRevision,
            expectedReferenceKeys: [...input.expectedReferenceKeys],
            relinkResultContentSnapshotId: null,
            relinkResultHistorySnapshotId: null,
            relinkResultOperationVersion: null,
            relinkResultKind: null,
            relinkResultDraftContentSnapshotId: null,
            relinkResultDraftSnapshotId: null,
            relinkResultDraftRecordVersion: null,
            relinkCommitId: null,
            relinkUndoable: null,
            recentUseUsedAt: null,
            recentUseAssetRevision: null,
            recentUseRequestId: null,
            errorCode: null,
            errorRequestId: null,
            createdAt: now,
            updatedAt: now,
            lease: null,
          }
        }
        return current
      }
      return {
        schemaVersion: 1,
        localAssetId: input.localAssetId,
        revision: 1,
        contentSha256: null,
        idempotencyKey,
        recentUseIdempotencyKey: mediaIdempotencyKeySchema.parse(
          input.recentUseIdempotencyKey
        ),
        attempt: 0,
        state: "queued",
        managedAssetId: null,
        managedContentSha256: null,
        managedStatus: null,
        managedAssetRevision: null,
        sourceDocumentId: input.sourceDocumentId,
        sourceContentSnapshotId: input.sourceContentSnapshotId,
        sourceHistorySnapshotId: input.sourceHistorySnapshotId,
        sourceOperationVersion: input.sourceOperationVersion,
        sourceDraftRecordVersion: input.sourceDraftRecordVersion,
        sourceDraftSnapshotId: input.sourceDraftSnapshotId,
        sourceLocalAssetRevision: input.sourceLocalAssetRevision,
        expectedReferenceKeys: [...input.expectedReferenceKeys],
        mappingRequestId: null,
        relinkResultContentSnapshotId: null,
        relinkResultHistorySnapshotId: null,
        relinkResultOperationVersion: null,
        relinkResultKind: null,
        relinkResultDraftContentSnapshotId: null,
        relinkResultDraftSnapshotId: null,
        relinkResultDraftRecordVersion: null,
        relinkCommitId: null,
        relinkUndoable: null,
        recentUseUsedAt: null,
        recentUseAssetRevision: null,
        recentUseRequestId: null,
        errorCode: null,
        errorRequestId: null,
        createdAt: now,
        updatedAt: now,
        lease: null,
      }
    },
    signal
  )
}

export const checkpointReleasedLocalAssetPromotionConflict = async (
  input: {
    localAssetId: string
    expectedRevision: number
    now?: string
  },
  signal?: AbortSignal
) => {
  const now = input.now ?? new Date().toISOString()
  parseTimestamp(now)
  return mutateJournal(
    input.localAssetId,
    (current) => {
      if (!current || current.revision !== input.expectedRevision) {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      if (current.state !== "mapped" && current.state !== "relinking") {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      if (
        current.lease &&
        parseTimestamp(current.lease.expiresAt) > parseTimestamp(now)
      ) {
        throw new LocalAssetPromotionBusyError()
      }
      return {
        ...current,
        revision: current.revision + 1,
        errorCode: "local_relink_conflict",
        errorRequestId: null,
        updatedAt: now,
        lease: null,
      }
    },
    signal
  )
}

const assertExpectedRevision = (
  journal: LocalAssetPromotionJournal,
  expectedRevision: number
) => {
  if (journal.revision !== expectedRevision) {
    throw new LocalAssetPromotionJournalRevisionError()
  }
}

const assertMonotonicMutationTime = (
  journal: LocalAssetPromotionJournal,
  now: string
) => {
  if (parseTimestamp(now) < parseTimestamp(journal.updatedAt)) {
    throw new LocalAssetPromotionJournalRevisionError()
  }
}

const assertLiveLease = (
  journal: LocalAssetPromotionJournal,
  ownerId: string,
  leaseToken: string,
  now: string
) => {
  if (
    !journal.lease ||
    journal.lease.ownerId !== ownerId ||
    journal.lease.token !== leaseToken ||
    parseTimestamp(journal.lease.expiresAt) <= parseTimestamp(now)
  ) {
    throw new LocalAssetPromotionLeaseError()
  }
}

export const claimLocalAssetPromotionJournal = async (
  input: {
    localAssetId: string
    expectedRevision: number
    ownerId: string
    now?: string
    leaseMilliseconds: number
    leaseToken?: string
  },
  signal?: AbortSignal
) => {
  assertLeaseDuration(input.leaseMilliseconds)
  const now = input.now ?? new Date().toISOString()
  const nowMilliseconds = parseTimestamp(now)
  return mutateJournal(
    input.localAssetId,
    (current) => {
      if (!current) throw new LocalAssetPromotionJournalRevisionError()
      assertExpectedRevision(current, input.expectedRevision)
      assertMonotonicMutationTime(current, now)
      if (current.state === "complete") {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      if (
        current.lease &&
        parseTimestamp(current.lease.expiresAt) > nowMilliseconds
      ) {
        throw new LocalAssetPromotionBusyError()
      }
      return {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        lease: {
          ownerId: boundedIdentitySchema.parse(input.ownerId),
          token: boundedIdentitySchema.parse(
            input.leaseToken ?? crypto.randomUUID()
          ),
          expiresAt: new Date(
            nowMilliseconds + input.leaseMilliseconds
          ).toISOString(),
        },
      }
    },
    signal
  )
}

export const renewLocalAssetPromotionJournalLease = async (input: {
  localAssetId: string
  expectedRevision: number
  ownerId: string
  leaseToken: string
  now?: string
  leaseMilliseconds: number
}) => {
  assertLeaseDuration(input.leaseMilliseconds)
  const now = input.now ?? new Date().toISOString()
  const nowMilliseconds = parseTimestamp(now)
  return mutateJournal(input.localAssetId, (current) => {
    if (!current) throw new LocalAssetPromotionJournalRevisionError()
    assertExpectedRevision(current, input.expectedRevision)
    assertMonotonicMutationTime(current, now)
    if (current.state === "complete") {
      throw new LocalAssetPromotionJournalRevisionError()
    }
    assertLiveLease(current, input.ownerId, input.leaseToken, now)
    return {
      ...current,
      revision: current.revision + 1,
      updatedAt: now,
      lease: {
        ownerId: current.lease!.ownerId,
        token: current.lease!.token,
        expiresAt: new Date(
          nowMilliseconds + input.leaseMilliseconds
        ).toISOString(),
      },
    }
  })
}

export const compareAndSwapLocalAssetPromotionJournal = async (input: {
  localAssetId: string
  expectedRevision: number
  ownerId: string
  leaseToken: string
  patch: LocalAssetPromotionJournalPatch
  now?: string
}) => {
  const now = input.now ?? new Date().toISOString()
  parseTimestamp(now)
  const patch = localAssetPromotionJournalPatchSchema.parse(input.patch)
  return mutateJournal(input.localAssetId, (current) => {
    if (!current) throw new LocalAssetPromotionJournalRevisionError()
    assertExpectedRevision(current, input.expectedRevision)
    assertMonotonicMutationTime(current, now)
    if (current.state === "complete") {
      throw new LocalAssetPromotionJournalRevisionError()
    }
    assertLiveLease(current, input.ownerId, input.leaseToken, now)
    return {
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: now,
      lease: current.lease,
    }
  })
}

export const releaseLocalAssetPromotionJournal = async (input: {
  localAssetId: string
  expectedRevision: number
  ownerId: string
  leaseToken: string
  now?: string
}) => {
  const now = input.now ?? new Date().toISOString()
  parseTimestamp(now)
  return mutateJournal(input.localAssetId, (current) => {
    if (!current) throw new LocalAssetPromotionJournalRevisionError()
    assertExpectedRevision(current, input.expectedRevision)
    assertMonotonicMutationTime(current, now)
    assertLiveLease(current, input.ownerId, input.leaseToken, now)
    return {
      ...current,
      revision: current.revision + 1,
      updatedAt: now,
      lease: null,
    }
  })
}
