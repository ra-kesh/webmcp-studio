import { describe, expect, it } from "vitest"
import { rendererInvocationErrorFromResponse } from "./renderer-invocation-error"
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
})
