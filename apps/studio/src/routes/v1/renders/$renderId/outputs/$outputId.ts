import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"

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
        GET: async ({ params }) => {
          const row = await env.DB.prepare(
            `SELECT r2_key, format, output_id, page_id
           FROM render_outputs
           WHERE id = ?1 AND render_job_id = ?2`
          )
            .bind(params.outputId, params.renderId)
            .first<OutputRow>()
          if (!row) {
            return Response.json(
              { error: { code: "render_output_not_found" } },
              { status: 404 }
            )
          }
          const object = await env.RENDERS.get(row.r2_key)
          if (!object) {
            return Response.json(
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
          return new Response(object.body, { headers })
        },
      },
    },
  }
)
