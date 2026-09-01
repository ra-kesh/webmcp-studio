import type { Document } from "@webmcp/document"

type PdfExportResponse = Pick<Response, "blob" | "ok" | "status">

export type OutputPdfExportDependencies = Readonly<{
  outputId: string | undefined
  signal?: AbortSignal
  flushActiveDraft: (signal?: AbortSignal) => Promise<boolean>
  getCurrentDocumentSnapshot: () => Document
  materializeNodes: (document: Document) => Promise<Document["nodes"]>
  fetcher: (input: string, init: RequestInit) => Promise<PdfExportResponse>
  download: (blob: Blob, filename: string) => void | Promise<void>
  assertOutputAdmission?: () => void
}>

const outputPdfFilename = (outputName: string) =>
  `${outputName.toLowerCase().replaceAll(" ", "-")}.pdf`

export async function exportOutputPdf({
  outputId,
  signal,
  flushActiveDraft,
  getCurrentDocumentSnapshot,
  materializeNodes,
  fetcher,
  download,
  assertOutputAdmission = () => undefined,
}: OutputPdfExportDependencies) {
  assertOutputAdmission()
  signal?.throwIfAborted()
  if (!(await flushActiveDraft(signal))) {
    throw new Error(
      "PDF export stopped because the current document is not durably saved."
    )
  }
  assertOutputAdmission()
  signal?.throwIfAborted()

  const document = getCurrentDocumentSnapshot()
  const output = document.outputs.find((candidate) => candidate.id === outputId)
  if (!output || !output.exportFormats.includes("pdf")) {
    throw new Error("The selected output is not available for PDF export.")
  }

  const nodes = await materializeNodes(document)
  assertOutputAdmission()
  signal?.throwIfAborted()
  const response = await fetcher("/v1/studio/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outputId: output.id,
      document: { ...document, nodes },
    }),
    signal,
  })
  assertOutputAdmission()
  if (!response.ok) throw new Error(`PDF export failed (${response.status}).`)

  const blob = await response.blob()
  assertOutputAdmission()
  signal?.throwIfAborted()
  await download(blob, outputPdfFilename(output.name))
  return true
}
