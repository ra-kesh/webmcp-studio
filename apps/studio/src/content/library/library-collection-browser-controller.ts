import type {
  LibraryCatalogItemSummary,
  LibraryCatalogQueryInput,
  LibraryCollectionDetail,
  LibraryItemIdentity,
} from "@webmcp/document"
import {
  LIBRARY_COLLECTION_MEMBER_LIMIT,
  libraryItemIdentityKey,
} from "@webmcp/document"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import type {
  LibraryDiscoveryClient,
  LibraryDiscoveryListResult,
} from "./library-discovery-client"

export type LibraryCollectionMember = Readonly<{
  identity: LibraryItemIdentity
  summary: LibraryCatalogItemSummary | null
  name: string
}>

export type LibraryCollectionCatalogFailure = Readonly<{
  message: string
  requestId: string | null
  retryable: boolean
}>

export type LibraryCollectionCatalogState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "loading"
      collectionId: string
      collectionRevision: number
      retained: readonly LibraryCollectionMember[] | null
      retainedCollectionRevision: number | null
    }>
  | Readonly<{
      status: "ready"
      collectionId: string
      collectionRevision: number
      members: readonly LibraryCollectionMember[]
    }>
  | Readonly<{
      status: "failed"
      collectionId: string
      collectionRevision: number
      retained: readonly LibraryCollectionMember[] | null
      retainedCollectionRevision: number | null
      failure: LibraryCollectionCatalogFailure
    }>
  | Readonly<{
      status: "dismissed"
      collectionId: string
      collectionRevision: number
      members: readonly LibraryCollectionMember[] | null
      memberCollectionRevision: number | null
    }>

export type LibraryCollectionBrowserControllerDependencies = Readonly<{
  list: LibraryDiscoveryClient["list"]
}>

type Listener = () => void

const PAGE_SIZE = 50
const MAX_PAGES = Math.ceil(LIBRARY_COLLECTION_MEMBER_LIMIT / PAGE_SIZE)

const identityKey = libraryItemIdentityKey

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const failureFrom = (error: unknown): LibraryCollectionCatalogFailure =>
  error instanceof LibraryDiscoveryHttpError
    ? {
        message: "Studio couldn't load the items in this collection.",
        requestId: error.requestId,
        retryable: error.retryable,
      }
    : {
        message: "Studio couldn't load the items in this collection.",
        requestId: null,
        retryable: true,
      }

const collectionQuery = (
  collectionId: string,
  generation: string,
  cursor: string | null
): LibraryCatalogQueryInput => ({
  generation,
  search: "",
  itemKinds: ["template", "media"],
  categoryIds: [],
  useCaseIds: [],
  formatFamilies: [],
  orientations: [],
  ownerKinds: [],
  favoritesOnly: false,
  recentOnly: false,
  collectionId,
  order: "curated",
  limit: PAGE_SIZE,
  cursor,
})

export class LibraryCollectionBrowserController {
  readonly #dependencies: LibraryCollectionBrowserControllerDependencies
  readonly #listeners = new Set<Listener>()
  #state: LibraryCollectionCatalogState = immutable({ status: "idle" })
  #request: AbortController | null = null
  #generation = 0
  #disposed = false
  #lastDetail: LibraryCollectionDetail | null = null

  constructor(dependencies: LibraryCollectionBrowserControllerDependencies) {
    this.#dependencies = dependencies
  }

  getSnapshot = () => this.#state

  subscribe = (listener: Listener) => {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  load(detail: LibraryCollectionDetail, force = false) {
    if (this.#disposed) return Promise.resolve(false)
    const current = this.#state
    if (
      !force &&
      current.status === "ready" &&
      current.collectionId === detail.summary.id &&
      current.collectionRevision === detail.summary.revision
    ) {
      return Promise.resolve(true)
    }

    this.#lastDetail = detail
    this.#request?.abort()
    const request = new AbortController()
    this.#request = request
    const requestGeneration = ++this.#generation
    const retained =
      current.status !== "idle" && current.collectionId === detail.summary.id
        ? current.status === "ready"
          ? current.members
          : current.status === "dismissed"
            ? current.members
            : current.retained
        : null
    const retainedCollectionRevision =
      retained && current.status !== "idle"
        ? current.status === "ready"
          ? current.collectionRevision
          : current.status === "dismissed"
            ? current.memberCollectionRevision
            : current.retainedCollectionRevision
        : null
    this.#publish({
      status: "loading",
      collectionId: detail.summary.id,
      collectionRevision: detail.summary.revision,
      retained,
      retainedCollectionRevision,
    })

    return this.#loadAll(detail, requestGeneration, request.signal).then(
      (members) => {
        if (!this.#accepts(request, requestGeneration)) return false
        this.#request = null
        this.#publish({
          status: "ready",
          collectionId: detail.summary.id,
          collectionRevision: detail.summary.revision,
          members,
        })
        return true
      },
      (error: unknown) => {
        if (!this.#accepts(request, requestGeneration)) return false
        this.#request = null
        this.#publish({
          status: "failed",
          collectionId: detail.summary.id,
          collectionRevision: detail.summary.revision,
          retained,
          retainedCollectionRevision,
          failure: failureFrom(error),
        })
        return false
      }
    )
  }

  retry() {
    return this.#lastDetail
      ? this.load(this.#lastDetail, true)
      : Promise.resolve(false)
  }

  dismissFailure() {
    if (this.#state.status !== "failed") return
    const failed = this.#state
    this.#request = null
    if (
      failed.retained &&
      failed.retainedCollectionRevision === failed.collectionRevision
    ) {
      this.#publish({
        status: "ready",
        collectionId: failed.collectionId,
        collectionRevision: failed.collectionRevision,
        members: failed.retained,
      })
      return
    }
    this.#publish({
      status: "dismissed",
      collectionId: failed.collectionId,
      collectionRevision: failed.collectionRevision,
      members: failed.retained,
      memberCollectionRevision: failed.retainedCollectionRevision,
    })
  }

  cancel() {
    if (
      this.#state.status === "idle" &&
      this.#request === null &&
      this.#lastDetail === null
    ) {
      return
    }
    this.#generation += 1
    this.#request?.abort()
    this.#request = null
    this.#lastDetail = null
    this.#publish({ status: "idle" })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#request?.abort()
    this.#request = null
    this.#lastDetail = null
    this.#state = immutable({ status: "idle" })
    this.#listeners.clear()
  }

  async #loadAll(
    detail: LibraryCollectionDetail,
    generationNumber: number,
    signal: AbortSignal
  ) {
    const generation = `collection-members-${generationNumber}`
    const summaries = new Map<string, LibraryCatalogItemSummary>()
    let cursor: string | null = null
    let expectedWorkspaceRevision: number | null = null
    let expectedTotal: number | null = null
    let pageCount = 0

    do {
      signal.throwIfAborted()
      if (pageCount >= MAX_PAGES) {
        throw new Error("Collection catalog exceeded the bounded page count.")
      }
      const result: LibraryDiscoveryListResult = await this.#dependencies.list(
        collectionQuery(detail.summary.id, generation, cursor),
        signal
      )
      signal.throwIfAborted()
      expectedWorkspaceRevision ??= result.workspaceRevision
      expectedTotal ??= result.page.total
      if (
        result.workspaceRevision !== expectedWorkspaceRevision ||
        result.page.total !== expectedTotal ||
        result.page.total > LIBRARY_COLLECTION_MEMBER_LIMIT
      ) {
        throw new Error("Collection catalog changed while it was loading.")
      }
      for (const summary of result.page.items) {
        const key = identityKey(summary)
        if (summaries.has(key)) {
          throw new Error("Collection catalog returned a duplicate item.")
        }
        summaries.set(key, summary)
      }
      cursor = result.page.nextCursor
      pageCount += 1
    } while (cursor !== null)

    if (expectedTotal !== summaries.size) {
      throw new Error("Collection catalog returned an incomplete item list.")
    }

    return immutable(
      detail.members.map((identity) => {
        const summary = summaries.get(identityKey(identity)) ?? null
        return {
          identity,
          summary,
          name: summary?.name ?? "Unavailable item",
        }
      })
    )
  }

  #accepts(request: AbortController, generation: number) {
    return (
      !this.#disposed &&
      !request.signal.aborted &&
      this.#request === request &&
      this.#generation === generation
    )
  }

  #publish(state: LibraryCollectionCatalogState) {
    if (this.#disposed) return
    this.#state = immutable(state)
    for (const listener of this.#listeners) listener()
  }
}
