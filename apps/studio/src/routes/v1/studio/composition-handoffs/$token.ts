import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  D1CompositionHandoffStore,
  redeemCompositionHandoff,
} from "../../../../server/composition-handoff"
import { requireStudioPrincipal } from "../../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/composition-handoffs/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const handoff = await redeemCompositionHandoff({
          token: params.token,
          workspaceId: session.workspaceId,
          store: new D1CompositionHandoffStore(env.DB),
        })
        if (!handoff) {
          return session.respond(
            Response.json(
              {
                error: {
                  code: "composition_handoff_unavailable",
                  message:
                    "This editor link is invalid, expired, or was opened in another workspace.",
                },
              },
              { status: 404, headers: { "Cache-Control": "no-store" } }
            )
          )
        }
        return session.respond(
          Response.json(
            { data: { handoff } },
            { headers: { "Cache-Control": "no-store" } }
          )
        )
      },
    },
  },
})
