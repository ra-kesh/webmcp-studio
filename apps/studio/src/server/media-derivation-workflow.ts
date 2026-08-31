import { WorkflowEntrypoint } from "cloudflare:workers"
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { MediaAssetRepository } from "./media-asset-repository"
import { executeMediaDerivation } from "./media-derivation-execution"
import { MediaDerivationExecutionError } from "./media-derivation-execution"
import { MediaDerivationRepository } from "./media-derivation-repository"
import { MediaDerivationOutputRepository } from "./media-derivation-output"
import { DeterministicMediaDerivationProvider } from "./media-derivation-provider"
import type { MediaDerivationProvider } from "./media-derivation-provider"

export type MediaDerivationWorkflowPayload = {
  workspaceId: string
  jobId: string
}

type WorkflowMediaDerivationEnv = Env & {
  MEDIA_DERIVATION_PROVIDER_KEY?: string
  MEDIA_DERIVATION_ATTEMPT_TIMEOUT_MS?: string
  MEDIA_DERIVATION_MAX_POLLS?: string
  MEDIA_DERIVATION_MAX_SOURCE_BYTES?: string
  MEDIA_DERIVATION_MAX_SOURCE_PIXELS?: string
}

const fakeTransparentPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg=="
  ),
  (character) => character.charCodeAt(0)
)

const positiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("media_derivation_execution_limit_invalid")
  }
  return parsed
}

export const configuredMediaDerivationProvider = (
  env: WorkflowMediaDerivationEnv
): MediaDerivationProvider => {
  if (env.MEDIA_DERIVATION_PROVIDER_KEY === "deterministic-local-fake") {
    return new DeterministicMediaDerivationProvider({
      mediaType: "image/png",
      bytes: fakeTransparentPng,
    })
  }
  throw new Error("media_derivation_provider_not_configured")
}

export class MediaDerivationJobWorkflow extends WorkflowEntrypoint<
  WorkflowMediaDerivationEnv,
  MediaDerivationWorkflowPayload
> {
  async run(
    event: Readonly<WorkflowEvent<MediaDerivationWorkflowPayload>>,
    step: WorkflowStep
  ) {
    return step.do(
      "execute media derivation",
      {
        retries: { limit: 0, delay: "1 second" },
        timeout: "5 minutes",
      },
      () =>
        executeMediaDerivation(
          {
            jobs: new MediaDerivationRepository(this.env.DB),
            assets: new MediaAssetRepository(this.env.DB, this.env.ASSETS),
            provider: configuredMediaDerivationProvider(this.env),
            admitAttempt: async (job) => {
              const source = await this.env.DB.prepare(
                `SELECT bytes, width, height FROM media_assets
                 WHERE workspace_id = ?1 AND id = ?2 AND status = 'ready'
                   AND content_hash = ?3`
              )
                .bind(job.workspaceId, job.sourceAssetId, job.sourceContentHash)
                .first<{ bytes: number; width: number; height: number }>()
              const maxBytes = positiveInteger(
                this.env.MEDIA_DERIVATION_MAX_SOURCE_BYTES,
                0
              )
              const maxPixels = positiveInteger(
                this.env.MEDIA_DERIVATION_MAX_SOURCE_PIXELS,
                0
              )
              if (
                !source ||
                source.bytes > maxBytes ||
                source.width * source.height > maxPixels
              ) {
                throw new MediaDerivationExecutionError(
                  "derivation_quota_exceeded",
                  false,
                  "The claimed source no longer meets derivation admission"
                )
              }
            },
            settleOutput: (input) =>
              new MediaDerivationOutputRepository(
                this.env.DB,
                this.env.ASSETS
              ).settle(input),
            timeoutMs: positiveInteger(
              this.env.MEDIA_DERIVATION_ATTEMPT_TIMEOUT_MS,
              120_000
            ),
            maxPolls: positiveInteger(this.env.MEDIA_DERIVATION_MAX_POLLS, 120),
          },
          event.payload.workspaceId,
          event.payload.jobId
        )
    )
  }
}
