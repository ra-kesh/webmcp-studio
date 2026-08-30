import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { requireStudioPrincipal } from "../../../../../server/studio-principal"

type OutputRow = {
  r2_key: string
  format: "png" | "pdf"
  output_id: string
  page_id: string | null
  manifest_json: string
  status: "ready" | "expired" | "deleted"
  expires_at: string | null
}

const downloadBaseName = (row: OutputRow) => {
  let name = row.page_id ?? row.output_id
  try {
    const manifest = JSON.parse(row.manifest_json) as {
      outputs?: Array<{
        id?: string
        name?: string
        pages?: Array<{ id?: string; name?: string }>
      }>
    }
    const output = manifest.outputs?.find(
      (candidate) => candidate.id === row.output_id
    )
    const page = output?.pages?.find(
      (candidate) => candidate.id === row.page_id
    )
    name = page?.name ?? output?.name ?? name
  } catch {
    // A published manifest is validated on write. Keep an identifier fallback
    // so an old malformed record cannot make an otherwise valid artifact
    // impossible to download.
  }
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "render"
  )
}

export const Route = createFileRoute("/v1/renders/$renderId/outputs/$outputId")(
  {
    server: {
      handlers: {
        GET: async ({ params, request }) => {
          const session = await requireStudioPrincipal(env, request)
          if (session instanceof Response) return session
          const json = (body: unknown, init?: ResponseInit) =>
            session.respond(Response.json(body, init))
          const row = await env.DB.prepare(
            `SELECT outputs.r2_key, outputs.format, outputs.output_id,
                    outputs.page_id, outputs.status, outputs.expires_at,
                    versions.manifest_json
             FROM render_outputs outputs
             JOIN render_jobs jobs ON jobs.id = outputs.render_job_id
             JOIN template_versions versions
               ON versions.template_id = jobs.template_id
              AND versions.version = jobs.template_version
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
          if (
            row.status !== "ready" ||
            (row.expires_at && row.expires_at <= new Date().toISOString())
          ) {
            return json(
              { error: { code: "render_asset_expired" } },
              { status: 410 }
            )
          }
          const object = await env.RENDERS.get(row.r2_key)
          if (!object) {
            await env.DB.prepare(
              `UPDATE render_outputs
               SET status = 'expired', deleted_at = ?2
               WHERE id = ?1 AND status = 'ready'`
            )
              .bind(params.outputId, new Date().toISOString())
              .run()
            return json(
              { error: { code: "render_asset_expired" } },
              { status: 410 }
            )
          }
          const headers = new Headers()
          object.writeHttpMetadata(headers)
          headers.set("ETag", object.httpEtag)
          headers.set("Cache-Control", "private, max-age=300")
          const filename = `${downloadBaseName(row)}.${row.format}`
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
