import { createContext, useContext } from "react"
import type {
  DocumentDraftRepository,
  DraftRepositoryEvent,
} from "../editor/document-draft-repository"
import type { DocumentRouteAdmissionController } from "../editor/document-route-admission"
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
  documentRouteAdmission: DocumentRouteAdmissionController
}>

// Keep the context identity in a dependency-only module. Provider implementation
// edits may then remount the Studio during Fast Refresh without temporarily
// leaving route consumers attached to a different Context object.
export const StudioPersistenceContext =
  createContext<StudioPersistenceApi | null>(null)

export function useStudioPersistence(): StudioPersistenceApi {
  const persistence = useContext(StudioPersistenceContext)
  if (!persistence) {
    throw new Error(
      "useStudioPersistence must be used within StudioPersistenceProvider."
    )
  }
  return persistence
}
