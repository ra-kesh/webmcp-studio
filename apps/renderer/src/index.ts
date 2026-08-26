import { launch } from "@cloudflare/playwright"
import { documentSchema } from "@webmcp/document"
import { z } from "zod"
import { renderDocumentToHtml, renderOutputToHtml } from "./html"

const renderRequestSchema = z.object({
  renderId: z.string().min(1),
  pageId: z.string().min(1),
  document: documentSchema,
})

const pdfRenderRequestSchema = z.object({
  renderId: z.string().min(1),
  outputId: z.string().min(1),
  document: documentSchema,
})

const MAX_RENDER_REQUEST_BYTES = 8_000_000

function requestExceedsLimit(request: Request): boolean {
  const header = request.headers.get("content-length")
  if (!header) return false
  const contentLength = Number(header)
  return (
    !Number.isFinite(contentLength) || contentLength > MAX_RENDER_REQUEST_BYTES
  )
}

async function handleRender(request: Request, env: Env): Promise<Response> {
  if (requestExceedsLimit(request)) {
    return Response.json(
      { error: "request_too_large", maxBytes: MAX_RENDER_REQUEST_BYTES },
      { status: 413 }
    )
  }

  const parsed = renderRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_render_request", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const page = parsed.data.document.pages.find(
    (candidate) => candidate.id === parsed.data.pageId
  )
  if (!page) return Response.json({ error: "page_not_found" }, { status: 404 })

  const browser = await launch(env.BROWSER)
  try {
    const browserPage = await browser.newPage()
    await browserPage.setViewportSize({
      width: page.width,
      height: page.height,
    })
    await browserPage.setContent(
      renderDocumentToHtml(parsed.data.document, page.id),
      {
        waitUntil: "networkidle",
      }
    )
    await browserPage.waitForSelector('html[data-fonts-ready="true"]', {
      timeout: 30_000,
    })
    const png = await browserPage.screenshot({ type: "png" })
    const key = `${parsed.data.renderId}/${page.id}.png`
    await env.RENDERS.put(key, png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        documentId: parsed.data.document.id,
        revision: String(parsed.data.document.revision),
      },
    })

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${page.id}.png"`,
        "Cache-Control": "no-store",
        "X-Render-Id": parsed.data.renderId,
        "X-Render-Key": key,
        "X-Page-Id": page.id,
        "X-Width": String(page.width),
        "X-Height": String(page.height),
      },
    })
  } finally {
    await browser.close()
  }
}

async function handlePdfRender(request: Request, env: Env): Promise<Response> {
  if (requestExceedsLimit(request)) {
    return Response.json(
      { error: "request_too_large", maxBytes: MAX_RENDER_REQUEST_BYTES },
      { status: 413 }
    )
  }

  const parsed = pdfRenderRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_pdf_render_request", details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const output = parsed.data.document.outputs.find(
    (candidate) => candidate.id === parsed.data.outputId
  )
  if (!output)
    return Response.json({ error: "output_not_found" }, { status: 404 })
  if (!output.exportFormats.includes("pdf")) {
    return Response.json({ error: "pdf_not_enabled" }, { status: 422 })
  }

  const pdfResponse = await env.BROWSER.quickAction("pdf", {
    html: renderOutputToHtml(parsed.data.document, output.id),
    cacheTTL: 0,
    gotoOptions: { waitUntil: "networkidle0", timeout: 30_000 },
    waitForSelector: {
      selector: 'html[data-fonts-ready="true"]',
      timeout: 30_000,
    },
    pdfOptions: {
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  })
  if (!pdfResponse.ok || !pdfResponse.body) {
    return new Response(pdfResponse.body, {
      status: pdfResponse.status,
      headers: pdfResponse.headers,
    })
  }

  const key = `${parsed.data.renderId}/${output.id}.pdf`
  const [storageBody, downloadBody] = pdfResponse.body.tee()
  await env.RENDERS.put(key, storageBody, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      documentId: parsed.data.document.id,
      outputId: output.id,
      pageCount: String(output.pageIds.length),
      revision: String(parsed.data.document.revision),
    },
  })

  return new Response(downloadBody, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${output.id}.pdf"`,
      "Cache-Control": "no-store",
      "X-Render-Id": parsed.data.renderId,
      "X-Render-Key": key,
      "X-Page-Count": String(output.pageIds.length),
    },
  })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "renderer" })
    }
    if (request.method === "POST" && url.pathname === "/render") {
      return handleRender(request, env)
    }
    if (request.method === "POST" && url.pathname === "/render/pdf") {
      return handlePdfRender(request, env)
    }
    return Response.json({ error: "not_found" }, { status: 404 })
  },
} satisfies ExportedHandler<Env>

export { renderDocumentToHtml, renderOutputToHtml } from "./html"
