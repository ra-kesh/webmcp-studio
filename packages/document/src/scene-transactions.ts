import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { z } from "zod"
import { applyCommand, MaskCommandError } from "./commands"
import {
  documentCommandSchema,
  type Document,
  type DocumentCommand,
} from "./schema"
import {
  DocumentValidationError,
  validateDocument,
  type ValidationIssue,
} from "./validation"

export const SCENE_TRANSACTION_VERSION = 1 as const
export const SCENE_TRANSACTION_MAX_BYTES = 2 * 1024 * 1024
export const SCENE_TRANSACTION_MAX_COMMANDS = 500
export const SCENE_TRANSACTION_RECEIPT_LIMIT = 128

const boundedIdentifier = z.string().trim().min(1).max(128)

export const sceneTransactionSchema = z
  .object({
    version: z.literal(SCENE_TRANSACTION_VERSION),
    id: boundedIdentifier,
    idempotencyKey: boundedIdentifier.regex(/^[A-Za-z0-9._:-]+$/),
    title: z.string().trim().min(1).max(200),
    mode: z.enum(["preflight", "preview", "review", "commit"]),
    expected: z
      .object({
        documentId: z.string().min(1),
        revision: z.number().int().nonnegative(),
        snapshotId: z.string().min(1),
        operationVersion: z.number().int().nonnegative(),
      })
      .strict(),
    commands: z
      .array(documentCommandSchema)
      .min(1)
      .max(SCENE_TRANSACTION_MAX_COMMANDS),
  })
  .strict()
  .superRefine((transaction, context) => {
    const commandIds = new Set<string>()
    transaction.commands.forEach((command, index) => {
      if (commandIds.has(command.id)) {
        context.addIssue({
          code: "custom",
          path: ["commands", index, "id"],
          message: "Command IDs must be unique within a transaction",
        })
      }
      commandIds.add(command.id)
    })
  })

export type SceneTransaction = z.infer<typeof sceneTransactionSchema>

export type SceneTransactionContext = Readonly<{
  document: Document
  snapshotId: string
  operationVersion: number
}>

export type SceneTransactionIdentity = Readonly<{
  documentId: string
  revision: number
  snapshotId: string | null
  operationVersion: number
}>

export type SceneTransactionErrorCode =
  | "payload_limit"
  | "invalid_transaction"
  | "document_mismatch"
  | "revision_mismatch"
  | "snapshot_mismatch"
  | "operation_version_mismatch"
  | "idempotency_key_reused"
  | "command_failed"
  | "validation_failed"

export type SceneTransactionError = Readonly<{
  code: SceneTransactionErrorCode
  message: string
  commandIndex?: number
  commandId?: string
  commandType?: DocumentCommand["type"]
  issues?: readonly ValidationIssue[]
  causeCode?: string
}>

type SceneTransactionResultBase = Readonly<{
  transactionId: string
  idempotencyKey: string
  requestHash: string
  mode: SceneTransaction["mode"]
  base: SceneTransactionIdentity
  replayed: boolean
}>

export type SceneTransactionSuccess = SceneTransactionResultBase &
  Readonly<{
    ok: true
    status: "validated" | "preview_ready" | "review_ready" | "committed"
    result: SceneTransactionIdentity
    commandCount: number
    changed: boolean
    warnings: readonly ValidationIssue[]
    document: Document
  }>

export type SceneTransactionFailure = SceneTransactionResultBase &
  Readonly<{
    ok: false
    status: "rejected"
    error: SceneTransactionError
    document: Document
  }>

export type SceneTransactionResult =
  SceneTransactionSuccess | SceneTransactionFailure

const emptyIdentity = (
  context: SceneTransactionContext
): SceneTransactionIdentity => ({
  documentId: context.document.id,
  revision: context.document.revision,
  snapshotId: context.snapshotId,
  operationVersion: context.operationVersion,
})

const serializedRequest = (value: unknown) => {
  try {
    const json = JSON.stringify(value)
    return typeof json === "string" ? json : null
  } catch {
    return null
  }
}

const digest = (value: unknown) =>
  bytesToHex(
    sha256(utf8ToBytes(serializedRequest(value) ?? "invalid-transaction"))
  )

const invalidResult = (
  context: SceneTransactionContext,
  input: unknown,
  error: SceneTransactionError,
  parsed?: SceneTransaction
): SceneTransactionFailure => ({
  ok: false,
  status: "rejected",
  transactionId: parsed?.id ?? "invalid-transaction",
  idempotencyKey: parsed?.idempotencyKey ?? "invalid-transaction",
  requestHash: digest(input),
  mode: parsed?.mode ?? "preflight",
  base: emptyIdentity(context),
  replayed: false,
  error,
  document: context.document,
})

const conflict = (
  context: SceneTransactionContext,
  transaction: SceneTransaction,
  requestHash: string
): SceneTransactionFailure | null => {
  const shared = {
    ok: false as const,
    status: "rejected" as const,
    transactionId: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    requestHash,
    mode: transaction.mode,
    base: emptyIdentity(context),
    replayed: false,
    document: context.document,
  }
  if (transaction.expected.documentId !== context.document.id) {
    return {
      ...shared,
      error: {
        code: "document_mismatch",
        message: "The transaction belongs to another document.",
      },
    }
  }
  if (transaction.expected.revision !== context.document.revision) {
    return {
      ...shared,
      error: {
        code: "revision_mismatch",
        message: `The document changed from revision ${transaction.expected.revision} to ${context.document.revision}.`,
      },
    }
  }
  if (transaction.expected.snapshotId !== context.snapshotId) {
    return {
      ...shared,
      error: {
        code: "snapshot_mismatch",
        message: "The document snapshot changed. Inspect the canvas again.",
      },
    }
  }
  if (transaction.expected.operationVersion !== context.operationVersion) {
    return {
      ...shared,
      error: {
        code: "operation_version_mismatch",
        message: "The editor operation changed. Inspect the canvas again.",
      },
    }
  }
  return null
}

const commandFailure = (
  context: SceneTransactionContext,
  transaction: SceneTransaction,
  requestHash: string,
  command: DocumentCommand,
  commandIndex: number,
  error: unknown
): SceneTransactionFailure => {
  const validationIssues =
    error instanceof DocumentValidationError ? error.issues : undefined
  return {
    ok: false,
    status: "rejected",
    transactionId: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    requestHash,
    mode: transaction.mode,
    base: emptyIdentity(context),
    replayed: false,
    error: {
      code: validationIssues ? "validation_failed" : "command_failed",
      message: error instanceof Error ? error.message : "The command failed.",
      commandIndex,
      commandId: command.id,
      commandType: command.type,
      ...(validationIssues ? { issues: validationIssues } : {}),
      ...(error instanceof MaskCommandError ? { causeCode: error.code } : {}),
    },
    document: context.document,
  }
}

const statusForMode = (
  mode: SceneTransaction["mode"]
): SceneTransactionSuccess["status"] => {
  switch (mode) {
    case "preflight":
      return "validated"
    case "preview":
      return "preview_ready"
    case "review":
      return "review_ready"
    case "commit":
      return "committed"
  }
}

const replayedCommit = (
  context: SceneTransactionContext,
  transaction: SceneTransaction,
  requestHash: string
): SceneTransactionResult | null => {
  if (
    transaction.mode !== "commit" ||
    transaction.expected.documentId !== context.document.id
  ) {
    return null
  }
  const receipt = context.document.sceneTransactionMetadata?.receipts.find(
    (candidate) => candidate.idempotencyKey === transaction.idempotencyKey
  )
  if (!receipt) return null
  if (receipt.requestHash !== requestHash) {
    return invalidResult(
      context,
      transaction,
      {
        code: "idempotency_key_reused",
        message:
          "That idempotency key was already used for a different transaction.",
      },
      transaction
    )
  }
  return {
    ok: true,
    status: "committed",
    transactionId: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    requestHash,
    mode: transaction.mode,
    base: emptyIdentity(context),
    result: emptyIdentity(context),
    commandCount: transaction.commands.length,
    changed: false,
    warnings: [],
    document: context.document,
    replayed: true,
  }
}

const appendTransactionReceipt = (
  document: Document,
  transaction: SceneTransaction,
  requestHash: string
): Document => ({
  ...document,
  sceneTransactionMetadata: {
    schemaVersion: 1,
    receipts: [
      ...(document.sceneTransactionMetadata?.receipts ?? []).filter(
        (receipt) => receipt.idempotencyKey !== transaction.idempotencyKey
      ),
      { idempotencyKey: transaction.idempotencyKey, requestHash },
    ].slice(-SCENE_TRANSACTION_RECEIPT_LIMIT),
  },
})

/**
 * Evaluates a bounded command batch against one exact editor snapshot.
 * Commands run on a private candidate. A rejected command returns the original
 * document, so callers cannot observe a partially applied transaction.
 */
export function executeSceneTransaction(
  context: SceneTransactionContext,
  input: unknown
): SceneTransactionResult {
  const serialized = serializedRequest(input)
  if (serialized === null) {
    return invalidResult(context, input, {
      code: "invalid_transaction",
      message: "The transaction must be serializable JSON data.",
    })
  }
  const requestBytes = utf8ToBytes(serialized).byteLength
  if (requestBytes > SCENE_TRANSACTION_MAX_BYTES) {
    return invalidResult(context, input, {
      code: "payload_limit",
      message: `The transaction uses ${requestBytes} bytes; the limit is ${SCENE_TRANSACTION_MAX_BYTES}.`,
    })
  }
  const parsed = sceneTransactionSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return invalidResult(context, input, {
      code: "invalid_transaction",
      message: issue?.message ?? "The transaction is invalid.",
    })
  }
  const transaction = parsed.data
  const requestHash = digest(transaction)
  const replayed = replayedCommit(context, transaction, requestHash)
  if (replayed) return replayed
  const stale = conflict(context, transaction, requestHash)
  if (stale) return stale

  let candidate = context.document
  for (const [commandIndex, command] of transaction.commands.entries()) {
    try {
      candidate = applyCommand(candidate, command)
    } catch (error) {
      return commandFailure(
        context,
        transaction,
        requestHash,
        command,
        commandIndex,
        error
      )
    }
  }

  if (transaction.mode === "commit") {
    candidate = appendTransactionReceipt(candidate, transaction, requestHash)
  }
  const issues = validateDocument(candidate)
  const blocking = issues.filter((issue) => issue.severity === "error")
  if (blocking.length) {
    return invalidResult(
      context,
      transaction,
      {
        code: "validation_failed",
        message: blocking[0]?.message ?? "The transaction is invalid.",
        issues: blocking,
      },
      transaction
    )
  }

  return {
    ok: true,
    status: statusForMode(transaction.mode),
    transactionId: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    requestHash,
    mode: transaction.mode,
    base: emptyIdentity(context),
    result: {
      documentId: candidate.id,
      revision: candidate.revision,
      snapshotId: null,
      operationVersion: context.operationVersion + 1,
    },
    commandCount: transaction.commands.length,
    changed: candidate !== context.document,
    warnings: issues.filter((issue) => issue.severity === "warning"),
    document: candidate,
    replayed: false,
  }
}

type StoredSceneTransactionResult = Readonly<{ requestHash: string }>

/**
 * Bounded replay protection for non-committing calls in one API session.
 * Commit receipts live in the canonical document and survive save and reload.
 */
export class SceneTransactionExecutor {
  readonly #receipts = new Map<string, StoredSceneTransactionResult>()

  execute(
    context: SceneTransactionContext,
    input: unknown
  ): SceneTransactionResult {
    const serialized = serializedRequest(input)
    if (
      serialized === null ||
      utf8ToBytes(serialized).byteLength > SCENE_TRANSACTION_MAX_BYTES
    ) {
      return executeSceneTransaction(context, input)
    }
    const parsed = sceneTransactionSchema.safeParse(input)
    if (!parsed.success) return executeSceneTransaction(context, input)
    if (parsed.data.expected.documentId !== context.document.id) {
      return executeSceneTransaction(context, parsed.data)
    }
    const requestHash = digest(parsed.data)
    const receiptKey = `${parsed.data.expected.documentId}:${parsed.data.idempotencyKey}`
    const existing = this.#receipts.get(receiptKey)
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return invalidResult(
          context,
          parsed.data,
          {
            code: "idempotency_key_reused",
            message:
              "That idempotency key was already used for a different transaction.",
          },
          parsed.data
        )
      }
      const replay = executeSceneTransaction(context, parsed.data)
      return replay.ok && !replay.replayed
        ? { ...replay, replayed: true }
        : replay
    }
    const result = executeSceneTransaction(context, parsed.data)
    if (!result.ok) return result
    if (this.#receipts.size >= SCENE_TRANSACTION_RECEIPT_LIMIT) {
      const oldest = this.#receipts.keys().next().value
      if (typeof oldest === "string") this.#receipts.delete(oldest)
    }
    this.#receipts.set(receiptKey, { requestHash })
    return result
  }

  get size() {
    return this.#receipts.size
  }
}
