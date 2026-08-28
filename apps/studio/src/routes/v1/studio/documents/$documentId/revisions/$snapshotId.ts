import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { requireStudioPrincipal } from "../../../../../../server/studio-principal"
import { getDocumentRevisionBySnapshotId } from "../../../../../../server/template-repository"

export const Route = createFileRoute(
  "/v1/studio/documents/$documentId/revisions/$snapshotId"
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const revision = await getDocumentRevisionBySnapshotId(
          env.DB,
          session.workspaceId,
          params.documentId,
          params.snapshotId
        )
        if (!revision) {
          return session.respond(
            Response.json(
              { error: { code: "document_revision_not_found" } },
              { status: 404 }
            )
          )
        }
        return session.respond(Response.json(revision))
      },
    },
  },
})
