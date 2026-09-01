import type { CanvasImageSourceReadiness } from "@webmcp/editor"

export type ImageSourceStateChange = Readonly<{
  nodeId: string
  src: string
  resourceToken?: string
  readiness: "loading" | CanvasImageSourceReadiness
  naturalSize?: Readonly<{ width: number; height: number }> | null
}>

export function acceptImageSourceStateChange(
  currentSources: ReadonlyMap<string, string>,
  reportedStates: Map<string, ImageSourceStateChange>,
  state: ImageSourceStateChange,
  currentResourceTokens?: ReadonlyMap<string, string | undefined>
) {
  if (currentSources.get(state.nodeId) !== state.src) return "stale" as const
  if (
    currentResourceTokens &&
    currentResourceTokens.get(state.nodeId) !== state.resourceToken
  ) {
    return "stale" as const
  }
  const previous = reportedStates.get(state.nodeId)
  if (
    previous?.src === state.src &&
    previous.resourceToken === state.resourceToken &&
    previous.readiness === state.readiness
  ) {
    return "duplicate" as const
  }
  reportedStates.set(state.nodeId, state)
  return "accepted" as const
}
