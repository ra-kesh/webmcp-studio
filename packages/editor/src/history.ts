import type { Document, DocumentCommand } from "@webmcp/document"
import {
  admitCanonicalHistoryDocument,
  applyCanonicalHistoryCommand,
} from "@webmcp/document/internal/history"

export const HISTORY_LIMIT = 100
export const HISTORY_MAX_BYTES = 16 * 1024 * 1024
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
  approximateBytes: number
}

export type DocumentHistory = {
  document: Document
  snapshotId: string
  operationVersion: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  pastBytes: number
  futureBytes: number
  maxBytes: number
}

export type DocumentHistoryOptions = {
  maxBytes?: number
}

export type DocumentHistoryCommit = Readonly<{
  id: string
  committedAt: number
  label: string
  undoable: boolean
}>

export type DocumentHistoryCommitResult = Readonly<{
  history: DocumentHistory
  commit: DocumentHistoryCommit
}>

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
    case "create_component":
      return "Create component"
    case "update_component":
      return "Update component"
    case "delete_component":
      return "Delete component"
    case "create_component_variant":
      return "Create component variant"
    case "update_component_variant":
      return "Update component variant"
    case "delete_component_variant":
      return "Delete component variant"
    case "create_component_instance":
      return "Create component instance"
    case "switch_component_variant":
      return "Switch component variant"
    case "update_component_instance":
      return "Update component override"
    case "update_component_instance_metadata":
      return "Update component instance"
    case "reset_component_override":
      return "Reset component override"
    case "reset_all_component_overrides":
      return "Reset component overrides"
    case "detach_component_instance":
      return "Detach component instance"
    case "synchronize_component_instances":
      return "Synchronize component instances"
    case "create_typography_style":
      return "Create text style"
    case "update_typography_style":
      return "Update text style"
    case "delete_typography_style":
      return "Delete text style"
    case "apply_typography_style":
      return "Apply text style"
    case "detach_typography_style":
      return "Detach text style"
    case "create_paint_style":
      return "Create paint style"
    case "update_paint_style":
      return "Update paint style"
    case "delete_paint_style":
      return "Delete paint style"
    case "apply_paint_style":
      return "Apply paint style"
    case "detach_paint_style":
      return "Detach paint style"
    case "create_variable":
      return "Create variable"
    case "update_variable":
      return "Update variable"
    case "delete_variable":
      return "Delete variable"
    case "bind_variable":
      return "Bind variable"
    case "unbind_variable":
      return "Unbind variable"
    case "replace_image_source":
      return "Replace image"
    case "create_mask_group":
      return "Create mask"
    case "release_mask_group":
      return "Release mask"
    case "set_mask_type":
      return "Change mask type"
    case "set_mask_sources":
      return "Change mask sources"
    case "relink_asset_references":
      return "Make image available everywhere"
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

const withApproximateBytes = (
  entry: Omit<HistoryEntry, "approximateBytes">
): HistoryEntry => ({
  ...entry,
  // Canonical documents contain no asset Blob bodies. UTF-16 JSON bytes are a
  // deterministic, conservative approximation of the retained JS payload.
  approximateBytes: JSON.stringify(entry).length * 2,
})

const approximateHistoryBytes = (entries: readonly HistoryEntry[]) =>
  entries.reduce((bytes, entry) => bytes + entry.approximateBytes, 0)

const normalizeMaxBytes = (maxBytes: number | undefined) => {
  if (maxBytes === undefined) return HISTORY_MAX_BYTES
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new Error("History maxBytes must be a finite non-negative number")
  }
  return Math.floor(maxBytes)
}

const boundedPast = (entries: HistoryEntry[], maxBytes: number) => {
  const retained = entries.slice(-HISTORY_LIMIT)
  let bytes = approximateHistoryBytes(retained)
  while (retained.length && bytes > maxBytes) {
    retained.shift()
    bytes = approximateHistoryBytes(retained)
  }
  return { entries: retained, bytes }
}

const boundedFuture = (entries: HistoryEntry[], maxBytes: number) => {
  const retained = entries.slice(0, HISTORY_LIMIT)
  let bytes = approximateHistoryBytes(retained)
  while (retained.length && bytes > maxBytes) {
    retained.pop()
    bytes = approximateHistoryBytes(retained)
  }
  return { entries: retained, bytes }
}

export function createDocumentHistory(
  document: Document,
  initialSnapshotId = createSnapshotId(),
  options: DocumentHistoryOptions = {}
): DocumentHistory {
  return {
    document: admitCanonicalHistoryDocument(document),
    snapshotId: initialSnapshotId,
    operationVersion: 0,
    past: [],
    future: [],
    pastBytes: 0,
    futureBytes: 0,
    maxBytes: normalizeMaxBytes(options.maxBytes),
  }
}

export function commitCommandsWithResult(
  history: DocumentHistory,
  commands: DocumentCommand[],
  options: HistoryCommitOptions = {}
): DocumentHistoryCommitResult | null {
  if (!commands.length) return null
  const document = commands.reduce(
    applyCanonicalHistoryCommand,
    history.document
  )
  if (document === history.document) return null
  const committedAt = options.committedAt ?? Date.now()
  const afterSnapshotId =
    options.snapshotId ?? createSnapshotId(commands.at(-1)?.id)
  const entry = withApproximateBytes({
    id: `transaction-${commands.at(-1)?.id ?? crypto.randomUUID()}`,
    label: options.label ?? commandLabel(commands),
    committedAt,
    coalesceKey: options.coalesceKey,
    before: history.document,
    after: document,
    beforeSnapshotId: history.snapshotId,
    afterSnapshotId,
  })
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
          withApproximateBytes({
            id: previous.id,
            label: entry.label,
            committedAt: entry.committedAt,
            coalesceKey: entry.coalesceKey,
            before: previous.before,
            after: entry.after,
            beforeSnapshotId: previous.beforeSnapshotId,
            afterSnapshotId: entry.afterSnapshotId,
          }),
        ]
      : [...history.past, entry]
  const bounded = boundedPast(past, history.maxBytes)
  const retainedEntry = bounded.entries.at(-1)
  const undoable = retainedEntry?.afterSnapshotId === afterSnapshotId
  return {
    history: {
      document,
      snapshotId: afterSnapshotId,
      operationVersion: history.operationVersion + 1,
      past: bounded.entries,
      future: [],
      pastBytes: bounded.bytes,
      futureBytes: 0,
      maxBytes: history.maxBytes,
    },
    commit: {
      id: undoable && retainedEntry ? retainedEntry.id : entry.id,
      committedAt: entry.committedAt,
      label: entry.label,
      undoable,
    },
  }
}

export function commitCommands(
  history: DocumentHistory,
  commands: DocumentCommand[],
  options: HistoryCommitOptions = {}
): DocumentHistory {
  return (
    commitCommandsWithResult(history, commands, options)?.history ?? history
  )
}

export function replaceDocumentWithResult(
  history: DocumentHistory,
  document: Document,
  options: HistoryCommitOptions = {}
): DocumentHistoryCommitResult {
  const canonicalDocument = admitCanonicalHistoryDocument(document)
  const committedAt = options.committedAt ?? Date.now()
  const afterSnapshotId = options.snapshotId ?? createSnapshotId()
  const entry = withApproximateBytes({
    id: `transaction-${crypto.randomUUID()}`,
    label: options.label ?? "Replace document",
    committedAt,
    coalesceKey: options.coalesceKey,
    before: history.document,
    after: canonicalDocument,
    beforeSnapshotId: history.snapshotId,
    afterSnapshotId,
  })
  const bounded = boundedPast([...history.past, entry], history.maxBytes)
  const undoable = bounded.entries.at(-1)?.afterSnapshotId === afterSnapshotId
  return {
    history: {
      document: canonicalDocument,
      snapshotId: afterSnapshotId,
      operationVersion: history.operationVersion + 1,
      past: bounded.entries,
      future: [],
      pastBytes: bounded.bytes,
      futureBytes: 0,
      maxBytes: history.maxBytes,
    },
    commit: {
      id: entry.id,
      committedAt: entry.committedAt,
      label: entry.label,
      undoable,
    },
  }
}

export function replaceDocument(
  history: DocumentHistory,
  document: Document,
  options: HistoryCommitOptions = {}
): DocumentHistory {
  return replaceDocumentWithResult(history, document, options).history
}

export function undoDocument(history: DocumentHistory): DocumentHistory {
  const entry = history.past.at(-1)
  if (!entry) return history
  const past = history.past.slice(0, -1)
  const future = boundedFuture([entry, ...history.future], history.maxBytes)
  return {
    document: entry.before,
    snapshotId: entry.beforeSnapshotId,
    operationVersion: history.operationVersion + 1,
    past,
    future: future.entries,
    pastBytes: approximateHistoryBytes(past),
    futureBytes: future.bytes,
    maxBytes: history.maxBytes,
  }
}

export function redoDocument(history: DocumentHistory): DocumentHistory {
  const [entry, ...future] = history.future
  if (!entry) return history
  const past = boundedPast([...history.past, entry], history.maxBytes)
  return {
    document: entry.after,
    snapshotId: entry.afterSnapshotId,
    operationVersion: history.operationVersion + 1,
    past: past.entries,
    future,
    pastBytes: past.bytes,
    futureBytes: approximateHistoryBytes(future),
    maxBytes: history.maxBytes,
  }
}

export function clearDocumentRedoHistory(
  history: DocumentHistory
): DocumentHistory {
  if (!history.future.length) return history
  return {
    ...history,
    future: [],
    futureBytes: 0,
  }
}

export function breakDocumentHistoryCoalescing(
  history: DocumentHistory
): DocumentHistory {
  const previous = history.past.at(-1)
  if (!previous?.coalesceKey) return history
  const replacement = withApproximateBytes({
    id: previous.id,
    label: previous.label,
    committedAt: previous.committedAt,
    before: previous.before,
    after: previous.after,
    beforeSnapshotId: previous.beforeSnapshotId,
    afterSnapshotId: previous.afterSnapshotId,
  })
  const past = [...history.past.slice(0, -1), replacement]
  return {
    ...history,
    past,
    pastBytes: approximateHistoryBytes(past),
  }
}
