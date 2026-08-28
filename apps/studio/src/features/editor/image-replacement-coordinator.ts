import type {
  ImageReplacementReadinessSession,
  ImageReplacementRendererEvent,
} from "./image-replacement-readiness"
import {
  createImageReplacementReadinessSession,
  reduceImageReplacementReadiness,
} from "./image-replacement-readiness"

export type PreparedImageReplacement<TPayload> = Readonly<{
  token: string
  nodeId: string
  previewSrc: string
  naturalSize: Readonly<{ width: number; height: number }>
  payload: TPayload
}>

type ActiveImageReplacement<TPayload> = {
  candidate: PreparedImageReplacement<TPayload>
  readiness: ImageReplacementReadinessSession
  resolve: (committed: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

export type ImageReplacementCoordinatorOptions<TPayload> = Readonly<{
  validate: (candidate: PreparedImageReplacement<TPayload>) => string | null
  commit: (candidate: PreparedImageReplacement<TPayload>) => boolean
  onPendingChange: (
    candidate: PreparedImageReplacement<TPayload> | null
  ) => void
  onFailure: (message: string) => void
  timeoutMs?: number
}>

export class ImageReplacementCoordinator<TPayload> {
  private active: ActiveImageReplacement<TPayload> | null = null

  constructor(
    private readonly options: ImageReplacementCoordinatorOptions<TPayload>
  ) {}

  start(candidate: PreparedImageReplacement<TPayload>): Promise<boolean> {
    if (this.active) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        const current = this.active
        if (!current || current.candidate.token !== candidate.token) return
        this.finish(
          current,
          false,
          "The replacement image took too long to become ready. The original image was kept. Retry or choose another image."
        )
      }, this.options.timeoutMs ?? 15_000)
      this.active = {
        candidate,
        readiness: createImageReplacementReadinessSession(
          candidate.token,
          candidate.nodeId,
          candidate.previewSrc,
          candidate.naturalSize
        ),
        resolve,
        timeout,
      }
      this.options.onPendingChange(candidate)
    })
  }

  report(event: ImageReplacementRendererEvent) {
    const current = this.active
    if (!current) return "stale" as const
    const result = reduceImageReplacementReadiness(current.readiness, event)
    if (result.outcome === "stale" || result.outcome === "duplicate") {
      return result.outcome
    }
    current.readiness = result.session
    if (result.outcome === "failed") {
      this.finish(
        current,
        false,
        `The replacement could not be installed by the ${event.renderer === "fabric" ? "editor canvas" : "document preview"}. The original image was kept.`
      )
      return "failed" as const
    }
    if (result.outcome === "pending") return "pending" as const

    const invalidReason = this.options.validate(current.candidate)
    if (invalidReason) {
      this.finish(current, false, invalidReason)
      return "rejected" as const
    }
    let committed = false
    try {
      committed = this.options.commit(current.candidate)
    } catch {
      committed = false
    }
    this.finish(
      current,
      committed,
      committed
        ? undefined
        : "The replacement was ready, but the document rejected the change. The original image was kept."
    )
    return committed ? ("committed" as const) : ("rejected" as const)
  }

  cancel(message?: string) {
    const current = this.active
    if (!current) return false
    this.finish(current, false, message)
    return true
  }

  private finish(
    current: ActiveImageReplacement<TPayload>,
    committed: boolean,
    failureMessage?: string
  ) {
    if (this.active !== current) return
    clearTimeout(current.timeout)
    this.active = null
    this.options.onPendingChange(null)
    if (!committed && failureMessage) this.options.onFailure(failureMessage)
    current.resolve(committed)
  }
}
