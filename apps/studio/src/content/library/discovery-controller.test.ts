import { describe, expect, it, vi } from "vitest"
import {
  libraryMediaDetailSchema,
  libraryMediaSummarySchema,
  libraryCatalogPageSchema,
} from "@webmcp/document"
import type {
  LibraryCatalogItemDetail,
  LibraryCatalogPage,
  LibraryCatalogQuery,
} from "@webmcp/document"
import {
  LIBRARY_DISCOVERY_PAGE_SIZE,
  LIBRARY_DISCOVERY_QUERY_DELAY_MS,
  LibraryDiscoveryController,
} from "./discovery-controller"
import type {
  LibraryDiscoveryDependencies,
  LibraryTaxonomy,
} from "./discovery-controller"

class Deferred<TValue> {
  readonly promise: Promise<TValue>
  resolve!: (value: TValue) => void
  reject!: (reason?: unknown) => void

  constructor() {
    this.promise = new Promise<TValue>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

const taxonomy: LibraryTaxonomy = {
  schemaVersion: 1,
  categories: [
    { id: "photograph", label: "Photos" },
    { id: "illustration", label: "Illustrations" },
  ],
  useCases: [
    { id: "proposal", label: "Proposals" },
    { id: "social-post", label: "Social posts" },
  ],
  formatFamilies: [
    { id: "raster", label: "Raster" },
    { id: "vector", label: "Vector" },
  ],
  orientations: [
    { id: "portrait", label: "Portrait" },
    { id: "landscape", label: "Landscape" },
    { id: "square", label: "Square" },
    { id: "mixed", label: "Mixed" },
  ],
  owners: [
    { id: "studio", label: "Studio" },
    { id: "workspace", label: "Your workspace" },
  ],
}

const mediaSummary = (id: string, version = 1) =>
  libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id,
    version,
    mediaSource: "curated",
    name: id.replaceAll("-", " "),
    description: `Description for ${id}`,
    categoryId: "photograph",
    useCaseIds: ["proposal"],
    formatFamily: "raster",
    orientation: "landscape",
    mimeType: "image/jpeg",
    dimensions: { width: 1600, height: 900 },
    bytes: 1_024,
    selectable: true,
    tags: ["photo", "proposal"],
    owner: { kind: "studio" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: true,
      canAddToCollection: true,
    },
    provenance: {
      sourceName: "Studio originals",
      sourceUrl: null,
      license: { id: "studio-original", name: "Studio original", url: null },
      attribution: { required: false, text: null },
      contentSha256: "a".repeat(64),
    },
    compatibility: {
      availability: "available",
      requirements: [],
      supportedActions: ["insert", "replace"],
      reason: null,
    },
    preview: {
      kind: "live_fallback",
      itemId: id,
      itemVersion: version,
      pageId: null,
      width: 1600,
      height: 900,
      resourcePath: null,
      mediaType: null,
      contentSha256: null,
      rendererRevision: null,
    },
    preferences: null,
    catalogStatus: "active",
    curatedRank: 0,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  })

const mediaDetail = (id: string, version = 1) =>
  libraryMediaDetailSchema.parse({
    schemaVersion: 1,
    summary: mediaSummary(id, version),
    selectionIdentity: { source: "curated", assetId: id, version },
  })

const queryIdentity = (query: LibraryCatalogQuery) => {
  const source = JSON.stringify({
    search: query.search,
    itemKinds: query.itemKinds,
    categoryIds: query.categoryIds,
    useCaseIds: query.useCaseIds,
    formatFamilies: query.formatFamilies,
    orientations: query.orientations,
    ownerKinds: query.ownerKinds,
    favoritesOnly: query.favoritesOnly,
    collectionId: query.collectionId,
    order: query.order,
    limit: query.limit,
  })
  let hash = 0
  for (const character of source)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `libq_${hash.toString(16).padStart(16, "0")}`
}

const pageFor = (
  query: LibraryCatalogQuery,
  items: readonly ReturnType<typeof mediaSummary>[],
  options: {
    cursor?: string | null
    total?: number
    queryIdentity?: string
    generation?: string
    catalogRevision?: string
  } = {}
) =>
  libraryCatalogPageSchema.parse({
    schemaVersion: 1,
    catalogRevision: options.catalogRevision ?? "test-catalog-v1",
    generation: options.generation ?? query.generation,
    queryIdentity: options.queryIdentity ?? queryIdentity(query),
    items,
    nextCursor: options.cursor ?? null,
    total: options.total ?? items.length,
  })

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const createHarness = () => {
  const listRequests: Array<{
    query: LibraryCatalogQuery
    signal: AbortSignal
    deferred: Deferred<LibraryCatalogPage>
  }> = []
  const detailRequests: Array<{
    kind: "template" | "media"
    id: string
    version: number
    signal: AbortSignal
    deferred: Deferred<LibraryCatalogItemDetail>
  }> = []
  const scheduled: Array<{
    callback: () => void
    delay: number
    cancelled: boolean
  }> = []
  const dependencies: LibraryDiscoveryDependencies = {
    list: vi.fn((query, signal) => {
      const deferred = new Deferred<LibraryCatalogPage>()
      listRequests.push({
        query: query as LibraryCatalogQuery,
        signal,
        deferred,
      })
      return deferred.promise
    }),
    getDetail: vi.fn((kind, id, version, signal) => {
      const deferred = new Deferred<LibraryCatalogItemDetail>()
      detailRequests.push({ kind, id, version, signal, deferred })
      return deferred.promise
    }),
    getTaxonomy: vi.fn(() => taxonomy),
    scheduleQuery: vi.fn((callback, delay) => {
      const scheduledQuery = { callback, delay, cancelled: false }
      scheduled.push(scheduledQuery)
      return () => {
        scheduledQuery.cancelled = true
      }
    }),
  }
  const controller = new LibraryDiscoveryController(dependencies)
  return { controller, dependencies, listRequests, detailRequests, scheduled }
}

describe("LibraryDiscoveryController taxonomy and query ownership", () => {
  it("validates a complete immutable taxonomy and exact ownership labels", () => {
    const harness = createHarness()
    expect(harness.controller.getSnapshot().taxonomy).toEqual(taxonomy)
    expect(Object.isFrozen(harness.controller.getSnapshot().taxonomy)).toBe(
      true
    )
    expect(harness.dependencies.list).not.toHaveBeenCalled()

    expect(
      () =>
        new LibraryDiscoveryController({
          ...harness.dependencies,
          getTaxonomy: () => ({
            ...taxonomy,
            orientations: taxonomy.orientations.slice(0, 3),
          }),
        })
    ).toThrow("every catalog orientation")
    expect(
      () =>
        new LibraryDiscoveryController({
          ...harness.dependencies,
          getTaxonomy: () => ({
            ...taxonomy,
            owners: [
              { id: "studio", label: "Us" },
              { id: "workspace", label: "You" },
            ],
          }),
        })
    ).toThrow("Ownership labels")
  })

  it("keeps raw search separate, labels retained results, and rejects aborted generations", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    expect(initial.query).toMatchObject({
      search: "",
      generation: "library-1-1",
      limit: LIBRARY_DISCOVERY_PAGE_SIZE,
    })
    initial.deferred.resolve(
      pageFor(initial.query, [mediaSummary("initial-photo")])
    )
    await flush()

    harness.controller.setRawSearch("  Photo   Story ")
    expect(harness.controller.getSnapshot()).toMatchObject({
      rawSearch: "  Photo   Story ",
      appliedQuery: { search: "" },
      queryScheduled: true,
      updatingResults: true,
    })
    expect(harness.scheduled[0]?.delay).toBe(LIBRARY_DISCOVERY_QUERY_DELAY_MS)
    harness.scheduled[0]?.callback()
    const photoRequest = harness.listRequests[1]
    expect(photoRequest.query.search).toBe("photo story")
    expect(harness.controller.getSnapshot()).toMatchObject({
      confirmedPage: null,
      retainedPage: { items: [{ id: "initial-photo" }] },
      replacementStatus: "loading",
      updatingResults: true,
    })

    harness.controller.setRawSearch("video")
    expect(photoRequest.signal.aborted).toBe(true)
    harness.scheduled[1]?.callback()
    const videoRequest = harness.listRequests[2]
    photoRequest.deferred.resolve(
      pageFor(photoRequest.query, [mediaSummary("stale-photo")])
    )
    videoRequest.deferred.resolve(
      pageFor(videoRequest.query, [mediaSummary("current-video")])
    )
    await flush()

    expect(harness.controller.getSnapshot()).toMatchObject({
      appliedQuery: { search: "video" },
      updatingResults: false,
      replacementStatus: "idle",
      retainedPage: null,
      confirmedPage: { items: [{ id: "current-video" }] },
      announcement: { message: "1 result." },
    })
  })

  it("retains a confirmed grid through same-query refresh failure", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(pageFor(initial.query, [mediaSummary("retained")]))
    await flush()

    const refresh = harness.controller.refresh()
    expect(harness.controller.getSnapshot()).toMatchObject({
      confirmedPage: { items: [{ id: "retained" }] },
      updatingResults: true,
      replacementStatus: "loading",
      appendFailure: null,
    })
    harness.listRequests[1].deferred.reject(new Error("catalog offline"))
    await refresh
    expect(harness.controller.getSnapshot()).toMatchObject({
      confirmedPage: { items: [{ id: "retained" }] },
      retainedPage: null,
      updatingResults: false,
      replacementStatus: "failed",
      replacementFailure: {
        kind: "request_failed",
        message: "catalog offline",
      },
      appendFailure: null,
    })
  })

  it("accepts a new catalog revision on refresh and rejects the old append", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(
      pageFor(initial.query, [mediaSummary("old-first")], {
        cursor: "old-page-2",
        total: 2,
        catalogRevision: "catalog-rev-1",
      })
    )
    await flush()

    const oldAppendPromise = harness.controller.loadMore()
    const oldAppend = harness.listRequests[1]
    const refreshPromise = harness.controller.refresh()
    const refresh = harness.listRequests[2]
    expect(oldAppend.signal.aborted).toBe(true)
    refresh.deferred.resolve(
      pageFor(refresh.query, [mediaSummary("new-only")], {
        catalogRevision: "catalog-rev-2",
      })
    )
    oldAppend.deferred.resolve(
      pageFor(oldAppend.query, [mediaSummary("old-late")], {
        total: 2,
        queryIdentity: queryIdentity(oldAppend.query),
        catalogRevision: "catalog-rev-1",
      })
    )
    await Promise.all([oldAppendPromise, refreshPromise])

    expect(harness.controller.getSnapshot().confirmedPage).toMatchObject({
      catalogRevision: "catalog-rev-2",
      items: [{ id: "new-only" }],
    })
  })

  it("preserves search focus through debounced replacement and automatic detail loading", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].deferred.resolve(
      pageFor(harness.listRequests[0].query, [mediaSummary("initial")])
    )
    await flush()
    harness.controller.clearFocusIntent(
      harness.controller.getSnapshot().focusIntent?.id ?? -1
    )

    harness.controller.setRawSearch("pho")
    harness.controller.setRawSearch("photo")
    expect(harness.scheduled[0]?.cancelled).toBe(true)
    harness.scheduled.at(-1)?.callback()
    const replacement = harness.listRequests.at(-1)!
    replacement.deferred.resolve(
      pageFor(replacement.query, [mediaSummary("photo-result")])
    )
    await flush()
    expect(harness.controller.getSnapshot().focusIntent).toBeNull()

    const detailPromise = harness.controller.selectItem(
      "media",
      "photo-result",
      1
    )
    harness.detailRequests.at(-1)!.deferred.resolve(mediaDetail("photo-result"))
    await detailPromise
    expect(harness.controller.getSnapshot().focusIntent).toBeNull()
  })

  it("restarts an aborted empty load when raw search returns to the applied query", () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]

    harness.controller.setRawSearch("draft")
    expect(initial.signal.aborted).toBe(true)
    harness.controller.setRawSearch("")

    expect(harness.scheduled[0]?.cancelled).toBe(true)
    expect(harness.listRequests).toHaveLength(2)
    expect(harness.listRequests[1].query).toMatchObject({
      search: "",
      generation: "library-1-2",
    })
    expect(harness.controller.getSnapshot()).toMatchObject({
      queryScheduled: false,
      replacementStatus: "loading",
      updatingResults: false,
    })
  })

  it("projects filters, order, and entry points into exact catalog queries", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(pageFor(initial.query, [mediaSummary("first")]))
    await flush()

    harness.controller.setFilters({
      itemKinds: ["media"],
      categoryIds: ["photograph"],
      useCaseIds: ["proposal"],
      formatFamilies: ["raster"],
      orientations: ["landscape"],
      ownerKinds: ["studio"],
      collectionId: "campaign-2026",
    })
    expect(harness.listRequests[1].query).toMatchObject({
      itemKinds: ["media"],
      categoryIds: ["photograph"],
      useCaseIds: ["proposal"],
      formatFamilies: ["raster"],
      orientations: ["landscape"],
      ownerKinds: ["studio"],
      collectionId: "campaign-2026",
      order: "curated",
    })
    expect(harness.controller.getSnapshot().focusIntent?.target).toBe("results")

    harness.controller.setEntryPoint("favorites")
    expect(harness.listRequests[1].signal.aborted).toBe(true)
    expect(harness.listRequests[2].query.favoritesOnly).toBe(true)
    harness.controller.setOrder("newest")
    expect(harness.listRequests[2].signal.aborted).toBe(true)
    expect(harness.listRequests[3].query).toMatchObject({
      favoritesOnly: true,
      order: "newest",
    })
    harness.controller.setEntryPoint("recent")
    expect(harness.listRequests[4].query).toMatchObject({
      favoritesOnly: false,
      order: "recent",
    })
    expect(() =>
      harness.controller.setFilters({ categoryIds: ["private-category"] })
    ).toThrow("Unknown library category")
    expect(() =>
      harness.controller.setFilters({ collectionId: "not a valid id" })
    ).toThrow()
  })

  it("folds pending search into a filter change without an intermediate request", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].deferred.resolve(
      pageFor(harness.listRequests[0].query, [mediaSummary("first")])
    )
    await flush()

    harness.controller.setRawSearch("proposal")
    harness.controller.setFilters({ itemKinds: ["template"] })

    expect(harness.scheduled[0]?.cancelled).toBe(true)
    expect(harness.listRequests).toHaveLength(2)
    expect(harness.listRequests[1].query).toMatchObject({
      search: "proposal",
      itemKinds: ["template"],
    })
    expect(harness.controller.getSnapshot().queryScheduled).toBe(false)
  })

  it("rejects schema-valid replacement pages with inconsistent pagination", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const request = harness.listRequests[0]
    request.deferred.resolve(
      pageFor(request.query, [mediaSummary("only-item")], { total: 2 })
    )
    await flush()

    expect(harness.controller.getSnapshot()).toMatchObject({
      confirmedPage: null,
      replacementStatus: "failed",
      replacementFailure: {
        kind: "invalid_response",
        message: "The library results had inconsistent pagination.",
      },
    })
  })
})

describe("LibraryDiscoveryController pagination, details, and lifetime", () => {
  it("reuses confirmed cursor identity, deduplicates append rows, and moves focus", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(
      pageFor(initial.query, [mediaSummary("a"), mediaSummary("b")], {
        cursor: "cursor-page-2",
        total: 3,
      })
    )
    await flush()
    const confirmed = harness.controller.getSnapshot().confirmedPage!

    const loadMore = harness.controller.loadMore()
    const append = harness.listRequests[1]
    expect(append.query).toMatchObject({
      generation: confirmed.generation,
      cursor: "cursor-page-2",
    })
    append.deferred.resolve(
      pageFor(append.query, [mediaSummary("b"), mediaSummary("c")], {
        cursor: null,
        total: 3,
        queryIdentity: confirmed.queryIdentity,
        catalogRevision: confirmed.catalogRevision,
      })
    )
    await loadMore

    expect(
      harness.controller.getSnapshot().confirmedPage?.items.map(({ id }) => id)
    ).toEqual(["a", "b", "c"])
    expect(harness.controller.getSnapshot()).toMatchObject({
      appendStatus: "idle",
      appendFailure: null,
      announcement: { message: "1 item added." },
      focusIntent: { target: "pagination-status" },
    })
  })

  it("keeps append failures separate and ignores a late page after query replacement", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(
      pageFor(initial.query, [mediaSummary("a")], {
        cursor: "cursor-page-2",
        total: 2,
      })
    )
    await flush()

    const failedAppend = harness.controller.loadMore()
    const append = harness.listRequests[1]
    append.deferred.resolve(
      pageFor(append.query, [mediaSummary("b")], {
        cursor: "cursor-page-2",
        total: 2,
        queryIdentity:
          harness.controller.getSnapshot().confirmedPage!.queryIdentity,
      })
    )
    await failedAppend
    expect(harness.controller.getSnapshot()).toMatchObject({
      replacementFailure: null,
      appendStatus: "failed",
      appendFailure: { kind: "invalid_response" },
      confirmedPage: { items: [{ id: "a" }] },
    })

    const retry = harness.controller.loadMore()
    const lateAppend = harness.listRequests[2]
    harness.controller.setRawSearch("new query")
    expect(lateAppend.signal.aborted).toBe(true)
    lateAppend.deferred.resolve(
      pageFor(lateAppend.query, [mediaSummary("too-late")], {
        total: 2,
        queryIdentity:
          harness.controller.getSnapshot().retainedPage?.queryIdentity,
      })
    )
    await retry
    expect(
      harness.controller
        .getSnapshot()
        .confirmedPage?.items.some(({ id }) => id === "too-late")
    ).not.toBe(true)
  })

  it("rejects an early terminal append that does not satisfy the confirmed total", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const initial = harness.listRequests[0]
    initial.deferred.resolve(
      pageFor(initial.query, [mediaSummary("a")], {
        cursor: "cursor-page-2",
        total: 3,
      })
    )
    await flush()

    const loadMore = harness.controller.loadMore()
    const append = harness.listRequests[1]
    append.deferred.resolve(
      pageFor(append.query, [mediaSummary("b")], {
        cursor: null,
        total: 3,
        queryIdentity:
          harness.controller.getSnapshot().confirmedPage!.queryIdentity,
      })
    )
    await loadMore

    expect(harness.controller.getSnapshot()).toMatchObject({
      confirmedPage: { items: [{ id: "a" }] },
      appendStatus: "failed",
      appendFailure: {
        kind: "invalid_response",
        message: "The next library page had inconsistent pagination.",
      },
    })
  })

  it("aborts superseded detail reads and validates the exact detail identity", async () => {
    const harness = createHarness()
    harness.controller.activate()

    const first = harness.controller.selectItem("media", "first", 1)
    const firstRequest = harness.detailRequests[0]
    const second = harness.controller.selectItem("media", "second", 2, {
      requestFocus: true,
    })
    const secondRequest = harness.detailRequests[1]
    expect(firstRequest.signal.aborted).toBe(true)
    firstRequest.deferred.resolve(mediaDetail("first"))
    secondRequest.deferred.resolve(mediaDetail("second", 2))
    await Promise.all([first, second])
    expect(harness.controller.getSnapshot()).toMatchObject({
      detail: {
        status: "ready",
        detail: { summary: { id: "second", version: 2 } },
      },
      focusIntent: { target: "item", itemIdentity: "media:second@2" },
    })

    const wrong = harness.controller.selectItem("media", "expected", 1)
    harness.detailRequests[2].deferred.resolve(mediaDetail("different"))
    await wrong
    expect(harness.controller.getSnapshot()).toMatchObject({
      detail: {
        status: "failed",
        failure: { kind: "invalid_response" },
      },
    })
  })

  it("aborts all owners on disposal and rejects late lifetime completions", async () => {
    const harness = createHarness()
    const listener = vi.fn()
    harness.controller.subscribe(listener)
    harness.controller.activate()
    const listRequest = harness.listRequests[0]
    const detailPromise = harness.controller.selectItem("media", "selected", 1)
    const detailRequest = harness.detailRequests[0]
    const notifications = listener.mock.calls.length

    harness.controller.dispose()
    harness.controller.dispose()
    expect(listRequest.signal.aborted).toBe(true)
    expect(detailRequest.signal.aborted).toBe(true)
    listRequest.deferred.resolve(
      pageFor(listRequest.query, [mediaSummary("late")])
    )
    detailRequest.deferred.resolve(mediaDetail("selected"))
    await detailPromise
    await flush()

    expect(harness.controller.getSnapshot()).toMatchObject({
      active: false,
      disposed: true,
      confirmedPage: null,
      detail: { status: "idle" },
    })
    expect(listener).toHaveBeenCalledTimes(notifications + 1)
  })
})
