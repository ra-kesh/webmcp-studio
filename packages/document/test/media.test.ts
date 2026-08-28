import { describe, expect, it } from "vitest"
import {
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_MAX_DIMENSION,
  MEDIA_ASSET_MAX_PIXEL_AREA,
  MEDIA_ASSET_TYPES,
  managedAssetIdFromSource,
  managedAssetSource,
  mediaAssetDeletionImpactResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetLookupResponseSchema,
  publicMediaAssetSchema,
} from "../src"

const assetId = "asset-0123456789abcdef0123456789abcdef"
const now = "2026-08-28T00:00:00.000Z"

describe("shared media transport contract", () => {
  it("enforces the canonical managed source identity", () => {
    expect(managedAssetSource(assetId)).toBe(`asset:managed/${assetId}`)
    expect(managedAssetIdFromSource(`asset:managed/${assetId}`)).toBe(assetId)
    expect(managedAssetIdFromSource("asset:managed/../private")).toBeNull()
    expect(() => managedAssetSource("../private")).toThrow()
  })

  it("strictly parses public list metadata without private storage fields", () => {
    const response = {
      assets: [
        {
          id: assetId,
          name: "Portrait",
          mediaType: "image/png",
          bytes: 128,
          width: 10,
          height: 12,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now,
          status: "ready",
        },
      ],
      nextCursor: null,
      storage: { bytes: 128, count: 1 },
    }
    expect(mediaAssetListResponseSchema.parse(response)).toEqual(response)
    expect(() =>
      mediaAssetListResponseSchema.parse({
        ...response,
        assets: [{ ...response.assets[0], r2Key: "private/key" }],
      })
    ).toThrow()
  })

  it("shares exact byte, edge, pixel-area, and media-type limits", () => {
    expect(MEDIA_ASSET_MAX_BYTES).toBe(25_000_000)
    expect(MEDIA_ASSET_MAX_DIMENSION).toBe(16_384)
    expect(MEDIA_ASSET_MAX_PIXEL_AREA).toBe(100_000_000)
    expect(MEDIA_ASSET_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"])
    const boundary = {
      id: assetId,
      name: "Boundary",
      mediaType: "image/webp",
      bytes: MEDIA_ASSET_MAX_BYTES,
      width: MEDIA_ASSET_MAX_DIMENSION,
      height: 6_103,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      status: "ready",
    }
    expect(publicMediaAssetSchema.parse(boundary)).toEqual(boundary)
    expect(() =>
      publicMediaAssetSchema.parse({ ...boundary, height: 6_104 })
    ).toThrow()
  })

  it("resolves ready and archived metadata without exposing a storage source", () => {
    const archived = {
      asset: {
        id: assetId,
        name: "Portrait",
        mediaType: "image/png",
        bytes: 128,
        width: 10,
        height: 12,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        status: "archived",
        selectable: false,
      },
    }
    expect(mediaAssetLookupResponseSchema.parse(archived)).toEqual(archived)
    expect(() =>
      mediaAssetLookupResponseSchema.parse({
        asset: { ...archived.asset, selectable: true },
      })
    ).toThrow()
    expect(() =>
      mediaAssetLookupResponseSchema.parse({
        asset: { ...archived.asset, r2Key: "private/key" },
      })
    ).toThrow()
  })

  it("strictly parses the reference-safe archive impact shape", () => {
    const response = {
      impact: {
        assetId,
        revision: 2,
        token: "a".repeat(64),
        canArchive: false,
        currentReferences: 1,
        publishedReferences: 1,
        references: [
          {
            referenceKind: "published_version",
            sourceId: "version-1",
            documentId: "document-1",
            pageId: "page-1",
            nodeId: "node-1",
            fieldId: null,
            property: "src",
          },
        ],
      },
    }
    expect(mediaAssetDeletionImpactResponseSchema.parse(response)).toEqual(
      response
    )
  })
})
