import type { StudioPrincipal } from "./studio-principal"
import {
  localAssetIdSchema,
  localAssetPromotionLookupResponseSchema,
  localAssetPromotionResolveRequestSchema,
  localAssetPromotionResolveResponseSchema,
  localAssetPromotionResponseSchema,
  mediaAssetArchiveResponseSchema,
  mediaAssetDeletionImpactResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetLookupResponseSchema,
  mediaAssetUseResponseSchema,
  mediaAssetUploadResponseSchema,
} from "@webmcp/document"
import { JsonBodyError, jsonBodyErrorResponse } from "@webmcp/worker-boundary"
import { apiIssuesFrom, requestIdFor } from "./api-boundary"
import {
  assertMediaAssetId,
  assertMediaIdempotencyKey,
  MAX_MEDIA_ASSET_BYTES,
  MAX_MEDIA_LIST_LIMIT,
  MediaAssetError,
  validateMediaUpload,
} from "./media-assets"
import { MediaAssetRepository } from "./media-asset-repository"
import { readStudioJsonBody } from "./json-request-policy"
import {
  completeRenderLeaseWithRetry,
  failRenderLeaseWithRetry,
  RenderAdmissionError,
  renderAdmissionErrorResponse,
} from "./render-admission-service"
import type { RenderAdmissionLease } from "./render-admission-service"

type PrincipalResolver = (
  request: Request
) => Promise<StudioPrincipal | Response>

export type MediaAssetHttpDependencies = {
  db: D1Database
  bucket: R2Bucket
  requirePrincipal: PrincipalResolver
  repository?: Pick<
    MediaAssetRepository,
    | "list"
    | "lookup"
    | "upload"
    | "storageUsage"
    | "contentMetadata"
    | "content"
    | "deletionImpact"
    | "markUsed"
    | "archive"
    | "promoteLocalAsset"
    | "lookupLocalPromotion"
    | "resolveLocalPromotions"
  >
  reserveUpload?: (
    principal: StudioPrincipal,
    input: {
      reservationId: string
      estimatedStorageBytes: number
      currentStorageBytes: number
      currentAssetCount: number
    }
  ) => Promise<RenderAdmissionLease>
}

const errorResponse = (error: MediaAssetError) =>
  Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status }
  )

const withMediaPrincipal = async (
  dependencies: MediaAssetHttpDependencies,
  request: Request,
  operation: (principal: StudioPrincipal) => Promise<Response>
) => {
  const principal = await principalFor(dependencies, request)
  if (principal instanceof Response) return principal
  try {
    return await operation(principal)
  } catch (error) {
    if (error instanceof MediaAssetError) {
      return principal.respond(errorResponse(error))
    }
    throw error
  }
}

const repositoryFor = (dependencies: MediaAssetHttpDependencies) =>
  dependencies.repository ??
  new MediaAssetRepository(dependencies.db, dependencies.bucket)

const principalFor = async (
  dependencies: MediaAssetHttpDependencies,
  request: Request
) => dependencies.requirePrincipal(request)

const parseListRequest = (request: Request) => {
  const searchParams = new URL(request.url).searchParams
  const collection = searchParams.get("collection") ?? "uploads"
  if (collection !== "uploads" && collection !== "recent") {
    throw new MediaAssetError(
      "invalid_collection",
      400,
      "Asset collection must be uploads or recent"
    )
  }
  const query = (searchParams.get("query") ?? "").trim()
  if (query.length > 200) {
    throw new MediaAssetError(
      "invalid_collection",
      400,
      "Asset query must contain at most 200 characters"
    )
  }
  const rawLimit = searchParams.get("limit")
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MEDIA_LIST_LIMIT) {
    throw new MediaAssetError(
      "invalid_collection",
      400,
      `Asset list limit must be an integer from 1-${MAX_MEDIA_LIST_LIMIT}`
    )
  }
  return {
    collection,
    query,
    limit,
    cursor: searchParams.get("cursor"),
  } as const
}

export function createMediaAssetHttpHandlers(
  dependencies: MediaAssetHttpDependencies
) {
  const repository = repositoryFor(dependencies)
  return {
    list: (request: Request) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const response = await repository.list(
          principal.workspaceId,
          parseListRequest(request)
        )
        return principal.respond(
          Response.json(mediaAssetListResponseSchema.parse(response), {
            headers: { "Cache-Control": "private, no-store" },
          })
        )
      }),

    lookup: (request: Request, assetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const asset = await repository.lookup(
          principal.workspaceId,
          assertMediaAssetId(assetIdInput)
        )
        return principal.respond(
          Response.json(mediaAssetLookupResponseSchema.parse({ asset }), {
            headers: { "Cache-Control": "private, no-store" },
          })
        )
      }),

    upload: (request: Request) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const contentType = request.headers.get("content-type") ?? ""
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
          throw new MediaAssetError(
            "invalid_multipart_request",
            415,
            "Asset uploads must use multipart/form-data"
          )
        }
        const contentLength = request.headers.get("content-length")
        if (!contentLength) {
          throw new MediaAssetError(
            "missing_content_length",
            411,
            "Asset uploads require Content-Length"
          )
        }
        const parsedLength = Number(contentLength)
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 1) {
          throw new MediaAssetError(
            "invalid_multipart_request",
            400,
            "Content-Length is invalid"
          )
        }
        if (parsedLength > MAX_MEDIA_ASSET_BYTES + 1_000_000) {
          throw new MediaAssetError(
            "upload_too_large",
            413,
            "Multipart upload exceeds the image upload limit"
          )
        }
        const idempotencyKey = assertMediaIdempotencyKey(
          request.headers.get("idempotency-key")
        )
        if (!dependencies.reserveUpload) {
          throw new Error("Media upload admission is not configured")
        }
        const storage = await repository.storageUsage(principal.workspaceId)
        let lease: RenderAdmissionLease
        try {
          lease = await dependencies.reserveUpload(principal, {
            // Transport attempts own admission independently. The caller's
            // idempotency key deduplicates repository results, but must never
            // let concurrent parsers or R2 producers share one capacity slot.
            reservationId: `media-upload-${crypto.randomUUID()}`,
            estimatedStorageBytes: Math.min(
              parsedLength,
              MAX_MEDIA_ASSET_BYTES
            ),
            currentStorageBytes: storage.bytes,
            currentAssetCount: storage.count,
          })
        } catch (error) {
          if (error instanceof RenderAdmissionError) {
            return principal.respond(renderAdmissionErrorResponse(error))
          }
          throw error
        }
        try {
          let form: FormData
          try {
            form = await request.formData()
          } catch {
            throw new MediaAssetError(
              "invalid_multipart_request",
              400,
              "Multipart upload could not be decoded"
            )
          }
          const file = form.get("file")
          if (
            !(file instanceof Blob) ||
            typeof Reflect.get(file, "name") !== "string"
          ) {
            throw new MediaAssetError(
              "invalid_multipart_request",
              400,
              "Multipart upload must contain one file field"
            )
          }
          const suppliedName = form.get("name")
          if (suppliedName !== null && typeof suppliedName !== "string") {
            throw new MediaAssetError(
              "invalid_asset_name",
              400,
              "Asset name must be text"
            )
          }
          const validated = await validateMediaUpload(
            file,
            suppliedName ?? undefined
          )
          const result = await repository.upload(
            principal.workspaceId,
            validated,
            idempotencyKey
          )
          await completeRenderLeaseWithRetry(
            lease,
            result.created ? validated.byteLength : 0
          )
          return principal.respond(
            Response.json(
              mediaAssetUploadResponseSchema.parse({ asset: result.asset }),
              { status: result.created ? 201 : 200 }
            )
          )
        } catch (error) {
          await failRenderLeaseWithRetry(lease)
          throw error
        }
      }),

    promoteLocal: (request: Request) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const contentType = request.headers.get("content-type") ?? ""
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
          throw new MediaAssetError(
            "invalid_multipart_request",
            415,
            "Local asset promotion must use multipart/form-data"
          )
        }
        const contentLength = request.headers.get("content-length")
        if (!contentLength) {
          throw new MediaAssetError(
            "missing_content_length",
            411,
            "Local asset promotion requires Content-Length"
          )
        }
        const parsedLength = Number(contentLength)
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 1) {
          throw new MediaAssetError(
            "invalid_multipart_request",
            400,
            "Content-Length is invalid"
          )
        }
        if (parsedLength > MAX_MEDIA_ASSET_BYTES + 1_000_000) {
          throw new MediaAssetError(
            "upload_too_large",
            413,
            "Multipart promotion exceeds the image upload limit"
          )
        }
        const idempotencyKey = assertMediaIdempotencyKey(
          request.headers.get("idempotency-key")
        )
        if (!idempotencyKey) {
          throw new MediaAssetError(
            "invalid_idempotency_key",
            400,
            "Local asset promotion requires Idempotency-Key"
          )
        }
        if (!dependencies.reserveUpload) {
          throw new Error("Media upload admission is not configured")
        }
        const storage = await repository.storageUsage(principal.workspaceId)
        let lease: RenderAdmissionLease
        try {
          lease = await dependencies.reserveUpload(principal, {
            reservationId: `media-promotion-${crypto.randomUUID()}`,
            estimatedStorageBytes: Math.min(
              parsedLength,
              MAX_MEDIA_ASSET_BYTES
            ),
            currentStorageBytes: storage.bytes,
            currentAssetCount: storage.count,
          })
        } catch (error) {
          if (error instanceof RenderAdmissionError) {
            return principal.respond(renderAdmissionErrorResponse(error))
          }
          throw error
        }
        try {
          let form: FormData
          try {
            form = await request.formData()
          } catch {
            throw new MediaAssetError(
              "invalid_multipart_request",
              400,
              "Multipart promotion could not be decoded"
            )
          }
          const localAssetIdInput = form.get("localAssetId")
          const parsedLocalAssetId =
            localAssetIdSchema.safeParse(localAssetIdInput)
          if (!parsedLocalAssetId.success) {
            throw new MediaAssetError(
              "invalid_local_asset_ids",
              400,
              "Multipart promotion must contain one valid localAssetId field"
            )
          }
          const file = form.get("file")
          if (
            !(file instanceof Blob) ||
            typeof Reflect.get(file, "name") !== "string"
          ) {
            throw new MediaAssetError(
              "invalid_multipart_request",
              400,
              "Multipart promotion must contain one file field"
            )
          }
          const suppliedName = form.get("name")
          if (suppliedName !== null && typeof suppliedName !== "string") {
            throw new MediaAssetError(
              "invalid_asset_name",
              400,
              "Asset name must be text"
            )
          }
          const validated = await validateMediaUpload(
            file,
            suppliedName ?? undefined
          )
          const result = await repository.promoteLocalAsset(
            principal.workspaceId,
            parsedLocalAssetId.data,
            validated,
            idempotencyKey,
            principal.id
          )
          await completeRenderLeaseWithRetry(lease, result.storageDeltaBytes)
          return principal.respond(
            Response.json(localAssetPromotionResponseSchema.parse(result), {
              status: result.storageDeltaBytes > 0 ? 201 : 200,
              headers: { "Cache-Control": "private, no-store" },
            })
          )
        } catch (error) {
          await failRenderLeaseWithRetry(lease)
          throw error
        }
      }),

    lookupLocalPromotion: (request: Request, localAssetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const parsed = localAssetIdSchema.safeParse(localAssetIdInput)
        if (!parsed.success) {
          throw new MediaAssetError(
            "invalid_local_asset_ids",
            400,
            "Local asset ID is malformed"
          )
        }
        const promotion = await repository.lookupLocalPromotion(
          principal.workspaceId,
          parsed.data
        )
        return principal.respond(
          Response.json(
            localAssetPromotionLookupResponseSchema.parse({ promotion }),
            { headers: { "Cache-Control": "private, no-store" } }
          )
        )
      }),

    resolveLocalPromotions: (request: Request) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        let input: unknown
        try {
          input = await readStudioJsonBody(
            request,
            "/v1/studio/assets/local-promotions/resolve"
          )
        } catch (error) {
          if (error instanceof JsonBodyError) {
            return principal.respond(jsonBodyErrorResponse(error, true))
          }
          throw error
        }
        const parsed = localAssetPromotionResolveRequestSchema.safeParse(input)
        if (!parsed.success) {
          return principal.respond(
            Response.json(
              {
                error: {
                  code: "invalid_local_asset_ids",
                  message: "Resolve requires 1-100 distinct local asset IDs",
                  issues: apiIssuesFrom(parsed.error.issues),
                },
              },
              { status: 400, headers: { "Cache-Control": "no-store" } }
            )
          )
        }
        const results = await repository.resolveLocalPromotions(
          principal.workspaceId,
          parsed.data.localAssetIds
        )
        return principal.respond(
          Response.json(
            localAssetPromotionResolveResponseSchema.parse({ results }),
            { headers: { "Cache-Control": "private, no-store" } }
          )
        )
      }),

    content: (request: Request, assetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const assetId = assertMediaAssetId(assetIdInput)
        const metadata = await repository.contentMetadata(
          principal.workspaceId,
          assetId
        )
        const etag = `"sha256-${metadata.contentHash}"`
        const headers = new Headers({
          "Cache-Control": "private, max-age=31536000, immutable",
          ETag: etag,
          "Content-Type": metadata.asset.mediaType,
          "Content-Length": String(metadata.asset.bytes),
          "X-Content-Type-Options": "nosniff",
        })
        if (request.headers.get("if-none-match") === etag) {
          return principal.respond(new Response(null, { status: 304, headers }))
        }
        const content = await repository.content(principal.workspaceId, assetId)
        return principal.respond(new Response(content.body, { headers }))
      }),

    deletionImpact: (request: Request, assetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const impact = await repository.deletionImpact(
          principal.workspaceId,
          assertMediaAssetId(assetIdInput)
        )
        return principal.respond(
          Response.json(
            mediaAssetDeletionImpactResponseSchema.parse({ impact })
          )
        )
      }),

    markUsed: (request: Request, assetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const idempotencyKey = assertMediaIdempotencyKey(
          request.headers.get("idempotency-key")
        )
        if (!idempotencyKey) {
          throw new MediaAssetError(
            "invalid_idempotency_key",
            400,
            "Marking an asset used requires Idempotency-Key"
          )
        }
        const receipt = await repository.markUsed(
          principal.workspaceId,
          assertMediaAssetId(assetIdInput),
          idempotencyKey
        )
        const requestId = requestIdFor(request)
        return principal.respond(
          Response.json(mediaAssetUseResponseSchema.parse({ receipt }), {
            headers: {
              "Cache-Control": "private, no-store",
              "X-Request-Id": requestId,
            },
          })
        )
      }),

    archive: (request: Request, assetIdInput: string) =>
      withMediaPrincipal(dependencies, request, async (principal) => {
        const revisionHeader = request.headers.get("if-match")
        const revisionMatch = revisionHeader?.match(/^"asset-revision-(\d+)"$/)
        const impactToken = request.headers.get("x-asset-impact-token")?.trim()
        if (!revisionMatch || !impactToken) {
          throw new MediaAssetError(
            "asset_impact_stale",
            412,
            'Archive requires If-Match: "asset-revision-N" and X-Asset-Impact-Token from the deletion-impact response'
          )
        }
        const revision = Number(revisionMatch[1])
        if (!Number.isSafeInteger(revision) || revision < 1) {
          throw new MediaAssetError(
            "asset_revision_mismatch",
            412,
            "Asset revision precondition is invalid"
          )
        }
        const archived = await repository.archive(
          principal.workspaceId,
          assertMediaAssetId(assetIdInput),
          revision,
          impactToken
        )
        return principal.respond(
          Response.json(mediaAssetArchiveResponseSchema.parse(archived))
        )
      }),
  }
}
