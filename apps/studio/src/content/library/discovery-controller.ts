import { z } from "zod"
import {
  libraryCatalogItemDetailSchema,
  libraryCatalogPageSchema,
  libraryCatalogQuerySchema,
  libraryCatalogItemIdentity,
  libraryItemIdentitySchema,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogItemSummary,
  LibraryCatalogQuery,
  LibraryCatalogQueryInput,
  LibraryItemIdentity,
  LibraryMediaSummary,
} from "@webmcp/document"
import {
  isTrustedLibraryCursorInvalidation,
  LibraryDiscoveryHttpError,
} from "./library-discovery-client"
import type {
  LibraryDiscoveryCursorReason,
  LibraryDiscoveryListResult,
} from "./library-discovery-client"

export const LIBRARY_DISCOVERY_QUERY_DELAY_MS = 180
export const LIBRARY_DISCOVERY_PAGE_SIZE = 24

export type LibraryDiscoveryEntryPoint =
  "featured" | "all" | "recent" | "favorites"

const catalogIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)

const taxonomyOptionSchema = z
  .object({
    id: catalogIdSchema,
    label: z.string().trim().min(1).max(100),
  })
  .strict()

const uniqueOptions = (
  options: readonly z.infer<typeof taxonomyOptionSchema>[],
  context: z.RefinementCtx
) => {
  if (new Set(options.map(({ id }) => id)).size !== options.length) {
    context.addIssue({ code: "custom", message: "Taxonomy IDs must be unique" })
  }
}

const taxonomyOptionsSchema = z
  .array(taxonomyOptionSchema)
  .min(1)
  .max(200)
  .superRefine(uniqueOptions)

export const libraryTaxonomySchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: taxonomyOptionsSchema,
    useCases: taxonomyOptionsSchema,
    formatFamilies: taxonomyOptionsSchema,
    orientations: taxonomyOptionsSchema,
    owners: taxonomyOptionsSchema,
  })
  .strict()
  .superRefine((taxonomy, context) => {
    const orientations = new Map(
      taxonomy.orientations.map(({ id, label }) => [id, label])
    )
    const owners = new Map(taxonomy.owners.map(({ id, label }) => [id, label]))
    const expectedOrientations = ["portrait", "landscape", "square", "mixed"]
    if (
      orientations.size !== expectedOrientations.length ||
      expectedOrientations.some((id) => !orientations.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["orientations"],
        message: "Taxonomy must define every catalog orientation",
      })
    }
    if (
      owners.size !== 2 ||
      owners.get("studio") !== "Studio" ||
      owners.get("workspace") !== "Your workspace"
    ) {
      context.addIssue({
        code: "custom",
        path: ["owners"],
        message: "Ownership labels must be Studio and Your workspace",
      })
    }
  })

export type LibraryTaxonomy = z.infer<typeof libraryTaxonomySchema>

export type LibraryDiscoveryFilters = Readonly<{
  itemKinds: readonly ("template" | "media")[]
  categoryIds: readonly string[]
  useCaseIds: readonly string[]
  formatFamilies: readonly string[]
  orientations: readonly ("portrait" | "landscape" | "square" | "mixed")[]
  ownerKinds: readonly ("studio" | "workspace")[]
  collectionId: string | null
}>

export type LibraryDiscoveryAppliedQuery = LibraryDiscoveryFilters &
  Readonly<{
    search: string
    order: "curated" | "recent" | "newest"
    entryPoint: LibraryDiscoveryEntryPoint
    favoritesOnly: boolean
    recentOnly: boolean
  }>

export type LibraryDiscoveryFailure = Readonly<{
  kind: "request_failed" | "invalid_response"
  message: string
  requestId?: string | null
  cursorReason?: LibraryDiscoveryCursorReason
}>

export type LibraryDiscoveryConfirmedPage = Readonly<{
  workspaceRevision: number
  catalogRevision: string
  generation: string
  queryIdentity: string
  queryKey: string
  items: readonly LibraryCatalogItemSummary[]
  nextCursor: string | null
  total: number
}>

export type LibraryDiscoveryDetailState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "loading"
      itemKind: "template" | "media"
      id: string
      version: number
      mediaSource?: LibraryMediaSummary["mediaSource"]
    }>
  | Readonly<{
      status: "ready"
      detail: LibraryCatalogItemDetail
    }>
  | Readonly<{
      status: "failed"
      itemKind: "template" | "media"
      id: string
      version: number
      mediaSource?: LibraryMediaSummary["mediaSource"]
      failure: LibraryDiscoveryFailure
    }>

export type LibraryDiscoveryFocusTarget =
  "search" | "results" | "load-more" | "pagination-status" | "item"

export type LibraryDiscoveryState = Readonly<{
  active: boolean
  disposed: boolean
  taxonomy: LibraryTaxonomy
  rawSearch: string
  appliedQuery: LibraryDiscoveryAppliedQuery
  filters: LibraryDiscoveryFilters
  order: "curated" | "recent" | "newest"
  entryPoint: LibraryDiscoveryEntryPoint
  queryScheduled: boolean
  updatingResults: boolean
  replacementStatus: "idle" | "loading" | "failed"
  replacementFailure: LibraryDiscoveryFailure | null
  appendStatus: "idle" | "loading" | "failed"
  appendFailure: LibraryDiscoveryFailure | null
  confirmedPage: LibraryDiscoveryConfirmedPage | null
  retainedPage: LibraryDiscoveryConfirmedPage | null
  detail: LibraryDiscoveryDetailState
  announcement: Readonly<{ id: number; message: string }> | null
  focusIntent: Readonly<{
    id: number
    target: LibraryDiscoveryFocusTarget
    itemIdentity?: string
  }> | null
}>

export type LibraryDiscoveryDependencies = Readonly<{
  list: (
    query: LibraryCatalogQueryInput,
    signal: AbortSignal
  ) => Promise<LibraryDiscoveryListResult>
  getDetail: (
    identity: LibraryItemIdentity,
    signal: AbortSignal
  ) => Promise<LibraryCatalogItemDetail>
  getTaxonomy: () => LibraryTaxonomy
  scheduleQuery: (callback: () => void, delayMs: number) => () => void
}>

type Listener = () => void

type ReplacementRequest = Readonly<{
  token: number
  lifetime: number
  generation: string
  queryKey: string
  controller: AbortController
}>

type AppendRequest = Readonly<{
  token: number
  lifetime: number
  generation: string
  queryKey: string
  queryIdentity: string
  workspaceRevision: number
  catalogRevision: string
  cursor: string
  controller: AbortController
}>

type DetailRequest = Readonly<{
  token: number
  lifetime: number
  identity: string
  controller: AbortController
}>

const emptyFilters = (): LibraryDiscoveryFilters => ({
  itemKinds: ["template", "media"],
  categoryIds: [],
  useCaseIds: [],
  formatFamilies: [],
  orientations: [],
  ownerKinds: [],
  collectionId: null,
})

const libraryDiscoveryListResultSchema = z
  .object({
    workspaceRevision: z.number().int().nonnegative(),
    page: libraryCatalogPageSchema,
  })
  .strict()

const normalizeSearch = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ")

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const requestFailure = (
  error: unknown,
  fallback: string
): LibraryDiscoveryFailure => {
  const cursorReason = cursorReasonFrom(error)
  return {
    kind: "request_failed",
    message: error instanceof Error ? error.message : fallback,
    requestId:
      error instanceof LibraryDiscoveryHttpError ? error.requestId : null,
    ...(cursorReason ? { cursorReason } : {}),
  }
}

const cursorReasonFrom = (
  error: unknown
): LibraryDiscoveryCursorReason | null =>
  isTrustedLibraryCursorInvalidation(error) ? error.cursorReason : null

const invalidResponse = (message: string): LibraryDiscoveryFailure => ({
  kind: "invalid_response",
  message,
  requestId: null,
})

const itemIdentity = (item: LibraryCatalogItemSummary) =>
  libraryCatalogItemIdentity(item)

export class LibraryDiscoveryController {
  readonly #dependencies: LibraryDiscoveryDependencies
  readonly #listeners = new Set<Listener>()
  #state: LibraryDiscoveryState
  #lifetime = 1
  #requestToken = 0
  #generation = 0
  #announcement = 0
  #focusIntent = 0
  #scheduledIntent = 0
  #cancelScheduledQuery: (() => void) | null = null
  #replacement: ReplacementRequest | null = null
  #append: AppendRequest | null = null
  #detail: DetailRequest | null = null

  constructor(dependencies: LibraryDiscoveryDependencies) {
    this.#dependencies = dependencies
    const taxonomy = immutable(
      libraryTaxonomySchema.parse(structuredClone(dependencies.getTaxonomy()))
    )
    const filters = immutable(emptyFilters())
    const appliedQuery = immutable(
      this.#createAppliedQuery("", filters, "curated", "featured")
    )
    this.#state = immutable({
      active: false,
      disposed: false,
      taxonomy,
      rawSearch: "",
      appliedQuery,
      filters,
      order: "curated",
      entryPoint: "featured",
      queryScheduled: false,
      updatingResults: false,
      replacementStatus: "idle",
      replacementFailure: null,
      appendStatus: "idle",
      appendFailure: null,
      confirmedPage: null,
      retainedPage: null,
      detail: { status: "idle" },
      announcement: null,
      focusIntent: null,
    } satisfies LibraryDiscoveryState)
  }

  getSnapshot = () => this.#state

  subscribe = (listener: Listener) => {
    if (this.#state.disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  activate() {
    if (this.#state.disposed || this.#state.active) return
    this.#publish({ ...this.#state, active: true })
    const search = normalizeSearch(this.#state.rawSearch)
    if (search !== this.#state.appliedQuery.search) {
      this.#applyCriteria({ search }, null)
      return
    }
    void this.refresh()
  }

  deactivate() {
    if (this.#state.disposed || !this.#state.active) return
    this.#cancelSchedule()
    this.#abortListRequests()
    this.#abortDetail()
    this.#publish({
      ...this.#state,
      active: false,
      queryScheduled: false,
      updatingResults: false,
      replacementStatus: "idle",
      appendStatus: "idle",
      detail: { status: "idle" },
      focusIntent: null,
    })
  }

  dispose() {
    if (this.#state.disposed) return
    this.#cancelSchedule()
    this.#lifetime += 1
    this.#abortListRequests()
    this.#abortDetail()
    this.#publish({
      ...this.#state,
      active: false,
      disposed: true,
      queryScheduled: false,
      updatingResults: false,
      replacementStatus: "idle",
      appendStatus: "idle",
      detail: { status: "idle" },
      focusIntent: null,
    })
    this.#listeners.clear()
  }

  setRawSearch(rawSearch: string) {
    if (this.#state.disposed || rawSearch === this.#state.rawSearch) return
    this.#cancelSchedule()
    const search = normalizeSearch(rawSearch)
    if (search === this.#state.appliedQuery.search) {
      this.#publish({
        ...this.#state,
        rawSearch,
        queryScheduled: false,
        updatingResults: this.#state.replacementStatus === "loading",
      })
      if (
        this.#state.active &&
        !this.#state.confirmedPage &&
        this.#state.replacementStatus !== "loading"
      ) {
        void this.#startReplacement(this.#state.appliedQuery, "same-query")
      }
      return
    }
    this.#abortListRequests()
    this.#abortDetail()
    const intent = ++this.#scheduledIntent
    this.#publish({
      ...this.#state,
      rawSearch,
      queryScheduled: this.#state.active,
      updatingResults: true,
      replacementStatus: "idle",
      replacementFailure: null,
      appendStatus: "idle",
      appendFailure: null,
      detail: { status: "idle" },
    })
    if (!this.#state.active) return
    this.#cancelScheduledQuery = this.#dependencies.scheduleQuery(() => {
      this.#cancelScheduledQuery = null
      if (
        this.#state.disposed ||
        !this.#state.active ||
        intent !== this.#scheduledIntent
      )
        return
      this.#applyCriteria(
        { search: normalizeSearch(this.#state.rawSearch) },
        null
      )
    }, LIBRARY_DISCOVERY_QUERY_DELAY_MS)
  }

  applySearch() {
    if (this.#state.disposed) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#applyCriteria(
      { search: normalizeSearch(this.#state.rawSearch) },
      "search"
    )
  }

  clearSearch() {
    if (this.#state.disposed) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#publish({ ...this.#state, rawSearch: "" })
    this.#applyCriteria({ search: "" }, "search")
  }

  setFilters(patch: Partial<LibraryDiscoveryFilters>) {
    if (this.#state.disposed) return
    const filters = immutable(
      this.#validateFilters({ ...this.#state.filters, ...patch })
    )
    if (JSON.stringify(filters) === JSON.stringify(this.#state.filters)) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#publish({ ...this.#state, filters })
    this.#applyCriteria(
      { filters, search: normalizeSearch(this.#state.rawSearch) },
      "results"
    )
  }

  setOrder(order: LibraryDiscoveryState["order"]) {
    if (this.#state.disposed || order === this.#state.order) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#publish({ ...this.#state, order })
    this.#applyCriteria(
      { order, search: normalizeSearch(this.#state.rawSearch) },
      "results"
    )
  }

  setEntryPoint(entryPoint: LibraryDiscoveryEntryPoint) {
    if (this.#state.disposed || entryPoint === this.#state.entryPoint) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#publish({ ...this.#state, entryPoint })
    this.#applyCriteria(
      { entryPoint, search: normalizeSearch(this.#state.rawSearch) },
      "results"
    )
  }

  setScope(
    patch: Partial<LibraryDiscoveryFilters>,
    entryPoint: LibraryDiscoveryEntryPoint
  ) {
    if (this.#state.disposed) return
    const filters = immutable(
      this.#validateFilters({ ...this.#state.filters, ...patch })
    )
    const filtersChanged =
      JSON.stringify(filters) !== JSON.stringify(this.#state.filters)
    const entryPointChanged = entryPoint !== this.#state.entryPoint
    if (!filtersChanged && !entryPointChanged) return
    this.#cancelSchedule()
    this.#scheduledIntent += 1
    this.#applyCriteria(
      {
        filters,
        entryPoint,
        search: normalizeSearch(this.#state.rawSearch),
      },
      "results"
    )
  }

  refresh() {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    return this.#startReplacement(this.#state.appliedQuery, "same-query")
  }

  retryReplacement() {
    return this.refresh()
  }

  loadMore() {
    const page = this.#state.confirmedPage
    if (
      this.#state.disposed ||
      !this.#state.active ||
      !page?.nextCursor ||
      this.#state.replacementStatus === "loading" ||
      this.#state.appendStatus === "loading"
    ) {
      return Promise.resolve()
    }
    this.#abortAppend()
    const controller = new AbortController()
    const request: AppendRequest = {
      token: ++this.#requestToken,
      lifetime: this.#lifetime,
      generation: page.generation,
      queryKey: page.queryKey,
      queryIdentity: page.queryIdentity,
      workspaceRevision: page.workspaceRevision,
      catalogRevision: page.catalogRevision,
      cursor: page.nextCursor,
      controller,
    }
    this.#append = request
    this.#publish({
      ...this.#state,
      appendStatus: "loading",
      appendFailure: null,
    })
    const query = this.#catalogQuery(
      this.#state.appliedQuery,
      request.generation,
      request.cursor
    )
    return this.#callList(query, controller.signal).then(
      (result) => this.#completeAppend(request, result),
      (error: unknown) => this.#failAppend(request, error)
    )
  }

  selectItem(
    kind: "template" | "media",
    id: string,
    version: number,
    sourceOrOptions:
      LibraryMediaSummary["mediaSource"] | { requestFocus?: boolean } = {},
    mediaOptions: { requestFocus?: boolean } = {}
  ) {
    if (this.#state.disposed || !this.#state.active)
      return Promise.resolve(null)
    this.#abortDetail()
    const controller = new AbortController()
    const identity = libraryItemIdentitySchema.parse(
      kind === "media"
        ? { itemKind: kind, id, version, mediaSource: sourceOrOptions }
        : { itemKind: kind, id, version }
    )
    const options =
      kind === "media"
        ? mediaOptions
        : typeof sourceOrOptions === "object"
          ? sourceOrOptions
          : {}
    const requestIdentity =
      identity.itemKind === "media"
        ? `media:${identity.mediaSource}:${identity.id}@${identity.version}`
        : `template:${identity.id}@${identity.version}`
    const request: DetailRequest = {
      token: ++this.#requestToken,
      lifetime: this.#lifetime,
      identity: requestIdentity,
      controller,
    }
    this.#detail = request
    this.#publish({
      ...this.#state,
      detail: {
        status: "loading",
        itemKind: kind,
        id,
        version,
        ...(identity.itemKind === "media"
          ? { mediaSource: identity.mediaSource }
          : {}),
      },
    })
    let result: Promise<LibraryCatalogItemDetail>
    try {
      result = Promise.resolve(
        this.#dependencies.getDetail(identity, controller.signal)
      )
    } catch (error) {
      result = Promise.reject(error)
    }
    return result.then(
      (value) => {
        if (!this.#acceptsDetail(request)) return null
        let detail: LibraryCatalogItemDetail
        try {
          detail = immutable(libraryCatalogItemDetailSchema.parse(value))
        } catch {
          this.#publishDetailFailure(
            request,
            kind,
            id,
            version,
            identity.itemKind === "media" ? identity.mediaSource : undefined,
            invalidResponse(
              "The selected library item returned invalid details."
            )
          )
          return null
        }
        if (
          detail.summary.itemKind !== kind ||
          detail.summary.id !== id ||
          detail.summary.version !== version ||
          (identity.itemKind === "media" &&
            (detail.summary.itemKind !== "media" ||
              detail.summary.mediaSource !== identity.mediaSource))
        ) {
          this.#publishDetailFailure(
            request,
            kind,
            id,
            version,
            identity.itemKind === "media" ? identity.mediaSource : undefined,
            invalidResponse(
              "The selected library detail identity did not match."
            )
          )
          return null
        }
        this.#detail = null
        this.#publish({
          ...this.#state,
          detail: { status: "ready", detail },
          focusIntent: options.requestFocus
            ? this.#nextFocus("item", requestIdentity)
            : null,
        })
        return detail
      },
      (error: unknown) => {
        if (!this.#acceptsDetail(request)) return null
        this.#publishDetailFailure(
          request,
          kind,
          id,
          version,
          identity.itemKind === "media" ? identity.mediaSource : undefined,
          requestFailure(
            error,
            "The selected library item could not be loaded."
          )
        )
        return null
      }
    )
  }

  retryDetail() {
    const detail = this.#state.detail
    return detail.status === "failed"
      ? this.selectItem(
          detail.itemKind,
          detail.id,
          detail.version,
          detail.itemKind === "media" ? detail.mediaSource! : {}
        )
      : Promise.resolve(null)
  }

  clearSelection() {
    if (this.#state.disposed || this.#state.detail.status === "idle") return
    this.#abortDetail()
    this.#publish({ ...this.#state, detail: { status: "idle" } })
  }

  clearAnnouncement(id: number) {
    if (this.#state.disposed || this.#state.announcement?.id !== id) return
    this.#publish({ ...this.#state, announcement: null })
  }

  clearFocusIntent(id: number) {
    if (this.#state.disposed || this.#state.focusIntent?.id !== id) return
    this.#publish({ ...this.#state, focusIntent: null })
  }

  #applyCriteria(
    patch: Partial<{
      search: string
      filters: LibraryDiscoveryFilters
      order: LibraryDiscoveryState["order"]
      entryPoint: LibraryDiscoveryEntryPoint
    }>,
    focus: "search" | "results" | null
  ) {
    const criteriaState = {
      ...this.#state,
      ...(patch.filters ? { filters: patch.filters } : {}),
      ...(patch.order ? { order: patch.order } : {}),
      ...(patch.entryPoint ? { entryPoint: patch.entryPoint } : {}),
    }
    const applied = immutable(
      this.#createAppliedQuery(
        patch.search ?? this.#state.appliedQuery.search,
        patch.filters ?? this.#state.filters,
        patch.order ?? this.#state.order,
        patch.entryPoint ?? this.#state.entryPoint
      )
    )
    const changed =
      this.#queryKey(applied) !== this.#queryKey(this.#state.appliedQuery)
    if (!changed) {
      this.#publish({
        ...criteriaState,
        appliedQuery: applied,
        queryScheduled: false,
        updatingResults: this.#state.replacementStatus === "loading",
      })
      return
    }
    this.#abortListRequests()
    this.#abortDetail()
    const retainedPage = this.#state.confirmedPage ?? this.#state.retainedPage
    this.#publish({
      ...criteriaState,
      appliedQuery: applied,
      queryScheduled: false,
      updatingResults: true,
      replacementStatus: "idle",
      replacementFailure: null,
      appendStatus: "idle",
      appendFailure: null,
      confirmedPage: null,
      retainedPage,
      detail: { status: "idle" },
      focusIntent: focus ? this.#nextFocus(focus) : null,
    })
    if (this.#state.active)
      void this.#startReplacement(applied, "changed-query")
  }

  #startReplacement(
    applied: LibraryDiscoveryAppliedQuery,
    mode: "same-query" | "changed-query"
  ) {
    this.#abortReplacement()
    this.#abortAppend()
    const controller = new AbortController()
    const generation = `library-${this.#lifetime}-${++this.#generation}`
    const request: ReplacementRequest = {
      token: ++this.#requestToken,
      lifetime: this.#lifetime,
      generation,
      queryKey: this.#queryKey(applied),
      controller,
    }
    this.#replacement = request
    this.#publish({
      ...this.#state,
      updatingResults:
        mode === "changed-query" ||
        this.#state.confirmedPage !== null ||
        this.#state.retainedPage !== null,
      replacementStatus: "loading",
      replacementFailure: null,
      appendStatus: "idle",
      appendFailure: null,
    })
    const query = this.#catalogQuery(applied, generation, null)
    return this.#callList(query, controller.signal).then(
      (result) => this.#completeReplacement(request, result),
      (error: unknown) => this.#failReplacement(request, error)
    )
  }

  async #callList(query: LibraryCatalogQuery, signal: AbortSignal) {
    return this.#dependencies.list(query, signal)
  }

  #completeReplacement(request: ReplacementRequest, value: unknown) {
    if (!this.#acceptsReplacement(request)) return
    let result: LibraryDiscoveryListResult
    try {
      result = immutable(libraryDiscoveryListResultSchema.parse(value))
    } catch {
      this.#publishReplacementFailure(
        request,
        invalidResponse("The library returned an invalid results page.")
      )
      return
    }
    const { page, workspaceRevision } = result
    if (page.generation !== request.generation) {
      this.#publishReplacementFailure(
        request,
        invalidResponse("The library results used the wrong generation.")
      )
      return
    }
    const prior = this.#state.confirmedPage
    const priorWorkspaceRevision =
      prior?.workspaceRevision ?? this.#state.retainedPage?.workspaceRevision
    if (
      priorWorkspaceRevision !== undefined &&
      workspaceRevision < priorWorkspaceRevision
    ) {
      this.#publishReplacementFailure(
        request,
        invalidResponse("The library returned an older workspace revision.")
      )
      return
    }
    if (
      prior?.queryKey === request.queryKey &&
      prior.queryIdentity !== page.queryIdentity
    ) {
      this.#publishReplacementFailure(
        request,
        invalidResponse(
          "The library changed identity during a same-query refresh."
        )
      )
      return
    }
    const replacementIdentities = page.items.map((item) => itemIdentity(item))
    if (
      new Set(replacementIdentities).size !== replacementIdentities.length ||
      page.items.length > page.total ||
      (page.nextCursor === null && page.items.length !== page.total) ||
      (page.nextCursor !== null && page.items.length >= page.total)
    ) {
      this.#publishReplacementFailure(
        request,
        invalidResponse("The library results had inconsistent pagination.")
      )
      return
    }
    this.#replacement = null
    const confirmedPage = immutable({
      workspaceRevision,
      catalogRevision: page.catalogRevision,
      generation: page.generation,
      queryIdentity: page.queryIdentity,
      queryKey: request.queryKey,
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    } satisfies LibraryDiscoveryConfirmedPage)
    this.#publish({
      ...this.#state,
      updatingResults: false,
      replacementStatus: "idle",
      replacementFailure: null,
      confirmedPage,
      retainedPage: null,
      announcement: this.#nextAnnouncement(
        `${page.total} result${page.total === 1 ? "" : "s"}.`
      ),
    })
  }

  #failReplacement(request: ReplacementRequest, error: unknown) {
    if (!this.#acceptsReplacement(request)) return
    this.#publishReplacementFailure(
      request,
      requestFailure(error, "The library could not be loaded.")
    )
  }

  #publishReplacementFailure(
    request: ReplacementRequest,
    failure: LibraryDiscoveryFailure
  ) {
    if (!this.#acceptsReplacement(request)) return
    this.#replacement = null
    this.#publish({
      ...this.#state,
      updatingResults: false,
      replacementStatus: "failed",
      replacementFailure: failure,
    })
  }

  #completeAppend(request: AppendRequest, value: unknown) {
    if (!this.#acceptsAppend(request)) return
    let result: LibraryDiscoveryListResult
    try {
      result = immutable(libraryDiscoveryListResultSchema.parse(value))
    } catch {
      this.#publishAppendFailure(
        request,
        invalidResponse("The library returned an invalid next page.")
      )
      return
    }
    const { page, workspaceRevision } = result
    const current = this.#state.confirmedPage
    if (
      !current ||
      workspaceRevision !== request.workspaceRevision ||
      page.generation !== request.generation ||
      page.queryIdentity !== request.queryIdentity ||
      page.catalogRevision !== request.catalogRevision ||
      page.total !== current.total
    ) {
      this.#publishAppendFailure(
        request,
        invalidResponse(
          "The next library page did not match the confirmed results."
        )
      )
      return
    }
    const seen = new Set(current.items.map((item) => itemIdentity(item)))
    const appended = page.items.filter((item) => {
      const identity = itemIdentity(item)
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    if (page.nextCursor === request.cursor) {
      this.#publishAppendFailure(
        request,
        invalidResponse("The next library page repeated its cursor.")
      )
      return
    }
    const combinedCount = current.items.length + appended.length
    if (
      combinedCount > page.total ||
      (page.nextCursor === null && combinedCount !== page.total) ||
      (page.nextCursor !== null && combinedCount >= page.total)
    ) {
      this.#publishAppendFailure(
        request,
        invalidResponse("The next library page had inconsistent pagination.")
      )
      return
    }
    this.#append = null
    const confirmedPage = immutable({
      ...current,
      items: [...current.items, ...appended],
      nextCursor: page.nextCursor,
    })
    this.#publish({
      ...this.#state,
      appendStatus: "idle",
      appendFailure: null,
      confirmedPage,
      announcement: this.#nextAnnouncement(
        `${appended.length} item${appended.length === 1 ? "" : "s"} added.`
      ),
      focusIntent: this.#nextFocus(
        page.nextCursor ? "load-more" : "pagination-status"
      ),
    })
  }

  #failAppend(request: AppendRequest, error: unknown) {
    if (!this.#acceptsAppend(request)) return
    if (cursorReasonFrom(error)) {
      this.#append = null
      return this.#startReplacement(this.#state.appliedQuery, "same-query")
    }
    this.#publishAppendFailure(
      request,
      requestFailure(error, "More library items could not be loaded.")
    )
  }

  #publishAppendFailure(
    request: AppendRequest,
    failure: LibraryDiscoveryFailure
  ) {
    if (!this.#acceptsAppend(request)) return
    this.#append = null
    this.#publish({
      ...this.#state,
      appendStatus: "failed",
      appendFailure: failure,
    })
  }

  #publishDetailFailure(
    request: DetailRequest,
    kind: "template" | "media",
    id: string,
    version: number,
    mediaSource: LibraryMediaSummary["mediaSource"] | undefined,
    failure: LibraryDiscoveryFailure
  ) {
    if (!this.#acceptsDetail(request)) return
    this.#detail = null
    this.#publish({
      ...this.#state,
      detail: {
        status: "failed",
        itemKind: kind,
        id,
        version,
        ...(kind === "media" ? { mediaSource } : {}),
        failure,
      },
    })
  }

  #acceptsReplacement(request: ReplacementRequest) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      this.#replacement?.token === request.token &&
      this.#queryKey(this.#state.appliedQuery) === request.queryKey
    )
  }

  #acceptsAppend(request: AppendRequest) {
    const page = this.#state.confirmedPage
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      this.#append?.token === request.token &&
      page?.queryKey === request.queryKey &&
      page.generation === request.generation &&
      page.queryIdentity === request.queryIdentity &&
      page.workspaceRevision === request.workspaceRevision &&
      page.catalogRevision === request.catalogRevision &&
      page.nextCursor === request.cursor
    )
  }

  #acceptsDetail(request: DetailRequest) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      this.#detail?.token === request.token &&
      this.#detail.identity === request.identity
    )
  }

  #createAppliedQuery(
    search: string,
    filters: LibraryDiscoveryFilters,
    order: LibraryDiscoveryState["order"],
    entryPoint: LibraryDiscoveryEntryPoint
  ): LibraryDiscoveryAppliedQuery {
    return {
      ...filters,
      search: normalizeSearch(search),
      order,
      entryPoint,
      favoritesOnly: entryPoint === "favorites",
      recentOnly: entryPoint === "recent",
    }
  }

  #catalogQuery(
    applied: LibraryDiscoveryAppliedQuery,
    generation: string,
    cursor: string | null
  ): LibraryCatalogQuery {
    return libraryCatalogQuerySchema.parse({
      generation,
      search: applied.search,
      itemKinds: applied.itemKinds,
      categoryIds: applied.categoryIds,
      useCaseIds: applied.useCaseIds,
      formatFamilies: applied.formatFamilies,
      orientations: applied.orientations,
      ownerKinds: applied.ownerKinds,
      favoritesOnly: applied.favoritesOnly,
      recentOnly: applied.recentOnly,
      collectionId: applied.collectionId,
      order:
        applied.entryPoint === "recent"
          ? "recent"
          : applied.entryPoint === "featured"
            ? "curated"
            : applied.order,
      limit: LIBRARY_DISCOVERY_PAGE_SIZE,
      cursor,
    })
  }

  #queryKey(applied: LibraryDiscoveryAppliedQuery) {
    return JSON.stringify(applied)
  }

  #validateFilters(filters: LibraryDiscoveryFilters): LibraryDiscoveryFilters {
    const taxonomy = this.#state.taxonomy
    const valid = {
      categoryIds: new Set(taxonomy.categories.map(({ id }) => id)),
      useCaseIds: new Set(taxonomy.useCases.map(({ id }) => id)),
      formatFamilies: new Set(taxonomy.formatFamilies.map(({ id }) => id)),
      orientations: new Set(taxonomy.orientations.map(({ id }) => id)),
      ownerKinds: new Set(taxonomy.owners.map(({ id }) => id)),
    }
    const normalize = <TValue extends string>(
      values: readonly TValue[],
      allowed: ReadonlySet<string>,
      label: string
    ) => {
      const result = [...new Set(values)].sort()
      const unknown = result.find((value) => !allowed.has(value))
      if (unknown) throw new Error(`Unknown library ${label}: ${unknown}`)
      return result
    }
    return {
      itemKinds: normalize(
        filters.itemKinds,
        new Set(["template", "media"]),
        "item kind"
      ),
      categoryIds: normalize(
        filters.categoryIds,
        valid.categoryIds,
        "category"
      ),
      useCaseIds: normalize(filters.useCaseIds, valid.useCaseIds, "use case"),
      formatFamilies: normalize(
        filters.formatFamilies,
        valid.formatFamilies,
        "format family"
      ),
      orientations: normalize(
        filters.orientations,
        valid.orientations,
        "orientation"
      ),
      ownerKinds: normalize(filters.ownerKinds, valid.ownerKinds, "owner"),
      collectionId:
        filters.collectionId === null
          ? null
          : catalogIdSchema.parse(filters.collectionId),
    }
  }

  #abortReplacement() {
    this.#replacement?.controller.abort()
    this.#replacement = null
  }

  #abortAppend() {
    this.#append?.controller.abort()
    this.#append = null
  }

  #abortListRequests() {
    this.#abortReplacement()
    this.#abortAppend()
  }

  #abortDetail() {
    this.#detail?.controller.abort()
    this.#detail = null
  }

  #cancelSchedule() {
    this.#cancelScheduledQuery?.()
    this.#cancelScheduledQuery = null
  }

  #nextAnnouncement(message: string) {
    return { id: ++this.#announcement, message }
  }

  #nextFocus(target: LibraryDiscoveryFocusTarget, itemIdentityValue?: string) {
    return {
      id: ++this.#focusIntent,
      target,
      ...(itemIdentityValue ? { itemIdentity: itemIdentityValue } : {}),
    }
  }

  #publish(state: LibraryDiscoveryState) {
    this.#state = immutable(state)
    for (const listener of this.#listeners) listener()
  }
}
