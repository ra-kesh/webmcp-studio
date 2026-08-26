import { createFileRoute } from "@tanstack/react-router"
import { northstarSeed } from "@webmcp/document"

export const Route = createFileRoute("/v1/studio/templates/")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          data: [
            {
              id: "northstar-wedding-proposal",
              name: "Northstar wedding proposal pack",
              latestVersion: 1,
              outputs: northstarSeed.outputs.map((output) => ({
                id: output.id,
                name: output.name,
                kind: output.kind,
                formats: output.exportFormats,
              })),
            },
          ],
        }),
    },
  },
})
