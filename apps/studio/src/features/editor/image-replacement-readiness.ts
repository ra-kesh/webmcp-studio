export type ImageReplacementRenderer = "fabric" | "react"

export type ImageReplacementReadinessSession = Readonly<{
  token: string
  nodeId: string
  src: string
  naturalSize: Readonly<{ width: number; height: number }>
  renderers: Readonly<Record<ImageReplacementRenderer, "waiting" | "ready">>
}>

export type ImageReplacementRendererEvent = Readonly<{
  token: string
  nodeId: string
  src: string
  renderer: ImageReplacementRenderer
  readiness: "ready" | "unavailable"
  naturalSize?: Readonly<{ width: number; height: number }> | null
}>

export type ImageReplacementReadinessResult = Readonly<{
  session: ImageReplacementReadinessSession
  outcome: "stale" | "duplicate" | "pending" | "ready" | "failed"
}>

export function createImageReplacementReadinessSession(
  token: string,
  nodeId: string,
  src: string,
  naturalSize: Readonly<{ width: number; height: number }>
): ImageReplacementReadinessSession {
  return {
    token,
    nodeId,
    src,
    naturalSize,
    renderers: { fabric: "waiting", react: "waiting" },
  }
}

export function reduceImageReplacementReadiness(
  session: ImageReplacementReadinessSession,
  event: ImageReplacementRendererEvent
): ImageReplacementReadinessResult {
  if (
    event.token !== session.token ||
    event.nodeId !== session.nodeId ||
    event.src !== session.src
  ) {
    return { session, outcome: "stale" }
  }
  if (event.readiness === "unavailable") {
    return { session, outcome: "failed" }
  }
  if (
    event.naturalSize?.width !== session.naturalSize.width ||
    event.naturalSize.height !== session.naturalSize.height
  ) {
    return { session, outcome: "failed" }
  }
  if (session.renderers[event.renderer] === "ready") {
    return { session, outcome: "duplicate" }
  }
  const next: ImageReplacementReadinessSession = {
    ...session,
    renderers: { ...session.renderers, [event.renderer]: "ready" },
  }
  return {
    session: next,
    outcome:
      next.renderers.fabric === "ready" && next.renderers.react === "ready"
        ? "ready"
        : "pending",
  }
}
