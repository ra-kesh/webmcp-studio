import { z } from "zod"

const keySchema = z.string().min(1).max(255)
const nullableText = (max: number) => z.string().max(max).nullable()
const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .nullable()

const snapshotSchema = z
  .object({
    id: z.string().max(255).nullable(),
    key: z.string().max(100).nullable(),
    label: z.string().max(255),
  })
  .strict()

const keyedClauseSchema = z
  .object({
    key: keySchema,
    text: z.string().max(5000),
  })
  .strict()

const paymentMilestoneSchema = z
  .object({
    key: keySchema,
    label: z.string().max(255),
    percentage: z.string().regex(/^\d+(\.\d{1,2})?$/),
    timing: z.string().max(500),
  })
  .strict()

function requireUniqueKeys(
  values: Array<{ key: string }>,
  path: PropertyKey[],
  context: z.RefinementCtx
) {
  if (new Set(values.map(({ key }) => key)).size !== values.length) {
    context.addIssue({ code: "custom", path, message: "Keys must be unique" })
  }
}

export const quotationDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    quotationDate: z.string().date(),
    quotationType: snapshotSchema,
    title: z.string().min(1).max(255),
    currency: z.literal("INR"),
    participants: z
      .array(
        z
          .object({
            key: keySchema,
            clientId: z.string().max(255).nullable(),
            clientUpdatedAt: z.string().datetime().nullable(),
            resolutionIntent: z.enum(["none", "create_lead"]).optional(),
            contact: z
              .object({
                name: z.string().min(1).max(255),
                email: nullableText(320),
                phoneNumber: nullableText(255),
                alternatePhone: nullableText(255),
                address: nullableText(5000),
                profession: nullableText(255),
                source: nullableText(255),
                socialHandle: nullableText(255),
                notes: nullableText(5000),
              })
              .strict(),
          })
          .strict()
      )
      .min(1)
      .max(10),
    events: z
      .array(
        z
          .object({
            key: keySchema,
            eventType: snapshotSchema,
            side: z.enum([
              "common",
              "bride",
              "groom",
              "both",
              "separateCommon",
            ]),
            guestCount: nullableText(255),
            timelineMode: z.enum(["fixed", "tentative"]),
            fixedDate: z.string().date().nullable(),
            dateWindow: nullableText(500),
            location: nullableText(500),
            notes: nullableText(2000),
          })
          .strict()
      )
      .min(1)
      .max(50),
    packages: z
      .array(
        z
          .object({
            key: keySchema,
            configuration: snapshotSchema
              .extend({
                defaultCost: moneySchema,
                description: nullableText(500),
              })
              .nullable(),
            name: z.string().min(1).max(255),
            price: moneySchema,
            summary: nullableText(2000),
            coverage: z
              .array(
                z
                  .object({
                    key: keySchema,
                    eventKey: keySchema,
                    roles: nullableText(5000),
                  })
                  .strict()
              )
              .max(50),
            deliverables: z
              .array(
                z
                  .object({
                    key: keySchema,
                    name: z.string().min(1).max(255),
                    quantity: z.number().int().min(1).max(10_000),
                    details: nullableText(5000),
                  })
                  .strict()
              )
              .max(100),
          })
          .strict()
      )
      .min(1)
      .max(10),
    recommendedPackageKey: keySchema.nullable(),
    termsConfiguration: z
      .object({
        id: z.string().max(255).nullable(),
        key: z.string().max(100).nullable(),
        label: z.string().min(1).max(255),
        metadataVersion: z.literal(1),
      })
      .strict()
      .nullable()
      .optional(),
    deliveryTimelines: z.array(keyedClauseSchema).max(50),
    paymentMilestones: z.array(paymentMilestoneSchema).length(3),
    fixedTerms: z.array(keyedClauseSchema).max(50),
  })
  .strict()
  .superRefine((document, context) => {
    requireUniqueKeys(document.participants, ["participants"], context)
    requireUniqueKeys(document.events, ["events"], context)
    requireUniqueKeys(document.packages, ["packages"], context)
    requireUniqueKeys(
      document.deliveryTimelines,
      ["deliveryTimelines"],
      context
    )
    requireUniqueKeys(
      document.paymentMilestones,
      ["paymentMilestones"],
      context
    )
    requireUniqueKeys(document.fixedTerms, ["fixedTerms"], context)

    const clientIds = document.participants.flatMap((participant) =>
      participant.clientId ? [participant.clientId] : []
    )
    if (new Set(clientIds).size !== clientIds.length) {
      context.addIssue({
        code: "custom",
        path: ["participants"],
        message: "Resolved clients must be distinct",
      })
    }

    const eventKeys = new Set(document.events.map((event) => event.key))
    document.events.forEach((event, index) => {
      if (
        event.timelineMode === "fixed" &&
        (!event.fixedDate || event.dateWindow)
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "fixedDate"],
          message: "Fixed events require a date and no date window",
        })
      }
      if (
        event.timelineMode === "tentative" &&
        (event.fixedDate || !event.dateWindow?.trim())
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "dateWindow"],
          message: "Tentative events require a date window and no fixed date",
        })
      }
    })

    document.packages.forEach((item, packageIndex) => {
      requireUniqueKeys(
        item.coverage,
        ["packages", packageIndex, "coverage"],
        context
      )
      requireUniqueKeys(
        item.deliverables,
        ["packages", packageIndex, "deliverables"],
        context
      )
      item.coverage.forEach((coverage, coverageIndex) => {
        if (!eventKeys.has(coverage.eventKey)) {
          context.addIssue({
            code: "custom",
            path: [
              "packages",
              packageIndex,
              "coverage",
              coverageIndex,
              "eventKey",
            ],
            message: "Coverage references an unknown event",
          })
        }
      })
    })

    if (
      document.recommendedPackageKey &&
      !document.packages.some(
        (item) => item.key === document.recommendedPackageKey
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["recommendedPackageKey"],
        message: "Recommended package does not exist",
      })
    }

    const paymentBasisPoints = document.paymentMilestones.reduce(
      (total, milestone) =>
        total + Math.round(Number(milestone.percentage) * 100),
      0
    )
    if (paymentBasisPoints !== 10_000) {
      context.addIssue({
        code: "custom",
        path: ["paymentMilestones"],
        message: "Payment percentages must total 100.00",
      })
    }
  })

export const quotationBrandingSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    organizationName: z.string().min(1).max(255),
    address: nullableText(5000),
    email: nullableText(320),
    phone: nullableText(255),
    taxIdentifier: nullableText(255),
    timezone: z.string().min(1).max(255),
    logoUrl: z.string().url().nullable().optional(),
  })
  .strict()

export const quotationRenderPayloadV1Schema = z
  .object({
    contractVersion: z.literal(1),
    source: z
      .object({
        type: z.literal("stuwiz.quotation"),
        quotationId: z.string().min(1),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
    quote: z
      .object({
        quoteNumber: z.string().min(1).max(100),
        quoteVersion: z.number().int().positive(),
        validUntil: z.string().date().nullable(),
        createdAt: z.string().datetime(),
      })
      .strict(),
    branding: quotationBrandingSnapshotV1Schema,
    document: quotationDocumentV1Schema,
  })
  .strict()

const canonicalSourceValue = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSourceValue).join(",")}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, child]) => `${JSON.stringify(key)}:${canonicalSourceValue(child)}`
    )
    .join(",")}}`
}

export async function quotationSourceFingerprint(
  input: QuotationRenderPayloadV1
) {
  const canonical = canonicalSourceValue(
    quotationRenderPayloadV1Schema.parse(input)
  )
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `sha256-${hex}`
}

export const quotationCompositionRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    templateId: z.string().min(1),
    payload: quotationRenderPayloadV1Schema,
  })
  .strict()

export type QuotationDocumentV1 = z.infer<typeof quotationDocumentV1Schema>
export type QuotationRenderPayloadV1 = z.infer<
  typeof quotationRenderPayloadV1Schema
>
export type QuotationCompositionRequestV1 = z.infer<
  typeof quotationCompositionRequestV1Schema
>
