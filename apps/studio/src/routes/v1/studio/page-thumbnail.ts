import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { handlePageThumbnailRequest } from "../../../server/page-thumbnail-http"

export const Route = createFileRoute("/v1/studio/page-thumbnail")({
  server: {
    handlers: {
      POST: ({ request }) => handlePageThumbnailRequest(request, env),
    },
  },
})
