import {
  createCuratedMediaResourceFetcher,
  CuratedMediaContentError,
  resolveCuratedMediaContent,
} from "../content/library/media/curated-media-content"

const immutableCacheControl = "public, max-age=31536000, immutable"

export async function handleCuratedMediaContentRequest(
  request: Request,
  env: Env,
  assetId: string,
  version: number
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    })
  }
  try {
    const content = await resolveCuratedMediaContent(
      { assetId, version },
      createCuratedMediaResourceFetcher(env.CURATED_MEDIA),
      request.signal
    )
    const etag = `"sha256-${content.identity.contentSha256}"`
    const headers = new Headers({
      "Cache-Control": immutableCacheControl,
      "Content-Length": String(content.bytes.byteLength),
      "Content-Type": content.item.mimeType,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    })
    if (request.headers.get("If-None-Match") === etag) {
      headers.delete("Content-Length")
      headers.delete("Content-Type")
      return new Response(null, { status: 304, headers })
    }
    return new Response(
      request.method === "HEAD" ? null : content.bytes.slice().buffer,
      {
        status: 200,
        headers,
      }
    )
  } catch (error) {
    if (error instanceof CuratedMediaContentError) {
      return Response.json(
        {
          error:
            error.reason === "identity_invalid"
              ? "curated_media_not_found"
              : "curated_media_integrity_failed",
        },
        {
          status: error.reason === "identity_invalid" ? 404 : 422,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        }
      )
    }
    throw error
  }
}
