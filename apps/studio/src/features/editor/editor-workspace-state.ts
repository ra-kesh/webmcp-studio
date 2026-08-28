import {
  assertEditorWorkspaceId,
  createEditorWorkspaceRecord,
  decodeEditorWorkspaceRecord,
  encodeEditorWorkspaceRecord,
  parseEditorWorkspaceRecord,
  pruneEditorWorkspaceRecord as pruneWorkspaceRecord,
} from "@webmcp/editor/page-guides"
import type {
  EditorWorkspaceDecodeError,
  EditorWorkspacePreferences,
  EditorWorkspaceRecordV1,
  EditorWorkspaceScope as CoreEditorWorkspaceScope,
  PageGuide,
} from "@webmcp/editor/page-guides"

export const EDITOR_WORKSPACE_STORAGE_KEY = "webmcp-studio:editor-workspace:v1"
export const EDITOR_WORKSPACE_QUARANTINE_KEY_PREFIX =
  "webmcp-studio:editor-workspace-quarantine:v1"

export type EditorWorkspaceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

export type EditorWorkspaceQuarantineRecordV1 = Readonly<{
  version: 1
  sourceStorageKey: string
  capturedAt: string
  failure: Readonly<{
    code: EditorWorkspaceDecodeError["code"]
    path: string
    message: string
  }>
  raw: string
}>

export type EditorWorkspaceLoadResult =
  | Readonly<{
      status: "empty" | "restored"
      record: EditorWorkspaceRecordV1
    }>
  | Readonly<{
      status: "recovered"
      record: EditorWorkspaceRecordV1
      failure: EditorWorkspaceDecodeError
      rawPreservedAt: "quarantine" | "source"
      quarantineKey: string | null
    }>
  | Readonly<{
      status: "unavailable"
      record: EditorWorkspaceRecordV1
      error: Error
    }>

export type EditorWorkspaceSaveResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>

export type EditorWorkspaceScope = CoreEditorWorkspaceScope

function asError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback)
}

function copyRecord(record: EditorWorkspaceRecordV1) {
  return decodeEditorWorkspaceRecord(record)
}

function ownValue<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string
): TValue | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined
}

export function getPageGuides(
  record: EditorWorkspaceRecordV1,
  documentId: string,
  pageId: string
): readonly PageGuide[] {
  return (
    ownValue(
      ownValue(record.documents, documentId)?.pages ?? {},
      pageId
    )?.guides.map((guide) => ({
      ...guide,
    })) ?? []
  )
}

export function setEditorWorkspacePreferences(
  record: EditorWorkspaceRecordV1,
  preferences: EditorWorkspacePreferences
): EditorWorkspaceRecordV1 {
  return decodeEditorWorkspaceRecord({
    ...record,
    preferences: { ...preferences },
  })
}

export function setPageGuides(
  record: EditorWorkspaceRecordV1,
  documentId: string,
  pageId: string,
  guides: readonly PageGuide[]
): EditorWorkspaceRecordV1 {
  assertEditorWorkspaceId(documentId, "documentId")
  assertEditorWorkspaceId(pageId, "pageId")
  const source = copyRecord(record)
  const documents = { ...source.documents }
  const existingDocument = ownValue(documents, documentId)
  const pages = { ...existingDocument?.pages }

  if (guides.length === 0) {
    delete pages[pageId]
    if (Object.keys(pages).length === 0) delete documents[documentId]
    else documents[documentId] = { pages }
  } else {
    pages[pageId] = { guides: guides.map((guide) => ({ ...guide })) }
    documents[documentId] = { pages }
  }

  return decodeEditorWorkspaceRecord({ ...source, documents })
}

export function pruneEditorWorkspaceRecord(
  record: EditorWorkspaceRecordV1,
  scope: EditorWorkspaceScope
): EditorWorkspaceRecordV1 {
  return pruneWorkspaceRecord(record, scope)
}

export function createEditorWorkspaceQuarantineRecord(
  raw: string,
  failure: EditorWorkspaceDecodeError,
  capturedAt = new Date().toISOString()
): EditorWorkspaceQuarantineRecordV1 {
  return {
    version: 1,
    sourceStorageKey: EDITOR_WORKSPACE_STORAGE_KEY,
    capturedAt,
    failure: {
      code: failure.code,
      path: failure.path,
      message: failure.message,
    },
    raw,
  }
}

export function parseEditorWorkspaceQuarantineRecord(
  serialized: string | null
): EditorWorkspaceQuarantineRecordV1 | null {
  if (!serialized) return null
  try {
    const value = JSON.parse(
      serialized
    ) as Partial<EditorWorkspaceQuarantineRecordV1>
    const failure = value.failure as
      Partial<EditorWorkspaceQuarantineRecordV1["failure"]> | undefined
    if (
      value.version !== 1 ||
      value.sourceStorageKey !== EDITOR_WORKSPACE_STORAGE_KEY ||
      typeof value.capturedAt !== "string" ||
      typeof value.raw !== "string" ||
      !failure ||
      ![
        "invalid_json",
        "invalid_shape",
        "unsupported_version",
        "limit_exceeded",
      ].includes(failure.code ?? "") ||
      typeof failure.path !== "string" ||
      typeof failure.message !== "string"
    ) {
      return null
    }
    return value as EditorWorkspaceQuarantineRecordV1
  } catch {
    return null
  }
}

function quarantineKey(capturedAt: string) {
  return `${EDITOR_WORKSPACE_QUARANTINE_KEY_PREFIX}:${capturedAt.replaceAll(":", "-")}`
}

function availableQuarantineKey(
  storage: EditorWorkspaceStorage,
  capturedAt: string
) {
  const base = quarantineKey(capturedAt)
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}:${suffix}`
    if (storage.getItem(candidate) === null) return candidate
  }
  throw new Error("Editor workspace quarantine is full for this timestamp.")
}

export class EditorWorkspaceRepository {
  readonly #storage: EditorWorkspaceStorage
  readonly #now: () => string

  constructor(
    storage: EditorWorkspaceStorage,
    options: { now?: () => string } = {}
  ) {
    this.#storage = storage
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  load(): EditorWorkspaceLoadResult {
    let raw: string | null
    try {
      raw = this.#storage.getItem(EDITOR_WORKSPACE_STORAGE_KEY)
    } catch (error) {
      return {
        status: "unavailable",
        record: createEditorWorkspaceRecord(),
        error: asError(error, "Editor workspace storage could not be read."),
      }
    }
    if (raw === null) {
      return { status: "empty", record: createEditorWorkspaceRecord() }
    }

    const decoded = parseEditorWorkspaceRecord(raw)
    if (decoded.ok) return { status: "restored", record: decoded.record }

    const capturedAt = this.#now()
    const quarantine = createEditorWorkspaceQuarantineRecord(
      raw,
      decoded.error,
      capturedAt
    )
    let key: string
    try {
      key = availableQuarantineKey(this.#storage, capturedAt)
      this.#storage.setItem(key, JSON.stringify(quarantine))
    } catch {
      return {
        status: "recovered",
        record: createEditorWorkspaceRecord(),
        failure: decoded.error,
        rawPreservedAt: "source",
        quarantineKey: null,
      }
    }
    try {
      this.#storage.removeItem(EDITOR_WORKSPACE_STORAGE_KEY)
    } catch {
      // The quarantine copy is complete, so retaining the source is safe.
    }
    return {
      status: "recovered",
      record: createEditorWorkspaceRecord(),
      failure: decoded.error,
      rawPreservedAt: "quarantine",
      quarantineKey: key,
    }
  }

  save(record: EditorWorkspaceRecordV1): EditorWorkspaceSaveResult {
    try {
      this.#storage.setItem(
        EDITOR_WORKSPACE_STORAGE_KEY,
        encodeEditorWorkspaceRecord(record)
      )
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: asError(error, "Editor workspace storage could not be written."),
      }
    }
  }

  prune(
    record: EditorWorkspaceRecordV1,
    scope: EditorWorkspaceScope
  ): EditorWorkspaceRecordV1 {
    const pruned = pruneEditorWorkspaceRecord(record, scope)
    const result = this.save(pruned)
    if (!result.ok) throw result.error
    return pruned
  }
}
