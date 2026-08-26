import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resolveDemoSession } from "../../../server/demo-session"

type RenderJobRow = {
  id: string
  template_id: string
  template_version: number
  status: "queued" | "rendering" | "completed" | "failed"
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
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
}

export const Route = createFileRoute("/v1/renders/$renderId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const job = await env.DB.prepare(
          `SELECT jobs.id, templates.public_id AS template_id,
                  jobs.template_version, jobs.status, jobs.error_code,
                  jobs.error_message, jobs.created_at, jobs.started_at,
                  jobs.completed_at
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
          `SELECT id, output_id, page_id, format, width, height, bytes, checksum
           FROM render_outputs WHERE render_job_id = ?1 ORDER BY created_at, id`
        )
          .bind(job.id)
          .all<RenderOutputRow>()
        return json({
          id: job.id,
          templateId: job.template_id,
          version: job.template_version,
          status: job.status,
          createdAt: job.created_at,
          startedAt: job.started_at,
          completedAt: job.completed_at,
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
            downloadUrl: `/v1/renders/${job.id}/outputs/${output.id}`,
          })),
        })
      },
    },
  },
})
