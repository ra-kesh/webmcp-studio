import type { RenderResourcePlan } from "@webmcp/document"
import type { RenderAdmissionWorkload } from "./render-admission-policy"
import type { StudioPrincipal } from "./studio-principal"

export class RenderAdmissionError extends Error {
  readonly code: string
  readonly retryAfterSeconds: number
  readonly retryable: boolean

  constructor(code: string, retryAfterSeconds: number) {
    super("The render budget is exhausted for this workspace")
    this.name = "RenderAdmissionError"
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.retryable = retryAfterSeconds > 0
  }
}

export type RenderAdmissionLease = {
  reservationId: string
  complete: (actualBytes: number) => Promise<void>
  fail: () => Promise<void>
}

export class RenderAdmissionCompletionError extends Error {
  constructor(readonly causes: readonly unknown[]) {
    super("Render capacity completion settlement is unknown")
    this.name = "RenderAdmissionCompletionError"
  }
}

/**
 * Failure settlement is idempotent. Retry once immediately so a transient
 * Durable Object transport failure does not hold a capacity slot until its
 * reservation TTL expires.
 */
export async function failRenderLeaseWithRetry(
  lease: RenderAdmissionLease
): Promise<void> {
  try {
    await lease.fail()
  } catch (firstError) {
    try {
      await lease.fail()
    } catch (secondError) {
      throw new AggregateError(
        [firstError, secondError],
        "Render capacity failure settlement failed twice"
      )
    }
  }
}

export async function completeRenderLeaseWithRetry(
  lease: RenderAdmissionLease,
  actualBytes: number
): Promise<void> {
  try {
    await lease.complete(actualBytes)
  } catch (firstError) {
    try {
      await lease.complete(actualBytes)
    } catch (secondError) {
      throw new RenderAdmissionCompletionError([firstError, secondError])
    }
  }
}

export async function reserveRenderCapacity(
  env: Env,
  principal: StudioPrincipal,
  plan: RenderResourcePlan,
  reservationId = `render-reservation-${crypto.randomUUID()}`,
  workload: RenderAdmissionWorkload = "artifact"
): Promise<RenderAdmissionLease> {
  return reserveRenderCapacityForBudget(
    env,
    principal.budgetKey,
    plan,
    reservationId,
    workload
  )
}

export async function reserveRenderCapacityForBudget(
  env: Env,
  budgetKey: string,
  plan: Pick<
    RenderResourcePlan,
    "pageCount" | "pixelArea" | "estimatedStorageBytes"
  > & {
    currentStorageBytes?: number
    currentAssetCount?: number
  },
  reservationId = `render-reservation-${crypto.randomUUID()}`,
  workload: RenderAdmissionWorkload = "artifact"
): Promise<RenderAdmissionLease> {
  const admissionKey =
    workload === "thumbnail"
      ? `thumbnail:${budgetKey}`
      : workload === "upload"
        ? `upload:${budgetKey}`
        : budgetKey
  const stub = env.RENDER_ADMISSION.getByName(admissionKey)
  const decision = await stub.reserve({
    ...plan,
    reservationId,
    now: Date.now(),
    workload,
  })
  if (!decision.admitted) {
    throw new RenderAdmissionError(decision.code, decision.retryAfterSeconds)
  }

  let settled = false
  let settlement: Promise<void> | null = null
  const settle = (operation: () => Promise<void>) => {
    if (settled) return Promise.resolve()
    if (settlement) return settlement
    settlement = operation().then(
      () => {
        settled = true
      },
      (error: unknown) => {
        settlement = null
        throw error
      }
    )
    return settlement
  }
  return {
    reservationId,
    complete: (actualBytes) =>
      settle(() => stub.complete(reservationId, actualBytes, Date.now())),
    fail: () => settle(() => stub.fail(reservationId, Date.now())),
  }
}

export const reserveThumbnailCapacity = (
  env: Env,
  principal: StudioPrincipal,
  plan: RenderResourcePlan,
  reservationId = `thumbnail-reservation-${crypto.randomUUID()}`
) => reserveRenderCapacity(env, principal, plan, reservationId, "thumbnail")

export const reserveMediaUploadCapacity = (
  env: Env,
  principal: StudioPrincipal,
  input: {
    reservationId: string
    estimatedStorageBytes: number
    currentStorageBytes: number
    currentAssetCount: number
  }
) =>
  reserveRenderCapacityForBudget(
    env,
    principal.budgetKey,
    {
      pageCount: 0,
      pixelArea: 0,
      estimatedStorageBytes: input.estimatedStorageBytes,
      currentStorageBytes: input.currentStorageBytes,
      currentAssetCount: input.currentAssetCount,
    },
    input.reservationId,
    "upload"
  )

export const renderAdmissionErrorResponse = (
  error: RenderAdmissionError,
  nested = true
) =>
  Response.json(
    nested
      ? {
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        }
      : {
          error: error.code,
          message: error.message,
          retryable: error.retryable,
        },
    {
      status: 429,
      headers: error.retryable
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined,
    }
  )
