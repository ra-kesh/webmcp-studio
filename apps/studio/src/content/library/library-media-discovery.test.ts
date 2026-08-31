import { describe, expect, it, vi } from "vitest"
import {
  libraryCatalogPageSchema,
  projectLocalMediaDetail,
  projectLocalMediaSummary,
} from "@webmcp/document"
import type {
  LibraryCatalogQuery,
  LibraryMediaSummary,
  LocalLibraryMediaMetadata,
} from "@webmcp/document"
import type {
  DeviceLocalMediaDiscoveryAdapter,
  DeviceLocalMediaDiscoveryResult,
} from "./device-local-media-discovery-adapter"
import { LibraryDiscoveryController } from "./discovery-controller"
import type {
  LibraryDiscoveryAppliedQuery,
  LibraryDiscoveryDependencies,
  LibraryTaxonomy,
} from "./discovery-controller"
import { createMediaLibraryDiscoveryController } from "./library-media-discovery-provider"
import {
  composeLibraryMediaDiscovery,
  DeviceLocalMediaOverlayController,
  libraryMediaUiIdentity,
} from "./library-media-discovery"

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
  categories: [{ id: "workspace-upload", label: "Workspace upload" }],
  useCases: [{ id: "proposal", label: "Proposal" }],
  formatFamilies: [{ id: "raster", label: "Raster" }],
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

const metadata: LocalLibraryMediaMetadata = {
  description: "Local campaign photograph",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["campaign", "upload"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    sourceName: "Device-local upload",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
}

const localSource = (id = "asset-collision", revision = 3) => ({
  id,
  name: "Campaign photo",
  mediaType: "image/png" as const,
  size: 4096,
  width: 1200,
  height: 800,
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  lastUsedAt: "2026-08-31T10:00:00.000Z",
  archivedAt: null,
  revision,
  integrity: "ready" as const,
})

const localSummary = (id = "asset-collision", revision = 3) =>
  projectLocalMediaSummary(localSource(id, revision), metadata)

const localResult = (
  items: readonly LibraryMediaSummary[] = [localSummary()],
  issue = "retained-warning"
): DeviceLocalMediaDiscoveryResult => ({
  items,
  status: {
    schemaVersion: 1,
    databaseVersion: 6,
    migrationState: "current",
    legacyRecordCount: 0,
    legacyMetadataRecordCount: 0,
    metadataRecordCount: items.length,
    examinedMetadataCount: items.length,
    unindexedMetadataCount: 0,
    projectedItemCount: items.length,
    archivedRecordCount: 0,
    unavailableRecordCount: 0,
    truncated: false,
    issues: [
      {
        assetId: "asset-warning",
        code: "corrupt_bytes",
        message: issue,
      },
    ],
  },
})

const query = (
  overrides: Partial<LibraryDiscoveryAppliedQuery> = {}
): LibraryDiscoveryAppliedQuery => ({
  search: "",
  itemKinds: ["media"],
  categoryIds: [],
  useCaseIds: [],
  formatFamilies: [],
  orientations: [],
  ownerKinds: [],
  collectionId: null,
  order: "curated",
  entryPoint: "all",
  favoritesOnly: false,
  recentOnly: false,
  ...overrides,
})

const discoveryDependencies = () => {
  const requests: Array<{
    query: LibraryCatalogQuery
    signal: AbortSignal
  }> = []
  const dependencies: LibraryDiscoveryDependencies = {
    list: vi.fn(async (input, signal) => {
      const parsed = input as LibraryCatalogQuery
      requests.push({ query: parsed, signal })
      return {
        workspaceRevision: 1,
        page: libraryCatalogPageSchema.parse({
          schemaVersion: 1,
          catalogRevision: "media-controller-test-v1",
          generation: parsed.generation,
          queryIdentity: `libq_${"a".repeat(16)}`,
          items: [],
          nextCursor: null,
          total: 0,
        }),
      }
    }),
    getDetail: vi.fn(),
    getTaxonomy: () => taxonomy,
    scheduleQuery: (callback) => {
      callback()
      return () => undefined
    },
  }
  return { dependencies, requests }
}

const overlayHarness = () => {
  const lists: Array<{
    signal: AbortSignal | undefined
    deferred: Deferred<DeviceLocalMediaDiscoveryResult>
  }> = []
  const details: Array<{
    assetId: string
    revision: number
    signal: AbortSignal | undefined
    deferred: Deferred<ReturnType<typeof projectLocalMediaDetail>>
  }> = []
  const adapter: DeviceLocalMediaDiscoveryAdapter = {
    list: vi.fn((signal) => {
      const deferred = new Deferred<DeviceLocalMediaDiscoveryResult>()
      lists.push({ signal, deferred })
      return deferred.promise
    }),
    getDetail: vi.fn((assetId, revision, signal) => {
      const deferred = new Deferred<
        ReturnType<typeof projectLocalMediaDetail>
      >()
      details.push({ assetId, revision, signal, deferred })
      return deferred.promise
    }),
    recheckSelection: vi.fn(async (identity) => ({
      detail: projectLocalMediaDetail(
        localSource(identity.assetId, identity.revision),
        metadata
      ),
      record: {
        schemaVersion: 4 as const,
        ...localSource(identity.assetId, identity.revision),
        blob: new Blob([new Uint8Array(4096)], { type: "image/png" }),
      },
    })),
  }
  return { adapter, lists, details }
}

describe("Gate 6D media discovery ownership", () => {
  it("initializes media scope before activation and stays independent of the template controller", async () => {
    const media = discoveryDependencies()
    const templates = discoveryDependencies()
    const mediaController = createMediaLibraryDiscoveryController(
      media.dependencies
    )
    const templateController = new LibraryDiscoveryController(
      templates.dependencies
    )
    templateController.setFilters({ itemKinds: ["template"] })

    expect(mediaController.getSnapshot().active).toBe(false)
    expect(mediaController.getSnapshot().filters.itemKinds).toEqual(["media"])
    expect(templateController.getSnapshot().filters.itemKinds).toEqual([
      "template",
    ])
    expect(media.requests).toHaveLength(0)
    expect(templates.requests).toHaveLength(0)

    mediaController.activate()
    templateController.activate()
    await Promise.resolve()

    expect(media.requests).toHaveLength(1)
    expect(media.requests[0]?.query.itemKinds).toEqual(["media"])
    expect(templates.requests).toHaveLength(1)
    expect(templates.requests[0]?.query.itemKinds).toEqual(["template"])

    mediaController.setFilters({ ownerKinds: ["workspace"] })
    await Promise.resolve()
    expect(mediaController.getSnapshot().filters.ownerKinds).toEqual([
      "workspace",
    ])
    expect(templateController.getSnapshot().filters.ownerKinds).toEqual([])
    expect(templateController.getSnapshot().filters.itemKinds).toEqual([
      "template",
    ])

    mediaController.setFilters({ itemKinds: ["template"] } as never)
    await Promise.resolve()
    expect(mediaController.getSnapshot().filters.itemKinds).toEqual(["media"])
    expect(
      media.requests.every(
        ({ query: requestQuery }) =>
          requestQuery.itemKinds.length === 1 &&
          requestQuery.itemKinds[0] === "media"
      )
    ).toBe(true)
  })

  it("fails closed when the server attempts to return a device-local source", async () => {
    const source = discoveryDependencies()
    const dependencies: LibraryDiscoveryDependencies = {
      ...source.dependencies,
      list: vi.fn(async (input) => {
        const requestQuery = input as LibraryCatalogQuery
        return {
          workspaceRevision: 1,
          page: libraryCatalogPageSchema.parse({
            schemaVersion: 1,
            catalogRevision: "invalid-local-source-v1",
            generation: requestQuery.generation,
            queryIdentity: `libq_${"e".repeat(16)}`,
            items: [localSummary()],
            nextCursor: null,
            total: 1,
          }),
        }
      }),
    }
    const controller = createMediaLibraryDiscoveryController(dependencies)

    controller.activate()
    await vi.waitFor(() =>
      expect(controller.getSnapshot().replacementStatus).toBe("failed")
    )

    expect(controller.getSnapshot()).toMatchObject({
      replacementStatus: "failed",
      confirmedPage: null,
      replacementFailure: {
        message: "Media discovery returned a non-media catalog item.",
      },
    })
    const defensive = composeLibraryMediaDiscovery(
      {
        workspaceRevision: 1,
        catalogRevision: "defensive-v1",
        generation: "defensive-generation",
        queryIdentity: `libq_${"f".repeat(16)}`,
        queryKey: "defensive-query",
        items: [localSummary()],
        nextCursor: null,
        total: 1,
      },
      null
    )
    expect(defensive.server.items).toEqual([])
  })

  it("aborts obsolete local requests, ignores stale results, and retains status on failure", async () => {
    const harness = overlayHarness()
    const controller = new DeviceLocalMediaOverlayController(
      harness.adapter,
      query()
    )
    controller.activate()
    expect(harness.lists).toHaveLength(1)

    controller.setQuery(query({ search: "campaign" }))
    expect(harness.lists).toHaveLength(2)
    expect(harness.lists[0]?.signal?.aborted).toBe(true)

    harness.lists[0]?.deferred.resolve(localResult([], "obsolete"))
    harness.lists[1]?.deferred.resolve(localResult())
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      confirmed: {
        items: [expect.objectContaining({ id: "asset-collision" })],
        status: {
          issues: [expect.objectContaining({ message: "retained-warning" })],
        },
      },
    })

    const refresh = controller.refresh()
    expect(controller.getSnapshot().confirmed).not.toBeNull()
    harness.lists[2]?.deferred.reject(new Error("IndexedDB unavailable"))
    await refresh

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      confirmed: {
        status: {
          issues: [expect.objectContaining({ message: "retained-warning" })],
        },
      },
      failure: { message: "IndexedDB unavailable" },
    })
  })

  it("keeps metadata detail revision exact and rejects a stale completion", async () => {
    const harness = overlayHarness()
    const controller = new DeviceLocalMediaOverlayController(
      harness.adapter,
      query()
    )
    controller.activate()
    harness.lists[0]?.deferred.resolve(localResult())
    await Promise.resolve()

    const first = controller.selectItem("asset-collision", 3)
    const second = controller.selectItem("asset-collision", 4)
    expect(harness.details[0]?.signal?.aborted).toBe(true)
    harness.details[0]?.deferred.resolve(
      projectLocalMediaDetail(localSource("asset-collision", 3), metadata)
    )
    harness.details[1]?.deferred.resolve(
      projectLocalMediaDetail(localSource("asset-collision", 4), metadata)
    )
    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toMatchObject({
      selectionIdentity: {
        source: "local",
        assetId: "asset-collision",
        revision: 4,
      },
    })
    expect(controller.getSnapshot().detail).toMatchObject({
      status: "ready",
      detail: { summary: { version: 4 } },
    })
  })

  it("loads exact preview bytes through a separately countable abortable port", async () => {
    const harness = overlayHarness()
    const controller = new DeviceLocalMediaOverlayController(
      harness.adapter,
      query()
    )
    controller.activate()
    harness.lists[0]?.deferred.resolve(localResult())
    await Promise.resolve()
    const signal = new AbortController().signal

    const preview = await controller.loadPreview(
      {
        source: "local",
        assetId: "asset-collision",
        revision: 3,
      },
      signal
    )

    expect(harness.adapter.recheckSelection).toHaveBeenCalledTimes(1)
    expect(harness.adapter.recheckSelection).toHaveBeenCalledWith(
      {
        source: "local",
        assetId: "asset-collision",
        revision: 3,
      },
      expect.any(AbortSignal)
    )
    const carriedSignal = vi.mocked(harness.adapter.recheckSelection).mock
      .calls[0]?.[1]
    expect(carriedSignal).not.toBe(signal)
    expect(carriedSignal?.aborted).toBe(false)
    expect(harness.adapter.list).toHaveBeenCalledTimes(1)
    expect(harness.adapter.getDetail).not.toHaveBeenCalled()
    expect(preview).toMatchObject({
      identity: {
        source: "local",
        assetId: "asset-collision",
        revision: 3,
      },
      mimeType: "image/png",
      bytes: 4096,
      width: 1200,
      height: 800,
    })
    expect(preview.blob).toBeInstanceOf(Blob)

    const aborted = new AbortController()
    aborted.abort(new DOMException("Preview left viewport", "AbortError"))
    await expect(
      controller.loadPreview(
        {
          source: "local",
          assetId: "asset-collision",
          revision: 3,
        },
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(harness.adapter.recheckSelection).toHaveBeenCalledTimes(1)
  })

  it("owns concurrent preview requests and aborts stale work on query, visibility, and lifetime transitions", async () => {
    const harness = overlayHarness()
    const selections: Array<{
      signal: AbortSignal | undefined
      deferred: Deferred<
        Awaited<
          ReturnType<DeviceLocalMediaDiscoveryAdapter["recheckSelection"]>
        >
      >
    }> = []
    const adapter: DeviceLocalMediaDiscoveryAdapter = {
      ...harness.adapter,
      recheckSelection: vi.fn((_identity, signal) => {
        const deferred = new Deferred<
          Awaited<
            ReturnType<DeviceLocalMediaDiscoveryAdapter["recheckSelection"]>
          >
        >()
        selections.push({ signal, deferred })
        return deferred.promise
      }),
    }
    const exact = (revision: number) => ({
      detail: projectLocalMediaDetail(
        localSource("asset-collision", revision),
        metadata
      ),
      record: {
        schemaVersion: 4 as const,
        ...localSource("asset-collision", revision),
        blob: new Blob([new Uint8Array(4096)], { type: "image/png" }),
      },
    })
    const controller = new DeviceLocalMediaOverlayController(adapter, query())
    controller.activate()
    harness.lists[0]?.deferred.resolve(localResult())
    await Promise.resolve()

    const first = controller.loadPreview({
      source: "local",
      assetId: "asset-collision",
      revision: 3,
    })
    const second = controller.loadPreview({
      source: "local",
      assetId: "asset-collision",
      revision: 4,
    })
    expect(selections).toHaveLength(2)
    expect(selections.every(({ signal }) => signal?.aborted === false)).toBe(
      true
    )

    const caller = new AbortController()
    const callerCancelled = controller.loadPreview(
      {
        source: "local",
        assetId: "asset-collision",
        revision: 5,
      },
      caller.signal
    )
    caller.abort(new DOMException("Card left viewport", "AbortError"))
    expect(selections[2]?.signal?.aborted).toBe(true)
    selections[2]?.deferred.resolve(exact(5))
    await expect(callerCancelled).rejects.toMatchObject({ name: "AbortError" })

    controller.setQuery(query({ ownerKinds: ["studio"] }))
    expect(selections.every(({ signal }) => signal?.aborted === true)).toBe(
      true
    )
    selections[0]?.deferred.resolve(exact(3))
    selections[1]?.deferred.resolve(exact(4))
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    await expect(second).rejects.toMatchObject({ name: "AbortError" })

    harness.lists[1]?.deferred.resolve(localResult())
    await Promise.resolve()
    const hidden = controller.loadPreview({
      source: "local",
      assetId: "asset-collision",
      revision: 3,
    })
    controller.deactivate()
    expect(selections[3]?.signal?.aborted).toBe(true)
    selections[3]?.deferred.resolve(exact(3))
    await expect(hidden).rejects.toMatchObject({ name: "AbortError" })

    controller.activate()
    harness.lists[2]?.deferred.resolve(localResult())
    await Promise.resolve()
    const disposed = controller.loadPreview({
      source: "local",
      assetId: "asset-collision",
      revision: 3,
    })
    controller.dispose()
    expect(selections[4]?.signal?.aborted).toBe(true)
    selections[4]?.deferred.resolve(exact(3))
    await expect(disposed).rejects.toMatchObject({ name: "AbortError" })
    await expect(
      controller.loadPreview({
        source: "local",
        assetId: "asset-collision",
        revision: 3,
      })
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps local source identity separate and outside server cursor math", () => {
    const local = localSummary("asset-collision", 3)
    const managed = { ...local, mediaSource: "managed" as const }
    const page = {
      workspaceRevision: 9,
      catalogRevision: "catalog-v9",
      generation: "media-generation",
      queryIdentity: `libq_${"b".repeat(16)}`,
      queryKey: "media-query",
      items: [managed],
      nextCursor: "next-server-page",
      total: 37,
    }
    const composition = composeLibraryMediaDiscovery(page, localResult([local]))

    expect(libraryMediaUiIdentity(managed)).toBe(
      "media:managed:asset-collision@3"
    )
    expect(libraryMediaUiIdentity(local)).toBe("media:local:asset-collision@3")
    expect(composition.server).toMatchObject({
      items: [managed],
      total: 37,
      nextCursor: "next-server-page",
    })
    expect(composition.local.items).toEqual([local])
  })

  it("composes retained server and local results after both refreshes fail", async () => {
    const retainedLocal = localResult()
    const harness = overlayHarness()
    const overlay = new DeviceLocalMediaOverlayController(
      harness.adapter,
      query()
    )
    overlay.activate()
    harness.lists[0]?.deferred.resolve(retainedLocal)
    await Promise.resolve()
    await Promise.resolve()

    const retainedServer = {
      workspaceRevision: 4,
      catalogRevision: "catalog-retained-v4",
      generation: "retained-generation",
      queryIdentity: `libq_${"d".repeat(16)}`,
      queryKey: "retained-query",
      items: [{ ...localSummary(), mediaSource: "managed" as const }],
      nextCursor: "retained-cursor",
      total: 8,
    }
    const refresh = overlay.refresh()
    harness.lists[1]?.deferred.reject(new Error("Local refresh failed"))
    await refresh

    const local =
      overlay.getSnapshot().confirmed ?? overlay.getSnapshot().retained
    const composition = composeLibraryMediaDiscovery(retainedServer, local)
    expect(overlay.getSnapshot()).toMatchObject({
      status: "failed",
      failure: { message: "Local refresh failed" },
    })
    expect(composition.server).toMatchObject({
      total: 8,
      nextCursor: "retained-cursor",
      items: [expect.objectContaining({ mediaSource: "managed" })],
    })
    expect(composition.local).toMatchObject({
      items: [expect.objectContaining({ mediaSource: "local" })],
      result: {
        status: {
          issues: [expect.objectContaining({ message: "retained-warning" })],
        },
      },
    })
  })

  it("excludes local media from durable and Studio-only scopes without hiding inventory health", () => {
    const source = localResult()
    const harness = overlayHarness()
    const controller = new DeviceLocalMediaOverlayController(
      harness.adapter,
      query({ entryPoint: "favorites", favoritesOnly: true })
    )
    controller.activate()
    harness.lists[0]?.deferred.resolve(source)

    return Promise.resolve().then(() => {
      expect(controller.getSnapshot().confirmed).toMatchObject({
        items: [],
        status: {
          projectedItemCount: 1,
          issues: [expect.objectContaining({ message: "retained-warning" })],
        },
      })
    })
  })

  it.each([
    ["Library", query({ ownerKinds: ["studio"] })],
    ["Favorites", query({ entryPoint: "favorites", favoritesOnly: true })],
    ["collection", query({ collectionId: "collection-1" })],
  ])(
    "reprojects retained Uploads inventory before a failed %s refresh",
    async (_label, nextQuery) => {
      const harness = overlayHarness()
      const controller = new DeviceLocalMediaOverlayController(
        harness.adapter,
        query({ ownerKinds: ["workspace"] })
      )
      controller.activate()
      harness.lists[0]?.deferred.resolve(localResult())
      await Promise.resolve()
      await Promise.resolve()
      expect(controller.getSnapshot().confirmed?.items).toHaveLength(1)

      controller.setQuery(nextQuery)
      expect(controller.getSnapshot().retained).toMatchObject({
        items: [],
        status: {
          issues: [expect.objectContaining({ message: "retained-warning" })],
        },
      })
      harness.lists[1]?.deferred.reject(new Error("Scoped refresh failed"))
      await Promise.resolve()
      await Promise.resolve()
      expect(controller.getSnapshot()).toMatchObject({
        status: "failed",
        retained: { items: [] },
        failure: { message: "Scoped refresh failed" },
      })
    }
  )
})
