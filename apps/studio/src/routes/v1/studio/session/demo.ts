import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createDemoSession } from "../../../../server/demo-session"
import {
  StudioAccessError,
  admitPublicDemoSessionCreation,
  isPublicDemoMode,
  studioAccessErrorResponse,
} from "../../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/session/demo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isPublicDemoMode(env)) {
          return Response.json(
            {
              error: {
                code: "studio_demo_login_unavailable",
                message: "Demo login is not enabled for this deployment",
              },
            },
            { status: 404 }
          )
        }

        const requestOrigin = request.headers.get("Origin")
        if (requestOrigin !== new URL(request.url).origin) {
          return Response.json(
            {
              error: {
                code: "studio_demo_origin_invalid",
                message: "Demo login must start from this site",
              },
            },
            { status: 403 }
          )
        }

        try {
          await admitPublicDemoSessionCreation(env, request)
          const session = await createDemoSession(env.DB, request)
          return session.respond(
            Response.json(
              { status: "ready", expiresAt: session.expiresAt },
              { headers: { "Cache-Control": "no-store" } }
            )
          )
        } catch (error) {
          if (error instanceof StudioAccessError) {
            return studioAccessErrorResponse(error)
          }
          throw error
        }
      },
    },
  },
})
