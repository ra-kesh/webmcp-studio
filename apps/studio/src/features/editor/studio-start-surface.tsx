import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { ChangeEvent, Ref } from "react"
import type { DesignTemplateCatalogItem } from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
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
  ArrowRight,
  ChevronRight,
  FileInput,
  FilePlus2,
  FileStack,
  Image,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import type { StudioStartIntent, StudioStartModel } from "./studio-start-model"
import { RecentDocuments } from "./recent-documents"
import {
  allTemplateCategoriesValue,
  filterTemplateCatalog,
  templateCatalogCategories,
  templateCatalogKey,
  templateCompatibility,
  templateDimensionsLabel,
  templatePreviewLayout,
} from "./template-catalog-model"
import type { TemplateCatalogLoadState } from "./template-catalog-panel"

type ReadyStartModel = Extract<
  StudioStartModel,
  { status: "ready" | "blocked" | "unavailable" }
>

export type StudioStartSurfaceProps = {
  model: ReadyStartModel
  templates: readonly DesignTemplateCatalogItem[]
  templateLoadState: TemplateCatalogLoadState
  hasQuotationSource: boolean
  pendingIntent?: StudioStartIntent | null
  actionError?: string | null
  onDismissActionError?: () => void
  initialFocus?: "heading" | "document-library"
  onCreateBlank: () => void
  onCreateFromTemplate: (template: DesignTemplateCatalogItem) => void
  onImportFile: (file: File) => boolean | Promise<boolean>
  onOpenSample: () => void
  onOpenDocument: (documentId: string) => boolean | Promise<boolean>
  onRetryTemplates: () => void
}

const pendingMatchesTemplate = (
  intent: StudioStartIntent | null,
  template: DesignTemplateCatalogItem
) =>
  intent?.kind === "template" &&
  intent.templateId === template.id &&
  intent.version === template.version

function ProductModel() {
  const steps = [
    {
      name: "Document",
      detail: "The editable source",
      icon: FileStack,
    },
    {
      name: "Outputs",
      detail: "Proposal, post, story, or custom format",
      icon: Image,
    },
    {
      name: "Pages",
      detail: "Ordered canvases exported together",
      icon: FilePlus2,
    },
  ]

  return (
    <section
      aria-labelledby="studio-model-heading"
      className="border-l pl-5 sm:pl-6"
    >
      <p
        className="text-xs font-medium text-muted-foreground"
        id="studio-model-heading"
      >
        How Studio files work
      </p>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map(({ name, detail, icon: Icon }, index) => (
          <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={name}>
            <span className="grid size-8 place-items-center rounded-md border bg-background text-muted-foreground">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {name}
                {index < steps.length - 1 ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 text-muted-foreground"
                  />
                ) : null}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] leading-4 text-muted-foreground">
        Export an output as PNG images or one PDF. Page order stays with the
        document.
      </p>
    </section>
  )
}

function StorageWarning({
  message,
  acknowledged,
  onAcknowledge,
}: {
  message: string
  acknowledged: boolean
  onAcknowledge: () => void
}) {
  return (
    <section
      aria-labelledby="storage-warning-title"
      className="grid gap-3 border border-destructive/25 bg-destructive/5 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
      role="alert"
    >
      <ShieldAlert aria-hidden="true" className="size-5 text-destructive" />
      <div className="min-w-0">
        <h2 className="text-sm font-medium" id="storage-warning-title">
          Browser saving is unavailable
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {message} Work created now may be lost when this tab closes or
          reloads.
        </p>
      </div>
      {acknowledged ? (
        <Badge
          className="justify-self-start sm:justify-self-end"
          variant="outline"
        >
          Session-only mode
        </Badge>
      ) : (
        <Button
          className="min-h-11 justify-self-start sm:min-h-9 sm:justify-self-end"
          size="sm"
          variant="outline"
          onClick={onAcknowledge}
        >
          Use this session
        </Button>
      )}
    </section>
  )
}

function StartTemplatePreview({
  template,
}: {
  template: DesignTemplateCatalogItem
}) {
  const layout = templatePreviewLayout(template, { width: 264, height: 150 })

  return (
    <div
      aria-label={`Preview of ${template.name}`}
      className="grid h-40 w-full place-items-center overflow-hidden border-b bg-muted/40 p-2"
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

function TemplateLoading() {
  return (
    <div
      aria-label="Loading design templates"
      className="grid gap-3 sm:grid-cols-2"
      role="status"
    >
      {[0, 1, 2, 3].map((index) => (
        <div className="border bg-background" key={index}>
          <Skeleton className="h-40 w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TemplateFailure({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Empty className="min-h-80 border" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert />
        </EmptyMedia>
        <EmptyTitle>Templates could not be loaded</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          className="min-h-11 sm:min-h-9"
          variant="outline"
          onClick={onRetry}
        >
          <RefreshCw data-icon="inline-start" />
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function TemplateEmpty({
  filtered,
  onClear,
}: {
  filtered: boolean
  onClear: () => void
}) {
  return (
    <Empty className="min-h-80 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {filtered ? <Search /> : <LayoutTemplate />}
        </EmptyMedia>
        <EmptyTitle>
          {filtered ? "No matching templates" : "No templates available"}
        </EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Clear the filters or try a more general search."
            : "Start with a blank document or import an existing Studio JSON file."}
        </EmptyDescription>
      </EmptyHeader>
      {filtered ? (
        <EmptyContent>
          <Button
            className="min-h-11 sm:min-h-9"
            variant="outline"
            onClick={onClear}
          >
            Clear filters
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

function SelectedTemplateDetails({
  template,
  hasQuotationSource,
  actionsEnabled,
  actionInProgress,
  pendingIntent,
  onCreate,
}: {
  template: DesignTemplateCatalogItem
  hasQuotationSource: boolean
  actionsEnabled: boolean
  actionInProgress: boolean
  pendingIntent: StudioStartIntent | null
  onCreate: (template: DesignTemplateCatalogItem) => void
}) {
  const compatibility = templateCompatibility(template, hasQuotationSource)

  return (
    <aside
      aria-labelledby="start-selected-template-title"
      className="self-start border bg-background p-4 lg:sticky lg:top-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          className="min-w-0 text-sm leading-5 font-semibold"
          id="start-selected-template-title"
        >
          {template.name}
        </h3>
        <Badge variant={compatibility.compatible ? "secondary" : "outline"}>
          {compatibility.label}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
      <Separator className="my-4" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Format</dt>
        <dd className="truncate text-right tabular-nums">
          {templateDimensionsLabel(template)}
        </dd>
        <dt className="text-muted-foreground">Pages</dt>
        <dd className="text-right tabular-nums">{template.pageCount}</dd>
        <dt className="text-muted-foreground">Category</dt>
        <dd className="truncate text-right">{template.category}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="text-right tabular-nums">v{template.version}</dd>
      </dl>
      <p className="mt-4 text-[11px] leading-4 text-muted-foreground">
        {compatibility.description}
      </p>
      <Button
        className="mt-4 min-h-11 w-full sm:min-h-9"
        disabled={
          !actionsEnabled || !compatibility.compatible || actionInProgress
        }
        onClick={() => onCreate(template)}
      >
        {pendingMatchesTemplate(pendingIntent, template) ? (
          <LoaderCircle className="animate-spin" data-icon="inline-start" />
        ) : compatibility.compatible ? (
          <Sparkles data-icon="inline-start" />
        ) : (
          <Link2 data-icon="inline-start" />
        )}
        {compatibility.compatible
          ? "Create from template"
          : "Quotation required"}
      </Button>
    </aside>
  )
}

function TemplateBrowser({
  items,
  loadState,
  hasQuotationSource,
  actionsEnabled,
  pendingIntent,
  onCreate,
  onRetry,
}: {
  items: readonly DesignTemplateCatalogItem[]
  loadState: TemplateCatalogLoadState
  hasQuotationSource: boolean
  actionsEnabled: boolean
  pendingIntent: StudioStartIntent | null
  onCreate: (template: DesignTemplateCatalogItem) => void
  onRetry: () => void
}) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState(allTemplateCategoriesValue)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const categories = useMemo(() => templateCatalogCategories(items), [items])
  const filteredItems = useMemo(
    () => filterTemplateCatalog(items, { search, category }),
    [category, items, search]
  )
  const selectedTemplate =
    filteredItems.find((item) => templateCatalogKey(item) === selectedKey) ||
    filteredItems.at(0) ||
    null
  const hasFilters =
    search.trim().length > 0 || category !== allTemplateCategoriesValue
  const actionInProgress = pendingIntent !== null

  const clearFilters = () => {
    setSearch("")
    setCategory(allTemplateCategoriesValue)
  }

  return (
    <section aria-labelledby="start-template-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Use a complete visual system
          </p>
          <h2
            className="mt-1 text-lg leading-6 font-semibold tracking-tight"
            id="start-template-heading"
          >
            Start from a template
          </h2>
        </div>
        {loadState.status === "ready" ? (
          <Badge variant="outline">
            {filteredItems.length}{" "}
            {filteredItems.length === 1 ? "template" : "templates"}
          </Badge>
        ) : null}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
        <InputGroup className="h-11 sm:h-8">
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
            className="min-h-11 w-full sm:min-h-9"
            size="sm"
          >
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent align="end" position="popper">
            <SelectGroup>
              <SelectItem value={allTemplateCategoriesValue}>
                All categories
              </SelectItem>
              {categories.map((itemCategory) => (
                <SelectItem key={itemCategory} value={itemCategory}>
                  {itemCategory}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <p aria-live="polite" className="sr-only">
        {loadState.status === "loading"
          ? "Loading design templates"
          : loadState.status === "error"
            ? "Design templates failed to load"
            : `${filteredItems.length} ${filteredItems.length === 1 ? "template" : "templates"} shown`}
      </p>

      {loadState.status === "loading" ? <TemplateLoading /> : null}
      {loadState.status === "error" ? (
        <TemplateFailure message={loadState.message} onRetry={onRetry} />
      ) : null}
      {loadState.status === "ready" && filteredItems.length === 0 ? (
        <TemplateEmpty filtered={hasFilters} onClear={clearFilters} />
      ) : null}
      {loadState.status === "ready" && filteredItems.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <ul
            aria-label="Design templates"
            className="grid content-start gap-3 sm:grid-cols-2"
          >
            {filteredItems.map((template) => {
              const compatibility = templateCompatibility(
                template,
                hasQuotationSource
              )
              const selected = template === selectedTemplate
              return (
                <li key={templateCatalogKey(template)}>
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "group/template flex w-full flex-col overflow-hidden border bg-background text-left transition-[border-color,background-color,box-shadow,transform] duration-150 outline-none hover:border-foreground/20 hover:bg-muted/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px",
                      selected && "border-foreground ring-1 ring-foreground/10"
                    )}
                    type="button"
                    onClick={() => setSelectedKey(templateCatalogKey(template))}
                  >
                    <StartTemplatePreview template={template} />
                    <span className="flex min-h-20 w-full items-start gap-3 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {template.name}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                          {templateDimensionsLabel(template)} ·{" "}
                          {template.pageCount}{" "}
                          {template.pageCount === 1 ? "page" : "pages"}
                        </span>
                      </span>
                      {!compatibility.compatible ? (
                        <Link2
                          aria-label={compatibility.label}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {selectedTemplate ? (
            <SelectedTemplateDetails
              actionInProgress={actionInProgress}
              actionsEnabled={actionsEnabled}
              hasQuotationSource={hasQuotationSource}
              pendingIntent={pendingIntent}
              template={selectedTemplate}
              onCreate={onCreate}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function QuickStarts({
  actionsEnabled,
  importSettling,
  pendingIntent,
  onCreateBlank,
  onImportFile,
  onOpenSample,
  blankButtonRef,
}: {
  actionsEnabled: boolean
  importSettling: boolean
  pendingIntent: StudioStartIntent | null
  onCreateBlank: () => void
  onImportFile: (file: File) => boolean | Promise<boolean>
  onOpenSample: () => void
  blankButtonRef?: Ref<HTMLButtonElement>
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const actionInProgress = pendingIntent !== null || importSettling
  const restoreImportFocus = useCallback(() => {
    window.setTimeout(() => importButtonRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const handleCancel = () => restoreImportFocus()
    input.addEventListener("cancel", handleCancel)
    return () => input.removeEventListener("cancel", handleCancel)
  }, [restoreImportFocus])

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) {
      restoreImportFocus()
      return
    }
    setImportError(null)
    try {
      const accepted = await onImportFile(file)
      if (!accepted) {
        setImportError(
          "This file could not be opened. The current draft was not changed."
        )
      }
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "This file could not be opened. The current draft was not changed."
      )
    } finally {
      input.value = ""
      restoreImportFocus()
    }
  }

  return (
    <section aria-labelledby="start-other-ways-heading">
      <div className="mb-4">
        <p className="text-xs font-medium text-muted-foreground">
          Other ways to begin
        </p>
        <h2
          className="mt-1 text-lg leading-6 font-semibold tracking-tight"
          id="start-other-ways-heading"
        >
          Blank or existing work
        </h2>
      </div>
      <div className="grid gap-px overflow-hidden border bg-border md:grid-cols-[1.15fr_0.85fr]">
        <button
          ref={blankButtonRef}
          className="group min-h-40 bg-background p-5 text-left transition-[background-color,transform,box-shadow] duration-150 outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset active:translate-y-px disabled:pointer-events-none disabled:opacity-55 sm:p-6"
          disabled={!actionsEnabled || actionInProgress}
          type="button"
          onClick={onCreateBlank}
        >
          <span className="grid size-9 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
            <FilePlus2 aria-hidden="true" className="size-4" />
          </span>
          <span className="mt-6 flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">
                Blank document
              </span>
              <span className="mt-1 block max-w-sm text-xs leading-5 text-muted-foreground">
                Choose a preset or enter exact pixel dimensions.
              </span>
            </span>
            {pendingIntent?.kind === "blank" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            )}
          </span>
        </button>

        <button
          ref={importButtonRef}
          aria-controls={inputId}
          className="group min-h-40 bg-background p-5 text-left transition-[background-color,transform,box-shadow] duration-150 outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset active:translate-y-px disabled:pointer-events-none disabled:opacity-55 sm:p-6"
          disabled={!actionsEnabled || actionInProgress}
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          <span className="grid size-9 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
            <FileInput aria-hidden="true" className="size-4" />
          </span>
          <span className="mt-6 flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">
                Import Studio JSON
              </span>
              <span className="mt-1 block max-w-sm text-xs leading-5 text-muted-foreground">
                Open a validated document file from this device.
              </span>
            </span>
            {pendingIntent?.kind === "import" || importSettling ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            )}
          </span>
        </button>
      </div>
      <input
        ref={inputRef}
        accept=".json,application/json"
        aria-hidden="true"
        hidden
        id={inputId}
        name="studioDocument"
        tabIndex={-1}
        type="file"
        onChange={importFile}
      />
      {importError ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {importError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium">Northstar sample proposal</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Six pages of sample quotation data. Studio labels it as sample work.
          </p>
        </div>
        <Button
          className="min-h-11 justify-self-start sm:min-h-9"
          disabled={!actionsEnabled || actionInProgress}
          variant="ghost"
          onClick={onOpenSample}
        >
          {pendingIntent?.kind === "sample" ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          Open sample
        </Button>
      </div>
    </section>
  )
}

export function StudioStartSurface({
  model,
  templates,
  templateLoadState,
  hasQuotationSource,
  pendingIntent = null,
  actionError = null,
  onDismissActionError,
  initialFocus = "heading",
  onCreateBlank,
  onCreateFromTemplate,
  onImportFile,
  onOpenDocument,
  onOpenSample,
  onRetryTemplates,
}: StudioStartSurfaceProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const blankActionRef = useRef<HTMLButtonElement>(null)
  const [ephemeralAcknowledged, setEphemeralAcknowledged] = useState(false)
  const [importSettling, setImportSettling] = useState(false)
  const sessionAllowed = model.durable || ephemeralAcknowledged
  const actionInProgress = pendingIntent !== null || importSettling
  const actionsEnabled = sessionAllowed && !importSettling

  useEffect(() => {
    if (initialFocus === "heading") {
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [initialFocus])

  return (
    <main className="min-h-[100dvh] bg-muted/20 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-md bg-foreground text-background"
          >
            <Sparkles className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">
              Studio
            </span>
            <span className="block text-[10px] text-muted-foreground">
              Documents and images
            </span>
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10 lg:gap-12 lg:px-8 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-end">
          <section aria-labelledby="studio-start-heading">
            <p className="text-xs font-medium text-muted-foreground">
              New document
            </p>
            <h1
              ref={headingRef}
              className="mt-2 max-w-2xl text-3xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-4xl"
              id="studio-start-heading"
              tabIndex={-1}
            >
              What are you making?
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Open recent work, start with a complete template, or create a
              clean page with exact dimensions.
            </p>
          </section>
          <ProductModel />
        </div>

        {!model.durable && model.storageWarning ? (
          <StorageWarning
            acknowledged={ephemeralAcknowledged}
            message={model.storageWarning}
            onAcknowledge={() => {
              setEphemeralAcknowledged(true)
              window.requestAnimationFrame(() =>
                blankActionRef.current?.focus()
              )
            }}
          />
        ) : model.storageWarning ? (
          <section
            className="flex items-start gap-3 border bg-background p-4"
            role="status"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              {model.storageWarning}
            </p>
          </section>
        ) : null}

        {actionError ? (
          <section
            className="flex items-start justify-between gap-4 border border-destructive/25 bg-destructive/5 p-4"
            role="alert"
          >
            <div>
              <p className="text-sm font-medium">
                Studio could not start that document
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {actionError}
              </p>
            </div>
            {onDismissActionError ? (
              <Button
                className="shrink-0"
                size="sm"
                type="button"
                variant="ghost"
                onClick={onDismissActionError}
              >
                Dismiss
              </Button>
            ) : null}
          </section>
        ) : null}

        <RecentDocuments
          actionsEnabled={actionsEnabled && !actionInProgress}
          initialFocusRequested={initialFocus === "document-library"}
          onCreateBlank={onCreateBlank}
          onOpen={onOpenDocument}
        />

        <Separator />

        <TemplateBrowser
          actionsEnabled={actionsEnabled}
          hasQuotationSource={hasQuotationSource}
          items={templates}
          loadState={templateLoadState}
          pendingIntent={pendingIntent}
          onCreate={onCreateFromTemplate}
          onRetry={onRetryTemplates}
        />

        <Separator />

        <QuickStarts
          actionsEnabled={actionsEnabled}
          importSettling={importSettling}
          pendingIntent={pendingIntent}
          blankButtonRef={blankActionRef}
          onCreateBlank={onCreateBlank}
          onImportFile={async (file) => {
            setImportSettling(true)
            try {
              return await onImportFile(file)
            } finally {
              setImportSettling(false)
            }
          }}
          onOpenSample={onOpenSample}
        />
      </div>
    </main>
  )
}
