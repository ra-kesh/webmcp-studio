import { describe, expect, it } from "vitest"
import { libraryMediaSummarySchema } from "@webmcp/document"
import type {
  LibraryMediaSummary,
  LibraryPreferenceSnapshot,
  LibraryTemplateSummary,
} from "@webmcp/document"
import { catalogTemplates } from "./library-template-browser.test-support"
import {
  effectiveLibraryPreference,
  projectLibraryCollectionOptions,
  projectLibraryMediaPreferences,
  projectLibraryTemplatePreferences,
} from "./library-preference-projection"

const template = (): LibraryTemplateSummary =>
  structuredClone(catalogTemplates[0])

const media = (
  mediaSource: LibraryMediaSummary["mediaSource"],
  overrides: Partial<LibraryMediaSummary> = {}
): LibraryMediaSummary =>
  libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id: `${mediaSource}-hero`,
    version: 1,
    mediaSource,
    name: `${mediaSource} hero`,
    description: `A ${mediaSource} library image`,
    categoryId: "photograph",
    useCaseIds: ["proposal"],
    formatFamily: "raster",
    orientation: "landscape",
    mimeType: "image/jpeg",
    dimensions: { width: 1_600, height: 900 },
    bytes: 4_096,
    selectable: true,
    tags: ["hero", "proposal"],
    owner:
      mediaSource === "curated" ? { kind: "studio" } : { kind: "workspace" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: mediaSource !== "local",
      canAddToCollection: mediaSource !== "local",
    },
    provenance: {
      sourceName: mediaSource === "local" ? "This device" : "Studio library",
      sourceUrl: null,
      license: {
        id: "studio-original",
        name: "Studio original",
        url: null,
      },
      attribution: { required: false, text: null },
      contentSha256: mediaSource === "curated" ? "a".repeat(64) : null,
    },
    compatibility: {
      availability: "available",
      requirements: [],
      supportedActions: ["insert", "replace", "assign_field"],
      reason: null,
    },
    preview: {
      kind: "live_fallback",
      itemId: `${mediaSource}-hero`,
      itemVersion: 1,
      pageId: null,
      width: 1_600,
      height: 900,
      resourcePath: null,
      mediaType: null,
      contentSha256: null,
      rendererRevision: null,
    },
    preferences:
      mediaSource === "local"
        ? {
            favorite: false,
            lastUsedAt: "2026-08-31T09:30:00.000Z",
            collectionIds: [],
          }
        : null,
    catalogStatus: "active",
    curatedRank: mediaSource === "curated" ? 1 : null,
    createdAt: "2026-08-31T09:00:00.000Z",
    updatedAt: "2026-08-31T09:00:00.000Z",
    ...overrides,
  })

type PreferenceItem = Pick<
  LibraryTemplateSummary | LibraryMediaSummary,
  "itemKind" | "id" | "version"
>

const preference = (
  item: PreferenceItem,
  overrides: Partial<LibraryPreferenceSnapshot["preferences"][number]> = {}
): LibraryPreferenceSnapshot["preferences"][number] => ({
  identity: {
    itemKind: item.itemKind,
    id: item.id,
    version: item.version,
  },
  favorite: true,
  lastUsedAt: "2026-08-31T10:00:00.000Z",
  collectionIds: ["collection-proposals"],
  revision: 2,
  updatedAt: "2026-08-31T10:00:00.000Z",
  ...overrides,
})

const snapshot = (
  item: PreferenceItem,
  overrides: Partial<LibraryPreferenceSnapshot> = {}
): LibraryPreferenceSnapshot => ({
  workspaceRevision: 3,
  preferences: [preference(item)],
  collections: [
    {
      id: "collection-proposals",
      name: "Proposals",
      scope: "workspace",
      revision: 1,
      itemCount: 1,
      createdAt: "2026-08-31T09:00:00.000Z",
      updatedAt: "2026-08-31T10:00:00.000Z",
    },
  ],
  ...overrides,
})

describe("library preference projection", () => {
  it("overlays only the exact immutable item identity without mutating discovery", () => {
    const source = template()
    const original = structuredClone(source)
    const projected = projectLibraryTemplatePreferences({
      items: [source],
      preferenceState: {
        snapshot: snapshot(source),
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })[0]

    expect(projected).not.toBe(source)
    expect(projected.preferences).toEqual({
      favorite: true,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: ["collection-proposals"],
    })
    expect(source).toEqual(original)

    const anotherVersion = { ...source, version: source.version + 1 }
    expect(
      effectiveLibraryPreference({
        item: anotherVersion,
        preferenceState: {
          snapshot: snapshot(source),
          snapshotStatus: "ready",
        },
        discoveryWorkspaceRevision: 3,
      })
    ).toEqual({ favorite: false, lastUsedAt: null, collectionIds: [] })
  })

  it("treats absence as false only after preference authority is available", () => {
    const source = {
      ...template(),
      preferences: {
        favorite: true,
        lastUsedAt: null,
        collectionIds: [],
      },
    }

    expect(
      effectiveLibraryPreference({
        item: source,
        preferenceState: {
          snapshot: null,
          snapshotStatus: "loading",
        },
        discoveryWorkspaceRevision: 3,
      })
    ).toEqual(source.preferences)
    expect(
      effectiveLibraryPreference({
        item: source,
        preferenceState: {
          snapshot: null,
          snapshotStatus: "ready",
        },
        discoveryWorkspaceRevision: 3,
      })
    ).toEqual({ favorite: false, lastUsedAt: null, collectionIds: [] })
  })

  it("derives collection filters from the authoritative snapshot", () => {
    const source = template()
    expect(
      projectLibraryCollectionOptions({ snapshot: snapshot(source) })
    ).toEqual([{ id: "collection-proposals", label: "Proposals" }])
  })

  it("masks favorite state only when favorite capability is revoked", () => {
    const source = template()
    const revoked = {
      ...source,
      permissions: {
        ...source.permissions,
        canFavorite: false,
      },
      preferences: {
        favorite: false,
        lastUsedAt: null,
        collectionIds: ["collection-proposals"],
      },
    }
    const projected = projectLibraryTemplatePreferences({
      items: [revoked],
      preferenceState: {
        snapshot: snapshot(source),
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })[0]

    expect(projected.preferences).toEqual({
      favorite: false,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: ["collection-proposals"],
    })
  })

  it("masks collection state only when collection capability is revoked", () => {
    const source = template()
    const revoked = {
      ...source,
      permissions: {
        ...source.permissions,
        canAddToCollection: false,
      },
      preferences: {
        favorite: true,
        lastUsedAt: null,
        collectionIds: [],
      },
    }
    const projected = projectLibraryTemplatePreferences({
      items: [revoked],
      preferenceState: {
        snapshot: snapshot(source),
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })[0]

    expect(projected.preferences).toEqual({
      favorite: true,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: [],
    })
  })

  it("does not let an older retained preference snapshot repaint a newer discovery page", () => {
    const source = {
      ...template(),
      preferences: {
        favorite: false,
        lastUsedAt: "2026-08-31T11:00:00.000Z",
        collectionIds: [],
      },
    }
    const staleSnapshot = snapshot(source, { workspaceRevision: 2 })
    const staleProjection = projectLibraryTemplatePreferences({
      items: [source],
      preferenceState: {
        snapshot: staleSnapshot,
        snapshotStatus: "failed",
      },
      discoveryWorkspaceRevision: 3,
    })[0]

    expect(staleProjection).toBe(source)
    expect(staleProjection.preferences).toEqual(source.preferences)

    const equalProjection = projectLibraryTemplatePreferences({
      items: [source],
      preferenceState: {
        snapshot: { ...staleSnapshot, workspaceRevision: 3 },
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })[0]
    expect(equalProjection.preferences?.favorite).toBe(true)
  })

  it("projects optimistic preferences onto exact curated and managed media identities", () => {
    const curated = media("curated", {
      preferences: {
        favorite: false,
        lastUsedAt: null,
        collectionIds: [],
      },
    })
    const managed = media("managed", {
      preferences: {
        favorite: false,
        lastUsedAt: null,
        collectionIds: [],
      },
    })
    const optimisticSnapshot = snapshot(curated, {
      preferences: [preference(curated), preference(managed)],
    })

    const projected = projectLibraryMediaPreferences({
      items: [curated, managed],
      preferenceState: {
        snapshot: optimisticSnapshot,
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })

    expect(projected.map(({ preferences }) => preferences)).toEqual([
      {
        favorite: true,
        lastUsedAt: "2026-08-31T10:00:00.000Z",
        collectionIds: ["collection-proposals"],
      },
      {
        favorite: true,
        lastUsedAt: "2026-08-31T10:00:00.000Z",
        collectionIds: ["collection-proposals"],
      },
    ])
    expect(curated.preferences?.favorite).toBe(false)
    expect(managed.preferences?.favorite).toBe(false)
  })

  it("applies media permission masks without suppressing permitted preference fields", () => {
    const curated = media("curated", {
      permissions: {
        canView: true,
        canUse: true,
        canFavorite: false,
        canAddToCollection: true,
      },
    })
    const managed = media("managed", {
      permissions: {
        canView: true,
        canUse: true,
        canFavorite: true,
        canAddToCollection: false,
      },
    })

    const projected = projectLibraryMediaPreferences({
      items: [curated, managed],
      preferenceState: {
        snapshot: snapshot(curated, {
          preferences: [preference(curated), preference(managed)],
        }),
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })

    expect(projected[0]?.preferences).toEqual({
      favorite: false,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: ["collection-proposals"],
    })
    expect(projected[1]?.preferences).toEqual({
      favorite: true,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: [],
    })
  })

  it("keeps newer media discovery preferences when the preference snapshot is stale", () => {
    const curated = media("curated", {
      preferences: {
        favorite: false,
        lastUsedAt: "2026-08-31T11:00:00.000Z",
        collectionIds: [],
      },
    })
    const managed = media("managed", {
      preferences: {
        favorite: false,
        lastUsedAt: "2026-08-31T11:00:00.000Z",
        collectionIds: [],
      },
    })

    const projected = projectLibraryMediaPreferences({
      items: [curated, managed],
      preferenceState: {
        snapshot: snapshot(curated, {
          workspaceRevision: 2,
          preferences: [preference(curated), preference(managed)],
        }),
        snapshotStatus: "failed",
      },
      discoveryWorkspaceRevision: 3,
    })

    expect(projected[0]).toBe(curated)
    expect(projected[1]).toBe(managed)
  })

  it("never projects durable favorites or collections onto local media", () => {
    const local = media("local", {
      id: "shared-media-id",
      permissions: {
        canView: true,
        canUse: true,
        canFavorite: true,
        canAddToCollection: true,
      },
      preferences: {
        favorite: true,
        lastUsedAt: "2026-08-31T09:30:00.000Z",
        collectionIds: ["collection-proposals"],
      },
      preview: {
        ...media("local").preview,
        itemId: "shared-media-id",
      },
    })
    const durableIdentityCollision = media("managed", {
      id: local.id,
      preview: { ...media("managed").preview, itemId: local.id },
    })

    const projected = projectLibraryMediaPreferences({
      items: [local],
      preferenceState: {
        snapshot: snapshot(durableIdentityCollision),
        snapshotStatus: "ready",
      },
      discoveryWorkspaceRevision: 3,
    })[0]

    expect(projected.preferences).toEqual({
      favorite: false,
      lastUsedAt: "2026-08-31T09:30:00.000Z",
      collectionIds: [],
    })
    expect(projected).not.toBe(local)
  })
})
