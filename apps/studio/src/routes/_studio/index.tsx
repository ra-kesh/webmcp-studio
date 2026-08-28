import { createFileRoute } from "@tanstack/react-router"
import { StudioShell } from "../../features/studio-shell"
import {
  documentLibraryNoticeCopy,
  documentPath,
  validateDocumentLibraryNoticeSearch,
} from "../../features/editor/document-route"

export const Route = createFileRoute("/_studio/")({
  validateSearch: (search) => validateDocumentLibraryNoticeSearch(search) ?? {},
  component: StudioLibraryRoute,
})

function StudioLibraryRoute() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const noticeSearch = validateDocumentLibraryNoticeSearch(search)
  const notice = noticeSearch ? documentLibraryNoticeCopy(noticeSearch) : null

  const navigateToDocument = async (documentId: string) => {
    const target = documentPath(documentId)
    if (!target.ok) {
      await navigate({
        replace: true,
        search: { notice: "invalid_document_route" },
        to: "/",
      })
      return false
    }
    await navigate({
      params: { documentId },
      to: "/documents/$documentId",
    })
    return true
  }

  return (
    <StudioShell
      routeNotice={notice}
      onDismissRouteNotice={() =>
        navigate({ replace: true, search: {}, to: "/" })
      }
      onOpenDocument={navigateToDocument}
      onSessionOpened={navigateToDocument}
    />
  )
}
