import type { Document } from "@webmcp/document"

type PngExportResponse = Pick<Response, "blob" | "ok" | "status">

export type PagePngExportDependencies = Readonly<{
  requestedPageId: string
  flushActiveDraft: () => Promise<boolean>
  getCurrentDocumentSnapshot: () => Document
  materializeNodes: (document: Document) => Promise<Document["nodes"]>
  fetcher: (input: string, init: RequestInit) => Promise<PngExportResponse>
  download: (blob: Blob, filename: string) => void | Promise<void>
}>

const pagePngFilename = (pageName: string) =>
  `${pageName.toLowerCase().replaceAll(" ", "-")}.png`

/**
 * Exports the page selected when the action was dispatched, while rendering
 * the exact canonical document that became durable at the flush boundary.
 */
export async function exportPagePng({
  requestedPageId,
  flushActiveDraft,
  getCurrentDocumentSnapshot,
  materializeNodes,
  fetcher,
  download,
}: PagePngExportDependencies) {
  if (!(await flushActiveDraft())) {
    throw new Error(
      "PNG export stopped because the current document is not durably saved."
    )
  }

  const document = getCurrentDocumentSnapshot()
  const requestedPage = document.pages.find(
    (page) => page.id === requestedPageId
  )
  if (!requestedPage) {
    throw new Error("The requested page no longer exists in this document.")
  }

  const nodes = await materializeNodes(document)
  const response = await fetcher("/v1/studio/export-png", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId: requestedPage.id,
      document: { ...document, nodes },
    }),
  })
  if (!response.ok) {
    throw new Error(`PNG export failed (${response.status}).`)
  }

  await download(await response.blob(), pagePngFilename(requestedPage.name))
  return true
}
