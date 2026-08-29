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
import { createEphemeralArtifactRendererRequest } from "../../../server/artifact-renderer-request"
import { apiIssuesFrom } from "../../../server/api-boundary"
import { readStudioJsonBody } from "../../../server/json-request-policy"
import { MediaAssetRepository } from "../../../server/media-asset-repository"
import { MediaAssetError } from "../../../server/media-assets"
import {
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
} from "../../../server/render-field-assets"
import type { ManagedImageResourceExpectation } from "../../../server/render-field-assets"
import {
  failRenderLeaseWithRetry,
  RenderAdmissionError,
  renderAdmissionErrorResponse,
  reserveRenderCapacity,
} from "../../../server/render-admission-service"
import { rendererBindingFailureResponse } from "../../../server/renderer-invocation-error"
import {
  StudioAccessError,
  resolveStudioPrincipal,
  studioAccessErrorResponse,
} from "../../../server/studio-principal"

const exportRequestSchema = z
  .object({
    outputId: z.string().min(1),
    document: documentSchema,
  })
  .strict()

export const Route = createFileRoute("/v1/studio/export-pdf")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const { workerEnv } = context
        request.signal.throwIfAborted()
        let principal
        try {
          principal = await resolveStudioPrincipal(workerEnv, request)
        } catch (error) {
          if (error instanceof StudioAccessError) {
            return studioAccessErrorResponse(error, false)
          }
          throw error
        }
        const respond = principal.respond
        let input: unknown
        try {
          input = await readStudioJsonBody(request, "/v1/studio/export-pdf")
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return respond(jsonBodyErrorResponse(error))
          }
          throw error
        }
        const parsed = exportRequestSchema.safeParse(input)
        if (!parsed.success) {
          return respond(
            Response.json(
              {
                error: "invalid_export_request",
                issues: apiIssuesFrom(parsed.error.issues),
              },
              { status: 400 }
            )
          )
        }
        request.signal.throwIfAborted()

        let renderDocument: Document
        let expectedImageResources: ManagedImageResourceExpectation[]
        try {
          const mediaAssets = new MediaAssetRepository(
            workerEnv.DB,
            workerEnv.ASSETS
          )
          const materialized = await materializeManagedDocumentAssets(
            parsed.data.document,
            (assetId, resourceSignal) =>
              mediaAssets.resolveRendererSource(
                principal.workspaceId,
                assetId,
                resourceSignal
              ),
            [],
            request.signal
          )
          request.signal.throwIfAborted()
          renderDocument = materialized.document
          expectedImageResources = materialized.resources
          await assertRenderImageResourceAdmission(
            renderDocument,
            expectedImageResources
          )
          request.signal.throwIfAborted()
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

        const output = renderDocument.outputs.find(
          (candidate) => candidate.id === parsed.data.outputId
        )
        if (!output) {
          return respond(
            Response.json({ error: "output_not_found" }, { status: 404 })
          )
        }
        const plan = createRenderResourcePlan(renderDocument, {
          outputId: output.id,
          format: "pdf",
        })
        let lease
        try {
          request.signal.throwIfAborted()
          lease = await reserveRenderCapacity(workerEnv, principal, plan)
        } catch (error) {
          if (error instanceof RenderAdmissionError) {
            return respond(renderAdmissionErrorResponse(error, false))
          }
          throw error
        }

        try {
          request.signal.throwIfAborted()
          const rendererRequest = createEphemeralArtifactRendererRequest({
            path: "/render/pdf",
            signal: request.signal,
            body: {
              renderId: crypto.randomUUID(),
              outputId: output.id,
              document: renderDocument,
              expectedImageResources,
            },
          })
          const rendererResponse =
            await workerEnv.RENDERER.fetch(rendererRequest)
          if (!rendererResponse.ok) {
            await failRenderLeaseWithRetry(lease)
          } else {
            await lease.complete(
              Number(rendererResponse.headers.get("X-Bytes") ?? 0)
            )
          }
          if (request.signal.aborted) {
            await rendererResponse.body?.cancel().catch(() => undefined)
            request.signal.throwIfAborted()
          }

          return respond(
            new Response(rendererResponse.body, {
              status: rendererResponse.status,
              headers: rendererResponse.headers,
            })
          )
        } catch (error) {
          try {
            await failRenderLeaseWithRetry(lease)
          } finally {
            request.signal.throwIfAborted()
          }
          const failure = rendererBindingFailureResponse(error)
          if (failure) return respond(failure)
          throw error
        }
      },
    },
  },
})
