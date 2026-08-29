import { useMemo, useState } from "react"
import type {
  DesignTemplateCatalogItem,
  TemplateApplicationImpact,
} from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
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
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@webmcp/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@webmcp/ui/components/input-group"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"
import { Separator } from "@webmcp/ui/components/separator"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { cn } from "@webmcp/ui/lib/utils"
import {
  AlertTriangle,
  Check,
  FileStack,
  FileWarning,
  FolderTree,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react"
import {
  allTemplateCategoriesValue,
  filterTemplateCatalog,
  isSameTemplate,
  templateCatalogCategories,
  templateCatalogKey,
  templateCompatibility,
  templateDimensionsLabel,
  templateImpactRows,
  templatePreviewLayout,
} from "./template-catalog-model"
import type {
  TemplateCatalogIdentity,
  TemplateCatalogPendingAction,
} from "./template-catalog-model"

export type TemplateCatalogLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

export type TemplateCatalogPanelProps = {
  items: readonly DesignTemplateCatalogItem[]
  loadState: TemplateCatalogLoadState
  hasQuotationSource: boolean
  reviewPending: boolean
  activeTemplate?: TemplateCatalogIdentity | null
  pendingAction?: TemplateCatalogPendingAction | null
  actionError?: string | null
  className?: string
  onRetry: () => void
  onCreate: (template: DesignTemplateCatalogItem) => void
  onApply: (template: DesignTemplateCatalogItem) => void
  getApplicationImpact: (
    template: DesignTemplateCatalogItem
  ) => TemplateApplicationImpact
  layerOrganizationUpgradeAvailable?: boolean
  onLayerOrganizationUpgrade?: () => void
}

type ApplyConfirmation = {
  template: DesignTemplateCatalogItem
  impact: TemplateApplicationImpact
}

function TemplatePreview({
  template,
}: {
  template: DesignTemplateCatalogItem
}) {
  const layout = templatePreviewLayout(template)
  const page = template.previewDocument.pages.find(
    (candidate) => candidate.id === template.previewPageId
  )

  return (
    <div
      aria-label={`Preview of ${template.name}, ${page?.name ?? "first page"}`}
      className="grid h-40 w-full place-items-center overflow-hidden rounded-md border bg-muted/40 p-2"
      role="img"
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-[3px] border bg-background shadow-sm"
        style={{ width: layout.width, height: layout.height }}
      >
        <Artboard
          document={template.previewDocument}
          imageSemantics="thumbnail"
          pageId={template.previewPageId}
          scale={layout.scale}
          showImageRecoveryActions={false}
        />
      </div>
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <div
      aria-label="Loading design templates"
      className="flex flex-col gap-3 p-3"
      role="status"
    >
      {[0, 1].map((index) => (
        <div
          className="flex flex-col gap-2 rounded-lg border p-1.5"
          key={index}
        >
          <Skeleton className="h-40 w-full" />
          <div className="flex flex-col gap-1 px-1.5 pt-1 pb-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CatalogFailure({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Empty className="min-h-72" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>Templates could not be loaded</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" />
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function CatalogEmpty({
  filtered,
  onReset,
}: {
  filtered: boolean
  onReset: () => void
}) {
  return (
    <Empty className="min-h-72">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {filtered ? <Search /> : <FileStack />}
        </EmptyMedia>
        <EmptyTitle>
          {filtered ? "No matching templates" : "No templates available"}
        </EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Try a different search term or show every category."
            : "When templates are added to this catalog, they will appear here."}
        </EmptyDescription>
      </EmptyHeader>
      {filtered ? (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onReset}>
            Clear filters
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

function TemplateCard({
  template,
  selected,
  active,
  hasQuotationSource,
  onSelect,
}: {
  template: DesignTemplateCatalogItem
  selected: boolean
  active: boolean
  hasQuotationSource: boolean
  onSelect: () => void
}) {
  const compatibility = templateCompatibility(template, hasQuotationSource)

  return (
    <li>
      <button
        aria-pressed={selected}
        className={cn(
          "group/template flex w-full flex-col gap-0 rounded-lg border bg-background p-1.5 text-left transition-[border-color,background-color,box-shadow,transform] outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px",
          selected && "border-foreground ring-1 ring-foreground/10"
        )}
        data-active={active}
        data-compatible={compatibility.compatible}
        onClick={onSelect}
        type="button"
      >
        <TemplatePreview template={template} />
        <span className="flex w-full items-start gap-2 px-1.5 pt-2 pb-1.5">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {template.name}
              </span>
              {active ? (
                <span
                  aria-label="Currently applied"
                  className="grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background"
                >
                  <Check className="size-2.5" />
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              {templateDimensionsLabel(template)} · {template.pageCount}{" "}
              {template.pageCount === 1 ? "page" : "pages"}
            </span>
            {!compatibility.compatible ? (
              <span className="mt-1 flex items-center gap-1 text-[10px] leading-4 text-muted-foreground">
                <Link2 className="size-3" />
                {compatibility.label}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

function TemplateDetails({
  template,
  active,
  hasQuotationSource,
  reviewPending,
  pendingAction,
  actionError,
  onCreate,
  onRequestApply,
}: {
  template: DesignTemplateCatalogItem
  active: boolean
  hasQuotationSource: boolean
  reviewPending: boolean
  pendingAction: TemplateCatalogPendingAction | null
  actionError: string | null
  onCreate: () => void
  onRequestApply: () => void
}) {
  const compatibility = templateCompatibility(template, hasQuotationSource)
  const actionInProgress = Boolean(pendingAction)
  const thisAction = pendingAction
    ? isSameTemplate(template, pendingAction.template)
      ? pendingAction.type
      : null
    : null
  const mutationsDisabled =
    reviewPending || !compatibility.compatible || actionInProgress

  return (
    <section
      aria-labelledby="selected-template-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="min-w-0 text-sm leading-5 font-medium"
            id="selected-template-title"
          >
            {template.name}
          </h3>
          <Badge variant={compatibility.compatible ? "secondary" : "outline"}>
            {compatibility.label}
          </Badge>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {template.description}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[10px] leading-4">
        <dt className="text-muted-foreground">Format</dt>
        <dd className="truncate text-right tabular-nums">
          {templateDimensionsLabel(template)}
        </dd>
        <dt className="text-muted-foreground">Pages</dt>
        <dd className="text-right tabular-nums">{template.pageCount}</dd>
        <dt className="text-muted-foreground">Category</dt>
        <dd className="truncate text-right">{template.category}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="truncate text-right">{template.source.name}</dd>
        <dt className="text-muted-foreground">License</dt>
        <dd className="truncate text-right">{template.source.license}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="text-right tabular-nums">v{template.version}</dd>
      </dl>

      <p className="text-[10px] leading-4 text-muted-foreground">
        {compatibility.description}
      </p>

      {template.kind === "quotation_style" && compatibility.compatible ? (
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
          <Sparkles className="mt-0.5 size-3 shrink-0" />
          Applying this style changes the visual system without replacing pages,
          fields, linked content, or manual layout.
        </p>
      ) : null}

      {active ? (
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
          <Check className="mt-0.5 size-3 shrink-0" />
          This template is currently applied to the design.
        </p>
      ) : null}

      {reviewPending ? (
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-3 shrink-0" />
          Resolve the pending WebMCP review before creating or applying a
          template.
        </p>
      ) : null}

      {actionError ? (
        <p className="text-[10px] leading-4 text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Button disabled={mutationsDisabled} onClick={onCreate}>
          {thisAction === "create" ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          Create new
        </Button>
        <Button
          disabled={mutationsDisabled || active}
          variant="outline"
          onClick={onRequestApply}
        >
          {thisAction === "apply" ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <FileStack data-icon="inline-start" />
          )}
          Apply to this design
        </Button>
      </div>
    </section>
  )
}

function ApplyTemplateDialog({
  confirmation,
  reviewPending,
  pendingAction,
  onOpenChange,
  onConfirm,
}: {
  confirmation: ApplyConfirmation | null
  reviewPending: boolean
  pendingAction: TemplateCatalogPendingAction | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const impactRows = confirmation ? templateImpactRows(confirmation.impact) : []
  const disabled = reviewPending || Boolean(pendingAction)

  return (
    <AlertDialog open={Boolean(confirmation)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <FileWarning />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Replace this design with {confirmation?.template.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This replaces the current document structure in one named action.
            One Undo restores the previous document and linked-source context.
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

        {confirmation?.impact.disconnectsQuotationSource ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Link2 className="mt-0.5 size-4 shrink-0" />
            The current Stuwiz quotation will be disconnected from this design.
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Keep current design</AlertDialogCancel>
          <AlertDialogAction disabled={disabled} onClick={onConfirm}>
            Apply template
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TemplateCatalogPanel({
  items,
  loadState,
  hasQuotationSource,
  reviewPending,
  activeTemplate = null,
  pendingAction = null,
  actionError = null,
  className,
  onRetry,
  onCreate,
  onApply,
  getApplicationImpact,
  layerOrganizationUpgradeAvailable = false,
  onLayerOrganizationUpgrade,
}: TemplateCatalogPanelProps) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState(allTemplateCategoriesValue)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ApplyConfirmation | null>(
    null
  )
  const categories = useMemo(() => templateCatalogCategories(items), [items])
  const filteredItems = useMemo(
    () => filterTemplateCatalog(items, { search, category }),
    [category, items, search]
  )
  const selectedTemplate =
    filteredItems.find((item) => templateCatalogKey(item) === selectedKey) ||
    filteredItems.find((item) => isSameTemplate(item, activeTemplate)) ||
    filteredItems.at(0) ||
    null
  const hasFilters =
    search.trim().length > 0 || category !== allTemplateCategoriesValue

  const clearFilters = () => {
    setSearch("")
    setCategory(allTemplateCategoriesValue)
  }

  const requestApply = (template: DesignTemplateCatalogItem) => {
    if (template.kind === "quotation_style") {
      onApply(template)
      return
    }
    setConfirmation({
      template,
      impact: getApplicationImpact(template),
    })
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-medium">Design templates</h2>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              Start a new design or explicitly apply one to the current work.
            </p>
          </div>
          <Badge
            aria-label={`${items.length} ${items.length === 1 ? "template" : "templates"}`}
            variant="outline"
          >
            {items.length}
          </Badge>
        </div>
        {layerOrganizationUpgradeAvailable ? (
          <section
            aria-label="Quotation layer organization update"
            className="rounded-lg border bg-muted/35 p-2.5"
          >
            <div className="flex items-start gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background text-foreground">
                <FolderTree className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[11px] leading-4 font-medium">
                  Organize quotation layers
                </h3>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  Restore semantic folders without changing copy, layout, or
                  styling.
                </p>
              </div>
            </div>
            <Button
              className="mt-2 w-full"
              disabled={reviewPending}
              size="sm"
              variant="outline"
              onClick={onLayerOrganizationUpgrade}
            >
              <FolderTree data-icon="inline-start" />
              Organize layers
            </Button>
            {reviewPending ? (
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                Finish or discard the pending review first.
              </p>
            ) : null}
          </section>
        ) : null}
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search design templates"
            placeholder="Search templates…"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger
            aria-label="Filter templates by category"
            className="w-full"
            size="sm"
          >
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              <SelectItem value={allTemplateCategoriesValue}>
                All categories
              </SelectItem>
              {categories.map((itemCategory) => (
                <SelectItem value={itemCategory} key={itemCategory}>
                  {itemCategory}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <p aria-live="polite" className="sr-only">
          {loadState.status === "ready"
            ? `${filteredItems.length} ${filteredItems.length === 1 ? "template" : "templates"} shown`
            : loadState.status === "loading"
              ? "Loading design templates"
              : "Design templates failed to load"}
        </p>
        {loadState.status === "loading" ? <CatalogSkeleton /> : null}
        {loadState.status === "error" ? (
          <CatalogFailure message={loadState.message} onRetry={onRetry} />
        ) : null}
        {loadState.status === "ready" ? (
          <div className="flex flex-col gap-3 p-3 pb-6">
            {filteredItems.length > 0 ? (
              <ul
                aria-label="Design templates"
                className="flex flex-col gap-2.5"
              >
                {filteredItems.map((template) => (
                  <TemplateCard
                    active={isSameTemplate(template, activeTemplate)}
                    hasQuotationSource={hasQuotationSource}
                    key={templateCatalogKey(template)}
                    selected={template === selectedTemplate}
                    template={template}
                    onSelect={() =>
                      setSelectedKey(templateCatalogKey(template))
                    }
                  />
                ))}
              </ul>
            ) : (
              <CatalogEmpty filtered={hasFilters} onReset={clearFilters} />
            )}

            {selectedTemplate ? (
              <TemplateDetails
                active={isSameTemplate(selectedTemplate, activeTemplate)}
                actionError={actionError}
                hasQuotationSource={hasQuotationSource}
                pendingAction={pendingAction}
                reviewPending={reviewPending}
                template={selectedTemplate}
                onCreate={() => onCreate(selectedTemplate)}
                onRequestApply={() => requestApply(selectedTemplate)}
              />
            ) : null}
          </div>
        ) : null}
      </ScrollArea>

      <ApplyTemplateDialog
        confirmation={confirmation}
        pendingAction={pendingAction}
        reviewPending={reviewPending}
        onConfirm={() => {
          if (!confirmation) return
          const template = confirmation.template
          setConfirmation(null)
          onApply(template)
        }}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      />
    </div>
  )
}
