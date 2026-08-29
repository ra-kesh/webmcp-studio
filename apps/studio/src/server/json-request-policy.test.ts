import { describe, expect, it } from "vitest"
import type { JsonBodyError } from "@webmcp/worker-boundary"
import {
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
})
