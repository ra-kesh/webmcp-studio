import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resolveDemoSession } from "../../../../server/demo-session"

type HistoryRow = {
  id: string
  template_id: string
  template_version: number
  status: "queued" | "rendering" | "completed" | "failed"
  request_json: string
  error_message: string | null
  created_at: string
  completed_at: string | null
  artifact_id: string | null
  output_id: string | null
  page_id: string | null
  format: "png" | "pdf" | null
  width: number | null
  height: number | null
  bytes: number | null
}

type HistoryRecord = {
  id: string
  templateId: string
  version: number
  status: "rendering" | "completed" | "failed"
  createdAt: string
  completedAt: string | null
  error: string | null
  request: unknown
  artifacts: Array<{
    id: string
    outputId: string
    pageId: string | null
    format: "png" | "pdf"
    width: number | null
    height: number | null
    bytes: number
    downloadUrl: string
  }>
}

export const Route = createFileRoute("/v1/studio/renders/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const requestedLimit = Number(
          new URL(request.url).searchParams.get("limit") ?? 30
        )
        const limit = Number.isInteger(requestedLimit)
          ? Math.min(Math.max(requestedLimit, 1), 100)
          : 30
        const result = await env.DB.prepare(
          `SELECT jobs.id, templates.public_id AS template_id,
                  jobs.template_version, jobs.status,
                  jobs.request_json, jobs.error_message, jobs.created_at,
                  jobs.completed_at, outputs.id AS artifact_id,
                  outputs.output_id, outputs.page_id, outputs.format,
                  outputs.width, outputs.height, outputs.bytes
           FROM (
             SELECT * FROM render_jobs
             WHERE workspace_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2
           ) jobs
           JOIN templates ON templates.id = jobs.template_id
           LEFT JOIN render_outputs outputs ON outputs.render_job_id = jobs.id
           ORDER BY jobs.created_at DESC, outputs.created_at, outputs.id`
        )
          .bind(session.workspaceId, limit)
          .all<HistoryRow>()

        const records = new Map<string, HistoryRecord>()
        for (const row of result.results) {
          let record = records.get(row.id)
          if (!record) {
            let parsedRequest: unknown = null
            try {
              parsedRequest = JSON.parse(row.request_json) as unknown
            } catch {
              // Preserve the job even if legacy request metadata is malformed.
            }
            record = {
              id: row.id,
              templateId: row.template_id,
              version: row.template_version,
              status: row.status === "queued" ? "rendering" : row.status,
              createdAt: row.created_at,
              completedAt: row.completed_at,
              error: row.error_message,
              request: parsedRequest,
              artifacts: [],
            }
            records.set(row.id, record)
          }
          if (
            row.artifact_id &&
            row.output_id &&
            row.format &&
            row.bytes !== null
          ) {
            record.artifacts.push({
              id: row.artifact_id,
              outputId: row.output_id,
              pageId: row.page_id,
              format: row.format,
              width: row.width,
              height: row.height,
              bytes: row.bytes,
              downloadUrl: `/v1/renders/${row.id}/outputs/${row.artifact_id}`,
            })
          }
        }

        return session.respond(Response.json({ data: [...records.values()] }))
      },
    },
  },
})
