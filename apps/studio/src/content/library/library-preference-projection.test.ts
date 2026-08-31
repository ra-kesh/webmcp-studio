import { describe, expect, it } from "vitest"
import type {
  LibraryPreferenceSnapshot,
  LibraryTemplateSummary,
} from "@webmcp/document"
import { catalogTemplates } from "./library-template-browser.test-support"
import {
  effectiveLibraryPreference,
  projectLibraryCollectionOptions,
  projectLibraryTemplatePreferences,
} from "./library-preference-projection"

const template = (): LibraryTemplateSummary =>
  structuredClone(catalogTemplates[0])

const snapshot = (
  item: LibraryTemplateSummary,
  overrides: Partial<LibraryPreferenceSnapshot> = {}
): LibraryPreferenceSnapshot => ({
  workspaceRevision: 3,
  preferences: [
    {
      identity: { itemKind: "template", id: item.id, version: item.version },
      favorite: true,
      lastUsedAt: "2026-08-31T10:00:00.000Z",
      collectionIds: ["collection-proposals"],
      revision: 2,
      updatedAt: "2026-08-31T10:00:00.000Z",
    },
  ],
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
})
