import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { requireStudioPrincipal } from "../../../../server/studio-principal"
import { getTemplateVersion } from "../../../../server/template-repository"
import { publicTemplateVersion } from "../../../../server/render-field-assets"

export const Route = createFileRoute("/v1/studio/templates/$templateId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        const searchParams = new URL(request.url).searchParams
        const versionValue = searchParams.get("version")
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
          if (searchParams.get("missing") === "empty") {
            return session.respond(new Response(null, { status: 204 }))
          }
          return json(
            { error: { code: "template_not_found" } },
            { status: 404 }
          )
        }
        const publicVersion = publicTemplateVersion(published)
        return json({
          id: publicVersion.templateId,
          versionId: publicVersion.id,
          templateId: publicVersion.templateId,
          name: publicVersion.document.name,
          version: publicVersion.version,
          sourceRevision: publicVersion.sourceRevision,
          sourceSnapshotId: publicVersion.sourceSnapshotId,
          publishedAt: publicVersion.publishedAt,
          document: publicVersion.document,
          manifest: publicVersion.manifest,
        })
      },
    },
  },
})
