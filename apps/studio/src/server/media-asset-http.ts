import type { StudioPrincipal } from "./studio-principal"
import {
  mediaAssetArchiveResponseSchema,
  mediaAssetDeletionImpactResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetLookupResponseSchema,
  mediaAssetUploadResponseSchema,
} from "@webmcp/document"
import {
  assertMediaAssetId,
  assertMediaIdempotencyKey,
  MAX_MEDIA_ASSET_BYTES,
  MAX_MEDIA_LIST_LIMIT,
  MediaAssetError,
  validateMediaUpload,
} from "./media-assets"
import { MediaAssetRepository } from "./media-asset-repository"

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
    | "contentMetadata"
    | "content"
    | "deletionImpact"
    | "markUsed"
    | "archive"
  >
}

const errorResponse = (error: MediaAssetError) =>
  Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status }
  )

const withMediaErrors = async (operation: () => Promise<Response>) => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof MediaAssetError) return errorResponse(error)
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
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
        return principal.respond(
          Response.json(
            mediaAssetUploadResponseSchema.parse({ asset: result.asset }),
            { status: result.created ? 201 : 200 }
          )
        )
      }),

    content: (request: Request, assetIdInput: string) =>
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
        const asset = await repository.markUsed(
          principal.workspaceId,
          assertMediaAssetId(assetIdInput)
        )
        return principal.respond(
          Response.json(mediaAssetUploadResponseSchema.parse({ asset }))
        )
      }),

    archive: (request: Request, assetIdInput: string) =>
      withMediaErrors(async () => {
        const principal = await principalFor(dependencies, request)
        if (principal instanceof Response) return principal
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
