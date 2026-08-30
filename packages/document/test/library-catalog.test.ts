import { describe, expect, it, vi } from "vitest"
import {
  LibraryCatalogCursorError,
  LibraryCatalogIndex,
  libraryCatalogItemSummarySchema,
  libraryCatalogQuerySchema,
  libraryMediaDetailSchema,
  libraryMediaSummarySchema,
  libraryTemplateDetailSchema,
  libraryTemplateSummarySchema,
} from "../src"
import type { LibraryMediaSummary, LibraryTemplateSummary } from "../src"

const createdAt = "2026-08-30T12:00:00.000Z"
const sha256 = "a".repeat(64)

const provenance = {
  sourceName: "Studio originals",
  sourceUrl: null,
  license: {
    id: "studio-internal",
    name: "Studio internal",
    url: null,
  },
  attribution: { required: false, text: null },
  contentSha256: null,
} as const

function templateSummary(
  options: {
    id?: string
    name?: string
    categoryId?: string
    useCaseIds?: string[]
    formatFamily?: string
    rank?: number | null
    favorite?: boolean
    lastUsedAt?: string | null
    collectionIds?: string[]
    owner?: "studio" | "workspace"
    createdAt?: string
    status?: "active" | "retired"
    templateKind?: "document_starter" | "quotation_style"
  } = {}
): LibraryTemplateSummary {
  const id = options.id ?? "editorial-one-pager"
  const templateKind = options.templateKind ?? "document_starter"
  return libraryTemplateSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "template",
    id,
    version: 1,
    templateKind,
    name: options.name ?? "Editorial one-pager",
    description: "A calm client-ready page for proposals and briefs.",
    categoryId: options.categoryId ?? "documents",
    useCaseIds: options.useCaseIds ?? ["brief", "proposal"],
    formatFamily: options.formatFamily ?? "document",
    orientation: "portrait",
    dimensions: [{ width: 1240, height: 1754 }],
    pageCount: 1,
    tags: ["editorial", "client-ready"],
    owner: { kind: options.owner ?? "studio" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: true,
      canAddToCollection: true,
    },
    provenance,
    compatibility: {
      availability:
        templateKind === "quotation_style" ? "requires_source" : "available",
      requirements:
        templateKind === "quotation_style" ? ["quotation_source"] : [],
      supportedActions: ["create", "apply"],
      reason: null,
    },
    preview: {
      kind: "live_fallback",
      itemId: id,
      itemVersion: 1,
      pageId: `${id}-page`,
      width: 310,
      height: 438,
      resourcePath: null,
      mediaType: null,
      contentSha256: null,
      rendererRevision: null,
    },
    preferences: {
      favorite: options.favorite ?? false,
      lastUsedAt: options.lastUsedAt ?? null,
      collectionIds: options.collectionIds ?? [],
    },
    catalogStatus: options.status ?? "active",
    curatedRank: options.rank ?? null,
    createdAt: options.createdAt ?? createdAt,
    updatedAt: options.createdAt ?? createdAt,
  })
}

function mediaSummary(
  options: {
    id?: string
    name?: string
    categoryId?: string
    useCaseIds?: string[]
    formatFamily?: string
    rank?: number | null
    favorite?: boolean
    lastUsedAt?: string | null
    collectionIds?: string[]
    source?: "curated" | "managed" | "local"
    createdAt?: string
  } = {}
): LibraryMediaSummary {
  const id = options.id ?? "soft-grid"
  const source = options.source ?? "curated"
  return libraryMediaSummarySchema.parse({
    schemaVersion: 1,
    itemKind: "media",
    id,
    version: 1,
    mediaSource: source,
    name: options.name ?? "Soft grid",
    description: "A quiet geometric backdrop for editorial layouts.",
    categoryId: options.categoryId ?? "backgrounds",
    useCaseIds: options.useCaseIds ?? ["editorial", "social"],
    formatFamily: options.formatFamily ?? "graphic",
    orientation: "square",
    mimeType: "image/png",
    dimensions: { width: 1080, height: 1080 },
    bytes: 42_000,
    selectable: true,
    tags: ["grid", "geometric"],
    owner: { kind: source === "curated" ? "studio" : "workspace" },
    permissions: {
      canView: true,
      canUse: true,
      canFavorite: true,
      canAddToCollection: true,
    },
    provenance: { ...provenance, contentSha256: sha256 },
    compatibility: {
      availability: "available",
      requirements: [],
      supportedActions: ["insert", "replace", "assign_field"],
      reason: null,
    },
    preview: {
      kind: "raster",
      itemId: id,
      itemVersion: 1,
      pageId: null,
      width: 320,
      height: 320,
      resourcePath: `/v1/studio/library/previews/media/${id}/1`,
      mediaType: "image/png",
      contentSha256: sha256,
      rendererRevision: "renderer-r1",
    },
    preferences: {
      favorite: options.favorite ?? false,
      lastUsedAt: options.lastUsedAt ?? null,
      collectionIds: options.collectionIds ?? [],
    },
    catalogStatus: "active",
    curatedRank: options.rank ?? null,
    createdAt: options.createdAt ?? createdAt,
    updatedAt: options.createdAt ?? createdAt,
  })
}

describe("library catalog schemas", () => {
  it("accepts compact template and media summaries without materializable content", () => {
    const template = templateSummary()
    const media = mediaSummary()

    expect(libraryCatalogItemSummarySchema.parse(template)).toEqual(template)
    expect(libraryCatalogItemSummarySchema.parse(media)).toEqual(media)
    expect(template).not.toHaveProperty("document")
    expect(media).not.toHaveProperty("src")
    expect(media).not.toHaveProperty("r2Key")
  })

  it("rejects unknown payload fields, invented team ownership, and private content locators", () => {
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...templateSummary(),
        document: { pages: [] },
      }).success
    ).toBe(false)
    expect(
      libraryMediaSummarySchema.safeParse({
        ...mediaSummary(),
        r2Key: "media/workspaces/private/original",
      }).success
    ).toBe(false)
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...templateSummary(),
        owner: { kind: "team" },
      }).success
    ).toBe(false)
  })

  it("enforces exact preview, orientation, provenance, and selectable projections", () => {
    const template = templateSummary()
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...template,
        preview: { ...template.preview, itemVersion: 2 },
      }).success
    ).toBe(false)
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...template,
        orientation: "landscape",
      }).success
    ).toBe(false)

    const media = mediaSummary()
    expect(
      libraryMediaSummarySchema.safeParse({ ...media, selectable: false })
        .success
    ).toBe(false)
    expect(
      libraryMediaSummarySchema.safeParse({
        ...media,
        provenance: {
          ...media.provenance,
          attribution: { required: true, text: null },
        },
      }).success
    ).toBe(false)

    for (const unsafeUrl of [
      "data:text/plain,private",
      "blob:https://studio.example/private",
      "file:///Users/customer/private.png",
    ]) {
      expect(
        libraryTemplateSummarySchema.safeParse({
          ...template,
          provenance: { ...template.provenance, sourceUrl: unsafeUrl },
        }).success
      ).toBe(false)
      expect(
        libraryTemplateSummarySchema.safeParse({
          ...template,
          provenance: {
            ...template.provenance,
            license: { ...template.provenance.license, url: unsafeUrl },
          },
        }).success
      ).toBe(false)
    }
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...template,
        provenance: {
          ...template.provenance,
          sourceUrl: "https://studio.example/source",
          license: {
            ...template.provenance.license,
            url: "http://licenses.example/terms",
          },
        },
      }).success
    ).toBe(true)
  })

  it("rejects quotation styles that claim immediate availability", () => {
    const quotation = templateSummary({ templateKind: "quotation_style" })
    expect(
      libraryTemplateSummarySchema.safeParse({
        ...quotation,
        compatibility: {
          ...quotation.compatibility,
          availability: "available",
        },
      }).success
    ).toBe(false)
  })

  it("retains exact materialization and selection identities in details", () => {
    const template = templateSummary({ templateKind: "quotation_style" })
    expect(
      libraryTemplateDetailSchema.parse({
        schemaVersion: 1,
        summary: template,
        materialization: {
          repository: "design_template",
          templateId: template.id,
          templateVersion: template.version,
          sourceContext: "quotation",
        },
      }).materialization.sourceContext
    ).toBe("quotation")
    expect(
      libraryTemplateDetailSchema.safeParse({
        schemaVersion: 1,
        summary: template,
        materialization: {
          repository: "design_template",
          templateId: template.id,
          templateVersion: 2,
          sourceContext: "quotation",
        },
      }).success
    ).toBe(false)

    const media = mediaSummary({ source: "managed", id: "asset-opaque-1" })
    expect(
      libraryMediaDetailSchema.safeParse({
        schemaVersion: 1,
        summary: media,
        selectionIdentity: {
          source: "managed",
          assetId: media.id,
          refetch: "required",
        },
      }).success
    ).toBe(true)
    expect(
      libraryMediaDetailSchema.safeParse({
        schemaVersion: 1,
        summary: media,
        selectionIdentity: {
          source: "managed",
          assetId: "different-asset",
          refetch: "required",
        },
      }).success
    ).toBe(false)
  })

  it("normalizes query text and set-like filters while rejecting unknown input", () => {
    expect(
      libraryCatalogQuerySchema.parse({
        generation: "search-7",
        search: "  Client   READY ",
        categoryIds: ["social", "documents", "social"],
      })
    ).toMatchObject({
      search: "client ready",
      categoryIds: ["documents", "social"],
      limit: 24,
      order: "curated",
    })
    expect(
      libraryCatalogQuerySchema.safeParse({
        generation: "search-7",
        teamId: "invented-team",
      }).success
    ).toBe(false)
    expect(
      libraryCatalogQuerySchema.safeParse({
        generation: "search-7",
        limit: 51,
      }).success
    ).toBe(false)
  })

  it("does not depend on the host locale for search or ordering", () => {
    const localeLower = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(() => {
        throw new Error("Locale-sensitive normalization is forbidden")
      })
    try {
      const catalog = new LibraryCatalogIndex("catalog-locale-r1", [
        templateSummary({ id: "istanbul-brief", name: "Istanbul brief" }),
        templateSummary({ id: "atlas-brief", name: "Atlas brief" }),
      ])
      expect(
        catalog
          .list({ generation: "locale-stable", search: "ISTANBUL" })
          .items.map((item) => item.id)
      ).toEqual(["istanbul-brief"])
    } finally {
      localeLower.mockRestore()
    }
  })
})

describe("library catalog index", () => {
  it("owns immutable snapshots and rejects duplicate version identities", () => {
    const source = templateSummary()
    const index = new LibraryCatalogIndex("catalog-r1", [source])
    source.name = "Changed outside the index"

    const page = index.list({ generation: "immutable-1" })
    expect(page.items[0]?.name).toBe("Editorial one-pager")
    expect(Object.isFrozen(page)).toBe(true)
    expect(Object.isFrozen(page.items)).toBe(true)
    expect(Object.isFrozen(page.items[0]?.preview)).toBe(true)
    expect(() => {
      page.items[0]!.name = "Mutation attempt"
    }).toThrow()
    expect(
      () => new LibraryCatalogIndex("catalog-r1", [source, source])
    ).toThrow("Duplicate library catalog item")
  })

  it("orders deterministically and composes discovery, ownership, and preference filters", () => {
    const items = [
      templateSummary({
        id: "proposal-template",
        name: "Premium proposal",
        categoryId: "proposals",
        useCaseIds: ["proposal"],
        rank: 2,
        favorite: true,
        collectionIds: ["client-work"],
        lastUsedAt: "2026-08-30T10:00:00.000Z",
      }),
      mediaSummary({
        id: "proposal-texture",
        name: "Proposal texture",
        categoryId: "backgrounds",
        useCaseIds: ["proposal"],
        rank: 1,
        lastUsedAt: "2026-08-30T11:00:00.000Z",
      }),
      templateSummary({
        id: "workspace-brief",
        name: "Workspace brief",
        owner: "workspace",
        rank: 3,
        createdAt: "2026-08-31T10:00:00.000Z",
      }),
      templateSummary({
        id: "retired-template",
        name: "Retired template",
        rank: 0,
        status: "retired",
      }),
    ]
    const index = new LibraryCatalogIndex("catalog-r1", items)

    expect(
      index.list({ generation: "curated" }).items.map((item) => item.id)
    ).toEqual(["proposal-texture", "proposal-template", "workspace-brief"])
    expect(
      index
        .list({
          generation: "search",
          search: "premium proposal",
          itemKinds: ["template"],
          useCaseIds: ["proposal"],
        })
        .items.map((item) => item.id)
    ).toEqual(["proposal-template"])
    expect(
      index
        .list({
          generation: "favorites",
          favoritesOnly: true,
          collectionId: "client-work",
        })
        .items.map((item) => item.id)
    ).toEqual(["proposal-template"])
    expect(
      index
        .list({
          generation: "workspace",
          ownerKinds: ["workspace"],
          order: "newest",
        })
        .items.map((item) => item.id)
    ).toEqual(["workspace-brief"])
    expect(
      index
        .list({ generation: "recent", order: "recent" })
        .items.map((item) => item.id)
    ).toEqual(["proposal-texture", "proposal-template", "workspace-brief"])
    expect(
      index
        .list({ generation: "recent-only", recentOnly: true, order: "recent" })
        .items.map((item) => item.id)
    ).toEqual(["proposal-texture", "proposal-template"])
  })

  it("binds opaque cursors to catalog revision, generation, and normalized query identity", () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      templateSummary({
        id: `template-${index + 1}`,
        name: `Template ${index + 1}`,
        rank: index,
      })
    )
    const catalog = new LibraryCatalogIndex("catalog-r1", items)
    const first = catalog.list({ generation: "browse-1", limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual([
      "template-1",
      "template-2",
    ])
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)

    const second = catalog.list({
      generation: "browse-1",
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(second.items.map((item) => item.id)).toEqual([
      "template-3",
      "template-4",
    ])
    expect(second.queryIdentity).toBe(first.queryIdentity)

    const failureReason = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        expect(error).toBeInstanceOf(LibraryCatalogCursorError)
        return (error as LibraryCatalogCursorError).reason
      }
      throw new Error("Expected cursor rejection")
    }
    expect(
      failureReason(() =>
        catalog.list({
          generation: "browse-2",
          limit: 2,
          cursor: first.nextCursor,
        })
      )
    ).toBe("generation_mismatch")
    expect(
      failureReason(() =>
        catalog.list({
          generation: "browse-1",
          limit: 2,
          order: "newest",
          cursor: first.nextCursor,
        })
      )
    ).toBe("query_mismatch")
    expect(
      failureReason(() =>
        catalog.list({
          generation: "browse-1",
          limit: 2,
          recentOnly: true,
          cursor: first.nextCursor,
        })
      )
    ).toBe("query_mismatch")
    expect(
      failureReason(() =>
        new LibraryCatalogIndex("catalog-r2", items).list({
          generation: "browse-1",
          limit: 2,
          cursor: first.nextCursor,
        })
      )
    ).toBe("catalog_revision_mismatch")
    expect(
      failureReason(() =>
        catalog.list({ generation: "browse-1", cursor: "not-json" })
      )
    ).toBe("malformed")
  })

  it("queries a 500-item catalog within the phase budget", () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      templateSummary({
        id: `scale-template-${index + 1}`,
        name: `Scale template ${String(index + 1).padStart(3, "0")}`,
        categoryId: index % 2 ? "documents" : "proposals",
        useCaseIds: index % 3 ? ["brief"] : ["proposal"],
        rank: index,
      })
    )
    const catalog = new LibraryCatalogIndex("catalog-scale-r1", items)
    catalog.list({ generation: "warmup", search: "scale", limit: 50 })

    const durations = Array.from({ length: 7 }, (_, iteration) => {
      const startedAt = performance.now()
      const page = catalog.list({
        generation: `measure-${iteration}`,
        search: "scale template",
        categoryIds: ["documents"],
        order: "newest",
        limit: 50,
      })
      expect(page.total).toBe(250)
      return performance.now() - startedAt
    }).sort((left, right) => left - right)

    expect(durations[Math.floor(durations.length / 2)]).toBeLessThan(50)
  })
})
