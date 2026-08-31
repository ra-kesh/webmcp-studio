import { createFileRoute } from "@tanstack/react-router"
import { createMediaDerivationHttpHandlers } from "../../../../../server/media-derivation-http"
import { mediaDerivationRouteDependencies } from "../../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute("/v1/studio/assets/$assetId/derivations")({
  server: {
    handlers: {
      POST: ({ request, params, context }) =>
        createMediaDerivationHttpHandlers(
          mediaDerivationRouteDependencies(context.workerEnv)
        ).create(request, params.assetId),
    },
  },
})
