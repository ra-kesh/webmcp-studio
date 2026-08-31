import { createFileRoute } from "@tanstack/react-router"
import {
  createMediaDerivationHttpHandlers,
  createMediaDerivationReadHttpHandlers,
} from "../../../../../server/media-derivation-http"
import {
  mediaDerivationReadRouteDependencies,
  mediaDerivationRouteDependencies,
} from "../../../../../server/media-derivation-route-dependencies"

export const Route = createFileRoute("/v1/studio/assets/$assetId/derivations")({
  server: {
    handlers: {
      GET: ({ request, params, context }) =>
        createMediaDerivationReadHttpHandlers(
          mediaDerivationReadRouteDependencies(context.workerEnv)
        ).latest(request, params.assetId),
      POST: ({ request, params, context }) =>
        createMediaDerivationHttpHandlers(
          mediaDerivationRouteDependencies(context.workerEnv)
        ).create(request, params.assetId),
    },
  },
})
