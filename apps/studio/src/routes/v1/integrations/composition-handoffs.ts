import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { ZodError } from "zod"
import { apiIssuesFrom } from "../../../server/api-boundary"
import {
  createCompositionHandoff,
  D1CompositionHandoffStore,
  hasValidCompositionHandoffCredential,
} from "../../../server/composition-handoff"
import { readStudioJsonBody } from "../../../server/json-request-policy"

type IntegrationEnvironment = {
  STUDIO_HANDOFF_SECRET?: string
}

export const Route = createFileRoute("/v1/integrations/composition-handoffs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = (env as unknown as IntegrationEnvironment)
          .STUDIO_HANDOFF_SECRET
        if (
          !(await hasValidCompositionHandoffCredential(request, expectedSecret))
        ) {
          return Response.json(
            { error: { code: "composition_handoff_unauthorized" } },
            { status: 401, headers: { "Cache-Control": "no-store" } }
          )
        }

        let input: unknown
        try {
          input = await readStudioJsonBody(
            request,
            "/v1/integrations/composition-handoffs"
          )
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return jsonBodyErrorResponse(error, true)
          }
          throw error
        }

        try {
          const token = await createCompositionHandoff({
            input,
            store: new D1CompositionHandoffStore(env.DB),
          })
          const editorUrl = new URL(
            `/composition-handoffs/${encodeURIComponent(token)}`,
            request.url
          ).toString()
          return Response.json(
            { data: { editorUrl } },
            { status: 201, headers: { "Cache-Control": "no-store" } }
          )
        } catch (error) {
          if (error instanceof ZodError) {
            return Response.json(
              {
                error: {
                  code: "invalid_composition_handoff",
                  issues: apiIssuesFrom(error.issues),
                },
              },
              { status: 400, headers: { "Cache-Control": "no-store" } }
            )
          }
          throw error
        }
      },
    },
  },
})
