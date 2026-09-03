import type { StudioInterchangePackage } from "@webmcp/document"

const FIGMA_HANDOFF_PREFIX = "figma-handoffs/"
const FIGMA_HANDOFF_TTL_MS = 10 * 60_000
const FIGMA_HANDOFF_MAX_BYTES = 24_000_000
const FIGMA_HANDOFF_TOKEN = /^[a-f0-9]{64}$/

const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

const objectKey = (handoffToken: string) =>
  `${FIGMA_HANDOFF_PREFIX}${handoffToken}.json`

export type FigmaHandoffReceipt = Readonly<{
  token: string
  expiresAt: string
}>

export async function createFigmaHandoff(
  bucket: R2Bucket,
  interchange: StudioInterchangePackage,
  signal?: AbortSignal
): Promise<FigmaHandoffReceipt> {
  signal?.throwIfAborted()
  const body = JSON.stringify(interchange)
  const byteLength = new TextEncoder().encode(body).byteLength
  if (byteLength > FIGMA_HANDOFF_MAX_BYTES) {
    throw new RangeError(
      "The editable package is too large for a Figma handoff. Download the Studio package instead."
    )
  }

  const handoffToken = token()
  const expiresAt = new Date(Date.now() + FIGMA_HANDOFF_TTL_MS).toISOString()
  const key = objectKey(handoffToken)
  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      expiresAt,
      documentId: interchange.source.documentId,
      format: interchange.format,
      version: String(interchange.version),
    },
  })
  try {
    signal?.throwIfAborted()
  } catch (error) {
    await bucket.delete(key)
    throw error
  }
  return { token: handoffToken, expiresAt }
}

const unavailable = (status: 404 | 410, code: string, message: string) =>
  Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    }
  )

export async function readFigmaHandoff(
  bucket: R2Bucket,
  handoffToken: string
): Promise<Response> {
  if (!FIGMA_HANDOFF_TOKEN.test(handoffToken)) {
    return unavailable(
      404,
      "figma_handoff_unavailable",
      "This Figma handoff link is invalid or unavailable."
    )
  }
  const key = objectKey(handoffToken)
  const object = await bucket.get(key)
  if (!object) {
    return unavailable(
      404,
      "figma_handoff_unavailable",
      "This Figma handoff link is invalid or unavailable."
    )
  }
  const expiresAt = Date.parse(object.customMetadata?.expiresAt ?? "")
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await bucket.delete(key)
    return unavailable(
      410,
      "figma_handoff_expired",
      "This Figma handoff link has expired. Create a new export in Studio."
    )
  }
  return new Response(object.body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Length": String(object.size),
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export const figmaHandoffPreflightResponse = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "600",
    },
  })
