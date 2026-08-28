import { useState } from "react"
import type { PropsWithChildren } from "react"
import { DocumentDraftRepository } from "./document-draft-repository"
import {
  StudioPersistenceProvider,
  useStudioPersistence,
} from "../persistence/studio-persistence-provider"
import { StudioPersistenceRuntime } from "../persistence/studio-persistence-runtime"
import type { StudioPersistenceRuntimeOptions } from "../persistence/studio-persistence-runtime"

export type StudioPersistenceTestWrapperProps = PropsWithChildren<{
  createRepository?: () => DocumentDraftRepository
  migrate?: StudioPersistenceRuntimeOptions["migrate"]
}>

export function StudioPersistenceTestWrapper({
  children,
  createRepository,
  migrate,
}: StudioPersistenceTestWrapperProps) {
  const [createRuntime] = useState(
    () => () =>
      new StudioPersistenceRuntime({
        createRepository:
          createRepository ??
          (() =>
            new DocumentDraftRepository({
              indexedDB: globalThis.indexedDB,
              sessionId: "mounted-editor-product-topology",
            })),
        ...(migrate ? { migrate } : {}),
      })
  )
  return (
    <StudioPersistenceProvider createRuntime={createRuntime}>
      {children}
    </StudioPersistenceProvider>
  )
}

export { useStudioPersistence }
