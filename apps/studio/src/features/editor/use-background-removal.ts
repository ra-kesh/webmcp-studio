import { useCallback, useEffect, useRef, useState } from "react"
import {
  cancelBackgroundRemoval,
  createBackgroundRemoval,
  getBackgroundRemovalProvenance,
  getBackgroundRemovalJob,
  getBackgroundRemovalPolicy,
  getLatestBackgroundRemoval,
  retryBackgroundRemoval,
} from "./background-removal-client"
import type {
  BackgroundRemovalJob,
  BackgroundRemovalPolicy,
  BackgroundRemovalProvenance,
} from "./background-removal-client"

export type BackgroundRemovalModel = Readonly<{
  available: boolean
  unavailableReason: string | null
  policy: BackgroundRemovalPolicy | null
  policyLoading: boolean
  job: BackgroundRemovalJob | null
  provenance: BackgroundRemovalProvenance | null
  busy: boolean
  applying: boolean
  applied: boolean
  error: string | null
  start: () => void
  cancel: () => void
  retry: () => void
  apply: () => void
}>

const terminal = (state: BackgroundRemovalJob["state"]) =>
  state === "succeeded" || state === "failed" || state === "cancelled"

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout)
        reject(signal.reason)
      },
      { once: true }
    )
  })

export function useBackgroundRemoval({
  nodeId,
  sourceAssetId,
  sourceIsManaged,
  editable,
  applyOutput,
}: {
  nodeId: string | null
  sourceAssetId: string | null
  sourceIsManaged: boolean
  editable: boolean
  applyOutput: (nodeId: string, outputAssetId: string) => Promise<boolean>
}): BackgroundRemovalModel {
  const [policy, setPolicy] = useState<BackgroundRemovalPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [job, setJob] = useState<BackgroundRemovalJob | null>(null)
  const [provenance, setProvenance] =
    useState<BackgroundRemovalProvenance | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const available = Boolean(
    nodeId && sourceAssetId && sourceIsManaged && editable
  )
  const unavailableReason = !editable
    ? "Image changes are unavailable while this document is locked for review."
    : !sourceIsManaged
      ? "Save or promote this image to Studio before removing its background."
      : !nodeId || !sourceAssetId
        ? "Select one image to remove its background."
        : null

  const watch = useCallback(async (initial: BackgroundRemovalJob) => {
    const generation = generationRef.current
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    let current = initial
    setJob(current)
    while (!terminal(current.state)) {
      await wait(750, controller.signal)
      current = await getBackgroundRemovalJob(current.id, controller.signal)
      if (generation !== generationRef.current) return
      setJob(current)
    }
    if (current.state === "succeeded" && current.outputAssetId) {
      const next = await getBackgroundRemovalProvenance(
        current.outputAssetId,
        controller.signal
      )
      if (generation === generationRef.current) setProvenance(next)
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setPolicy(null)
    setJob(null)
    setProvenance(null)
    setApplying(false)
    setApplied(false)
    setError(null)
    if (!available || !sourceAssetId) return
    const generation = generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setPolicyLoading(true)
    void Promise.all([
      getBackgroundRemovalPolicy(controller.signal),
      getLatestBackgroundRemoval(sourceAssetId, controller.signal),
    ])
      .then(([nextPolicy, latestJob]) => {
        if (generation !== generationRef.current) return
        setPolicy(nextPolicy)
        if (latestJob) void watch(latestJob)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || generation !== generationRef.current) {
          return
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Background-removal policy could not be loaded."
        )
      })
      .finally(() => {
        if (generation === generationRef.current) setPolicyLoading(false)
      })
    return () => controller.abort()
  }, [available, nodeId, sourceAssetId, watch])

  const run = useCallback(
    (operation: () => Promise<BackgroundRemovalJob>) => {
      setError(null)
      setApplied(false)
      void operation()
        .then(watch)
        .catch((caught: unknown) => {
          if (controllerRef.current?.signal.aborted) return
          setError(
            caught instanceof Error
              ? caught.message
              : "Background removal could not be completed."
          )
        })
    },
    [watch]
  )

  const start = useCallback(() => {
    if (!available || !policy || !sourceAssetId) return
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    run(() => createBackgroundRemoval(sourceAssetId, policy, controller.signal))
  }, [available, policy, run, sourceAssetId])

  const cancel = useCallback(() => {
    if (!job || (job.state !== "queued" && job.state !== "running")) return
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    run(() => cancelBackgroundRemoval(job, controller.signal))
  }, [job, run])

  const retry = useCallback(() => {
    if (!job?.retryable) return
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    run(() => retryBackgroundRemoval(job, controller.signal))
  }, [job, run])

  const apply = useCallback(() => {
    if (!nodeId || !job?.outputAssetId || job.state !== "succeeded") return
    setApplying(true)
    setError(null)
    void applyOutput(nodeId, job.outputAssetId)
      .then((committed) => {
        setApplied(committed)
        if (!committed) {
          setError(
            "The result is saved in Media, but this image could not be replaced. Check its binding or selection and retry."
          )
        }
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "The result is saved in Media, but could not be applied."
        )
      )
      .finally(() => setApplying(false))
  }, [applyOutput, job, nodeId])

  return {
    available,
    unavailableReason,
    policy,
    policyLoading,
    job,
    provenance,
    busy:
      job?.state === "queued" ||
      job?.state === "running" ||
      job?.state === "cancelling",
    applying,
    applied,
    error,
    start,
    cancel,
    retry,
    apply,
  }
}
