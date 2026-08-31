import { createFileRoute } from "@tanstack/react-router"
import { handleCuratedMediaContentRequest } from "../../../../../../../../server/curated-media-http"

export const Route = createFileRoute(
  "/v1/studio/library/media/$assetId/versions/$version/content"
)({
  server: {
    handlers: {
      GET: ({ request, context, params }) =>
        handleCuratedMediaContentRequest(
          request,
          context.workerEnv,
          params.assetId,
          Number(params.version)
        ),
      HEAD: ({ request, context, params }) =>
        handleCuratedMediaContentRequest(
          request,
          context.workerEnv,
          params.assetId,
          Number(params.version)
        ),
    },
  },
})
