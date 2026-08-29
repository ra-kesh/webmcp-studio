import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createMediaAssetHttpHandlers } from "../../../../server/media-asset-http"
import { reserveMediaUploadCapacity } from "../../../../server/render-admission-service"
import { requireStudioPrincipal } from "../../../../server/studio-principal"

const handlers = createMediaAssetHttpHandlers({
  db: env.DB,
  bucket: env.ASSETS,
  requirePrincipal: (request) => requireStudioPrincipal(env, request),
  reserveUpload: (principal, input) =>
    reserveMediaUploadCapacity(env, principal, input),
})

export const Route = createFileRoute("/v1/studio/assets/")({
  server: {
    handlers: {
      GET: ({ request }) => handlers.list(request),
      POST: ({ request }) => handlers.upload(request),
    },
  },
})
