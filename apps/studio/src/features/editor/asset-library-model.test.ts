import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import {
  assetReferenceUsage,
  formatStoragePercentage,
  healthyLocalAssetIds,
  localMediaRecoveryImpact,
  localMediaRecoveryImpactForReferenceKeys,
  localMediaRecoveryImpactSummary,
  matchesAssetSearch,
  missingLocalAssetIds,
  namedDocumentMediaUses,
  parseRecentLibraryUse,
  recordRecentLibraryUse,
  sortLocalUploadsByCreatedAt,
  sortManagedMediaAssets,
  wasMediaAssetUsed,
} from "./asset-library-model"

describe("asset library model", () => {
  it("keeps equal-count import aliases distinguishable by named uses", () => {
    const [firstNode, secondNode] = northstarSeed.nodes
    const firstPage = northstarSeed.pages.find((page) =>
      page.nodeIds.includes(firstNode.id)
    )!
    const secondPage = northstarSeed.pages.find((page) =>
      page.nodeIds.includes(secondNode.id)
    )!
    const firstOutput = northstarSeed.outputs.find((output) =>
      output.pageIds.includes(firstPage.id)
    )!
    const secondOutput = northstarSeed.outputs.find((output) =>
      output.pageIds.includes(secondPage.id)
    )!

    const first = namedDocumentMediaUses(northstarSeed, {
      nodeIds: [firstNode.id],
      fieldIds: [],
      pageIds: [firstPage.id],
      outputIds: [firstOutput.id],
    })
    const second = namedDocumentMediaUses(northstarSeed, {
      nodeIds: [secondNode.id],
      fieldIds: [],
      pageIds: [secondPage.id],
      outputIds: [secondOutput.id],
    })

    expect(first).toHaveLength(second.length)
    expect(first.map((use) => use.label)).not.toEqual(
      second.map((use) => use.label)
    )
    expect(first).toContainEqual(
      expect.objectContaining({ label: firstNode.name, kind: "Layer" })
    )
    expect(second).toContainEqual(
      expect.objectContaining({ label: secondNode.name, kind: "Layer" })
    )
  })

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
          constraints: { horizontal: "min" as const, vertical: "min" as const },
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
          constraints: { horizontal: "min" as const, vertical: "min" as const },
        },
      ],
    }

    expect(missingLocalAssetIds(document, ["available"])).toEqual(["missing"])
    expect(missingLocalAssetIds(document, ["available", "missing"])).toEqual([])
    expect(
      missingLocalAssetIds(document, healthyLocalAssetIds(["missing"], []))
    ).toEqual(["missing"])
  })

  it("projects every alias use instead of stopping at the first image node", () => {
    const source = "asset:local/missing"
    const page = northstarSeed.pages[0]
    const image = (id: string, locked: boolean) => ({
      id,
      type: "image" as const,
      name: id,
      assetId: "missing",
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
      locked,
      constraints: { horizontal: "min" as const, vertical: "min" as const },
    })
    const document = {
      ...northstarSeed,
      pages: [
        {
          ...page,
          nodeIds: [...page.nodeIds, "direct-image", "bound-image"],
        },
      ],
      outputs: northstarSeed.outputs.map((output) => ({
        ...output,
        pageIds: [page.id],
      })),
      nodes: [
        ...northstarSeed.nodes,
        image("direct-image", false),
        image("bound-image", true),
      ],
      fields: [
        ...northstarSeed.fields,
        {
          id: "hero_asset",
          key: "hero_asset",
          label: "Hero asset",
          type: "asset" as const,
          required: true,
          defaultValue: source,
          agentDescription: "",
          validation: {},
        },
      ],
      fieldValues: {
        ...northstarSeed.fieldValues,
        hero_asset: source,
      },
      bindings: [
        ...northstarSeed.bindings,
        {
          id: "hero-binding",
          fieldId: "hero_asset",
          nodeId: "bound-image",
          property: "src" as const,
        },
      ],
    }

    const impact = localMediaRecoveryImpact(document, "missing")
    expect(impact).toMatchObject({
      referenceKeys: [
        "field/hero_asset/current",
        "field/hero_asset/default",
        "node/bound-image/src",
        "node/direct-image/src",
      ],
      directNodeIds: ["bound-image", "direct-image"],
      projectedNodeIds: ["bound-image"],
      fieldIds: ["hero_asset"],
      lockedNodeIds: ["bound-image"],
      requiredFieldIds: ["hero_asset"],
      referenceCount: 4,
    })
    expect(impact.pageIds).toEqual([page.id])
    expect(impact.outputIds).toEqual(
      northstarSeed.outputs.map((output) => output.id).sort()
    )
    expect(localMediaRecoveryImpactSummary(impact)).toContain("4 uses")
    expect(localMediaRecoveryImpactSummary(impact)).toContain("2 layers")
    expect(localMediaRecoveryImpactSummary(impact)).toContain("1 field")

    const migratedDocument = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.type === "image" && node.src === source
          ? {
              ...node,
              src: "asset:managed/asset-recovered-12345",
              assetId: "asset-recovered-12345",
            }
          : node
      ),
      fields: document.fields.map((field) =>
        field.type === "asset" && field.defaultValue === source
          ? {
              ...field,
              defaultValue: "asset:managed/asset-recovered-12345",
            }
          : field
      ),
      fieldValues: {
        ...document.fieldValues,
        hero_asset: "asset:managed/asset-recovered-12345",
      },
    }
    expect(
      localMediaRecoveryImpactForReferenceKeys(
        migratedDocument,
        "missing",
        impact.referenceKeys
      )
    ).toMatchObject({
      referenceKeys: impact.referenceKeys,
      directNodeIds: impact.directNodeIds,
      projectedNodeIds: impact.projectedNodeIds,
      fieldIds: impact.fieldIds,
      pageIds: impact.pageIds,
      outputIds: impact.outputIds,
      referenceCount: impact.referenceCount,
    })
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
