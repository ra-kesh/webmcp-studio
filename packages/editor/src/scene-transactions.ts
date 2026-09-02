import {
  changeSetSchema,
  executeSceneTransaction,
  type ChangeSet,
  type SceneTransaction,
  type SceneTransactionFailure,
  type SceneTransactionSuccess,
} from "@webmcp/document"
import {
  commitPreparedDocumentWithResult,
  historyCommandLabel,
  type DocumentHistory,
  type DocumentHistoryCommit,
  type HistoryCommitOptions,
} from "./history"

const commandSummary = (type: SceneTransaction["commands"][number]["type"]) =>
  type.replaceAll("_", " ")

export function sceneTransactionToChangeSet(
  transaction: SceneTransaction,
  createdAt: string
): ChangeSet {
  if (transaction.mode !== "review") {
    throw new Error("Only review-mode transactions can become change sets.")
  }
  return changeSetSchema.parse({
    id: transaction.id,
    documentId: transaction.expected.documentId,
    baseRevision: transaction.expected.revision,
    baseSnapshotId: transaction.expected.snapshotId,
    title: transaction.title,
    createdAt,
    createdBy: "agent",
    status: "pending",
    operations: transaction.commands.map((command) => ({
      id: command.id,
      command,
      summary: commandSummary(command.type),
      status: "pending",
    })),
  })
}

export type SceneTransactionCommitResult =
  | Readonly<{
      ok: true
      history: DocumentHistory
      commit: DocumentHistoryCommit | null
      transaction: SceneTransactionSuccess
    }>
  | Readonly<{
      ok: false
      history: DocumentHistory
      transaction: SceneTransactionFailure
    }>

export function sceneTransactionForHistory(
  history: DocumentHistory,
  commands: SceneTransaction["commands"],
  options: Readonly<{
    title?: string
    mode?: SceneTransaction["mode"]
    identity?: string
    idempotencyKey?: string
  }> = {}
): SceneTransaction {
  const identity = options.identity ?? crypto.randomUUID()
  const title = (options.title ?? historyCommandLabel(commands)).trim()
  return {
    version: 1,
    id: `transaction-${identity}`,
    idempotencyKey: options.idempotencyKey ?? `editor:${identity}`,
    title: title.slice(0, 200) || "Update document",
    mode: options.mode ?? "commit",
    expected: {
      documentId: history.document.id,
      revision: history.document.revision,
      snapshotId: history.snapshotId,
      operationVersion: history.operationVersion,
    },
    commands,
  }
}

/** Commits a validated transaction as one history entry and one undo step. */
export function commitSceneTransaction(
  history: DocumentHistory,
  transaction: SceneTransaction,
  options: Omit<HistoryCommitOptions, "label"> = {}
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
  if (evaluated.replayed || !evaluated.changed) {
    return {
      ok: true,
      history,
      commit: null,
      transaction: evaluated,
    }
  }
  const committed = commitPreparedDocumentWithResult(
    history,
    evaluated.document,
    transaction.id,
    { ...options, label: transaction.title }
  )
  if (!committed) {
    return { ok: true, history, commit: null, transaction: evaluated }
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
