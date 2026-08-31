import { createFileRoute } from "@tanstack/react-router"
import { createMediaDerivationHttpHandlers } from "../../../../server/media-derivation-http"
import { mediaDerivationRouteDependencies } from "../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute("/v1/studio/media-derivations/policy")({
  server: {
    handlers: {
      GET: ({ request, context }) =>
        createMediaDerivationHttpHandlers(
          mediaDerivationRouteDependencies(context.workerEnv)
        ).policy(request),
    },
  },
})
