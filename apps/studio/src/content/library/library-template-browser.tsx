import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import {
  ChevronRight,
  Ellipsis,
  FileStack,
  Filter,
  FolderPlus,
  Folders,
  Heart,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CSSProperties, ReactNode, RefCallback } from "react"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryTemplateDetail,
  LibraryTemplateSummary,
} from "@webmcp/document"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@webmcp/ui/components/input-group"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@webmcp/ui/components/sheet"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { cn } from "@webmcp/ui/lib/utils"
import type {
  LibraryDiscoveryDetailState,
  LibraryDiscoveryEntryPoint,
  LibraryDiscoveryFilters,
  LibraryDiscoveryState,
} from "./discovery-controller"
import {
  useLibraryDiscovery,
  useLibraryDiscoveryLease,
} from "./library-discovery-provider"
import { LibraryPreview } from "./library-preview"
import {
  LibraryCollectionBrowserDialog,
  LibraryPreferenceFailureNotice,
} from "./library-collection-browser"
import type { LibraryCollectionDialogRequest } from "./library-collection-browser"
import {
  projectLibraryCollectionOptions,
  projectLibraryTemplatePreferences,
} from "./library-preference-projection"
import { useLibraryPreferences } from "./library-preference-provider"
import type {
  LibraryPreferenceFailure,
  LibraryPreferenceStateOwner,
} from "./library-preference-controller"

export const LIBRARY_TEMPLATE_VIRTUALIZATION_THRESHOLD = 48

export type LibraryTemplateIntent = Readonly<{
  itemKind: "template"
  id: string
  version: number
}>

export type LibraryTemplateFilterOption = Readonly<{
  id: string
  label: string
}>

export type LibraryTemplateBrowserProps = Readonly<{
  variant: "start" | "editor"
  density?: "comfortable" | "compact"
  visible?: boolean
  hasQuotationSource: boolean
  actionsEnabled?: boolean
  activeTemplate?: Readonly<{ id: string; version: number }> | null
  pendingAction?:
    (LibraryTemplateIntent & Readonly<{ action: "create" | "apply" }>) | null
  actionError?: string | null
  collectionOptions?: readonly LibraryTemplateFilterOption[]
  onCreate: (intent: LibraryTemplateIntent) => void
  onApply?: (intent: LibraryTemplateIntent) => void
  onToggleFavorite?: (intent: LibraryTemplateIntent, favorite: boolean) => void
}>

const exactIdentity = (item: LibraryTemplateSummary): LibraryTemplateIntent =>
  Object.freeze({
    itemKind: "template",
    id: item.id,
    version: item.version,
  })

const identityKey = (item: Pick<LibraryTemplateSummary, "id" | "version">) =>
  `template:${item.id}@${item.version}`

const isTemplate = (
  item: LibraryCatalogItemSummary
): item is LibraryTemplateSummary => item.itemKind === "template"

const isTemplateDetail = (
  detail: LibraryCatalogItemDetail
): detail is LibraryTemplateDetail => detail.summary.itemKind === "template"

const ownerLabel = (item: LibraryTemplateSummary) =>
  item.owner.kind === "studio" ? "Studio" : "Your workspace"

const dimensionLabel = (item: LibraryTemplateSummary) => {
  const first = item.dimensions[0]
  if (!first) return "Custom size"
  const dimensions = `${first.width.toLocaleString()} × ${first.height.toLocaleString()}`
  return item.dimensions.every(
    (dimension) =>
      dimension.width === first.width && dimension.height === first.height
  )
    ? dimensions
    : "Mixed sizes"
}

type Compatibility = Readonly<{
  available: boolean
  reason: string | null
}>

const compatibilityFor = (
  item: LibraryTemplateSummary,
  hasQuotationSource: boolean,
  action: "create" | "apply"
): Compatibility => {
  if (item.catalogStatus !== "active") {
    return { available: false, reason: "This version is retired." }
  }
  if (!item.permissions.canUse) {
    return { available: false, reason: "You do not have permission to use it." }
  }
  if (!item.compatibility.supportedActions.includes(action)) {
    return {
      available: false,
      reason:
        action === "apply"
          ? "This template starts a new document and cannot be applied."
          : "This template cannot create a new document.",
    }
  }
  if (item.compatibility.availability === "unavailable") {
    return {
      available: false,
      reason: item.compatibility.reason ?? "This template is unavailable.",
    }
  }
  if (
    item.compatibility.requirements.includes("quotation_source") &&
    !hasQuotationSource
  ) {
    return {
      available: false,
      reason: "Import a quotation before using this style.",
    }
  }
  return { available: true, reason: null }
}

const cardContainmentStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "280px",
}

const entryPoints: readonly Readonly<{
  id: Extract<LibraryDiscoveryEntryPoint, "featured" | "recent" | "favorites">
  label: string
}>[] = [
  { id: "featured", label: "Featured" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
]

function BrowserFilters({
  state,
  collectionOptions,
  onChange,
  onOrderChange,
  compact = false,
}: {
  state: LibraryDiscoveryState
  collectionOptions: readonly LibraryTemplateFilterOption[]
  onChange: (patch: Partial<LibraryDiscoveryFilters>) => void
  onOrderChange: (order: LibraryDiscoveryState["order"]) => void
  compact?: boolean
}) {
  const fieldClass = cn(
    "min-h-11 rounded-lg border border-input bg-background px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
    compact ? "w-full" : "min-w-40"
  )
  return (
    <fieldset
      className={cn(
        "grid gap-2",
        compact ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3"
      )}
    >
      <legend className="sr-only">Filter templates</legend>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Category
        <select
          aria-label="Filter templates by category"
          className={fieldClass}
          value={state.filters.categoryIds[0] ?? "all"}
          onChange={(event) =>
            onChange({
              categoryIds:
                event.target.value === "all" ? [] : [event.target.value],
            })
          }
        >
          <option value="all">All categories</option>
          {state.taxonomy.categories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Use case
        <select
          aria-label="Filter templates by use case"
          className={fieldClass}
          value={state.filters.useCaseIds[0] ?? "all"}
          onChange={(event) =>
            onChange({
              useCaseIds:
                event.target.value === "all" ? [] : [event.target.value],
            })
          }
        >
          <option value="all">All use cases</option>
          {state.taxonomy.useCases.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Format
        <select
          aria-label="Filter templates by format"
          className={fieldClass}
          value={state.filters.formatFamilies[0] ?? "all"}
          onChange={(event) =>
            onChange({
              formatFamilies:
                event.target.value === "all" ? [] : [event.target.value],
            })
          }
        >
          <option value="all">All formats</option>
          {state.taxonomy.formatFamilies.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Owner
        <select
          aria-label="Filter templates by owner"
          className={fieldClass}
          value={state.filters.ownerKinds[0] ?? "all"}
          onChange={(event) =>
            onChange({
              ownerKinds:
                event.target.value === "all"
                  ? []
                  : [
                      event.target
                        .value as LibraryDiscoveryFilters["ownerKinds"][number],
                    ],
            })
          }
        >
          <option value="all">All owners</option>
          {state.taxonomy.owners.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Collection
        <select
          aria-label="Filter templates by collection"
          className={fieldClass}
          value={state.filters.collectionId ?? "all"}
          onChange={(event) =>
            onChange({
              collectionId:
                event.target.value === "all" ? null : event.target.value,
            })
          }
        >
          <option value="all">All collections</option>
          {collectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Sort
        <select
          aria-label="Sort templates"
          className={fieldClass}
          value={state.order}
          onChange={(event) =>
            onOrderChange(event.target.value as LibraryDiscoveryState["order"])
          }
        >
          <option value="curated">Featured first</option>
          <option value="recent">Recently used</option>
          <option value="newest">Newest first</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Orientation
        <select
          aria-label="Filter templates by orientation"
          className={fieldClass}
          value={state.filters.orientations[0] ?? "all"}
          onChange={(event) =>
            onChange({
              orientations:
                event.target.value === "all"
                  ? []
                  : [
                      event.target
                        .value as LibraryDiscoveryFilters["orientations"][number],
                    ],
            })
          }
        >
          <option value="all">Any orientation</option>
          {state.taxonomy.orientations.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}

function TemplateCard({
  item,
  selected,
  active,
  compact,
  hasQuotationSource,
  onSelect,
  onInspect,
  onToggleFavorite,
  collectionOptions,
  collectionMutationPending,
  onToggleCollection,
  onNewCollection,
  onManageCollections,
  favoritePending,
  onFocus,
  cardRef,
  semanticPosition,
}: {
  item: LibraryTemplateSummary
  selected: boolean
  active: boolean
  compact: boolean
  hasQuotationSource: boolean
  onSelect: () => void
  onInspect: () => void
  onToggleFavorite?: (favorite: boolean) => void
  collectionOptions: readonly LibraryTemplateFilterOption[]
  collectionMutationPending: (collectionId: string) => boolean
  onToggleCollection?: (collectionId: string, member: boolean) => void
  onNewCollection: (item: LibraryTemplateSummary) => void
  onManageCollections: () => void
  favoritePending: boolean
  onFocus: () => void
  cardRef?: RefCallback<HTMLButtonElement>
  semanticPosition?: Readonly<{ position: number; size: number }>
}) {
  const favorite = item.preferences?.favorite ?? false
  const createCompatibility = compatibilityFor(
    item,
    hasQuotationSource,
    "create"
  )
  return (
    <article
      aria-label={item.name}
      className={cn(
        "group/template overflow-hidden rounded-lg border bg-background transition-[border-color,box-shadow,transform] duration-150 motion-reduce:transition-none",
        "hover:border-foreground/25 active:translate-y-px",
        selected && "border-foreground/55 ring-1 ring-foreground/10",
        active && "shadow-[inset_3px_0_0_var(--foreground)]"
      )}
      data-template-card={identityKey(item)}
      style={cardContainmentStyle}
      onFocusCapture={onFocus}
    >
      <LibraryPreview
        descriptor={item.preview}
        label={`Select ${item.name}`}
        selected={selected}
        onSelect={onSelect}
      />
      <div className={cn("grid gap-2", compact ? "p-2.5" : "p-3")}>
        <div className="flex min-w-0 items-start gap-2">
          <button
            ref={cardRef}
            aria-label={`Show details for ${item.name}`}
            aria-posinset={semanticPosition?.position}
            aria-pressed={selected}
            aria-setsize={semanticPosition?.size}
            className="min-h-11 min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
            type="button"
            onClick={onSelect}
          >
            <span className="block truncate text-sm font-medium tracking-[-0.01em]">
              {item.name}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
              {dimensionLabel(item)} · {item.pageCount}{" "}
              {item.pageCount === 1 ? "page" : "pages"}
            </span>
          </button>
          <button
            aria-label={
              favoritePending
                ? `Saving favorite for ${item.name}`
                : `${favorite ? "Remove" : "Add"} ${item.name} ${favorite ? "from" : "to"} favorites`
            }
            aria-pressed={favorite}
            aria-busy={favoritePending || undefined}
            className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              favoritePending ||
              !item.permissions.canFavorite ||
              !onToggleFavorite
            }
            type="button"
            onClick={() => onToggleFavorite?.(!favorite)}
          >
            {favoritePending ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Heart
                aria-hidden="true"
                className={cn(
                  "size-4",
                  favorite && "fill-current text-foreground"
                )}
              />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Actions for ${item.name}`}
                className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/45"
                type="button"
              >
                <Ellipsis aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuGroup>
                <DropdownMenuItem className="min-h-11" onSelect={onInspect}>
                  Show details
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Collections</DropdownMenuLabel>
                {collectionOptions.map((collection) => {
                  const member =
                    item.preferences?.collectionIds.includes(collection.id) ??
                    false
                  const pending = collectionMutationPending(collection.id)
                  return (
                    <DropdownMenuCheckboxItem
                      checked={member}
                      className="min-h-11"
                      data-library-collection-toggle={collection.id}
                      disabled={pending || !item.permissions.canAddToCollection}
                      key={collection.id}
                      onSelect={() =>
                        onToggleCollection?.(collection.id, !member)
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {pending ? "Saving…" : collection.label}
                      </span>
                    </DropdownMenuCheckboxItem>
                  )
                })}
                <DropdownMenuItem
                  className="min-h-11"
                  data-library-new-collection="true"
                  disabled={!item.permissions.canAddToCollection}
                  onSelect={() => onNewCollection(item)}
                >
                  <FolderPlus aria-hidden="true" />
                  New collection
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-11"
                  data-library-manage-collections="true"
                  onSelect={onManageCollections}
                >
                  <Folders aria-hidden="true" />
                  Manage collections
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!createCompatibility.available ? (
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {createCompatibility.reason}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function TemplateDetails({
  item,
  variant,
  hasQuotationSource,
  actionsEnabled,
  pendingAction,
  actionError,
  detailState,
  onCreate,
  onApply,
  onRetryDetail,
}: {
  item: LibraryTemplateSummary
  variant: LibraryTemplateBrowserProps["variant"]
  hasQuotationSource: boolean
  actionsEnabled: boolean
  pendingAction: LibraryTemplateBrowserProps["pendingAction"]
  actionError: string | null
  detailState: LibraryDiscoveryDetailState
  onCreate: (intent: LibraryTemplateIntent) => void
  onApply?: (intent: LibraryTemplateIntent) => void
  onRetryDetail: () => void
}) {
  const readyDetail = detailState.status === "ready" ? detailState.detail : null
  const exactDetail: LibraryTemplateDetail | null =
    readyDetail &&
    isTemplateDetail(readyDetail) &&
    readyDetail.summary.id === item.id &&
    readyDetail.summary.version === item.version
      ? readyDetail
      : null
  const authoritativeItem: LibraryTemplateSummary = exactDetail?.summary ?? item
  const effectiveAuthoritativeItem: LibraryTemplateSummary = exactDetail
    ? { ...authoritativeItem, preferences: item.preferences }
    : authoritativeItem
  const intent = exactIdentity(effectiveAuthoritativeItem)
  const createCompatibility = exactDetail
    ? compatibilityFor(authoritativeItem, hasQuotationSource, "create")
    : { available: false, reason: null }
  const applyCompatibility = exactDetail
    ? compatibilityFor(authoritativeItem, hasQuotationSource, "apply")
    : { available: false, reason: null }
  const pending =
    pendingAction?.id === item.id && pendingAction.version === item.version
      ? pendingAction.action
      : null
  const reason =
    variant === "editor" && onApply
      ? (applyCompatibility.reason ?? createCompatibility.reason)
      : createCompatibility.reason
  const exactDetailFailure =
    detailState.status === "failed" &&
    detailState.itemKind === "template" &&
    detailState.id === item.id &&
    detailState.version === item.version
      ? detailState.failure
      : null
  return (
    <aside
      aria-label={`Details for ${item.name}`}
      className={cn(
        "border bg-background",
        variant === "start"
          ? "rounded-lg p-4 lg:sticky lg:top-4 lg:self-start"
          : "border-x-0 border-b-0 p-3"
      )}
      data-template-details={identityKey(item)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">
            {ownerLabel(effectiveAuthoritativeItem)} · version{" "}
            {effectiveAuthoritativeItem.version}
          </p>
          <h3 className="mt-1 text-base font-semibold tracking-[-0.02em]">
            {effectiveAuthoritativeItem.name}
          </h3>
        </div>
        {effectiveAuthoritativeItem.preferences?.favorite ? (
          <Heart aria-label="Favorite" className="size-4 fill-current" />
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {effectiveAuthoritativeItem.description}
      </p>
      {!exactDetail && !exactDetailFailure ? (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          Checking this exact version
        </p>
      ) : null}
      {exactDetailFailure ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-[11px]">
          <span>{exactDetailFailure.message}</span>
          <Button
            className="min-h-11 shrink-0"
            size="sm"
            type="button"
            variant="outline"
            onClick={onRetryDetail}
          >
            Retry details
          </Button>
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-y py-3 text-[11px]">
        <div>
          <dt className="text-muted-foreground">Format</dt>
          <dd className="mt-0.5 font-medium">
            {effectiveAuthoritativeItem.formatFamily}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pages</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {effectiveAuthoritativeItem.pageCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Size</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {dimensionLabel(effectiveAuthoritativeItem)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Orientation</dt>
          <dd className="mt-0.5 font-medium capitalize">
            {effectiveAuthoritativeItem.orientation}
          </dd>
        </div>
      </dl>
      {reason ? (
        <p className="mt-3 rounded-md bg-muted/65 p-2.5 text-[11px] leading-4 text-muted-foreground">
          {reason}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-xs leading-5 text-destructive">{actionError}</p>
      ) : null}
      <div className="mt-3 grid gap-2">
        <Button
          className="min-h-11 w-full"
          disabled={
            !exactDetail ||
            !actionsEnabled ||
            !createCompatibility.available ||
            !!pendingAction
          }
          type="button"
          onClick={() => onCreate(intent)}
        >
          {pending === "create" ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          Create from template
        </Button>
        {variant === "editor" && onApply ? (
          <Button
            className="min-h-11 w-full"
            disabled={
              !actionsEnabled ||
              !exactDetail ||
              !applyCompatibility.available ||
              !!pendingAction
            }
            type="button"
            variant="outline"
            onClick={() => onApply(intent)}
          >
            {pending === "apply" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <FileStack aria-hidden="true" />
            )}
            Apply to this document
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

function TemplateSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      aria-label="Loading design templates"
      className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}
    >
      {Array.from({ length: compact ? 3 : 6 }, (_, index) => (
        <div className="rounded-lg border p-2" key={index}>
          <Skeleton className="aspect-4/3 w-full motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-4 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-3 w-1/2 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function columnCountFor(width: number, variant: "start" | "editor") {
  if (variant === "editor") return width >= 420 ? 2 : 1
  if (width >= 1080) return 4
  if (width >= 760) return 3
  return 2
}

function useContainerColumns(variant: "start" | "editor") {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(() => columnCountFor(0, variant))
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = (width: number) =>
      setColumns((current) => {
        const next = columnCountFor(width, variant)
        return next === current ? current : next
      })
    update(host.getBoundingClientRect().width)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [variant])
  return { hostRef, columns }
}

const favoriteKey = (item: LibraryTemplateSummary) =>
  `favorite:${identityKey(item)}`

const snapshotFailureIdentity = (failure: LibraryPreferenceFailure | null) =>
  failure
    ? `${failure.key}:${failure.requestId ?? "no-request"}:${failure.message}`
    : null

type CollectionProps = Readonly<{
  items: readonly LibraryTemplateSummary[]
  variant: "start" | "editor"
  selectedKey: string | null
  focusIdentity: string | null
  forceFocusIdentity: boolean
  activeTemplate: LibraryTemplateBrowserProps["activeTemplate"]
  hasQuotationSource: boolean
  onSelect: (item: LibraryTemplateSummary) => void
  onToggleFavorite?: LibraryTemplateBrowserProps["onToggleFavorite"]
  collectionOptions: readonly LibraryTemplateFilterOption[]
  onToggleCollection: (
    item: LibraryTemplateSummary,
    collectionId: string,
    member: boolean
  ) => void
  onNewCollection: (item: LibraryTemplateSummary) => void
  onManageCollections: () => void
  preferenceState: LibraryPreferenceStateOwner
  onCardFocus: (identity: string, index: number) => void
  onCollectionFocusLeave: () => void
  onFocusIntentHandled: () => void
  renderSelectedDetails?: (item: LibraryTemplateSummary) => ReactNode
}>

function TemplateCollection({
  items,
  variant,
  selectedKey,
  focusIdentity,
  forceFocusIdentity,
  activeTemplate,
  hasQuotationSource,
  onSelect,
  onToggleFavorite,
  collectionOptions,
  onToggleCollection,
  onNewCollection,
  onManageCollections,
  preferenceState,
  onCardFocus,
  onCollectionFocusLeave,
  onFocusIntentHandled,
  renderSelectedDetails,
}: CollectionProps) {
  const compact = variant === "editor"
  const { hostRef, columns } = useContainerColumns(variant)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = selectedKey
    ? items.findIndex((item) => identityKey(item) === selectedKey)
    : -1
  const focusIndex = focusIdentity
    ? items.findIndex((item) => identityKey(item) === focusIdentity)
    : -1
  const rowCount = Math.ceil(items.length / columns)
  const virtualized = items.length > LIBRARY_TEMPLATE_VIRTUALIZATION_THRESHOLD
  const selectedRow =
    selectedIndex < 0 ? -1 : Math.floor(selectedIndex / columns)
  const focusRow = focusIndex < 0 ? -1 : Math.floor(focusIndex / columns)
  const virtualizer = useVirtualizer({
    count: virtualized ? rowCount : 0,
    estimateSize: () => (compact ? 260 : 300),
    getScrollElement: () => scrollRef.current,
    getItemKey: (rowIndex) => {
      const first = items[rowIndex * columns]
      return first ? `${identityKey(first)}:${columns}` : rowIndex
    },
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range))
      if (selectedRow >= 0) indexes.add(selectedRow)
      if (focusRow >= 0) indexes.add(focusRow)
      return [...indexes].sort((left, right) => left - right)
    },
    useFlushSync: false,
  })
  const virtualRows = virtualizer.getVirtualItems()

  const registerCard = useCallback(
    (key: string): RefCallback<HTMLButtonElement> =>
      (node) => {
        if (node) cardRefs.current.set(key, node)
        else cardRefs.current.delete(key)
      },
    []
  )

  useEffect(() => {
    if (!focusIdentity || focusIndex < 0) return
    if (
      !forceFocusIdentity &&
      hostRef.current?.contains(document.activeElement)
    )
      return
    if (virtualized) virtualizer.scrollToIndex(focusRow, { align: "auto" })
    const frame = requestAnimationFrame(() => {
      const node = cardRefs.current.get(focusIdentity)
      if (!node) return
      node.focus()
      onFocusIntentHandled()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    focusIdentity,
    focusIndex,
    focusRow,
    forceFocusIdentity,
    onFocusIntentHandled,
    virtualized,
    virtualRows,
    virtualizer,
  ])

  const renderItem = (item: LibraryTemplateSummary, index: number) => {
    const key = identityKey(item)
    const selected = selectedKey === key
    return (
      <>
        <TemplateCard
          active={
            activeTemplate?.id === item.id &&
            activeTemplate.version === item.version
          }
          cardRef={registerCard(key)}
          compact={compact}
          hasQuotationSource={hasQuotationSource}
          item={item}
          key={key}
          selected={selected}
          collectionOptions={collectionOptions}
          collectionMutationPending={(collectionId) =>
            preferenceState.pending.has(
              `collection:${collectionId}:add:${key}`
            ) ||
            preferenceState.pending.has(
              `collection:${collectionId}:remove:${key}`
            )
          }
          favoritePending={preferenceState.pending.has(favoriteKey(item))}
          semanticPosition={{ position: index + 1, size: items.length }}
          onInspect={() => onSelect(item)}
          onManageCollections={onManageCollections}
          onNewCollection={onNewCollection}
          onFocus={() => onCardFocus(key, index)}
          onSelect={() => onSelect(item)}
          onToggleFavorite={
            onToggleFavorite
              ? (favorite) => onToggleFavorite(exactIdentity(item), favorite)
              : undefined
          }
          onToggleCollection={(collectionId, member) =>
            onToggleCollection(item, collectionId, member)
          }
        />
        {selected ? renderSelectedDetails?.(item) : null}
      </>
    )
  }

  return (
    <div
      ref={hostRef}
      className="min-w-0"
      data-library-grid-host="true"
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        )
          return
        onCollectionFocusLeave()
      }}
    >
      {virtualized ? (
        <div
          ref={scrollRef}
          className={cn(
            "overflow-y-auto overscroll-contain pr-1",
            compact ? "max-h-[34rem]" : "max-h-[52rem]"
          )}
          data-library-virtualized="true"
          tabIndex={-1}
        >
          <div
            aria-label="Design templates"
            className="relative w-full"
            role="list"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualRows.map((virtualRow) => {
              const start = virtualRow.index * columns
              const rowItems = items.slice(start, start + columns)
              return (
                <div
                  className="absolute top-0 left-0 grid w-full gap-3 pb-3"
                  data-index={virtualRow.index}
                  data-library-virtual-row={virtualRow.index}
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rowItems.map((item, offset) => (
                    <div
                      aria-posinset={start + offset + 1}
                      aria-setsize={items.length}
                      key={identityKey(item)}
                      role="listitem"
                    >
                      {renderItem(item, start + offset)}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <ul
          aria-label="Design templates"
          className="grid gap-3"
          data-library-semantic-list="true"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {items.map((item, index) => (
            <li className="min-w-0" key={identityKey(item)}>
              {renderItem(item, index)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LibraryTemplateBrowser(props: LibraryTemplateBrowserProps) {
  const visible = props.visible ?? true
  useLibraryDiscoveryLease(visible)
  return visible ? <LibraryTemplateBrowserContent {...props} visible /> : null
}

function LibraryTemplateBrowserContent({
  variant,
  density = variant === "editor" ? "compact" : "comfortable",
  visible = true,
  hasQuotationSource,
  actionsEnabled = true,
  activeTemplate = null,
  pendingAction = null,
  actionError = null,
  collectionOptions,
  onCreate,
  onApply,
  onToggleFavorite,
}: LibraryTemplateBrowserProps) {
  const { state, commands } = useLibraryDiscovery()
  const { state: preferenceState, commands: preferenceCommands } =
    useLibraryPreferences()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false)
  const [collectionDialogRequest, setCollectionDialogRequest] =
    useState<LibraryCollectionDialogRequest>({
      key: 0,
      mode: "manage",
      collectionId: null,
      pendingMember: null,
    })
  const [dismissedSnapshotFailure, setDismissedSnapshotFailure] = useState<
    string | null
  >(null)
  const [focusedCard, setFocusedCard] = useState<{
    identity: string
    index: number
  } | null>(null)
  const [, requestResultsFocus] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const loadMoreRef = useRef<HTMLButtonElement | null>(null)
  const paginationStatusRef = useRef<HTMLParagraphElement | null>(null)
  const resultsFocusRequestedRef = useRef(false)

  useEffect(() => {
    if (!visible) return
    if (
      state.filters.itemKinds.length === 1 &&
      state.filters.itemKinds[0] === "template"
    )
      return
    commands.setFilters({ itemKinds: ["template"] })
  }, [commands, state.filters.itemKinds, visible])

  const page = state.confirmedPage ?? state.retainedPage
  const discoveredItems = useMemo(
    () => page?.items.filter(isTemplate) ?? [],
    [page]
  )
  const items = useMemo(
    () =>
      projectLibraryTemplatePreferences({
        items: discoveredItems,
        preferenceState,
        discoveryWorkspaceRevision: page?.workspaceRevision ?? 0,
      }),
    [discoveredItems, page?.workspaceRevision, preferenceState]
  )
  const effectiveCollectionOptions = useMemo(
    () => collectionOptions ?? projectLibraryCollectionOptions(preferenceState),
    [collectionOptions, preferenceState]
  )
  useEffect(() => {
    const collectionId = state.filters.collectionId
    if (
      collectionId === null ||
      preferenceState.snapshotStatus !== "ready" ||
      effectiveCollectionOptions.some(({ id }) => id === collectionId)
    ) {
      return
    }
    commands.setFilters({ collectionId: null })
  }, [
    commands,
    effectiveCollectionOptions,
    preferenceState.snapshotStatus,
    state.filters.collectionId,
  ])
  const selectedItem = useMemo(
    () =>
      items.find((item) => identityKey(item) === selectedKey) ??
      items.find(
        (item) =>
          item.id === activeTemplate?.id &&
          item.version === activeTemplate.version
      ) ??
      items[0] ??
      null,
    [activeTemplate, items, selectedKey]
  )
  const effectiveSelectedKey = selectedItem ? identityKey(selectedItem) : null

  useEffect(() => {
    if (!focusedCard) return
    if (items.some((item) => identityKey(item) === focusedCard.identity)) return
    const successor = items[Math.min(focusedCard.index, items.length - 1)]
    if (successor) {
      setFocusedCard({
        identity: identityKey(successor),
        index: Math.min(focusedCard.index, items.length - 1),
      })
      return
    }
    setFocusedCard(null)
    searchRef.current?.focus()
  }, [focusedCard, items])

  useEffect(() => {
    if (!selectedItem || selectedKey === effectiveSelectedKey) return
    setSelectedKey(effectiveSelectedKey)
    void commands.selectItem("template", selectedItem.id, selectedItem.version)
  }, [commands, effectiveSelectedKey, selectedItem, selectedKey])

  const selectItem = useCallback(
    (item: LibraryTemplateSummary) => {
      const key = identityKey(item)
      setSelectedKey(key)
      void commands.selectItem("template", item.id, item.version)
    },
    [commands]
  )

  const toggleFavorite = useCallback(
    (intent: LibraryTemplateIntent, favorite: boolean) => {
      if (onToggleFavorite) {
        onToggleFavorite(intent, favorite)
        return
      }
      const item = items.find(
        (candidate) =>
          candidate.id === intent.id && candidate.version === intent.version
      )
      if (!item) return
      void preferenceCommands.setFavorite(intent, item.name, favorite)
    },
    [items, onToggleFavorite, preferenceCommands]
  )
  const effectiveToggleFavorite =
    onToggleFavorite || preferenceState.snapshot ? toggleFavorite : undefined

  const openCollections = useCallback(
    (
      mode: "manage" | "create",
      collectionId: string | null = null,
      pendingMember: LibraryCollectionDialogRequest["pendingMember"] = null
    ) => {
      setCollectionDialogRequest((current) => ({
        key: current.key + 1,
        mode,
        collectionId,
        pendingMember,
      }))
      setCollectionDialogOpen(true)
    },
    []
  )
  const toggleCollection = useCallback(
    (item: LibraryTemplateSummary, collectionId: string, member: boolean) => {
      if (!item.permissions.canAddToCollection) return
      if (member) {
        void preferenceCommands.addCollectionMember(
          collectionId,
          exactIdentity(item),
          item.name
        )
      } else {
        void preferenceCommands.removeCollectionMember(
          collectionId,
          exactIdentity(item),
          item.name
        )
      }
    },
    [preferenceCommands]
  )

  const updateFilters = useCallback(
    (patch: Partial<LibraryDiscoveryFilters>) => {
      resultsFocusRequestedRef.current = false
      commands.setFilters(patch)
    },
    [commands]
  )
  const updateOrder = useCallback(
    (order: LibraryDiscoveryState["order"]) => {
      resultsFocusRequestedRef.current = false
      commands.setOrder(order)
    },
    [commands]
  )
  const updateEntryPoint = useCallback(
    (entryPoint: LibraryDiscoveryEntryPoint) => {
      resultsFocusRequestedRef.current = false
      commands.setEntryPoint(entryPoint)
    },
    [commands]
  )

  const explicitFocusIdentity =
    state.focusIntent?.target === "item"
      ? (state.focusIntent.itemIdentity ?? effectiveSelectedKey)
      : resultsFocusRequestedRef.current &&
          !state.updatingResults &&
          !state.queryScheduled &&
          state.replacementStatus !== "loading"
        ? effectiveSelectedKey
        : null
  const focusIdentity = explicitFocusIdentity ?? focusedCard?.identity ?? null
  useEffect(() => {
    const intent = state.focusIntent
    if (!intent) return
    if (intent.target === "search") {
      searchRef.current?.focus()
      commands.clearFocusIntent(intent.id)
    } else if (intent.target === "load-more") {
      loadMoreRef.current?.focus()
      commands.clearFocusIntent(intent.id)
    } else if (intent.target === "pagination-status") {
      paginationStatusRef.current?.focus()
      commands.clearFocusIntent(intent.id)
    } else if (
      intent.target === "results" &&
      !resultsFocusRequestedRef.current
    ) {
      commands.clearFocusIntent(intent.id)
    }
  }, [commands, state.focusIntent])

  const initialLoading =
    !page && (state.replacementStatus === "loading" || state.queryScheduled)
  const initialFailure =
    !page && state.replacementStatus === "failed"
      ? state.replacementFailure
      : null
  const hasActiveCriteria =
    state.rawSearch.trim().length > 0 ||
    state.filters.categoryIds.length > 0 ||
    state.filters.useCaseIds.length > 0 ||
    state.filters.formatFamilies.length > 0 ||
    state.filters.orientations.length > 0 ||
    state.filters.ownerKinds.length > 0 ||
    state.filters.collectionId !== null ||
    state.entryPoint !== "featured" ||
    state.order !== "curated" ||
    state.appliedQuery.favoritesOnly ||
    state.appliedQuery.recentOnly
  const showAllTemplates = () => {
    resultsFocusRequestedRef.current = false
    commands.clearSearch()
    updateFilters({
      categoryIds: [],
      useCaseIds: [],
      formatFamilies: [],
      orientations: [],
      ownerKinds: [],
      collectionId: null,
    })
    updateOrder("curated")
    updateEntryPoint("featured")
    resultsFocusRequestedRef.current = true
  }
  const filterControls = (
    <BrowserFilters
      collectionOptions={effectiveCollectionOptions}
      state={state}
      onChange={updateFilters}
      onOrderChange={updateOrder}
    />
  )
  const updating = state.updatingResults || state.queryScheduled
  const selectedDetailFailure =
    state.detail.status === "failed" &&
    selectedItem?.id === state.detail.id &&
    selectedItem.version === state.detail.version
      ? state.detail.failure.message
      : null
  const snapshotFailureKey = snapshotFailureIdentity(
    preferenceState.snapshotFailure
  )
  const visibleSnapshotFailure =
    preferenceState.snapshotFailure &&
    snapshotFailureKey !== dismissedSnapshotFailure
      ? preferenceState.snapshotFailure
      : null
  const preferenceFailures = Array.from(preferenceState.failures.values())
  const liveErrors = [
    actionError,
    selectedDetailFailure,
    state.appendFailure?.message,
    state.replacementFailure?.message,
    visibleSnapshotFailure?.message,
    ...preferenceFailures.map(({ message }) => message),
  ].filter((message): message is string => Boolean(message))
  const controllerMessage =
    state.announcement?.message ??
    (initialLoading
      ? "Loading design templates."
      : updating
        ? "Updating results."
        : "")
  const liveMessage = Array.from(
    new Set([...liveErrors, controllerMessage].filter(Boolean))
  ).join(" ")
  const hasNarrowingCriteria =
    state.rawSearch.trim().length > 0 ||
    state.filters.categoryIds.length > 0 ||
    state.filters.useCaseIds.length > 0 ||
    state.filters.formatFamilies.length > 0 ||
    state.filters.orientations.length > 0 ||
    state.filters.ownerKinds.length > 0 ||
    state.filters.collectionId !== null
  const emptyCopy =
    !hasNarrowingCriteria && state.entryPoint === "favorites"
      ? {
          title: "No favorite templates yet",
          description:
            "Use the heart on a template to keep it easy to find here.",
        }
      : !hasNarrowingCriteria && state.entryPoint === "recent"
        ? {
            title: "No recently used templates",
            description:
              "Templates appear here after you create a document from them.",
          }
        : hasActiveCriteria
          ? {
              title: "No matching templates",
              description: "Try a different search or return to all templates.",
            }
          : {
              title: "No templates available",
              description:
                "Studio's template catalog is empty. You can still create a blank document or import existing work.",
            }

  return (
    <section
      aria-busy={updating || initialLoading || undefined}
      aria-labelledby={`library-template-heading-${variant}`}
      className={cn(
        "min-w-0 bg-background",
        variant === "editor" && "flex h-full min-h-0 flex-col",
        density === "compact" && "text-sm"
      )}
      data-library-template-browser={variant}
      onFocusCapture={(event) => {
        if ((event.target as Element).closest("[data-template-card]")) return
        setFocusedCard(null)
      }}
    >
      <div
        className={cn(
          "grid gap-3",
          variant === "start" ? "mb-4" : "shrink-0 border-b p-3"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {variant === "start" ? (
              <p className="text-xs font-medium text-muted-foreground">
                Use a complete visual system
              </p>
            ) : null}
            <h2
              className={cn(
                "font-semibold tracking-[-0.02em]",
                variant === "start" ? "mt-1 text-lg" : "text-sm"
              )}
              id={`library-template-heading-${variant}`}
            >
              {variant === "start" ? "Start from a template" : "Templates"}
            </h2>
          </div>
          {page ? (
            <Badge aria-label={`${page.total} templates`} variant="outline">
              {page.total}
            </Badge>
          ) : null}
        </div>

        <nav
          aria-label="Template collections"
          className={cn(
            "flex gap-1",
            variant === "editor"
              ? "items-center overflow-visible"
              : "overflow-x-auto pb-0.5"
          )}
        >
          {entryPoints.map((entry) => (
            <button
              aria-current={state.entryPoint === entry.id ? "page" : undefined}
              className={cn(
                "shrink-0 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/45",
                variant === "editor"
                  ? "h-8 rounded-[5px] px-1.5 text-[11px]"
                  : "min-h-11 rounded-md px-3 text-xs",
                state.entryPoint === entry.id
                  ? variant === "editor"
                    ? "bg-studio-accent/12 text-studio-accent hover:bg-studio-accent/16"
                    : "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              data-library-entry-point={entry.id}
              key={entry.id}
              type="button"
              onClick={() => updateEntryPoint(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          {variant === "editor" ? (
            <button
              aria-label="Manage template collections"
              className="grid size-8 shrink-0 place-items-center rounded-[5px] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-studio-accent/45"
              data-library-collections-trigger="true"
              title="Manage collections"
              type="button"
              onClick={() =>
                openCollections("manage", state.filters.collectionId)
              }
            >
              <Folders aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <button
              className="min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/45"
              data-library-collections-trigger="true"
              type="button"
              onClick={() =>
                openCollections("manage", state.filters.collectionId)
              }
            >
              Collections
            </button>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <InputGroup
            className={cn(
              "min-w-0 flex-1",
              variant === "editor" ? "h-8 rounded-[5px]" : "h-11"
            )}
          >
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              aria-label="Search design templates"
              name="template-search"
              placeholder="Search templates…"
              type="search"
              value={state.rawSearch}
              onChange={(event) => {
                resultsFocusRequestedRef.current = false
                commands.setRawSearch(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") commands.applySearch()
                if (event.key === "Escape" && state.rawSearch)
                  commands.clearSearch()
                if (event.key === "ArrowDown" && effectiveSelectedKey) {
                  event.preventDefault()
                  resultsFocusRequestedRef.current = true
                  requestResultsFocus((request) => request + 1)
                  commands.applySearch()
                }
              }}
            />
          </InputGroup>
          {variant === "editor" ? (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  aria-label="Filter templates"
                  className="size-8 shrink-0 rounded-[5px]"
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Filter aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent showCloseButton={false} side="right">
                <SheetHeader>
                  <SheetTitle>Template filters</SheetTitle>
                  <SheetDescription>
                    Narrow the catalog without changing the current document.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-4">
                  <BrowserFilters
                    compact
                    collectionOptions={effectiveCollectionOptions}
                    state={state}
                    onChange={updateFilters}
                    onOrderChange={updateOrder}
                  />
                </div>
                <SheetClose asChild>
                  <Button
                    aria-label="Close template filters"
                    className="absolute top-2 right-2 size-11"
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          ) : null}
        </div>
        {variant === "start" ? filterControls : null}
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {visibleSnapshotFailure || preferenceFailures.length > 0 ? (
        <div
          className={cn(
            "grid gap-2",
            variant === "editor" ? "shrink-0 border-b p-3" : "mb-4"
          )}
          data-library-preference-errors="true"
        >
          {visibleSnapshotFailure ? (
            <LibraryPreferenceFailureNotice
              failure={visibleSnapshotFailure}
              onDismiss={() => setDismissedSnapshotFailure(snapshotFailureKey)}
              onRetry={() => {
                setDismissedSnapshotFailure(null)
                void preferenceCommands.refresh()
              }}
            />
          ) : null}
          {preferenceFailures.map((failure) => (
            <LibraryPreferenceFailureNotice
              failure={failure}
              key={failure.key}
              onDismiss={() => preferenceCommands.dismissFailure(failure.key)}
              onRetry={() => void preferenceCommands.retry(failure.key)}
            />
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0",
          variant === "editor" ? "flex-1 overflow-y-auto" : ""
        )}
      >
        {updating && page ? (
          <div
            className={cn(
              "mb-3 flex min-h-11 items-center gap-2 rounded-md border bg-muted/35 px-3 text-xs text-muted-foreground",
              variant === "editor" && "mx-3 mt-3"
            )}
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Updating results
          </div>
        ) : null}
        {state.replacementFailure && page ? (
          <div
            className={cn(
              "mb-3 flex min-h-11 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 text-xs",
              variant === "editor" && "mx-3 mt-3"
            )}
          >
            <span>{state.replacementFailure.message}</span>
            <Button
              className="min-h-11 shrink-0"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void commands.retryReplacement()}
            >
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : null}
        {initialLoading ? (
          <div className={cn(variant === "editor" && "p-3")}>
            <TemplateSkeleton compact={variant === "editor"} />
          </div>
        ) : null}
        {initialFailure ? (
          <div
            className={cn(
              "grid min-h-56 place-items-center rounded-lg border border-dashed p-6 text-center",
              variant === "editor" && "m-3"
            )}
          >
            <div className="max-w-xs">
              <h3 className="text-sm font-semibold">
                Templates could not load
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {initialFailure.message}
              </p>
              <Button
                className="mt-4 min-h-11"
                type="button"
                variant="outline"
                onClick={() => void commands.retryReplacement()}
              >
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          </div>
        ) : null}
        {page && items.length === 0 && !updating ? (
          <div
            className={cn(
              "grid min-h-56 place-items-center rounded-lg border border-dashed p-6 text-center",
              variant === "editor" && "m-3"
            )}
          >
            <div className="max-w-xs">
              <FileStack
                aria-hidden="true"
                className="mx-auto size-5 text-muted-foreground"
              />
              <h3 className="mt-3 text-sm font-semibold">{emptyCopy.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {emptyCopy.description}
              </p>
              {hasActiveCriteria ? (
                <Button
                  className="mt-4 min-h-11"
                  type="button"
                  variant="outline"
                  onClick={showAllTemplates}
                >
                  Show all templates
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {page && items.length > 0 ? (
          <div
            className={cn(
              "grid min-w-0 gap-4",
              variant === "start" ? "lg:grid-cols-[minmax(0,1fr)_18rem]" : ""
            )}
          >
            <div className={cn("min-w-0", variant === "editor" && "p-3")}>
              <TemplateCollection
                activeTemplate={activeTemplate}
                focusIdentity={focusIdentity}
                forceFocusIdentity={Boolean(explicitFocusIdentity)}
                hasQuotationSource={hasQuotationSource}
                items={items}
                collectionOptions={effectiveCollectionOptions}
                preferenceState={preferenceState}
                selectedKey={effectiveSelectedKey}
                variant={variant}
                onCardFocus={(identity, index) => {
                  setFocusedCard({ identity, index })
                }}
                onCollectionFocusLeave={() => setFocusedCard(null)}
                onManageCollections={() => openCollections("manage")}
                onNewCollection={(item) =>
                  openCollections("create", null, {
                    identity: exactIdentity(item),
                    name: item.name,
                  })
                }
                onFocusIntentHandled={() => {
                  resultsFocusRequestedRef.current = false
                  const intent = state.focusIntent
                  if (intent) commands.clearFocusIntent(intent.id)
                }}
                renderSelectedDetails={
                  variant === "editor"
                    ? (item) => (
                        <TemplateDetails
                          actionError={actionError}
                          actionsEnabled={actionsEnabled}
                          detailState={state.detail}
                          hasQuotationSource={hasQuotationSource}
                          item={item}
                          pendingAction={pendingAction}
                          variant={variant}
                          onApply={onApply}
                          onCreate={onCreate}
                          onRetryDetail={() => void commands.retryDetail()}
                        />
                      )
                    : undefined
                }
                onSelect={selectItem}
                onToggleFavorite={effectiveToggleFavorite}
                onToggleCollection={toggleCollection}
              />
              <div className="mt-3 grid gap-2">
                {state.appendFailure ? (
                  <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 text-xs">
                    <span>{state.appendFailure.message}</span>
                    <Button
                      className="min-h-11 shrink-0"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => void commands.loadMore()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}
                {page.nextCursor ? (
                  <Button
                    ref={loadMoreRef}
                    className="min-h-11 w-full"
                    disabled={state.appendStatus === "loading"}
                    type="button"
                    variant="outline"
                    onClick={() => void commands.loadMore()}
                  >
                    {state.appendStatus === "loading" ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <ChevronRight aria-hidden="true" />
                    )}
                    Load more templates
                  </Button>
                ) : (
                  <p
                    ref={paginationStatusRef}
                    className="min-h-11 rounded-md px-3 py-3 text-center text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
                    tabIndex={-1}
                  >
                    All {page.total} templates loaded
                  </p>
                )}
              </div>
            </div>
            {selectedItem && variant === "start" ? (
              <TemplateDetails
                actionError={actionError}
                actionsEnabled={actionsEnabled}
                detailState={state.detail}
                hasQuotationSource={hasQuotationSource}
                item={selectedItem}
                pendingAction={pendingAction}
                variant={variant}
                onApply={onApply}
                onCreate={onCreate}
                onRetryDetail={() => void commands.retryDetail()}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <LibraryCollectionBrowserDialog
        open={collectionDialogOpen}
        request={collectionDialogRequest}
        onFilterCollection={(collectionId) => {
          updateFilters({ collectionId })
          resultsFocusRequestedRef.current = true
        }}
        onOpenChange={setCollectionDialogOpen}
      />
    </section>
  )
}
