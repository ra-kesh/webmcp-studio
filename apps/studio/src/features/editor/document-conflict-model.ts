import type { LocalSaveState } from "./document-draft-save-controller"
import type {
  DocumentDraftConflict,
  DraftRepositoryFailure,
} from "./document-draft-repository"

export type DocumentConflictIdentity = Readonly<{
  conflictId: string
  candidateDraftSnapshotId: string
}>

export type DocumentConflictAction = "download" | "reload" | "save_copy"

export type DocumentConflictOperation =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "running"
      action: DocumentConflictAction
      identity: DocumentConflictIdentity | null
      message: string
    }>
  | Readonly<{
      status: "confirming_reload"
      identity: DocumentConflictIdentity | null
      message: string
    }>
  | Readonly<{
      status: "failed"
      action: DocumentConflictAction
      identity: DocumentConflictIdentity | null
      message: string
      retryable: boolean
      createdDocumentId?: string
    }>

export type DocumentConflictModelInput = Readonly<{
  documentId: string
  documentName: string
  saveState: LocalSaveState
  verifiedConflicts: readonly DocumentDraftConflict[]
  discoveryFailure?: DraftRepositoryFailure | null
  operation?: DocumentConflictOperation
}>

type ConflictReasonModel = Readonly<{
  reason: DocumentDraftConflict["reason"]
  reasonLabel: string
  durableHeadState: "changed" | "deleted" | "migration_collision"
  durableHeadCopy: string
}>

export type DocumentConflictModel =
  | Readonly<{
      status: "none"
      documentId: string
      documentName: string
      operation: DocumentConflictOperation
    }>
  | Readonly<{
      status: "external_change"
      documentId: string
      documentName: string
      reason: "saved_elsewhere" | "deleted_elsewhere"
      observedRecordVersion: number
      heading: string
      detail: string
      actions: readonly DocumentConflictAction[]
      operation: DocumentConflictOperation
    }>
  | Readonly<{
      status: "conflict"
      documentId: string
      documentName: string
      identity: DocumentConflictIdentity
      detectedAt: string
      expectedRecordVersion: number
      observedRecordVersion: number | null
      reason: ConflictReasonModel["reason"]
      reasonLabel: string
      durableHeadState: ConflictReasonModel["durableHeadState"]
      heading: string
      detail: string
      durableHeadCopy: string
      actions: readonly DocumentConflictAction[]
      operation: DocumentConflictOperation
    }>
  | Readonly<{
      status: "recovery_required"
      documentId: string
      documentName: string
      heading: string
      detail: string
      failureKind: DraftRepositoryFailure["kind"]
      operation: DocumentConflictOperation
    }>
  | Readonly<{
      status: "save_failed"
      documentId: string
      documentName: string
      heading: string
      detail: string
      retryable: boolean
      actions: readonly ["download"]
      operation: DocumentConflictOperation
    }>

const idleOperation: DocumentConflictOperation = { status: "idle" }

export const conflictIdentity = (
  conflict: DocumentDraftConflict
): DocumentConflictIdentity => ({
  conflictId: conflict.conflictId,
  candidateDraftSnapshotId: conflict.candidateDraftSnapshotId,
})

export const selectNewestUnresolvedConflict = (
  documentId: string,
  verifiedConflicts: readonly DocumentDraftConflict[]
): DocumentDraftConflict | null =>
  [...verifiedConflicts]
    .filter(
      (conflict) =>
        conflict.documentId === documentId && conflict.resolvedAt === null
    )
    .sort(
      (left, right) =>
        right.detectedAt.localeCompare(left.detectedAt) ||
        right.conflictId.localeCompare(left.conflictId) ||
        right.candidateDraftSnapshotId.localeCompare(
          left.candidateDraftSnapshotId
        )
    )[0] ?? null

const projectReason = (
  reason: DocumentDraftConflict["reason"]
): ConflictReasonModel => {
  switch (reason) {
    case "stale_write":
      return {
        reason,
        reasonLabel: "A newer saved version exists",
        durableHeadState: "changed",
        durableHeadCopy: "The saved document changed after editing began.",
      }
    case "deleted_elsewhere":
      return {
        reason,
        reasonLabel: "The saved document was deleted",
        durableHeadState: "deleted",
        durableHeadCopy: "The saved document is now in Trash.",
      }
    case "migration_collision":
      return {
        reason,
        reasonLabel: "Two stored versions need recovery",
        durableHeadState: "migration_collision",
        durableHeadCopy:
          "A stored version already used this document identity during migration.",
      }
  }
}

export const projectDocumentConflictModel = (
  input: DocumentConflictModelInput
): DocumentConflictModel => {
  const operation = input.operation ?? idleOperation
  if (input.discoveryFailure) {
    return {
      status: "recovery_required",
      documentId: input.documentId,
      documentName: input.documentName,
      heading: `Recovery needed for ${input.documentName}`,
      detail:
        input.discoveryFailure.kind === "corrupt_record"
          ? "A stored recovery candidate could not be verified."
          : "Stored recovery information is temporarily unavailable.",
      failureKind: input.discoveryFailure.kind,
      operation,
    }
  }

  const conflict = selectNewestUnresolvedConflict(
    input.documentId,
    input.verifiedConflicts
  )
  if (conflict) {
    const reason = projectReason(conflict.reason)
    return {
      status: "conflict",
      documentId: input.documentId,
      documentName: input.documentName,
      identity: conflictIdentity(conflict),
      detectedAt: conflict.detectedAt,
      expectedRecordVersion: conflict.expectedRecordVersion,
      observedRecordVersion: conflict.observedRecordVersion,
      ...reason,
      heading: `Recover changes to ${input.documentName}`,
      detail:
        "Your preserved version remains available until you choose how to recover it.",
      actions: ["download", "reload", "save_copy"],
      operation,
    }
  }

  if (input.saveState.status === "external_change") {
    if (input.saveState.reason === "quarantined_elsewhere") {
      return {
        status: "recovery_required",
        documentId: input.documentId,
        documentName: input.documentName,
        heading: `Recovery needed for ${input.documentName}`,
        detail: "The saved document was quarantined and cannot be reopened.",
        failureKind: "corrupt_record",
        operation,
      }
    }
    const deleted = input.saveState.reason === "deleted_elsewhere"
    return {
      status: "external_change",
      documentId: input.documentId,
      documentName: input.documentName,
      reason: input.saveState.reason,
      observedRecordVersion: input.saveState.observedRecordVersion,
      heading: deleted
        ? `${input.documentName} was deleted elsewhere`
        : `${input.documentName} changed elsewhere`,
      detail: deleted
        ? "Your open version has not replaced the deleted saved document."
        : "Your open version has not been merged with the newer saved version.",
      actions: ["download", "reload", "save_copy"],
      operation,
    }
  }

  if (input.saveState.status === "failed") {
    return {
      status: "save_failed",
      documentId: input.documentId,
      documentName: input.documentName,
      heading: `Changes to ${input.documentName} were not saved`,
      detail: "Download your open version before retrying or leaving.",
      retryable: input.saveState.retryable,
      actions: ["download"],
      operation,
    }
  }

  return {
    status: "none",
    documentId: input.documentId,
    documentName: input.documentName,
    operation,
  }
}
