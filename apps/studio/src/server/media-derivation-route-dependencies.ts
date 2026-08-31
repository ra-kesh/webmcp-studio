import { requireStudioPrincipal } from "./studio-principal"
import type {
  MediaDerivationDispatcher,
  MediaDerivationHttpDependencies,
  MediaDerivationReadHttpDependencies,
} from "./media-derivation-http"
import { MediaDerivationError } from "./media-derivations"

type MediaDerivationWorkflowBinding = Readonly<{
  create: (options: {
    id: string
    params: { workspaceId: string; jobId: string }
    retention: { successRetention: string; errorRetention: string }
  }) => Promise<{ id: string }>
  get: (id: string) => Promise<{ status: () => Promise<unknown> }>
}>

type ConfiguredMediaDerivationEnv = Env & {
  MEDIA_DERIVATION_JOBS?: MediaDerivationWorkflowBinding
  MEDIA_DERIVATION_PROVIDER_KEY?: string
  MEDIA_DERIVATION_MODEL_VERSION?: string
  MEDIA_DERIVATION_PRIVACY_POLICY_VERSION?: string
  MEDIA_DERIVATION_MAX_ATTEMPTS?: string
  MEDIA_DERIVATION_MAX_ACTIVE_JOBS?: string
  MEDIA_DERIVATION_MAX_SOURCE_BYTES?: string
  MEDIA_DERIVATION_MAX_SOURCE_PIXELS?: string
  MEDIA_DERIVATION_MAX_JOBS_PER_HOUR?: string
  MEDIA_DERIVATION_MAX_DERIVATIVE_BYTES?: string
  MEDIA_DERIVATION_SUBPROCESSOR?: string
  MEDIA_DERIVATION_RETENTION?: string
  MEDIA_DERIVATION_REGION?: string
  MEDIA_DERIVATION_COST?: string
  MEDIA_DERIVATION_CANCELLATION_LIMITS?: string
}

const required = (
  env: ConfiguredMediaDerivationEnv,
  key: keyof ConfiguredMediaDerivationEnv
) => {
  const value = env[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new MediaDerivationError(
      "derivation_not_configured",
      503,
      "Background removal is not configured"
    )
  }
  return value.trim()
}

const positiveInteger = (value: string, name: string) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`media_derivation_${name}_invalid`)
  }
  return parsed
}

const dispatcherFor = (
  env: ConfiguredMediaDerivationEnv
): MediaDerivationDispatcher => ({
  dispatch: async ({ workspaceId, jobId }) => {
    const workflows = env.MEDIA_DERIVATION_JOBS
    try {
      await workflows.create({
        id: jobId,
        params: { workspaceId, jobId },
        retention: {
          successRetention: "14 days",
          errorRetention: "14 days",
        },
      })
    } catch (error) {
      try {
        await (await workflows.get(jobId)).status()
        return
      } catch {
        throw new MediaDerivationError(
          "derivation_dispatch_unavailable",
          503,
          "Background removal was queued but dispatch is temporarily unavailable"
        )
      }
    }
  },
})

export const mediaDerivationRouteDependencies = (
  workerEnv: Env
): MediaDerivationHttpDependencies => {
  const env = workerEnv as ConfiguredMediaDerivationEnv
  return {
    db: env.DB,
    requirePrincipal: (request) => requireStudioPrincipal(env, request),
    configuration: {
      providerKey: required(env, "MEDIA_DERIVATION_PROVIDER_KEY"),
      providerModelVersion: required(env, "MEDIA_DERIVATION_MODEL_VERSION"),
      privacyPolicyVersion: required(
        env,
        "MEDIA_DERIVATION_PRIVACY_POLICY_VERSION"
      ),
      maxAttempts: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_ATTEMPTS"),
        "max_attempts"
      ),
    },
    disclosure: {
      subprocessor: required(env, "MEDIA_DERIVATION_SUBPROCESSOR"),
      retention: required(env, "MEDIA_DERIVATION_RETENTION"),
      region: env.MEDIA_DERIVATION_REGION?.trim() || null,
      cost: required(env, "MEDIA_DERIVATION_COST"),
      cancellationLimits: required(env, "MEDIA_DERIVATION_CANCELLATION_LIMITS"),
    },
    dispatcher: dispatcherFor(env),
    admission: {
      maxActiveJobs: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_ACTIVE_JOBS"),
        "active_job_limit"
      ),
      maxSourceBytes: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_SOURCE_BYTES"),
        "source_byte_limit"
      ),
      maxSourcePixels: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_SOURCE_PIXELS"),
        "source_pixel_limit"
      ),
      maxJobsPerHour: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_JOBS_PER_HOUR"),
        "job_window_limit"
      ),
      maxDerivativeBytes: positiveInteger(
        required(env, "MEDIA_DERIVATION_MAX_DERIVATIVE_BYTES"),
        "derivative_storage_limit"
      ),
    },
  }
}

export const mediaDerivationReadRouteDependencies = (
  workerEnv: Env
): MediaDerivationReadHttpDependencies => ({
  db: workerEnv.DB,
  requirePrincipal: (request) => requireStudioPrincipal(workerEnv, request),
})
