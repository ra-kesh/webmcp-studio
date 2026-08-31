import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Folder,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type {
  LibraryCollectionDetail,
  LibraryCollectionSummary,
  LibraryItemIdentity,
} from "@webmcp/document"
import { libraryCollectionNameSchema } from "@webmcp/document"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@webmcp/ui/components/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Separator } from "@webmcp/ui/components/separator"
import { cn } from "@webmcp/ui/lib/utils"
import { LibraryCollectionBrowserController } from "./library-collection-browser-controller"
import type { LibraryCollectionCatalogState } from "./library-collection-browser-controller"
import { createLibraryDiscoveryClient } from "./library-discovery-client"
import type {
  LibraryPreferenceFailure,
  LibraryPreferencePending,
  LibraryPreferenceStateOwner,
} from "./library-preference-controller"
import { useLibraryPreferences } from "./library-preference-provider"
import type { LibraryPreferenceCommands } from "./library-preference-provider"

export type LibraryCollectionDialogRequest = Readonly<{
  key: number
  mode: "manage" | "create"
  collectionId: string | null
  pendingMember: Readonly<{
    identity: LibraryItemIdentity
    name: string
  }> | null
}>

export type LibraryCollectionBrowserControllerFactory =
  () => LibraryCollectionBrowserController

const identityKey = (identity: LibraryItemIdentity) =>
  `${identity.itemKind}:${identity.id}@${identity.version}`

const EMPTY_COLLECTIONS: readonly LibraryCollectionSummary[] = []
const IDLE_COLLECTION_CATALOG: LibraryCollectionCatalogState = {
  status: "idle",
}

const collectionFailures = (
  state: LibraryPreferenceStateOwner,
  collectionId: string | null,
  includeCreate: boolean
) =>
  [...state.failures.values()].filter(
    ({ key }) =>
      (includeCreate && key === "collection:create") ||
      (collectionId !== null && key.startsWith(`collection:${collectionId}:`))
  )

const collectionPending = (
  state: LibraryPreferenceStateOwner,
  collectionId: string | null,
  action?: LibraryPreferencePending["action"]
) =>
  [...state.pending.values()].find(
    (pending) =>
      pending.collectionId === collectionId &&
      (action === undefined || pending.action === action)
  ) ?? null

export function LibraryPreferenceFailureNotice({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: LibraryPreferenceFailure
  onRetry: () => void
  onDismiss?: () => void
}) {
  return (
    <div
      className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
      data-library-preference-failure={failure.key}
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{failure.message}</p>
          {failure.requestId ? (
            <p className="mt-1 text-[11px] break-all text-muted-foreground">
              Request ID: {failure.requestId}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {failure.retryable ? (
          <Button
            className="min-h-11"
            size="sm"
            type="button"
            variant="outline"
            onClick={onRetry}
          >
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        ) : null}
        {onDismiss ? (
          <Button
            className="min-h-11"
            size="sm"
            type="button"
            variant="ghost"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CollectionNameField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  error: string | null
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field
      data-disabled={disabled || undefined}
      data-invalid={!!error || undefined}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        aria-invalid={!!error || undefined}
        className="min-h-11"
        disabled={disabled}
        id={id}
        maxLength={200}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

function CollectionMemberList({
  detail,
  catalogState,
  pending,
  commands,
  authoritativeCollectionRevision,
  onRetryCatalog,
  onDismissCatalog,
}: {
  detail: LibraryCollectionDetail
  catalogState: LibraryCollectionCatalogState
  pending: LibraryPreferencePending | null
  commands: LibraryPreferenceCommands
  authoritativeCollectionRevision: number
  onRetryCatalog: () => void
  onDismissCatalog: () => void
}) {
  const members =
    catalogState.status === "ready"
      ? catalogState.members
      : catalogState.status === "loading" || catalogState.status === "failed"
        ? catalogState.retained
        : catalogState.status === "dismissed"
          ? catalogState.members
          : null
  if (catalogState.status === "loading" && !members) {
    return (
      <div
        className="grid min-h-40 place-items-center text-sm text-muted-foreground"
        data-library-collection-members-loading="true"
      >
        <span className="flex items-center gap-2">
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          Loading collection items
        </span>
      </div>
    )
  }
  if (catalogState.status === "failed" && !members) {
    return (
      <div className="grid min-h-40 place-items-center p-4 text-center text-sm">
        <div>
          <p className="font-medium">{catalogState.failure.message}</p>
          {catalogState.failure.requestId ? (
            <p className="mt-1 text-xs break-all text-muted-foreground">
              Request ID: {catalogState.failure.requestId}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {catalogState.failure.retryable ? (
              <Button
                className="min-h-11"
                type="button"
                variant="outline"
                onClick={onRetryCatalog}
              >
                <RefreshCw aria-hidden="true" />
                Retry items
              </Button>
            ) : null}
            <Button
              className="min-h-11"
              type="button"
              variant="ghost"
              onClick={onDismissCatalog}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    )
  }
  if (catalogState.status === "dismissed" && !members) {
    return (
      <Empty className="min-h-40 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Folder aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Collection items are unavailable</EmptyTitle>
          <EmptyDescription>
            Reload the collection to try fetching its items again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            onClick={onRetryCatalog}
          >
            <RefreshCw aria-hidden="true" />
            Reload items
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  if (!members?.length) {
    return (
      <Empty className="min-h-40 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Folder aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This collection is empty</EmptyTitle>
          <EmptyDescription>
            Add templates from a card's actions menu.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const catalogReady =
    catalogState.status === "ready" &&
    catalogState.collectionRevision === detail.summary.revision &&
    detail.summary.revision === authoritativeCollectionRevision
  const busy = pending !== null || !catalogReady
  const displayedOrder = members.map(({ identity }) => identity)
  return (
    <div className="grid gap-2">
      {catalogState.status === "failed" ? (
        <div
          className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
          data-library-collection-catalog-failure="true"
        >
          <p className="font-medium">{catalogState.failure.message}</p>
          {catalogState.failure.requestId ? (
            <p className="break-all text-muted-foreground">
              Request ID: {catalogState.failure.requestId}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {catalogState.failure.retryable ? (
              <Button
                className="min-h-11"
                size="sm"
                type="button"
                variant="outline"
                onClick={onRetryCatalog}
              >
                <RefreshCw aria-hidden="true" />
                Retry items
              </Button>
            ) : null}
            <Button
              className="min-h-11"
              size="sm"
              type="button"
              variant="ghost"
              onClick={onDismissCatalog}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea className="h-[min(48vh,27rem)] rounded-lg border">
        <ol aria-label={`Items in ${detail.summary.name}`} className="divide-y">
          {members.map((member, index) => {
            const key = identityKey(member.identity)
            const removeKey = `collection:${detail.summary.id}:remove:${key}`
            const removing = pending?.key === removeKey
            return (
              <li
                className="flex min-h-14 items-center gap-2 px-2 py-1.5"
                data-library-collection-member={key}
                key={key}
              >
                <div className="min-w-0 flex-1 pl-1">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {member.identity.itemKind}
                  </p>
                </div>
                <Button
                  aria-label={`Move ${member.name} up`}
                  className="size-11 shrink-0"
                  data-library-member-move="up"
                  disabled={busy || index === 0}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const ordered = [...displayedOrder]
                    ;[ordered[index - 1], ordered[index]] = [
                      ordered[index],
                      ordered[index - 1],
                    ]
                    void commands.reorderCollectionMembers(
                      detail.summary.id,
                      ordered
                    )
                  }}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Move ${member.name} down`}
                  className="size-11 shrink-0"
                  data-library-member-move="down"
                  disabled={busy || index === members.length - 1}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const ordered = [...displayedOrder]
                    ;[ordered[index], ordered[index + 1]] = [
                      ordered[index + 1],
                      ordered[index],
                    ]
                    void commands.reorderCollectionMembers(
                      detail.summary.id,
                      ordered
                    )
                  }}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Remove ${member.name} from ${detail.summary.name}`}
                  className="min-h-11 shrink-0"
                  data-library-member-remove={key}
                  disabled={busy}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void commands.removeCollectionMember(
                      detail.summary.id,
                      member.identity,
                      member.name
                    )
                  }
                >
                  {removing ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <Trash2 aria-hidden="true" />
                  )}
                  Remove
                </Button>
              </li>
            )
          })}
        </ol>
      </ScrollArea>
    </div>
  )
}

export function LibraryCollectionBrowserDialog({
  open,
  request,
  onOpenChange,
  onFilterCollection,
  createMemberController = () =>
    new LibraryCollectionBrowserController({
      list: createLibraryDiscoveryClient().list,
    }),
}: {
  open: boolean
  request: LibraryCollectionDialogRequest
  onOpenChange: (open: boolean) => void
  onFilterCollection: (collectionId: string) => void
  createMemberController?: LibraryCollectionBrowserControllerFactory
}) {
  const { state, commands } = useLibraryPreferences()
  const [memberController] = useState(createMemberController)
  const memberState = useSyncExternalStore(
    memberController.subscribe,
    memberController.getSnapshot,
    memberController.getSnapshot
  )
  const collections = state.snapshot?.collections ?? EMPTY_COLLECTIONS
  const [mode, setMode] = useState<"manage" | "create">("manage")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createName, setCreateName] = useState("")
  const [createMemberIntent, setCreateMemberIntent] =
    useState<LibraryCollectionDialogRequest["pendingMember"]>(null)
  const [renameName, setRenameName] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameBaseline, setRenameBaseline] = useState("")
  const [renameConflict, setRenameConflict] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const createAttemptMemberRef =
    useRef<LibraryCollectionDialogRequest["pendingMember"]>(null)
  const renameSelectionRef = useRef<string | null>(null)
  const appliedRequestKeyRef = useRef<number | null>(null)

  const selectedSummary =
    collections.find(({ id }) => id === selectedId) ?? null
  const selectedSummaryId = selectedSummary?.id ?? null
  const selectedSummaryName = selectedSummary?.name ?? ""
  const selectedSummaryRevision = selectedSummary?.revision ?? null
  const detailState = selectedId
    ? state.collectionDetails.get(selectedId)
    : undefined
  const detail =
    detailState?.status === "ready"
      ? detailState.detail
      : detailState?.status === "loading" ||
          detailState?.status === "failed" ||
          detailState?.status === "dismissed"
        ? detailState.retained
        : null
  const failures = collectionFailures(state, selectedId, mode === "create")
  const activePending = collectionPending(state, selectedId)
  const creating = state.pending.has("collection:create")
  const visibleMemberState =
    detail &&
    memberState.status !== "idle" &&
    memberState.collectionId === detail.summary.id &&
    memberState.collectionRevision === detail.summary.revision
      ? memberState
      : IDLE_COLLECTION_CATALOG

  useEffect(() => () => memberController.dispose(), [memberController])

  useEffect(() => {
    if (!open) {
      memberController.cancel()
      return
    }
    if (appliedRequestKeyRef.current === request.key) return
    appliedRequestKeyRef.current = request.key
    setMode(request.mode)
    setCreateMemberIntent(request.pendingMember)
    setDeleteArmed(false)
    if (request.collectionId) setSelectedId(request.collectionId)
    else if (request.mode === "manage")
      setSelectedId((current) =>
        collections.some(({ id }) => id === current)
          ? current
          : (collections[0]?.id ?? null)
      )
  }, [collections, memberController, open, request])

  useEffect(() => {
    if (!open || mode !== "manage" || !selectedSummaryId) return
    void commands.loadCollection(selectedSummaryId)
  }, [commands, mode, open, selectedSummaryId, selectedSummaryRevision])

  useEffect(() => {
    if (!open || mode !== "manage" || !selectedSummaryId) return
    if (renameSelectionRef.current !== selectedSummaryId) {
      renameSelectionRef.current = selectedSummaryId
      setRenameName(selectedSummaryName)
      setRenameBaseline(selectedSummaryName)
      setRenameConflict(null)
      setRenameError(null)
      return
    }
    if (selectedSummaryName === renameBaseline) return
    if (selectedSummaryName === renameName) {
      setRenameBaseline(selectedSummaryName)
      setRenameConflict(null)
      return
    }
    if (renameName !== renameBaseline) {
      setRenameConflict(
        `This collection was renamed to “${selectedSummaryName}” elsewhere. Saving will replace that name.`
      )
    } else {
      setRenameName(selectedSummaryName)
      setRenameConflict(null)
    }
    setRenameBaseline(selectedSummaryName)
  }, [
    mode,
    open,
    renameBaseline,
    renameName,
    selectedSummaryId,
    selectedSummaryName,
  ])

  useEffect(() => {
    if (!open || !detail) return
    void memberController.load(detail)
  }, [detail, memberController, open])

  const finishCreatedCollection = async (
    created: LibraryCollectionSummary | null
  ) => {
    if (!created) return false
    const pendingMember = createAttemptMemberRef.current
    createAttemptMemberRef.current = null
    setSelectedId(created.id)
    setMode("manage")
    setCreateName("")
    setCreateMemberIntent(null)
    if (pendingMember) {
      await commands.addCollectionMember(
        created.id,
        pendingMember.identity,
        pendingMember.name
      )
    }
    return true
  }

  useEffect(() => {
    if (!selectedId || collections.some(({ id }) => id === selectedId)) return
    setSelectedId(collections[0]?.id ?? null)
    setDeleteArmed(false)
  }, [collections, selectedId])

  const submitCreate = async () => {
    const parsed = libraryCollectionNameSchema.safeParse(createName)
    if (!parsed.success) {
      setCreateError(
        parsed.error.issues[0]?.message ?? "Enter a collection name."
      )
      return
    }
    setCreateError(null)
    createAttemptMemberRef.current = createMemberIntent
    await finishCreatedCollection(
      await commands.createCollectionResult(parsed.data)
    )
  }

  const submitRename = async () => {
    if (!selectedSummary) return
    const parsed = libraryCollectionNameSchema.safeParse(renameName)
    if (!parsed.success) {
      setRenameError(
        parsed.error.issues[0]?.message ?? "Enter a collection name."
      )
      return
    }
    setRenameError(null)
    await commands.renameCollection(selectedSummary.id, parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-hidden p-0 sm:max-w-4xl"
        data-library-collection-dialog="true"
        showCloseButton={false}
      >
        <DialogHeader className="border-b p-4 pr-14">
          <DialogTitle>Collections</DialogTitle>
          <DialogDescription>
            Keep useful templates and media together for repeatable work.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 sm:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b sm:border-r sm:border-b-0">
            <div className="p-3">
              <Button
                className="min-h-11 w-full"
                data-library-collection-create="true"
                type="button"
                variant={mode === "create" ? "secondary" : "outline"}
                onClick={() => {
                  setMode("create")
                  setCreateMemberIntent(null)
                  setCreateError(null)
                }}
              >
                <FolderPlus aria-hidden="true" />
                New collection
              </Button>
            </div>
            <ScrollArea className="max-h-40 px-2 pb-2 sm:h-[31rem] sm:max-h-none">
              <ul aria-label="Your collections" className="grid gap-1">
                {collections.map((collection) => (
                  <li key={collection.id}>
                    <button
                      aria-current={
                        mode === "manage" && selectedId === collection.id
                          ? "true"
                          : undefined
                      }
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/45",
                        mode === "manage" &&
                          selectedId === collection.id &&
                          "bg-muted font-medium"
                      )}
                      data-library-collection-row={collection.id}
                      type="button"
                      onClick={() => {
                        setMode("manage")
                        setSelectedId(collection.id)
                        setDeleteArmed(false)
                      }}
                    >
                      <Folder aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {collection.name}
                      </span>
                      <Badge variant="outline">{collection.itemCount}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4">
            {mode === "create" ? (
              <form
                className="grid gap-5"
                data-library-collection-create-form="true"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitCreate()
                }}
              >
                <div>
                  <h3 className="text-sm font-semibold">New collection</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {createMemberIntent
                      ? `Create a collection and add ${createMemberIntent.name}.`
                      : "Name it for the client, campaign, or workflow you return to."}
                  </p>
                </div>
                <FieldGroup>
                  <CollectionNameField
                    disabled={creating}
                    error={createError}
                    id="library-collection-create-name"
                    label="Collection name"
                    value={createName}
                    onChange={(value) => {
                      setCreateName(value)
                      setCreateError(null)
                    }}
                  />
                </FieldGroup>
                {collectionFailures(state, null, true).map((failure) => (
                  <LibraryPreferenceFailureNotice
                    failure={failure}
                    key={failure.key}
                    onDismiss={() => {
                      createAttemptMemberRef.current = null
                      commands.dismissFailure(failure.key)
                    }}
                    onRetry={() =>
                      void commands
                        .retryCreateCollectionResult()
                        .then(finishCreatedCollection)
                    }
                  />
                ))}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    className="min-h-11"
                    type="button"
                    variant="ghost"
                    onClick={() => setMode("manage")}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="min-h-11"
                    data-library-collection-create-submit="true"
                    disabled={creating}
                    type="submit"
                  >
                    {creating ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <FolderPlus aria-hidden="true" />
                    )}
                    Create collection
                  </Button>
                </div>
              </form>
            ) : selectedSummary ? (
              <div className="grid gap-4">
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitRename()
                  }}
                >
                  <FieldGroup>
                    <CollectionNameField
                      disabled={activePending?.action === "rename_collection"}
                      error={renameError}
                      id="library-collection-rename-name"
                      label="Collection name"
                      value={renameName}
                      onChange={(value) => {
                        setRenameName(value)
                        setRenameError(null)
                      }}
                    />
                  </FieldGroup>
                  {renameConflict ? (
                    <p
                      className="text-xs leading-5 text-amber-700 dark:text-amber-300"
                      data-library-collection-rename-conflict="true"
                    >
                      {renameConflict}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      data-library-collection-rename="true"
                      disabled={
                        !!activePending || renameName === selectedSummary.name
                      }
                      size="sm"
                      type="submit"
                      variant="outline"
                    >
                      Save name
                    </Button>
                    <Button
                      className="min-h-11"
                      data-library-collection-filter={selectedSummary.id}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        onFilterCollection(selectedSummary.id)
                        onOpenChange(false)
                      }}
                    >
                      Show in browser
                    </Button>
                  </div>
                </form>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Items</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedSummary.itemCount} of 500 items
                    </p>
                  </div>
                  {activePending?.phase === "reconciling" ? (
                    <span className="text-xs text-muted-foreground">
                      Refreshing after another change…
                    </span>
                  ) : null}
                </div>
                {detailState?.status === "loading" && !detail ? (
                  <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                      Loading collection
                    </span>
                  </div>
                ) : null}
                {detailState?.status === "failed" ? (
                  <LibraryPreferenceFailureNotice
                    failure={detailState.failure}
                    onDismiss={() =>
                      commands.dismissCollectionDetailFailure(
                        selectedSummary.id
                      )
                    }
                    onRetry={() =>
                      void commands.retryCollectionDetail(selectedSummary.id)
                    }
                  />
                ) : null}
                {detailState?.status === "dismissed" && !detail ? (
                  <Empty className="min-h-40 border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Folder aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>
                        Collection details are unavailable
                      </EmptyTitle>
                      <EmptyDescription>
                        Reload the collection to try fetching its items again.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        className="min-h-11"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          void commands.retryCollectionDetail(
                            selectedSummary.id
                          )
                        }
                      >
                        <RefreshCw aria-hidden="true" />
                        Reload collection
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : null}
                {detail ? (
                  <CollectionMemberList
                    authoritativeCollectionRevision={selectedSummary.revision}
                    catalogState={visibleMemberState}
                    commands={commands}
                    detail={detail}
                    pending={activePending}
                    onDismissCatalog={() => memberController.dismissFailure()}
                    onRetryCatalog={() => void memberController.retry()}
                  />
                ) : null}
                {failures.map((failure) => (
                  <LibraryPreferenceFailureNotice
                    failure={failure}
                    key={failure.key}
                    onDismiss={() => commands.dismissFailure(failure.key)}
                    onRetry={() => void commands.retry(failure.key)}
                  />
                ))}
                <Separator />
                {deleteArmed ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm font-medium">
                      Delete this collection?
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Its templates and media remain in the library.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="min-h-11"
                        type="button"
                        variant="outline"
                        onClick={() => setDeleteArmed(false)}
                      >
                        Keep collection
                      </Button>
                      <Button
                        className="min-h-11"
                        data-library-collection-delete-confirm={
                          selectedSummary.id
                        }
                        disabled={activePending?.action === "delete_collection"}
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          void commands.deleteCollection(selectedSummary.id)
                        }
                      >
                        <Trash2 aria-hidden="true" />
                        Delete collection
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="min-h-11 w-fit"
                    data-library-collection-delete={selectedSummary.id}
                    disabled={!!activePending}
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleteArmed(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete collection
                  </Button>
                )}
              </div>
            ) : (
              <Empty className="min-h-72 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderPlus aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No collections yet</EmptyTitle>
                  <EmptyDescription>
                    Create one to keep related library items together.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    className="min-h-11"
                    type="button"
                    onClick={() => {
                      setCreateMemberIntent(null)
                      setMode("create")
                    }}
                  >
                    New collection
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
