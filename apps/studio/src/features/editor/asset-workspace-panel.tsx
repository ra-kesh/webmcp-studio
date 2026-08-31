import type { Document } from "@webmcp/document"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@webmcp/ui/components/tabs"
import { LibraryMediaBrowser } from "../../content/library/library-media-browser"
import type {
  LibraryMediaIntent,
  LibraryMediaScope,
} from "../../content/library/library-media-browser"
import { ComponentAssetsPanel } from "./component-assets-panel"

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
  document,
  activeView,
  mediaBrowserVisible,
  mediaScope,
  mediaPendingIdentity,
  mediaActionError,
  mediaActionsEnabled,
  canCreateComponentFromSelection,
  reviewPending,
  onActiveViewChange,
  onMediaScopeChange,
  onMediaSelect,
  onCreateComponentFromSelection,
  onInsertComponent,
  onFocusComponentSource,
}: AssetWorkspacePanelProps) {
  return (
    <section
      aria-label="Assets workspace"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        value={activeView}
        onValueChange={(value) =>
          onActiveViewChange(value as AssetWorkspaceView)
        }
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <TabsList
          aria-label="Asset types"
          variant="line"
          className="h-11 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b px-2"
        >
          <TabsTrigger value="media" className="h-11 flex-none px-3 text-xs">
            Media
          </TabsTrigger>
          <TabsTrigger
            value="components"
            className="h-11 flex-none px-3 text-xs"
          >
            Components
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="media"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <LibraryMediaBrowser
            visible={mediaBrowserVisible}
            density="compact"
            scope={mediaScope}
            action="insert"
            actionsEnabled={mediaActionsEnabled}
            pendingIdentity={mediaPendingIdentity}
            actionError={mediaActionError}
            onScopeChange={onMediaScopeChange}
            onSelect={onMediaSelect}
          />
        </TabsContent>
        <TabsContent
          value="components"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <ComponentAssetsPanel
            document={document}
            canCreateFromSelection={canCreateComponentFromSelection}
            reviewPending={reviewPending}
            onCreateFromSelection={onCreateComponentFromSelection}
            onInsert={onInsertComponent}
            onFocusSource={onFocusComponentSource}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}
