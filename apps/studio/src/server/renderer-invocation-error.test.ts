import { describe, expect, it } from "vitest"
import {
  rendererBindingFailureResponse,
  rendererInvocationErrorFromResponse,
} from "./renderer-invocation-error"
import type { RendererInvocationError } from "./renderer-invocation-error"

describe("renderer invocation errors", () => {
  it("preserves stable node-specific resource failure details", async () => {
    const error = await rendererInvocationErrorFromResponse(
      Response.json(
        {
          error: "render_resource_failed",
          code: "image_resource_source_mismatch",
          message: "Required render resource failed for node hero-image",
          nodeId: "hero-image",
          assetId: "asset-abcdefghij",
        },
        { status: 422 }
      )
    )

    expect(error).toEqual(
      expect.objectContaining<Partial<RendererInvocationError>>({
        code: "image_resource_source_mismatch",
        message: "Required render resource failed for node hero-image",
        status: 422,
        nodeId: "hero-image",
        assetId: "asset-abcdefghij",
      })
    )
  })

  it("uses a bounded stable fallback for malformed renderer responses", async () => {
    const error = await rendererInvocationErrorFromResponse(
      new Response("not-json".repeat(1_000), { status: 502 })
    )

    expect(error).toMatchObject({
      code: "renderer_failed",
      message: "Renderer returned 502",
      status: 502,
    })
  })

  it("turns Browser Rendering capacity errors into retryable responses", async () => {
    const cause = new Error(
      "Unable to create new browser: code: 429: message: Rate limit exceeded"
    )
    const error = new Error("Renderer binding failed", { cause })
    const response = rendererBindingFailureResponse(error)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)
    expect(response?.headers.get("Retry-After")).toBe("10")
    await expect(response?.json()).resolves.toMatchObject({
      error: "renderer_capacity_exhausted",
      code: "browser_session_rate_limited",
      retryable: true,
    })
  })

  it("does not hide unrelated renderer binding defects", () => {
    expect(rendererBindingFailureResponse(new Error("programmer defect"))).toBe(
      null
    )
  })
})
