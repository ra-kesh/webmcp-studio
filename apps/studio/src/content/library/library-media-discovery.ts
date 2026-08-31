import type { LibraryMediaDetail, LibraryMediaSummary } from "@webmcp/document"
import type {
  DeviceLocalMediaDiscoveryAdapter,
  DeviceLocalMediaDiscoveryResult,
  DeviceLocalMediaSelectionIdentity,
  ExactDeviceLocalMediaSelection,
} from "./device-local-media-discovery-adapter"
import type {
  LibraryDiscoveryAppliedQuery,
  LibraryDiscoveryConfirmedPage,
} from "./discovery-controller"

export type LibraryMediaSource = LibraryMediaSummary["mediaSource"]

/**
 * Browser identity is deliberately stronger than the server catalog identity.
 * A device-local asset may have the same id and revision as a managed or
 * curated item, but it must never share selection, focus, or preview state.
 */
export const libraryMediaUiIdentity = (
  item: Pick<LibraryMediaSummary, "id" | "version" | "mediaSource">
) => `media:${item.mediaSource}:${item.id}@${item.version}`

const normalizeSearch = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ")

const compareText = (left: string, right: string) =>
  left === right ? 0 : left < right ? -1 : 1

const localMediaMatchesQuery = (
  item: LibraryMediaSummary,
  query: LibraryDiscoveryAppliedQuery
) => {
  if (
    item.mediaSource !== "local" ||
    !query.itemKinds.includes("media") ||
    query.favoritesOnly ||
    query.collectionId !== null ||
    (query.ownerKinds.length > 0 && !query.ownerKinds.includes("workspace"))
  ) {
    return false
  }
  if (
    query.categoryIds.length > 0 &&
    !query.categoryIds.includes(item.categoryId)
  ) {
    return false
  }
  if (
    query.useCaseIds.length > 0 &&
    !query.useCaseIds.some((value) => item.useCaseIds.includes(value))
  ) {
    return false
  }
  if (
    query.formatFamilies.length > 0 &&
    !query.formatFamilies.includes(item.formatFamily)
  ) {
    return false
  }
  if (
    query.orientations.length > 0 &&
    !query.orientations.includes(item.orientation)
  ) {
    return false
  }
  if (query.recentOnly && !item.preferences?.lastUsedAt) return false

  const needle = normalizeSearch(query.search)
  if (!needle) return true
  const haystack = normalizeSearch(
    [
      item.name,
      item.description,
      item.categoryId,
      item.formatFamily,
      ...item.useCaseIds,
      ...item.tags,
    ].join(" ")
  )
  return needle.split(" ").every((term) => haystack.includes(term))
}

export const projectDeviceLocalMediaForQuery = (
  result: DeviceLocalMediaDiscoveryResult,
  query: LibraryDiscoveryAppliedQuery
): DeviceLocalMediaDiscoveryResult => {
  const items = result.items.filter((item) =>
    localMediaMatchesQuery(item, query)
  )
  const order = query.recentOnly ? "recent" : query.order
  items.sort((left, right) => {
    if (order === "recent") {
      const recent = compareText(
        right.preferences?.lastUsedAt ?? "",
        left.preferences?.lastUsedAt ?? ""
      )
      if (recent) return recent
    }
    if (order === "newest") {
      const newest = compareText(right.createdAt, left.createdAt)
      if (newest) return newest
    }
    if (order === "curated" || order === "recent") {
      const leftRank = left.curatedRank ?? Number.MAX_SAFE_INTEGER
      const rightRank = right.curatedRank ?? Number.MAX_SAFE_INTEGER
      if (leftRank !== rightRank) return leftRank - rightRank
    }
    return (
      compareText(left.name.toLowerCase(), right.name.toLowerCase()) ||
      compareText(left.id, right.id) ||
      right.version - left.version
    )
  })
  return Object.freeze({
    items: Object.freeze(items),
    // This is inventory health, not the filtered result count. Preserve it
    // exactly so an empty filtered group cannot hide a partial local scan.
    status: result.status,
  })
}

export type DeviceLocalMediaOverlayFailure = Readonly<{
  message: string
}>

export type DeviceLocalMediaOverlayDetailState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; assetId: string; revision: number }>
  | Readonly<{ status: "ready"; detail: LibraryMediaDetail }>
  | Readonly<{
      status: "failed"
      assetId: string
      revision: number
      failure: DeviceLocalMediaOverlayFailure
    }>

export type DeviceLocalMediaOverlayState = Readonly<{
  active: boolean
  disposed: boolean
  query: LibraryDiscoveryAppliedQuery
  queryKey: string
  status: "idle" | "loading" | "ready" | "failed"
  confirmed: DeviceLocalMediaDiscoveryResult | null
  retained: DeviceLocalMediaDiscoveryResult | null
  failure: DeviceLocalMediaOverlayFailure | null
  detail: DeviceLocalMediaOverlayDetailState
}>

export type ExactDeviceLocalMediaPreview = Readonly<{
  identity: DeviceLocalMediaSelectionIdentity
  blob: Blob
  mimeType: LibraryMediaSummary["mimeType"]
  bytes: number
  width: number
  height: number
}>

type Listener = () => void

type ListRequest = Readonly<{
  token: number
  lifetime: number
  queryKey: string
  controller: AbortController
}>

type DetailRequest = Readonly<{
  token: number
  lifetime: number
  identity: string
  controller: AbortController
}>

type PreviewRequest = Readonly<{
  token: number
  lifetime: number
  queryKey: string
  controller: AbortController
  detachCallerAbort: () => void
}>

const failureFrom = (
  error: unknown,
  fallback: string
): DeviceLocalMediaOverlayFailure => ({
  message: error instanceof Error ? error.message : fallback,
})

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

export class DeviceLocalMediaOverlayController {
  readonly #adapter: DeviceLocalMediaDiscoveryAdapter
  readonly #listeners = new Set<Listener>()
  #state: DeviceLocalMediaOverlayState
  #lifetime = 1
  #token = 0
  #listRequest: ListRequest | null = null
  #detailRequest: DetailRequest | null = null
  #previewRequests = new Map<number, PreviewRequest>()
  #inventory: DeviceLocalMediaDiscoveryResult | null = null

  constructor(
    adapter: DeviceLocalMediaDiscoveryAdapter,
    initialQuery: LibraryDiscoveryAppliedQuery
  ) {
    this.#adapter = adapter
    const query = immutable(structuredClone(initialQuery))
    this.#state = immutable({
      active: false,
      disposed: false,
      query,
      queryKey: this.#key(query),
      status: "idle",
      confirmed: null,
      retained: null,
      failure: null,
      detail: { status: "idle" },
    })
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
    void this.refresh()
  }

  deactivate() {
    if (this.#state.disposed || !this.#state.active) return
    this.#abortRequests()
    this.#publish({
      ...this.#state,
      active: false,
      status: this.#state.confirmed ? "ready" : "idle",
      failure: null,
      detail: { status: "idle" },
    })
  }

  dispose() {
    if (this.#state.disposed) return
    this.#lifetime += 1
    this.#abortRequests()
    this.#publish({
      ...this.#state,
      active: false,
      disposed: true,
      status: "idle",
      failure: null,
      detail: { status: "idle" },
    })
    this.#listeners.clear()
  }

  setQuery(queryInput: LibraryDiscoveryAppliedQuery) {
    if (this.#state.disposed) return
    const query = immutable(structuredClone(queryInput))
    const queryKey = this.#key(query)
    if (queryKey === this.#state.queryKey) return
    this.#abortRequests()
    const retained = this.#inventory
      ? immutable(projectDeviceLocalMediaForQuery(this.#inventory, query))
      : null
    this.#publish({
      ...this.#state,
      query,
      queryKey,
      status: this.#state.active ? "loading" : "idle",
      confirmed: null,
      retained,
      failure: null,
      detail: { status: "idle" },
    })
    if (this.#state.active) void this.#startList()
  }

  refresh() {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    return this.#startList()
  }

  selectItem(assetId: string, revision: number) {
    if (this.#state.disposed || !this.#state.active)
      return Promise.resolve(null)
    this.#detailRequest?.controller.abort()
    const controller = new AbortController()
    const identity = `${assetId}@${revision}`
    const request: DetailRequest = {
      token: ++this.#token,
      lifetime: this.#lifetime,
      identity,
      controller,
    }
    this.#detailRequest = request
    this.#publish({
      ...this.#state,
      detail: { status: "loading", assetId, revision },
    })
    return this.#adapter.getDetail(assetId, revision, controller.signal).then(
      (detail) => {
        if (!this.#acceptsDetail(request)) return null
        if (
          detail.summary.mediaSource !== "local" ||
          detail.summary.id !== assetId ||
          detail.summary.version !== revision ||
          detail.selectionIdentity.source !== "local" ||
          detail.selectionIdentity.assetId !== assetId ||
          detail.selectionIdentity.revision !== revision
        ) {
          return this.#failDetail(
            request,
            assetId,
            revision,
            new Error("Device-local media detail identity did not match.")
          )
        }
        this.#detailRequest = null
        this.#publish({ ...this.#state, detail: { status: "ready", detail } })
        return detail
      },
      (error: unknown) => this.#failDetail(request, assetId, revision, error)
    )
  }

  recheckSelection(
    identity: DeviceLocalMediaSelectionIdentity,
    signal?: AbortSignal
  ): Promise<ExactDeviceLocalMediaSelection> {
    return this.#adapter.recheckSelection(identity, signal)
  }

  async loadPreview(
    identity: DeviceLocalMediaSelectionIdentity,
    signal?: AbortSignal
  ): Promise<ExactDeviceLocalMediaPreview> {
    if (this.#state.disposed || !this.#state.active) {
      throw new DOMException("Media preview owner is not active.", "AbortError")
    }
    signal?.throwIfAborted()
    const controller = new AbortController()
    const relayCallerAbort = () =>
      controller.abort(
        signal?.reason ??
          new DOMException("Media preview was cancelled.", "AbortError")
      )
    signal?.addEventListener("abort", relayCallerAbort, { once: true })
    const request: PreviewRequest = {
      token: ++this.#token,
      lifetime: this.#lifetime,
      queryKey: this.#state.queryKey,
      controller,
      detachCallerAbort: () =>
        signal?.removeEventListener("abort", relayCallerAbort),
    }
    this.#previewRequests.set(request.token, request)
    try {
      const selection = await this.#adapter.recheckSelection(
        identity,
        controller.signal
      )
      controller.signal.throwIfAborted()
      if (!this.#acceptsPreview(request)) {
        throw new DOMException("Media preview became stale.", "AbortError")
      }
      const { record } = selection
      if (
        record.id !== identity.assetId ||
        record.revision !== identity.revision ||
        record.integrity !== "ready" ||
        record.archivedAt !== null ||
        record.blob.size !== record.size ||
        record.mediaType !== selection.detail.summary.mimeType ||
        !Number.isSafeInteger(record.width) ||
        (record.width ?? 0) < 1 ||
        !Number.isSafeInteger(record.height) ||
        (record.height ?? 0) < 1 ||
        record.width !== selection.detail.summary.dimensions.width ||
        record.height !== selection.detail.summary.dimensions.height
      ) {
        throw new Error(
          "Device-local preview identity did not match ready bytes."
        )
      }
      return Object.freeze({
        identity: Object.freeze({ ...identity }),
        blob: record.blob,
        mimeType: selection.detail.summary.mimeType,
        bytes: record.size,
        width: record.width,
        height: record.height,
      })
    } finally {
      request.detachCallerAbort()
      this.#previewRequests.delete(request.token)
    }
  }

  clearSelection() {
    if (this.#state.disposed || this.#state.detail.status === "idle") return
    this.#detailRequest?.controller.abort()
    this.#detailRequest = null
    this.#publish({ ...this.#state, detail: { status: "idle" } })
  }

  async #startList() {
    this.#listRequest?.controller.abort()
    const controller = new AbortController()
    const request: ListRequest = {
      token: ++this.#token,
      lifetime: this.#lifetime,
      queryKey: this.#state.queryKey,
      controller,
    }
    this.#listRequest = request
    this.#publish({ ...this.#state, status: "loading", failure: null })
    try {
      const result = await this.#adapter.list(controller.signal)
      if (!this.#acceptsList(request)) return
      this.#listRequest = null
      this.#inventory = immutable(result)
      const confirmed = immutable(
        projectDeviceLocalMediaForQuery(this.#inventory, this.#state.query)
      )
      this.#publish({
        ...this.#state,
        status: "ready",
        confirmed,
        retained: null,
        failure: null,
      })
    } catch (error) {
      if (!this.#acceptsList(request)) return
      this.#listRequest = null
      this.#publish({
        ...this.#state,
        status: "failed",
        failure: failureFrom(
          error,
          "Device-local media could not be refreshed."
        ),
      })
    }
  }

  #failDetail(
    request: DetailRequest,
    assetId: string,
    revision: number,
    error: unknown
  ) {
    if (!this.#acceptsDetail(request)) return null
    this.#detailRequest = null
    this.#publish({
      ...this.#state,
      detail: {
        status: "failed",
        assetId,
        revision,
        failure: failureFrom(
          error,
          "Device-local media details could not be loaded."
        ),
      },
    })
    return null
  }

  #acceptsList(request: ListRequest) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      this.#listRequest?.token === request.token &&
      this.#state.queryKey === request.queryKey
    )
  }

  #acceptsDetail(request: DetailRequest) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      this.#detailRequest?.token === request.token &&
      this.#detailRequest.identity === request.identity
    )
  }

  #acceptsPreview(request: PreviewRequest) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      request.lifetime === this.#lifetime &&
      request.queryKey === this.#state.queryKey &&
      this.#previewRequests.get(request.token) === request
    )
  }

  #abortRequests() {
    this.#listRequest?.controller.abort()
    this.#listRequest = null
    this.#detailRequest?.controller.abort()
    this.#detailRequest = null
    for (const request of this.#previewRequests.values()) {
      request.controller.abort(
        new DOMException("Media preview owner changed.", "AbortError")
      )
      request.detachCallerAbort()
    }
    this.#previewRequests.clear()
  }

  #publish(state: DeviceLocalMediaOverlayState) {
    this.#state = immutable(state)
    for (const listener of this.#listeners) listener()
  }

  #key(query: LibraryDiscoveryAppliedQuery) {
    return JSON.stringify(query)
  }
}

export type LibraryMediaDiscoveryComposition = Readonly<{
  server: Readonly<{
    page: LibraryDiscoveryConfirmedPage | null
    items: readonly LibraryMediaSummary[]
    total: number
    nextCursor: string | null
  }>
  local: Readonly<{
    result: DeviceLocalMediaDiscoveryResult | null
    items: readonly LibraryMediaSummary[]
  }>
}>

/** Keep the two authorities explicit: local items never affect server totals. */
export function composeLibraryMediaDiscovery(
  page: LibraryDiscoveryConfirmedPage | null,
  local: DeviceLocalMediaDiscoveryResult | null
): LibraryMediaDiscoveryComposition {
  const serverItems = (page?.items ?? []).filter(
    (item): item is LibraryMediaSummary =>
      item.itemKind === "media" && item.mediaSource !== "local"
  )
  return Object.freeze({
    server: Object.freeze({
      page,
      items: Object.freeze(serverItems),
      total: page?.total ?? 0,
      nextCursor: page?.nextCursor ?? null,
    }),
    local: Object.freeze({
      result: local,
      items: local?.items ?? Object.freeze([]),
    }),
  })
}
