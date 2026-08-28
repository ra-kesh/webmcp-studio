import { z } from "zod"
import {
  builtInDesignTemplateRepository,
  quotationRenderPayloadV1Schema,
} from "@webmcp/document"
import type {
  Document,
  QuotationRenderPayloadV1,
  QuotationTemplateId,
} from "@webmcp/document"
import {
  createDraftRecoveryRecord,
  decodeStoredDraft,
  DRAFT_RECOVERY_STORAGE_KEY,
  parseDraftRecoveryRecord,
} from "./draft-recovery"
import type {
  DraftRecoveryFailure,
  DraftRecoveryRecord,
} from "./draft-recovery"

export const CURRENT_DRAFT_STORAGE_KEY = "webmcp-studio:current-draft:v1"
export const LEGACY_DOCUMENT_STORAGE_KEY = "webmcp-studio:northstar-document:v2"
export const LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY =
  "webmcp-studio:quotation-template:v1"
export const LEGACY_QUOTATION_SOURCE_STORAGE_KEY =
  "webmcp-studio:quotation-source:v1"
export const LEGACY_DESIGN_TEMPLATE_STORAGE_KEY =
  "webmcp-studio:design-template:v1"

const quotationTemplateIdSchema = z.enum([
  "editorial-olive",
  "warm-paper",
  "midnight-film",
])

const designTemplateIdentitySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict()

const sourceContextSchema = z
  .object({
    quotationSource: quotationRenderPayloadV1Schema.nullable(),
    quotationTemplateId: quotationTemplateIdSchema,
    designTemplate: designTemplateIdentitySchema.nullable(),
  })
  .strict()

const envelopeWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    document: z.unknown(),
    sourceContext: sourceContextSchema.nullable(),
  })
  .strict()

const snapshotWireSchema = envelopeWireSchema.omit({ schemaVersion: true })

export type CurrentDraftSourceContext = {
  quotationSource: QuotationRenderPayloadV1 | null
  quotationTemplateId: QuotationTemplateId
  designTemplate: { id: string; version: number } | null
}

export type CurrentDraftSnapshot = {
  document: Document
  sourceContext: CurrentDraftSourceContext | null
}

export type CurrentDraftEnvelope = CurrentDraftSnapshot & {
  schemaVersion: 1
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type DraftStorageProvider = () => DraftStorage

export type DraftStorageFailure = {
  operation:
    | "get_storage"
    | "read_recovery"
    | "read_current"
    | "read_legacy"
    | "write_current"
    | "write_recovery"
    | "cleanup_legacy"
    | "legacy_source_context_discarded"
  message: string
}

export type CurrentDraftBootstrapResult =
  | { status: "empty" }
  | {
      status: "current"
      envelope: CurrentDraftEnvelope
      source: "envelope" | "legacy"
      migrated: boolean
      warnings: DraftStorageFailure[]
    }
  | {
      status: "recovery_required"
      recovery: DraftRecoveryRecord
      recoveryStored: boolean
      storageFailure?: DraftStorageFailure
    }
  | {
      status: "storage_unavailable"
      failure: DraftStorageFailure
      recoverableDraft?: CurrentDraftEnvelope
      legacyBytesPreserved?: true
    }

export type CurrentDraftWriteResult =
  | { ok: true; envelope: CurrentDraftEnvelope }
  | {
      ok: false
      reason: "validation_failed"
      failure: DraftRecoveryFailure
    }
  | {
      ok: false
      reason: "recovery_required"
      recovery: DraftRecoveryRecord
    }
  | {
      ok: false
      reason: "storage_unavailable"
      failure: DraftStorageFailure
    }
  | {
      ok: false
      reason: "capture_failed"
      message: string
    }

type EnvelopeDecodeResult =
  | {
      ok: true
      envelope: CurrentDraftEnvelope
      requiresRewrite: boolean
    }
  | { ok: false; failure: DraftRecoveryFailure }

const legacyKeys = [
  LEGACY_DOCUMENT_STORAGE_KEY,
  LEGACY_QUOTATION_TEMPLATE_STORAGE_KEY,
  LEGACY_QUOTATION_SOURCE_STORAGE_KEY,
  LEGACY_DESIGN_TEMPLATE_STORAGE_KEY,
] as const

const ownedRecoverySourceKeys = new Set<string>([
  CURRENT_DRAFT_STORAGE_KEY,
  LEGACY_DOCUMENT_STORAGE_KEY,
  DRAFT_RECOVERY_STORAGE_KEY,
])

const browserStorage: DraftStorageProvider = () => globalThis.localStorage

function errorDetail(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? ` ${error.message.trim()}`
    : ""
}

function storageFailure(
  operation: DraftStorageFailure["operation"],
  message: string,
  error: unknown
): DraftStorageFailure {
  return { operation, message: `${message}${errorDetail(error)}` }
}

function schemaFailure(message: string): DraftRecoveryFailure {
  return { kind: "schema_invalid", message }
}

function validateSourceContext(
  sourceContext: CurrentDraftSourceContext | null
): DraftRecoveryFailure | null {
  if (!sourceContext?.designTemplate) return null

  let definition: ReturnType<typeof builtInDesignTemplateRepository.get>
  try {
    definition = builtInDesignTemplateRepository.get(
      sourceContext.designTemplate.id,
      sourceContext.designTemplate.version
    )
  } catch {
    return schemaFailure(
      `The saved draft references an unknown immutable design template: ${sourceContext.designTemplate.id}@${sourceContext.designTemplate.version}.`
    )
  }

  if (definition.kind === "quotation_style") {
    if (!sourceContext.quotationSource) {
      return schemaFailure(
        `The saved draft's ${definition.name} template requires its linked quotation source.`
      )
    }
    if (definition.quotationTemplateId !== sourceContext.quotationTemplateId) {
      return schemaFailure(
        `The saved draft's design-template identity does not match its quotation style.`
      )
    }
    return null
  }

  if (sourceContext.quotationSource) {
    return schemaFailure(
      "The saved draft combines a document-starter identity with unrelated quotation source data."
    )
  }
  return null
}

function decodeSnapshotDocument(document: unknown) {
  if (document === undefined) {
    return {
      ok: false as const,
      failure: schemaFailure("The current draft document is missing."),
    }
  }
  let serialized: string
  try {
    serialized = JSON.stringify(document)
  } catch {
    return {
      ok: false as const,
      failure: schemaFailure(
        "The current draft document cannot be serialized safely."
      ),
    }
  }
  return decodeStoredDraft(serialized)
}

export function decodeCurrentDraftEnvelope(raw: string): EnvelopeDecodeResult {
  let unknownEnvelope: unknown
  try {
    unknownEnvelope = JSON.parse(raw) as unknown
  } catch {
    return {
      ok: false,
      failure: {
        kind: "malformed_json",
        message: "The saved current draft is not valid JSON.",
      },
    }
  }

  if (
    unknownEnvelope &&
    typeof unknownEnvelope === "object" &&
    "schemaVersion" in unknownEnvelope &&
    (unknownEnvelope as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    return {
      ok: false,
      failure: {
        kind: "migration_failed",
        message: "This current-draft version cannot be migrated safely.",
      },
    }
  }

  const parsedEnvelope = envelopeWireSchema.safeParse(unknownEnvelope)
  if (!parsedEnvelope.success) {
    const issue = parsedEnvelope.error.issues[0]
    const location = issue.path.length ? ` at ${issue.path.join(".")}` : ""
    return {
      ok: false,
      failure: schemaFailure(
        `The saved current draft has an invalid envelope${location}: ${issue.message}`
      ),
    }
  }

  const serializedDocument = JSON.stringify(parsedEnvelope.data.document)
  const decodedDocument = decodeSnapshotDocument(parsedEnvelope.data.document)
  if (!decodedDocument.ok) return decodedDocument

  const sourceContext = parsedEnvelope.data.sourceContext
  const sourceFailure = validateSourceContext(sourceContext)
  if (sourceFailure) return { ok: false, failure: sourceFailure }

  return {
    ok: true,
    envelope: {
      schemaVersion: 1,
      document: decodedDocument.document,
      sourceContext,
    },
    requiresRewrite:
      JSON.stringify(decodedDocument.document) !== serializedDocument,
  }
}

export function validateCurrentDraftSnapshot(
  snapshot: unknown
):
  | { ok: true; envelope: CurrentDraftEnvelope }
  | { ok: false; failure: DraftRecoveryFailure } {
  const parsedSnapshot = snapshotWireSchema.safeParse(snapshot)
  if (!parsedSnapshot.success) {
    const issue = parsedSnapshot.error.issues[0]
    const location = issue.path.length ? ` at ${issue.path.join(".")}` : ""
    return {
      ok: false,
      failure: schemaFailure(
        `The current draft cannot be saved${location}: ${issue.message}`
      ),
    }
  }

  const decodedDocument = decodeSnapshotDocument(parsedSnapshot.data.document)
  if (!decodedDocument.ok) return decodedDocument
  const sourceFailure = validateSourceContext(parsedSnapshot.data.sourceContext)
  if (sourceFailure) return { ok: false, failure: sourceFailure }

  return {
    ok: true,
    envelope: {
      schemaVersion: 1,
      document: decodedDocument.document,
      sourceContext: parsedSnapshot.data.sourceContext,
    },
  }
}

function acquireStorage(
  getStorage: DraftStorageProvider
):
  | { ok: true; storage: DraftStorage }
  | { ok: false; failure: DraftStorageFailure } {
  try {
    const storage = getStorage()
    return { ok: true, storage }
  } catch (error) {
    return {
      ok: false,
      failure: storageFailure(
        "get_storage",
        "Studio cannot access browser draft storage.",
        error
      ),
    }
  }
}

function readItem(
  storage: DraftStorage,
  key: string,
  operation: "read_recovery" | "read_current" | "read_legacy"
):
  | { ok: true; raw: string | null }
  | { ok: false; failure: DraftStorageFailure } {
  try {
    return { ok: true, raw: storage.getItem(key) }
  } catch (error) {
    return {
      ok: false,
      failure: storageFailure(
        operation,
        "Studio cannot read browser draft storage.",
        error
      ),
    }
  }
}

function matchingRecovery(raw: string | null) {
  const recovery = parseDraftRecoveryRecord(raw)
  return recovery && ownedRecoverySourceKeys.has(recovery.sourceStorageKey)
    ? recovery
    : null
}

function persistRecovery(
  storage: DraftStorage,
  recovery: DraftRecoveryRecord
): { ok: true } | { ok: false; failure: DraftStorageFailure } {
  try {
    storage.setItem(DRAFT_RECOVERY_STORAGE_KEY, JSON.stringify(recovery))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      failure: storageFailure(
        "write_recovery",
        "Studio cannot create a second browser recovery copy.",
        error
      ),
    }
  }
}

function recoveryResult(
  storage: DraftStorage,
  sourceStorageKey: string,
  raw: string,
  failure: DraftRecoveryFailure,
  capturedAt: string
): Extract<CurrentDraftBootstrapResult, { status: "recovery_required" }> {
  const recovery = createDraftRecoveryRecord({
    sourceStorageKey,
    raw,
    failure,
    capturedAt,
  })
  const persisted = persistRecovery(storage, recovery)
  return persisted.ok
    ? { status: "recovery_required", recovery, recoveryStored: true }
    : {
        status: "recovery_required",
        recovery,
        recoveryStored: false,
        storageFailure: persisted.failure,
      }
}

function writeEnvelope(
  storage: DraftStorage,
  envelope: CurrentDraftEnvelope
): { ok: true } | { ok: false; failure: DraftStorageFailure } {
  try {
    storage.setItem(CURRENT_DRAFT_STORAGE_KEY, JSON.stringify(envelope))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      failure: storageFailure(
        "write_current",
        "Studio cannot save the current browser draft.",
        error
      ),
    }
  }
}

export function bootstrapCurrentDraft({
  getStorage = browserStorage,
  now = () => new Date().toISOString(),
}: {
  getStorage?: DraftStorageProvider
  now?: () => string
} = {}): CurrentDraftBootstrapResult {
  const acquired = acquireStorage(getStorage)
  if (!acquired.ok) {
    return { status: "storage_unavailable", failure: acquired.failure }
  }
  const { storage } = acquired

  const recoveryRead = readItem(
    storage,
    DRAFT_RECOVERY_STORAGE_KEY,
    "read_recovery"
  )
  if (!recoveryRead.ok) {
    return { status: "storage_unavailable", failure: recoveryRead.failure }
  }
  const recovery = matchingRecovery(recoveryRead.raw)
  if (recovery) {
    return { status: "recovery_required", recovery, recoveryStored: true }
  }
  if (recoveryRead.raw !== null) {
    return recoveryResult(
      storage,
      DRAFT_RECOVERY_STORAGE_KEY,
      recoveryRead.raw,
      schemaFailure("The browser draft recovery record is invalid."),
      now()
    )
  }

  const currentRead = readItem(
    storage,
    CURRENT_DRAFT_STORAGE_KEY,
    "read_current"
  )
  if (!currentRead.ok) {
    return { status: "storage_unavailable", failure: currentRead.failure }
  }
  if (currentRead.raw !== null) {
    const decoded = decodeCurrentDraftEnvelope(currentRead.raw)
    if (!decoded.ok) {
      return recoveryResult(
        storage,
        CURRENT_DRAFT_STORAGE_KEY,
        currentRead.raw,
        decoded.failure,
        now()
      )
    }
    if (decoded.requiresRewrite) {
      const rewritten = writeEnvelope(storage, decoded.envelope)
      if (!rewritten.ok) {
        return {
          status: "storage_unavailable",
          failure: rewritten.failure,
          recoverableDraft: decoded.envelope,
        }
      }
    }
    return {
      status: "current",
      envelope: decoded.envelope,
      source: "envelope",
      migrated: decoded.requiresRewrite,
      warnings: [],
    }
  }

  const legacyRead = readItem(
    storage,
    LEGACY_DOCUMENT_STORAGE_KEY,
    "read_legacy"
  )
  if (!legacyRead.ok) {
    return { status: "storage_unavailable", failure: legacyRead.failure }
  }
  if (legacyRead.raw === null) return { status: "empty" }

  const decodedLegacy = decodeStoredDraft(legacyRead.raw)
  if (!decodedLegacy.ok) {
    return recoveryResult(
      storage,
      LEGACY_DOCUMENT_STORAGE_KEY,
      legacyRead.raw,
      decodedLegacy.failure,
      now()
    )
  }

  const envelope: CurrentDraftEnvelope = {
    schemaVersion: 1,
    document: decodedLegacy.document,
    sourceContext: null,
  }

  const legacyContextKeys = legacyKeys.filter(
    (key) => key !== LEGACY_DOCUMENT_STORAGE_KEY
  )
  let legacySourceContextExisted = false
  for (const key of legacyContextKeys) {
    const read = readItem(storage, key, "read_legacy")
    if (!read.ok) {
      return {
        status: "storage_unavailable",
        failure: read.failure,
        recoverableDraft: envelope,
        legacyBytesPreserved: true,
      }
    }
    legacySourceContextExisted ||= read.raw !== null
  }

  const migrated = writeEnvelope(storage, envelope)
  if (!migrated.ok) {
    return {
      status: "storage_unavailable",
      failure: migrated.failure,
      recoverableDraft: envelope,
      legacyBytesPreserved: true,
    }
  }

  const warnings: DraftStorageFailure[] = legacySourceContextExisted
    ? [
        {
          operation: "legacy_source_context_discarded",
          message:
            "The document was preserved, but its legacy quotation and design-template association could not be proven. Re-import quotation data before using a source-linked style.",
        },
      ]
    : []
  for (const key of legacyKeys) {
    try {
      storage.removeItem(key)
    } catch (error) {
      warnings.push(
        storageFailure(
          "cleanup_legacy",
          `Studio saved the atomic draft but could not remove legacy key ${key}.`,
          error
        )
      )
    }
  }
  return {
    status: "current",
    envelope,
    source: "legacy",
    migrated: true,
    warnings,
  }
}

export function writeCurrentDraft(
  snapshot: CurrentDraftSnapshot,
  { getStorage = browserStorage }: { getStorage?: DraftStorageProvider } = {}
): CurrentDraftWriteResult {
  const acquired = acquireStorage(getStorage)
  if (!acquired.ok) {
    return {
      ok: false,
      reason: "storage_unavailable",
      failure: acquired.failure,
    }
  }

  const recoveryRead = readItem(
    acquired.storage,
    DRAFT_RECOVERY_STORAGE_KEY,
    "read_recovery"
  )
  if (!recoveryRead.ok) {
    return {
      ok: false,
      reason: "storage_unavailable",
      failure: recoveryRead.failure,
    }
  }
  const recovery = matchingRecovery(recoveryRead.raw)
  if (recovery) return { ok: false, reason: "recovery_required", recovery }

  const validated = validateCurrentDraftSnapshot(snapshot)
  if (!validated.ok) {
    return {
      ok: false,
      reason: "validation_failed",
      failure: validated.failure,
    }
  }
  const written = writeEnvelope(acquired.storage, validated.envelope)
  if (!written.ok) {
    return {
      ok: false,
      reason: "storage_unavailable",
      failure: written.failure,
    }
  }
  return { ok: true, envelope: validated.envelope }
}

export function flushCurrentDraft(
  capture: () => CurrentDraftSnapshot,
  options: { getStorage?: DraftStorageProvider } = {}
): CurrentDraftWriteResult {
  let snapshot: CurrentDraftSnapshot
  try {
    snapshot = capture()
  } catch (error) {
    return {
      ok: false,
      reason: "capture_failed",
      message: `Studio could not capture the latest draft before saving.${errorDetail(error)}`,
    }
  }
  return writeCurrentDraft(snapshot, options)
}
