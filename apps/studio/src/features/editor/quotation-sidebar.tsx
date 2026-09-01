import { useEffect, useRef, useState } from "react"
import type { Document, SceneNode } from "@webmcp/document"
import type { LayerDropIntent, LayerTreeItem, Selection } from "@webmcp/editor"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import { Button } from "@webmcp/ui/components/button"
import {
  EditorPanelNotice,
  EditorPanelTabsList,
} from "@webmcp/ui/components/editor-chrome"
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"
import { FileWarning, FolderTree, Link2 } from "lucide-react"
import { LibraryTemplateBrowser } from "../../content/library/library-template-browser"
import type { LibraryTemplateIntent } from "../../content/library/library-template-browser"
import type {
  LibraryMediaIntent,
  LibraryMediaScope,
} from "../../content/library/library-media-browser"
import type { ResolvedTemplateAction } from "../../content/library/library-template-actions"
import { LayerTree } from "./layer-tree"
import { AssetWorkspacePanel } from "./asset-workspace-panel"
import type { AssetWorkspaceView } from "./asset-workspace-panel"
import type { ProductCommandMenuRuntime } from "./product-command-menu"
import { PageOutputPanel } from "./page-output-panel"
import type { PageOutputPanelProps } from "./page-output-panel"
import { templateImpactRows } from "./template-catalog-model"
import type { TemplateCatalogIdentity } from "./template-catalog-model"

export type DocumentPanelTab = "templates" | "components" | "pages" | "layers"

export function QuotationSidebar({
  document,
  activePageId,
  selection,
  activeTemplate,
  hasQuotationSource,
  templateActionError,
  reviewPending,
  activePanel,
  onActivePanelChange,
  onCreateFromTemplate,
  onResolveApplyTemplate,
  onConfirmApplyTemplate,
  onCancelTemplateAction,
  layerOrganizationUpgradeAvailable,
  onLayerOrganizationUpgrade,
  onSelectionChange,
  onFocusNode,
  onHoverNode,
  onRenameNode,
  onRenameGroup,
  onUpdateLayerNodes,
  onMoveLayer,
  onDeleteLayerNodes,
  canCreateComponentFromSelection,
  onCreateComponentFromSelection,
  onInsertComponent,
  onFocusComponentSource,
  assetWorkspaceView,
  mediaBrowserVisible,
  mediaScope,
  mediaPendingIdentity,
  mediaActionError,
  mediaActionsEnabled,
  onAssetWorkspaceViewChange,
  onMediaScopeChange,
  onMediaSelect,
  productCommandContext,
  productCommandRuntime,
  compact = false,
  templateBrowserVisible = true,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onUpdatePage,
  onRemovePage,
  onReorderPage,
  onAddOutput,
  onUpdateOutput,
  onRemoveOutput,
  className,
}: {
  document: Document
  activePageId: string
  selection: Selection | null
  activeTemplate: TemplateCatalogIdentity | null
  hasQuotationSource: boolean
  templateActionError?: string | null
  reviewPending: boolean
  activePanel: DocumentPanelTab
  onActivePanelChange: (panel: DocumentPanelTab) => void
  onCreateFromTemplate: (
    template: LibraryTemplateIntent
  ) => boolean | Promise<boolean>
  onResolveApplyTemplate: (
    template: LibraryTemplateIntent
  ) => Promise<ResolvedTemplateAction | null>
  onConfirmApplyTemplate: (
    action: ResolvedTemplateAction
  ) => boolean | Promise<boolean>
  onCancelTemplateAction: () => void
  layerOrganizationUpgradeAvailable?: boolean
  onLayerOrganizationUpgrade?: () => void
  onSelectionChange: (nodeIds: string[]) => void
  onFocusNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
  onRenameNode: (nodeId: string, name: string) => void
  onRenameGroup: (groupId: string, name: string) => void
  onUpdateLayerNodes: (nodeIds: string[], patch: Partial<SceneNode>) => void
  onMoveLayer: (
    source: LayerTreeItem,
    target: LayerTreeItem,
    intent: LayerDropIntent
  ) => boolean
  onDeleteLayerNodes: (nodeIds: string[]) => boolean
  canCreateComponentFromSelection: boolean
  onCreateComponentFromSelection: () => void
  onInsertComponent: (componentId: string) => void
  onFocusComponentSource: (componentId: string) => void
  assetWorkspaceView: AssetWorkspaceView
  mediaBrowserVisible: boolean
  mediaScope: LibraryMediaScope
  mediaPendingIdentity?: string | null
  mediaActionError?: string | null
  mediaActionsEnabled: boolean
  onAssetWorkspaceViewChange: (view: AssetWorkspaceView) => void
  onMediaScopeChange: (scope: LibraryMediaScope) => void
  onMediaSelect: (intent: LibraryMediaIntent) => void
  productCommandContext: ProductCommandRuntimeContext
  productCommandRuntime: ProductCommandMenuRuntime
  compact?: boolean
  templateBrowserVisible?: boolean
  className?: string
} & Pick<
  PageOutputPanelProps,
  | "onSelectPage"
  | "onAddPage"
  | "onDuplicatePage"
  | "onUpdatePage"
  | "onRemovePage"
  | "onReorderPage"
  | "onAddOutput"
  | "onUpdateOutput"
  | "onRemoveOutput"
>) {
  const [pendingTemplateAction, setPendingTemplateAction] = useState<
    (LibraryTemplateIntent & { action: "create" | "apply" }) | null
  >(null)
  const [applyConfirmation, setApplyConfirmation] =
    useState<ResolvedTemplateAction | null>(null)
  const wasTemplateBrowserVisible = useRef(templateBrowserVisible)
  const cancelTemplateActionRef = useRef(onCancelTemplateAction)
  cancelTemplateActionRef.current = onCancelTemplateAction

  useEffect(() => {
    const wasVisible = wasTemplateBrowserVisible.current
    wasTemplateBrowserVisible.current = templateBrowserVisible
    if (wasVisible && !templateBrowserVisible) {
      cancelTemplateActionRef.current()
      setPendingTemplateAction(null)
      setApplyConfirmation(null)
    }
  }, [templateBrowserVisible])

  useEffect(
    () => () => {
      if (wasTemplateBrowserVisible.current) cancelTemplateActionRef.current()
    },
    []
  )

  const createFromTemplate = async (intent: LibraryTemplateIntent) => {
    setPendingTemplateAction({ ...intent, action: "create" })
    try {
      await onCreateFromTemplate(intent)
    } finally {
      setPendingTemplateAction(null)
    }
  }

  const resolveApplyTemplate = async (intent: LibraryTemplateIntent) => {
    setPendingTemplateAction({ ...intent, action: "apply" })
    try {
      const resolved = await onResolveApplyTemplate(intent)
      if (resolved) setApplyConfirmation(resolved)
    } finally {
      setPendingTemplateAction(null)
    }
  }

  const closeApplyConfirmation = () => {
    onCancelTemplateAction()
    setApplyConfirmation(null)
  }

  const confirmApplyTemplate = async () => {
    const confirmation = applyConfirmation
    if (!confirmation) return
    setPendingTemplateAction({ ...confirmation.intent, action: "apply" })
    try {
      await onConfirmApplyTemplate(confirmation)
      setApplyConfirmation(null)
    } finally {
      setPendingTemplateAction(null)
    }
  }

  const impactRows = applyConfirmation
    ? templateImpactRows(applyConfirmation.impact)
    : []

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-r bg-editor-panel",
        className
      )}
    >
      <Tabs
        value={activePanel}
        onValueChange={(value) =>
          onActivePanelChange(value as DocumentPanelTab)
        }
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <EditorPanelTabsList aria-label="Editor panels">
          <TabsTrigger value="templates" className="flex-none px-2.5 text-[11px]">
            Templates
          </TabsTrigger>
          <TabsTrigger value="components" className="flex-none px-2.5 text-[11px]">
            Assets
          </TabsTrigger>
          <TabsTrigger value="pages" className="flex-none px-2.5 text-[11px]">
            Pages
          </TabsTrigger>
          <TabsTrigger value="layers" className="flex-none px-2.5 text-[11px]">
            Layers
          </TabsTrigger>
        </EditorPanelTabsList>
        <TabsContent
          value="templates"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {layerOrganizationUpgradeAvailable ? (
              <EditorPanelNotice
                aria-label="Quotation layer organization update"
                className="m-2.5 mb-0"
                icon={<FolderTree />}
                title="Organize quotation layers"
                description="Restore semantic folders without changing copy, layout, or styling."
              >
                <Button
                  disabled={reviewPending}
                  size="sm"
                  variant="outline"
                  onClick={onLayerOrganizationUpgrade}
                >
                  <FolderTree data-icon="inline-start" />
                  Organize layers
                </Button>
                {reviewPending ? (
                  <p className="basis-full text-muted-foreground">
                    Finish or discard the pending review first.
                  </p>
                ) : null}
              </EditorPanelNotice>
            ) : null}
            <LibraryTemplateBrowser
              actionError={templateActionError}
              actionsEnabled={!reviewPending}
              activeTemplate={activeTemplate}
              density="compact"
              hasQuotationSource={hasQuotationSource}
              pendingAction={pendingTemplateAction}
              variant="editor"
              visible={templateBrowserVisible}
              onApply={(intent) => void resolveApplyTemplate(intent)}
              onCreate={(intent) => void createFromTemplate(intent)}
            />
          </div>
        </TabsContent>
        <TabsContent
          value="components"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <AssetWorkspacePanel
            document={document}
            activeView={assetWorkspaceView}
            mediaBrowserVisible={mediaBrowserVisible}
            mediaScope={mediaScope}
            mediaPendingIdentity={mediaPendingIdentity}
            mediaActionError={mediaActionError}
            mediaActionsEnabled={mediaActionsEnabled}
            canCreateComponentFromSelection={canCreateComponentFromSelection}
            reviewPending={reviewPending}
            onActiveViewChange={onAssetWorkspaceViewChange}
            onMediaScopeChange={onMediaScopeChange}
            onMediaSelect={onMediaSelect}
            onCreateComponentFromSelection={onCreateComponentFromSelection}
            onInsertComponent={onInsertComponent}
            onFocusComponentSource={onFocusComponentSource}
          />
        </TabsContent>
        <TabsContent
          value="pages"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <PageOutputPanel
            document={document}
            activePageId={activePageId}
            reviewPending={reviewPending}
            productCommandContext={productCommandContext}
            productCommandRuntime={productCommandRuntime}
            onSelectPage={onSelectPage}
            onAddPage={onAddPage}
            onDuplicatePage={onDuplicatePage}
            onUpdatePage={onUpdatePage}
            onRemovePage={onRemovePage}
            onReorderPage={onReorderPage}
            onAddOutput={onAddOutput}
            onUpdateOutput={onUpdateOutput}
            onRemoveOutput={onRemoveOutput}
          />
        </TabsContent>
        <TabsContent
          value="layers"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <LayerTree
            key={`${document.id}:${activePageId}`}
            document={document}
            activePageId={activePageId}
            selection={selection}
            reviewPending={reviewPending}
            onSelectionChange={onSelectionChange}
            onFocusNode={onFocusNode}
            onHoverNode={onHoverNode}
            onRenameNode={onRenameNode}
            onRenameGroup={onRenameGroup}
            onUpdateNodes={onUpdateLayerNodes}
            onMoveLayer={onMoveLayer}
            onDeleteNodes={onDeleteLayerNodes}
            productCommandContext={productCommandContext}
            productCommandRuntime={productCommandRuntime}
            compact={compact}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={Boolean(applyConfirmation)}
        onOpenChange={(open) => {
          if (!open) closeApplyConfirmation()
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <FileWarning />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Apply {applyConfirmation?.detail.summary.name} to this design?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Review the exact changes below. Studio applies this version in one
              named action, and one Undo restores the previous document and
              linked-source context.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
            {impactRows.map((row) => (
              <div className="contents" key={row.id}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    "text-right font-medium tabular-nums",
                    row.warning && "text-foreground"
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {applyConfirmation?.impact.disconnectsQuotationSource ? (
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Link2 className="mt-0.5 size-4 shrink-0" />
              The current Stuwiz quotation will be disconnected from this
              design.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current design</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(pendingTemplateAction) || reviewPending}
              onClick={(event) => {
                event.preventDefault()
                void confirmApplyTemplate()
              }}
            >
              Apply template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
