import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import type { PropsWithChildren } from "react"
import type {
  DocumentDraftRepository,
  DraftRepositoryEvent,
} from "../editor/document-draft-repository"
import { StudioPersistenceRuntime } from "./studio-persistence-runtime"
import type { StudioPersistenceState } from "./studio-persistence-runtime"

export type StudioPersistenceApi = Readonly<{
  repository: DocumentDraftRepository
  state: StudioPersistenceState
  retry: () => void
  completeRecovery: (warning: string | null) => void
  subscribeRepositoryEvents: (
    listener: (event: DraftRepositoryEvent) => void
  ) => () => void
  acquireLease: () => () => void
}>

const StudioPersistenceContext = createContext<StudioPersistenceApi | null>(
  null
)

export type StudioPersistenceProviderProps = PropsWithChildren<{
  createRuntime?: () => StudioPersistenceRuntime
}>

export function StudioPersistenceProvider({
  children,
  createRuntime,
}: StudioPersistenceProviderProps) {
  const [runtime] = useState<StudioPersistenceRuntime>(
    () => createRuntime?.() ?? new StudioPersistenceRuntime()
  )
  const state = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot
  )

  useEffect(() => runtime.retain(), [runtime])

  const api = useMemo<StudioPersistenceApi>(
    () => ({
      get repository() {
        return runtime.repository
      },
      state,
      retry: () => runtime.retry(),
      completeRecovery: (warning) => runtime.completeRecovery(warning),
      subscribeRepositoryEvents: (listener) =>
        runtime.subscribeRepositoryEvents(listener),
      acquireLease: () => runtime.acquireLease(),
    }),
    [runtime, state]
  )

  return (
    <StudioPersistenceContext.Provider value={api}>
      {children}
    </StudioPersistenceContext.Provider>
  )
}

export function useStudioPersistence(): StudioPersistenceApi {
  const persistence = useContext(StudioPersistenceContext)
  if (!persistence) {
    throw new Error(
      "useStudioPersistence must be used within StudioPersistenceProvider."
    )
  }
  return persistence
}
