import type {
  DocumentDraftReadResult,
  DocumentDraftRepository,
  DocumentDraftSummary,
  DraftListRecoveryItem,
  DraftRepositoryEvent,
  DraftRepositoryFailure,
  DraftWriteResult,
} from "./document-draft-repository"

export const RECENT_DOCUMENTS_PAGE_SIZE = 24
export const RECENT_DOCUMENTS_QUERY_DELAY_MS = 180

export type DocumentsCollection = "recent" | "trash"
export type DocumentsView = "grid" | "list"

export type ConfirmedPage = Readonly<{
  items: readonly DocumentDraftSummary[]
  nextCursor: string | null
  recoveryItems: readonly DraftListRecoveryItem[]
  confirmedAt: number
  revision: number
}>

export type CollectionSlot =
  | Readonly<{ status: "idle"; stale: boolean }>
  | Readonly<{ status: "loading"; retained: ConfirmedPage | null }>
  | Readonly<{
      status: "ready"
      page: ConfirmedPage
      stale: boolean
      pagination: "idle" | "loading_more"
      paginationFailure: DraftRepositoryFailure | null
    }>
  | Readonly<{
      status: "failed"
      retained: ConfirmedPage | null
      failure: DraftRepositoryFailure
    }>

/**
 * Failed actions remain in the model after their repository promise settles.
 * A separate internal token map owns in-flight work, so `failed` never means
 * busy and a retry can synchronously claim the document again.
 */
export type DocumentActionState =
  | Readonly<{
      kind: "rename"
      phase: "editing"
      owner: "recent"
      documentName: string
      expectedRecordVersion: number
      input: string
      error: string | null
    }>
  | Readonly<{
      kind: "rename"
      phase: "submitting"
      owner: "recent"
      documentName: string
      expectedRecordVersion: number
      input: string
      token: number
      error: null
    }>
  | Readonly<{
      kind: "duplicate" | "trash" | "restore" | "download"
      phase: "submitting"
      owner: DocumentsCollection
      documentName: string
      token: number
      error: null
    }>
  | Readonly<{
      kind: "duplicate" | "trash" | "restore" | "download"
      phase: "failed"
      owner: DocumentsCollection
      documentName: string
      token: number
      error: string
    }>

export type RecentDocumentsState = Readonly<{
  active: boolean
  disposed: boolean
  collection: DocumentsCollection
  queryInput: string
  appliedQuery: string
  view: DocumentsView
  recent: CollectionSlot
  trash: CollectionSlot
  actions: ReadonlyMap<string, DocumentActionState>
  recoveryItems: readonly DraftListRecoveryItem[]
  undo: null | Readonly<{
    kind: "restore"
    documentId: string
    name: string
    expectedRecordVersion: number
  }>
  announcement: null | Readonly<{ id: number; message: string }>
  focusIntent: null | Readonly<{
    id: number
    target:
      | "search"
      | "collection-heading"
      | "load-more"
      | "pagination-status"
      | "document"
    documentId?: string
  }>
}>

export type DownloadedDocument = Readonly<{
  documentId: string
  name: string
  fileName: string
  json: string
}>

export type RecentDocumentsDependencies = Readonly<{
  list: DocumentDraftRepository["list"]
  rename: DocumentDraftRepository["rename"]
  duplicate: DocumentDraftRepository["duplicate"]
  softDelete: DocumentDraftRepository["softDelete"]
  restore: DocumentDraftRepository["restore"]
  getForDownload: DocumentDraftRepository["get"]
  subscribe: (listener: (event: DraftRepositoryEvent) => void) => () => void
  scheduleQuery: (callback: () => void, delayMs: number) => () => void
  readViewPreference: () => DocumentsView
  writeViewPreference: (view: DocumentsView) => void
  now?: () => number
}>

type Listener = () => void

type ReplacementRequest = {
  generation: number
  lifetime: number
  query: string
  queued: boolean
  promise: Promise<void>
}

type AppendRequest = {
  generation: number
  lifetime: number
  replacementGeneration: number
  query: string
  baseRevision: number
  cursor: string
  promise: Promise<void>
}

type CollectionRecord<T> = Record<DocumentsCollection, T>

const repositoryState = (collection: DocumentsCollection) =>
  collection === "recent" ? ("active" as const) : ("deleted" as const)

const confirmedPage = (slot: CollectionSlot): ConfirmedPage | null => {
  if (slot.status === "ready") return slot.page
  if (slot.status === "loading" || slot.status === "failed")
    return slot.retained
  return null
}

const idleSlot = (stale: boolean): CollectionSlot => ({
  status: "idle",
  stale,
})

const readySlot = (
  page: ConfirmedPage,
  options: {
    stale?: boolean
    pagination?: "idle" | "loading_more"
    paginationFailure?: DraftRepositoryFailure | null
  } = {}
): CollectionSlot => ({
  status: "ready",
  page,
  stale: options.stale ?? false,
  pagination: options.pagination ?? "idle",
  paginationFailure: options.paginationFailure ?? null,
})

const staleSlot = (slot: CollectionSlot): CollectionSlot => {
  const retained = confirmedPage(slot)
  if (retained) {
    const paginationFailure =
      slot.status === "ready" ? slot.paginationFailure : null
    return readySlot(retained, { stale: true, paginationFailure })
  }
  if (slot.status === "failed") return slot
  return idleSlot(true)
}

const activityOrder = (
  left: DocumentDraftSummary,
  right: DocumentDraftSummary
) => {
  const leftTime = Date.parse(left.activityAt)
  const rightTime = Date.parse(right.activityAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  if (left.documentId === right.documentId) return 0
  return left.documentId > right.documentId ? -1 : 1
}

const matchesCollection = (
  summary: DocumentDraftSummary,
  collection: DocumentsCollection
) =>
  collection === "recent"
    ? summary.deletedAt === null
    : summary.deletedAt !== null

const matchesQuery = (summary: DocumentDraftSummary, query: string) =>
  !query || summary.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())

const recoveryKey = (item: DraftListRecoveryItem) => {
  if (item.status === "quarantined") {
    return JSON.stringify(["quarantined", item.quarantineId])
  }
  return JSON.stringify([
    "retained",
    item.documentId,
    item.failure.kind,
    item.failure.message,
  ])
}

const invariantFailure = (message: string): DraftRepositoryFailure => ({
  kind: "validation_failed",
  message,
})

const requestFailure = (message: string): DraftRepositoryFailure => ({
  kind: "request_failed",
  message,
})

const quarantineEventMessage =
  "A stored document was quarantined after failing validation."

const writeFailureMessage = (
  result: Exclude<DraftWriteResult, { ok: true }>
) => {
  if ("failure" in result) return result.failure.message
  if (result.reason === "conflict")
    return "This document changed elsewhere. Refresh the list and try again."
  if (result.reason === "deleted")
    return "This document is already in Trash. Refresh the list and try again."
  if (result.reason === "exists")
    return "A document with this identity already exists."
  return "This document no longer exists. Refresh the list and try again."
}

const readFailureMessage = (
  result: Exclude<DocumentDraftReadResult, { ok: true }>
) => result.failure.message

const downloadFileName = (name: string) => {
  const base = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim()
  return `${base || "document"}.json`
}

export class RecentDocumentsController {
  readonly #dependencies: RecentDocumentsDependencies
  readonly #listeners = new Set<Listener>()
  readonly #replacementGeneration: CollectionRecord<number> = {
    recent: 0,
    trash: 0,
  }
  readonly #appendGeneration: CollectionRecord<number> = {
    recent: 0,
    trash: 0,
  }
  readonly #replacement: CollectionRecord<ReplacementRequest | null> = {
    recent: null,
    trash: null,
  }
  readonly #append: CollectionRecord<AppendRequest | null> = {
    recent: null,
    trash: null,
  }
  readonly #ownedActions = new Map<string, number>()
  readonly #renameReservations = new Set<string>()
  readonly #now: () => number
  #state: RecentDocumentsState
  #unsubscribe: (() => void) | null = null
  #cancelScheduledQuery: (() => void) | null = null
  #lifetime = 1
  #queryIntent = 0
  #pageRevision = 0
  #actionToken = 0
  #focusIntent = 0
  #announcement = 0

  constructor(dependencies: RecentDocumentsDependencies) {
    this.#dependencies = dependencies
    this.#now = dependencies.now ?? Date.now
    let view: DocumentsView = "grid"
    try {
      view = dependencies.readViewPreference()
    } catch {
      // A view preference cannot make the canonical repository unavailable.
    }
    this.#state = {
      active: false,
      disposed: false,
      collection: "recent",
      queryInput: "",
      appliedQuery: "",
      view,
      recent: idleSlot(false),
      trash: idleSlot(false),
      actions: new Map(),
      recoveryItems: [],
      undo: null,
      announcement: null,
      focusIntent: null,
    }
  }

  getSnapshot = () => this.#state

  subscribe = (listener: Listener) => {
    if (this.#state.disposed) return () => undefined
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  activate() {
    if (this.#state.disposed || this.#state.active) return
    this.#ensureSubscription()
    this.#publish({ ...this.#state, active: true })
    const normalizedQuery = this.#state.queryInput.trim()
    if (normalizedQuery !== this.#state.appliedQuery) {
      this.#applyQuery(normalizedQuery)
      return
    }
    if (this.#slotNeedsReplacement(this.#state.collection)) {
      void this.#startReplacement(this.#state.collection, "coalesce")
    }
  }

  deactivate() {
    if (this.#state.disposed || !this.#state.active) return
    this.#cancelQuerySchedule()
    this.#queryIntent += 1
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#publish({
      ...this.#state,
      active: false,
      recent: staleSlot(this.#state.recent),
      trash: staleSlot(this.#state.trash),
      focusIntent: null,
    })
  }

  dispose() {
    if (this.#state.disposed) return
    this.#cancelQuerySchedule()
    this.#lifetime += 1
    this.#queryIntent += 1
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#ownedActions.clear()
    this.#renameReservations.clear()
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#publish({
      ...this.#state,
      active: false,
      disposed: true,
      focusIntent: null,
    })
    this.#listeners.clear()
  }

  setCollection(collection: DocumentsCollection) {
    if (this.#state.disposed || collection === this.#state.collection) return
    this.#cancelQuerySchedule()
    const normalized = this.#state.queryInput.trim()
    if (normalized !== this.#state.appliedQuery) {
      this.#applyQuery(normalized, collection)
      return
    }
    const previous = this.#state.collection
    this.#cancelRequests(previous)
    this.#publish({
      ...this.#state,
      collection,
      [previous]: staleSlot(this.#state[previous]),
      focusIntent: this.#nextFocus("collection-heading"),
    })
    if (this.#state.active && this.#slotNeedsReplacement(collection)) {
      void this.#startReplacement(collection, "coalesce")
    }
  }

  setQueryInput(queryInput: string) {
    if (this.#state.disposed) return
    this.#cancelQuerySchedule()
    this.#queryIntent += 1
    const intent = this.#queryIntent
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#publish({
      ...this.#state,
      queryInput,
      recent: staleSlot(this.#state.recent),
      trash: staleSlot(this.#state.trash),
    })
    if (!this.#state.active) return
    this.#cancelScheduledQuery = this.#dependencies.scheduleQuery(() => {
      this.#cancelScheduledQuery = null
      if (
        this.#state.disposed ||
        !this.#state.active ||
        intent !== this.#queryIntent
      )
        return
      this.#applyQuery(this.#state.queryInput.trim())
    }, RECENT_DOCUMENTS_QUERY_DELAY_MS)
  }

  applyQueryInput() {
    if (this.#state.disposed) return
    this.#cancelQuerySchedule()
    this.#queryIntent += 1
    this.#applyQuery(this.#state.queryInput.trim())
  }

  clearQuery() {
    if (this.#state.disposed) return
    this.#cancelQuerySchedule()
    this.#queryIntent += 1
    this.#publish({ ...this.#state, queryInput: "" })
    this.#applyQuery("")
  }

  restoreRouteState(collection: DocumentsCollection, query: string) {
    if (this.#state.disposed) return
    this.#cancelQuerySchedule()
    this.#queryIntent += 1
    const queryInput = query
    this.#publish({ ...this.#state, queryInput })
    this.#applyQuery(queryInput.trim(), collection)
  }

  setView(view: DocumentsView) {
    if (this.#state.disposed || view === this.#state.view) return
    this.#publish({ ...this.#state, view })
    try {
      this.#dependencies.writeViewPreference(view)
    } catch {
      // The in-memory preference remains usable when optional storage fails.
    }
  }

  refresh() {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    return this.#startReplacement(this.#state.collection, "coalesce")
  }

  retry() {
    return this.refresh()
  }

  loadMore() {
    const collection = this.#state.collection
    const slot = this.#state[collection]
    if (
      this.#state.disposed ||
      !this.#state.active ||
      slot.status !== "ready" ||
      slot.pagination === "loading_more" ||
      !slot.page.nextCursor
    ) {
      return Promise.resolve()
    }

    const lifetime = this.#lifetime
    const replacementGeneration = this.#replacementGeneration[collection]
    const generation = ++this.#appendGeneration[collection]
    const query = this.#state.appliedQuery
    const baseRevision = slot.page.revision
    const cursor = slot.page.nextCursor
    this.#publish({
      ...this.#state,
      [collection]: readySlot(slot.page, {
        stale: slot.stale,
        pagination: "loading_more",
      }),
    })

    let request: ReturnType<RecentDocumentsDependencies["list"]>
    try {
      request = this.#dependencies.list({
        state: repositoryState(collection),
        query,
        limit: RECENT_DOCUMENTS_PAGE_SIZE,
        cursor,
      })
    } catch (error) {
      request = Promise.reject(error)
    }
    const promise = Promise.resolve(request)
      .then(
        (result) => {
          if (
            !this.#acceptsAppend({
              collection,
              generation,
              lifetime,
              replacementGeneration,
              query,
              baseRevision,
              cursor,
            })
          )
            return
          const current = this.#state[collection]
          if (current.status !== "ready") return
          if (!result.ok) {
            this.#publish({
              ...this.#state,
              [collection]: readySlot(current.page, {
                stale: current.stale,
                paginationFailure: result.failure,
              }),
            })
            return
          }
          this.#mergeRecovery(result.page.recoveryItems)
          const failure = this.#validateAppend(
            collection,
            current.page.items,
            result.page.items
          )
          if (failure) {
            this.#publish({
              ...this.#state,
              [collection]: readySlot(current.page, {
                stale: true,
                paginationFailure: failure,
              }),
              announcement: this.#nextAnnouncement(failure.message),
            })
            void this.#startReplacement(collection, "supersede", true)
            return
          }
          const page: ConfirmedPage = {
            items: [...current.page.items, ...result.page.items],
            nextCursor: result.page.nextCursor,
            recoveryItems: result.page.recoveryItems,
            confirmedAt: this.#now(),
            revision: ++this.#pageRevision,
          }
          this.#publish({
            ...this.#state,
            [collection]: readySlot(page),
            announcement: this.#nextAnnouncement(
              `${result.page.items.length} document${
                result.page.items.length === 1 ? "" : "s"
              } added.`
            ),
            focusIntent: this.#nextFocus(
              result.page.nextCursor ? "load-more" : "pagination-status"
            ),
          })
        },
        (error: unknown) => {
          if (
            !this.#acceptsAppend({
              collection,
              generation,
              lifetime,
              replacementGeneration,
              query,
              baseRevision,
              cursor,
            })
          )
            return
          const current = this.#state[collection]
          if (current.status !== "ready") return
          this.#publish({
            ...this.#state,
            [collection]: readySlot(current.page, {
              stale: current.stale,
              paginationFailure: requestFailure(
                error instanceof Error
                  ? error.message
                  : "More documents could not be loaded."
              ),
            }),
          })
        }
      )
      .finally(() => {
        if (this.#append[collection]?.generation === generation) {
          this.#append[collection] = null
        }
      })
    this.#append[collection] = {
      generation,
      lifetime,
      replacementGeneration,
      query,
      baseRevision,
      cursor,
      promise,
    }
    return promise
  }

  beginRename(documentId: string) {
    if (
      this.#state.disposed ||
      this.#ownedActions.has(documentId) ||
      this.#renameReservations.has(documentId)
    )
      return false
    const summary = this.#findSummary("recent", documentId)
    if (!summary || summary.deletedAt !== null) return false
    this.#setAction(documentId, {
      kind: "rename",
      phase: "editing",
      owner: "recent",
      documentName: summary.name,
      expectedRecordVersion: summary.recordVersion,
      input: summary.name,
      error: null,
    })
    this.#renameReservations.add(documentId)
    return true
  }

  updateRename(documentId: string, input: string) {
    const action = this.#state.actions.get(documentId)
    if (
      this.#state.disposed ||
      !action ||
      action.kind !== "rename" ||
      action.phase !== "editing" ||
      this.#ownedActions.has(documentId)
    )
      return
    this.#setAction(documentId, { ...action, input, error: null })
  }

  cancelAction(documentId: string) {
    if (this.#state.disposed || this.#ownedActions.has(documentId)) return
    this.#renameReservations.delete(documentId)
    this.#removeAction(documentId)
  }

  async submitRename(documentId: string) {
    if (this.#state.disposed) return false
    const action = this.#state.actions.get(documentId)
    if (!action || action.kind !== "rename") return false
    const input = action.input
    const name = input.trim()
    if (!name) {
      this.#setAction(documentId, {
        kind: "rename",
        phase: "editing",
        owner: action.owner,
        documentName: action.documentName,
        expectedRecordVersion: action.expectedRecordVersion,
        input,
        error: "Document name is required.",
      })
      return false
    }
    const token = this.#claimRenameAction(documentId)
    if (token === null) return false
    this.#setAction(documentId, {
      kind: "rename",
      phase: "submitting",
      owner: action.owner,
      documentName: action.documentName,
      expectedRecordVersion: action.expectedRecordVersion,
      input,
      token,
      error: null,
    })
    let result: DraftWriteResult
    try {
      result = await this.#dependencies.rename(
        documentId,
        action.expectedRecordVersion,
        name
      )
    } catch (error) {
      result = {
        ok: false,
        reason: "storage_unavailable",
        failure: requestFailure(
          error instanceof Error
            ? error.message
            : "The document could not be renamed."
        ),
      }
    }
    this.#releaseAction(documentId, token)
    if (!this.#acceptsAction(documentId, token)) return false
    if (!result.ok) {
      this.#mergeCorruptActionRecovery(documentId, result)
      this.#setAction(documentId, {
        kind: "rename",
        phase: "editing",
        owner: action.owner,
        documentName: action.documentName,
        expectedRecordVersion: action.expectedRecordVersion,
        input,
        error: writeFailureMessage(result),
      })
      return false
    }
    this.#cancelRequests("recent")
    this.#replaceSummary("recent", result.record.summary)
    if (
      matchesQuery(result.record.summary, this.#state.appliedQuery) &&
      this.#findSummary("recent", documentId) === null
    ) {
      this.#insertSummary("recent", result.record.summary, true)
    }
    this.#renameReservations.delete(documentId)
    this.#removeAction(documentId)
    this.#invalidate(["recent"])
    this.#publish({
      ...this.#state,
      announcement: this.#nextAnnouncement(
        `Renamed to ${result.record.summary.name}.`
      ),
      focusIntent: this.#focusVisibleDocumentOrHeading(
        action.owner,
        documentId
      ),
    })
    return true
  }

  async duplicate(documentId: string) {
    const summary = this.#findSummary("recent", documentId)
    if (this.#state.disposed || !summary || summary.deletedAt !== null)
      return null
    const token = this.#claimAction(documentId)
    if (token === null) return null
    this.#setAction(documentId, {
      kind: "duplicate",
      phase: "submitting",
      owner: "recent",
      documentName: summary.name,
      token,
      error: null,
    })
    let result: DraftWriteResult
    try {
      result = await this.#dependencies.duplicate(documentId)
    } catch (error) {
      result = {
        ok: false,
        reason: "storage_unavailable",
        failure: requestFailure(
          error instanceof Error
            ? error.message
            : "The document could not be duplicated."
        ),
      }
    }
    this.#releaseAction(documentId, token)
    if (!this.#acceptsAction(documentId, token)) return null
    if (!result.ok) {
      this.#mergeCorruptActionRecovery(documentId, result)
      this.#setFailedAction(
        documentId,
        "duplicate",
        "recent",
        summary.name,
        token,
        writeFailureMessage(result)
      )
      return null
    }
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#insertSummary("recent", result.record.summary)
    this.#removeAction(documentId)
    this.#invalidate(["recent", "trash"])
    this.#publish({
      ...this.#state,
      announcement: this.#nextAnnouncement(
        `${result.record.summary.name} was created.`
      ),
    })
    return result.record.summary
  }

  moveToTrash(documentId: string) {
    const summary = this.#findSummary("recent", documentId)
    if (!summary || summary.deletedAt !== null) return Promise.resolve(null)
    return this.#changeDeletion(summary, true)
  }

  restore(documentId: string) {
    const summary = this.#findSummary("trash", documentId)
    if (!summary || summary.deletedAt === null) return Promise.resolve(null)
    return this.#changeDeletion(summary, false)
  }

  restoreUndo() {
    const undo = this.#state.undo
    if (!undo) return Promise.resolve(null)
    return this.#changeDeletion(
      {
        documentId: undo.documentId,
        name: undo.name,
        recordVersion: undo.expectedRecordVersion,
      },
      false
    )
  }

  dismissUndo() {
    if (this.#state.disposed || !this.#state.undo) return
    this.#publish({ ...this.#state, undo: null })
  }

  async download(documentId: string): Promise<DownloadedDocument | null> {
    const owner = this.#state.collection
    const summary = this.#findSummary(owner, documentId)
    if (this.#state.disposed || !summary) return null
    const token = this.#claimAction(documentId)
    if (token === null) return null
    this.#setAction(documentId, {
      kind: "download",
      phase: "submitting",
      owner,
      documentName: summary.name,
      token,
      error: null,
    })
    let result: DocumentDraftReadResult
    try {
      result = await this.#dependencies.getForDownload(documentId)
    } catch (error) {
      result = {
        ok: false,
        reason: "storage_unavailable",
        failure: requestFailure(
          error instanceof Error
            ? error.message
            : "The document could not be downloaded."
        ),
      }
    }
    this.#releaseAction(documentId, token)
    if (!this.#acceptsAction(documentId, token)) return null
    if (!result.ok) {
      this.#mergeCorruptActionRecovery(documentId, result)
      this.#setFailedAction(
        documentId,
        "download",
        owner,
        summary.name,
        token,
        readFailureMessage(result)
      )
      return null
    }
    if (
      result.status !== "found" ||
      result.record.summary.documentId !== documentId ||
      result.record.envelope.document.id !== documentId
    ) {
      this.#setFailedAction(
        documentId,
        "download",
        owner,
        summary.name,
        token,
        result.status === "missing"
          ? "This document no longer exists."
          : "The stored document identity did not match the requested document."
      )
      return null
    }
    const downloaded: DownloadedDocument = {
      documentId,
      name: result.record.summary.name,
      fileName: downloadFileName(result.record.summary.name),
      json: JSON.stringify(result.record.envelope, null, 2),
    }
    this.#removeAction(documentId)
    this.#publish({
      ...this.#state,
      announcement: this.#nextAnnouncement(
        `${result.record.summary.name} is ready to download.`
      ),
      focusIntent: this.#focusVisibleDocumentOrHeading(owner, documentId),
    })
    return downloaded
  }

  clearAnnouncement(id: number) {
    if (
      this.#state.disposed ||
      this.#state.announcement === null ||
      this.#state.announcement.id !== id
    )
      return
    this.#publish({ ...this.#state, announcement: null })
  }

  clearFocusIntent(id: number) {
    if (this.#state.disposed || this.#state.focusIntent?.id !== id) return
    this.#publish({ ...this.#state, focusIntent: null })
  }

  #applyQuery(query: string, collection = this.#state.collection) {
    const changed = query !== this.#state.appliedQuery
    const collectionChanged = collection !== this.#state.collection
    if (!changed && !collectionChanged) {
      if (this.#state.active && this.#slotNeedsReplacement(collection)) {
        void this.#startReplacement(collection, "coalesce")
      }
      return
    }
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#publish({
      ...this.#state,
      collection,
      appliedQuery: query,
      recent: changed ? idleSlot(true) : staleSlot(this.#state.recent),
      trash: changed ? idleSlot(true) : staleSlot(this.#state.trash),
      focusIntent: collectionChanged
        ? this.#nextFocus("collection-heading")
        : this.#state.focusIntent,
    })
    if (this.#state.active) {
      void this.#startReplacement(collection, "supersede")
    }
  }

  #slotNeedsReplacement(collection: DocumentsCollection) {
    const slot = this.#state[collection]
    return (
      slot.status === "idle" ||
      slot.status === "failed" ||
      (slot.status === "ready" && slot.stale)
    )
  }

  #startReplacement(
    collection: DocumentsCollection,
    mode: "coalesce" | "supersede",
    preserveState = false
  ): Promise<void> {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    const currentRequest = this.#replacement[collection]
    if (
      mode === "coalesce" &&
      currentRequest &&
      currentRequest.lifetime === this.#lifetime &&
      currentRequest.query === this.#state.appliedQuery
    ) {
      currentRequest.queued = true
      return currentRequest.promise
    }

    this.#appendGeneration[collection] += 1
    this.#append[collection] = null
    const generation = ++this.#replacementGeneration[collection]
    const lifetime = this.#lifetime
    const query = this.#state.appliedQuery
    const retained = confirmedPage(this.#state[collection])
    if (!preserveState) {
      this.#publish({
        ...this.#state,
        [collection]: { status: "loading", retained },
      })
    }

    let request: ReturnType<RecentDocumentsDependencies["list"]>
    try {
      request = this.#dependencies.list({
        state: repositoryState(collection),
        query,
        limit: RECENT_DOCUMENTS_PAGE_SIZE,
      })
    } catch (error) {
      request = Promise.reject(error)
    }
    const promise = Promise.resolve(request)
      .then(
        (result) => {
          if (
            !this.#acceptsReplacement(collection, generation, lifetime, query)
          )
            return
          if (!result.ok) {
            this.#publish({
              ...this.#state,
              [collection]: {
                status: "failed",
                retained,
                failure: result.failure,
              },
            })
            return
          }
          this.#mergeRecovery(result.page.recoveryItems)
          const page: ConfirmedPage = {
            items: [...result.page.items],
            nextCursor: result.page.nextCursor,
            recoveryItems: [...result.page.recoveryItems],
            confirmedAt: this.#now(),
            revision: ++this.#pageRevision,
          }
          this.#publish({
            ...this.#state,
            [collection]: readySlot(page),
          })
        },
        (error: unknown) => {
          if (
            !this.#acceptsReplacement(collection, generation, lifetime, query)
          )
            return
          this.#publish({
            ...this.#state,
            [collection]: {
              status: "failed",
              retained,
              failure: requestFailure(
                error instanceof Error
                  ? error.message
                  : "Documents could not be loaded."
              ),
            },
          })
        }
      )
      .finally(() => {
        const active = this.#replacement[collection]
        if (!active || active.generation !== generation) return
        const queued = active.queued
        this.#replacement[collection] = null
        if (
          queued &&
          !this.#state.disposed &&
          this.#state.active &&
          this.#state.collection === collection &&
          this.#state.appliedQuery === query
        ) {
          void this.#startReplacement(collection, "supersede")
        }
      })
    this.#replacement[collection] = {
      generation,
      lifetime,
      query,
      queued: false,
      promise,
    }
    return promise
  }

  #acceptsReplacement(
    collection: DocumentsCollection,
    generation: number,
    lifetime: number,
    query: string
  ) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      this.#lifetime === lifetime &&
      this.#replacementGeneration[collection] === generation &&
      this.#state.collection === collection &&
      this.#state.appliedQuery === query
    )
  }

  #acceptsAppend(
    input: Omit<AppendRequest, "promise"> & {
      collection: DocumentsCollection
    }
  ) {
    const slot = this.#state[input.collection]
    return (
      !this.#state.disposed &&
      this.#state.active &&
      this.#lifetime === input.lifetime &&
      this.#state.collection === input.collection &&
      this.#state.appliedQuery === input.query &&
      this.#appendGeneration[input.collection] === input.generation &&
      this.#replacementGeneration[input.collection] ===
        input.replacementGeneration &&
      slot.status === "ready" &&
      slot.page.revision === input.baseRevision &&
      slot.page.nextCursor === input.cursor
    )
  }

  #validateAppend(
    collection: DocumentsCollection,
    existing: readonly DocumentDraftSummary[],
    appended: readonly DocumentDraftSummary[]
  ): DraftRepositoryFailure | null {
    const ids = new Set(existing.map((item) => item.documentId))
    for (const item of appended) {
      if (!matchesCollection(item, collection)) {
        return invariantFailure(
          "The next document page did not match the selected collection. Refreshing the list."
        )
      }
      if (ids.has(item.documentId)) {
        return invariantFailure(
          "The next document page repeated an existing document. Refreshing the list."
        )
      }
      ids.add(item.documentId)
    }
    const combined = [...existing, ...appended]
    for (let index = 1; index < combined.length; index += 1) {
      if (activityOrder(combined[index - 1], combined[index]) <= 0) continue
      return invariantFailure(
        "The next document page was out of order. Refreshing the list."
      )
    }
    return null
  }

  #cancelRequests(collection: DocumentsCollection) {
    this.#replacementGeneration[collection] += 1
    this.#appendGeneration[collection] += 1
    this.#replacement[collection] = null
    this.#append[collection] = null
  }

  #cancelQuerySchedule() {
    this.#cancelScheduledQuery?.()
    this.#cancelScheduledQuery = null
  }

  #ensureSubscription() {
    if (this.#unsubscribe || this.#state.disposed) return
    try {
      this.#unsubscribe = this.#dependencies.subscribe((event) =>
        this.#onRepositoryEvent(event)
      )
    } catch {
      // Event delivery only changes refresh latency. Repository reads remain
      // authoritative when the fanout channel is unavailable.
    }
  }

  #onRepositoryEvent(event: DraftRepositoryEvent) {
    if (this.#state.disposed) return
    if (event.type === "preview" || event.type === "conflict_resolved") return
    if (event.type === "saved") {
      this.#invalidate(["recent"])
      return
    }
    if (event.type === "quarantined") {
      this.#mergeRecovery([
        {
          documentId: event.documentId,
          quarantineId: event.quarantineId,
          status: "quarantined",
          failure: {
            kind: "corrupt_record",
            message: quarantineEventMessage,
          },
        },
      ])
    }
    this.#invalidate(["recent", "trash"])
  }

  #invalidate(collections: readonly DocumentsCollection[]) {
    this.#markCollectionsStale(collections)
    const selected = this.#state.collection
    if (!this.#state.active || !collections.includes(selected)) return
    void this.#startReplacement(selected, "coalesce")
  }

  #markCollectionsStale(collections: readonly DocumentsCollection[]) {
    let next = this.#state
    for (const collection of collections) {
      next = { ...next, [collection]: staleSlot(next[collection]) }
    }
    if (next !== this.#state) this.#publish(next)
  }

  #mergeRecovery(items: readonly DraftListRecoveryItem[]) {
    if (items.length === 0) return
    const merged = [...this.#state.recoveryItems]
    const indexes = new Map(
      merged.map((item, index) => [recoveryKey(item), index] as const)
    )
    let changed = false
    for (const item of items) {
      const key = recoveryKey(item)
      const existingIndex = indexes.get(key)
      if (existingIndex !== undefined) {
        const existing = merged[existingIndex]
        if (
          existing.failure.message === quarantineEventMessage &&
          item.failure.message !== quarantineEventMessage
        ) {
          merged[existingIndex] = item
          changed = true
        }
        continue
      }
      indexes.set(key, merged.length)
      merged.push(item)
      changed = true
    }
    if (changed) {
      this.#publish({ ...this.#state, recoveryItems: merged })
    }
  }

  #mergeCorruptActionRecovery(
    documentId: string,
    result:
      | Exclude<DraftWriteResult, { ok: true }>
      | Exclude<DocumentDraftReadResult, { ok: true }>
  ) {
    if (result.reason !== "corrupt_record") return
    this.#mergeRecovery([
      {
        documentId,
        quarantineId: result.quarantineId,
        status: "quarantined",
        failure: result.failure,
      },
    ])
  }

  #findSummary(collection: DocumentsCollection, documentId: string) {
    const page = confirmedPage(this.#state[collection])
    return page?.items.find((item) => item.documentId === documentId) ?? null
  }

  #replaceSummary(
    collection: DocumentsCollection,
    summary: DocumentDraftSummary
  ) {
    const slot = this.#state[collection]
    const page = confirmedPage(slot)
    if (
      !page ||
      !page.items.some((item) => item.documentId === summary.documentId)
    )
      return
    const items = page.items
      .map((item) => (item.documentId === summary.documentId ? summary : item))
      .filter((item) => matchesCollection(item, collection))
      .filter((item) => matchesQuery(item, this.#state.appliedQuery))
      .sort(activityOrder)
    this.#publish({
      ...this.#state,
      [collection]: readySlot(
        { ...page, items, revision: ++this.#pageRevision },
        { stale: true }
      ),
    })
  }

  #insertSummary(
    collection: DocumentsCollection,
    summary: DocumentDraftSummary,
    retainWhenUnloaded = false
  ) {
    const slot = this.#state[collection]
    const page = confirmedPage(slot)
    if (
      !matchesCollection(summary, collection) ||
      !matchesQuery(summary, this.#state.appliedQuery)
    )
      return
    if (!page) {
      if (!retainWhenUnloaded) return
      this.#publish({
        ...this.#state,
        [collection]: readySlot(
          {
            items: [summary],
            nextCursor: null,
            recoveryItems: [],
            confirmedAt: this.#now(),
            revision: ++this.#pageRevision,
          },
          { stale: true }
        ),
      })
      return
    }
    const items = [
      summary,
      ...page.items.filter((item) => item.documentId !== summary.documentId),
    ].sort(activityOrder)
    this.#publish({
      ...this.#state,
      [collection]: readySlot(
        { ...page, items, revision: ++this.#pageRevision },
        { stale: true }
      ),
    })
  }

  #removeSummary(collection: DocumentsCollection, documentId: string) {
    const slot = this.#state[collection]
    const page = confirmedPage(slot)
    if (!page || !page.items.some((item) => item.documentId === documentId))
      return
    this.#publish({
      ...this.#state,
      [collection]: readySlot(
        {
          ...page,
          items: page.items.filter((item) => item.documentId !== documentId),
          revision: ++this.#pageRevision,
        },
        { stale: true }
      ),
    })
  }

  async #changeDeletion(
    target: Pick<DocumentDraftSummary, "documentId" | "name" | "recordVersion">,
    deleted: boolean
  ) {
    const { documentId } = target
    if (this.#state.disposed) return null
    const token = this.#claimAction(documentId)
    if (token === null) return null
    const kind = deleted ? "trash" : "restore"
    const owner: DocumentsCollection = deleted ? "recent" : "trash"
    this.#setAction(documentId, {
      kind,
      phase: "submitting",
      owner,
      documentName: target.name,
      token,
      error: null,
    })
    let result: DraftWriteResult
    try {
      result = await (deleted
        ? this.#dependencies.softDelete(documentId, target.recordVersion)
        : this.#dependencies.restore(documentId, target.recordVersion))
    } catch (error) {
      result = {
        ok: false,
        reason: "storage_unavailable",
        failure: requestFailure(
          error instanceof Error
            ? error.message
            : deleted
              ? "The document could not be moved to Trash."
              : "The document could not be restored."
        ),
      }
    }
    this.#releaseAction(documentId, token)
    if (!this.#acceptsAction(documentId, token)) return null
    if (!result.ok) {
      this.#mergeCorruptActionRecovery(documentId, result)
      this.#setFailedAction(
        documentId,
        kind,
        owner,
        target.name,
        token,
        writeFailureMessage(result)
      )
      return null
    }

    const committed = result.record.summary
    this.#cancelRequests("recent")
    this.#cancelRequests("trash")
    this.#removeAction(documentId)
    if (deleted) {
      const activeItems = confirmedPage(this.#state.recent)?.items ?? []
      const index = activeItems.findIndex(
        (item) => item.documentId === documentId
      )
      const nextDocument = index >= 0 ? activeItems.at(index + 1) : undefined
      const previousDocument = index > 0 ? activeItems.at(index - 1) : undefined
      const focusDocument = (nextDocument ?? previousDocument)?.documentId
      this.#removeSummary("recent", documentId)
      this.#insertSummary("trash", committed)
      this.#invalidate(["recent", "trash"])
      this.#publish({
        ...this.#state,
        undo: {
          kind: "restore",
          documentId,
          name: committed.name,
          expectedRecordVersion: committed.recordVersion,
        },
        announcement: this.#nextAnnouncement(
          `${committed.name} was moved to Trash.`
        ),
        focusIntent:
          this.#state.collection === owner && focusDocument
            ? this.#nextFocus("document", focusDocument)
            : this.#nextFocus("collection-heading"),
      })
    } else {
      const visibleInCurrentQuery = matchesQuery(
        committed,
        this.#state.appliedQuery
      )
      this.#removeSummary("trash", documentId)
      this.#insertSummary("recent", committed, true)
      this.#publish({
        ...this.#state,
        collection: "recent",
        undo:
          this.#state.undo?.documentId === documentId ? null : this.#state.undo,
        announcement: this.#nextAnnouncement(
          visibleInCurrentQuery
            ? `${committed.name} was restored.`
            : `${committed.name} was restored, but it is hidden by the current search.`
        ),
        focusIntent:
          visibleInCurrentQuery &&
          this.#findSummary("recent", documentId) !== null
            ? this.#nextFocus("document", documentId)
            : this.#nextFocus("collection-heading"),
      })
      this.#invalidate(["recent", "trash"])
    }
    return committed
  }

  #claimAction(documentId: string) {
    if (
      this.#state.disposed ||
      this.#ownedActions.has(documentId) ||
      this.#renameReservations.has(documentId)
    )
      return null
    const token = ++this.#actionToken
    this.#ownedActions.set(documentId, token)
    return token
  }

  #claimRenameAction(documentId: string) {
    if (
      this.#state.disposed ||
      this.#ownedActions.has(documentId) ||
      !this.#renameReservations.has(documentId)
    )
      return null
    const token = ++this.#actionToken
    this.#ownedActions.set(documentId, token)
    return token
  }

  #releaseAction(documentId: string, token: number) {
    if (this.#ownedActions.get(documentId) === token) {
      this.#ownedActions.delete(documentId)
    }
  }

  #acceptsAction(documentId: string, token: number) {
    if (this.#state.disposed) return false
    const action = this.#state.actions.get(documentId)
    return action?.phase === "submitting" && action.token === token
  }

  #setAction(documentId: string, action: DocumentActionState) {
    const actions = new Map(this.#state.actions)
    actions.set(documentId, action)
    this.#publish({ ...this.#state, actions })
  }

  #setFailedAction(
    documentId: string,
    kind: "duplicate" | "trash" | "restore" | "download",
    owner: DocumentsCollection,
    documentName: string,
    token: number,
    error: string
  ) {
    this.#setAction(documentId, {
      kind,
      phase: "failed",
      owner,
      documentName,
      token,
      error,
    })
  }

  #removeAction(documentId: string) {
    if (!this.#state.actions.has(documentId)) return
    const actions = new Map(this.#state.actions)
    actions.delete(documentId)
    this.#publish({ ...this.#state, actions })
  }

  #nextFocus(
    target:
      | "search"
      | "collection-heading"
      | "load-more"
      | "pagination-status"
      | "document",
    documentId?: string
  ) {
    if (!this.#state.active) return null
    return {
      id: ++this.#focusIntent,
      target,
      ...(documentId ? { documentId } : {}),
    }
  }

  #focusVisibleDocumentOrHeading(
    owner: DocumentsCollection,
    documentId: string
  ) {
    return this.#state.collection === owner &&
      this.#findSummary(owner, documentId) !== null
      ? this.#nextFocus("document", documentId)
      : this.#nextFocus("collection-heading")
  }

  #nextAnnouncement(message: string) {
    return { id: ++this.#announcement, message }
  }

  #publish(state: RecentDocumentsState) {
    this.#state = state
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // One consumer cannot prevent other views from observing the state.
      }
    }
  }
}
