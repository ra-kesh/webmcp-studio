import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { templateVersionSchema } from "@webmcp/document"
import { resolveDemoSession } from "../../../../server/demo-session"
import { persistTemplateVersion } from "../../../../server/template-repository"

const MAX_PUBLISH_REQUEST_BYTES = 8_000_000

type TemplateListRow = {
  id: string
  name: string
  latest_version: number
  manifest_json: string
  published_at: string
}

export const Route = createFileRoute("/v1/studio/templates/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const result = await env.DB.prepare(
          `SELECT t.public_id AS id, t.name, t.latest_version, tv.manifest_json, tv.published_at
           FROM templates t
           JOIN template_versions tv
             ON tv.template_id = t.id AND tv.version = t.latest_version
           WHERE t.workspace_id = ?1
           ORDER BY tv.published_at DESC`
        )
          .bind(session.workspaceId)
          .all<TemplateListRow>()
        return session.respond(
          Response.json({
            data: result.results.map((row) => {
              const manifest = JSON.parse(row.manifest_json) as {
                parameters: unknown[]
                outputs: unknown[]
              }
              return {
                id: row.id,
                name: row.name,
                latestVersion: row.latest_version,
                publishedAt: row.published_at,
                parameterCount: manifest.parameters.length,
                outputs: manifest.outputs,
              }
            }),
          })
        )
      },
      POST: async ({ request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const contentLength = Number(request.headers.get("content-length") ?? 0)
        if (!contentLength) {
          return json(
            { error: { code: "content_length_required" } },
            { status: 411 }
          )
        }
        if (contentLength > MAX_PUBLISH_REQUEST_BYTES) {
          return json(
            {
              error: {
                code: "request_too_large",
                maxBytes: MAX_PUBLISH_REQUEST_BYTES,
              },
            },
            { status: 413 }
          )
        }
        const parsed = templateVersionSchema.safeParse(await request.json())
        if (!parsed.success) {
          return json(
            {
              error: {
                code: "invalid_template_version",
                details: parsed.error.flatten(),
              },
            },
            { status: 400 }
          )
        }
        try {
          const version = await persistTemplateVersion(
            env.DB,
            session.workspaceId,
            parsed.data
          )
          return json(
            {
              id: version.id,
              templateId: version.templateId,
              version: version.version,
              sourceRevision: version.sourceRevision,
              publishedAt: version.publishedAt,
              manifest: version.manifest,
            },
            { status: 201 }
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : ""
          if (message === "published_version_conflict") {
            return json(
              { error: { code: "published_version_conflict" } },
              { status: 409 }
            )
          }
          if (message.startsWith("expected_version:")) {
            return json(
              {
                error: {
                  code: "version_conflict",
                  expectedVersion: Number(message.split(":")[1]),
                },
              },
              { status: 409 }
            )
          }
          throw error
        }
      },
    },
  },
})
