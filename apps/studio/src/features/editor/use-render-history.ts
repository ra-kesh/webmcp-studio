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
  status:
    | "queued"
    | "rendering"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "status_unknown"
  attempt?: number
  maxAttempts?: number
  retryable?: boolean
  idempotencyKey?: string
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
  status: z
    .enum([
      "queued",
      "rendering",
      "retrying",
      "completed",
      "failed",
      "cancelling",
      "cancelled",
    ])
    .optional(),
  statusUrl: z.string().optional(),
  attempt: z.number().optional(),
  maxAttempts: z.number().optional(),
  retryable: z.boolean().optional(),
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
        status: z.enum([
          "queued",
          "rendering",
          "retrying",
          "completed",
          "failed",
          "cancelling",
          "cancelled",
        ]),
        attempt: z.number().optional(),
        maxAttempts: z.number().optional(),
        retryable: z.boolean().optional(),
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

const terminalStatuses = new Set(["completed", "failed", "cancelled"])

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const timeout = window.setTimeout(finish, milliseconds)
    if (!signal) return
    const abort = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
  })

async function pollRender(
  statusUrl: string,
  signal: AbortSignal | undefined,
  onProgress: (payload: RenderApiResponse) => void
) {
  let delay = 500
  while (true) {
    signal?.throwIfAborted()
    const response = await fetch(statusUrl, { signal })
    const payload = renderApiResponseSchema.parse(await response.json())
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `Render status returned ${response.status}.`
      )
    }
    onProgress(payload)
    if (payload.status && terminalStatuses.has(payload.status)) return payload
    await wait(delay, signal)
    delay = Math.min(2_000, Math.round(delay * 1.5))
  }
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
            attempt: record.attempt,
            maxAttempts: record.maxAttempts,
            retryable: record.retryable,
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

  const hasRestoredActiveRender = records.some(
    (record) =>
      !record.idempotencyKey &&
      ["queued", "rendering", "retrying", "cancelling"].includes(record.status)
  )

  useEffect(() => {
    if (!hasRestoredActiveRender) return
    const controller = new AbortController()
    const refresh = async () => {
      const activeIds = recordsRef.current
        .filter(
          (record) =>
            !record.idempotencyKey &&
            ["queued", "rendering", "retrying", "cancelling"].includes(
              record.status
            )
        )
        .map((record) => record.id)
      await Promise.allSettled(
        activeIds.map(async (renderId) => {
          const response = await fetch(`/v1/renders/${renderId}`, {
            signal: controller.signal,
          })
          const payload = renderApiResponseSchema.parse(await response.json())
          if (!response.ok || !payload.status) return
          setRecords((current) =>
            current.map((record) => {
              if (record.id !== renderId) return record
              return {
                ...record,
                status: payload.status!,
                attempt: payload.attempt,
                maxAttempts: payload.maxAttempts,
                retryable: payload.retryable,
                completedAt: payload.completedAt ?? record.completedAt,
                error:
                  payload.status === "failed"
                    ? payload.error?.message || "Rendering failed."
                    : payload.status === "cancelled"
                      ? "Render cancelled."
                      : undefined,
                artifacts: (payload.artifacts ?? []).map((artifact) => ({
                  id: artifact.id,
                  outputId: artifact.outputId,
                  pageId: artifact.pageId ?? undefined,
                  format: artifact.format,
                  filename: artifactFilename(version, artifact),
                  bytes: artifact.bytes,
                  width: artifact.width ?? undefined,
                  height: artifact.height ?? undefined,
                  objectUrl: artifact.downloadUrl,
                })),
              }
            })
          )
        })
      )
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 2_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [hasRestoredActiveRender, version])

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
        idempotencyKey,
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
          let payload = renderApiResponseSchema.parse(await response.json())
          serverId = payload.id ?? localId
          if (!response.ok) {
            const message = payload.error?.message
            throw new Error(
              message?.includes("not found")
                ? "The Renderer Worker is not running in this local session. Start the full Worker topology and try again."
                : message || `Render API returned ${response.status}.`
            )
          }

          const statusUrl = payload.statusUrl ?? `/v1/renders/${serverId}`
          if (payload.status && !terminalStatuses.has(payload.status)) {
            const accepted: RenderRecord = {
              ...record,
              id: serverId,
              status: payload.status,
              attempt: payload.attempt,
              maxAttempts: payload.maxAttempts,
            }
            setRecords((current) =>
              current.flatMap((candidate) => {
                if (candidate.id === localId) return [accepted]
                if (candidate.id === serverId) return []
                return [candidate]
              })
            )
            payload = await pollRender(
              statusUrl,
              options.signal,
              (progress) => {
                if (!progress.status) return
                setRecords((current) =>
                  current.map((candidate) =>
                    candidate.id === serverId
                      ? {
                          ...candidate,
                          status: progress.status!,
                          attempt: progress.attempt,
                          maxAttempts: progress.maxAttempts,
                          retryable: progress.retryable,
                        }
                      : candidate
                  )
                )
              }
            )
          }
          if (payload.status === "failed" || payload.status === "cancelled") {
            const terminal: RenderRecord = {
              ...record,
              id: serverId,
              status: payload.status,
              attempt: payload.attempt,
              maxAttempts: payload.maxAttempts,
              retryable: payload.retryable,
              completedAt: payload.completedAt ?? new Date().toISOString(),
              error:
                payload.status === "cancelled"
                  ? "Render cancelled."
                  : payload.error?.message || "Rendering failed.",
            }
            setRecords((current) =>
              current.map((candidate) =>
                candidate.id === serverId || candidate.id === localId
                  ? terminal
                  : candidate
              )
            )
            return terminal
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
            attempt: payload.attempt,
            maxAttempts: payload.maxAttempts,
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

  const cancelRender = useCallback(async (renderId: string) => {
    const response = await fetch(`/v1/renders/${renderId}`, {
      method: "DELETE",
    })
    const payload = renderApiResponseSchema.parse(await response.json())
    if (!response.ok || !payload.status) {
      throw new Error(
        payload.error?.message ||
          `Render cancellation returned ${response.status}.`
      )
    }
    setRecords((current) =>
      current.map((record) =>
        record.id === renderId
          ? {
              ...record,
              status: payload.status!,
              completedAt: payload.completedAt ?? record.completedAt,
            }
          : record
      )
    )
  }, [])

  const retryRender = useCallback(
    async (renderId: string) => {
      const response = await fetch(`/v1/renders/${renderId}`, {
        method: "POST",
      })
      const payload = renderApiResponseSchema.parse(await response.json())
      if (!response.ok || !payload.status) {
        throw new Error(
          payload.error?.message || `Render retry returned ${response.status}.`
        )
      }
      setRecords((current) =>
        current.map((record) =>
          record.id === renderId
            ? { ...record, status: payload.status!, error: undefined }
            : record
        )
      )
      const terminal = await pollRender(
        payload.statusUrl ?? `/v1/renders/${renderId}`,
        undefined,
        (progress) => {
          if (!progress.status) return
          setRecords((current) =>
            current.map((record) =>
              record.id === renderId
                ? {
                    ...record,
                    status: progress.status!,
                    attempt: progress.attempt,
                    maxAttempts: progress.maxAttempts,
                    retryable: progress.retryable,
                  }
                : record
            )
          )
        }
      )
      setRecords((current) =>
        current.map((record) => {
          if (record.id !== renderId || !terminal.status) return record
          return {
            ...record,
            status: terminal.status,
            attempt: terminal.attempt,
            maxAttempts: terminal.maxAttempts,
            retryable: terminal.retryable,
            completedAt: terminal.completedAt,
            error:
              terminal.status === "failed"
                ? terminal.error?.message || "Rendering failed."
                : terminal.status === "cancelled"
                  ? "Render cancelled."
                  : undefined,
            artifacts: (terminal.artifacts ?? []).map((artifact) => ({
              id: artifact.id,
              outputId: artifact.outputId,
              pageId: artifact.pageId ?? undefined,
              format: artifact.format,
              filename: artifactFilename(version, artifact),
              bytes: artifact.bytes,
              width: artifact.width ?? undefined,
              height: artifact.height ?? undefined,
              objectUrl: artifact.downloadUrl,
            })),
          }
        })
      )
    },
    [version]
  )

  return { records, historyError, runRender, cancelRender, retryRender }
}

export type RenderHistoryController = ReturnType<typeof useRenderHistory>
