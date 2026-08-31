import { catalogIdSchema } from "@webmcp/document"
import type { DocumentDraftRecord } from "./document-draft-repository"

export type LibraryTemplateCreateResult =
  | Readonly<{ succeeded: false; completionId: null }>
  | Readonly<{ succeeded: true; completionId: string | null }>

export const failedLibraryTemplateCreate = (): LibraryTemplateCreateResult => ({
  succeeded: false,
  completionId: null,
})

export const completedLibraryTemplateCreate = (
  record: DocumentDraftRecord | null,
  installedDocumentId: string
): LibraryTemplateCreateResult => {
  if (
    !record ||
    record.summary.deletedAt !== null ||
    record.summary.documentId !== installedDocumentId ||
    record.envelope.document.id !== installedDocumentId
  ) {
    return { succeeded: true, completionId: null }
  }

  const completionId = catalogIdSchema.safeParse(record.summary.documentId)
  return {
    succeeded: true,
    completionId: completionId.success ? completionId.data : null,
  }
}
