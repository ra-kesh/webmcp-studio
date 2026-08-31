import {
  launch,
  type Browser,
  type BrowserWorker,
  type Page,
} from "@cloudflare/playwright"
import {
  assertPageThumbnailSize,
  assertRenderImageResourceAdmission,
  assertRenderableDocument,
  DocumentValidationError,
  documentSchema,
  pageThumbnailLimits,
  PageThumbnailSizeError,
  renderImageResourceExpectationSchema,
  RenderImageResourceAdmissionError,
} from "@webmcp/document"
import { z } from "zod"
import {
  JsonBodyError,
  jsonBodyErrorResponse,
  readJsonBody,
} from "@webmcp/worker-boundary"
import { ArtifactSizeError, assertArtifactSize } from "./artifact-body"
import {
  renderDocumentThumbnailToHtml,
  renderDocumentToHtml,
  renderOutputToHtml,
} from "./html"

const expectedImageResourceSchema = renderImageResourceExpectationSchema

const expectedImageResourcesSchema = z
  .array(expectedImageResourceSchema)
  .max(5_000)

const renderRequestSchema = z
  .object({
    renderId: z.string().min(1),
    outputId: z.string().min(1),
    pageId: z.string().min(1),
    document: documentSchema,
    expectedImageResources: expectedImageResourcesSchema,
  })
  .strict()

const thumbnailSizeSchema = z
  .object({
    width: z
      .number()
      .int()
      .min(pageThumbnailLimits.minDimension)
      .max(pageThumbnailLimits.maxDimension),
    height: z
      .number()
      .int()
      .min(pageThumbnailLimits.minDimension)
      .max(pageThumbnailLimits.maxDimension),
  })
  .strict()

const thumbnailRenderRequestSchema = z
  .object({
    renderId: z.string().min(1),
    outputId: z.string().min(1),
    pageId: z.string().min(1),
    size: thumbnailSizeSchema,
    document: documentSchema,
    expectedImageResources: expectedImageResourcesSchema,
  })
  .strict()

const pdfRenderRequestSchema = z
  .object({
    renderId: z.string().min(1),
    outputId: z.string().min(1),
    document: documentSchema,
    expectedImageResources: expectedImageResourcesSchema,
  })
  .strict()

const MAX_RENDER_REQUEST_BYTES = 8_000_000
const RESOURCE_READINESS_TIMEOUT_MS = 30_000
const RENDER_DEADLINE_MS = 45_000

type RenderResourceErrorCode =
  | "image_decode_failed"
  | "image_dimension_mismatch"
  | "image_resource_duplicate"
  | "image_resource_identity_mismatch"
  | "image_resource_node_missing"
  | "image_resource_source_mismatch"
  | "image_resource_type_mismatch"
  | "image_resource_inline_invalid"
  | "image_resource_inline_dimensions_exceeded"
  | "managed_font_failed"
  | "luminance_conversion_failed"
  | "resource_readiness_failed"
  | "resource_readiness_timeout"

export class RenderResourceError extends Error {
  constructor(
    readonly code: RenderResourceErrorCode,
    readonly nodeId?: string,
    readonly assetId?: string
  ) {
    super(
      nodeId
        ? `Required render resource failed for node ${nodeId}`
        : "Required render resources did not become ready"
    )
    this.name = "RenderResourceError"
  }
}

export async function waitForRenderResources(
  page: Page,
  timeout = RESOURCE_READINESS_TIMEOUT_MS,
  expectedImageResources: readonly z.infer<
    typeof expectedImageResourceSchema
  >[] = []
): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const root = (
          globalThis as unknown as {
            document: {
              documentElement: { hasAttribute(name: string): boolean }
            }
          }
        ).document.documentElement
        return (
          root.hasAttribute("data-render-ready") ||
          root.hasAttribute("data-render-error")
        )
      },
      undefined,
      { timeout }
    )
  } catch {
    throw new RenderResourceError("resource_readiness_timeout")
  }

  const state = await page.evaluate((expectations) => {
    const root = (
      globalThis as unknown as {
        document: {
          documentElement: { getAttribute(name: string): string | null }
        }
      }
    ).document.documentElement
    const ready = root.getAttribute("data-render-ready") === "true"
    if (ready) {
      const document = (
        globalThis as unknown as {
          document: {
            querySelectorAll(selector: string): ArrayLike<{
              getAttribute(name: string): string | null
              naturalWidth: number
              naturalHeight: number
            }>
          }
        }
      ).document
      const images = Array.from(document.querySelectorAll("img[data-node-id]"))
      const imageByNodeId = new Map(
        images.map((image) => [image.getAttribute("data-node-id"), image])
      )
      const mismatch = expectations.find((expectation) => {
        const image = imageByNodeId.get(expectation.nodeId)
        return (
          !image ||
          image.naturalWidth !== expectation.width ||
          image.naturalHeight !== expectation.height
        )
      })
      if (mismatch) {
        return {
          ready: false,
          code: "image_dimension_mismatch",
          nodeId: mismatch.nodeId,
        }
      }
    }
    return {
      ready,
      code: root.getAttribute("data-render-error"),
      nodeId: root.getAttribute("data-render-error-node") ?? undefined,
    }
  }, expectedImageResources)
  if (state.ready) return

  const code =
    state.code === "image_decode_failed" ||
    state.code === "image_dimension_mismatch" ||
    state.code === "managed_font_failed" ||
    state.code === "luminance_conversion_failed" ||
    state.code === "resource_readiness_failed"
      ? state.code
      : "resource_readiness_failed"
  throw new RenderResourceError(code, state.nodeId)
}

function renderResourceErrorResponse(error: RenderResourceError): Response {
  return Response.json(
    {
      error: "render_resource_failed",
      code: error.code,
      message: error.message,
      ...(error.nodeId ? { nodeId: error.nodeId } : {}),
      ...(error.assetId ? { assetId: error.assetId } : {}),
    },
    { status: 422 }
  )
}

function thumbnailSizeErrorResponse(error: PageThumbnailSizeError): Response {
  return Response.json(
    {
      error: "invalid_thumbnail_dimensions",
      code: error.code,
      message: error.message,
    },
    { status: 422 }
  )
}

function pngDimensions(bytes: Uint8Array): {
  width: number
  height: number
} | null {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

async function admitExpectedImageResources(
  document: z.infer<typeof documentSchema>,
  expectedImageResources: readonly z.infer<typeof expectedImageResourceSchema>[]
): Promise<void> {
  try {
    await assertRenderImageResourceAdmission(document, expectedImageResources)
  } catch (error) {
    if (error instanceof RenderImageResourceAdmissionError) {
      throw new RenderResourceError(error.code, error.nodeId, error.assetId)
    }
    throw error
  }
}

function artifactSizeErrorResponse(error: ArtifactSizeError): Response {
  return Response.json(
    {
      error: "render_artifact_too_large",
      code: error.code,
      maxBytes: error.maxBytes,
      receivedBytes: error.receivedBytes,
    },
    { status: 413 }
  )
}

const prefersMetadataOnly = (request: Request) =>
  request.headers
    .get("Prefer")
    ?.split(",")
    .some((preference) => preference.trim() === "return=minimal") ?? false

const prefersEphemeralArtifact = (request: Request) =>
  request.headers.get("X-Render-Persistence") === "ephemeral"

function ephemeralArtifactResponse({
  bytes,
  contentType,
  filename,
  renderId,
  details,
}: {
  bytes: Uint8Array
  contentType: string
  filename: string
  renderId: string
  details: Record<string, string>
}) {
  const responseBytes = Uint8Array.from(bytes)
  return new Response(responseBytes.buffer, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
      "X-Bytes": String(bytes.byteLength),
      "X-Render-Id": renderId,
      "X-Render-Mode": "ephemeral-export",
      ...details,
    },
  })
}

function storedArtifactHeaders({
  contentType,
  filename,
  renderId,
  key,
  size,
  checksum,
  details,
}: {
  contentType: string
  filename: string
  renderId: string
  key: string
  size: number
  checksum: string
  details: Record<string, string>
}) {
  return new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Render-Id": renderId,
    "X-Render-Key": key,
    "X-Bytes": String(size),
    "X-Checksum": checksum,
    ...details,
  })
}

async function storedArtifactResponse({
  request,
  env,
  key,
  headers,
}: {
  request: Request
  env: Env
  key: string
  headers: Headers
}) {
  await removeStoredArtifactAfterAbort(request, env, key)
  if (prefersMetadataOnly(request)) {
    headers.set("Preference-Applied", "return=minimal")
    await removeStoredArtifactAfterAbort(request, env, key)
    return new Response(null, { status: 204, headers })
  }
  let stored
  try {
    stored = await env.RENDERS.get(key)
  } catch (error) {
    if (request.signal.aborted) {
      try {
        await env.RENDERS.delete(key)
      } finally {
        request.signal.throwIfAborted()
      }
    }
    throw error
  }
  if (request.signal.aborted) {
    await stored?.body.cancel().catch(() => undefined)
    try {
      await env.RENDERS.delete(key)
    } finally {
      request.signal.throwIfAborted()
    }
  }
  if (!stored) {
    await env.RENDERS.delete(key)
    return Response.json(
      { error: "render_artifact_unavailable", key },
      { status: 502 }
    )
  }
  headers.set("Content-Length", String(stored.size))
  await removeStoredArtifactAfterAbort(request, env, key)
  return new Response(stored.body, { headers })
}

async function rendererJson(
  request: Request,
  maxBytes = MAX_RENDER_REQUEST_BYTES
): Promise<unknown | Response> {
  try {
    return await readJsonBody(request, { maxBytes })
  } catch (error) {
    if (error instanceof JsonBodyError) return jsonBodyErrorResponse(error)
    throw error
  }
}

function renderDeadlineResponse(timeoutMs: number) {
  return Response.json(
    {
      error: "render_deadline_exceeded",
      code: "render_deadline_exceeded",
      message: "Renderer exceeded its execution deadline",
      retryable: true,
      timeoutMs,
    },
    {
      status: 504,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "1",
        "X-Render-Deadline-Ms": String(timeoutMs),
      },
    }
  )
}

async function withRenderDeadline(
  request: Request,
  timeoutMs: number,
  render: (boundedRequest: Request) => Promise<Response>
): Promise<Response> {
  request.signal.throwIfAborted()
  const deadlineSignal = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([request.signal, deadlineSignal])
  const boundedRequest = new Request(request, { signal })

  try {
    return await render(boundedRequest)
  } catch (error) {
    if (request.signal.aborted) request.signal.throwIfAborted()
    if (deadlineSignal.aborted) return renderDeadlineResponse(timeoutMs)
    throw error
  }
}

async function withAbortableBrowser<T>(
  request: Request,
  env: Env,
  operation: (browser: Browser) => Promise<T>
): Promise<T> {
  request.signal.throwIfAborted()
  let browser: Browser
  try {
    browser = await launch(abortableBrowserEndpoint(request, env), {
      keep_alive: 10_000,
    })
  } catch (error) {
    request.signal.throwIfAborted()
    throw error
  }

  let closePromise: Promise<void> | undefined
  const closeBrowser = () => {
    closePromise ??= browser.close()
    return closePromise
  }
  const abortBrowser = () => {
    void closeBrowser().catch(() => undefined)
  }
  request.signal.addEventListener("abort", abortBrowser, { once: true })
  try {
    request.signal.throwIfAborted()
    return await operation(browser)
  } catch (error) {
    request.signal.throwIfAborted()
    throw error
  } finally {
    request.signal.removeEventListener("abort", abortBrowser)
    try {
      await closeBrowser()
    } catch (error) {
      request.signal.throwIfAborted()
      throw error
    }
  }
}

function abortableBrowserEndpoint(request: Request, env: Env): BrowserWorker {
  return {
    fetch: (input, init) => {
      const inputSignal = input instanceof Request ? input.signal : undefined
      const initSignal = init?.signal
      const signals = [request.signal, inputSignal, initSignal].filter(
        (signal): signal is AbortSignal => signal !== undefined
      )
      const signal =
        signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      return env.BROWSER.fetch(new Request(input, { ...init, signal }))
    },
  }
}

async function removeStoredArtifactAfterAbort(
  request: Request,
  env: Env,
  key: string
) {
  if (!request.signal.aborted) return
  try {
    await env.RENDERS.delete(key)
  } finally {
    request.signal.throwIfAborted()
  }
}

async function completeArtifactStore<T>(
  request: Request,
  env: Env,
  key: string,
  store: () => Promise<T>
): Promise<T> {
  let abortCleanupAttempted = false
  try {
    const stored = await store()
    if (request.signal.aborted) {
      abortCleanupAttempted = true
      await removeStoredArtifactAfterAbort(request, env, key)
    }
    return stored
  } catch (error) {
    if (request.signal.aborted && !abortCleanupAttempted) {
      try {
        await env.RENDERS.delete(key)
      } finally {
        request.signal.throwIfAborted()
      }
    }
    throw error
  }
}

async function handleRender(request: Request, env: Env): Promise<Response> {
  request.signal.throwIfAborted()
  const input = await rendererJson(request)
  if (input instanceof Response) return input
  const parsed = renderRequestSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_render_request", details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  try {
    assertRenderableDocument(parsed.data.document)
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return Response.json(
        { error: "document_validation_failed", issues: error.issues },
        { status: 422 }
      )
    }
    throw error
  }

  const page = parsed.data.document.pages.find(
    (candidate) => candidate.id === parsed.data.pageId
  )
  if (!page) return Response.json({ error: "page_not_found" }, { status: 404 })

  try {
    await admitExpectedImageResources(
      parsed.data.document,
      parsed.data.expectedImageResources
    )
  } catch (error) {
    request.signal.throwIfAborted()
    if (error instanceof RenderResourceError) {
      return renderResourceErrorResponse(error)
    }
    throw error
  }

  request.signal.throwIfAborted()
  return withAbortableBrowser(request, env, async (browser) => {
    const browserPage = await browser.newPage()
    request.signal.throwIfAborted()
    await browserPage.setViewportSize({
      width: page.width,
      height: page.height,
    })
    request.signal.throwIfAborted()
    await browserPage.setContent(
      renderDocumentToHtml(parsed.data.document, page.id),
      {
        waitUntil: "networkidle",
      }
    )
    request.signal.throwIfAborted()
    try {
      await waitForRenderResources(
        browserPage,
        RESOURCE_READINESS_TIMEOUT_MS,
        parsed.data.expectedImageResources.filter((resource) =>
          page.nodeIds.includes(resource.nodeId)
        )
      )
    } catch (error) {
      request.signal.throwIfAborted()
      if (error instanceof RenderResourceError) {
        return renderResourceErrorResponse(error)
      }
      throw error
    }
    request.signal.throwIfAborted()
    const png = await browserPage.screenshot({ type: "png" })
    request.signal.throwIfAborted()
    try {
      assertArtifactSize(png.byteLength)
    } catch (error) {
      if (error instanceof ArtifactSizeError) {
        return artifactSizeErrorResponse(error)
      }
      throw error
    }
    if (prefersEphemeralArtifact(request)) {
      request.signal.throwIfAborted()
      return ephemeralArtifactResponse({
        bytes: png,
        contentType: "image/png",
        filename: `${page.id}.png`,
        renderId: parsed.data.renderId,
        details: {
          "X-Page-Id": page.id,
          "X-Output-Id": parsed.data.outputId,
          "X-Width": String(page.width),
          "X-Height": String(page.height),
        },
      })
    }
    const key = `${parsed.data.renderId}/${parsed.data.outputId}/${page.id}.png`
    request.signal.throwIfAborted()
    const stored = await completeArtifactStore(request, env, key, () =>
      env.RENDERS.put(key, png, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: {
          documentId: parsed.data.document.id,
          outputId: parsed.data.outputId,
          revision: String(parsed.data.document.revision),
        },
      })
    )
    if (!stored) {
      return Response.json(
        { error: "render_artifact_store_failed" },
        { status: 502 }
      )
    }
    await removeStoredArtifactAfterAbort(request, env, key)
    return storedArtifactResponse({
      request,
      env,
      key,
      headers: storedArtifactHeaders({
        contentType: "image/png",
        filename: `${page.id}.png`,
        renderId: parsed.data.renderId,
        key,
        size: stored.size,
        checksum: stored.etag,
        details: {
          "X-Page-Id": page.id,
          "X-Output-Id": parsed.data.outputId,
          "X-Width": String(page.width),
          "X-Height": String(page.height),
        },
      }),
    })
  })
}

async function handleThumbnailRender(
  request: Request,
  env: Env
): Promise<Response> {
  request.signal.throwIfAborted()
  const input = await rendererJson(request)
  if (input instanceof Response) return input
  const parsed = thumbnailRenderRequestSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_thumbnail_render_request",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }
  try {
    assertRenderableDocument(parsed.data.document)
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return Response.json(
        { error: "document_validation_failed", issues: error.issues },
        { status: 422 }
      )
    }
    throw error
  }

  const page = parsed.data.document.pages.find(
    (candidate) => candidate.id === parsed.data.pageId
  )
  if (!page) return Response.json({ error: "page_not_found" }, { status: 404 })
  const output = parsed.data.document.outputs.find(
    (candidate) => candidate.id === parsed.data.outputId
  )
  if (
    !output ||
    page.outputId !== output.id ||
    !output.pageIds.includes(page.id)
  ) {
    return Response.json({ error: "output_not_found" }, { status: 404 })
  }
  try {
    assertPageThumbnailSize(page, parsed.data.size)
  } catch (error) {
    if (error instanceof PageThumbnailSizeError) {
      return thumbnailSizeErrorResponse(error)
    }
    throw error
  }
  try {
    await admitExpectedImageResources(
      parsed.data.document,
      parsed.data.expectedImageResources
    )
  } catch (error) {
    request.signal.throwIfAborted()
    if (error instanceof RenderResourceError) {
      return renderResourceErrorResponse(error)
    }
    throw error
  }

  return withAbortableBrowser(request, env, async (browser) => {
    const browserPage = await browser.newPage()
    request.signal.throwIfAborted()
    await browserPage.setViewportSize(parsed.data.size)
    request.signal.throwIfAborted()
    await browserPage.setContent(
      renderDocumentThumbnailToHtml(
        parsed.data.document,
        page.id,
        parsed.data.size
      ),
      { waitUntil: "networkidle" }
    )
    try {
      await waitForRenderResources(
        browserPage,
        RESOURCE_READINESS_TIMEOUT_MS,
        parsed.data.expectedImageResources.filter((resource) =>
          page.nodeIds.includes(resource.nodeId)
        )
      )
    } catch (error) {
      request.signal.throwIfAborted()
      if (error instanceof RenderResourceError) {
        return renderResourceErrorResponse(error)
      }
      throw error
    }
    request.signal.throwIfAborted()
    const png = await browserPage.screenshot({ type: "png", fullPage: false })
    request.signal.throwIfAborted()
    try {
      assertArtifactSize(png.byteLength)
    } catch (error) {
      if (error instanceof ArtifactSizeError) {
        return artifactSizeErrorResponse(error)
      }
      throw error
    }
    const dimensions = pngDimensions(png)
    if (
      !dimensions ||
      dimensions.width !== parsed.data.size.width ||
      dimensions.height !== parsed.data.size.height
    ) {
      return Response.json(
        {
          error: "thumbnail_dimension_mismatch",
          expected: parsed.data.size,
          received: dimensions,
        },
        { status: 502 }
      )
    }

    request.signal.throwIfAborted()
    return new Response(png, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${page.id}-thumbnail.png"`,
        "Content-Length": String(png.byteLength),
        "Content-Type": "image/png",
        "X-Bytes": String(png.byteLength),
        "X-Height": String(dimensions.height),
        "X-Output-Id": output.id,
        "X-Page-Id": page.id,
        "X-Render-Id": parsed.data.renderId,
        "X-Render-Mode": "ephemeral-thumbnail",
        "X-Width": String(dimensions.width),
      },
    })
  })
}

async function handlePdfRender(request: Request, env: Env): Promise<Response> {
  request.signal.throwIfAborted()
  const input = await rendererJson(request)
  if (input instanceof Response) return input
  const parsed = pdfRenderRequestSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_pdf_render_request", details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  try {
    assertRenderableDocument(parsed.data.document)
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return Response.json(
        { error: "document_validation_failed", issues: error.issues },
        { status: 422 }
      )
    }
    throw error
  }
  const output = parsed.data.document.outputs.find(
    (candidate) => candidate.id === parsed.data.outputId
  )
  if (!output)
    return Response.json({ error: "output_not_found" }, { status: 404 })
  if (!output.exportFormats.includes("pdf")) {
    return Response.json({ error: "pdf_not_enabled" }, { status: 422 })
  }

  try {
    await admitExpectedImageResources(
      parsed.data.document,
      parsed.data.expectedImageResources
    )
  } catch (error) {
    request.signal.throwIfAborted()
    if (error instanceof RenderResourceError) {
      return renderResourceErrorResponse(error)
    }
    throw error
  }

  request.signal.throwIfAborted()
  return withAbortableBrowser(request, env, async (browser) => {
    const browserPage = await browser.newPage()
    request.signal.throwIfAborted()
    await browserPage.setContent(
      renderOutputToHtml(parsed.data.document, output.id),
      {
        waitUntil: "networkidle",
      }
    )
    request.signal.throwIfAborted()
    try {
      const renderedNodeIds = new Set(
        parsed.data.document.pages
          .filter((page) => output.pageIds.includes(page.id))
          .flatMap((page) => page.nodeIds)
      )
      await waitForRenderResources(
        browserPage,
        RESOURCE_READINESS_TIMEOUT_MS,
        parsed.data.expectedImageResources.filter((resource) =>
          renderedNodeIds.has(resource.nodeId)
        )
      )
    } catch (error) {
      request.signal.throwIfAborted()
      if (error instanceof RenderResourceError) {
        return renderResourceErrorResponse(error)
      }
      throw error
    }
    request.signal.throwIfAborted()
    const pdfBytes = await browserPage.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    request.signal.throwIfAborted()
    try {
      assertArtifactSize(pdfBytes.byteLength)
    } catch (error) {
      if (error instanceof ArtifactSizeError) {
        return artifactSizeErrorResponse(error)
      }
      throw error
    }

    if (prefersEphemeralArtifact(request)) {
      request.signal.throwIfAborted()
      return ephemeralArtifactResponse({
        bytes: pdfBytes,
        contentType: "application/pdf",
        filename: `${output.id}.pdf`,
        renderId: parsed.data.renderId,
        details: {
          "X-Page-Count": String(output.pageIds.length),
          "X-Output-Id": output.id,
        },
      })
    }

    const key = `${parsed.data.renderId}/${output.id}.pdf`
    request.signal.throwIfAborted()
    const stored = await completeArtifactStore(request, env, key, () =>
      env.RENDERS.put(key, pdfBytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: {
          documentId: parsed.data.document.id,
          outputId: output.id,
          pageCount: String(output.pageIds.length),
          revision: String(parsed.data.document.revision),
        },
      })
    )
    if (!stored) {
      return Response.json(
        { error: "render_artifact_store_failed" },
        { status: 502 }
      )
    }
    await removeStoredArtifactAfterAbort(request, env, key)
    return storedArtifactResponse({
      request,
      env,
      key,
      headers: storedArtifactHeaders({
        contentType: "application/pdf",
        filename: `${output.id}.pdf`,
        renderId: parsed.data.renderId,
        key,
        size: stored.size,
        checksum: stored.etag,
        details: {
          "X-Page-Count": String(output.pageIds.length),
          "X-Output-Id": output.id,
        },
      }),
    })
  })
}

export function createRendererWorker(renderDeadlineMs = RENDER_DEADLINE_MS) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true, service: "renderer" })
      }
      if (request.method === "POST" && url.pathname === "/render") {
        return withRenderDeadline(request, renderDeadlineMs, (boundedRequest) =>
          handleRender(boundedRequest, env)
        )
      }
      if (request.method === "POST" && url.pathname === "/render/thumbnail") {
        return withRenderDeadline(request, renderDeadlineMs, (boundedRequest) =>
          handleThumbnailRender(boundedRequest, env)
        )
      }
      if (request.method === "POST" && url.pathname === "/render/pdf") {
        return withRenderDeadline(request, renderDeadlineMs, (boundedRequest) =>
          handlePdfRender(boundedRequest, env)
        )
      }
      return Response.json({ error: "not_found" }, { status: 404 })
    },
  } satisfies ExportedHandler<Env>
}

export default createRendererWorker()

export {
  renderDocumentThumbnailToHtml,
  renderDocumentToHtml,
  renderOutputToHtml,
} from "./html"
