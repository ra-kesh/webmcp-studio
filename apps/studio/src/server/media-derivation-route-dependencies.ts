import type { StudioPrincipal } from "./studio-principal"
import { requireStudioPrincipal } from "./studio-principal"
import type {
  MediaDerivationDispatcher,
  MediaDerivationHttpDependencies,
} from "./media-derivation-http"
import { MediaDerivationError } from "./media-derivations"

type MediaDerivationWorkflowBinding = Readonly<{
  create(options: {
    id: string
    params: { workspaceId: string; jobId: string }
    retention: { successRetention: string; errorRetention: string }
  }): Promise<{ id: string }>
  get(id: string): Promise<{ status(): Promise<unknown> }>
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
    if (!workflows) {
      throw new MediaDerivationError(
        "derivation_not_configured",
        503,
        "Background removal dispatch is not configured"
      )
    }
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

const admitCreate = async (
  env: ConfiguredMediaDerivationEnv,
  principal: StudioPrincipal,
  sourceAssetId: string
) => {
  const limit = positiveInteger(
    required(env, "MEDIA_DERIVATION_MAX_ACTIVE_JOBS"),
    "active_job_limit"
  )
  const maxSourceBytes = positiveInteger(
    required(env, "MEDIA_DERIVATION_MAX_SOURCE_BYTES"),
    "source_byte_limit"
  )
  const maxSourcePixels = positiveInteger(
    required(env, "MEDIA_DERIVATION_MAX_SOURCE_PIXELS"),
    "source_pixel_limit"
  )
  const maxJobsPerHour = positiveInteger(
    required(env, "MEDIA_DERIVATION_MAX_JOBS_PER_HOUR"),
    "job_window_limit"
  )
  const maxDerivativeBytes = positiveInteger(
    required(env, "MEDIA_DERIVATION_MAX_DERIVATIVE_BYTES"),
    "derivative_storage_limit"
  )
  const [sourceResult, activeResult, windowResult, storageResult] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT bytes, width, height FROM media_assets
           WHERE workspace_id = ?1 AND id = ?2 AND status = 'ready'`
      ).bind(principal.workspaceId, sourceAssetId),
      env.DB.prepare(
        `SELECT COUNT(*) AS count,
                  MAX(CASE WHEN source_asset_id = ?2 THEN 1 ELSE 0 END) AS replay
           FROM media_derivation_jobs
           WHERE workspace_id = ?1
             AND state IN ('queued', 'running', 'cancelling')`
      ).bind(principal.workspaceId, sourceAssetId),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM media_derivation_jobs
           WHERE workspace_id = ?1 AND created_at >= ?2`
      ).bind(
        principal.workspaceId,
        new Date(Date.now() - 60 * 60 * 1_000).toISOString()
      ),
      env.DB.prepare(
        `SELECT COALESCE(SUM(assets.bytes), 0) AS bytes
           FROM media_derivation_provenance provenance
           JOIN media_assets assets
             ON assets.workspace_id = provenance.workspace_id
            AND assets.id = provenance.output_asset_id
           WHERE provenance.workspace_id = ?1`
      ).bind(principal.workspaceId),
    ])
  const source = sourceResult.results[0] as
    { bytes: number; width: number; height: number } | undefined
  if (!source) return
  if (
    Number(source.bytes) > maxSourceBytes ||
    Number(source.width) * Number(source.height) > maxSourcePixels
  ) {
    throw new MediaDerivationError(
      "derivation_quota_exceeded",
      429,
      "The source image exceeds the configured background-removal limit"
    )
  }
  const active = activeResult.results[0] as
    { count: number; replay: number | null } | undefined
  const replay = Number(active?.replay ?? 0) === 1
  if (Number(active?.count ?? 0) >= limit && !replay) {
    throw new MediaDerivationError(
      "derivation_quota_exceeded",
      429,
      "The workspace has reached its active background-removal limit"
    )
  }
  const windowCount = Number(
    (windowResult.results[0] as { count?: number } | undefined)?.count ?? 0
  )
  const derivativeBytes = Number(
    (storageResult.results[0] as { bytes?: number } | undefined)?.bytes ?? 0
  )
  if (
    (windowCount >= maxJobsPerHour && !replay) ||
    derivativeBytes >= maxDerivativeBytes
  ) {
    throw new MediaDerivationError(
      "derivation_quota_exceeded",
      429,
      "The workspace has reached a background-removal quota"
    )
  }
}

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
    admitCreate: (principal, sourceAssetId) =>
      admitCreate(env, principal, sourceAssetId),
  }
}
