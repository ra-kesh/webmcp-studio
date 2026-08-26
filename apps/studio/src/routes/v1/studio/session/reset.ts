import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { resetDemoSession } from "../../../../server/demo-session"

export const Route = createFileRoute("/v1/studio/session/reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await resetDemoSession(env.DB, request)
        return session.respond(Response.json({ status: "reset" }))
      },
    },
  },
})
