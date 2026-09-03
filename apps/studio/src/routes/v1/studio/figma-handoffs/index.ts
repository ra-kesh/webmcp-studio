import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  createStudioInterchangePackage,
  studioInterchangePackageSchema,
} from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import {
  createCuratedMediaResourceFetcher,
  resolveCuratedMediaContent,
} from "../../../../content/library/media/curated-media-content"
import { apiIssuesFrom } from "../../../../server/api-boundary"
import { createFigmaHandoff } from "../../../../server/figma-handoff"
import { readStudioJsonBody } from "../../../../server/json-request-policy"
import { MediaAssetRepository } from "../../../../server/media-asset-repository"
import {
  CuratedAssetMaterializationError,
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
} from "../../../../server/render-field-assets"
import { requireStudioPrincipal } from "../../../../server/studio-principal"

export const Route = createFileRoute("/v1/studio/figma-handoffs/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireStudioPrincipal(env, request)
        if (session instanceof Response) return session
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/figma-handoffs")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return session.respond(jsonBodyErrorResponse(error, true))
          }
          throw error
        }
        const parsed = studioInterchangePackageSchema.safeParse(input)
        if (!parsed.success) {
          return session.respond(
            Response.json(
              {
                error: {
                  code: "invalid_figma_handoff_package",
                  message:
                    "The request is not a valid Studio interchange package.",
                  issues: apiIssuesFrom(parsed.error.issues),
                },
              },
              { status: 400 }
            )
          )
        }

        request.signal.throwIfAborted()
        let interchange
        try {
          const mediaAssets = new MediaAssetRepository(env.DB, env.ASSETS)
          const fetchCuratedResource = createCuratedMediaResourceFetcher(
            env.CURATED_MEDIA,
            request.url
          )
          const materialized = await materializeManagedDocumentAssets(
            parsed.data.document,
            (assetId, signal) =>
              mediaAssets.resolveRendererSource(
                session.workspaceId,
                assetId,
                signal
              ),
            [],
            request.signal,
            (assetId, version, signal) =>
              resolveCuratedMediaContent(
                { assetId, version },
                fetchCuratedResource,
                signal
              )
          )
          interchange = createStudioInterchangePackage(materialized.document)
        } catch (error) {
          if (
            error instanceof ManagedAssetMaterializationError ||
            error instanceof CuratedAssetMaterializationError
          ) {
            return session.respond(
              Response.json(
                {
                  error: {
                    code: "figma_handoff_asset_unavailable",
                    message:
                      "One of the document images could not be prepared for Figma.",
                    assetId: error.assetId,
                    nodeId: error.nodeId,
                  },
                },
                { status: 422 }
              )
            )
          }
          throw error
        }

        if (interchange.assets.some((asset) => asset.sourceKind === "local")) {
          return session.respond(
            Response.json(
              {
                error: {
                  code: "figma_handoff_local_asset_unavailable",
                  message:
                    "One of the document images is still device-only. Download the Studio package instead.",
                },
              },
              { status: 422 }
            )
          )
        }

        let receipt
        try {
          receipt = await createFigmaHandoff(
            env.RENDERS,
            interchange,
            request.signal
          )
        } catch (error) {
          if (error instanceof RangeError) {
            return session.respond(
              Response.json(
                {
                  error: {
                    code: "figma_handoff_too_large",
                    message: error.message,
                  },
                },
                { status: 413 }
              )
            )
          }
          throw error
        }
        const handoffUrl = new URL(
          `/v1/studio/figma-handoffs/${receipt.token}`,
          request.url
        ).toString()
        return session.respond(
          Response.json(
            { data: { handoffUrl, expiresAt: receipt.expiresAt } },
            {
              status: 201,
              headers: {
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
              },
            }
          )
        )
      },
    },
  },
})
