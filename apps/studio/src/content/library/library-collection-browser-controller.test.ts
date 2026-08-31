import { describe, expect, it, vi } from "vitest"
import type {
  LibraryCatalogItemSummary,
  LibraryCatalogQueryInput,
  LibraryCollectionDetail,
} from "@webmcp/document"
import { LibraryCollectionBrowserController } from "./library-collection-browser-controller"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import { catalogTemplates } from "./library-template-browser.test-support"

const collection = (
  members = catalogTemplates.slice(0, 2)
): LibraryCollectionDetail => ({
  summary: {
    id: "collection-campaign",
    name: "Campaign",
    scope: "workspace",
    revision: 3,
    itemCount: members.length,
    createdAt: "2026-08-31T09:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
  },
  members: members.map(({ itemKind, id, version }) => ({
    itemKind,
    id,
    version,
  })),
})

const page = (
  query: LibraryCatalogQueryInput,
  items: readonly LibraryCatalogItemSummary[],
  total = items.length,
  nextCursor: string | null = null
) => ({
  workspaceRevision: 7,
  page: {
    schemaVersion: 1 as const,
    catalogRevision: "collection-catalog-r1",
    generation: query.generation,
    queryIdentity: "libq_0123456789abcdef",
    items: [...items],
    nextCursor,
    total,
  },
})

describe("LibraryCollectionBrowserController", () => {
  it("loads names through bounded collection paging and preserves server detail order", async () => {
    const first = catalogTemplates[0]
    const second = catalogTemplates[1]
    const detail = collection([second, first])
    const list = vi.fn(
      async (query: LibraryCatalogQueryInput, _signal: AbortSignal) =>
        query.cursor
          ? page(query, [second], 2, null)
          : page(query, [first], 2, "next-page")
    )
    const controller = new LibraryCollectionBrowserController({ list })

    await expect(controller.load(detail)).resolves.toBe(true)

    const state = controller.getSnapshot()
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.members.map(({ name }) => name)).toEqual([
      second.name,
      first.name,
    ])
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[0]?.[0]).toMatchObject({
      collectionId: "collection-campaign",
      itemKinds: ["template", "media"],
      limit: 50,
      cursor: null,
    })
    expect(list.mock.calls[1]?.[0].cursor).toBe("next-page")
  })

  it("aborts a superseded collection load and accepts only the latest revision", async () => {
    const requests: Array<{
      query: LibraryCatalogQueryInput
      signal: AbortSignal
      resolve: (value: ReturnType<typeof page>) => void
    }> = []
    const list = vi.fn(
      (query: LibraryCatalogQueryInput, signal: AbortSignal) =>
        new Promise<ReturnType<typeof page>>((resolve) => {
          requests.push({ query, signal, resolve })
        })
    )
    const controller = new LibraryCollectionBrowserController({ list })
    const oldDetail = collection([catalogTemplates[0]])
    const nextDetail = {
      ...oldDetail,
      summary: { ...oldDetail.summary, revision: 4 },
    }

    const oldLoad = controller.load(oldDetail)
    const nextLoad = controller.load(nextDetail)
    expect(requests[0]?.signal.aborted).toBe(true)
    requests[0]?.resolve(page(requests[0].query, [catalogTemplates[0]]))
    requests[1]?.resolve(page(requests[1].query, [catalogTemplates[0]]))

    await expect(nextLoad).resolves.toBe(true)
    await expect(oldLoad).resolves.toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      collectionRevision: 4,
    })
  })

  it("never retains one collection's members while loading another collection", async () => {
    let calls = 0
    let nextQuery: LibraryCatalogQueryInput | undefined
    let resolveNext: ((value: ReturnType<typeof page>) => void) | undefined
    const list = vi.fn((query: LibraryCatalogQueryInput) => {
      calls += 1
      if (calls === 1) {
        return Promise.resolve(page(query, [catalogTemplates[0]]))
      }
      nextQuery = query
      return new Promise<ReturnType<typeof page>>((resolve) => {
        resolveNext = resolve
      })
    })
    const controller = new LibraryCollectionBrowserController({ list })
    await controller.load(collection([catalogTemplates[0]]))
    const nextDetail: LibraryCollectionDetail = {
      summary: {
        ...collection().summary,
        id: "collection-next",
        name: "Next",
      },
      members: [catalogTemplates[1]].map(({ itemKind, id, version }) => ({
        itemKind,
        id,
        version,
      })),
    }

    const pending = controller.load(nextDetail)
    expect(controller.getSnapshot()).toMatchObject({
      status: "loading",
      collectionId: "collection-next",
      retained: null,
    })
    if (!nextQuery || !resolveNext) throw new Error("Expected second request")
    resolveNext(page(nextQuery, [catalogTemplates[1]]))
    await expect(pending).resolves.toBe(true)
  })

  it("retains correlated request identity for a retryable catalog failure", async () => {
    const controller = new LibraryCollectionBrowserController({
      list: vi.fn(async () => {
        throw new LibraryDiscoveryHttpError({
          code: "library_timeout",
          status: 504,
          message: "Timed out",
          requestId: "request-collection-catalog-1",
          retryable: true,
        })
      }),
    })

    await expect(controller.load(collection())).resolves.toBe(false)

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      failure: {
        requestId: "request-collection-catalog-1",
        retryable: true,
      },
    })
    controller.dismissFailure()
    expect(controller.getSnapshot()).toMatchObject({
      status: "dismissed",
      collectionId: "collection-campaign",
      members: null,
    })
  })

  it("dismisses a retained refresh warning back to the confirmed member rows", async () => {
    const list = vi
      .fn()
      .mockImplementationOnce(async (query: LibraryCatalogQueryInput) =>
        page(query, catalogTemplates.slice(0, 2))
      )
      .mockImplementationOnce(async () => {
        throw new LibraryDiscoveryHttpError({
          code: "library_timeout",
          status: 504,
          message: "Timed out",
          requestId: "request-retained-refresh-1",
          retryable: true,
        })
      })
    const controller = new LibraryCollectionBrowserController({ list })
    const detail = collection()
    await controller.load(detail)
    await controller.load(detail, true)

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      collectionRevision: detail.summary.revision,
      retained: expect.any(Array),
    })
    controller.dismissFailure()
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      collectionRevision: detail.summary.revision,
      members: expect.any(Array),
    })
  })

  it("keeps stale retained rows read-only after dismissing a newer-revision failure", async () => {
    const list = vi
      .fn()
      .mockImplementationOnce(async (query: LibraryCatalogQueryInput) =>
        page(query, catalogTemplates.slice(0, 2))
      )
      .mockRejectedValueOnce(
        new LibraryDiscoveryHttpError({
          code: "library_timeout",
          status: 504,
          message: "Timed out",
          requestId: "request-stale-retained-1",
          retryable: true,
        })
      )
    const controller = new LibraryCollectionBrowserController({ list })
    const first = collection()
    await controller.load(first)
    await controller.load({
      ...first,
      summary: { ...first.summary, revision: first.summary.revision + 1 },
    })

    controller.dismissFailure()

    expect(controller.getSnapshot()).toMatchObject({
      status: "dismissed",
      collectionRevision: first.summary.revision + 1,
      memberCollectionRevision: first.summary.revision,
      members: expect.any(Array),
    })
  })
})
