import { beforeEach, describe, expect, it, vi } from "vitest"
import { northstarSeed } from "@webmcp/document"
import { launch } from "@cloudflare/playwright"
import { MAX_RENDER_ARTIFACT_BYTES } from "../src/artifact-body"

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }))

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function successfulBrowserPage(pdfBytes: number[]) {
  return {
    setContent: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => ({
      ready: true,
      code: null as string | null,
      nodeId: undefined as string | undefined,
    })),
    pdf: vi.fn(async () => Uint8Array.from(pdfBytes)),
    screenshot: vi.fn(async () => Uint8Array.from([1, 2, 3])),
    setViewportSize: vi.fn(async () => undefined),
  }
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

async function managedImageFixture() {
  const document = structuredClone(northstarSeed)
  const sourceBytes = Uint8Array.from([1, 2, 3, 4])
  const src = "data:image/png;base64,AQIDBA=="
  const contentHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", sourceBytes)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
  document.pages[0]!.nodeIds.push("managed-image")
  document.nodes.push({
    id: "managed-image",
    name: "Managed image",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId: "asset-abcdefghij",
    src,
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    alt: "Managed image",
    decorative: false,
  })
  return {
    document,
    resource: {
      nodeId: "managed-image",
      assetId: "asset-abcdefghij",
      width: 1_200,
      height: 800,
      contentHash,
      revision: 3,
    },
  }
}

describe("renderer Worker", () => {
  beforeEach(() => {
    vi.mocked(launch).mockReset()
  })

  it("waits for resources, then stores and returns a sized browser PDF", async () => {
    const { default: worker } = await import("../src/index")
    const pdfBytes = [37, 80, 68, 70, 45, 49, 46, 55]
    const browserPage = successfulBrowserPage(pdfBytes)
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const put = vi.fn(async (_key: string, body: unknown) => {
      expect(body).toBeInstanceOf(Uint8Array)
      expect([...(body as Uint8Array)]).toEqual(pdfBytes)
      return { size: pdfBytes.length, etag: "test-checksum" }
    })
    const get = vi.fn(async () => ({
      size: pdfBytes.length,
      etag: "test-checksum",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from(pdfBytes))
          controller.close()
        },
      }),
    }))
    const env = {
      BROWSER: {},
      RENDERS: {
        put,
        get,
      },
    } as unknown as Env
    const request = new Request("https://renderer.internal/render/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        renderId: "render-integration-test",
        outputId: "proposal",
        document: northstarSeed,
        expectedImageResources: [],
      }),
    })

    const response = await worker.fetch(request as never, env)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Length")).toBe(String(pdfBytes.length))
    expect(response.headers.get("X-Render-Key")).toBe(
      "render-integration-test/proposal.pdf"
    )
    expect(response.headers.get("X-Page-Count")).toBe(
      String(
        northstarSeed.outputs.find((output) => output.id === "proposal")!
          .pageIds.length
      )
    )
    expect(response.headers.get("X-Bytes")).toBe(String(pdfBytes.length))
    expect(response.headers.get("X-Checksum")).toBe("test-checksum")
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(pdfBytes)
    expect(browserPage.waitForFunction).toHaveBeenCalledOnce()
    expect(browserPage.evaluate).toHaveBeenCalledOnce()
    expect(browserPage.pdf).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it("stores a durable-job PDF once and returns metadata without reading it back", async () => {
    const { default: worker } = await import("../src/index")
    const pdfBytes = [37, 80, 68, 70]
    const browserPage = successfulBrowserPage(pdfBytes)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn(async () => ({
      size: pdfBytes.length,
      etag: "metadata-checksum",
    }))
    const get = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          renderId: "metadata-render",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put, get } } as unknown as Env
    )

    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(response.headers.get("Preference-Applied")).toBe("return=minimal")
    expect(response.headers.get("X-Bytes")).toBe(String(pdfBytes.length))
    expect(put).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
  })

  it("rejects an oversized PDF before R2 without allocating a threshold fixture", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([])
    browserPage.pdf.mockResolvedValue({
      byteLength: MAX_RENDER_ARTIFACT_BYTES + 1,
    } as never)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "oversized-render",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: "render_artifact_too_large",
      code: "artifact_too_large",
      maxBytes: MAX_RENDER_ARTIFACT_BYTES,
      receivedBytes: MAX_RENDER_ARTIFACT_BYTES + 1,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it("rejects an oversized PNG before R2", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([])
    browserPage.screenshot.mockResolvedValue({
      byteLength: MAX_RENDER_ARTIFACT_BYTES + 1,
    } as never)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "oversized-png",
          outputId: "proposal",
          pageId: "cover",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: "render_artifact_too_large",
      receivedBytes: MAX_RENDER_ARTIFACT_BYTES + 1,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it("fails a direct download deterministically when the stored artifact cannot be read", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([37, 80, 68, 70])
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn(async () => ({ size: 4, etag: "stored" }))
    const get = vi.fn(async () => null)
    const remove = vi.fn(async () => undefined)
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "missing-stored-render",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put, get, delete: remove } } as unknown as Env
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "render_artifact_unavailable",
      key: "missing-stored-render/proposal.pdf",
    })
    expect(put).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith("missing-stored-render/proposal.pdf")
  })

  it("rejects aggregate-invalid documents before Browser Rendering or R2", async () => {
    const { default: worker } = await import("../src/index")
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      ...document.nodes[0]!,
      id: "orphan-render-node",
      name: "Orphan render node",
    })
    const put = vi.fn()
    const env = {
      BROWSER: {},
      RENDERS: { put },
    } as unknown as Env
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "invalid-render",
          outputId: "proposal",
          document,
          expectedImageResources: [],
        }),
      }) as never,
      env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "document_validation_failed",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "orphan_node" }),
        ]),
      })
    )
    expect(launch).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it("rejects unknown public request keys", async () => {
    const { default: worker } = await import("../src/index")
    const env = {
      BROWSER: {},
      RENDERS: { put: vi.fn() },
    } as unknown as Env
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "strict-render",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
          unexpected: true,
        }),
      }) as never,
      env
    )

    expect(response.status).toBe(400)
    expect(launch).not.toHaveBeenCalled()
  })

  it("requires an explicit image-resource admission manifest", async () => {
    const { default: worker } = await import("../src/index")
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "missing-resource-manifest",
          outputId: "proposal",
          document: northstarSeed,
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: "invalid_pdf_render_request",
    })
    expect(launch).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON before Browser Rendering or R2", async () => {
    const { default: worker } = await import("../src/index")
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }) as never,
      {
        BROWSER: {},
        RENDERS: { put },
      } as unknown as Env
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "invalid_json" })
    expect(launch).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it.each(["/render", "/render/pdf", "/render/thumbnail"])(
    "rejects the complete JSON transport matrix on %s before Browser Rendering or R2",
    async (path) => {
      const { default: worker } = await import("../src/index")
      const put = vi.fn()
      const env = {
        BROWSER: {},
        RENDERS: { put },
      } as unknown as Env
      const oversized = `"${"x".repeat(8_000_000)}"`
      const cases: Array<{
        name: string
        body: string
        headers: Record<string, string>
        status: number
        code: string
      }> = [
        {
          name: "empty",
          body: "",
          headers: { "Content-Type": "application/json" },
          status: 400,
          code: "empty_json_body",
        },
        {
          name: "malformed",
          body: "{",
          headers: { "Content-Type": "application/json" },
          status: 400,
          code: "invalid_json",
        },
        {
          name: "wrong content type",
          body: "{}",
          headers: { "Content-Type": "text/plain" },
          status: 400,
          code: "unsupported_media_type",
        },
        {
          name: "invalid length",
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "nope",
          },
          status: 400,
          code: "invalid_content_length",
        },
        {
          name: "mismatched length",
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "3",
          },
          status: 400,
          code: "invalid_content_length",
        },
        {
          name: "declared oversized",
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "8000001",
          },
          status: 413,
          code: "request_too_large",
        },
        {
          name: "headerless oversized",
          body: oversized,
          headers: { "Content-Type": "application/json" },
          status: 413,
          code: "request_too_large",
        },
      ]

      for (const boundaryCase of cases) {
        const response = await worker.fetch(
          new Request(`https://renderer.internal${path}`, {
            method: "POST",
            headers: boundaryCase.headers,
            body: boundaryCase.body,
          }) as never,
          env
        )

        expect(response.status, boundaryCase.name).toBe(boundaryCase.status)
        expect(await response.json(), boundaryCase.name).toMatchObject({
          error: boundaryCase.code,
        })
      }

      expect(launch).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    }
  )

  it("rejects network and CSS authority before Browser Rendering or R2", async () => {
    const { default: worker } = await import("../src/index")
    const document = structuredClone(northstarSeed)
    const firstPage = document.pages[0]!
    firstPage.background = "#fff;background:url(https://attacker.test/a)"
    firstPage.nodeIds.push("remote-image")
    document.nodes.push({
      id: "remote-image",
      type: "image",
      name: "Remote image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "remote-image",
      src: "https://attacker.test/image.png",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: false,
    })
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "unsafe-render",
          outputId: "proposal",
          document,
          expectedImageResources: [],
        }),
      }) as never,
      {
        BROWSER: {},
        RENDERS: { put },
      } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: "document_validation_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unsafe_render_value" }),
        expect.objectContaining({ code: "unmanaged_asset" }),
      ]),
    })
    expect(launch).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it("rejects a failed required image before PDF generation or R2", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([37, 80, 68, 70])
    browserPage.evaluate.mockResolvedValue({
      ready: false,
      code: "image_decode_failed",
      nodeId: "cover-image",
    })
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const put = vi.fn()

    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "resource-failure",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: "render_resource_failed",
      code: "image_decode_failed",
      message: "Required render resource failed for node cover-image",
      nodeId: "cover-image",
    })
    expect(browserPage.pdf).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("rejects managed natural-dimension drift before PDF generation or R2", async () => {
    const { default: worker } = await import("../src/index")
    const fixture = await managedImageFixture()
    const browserPage = successfulBrowserPage([37, 80, 68, 70])
    browserPage.evaluate.mockResolvedValue({
      ready: false,
      code: "image_dimension_mismatch",
      nodeId: "managed-image",
    })
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const put = vi.fn()

    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "dimension-mismatch",
          outputId: "proposal",
          document: fixture.document,
          expectedImageResources: [fixture.resource],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: "render_resource_failed",
      code: "image_dimension_mismatch",
      message: "Required render resource failed for node managed-image",
      nodeId: "managed-image",
    })
    expect(browserPage.pdf).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("rejects a managed source digest mismatch before Browser Rendering or R2", async () => {
    const { default: worker } = await import("../src/index")
    const fixture = await managedImageFixture()
    const put = vi.fn()

    const response = await worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "source-mismatch",
          outputId: "proposal",
          document: fixture.document,
          expectedImageResources: [
            { ...fixture.resource, contentHash: "a".repeat(64) },
          ],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: "render_resource_failed",
      code: "image_resource_source_mismatch",
      message: "Required render resource failed for node managed-image",
      nodeId: "managed-image",
      assetId: "asset-abcdefghij",
    })
    expect(launch).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it("rejects a resource timeout before PNG capture or R2", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([])
    browserPage.waitForFunction.mockRejectedValue(new Error("timeout"))
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const put = vi.fn()

    const response = await worker.fetch(
      new Request("https://renderer.internal/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "resource-timeout",
          outputId: "proposal",
          pageId: "cover",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: "render_resource_failed",
      code: "resource_readiness_timeout",
    })
    expect(browserPage.screenshot).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("returns an exact ephemeral thumbnail without writing or reading R2", async () => {
    const { default: worker } = await import("../src/index")
    const bytes = pngHeader(124, 175)
    const browserPage = successfulBrowserPage([])
    browserPage.screenshot.mockResolvedValue(bytes)
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const put = vi.fn()
    const get = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "thumbnail-render",
          outputId: "proposal",
          pageId: "cover",
          size: { width: 124, height: 175 },
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put, get } } as unknown as Env
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length))
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("X-Render-Mode")).toBe("ephemeral-thumbnail")
    expect(response.headers.get("X-Render-Id")).toBe("thumbnail-render")
    expect(response.headers.get("X-Page-Id")).toBe("cover")
    expect(response.headers.get("X-Output-Id")).toBe("proposal")
    expect(response.headers.get("X-Width")).toBe("124")
    expect(response.headers.get("X-Height")).toBe("175")
    expect(response.headers.get("X-Render-Key")).toBeNull()
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      ...bytes,
    ])
    expect(browserPage.setViewportSize).toHaveBeenCalledWith({
      width: 124,
      height: 175,
    })
    expect(browserPage.setContent).toHaveBeenCalledWith(
      expect.stringContaining("transform:scale(0.1)"),
      { waitUntil: "networkidle" }
    )
    expect(browserPage.screenshot).toHaveBeenCalledWith({
      type: "png",
      fullPage: false,
    })
    expect(put).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    {
      format: "PNG",
      path: "/render",
      requestFields: { pageId: "cover" },
      bytes: [1, 2, 3],
      contentType: "image/png",
      filename: 'attachment; filename="cover.png"',
      details: {
        "X-Page-Id": "cover",
        "X-Output-Id": "proposal",
        "X-Width": String(northstarSeed.pages[0]!.width),
        "X-Height": String(northstarSeed.pages[0]!.height),
      },
    },
    {
      format: "PDF",
      path: "/render/pdf",
      requestFields: {},
      bytes: [37, 80, 68, 70],
      contentType: "application/pdf",
      filename: 'attachment; filename="proposal.pdf"',
      details: {
        "X-Output-Id": "proposal",
        "X-Page-Count": String(
          northstarSeed.outputs.find((output) => output.id === "proposal")!
            .pageIds.length
        ),
      },
    },
  ] as const)(
    "returns a $format foreground artifact from memory without touching R2",
    async ({ path, requestFields, bytes, contentType, filename, details }) => {
      const { default: worker } = await import("../src/index")
      const browserPage = successfulBrowserPage([...bytes])
      browserPage.screenshot.mockResolvedValue(Uint8Array.from(bytes))
      const close = vi.fn(async () => undefined)
      vi.mocked(launch).mockResolvedValue({
        newPage: vi.fn(async () => browserPage),
        close,
      } as never)
      const put = vi.fn()
      const get = vi.fn()
      const remove = vi.fn()

      const response = await worker.fetch(
        new Request(`https://renderer.internal${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Render-Persistence": "ephemeral",
          },
          body: JSON.stringify({
            renderId: "foreground-export",
            outputId: "proposal",
            document: northstarSeed,
            expectedImageResources: [],
            ...requestFields,
          }),
        }) as never,
        {
          BROWSER: {},
          RENDERS: { put, get, delete: remove },
        } as unknown as Env
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe(contentType)
      expect(response.headers.get("Content-Disposition")).toBe(filename)
      expect(response.headers.get("Content-Length")).toBe(String(bytes.length))
      expect(response.headers.get("Cache-Control")).toBe("no-store")
      expect(response.headers.get("X-Render-Mode")).toBe("ephemeral-export")
      expect(response.headers.get("X-Render-Id")).toBe("foreground-export")
      expect(response.headers.get("X-Bytes")).toBe(String(bytes.length))
      expect(response.headers.get("X-Render-Key")).toBeNull()
      for (const [name, value] of Object.entries(details)) {
        expect(response.headers.get(name)).toBe(value)
      }
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
        ...bytes,
      ])
      expect(put).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    [{ width: 513, height: 512 }, 400, "invalid_thumbnail_render_request"],
    [{ width: 200, height: 200 }, 422, "invalid_thumbnail_dimensions"],
  ] as const)(
    "rejects invalid thumbnail size %o before Browser Rendering or R2",
    async (size, status, error) => {
      const { default: worker } = await import("../src/index")
      const put = vi.fn()
      const response = await worker.fetch(
        new Request("https://renderer.internal/render/thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId: "invalid-thumbnail",
            outputId: "proposal",
            pageId: "cover",
            size,
            document: northstarSeed,
            expectedImageResources: [],
          }),
        }) as never,
        { BROWSER: {}, RENDERS: { put } } as unknown as Env
      )

      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ error })
      expect(launch).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    }
  )

  it("rejects a thumbnail whose browser PNG dimensions drift", async () => {
    const { default: worker } = await import("../src/index")
    const browserPage = successfulBrowserPage([])
    browserPage.screenshot.mockResolvedValue(pngHeader(125, 175))
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "drifted-thumbnail",
          outputId: "proposal",
          pageId: "cover",
          size: { width: 124, height: 175 },
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "thumbnail_dimension_mismatch",
      expected: { width: 124, height: 175 },
      received: { width: 125, height: 175 },
    })
    expect(put).not.toHaveBeenCalled()
  })

  it("checks managed image dimensions before thumbnail capture", async () => {
    const { default: worker } = await import("../src/index")
    const fixture = await managedImageFixture()
    const browserPage = successfulBrowserPage([])
    browserPage.evaluate.mockResolvedValue({
      ready: false,
      code: "image_dimension_mismatch",
      nodeId: "managed-image",
    })
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const put = vi.fn()
    const response = await worker.fetch(
      new Request("https://renderer.internal/render/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "thumbnail-resource-drift",
          outputId: "proposal",
          pageId: "cover",
          size: { width: 124, height: 175 },
          document: fixture.document,
          expectedImageResources: [fixture.resource],
        }),
      }) as never,
      { BROWSER: {}, RENDERS: { put } } as unknown as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: "render_resource_failed",
      code: "image_dimension_mismatch",
      message: "Required render resource failed for node managed-image",
      nodeId: "managed-image",
    })
    expect(browserPage.screenshot).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it("stops an aborted thumbnail request before Browser Rendering", async () => {
    const { default: worker } = await import("../src/index")
    const controller = new AbortController()
    controller.abort()
    const request = new Request("https://renderer.internal/render/thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        renderId: "aborted-thumbnail",
        outputId: "proposal",
        pageId: "cover",
        size: { width: 124, height: 175 },
        document: northstarSeed,
        expectedImageResources: [],
      }),
      signal: controller.signal,
    })

    await expect(
      worker.fetch(
        request as never,
        {
          BROWSER: {},
          RENDERS: { put: vi.fn() },
        } as unknown as Env
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(launch).not.toHaveBeenCalled()
  })

  it.each([
    ["PNG", "/render", { pageId: "cover" }],
    ["PDF", "/render/pdf", {}],
  ] as const)(
    "closes Browser once when a %s request is cancelled during page setup",
    async (_format, path, requestFields) => {
      const { default: worker } = await import("../src/index")
      const setup = deferred<undefined>()
      const browserPage = successfulBrowserPage([37, 80, 68, 70])
      browserPage.setContent.mockImplementation(() => setup.promise)
      const close = vi.fn(async () => {
        setup.reject(new Error("Browser closed"))
      })
      vi.mocked(launch).mockResolvedValue({
        newPage: vi.fn(async () => browserPage),
        close,
      } as never)
      const put = vi.fn()
      const controller = new AbortController()
      const rendering = worker.fetch(
        new Request(`https://renderer.internal${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId: `cancelled-${_format.toLowerCase()}`,
            outputId: "proposal",
            document: northstarSeed,
            expectedImageResources: [],
            ...requestFields,
          }),
          signal: controller.signal,
        }) as never,
        { BROWSER: {}, RENDERS: { put } } as unknown as Env
      )

      await vi.waitFor(() => expect(browserPage.setContent).toHaveBeenCalled())
      controller.abort(new DOMException("Client left", "AbortError"))

      await expect(rendering).rejects.toMatchObject({ name: "AbortError" })
      expect(close).toHaveBeenCalledOnce()
      expect(browserPage.screenshot).not.toHaveBeenCalled()
      expect(browserPage.pdf).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["PNG", "/render", { pageId: "cover" }],
    ["PDF", "/render/pdf", {}],
  ] as const)(
    "removes a %s artifact when cancellation lands during R2 storage",
    async (_format, path, requestFields) => {
      const { default: worker } = await import("../src/index")
      const stored = deferred<{ size: number; etag: string }>()
      const browserPage = successfulBrowserPage([37, 80, 68, 70])
      const close = vi.fn(async () => undefined)
      vi.mocked(launch).mockResolvedValue({
        newPage: vi.fn(async () => browserPage),
        close,
      } as never)
      const put = vi.fn(() => stored.promise)
      const get = vi.fn()
      const remove = vi.fn(async () => undefined)
      const controller = new AbortController()
      const rendering = worker.fetch(
        new Request(`https://renderer.internal${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId: `stored-${_format.toLowerCase()}`,
            outputId: "proposal",
            document: northstarSeed,
            expectedImageResources: [],
            ...requestFields,
          }),
          signal: controller.signal,
        }) as never,
        { BROWSER: {}, RENDERS: { put, get, delete: remove } } as unknown as Env
      )

      await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
      controller.abort(new DOMException("Client left", "AbortError"))
      stored.resolve({ size: 4, etag: "stored-after-abort" })

      await expect(rendering).rejects.toMatchObject({ name: "AbortError" })
      expect(remove).toHaveBeenCalledWith(
        _format === "PNG"
          ? "stored-png/proposal/cover.png"
          : "stored-pdf/proposal.pdf"
      )
      expect(get).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ["PNG", "/render", { pageId: "cover" }],
    ["PDF", "/render/pdf", {}],
    [
      "thumbnail",
      "/render/thumbnail",
      { pageId: "cover", size: { width: 124, height: 175 } },
    ],
  ] as const)(
    "closes Browser and returns a stable deadline when %s page setup stalls",
    async (_format, path, requestFields) => {
      const { createRendererWorker } = await import("../src/index")
      const worker = createRendererWorker(50)
      const setup = deferred<undefined>()
      const browserPage = successfulBrowserPage([37, 80, 68, 70])
      browserPage.setContent.mockImplementation(() => setup.promise)
      const close = vi.fn(async () => setup.reject(new Error("Browser closed")))
      vi.mocked(launch).mockResolvedValue({
        newPage: vi.fn(async () => browserPage),
        close,
      } as never)
      const rendering = worker.fetch(
        new Request(`https://renderer.internal${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId: `deadline-${_format.toLowerCase()}`,
            outputId: "proposal",
            document: northstarSeed,
            expectedImageResources: [],
            ...requestFields,
          }),
        }) as never,
        {
          BROWSER: {},
          RENDERS: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
        } as unknown as Env
      )

      const response = await rendering
      expect(response.status).toBe(504)
      expect(response.headers.get("Cache-Control")).toBe("no-store")
      expect(response.headers.get("Retry-After")).toBe("1")
      expect(response.headers.get("X-Render-Deadline-Ms")).toBe("50")
      await expect(response.json()).resolves.toEqual({
        error: "render_deadline_exceeded",
        code: "render_deadline_exceeded",
        message: "Renderer exceeded its execution deadline",
        retryable: true,
        timeoutMs: 50,
      })
      expect(close).toHaveBeenCalledOnce()
      expect(browserPage.screenshot).not.toHaveBeenCalled()
      expect(browserPage.pdf).not.toHaveBeenCalled()
    }
  )

  it("passes the deadline signal into Browser acquisition and bounds an orphan session", async () => {
    const { createRendererWorker } = await import("../src/index")
    const worker = createRendererWorker(50)
    let acquireSignal: AbortSignal | undefined
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      const browserRequest = input as Request
      acquireSignal = browserRequest.signal
      return new Promise<Response>((_resolve, reject) => {
        browserRequest.signal.addEventListener(
          "abort",
          () => reject(browserRequest.signal.reason),
          { once: true }
        )
      })
    })
    vi.mocked(launch).mockImplementation(async (endpoint, options) => {
      expect(options).toMatchObject({ keep_alive: 10_000 })
      await (endpoint as { fetch: typeof fetch }).fetch(
        "https://browser.internal/v1/devtools/browser",
        { method: "POST" }
      )
      throw new Error("Browser acquisition unexpectedly resolved")
    })

    const response = await worker.fetch(
      new Request("https://renderer.internal/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "deadline-browser-acquire",
          outputId: "proposal",
          pageId: "cover",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }),
      {
        BROWSER: { fetch: browserFetch },
        RENDERS: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      } as unknown as Env
    )

    expect(response.status).toBe(504)
    expect(acquireSignal?.aborted).toBe(true)
    expect(acquireSignal?.reason).toMatchObject({ name: "TimeoutError" })
    expect(browserFetch).toHaveBeenCalledOnce()
  })

  it("waits for a timed-out persistent put to settle and removes it before returning", async () => {
    const { createRendererWorker } = await import("../src/index")
    const worker = createRendererWorker(50)
    const pdfBytes = [37, 80, 68, 70]
    const browserPage = successfulBrowserPage(pdfBytes)
    const close = vi.fn(async () => undefined)
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close,
    } as never)
    const stored = deferred<{ size: number; etag: string }>()
    const put = vi.fn(() => stored.promise)
    const get = vi.fn()
    const remove = vi.fn(async () => undefined)
    const rendering = worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "deadline-r2-put",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
      }) as never,
      {
        BROWSER: {},
        RENDERS: { put, get, delete: remove },
      } as unknown as Env
    )

    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
    let finished = false
    void rendering.then(() => {
      finished = true
    })
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(finished).toBe(false)

    stored.resolve({ size: pdfBytes.length, etag: "late-artifact" })
    const response = await rendering

    expect(response.status).toBe(504)
    expect(remove).toHaveBeenCalledWith("deadline-r2-put/proposal.pdf")
    expect(get).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("cancels a loaded artifact body and removes it when PDF download is abandoned", async () => {
    const { default: worker } = await import("../src/index")
    const pdfBytes = Uint8Array.from([37, 80, 68, 70])
    const browserPage = successfulBrowserPage([...pdfBytes])
    vi.mocked(launch).mockResolvedValue({
      newPage: vi.fn(async () => browserPage),
      close: vi.fn(async () => undefined),
    } as never)
    const loaded = deferred<{
      size: number
      body: ReadableStream<Uint8Array>
    }>()
    const cancelBody = vi.fn()
    const put = vi.fn(async () => ({ size: pdfBytes.length, etag: "stored" }))
    const get = vi.fn(() => loaded.promise)
    const remove = vi.fn(async () => undefined)
    const controller = new AbortController()
    const rendering = worker.fetch(
      new Request("https://renderer.internal/render/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: "abandoned-download",
          outputId: "proposal",
          document: northstarSeed,
          expectedImageResources: [],
        }),
        signal: controller.signal,
      }) as never,
      { BROWSER: {}, RENDERS: { put, get, delete: remove } } as unknown as Env
    )

    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())
    controller.abort(new DOMException("Client left", "AbortError"))
    loaded.resolve({
      size: pdfBytes.length,
      body: new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(pdfBytes)
        },
        cancel: cancelBody,
      }),
    })

    await expect(rendering).rejects.toMatchObject({ name: "AbortError" })
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith("abandoned-download/proposal.pdf")
  })
})
