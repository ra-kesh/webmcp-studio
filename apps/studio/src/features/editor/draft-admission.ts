import {
  deriveDocumentSnapshotId,
  quotationSourceFingerprint,
} from "@webmcp/document"
import { validateCurrentDraftSnapshot } from "./current-draft-repository"
import type {
  CurrentDraftEnvelope,
  CurrentDraftSnapshot,
  CurrentDraftSourceContext,
} from "./current-draft-repository"
import type { ReviewJournal } from "./review-journal"
import {
  quotationRefreshCandidateIdentity,
  quotationRefreshProposalId,
} from "./quotation-refresh-journal"
import type { QuotationRefreshJournal } from "./quotation-refresh-journal"
import type { DraftRecoveryFailure } from "./draft-recovery"
import { quotationCompositionMismatch } from "./quotation-composition-context"

/**
 * Browser JSON imports and durable drafts share one admission boundary. This
 * protects the browser from a second, unbounded JSON allocation; storage quota
 * failures remain a separate concern below this limit.
 */
export const DRAFT_MAX_ENCODED_BYTES = 32 * 1024 * 1024

export type DraftAdmissionSuccess = Readonly<{
  ok: true
  envelope: CurrentDraftEnvelope
  contentSnapshotId: string
  draftSnapshotId: string
  encodedJson: string
  encodedByteLength: number
}>

export type DraftAdmissionFailure =
  | Readonly<{
      ok: false
      reason: "validation_failed"
      failure: DraftRecoveryFailure
    }>
  | Readonly<{
      ok: false
      reason: "too_large"
      encodedByteLength: number
      maximumEncodedByteLength: number
    }>

export type DraftAdmissionResult = DraftAdmissionSuccess | DraftAdmissionFailure

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Draft contains a non-finite number")
    return JSON.stringify(value)
  }
  if (typeof value !== "object")
    throw new TypeError("Draft contains a value that cannot be encoded")
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => (entry === undefined ? "null" : canonicalJson(entry)))
      .join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`
}

const sha256 = async (encoded: string): Promise<string> => {
  const bytes = new TextEncoder().encode(encoded)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `sha256-${hex}`
}

/** The exact versioned bytes committed as a durable draft body. */
export function encodeCanonicalDraftEnvelope(
  envelope: CurrentDraftEnvelope
): string {
  return canonicalJson(envelope)
}

/** UTF-8 byte length, rather than JavaScript UTF-16 code-unit length. */
export function encodedUtf8ByteLength(encoded: string): number {
  return new TextEncoder().encode(encoded).byteLength
}

/**
 * Draft identity deliberately includes source context while content identity
 * does not. The versioned preimage leaves room for a future hash migration.
 */
export function deriveDraftSnapshotId(
  contentSnapshotId: string,
  sourceContext: CurrentDraftSourceContext | null,
  reviewJournal?: ReviewJournal,
  quotationRefresh?: QuotationRefreshJournal
): Promise<string> {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      contentSnapshotId,
      sourceContext,
      ...(reviewJournal ? { reviewJournal } : {}),
      ...(quotationRefresh ? { quotationRefresh } : {}),
    })
  )
}

/**
 * Validates and canonicalizes a captured draft before any storage transaction
 * is opened, then derives the independent content and draft identities.
 */
export async function prepareDraftAdmission(
  snapshot: CurrentDraftSnapshot
): Promise<DraftAdmissionResult> {
  const validated = validateCurrentDraftSnapshot(snapshot)
  if (!validated.ok) {
    return {
      ok: false,
      reason: "validation_failed",
      failure: validated.failure,
    }
  }

  const sourceContext = validated.envelope.sourceContext
  if (sourceContext?.quotationSource && sourceContext.composition) {
    const mismatch = await quotationCompositionMismatch(
      sourceContext.quotationSource,
      sourceContext.composition
    )
    if (mismatch) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: { kind: "schema_invalid", message: mismatch },
      }
    }
  }

  const encodedJson = encodeCanonicalDraftEnvelope(validated.envelope)
  const encodedByteLength = encodedUtf8ByteLength(encodedJson)
  if (encodedByteLength > DRAFT_MAX_ENCODED_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      encodedByteLength,
      maximumEncodedByteLength: DRAFT_MAX_ENCODED_BYTES,
    }
  }

  const contentSnapshotId = await deriveDocumentSnapshotId(
    validated.envelope.document
  )
  const pendingRefresh = validated.envelope.quotationRefresh?.pending
  if (pendingRefresh && sourceContext?.quotationSource) {
    const [
      baseSourceSnapshotId,
      incomingSourceSnapshotId,
      candidateSnapshotId,
    ] = await Promise.all([
      quotationSourceFingerprint(sourceContext.quotationSource),
      quotationSourceFingerprint(pendingRefresh.incomingSource),
      quotationRefreshCandidateIdentity(pendingRefresh.candidateDocument),
    ])
    const proposalId = await quotationRefreshProposalId({
      documentId: pendingRefresh.documentId,
      baseDocumentRevision: pendingRefresh.baseDocumentRevision,
      baseHistorySnapshotId: pendingRefresh.baseHistorySnapshotId,
      baseDraftSnapshotId: pendingRefresh.baseDraftSnapshotId,
      baseContentSnapshotId: pendingRefresh.baseContentSnapshotId,
      candidateContentSnapshotId: pendingRefresh.candidateContentSnapshotId,
      base: pendingRefresh.base,
      incoming: pendingRefresh.incoming,
      composerVersion: pendingRefresh.composerVersion,
      template: pendingRefresh.template,
      appearanceTemplateId: pendingRefresh.appearanceTemplateId,
      impact: pendingRefresh.impact,
      collisionChoices: pendingRefresh.collisionChoices,
    })
    const mismatches = [
      baseSourceSnapshotId !== pendingRefresh.base.sourceSnapshotId
        ? "base source"
        : null,
      incomingSourceSnapshotId !== pendingRefresh.incoming.sourceSnapshotId
        ? "incoming source"
        : null,
      contentSnapshotId !== pendingRefresh.baseContentSnapshotId
        ? "base document"
        : null,
      candidateSnapshotId !== pendingRefresh.candidateContentSnapshotId
        ? "candidate document"
        : null,
      proposalId !== pendingRefresh.proposalId ? "proposal" : null,
    ].filter((value): value is string => value !== null)
    if (mismatches.length) {
      return {
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "schema_invalid",
          message: `The pending quotation refresh failed exact ${mismatches.join(", ")} identity verification.`,
        },
      }
    }
  }
  const draftSnapshotId = await deriveDraftSnapshotId(
    contentSnapshotId,
    validated.envelope.sourceContext,
    validated.envelope.reviewJournal,
    validated.envelope.quotationRefresh
  )

  return {
    ok: true,
    envelope: validated.envelope,
    contentSnapshotId,
    draftSnapshotId,
    encodedJson,
    encodedByteLength,
  }
}
