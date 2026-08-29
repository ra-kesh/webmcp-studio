import { describe, expect, it } from "vitest"
import { createEphemeralArtifactRendererRequest } from "./artifact-renderer-request"

describe("createEphemeralArtifactRendererRequest", () => {
  it.each(["/render", "/render/pdf"] as const)(
    "creates a cancellable %s request that cannot leave a stored artifact",
    async (path) => {
      const controller = new AbortController()
      const body = { renderId: "foreground-render", outputId: "proposal" }
      const request = createEphemeralArtifactRendererRequest({
        path,
        body,
        signal: controller.signal,
      })

      expect(request.url).toBe(`https://renderer.internal${path}`)
      expect(request.method).toBe("POST")
      expect(request.headers.get("Content-Type")).toBe("application/json")
      expect(request.headers.get("X-Render-Persistence")).toBe("ephemeral")
      expect(await request.clone().json()).toEqual(body)

      controller.abort(new DOMException("Client left", "AbortError"))
      expect(request.signal.aborted).toBe(true)
      expect(request.signal.reason).toMatchObject({ name: "AbortError" })
    }
  )
})
