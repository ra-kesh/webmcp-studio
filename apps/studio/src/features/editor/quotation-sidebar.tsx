import type {
  DesignTemplateCatalogItem,
  Document,
  SceneNode,
  TemplateApplicationImpact,
} from "@webmcp/document"
import type { LayerDropIntent, LayerTreeItem, Selection } from "@webmcp/editor"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { EditorPanelTabsList } from "@webmcp/ui/components/editor-chrome"
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"
import { LayerTree } from "./layer-tree"
import type { ProductCommandMenuRuntime } from "./product-command-menu"
import { PageOutputPanel } from "./page-output-panel"
import type { PageOutputPanelProps } from "./page-output-panel"
import { TemplateCatalogPanel } from "./template-catalog-panel"
import type {
  TemplateCatalogIdentity,
  TemplateCatalogPendingAction,
} from "./template-catalog-model"
import type { TemplateCatalogLoadState } from "./template-catalog-panel"

export type DocumentPanelTab = "templates" | "pages" | "layers"

export function QuotationSidebar({
  document,
  activePageId,
  selection,
  templates,
  templateLoadState,
  activeTemplate,
  hasQuotationSource,
  templatePendingAction,
  templateActionError,
  reviewPending,
  activePanel,
  onActivePanelChange,
  onRetryTemplates,
  onCreateFromTemplate,
  onApplyTemplate,
  getTemplateApplicationImpact,
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
  productCommandContext,
  productCommandRuntime,
  compact = false,
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
  templates: readonly DesignTemplateCatalogItem[]
  templateLoadState: TemplateCatalogLoadState
  activeTemplate: TemplateCatalogIdentity | null
  hasQuotationSource: boolean
  templatePendingAction?: TemplateCatalogPendingAction | null
  templateActionError?: string | null
  reviewPending: boolean
  activePanel: DocumentPanelTab
  onActivePanelChange: (panel: DocumentPanelTab) => void
  onRetryTemplates: () => void
  onCreateFromTemplate: (template: DesignTemplateCatalogItem) => void
  onApplyTemplate: (template: DesignTemplateCatalogItem) => void
  getTemplateApplicationImpact: (
    template: DesignTemplateCatalogItem
  ) => TemplateApplicationImpact
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
  productCommandContext: ProductCommandRuntimeContext
  productCommandRuntime: ProductCommandMenuRuntime
  compact?: boolean
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
  return (
    <aside
      className={cn("flex min-h-0 flex-col border-r bg-background", className)}
    >
      <Tabs
        value={activePanel}
        onValueChange={(value) =>
          onActivePanelChange(value as DocumentPanelTab)
        }
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <EditorPanelTabsList aria-label="Editor panels">
          <TabsTrigger value="templates" className="flex-none px-2.5 text-xs">
            Templates
          </TabsTrigger>
          <TabsTrigger value="pages" className="flex-none px-2.5 text-xs">
            Pages
          </TabsTrigger>
          <TabsTrigger value="layers" className="flex-none px-2.5 text-xs">
            Layers
          </TabsTrigger>
        </EditorPanelTabsList>
        <TabsContent
          value="templates"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <TemplateCatalogPanel
            actionError={templateActionError}
            activeTemplate={activeTemplate}
            getApplicationImpact={getTemplateApplicationImpact}
            hasQuotationSource={hasQuotationSource}
            items={templates}
            loadState={templateLoadState}
            layerOrganizationUpgradeAvailable={
              layerOrganizationUpgradeAvailable
            }
            pendingAction={templatePendingAction}
            reviewPending={reviewPending}
            onApply={onApplyTemplate}
            onCreate={onCreateFromTemplate}
            onLayerOrganizationUpgrade={onLayerOrganizationUpgrade}
            onRetry={onRetryTemplates}
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
    </aside>
  )
}
