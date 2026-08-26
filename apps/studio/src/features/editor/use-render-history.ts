import { useEffect, useRef, useState } from "react"
import {
  materializeTemplateVersion,
  type TemplateModifications,
  type TemplateVersion,
} from "@webmcp/document"

export type RenderSelection = {
  outputId: string
  format: "png" | "pdf"
}

export type RenderArtifact = {
  id: string
  outputId: string
  pageId?: string
  format: "png" | "pdf"
  filename: string
  bytes: number
  width?: number
  height?: number
  objectUrl: string
}

export type RenderRecord = {
  id: string
  templateId: string
  version: number
  createdAt: string
  completedAt?: string
  status: "rendering" | "completed" | "failed"
  modifications: TemplateModifications
  selections: RenderSelection[]
  artifacts: RenderArtifact[]
  error?: string
}

async function renderArtifact(
  document: TemplateVersion["document"],
  selection: RenderSelection,
  pageId?: string
): Promise<RenderArtifact> {
  const endpoint =
    selection.format === "pdf"
      ? "/v1/studio/export-pdf"
      : "/v1/studio/export-png"
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      selection.format === "pdf"
        ? { outputId: selection.outputId, document }
        : { pageId, document }
    ),
  })
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 240)
    const localServiceMissing = detail.includes("not found")
    throw new Error(
      localServiceMissing
        ? "The Renderer Worker is not running in this local session. Start the full Worker topology and try again."
        : detail ||
            `Renderer returned ${response.status} for ${selection.format.toUpperCase()}.`
    )
  }
  const blob = await response.blob()
  const output = document.outputs.find(
    (candidate) => candidate.id === selection.outputId
  )
  const page = pageId
    ? document.pages.find((candidate) => candidate.id === pageId)
    : undefined
  const baseName = (page?.name ?? output?.name ?? selection.outputId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return {
    id: crypto.randomUUID(),
    outputId: selection.outputId,
    pageId,
    format: selection.format,
    filename: `${baseName || "render"}.${selection.format}`,
    bytes: blob.size,
    width: page?.width,
    height: page?.height,
    objectUrl: URL.createObjectURL(blob),
  }
}

export function useRenderHistory() {
  const [records, setRecords] = useState<RenderRecord[]>([])
  const recordsRef = useRef(records)
  recordsRef.current = records

  useEffect(
    () => () => {
      for (const record of recordsRef.current) {
        for (const artifact of record.artifacts) {
          URL.revokeObjectURL(artifact.objectUrl)
        }
      }
    },
    []
  )

  const runRender = async (
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: RenderSelection[]
  ) => {
    if (!selections.length) throw new Error("Choose at least one output.")
    const id = `render-${crypto.randomUUID()}`
    const record: RenderRecord = {
      id,
      templateId: version.templateId,
      version: version.version,
      createdAt: new Date().toISOString(),
      status: "rendering",
      modifications: structuredClone(modifications),
      selections: structuredClone(selections),
      artifacts: [],
    }
    setRecords((current) => [record, ...current])

    const artifacts: RenderArtifact[] = []
    try {
      const document = materializeTemplateVersion(version, modifications)
      for (const selection of selections) {
        const output = document.outputs.find(
          (candidate) => candidate.id === selection.outputId
        )
        if (!output) throw new Error(`Unknown output: ${selection.outputId}`)
        if (!output.exportFormats.includes(selection.format)) {
          throw new Error(
            `${output.name} does not support ${selection.format.toUpperCase()}.`
          )
        }
        if (selection.format === "pdf") {
          artifacts.push(await renderArtifact(document, selection))
        } else {
          for (const pageId of output.pageIds) {
            artifacts.push(await renderArtifact(document, selection, pageId))
          }
        }
      }
      const completed: RenderRecord = {
        ...record,
        status: "completed",
        completedAt: new Date().toISOString(),
        artifacts,
      }
      setRecords((current) =>
        current.map((candidate) =>
          candidate.id === id ? completed : candidate
        )
      )
      return completed
    } catch (error) {
      for (const artifact of artifacts) {
        URL.revokeObjectURL(artifact.objectUrl)
      }
      const failed: RenderRecord = {
        ...record,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Rendering failed.",
      }
      setRecords((current) =>
        current.map((candidate) => (candidate.id === id ? failed : candidate))
      )
      return failed
    }
  }

  return { records, runRender }
}
