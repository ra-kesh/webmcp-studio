import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import {
  assetReferenceUsage,
  formatStoragePercentage,
  healthyLocalAssetIds,
  matchesAssetSearch,
  missingLocalAssetIds,
  parseRecentLibraryUse,
  recordRecentLibraryUse,
  sortLocalUploadsByCreatedAt,
  sortManagedMediaAssets,
  wasMediaAssetUsed,
} from "./asset-library-model"

describe("asset library model", () => {
  it("finds managed media references across nodes, pages, and asset fields", () => {
    const assetId = "asset-hero-photo-12345"
    const source = `asset:managed/${assetId}`
    const page = northstarSeed.pages[0]
    const document = {
      ...northstarSeed,
      pages: [{ ...page, nodeIds: [...page.nodeIds, "hero-node"] }],
      nodes: [
        ...northstarSeed.nodes,
        {
          id: "hero-node",
          type: "image" as const,
          name: "Hero",
          assetId,
          src: source,
          alt: "",
          placement: {
            mode: "fill" as const,
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          frameMask: { shape: "rectangle" as const },
          decorative: false,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset" as const,
          required: false,
          defaultValue: source,
          agentDescription: "",
          validation: {},
        },
      ],
    }

    expect(assetReferenceUsage(document, "managed", assetId)).toEqual({
      assetId,
      nodeIds: ["hero-node"],
      pageIds: [page.id],
      fieldIds: ["hero_asset"],
      referenceCount: 2,
    })
  })

  it("reports only local references whose blobs are absent", () => {
    const page = northstarSeed.pages[0]
    const document = {
      ...northstarSeed,
      pages: [{ ...page, nodeIds: [...page.nodeIds, "missing-node"] }],
      nodes: [
        ...northstarSeed.nodes,
        {
          id: "missing-node",
          type: "image" as const,
          name: "Missing",
          assetId: "missing",
          src: "asset:local/missing",
          alt: "",
          placement: {
            mode: "fill" as const,
            focalX: 0.5,
            focalY: 0.5,
            zoom: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          frameMask: { shape: "rectangle" as const },
          decorative: false,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
    }

    expect(missingLocalAssetIds(document, ["available"])).toEqual(["missing"])
    expect(missingLocalAssetIds(document, ["available", "missing"])).toEqual([])
    expect(
      missingLocalAssetIds(document, healthyLocalAssetIds(["missing"], []))
    ).toEqual(["missing"])
  })

  it("normalizes search and caps storage percentages", () => {
    expect(matchesAssetSearch("  WARM ", "Warm grain", "background")).toBe(true)
    expect(matchesAssetSearch("portrait", "Warm grain", "background")).toBe(
      false
    )
    expect(formatStoragePercentage(75, 100)).toBe(75)
    expect(formatStoragePercentage(120, 100)).toBe(100)
    expect(formatStoragePercentage(10, null)).toBeNull()
  })

  it("sorts Uploads by creation and Recent by actual use", () => {
    const common = {
      name: "Image",
      mediaType: "image/png" as const,
      bytes: 10,
      width: 10,
      height: 10,
      updatedAt: "2026-08-28T00:00:00.000Z",
      status: "ready" as const,
    }
    const olderButUsed = {
      ...common,
      id: "asset-older-but-used1",
      createdAt: "2026-08-26T00:00:00.000Z",
      lastUsedAt: "2026-08-28T03:00:00.000Z",
    }
    const newerButUnused = {
      ...common,
      id: "asset-newer-unused001",
      createdAt: "2026-08-28T02:00:00.000Z",
      lastUsedAt: "2026-08-28T02:00:00.000Z",
    }
    expect(
      sortManagedMediaAssets([olderButUsed, newerButUnused], "uploads").map(
        (asset) => asset.id
      )
    ).toEqual([newerButUnused.id, olderButUsed.id])
    expect(
      sortManagedMediaAssets([olderButUsed, newerButUnused], "recent").map(
        (asset) => asset.id
      )
    ).toEqual([olderButUsed.id, newerButUnused.id])
    expect(
      sortLocalUploadsByCreatedAt([
        { id: "older", createdAt: olderButUsed.createdAt },
        { id: "newer", createdAt: newerButUnused.createdAt },
      ]).map((asset) => asset.id)
    ).toEqual(["newer", "older"])
    expect(wasMediaAssetUsed(olderButUsed)).toBe(true)
    expect(wasMediaAssetUsed(newerButUnused)).toBe(false)
  })

  it("persists only valid bounded built-in recent-use timestamps", () => {
    expect(
      parseRecentLibraryUse(
        JSON.stringify({ olive: 10, invalid: "now", zero: 0 })
      )
    ).toEqual({ olive: 10 })
    expect(parseRecentLibraryUse("not json")).toEqual({})
    expect(recordRecentLibraryUse({ olive: 10 }, "sandstone", 20)).toEqual({
      sandstone: 20,
      olive: 10,
    })
  })
})
