import { launch } from "@cloudflare/playwright"
import { documentSchema } from "@webmcp/document"
import { z } from "zod"
import { renderDocumentToHtml } from "./html"

const renderRequestSchema = z.object({
  renderId: z.string().min(1),
  pageId: z.string().min(1),
  document: documentSchema,
})

const MAX_RENDER_REQUEST_BYTES = 1_500_000

async function handleRender(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (!contentLength || contentLength > MAX_RENDER_REQUEST_BYTES) {
    return Response.json(
      { error: "content_length_required", maxBytes: MAX_RENDER_REQUEST_BYTES },
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
    const png = await browserPage.screenshot({ type: "png" })
    const key = `${parsed.data.renderId}/${page.id}.png`
    await env.RENDERS.put(key, png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        documentId: parsed.data.document.id,
        revision: String(parsed.data.document.revision),
      },
    })

    return Response.json({
      renderId: parsed.data.renderId,
      pageId: page.id,
      key,
      format: "png",
      width: page.width,
      height: page.height,
    })
  } finally {
    await browser.close()
  }
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
    return Response.json({ error: "not_found" }, { status: 404 })
  },
} satisfies ExportedHandler<Env>

export { renderDocumentToHtml } from "./html"
