import { useEffect, useRef, useState } from "react"
import type { TemplateModifications, TemplateVersion } from "@webmcp/document"

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

type RenderApiResponse = {
  id?: string
  completedAt?: string
  error?: { code?: string; message?: string }
  artifacts?: Array<{
    id: string
    outputId: string
    pageId: string | null
    format: "png" | "pdf"
    width: number | null
    height: number | null
    bytes: number
    downloadUrl: string
  }>
}

type RenderHistoryResponse = {
  data?: Array<{
    id: string
    templateId: string
    version: number
    createdAt: string
    completedAt: string | null
    status: "rendering" | "completed" | "failed"
    error: string | null
    request: {
      modifications?: TemplateModifications
      response?: { outputs?: RenderSelection[] }
    } | null
    artifacts: NonNullable<RenderApiResponse["artifacts"]>
  }>
}

const artifactFilename = (
  version: TemplateVersion | undefined,
  artifact: NonNullable<RenderApiResponse["artifacts"]>[number]
) => {
  const output = version?.manifest.outputs.find(
    (candidate) => candidate.id === artifact.outputId
  )
  const page = output?.pages.find(
    (candidate) => candidate.id === artifact.pageId
  )
  const baseName = (page?.name ?? output?.name ?? artifact.outputId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${baseName || "render"}.${artifact.format}`
}

export function useRenderHistory(version?: TemplateVersion) {
  const [records, setRecords] = useState<RenderRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
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

  useEffect(() => {
    if (!version) return
    const controller = new AbortController()
    void fetch("/v1/studio/renders/?limit=30", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Render history returned ${response.status}.`)
        }
        return (await response.json()) as RenderHistoryResponse
      })
      .then((payload) => {
        const restored = (payload.data ?? []).map<RenderRecord>((record) => {
          const matchingVersion =
            version.templateId === record.templateId &&
            version.version === record.version
              ? version
              : undefined
          return {
            id: record.id,
            templateId: record.templateId,
            version: record.version,
            createdAt: record.createdAt,
            completedAt: record.completedAt ?? undefined,
            status: record.status,
            modifications: record.request?.modifications ?? {},
            selections: record.request?.response?.outputs ?? [],
            error: record.error ?? undefined,
            artifacts: record.artifacts.map((artifact) => ({
              id: artifact.id,
              outputId: artifact.outputId,
              pageId: artifact.pageId ?? undefined,
              format: artifact.format,
              filename: artifactFilename(matchingVersion, artifact),
              bytes: artifact.bytes,
              width: artifact.width ?? undefined,
              height: artifact.height ?? undefined,
              objectUrl: artifact.downloadUrl,
            })),
          }
        })
        setRecords((current) => {
          const currentIds = new Set(current.map((record) => record.id))
          return [
            ...current,
            ...restored.filter((record) => !currentIds.has(record.id)),
          ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        })
        setHistoryError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Render history could not be loaded."
        )
      })
    return () => controller.abort()
  }, [version?.id])

  const runRender = async (
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: RenderSelection[]
  ) => {
    if (!selections.length) throw new Error("Choose at least one output.")
    const localId = `local-render-${crypto.randomUUID()}`
    const record: RenderRecord = {
      id: localId,
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
    let serverId = localId
    try {
      const response = await fetch("/v1/studio/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": localId,
        },
        body: JSON.stringify({
          templateId: version.templateId,
          version: version.version,
          modifications,
          response: { type: "url", outputs: selections },
        }),
      })
      const payload = (await response.json()) as RenderApiResponse
      serverId = payload.id ?? localId
      if (!response.ok) {
        const message = payload.error?.message
        throw new Error(
          message?.includes("not found")
            ? "The Renderer Worker is not running in this local session. Start the full Worker topology and try again."
            : message || `Render API returned ${response.status}.`
        )
      }

      for (const artifact of payload.artifacts ?? []) {
        const download = await fetch(artifact.downloadUrl)
        if (!download.ok) {
          throw new Error(`Artifact download returned ${download.status}.`)
        }
        const blob = await download.blob()
        artifacts.push({
          id: artifact.id,
          outputId: artifact.outputId,
          pageId: artifact.pageId ?? undefined,
          format: artifact.format,
          filename: artifactFilename(version, artifact),
          bytes: blob.size || artifact.bytes,
          width: artifact.width ?? undefined,
          height: artifact.height ?? undefined,
          objectUrl: URL.createObjectURL(blob),
        })
      }

      const completed: RenderRecord = {
        ...record,
        id: serverId,
        status: "completed",
        completedAt: payload.completedAt ?? new Date().toISOString(),
        artifacts,
      }
      setRecords((current) =>
        current.map((candidate) =>
          candidate.id === localId ? completed : candidate
        )
      )
      return completed
    } catch (error) {
      for (const artifact of artifacts) {
        URL.revokeObjectURL(artifact.objectUrl)
      }
      const failed: RenderRecord = {
        ...record,
        id: serverId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Rendering failed.",
      }
      setRecords((current) =>
        current.map((candidate) =>
          candidate.id === localId ? failed : candidate
        )
      )
      return failed
    }
  }

  return { records, historyError, runRender }
}
