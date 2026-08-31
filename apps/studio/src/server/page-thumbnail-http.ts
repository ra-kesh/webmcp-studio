import {
  assertPageThumbnailSize,
  assertRenderImageResourceAdmission,
  assertRenderableDocument,
  createPageThumbnailDocument,
  createPageThumbnailRenderResourcePlan,
  decodeDocument,
  DocumentMigrationError,
  DocumentValidationError,
  pageThumbnailLimits,
  PageThumbnailSizeError,
  RenderImageResourceAdmissionError,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { z } from "zod"
import { readStudioJsonBody } from "./json-request-policy"
import { MediaAssetRepository } from "./media-asset-repository"
import {
  createCuratedMediaResourceFetcher,
  resolveCuratedMediaContent,
} from "../content/library/media/curated-media-content"
import { MediaAssetError } from "./media-assets"
import {
  CuratedAssetMaterializationError,
  ManagedAssetMaterializationError,
  materializeManagedDocumentAssets,
} from "./render-field-assets"
import type { ManagedImageResourceExpectation } from "./render-field-assets"
import {
  failRenderLeaseWithRetry,
  RenderAdmissionError,
  renderAdmissionErrorResponse,
  reserveThumbnailCapacity,
} from "./render-admission-service"
import type { RenderAdmissionLease } from "./render-admission-service"
import {
  StudioAccessError,
  resolveStudioPrincipal,
  studioAccessErrorResponse,
} from "./studio-principal"
import type { StudioPrincipal } from "./studio-principal"
import { apiIssuesFrom } from "./api-boundary"

const thumbnailSizeSchema = z
  .object({
    width: z
      .number()
      .int()
      .min(pageThumbnailLimits.minDimension)
      .max(pageThumbnailLimits.maxDimension),
    height: z
      .number()
      .int()
      .min(pageThumbnailLimits.minDimension)
      .max(pageThumbnailLimits.maxDimension),
  })
  .strict()

export const pageThumbnailRequestSchema = z
  .object({
    pageId: z.string().min(1),
    size: thumbnailSizeSchema,
    document: z
      .unknown()
      .refine((document) => document !== undefined, "Document is required"),
  })
  .strict()

type PreparedThumbnailDocument = {
  document: Document
  expectedImageResources: ManagedImageResourceExpectation[]
}

export type PageThumbnailHandlerDependencies = {
  resolvePrincipal: (env: Env, request: Request) => Promise<StudioPrincipal>
  prepareDocument: (
    env: Env,
    principal: StudioPrincipal,
    document: Document,
    signal: AbortSignal
  ) => Promise<PreparedThumbnailDocument>
  reserveCapacity: typeof reserveThumbnailCapacity
  invokeRenderer: (env: Env, request: Request) => Promise<Response>
  createRenderId: () => string
}

const productionDependencies: PageThumbnailHandlerDependencies = {
  resolvePrincipal: resolveStudioPrincipal,
  prepareDocument: async (env, principal, document, signal) => {
    signal.throwIfAborted()
    const mediaAssets = new MediaAssetRepository(env.DB, env.ASSETS)
    const fetchCuratedResource = createCuratedMediaResourceFetcher(
      env.CURATED_MEDIA
    )
    const materialized = await materializeManagedDocumentAssets(
      document,
      (assetId, resourceSignal) =>
        mediaAssets.resolveRendererSource(
          principal.workspaceId,
          assetId,
          resourceSignal
        ),
      [],
      signal,
      (assetId, version, resourceSignal) =>
        resolveCuratedMediaContent(
          { assetId, version },
          fetchCuratedResource,
          resourceSignal
        )
    )
    signal.throwIfAborted()
    await assertRenderImageResourceAdmission(
      materialized.document,
      materialized.resources
    )
    assertRenderableDocument(materialized.document)
    return {
      document: materialized.document,
      expectedImageResources: materialized.resources,
    }
  },
  reserveCapacity: reserveThumbnailCapacity,
  invokeRenderer: (env, request) => env.RENDERER.fetch(request),
  createRenderId: () => crypto.randomUUID(),
}

function resourceFailureResponse(error: unknown): Response | null {
  if (error instanceof DocumentValidationError) {
    return Response.json(
      { error: "document_validation_failed", issues: error.issues },
      { status: 422 }
    )
  }
  if (
    error instanceof ManagedAssetMaterializationError ||
    error instanceof CuratedAssetMaterializationError ||
    error instanceof RenderImageResourceAdmissionError
  ) {
    return Response.json(
      {
        error: "render_resource_admission_failed",
        code: error.code,
        message: error.message,
        nodeId: error.nodeId,
        assetId: error.assetId,
      },
      { status: 422 }
    )
  }
  if (error instanceof MediaAssetError) {
    return Response.json(
      {
        error: "managed_asset_integrity_failed",
        message: "A managed image failed resource integrity validation",
      },
      { status: 422 }
    )
  }
  return null
}

function thumbnailSizeFailureResponse(error: PageThumbnailSizeError) {
  return Response.json(
    {
      error: "invalid_thumbnail_dimensions",
      code: error.code,
      message: error.message,
    },
    { status: 422 }
  )
}

const rendererThumbnailHeadersAreValid = (
  response: Response,
  expected: {
    outputId: string
    pageId: string
    renderId: string
    width: number
    height: number
  }
) => {
  const bytes = Number(response.headers.get("X-Bytes"))
  return (
    response.headers.get("Content-Type") === "image/png" &&
    response.headers.get("Cache-Control") === "no-store" &&
    response.headers.get("X-Render-Mode") === "ephemeral-thumbnail" &&
    response.headers.get("X-Render-Key") === null &&
    response.headers.get("X-Render-Id") === expected.renderId &&
    response.headers.get("X-Output-Id") === expected.outputId &&
    response.headers.get("X-Page-Id") === expected.pageId &&
    response.headers.get("X-Width") === String(expected.width) &&
    response.headers.get("X-Height") === String(expected.height) &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    response.headers.get("Content-Length") === String(bytes)
  )
}

export function createPageThumbnailRequestHandler(
  dependencies: PageThumbnailHandlerDependencies = productionDependencies
) {
  return async (request: Request, env: Env): Promise<Response> => {
    let principal: StudioPrincipal
    try {
      principal = await dependencies.resolvePrincipal(env, request)
    } catch (error) {
      if (error instanceof StudioAccessError) {
        return studioAccessErrorResponse(error, false)
      }
      throw error
    }
    const respond = principal.respond
    let input: unknown
    try {
      input = await readStudioJsonBody(request, "/v1/studio/page-thumbnail")
    } catch (error) {
      if (error instanceof JsonBodyError) {
        return respond(jsonBodyErrorResponse(error))
      }
      throw error
    }
    const parsed = pageThumbnailRequestSchema.safeParse(input)
    if (!parsed.success) {
      return respond(
        Response.json(
          {
            error: "invalid_thumbnail_request",
            issues: apiIssuesFrom(parsed.error.issues),
          },
          { status: 400 }
        )
      )
    }

    let document: Document
    try {
      document = decodeDocument(parsed.data.document).document
    } catch (error) {
      if (error instanceof z.ZodError) {
        return respond(
          Response.json(
            {
              error: "invalid_thumbnail_request",
              issues: apiIssuesFrom(
                error.issues.map((issue) => ({
                  ...issue,
                  path: ["document", ...issue.path],
                }))
              ),
            },
            { status: 400 }
          )
        )
      }
      if (error instanceof DocumentMigrationError) {
        return respond(
          Response.json(
            {
              error: "invalid_thumbnail_request",
              issues: [
                {
                  path: ["document"],
                  code: "document_migration_failed",
                  message: error.message,
                },
              ],
            },
            { status: 400 }
          )
        )
      }
      const failure = resourceFailureResponse(error)
      if (failure) return respond(failure)
      throw error
    }

    const requestedPage = document.pages.find(
      (candidate) => candidate.id === parsed.data.pageId
    )
    if (!requestedPage) {
      return respond(
        Response.json({ error: "page_not_found" }, { status: 404 })
      )
    }
    const requestedOutput = document.outputs.find(
      (candidate) =>
        candidate.id === requestedPage.outputId &&
        candidate.pageIds.includes(requestedPage.id)
    )
    if (!requestedOutput) {
      return respond(
        Response.json({ error: "output_not_found" }, { status: 404 })
      )
    }
    try {
      assertPageThumbnailSize(requestedPage, parsed.data.size)
    } catch (error) {
      if (error instanceof PageThumbnailSizeError) {
        return respond(thumbnailSizeFailureResponse(error))
      }
      throw error
    }

    const thumbnailDocument = createPageThumbnailDocument(
      document,
      requestedPage.id
    )

    let prepared: PreparedThumbnailDocument
    try {
      prepared = await dependencies.prepareDocument(
        env,
        principal,
        thumbnailDocument,
        request.signal
      )
    } catch (error) {
      const failure = resourceFailureResponse(error)
      if (failure) return respond(failure)
      throw error
    }
    request.signal.throwIfAborted()

    const page = prepared.document.pages.find(
      (candidate) => candidate.id === parsed.data.pageId
    )
    if (!page) {
      return respond(
        Response.json({ error: "page_not_found" }, { status: 404 })
      )
    }
    const output = prepared.document.outputs.find(
      (candidate) =>
        candidate.id === page.outputId && candidate.pageIds.includes(page.id)
    )
    if (!output) {
      return respond(
        Response.json({ error: "output_not_found" }, { status: 404 })
      )
    }

    assertPageThumbnailSize(page, parsed.data.size)
    const plan = createPageThumbnailRenderResourcePlan(prepared.document, {
      outputId: output.id,
      pageId: page.id,
      size: parsed.data.size,
    })

    let lease: RenderAdmissionLease
    try {
      request.signal.throwIfAborted()
      lease = await dependencies.reserveCapacity(env, principal, plan)
    } catch (error) {
      if (error instanceof RenderAdmissionError) {
        return respond(renderAdmissionErrorResponse(error, false))
      }
      throw error
    }
    if (request.signal.aborted) {
      await failRenderLeaseWithRetry(lease)
      request.signal.throwIfAborted()
    }

    const renderId = dependencies.createRenderId()
    try {
      const rendererRequest = new Request(
        "https://renderer.internal/render/thumbnail",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId,
            outputId: output.id,
            pageId: page.id,
            size: parsed.data.size,
            document: prepared.document,
            expectedImageResources: prepared.expectedImageResources,
          }),
          signal: request.signal,
        }
      )
      const rendererResponse = await dependencies.invokeRenderer(
        env,
        rendererRequest
      )
      if (request.signal.aborted) {
        await rendererResponse.body?.cancel().catch(() => undefined)
        request.signal.throwIfAborted()
      }
      if (!rendererResponse.ok) {
        await failRenderLeaseWithRetry(lease)
      } else if (
        !rendererThumbnailHeadersAreValid(rendererResponse, {
          outputId: output.id,
          pageId: page.id,
          renderId,
          ...parsed.data.size,
        })
      ) {
        await rendererResponse.body?.cancel()
        await failRenderLeaseWithRetry(lease)
        return respond(
          Response.json(
            { error: "invalid_thumbnail_renderer_response" },
            { status: 502 }
          )
        )
      } else {
        await lease.complete(Number(rendererResponse.headers.get("X-Bytes")))
      }

      return respond(
        new Response(rendererResponse.body, {
          status: rendererResponse.status,
          headers: rendererResponse.headers,
        })
      )
    } catch (error) {
      await failRenderLeaseWithRetry(lease)
      throw error
    }
  }
}

export const handlePageThumbnailRequest = createPageThumbnailRequestHandler()
