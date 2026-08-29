import { applyCommandToCanonicalDocumentUnchecked } from "./commands"
import type { Document, DocumentCommand } from "./schema"
import { documentSchema } from "./schema"
import { assertValidCanonicalDocument } from "./validation"

const admittedHistoryDocuments = new WeakSet<Document>()

/**
 * Establishes the invariant required by the identity-preserving history path.
 * Parsing is used as validation only so a trusted canonical object keeps its
 * node/page identities for incremental renderers.
 */
export function admitCanonicalHistoryDocument(input: Document): Document {
  documentSchema.parse(input)
  assertValidCanonicalDocument(input)
  admittedHistoryDocuments.add(input)
  return input
}

export function applyCanonicalHistoryCommand(
  document: Document,
  command: DocumentCommand
): Document {
  if (!admittedHistoryDocuments.has(document)) {
    throw new TypeError(
      "History commands require a document admitted through createDocumentHistory."
    )
  }
  const next = applyCommandToCanonicalDocumentUnchecked(document, command)
  admittedHistoryDocuments.add(next)
  return next
}
