import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createMediaAssetHttpHandlers } from "../../../../../server/media-asset-http"
import { requireStudioPrincipal } from "../../../../../server/studio-principal"

const handlers = createMediaAssetHttpHandlers({
  db: env.DB,
  bucket: env.ASSETS,
  requirePrincipal: (request) => requireStudioPrincipal(env, request),
})

export const Route = createFileRoute("/v1/studio/assets/$assetId/content")({
  server: {
    handlers: {
      GET: ({ params, request }) => handlers.content(request, params.assetId),
    },
  },
})
