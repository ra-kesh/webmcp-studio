import { mediaAssetIdSchema, mediaIdempotencyKeySchema } from "@webmcp/document"
import { z } from "zod"

export const mediaDerivationOperationSchema = z.literal("remove_background")

export const mediaDerivationParametersSchema = z.object({}).strict()

export const mediaDerivationCreateInputSchema = z
  .object({
    sourceAssetId: mediaAssetIdSchema,
    operation: mediaDerivationOperationSchema,
    parameters: mediaDerivationParametersSchema,
  })
  .strict()

const boundedVersionSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim())

export const mediaDerivationConfigurationSchema = z
  .object({
    providerKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    providerModelVersion: boundedVersionSchema,
    privacyPolicyVersion: boundedVersionSchema,
    maxAttempts: z.number().int().positive(),
  })
  .strict()

export const mediaDerivationJobIdSchema = z
  .string()
  .regex(/^derivation-[A-Za-z0-9_-]{17,85}$/)

export const mediaDerivationAttemptIdSchema = z
  .string()
  .regex(/^derivation-attempt-[A-Za-z0-9_-]{17,93}$/)

export const mediaDerivationSafeFailureCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)

export type MediaDerivationOperation = z.infer<
  typeof mediaDerivationOperationSchema
>
export type MediaDerivationCreateInput = z.infer<
  typeof mediaDerivationCreateInputSchema
>
export type MediaDerivationConfiguration = z.infer<
  typeof mediaDerivationConfigurationSchema
>

export type MediaDerivationJobState =
  "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled"

export type MediaDerivationAttemptState =
  "running" | "succeeded" | "failed" | "cancelled"

export type MediaDerivationJob = Readonly<{
  id: string
  workspaceId: string
  sourceAssetId: string
  sourceContentHash: string
  operation: MediaDerivationOperation
  parameters: Readonly<Record<string, never>>
  parametersHash: string
  providerKey: string
  providerModelVersion: string
  privacyPolicyVersion: string
  requestFingerprint: string
  state: MediaDerivationJobState
  outputAssetId: string | null
  activeAttemptId: string | null
  attemptCount: number
  maxAttempts: number
  retryable: boolean
  safeFailureCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  cancellationRequestedAt: string | null
  updatedAt: string
}>

export type MediaDerivationAttempt = Readonly<{
  id: string
  workspaceId: string
  jobId: string
  attemptNumber: number
  providerExecutionId: string | null
  state: MediaDerivationAttemptState
  safeFailureCode: string | null
  retryable: boolean
  startedAt: string
  finishedAt: string | null
}>

export type MediaDerivationProvenance = Readonly<{
  workspaceId: string
  outputAssetId: string
  sourceAssetId: string
  sourceContentHash: string
  derivationJobId: string
  operation: MediaDerivationOperation
  providerKey: string
  providerModelVersion: string
  privacyPolicyVersion: string
  outputContentHash: string
  outputMediaType: "image/png" | "image/jpeg" | "image/webp"
  outputWidth: number
  outputHeight: number
  createdAt: string
}>

export type PublicMediaDerivationJob = Readonly<{
  id: string
  sourceAssetId: string
  operation: MediaDerivationOperation
  state: MediaDerivationJobState
  outputAssetId: string | null
  attemptCount: number
  maxAttempts: number
  retryable: boolean
  safeFailureCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  cancellationRequestedAt: string | null
  updatedAt: string
}>

export const publicMediaDerivationJob = (
  job: MediaDerivationJob
): PublicMediaDerivationJob => ({
  id: job.id,
  sourceAssetId: job.sourceAssetId,
  operation: job.operation,
  state: job.state,
  outputAssetId: job.outputAssetId,
  attemptCount: job.attemptCount,
  maxAttempts: job.maxAttempts,
  retryable: job.retryable,
  safeFailureCode: job.safeFailureCode,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  cancellationRequestedAt: job.cancellationRequestedAt,
  updatedAt: job.updatedAt,
})

export class MediaDerivationError extends Error {
  readonly code:
    | "invalid_derivation_request"
    | "invalid_derivation_configuration"
    | "invalid_derivation_job_id"
    | "invalid_derivation_attempt_id"
    | "invalid_derivation_failure"
    | "invalid_idempotency_key"
    | "source_asset_not_ready"
    | "derivation_job_not_found"
    | "idempotency_key_reused"
    | "derivation_state_conflict"
    | "derivation_attempt_stale"
    | "derivation_attempt_limit_reached"
    | "derivation_output_not_ready"
    | "derivation_output_conflict"
    | "derivation_quota_exceeded"
    | "derivation_dispatch_unavailable"
    | "derivation_not_configured"
  readonly status: 400 | 404 | 409 | 429 | 503

  constructor(
    code: MediaDerivationError["code"],
    status: MediaDerivationError["status"],
    message: string
  ) {
    super(message)
    this.name = "MediaDerivationError"
    this.code = code
    this.status = status
  }
}

export const parseMediaDerivationCreateInput = (
  value: unknown
): MediaDerivationCreateInput => {
  const parsed = mediaDerivationCreateInputSchema.safeParse(value)
  if (!parsed.success) {
    throw new MediaDerivationError(
      "invalid_derivation_request",
      400,
      "The media derivation request is malformed"
    )
  }
  return parsed.data
}

export const parseMediaDerivationConfiguration = (
  value: unknown
): MediaDerivationConfiguration => {
  const parsed = mediaDerivationConfigurationSchema.safeParse(value)
  if (!parsed.success) {
    throw new MediaDerivationError(
      "invalid_derivation_configuration",
      400,
      "The configured media derivation adapter snapshot is malformed"
    )
  }
  return parsed.data
}

export const assertMediaDerivationIdempotencyKey = (value: string): string => {
  const normalized = value.trim()
  if (!mediaIdempotencyKeySchema.safeParse(normalized).success) {
    throw new MediaDerivationError(
      "invalid_idempotency_key",
      400,
      "Idempotency-Key must contain 1-128 letters, numbers, dots, colons, underscores, or hyphens"
    )
  }
  return normalized
}

export const assertMediaDerivationJobId = (value: string): string => {
  if (!mediaDerivationJobIdSchema.safeParse(value).success) {
    throw new MediaDerivationError(
      "invalid_derivation_job_id",
      400,
      "Media derivation job ID is malformed"
    )
  }
  return value
}

export const assertMediaDerivationAttemptId = (value: string): string => {
  if (!mediaDerivationAttemptIdSchema.safeParse(value).success) {
    throw new MediaDerivationError(
      "invalid_derivation_attempt_id",
      400,
      "Media derivation attempt ID is malformed"
    )
  }
  return value
}

export const assertMediaDerivationFailureCode = (value: string): string => {
  if (!mediaDerivationSafeFailureCodeSchema.safeParse(value).success) {
    throw new MediaDerivationError(
      "invalid_derivation_failure",
      400,
      "Media derivation failure code is malformed"
    )
  }
  return value
}

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

const sha256Text = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export type MediaDerivationRequestIdentity = Readonly<{
  parametersJson: "{}"
  parametersHash: string
  requestFingerprint: string
}>

export async function mediaDerivationRequestIdentity(input: {
  workspaceId: string
  sourceAssetId: string
  sourceContentHash: string
  operation: MediaDerivationOperation
  parameters: Readonly<Record<string, never>>
  configuration: MediaDerivationConfiguration
}): Promise<MediaDerivationRequestIdentity> {
  const parametersJson = canonicalJson(input.parameters)
  if (parametersJson !== "{}") {
    throw new MediaDerivationError(
      "invalid_derivation_request",
      400,
      "Background removal does not accept parameters"
    )
  }
  const parametersHash = await sha256Text(parametersJson)
  const requestFingerprint = await sha256Text(
    canonicalJson({
      workspaceId: input.workspaceId,
      sourceAssetId: input.sourceAssetId,
      sourceContentHash: input.sourceContentHash,
      operation: input.operation,
      parameters: input.parameters,
      providerKey: input.configuration.providerKey,
      providerModelVersion: input.configuration.providerModelVersion,
      privacyPolicyVersion: input.configuration.privacyPolicyVersion,
    })
  )
  return { parametersJson: "{}", parametersHash, requestFingerprint }
}

export const createMediaDerivationJobId = () =>
  `derivation-${crypto.randomUUID()}`

export const createMediaDerivationAttemptId = () =>
  `derivation-attempt-${crypto.randomUUID()}`
