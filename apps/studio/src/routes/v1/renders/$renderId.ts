import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/v1/renders/$renderId")({
  server: {
    handlers: {
      GET: ({ params }) =>
        Response.json({
          id: params.renderId,
          status: "queued",
          note: "The contract is live. D1-backed job persistence is the next implementation slice.",
        }),
    },
  },
})
