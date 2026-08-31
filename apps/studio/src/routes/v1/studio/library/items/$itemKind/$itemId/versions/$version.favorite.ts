import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createLibraryHttpHandlers } from "../../../../../../../../server/library-http"
import { requireStudioPrincipal } from "../../../../../../../../server/studio-principal"

const handlers = createLibraryHttpHandlers({
  db: env.DB,
  requirePrincipal: (request) => requireStudioPrincipal(env, request),
})

export const Route = createFileRoute(
  "/v1/studio/library/items/$itemKind/$itemId/versions/$version/favorite"
)({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        handlers.setFavorite(
          request,
          params.itemKind,
          params.itemId,
          params.version
        ),
    },
  },
})
