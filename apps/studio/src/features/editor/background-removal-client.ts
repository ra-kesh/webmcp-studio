import { z } from "zod"

const jobSchema = z
  .object({
    id: z.string(),
    sourceAssetId: z.string(),
    operation: z.literal("remove_background"),
    state: z.enum([
      "queued",
      "running",
      "cancelling",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    outputAssetId: z.string().nullable(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    retryable: z.boolean(),
    safeFailureCode: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    cancellationRequestedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict()

const policySchema = z
  .object({
    operation: z.literal("remove_background"),
    privacyPolicyVersion: z.string(),
    subprocessor: z.string(),
    retention: z.string(),
    region: z.string().nullable(),
    cost: z.string(),
    cancellationLimits: z.string(),
  })
  .strict()

const latestJobSchema = z.object({ job: jobSchema.nullable() }).strict()

const provenanceSchema = z
  .object({
    outputAssetId: z.string(),
    sourceAssetId: z.string(),
    derivationJobId: z.string(),
    operation: z.literal("remove_background"),
    privacyPolicyVersion: z.string(),
    outputMediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    outputWidth: z.number().int().positive(),
    outputHeight: z.number().int().positive(),
    createdAt: z.string(),
  })
  .strict()

const provenanceResponseSchema = z
  .object({ provenance: provenanceSchema.nullable() })
  .strict()

export type BackgroundRemovalJob = z.infer<typeof jobSchema>
export type BackgroundRemovalPolicy = z.infer<typeof policySchema>
export type BackgroundRemovalProvenance = z.infer<typeof provenanceSchema>

export class BackgroundRemovalClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "BackgroundRemovalClientError"
  }
}

const readResponse = async <T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T> => {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? (body.error as { code?: unknown; message?: unknown })
        : null
    throw new BackgroundRemovalClientError(
      typeof error?.code === "string"
        ? error.code
        : "derivation_request_failed",
      response.status,
      typeof error?.message === "string"
        ? error.message
        : `Background removal request failed (${response.status})`
    )
  }
  return schema.parse(body)
}

const mutationHeaders = (idempotencyKey: string) => ({
  "Content-Type": "application/json",
  "Idempotency-Key": idempotencyKey,
  "X-Request-Id": crypto.randomUUID(),
})

export const getBackgroundRemovalPolicy = async (signal?: AbortSignal) =>
  readResponse(
    await fetch("/v1/studio/media-derivations/policy", { signal }),
    policySchema
  )

export const createBackgroundRemoval = async (
  assetId: string,
  policy: BackgroundRemovalPolicy,
  signal?: AbortSignal
) =>
  createBackgroundRemovalWithConsent(
    assetId,
    policy.privacyPolicyVersion,
    signal
  )

export const createBackgroundRemovalWithConsent = async (
  assetId: string,
  privacyPolicyVersion: string,
  signal?: AbortSignal
) =>
  readResponse(
    await fetch(
      `/v1/studio/assets/${encodeURIComponent(assetId)}/derivations`,
      {
        method: "POST",
        signal,
        headers: mutationHeaders(crypto.randomUUID()),
        body: JSON.stringify({
          operation: "remove_background",
          parameters: {},
          consent: {
            accepted: true,
            privacyPolicyVersion,
          },
        }),
      }
    ),
    jobSchema
  )

export const getLatestBackgroundRemoval = async (
  assetId: string,
  signal?: AbortSignal
) =>
  (
    await readResponse(
      await fetch(
        `/v1/studio/assets/${encodeURIComponent(assetId)}/derivations`,
        { signal }
      ),
      latestJobSchema
    )
  ).job

export const getBackgroundRemovalProvenance = async (
  outputAssetId: string,
  signal?: AbortSignal
) =>
  (
    await readResponse(
      await fetch(
        `/v1/studio/assets/${encodeURIComponent(outputAssetId)}/derivation-provenance`,
        { signal }
      ),
      provenanceResponseSchema
    )
  ).provenance

export const getBackgroundRemovalJob = async (
  jobId: string,
  signal?: AbortSignal
) =>
  readResponse(
    await fetch(`/v1/studio/media-derivations/${encodeURIComponent(jobId)}`, {
      signal,
    }),
    jobSchema
  )

export const backgroundRemovalMutationKey = async (
  action: "cancel" | "retry",
  jobId: string,
  expectedUpdatedAt: string
) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({ action, expectedUpdatedAt, jobId, source: "webmcp" })
    )
  )
  return `webmcp:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`
}

export const mutateBackgroundRemoval = async (
  jobId: string,
  expectedUpdatedAt: string,
  action: "cancel" | "retry",
  signal?: AbortSignal,
  idempotencyKey: string = crypto.randomUUID()
) =>
  readResponse(
    await fetch(
      `/v1/studio/media-derivations/${encodeURIComponent(jobId)}/${action}`,
      {
        method: "POST",
        signal,
        headers: mutationHeaders(idempotencyKey),
        body: JSON.stringify({ expectedUpdatedAt }),
      }
    ),
    jobSchema
  )

export const cancelBackgroundRemoval = (
  job: BackgroundRemovalJob,
  signal?: AbortSignal
) => mutateBackgroundRemoval(job.id, job.updatedAt, "cancel", signal)

export const retryBackgroundRemoval = (
  job: BackgroundRemovalJob,
  signal?: AbortSignal
) => mutateBackgroundRemoval(job.id, job.updatedAt, "retry", signal)
