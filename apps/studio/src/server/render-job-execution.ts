import {
  assertRenderImageResourceAdmission,
  createRenderResourcePlan,
  materializeTemplateVersion,
} from "@webmcp/document"
import type { Document, RenderResourcePlan } from "@webmcp/document"
import { MediaAssetRepository } from "./media-asset-repository"
import {
  createCuratedMediaResourceFetcher,
  resolveCuratedMediaContent,
} from "../content/library/media/curated-media-content"
import {
  CuratedAssetMaterializationError,
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
  resolveRenderFieldAssetIdsForWorkspace,
} from "./render-field-assets"
import type { ManagedImageResourceExpectation } from "./render-field-assets"
import {
  completeRenderLeaseWithRetry,
  failRenderLeaseWithRetry,
  RenderAdmissionCompletionError,
  reserveRenderCapacityForBudget,
} from "./render-admission-service"
import type { RenderAdmissionLease } from "./render-admission-service"
import {
  RendererInvocationError,
  rendererInvocationErrorFromResponse,
} from "./renderer-invocation-error"
import {
  combineRenderPlans,
  renderRequestSchema,
  terminalRenderStatuses,
} from "./render-job-contract"
import type {
  DurableRenderStatus,
  RenderJobRequest,
} from "./render-job-contract"
import { getTemplateVersion } from "./template-repository"

const artifactRetentionMs = 7 * 24 * 60 * 60 * 1_000

type RenderJobRow = {
  id: string
  workspace_id: string
  template_public_id: string
  template_version: number
  status: DurableRenderStatus
  request_json: string
  attempt_count: number
  max_attempts: number
  cancellation_requested_at: string | null
  deadline_at: string | null
  admission_key: string
  active_attempt_id: string | null
  admission_settlement: "pending" | "completed" | "failed" | null
  workflow_instance_id: string | null
}

export type RenderArtifact = {
  id: string
  outputId: string
  pageId: string | null
  format: "png" | "pdf"
  key: string
  width: number | null
  height: number | null
  bytes: number
  checksum: string
}

export type PreparedRenderJob = {
  request: RenderJobRequest
  document: Document
  resources: ManagedImageResourceExpectation[]
  plan: RenderResourcePlan
}

const artifactIdentity = async (
  renderId: string,
  outputId: string,
  pageId: string | null,
  format: string
) => {
  const value = `${renderId}\u0000${outputId}\u0000${pageId ?? ""}\u0000${format}`
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `render-output-${hash}`
}

export async function prepareRenderJob(
  env: Env,
  workspaceId: string,
  request: RenderJobRequest,
  signal?: AbortSignal
): Promise<PreparedRenderJob> {
  signal?.throwIfAborted()
  const version = await getTemplateVersion(
    env.DB,
    workspaceId,
    request.templateId,
    request.version
  )
  signal?.throwIfAborted()
  if (!version) throw new Error("template_not_found")
  const mediaAssets = new MediaAssetRepository(env.DB, env.ASSETS)
  const fetchCuratedResource = createCuratedMediaResourceFetcher(
    env.CURATED_MEDIA
  )
  const resolveCuratedAsset = (
    assetId: string,
    curatedVersion: number,
    resolverSignal?: AbortSignal
  ) =>
    resolveCuratedMediaContent(
      { assetId, version: curatedVersion },
      fetchCuratedResource,
      resolverSignal
    )
  const fieldAssets = await resolveRenderFieldAssetIdsForWorkspace(
    version,
    request.modifications,
    (assetId, resolverSignal) =>
      mediaAssets.resolveRendererSource(workspaceId, assetId, resolverSignal),
    resolveCuratedAsset,
    signal
  )
  signal?.throwIfAborted()
  const materialized = await materializeManagedDocumentAssets(
    materializeTemplateVersion(version, fieldAssets.modifications),
    (assetId, resolverSignal) =>
      mediaAssets.resolveRendererSource(workspaceId, assetId, resolverSignal),
    fieldAssets.resources,
    signal,
    resolveCuratedAsset
  )
  signal?.throwIfAborted()
  await assertRenderImageResourceAdmission(
    materialized.document,
    materialized.resources
  )
  const plans = request.response.outputs.map((selection) => {
    const output = materialized.document.outputs.find(
      (candidate) => candidate.id === selection.outputId
    )
    if (!output) throw new Error(`unknown_output:${selection.outputId}`)
    if (!output.exportFormats.includes(selection.format)) {
      throw new Error(
        `unsupported_format:${selection.outputId}:${selection.format}`
      )
    }
    return createRenderResourcePlan(materialized.document, selection)
  })
  return {
    request,
    document: materialized.document,
    resources: materialized.resources,
    plan: combineRenderPlans(plans),
  }
}

const remainingRenderDeadlineMs = (deadlineAt: string) => {
  const remainingMs = Date.parse(deadlineAt) - Date.now()
  if (remainingMs <= 0) throw new RenderDeadlineExceededError()
  return remainingMs
}

export async function withRenderDeadline<T>(
  deadlineAt: string,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new RenderDeadlineExceededError()),
    Math.max(1, remainingRenderDeadlineMs(deadlineAt))
  )
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

export async function completeRenderAdmissionWithinDeadline(
  deadlineAt: string,
  lease: RenderAdmissionLease,
  actualBytes: number
): Promise<boolean> {
  remainingRenderDeadlineMs(deadlineAt)
  await completeRenderLeaseWithRetry(lease, actualBytes)
  try {
    remainingRenderDeadlineMs(deadlineAt)
    return true
  } catch (error) {
    if (isRenderDeadlineError(error)) return false
    throw error
  }
}

async function invokeRenderer(
  env: Env,
  document: Document,
  resources: readonly ManagedImageResourceExpectation[],
  renderId: string,
  storageRenderId: string,
  outputId: string,
  format: "png" | "pdf",
  pageId?: string,
  signal?: AbortSignal,
  timeoutMs = 3 * 60_000
): Promise<RenderArtifact> {
  const invocationSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, timeoutMs))])
    : AbortSignal.timeout(Math.max(1, timeoutMs))
  const response = await env.RENDERER.fetch(
    new Request(
      format === "pdf"
        ? "https://renderer.internal/render/pdf"
        : "https://renderer.internal/render",
      {
        method: "POST",
        signal: invocationSignal,
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(
          format === "pdf"
            ? {
                renderId: storageRenderId,
                outputId,
                document,
                expectedImageResources: resources,
              }
            : {
                renderId: storageRenderId,
                outputId,
                pageId,
                document,
                expectedImageResources: resources,
              }
        ),
      }
    )
  )
  invocationSignal.throwIfAborted()
  if (!response.ok) throw await rendererInvocationErrorFromResponse(response)
  const key = response.headers.get("X-Render-Key")
  if (!key) throw new Error("Renderer did not return an artifact key")
  await response.body?.cancel()
  invocationSignal.throwIfAborted()
  const page = pageId
    ? document.pages.find((candidate) => candidate.id === pageId)
    : undefined
  const id = await artifactIdentity(renderId, outputId, pageId ?? null, format)
  invocationSignal.throwIfAborted()
  return {
    id,
    outputId,
    pageId: pageId ?? null,
    format,
    key,
    width: page?.width ?? null,
    height: page?.height ?? null,
    bytes: Number(response.headers.get("X-Bytes") ?? 0),
    checksum: response.headers.get("X-Checksum") ?? key,
  }
}

const loadJob = (env: Env, renderId: string) =>
  env.DB.prepare(
    `SELECT jobs.id, jobs.workspace_id, templates.public_id AS template_public_id,
            jobs.template_version, jobs.status, jobs.request_json,
            jobs.attempt_count, jobs.max_attempts,
            jobs.cancellation_requested_at, jobs.deadline_at,
            jobs.admission_key, jobs.active_attempt_id,
            jobs.admission_settlement, jobs.workflow_instance_id
     FROM render_jobs jobs
     JOIN templates ON templates.id = jobs.template_id
     WHERE jobs.id = ?1`
  )
    .bind(renderId)
    .first<RenderJobRow>()

async function cancellationRequested(env: Env, renderId: string) {
  const row = await env.DB.prepare(
    `SELECT status, cancellation_requested_at
     FROM render_jobs WHERE id = ?1`
  )
    .bind(renderId)
    .first<{
      status: DurableRenderStatus
      cancellation_requested_at: string | null
    }>()
  return row?.status === "cancelling" || Boolean(row?.cancellation_requested_at)
}

async function deleteArtifacts(env: Env, artifacts: RenderArtifact[]) {
  await Promise.allSettled(
    artifacts.map((artifact) => env.RENDERS.delete(artifact.key))
  )
}

async function deleteRenderPrefix(env: Env, renderId: string) {
  let cursor: string | undefined
  do {
    const page = await env.RENDERS.list({
      prefix: `${renderId}/`,
      ...(cursor ? { cursor } : {}),
    })
    if (page.objects.length) {
      await env.RENDERS.delete(page.objects.map((object) => object.key))
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

async function failKnownRenderReservation(
  env: Env,
  admissionKey: string,
  reservationId: string
) {
  const stub = env.RENDER_ADMISSION.getByName(admissionKey)
  await failRenderLeaseWithRetry({
    reservationId,
    complete: async () => {
      throw new Error("Cannot complete a failed render reservation")
    },
    fail: () => stub.fail(reservationId, Date.now()),
  })
}

export async function cancelRenderJobExecution(
  env: Env,
  renderId: string,
  expectedAttemptId?: string
) {
  const claimedAt = new Date().toISOString()
  const claim = await env.DB.prepare(
    `UPDATE render_jobs
     SET status = 'cancelling',
         cancellation_requested_at = COALESCE(cancellation_requested_at, ?3),
         updated_at = ?3,
         admission_settlement = CASE WHEN reservation_id IS NULL THEN NULL
           ELSE 'pending' END
     WHERE id = ?1
       AND status IN ('queued', 'rendering', 'retrying', 'cancelling')
       AND (?2 IS NULL OR active_attempt_id = ?2)`
  )
    .bind(renderId, expectedAttemptId ?? null, claimedAt)
    .run()
  const job = await env.DB.prepare(
    `SELECT status, active_attempt_id, reservation_id, admission_key
     FROM render_jobs WHERE id = ?1`
  )
    .bind(renderId)
    .first<{
      status: DurableRenderStatus
      active_attempt_id: string | null
      reservation_id: string | null
      admission_key: string
    }>()
  const ownsCleanup =
    Boolean(claim.meta.changes) ||
    ((job?.status === "cancelling" || job?.status === "cancelled") &&
      (!expectedAttemptId || job.active_attempt_id === expectedAttemptId))
  if (!job || !ownsCleanup) return { status: job?.status ?? "missing" }

  // The state claim fences finalization and new attempts before global cleanup.
  await deleteRenderPrefix(env, renderId)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM render_outputs WHERE render_job_id = ?1").bind(
      renderId
    ),
    env.DB.prepare(
      `UPDATE render_attempts
       SET status = 'cancelled', retryable = 0, finished_at = ?2
       WHERE render_job_id = ?1 AND status = 'running'
         AND (?3 IS NULL OR id = ?3)`
    ).bind(renderId, claimedAt, expectedAttemptId ?? null),
  ])

  let admissionSettled = !job.reservation_id
  if (job.reservation_id) {
    admissionSettled = await failKnownRenderReservation(
      env,
      job.admission_key,
      job.reservation_id
    )
      .then(() => true)
      .catch(() => false)
  }
  const completedAt = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE render_jobs
     SET status = 'cancelled', completed_at = ?3, heartbeat_at = ?3,
         updated_at = ?3, error_code = NULL, error_message = NULL,
         retryable = 0,
         admission_settlement = CASE WHEN ?4 = 1 THEN 'failed'
           ELSE admission_settlement END
     WHERE id = ?1 AND status = 'cancelling'
       AND (?2 IS NULL OR active_attempt_id = ?2)`
  )
    .bind(
      renderId,
      expectedAttemptId ?? null,
      completedAt,
      admissionSettled ? 1 : 0
    )
    .run()
  return { status: "cancelled" as const }
}

async function settleCancelled(
  env: Env,
  renderId: string,
  artifacts: RenderArtifact[],
  expectedAttemptId?: string
) {
  await deleteArtifacts(env, artifacts)
  await cancelRenderJobExecution(env, renderId, expectedAttemptId)
}

async function settleDeadlineAfterAdmissionCompletion(
  env: Env,
  plan: RenderAttemptPlan
): Promise<RenderAttemptResult> {
  const settledAt = new Date().toISOString()
  const error = new RenderDeadlineExceededError()
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE render_jobs
       SET status = 'failed', error_code = 'render_deadline_exceeded',
           error_message = ?3, completed_at = ?4, heartbeat_at = ?4,
           updated_at = ?4, retryable = 0,
           admission_settlement = 'completed'
       WHERE id = ?1 AND status = 'rendering' AND active_attempt_id = ?2`
    ).bind(plan.renderId, plan.attemptId, error.message, settledAt),
    env.DB.prepare(
      `UPDATE render_attempts
       SET status = 'failed', retryable = 0,
           error_code = 'render_deadline_exceeded', error_message = ?2,
           finished_at = ?3
       WHERE id = ?1 AND status = 'running'
         AND EXISTS (
           SELECT 1 FROM render_jobs
           WHERE id = ?4 AND status = 'failed' AND active_attempt_id = ?1
         )`
    ).bind(plan.attemptId, error.message, settledAt, plan.renderId),
  ])
  if (!results[0]?.meta.changes) {
    const latest = await loadJob(env, plan.renderId)
    if (latest?.status === "cancelled" || latest?.status === "cancelling") {
      return { status: "cancelled" }
    }
    return { status: "already_terminal" }
  }
  await deleteRenderPrefix(env, plan.storageRenderId)
  return { status: "failed", message: error.message }
}

const retryableFailure = (error: unknown) =>
  !isRenderDeadlineError(error) &&
  (!(error instanceof RendererInvocationError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500)

export type RenderArtifactSelection = {
  outputId: string
  format: "png" | "pdf"
  pageId?: string
}

export type RenderAttemptPlan = {
  renderId: string
  attempt: number
  attemptId: string
  reservationId: string
  storageRenderId: string
  deadlineAt: string
  selections: RenderArtifactSelection[]
}

export type RenderAttemptResult =
  | { status: "ready"; plan: RenderAttemptPlan }
  | { status: "completed" | "cancelled" | "already_terminal" }
  | { status: "failed"; message: string }

export class RenderCancellationRequestedError extends Error {
  constructor() {
    super("Render cancellation was requested")
    this.name = "RenderCancellationRequestedError"
  }
}

export class RenderDeadlineExceededError extends Error {
  readonly code = "render_deadline_exceeded"

  constructor() {
    super("The render did not finish before its deadline")
    this.name = "RenderDeadlineExceededError"
  }
}

const isRenderDeadlineError = (error: unknown) =>
  error instanceof RenderDeadlineExceededError ||
  (error instanceof Error && error.name === "RenderDeadlineExceededError")

export const durableRenderFailureCode = (
  error: unknown,
  settlementUnknown = false
) => {
  if (settlementUnknown) return "admission_settlement_unknown"
  if (isRenderDeadlineError(error)) return "render_deadline_exceeded"
  if (
    error instanceof CuratedAssetMaterializationError ||
    error instanceof ManagedAssetMaterializationError
  ) {
    return error.code
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code
    if (
      code === "curated_asset_materialization_failed" ||
      code === "managed_asset_materialization_failed"
    ) {
      return code
    }
  }
  return error instanceof RendererInvocationError
    ? error.code
    : "renderer_failed"
}

export const durableRenderFailureMessage = (error: unknown) => {
  if (error instanceof Error) return error.message.slice(0, 500)
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message
    if (typeof message === "string") return message.slice(0, 500)
  }
  return "Renderer failed"
}

async function refreshAttemptHeartbeat(env: Env, plan: RenderAttemptPlan) {
  const remainingMs = Date.parse(plan.deadlineAt) - Date.now()
  if (remainingMs <= 0) throw new RenderDeadlineExceededError()
  const heartbeatAt = new Date().toISOString()
  const heartbeat = await env.DB.prepare(
    `UPDATE render_jobs SET heartbeat_at = ?3, updated_at = ?3
     WHERE id = ?1 AND status = 'rendering' AND active_attempt_id = ?2
       AND cancellation_requested_at IS NULL`
  )
    .bind(plan.renderId, plan.attemptId, heartbeatAt)
    .run()
  if (!heartbeat.meta.changes) {
    const current = await loadJob(env, plan.renderId)
    if (
      current?.status === "cancelling" ||
      current?.cancellation_requested_at
    ) {
      throw new RenderCancellationRequestedError()
    }
    throw new Error("render_attempt_lost_ownership")
  }
  return remainingMs
}

export async function beginRenderJobAttempt(
  env: Env,
  renderId: string,
  workflowInstanceId: string
): Promise<RenderAttemptResult> {
  const initial = await loadJob(env, renderId)
  if (!initial) return { status: "failed", message: "render_not_found" }
  if (terminalRenderStatuses.has(initial.status)) {
    return { status: "already_terminal" }
  }
  if (initial.status === "cancelling" || initial.cancellation_requested_at) {
    await settleCancelled(env, renderId, [])
    return { status: "cancelled" }
  }
  if (initial.deadline_at && Date.parse(initial.deadline_at) <= Date.now()) {
    const settledAt = new Date().toISOString()
    await env.DB.prepare(
      `UPDATE render_jobs
       SET status = 'failed', error_code = 'render_deadline_exceeded',
           error_message = 'The render did not finish before its deadline',
           completed_at = ?2, heartbeat_at = ?2, updated_at = ?2,
           retryable = 0
       WHERE id = ?1 AND status IN ('queued', 'rendering', 'retrying')`
    )
      .bind(renderId, settledAt)
      .run()
    return { status: "failed", message: "render_deadline_exceeded" }
  }

  const resumesClaimedAttempt =
    initial.status === "rendering" &&
    initial.workflow_instance_id === workflowInstanceId &&
    Boolean(initial.active_attempt_id)
  if (initial.status === "rendering" && !resumesClaimedAttempt) {
    return { status: "already_terminal" }
  }
  const attempt = resumesClaimedAttempt
    ? initial.attempt_count
    : Math.min(initial.max_attempts, initial.attempt_count + 1)
  const now = new Date().toISOString()
  // One product job owns one durable budget charge. Retries reopen the same
  // reservation instead of charging request/page/pixel quotas again.
  const reservationId = renderId
  const attemptId =
    (resumesClaimedAttempt ? initial.active_attempt_id : null) ??
    `${renderId}:attempt:${attempt}`
  const storageRenderId = `${renderId}/attempt-${attempt}`
  const deadlineAt =
    initial.deadline_at ?? new Date(Date.now() + 10 * 60_000).toISOString()
  const claimResults = resumesClaimedAttempt
    ? null
    : await env.DB.batch([
        env.DB.prepare(
          `UPDATE render_jobs
     SET status = 'rendering', attempt_count = ?2, reservation_id = ?3,
         active_attempt_id = ?4, workflow_instance_id = ?5,
         started_at = COALESCE(started_at, ?6), heartbeat_at = ?6,
         updated_at = ?6, deadline_at = COALESCE(deadline_at, ?7),
         error_code = NULL, error_message = NULL
     WHERE id = ?1
       AND status IN ('queued', 'retrying')
       AND cancellation_requested_at IS NULL`
        ).bind(
          renderId,
          attempt,
          reservationId,
          attemptId,
          workflowInstanceId,
          now,
          deadlineAt
        ),
        env.DB.prepare(
          `INSERT INTO render_attempts
       (id, render_job_id, attempt_number, workflow_instance_id, status,
        reservation_id, started_at)
       SELECT ?1, ?2, ?3, ?4, 'running', ?5, ?6
       WHERE EXISTS (
         SELECT 1 FROM render_jobs
         WHERE id = ?2 AND active_attempt_id = ?1 AND status = 'rendering'
       )
       ON CONFLICT(render_job_id, attempt_number) DO UPDATE SET
         workflow_instance_id = excluded.workflow_instance_id,
         status = 'running', reservation_id = excluded.reservation_id,
         started_at = excluded.started_at, finished_at = NULL,
         retryable = 0, error_code = NULL, error_message = NULL`
        ).bind(
          attemptId,
          renderId,
          attempt,
          workflowInstanceId,
          reservationId,
          now
        ),
      ])
  if (claimResults && !claimResults[0]?.meta.changes) {
    const current = await loadJob(env, renderId)
    if (current?.status === "cancelling") {
      await settleCancelled(env, renderId, [])
      return { status: "cancelled" }
    }
    return { status: "already_terminal" }
  }

  try {
    const parsed = renderRequestSchema.parse(JSON.parse(initial.request_json))
    const prepared = await withRenderDeadline(deadlineAt, (signal) =>
      prepareRenderJob(env, initial.workspace_id, parsed, signal)
    )
    await reserveRenderCapacityForBudget(
      env,
      initial.admission_key,
      prepared.plan,
      reservationId
    )
    await env.DB.prepare(
      `UPDATE render_jobs SET admission_settlement = 'pending', updated_at = ?2
       WHERE id = ?1 AND status = 'rendering' AND active_attempt_id = ?3`
    )
      .bind(renderId, new Date().toISOString(), attemptId)
      .run()
    const selections: RenderArtifactSelection[] = []
    for (const selection of prepared.request.response.outputs) {
      const output = prepared.document.outputs.find(
        (candidate) => candidate.id === selection.outputId
      )!
      if (selection.format === "pdf") {
        selections.push({ outputId: output.id, format: selection.format })
      } else {
        for (const pageId of output.pageIds) {
          selections.push({
            outputId: output.id,
            format: selection.format,
            pageId,
          })
        }
      }
    }
    return {
      status: "ready",
      plan: {
        renderId,
        attempt,
        attemptId,
        reservationId,
        storageRenderId,
        deadlineAt,
        selections,
      },
    }
  } catch (error) {
    return failRenderJobAttempt(
      env,
      {
        renderId,
        attempt,
        attemptId,
        reservationId,
        storageRenderId,
        deadlineAt,
        selections: [],
      },
      [],
      error
    )
  }
}

export async function renderJobArtifact(
  env: Env,
  plan: RenderAttemptPlan,
  selection: RenderArtifactSelection
) {
  await refreshAttemptHeartbeat(env, plan)
  const current = await loadJob(env, plan.renderId)
  if (
    current?.status !== "rendering" ||
    current.active_attempt_id !== plan.attemptId
  ) {
    if (
      current?.status === "cancelling" ||
      current?.cancellation_requested_at
    ) {
      throw new RenderCancellationRequestedError()
    }
    throw new Error("render_attempt_lost_ownership")
  }
  if (await cancellationRequested(env, plan.renderId)) {
    throw new RenderCancellationRequestedError()
  }
  const parsed = renderRequestSchema.parse(JSON.parse(current.request_json))
  const prepared = await withRenderDeadline(plan.deadlineAt, (signal) =>
    prepareRenderJob(env, current.workspace_id, parsed, signal)
  )
  return withRenderDeadline(plan.deadlineAt, (signal) =>
    invokeRenderer(
      env,
      prepared.document,
      prepared.resources,
      plan.renderId,
      plan.storageRenderId,
      selection.outputId,
      selection.format,
      selection.pageId,
      signal
    )
  )
}

export async function completeRenderJobAttempt(
  env: Env,
  plan: RenderAttemptPlan,
  artifacts: RenderArtifact[]
): Promise<RenderAttemptResult> {
  const current = await loadJob(env, plan.renderId)
  if (current?.status === "completed") return { status: "already_terminal" }
  await refreshAttemptHeartbeat(env, plan)
  if (
    current?.status !== "rendering" ||
    current.active_attempt_id !== plan.attemptId
  ) {
    if (
      current?.status === "cancelling" ||
      current?.cancellation_requested_at
    ) {
      await settleCancelled(env, plan.renderId, artifacts, plan.attemptId)
      return { status: "cancelled" }
    }
    await deleteArtifacts(env, artifacts)
    return { status: "already_terminal" }
  }
  if (await cancellationRequested(env, plan.renderId)) {
    await settleCancelled(env, plan.renderId, artifacts, plan.attemptId)
    return { status: "cancelled" }
  }
  const parsed = renderRequestSchema.parse(JSON.parse(current.request_json))
  const prepared = await withRenderDeadline(plan.deadlineAt, (signal) =>
    prepareRenderJob(env, current.workspace_id, parsed, signal)
  )
  await refreshAttemptHeartbeat(env, plan)
  const lease = await reserveRenderCapacityForBudget(
    env,
    current.admission_key,
    prepared.plan,
    plan.reservationId
  )
  const admissionCompletedBeforeDeadline =
    await completeRenderAdmissionWithinDeadline(
      plan.deadlineAt,
      lease,
      artifacts.reduce((total, artifact) => total + artifact.bytes, 0)
    )
  if (!admissionCompletedBeforeDeadline) {
    return settleDeadlineAfterAdmissionCompletion(env, plan)
  }

  try {
    remainingRenderDeadlineMs(plan.deadlineAt)
  } catch (error) {
    if (isRenderDeadlineError(error)) {
      return settleDeadlineAfterAdmissionCompletion(env, plan)
    }
    throw error
  }

  const completedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + artifactRetentionMs).toISOString()
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE render_jobs
       SET status = 'completed', completed_at = ?2, heartbeat_at = ?2,
           updated_at = ?2, artifact_expires_at = ?3,
           error_code = NULL, error_message = NULL,
           admission_settlement = 'completed'
       WHERE id = ?1 AND status = 'rendering'
         AND cancellation_requested_at IS NULL AND active_attempt_id = ?4
         AND deadline_at > ?5`
    ).bind(plan.renderId, completedAt, expiresAt, plan.attemptId, completedAt),
    ...artifacts.map((artifact) =>
      env.DB.prepare(
        `INSERT INTO render_outputs
         (id, render_job_id, output_id, page_id, format, r2_key, width, height,
          bytes, checksum, created_at, status, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'ready', ?12
         WHERE EXISTS (
           SELECT 1 FROM render_jobs
           WHERE id = ?2 AND status = 'completed' AND active_attempt_id = ?13
         )
         ON CONFLICT DO UPDATE SET id = excluded.id, r2_key = excluded.r2_key,
           width = excluded.width, height = excluded.height,
           bytes = excluded.bytes, checksum = excluded.checksum,
           created_at = excluded.created_at, status = 'ready',
           expires_at = excluded.expires_at, deleted_at = NULL`
      ).bind(
        artifact.id,
        plan.renderId,
        artifact.outputId,
        artifact.pageId,
        artifact.format,
        artifact.key,
        artifact.width,
        artifact.height,
        artifact.bytes,
        artifact.checksum,
        completedAt,
        expiresAt,
        plan.attemptId
      )
    ),
    env.DB.prepare(
      `UPDATE render_attempts
         SET status = 'succeeded', retryable = 0, finished_at = ?2,
             error_code = NULL, error_message = NULL
         WHERE id = ?1 AND status = 'running'
           AND EXISTS (
             SELECT 1 FROM render_jobs
             WHERE id = ?3 AND status = 'completed' AND active_attempt_id = ?1
           )`
    ).bind(plan.attemptId, completedAt, plan.renderId),
  ]).catch((error: unknown) => {
    throw new RenderAdmissionCompletionError([error])
  })
  const completion = results[0]
  if (!completion.meta.changes) {
    const latest = await loadJob(env, plan.renderId)
    if (
      latest?.status === "cancelling" &&
      latest.active_attempt_id === plan.attemptId
    ) {
      await settleCancelled(env, plan.renderId, artifacts, plan.attemptId)
      return { status: "cancelled" }
    }
    if (
      latest?.status === "rendering" &&
      latest.active_attempt_id === plan.attemptId &&
      latest.deadline_at &&
      Date.parse(latest.deadline_at) <= Date.now()
    ) {
      return settleDeadlineAfterAdmissionCompletion(env, plan)
    }
    if (latest?.status !== "completed") {
      await deleteRenderPrefix(env, plan.storageRenderId)
    }
    return { status: "already_terminal" }
  }
  return { status: "completed" }
}

export async function failRenderJobAttempt(
  env: Env,
  plan: RenderAttemptPlan,
  artifacts: RenderArtifact[],
  error: unknown
): Promise<RenderAttemptResult> {
  const current = await loadJob(env, plan.renderId)
  if (current?.active_attempt_id !== plan.attemptId) {
    await deleteRenderPrefix(env, plan.storageRenderId)
    return { status: "already_terminal" }
  }
  if (current.status === "cancelling" || current.cancellation_requested_at) {
    await settleCancelled(env, plan.renderId, artifacts, plan.attemptId)
    return { status: "cancelled" }
  }
  if (current.status !== "rendering") return { status: "already_terminal" }
  const settlementUnknown =
    error instanceof RenderAdmissionCompletionError ||
    (error instanceof Error &&
      error.message.includes("completion settlement is unknown"))
  let admissionSettled = false
  if (!settlementUnknown && current.admission_settlement === "pending") {
    admissionSettled = await failKnownRenderReservation(
      env,
      current.admission_key,
      plan.reservationId
    )
      .then(() => true)
      .catch(() => false)
  }
  if (!settlementUnknown) {
    await deleteRenderPrefix(env, plan.storageRenderId)
  }
  const message = durableRenderFailureMessage(error)
  const canRetry =
    (settlementUnknown || retryableFailure(error)) &&
    plan.attempt < current.max_attempts
  const settledAt = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE render_jobs
     SET status = 'failed', error_code = ?2, error_message = ?3,
         completed_at = ?4, heartbeat_at = ?4, updated_at = ?4,
         retryable = ?5,
         admission_settlement = CASE WHEN ?7 = 1 THEN 'failed'
           ELSE admission_settlement END
     WHERE id = ?1 AND status = 'rendering' AND active_attempt_id = ?6`
  )
    .bind(
      plan.renderId,
      durableRenderFailureCode(error, settlementUnknown),
      message,
      settledAt,
      canRetry ? 1 : 0,
      plan.attemptId,
      admissionSettled ? 1 : 0
    )
    .run()
  await env.DB.prepare(
    `UPDATE render_attempts
     SET status = 'failed', retryable = ?2, error_code = ?3,
         error_message = ?4, finished_at = ?5
     WHERE id = ?1 AND status = 'running'`
  )
    .bind(
      plan.attemptId,
      canRetry ? 1 : 0,
      durableRenderFailureCode(error, settlementUnknown),
      message,
      settledAt
    )
    .run()
  return { status: "failed", message }
}
