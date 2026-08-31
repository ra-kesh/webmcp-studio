import { createFileRoute } from "@tanstack/react-router"
import { createMediaDerivationReadHttpHandlers } from "../../../../../server/media-derivation-http"
import { mediaDerivationReadRouteDependencies } from "../../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute(
  "/v1/studio/assets/$assetId/derivation-provenance"
)({
  server: {
    handlers: {
      GET: ({ request, params, context }) =>
        createMediaDerivationReadHttpHandlers(
          mediaDerivationReadRouteDependencies(context.workerEnv)
        ).provenance(request, params.assetId),
    },
  },
})
