import {
  executeSceneTransaction,
  type SceneTransaction,
  type SceneTransactionFailure,
  type SceneTransactionSuccess,
} from "@webmcp/document"
import {
  commitCommandsWithResult,
  type DocumentHistory,
  type DocumentHistoryCommit,
} from "./history"

export type SceneTransactionCommitResult =
  | Readonly<{
      ok: true
      history: DocumentHistory
      commit: DocumentHistoryCommit
      transaction: SceneTransactionSuccess
    }>
  | Readonly<{
      ok: false
      history: DocumentHistory
      transaction: SceneTransactionFailure
    }>

/** Commits a validated transaction as one history entry and one undo step. */
export function commitSceneTransaction(
  history: DocumentHistory,
  transaction: SceneTransaction
): SceneTransactionCommitResult {
  const evaluated = executeSceneTransaction(
    {
      document: history.document,
      snapshotId: history.snapshotId,
      operationVersion: history.operationVersion,
    },
    transaction
  )
  if (!evaluated.ok) {
    return { ok: false, history, transaction: evaluated }
  }
  if (transaction.mode !== "commit") {
    return {
      ok: false,
      history,
      transaction: {
        ok: false,
        status: "rejected",
        transactionId: transaction.id,
        idempotencyKey: transaction.idempotencyKey,
        requestHash: evaluated.requestHash,
        mode: transaction.mode,
        base: evaluated.base,
        replayed: false,
        error: {
          code: "invalid_transaction",
          message: "Editor history accepts only commit-mode transactions.",
        },
        document: history.document,
      },
    }
  }
  const committed = commitCommandsWithResult(history, transaction.commands, {
    label: transaction.title,
  })
  if (!committed) {
    return {
      ok: false,
      history,
      transaction: {
        ok: false,
        status: "rejected",
        transactionId: transaction.id,
        idempotencyKey: transaction.idempotencyKey,
        requestHash: evaluated.requestHash,
        mode: transaction.mode,
        base: evaluated.base,
        replayed: false,
        error: {
          code: "command_failed",
          message: "The transaction did not change the document.",
        },
        document: history.document,
      },
    }
  }
  return {
    ok: true,
    history: committed.history,
    commit: committed.commit,
    transaction: {
      ...evaluated,
      status: "committed",
      result: {
        documentId: committed.history.document.id,
        revision: committed.history.document.revision,
        snapshotId: committed.history.snapshotId,
        operationVersion: committed.history.operationVersion,
      },
      document: committed.history.document,
    },
  }
}
