export type StudioWebMcpActivityStatus = "running" | "succeeded" | "failed"

export type StudioWebMcpActivity = Readonly<{
  executionId: string
  toolName: string
  title: string
  readOnly: boolean
  status: StudioWebMcpActivityStatus
  startedAt: string
  finishedAt?: string
}>

export type StudioWebMcpActivitySnapshot = Readonly<{
  active: readonly StudioWebMcpActivity[]
  recent: readonly StudioWebMcpActivity[]
}>

export type StudioWebMcpActivityStore = Readonly<{
  getSnapshot: () => StudioWebMcpActivitySnapshot
  subscribe: (listener: () => void) => () => void
  publish: (activity: StudioWebMcpActivity) => void
  clear: () => void
}>

const EMPTY_ACTIVITY: StudioWebMcpActivitySnapshot = {
  active: [],
  recent: [],
}

const MAX_RECENT_ACTIVITY = 5

export function createStudioWebMcpActivityStore(): StudioWebMcpActivityStore {
  let snapshot = EMPTY_ACTIVITY
  const listeners = new Set<() => void>()

  const emit = () => listeners.forEach((listener) => listener())

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (activity) => {
      if (activity.status === "running") {
        snapshot = {
          active: [
            ...snapshot.active.filter(
              (item) => item.executionId !== activity.executionId
            ),
            activity,
          ],
          recent: snapshot.recent,
        }
      } else {
        snapshot = {
          active: snapshot.active.filter(
            (item) => item.executionId !== activity.executionId
          ),
          recent: [
            activity,
            ...snapshot.recent.filter(
              (item) => item.executionId !== activity.executionId
            ),
          ].slice(0, MAX_RECENT_ACTIVITY),
        }
      }
      emit()
    },
    clear: () => {
      if (snapshot === EMPTY_ACTIVITY) return
      snapshot = EMPTY_ACTIVITY
      emit()
    },
  }
}

export const emptyStudioWebMcpActivityStore: StudioWebMcpActivityStore = {
  getSnapshot: () => EMPTY_ACTIVITY,
  subscribe: () => () => undefined,
  publish: () => undefined,
  clear: () => undefined,
}
