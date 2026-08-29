import type { RenderResourcePlan } from "@webmcp/document"
import { z } from "zod"

export const renderRequestSchema = z
  .object({
    templateId: z.string().min(1),
    version: z.number().int().positive().optional(),
    modifications: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
    response: z
      .object({
        type: z.literal("url"),
        outputs: z
          .array(
            z
              .object({
                outputId: z.string().min(1),
                format: z.enum(["png", "pdf"]),
              })
              .strict()
          )
          .min(1)
          .max(12),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>()
    for (const [index, output] of request.response.outputs.entries()) {
      const key = `${output.outputId}:${output.format}`
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["response", "outputs", index],
          message: "Each output and format pair may be requested only once",
        })
      }
      seen.add(key)
    }
  })

export type RenderJobRequest = z.infer<typeof renderRequestSchema>

export const combineRenderPlans = (
  plans: RenderResourcePlan[]
): RenderResourcePlan => ({
  outputId: "render-batch",
  format: plans[0]?.format ?? "pdf",
  pageIds: plans.flatMap((plan) => plan.pageIds),
  pageCount: plans.reduce((total, plan) => total + plan.pageCount, 0),
  pixelArea: plans.reduce((total, plan) => total + plan.pixelArea, 0),
  estimatedStorageBytes: plans.reduce(
    (total, plan) => total + plan.estimatedStorageBytes,
    0
  ),
})

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export async function renderRequestHash(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value))
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export type DurableRenderStatus =
  | "queued"
  | "rendering"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"

export const terminalRenderStatuses = new Set<DurableRenderStatus>([
  "completed",
  "failed",
  "cancelled",
])
