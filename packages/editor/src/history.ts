import {
  applyCommand,
  type Document,
  type DocumentCommand,
} from "@webmcp/document"

export const HISTORY_LIMIT = 100
export const HISTORY_COALESCE_WINDOW_MS = 300

export type HistoryEntry = {
  id: string
  label: string
  committedAt: number
  coalesceKey?: string
  before: Document
  after: Document
  beforeSnapshotId: string
  afterSnapshotId: string
}

export type DocumentHistory = {
  document: Document
  snapshotId: string
  operationVersion: number
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export type HistoryCommitOptions = {
  label?: string
  coalesceKey?: string
  committedAt?: number
  snapshotId?: string
}

const createSnapshotId = (seed?: string) =>
  `snapshot-${seed ?? crypto.randomUUID()}`

const commandLabel = (commands: DocumentCommand[]) => {
  const types = new Set(commands.map((command) => command.type))
  if (types.size > 1) return "Update document"
  switch (commands[0]?.type) {
    case "add_node":
      return "Add layer"
    case "update_node":
      return "Update layer"
    case "replace_image_source":
      return "Replace image"
    case "remove_node":
      return "Delete layer"
    case "reorder_node":
      return "Reorder layer"
    case "reorder_nodes":
      return "Reorder layers"
    case "reparent_node":
      return "Move layer into group"
    case "reparent_group":
      return "Move group"
    case "group_nodes":
      return "Group layers"
    case "ungroup_nodes":
      return "Ungroup layers"
    case "add_field":
      return "Add field"
    case "update_field":
      return "Update field"
    case "remove_field":
      return "Delete field"
    case "set_field":
      return "Update field value"
    case "bind_field":
      return "Bind field"
    case "unbind_field":
      return "Unbind field"
    case "add_page":
      return "Add page"
    case "duplicate_page":
      return "Duplicate page"
    case "duplicate_nodes":
      return "Duplicate layers"
    case "update_page":
      return "Update page"
    case "remove_page":
      return "Delete page"
    case "reorder_page":
      return "Reorder page"
    case "add_output":
      return "Add output"
    case "update_output":
      return "Update output"
    case "remove_output":
      return "Delete output"
    case "add_output_variant":
      return "Add output variant"
    case "update_group":
      return "Update group"
    default:
      return "Update document"
  }
}

const bounded = (entries: HistoryEntry[]) => entries.slice(-HISTORY_LIMIT)

export function createDocumentHistory(
  document: Document,
  initialSnapshotId = createSnapshotId()
): DocumentHistory {
  return {
    document,
    snapshotId: initialSnapshotId,
    operationVersion: 0,
    past: [],
    future: [],
  }
}

export function commitCommands(
  history: DocumentHistory,
  commands: DocumentCommand[],
  options: HistoryCommitOptions = {}
): DocumentHistory {
  if (!commands.length) return history
  const document = commands.reduce(applyCommand, history.document)
  const committedAt = options.committedAt ?? Date.now()
  const afterSnapshotId =
    options.snapshotId ?? createSnapshotId(commands.at(-1)?.id)
  const entry: HistoryEntry = {
    id: `transaction-${commands.at(-1)?.id ?? crypto.randomUUID()}`,
    label: options.label ?? commandLabel(commands),
    committedAt,
    coalesceKey: options.coalesceKey,
    before: history.document,
    after: document,
    beforeSnapshotId: history.snapshotId,
    afterSnapshotId,
  }
  const previous = history.past.at(-1)
  const shouldCoalesce =
    Boolean(entry.coalesceKey) &&
    previous !== undefined &&
    previous.coalesceKey === entry.coalesceKey &&
    committedAt - previous.committedAt <= HISTORY_COALESCE_WINDOW_MS
  const past =
    shouldCoalesce && previous
      ? [
          ...history.past.slice(0, -1),
          {
            ...entry,
            id: previous.id,
            before: previous.before,
            beforeSnapshotId: previous.beforeSnapshotId,
          },
        ]
      : [...history.past, entry]
  return {
    document,
    snapshotId: afterSnapshotId,
    operationVersion: history.operationVersion + 1,
    past: bounded(past),
    future: [],
  }
}

export function replaceDocument(
  history: DocumentHistory,
  document: Document,
  options: HistoryCommitOptions = {}
): DocumentHistory {
  const committedAt = options.committedAt ?? Date.now()
  const afterSnapshotId = options.snapshotId ?? createSnapshotId()
  const entry: HistoryEntry = {
    id: `transaction-${crypto.randomUUID()}`,
    label: options.label ?? "Replace document",
    committedAt,
    coalesceKey: options.coalesceKey,
    before: history.document,
    after: document,
    beforeSnapshotId: history.snapshotId,
    afterSnapshotId,
  }
  return {
    document,
    snapshotId: afterSnapshotId,
    operationVersion: history.operationVersion + 1,
    past: bounded([...history.past, entry]),
    future: [],
  }
}

export function undoDocument(history: DocumentHistory): DocumentHistory {
  const entry = history.past.at(-1)
  if (!entry) return history
  return {
    document: entry.before,
    snapshotId: entry.beforeSnapshotId,
    operationVersion: history.operationVersion + 1,
    past: history.past.slice(0, -1),
    future: [entry, ...history.future].slice(0, HISTORY_LIMIT),
  }
}

export function redoDocument(history: DocumentHistory): DocumentHistory {
  const [entry, ...future] = history.future
  if (!entry) return history
  return {
    document: entry.after,
    snapshotId: entry.afterSnapshotId,
    operationVersion: history.operationVersion + 1,
    past: bounded([...history.past, entry]),
    future,
  }
}
