import { createFileRoute } from "@tanstack/react-router"
import { createMediaDerivationHttpHandlers } from "../../../../server/media-derivation-http"
import { mediaDerivationRouteDependencies } from "../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute("/v1/studio/media-derivations/$jobId")({
  server: {
    handlers: {
      GET: ({ request, params, context }) =>
        createMediaDerivationHttpHandlers(
          mediaDerivationRouteDependencies(context.workerEnv)
        ).get(request, params.jobId),
    },
  },
})
