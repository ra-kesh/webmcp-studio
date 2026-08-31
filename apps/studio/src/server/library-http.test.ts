import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  LibraryCatalogCursorError,
  libraryCollectionDetailSchema,
  libraryPreferenceStateSchema,
  projectPublicMediaDetail,
} from "@webmcp/document"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogIndex,
} from "../content/library/catalog"
import {
  assertCatalogItemCapability,
  createLibraryHttpHandlers,
  parseLibraryListRequest,
} from "./library-http"
import { LibraryCatalogService } from "./library-catalog-service"
import { LibraryPreferenceError } from "./library-preference-repository"
import type { StudioPrincipal } from "./studio-principal"

const now = "2026-08-31T10:00:00.000Z"
const identity = {
  itemKind: "template" as const,
  id: "signal-creative-brief",
  version: 1,
}
const preference = libraryPreferenceStateSchema.parse({
  identity,
  favorite: true,
  lastUsedAt: now,
  collectionIds: [],
  revision: 2,
  updatedAt: now,
})
const collection = libraryCollectionDetailSchema.parse({
  summary: {
    id: "collection-client-work",
    name: "Client work",
    scope: "workspace",
    revision: 1,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  },
  members: [],
})

const currentManagedDetail = () =>
  projectPublicMediaDetail(
    {
      id: "asset-ManagedCurrent01",
      name: "Current client portrait",
      mediaType: "image/jpeg",
      bytes: 240_000,
      width: 1_200,
      height: 1_500,
      createdAt: "2026-08-30T08:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
      lastUsedAt: "2026-08-30T10:00:00.000Z",
      status: "ready",
    },
    {
      catalogVersion: 7,
      description: "Customer-provided workspace upload",
      categoryId: "workspace-upload",
      useCaseIds: ["proposal"],
      formatFamily: "image",
      tags: ["portrait"],
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

const principal: StudioPrincipal = {
  id: "principal-a",
  budgetKey: "workspace-a",
  workspaceId: "workspace-a",
  expiresAt: "2026-09-01T00:00:00.000Z",
  mode: "local_demo",
  respond: (response) => {
    response.headers.set("x-principal-response", "yes")
    return response
  },
}

const repository = {
  readProjection: vi.fn(),
  readSnapshot: vi.fn(),
  readCollectionSnapshot: vi.fn(),
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  setFavorite: vi.fn(),
  recordUsed: vi.fn(),
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addCollectionMember: vi.fn(),
  removeCollectionMember: vi.fn(),
  reorderCollectionMembers: vi.fn(),
}

const catalog = {
  list: vi.fn(),
  getDetail: vi.fn(),
  getCurrentManagedDetail: vi.fn(),
}

const handlers = createLibraryHttpHandlers({
  db: {} as D1Database,
  requirePrincipal: async () => principal,
  repository,
  catalog,
})

const jsonRequest = (
  url: string,
  method: string,
  body: unknown,
  headers: HeadersInit = {}
) => {
  const encoded = JSON.stringify(body)
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(encoded).byteLength),
      ...Object.fromEntries(new Headers(headers).entries()),
    },
    body: encoded,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  repository.readProjection.mockResolvedValue({
    workspaceRevision: 8,
    preferences: [preference],
  })
  repository.readSnapshot.mockResolvedValue({
    workspaceRevision: 8,
    preferences: [preference],
    collections: [collection.summary],
  })
  repository.listCollections.mockResolvedValue([collection.summary])
  repository.getCollection.mockResolvedValue(collection)
  repository.readCollectionSnapshot.mockResolvedValue({
    workspaceRevision: 8,
    collection,
  })
  const page = studioLibraryCatalogIndex.list({
    generation: "http-test",
    itemKinds: ["template"],
    limit: 10,
  })
  catalog.list.mockResolvedValue({ workspaceRevision: 8, page })
  catalog.getDetail.mockResolvedValue(null)
  catalog.getCurrentManagedDetail.mockResolvedValue(null)
})

describe("library HTTP contract", () => {
  it("keeps the warm local Worker list path within the Gate 8 budget", async () => {
    const realCatalog = new LibraryCatalogService({
      readProjection: async () => ({
        workspaceRevision: 8,
        preferences: [],
      }),
    })
    const performanceHandlers = createLibraryHttpHandlers({
      db: {} as D1Database,
      requirePrincipal: async () => principal,
      repository,
      catalog: realCatalog,
    })

    const requestFor = (generation: string) =>
      new Request(
        `https://studio.test/v1/studio/library/items?generation=${generation}&limit=50`
      )
    await performanceHandlers.listItems(requestFor("warmup"))

    const durations = []
    for (let iteration = 0; iteration < 7; iteration += 1) {
      const startedAt = performance.now()
      const response = await performanceHandlers.listItems(
        requestFor(`measure-${iteration}`)
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { page: { items: unknown[] } }
      expect(body.page.items).toHaveLength(50)
      durations.push(performance.now() - startedAt)
    }
    durations.sort((left, right) => left - right)

    expect(durations[Math.floor(durations.length / 2)]).toBeLessThan(200)
  })

  it("round-trips assign-field Recent through the HTTP boundary", async () => {
    const receipt = {
      schemaVersion: 1 as const,
      operation: "record_used" as const,
      completedAction: "assign_field" as const,
      completionId: "field-assignment-1",
      preference: { ...preference, revision: 3 },
      workspaceRevision: 9,
    }
    repository.recordUsed.mockResolvedValue(receipt)

    const response = await handlers.recordUsed(
      jsonRequest(
        "https://studio.test/v1/studio/library/items/template/signal-creative-brief/versions/1/used",
        "POST",
        {
          schemaVersion: 1,
          completedAction: "assign_field",
          completionId: "field-assignment-1",
        },
        { "Idempotency-Key": "recent-field-assignment-1" }
      ),
      identity.itemKind,
      identity.id,
      identity.version
    )

    expect(response.status).toBe(200)
    expect(repository.recordUsed).toHaveBeenCalledWith(
      principal.workspaceId,
      principal.id,
      identity,
      "assign_field",
      "field-assignment-1",
      "recent-field-assignment-1"
    )
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      receipt,
    })
  })

  it("enforces the requested item capability without coupling independent permissions", async () => {
    const detail = structuredClone(
      getStudioLibraryCatalogDetail("template", identity.id, identity.version)!
    )
    detail.summary.permissions.canUse = false
    detail.summary.permissions.canFavorite = true
    detail.summary.permissions.canAddToCollection = true
    catalog.getDetail.mockResolvedValue({ workspaceRevision: 8, detail })

    await expect(
      assertCatalogItemCapability(
        catalog,
        "workspace-a",
        "principal-a",
        identity,
        "favorite"
      )
    ).resolves.toBeUndefined()
    await expect(
      assertCatalogItemCapability(
        catalog,
        "workspace-a",
        "principal-a",
        identity,
        "add_to_collection"
      )
    ).resolves.toBeUndefined()
    await expect(
      assertCatalogItemCapability(
        catalog,
        "workspace-a",
        "principal-a",
        identity,
        "use"
      )
    ).rejects.toMatchObject({ code: "library_item_not_found", status: 404 })
  })

  it("strictly parses repeated list parameters and scopes the catalog read", async () => {
    const request = new Request(
      "https://studio.test/v1/studio/library/items?generation=http-test&itemKind=template&categoryId=documents&useCaseId=proposal&orientation=portrait&ownerKind=studio&favoritesOnly=true&recentOnly=false&limit=10"
    )
    expect(parseLibraryListRequest(request)).toMatchObject({
      generation: "http-test",
      itemKinds: ["template"],
      categoryIds: ["documents"],
      useCaseIds: ["proposal"],
      orientations: ["portrait"],
      ownerKinds: ["studio"],
      favoritesOnly: true,
      recentOnly: false,
      limit: 10,
    })

    const response = await handlers.listItems(request)
    expect(catalog.list).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      expect.objectContaining({ generation: "http-test", limit: 10 })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe('"library-workspace-revision-8"')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("x-principal-response")).toBe("yes")
  })

  it("serves exact managed detail without exposing private storage identity", async () => {
    const asset = {
      id: "asset-ManagedPortrait01",
      name: "Client portrait",
      mediaType: "image/jpeg" as const,
      bytes: 240_000,
      width: 1_200,
      height: 1_500,
      createdAt: "2026-08-30T08:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
      lastUsedAt: "2026-08-30T10:00:00.000Z",
      status: "ready" as const,
    }
    const detail = projectPublicMediaDetail(asset, {
      catalogVersion: 3,
      description: "Customer-provided workspace upload",
      categoryId: "workspace-upload",
      useCaseIds: ["proposal"],
      formatFamily: "image",
      tags: ["portrait"],
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
    })
    catalog.getDetail.mockResolvedValue({ workspaceRevision: 8, detail })

    const response = await handlers.getItemDetail(
      new Request(
        `https://studio.test/v1/studio/library/items/media/${asset.id}/versions/3?mediaSource=managed`
      ),
      "media",
      asset.id,
      3
    )

    expect(catalog.getDetail).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      {
        itemKind: "media",
        id: asset.id,
        version: 3,
        mediaSource: "managed",
      }
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({
      detail: {
        summary: {
          id: asset.id,
          version: 3,
          mediaSource: "managed",
          selectable: true,
        },
        selectionIdentity: {
          source: "managed",
          assetId: asset.id,
          refetch: "required",
        },
      },
    })
    expect(body).not.toContain("r2Key")
  })

  it("resolves an uploaded managed asset to its current exact catalog version without listing", async () => {
    const detail = currentManagedDetail()
    catalog.getCurrentManagedDetail.mockResolvedValue({
      workspaceRevision: 8,
      detail,
    })

    const response = await handlers.getItemDetail(
      new Request(
        `https://studio.test/v1/studio/library/items/media/${detail.summary.id}/versions/current?mediaSource=managed`
      ),
      "media",
      detail.summary.id,
      "current"
    )

    expect(catalog.getCurrentManagedDetail).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      detail.summary.id
    )
    expect(catalog.list).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe(
      `"library-managed-detail-${detail.summary.id}-version-7-workspace-8"`
    )
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
      detail: {
        summary: {
          id: detail.summary.id,
          version: 7,
          mediaSource: "managed",
        },
        selectionIdentity: {
          source: "managed",
          assetId: detail.summary.id,
          catalogVersion: 7,
        },
      },
    })
  })

  it("rejects wrong-source or malformed current managed lookups before catalog access", async () => {
    const assetId = currentManagedDetail().summary.id
    const cases = [
      `https://studio.test/v1/studio/library/items/media/${assetId}/versions/current?mediaSource=curated`,
      `https://studio.test/v1/studio/library/items/media/${assetId}/versions/current`,
      `https://studio.test/v1/studio/library/items/media/${assetId}/versions/current?mediaSource=managed&mediaSource=managed`,
      "https://studio.test/v1/studio/library/items/media/not-an-asset/versions/current?mediaSource=managed",
    ]

    for (const url of cases) {
      const response = await handlers.getItemDetail(
        new Request(url),
        "media",
        new URL(url).pathname.split("/").at(-3)!,
        "current"
      )
      expect(response.status).toBe(400)
    }
    expect(catalog.getCurrentManagedDetail).not.toHaveBeenCalled()
  })

  it("requires one canonical media source on item routes and rejects it for templates", async () => {
    const requests = [
      "https://studio.test/v1/studio/library/items/media/shared/versions/1",
      "https://studio.test/v1/studio/library/items/media/shared/versions/1?mediaSource=managed&mediaSource=curated",
      "https://studio.test/v1/studio/library/items/media/shared/versions/1?mediaSource=unknown",
      "https://studio.test/v1/studio/library/items/media/shared/versions/1?mediaSource=managed&extra=value",
    ]
    for (const url of requests) {
      const response = await handlers.getItemDetail(
        new Request(url),
        "media",
        "shared",
        1
      )
      expect(response.status).toBe(400)
    }

    const templateResponse = await handlers.getItemDetail(
      new Request(
        "https://studio.test/v1/studio/library/items/template/shared/versions/1?mediaSource=curated"
      ),
      "template",
      "shared",
      1
    )
    expect(templateResponse.status).toBe(400)
    expect(catalog.getDetail).not.toHaveBeenCalled()
  })

  it("preserves the shared all-item default when itemKind is omitted", async () => {
    const request = new Request(
      "https://studio.test/v1/studio/library/items?generation=http-test"
    )

    expect(parseLibraryListRequest(request).itemKinds).toEqual([
      "template",
      "media",
    ])
    await handlers.listItems(request)
    expect(catalog.list).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      expect.objectContaining({ itemKinds: ["template", "media"] })
    )
  })

  it("rejects unknown, duplicate scalar, and non-decimal query values", async () => {
    const queries = [
      "generation=http-test&unknown=value",
      "generation=http-test&generation=second",
      "generation=http-test&limit=10&limit=20",
      "generation=http-test&limit=1e1",
      "generation=http-test&limit=01",
    ]

    for (const query of queries) {
      const response = await handlers.listItems(
        new Request(`https://studio.test/v1/studio/library/items?${query}`)
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_library_request", retryable: false },
      })
    }
    expect(catalog.list).not.toHaveBeenCalled()
  })

  it("rejects malformed query values before catalog access", async () => {
    const response = await handlers.listItems(
      new Request(
        "https://studio.test/v1/studio/library/items?generation=http-test&favoritesOnly=1"
      )
    )
    expect(response.status).toBe(400)
    expect(catalog.list).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_library_request", retryable: false },
    })
  })

  it("returns a stable replacement signal for an obsolete cursor", async () => {
    catalog.list.mockRejectedValue(
      new LibraryCatalogCursorError("catalog_revision_mismatch")
    )
    const response = await handlers.listItems(
      new Request(
        "https://studio.test/v1/studio/library/items?generation=http-test&cursor=YWJj"
      )
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_library_request",
        cursorReason: "catalog_revision_mismatch",
        retryable: false,
      },
    })
  })

  it("requires revision and idempotency headers before favorite mutation", async () => {
    const missingHeaders = await handlers.setFavorite(
      jsonRequest(
        "https://studio.test/v1/studio/library/items/template/signal-creative-brief/versions/1/favorite",
        "PUT",
        { schemaVersion: 1, favorite: true }
      ),
      identity.itemKind,
      identity.id,
      identity.version
    )
    expect(missingHeaders.status).toBe(400)
    expect(repository.setFavorite).not.toHaveBeenCalled()

    repository.setFavorite.mockResolvedValue({
      schemaVersion: 1,
      operation: "set_favorite",
      preference,
      workspaceRevision: 8,
    })
    const response = await handlers.setFavorite(
      jsonRequest(
        "https://studio.test/v1/studio/library/items/template/signal-creative-brief/versions/1/favorite",
        "PUT",
        { schemaVersion: 1, favorite: true },
        {
          "If-Match": '"library-preference-revision-1"',
          "Idempotency-Key": "favorite-request-1",
        }
      ),
      identity.itemKind,
      identity.id,
      identity.version
    )
    expect(repository.setFavorite).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      identity,
      1,
      true,
      "favorite-request-1"
    )
    expect(response.headers.get("etag")).toBe('"library-preference-revision-2"')
  })

  it("requires the exact canonical revision ETag grammar", async () => {
    const invalidTags = [
      '"library-preference-revision-+1"',
      '"library-preference-revision-01"',
      'W/"library-preference-revision-1"',
      '"library-preference-revision-1.0"',
    ]

    for (const tag of invalidTags) {
      const response = await handlers.setFavorite(
        jsonRequest(
          "https://studio.test/v1/studio/library/items/template/signal-creative-brief/versions/1/favorite",
          "PUT",
          { schemaVersion: 1, favorite: true },
          {
            "If-Match": tag,
            "Idempotency-Key": "favorite-request-strict-etag",
          }
        ),
        identity.itemKind,
        identity.id,
        identity.version
      )
      expect(response.status).toBe(400)
    }
    expect(repository.setFavorite).not.toHaveBeenCalled()
  })

  it("rejects non-canonical item versions on every item route", async () => {
    for (const version of ["1e0", "+1", "01"]) {
      const detailResponse = await handlers.getItemDetail(
        new Request("https://studio.test/v1/studio/library/items/invalid"),
        identity.itemKind,
        identity.id,
        version
      )
      expect(detailResponse.status).toBe(400)
    }

    const favoriteResponse = await handlers.setFavorite(
      jsonRequest(
        "https://studio.test/v1/studio/library/items/invalid/favorite",
        "PUT",
        { schemaVersion: 1, favorite: true },
        {
          "If-Match": '"library-preference-revision-0"',
          "Idempotency-Key": "invalid-version-favorite",
        }
      ),
      identity.itemKind,
      identity.id,
      "1e0"
    )
    const usedResponse = await handlers.recordUsed(
      jsonRequest(
        "https://studio.test/v1/studio/library/items/invalid/used",
        "POST",
        {
          schemaVersion: 1,
          completedAction: "create",
          completionId: "completion-invalid-version",
        },
        { "Idempotency-Key": "invalid-version-used" }
      ),
      identity.itemKind,
      identity.id,
      "1e0"
    )
    const memberResponse = await handlers.addCollectionMember(
      jsonRequest(
        "https://studio.test/v1/studio/library/collections/collection-client-work/items/invalid",
        "PUT",
        { schemaVersion: 1 },
        {
          "If-Match": '"library-collection-revision-1"',
          "Idempotency-Key": "invalid-version-member",
        }
      ),
      collection.summary.id,
      identity.itemKind,
      identity.id,
      "1e0"
    )

    expect(favoriteResponse.status).toBe(400)
    expect(usedResponse.status).toBe(400)
    expect(memberResponse.status).toBe(400)
    expect(catalog.getDetail).not.toHaveBeenCalled()
    expect(repository.setFavorite).not.toHaveBeenCalled()
    expect(repository.recordUsed).not.toHaveBeenCalled()
    expect(repository.addCollectionMember).not.toHaveBeenCalled()
  })

  it("reports server response validation failures as sanitized internal errors", async () => {
    catalog.list.mockResolvedValue({ workspaceRevision: 8, page: {} })
    const response = await handlers.listItems(
      new Request(
        "https://studio.test/v1/studio/library/items?generation=http-test"
      )
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "internal_error",
        message: "The request could not be completed",
        retryable: false,
      },
    })
  })

  it("creates and reads only the principal's collection with strict envelopes", async () => {
    repository.createCollection.mockResolvedValue({
      schemaVersion: 1,
      operation: "create_collection",
      collection,
      workspaceRevision: 8,
    })
    const created = await handlers.createCollection(
      jsonRequest(
        "https://studio.test/v1/studio/library/collections",
        "POST",
        { schemaVersion: 1, name: "Client work" },
        { "Idempotency-Key": "collection-request-1" }
      )
    )
    expect(created.status).toBe(201)
    expect(repository.createCollection).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      "Client work",
      "collection-request-1"
    )

    const read = await handlers.getCollection(
      new Request(
        "https://studio.test/v1/studio/library/collections/collection-client-work"
      ),
      collection.summary.id
    )
    expect(repository.readCollectionSnapshot).toHaveBeenCalledWith(
      "workspace-a",
      "principal-a",
      collection.summary.id
    )
    expect(await read.json()).toEqual({
      schemaVersion: 1,
      workspaceRevision: 8,
      collection,
    })
  })

  it("preserves the same public not-found error for inaccessible collections", async () => {
    repository.readCollectionSnapshot.mockRejectedValue(
      new LibraryPreferenceError(
        "library_collection_not_found",
        404,
        "Library collection was not found"
      )
    )
    const response = await handlers.getCollection(
      new Request(
        "https://studio.test/v1/studio/library/collections/collection-foreign"
      ),
      "collection-foreign"
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "library_collection_not_found", retryable: false },
    })
  })

  it("preserves the typed collection-limit conflict", async () => {
    repository.createCollection.mockRejectedValue(
      new LibraryPreferenceError(
        "library_collection_limit_reached",
        409,
        "A principal can have at most 100 library collections"
      )
    )
    const response = await handlers.createCollection(
      jsonRequest(
        "https://studio.test/v1/studio/library/collections",
        "POST",
        { schemaVersion: 1, name: "One too many" },
        { "Idempotency-Key": "collection-limit-request" }
      )
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "library_collection_limit_reached",
        retryable: false,
      },
    })
  })
})
