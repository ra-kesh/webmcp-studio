import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import {
  LibraryCatalogIndex,
  LibraryCatalogProjectionError,
  builtInDesignTemplateRepository,
  projectCuratedMediaDetail,
  projectCuratedMediaSummary,
  projectDesignTemplateDetail,
  projectDesignTemplateSummary,
  projectLocalMediaDetail,
  projectLocalMediaSummary,
  projectPublicMediaDetail,
  projectPublicMediaSummary,
  publicMediaAssetSchema,
} from "@webmcp/document"
import type {
  LibraryProvenance,
  LocalLibraryMediaMetadata,
  WorkspaceLibraryMediaMetadata,
} from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import type { LocalAssetSummary } from "./local-asset-store"

const catalogTimestamp = "2026-08-31T00:00:00.000Z"
const templateUseCaseTags = new Set([
  "announcement",
  "brief",
  "event",
  "launch",
  "proposal",
  "quotation",
  "wedding",
])

const workspaceProvenance: LibraryProvenance = {
  sourceName: "Workspace upload",
  sourceUrl: null,
  license: {
    id: "customer-provided",
    name: "Customer-provided media",
    url: null,
  },
  attribution: { required: false, text: null },
  contentSha256: null,
}

const workspaceMetadata = (
  patch: Partial<WorkspaceLibraryMediaMetadata> = {}
): WorkspaceLibraryMediaMetadata => ({
  catalogVersion: 1,
  description: "Workspace media used in client documents.",
  categoryId: "workspace-media",
  useCaseIds: ["client-work"],
  formatFamily: "image",
  tags: ["client-work"],
  provenance: workspaceProvenance,
  ...patch,
})

const localMetadata = (
  patch: Partial<LocalLibraryMediaMetadata> = {}
): LocalLibraryMediaMetadata => ({
  description: "Browser-local media used in the current workspace.",
  categoryId: "local-media",
  useCaseIds: ["client-work"],
  formatFamily: "image",
  tags: ["client-work"],
  provenance: workspaceProvenance,
  ...patch,
})

describe("library catalog source projections", () => {
  it("projects every active built-in template without carrying preview documents", () => {
    const sourceItems = builtInDesignTemplateRepository.list()
    const summaries = sourceItems.map((item, index) =>
      projectDesignTemplateSummary(item, {
        curatedRank: index,
        useCaseIds: item.tags.filter((tag) => templateUseCaseTags.has(tag)),
      })
    )

    expect(summaries).toHaveLength(5)
    expect(summaries.map((summary) => summary.id)).toEqual(
      sourceItems.map((item) => item.id)
    )
    for (const [index, summary] of summaries.entries()) {
      const source = sourceItems[index]!
      expect(summary).toMatchObject({
        version: source.version,
        templateKind: source.kind,
        pageCount: source.pageCount,
        owner: { kind: "studio" },
        provenance: {
          sourceName: source.source.name,
          license: { name: source.source.license },
        },
      })
      expect(summary.dimensions).toEqual(source.dimensions)
      expect(summary.preview.pageId).toBe(source.previewPageId)
      expect(summary).not.toHaveProperty("previewDocument")
      expect(JSON.stringify(summary)).not.toContain("nodes")
    }

    const quotation = sourceItems.find(
      (item) => item.kind === "quotation_style"
    )!
    expect(
      projectDesignTemplateDetail(quotation, {
        useCaseIds: ["quotation"],
      }).materialization
    ).toEqual({
      repository: "design_template",
      templateId: quotation.id,
      templateVersion: quotation.version,
      sourceContext: "quotation",
    })
  })

  it("projects all current curated Studio assets without exposing their data URIs", () => {
    const summaries = studioAssets.map((asset, index) =>
      projectCuratedMediaSummary(asset, {
        categoryId: asset.tags[0]!,
        useCaseIds: asset.tags.filter((tag) =>
          ["background", "invitation", "travel", "wedding"].includes(tag)
        ),
        createdAt: catalogTimestamp,
        updatedAt: catalogTimestamp,
        curatedRank: index,
      })
    )

    expect(summaries).toHaveLength(6)
    expect(summaries.map((summary) => summary.id)).toEqual(
      studioAssets.map((asset) => asset.id)
    )
    for (const [index, summary] of summaries.entries()) {
      const source = studioAssets[index]!
      expect(summary).toMatchObject({
        name: source.name,
        version: source.version,
        description: source.description,
        mediaSource: "curated",
        mimeType: "image/svg+xml",
        dimensions: { width: source.width, height: source.height },
        owner: { kind: "studio" },
        selectable: true,
        provenance: { contentSha256: source.contentSha256 },
      })
      expect(summary.bytes).toBeGreaterThan(0)
      expect(JSON.stringify(summary)).not.toContain("data:image")
    }

    const detail = projectCuratedMediaDetail(studioAssets[0]!, {
      categoryId: studioAssets[0]!.tags[0]!,
      createdAt: catalogTimestamp,
      updatedAt: catalogTimestamp,
    })
    expect(detail.selectionIdentity).toEqual({
      source: "curated",
      assetId: studioAssets[0]!.id,
      version: studioAssets[0]!.version,
    })
  })

  it("binds curated versions and checksums to their exact source bytes", () => {
    for (const asset of studioAssets) {
      const [, encoded = ""] = asset.src.split(",", 2)
      const bytes = Buffer.from(decodeURIComponent(encoded))
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.contentSha256
      )
      expect(asset.version).toBeGreaterThan(0)
    }
  })

  it("keeps managed list metadata separate from authoritative selection", () => {
    const asset = publicMediaAssetSchema.parse({
      id: "asset-AbCdEfGhIjKl",
      name: "Client portrait",
      mediaType: "image/jpeg",
      bytes: 240_000,
      width: 1200,
      height: 1500,
      createdAt: "2026-08-30T08:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
      lastUsedAt: "2026-08-30T10:00:00.000Z",
      status: "ready",
    })
    const metadata = workspaceMetadata({ catalogVersion: 4 })
    const summary = projectPublicMediaSummary(asset, metadata)
    const detail = projectPublicMediaDetail(asset, metadata)

    expect(summary).toMatchObject({
      id: asset.id,
      version: 4,
      mediaSource: "managed",
      owner: { kind: "workspace" },
      dimensions: { width: asset.width, height: asset.height },
      bytes: asset.bytes,
    })
    expect(detail.selectionIdentity).toEqual({
      source: "managed",
      assetId: asset.id,
      refetch: "required",
    })
    expect(detail.selectionIdentity).not.toHaveProperty("revision")
    expect(JSON.stringify(detail)).not.toContain("r2Key")

    const restricted = projectPublicMediaSummary(
      asset,
      workspaceMetadata({
        permissions: {
          canView: true,
          canUse: false,
          canFavorite: true,
          canAddToCollection: true,
        },
      })
    )
    expect(restricted.selectable).toBe(false)
  })

  it("retains local revision and rejects archived, incomplete, or missing-byte records", () => {
    const asset: LocalAssetSummary = {
      schemaVersion: 4,
      id: "local-client-portrait",
      name: "Local client portrait",
      mediaType: "image/png",
      size: 180_000,
      width: 900,
      height: 1200,
      createdAt: "2026-08-30T08:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
      lastUsedAt: "2026-08-30T10:00:00.000Z",
      archivedAt: null,
      revision: 7,
      integrity: "ready",
    }
    const summary = projectLocalMediaSummary(asset, localMetadata())
    const detail = projectLocalMediaDetail(asset, localMetadata())

    expect(summary).toMatchObject({
      id: asset.id,
      version: asset.revision,
      mediaSource: "local",
      owner: { kind: "workspace" },
    })
    expect(detail.selectionIdentity).toEqual({
      source: "local",
      assetId: asset.id,
      revision: asset.revision,
    })

    const reasonFor = (patch: Partial<LocalAssetSummary>) => {
      try {
        projectLocalMediaSummary({ ...asset, ...patch }, localMetadata())
      } catch (error) {
        expect(error).toBeInstanceOf(LibraryCatalogProjectionError)
        return (error as LibraryCatalogProjectionError).reason
      }
      throw new Error("Expected local media projection to fail")
    }
    expect(reasonFor({ archivedAt: catalogTimestamp })).toBe(
      "local_asset_archived"
    )
    expect(reasonFor({ integrity: "missing_bytes" })).toBe(
      "local_asset_missing_bytes"
    )
    expect(reasonFor({ width: null })).toBe("local_asset_missing_dimensions")
  })

  it("builds one searchable index from current templates and curated media", () => {
    const templates = builtInDesignTemplateRepository
      .list()
      .map((item, index) =>
        projectDesignTemplateSummary(item, {
          curatedRank: index,
          useCaseIds: item.tags.filter((tag) => templateUseCaseTags.has(tag)),
        })
      )
    const media = studioAssets.map((asset, index) =>
      projectCuratedMediaSummary(asset, {
        categoryId: asset.tags[0]!,
        useCaseIds: asset.tags.filter((tag) =>
          ["background", "invitation", "travel", "wedding"].includes(tag)
        ),
        createdAt: catalogTimestamp,
        updatedAt: catalogTimestamp,
        curatedRank: templates.length + index,
      })
    )
    const catalog = new LibraryCatalogIndex("built-ins-r1", [
      ...templates,
      ...media,
    ])

    expect(
      catalog
        .list({ generation: "botanical-search", search: "olive botanical" })
        .items.map((item) => item.id)
    ).toEqual(["olive-botanical"])
    expect(
      catalog
        .list({
          generation: "proposal-filter",
          itemKinds: ["template"],
          useCaseIds: ["proposal"],
        })
        .items.map((item) => item.id)
    ).toContain("editorial-one-pager")
    expect(catalog.list({ generation: "all-current" }).total).toBe(11)
  })

  it("does not promote new use cases that are absent from source tags", () => {
    const template = builtInDesignTemplateRepository.list()[0]!
    expect(() =>
      projectDesignTemplateSummary(template, { useCaseIds: ["annual-report"] })
    ).toThrow(LibraryCatalogProjectionError)
    expect(() =>
      projectCuratedMediaSummary(studioAssets[0]!, {
        categoryId: studioAssets[0]!.tags[0]!,
        useCaseIds: ["annual-report"],
        createdAt: catalogTimestamp,
        updatedAt: catalogTimestamp,
      })
    ).toThrow(LibraryCatalogProjectionError)
  })
})
