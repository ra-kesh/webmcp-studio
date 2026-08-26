import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

const renderRequestSchema = z.object({
  templateId: z.string().min(1),
  version: z.number().int().positive().optional(),
  modifications: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
  response: z.object({
    type: z.enum(["url", "base64"]),
    outputs: z
      .array(
        z.object({
          outputId: z.string().min(1),
          format: z.enum(["png", "pdf"]),
          scale: z.number().positive().max(4).optional(),
        })
      )
      .min(1),
  }),
})

const MAX_REQUEST_BYTES = 256_000

export const Route = createFileRoute("/v1/studio/render")({
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
        if (contentLength > MAX_REQUEST_BYTES) {
          return Response.json(
            { error: "request_too_large", maxBytes: MAX_REQUEST_BYTES },
            { status: 413 }
          )
        }
        const parsed = renderRequestSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json(
            {
              error: "invalid_render_request",
              details: parsed.error.flatten(),
            },
            { status: 400 }
          )
        }
        if (parsed.data.templateId !== "northstar-wedding-proposal") {
          return Response.json({ error: "template_not_found" }, { status: 404 })
        }

        const renderId = crypto.randomUUID()
        return Response.json(
          {
            id: renderId,
            status: "queued",
            templateId: parsed.data.templateId,
            version: parsed.data.version ?? 1,
            outputs: parsed.data.response.outputs,
            responseType: parsed.data.response.type,
            statusUrl: `/v1/renders/${renderId}`,
          },
          { status: 202 }
        )
      },
    },
  },
})
