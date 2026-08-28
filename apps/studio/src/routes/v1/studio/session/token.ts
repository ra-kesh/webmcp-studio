import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { requireStudioPrincipal } from "../../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/session/token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        if (session.mode !== "local_demo") {
          return Response.json(
            {
              error: {
                code: "access_token_export_disabled",
                message:
                  "Production API clients must authenticate through Cloudflare Access",
              },
            },
            { status: 409 }
          )
        }
        return session.respond(
          Response.json(
            {
              token: session.id,
              expiresAt: session.expiresAt,
            },
            {
              headers: { "Cache-Control": "no-store" },
            }
          )
        )
      },
    },
  },
})
