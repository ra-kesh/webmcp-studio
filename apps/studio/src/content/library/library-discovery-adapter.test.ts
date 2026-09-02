import { describe, expect, it, vi } from "vitest"
import {
  libraryCatalogQueryIdentity,
  projectPublicMediaDetail,
} from "@webmcp/document"
import type {
  LibraryCatalogItemSummary,
  LibraryCatalogQueryInput,
} from "@webmcp/document"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogIndex,
} from "./catalog"
import {
  createStudioLibraryDiscoveryAdapter,
  studioLibraryDiscoveryAdapter,
} from "./library-discovery-adapter"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import type { LibraryDiscoveryFetch } from "./library-discovery-client"

const allCatalogItems = () => {
  const items: LibraryCatalogItemSummary[] = []
  let cursor: string | null = null
  do {
    const page = studioLibraryCatalogIndex.list({
      generation: "adapter-test-complete-catalog",
      limit: 50,
      cursor,
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

const sortedUnique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1
  )

const jsonResponse = (
  body: unknown,
  options: {
    status?: number
    requestId?: string
    workspaceRevision?: number
    etag?: string
  } = {}
) => {
  const workspaceRevision = options.workspaceRevision ?? 7
  return Response.json(body, {
    status: options.status ?? 200,
    headers: {
      "X-Request-Id": options.requestId ?? "request-discovery-1",
      ETag: options.etag ?? `"library-workspace-revision-${workspaceRevision}"`,
    },
  })
}

describe("Studio library discovery adapter", () => {
  it("projects validated taxonomy from the complete static active catalog", () => {
    const items = allCatalogItems()
    const taxonomy = studioLibraryDiscoveryAdapter.getTaxonomy()

    expect(items).toHaveLength(58)
    expect(taxonomy.categories.map(({ id }) => id)).toEqual(
      sortedUnique(items.map((item) => item.categoryId))
    )
    expect(taxonomy.useCases.map(({ id }) => id)).toEqual(
      sortedUnique(items.flatMap((item) => item.useCaseIds))
    )
    expect(taxonomy.formatFamilies.map(({ id }) => id)).toEqual(
      sortedUnique(items.map((item) => item.formatFamily))
    )
    expect(taxonomy.orientations).toEqual([
      { id: "portrait", label: "Portrait" },
      { id: "landscape", label: "Landscape" },
      { id: "square", label: "Square" },
      { id: "mixed", label: "Mixed" },
    ])
    expect(taxonomy.owners).toEqual([
      { id: "studio", label: "Studio" },
      { id: "workspace", label: "Your workspace" },
    ])
    expect(Object.isFrozen(taxonomy)).toBe(true)
    expect(Object.isFrozen(taxonomy.categories)).toBe(true)
    expect(Object.isFrozen(taxonomy.categories[0])).toBe(true)
    expect(studioLibraryDiscoveryAdapter.getTaxonomy()).toBe(taxonomy)
  })

  it("encodes the canonical list query exactly and uses a strict same-origin GET", async () => {
    const query: LibraryCatalogQueryInput = {
      generation: "adapter-list",
      search: "  Photo   Story ",
      itemKinds: ["media"],
      categoryIds: ["photograph"],
      useCaseIds: ["proposal"],
      formatFamilies: ["raster"],
      orientations: ["landscape"],
      ownerKinds: ["studio"],
      favoritesOnly: true,
      recentOnly: false,
      collectionId: "campaign-2026",
      order: "newest",
      limit: 1,
      cursor: "YWJj",
    }
    const page = {
      ...studioLibraryCatalogIndex.list({
        generation: "adapter-list",
        itemKinds: ["media"],
        limit: 1,
      }),
      queryIdentity: libraryCatalogQueryIdentity(query),
    }
    const fetchRequest = vi.fn<LibraryDiscoveryFetch>(async () =>
      jsonResponse({ schemaVersion: 1, workspaceRevision: 7, page })
    )
    const adapter = createStudioLibraryDiscoveryAdapter({ fetchRequest })
    const signal = new AbortController().signal

    const result = adapter.list(query, signal)
    const resolved = await result
    expect(resolved).toEqual({ workspaceRevision: 7, page })
    expect(Object.isFrozen(resolved)).toBe(true)

    expect(fetchRequest).toHaveBeenCalledWith(
      "/v1/studio/library/items?generation=adapter-list&search=photo+story&itemKind=media&categoryId=photograph&useCaseId=proposal&formatFamily=raster&orientation=landscape&ownerKind=studio&favoritesOnly=true&recentOnly=false&collectionId=campaign-2026&order=newest&limit=1&cursor=YWJj",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        signal,
      }
    )
  })

  it("resolves only the requested exact detail identity over HTTP", async () => {
    const summary = studioLibraryCatalogIndex.list({
      generation: "adapter-detail",
      itemKinds: ["template"],
      limit: 1,
    }).items[0]
    if (summary.itemKind !== "template") {
      throw new Error("Expected an exact template summary")
    }
    const detail = getStudioLibraryCatalogDetail(
      "template",
      summary.id,
      summary.version
    )
    if (!detail) throw new Error("Expected template detail")
    const fetchRequest = vi.fn<LibraryDiscoveryFetch>(async () =>
      jsonResponse({ schemaVersion: 1, workspaceRevision: 7, detail })
    )
    const adapter = createStudioLibraryDiscoveryAdapter({ fetchRequest })

    const result = adapter.getDetail(
      { itemKind: "template", id: summary.id, version: summary.version },
      new AbortController().signal
    )
    const resolved = await result
    expect(resolved).toEqual(detail)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(fetchRequest.mock.calls[0]?.[0]).toBe(
      `/v1/studio/library/items/template/${summary.id}/versions/${summary.version}`
    )

    await expect(
      adapter.getDetail(
        {
          itemKind: "template",
          id: "different-template",
          version: summary.version,
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "library_invalid_response" })
  })

  it("resolves a current managed upload to an exact source-aware catalog detail", async () => {
    const assetId = "asset-ManagedHandshake01"
    const detail = projectPublicMediaDetail(
      {
        id: assetId,
        name: "Uploaded portrait",
        mediaType: "image/jpeg",
        bytes: 240_000,
        width: 1_200,
        height: 1_500,
        createdAt: "2026-08-31T08:00:00.000Z",
        updatedAt: "2026-08-31T08:00:00.000Z",
        lastUsedAt: "2026-08-31T08:00:00.000Z",
        status: "ready",
      },
      {
        catalogVersion: 7,
        description: "Customer-provided workspace upload",
        categoryId: "workspace-upload",
        useCaseIds: [],
        formatFamily: "image",
        tags: [],
        provenance: {
          sourceName: "Workspace upload",
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
    )
    const fetchRequest = vi.fn<LibraryDiscoveryFetch>(async () =>
      jsonResponse(
        { schemaVersion: 1, workspaceRevision: 7, detail },
        {
          etag: `"library-managed-detail-${assetId}-version-7-workspace-7"`,
        }
      )
    )
    const adapter = createStudioLibraryDiscoveryAdapter({ fetchRequest })
    const signal = new AbortController().signal

    await expect(
      adapter.getCurrentManagedDetail(assetId, signal)
    ).resolves.toMatchObject({
      summary: { id: assetId, version: 7, mediaSource: "managed" },
      selectionIdentity: {
        source: "managed",
        assetId,
        catalogVersion: 7,
      },
    })
    expect(fetchRequest).toHaveBeenCalledWith(
      `/v1/studio/library/items/media/${assetId}/versions/current?mediaSource=managed`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal,
      })
    )

    const wrongSource = structuredClone(detail)
    wrongSource.summary.mediaSource = "curated"
    wrongSource.summary.owner = { kind: "studio" }
    wrongSource.selectionIdentity = {
      source: "curated",
      assetId,
      version: 7,
    }
    const collisionAdapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse({
          schemaVersion: 1,
          workspaceRevision: 7,
          detail: wrongSource,
        }),
    })
    await expect(
      collisionAdapter.getCurrentManagedDetail(assetId, signal)
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      message:
        "Studio returned current details for a different managed media item.",
    })
  })

  it("fails closed on invalid envelopes, request identities, and workspace ETags", async () => {
    const page = studioLibraryCatalogIndex.list({
      generation: "adapter-invalid",
      limit: 1,
    })
    const signal = new AbortController().signal
    const invalidSchema = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse({
          schemaVersion: 1,
          workspaceRevision: 7,
          page,
          extra: true,
        }),
    })
    await expect(
      invalidSchema.list({ generation: "adapter-invalid", limit: 1 }, signal)
    ).rejects.toMatchObject({ code: "library_invalid_response" })

    const missingRequestId = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        Response.json(
          { schemaVersion: 1, workspaceRevision: 7, page },
          { headers: { ETag: '"library-workspace-revision-7"' } }
        ),
    })
    await expect(
      missingRequestId.list({ generation: "adapter-invalid", limit: 1 }, signal)
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      requestId: null,
    })

    const wrongEtag = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse(
          { schemaVersion: 1, workspaceRevision: 7, page },
          { etag: '"library-workspace-revision-6"' }
        ),
    })
    await expect(
      wrongEtag.list({ generation: "adapter-invalid", limit: 1 }, signal)
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      requestId: "request-discovery-1",
    })
  })

  it("accepts a Cloudflare weak response tag for the canonical revision", async () => {
    const page = studioLibraryCatalogIndex.list({
      generation: "adapter-weak-etag",
      limit: 1,
    })
    const adapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse(
          { schemaVersion: 1, workspaceRevision: 7, page },
          { etag: 'W/"library-workspace-revision-7"' }
        ),
    })

    await expect(
      adapter.list(
        { generation: "adapter-weak-etag", limit: 1 },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ workspaceRevision: 7 })
  })

  it("rejects a schema-valid page for a different normalized query", async () => {
    const query = { generation: "adapter-wrong-query", search: "proposal" }
    const page = studioLibraryCatalogIndex.list({
      generation: "adapter-wrong-query",
      search: "invoice",
    })
    const adapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse({ schemaVersion: 1, workspaceRevision: 7, page }),
    })

    await expect(
      adapter.list(query, new AbortController().signal)
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      message: "Studio returned library results for the wrong query.",
    })
  })

  it("preserves a validated cursor invalidation reason from an HTTP error", async () => {
    const adapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () =>
        jsonResponse(
          {
            error: {
              code: "invalid_library_request",
              message: "Library cursor is no longer valid.",
              requestId: "request-cursor-1",
              retryable: false,
              cursorReason: "catalog_revision_mismatch",
            },
          },
          { status: 400, requestId: "request-cursor-1" }
        ),
    })

    let caught: unknown
    try {
      await adapter.list(
        { generation: "adapter-cursor", cursor: "YWJj" },
        new AbortController().signal
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LibraryDiscoveryHttpError)
    expect(caught).toMatchObject({
      code: "invalid_library_request",
      status: 400,
      requestId: "request-cursor-1",
      retryable: false,
      cursorReason: "catalog_revision_mismatch",
    })
  })

  it.each([
    {
      name: "missing header identity",
      response: () =>
        Response.json(
          {
            error: {
              code: "invalid_library_request",
              message: "private missing-header detail",
              requestId: "request-body-only",
              retryable: false,
              cursorReason: "catalog_revision_mismatch",
            },
          },
          { status: 400 }
        ),
    },
    {
      name: "mismatched body identity",
      response: () =>
        jsonResponse(
          {
            error: {
              code: "invalid_library_request",
              message: "private mismatch detail",
              requestId: "request-body-mismatch",
              retryable: false,
              cursorReason: "catalog_revision_mismatch",
            },
          },
          { status: 400, requestId: "request-header-mismatch" }
        ),
    },
    {
      name: "malformed envelope",
      response: () =>
        jsonResponse(
          {
            error: {
              code: "invalid_library_request",
              message: 42,
              requestId: "request-malformed",
              retryable: false,
              cursorReason: "catalog_revision_mismatch",
            },
          },
          { status: 400, requestId: "request-malformed" }
        ),
    },
    {
      name: "extra error data",
      response: () =>
        jsonResponse(
          {
            error: {
              code: "invalid_library_request",
              message: "private extra detail",
              requestId: "request-extra",
              retryable: false,
              cursorReason: "catalog_revision_mismatch",
              debug: "must not be trusted",
            },
          },
          { status: 400, requestId: "request-extra" }
        ),
    },
  ])("fails closed on $name", async ({ response }) => {
    const adapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: async () => response(),
    })

    await expect(
      adapter.list(
        { generation: "adapter-unverified-error" },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      code: "library_invalid_response",
      message: "Studio returned an unverifiable library error.",
      requestId: null,
      retryable: true,
      cursorReason: null,
    })
  })

  it("forwards abort ownership and never starts a pre-aborted request", async () => {
    const preAborted = new AbortController()
    const abortReason = new DOMException("Closed", "AbortError")
    preAborted.abort(abortReason)
    const fetchRequest = vi.fn<LibraryDiscoveryFetch>()
    const adapter = createStudioLibraryDiscoveryAdapter({ fetchRequest })
    await expect(
      adapter.list({ generation: "adapter-pre-abort" }, preAborted.signal)
    ).rejects.toBe(abortReason)
    expect(fetchRequest).not.toHaveBeenCalled()

    const inFlight = new AbortController()
    const waitingFetch = vi.fn<LibraryDiscoveryFetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          )
        })
    )
    const inFlightAdapter = createStudioLibraryDiscoveryAdapter({
      fetchRequest: waitingFetch,
    })
    const request = inFlightAdapter.list(
      { generation: "adapter-in-flight-abort" },
      inFlight.signal
    )
    inFlight.abort(abortReason)
    await expect(request).rejects.toBe(abortReason)
  })
})
