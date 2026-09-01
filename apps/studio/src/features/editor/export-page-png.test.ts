import { describe, expect, it, vi } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { exportPagePng } from "./export-page-png"
import {
  assertImageReplacementOutputAdmission,
  captureImageReplacementOutputAdmission,
  imageReplacementOutputAdmission,
} from "./image-replacement-output-admission"

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

  it("rejects a stale invocation before artifact creation even after replacement rollback", async () => {
    const requestedPage = quotationStarter.document.pages[0]
    let admission = imageReplacementOutputAdmission(false, 0)
    const lease = captureImageReplacementOutputAdmission(admission)
    let resolveMaterialization!: (
      nodes: typeof quotationStarter.document.nodes
    ) => void
    const materialization = new Promise<typeof quotationStarter.document.nodes>(
      (resolve) => {
        resolveMaterialization = resolve
      }
    )
    const fetcher = vi.fn()
    const download = vi.fn()

    const exporting = exportPagePng({
      requestedPageId: requestedPage.id,
      flushActiveDraft: async () => true,
      getCurrentDocumentSnapshot: () => quotationStarter.document,
      materializeNodes: () => materialization,
      fetcher,
      download,
      assertOutputAdmission: () =>
        assertImageReplacementOutputAdmission(admission, lease),
    })

    admission = imageReplacementOutputAdmission(true, 1)
    admission = imageReplacementOutputAdmission(false, 2)
    resolveMaterialization(quotationStarter.document.nodes)

    await expect(exporting).rejects.toThrow(
      /image replacement preview changed/i
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()

    const freshLease = captureImageReplacementOutputAdmission(admission)
    expect(() =>
      assertImageReplacementOutputAdmission(admission, freshLease)
    ).not.toThrow()
  })

  it("reports stale admission after a deferred failed renderer response", async () => {
    const requestedPage = quotationStarter.document.pages[0]
    let admission = imageReplacementOutputAdmission(false, 0)
    const lease = captureImageReplacementOutputAdmission(admission)
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const download = vi.fn()
    const fetcher = vi.fn(() => response)

    const exporting = exportPagePng({
      requestedPageId: requestedPage.id,
      flushActiveDraft: async () => true,
      getCurrentDocumentSnapshot: () => quotationStarter.document,
      materializeNodes: async (document) => document.nodes,
      fetcher,
      download,
      assertOutputAdmission: () =>
        assertImageReplacementOutputAdmission(admission, lease),
    })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())

    admission = imageReplacementOutputAdmission(true, 1)
    admission = imageReplacementOutputAdmission(false, 2)
    resolveResponse(new Response(null, { status: 500 }))

    await expect(exporting).rejects.toThrow(
      /image replacement preview changed/i
    )
    expect(download).not.toHaveBeenCalled()
  })
})
