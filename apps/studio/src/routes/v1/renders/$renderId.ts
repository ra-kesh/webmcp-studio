import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"

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
      GET: async ({ params }) => {
        const job = await env.DB.prepare(
          `SELECT id, template_id, template_version, status, error_code,
                  error_message, created_at, started_at, completed_at
           FROM render_jobs WHERE id = ?1`
        )
          .bind(params.renderId)
          .first<RenderJobRow>()
        if (!job) {
          return Response.json(
            { error: { code: "render_not_found" } },
            { status: 404 }
          )
        }
        const outputs = await env.DB.prepare(
          `SELECT id, output_id, page_id, format, width, height, bytes, checksum
           FROM render_outputs WHERE render_job_id = ?1 ORDER BY created_at, id`
        )
          .bind(job.id)
          .all<RenderOutputRow>()
        return Response.json({
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
