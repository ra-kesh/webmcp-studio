import { applyCommand } from "./commands"
import {
  changeSetSchema,
  type ChangeOperation,
  type ChangeSet,
  type Document,
} from "./schema"

export type ChangeSetConflict = {
  code: "document_mismatch" | "revision_mismatch"
  message: string
  expectedRevision: number
  actualRevision: number
}

export function getChangeSetConflict(
  document: Document,
  changeSet: ChangeSet
): ChangeSetConflict | null {
  if (changeSet.documentId !== document.id) {
    return {
      code: "document_mismatch",
      message: "This proposal belongs to another document.",
      expectedRevision: changeSet.baseRevision,
      actualRevision: document.revision,
    }
  }
  if (changeSet.baseRevision !== document.revision) {
    return {
      code: "revision_mismatch",
      message: `The document changed from revision ${changeSet.baseRevision} to ${document.revision}. Ask the agent to inspect it again.`,
      expectedRevision: changeSet.baseRevision,
      actualRevision: document.revision,
    }
  }
  return null
}

function statusForOperations(
  operations: ChangeOperation[]
): ChangeSet["status"] {
  const accepted = operations.filter(
    (operation) => operation.status === "accepted"
  ).length
  const rejected = operations.filter(
    (operation) => operation.status === "rejected"
  ).length
  if (accepted === operations.length) return "accepted"
  if (rejected === operations.length) return "rejected"
  if (accepted || rejected) return "partially_accepted"
  return "pending"
}

export function decideChangeOperation(
  changeSetInput: ChangeSet,
  operationId: string,
  status: ChangeOperation["status"]
): ChangeSet {
  const changeSet = changeSetSchema.parse(changeSetInput)
  if (!changeSet.operations.some((operation) => operation.id === operationId)) {
    throw new Error(`Unknown change operation: ${operationId}`)
  }
  const operations = changeSet.operations.map((operation) =>
    operation.id === operationId ? { ...operation, status } : operation
  )
  return changeSetSchema.parse({
    ...changeSet,
    operations,
    status: statusForOperations(operations),
  })
}

export function decideAllChangeOperations(
  changeSetInput: ChangeSet,
  status: Exclude<ChangeOperation["status"], "pending">
): ChangeSet {
  const changeSet = changeSetSchema.parse(changeSetInput)
  const operations = changeSet.operations.map((operation) => ({
    ...operation,
    status,
  }))
  return changeSetSchema.parse({
    ...changeSet,
    operations,
    status: statusForOperations(operations),
  })
}

export function previewChangeSet(
  document: Document,
  changeSetInput: ChangeSet
): Document {
  const changeSet = changeSetSchema.parse(changeSetInput)
  const conflict = getChangeSetConflict(document, changeSet)
  if (conflict) throw new Error(conflict.message)
  return changeSet.operations
    .filter((operation) => operation.status !== "rejected")
    .reduce(
      (current, operation) => applyCommand(current, operation.command),
      document
    )
}

export function applyAcceptedChangeSet(
  document: Document,
  changeSetInput: ChangeSet
): Document {
  const changeSet = changeSetSchema.parse(changeSetInput)
  const conflict = getChangeSetConflict(document, changeSet)
  if (conflict) throw new Error(conflict.message)
  return changeSet.operations
    .filter((operation) => operation.status === "accepted")
    .reduce(
      (current, operation) => applyCommand(current, operation.command),
      document
    )
}
