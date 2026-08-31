import { MediaAssetRepository } from "./media-asset-repository"
import { sha256Hex } from "./media-assets"
import { MediaDerivationRepository } from "./media-derivation-repository"
import type {
  MediaDerivationJob,
  MediaDerivationProvenance,
} from "./media-derivations"
import type {
  MediaDerivationProvider,
  ProviderExecution,
  VerifiedDerivationInput,
} from "./media-derivation-provider"
import {
  MediaDerivationDispatchError,
  sanitizeProviderInput,
} from "./media-derivation-provider"

export type MediaDerivationOutput = Readonly<{
  mediaType: "image/png" | "image/jpeg" | "image/webp"
  bytes: Uint8Array
}>

export type MediaDerivationSettlement = Readonly<{
  job: MediaDerivationJob
  provenance: MediaDerivationProvenance
}>

export type MediaDerivationExecutionDependencies = Readonly<{
  jobs: Pick<
    MediaDerivationRepository,
    "claim" | "get" | "fail" | "settleCancellation"
  >
  assets: Pick<MediaAssetRepository, "content">
  provider: MediaDerivationProvider
  admitAttempt: (job: MediaDerivationJob) => Promise<void>
  settleOutput: (input: {
    job: MediaDerivationJob
    attemptId: string
    output: MediaDerivationOutput
  }) => Promise<MediaDerivationSettlement>
  timeoutMs: number
  maxPolls: number
}>

export class MediaDerivationExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = "MediaDerivationExecutionError"
  }
}

const safeFailure = (error: unknown) => {
  if (
    error instanceof MediaDerivationExecutionError ||
    error instanceof MediaDerivationDispatchError
  ) {
    return { code: error.code, retryable: error.retryable }
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { code: "provider_timeout", retryable: true }
  }
  return { code: "provider_unavailable", retryable: true }
}

const readVerifiedSource = async (
  dependencies: MediaDerivationExecutionDependencies,
  job: MediaDerivationJob,
  attemptId: string
): Promise<VerifiedDerivationInput> => {
  const source = await dependencies.assets.content(
    job.workspaceId,
    job.sourceAssetId
  )
  if (source.asset.status !== "ready") throw new Error("source_asset_not_ready")
  const bytes = new Uint8Array(await new Response(source.body).arrayBuffer())
  if (
    source.contentHash !== job.sourceContentHash ||
    (await sha256Hex(bytes)) !== job.sourceContentHash
  ) {
    throw new Error("source_asset_integrity_failed")
  }
  return {
    jobId: job.id,
    attemptId,
    workspaceId: job.workspaceId,
    sourceAssetId: job.sourceAssetId,
    sourceContentHash: job.sourceContentHash,
    mediaType: source.asset.mediaType,
    width: source.asset.width,
    height: source.asset.height,
    bytes,
  }
}

const cancellationRequested = (job: MediaDerivationJob) =>
  job.state === "cancelling" || job.state === "cancelled"

export async function executeMediaDerivation(
  dependencies: MediaDerivationExecutionDependencies,
  workspaceId: string,
  jobId: string
): Promise<
  | Readonly<{ status: "succeeded"; settlement: MediaDerivationSettlement }>
  | Readonly<{ status: "failed" | "cancelled"; job: MediaDerivationJob }>
> {
  const claimed = await dependencies.jobs.claim(workspaceId, jobId)
  let execution: ProviderExecution | null = null
  const signal = AbortSignal.timeout(dependencies.timeoutMs)
  try {
    await dependencies.admitAttempt(claimed.job)
    const input = sanitizeProviderInput(
      await readVerifiedSource(dependencies, claimed.job, claimed.attempt.id)
    )
    signal.throwIfAborted()
    execution = await dependencies.provider.start(input)
    for (let poll = 0; poll < dependencies.maxPolls; poll += 1) {
      signal.throwIfAborted()
      const current = await dependencies.jobs.get(workspaceId, jobId)
      if (cancellationRequested(current)) {
        await dependencies.provider.cancel(execution)
        const job = await dependencies.jobs.settleCancellation(
          workspaceId,
          jobId,
          claimed.attempt.id
        )
        return { status: "cancelled", job }
      }
      const result = await dependencies.provider.poll(execution)
      if (result.state === "running") continue
      if (result.state === "failed") {
        const job = await dependencies.jobs.fail(
          workspaceId,
          jobId,
          claimed.attempt.id,
          result
        )
        return { status: "failed", job }
      }
      const beforeSettlement = await dependencies.jobs.get(workspaceId, jobId)
      if (cancellationRequested(beforeSettlement)) {
        await dependencies.provider.cancel(execution)
        const job = await dependencies.jobs.settleCancellation(
          workspaceId,
          jobId,
          claimed.attempt.id
        )
        return { status: "cancelled", job }
      }
      const settlement = await dependencies.settleOutput({
        job: claimed.job,
        attemptId: claimed.attempt.id,
        output: { mediaType: result.mediaType, bytes: result.bytes },
      })
      return { status: "succeeded", settlement }
    }
    throw new DOMException(
      "Provider polling exceeded its bound",
      "TimeoutError"
    )
  } catch (error) {
    const latest = await dependencies.jobs.get(workspaceId, jobId)
    if (cancellationRequested(latest)) {
      if (execution) await dependencies.provider.cancel(execution)
      const job = await dependencies.jobs.settleCancellation(
        workspaceId,
        jobId,
        claimed.attempt.id
      )
      return { status: "cancelled", job }
    }
    const job = await dependencies.jobs.fail(
      workspaceId,
      jobId,
      claimed.attempt.id,
      safeFailure(error)
    )
    return { status: "failed", job }
  }
}
