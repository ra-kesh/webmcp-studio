import { describe, expect, it, vi } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { exportOutputPdf } from "./export-output-pdf"
import {
  assertImageReplacementOutputAdmission,
  captureImageReplacementOutputAdmission,
  imageReplacementOutputAdmission,
} from "./image-replacement-output-admission"

describe("exportOutputPdf", () => {
  it("rejects a stale invocation before artifact creation after replacement commit", async () => {
    const output = quotationStarter.document.outputs.find((candidate) =>
      candidate.exportFormats.includes("pdf")
    )!
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

    const exporting = exportOutputPdf({
      outputId: output.id,
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
  })

  it("reports stale admission after a deferred failed renderer response", async () => {
    const output = quotationStarter.document.outputs.find((candidate) =>
      candidate.exportFormats.includes("pdf")
    )!
    let admission = imageReplacementOutputAdmission(false, 0)
    const lease = captureImageReplacementOutputAdmission(admission)
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const download = vi.fn()
    const fetcher = vi.fn(() => response)

    const exporting = exportOutputPdf({
      outputId: output.id,
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
