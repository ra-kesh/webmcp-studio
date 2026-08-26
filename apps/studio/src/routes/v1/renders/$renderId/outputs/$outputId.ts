import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resolveDemoSession } from "../../../../../server/demo-session"

type OutputRow = {
  r2_key: string
  format: "png" | "pdf"
  output_id: string
  page_id: string | null
}

export const Route = createFileRoute("/v1/renders/$renderId/outputs/$outputId")(
  {
    server: {
      handlers: {
        GET: async ({ params, request }) => {
          const session = await resolveDemoSession(env.DB, request)
          const json = (body: unknown, init?: ResponseInit) =>
            session.respond(Response.json(body, init))
          const row = await env.DB.prepare(
            `SELECT outputs.r2_key, outputs.format, outputs.output_id,
                    outputs.page_id
             FROM render_outputs outputs
             JOIN render_jobs jobs ON jobs.id = outputs.render_job_id
             WHERE outputs.id = ?1 AND outputs.render_job_id = ?2
               AND jobs.workspace_id = ?3`
          )
            .bind(params.outputId, params.renderId, session.workspaceId)
            .first<OutputRow>()
          if (!row) {
            return json(
              { error: { code: "render_output_not_found" } },
              { status: 404 }
            )
          }
          const object = await env.RENDERS.get(row.r2_key)
          if (!object) {
            return json(
              { error: { code: "render_asset_expired" } },
              { status: 410 }
            )
          }
          const headers = new Headers()
          object.writeHttpMetadata(headers)
          headers.set("ETag", object.httpEtag)
          headers.set("Cache-Control", "private, max-age=300")
          const filename = `${row.page_id ?? row.output_id}.${row.format}`
          headers.set(
            "Content-Disposition",
            `attachment; filename="${filename.replaceAll('"', "")}"`
          )
          return session.respond(new Response(object.body, { headers }))
        },
      },
    },
  }
)
