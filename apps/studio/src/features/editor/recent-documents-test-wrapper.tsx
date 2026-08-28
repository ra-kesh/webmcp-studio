import type { PropsWithChildren } from "react"
import {
  RecentDocumentsProvider,
  useRecentDocuments,
  useRecentDocumentsVisibility,
} from "./recent-documents-provider"
import type { RecentDocumentsProviderProps } from "./recent-documents-provider"
import { StudioPersistenceTestWrapper } from "./studio-persistence-test-wrapper"
import type { StudioPersistenceTestWrapperProps } from "./studio-persistence-test-wrapper"

export type RecentDocumentsTestWrapperProps = PropsWithChildren<
  Pick<StudioPersistenceTestWrapperProps, "createRepository" | "migrate"> &
    Pick<
      RecentDocumentsProviderProps,
      "createController" | "scheduleFinalization"
    > &
    Readonly<{ libraryVisible: boolean }>
>

function TestLibraryVisibility({ visible }: { visible: boolean }) {
  useRecentDocumentsVisibility(visible)
  return null
}

export function RecentDocumentsTestWrapper({
  children,
  createRepository,
  migrate,
  createController,
  scheduleFinalization,
  libraryVisible,
}: RecentDocumentsTestWrapperProps) {
  return (
    <StudioPersistenceTestWrapper
      createRepository={createRepository}
      migrate={migrate}
    >
      <RecentDocumentsProvider
        createController={createController}
        scheduleFinalization={scheduleFinalization}
      >
        <TestLibraryVisibility visible={libraryVisible} />
        {children}
      </RecentDocumentsProvider>
    </StudioPersistenceTestWrapper>
  )
}

export { useRecentDocuments }
