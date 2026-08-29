import { readJsonBody } from "@webmcp/worker-boundary"
import type { ReadJsonBodyOptions } from "@webmcp/worker-boundary"

export const studioJsonRequestPolicies = {
  "/v1/studio/export-png": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/export-pdf": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/page-thumbnail": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/render": {
    maxBytes: 256_000,
    requireContentLength: true,
  },
  "/v1/studio/templates/": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/quotation-compositions": {
    maxBytes: 2_000_000,
    requireContentLength: true,
  },
  "/v1/studio/assets/local-promotions/resolve": {
    maxBytes: 32_000,
    requireContentLength: true,
  },
} as const satisfies Record<string, ReadJsonBodyOptions>

export type StudioJsonRoute = keyof typeof studioJsonRequestPolicies

export const readStudioJsonBody = (
  request: Request,
  route: StudioJsonRoute
): Promise<unknown> => readJsonBody(request, studioJsonRequestPolicies[route])
