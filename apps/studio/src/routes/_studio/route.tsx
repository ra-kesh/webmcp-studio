import { Outlet, createFileRoute } from "@tanstack/react-router"
import { LibraryPreviewProvider } from "../../content/library/library-preview-provider"
import { LibraryRuntimeProvider } from "../../content/library/library-runtime-provider"
import { RecentDocumentsProvider } from "../../features/editor/recent-documents-provider"
import { DocumentPreviewProvider } from "../../features/editor/document-preview-provider"
import { StudioPersistenceProvider } from "../../features/persistence/studio-persistence-provider"

export const Route = createFileRoute("/_studio")({
  // Browser persistence belongs only to Studio UI routes. API routes remain
  // root children and never construct IndexedDB, BroadcastChannel, or legacy
  // localStorage migration state.
  ssr: false,
  component: StudioPersistenceLayout,
})

function StudioPersistenceLayout() {
  return (
    <StudioPersistenceProvider>
      <LibraryPreviewProvider>
        <LibraryRuntimeProvider>
          <DocumentPreviewProvider>
            <RecentDocumentsProvider>
              <Outlet />
            </RecentDocumentsProvider>
          </DocumentPreviewProvider>
        </LibraryRuntimeProvider>
      </LibraryPreviewProvider>
    </StudioPersistenceProvider>
  )
}
