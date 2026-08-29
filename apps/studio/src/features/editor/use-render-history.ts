import { useCallback, useEffect, useRef, useState } from "react"
import type { TemplateModifications, TemplateVersion } from "@webmcp/document"
import { z } from "zod"

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
  status: "rendering" | "completed" | "failed" | "status_unknown"
  modifications: TemplateModifications
  selections: RenderSelection[]
  artifacts: RenderArtifact[]
  error?: string
}

const renderSelectionSchema = z.object({
  outputId: z.string(),
  format: z.enum(["png", "pdf"]),
})

const renderArtifactResponseSchema = z.object({
  id: z.string(),
  outputId: z.string(),
  pageId: z.string().nullable(),
  format: z.enum(["png", "pdf"]),
  width: z.number().nullable(),
  height: z.number().nullable(),
  bytes: z.number(),
  downloadUrl: z.string(),
})

const renderApiResponseSchema = z.object({
  id: z.string().optional(),
  completedAt: z.string().optional(),
  error: z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .optional(),
  artifacts: z.array(renderArtifactResponseSchema).optional(),
})

const renderHistoryResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        templateId: z.string(),
        version: z.number(),
        createdAt: z.string(),
        completedAt: z.string().nullable(),
        status: z.enum(["rendering", "completed", "failed"]),
        error: z.string().nullable(),
        request: z
          .object({
            modifications: z
              .record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean()])
              )
              .optional(),
            response: z
              .object({ outputs: z.array(renderSelectionSchema).optional() })
              .optional(),
          })
          .nullable(),
        artifacts: z.array(renderArtifactResponseSchema),
      })
    )
    .optional(),
})

type RenderApiResponse = z.infer<typeof renderApiResponseSchema>

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

const revokeObjectUrl = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url)
}

const waitForRenderResponse = <T>(
  pending: Promise<T>,
  signal?: AbortSignal
) => {
  if (!signal) return pending
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void pending.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

export function useRenderHistory(version?: TemplateVersion) {
  const [records, setRecords] = useState<RenderRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const recordsRef = useRef(records)
  recordsRef.current = records
  const activeRendersRef = useRef(
    new Map<
      string,
      { requestIdentity: string; promise: Promise<RenderRecord> }
    >()
  )

  useEffect(
    () => () => {
      for (const record of recordsRef.current) {
        for (const artifact of record.artifacts) {
          revokeObjectUrl(artifact.objectUrl)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!version) {
      setRecords((current) => {
        if (!current.length) return current
        for (const record of current) {
          for (const artifact of record.artifacts) {
            revokeObjectUrl(artifact.objectUrl)
          }
        }
        return []
      })
      setHistoryError(null)
      return
    }
    const controller = new AbortController()
    void fetch("/v1/studio/renders/?limit=30", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Render history returned ${response.status}.`)
        }
        return renderHistoryResponseSchema.parse(await response.json())
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

  const runRender = useCallback(
    (
      publishedVersion: TemplateVersion,
      modifications: TemplateModifications,
      selections: RenderSelection[],
      options: { signal?: AbortSignal; idempotencyKey?: string } = {}
    ) => {
      if (!selections.length) throw new Error("Choose at least one output.")
      options.signal?.throwIfAborted()
      const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID()
      const requestIdentity = JSON.stringify({
        templateId: publishedVersion.templateId,
        version: publishedVersion.version,
        modifications,
        selections,
      })
      const existing = activeRendersRef.current.get(idempotencyKey)
      if (existing) {
        if (existing.requestIdentity !== requestIdentity) {
          throw new Error(
            "That render idempotency key is already active for a different request."
          )
        }
        return existing.promise
      }
      if (activeRendersRef.current.size >= 3) {
        throw new Error(
          "Three renders are already in progress. Wait for one to finish before starting another."
        )
      }
      const localId = `local-render-${idempotencyKey}`
      const record: RenderRecord = {
        id: localId,
        templateId: publishedVersion.templateId,
        version: publishedVersion.version,
        createdAt: new Date().toISOString(),
        status: "rendering",
        modifications: structuredClone(modifications),
        selections: structuredClone(selections),
        artifacts: [],
      }
      setRecords((current) => [
        record,
        ...current.filter((candidate) => candidate.id !== localId),
      ])

      const operation = (async () => {
        let artifacts: RenderArtifact[] = []
        let serverId = localId
        let authoritativeFailure = false
        try {
          const response = await waitForRenderResponse(
            fetch("/v1/studio/render", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
              },
              body: JSON.stringify({
                templateId: publishedVersion.templateId,
                version: publishedVersion.version,
                modifications,
                response: { type: "url", outputs: selections },
              }),
              signal: options.signal,
            }),
            options.signal
          )
          authoritativeFailure = !response.ok
          const payload = renderApiResponseSchema.parse(await response.json())
          serverId = payload.id ?? localId
          if (!response.ok) {
            const message = payload.error?.message
            throw new Error(
              message?.includes("not found")
                ? "The Renderer Worker is not running in this local session. Start the full Worker topology and try again."
                : message || `Render API returned ${response.status}.`
            )
          }

          artifacts = (payload.artifacts ?? []).map(
            (artifact) =>
              ({
                id: artifact.id,
                outputId: artifact.outputId,
                pageId: artifact.pageId ?? undefined,
                format: artifact.format,
                filename: artifactFilename(publishedVersion, artifact),
                bytes: artifact.bytes,
                width: artifact.width ?? undefined,
                height: artifact.height ?? undefined,
                objectUrl: artifact.downloadUrl,
              }) satisfies RenderArtifact
          )

          const completed: RenderRecord = {
            ...record,
            id: serverId,
            status: "completed",
            completedAt: payload.completedAt ?? new Date().toISOString(),
            artifacts,
          }
          setRecords((current) =>
            current.flatMap((candidate) => {
              if (candidate.id === localId) return [completed]
              if (candidate.id === serverId) return []
              return [candidate]
            })
          )
          return completed
        } catch (error) {
          for (const artifact of artifacts) {
            revokeObjectUrl(artifact.objectUrl)
          }
          const statusUnknown =
            Boolean(options.signal?.aborted) || !authoritativeFailure
          const failed: RenderRecord = {
            ...record,
            id: serverId,
            status: statusUnknown ? "status_unknown" : "failed",
            completedAt: new Date().toISOString(),
            error: statusUnknown
              ? "Studio stopped waiting; the server may still have committed this render. Retry with the same request identity to reconcile it."
              : error instanceof Error
                ? error.message
                : "Rendering failed.",
          }
          setRecords((current) =>
            current.flatMap((candidate) => {
              if (candidate.id === localId) return [failed]
              if (candidate.id === serverId) return []
              return [candidate]
            })
          )
          return failed
        }
      })()
      activeRendersRef.current.set(idempotencyKey, {
        requestIdentity,
        promise: operation,
      })
      void operation.finally(() => {
        const active = activeRendersRef.current.get(idempotencyKey)
        if (active?.promise === operation) {
          activeRendersRef.current.delete(idempotencyKey)
        }
      })
      return operation
    },
    []
  )

  return { records, historyError, runRender }
}

export type RenderHistoryController = ReturnType<typeof useRenderHistory>
