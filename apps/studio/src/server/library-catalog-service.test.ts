import { describe, expect, it } from "vitest"
import type { LibraryPreferenceState } from "@webmcp/document"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogSummaries,
} from "../content/library/catalog"
import { LibraryCatalogService } from "./library-catalog-service"
import type {
  LibraryPreferenceProjectionSnapshot,
  ManagedMediaLibraryCatalogReader,
} from "./library-catalog-service"
import type { ManagedMediaCatalogEntry } from "./media-asset-repository"

const usedAt = "2026-08-31T10:00:00.000Z"

const preference = (
  id: string,
  version: number,
  input: Partial<LibraryPreferenceState> = {}
): LibraryPreferenceState => ({
  identity: { itemKind: "template", id, version },
  favorite: true,
  lastUsedAt: usedAt,
  collectionIds: ["collection-client-work"],
  revision: 1,
  updatedAt: usedAt,
  ...input,
})

const managedEntry = (
  input: Partial<ManagedMediaCatalogEntry["metadata"]> = {}
): ManagedMediaCatalogEntry => ({
  asset: {
    id: "asset-ManagedPortrait01",
    name: "Client portrait",
    mediaType: "image/jpeg",
    bytes: 240_000,
    width: 1_200,
    height: 1_500,
    createdAt: "2026-08-30T08:00:00.000Z",
    updatedAt: "2026-08-30T09:00:00.000Z",
    lastUsedAt: "2026-08-30T10:00:00.000Z",
    status: "ready",
  },
  metadata: {
    description: "Customer-provided workspace upload",
    tags: ["client", "portrait"],
    categoryId: "workspace-upload",
    useCaseIds: ["proposal"],
    provenance: {
      sourceName: "Workspace upload",
      sourceUrl: null,
      license: {
        id: "customer-provided",
        name: "Customer-provided; rights not verified",
        url: null,
      },
      attribution: { required: false, text: null },
    },
    catalogVersion: 3,
    createdAt: "2026-08-30T08:00:00.000Z",
    updatedAt: "2026-08-31T11:00:00.000Z",
    ...input,
  },
})

const managedReader = (
  entry: ManagedMediaCatalogEntry | null,
  catalogRevision = 4
): ManagedMediaLibraryCatalogReader => ({
  readRevision: async () => catalogRevision,
  readSnapshot: async () => ({
    entries: entry ? [entry] : [],
    catalogRevision,
  }),
  getExact: async (_workspaceId, assetId, version) =>
    entry &&
    entry.asset.id === assetId &&
    entry.metadata.catalogVersion === version
      ? entry
      : null,
  getCurrent: async (_workspaceId, assetId) =>
    entry?.asset.id === assetId ? entry : null,
})

describe("LibraryCatalogService", () => {
  it("keeps same-id curated and managed media independently discoverable and mutable", async () => {
    const curated = studioLibraryCatalogSummaries.find(
      (item) => item.itemKind === "media"
    )!
    const managed = managedEntry({ catalogVersion: curated.version })
    managed.asset.id = curated.id
    managed.asset.name = "Workspace collision"
    const managedMedia = managedReader(managed)
    const service = new LibraryCatalogService(
      {
        readProjection: async () => ({
          workspaceRevision: 17,
          preferences: [
            preference(curated.id, curated.version, {
              identity: {
                itemKind: "media",
                id: curated.id,
                version: curated.version,
                mediaSource: "managed",
              },
            }),
          ],
        }),
      },
      { managedMedia }
    )

    const page = await service.list("workspace-a", "principal-a", {
      generation: "same-id-source-aware",
      itemKinds: ["media"],
      limit: 50,
    })
    const collisions = page.page.items.flatMap((item) =>
      item.itemKind === "media" && item.id === curated.id ? [item] : []
    )
    expect(collisions).toHaveLength(2)
    expect(
      collisions.map((item) => [item.mediaSource, item.preferences?.favorite])
    ).toEqual([
      ["curated", false],
      ["managed", true],
    ])

    const curatedDetail = await service.getDetail(
      "workspace-a",
      "principal-a",
      {
        itemKind: "media",
        id: curated.id,
        version: curated.version,
        mediaSource: "curated",
      }
    )
    const managedDetail = await service.getDetail(
      "workspace-a",
      "principal-a",
      {
        itemKind: "media",
        id: curated.id,
        version: curated.version,
        mediaSource: "managed",
      }
    )
    expect(curatedDetail?.detail.summary).toMatchObject({
      mediaSource: "curated",
      preferences: { favorite: false },
    })
    expect(managedDetail?.detail).toMatchObject({
      summary: { mediaSource: "managed", preferences: { favorite: true } },
      selectionIdentity: {
        source: "managed",
        catalogVersion: curated.version,
      },
    })
  })

  it("overlays only the current principal's exact preference identities", async () => {
    let projection: LibraryPreferenceProjectionSnapshot = {
      workspaceRevision: 7,
      preferences: [
        preference("signal-creative-brief", 1),
        preference("signal-creative-brief", 999),
      ],
    }
    const readProjection = async () => projection
    const service = new LibraryCatalogService({ readProjection })

    const result = await service.list("workspace-a", "principal-a", {
      generation: "service-test",
      itemKinds: ["template"],
      limit: 50,
    })
    const exact = result.page.items.find(
      (item) => item.id === "signal-creative-brief" && item.version === 1
    )
    const untouched = result.page.items.find(
      (item) => item.id !== "signal-creative-brief"
    )

    expect(result.workspaceRevision).toBe(7)
    expect(result.page.catalogRevision).toMatch(/:w7:m0$/)
    expect(exact?.preferences).toEqual({
      favorite: true,
      lastUsedAt: usedAt,
      collectionIds: ["collection-client-work"],
    })
    expect(untouched?.preferences).toEqual({
      favorite: false,
      lastUsedAt: null,
      collectionIds: [],
    })

    projection = { workspaceRevision: 8, preferences: [] }
    const replaced = await service.list("workspace-a", "principal-a", {
      generation: "service-test",
      itemKinds: ["template"],
      limit: 50,
    })
    expect(replaced.page.catalogRevision).toMatch(/:w8:m0$/)
  })

  it("invalidates an old cursor when the workspace preference epoch changes", async () => {
    let projection: LibraryPreferenceProjectionSnapshot = {
      workspaceRevision: 3,
      preferences: [],
    }
    const service = new LibraryCatalogService({
      readProjection: async () => projection,
    })
    const first = await service.list("workspace-a", "principal-a", {
      generation: "cursor-test",
      limit: 1,
    })
    expect(first.page.nextCursor).not.toBeNull()

    projection = { workspaceRevision: 4, preferences: [] }
    await expect(
      service.list("workspace-a", "principal-a", {
        generation: "cursor-test",
        limit: 1,
        cursor: first.page.nextCursor,
      })
    ).rejects.toMatchObject({
      reason: "catalog_revision_mismatch",
    })
  })

  it("composes ready managed summaries and invalidates cursors on the bounded media epoch", async () => {
    const entry = managedEntry()
    let revision = 4
    const managed: ManagedMediaLibraryCatalogReader = {
      readRevision: async () => revision,
      readSnapshot: async () => ({
        entries: [entry],
        catalogRevision: revision,
      }),
      getExact: managedReader(entry).getExact,
      getCurrent: managedReader(entry).getCurrent,
    }
    const service = new LibraryCatalogService(
      {
        readProjection: async () => ({
          workspaceRevision: 6,
          preferences: [
            preference(entry.asset.id, entry.metadata.catalogVersion, {
              identity: {
                itemKind: "media",
                id: entry.asset.id,
                version: entry.metadata.catalogVersion,
                mediaSource: "managed",
              },
            }),
          ],
        }),
      },
      { managedMedia: managed }
    )
    const first = await service.list("workspace-a", "principal-a", {
      generation: "managed-cursor",
      itemKinds: ["media"],
      ownerKinds: ["workspace"],
      search: "client proposal",
      limit: 1,
    })

    expect(first.page.catalogRevision).toMatch(/:w6:m4$/)
    expect(first.page.items).toEqual([
      expect.objectContaining({
        id: entry.asset.id,
        version: entry.metadata.catalogVersion,
        mediaSource: "managed",
        selectable: true,
        owner: { kind: "workspace" },
        preferences: {
          favorite: true,
          lastUsedAt: usedAt,
          collectionIds: ["collection-client-work"],
        },
      }),
    ])
    expect(JSON.stringify(first)).not.toContain("r2Key")

    const cursorPage = await service.list("workspace-a", "principal-a", {
      generation: "managed-cursor",
      itemKinds: ["media"],
      limit: 1,
    })
    expect(cursorPage.page.nextCursor).not.toBeNull()
    revision = 5
    await expect(
      service.list("workspace-a", "principal-a", {
        generation: "managed-cursor",
        itemKinds: ["media"],
        limit: 1,
        cursor: cursorPage.page.nextCursor,
      })
    ).rejects.toMatchObject({ reason: "catalog_revision_mismatch" })
  })

  it("refetches exact managed catalog identity and rejects stale or archived details", async () => {
    const entry = managedEntry()
    let current: ManagedMediaCatalogEntry | null = entry
    const managed: ManagedMediaLibraryCatalogReader = {
      readRevision: async () => 4,
      readSnapshot: async () => ({
        entries: current ? [current] : [],
        catalogRevision: 4,
      }),
      getExact: async (workspaceId, assetId, version) =>
        workspaceId === "workspace-a" &&
        current?.asset.id === assetId &&
        current.metadata.catalogVersion === version
          ? current
          : null,
      getCurrent: async (workspaceId, assetId) =>
        workspaceId === "workspace-a" && current?.asset.id === assetId
          ? current
          : null,
    }
    const service = new LibraryCatalogService(
      {
        readProjection: async () => ({
          workspaceRevision: 9,
          preferences: [],
        }),
      },
      { managedMedia: managed }
    )

    const detail = await service.getDetail("workspace-a", "principal-a", {
      itemKind: "media",
      id: entry.asset.id,
      version: entry.metadata.catalogVersion,
      mediaSource: "managed",
    })
    expect(detail?.detail).toMatchObject({
      summary: {
        id: entry.asset.id,
        version: entry.metadata.catalogVersion,
        mediaSource: "managed",
        selectable: true,
      },
      selectionIdentity: {
        source: "managed",
        assetId: entry.asset.id,
        catalogVersion: entry.metadata.catalogVersion,
        refetch: "required",
      },
    })
    expect(JSON.stringify(detail)).not.toContain("r2Key")
    expect(
      await service.getDetail("workspace-a", "principal-a", {
        itemKind: "media",
        id: entry.asset.id,
        version: entry.metadata.catalogVersion + 1,
        mediaSource: "managed",
      })
    ).toBeNull()

    current = null
    expect(
      await service.getDetail("workspace-a", "principal-a", {
        itemKind: "media",
        id: entry.asset.id,
        version: entry.metadata.catalogVersion,
        mediaSource: "managed",
      })
    ).toBeNull()
  })

  it("resolves the current managed catalog version through exact source authority", async () => {
    const current = managedEntry({ catalogVersion: 7 })
    const curatedCollision = studioLibraryCatalogSummaries.find(
      (item) => item.itemKind === "media"
    )!
    current.asset.id = curatedCollision.id
    const service = new LibraryCatalogService(
      {
        readProjection: async () => ({
          workspaceRevision: 12,
          preferences: [],
        }),
      },
      { managedMedia: managedReader(current) }
    )

    const result = await service.getCurrentManagedDetail(
      "workspace-a",
      "principal-a",
      current.asset.id
    )

    expect(result).toMatchObject({
      workspaceRevision: 12,
      detail: {
        summary: {
          id: current.asset.id,
          version: 7,
          mediaSource: "managed",
        },
        selectionIdentity: {
          source: "managed",
          assetId: current.asset.id,
          catalogVersion: 7,
          refetch: "required",
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain("r2Key")
  })

  it("projects exact detail without exposing source bodies or changing authority", async () => {
    const service = new LibraryCatalogService({
      readProjection: async () => ({
        workspaceRevision: 11,
        preferences: [preference("signal-creative-brief", 1)],
      }),
    })
    const result = await service.getDetail("workspace-a", "principal-a", {
      itemKind: "template",
      id: "signal-creative-brief",
      version: 1,
    })

    expect(result).not.toBeNull()
    expect(result?.workspaceRevision).toBe(11)
    expect(result?.detail.summary.preferences?.favorite).toBe(true)
    expect(result?.detail.summary.permissions.canUse).toBe(true)
    expect(result?.detail.summary.provenance.sourceName).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('"document"')
    expect(
      await service.getDetail("workspace-a", "principal-a", {
        itemKind: "template",
        id: "missing-template",
        version: 1,
      })
    ).toBeNull()
  })

  it("masks favorite and collection state after those permissions are revoked", async () => {
    const baseSummary = structuredClone(
      studioLibraryCatalogSummaries.find(
        (summary) => summary.itemKind === "template"
      )!
    )
    const baseDetail = structuredClone(
      getStudioLibraryCatalogDetail(
        "template",
        baseSummary.id,
        baseSummary.version
      )!
    )
    baseSummary.permissions.canFavorite = false
    baseSummary.permissions.canAddToCollection = false
    baseDetail.summary.permissions.canFavorite = false
    baseDetail.summary.permissions.canAddToCollection = false
    const storedPreference = preference(baseSummary.id, baseSummary.version)
    const service = new LibraryCatalogService(
      {
        readProjection: async () => ({
          workspaceRevision: 12,
          preferences: [storedPreference],
        }),
      },
      {
        baseCatalogRevision: "permission-revocation-test",
        baseSummaries: [baseSummary],
        resolveBaseDetail: () => baseDetail,
      }
    )

    const list = await service.list("workspace-a", "principal-a", {
      generation: "permission-revocation-test",
    })
    const detail = await service.getDetail("workspace-a", "principal-a", {
      itemKind: "template",
      id: baseSummary.id,
      version: baseSummary.version,
    })

    expect(list.page.items[0]?.preferences).toEqual({
      favorite: false,
      lastUsedAt: usedAt,
      collectionIds: [],
    })
    expect(detail?.detail.summary.preferences).toEqual({
      favorite: false,
      lastUsedAt: usedAt,
      collectionIds: [],
    })
  })
})
