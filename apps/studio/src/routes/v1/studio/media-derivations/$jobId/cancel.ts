import { createFileRoute } from "@tanstack/react-router"
import { createMediaDerivationHttpHandlers } from "../../../../../server/media-derivation-http"
import { mediaDerivationRouteDependencies } from "../../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute(
  "/v1/studio/media-derivations/$jobId/cancel"
)({
  server: {
    handlers: {
      POST: ({ request, params, context }) =>
        createMediaDerivationHttpHandlers(
          mediaDerivationRouteDependencies(context.workerEnv)
        ).cancel(request, params.jobId),
    },
  },
})
