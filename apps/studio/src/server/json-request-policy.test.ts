import { describe, expect, it } from "vitest"
import { libraryReorderCollectionMembersRequestSchema } from "@webmcp/document"
import type { JsonBodyError } from "@webmcp/worker-boundary"
import {
  LIBRARY_COLLECTION_REORDER_MAX_BYTES,
  readStudioJsonBody,
  studioJsonRequestPolicies,
} from "./json-request-policy"
import type { StudioJsonRoute } from "./json-request-policy"

const routes = [
  "/v1/studio/export-png",
  "/v1/studio/export-pdf",
  "/v1/studio/page-thumbnail",
  "/v1/studio/render",
  "/v1/studio/templates/",
  "/v1/studio/quotation-compositions",
  "/v1/studio/assets/local-promotions/resolve",
  "/v1/studio/media-derivations",
  "/v1/studio/library/items/:itemKind/:itemId/versions/:version/favorite",
  "/v1/studio/library/items/:itemKind/:itemId/versions/:version/used",
  "/v1/studio/library/collections",
  "/v1/studio/library/collections/:collectionId",
  "/v1/studio/library/collections/:collectionId/items/:itemKind/:itemId/versions/:version",
  "/v1/studio/library/collections/:collectionId/order",
] as const satisfies readonly StudioJsonRoute[]

const jsonRequest = (body: string, contentLength?: string) => {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (contentLength !== undefined) {
    headers.set("Content-Length", contentLength)
  }
  return new Request("https://studio.test/", {
    method: "POST",
    headers,
    body,
  })
}

describe("Studio JSON request policies", () => {
  it("registers every JSON-consuming public route with its production cap", () => {
    expect(Object.keys(studioJsonRequestPolicies)).toEqual(routes)
    expect(studioJsonRequestPolicies).toEqual({
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
    })
  })

  it("parses exact-length JSON and returns 411 for headerless JSON on every route", async () => {
    for (const route of routes) {
      await expect(
        readStudioJsonBody(jsonRequest("{}", "2"), route)
      ).resolves.toEqual({})
      await expect(
        readStudioJsonBody(jsonRequest("{}"), route)
      ).rejects.toMatchObject({
        code: "content_length_required",
        status: 411,
      } satisfies Partial<JsonBodyError>)
    }
  })

  it("returns 413 for an oversized headerless stream before the 411 policy", async () => {
    const policy = studioJsonRequestPolicies["/v1/studio/render"]
    const body = `"${"x".repeat(policy.maxBytes)}"`
    await expect(
      readStudioJsonBody(jsonRequest(body), "/v1/studio/render")
    ).rejects.toMatchObject({
      code: "request_too_large",
      status: 413,
      maxBytes: policy.maxBytes,
    } satisfies Partial<JsonBodyError>)
  })

  it("admits the largest schema-valid 500-member reorder body", async () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      orderedIdentities: Array.from({ length: 500 }, (_, index) => ({
        itemKind: "template",
        id: `${"a".repeat(190)}${String(index).padStart(10, "0")}`,
        version: Number.MAX_SAFE_INTEGER,
      })),
    })
    const bytes = new TextEncoder().encode(body).byteLength
    expect(
      libraryReorderCollectionMembersRequestSchema.safeParse(JSON.parse(body))
        .success
    ).toBe(true)
    expect(bytes).toBe(129_541)
    expect(LIBRARY_COLLECTION_REORDER_MAX_BYTES).toBeGreaterThanOrEqual(bytes)
    await expect(
      readStudioJsonBody(
        jsonRequest(body, String(bytes)),
        "/v1/studio/library/collections/:collectionId/order"
      )
    ).resolves.toEqual(JSON.parse(body))
  })
})
