import {
  changeSetSchema,
  fieldValueMatchesType,
  getChangeSetConflict,
  type ChangeSet,
  type Document,
} from "@webmcp/document"

export type FieldUpdateProposalInput = {
  documentId: string
  baseRevision: number
  values: Record<string, string | number | boolean>
  reason?: string
}

export type ChangeSetIdentityFactory = {
  id(): string
  now(): string
}

export function createFieldUpdateChangeSet(
  document: Document,
  input: FieldUpdateProposalInput,
  identity: ChangeSetIdentityFactory
): ChangeSet {
  const shell: ChangeSet = {
    id: `change-set-${identity.id()}`,
    documentId: input.documentId,
    baseRevision: input.baseRevision,
    title: input.reason?.trim() || "Update shared content",
    createdAt: identity.now(),
    createdBy: "agent",
    status: "pending",
    operations: Object.entries(input.values).flatMap(([key, value]) => {
      const field = document.fields.find((candidate) => candidate.key === key)
      if (!field) throw new Error(`Unknown shared field: ${key}`)
      if (!fieldValueMatchesType(field, value)) {
        throw new Error(`Invalid value for ${field.label}`)
      }
      if (document.fieldValues[field.id] === value) return []
      const bindingCount = document.bindings.filter(
        (binding) => binding.fieldId === field.id
      ).length
      const at = identity.now()
      return [
        {
          id: `operation-${identity.id()}`,
          status: "pending" as const,
          summary: `Update ${field.label} in ${bindingCount} bound layer${bindingCount === 1 ? "" : "s"}`,
          command: {
            id: `command-${identity.id()}`,
            type: "set_field" as const,
            actor: "agent" as const,
            at,
            fieldId: field.id,
            value,
          },
        },
      ]
    }),
  }
  const conflict = getChangeSetConflict(document, shell)
  if (conflict) throw new Error(conflict.message)
  if (!shell.operations.length) {
    throw new Error("The proposed values already match the document.")
  }
  return changeSetSchema.parse(shell)
}
