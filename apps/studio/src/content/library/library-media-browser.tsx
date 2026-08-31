import {
  Ellipsis,
  Filter,
  Heart,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
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
import type { KeyboardEvent, ReactNode } from "react"
import { libraryMediaDetailSchema } from "@webmcp/document"
import type {
  LibraryItemIdentity,
  LibraryMediaDetail,
  LibraryMediaSummary,
} from "@webmcp/document"
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@webmcp/ui/components/sheet"
import { Skeleton } from "@webmcp/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"
import {
  LibraryCollectionBrowserDialog,
  LibraryPreferenceFailureNotice,
} from "./library-collection-browser"
import type { LibraryCollectionDialogRequest } from "./library-collection-browser"
import { LibraryMediaCollection } from "./library-media-collection"
import type { LibraryMediaCollectionCardRenderProps } from "./library-media-collection"
import {
  useLibraryMediaDiscovery,
  useLibraryMediaDiscoveryLease,
} from "./library-media-discovery-provider"
import { libraryMediaUiIdentity } from "./library-media-discovery"
import { LibraryMediaPreview } from "./library-media-preview"
import {
  projectLibraryCollectionOptions,
  projectLibraryMediaPreferences,
} from "./library-preference-projection"
import { useLibraryPreferences } from "./library-preference-provider"

export type LibraryMediaScope =
  | Readonly<{ kind: "recent" }>
  | Readonly<{ kind: "uploads" }>
  | Readonly<{ kind: "library" }>
  | Readonly<{ kind: "favorites" }>
  | Readonly<{
      kind: "collection"
      collectionId: string
      label: string
    }>

export type LibraryMediaIntent = Readonly<{
  itemKind: "media"
  id: string
  version: number
  mediaSource: "curated" | "managed" | "local"
  detail: LibraryMediaDetail
  selectionIdentity: LibraryMediaDetail["selectionIdentity"]
}>

export type LibraryMediaBrowserProps = Readonly<{
  visible?: boolean
  density?: "comfortable" | "compact"
  scope: LibraryMediaScope
  action: "insert" | "replace" | "assign_field"
  targetName?: string
  actionsEnabled?: boolean
  pendingIdentity?: string | null
  actionError?: string | null
  onScopeChange: (scope: LibraryMediaScope) => void
  onSelect: (intent: LibraryMediaIntent) => void
}>

type ScopeCriteria = Readonly<{
  entryPoint: "featured" | "all" | "recent" | "favorites"
  ownerKinds: readonly ("studio" | "workspace")[]
  collectionId: string | null
  label: string
}>

export const libraryMediaScopeCriteria = (
  scope: LibraryMediaScope
): ScopeCriteria => {
  switch (scope.kind) {
    case "recent":
      return {
        entryPoint: "recent",
        ownerKinds: [],
        collectionId: null,
        label: "Recently used",
      }
    case "uploads":
      return {
        entryPoint: "all",
        ownerKinds: ["workspace"],
        collectionId: null,
        label: "Workspace uploads",
      }
    case "library":
      return {
        entryPoint: "featured",
        ownerKinds: ["studio"],
        collectionId: null,
        label: "Studio library",
      }
    case "favorites":
      return {
        entryPoint: "favorites",
        ownerKinds: [],
        collectionId: null,
        label: "Favorites",
      }
    case "collection":
      return {
        entryPoint: "all",
        ownerKinds: [],
        collectionId: scope.collectionId,
        label: scope.label,
      }
  }
}

const scopeValue = (scope: LibraryMediaScope) =>
  scope.kind === "collection" ? `collection:${scope.collectionId}` : scope.kind

const mediaIdentity = (item: LibraryMediaSummary): LibraryItemIdentity => ({
  itemKind: "media",
  id: item.id,
  version: item.version,
  mediaSource: item.mediaSource,
})

const sourceLabel = (item: LibraryMediaSummary) => {
  if (item.mediaSource === "curated") return "Studio library"
  if (item.mediaSource === "managed") return "Workspace upload"
  return "On this device"
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const exactDetailMatches = (
  detail: LibraryMediaDetail,
  item: LibraryMediaSummary
) => {
  const selectionVersion =
    detail.selectionIdentity.source === "curated"
      ? detail.selectionIdentity.version
      : detail.selectionIdentity.source === "managed"
        ? detail.selectionIdentity.catalogVersion
        : detail.selectionIdentity.revision
  return (
    detail.summary.id === item.id &&
    detail.summary.version === item.version &&
    detail.summary.mediaSource === item.mediaSource &&
    detail.selectionIdentity.source === item.mediaSource &&
    detail.selectionIdentity.assetId === item.id &&
    selectionVersion === item.version
  )
}

const immutable = <TValue,>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const intentFrom = (detailInput: LibraryMediaDetail): LibraryMediaIntent => {
  const detail = immutable(
    libraryMediaDetailSchema.parse(structuredClone(detailInput))
  )
  return Object.freeze({
    itemKind: "media",
    id: detail.summary.id,
    version: detail.summary.version,
    mediaSource: detail.summary.mediaSource,
    detail,
    selectionIdentity: detail.selectionIdentity,
  })
}

const actionVerb = (action: LibraryMediaBrowserProps["action"]) =>
  action === "insert" ? "Insert" : action === "replace" ? "Replace" : "Assign"

const actionLabel = (
  item: LibraryMediaSummary,
  action: LibraryMediaBrowserProps["action"],
  targetName?: string
) => {
  const quotedItem = `“${item.name}”`
  const from = `from ${sourceLabel(item)}`
  if (action === "replace" && targetName) {
    return `Replace “${targetName}” with ${quotedItem} ${from}`
  }
  if (action === "assign_field" && targetName) {
    return `Assign ${quotedItem} ${from} to “${targetName}”`
  }
  return `${actionVerb(action)} ${quotedItem} ${from}`
}

const snapshotFailureIdentity = (
  failure: ReturnType<typeof useLibraryPreferences>["state"]["snapshotFailure"]
) =>
  failure
    ? `${failure.key}:${failure.requestId ?? "no-request"}:${failure.message}`
    : null

const localHealthMessage = (
  status:
    | NonNullable<
        ReturnType<
          typeof useLibraryMediaDiscovery
        >["composition"]["local"]["result"]
      >["status"]
    | undefined
) => {
  if (!status) return null
  const messages: string[] = []
  if (status.migrationState !== "current") {
    messages.push("Local media storage needs attention")
  }
  if (status.truncated) messages.push("Only part of local media was scanned")
  if (status.unindexedMetadataCount > 0) {
    messages.push(
      `${status.unindexedMetadataCount} local items are not indexed`
    )
  }
  if (status.unavailableRecordCount > 0) {
    messages.push(
      `${status.unavailableRecordCount} local items are unavailable`
    )
  }
  if (status.archivedRecordCount > 0) {
    messages.push(
      `${status.archivedRecordCount} archived local items were omitted`
    )
  }
  if (status.issues.length > 0) {
    messages.push(`${status.issues.length} local media issues were found`)
  }
  return messages.length > 0 ? messages.join(". ") : null
}

const selectClassName =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/45"

type ExactFailure = Readonly<{
  message: string
  requestId: string | null
}>

function ScopeFilters({ onClose }: { onClose?: () => void }) {
  const { state, commands } = useLibraryMediaDiscovery()
  const setSingle = (
    key: "categoryIds" | "useCaseIds" | "formatFamilies" | "orientations",
    value: string
  ) => commands.setFilters({ [key]: value ? [value] : [] })
  return (
    <div className="grid gap-4 px-4 pb-4">
      <label className="grid gap-1.5 text-xs font-medium">
        Category
        <select
          className={selectClassName}
          value={state.filters.categoryIds[0] ?? ""}
          onChange={(event) => setSingle("categoryIds", event.target.value)}
        >
          <option value="">All categories</option>
          {state.taxonomy.categories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        Use case
        <select
          className={selectClassName}
          value={state.filters.useCaseIds[0] ?? ""}
          onChange={(event) => setSingle("useCaseIds", event.target.value)}
        >
          <option value="">All use cases</option>
          {state.taxonomy.useCases.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        Format
        <select
          className={selectClassName}
          value={state.filters.formatFamilies[0] ?? ""}
          onChange={(event) => setSingle("formatFamilies", event.target.value)}
        >
          <option value="">All formats</option>
          {state.taxonomy.formatFamilies.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        Orientation
        <select
          className={selectClassName}
          value={state.filters.orientations[0] ?? ""}
          onChange={(event) => setSingle("orientations", event.target.value)}
        >
          <option value="">All orientations</option>
          {state.taxonomy.orientations.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        Order
        <select
          className={selectClassName}
          value={state.order}
          onChange={(event) =>
            commands.setOrder(
              event.target.value as "curated" | "recent" | "newest"
            )
          }
        >
          <option value="curated">Curated</option>
          <option value="recent">Recently used</option>
          <option value="newest">Newest</option>
        </select>
      </label>
      <Button
        className="min-h-11"
        type="button"
        variant="outline"
        onClick={() => {
          commands.setFilters({
            categoryIds: [],
            useCaseIds: [],
            formatFamilies: [],
            orientations: [],
          })
          commands.setOrder("curated")
          onClose?.()
        }}
      >
        Clear filters
      </Button>
    </div>
  )
}

type MediaCardProps = LibraryMediaCollectionCardRenderProps &
  Readonly<{
    action: LibraryMediaBrowserProps["action"]
    targetName?: string
    actionsEnabled: boolean
    pending: boolean
    checking: boolean
    checkFailure: ExactFailure | null
    collectionOptions: readonly Readonly<{ id: string; label: string }>[]
    preferencePending: ReadonlyMap<string, unknown>
    visibilityRoot: Element | null
    ownershipKey: string
    loadLocalPreview: ReturnType<
      typeof useLibraryMediaDiscovery
    >["localCommands"]["loadPreview"]
    onPrimary: (item: LibraryMediaSummary) => void
    onInspect: (item: LibraryMediaSummary, opener: HTMLButtonElement) => void
    onToggleFavorite: (item: LibraryMediaSummary, favorite: boolean) => void
    onToggleCollection: (
      item: LibraryMediaSummary,
      collectionId: string,
      member: boolean
    ) => void
    onNewCollection: (item: LibraryMediaSummary) => void
    onManageCollections: () => void
  }>

function MediaCard({
  item,
  identity,
  selected,
  cardRef,
  onFocus,
  action,
  targetName,
  actionsEnabled,
  pending,
  checking,
  checkFailure,
  collectionOptions,
  preferencePending,
  visibilityRoot,
  ownershipKey,
  loadLocalPreview,
  onPrimary,
  onInspect,
  onToggleFavorite,
  onToggleCollection,
  onNewCollection,
  onManageCollections,
}: MediaCardProps) {
  const overflowRef = useRef<HTMLButtonElement | null>(null)
  const favorite = item.preferences?.favorite ?? false
  const available =
    actionsEnabled &&
    item.selectable &&
    item.compatibility.supportedActions.includes(action)
  const favoriteKey = `favorite:media:${item.id}@${item.version}`
  const favoritePending = preferencePending.has(favoriteKey)
  const busy = pending || checking

  return (
    <article
      aria-label={item.name}
      className={cn(
        "group/media relative overflow-hidden rounded-lg border bg-background transition-[border-color,box-shadow,transform] duration-150 motion-reduce:transition-none",
        "hover:border-foreground/25 active:translate-y-px",
        selected && "border-foreground/55 ring-1 ring-foreground/10"
      )}
      data-media-card={identity}
      onFocusCapture={onFocus}
    >
      <button
        ref={cardRef}
        aria-busy={busy || undefined}
        aria-label={
          checkFailure
            ? `Retry exact version for “${item.name}” from ${sourceLabel(item)}`
            : actionLabel(item, action, targetName)
        }
        aria-pressed={selected}
        className="block w-full min-w-0 rounded-t-lg p-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-55"
        disabled={!available || busy}
        type="button"
        onClick={() => onPrimary(item)}
      >
        <LibraryMediaPreview
          className="bg-[linear-gradient(45deg,rgba(24,24,27,0.035)_25%,transparent_25%,transparent_75%,rgba(24,24,27,0.035)_75%),linear-gradient(45deg,rgba(24,24,27,0.035)_25%,transparent_25%,transparent_75%,rgba(24,24,27,0.035)_75%)] bg-size-[12px_12px] bg-position-[0_0,6px_6px]"
          item={item}
          loadLocalPreview={loadLocalPreview}
          ownershipKey={ownershipKey}
          visibilityRoot={visibilityRoot}
        />
        <span className="mt-2.5 block truncate text-sm font-medium tracking-[-0.01em]">
          {item.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
          {item.dimensions.width} × {item.dimensions.height} ·{" "}
          {formatBytes(item.bytes)}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {busy
            ? "Checking exact version…"
            : checkFailure
              ? "Retry exact version"
              : sourceLabel(item)}
        </span>
      </button>
      <div className="flex min-h-11 items-center justify-end gap-0.5 border-t px-1.5">
        {checkFailure ? (
          <span
            className="mr-auto min-w-0 truncate px-1 text-[11px] text-destructive"
            title={checkFailure.message}
          >
            {checkFailure.message}
            {checkFailure.requestId
              ? ` · Request ID: ${checkFailure.requestId}`
              : null}
          </span>
        ) : !available && item.compatibility.reason ? (
          <span className="mr-auto truncate px-1 text-[11px] text-muted-foreground">
            {item.compatibility.reason}
          </span>
        ) : (
          <span className="mr-auto truncate px-1 text-[11px] text-muted-foreground">
            {sourceLabel(item)}
          </span>
        )}
        {item.permissions.canFavorite ? (
          <button
            aria-busy={favoritePending || undefined}
            aria-label={`${favorite ? "Remove" : "Add"} ${item.name} ${favorite ? "from" : "to"} favorites`}
            aria-pressed={favorite}
            className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/45 disabled:opacity-45"
            disabled={favoritePending}
            type="button"
            onClick={() => onToggleFavorite(item, !favorite)}
          >
            {favoritePending ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Heart
                aria-hidden="true"
                className={cn(favorite && "fill-current text-foreground")}
              />
            )}
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={overflowRef}
              aria-label={`Actions for ${item.name}`}
              className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/45"
              type="button"
            >
              <Ellipsis aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() => {
                const opener = overflowRef.current
                if (opener) onInspect(item, opener)
              }}
            >
              Details
            </DropdownMenuItem>
            {item.mediaSource === "local" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Stored on this device</DropdownMenuLabel>
              </>
            ) : item.permissions.canAddToCollection ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Collections</DropdownMenuLabel>
                  {collectionOptions.map((collection) => {
                    const member =
                      item.preferences?.collectionIds.includes(collection.id) ??
                      false
                    const mutation = member ? "remove" : "add"
                    const mutationKey = `collection:${collection.id}:${mutation}:media:${item.id}@${item.version}`
                    return (
                      <DropdownMenuCheckboxItem
                        checked={member}
                        className="min-h-11"
                        data-library-media-collection={collection.id}
                        disabled={preferencePending.has(mutationKey)}
                        key={collection.id}
                        onCheckedChange={(checked) =>
                          onToggleCollection(
                            item,
                            collection.id,
                            checked === true
                          )
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {collection.label}
                        </span>
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => onNewCollection(item)}
                  >
                    New collection…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={onManageCollections}
                  >
                    Manage collections…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

type DetailsState = Readonly<{
  item: LibraryMediaSummary
  status: "loading" | "ready" | "failed"
  detail: LibraryMediaDetail | null
  failure: ExactFailure | null
  actionStatus: "idle" | "checking" | "failed"
  actionFailure: ExactFailure | null
}>

function MediaDetails({
  state,
  action,
  targetName,
  actionsEnabled,
  pending,
  ownershipKey,
  loadLocalPreview,
  collectionOptions,
  onOpenChange,
  onRetry,
  onSelect,
}: Readonly<{
  state: DetailsState | null
  action: LibraryMediaBrowserProps["action"]
  targetName?: string
  actionsEnabled: boolean
  pending: boolean
  ownershipKey: string
  loadLocalPreview: ReturnType<
    typeof useLibraryMediaDiscovery
  >["localCommands"]["loadPreview"]
  collectionOptions: readonly Readonly<{ id: string; label: string }>[]
  onOpenChange: (open: boolean) => void
  onRetry: () => void
  onSelect: (item: LibraryMediaSummary) => void
}>) {
  const retainedItem = state?.item ?? null
  const detail = state?.detail ?? null
  const item = detail?.summary ?? retainedItem
  const projectedPreferences = retainedItem?.preferences ?? null
  const collectionLabels = collectionOptions
    .filter(({ id }) => projectedPreferences?.collectionIds.includes(id))
    .map(({ label }) => label)
  return (
    <Sheet open={state !== null} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full max-w-full gap-0 overflow-hidden sm:max-w-md"
        data-media-details="true"
        showCloseButton={false}
        side="right"
      >
        {item ? (
          <>
            <SheetHeader className="shrink-0 border-b pr-14">
              <SheetTitle className="truncate">{item.name}</SheetTitle>
              <SheetDescription>
                {sourceLabel(item)} ·{" "}
                {detail?.selectionIdentity.source === "local"
                  ? `local revision ${detail.selectionIdentity.revision}`
                  : `version ${item.version}`}
              </SheetDescription>
            </SheetHeader>
            <SheetClose asChild>
              <Button
                aria-label="Close media details"
                className="absolute top-2 right-2 size-11"
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain p-4">
              <LibraryMediaPreview
                item={item}
                loadLocalPreview={loadLocalPreview}
                ownershipKey={`${ownershipKey}:details`}
                visibilityRoot={null}
              />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Dimensions</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {item.dimensions.width} × {item.dimensions.height}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {formatBytes(item.bytes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="mt-0.5 font-medium">{item.mimeType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="mt-0.5 font-medium">
                    {item.provenance.sourceUrl ? (
                      <a
                        className="inline-flex min-h-11 items-center underline underline-offset-2"
                        href={item.provenance.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.provenance.sourceName}
                      </a>
                    ) : (
                      item.provenance.sourceName
                    )}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">License</dt>
                  <dd className="mt-0.5 font-medium">
                    {item.provenance.license.url ? (
                      <a
                        className="inline-flex min-h-11 items-center underline underline-offset-2"
                        href={item.provenance.license.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.provenance.license.name}
                      </a>
                    ) : (
                      item.provenance.license.name
                    )}
                  </dd>
                </div>
              </dl>
              <div>
                <h3 className="text-xs font-medium">About</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.description}
                </p>
              </div>
              {item.provenance.attribution.required ? (
                <div className="rounded-lg border bg-muted/35 p-3 text-xs">
                  <p className="font-medium">Attribution required</p>
                  <p className="mt-1 text-muted-foreground">
                    {item.provenance.attribution.text}
                  </p>
                </div>
              ) : null}
              {item.permissions.canFavorite ? (
                <div className="rounded-lg border bg-muted/20 p-3 text-xs">
                  <p className="font-medium">Favorite</p>
                  <p className="mt-1 text-muted-foreground">
                    {projectedPreferences?.favorite
                      ? "Saved to favorites"
                      : "Not in favorites"}
                  </p>
                </div>
              ) : null}
              {item.permissions.canAddToCollection ? (
                <div className="rounded-lg border bg-muted/20 p-3 text-xs">
                  <p className="font-medium">Collections</p>
                  <p className="mt-1 text-muted-foreground">
                    {collectionLabels.length > 0
                      ? collectionLabels.join(", ")
                      : "Not in a collection"}
                  </p>
                </div>
              ) : null}
              {state?.status === "loading" ? (
                <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                  Checking exact version
                </div>
              ) : null}
              {state?.status === "failed" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                  <p>{state.failure?.message}</p>
                  {state.failure?.requestId ? (
                    <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                      Request ID: {state.failure.requestId}
                    </p>
                  ) : null}
                  <Button
                    className="mt-3 min-h-11"
                    type="button"
                    variant="outline"
                    onClick={onRetry}
                  >
                    <RefreshCw aria-hidden="true" />
                    Retry details
                  </Button>
                </div>
              ) : null}
              {state?.actionStatus === "failed" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                  <p>{state.actionFailure?.message}</p>
                  {state.actionFailure?.requestId ? (
                    <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                      Request ID: {state.actionFailure.requestId}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <SheetFooter className="shrink-0 border-t">
              <Button
                className="min-h-11 w-full"
                disabled={
                  !actionsEnabled ||
                  pending ||
                  !detail ||
                  state?.actionStatus === "checking" ||
                  !item.selectable ||
                  !item.compatibility.supportedActions.includes(action)
                }
                type="button"
                onClick={() => onSelect(item)}
              >
                {pending
                  ? "Working…"
                  : state?.actionStatus === "checking"
                    ? "Checking exact version…"
                    : state?.actionStatus === "failed"
                      ? "Retry exact version"
                      : actionLabel(item, action, targetName)}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function MediaSkeleton() {
  return (
    <div
      aria-label="Loading media"
      className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 min-[620px]:grid-cols-3 min-[860px]:grid-cols-4"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div className="rounded-lg border p-2" key={index}>
          <Skeleton className="aspect-4/3 w-full motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-4 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-3 w-1/2 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function StatusNotice({
  children,
  destructive = false,
  action,
}: {
  children: ReactNode
  destructive?: boolean
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-xs",
        destructive
          ? "border-destructive/30 bg-destructive/5"
          : "bg-muted/35 text-muted-foreground"
      )}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  )
}

export function LibraryMediaBrowser(props: LibraryMediaBrowserProps) {
  const visible = props.visible ?? true
  return visible ? <LibraryMediaBrowserPrepared {...props} visible /> : null
}

function LibraryMediaBrowserPrepared({
  visible = true,
  ...props
}: LibraryMediaBrowserProps) {
  const { state, commands } = useLibraryMediaDiscovery()
  const criteria = useMemo(
    () => libraryMediaScopeCriteria(props.scope),
    [props.scope]
  )

  useLayoutEffect(() => {
    commands.setScope({
      entryPoint: criteria.entryPoint,
      ownerKinds: criteria.ownerKinds,
      collectionId: criteria.collectionId,
    })
  }, [
    commands,
    criteria.collectionId,
    criteria.entryPoint,
    criteria.ownerKinds,
  ])
  useLibraryMediaDiscoveryLease(visible)

  const scopePrepared =
    state.entryPoint === criteria.entryPoint &&
    state.filters.collectionId === criteria.collectionId &&
    state.filters.ownerKinds.length === criteria.ownerKinds.length &&
    state.filters.ownerKinds.every(
      (owner, index) => owner === criteria.ownerKinds[index]
    )

  return scopePrepared ? (
    <LibraryMediaBrowserContent {...props} visible />
  ) : (
    <section
      aria-busy="true"
      aria-label="Preparing media library"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-library-media-browser="preparing"
    />
  )
}

function LibraryMediaBrowserContent({
  density = "compact",
  scope,
  action,
  targetName,
  actionsEnabled = true,
  pendingIdentity = null,
  actionError = null,
  onScopeChange,
  onSelect,
}: LibraryMediaBrowserProps) {
  const { state, localState, composition, commands, localCommands } =
    useLibraryMediaDiscovery()
  const { state: preferenceState, commands: preferenceCommands } =
    useLibraryPreferences()
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null
  )
  const getScrollElement = useCallback(() => scrollElement, [scrollElement])
  const searchRef = useRef<HTMLInputElement | null>(null)
  const loadMoreRef = useRef<HTMLButtonElement | null>(null)
  const paginationStatusRef = useRef<HTMLParagraphElement | null>(null)
  const detailsOpenerRef = useRef<HTMLButtonElement | null>(null)
  const exactActionTokenRef = useRef(0)
  const detailTokenRef = useRef(0)
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null)
  const [checkingIdentity, setCheckingIdentity] = useState<string | null>(null)
  const [actionCheckFailure, setActionCheckFailure] = useState<{
    identity: string
    message: string
    requestId: string | null
  } | null>(null)
  const [details, setDetails] = useState<DetailsState | null>(null)
  const [focusedCard, setFocusedCard] = useState<{
    identity: string
    index: number
  } | null>(null)
  const [forceFocus, setForceFocus] = useState(false)
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

  const page = composition.server.page
  const discoveryRevision =
    page?.workspaceRevision ?? preferenceState.snapshot?.workspaceRevision ?? 0
  const serverItems = useMemo(
    () =>
      projectLibraryMediaPreferences({
        items: composition.server.items,
        preferenceState,
        discoveryWorkspaceRevision: discoveryRevision,
      }),
    [composition.server.items, discoveryRevision, preferenceState]
  )
  const localItems = useMemo(
    () =>
      projectLibraryMediaPreferences({
        items: composition.local.items,
        preferenceState,
        discoveryWorkspaceRevision: discoveryRevision,
      }),
    [composition.local.items, discoveryRevision, preferenceState]
  )
  const items = useMemo(
    () => [...serverItems, ...localItems],
    [localItems, serverItems]
  )
  const collectionOptions = useMemo(
    () => projectLibraryCollectionOptions(preferenceState),
    [preferenceState]
  )
  const criteria = libraryMediaScopeCriteria(scope)
  const ownershipKey = `${state.appliedQuery.search}:${state.entryPoint}:${state.filters.collectionId ?? "none"}:${state.filters.ownerKinds.join(",")}:${page?.queryKey ?? localState.queryKey}`
  const localHealth = localHealthMessage(composition.local.result?.status)
  const updating =
    state.updatingResults ||
    state.queryScheduled ||
    (localState.status === "loading" && localItems.length > 0)
  const initialLoading =
    items.length === 0 &&
    ((state.replacementStatus === "loading" && !page) ||
      (localState.status === "loading" && !composition.local.result))
  const initialServerFailure =
    !page && state.replacementStatus === "failed"
      ? state.replacementFailure
      : null
  const inlineServerFailure =
    state.replacementFailure && (page !== null || items.length > 0)
      ? state.replacementFailure
      : null
  const localFailure = localState.failure
  const countCopy = `${serverItems.length} cloud ${serverItems.length === 1 ? "result" : "results"} · ${localItems.length} on this device`

  useEffect(() => {
    if (!focusedCard) return
    if (
      items.some(
        (item) => libraryMediaUiIdentity(item) === focusedCard.identity
      )
    ) {
      return
    }
    if (items.length > 0) {
      const index = Math.min(focusedCard.index, items.length - 1)
      const successor = items[index]
      setFocusedCard({
        identity: libraryMediaUiIdentity(successor),
        index,
      })
      setForceFocus(true)
      return
    }
    setFocusedCard(null)
    searchRef.current?.focus()
  }, [focusedCard, items])

  useEffect(() => {
    const intent = state.focusIntent
    if (!intent) return
    if (intent.target === "search") searchRef.current?.focus()
    else if (intent.target === "load-more") loadMoreRef.current?.focus()
    else if (intent.target === "pagination-status") {
      paginationStatusRef.current?.focus()
    } else return
    commands.clearFocusIntent(intent.id)
  }, [commands, state.focusIntent])

  const loadExact = useCallback(
    async (item: LibraryMediaSummary) => {
      const result =
        item.mediaSource === "local"
          ? await localCommands.selectItem(item.id, item.version)
          : await commands.selectItem(item.id, item.version, item.mediaSource)
      if (result.status === "failed") return result
      if (exactDetailMatches(result.detail, item)) return result
      return {
        status: "failed" as const,
        message:
          "The exact media version no longer matches this library result.",
        requestId: null,
      }
    },
    [commands, localCommands]
  )

  const performPrimary = useCallback(
    async (item: LibraryMediaSummary) => {
      const identity = libraryMediaUiIdentity(item)
      const token = ++exactActionTokenRef.current
      setSelectedIdentity(identity)
      setCheckingIdentity(identity)
      setActionCheckFailure(null)
      try {
        const result = await loadExact(item)
        if (token !== exactActionTokenRef.current) return
        if (result.status === "failed") {
          setActionCheckFailure({
            identity,
            message: result.message,
            requestId: result.requestId,
          })
          return
        }
        onSelect(intentFrom(result.detail))
      } finally {
        if (token === exactActionTokenRef.current) setCheckingIdentity(null)
      }
    },
    [loadExact, onSelect]
  )

  const loadDetails = useCallback(
    async (item: LibraryMediaSummary) => {
      const token = ++detailTokenRef.current
      setDetails({
        item,
        status: "loading",
        detail: null,
        failure: null,
        actionStatus: "idle",
        actionFailure: null,
      })
      const result = await loadExact(item)
      if (token !== detailTokenRef.current) return
      setDetails(
        result.status === "ready"
          ? {
              item,
              status: "ready",
              detail: result.detail,
              failure: null,
              actionStatus: "idle",
              actionFailure: null,
            }
          : {
              item,
              status: "failed",
              detail: null,
              failure: result,
              actionStatus: "idle",
              actionFailure: null,
            }
      )
    },
    [loadExact]
  )

  const performDetailsPrimary = useCallback(
    async (item: LibraryMediaSummary) => {
      const identity = libraryMediaUiIdentity(item)
      const token = ++exactActionTokenRef.current
      setDetails((current) =>
        current && libraryMediaUiIdentity(current.item) === identity
          ? {
              ...current,
              actionStatus: "checking",
              actionFailure: null,
            }
          : current
      )
      const result = await loadExact(item)
      if (token !== exactActionTokenRef.current) return
      if (result.status === "failed") {
        setDetails((current) =>
          current && libraryMediaUiIdentity(current.item) === identity
            ? {
                ...current,
                actionStatus: "failed",
                actionFailure: result,
              }
            : current
        )
        return
      }
      setDetails((current) =>
        current && libraryMediaUiIdentity(current.item) === identity
          ? {
              ...current,
              status: "ready",
              detail: result.detail,
              failure: null,
              actionStatus: "idle",
              actionFailure: null,
            }
          : current
      )
      onSelect(intentFrom(result.detail))
    },
    [loadExact, onSelect]
  )

  const closeDetails = useCallback(() => {
    detailTokenRef.current += 1
    setDetails(null)
    const opener = detailsOpenerRef.current
    detailsOpenerRef.current = null
    queueMicrotask(() => opener?.focus({ preventScroll: true }))
  }, [])

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

  const toggleFavorite = useCallback(
    (item: LibraryMediaSummary, favorite: boolean) => {
      if (item.mediaSource === "local" || !item.permissions.canFavorite) return
      void preferenceCommands.setFavorite(
        mediaIdentity(item),
        item.name,
        favorite
      )
    },
    [preferenceCommands]
  )

  const toggleCollection = useCallback(
    (item: LibraryMediaSummary, collectionId: string, member: boolean) => {
      if (
        item.mediaSource === "local" ||
        !item.permissions.canAddToCollection
      ) {
        return
      }
      if (member) {
        void preferenceCommands.addCollectionMember(
          collectionId,
          mediaIdentity(item),
          item.name
        )
      } else {
        void preferenceCommands.removeCollectionMember(
          collectionId,
          mediaIdentity(item),
          item.name
        )
      }
    },
    [preferenceCommands]
  )

  const clearCriteria = () => {
    commands.clearSearch()
    commands.setFilters({
      categoryIds: [],
      useCaseIds: [],
      formatFamilies: [],
      orientations: [],
    })
    commands.setOrder("curated")
  }

  const hasNarrowingCriteria =
    state.rawSearch.trim().length > 0 ||
    state.filters.categoryIds.length > 0 ||
    state.filters.useCaseIds.length > 0 ||
    state.filters.formatFamilies.length > 0 ||
    state.filters.orientations.length > 0

  const snapshotFailureKey = snapshotFailureIdentity(
    preferenceState.snapshotFailure
  )
  const visibleSnapshotFailure =
    preferenceState.snapshotFailure &&
    snapshotFailureKey !== dismissedSnapshotFailure
      ? preferenceState.snapshotFailure
      : null
  const preferenceFailures = [...preferenceState.failures.values()]
  const presentedDetails = details
    ? {
        ...details,
        item:
          items.find(
            (item) =>
              libraryMediaUiIdentity(item) ===
              libraryMediaUiIdentity(details.item)
          ) ?? details.item,
      }
    : null
  const liveMessage = Array.from(
    new Set(
      [
        state.announcement?.message,
        actionError,
        actionCheckFailure?.message,
        details?.failure?.message,
        details?.actionFailure?.message,
        state.replacementFailure?.message,
        state.appendFailure?.message,
        localFailure?.message,
        localHealth,
        visibleSnapshotFailure?.message,
        ...preferenceFailures.map((failure) => failure.message),
      ].filter((message): message is string => Boolean(message))
    )
  ).join(" ")

  const tabScopes = useMemo(
    () => [
      { value: "recent", label: "Recent", scope: { kind: "recent" } as const },
      {
        value: "uploads",
        label: "Uploads",
        scope: { kind: "uploads" } as const,
      },
      {
        value: "library",
        label: "Library",
        scope: { kind: "library" } as const,
      },
      {
        value: "favorites",
        label: "Favorites",
        scope: { kind: "favorites" } as const,
      },
      ...collectionOptions.map((collection) => ({
        value: `collection:${collection.id}`,
        label: collection.label,
        scope: {
          kind: "collection" as const,
          collectionId: collection.id,
          label: collection.label,
        },
      })),
    ],
    [collectionOptions]
  )

  const renderCard = useCallback(
    (card: LibraryMediaCollectionCardRenderProps) => (
      <MediaCard
        {...card}
        action={action}
        actionsEnabled={actionsEnabled}
        checkFailure={
          actionCheckFailure?.identity === card.identity
            ? actionCheckFailure
            : null
        }
        checking={checkingIdentity === card.identity}
        collectionOptions={collectionOptions}
        loadLocalPreview={localCommands.loadPreview}
        ownershipKey={ownershipKey}
        pending={pendingIdentity === card.identity}
        preferencePending={preferenceState.pending}
        targetName={targetName}
        visibilityRoot={scrollElement}
        onInspect={(item, opener) => {
          setSelectedIdentity(libraryMediaUiIdentity(item))
          detailsOpenerRef.current = opener
          void loadDetails(item)
        }}
        onManageCollections={() => openCollections("manage")}
        onNewCollection={(item) =>
          openCollections("create", null, {
            identity: mediaIdentity(item),
            name: item.name,
          })
        }
        onPrimary={(item) => void performPrimary(item)}
        onToggleCollection={toggleCollection}
        onToggleFavorite={toggleFavorite}
      />
    ),
    [
      action,
      actionCheckFailure,
      actionsEnabled,
      checkingIdentity,
      collectionOptions,
      loadDetails,
      localCommands.loadPreview,
      openCollections,
      ownershipKey,
      pendingIdentity,
      performPrimary,
      preferenceState.pending,
      scrollElement,
      targetName,
      toggleCollection,
      toggleFavorite,
    ]
  )

  const appendContent = state.appendFailure ? (
    <StatusNotice
      destructive
      action={
        <Button
          className="min-h-11 shrink-0"
          type="button"
          variant="outline"
          onClick={() => void commands.loadMore()}
        >
          Retry
        </Button>
      }
    >
      {state.appendFailure.message}
    </StatusNotice>
  ) : null

  return (
    <section
      aria-busy={updating || initialLoading || undefined}
      aria-label="Media library"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-library-media-browser="true"
      data-media-scope={scopeValue(scope)}
    >
      <Tabs
        className="shrink-0 gap-0 border-b"
        value={scopeValue(scope)}
        onValueChange={(value) => {
          const next = tabScopes.find((tab) => tab.value === value)
          if (next) onScopeChange(next.scope)
        }}
      >
        <TabsList
          className="w-full justify-start gap-0 p-0 group-data-horizontal/tabs:h-12"
          variant="line"
        >
          {tabScopes.map((tab) => (
            <TabsTrigger
              className="h-full min-w-0 flex-1 rounded-none px-1.5 text-xs after:bottom-[-1px]"
              key={tab.value}
              value={tab.value}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <InputGroup className="h-12 min-w-0 flex-1">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            aria-label="Search media"
            name="media-search"
            className="h-full"
            placeholder="Search media…"
            type="search"
            value={state.rawSearch}
            onChange={(event) => commands.setRawSearch(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") commands.applySearch()
              if (event.key === "Escape" && state.rawSearch) {
                event.stopPropagation()
                commands.clearSearch()
              }
              if (event.key === "ArrowDown" && items.length > 0) {
                event.preventDefault()
                const target =
                  items.find(
                    (item) => libraryMediaUiIdentity(item) === selectedIdentity
                  ) ?? items[0]
                setFocusedCard({
                  identity: libraryMediaUiIdentity(target),
                  index: items.indexOf(target),
                })
                setForceFocus(true)
                commands.applySearch()
              }
            }}
          />
        </InputGroup>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              aria-label="Filter media"
              className="size-12 shrink-0"
              size="icon"
              type="button"
              variant="outline"
            >
              <Filter aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent
            className="w-full max-w-full gap-0 overflow-hidden sm:max-w-sm"
            showCloseButton={false}
            side="right"
          >
            <SheetHeader className="shrink-0 border-b pr-14">
              <SheetTitle>Media filters</SheetTitle>
              <SheetDescription>
                Narrow this source without changing the current document.
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4">
              <ScopeFilters />
            </div>
            <SheetClose asChild>
              <Button
                aria-label="Close media filters"
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
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <div className="grid shrink-0 gap-2 border-b px-3 py-2">
        <div className="flex min-h-7 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{countCopy}</span>
          {updating ? (
            <span className="inline-flex items-center gap-1.5">
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              Updating
            </span>
          ) : null}
        </div>
        {actionError ? (
          <StatusNotice destructive>{actionError}</StatusNotice>
        ) : null}
        {inlineServerFailure ? (
          <StatusNotice
            destructive
            action={
              <Button
                className="min-h-11 shrink-0"
                type="button"
                variant="outline"
                onClick={() => void commands.retryReplacement()}
              >
                Retry
              </Button>
            }
          >
            {inlineServerFailure.message}
          </StatusNotice>
        ) : null}
        {localFailure ? (
          <StatusNotice
            destructive
            action={
              <Button
                className="min-h-11 shrink-0"
                type="button"
                variant="outline"
                onClick={() => void localCommands.refresh()}
              >
                Retry
              </Button>
            }
          >
            {localFailure.message}
          </StatusNotice>
        ) : null}
        {localHealth ? <StatusNotice>{localHealth}</StatusNotice> : null}
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

      <div
        ref={setScrollElement}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        data-library-media-scroll-owner="true"
      >
        {initialLoading ? <MediaSkeleton /> : null}
        {initialServerFailure && items.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-lg border border-dashed p-6 text-center">
            <div className="max-w-xs">
              <ImageIcon
                aria-hidden="true"
                className="mx-auto size-5 text-muted-foreground"
              />
              <h2 className="mt-3 text-sm font-semibold">
                Media could not load
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {initialServerFailure.message}
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
        {!initialLoading && !initialServerFailure && items.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-lg border border-dashed p-6 text-center">
            <div className="max-w-xs">
              <ImageIcon
                aria-hidden="true"
                className="mx-auto size-5 text-muted-foreground"
              />
              <h2 className="mt-3 text-sm font-semibold">
                {hasNarrowingCriteria
                  ? "No media matches these filters"
                  : `No media in ${criteria.label}`}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {hasNarrowingCriteria
                  ? "Clear search and filters to see more media."
                  : "Choose another source or add media to this collection."}
              </p>
              {hasNarrowingCriteria ? (
                <Button
                  className="mt-4 min-h-11"
                  type="button"
                  variant="outline"
                  onClick={clearCriteria}
                >
                  Clear search and filters
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {items.length > 0 ? (
          <LibraryMediaCollection
            density={density}
            focusedIdentity={focusedCard?.identity ?? null}
            forceFocusIdentity={forceFocus}
            getScrollElement={getScrollElement}
            localGroup={
              localItems.length > 0
                ? { label: "On this device", items: localItems }
                : null
            }
            selectedIdentity={selectedIdentity}
            serverGroup={{ label: criteria.label, items: serverItems }}
            renderCard={renderCard}
            renderServerFinalStatus={
              page && !page.nextCursor
                ? () => (
                    <p
                      ref={paginationStatusRef}
                      className="min-h-11 rounded-md px-3 py-3 text-center text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/45"
                      tabIndex={-1}
                    >
                      All {page.total} cloud{" "}
                      {page.total === 1 ? "result" : "results"} loaded
                    </p>
                  )
                : undefined
            }
            renderServerLoadMore={
              page?.nextCursor
                ? () => (
                    <div className="grid gap-2">
                      {appendContent}
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
                        ) : null}
                        Load more cloud media
                      </Button>
                    </div>
                  )
                : state.appendFailure
                  ? () => appendContent
                  : undefined
            }
            onCardFocus={(identity, index) => {
              setFocusedCard({ identity, index })
              setForceFocus(false)
            }}
            onCollectionFocusLeave={() => setForceFocus(false)}
            onFocusIntentHandled={() => setForceFocus(false)}
          />
        ) : null}
      </div>

      <MediaDetails
        action={action}
        actionsEnabled={actionsEnabled}
        collectionOptions={collectionOptions}
        loadLocalPreview={localCommands.loadPreview}
        ownershipKey={ownershipKey}
        pending={Boolean(
          details && pendingIdentity === libraryMediaUiIdentity(details.item)
        )}
        state={presentedDetails}
        targetName={targetName}
        onOpenChange={(open) => {
          if (!open) closeDetails()
        }}
        onRetry={() => details && void loadDetails(details.item)}
        onSelect={(item) => void performDetailsPrimary(item)}
      />

      <LibraryCollectionBrowserDialog
        open={collectionDialogOpen}
        request={collectionDialogRequest}
        onFilterCollection={(collectionId) => {
          const collection = collectionOptions.find(
            (option) => option.id === collectionId
          )
          if (collection) {
            onScopeChange({
              kind: "collection",
              collectionId,
              label: collection.label,
            })
          }
        }}
        onOpenChange={setCollectionDialogOpen}
      />
    </section>
  )
}
