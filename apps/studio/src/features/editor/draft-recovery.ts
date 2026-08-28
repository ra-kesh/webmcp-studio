import {
  DocumentMigrationError,
  DocumentValidationError,
  decodeDocument,
  validateDocument,
} from "@webmcp/document"
import type { Document, ValidationIssue } from "@webmcp/document"

export const DRAFT_RECOVERY_STORAGE_KEY = "webmcp-studio:draft-recovery:v1"

export type DraftRecoveryFailureKind =
  "malformed_json" | "schema_invalid" | "migration_failed" | "aggregate_invalid"

export type DraftRecoveryFailure = {
  kind: DraftRecoveryFailureKind
  message: string
  issue?: ValidationIssue
}

export type DraftRecoveryRecord = {
  schemaVersion: 1
  sourceStorageKey: string
  capturedAt: string
  failure: DraftRecoveryFailure
  raw: string
}

export type DraftDecodeResult =
  | { ok: true; document: Document }
  | { ok: false; failure: DraftRecoveryFailure }

type DraftMigration = (document: Document) => Document

const identityMigration: DraftMigration = (document) => document

function schemaFailureMessage(path: PropertyKey[], message: string) {
  const location = path.length ? ` at ${path.join(".")}` : ""
  return `The saved draft does not match this version of Studio${location}: ${message}`
}

export function decodeStoredDraft(
  raw: string,
  migrate: DraftMigration = identityMigration
): DraftDecodeResult {
  let unknownDocument: unknown
  try {
    unknownDocument = JSON.parse(raw) as unknown
  } catch {
    return {
      ok: false,
      failure: {
        kind: "malformed_json",
        message: "The saved draft is not valid JSON.",
      },
    }
  }

  let decoded: ReturnType<typeof decodeDocument>
  try {
    decoded = decodeDocument(unknownDocument)
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      const issue = error.issues[0]
      return {
        ok: false,
        failure: {
          kind: "aggregate_invalid",
          message: `The saved draft has invalid document relationships: ${issue.message}`,
          issue,
        },
      }
    }
    return {
      ok: false,
      failure: {
        kind:
          error instanceof DocumentMigrationError
            ? "migration_failed"
            : "schema_invalid",
        message:
          error instanceof DocumentMigrationError
            ? error.message
            : schemaFailureMessage([], "the document shape is invalid"),
      },
    }
  }

  let migrated: Document
  try {
    migrated = migrate(decoded.document)
  } catch {
    return {
      ok: false,
      failure: {
        kind: "migration_failed",
        message: "The saved draft could not be migrated safely.",
      },
    }
  }

  const blockingIssue = validateDocument(migrated).find(
    (issue) => issue.severity === "error"
  )
  if (blockingIssue) {
    return {
      ok: false,
      failure: {
        kind: "aggregate_invalid",
        message: `The saved draft has invalid document relationships: ${blockingIssue.message}`,
        issue: blockingIssue,
      },
    }
  }

  return { ok: true, document: migrated }
}

export function createDraftRecoveryRecord({
  sourceStorageKey,
  raw,
  failure,
  capturedAt = new Date().toISOString(),
}: {
  sourceStorageKey: string
  raw: string
  failure: DraftRecoveryFailure
  capturedAt?: string
}): DraftRecoveryRecord {
  return {
    schemaVersion: 1,
    sourceStorageKey,
    capturedAt,
    failure,
    raw,
  }
}

export function parseDraftRecoveryRecord(
  serialized: string | null
): DraftRecoveryRecord | null {
  if (!serialized) return null
  try {
    const value = JSON.parse(serialized) as Partial<DraftRecoveryRecord>
    const failure = value.failure as Partial<DraftRecoveryFailure> | undefined
    if (
      value.schemaVersion !== 1 ||
      typeof value.sourceStorageKey !== "string" ||
      typeof value.capturedAt !== "string" ||
      typeof value.raw !== "string" ||
      !failure ||
      ![
        "malformed_json",
        "schema_invalid",
        "migration_failed",
        "aggregate_invalid",
      ].includes(failure.kind ?? "") ||
      typeof failure.message !== "string"
    ) {
      return null
    }
    return value as DraftRecoveryRecord
  } catch {
    return null
  }
}
