import { describe, expect, it, vi } from "vitest"
import {
  assertRenderImageResourceAdmission,
  assertRenderableDocument,
  createPageThumbnailDocument,
  northstarSeed,
} from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { nestedOverDepthRenderConformanceDocument } from "@webmcp/document/internal/mask-render-conformance"
import { createImageHeavyPerformanceFixture } from "../features/editor/image-heavy-performance-fixture.test-contract"
import { createPageThumbnailRequestHandler } from "./page-thumbnail-http"
import type { PageThumbnailHandlerDependencies } from "./page-thumbnail-http"
import { materializeManagedDocumentAssets } from "./render-field-assets"
import { StudioAccessError } from "./studio-principal"
import type { StudioPrincipal } from "./studio-principal"

const principal: StudioPrincipal = {
  id: "principal-test",
  budgetKey: "workspace-test",
  workspaceId: "workspace-test",
  expiresAt: "2099-01-01T00:00:00.000Z",
  mode: "cloudflare_access",
  respond: (response) => response,
}

const jsonRequest = (
  input: unknown,
  options: { signal?: AbortSignal } = {}
) => {
  const body = JSON.stringify(input)
  return new Request("https://studio.test/v1/studio/page-thumbnail", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
    signal: options.signal,
  })
}

const thumbnailRequest = (overrides: Record<string, unknown> = {}) => ({
  pageId: "cover",
  size: { width: 102, height: 144 },
  document: northstarSeed,
  ...overrides,
})

const boundManagedImageDocument = () => {
  const document = structuredClone(northstarSeed)
  const assetId = "asset-0123456789abcdef0123456789abcdef"
  const source = `asset:managed/${assetId}`
  const page = document.pages[0]
  document.nodes.push({
    id: "bound-managed-image",
    name: "Bound managed image",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId,
    src: source,
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
    decorative: false,
    alt: "Bound image",
  })
  page.nodeIds.push("bound-managed-image")
  document.fields.push({
    id: "bound-asset-field",
    key: "bound_asset",
    label: "Bound asset",
    type: "asset",
    required: true,
    defaultValue: source,
    agentDescription: "The managed image rendered on this page.",
    validation: {},
  })
  document.fieldValues["bound-asset-field"] = source
  document.bindings.push({
    id: "bound-asset-binding",
    fieldId: "bound-asset-field",
    nodeId: "bound-managed-image",
    property: "src",
  })
  return { assetId, document, source }
}

const rendererResponse = (overrides: Record<string, string> = {}) =>
  new Response(Uint8Array.from([1, 2, 3]), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
      "Content-Length": "3",
      "X-Bytes": "3",
      "X-Height": "144",
      "X-Output-Id": "proposal",
      "X-Page-Id": "cover",
      "X-Render-Id": "thumbnail-render-id",
      "X-Render-Mode": "ephemeral-thumbnail",
      "X-Width": "102",
      ...overrides,
    },
  })

function dependencies(options?: {
  invokeRenderer?: PageThumbnailHandlerDependencies["invokeRenderer"]
  prepareDocument?: PageThumbnailHandlerDependencies["prepareDocument"]
  resolvePrincipal?: PageThumbnailHandlerDependencies["resolvePrincipal"]
}) {
  const complete = vi.fn(async () => undefined)
  const fail = vi.fn(async () => undefined)
  const prepareDocument = vi.fn(
    async (_env: Env, _principal: StudioPrincipal, document: Document) => {
      assertRenderableDocument(document)
      await assertRenderImageResourceAdmission(document, [])
      return { document, expectedImageResources: [] }
    }
  )
  const reserveCapacity = vi.fn(async () => ({
    reservationId: "thumbnail-reservation",
    complete,
    fail,
  }))
  const value: PageThumbnailHandlerDependencies = {
    resolvePrincipal: options?.resolvePrincipal ?? vi.fn(async () => principal),
    prepareDocument: options?.prepareDocument ?? prepareDocument,
    reserveCapacity,
    invokeRenderer:
      options?.invokeRenderer ?? vi.fn(async () => rendererResponse()),
    createRenderId: () => "thumbnail-render-id",
  }
  return { complete, fail, prepareDocument, reserveCapacity, value }
}

describe("page thumbnail Studio boundary", () => {
  it("migrates a legacy document before preview admission", async () => {
    const legacy = structuredClone(northstarSeed) as unknown as Record<
      string,
      unknown
    >
    legacy.schemaVersion = 2
    delete legacy.typographyStyles
    delete legacy.paintStyles
    delete legacy.variables
    const fixture = dependencies()
    const handler = createPageThumbnailRequestHandler(fixture.value)

    const response = await handler(
      jsonRequest(thumbnailRequest({ document: legacy })),
      {} as Env
    )

    expect(response.status).toBe(200)
    expect(fixture.prepareDocument).toHaveBeenCalledWith(
      {},
      principal,
      createPageThumbnailDocument(northstarSeed, "cover"),
      expect.any(AbortSignal)
    )
    expect(fixture.reserveCapacity).toHaveBeenCalledOnce()
  })

  it("reports an invalid legacy document under the document boundary", async () => {
    const fixture = dependencies()
    const handler = createPageThumbnailRequestHandler(fixture.value)

    const response = await handler(
      jsonRequest(thumbnailRequest({ document: { schemaVersion: 2 } })),
      {} as Env
    )

    expect(response.status).toBe(400)
    const payload: {
      error: string
      issues: Array<{ path: Array<string | number> }>
    } = await response.json()
    expect(payload.error).toBe("invalid_thumbnail_request")
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["document", "id"] }),
      ])
    )
    expect(fixture.prepareDocument).not.toHaveBeenCalled()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
  })

  it("reports a semantic document rejection before thumbnail preparation", async () => {
    const fixture = dependencies()
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const pageId = nestedOverDepthRenderConformanceDocument.pages[0].id

    const response = await handler(
      jsonRequest(
        thumbnailRequest({
          pageId,
          size: { width: 240, height: 180 },
          document: nestedOverDepthRenderConformanceDocument,
        })
      ),
      {} as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: "document_validation_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_group", pageId }),
      ]),
    })
    expect(fixture.prepareDocument).not.toHaveBeenCalled()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
  })

  it("authenticates, admits capacity, and proxies the exact private request", async () => {
    const invokeRenderer = vi.fn(async (_env: Env, request: Request) => {
      expect(request.url).toBe("https://renderer.internal/render/thumbnail")
      expect(request.method).toBe("POST")
      expect(request.signal.aborted).toBe(false)
      expect(await request.json()).toEqual({
        renderId: "thumbnail-render-id",
        outputId: "proposal",
        pageId: "cover",
        size: { width: 102, height: 144 },
        document: createPageThumbnailDocument(northstarSeed, "cover"),
        expectedImageResources: [],
      })
      return rendererResponse()
    })
    const fixture = dependencies({ invokeRenderer })
    const handler = createPageThumbnailRequestHandler(fixture.value)

    const response = await handler(jsonRequest(thumbnailRequest()), {} as Env)

    expect(response.status).toBe(200)
    expect(response.headers.get("X-Render-Mode")).toBe("ephemeral-thumbnail")
    expect(response.headers.get("X-Width")).toBe("102")
    expect(response.headers.get("X-Height")).toBe("144")
    expect(response.headers.get("X-Render-Key")).toBeNull()
    expect(await response.arrayBuffer()).toHaveProperty("byteLength", 3)
    expect(fixture.prepareDocument).toHaveBeenCalledOnce()
    expect(fixture.reserveCapacity).toHaveBeenCalledWith({}, principal, {
      outputId: "proposal",
      format: "png",
      pageIds: ["cover"],
      pageCount: 1,
      pixelArea: 14_688,
      estimatedStorageBytes: 58_752,
    })
    expect(fixture.complete).toHaveBeenCalledWith(3)
    expect(fixture.fail).not.toHaveBeenCalled()
  })

  it("fails capacity and cancels the renderer body when the caller leaves", async () => {
    const controller = new AbortController()
    const cancelBody = vi.fn()
    const invokeRenderer = vi.fn(async () => {
      controller.abort(new DOMException("Client left", "AbortError"))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(Uint8Array.from([1, 2, 3]))
          },
          cancel: cancelBody,
        }),
        { status: 200 }
      )
    })
    const fixture = dependencies({ invokeRenderer })
    const handler = createPageThumbnailRequestHandler(fixture.value)

    await expect(
      handler(
        jsonRequest(thumbnailRequest(), { signal: controller.signal }),
        {} as Env
      )
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(fixture.complete).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledOnce()
    expect(cancelBody).toHaveBeenCalledOnce()
  })

  it("scopes a 100-page document before render-policy and renderer work", async () => {
    const largeDocument = createImageHeavyPerformanceFixture({
      pageCount: 100,
      imagesPerPage: 0,
    }).document
    const page = largeDocument.pages[99]
    const output = largeDocument.outputs[0]
    const invokeRenderer = vi.fn(async (_env: Env, request: Request) => {
      const body: {
        document: Document
        pageId: string
        outputId: string
      } = await request.json()
      expect(body.document.pages).toHaveLength(1)
      expect(body.document.nodes).toHaveLength(0)
      expect(body.document.outputs[0].pageIds).toEqual([page.id])
      expect(body.pageId).toBe(page.id)
      expect(body.outputId).toBe(output.id)
      return rendererResponse({
        "X-Output-Id": output.id,
        "X-Page-Id": page.id,
        "X-Width": "124",
        "X-Height": "80",
      })
    })
    const fixture = dependencies({ invokeRenderer })
    const handler = createPageThumbnailRequestHandler(fixture.value)

    const response = await handler(
      jsonRequest({
        pageId: page.id,
        size: { width: 124, height: 80 },
        document: largeDocument,
      }),
      {} as Env
    )

    expect(response.status).toBe(200)
    expect(fixture.prepareDocument).toHaveBeenCalledWith(
      {},
      principal,
      createPageThumbnailDocument(largeDocument, page.id),
      expect.any(AbortSignal)
    )
    expect(fixture.reserveCapacity).toHaveBeenCalledWith({}, principal, {
      outputId: output.id,
      format: "png",
      pageIds: [page.id],
      pageCount: 1,
      pixelArea: 9_920,
      estimatedStorageBytes: 39_680,
    })
  })

  it("sends one bounded copy of a multi-megabyte bound managed image", async () => {
    const { assetId, document } = boundManagedImageDocument()
    const inlineSource = `data:image/png;base64,${"A".repeat(3_000_000)}`
    const prepareDocument = vi.fn(
      async (
        _env: Env,
        _principal: StudioPrincipal,
        projected: Document,
        signal: AbortSignal
      ) => {
        const materialized = await materializeManagedDocumentAssets(
          projected,
          async () => ({
            assetId,
            src: inlineSource,
            width: 100,
            height: 100,
            contentHash: "a".repeat(64),
            revision: 1,
          }),
          [],
          signal
        )
        return {
          document: materialized.document,
          expectedImageResources: materialized.resources,
        }
      }
    )
    const invokeRenderer = vi.fn(async (_env: Env, request: Request) => {
      const body = await request.text()
      expect(new TextEncoder().encode(body).byteLength).toBeLessThan(8_000_000)
      expect(body.split(inlineSource)).toHaveLength(2)
      return rendererResponse()
    })
    const fixture = dependencies({ prepareDocument, invokeRenderer })
    const handler = createPageThumbnailRequestHandler(fixture.value)

    const response = await handler(
      jsonRequest(thumbnailRequest({ document })),
      {} as Env
    )

    expect(response.status).toBe(200)
    expect(prepareDocument).toHaveBeenCalledOnce()
    expect(invokeRenderer).toHaveBeenCalledOnce()
  })

  it("authenticates before rejecting out-of-bounds input", async () => {
    const fixture = dependencies()
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const response = await handler(
      jsonRequest(thumbnailRequest({ size: { width: 513, height: 512 } })),
      {} as Env
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: "invalid_thumbnail_request",
    })
    expect(fixture.value.resolvePrincipal).toHaveBeenCalledOnce()
    expect(fixture.prepareDocument).not.toHaveBeenCalled()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
  })

  it("rejects an aspect mismatch before capacity reservation", async () => {
    const fixture = dependencies()
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const response = await handler(
      jsonRequest(thumbnailRequest({ size: { width: 200, height: 200 } })),
      {} as Env
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: "invalid_thumbnail_dimensions",
      code: "thumbnail_aspect_ratio_mismatch",
      message: "Thumbnail dimensions do not match the source page aspect ratio",
    })
    expect(fixture.prepareDocument).not.toHaveBeenCalled()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
  })

  it("requires a Studio principal before document or render work", async () => {
    const fixture = dependencies({
      resolvePrincipal: vi.fn(async () => {
        throw new StudioAccessError(
          "studio_authentication_required",
          401,
          "Authentication required"
        )
      }),
    })
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const response = await handler(jsonRequest(thumbnailRequest()), {} as Env)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: "studio_authentication_required",
    })
    expect(fixture.prepareDocument).not.toHaveBeenCalled()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
  })

  it("does not reserve or invoke the renderer when aborted during preparation", async () => {
    const controller = new AbortController()
    const prepareDocument = vi.fn(
      async (_env: Env, _principal: StudioPrincipal, document: Document) => {
        controller.abort()
        return { document, expectedImageResources: [] }
      }
    )
    const fixture = dependencies({ prepareDocument })
    const handler = createPageThumbnailRequestHandler(fixture.value)

    await expect(
      handler(
        jsonRequest(thumbnailRequest(), { signal: controller.signal }),
        {} as Env
      )
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(prepareDocument).toHaveBeenCalledOnce()
    expect(fixture.reserveCapacity).not.toHaveBeenCalled()
    expect(fixture.value.invokeRenderer).not.toHaveBeenCalled()
  })

  it("fails capacity when the private renderer response contract drifts", async () => {
    const fixture = dependencies({
      invokeRenderer: vi.fn(async () => rendererResponse({ "X-Width": "103" })),
    })
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const response = await handler(jsonRequest(thumbnailRequest()), {} as Env)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "invalid_thumbnail_renderer_response",
    })
    expect(fixture.complete).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledOnce()
  })

  it("fails capacity and preserves a private renderer rejection", async () => {
    const fixture = dependencies({
      invokeRenderer: vi.fn(async () =>
        Response.json(
          {
            error: "render_resource_failed",
            code: "image_dimension_mismatch",
            nodeId: "hero-image",
          },
          { status: 422 }
        )
      ),
    })
    const handler = createPageThumbnailRequestHandler(fixture.value)
    const response = await handler(jsonRequest(thumbnailRequest()), {} as Env)

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: "render_resource_failed",
      code: "image_dimension_mismatch",
      nodeId: "hero-image",
    })
    expect(fixture.complete).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledOnce()
  })
})
