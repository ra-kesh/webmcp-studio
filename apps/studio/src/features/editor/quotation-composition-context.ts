import { z } from "zod"
import {
  quotationSourceFingerprint,
  QUOTATION_COMPOSER_VERSION,
} from "@webmcp/document"
import type { QuotationRenderPayloadV1 } from "@webmcp/document"

const immutableTemplateIdentitySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict()

const knownQuotationCompositionSchema = z
  .object({
    status: z.literal("known"),
    composerId: z.literal("quotation"),
    composerVersion: z.number().int().positive(),
    sourceSnapshotId: z.string().regex(/^sha256-[0-9a-f]{64}$/),
    sourceQuotationId: z.string().min(1),
    sourceRevision: z.number().int().nonnegative(),
    quoteVersion: z.number().int().positive(),
    contractVersion: z.literal(1),
    template: immutableTemplateIdentitySchema,
  })
  .strict()

const legacyUnknownQuotationCompositionSchema = z
  .object({
    status: z.literal("legacy_unknown"),
    appliedMigrations: z.array(z.string().min(1)),
  })
  .strict()

export const quotationCompositionContextSchema = z.discriminatedUnion(
  "status",
  [knownQuotationCompositionSchema, legacyUnknownQuotationCompositionSchema]
)

export type QuotationCompositionContext = z.infer<
  typeof quotationCompositionContextSchema
>

export async function createKnownQuotationComposition(
  source: QuotationRenderPayloadV1,
  template: Readonly<{ id: string; version: number }>,
  composerVersion = QUOTATION_COMPOSER_VERSION
): Promise<QuotationCompositionContext> {
  return knownQuotationCompositionSchema.parse({
    status: "known",
    composerId: "quotation",
    composerVersion,
    sourceSnapshotId: await quotationSourceFingerprint(source),
    sourceQuotationId: source.source.quotationId,
    sourceRevision: source.source.revision,
    quoteVersion: source.quote.quoteVersion,
    contractVersion: source.contractVersion,
    template,
  })
}

export async function quotationCompositionMismatch(
  source: QuotationRenderPayloadV1,
  composition: QuotationCompositionContext
): Promise<string | null> {
  if (composition.status === "legacy_unknown") return null
  if (
    composition.sourceQuotationId !== source.source.quotationId ||
    composition.sourceRevision !== source.source.revision ||
    composition.quoteVersion !== source.quote.quoteVersion ||
    composition.contractVersion !== source.contractVersion
  ) {
    return "The saved quotation composition coordinates do not match its linked source."
  }
  if (
    composition.sourceSnapshotId !== (await quotationSourceFingerprint(source))
  ) {
    return "The saved quotation composition fingerprint does not match its linked source."
  }
  return null
}
