import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  composeQuotationDocument,
  quotationCompositionRequestV1Schema,
  quotationTemplates,
} from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { apiIssuesFrom } from "../../../server/api-boundary"
import { readStudioJsonBody } from "../../../server/json-request-policy"
import { requireStudioPrincipal } from "../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/quotation-compositions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        return session.respond(
          Response.json({
            data: quotationTemplates.map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              category: template.category,
            })),
          })
        )
      },
      POST: async ({ request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        const json = (body: unknown, init?: ResponseInit) =>
          session.respond(Response.json(body, init))
        let input: unknown
        try {
          input = await readStudioJsonBody(
            request,
            "/v1/studio/quotation-compositions"
          )
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return session.respond(jsonBodyErrorResponse(error, true))
          }
          throw error
        }
        const parsed = quotationCompositionRequestV1Schema.safeParse(input)
        if (!parsed.success) {
          return json(
            {
              error: {
                code: "invalid_quotation_composition",
                issues: apiIssuesFrom(parsed.error.issues),
              },
            },
            { status: 400 }
          )
        }
        const template = quotationTemplates.find(
          (candidate) => candidate.id === parsed.data.templateId
        )
        if (!template) {
          return json(
            {
              error: {
                code: "unknown_template",
                templateId: parsed.data.templateId,
              },
            },
            { status: 422 }
          )
        }
        const document = composeQuotationDocument(
          parsed.data.payload,
          template.id
        )
        return json({
          data: {
            source: parsed.data.payload.source,
            template: {
              id: template.id,
              name: template.name,
            },
            pageCount: document.pages.length,
            document,
          },
        })
      },
    },
  },
})
