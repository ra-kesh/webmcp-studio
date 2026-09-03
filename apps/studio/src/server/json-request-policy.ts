import { readJsonBody } from "@webmcp/worker-boundary"
import type { ReadJsonBodyOptions } from "@webmcp/worker-boundary"

export const LIBRARY_COLLECTION_REORDER_MAX_BYTES = 132_000

export const studioJsonRequestPolicies = {
  "/v1/integrations/composition-handoffs": {
    maxBytes: 2_000_000,
    requireContentLength: true,
  },
  "/v1/studio/export-png": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/export-pdf": {
    maxBytes: 8_000_000,
    requireContentLength: true,
  },
  "/v1/studio/figma-handoffs": {
    maxBytes: 16_000_000,
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
  "/v1/studio/media-derivations": {
    maxBytes: 2_048,
    requireContentLength: true,
  },
  "/v1/studio/library/items/:itemKind/:itemId/versions/:version/favorite": {
    maxBytes: 1_024,
    requireContentLength: true,
  },
  "/v1/studio/library/items/:itemKind/:itemId/versions/:version/used": {
    maxBytes: 2_048,
    requireContentLength: true,
  },
  "/v1/studio/library/collections": {
    maxBytes: 4_096,
    requireContentLength: true,
  },
  "/v1/studio/library/collections/:collectionId": {
    maxBytes: 4_096,
    requireContentLength: true,
  },
  "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version":
    {
      maxBytes: 1_024,
      requireContentLength: true,
    },
  "/v1/studio/library/collections/:collectionId/order": {
    maxBytes: LIBRARY_COLLECTION_REORDER_MAX_BYTES,
    requireContentLength: true,
  },
} as const satisfies Record<string, ReadJsonBodyOptions>

export type StudioJsonRoute = keyof typeof studioJsonRequestPolicies

export const readStudioJsonBody = (
  request: Request,
  route: StudioJsonRoute
): Promise<unknown> => readJsonBody(request, studioJsonRequestPolicies[route])
