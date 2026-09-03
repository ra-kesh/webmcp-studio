import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  figmaHandoffPreflightResponse,
  readFigmaHandoff,
} from "../../../../server/figma-handoff"

export const Route = createFileRoute("/v1/studio/figma-handoffs/$token")({
  server: {
    handlers: {
      GET: ({ params }) => readFigmaHandoff(env.RENDERS, params.token),
      OPTIONS: () => figmaHandoffPreflightResponse(),
    },
  },
})
