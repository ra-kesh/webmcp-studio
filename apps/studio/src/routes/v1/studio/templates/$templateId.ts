import { createFileRoute } from "@tanstack/react-router"
import { northstarSeed } from "@webmcp/document"

export const Route = createFileRoute("/v1/studio/templates/$templateId")({
  server: {
    handlers: {
      GET: ({ params }) => {
        if (params.templateId !== "northstar-wedding-proposal") {
          return Response.json({ error: "template_not_found" }, { status: 404 })
        }
        return Response.json({
          id: params.templateId,
          name: "Northstar wedding proposal pack",
          latestVersion: 1,
          fields: northstarSeed.fields.map(
            ({ id, key, label, type, required, defaultValue }) => ({
              id,
              key,
              label,
              type,
              required,
              defaultValue,
            })
          ),
          outputs: northstarSeed.outputs,
        })
      },
    },
  },
})
