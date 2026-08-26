import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resolveDemoSession } from "../../../../server/demo-session"
import { getTemplateVersion } from "../../../../server/template-repository"

export const Route = createFileRoute("/v1/studio/templates/$templateId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await resolveDemoSession(env.DB, request)
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const versionValue = new URL(request.url).searchParams.get("version")
        const version = versionValue ? Number(versionValue) : undefined
        if (
          versionValue &&
          (!Number.isInteger(version) || (version ?? 0) < 1)
        ) {
          return json({ error: { code: "invalid_version" } }, { status: 400 })
        }
        const published = await getTemplateVersion(
          env.DB,
          session.workspaceId,
          params.templateId,
          version
        )
        if (!published) {
          return json(
            { error: { code: "template_not_found" } },
            { status: 404 }
          )
        }
        return json({
          id: published.templateId,
          name: published.document.name,
          version: published.version,
          sourceRevision: published.sourceRevision,
          publishedAt: published.publishedAt,
          manifest: published.manifest,
        })
      },
    },
  },
})
