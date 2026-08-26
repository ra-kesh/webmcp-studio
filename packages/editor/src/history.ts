import {
  applyCommand,
  type Document,
  type DocumentCommand,
} from "@webmcp/document"

export type DocumentHistory = {
  document: Document
  past: Document[]
  future: Document[]
}

export function createDocumentHistory(document: Document): DocumentHistory {
  return { document, past: [], future: [] }
}

export function commitCommands(
  history: DocumentHistory,
  commands: DocumentCommand[]
): DocumentHistory {
  if (!commands.length) return history
  const document = commands.reduce(applyCommand, history.document)
  return {
    document,
    past: [...history.past.slice(-99), history.document],
    future: [],
  }
}

export function replaceDocument(
  history: DocumentHistory,
  document: Document
): DocumentHistory {
  return {
    document,
    past: [...history.past.slice(-99), history.document],
    future: [],
  }
}

export function undoDocument(history: DocumentHistory): DocumentHistory {
  const document = history.past.at(-1)
  if (!document) return history
  return {
    document,
    past: history.past.slice(0, -1),
    future: [history.document, ...history.future.slice(0, 99)],
  }
}

export function redoDocument(history: DocumentHistory): DocumentHistory {
  const [document, ...future] = history.future
  if (!document) return history
  return {
    document,
    past: [...history.past.slice(-99), history.document],
    future,
  }
}
