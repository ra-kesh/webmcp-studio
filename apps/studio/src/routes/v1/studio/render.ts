import { createFileRoute } from "@tanstack/react-router"
import { apiIssuesFrom } from "../../../server/api-boundary"
import { RenderImageResourceAdmissionError } from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { databaseTemplateId } from "../../../server/demo-session"
import { readStudioJsonBody } from "../../../server/json-request-policy"
import { MediaAssetError } from "../../../server/media-assets"
import {
  CuratedAssetMaterializationError,
  ManagedAssetMaterializationError,
} from "../../../server/render-field-assets"
import {
  renderRequestHash,
  renderRequestSchema,
} from "../../../server/render-job-contract"
import type { DurableRenderStatus } from "../../../server/render-job-contract"
import { prepareRenderJob } from "../../../server/render-job-execution"
import {
  StudioAccessError,
  resolveStudioPrincipal,
  studioAccessErrorResponse,
} from "../../../server/studio-principal"
import { getTemplateVersion } from "../../../server/template-repository"

type ExistingJobRow = {
  id: string
  template_public_id: string
  template_version: number
  status: DurableRenderStatus
  request_hash: string | null
  workflow_instance_id: string | null
  attempt_count: number
  max_attempts: number
  retryable: number
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  cancellation_requested_at: string | null
  artifact_expires_at: string | null
}

type ExistingArtifactRow = {
  id: string
  output_id: string
  page_id: string | null
  format: "png" | "pdf"
  width: number | null
  height: number | null
  bytes: number
  checksum: string
  status: "ready" | "expired" | "deleted"
  expires_at: string | null
}

const selectExistingJob = (env: Env, workspaceId: string, key: string) =>
  env.DB.prepare(
    `SELECT jobs.id, templates.public_id AS template_public_id,
            jobs.template_version, jobs.status, jobs.request_hash,
            jobs.workflow_instance_id, jobs.attempt_count, jobs.max_attempts,
            jobs.retryable,
            jobs.error_code, jobs.error_message, jobs.created_at,
            jobs.started_at, jobs.completed_at,
            jobs.cancellation_requested_at, jobs.artifact_expires_at
     FROM render_jobs jobs
     JOIN templates ON templates.id = jobs.template_id
     WHERE jobs.workspace_id = ?1 AND jobs.idempotency_key = ?2`
  )
    .bind(workspaceId, key)
    .first<ExistingJobRow>()

async function renderJobResponse(env: Env, job: ExistingJobRow) {
  const outputs = await env.DB.prepare(
    `SELECT id, output_id, page_id, format, width, height, bytes, checksum,
            status, expires_at
     FROM render_outputs WHERE render_job_id = ?1 ORDER BY created_at, id`
  )
    .bind(job.id)
    .all<ExistingArtifactRow>()
  return Response.json(
    {
      id: job.id,
      status: job.status,
      templateId: job.template_public_id,
      version: job.template_version,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      cancellationRequestedAt: job.cancellation_requested_at,
      attempt: job.attempt_count,
      maxAttempts: job.max_attempts,
      retryable: job.retryable === 1,
      artifactExpiresAt: job.artifact_expires_at,
      error: job.error_code
        ? { code: job.error_code, message: job.error_message }
        : null,
      statusUrl: `/v1/renders/${job.id}`,
      cancelUrl: `/v1/renders/${job.id}`,
      artifacts: outputs.results
        .filter(
          (artifact) =>
            artifact.status === "ready" &&
            (!artifact.expires_at ||
              artifact.expires_at > new Date().toISOString())
        )
        .map((artifact) => ({
          id: artifact.id,
          outputId: artifact.output_id,
          pageId: artifact.page_id,
          format: artifact.format,
          width: artifact.width,
          height: artifact.height,
          bytes: artifact.bytes,
          checksum: artifact.checksum,
          expiresAt: artifact.expires_at,
          downloadUrl: `/v1/renders/${job.id}/outputs/${artifact.id}`,
        })),
    },
    { status: job.status === "failed" ? 502 : 202 }
  )
}

async function ensureWorkflow(env: Env, job: ExistingJobRow) {
  if (job.workflow_instance_id) return
  try {
    const instance = await env.RENDER_JOBS.create({
      id: job.id,
      params: { renderId: job.id },
      retention: {
        successRetention: "14 days",
        errorRetention: "14 days",
      },
    })
    await env.DB.prepare(
      `UPDATE render_jobs
       SET workflow_instance_id = ?2, updated_at = ?3,
           dispatch_state = 'dispatched', error_code = NULL, error_message = NULL
       WHERE id = ?1 AND workflow_instance_id IS NULL`
    )
      .bind(job.id, instance.id, new Date().toISOString())
      .run()
  } catch (error) {
    try {
      const instance = await env.RENDER_JOBS.get(job.id)
      await instance.status()
      await env.DB.prepare(
        `UPDATE render_jobs
         SET workflow_instance_id = ?2, updated_at = ?3,
             dispatch_state = 'dispatched', error_code = NULL, error_message = NULL
         WHERE id = ?1 AND workflow_instance_id IS NULL`
      )
        .bind(job.id, instance.id, new Date().toISOString())
        .run()
      return
    } catch {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Render dispatch failed"
      await env.DB.prepare(
        `UPDATE render_jobs
         SET error_code = 'render_dispatch_pending', error_message = ?2,
             updated_at = ?3
         WHERE id = ?1 AND status = 'queued'`
      )
        .bind(job.id, message, new Date().toISOString())
        .run()
      throw error
    }
  }
}

const preparationErrorResponse = (error: unknown) => {
  const materializationFailure =
    error instanceof ManagedAssetMaterializationError ||
    error instanceof CuratedAssetMaterializationError
      ? error
      : null
  const managedAssetFailure = error instanceof MediaAssetError ? error : null
  const resourceFailure =
    error instanceof RenderImageResourceAdmissionError ? error : null
  const message =
    error instanceof Error ? error.message : "Invalid render request"
  if (message === "template_not_found") {
    return Response.json(
      { error: { code: "template_not_found" } },
      { status: 404 }
    )
  }
  if (message.startsWith("unknown_output:")) {
    return Response.json(
      {
        error: {
          code: "unknown_output",
          outputId: message.slice("unknown_output:".length),
        },
      },
      { status: 422 }
    )
  }
  if (message.startsWith("unsupported_format:")) {
    const [, outputId, format] = message.split(":")
    return Response.json(
      { error: { code: "unsupported_format", outputId, format } },
      { status: 422 }
    )
  }
  return Response.json(
    {
      error: {
        code: resourceFailure
          ? "render_resource_admission_failed"
          : materializationFailure
            ? materializationFailure.code
            : managedAssetFailure
              ? "managed_asset_integrity_failed"
              : "invalid_modification",
        message: resourceFailure
          ? resourceFailure.message
          : materializationFailure
            ? materializationFailure.message
            : managedAssetFailure
              ? "A managed image failed resource integrity validation"
              : message,
        ...(resourceFailure
          ? {
              resourceCode: resourceFailure.code,
              assetId: resourceFailure.assetId,
              nodeId: resourceFailure.nodeId,
            }
          : materializationFailure
            ? {
                assetId: materializationFailure.assetId,
                nodeId: materializationFailure.nodeId,
              }
            : {}),
      },
    },
    { status: 422 }
  )
}

export const Route = createFileRoute("/v1/studio/render")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const { workerEnv } = context
        let session
        try {
          session = await resolveStudioPrincipal(workerEnv, request)
        } catch (error) {
          if (error instanceof StudioAccessError) {
            return studioAccessErrorResponse(error)
          }
          throw error
        }
        const respond = (response: Response) => session.respond(response)
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/render")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return respond(jsonBodyErrorResponse(error, true))
          }
          throw error
        }
        const parsed = renderRequestSchema.safeParse(input)
        if (!parsed.success) {
          return respond(
            Response.json(
              {
                error: {
                  code: "invalid_render_request",
                  issues: apiIssuesFrom(parsed.error.issues),
                },
              },
              { status: 400 }
            )
          )
        }
        const idempotencyKey = request.headers.get("Idempotency-Key")?.trim()
        if (!idempotencyKey) {
          return respond(
            Response.json(
              { error: { code: "idempotency_key_required" } },
              { status: 400 }
            )
          )
        }
        if (
          idempotencyKey.length > 128 ||
          !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
        ) {
          return respond(
            Response.json(
              { error: { code: "invalid_idempotency_key" } },
              { status: 400 }
            )
          )
        }
        const hash = await renderRequestHash(parsed.data)
        const existing = await selectExistingJob(
          workerEnv,
          session.workspaceId,
          idempotencyKey
        )
        if (existing) {
          if (existing.request_hash !== hash) {
            return respond(
              Response.json(
                { error: { code: "idempotency_key_reused" } },
                { status: 409 }
              )
            )
          }
          if (existing.status === "queued" && !existing.workflow_instance_id) {
            await ensureWorkflow(workerEnv, existing).catch(() => undefined)
          }
          const current =
            (await selectExistingJob(
              workerEnv,
              session.workspaceId,
              idempotencyKey
            )) ?? existing
          return respond(await renderJobResponse(workerEnv, current))
        }

        try {
          await prepareRenderJob(
            workerEnv,
            session.workspaceId,
            parsed.data,
            request.signal
          )
        } catch (error) {
          return respond(preparationErrorResponse(error))
        }
        const version = await getTemplateVersion(
          workerEnv.DB,
          session.workspaceId,
          parsed.data.templateId,
          parsed.data.version
        )
        if (!version) {
          return respond(
            preparationErrorResponse(new Error("template_not_found"))
          )
        }

        const renderId = `render-${crypto.randomUUID()}`
        const createdAt = new Date().toISOString()
        const deadlineAt = new Date(Date.now() + 10 * 60_000).toISOString()
        try {
          await workerEnv.DB.prepare(
            `INSERT INTO render_jobs
             (id, workspace_id, template_id, template_version, status,
              request_json, idempotency_key, request_hash, attempt_count,
              max_attempts, deadline_at, admission_key, dispatch_state,
              updated_at, created_at)
             VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, 0, 5, ?8, ?9,
                     'pending', ?10, ?10)`
          )
            .bind(
              renderId,
              session.workspaceId,
              databaseTemplateId(session.workspaceId, version.templateId),
              version.version,
              JSON.stringify(parsed.data),
              idempotencyKey,
              hash,
              deadlineAt,
              session.budgetKey,
              createdAt
            )
            .run()
        } catch {
          const raced = await selectExistingJob(
            workerEnv,
            session.workspaceId,
            idempotencyKey
          )
          if (!raced || raced.request_hash !== hash) {
            return respond(
              Response.json(
                { error: { code: "idempotency_key_reused" } },
                { status: 409 }
              )
            )
          }
          await ensureWorkflow(workerEnv, raced).catch(() => undefined)
          return respond(await renderJobResponse(workerEnv, raced))
        }

        const queued = await selectExistingJob(
          workerEnv,
          session.workspaceId,
          idempotencyKey
        )
        if (!queued) throw new Error("Queued render job was not persisted")
        await ensureWorkflow(workerEnv, queued).catch(() => undefined)
        const dispatched =
          (await selectExistingJob(
            workerEnv,
            session.workspaceId,
            idempotencyKey
          )) ?? queued
        return respond(await renderJobResponse(workerEnv, dispatched))
      },
    },
  },
})
