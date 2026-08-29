import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { requireStudioPrincipal } from "../../../server/studio-principal"
import type { DurableRenderStatus } from "../../../server/render-job-contract"
import { cancelRenderJobExecution } from "../../../server/render-job-execution"

type RenderJobRow = {
  id: string
  template_id: string
  template_version: number
  status: DurableRenderStatus
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  attempt_count: number
  max_attempts: number
  retryable: number
  cancellation_requested_at: string | null
  artifact_expires_at: string | null
}

type RenderOutputRow = {
  id: string
  output_id: string
  page_id: string | null
  format: "png" | "pdf"
  width: number | null
  height: number | null
  bytes: number
  checksum: string
  expires_at: string | null
}

export const Route = createFileRoute("/v1/renders/$renderId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const job = await env.DB.prepare(
          `SELECT jobs.id, templates.public_id AS template_id,
                  jobs.template_version, jobs.status, jobs.error_code,
                  jobs.error_message, jobs.created_at, jobs.started_at,
                  jobs.completed_at, jobs.attempt_count, jobs.max_attempts,
                  jobs.retryable,
                  jobs.cancellation_requested_at, jobs.artifact_expires_at
           FROM render_jobs jobs
           JOIN templates ON templates.id = jobs.template_id
           WHERE jobs.id = ?1 AND jobs.workspace_id = ?2`
        )
          .bind(params.renderId, session.workspaceId)
          .first<RenderJobRow>()
        if (!job) {
          return json({ error: { code: "render_not_found" } }, { status: 404 })
        }
        const outputs = await env.DB.prepare(
          `SELECT id, output_id, page_id, format, width, height, bytes, checksum,
                  expires_at
           FROM render_outputs
           WHERE render_job_id = ?1 AND status = 'ready'
             AND (expires_at IS NULL OR expires_at > ?2)
           ORDER BY created_at, id`
        )
          .bind(job.id, new Date().toISOString())
          .all<RenderOutputRow>()
        return json({
          id: job.id,
          templateId: job.template_id,
          version: job.template_version,
          status: job.status,
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
          artifacts: outputs.results.map((output) => ({
            id: output.id,
            outputId: output.output_id,
            pageId: output.page_id,
            format: output.format,
            width: output.width,
            height: output.height,
            bytes: output.bytes,
            checksum: output.checksum,
            expiresAt: output.expires_at,
            downloadUrl: `/v1/renders/${job.id}/outputs/${output.id}`,
          })),
        })
      },
      DELETE: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const now = new Date().toISOString()
        const result = await env.DB.prepare(
          `UPDATE render_jobs
           SET status = CASE
                 WHEN status IN ('queued', 'retrying') THEN 'cancelled'
                 WHEN status = 'rendering' THEN 'cancelling'
                 ELSE status
               END,
               cancellation_requested_at = CASE
                 WHEN status IN ('queued', 'rendering', 'retrying')
                   THEN COALESCE(cancellation_requested_at, ?3)
                 ELSE cancellation_requested_at
               END,
               completed_at = CASE
                 WHEN status IN ('queued', 'retrying') THEN ?3
                 ELSE completed_at
               END,
               updated_at = ?3
           WHERE id = ?1 AND workspace_id = ?2
             AND status IN ('queued', 'rendering', 'retrying', 'cancelling')`
        )
          .bind(params.renderId, session.workspaceId, now)
          .run()
        if (!result.meta.changes) {
          const existing = await env.DB.prepare(
            "SELECT status FROM render_jobs WHERE id = ?1 AND workspace_id = ?2"
          )
            .bind(params.renderId, session.workspaceId)
            .first<{ status: DurableRenderStatus }>()
          if (existing) {
            return session.respond(
              Response.json({ id: params.renderId, status: existing.status })
            )
          }
          return session.respond(
            Response.json(
              { error: { code: "render_not_found" } },
              { status: 404 }
            )
          )
        }
        const workflow = await env.DB.prepare(
          `SELECT workflow_instance_id FROM render_jobs
           WHERE id = ?1 AND workspace_id = ?2`
        )
          .bind(params.renderId, session.workspaceId)
          .first<{ workflow_instance_id: string | null }>()
        if (workflow?.workflow_instance_id) {
          await env.RENDER_JOBS.get(workflow.workflow_instance_id)
            .then((instance) => instance.terminate({ rollback: true }))
            .catch(() => undefined)
        }
        await cancelRenderJobExecution(env, params.renderId)
        const job = await env.DB.prepare(
          `SELECT status, cancellation_requested_at, completed_at
           FROM render_jobs WHERE id = ?1 AND workspace_id = ?2`
        )
          .bind(params.renderId, session.workspaceId)
          .first<{
            status: DurableRenderStatus
            cancellation_requested_at: string | null
            completed_at: string | null
          }>()
        return session.respond(
          Response.json({
            id: params.renderId,
            status: job?.status,
            cancellationRequestedAt: job?.cancellation_requested_at,
            completedAt: job?.completed_at,
            statusUrl: `/v1/renders/${params.renderId}`,
          })
        )
      },
      POST: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const job = await env.DB.prepare(
          `SELECT status, retryable, attempt_count, max_attempts,
                  workflow_instance_id
           FROM render_jobs WHERE id = ?1 AND workspace_id = ?2`
        )
          .bind(params.renderId, session.workspaceId)
          .first<{
            status: DurableRenderStatus
            retryable: number
            attempt_count: number
            max_attempts: number
            workflow_instance_id: string | null
          }>()
        if (!job) {
          return session.respond(
            Response.json(
              { error: { code: "render_not_found" } },
              { status: 404 }
            )
          )
        }
        if (
          job.status !== "failed" ||
          job.retryable !== 1 ||
          job.attempt_count >= job.max_attempts ||
          !job.workflow_instance_id
        ) {
          return session.respond(
            Response.json(
              { error: { code: "render_not_retryable" } },
              { status: 409 }
            )
          )
        }
        const now = new Date().toISOString()
        const deadline = new Date(Date.now() + 10 * 60_000).toISOString()
        const reset = await env.DB.prepare(
          `UPDATE render_jobs
           SET status = 'queued', completed_at = NULL, error_code = NULL,
               error_message = NULL, cancellation_requested_at = NULL,
               retryable = 0, deadline_at = ?3,
               dispatch_state = 'restart_pending', updated_at = ?4
           WHERE id = ?1 AND workspace_id = ?2 AND status = 'failed'
             AND retryable = 1 AND attempt_count < max_attempts`
        )
          .bind(params.renderId, session.workspaceId, deadline, now)
          .run()
        if (!reset.meta.changes) {
          return session.respond(
            Response.json(
              { error: { code: "render_retry_conflict" } },
              { status: 409 }
            )
          )
        }
        try {
          const instance = await env.RENDER_JOBS.get(job.workflow_instance_id)
          await instance.restart()
          await env.DB.prepare(
            `UPDATE render_jobs SET dispatch_state = 'dispatched', updated_at = ?3
             WHERE id = ?1 AND workspace_id = ?2 AND status = 'queued'`
          )
            .bind(
              params.renderId,
              session.workspaceId,
              new Date().toISOString()
            )
            .run()
        } catch (error) {
          await env.DB.prepare(
            `UPDATE render_jobs
             SET dispatch_state = 'restart_pending',
                 error_code = 'render_retry_dispatch_pending',
                 error_message = ?3, updated_at = ?4
             WHERE id = ?1 AND workspace_id = ?2 AND status = 'queued'`
          )
            .bind(
              params.renderId,
              session.workspaceId,
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Render retry dispatch failed",
              new Date().toISOString()
            )
            .run()
          return session.respond(
            Response.json(
              {
                id: params.renderId,
                status: "queued",
                attempt: job.attempt_count,
                maxAttempts: job.max_attempts,
                statusUrl: `/v1/renders/${params.renderId}`,
              },
              { status: 202 }
            )
          )
        }
        return session.respond(
          Response.json(
            {
              id: params.renderId,
              status: "queued",
              attempt: job.attempt_count,
              maxAttempts: job.max_attempts,
              statusUrl: `/v1/renders/${params.renderId}`,
            },
            { status: 202 }
          )
        )
      },
    },
  },
})
