import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import {
  assertRenderImageResourceAdmission,
  DocumentValidationError,
  assertRenderableDocument,
  createRenderResourcePlan,
  documentSchema,
  RenderImageResourceAdmissionError,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { z } from "zod"
import { readStudioJsonBody } from "../../../server/json-request-policy"
import { MediaAssetRepository } from "../../../server/media-asset-repository"
import { MediaAssetError } from "../../../server/media-assets"
import {
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
} from "../../../server/render-field-assets"
import type { ManagedImageResourceExpectation } from "../../../server/render-field-assets"
import {
  RenderAdmissionError,
  renderAdmissionErrorResponse,
  reserveRenderCapacity,
} from "../../../server/render-admission-service"
import {
  StudioAccessError,
  resolveStudioPrincipal,
  studioAccessErrorResponse,
} from "../../../server/studio-principal"

const exportRequestSchema = z
  .object({
    pageId: z.string().min(1),
    document: documentSchema,
  })
  .strict()

export const Route = createFileRoute("/v1/studio/export-png")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/export-png")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return jsonBodyErrorResponse(error)
          }
          throw error
        }
        const parsed = exportRequestSchema.safeParse(input)
        if (!parsed.success) {
          return Response.json(
            {
              error: "invalid_export_request",
              details: parsed.error.flatten(),
            },
            { status: 400 }
          )
        }
        let principal
        try {
          principal = await resolveStudioPrincipal(env, request)
        } catch (error) {
          if (error instanceof StudioAccessError) {
            return studioAccessErrorResponse(error, false)
          }
          throw error
        }
        const respond = principal.respond

        let renderDocument: Document
        let expectedImageResources: ManagedImageResourceExpectation[]
        try {
          const mediaAssets = new MediaAssetRepository(env.DB, env.ASSETS)
          const materialized = await materializeManagedDocumentAssets(
            parsed.data.document,
            (assetId) =>
              mediaAssets.resolveRendererSource(principal.workspaceId, assetId)
          )
          renderDocument = materialized.document
          expectedImageResources = materialized.resources
          await assertRenderImageResourceAdmission(
            renderDocument,
            expectedImageResources
          )
          assertRenderableDocument(renderDocument)
        } catch (error) {
          if (error instanceof DocumentValidationError) {
            return respond(
              Response.json(
                {
                  error: "document_validation_failed",
                  issues: error.issues,
                },
                { status: 422 }
              )
            )
          }
          if (
            error instanceof ManagedAssetMaterializationError ||
            error instanceof RenderImageResourceAdmissionError
          ) {
            return respond(
              Response.json(
                {
                  error: "render_resource_admission_failed",
                  code: error.code,
                  message: error.message,
                  nodeId: error.nodeId,
                  assetId: error.assetId,
                },
                { status: 422 }
              )
            )
          }
          if (error instanceof MediaAssetError) {
            return respond(
              Response.json(
                {
                  error: "managed_asset_integrity_failed",
                  message:
                    "A managed image failed resource integrity validation",
                },
                { status: 422 }
              )
            )
          }
          throw error
        }

        const page = renderDocument.pages.find(
          (candidate) => candidate.id === parsed.data.pageId
        )
        if (!page) {
          return respond(
            Response.json({ error: "page_not_found" }, { status: 404 })
          )
        }
        const output = renderDocument.outputs.find((candidate) =>
          candidate.pageIds.includes(page.id)
        )
        if (!output) {
          return respond(
            Response.json({ error: "output_not_found" }, { status: 404 })
          )
        }
        const plan = createRenderResourcePlan(renderDocument, {
          outputId: output.id,
          pageId: page.id,
          format: "png",
        })
        let lease
        try {
          lease = await reserveRenderCapacity(env, principal, plan)
        } catch (error) {
          if (error instanceof RenderAdmissionError) {
            return respond(renderAdmissionErrorResponse(error, false))
          }
          throw error
        }

        try {
          const body = JSON.stringify({
            renderId: crypto.randomUUID(),
            outputId: output.id,
            pageId: page.id,
            document: renderDocument,
            expectedImageResources,
          })
          const rendererResponse = await env.RENDERER.fetch(
            new Request("https://renderer.internal/render", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            })
          )
          if (!rendererResponse.ok) {
            await lease.fail()
          } else {
            await lease.complete(
              Number(rendererResponse.headers.get("X-Bytes") ?? 0)
            )
          }

          return respond(
            new Response(rendererResponse.body, {
              status: rendererResponse.status,
              headers: rendererResponse.headers,
            })
          )
        } catch (error) {
          await lease.fail()
          throw error
        }
      },
    },
  },
})
