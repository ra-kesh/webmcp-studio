import { describe, expect, it } from "vitest"
import type { LibraryPreferenceState } from "@webmcp/document"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogSummaries,
} from "../content/library/catalog"
import {
  LibraryCatalogService,
  type LibraryPreferenceProjectionSnapshot,
} from "./library-catalog-service"

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

describe("LibraryCatalogService", () => {
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
    expect(result.page.catalogRevision).toMatch(/:w7$/)
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
    expect(replaced.page.catalogRevision).toMatch(/:w8$/)
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

  it("projects exact detail without exposing source bodies or changing authority", async () => {
    const service = new LibraryCatalogService({
      readProjection: async () => ({
        workspaceRevision: 11,
        preferences: [preference("signal-creative-brief", 1)],
      }),
    })
    const result = await service.getDetail(
      "workspace-a",
      "principal-a",
      "template",
      "signal-creative-brief",
      1
    )

    expect(result).not.toBeNull()
    expect(result?.workspaceRevision).toBe(11)
    expect(result?.detail.summary.preferences?.favorite).toBe(true)
    expect(result?.detail.summary.permissions.canUse).toBe(true)
    expect(result?.detail.summary.provenance.sourceName).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('"document"')
    expect(
      await service.getDetail(
        "workspace-a",
        "principal-a",
        "template",
        "missing-template",
        1
      )
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
    const detail = await service.getDetail(
      "workspace-a",
      "principal-a",
      baseSummary.itemKind,
      baseSummary.id,
      baseSummary.version
    )

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
