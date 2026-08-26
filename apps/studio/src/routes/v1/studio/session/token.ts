import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resolveDemoSession } from "../../../../server/demo-session"

export const Route = createFileRoute("/v1/studio/session/token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await resolveDemoSession(env.DB, request)
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
