import type { Document } from "@webmcp/document"
import { LibraryMediaBrowser } from "../../content/library/library-media-browser"
import type {
  LibraryMediaIntent,
  LibraryMediaScope,
} from "../../content/library/library-media-browser"

export type AssetWorkspaceView = "media" | "components"

export type AssetWorkspacePanelProps = Readonly<{
  document: Document
  activeView: AssetWorkspaceView
  mediaBrowserVisible: boolean
  mediaScope: LibraryMediaScope
  mediaPendingIdentity?: string | null
  mediaActionError?: string | null
  mediaActionsEnabled: boolean
  canCreateComponentFromSelection: boolean
  reviewPending: boolean
  onActiveViewChange: (view: AssetWorkspaceView) => void
  onMediaScopeChange: (scope: LibraryMediaScope) => void
  onMediaSelect: (intent: LibraryMediaIntent) => void
  onCreateComponentFromSelection: () => void
  onInsertComponent: (componentId: string) => void
  onFocusComponentSource: (componentId: string) => void
}>

export function AssetWorkspacePanel({
  mediaBrowserVisible,
  mediaPendingIdentity,
  mediaActionError,
  mediaActionsEnabled,
  onMediaScopeChange,
  onMediaSelect,
}: AssetWorkspacePanelProps) {
  return (
    <section
      aria-label="Assets workspace"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <LibraryMediaBrowser
        visible={mediaBrowserVisible}
        density="compact"
        simpleLibrary
        scope={{ kind: "library" }}
        action="insert"
        actionsEnabled={mediaActionsEnabled}
        pendingIdentity={mediaPendingIdentity}
        actionError={mediaActionError}
        onScopeChange={onMediaScopeChange}
        onSelect={onMediaSelect}
      />
    </section>
  )
}
