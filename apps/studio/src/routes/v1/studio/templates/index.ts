import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  decodeDocument,
  PublishValidationError,
  templatePublishRequestSchema,
} from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { apiIssuesFrom } from "../../../../server/api-boundary"
import { readStudioJsonBody } from "../../../../server/json-request-policy"
import { requireStudioPrincipal } from "../../../../server/studio-principal"
import { persistTemplateVersion } from "../../../../server/template-repository"
import { publicTemplateVersion } from "../../../../server/render-field-assets"

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
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
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
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/templates/")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return session.respond(jsonBodyErrorResponse(error, true))
          }
          throw error
        }
        let compatibleInput = input
        try {
          if (input && typeof input === "object" && "document" in input) {
            compatibleInput = {
              ...input,
              document: decodeDocument(input.document).document,
            }
          }
        } catch {
          // The strict request parser below returns the public validation shape.
        }
        const parsed = templatePublishRequestSchema.safeParse(compatibleInput)
        if (!parsed.success) {
          return json(
            {
              error: {
                code: "invalid_publish_request",
                issues: apiIssuesFrom(parsed.error.issues),
              },
            },
            { status: 400 }
          )
        }
        try {
          const result = await persistTemplateVersion(
            env.DB,
            env.ASSETS,
            session.workspaceId,
            parsed.data
          )
          const version = result.version
          return json(publicTemplateVersion(version), {
            status: result.created ? 201 : 200,
          })
        } catch (error) {
          if (error instanceof PublishValidationError) {
            return json(
              {
                error: {
                  code: "publish_validation_failed",
                  issues: error.issues,
                },
              },
              { status: 422 }
            )
          }
          const message = error instanceof Error ? error.message : ""
          if (
            message === "published_version_conflict" ||
            message === "published_snapshot_conflict"
          ) {
            return json({ error: { code: message } }, { status: 409 })
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
