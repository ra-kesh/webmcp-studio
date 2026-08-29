import { describe, expect, it, vi } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { exportPagePng } from "./export-page-png"

describe("exportPagePng", () => {
  it("keeps the dispatched page identity while rendering the exact post-flush document", async () => {
    const requestedPage = quotationStarter.document.pages[0]
    const laterPage = quotationStarter.document.pages[1]
    let resolveFlush!: (saved: boolean) => void
    const flush = new Promise<boolean>((resolve) => {
      resolveFlush = resolve
    })
    let durableDocument = structuredClone(quotationStarter.document)
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) =>
      Promise.resolve(new Response(new Blob(["png"]), { status: 200 }))
    )
    const download = vi.fn()

    const exporting = exportPagePng({
      requestedPageId: requestedPage.id,
      flushActiveDraft: () => flush,
      getCurrentDocumentSnapshot: () => structuredClone(durableDocument),
      materializeNodes: async (document) => document.nodes,
      fetcher,
      download,
    })

    // Model a page switch and a committed edit while the ordered save drains.
    durableDocument = {
      ...durableDocument,
      name: "Document after page B edit",
      pages: durableDocument.pages.map((page) =>
        page.id === laterPage.id ? { ...page, name: "Edited page B" } : page
      ),
    }
    resolveFlush(true)

    await expect(exporting).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("/v1/studio/export-png")
    const request = JSON.parse(String(init.body)) as {
      pageId: string
      document: typeof durableDocument
    }
    expect(request.pageId).toBe(requestedPage.id)
    expect(request.document).toEqual(durableDocument)
    expect(init.signal).toBeUndefined()
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      `${requestedPage.name.toLowerCase().replaceAll(" ", "-")}.png`
    )
  })

  it("stops after a pending save is cancelled and never calls the renderer", async () => {
    const requestedPage = quotationStarter.document.pages[0]
    const controller = new AbortController()
    const fetcher = vi.fn()
    const flushActiveDraft = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )

    const exporting = exportPagePng({
      requestedPageId: requestedPage.id,
      signal: controller.signal,
      flushActiveDraft,
      getCurrentDocumentSnapshot: () => quotationStarter.document,
      materializeNodes: async (document) => document.nodes,
      fetcher,
      download: vi.fn(),
    })
    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(exporting).rejects.toMatchObject({ name: "AbortError" })
    expect(flushActiveDraft).toHaveBeenCalledWith(controller.signal)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
