import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createLibraryHttpHandlers } from "../../../../../../../../../../server/library-http"
import { requireStudioPrincipal } from "../../../../../../../../../../server/studio-principal"

const handlers = createLibraryHttpHandlers({
  db: env.DB,
  requirePrincipal: (request) => requireStudioPrincipal(env, request),
})

export const Route = createFileRoute(
  "/v1/studio/library/collections/$collectionId/items/$itemKind/$itemId/versions/$version"
)({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        handlers.addCollectionMember(
          request,
          params.collectionId,
          params.itemKind,
          params.itemId,
          params.version
        ),
      DELETE: ({ request, params }) =>
        handlers.removeCollectionMember(
          request,
          params.collectionId,
          params.itemKind,
          params.itemId,
          params.version
        ),
    },
  },
})
