import {
  projectLayerExportDocument,
  resolveLayerExportRoutes,
  type Document,
} from "@webmcp/document"

export async function exportLayer({
  nodeId,
  settingId,
  signal,
  flushActiveDraft,
  getCurrentDocumentSnapshot,
  materializeNodes,
  fetcher,
  download,
  assertOutputAdmission = () => undefined,
}: {
  nodeId: string
  settingId?: string
  signal?: AbortSignal
  flushActiveDraft: (signal?: AbortSignal) => Promise<boolean>
  getCurrentDocumentSnapshot: () => Document
  materializeNodes: (document: Document) => Promise<Document["nodes"]>
  fetcher: (
    input: string,
    init: RequestInit
  ) => Promise<Pick<Response, "blob" | "ok" | "status">>
  download: (blob: Blob, filename: string) => void | Promise<void>
  assertOutputAdmission?: () => void
}) {
  assertOutputAdmission()
  signal?.throwIfAborted()
  if (!(await flushActiveDraft(signal))) {
    throw new Error(
      "Layer export stopped because the document is not durably saved."
    )
  }
  const document = getCurrentDocumentSnapshot()
  const routes = resolveLayerExportRoutes(document, nodeId)
  const route = settingId
    ? routes.find((candidate) => candidate.setting.id === settingId)
    : routes[0]
  if (!route)
    throw new Error("Add a layer export setting before exporting this layer.")
  const projected = projectLayerExportDocument(document, route)
  const nodes = await materializeNodes(projected)
  assertOutputAdmission()
  signal?.throwIfAborted()
  const pdf = route.setting.format === "pdf"
  const response = await fetcher(
    pdf ? "/v1/studio/export-pdf" : "/v1/studio/export-png",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(pdf ? { outputId: route.outputId } : { pageId: route.pageId }),
        document: { ...projected, nodes },
      }),
      signal,
    }
  )
  if (!response.ok) {
    throw new Error(`Layer export failed (${response.status}).`)
  }
  const blob = await response.blob()
  assertOutputAdmission()
  signal?.throwIfAborted()
  await download(blob, route.filename)
  return true
}
