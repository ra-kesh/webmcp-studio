import { z } from "zod"
import {
  deriveDocumentSnapshotId,
  documentSchema,
  quotationRenderPayloadV1Schema,
} from "@webmcp/document"
import type {
  QuotationRefreshConflictPolicy,
  QuotationRefreshImpact,
} from "@webmcp/document"

export const QUOTATION_REFRESH_RESOLVED_LIMIT = 50
export const QUOTATION_REFRESH_PENDING_MAX_BYTES = 8 * 1024 * 1024

const sourceIdentitySchema = z
  .object({
    quotationId: z.string().min(1),
    sourceRevision: z.number().int().nonnegative(),
    quoteVersion: z.number().int().positive(),
    contractVersion: z.literal(1),
    sourceSnapshotId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
  })
  .strict()

const templateIdentitySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict()

const conflictSchema = z
  .object({
    kind: z.enum(["changed_by_both", "edited_then_removed"]),
    semanticKey: z.string().min(1),
    layerName: z.string().min(1),
    properties: z.array(z.string().min(1)).min(1),
  })
  .strict()

const impactSchema = z
  .object({
    changedSourcePaths: z.array(z.string().min(1)).max(200),
    changedCategories: z.array(z.string().min(1)).max(20),
    generatedPageCount: z.number().int().nonnegative(),
    previousGeneratedPageCount: z.number().int().nonnegative(),
    generatedLayerCount: z.number().int().nonnegative(),
    addedSourceLayers: z.number().int().nonnegative(),
    removedSourceLayers: z.number().int().nonnegative(),
    updatedSourceLayers: z.number().int().nonnegative(),
    preservedStudioLayers: z.number().int().nonnegative(),
    preservedCustomLayerCount: z.number().int().nonnegative(),
    businessChanges: z
      .array(
        z
          .object({
            category: z.string().min(1),
            added: z.number().int().nonnegative(),
            removed: z.number().int().nonnegative(),
            updated: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(20),
    conflicts: z.array(conflictSchema).max(500),
  })
  .strict()

const collisionChoiceSchema = z.enum(["preserve_studio", "use_source"])
const quotationTemplateIdSchema = z.enum([
  "editorial-olive",
  "warm-paper",
  "midnight-film",
])

const pendingRefreshSchema = z
  .object({
    id: z.string().min(1),
    preparedAt: z.string().datetime(),
    documentId: z.string().min(1),
    baseDocumentRevision: z.number().int().nonnegative(),
    baseHistorySnapshotId: z.string().min(1),
    baseDraftSnapshotId: z.string().min(1),
    base: sourceIdentitySchema,
    incoming: sourceIdentitySchema,
    incomingSource: quotationRenderPayloadV1Schema,
    baseContentSnapshotId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
    candidateContentSnapshotId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
    candidateDocument: documentSchema,
    composerVersion: z.number().int().positive(),
    template: templateIdentitySchema,
    appearanceTemplateId: quotationTemplateIdSchema,
    proposalId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
    impact: impactSchema,
    collisionChoices: z.record(z.string(), collisionChoiceSchema),
  })
  .strict()
  .superRefine((pending, context) => {
    const conflictKeys = pending.impact.conflicts.map(
      (conflict) => conflict.semanticKey
    )
    if (new Set(conflictKeys).size !== conflictKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["impact", "conflicts"],
        message: "Quotation refresh collisions must have unique semantic keys.",
      })
    }
    const allowedChoices = new Set(conflictKeys)
    for (const semanticKey of Object.keys(pending.collisionChoices)) {
      if (!allowedChoices.has(semanticKey)) {
        context.addIssue({
          code: "custom",
          path: ["collisionChoices", semanticKey],
          message:
            "A quotation refresh choice must reference a current collision.",
        })
      }
    }
    if (
      pending.candidateDocument.id !== pending.documentId ||
      pending.candidateDocument.revision !== pending.baseDocumentRevision + 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateDocument"],
        message:
          "The quotation refresh candidate does not belong to its base document.",
      })
    }
  })

const resolvedRefreshSchema = z
  .object({
    id: z.string().min(1),
    decision: z.enum(["accepted", "rejected"]),
    decidedAt: z.string().datetime(),
    base: sourceIdentitySchema,
    incoming: sourceIdentitySchema,
    composerVersion: z.number().int().positive(),
    template: templateIdentitySchema,
    appearanceTemplateId: quotationTemplateIdSchema,
    proposalId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
    impact: impactSchema.omit({ changedSourcePaths: true, conflicts: true }),
    collisionChoices: z.record(z.string(), collisionChoiceSchema),
    baseContentSnapshotId: z.string().min(1),
    resultContentSnapshotId: z.string().min(1).nullable(),
    resultDocumentRevision: z.number().int().nonnegative().nullable(),
  })
  .strict()

export const quotationRefreshJournalSchema = z
  .object({
    pending: pendingRefreshSchema.nullable(),
    resolved: z
      .array(resolvedRefreshSchema)
      .max(QUOTATION_REFRESH_RESOLVED_LIMIT),
  })
  .strict()
  .superRefine((journal, context) => {
    if (!journal.pending) return
    const bytes = new TextEncoder().encode(
      JSON.stringify(journal.pending)
    ).byteLength
    if (bytes > QUOTATION_REFRESH_PENDING_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["pending"],
        message:
          "The pending quotation refresh exceeds the 8 MB recovery limit.",
      })
    }
  })

export type QuotationRefreshJournal = z.infer<
  typeof quotationRefreshJournalSchema
>
export type PendingQuotationRefresh = z.infer<typeof pendingRefreshSchema>
export type ResolvedQuotationRefresh = z.infer<typeof resolvedRefreshSchema>
export type QuotationSourceIdentity = z.infer<typeof sourceIdentitySchema>

export type QuotationRefreshProposalCoordinates = Readonly<{
  documentId: string
  baseDocumentRevision: number
  baseHistorySnapshotId: string
  baseDraftSnapshotId: string
  baseContentSnapshotId: string
  candidateContentSnapshotId: string
  base: QuotationSourceIdentity
  incoming: QuotationSourceIdentity
  composerVersion: number
  template: Readonly<{ id: string; version: number }>
  appearanceTemplateId: z.infer<typeof quotationTemplateIdSchema>
  impact: QuotationRefreshImpact
  collisionChoices: Readonly<Record<string, QuotationRefreshConflictPolicy>>
}>

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export async function quotationRefreshProposalId(
  input: QuotationRefreshProposalCoordinates
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(input))
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `sha256-${hex}`
}

export async function quotationRefreshCandidateIdentity(
  candidateDocument: z.infer<typeof documentSchema>
) {
  return deriveDocumentSnapshotId(candidateDocument)
}

export const emptyQuotationRefreshJournal = (): QuotationRefreshJournal => ({
  pending: null,
  resolved: [],
})

export function quotationRefreshJournalOrEmpty(
  input: QuotationRefreshJournal | undefined
) {
  return input
    ? quotationRefreshJournalSchema.parse(input)
    : emptyQuotationRefreshJournal()
}

export function quotationRefreshJournalForStorage(
  journalInput: QuotationRefreshJournal
) {
  const journal = quotationRefreshJournalSchema.parse(journalInput)
  return journal.pending || journal.resolved.length ? journal : undefined
}

export function setPendingQuotationRefresh(
  journalInput: QuotationRefreshJournal,
  pending: PendingQuotationRefresh
) {
  const journal = quotationRefreshJournalSchema.parse(journalInput)
  if (journal.pending) {
    throw new Error("Resolve or reject the pending quotation refresh first.")
  }
  return quotationRefreshJournalSchema.parse({ ...journal, pending })
}

export function replacePendingQuotationRefresh(
  journalInput: QuotationRefreshJournal,
  pending: PendingQuotationRefresh
) {
  const journal = quotationRefreshJournalSchema.parse(journalInput)
  if (!journal.pending || journal.pending.id !== pending.id) {
    throw new Error("The quotation refresh changed before it could be updated.")
  }
  return quotationRefreshJournalSchema.parse({ ...journal, pending })
}

export function chooseQuotationRefreshCollision(
  journalInput: QuotationRefreshJournal,
  semanticKey: string,
  choice: QuotationRefreshConflictPolicy
) {
  const journal = quotationRefreshJournalSchema.parse(journalInput)
  if (!journal.pending)
    throw new Error("There is no pending quotation refresh.")
  if (
    !journal.pending.impact.conflicts.some(
      (conflict) => conflict.semanticKey === semanticKey
    )
  ) {
    throw new Error(`Unknown quotation refresh collision: ${semanticKey}`)
  }
  return quotationRefreshJournalSchema.parse({
    ...journal,
    pending: {
      ...journal.pending,
      collisionChoices: {
        ...journal.pending.collisionChoices,
        [semanticKey]: choice,
      },
    },
  })
}

export function resolveQuotationRefresh(
  journalInput: QuotationRefreshJournal,
  resolved: ResolvedQuotationRefresh
) {
  const journal = quotationRefreshJournalSchema.parse(journalInput)
  if (!journal.pending || journal.pending.id !== resolved.id) {
    throw new Error("The quotation refresh changed before it was resolved.")
  }
  return quotationRefreshJournalSchema.parse({
    pending: null,
    resolved: [resolved, ...journal.resolved].slice(
      0,
      QUOTATION_REFRESH_RESOLVED_LIMIT
    ),
  })
}

export function resolvedImpact(impact: QuotationRefreshImpact) {
  return {
    changedCategories: [...impact.changedCategories],
    generatedPageCount: impact.generatedPageCount,
    previousGeneratedPageCount: impact.previousGeneratedPageCount,
    generatedLayerCount: impact.generatedLayerCount,
    addedSourceLayers: impact.addedSourceLayers,
    removedSourceLayers: impact.removedSourceLayers,
    updatedSourceLayers: impact.updatedSourceLayers,
    preservedStudioLayers: impact.preservedStudioLayers,
    preservedCustomLayerCount: impact.preservedCustomLayerCount,
    businessChanges: impact.businessChanges.map((change) => ({ ...change })),
  }
}
