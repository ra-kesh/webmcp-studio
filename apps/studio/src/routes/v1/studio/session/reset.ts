import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resetDemoSession } from "../../../../server/demo-session"
import { isLocalStudioRequest } from "../../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/session/reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isLocalStudioRequest(request)) {
          return Response.json(
            {
              error: {
                code: "studio_demo_reset_unavailable",
                message: "Demo session reset is available only on localhost",
              },
            },
            { status: 404 }
          )
        }
        const session = await resetDemoSession(env.DB, request)
        return session.respond(Response.json({ status: "reset" }))
      },
    },
  },
})
