import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { documentSchema } from "@webmcp/document"
import { z } from "zod"

const exportRequestSchema = z.object({
  outputId: z.string().min(1),
  document: documentSchema,
})

const MAX_EXPORT_REQUEST_BYTES = 8_000_000

export const Route = createFileRoute("/v1/studio/export-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? 0)
        if (!contentLength) {
          return Response.json(
            { error: "content_length_required" },
            { status: 411 }
          )
        }
        if (contentLength > MAX_EXPORT_REQUEST_BYTES) {
          return Response.json(
            {
              error: "request_too_large",
              maxBytes: MAX_EXPORT_REQUEST_BYTES,
            },
            { status: 413 }
          )
        }

        const parsed = exportRequestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            {
              error: "invalid_export_request",
              details: parsed.error.flatten(),
            },
            { status: 400 }
          )
        }
        const output = parsed.data.document.outputs.find(
          (candidate) => candidate.id === parsed.data.outputId
        )
        if (!output) {
          return Response.json({ error: "output_not_found" }, { status: 404 })
        }

        const body = JSON.stringify({
          renderId: crypto.randomUUID(),
          outputId: output.id,
          document: parsed.data.document,
        })
        const rendererResponse = await env.RENDERER.fetch(
          new Request("https://renderer.internal/render/pdf", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body,
          })
        )

        return new Response(rendererResponse.body, {
          status: rendererResponse.status,
          headers: rendererResponse.headers,
        })
      },
    },
  },
})
