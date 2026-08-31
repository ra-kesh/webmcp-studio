import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createLibraryHttpHandlers } from "../../../../../server/library-http"
import { requireStudioPrincipal } from "../../../../../server/studio-principal"

const handlers = createLibraryHttpHandlers({
  db: env.DB,
  requirePrincipal: (request) => requireStudioPrincipal(env, request),
})

export const Route = createFileRoute("/v1/studio/library/items/")({
  server: { handlers: { GET: ({ request }) => handlers.listItems(request) } },
})
