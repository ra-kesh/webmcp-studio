import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { studioMediaManifest } from "../../content/library/media/manifest"
import {
  studioAssetIdForValue,
  studioAssetContentPathForValue,
  studioAssetIdentityForValue,
  studioAssets,
  studioCompatibilityAssetPathForValue,
} from "./asset-catalog"

describe("Studio asset compatibility facade", () => {
  it("keeps the six proven insertion sources render-safe until curated materialization lands", () => {
    expect(studioAssets).toHaveLength(6)
    expect(studioAssets.map((asset) => asset.id).sort()).toEqual([
      "dusk-blocks",
      "floral-linework",
      "linen-paper",
      "olive-botanical",
      "sandstone-arches",
      "warm-grain",
    ])

    for (const asset of studioAssets) {
      expect(asset.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
      expect(asset.resourcePath).toBeNull()
      expect(studioMediaManifest.some((item) => item.id === asset.id)).toBe(
        true
      )
      const [, encoded = ""] = asset.src.split(",", 2)
      const bytes = Buffer.from(decodeURIComponent(encoded))
      expect(bytes.byteLength).toBe(asset.bytes)
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.contentSha256
      )
      expect(asset.provenance.contentSha256).toBe(asset.contentSha256)
      expect(studioAssetIdForValue(asset.id)).toBe(asset.id)
      expect(studioAssetIdForValue(asset.src)).toBe(asset.id)
      const compatibilityPath = studioCompatibilityAssetPathForValue(asset.src)
      expect(compatibilityPath).toBe(
        `/library/media/${asset.id}/v${asset.version}/${asset.contentSha256}.svg`
      )
      expect(studioAssetIdentityForValue(compatibilityPath)).toEqual({
        assetId: asset.id,
        version: asset.version,
        contentSha256: asset.contentSha256,
      })
      expect(studioAssetContentPathForValue(compatibilityPath)).toBe(
        `/v1/studio/library/media/${encodeURIComponent(asset.id)}/versions/${asset.version}/content`
      )
    }
  })

  it("recognizes every immutable manifest path while retaining the six compatibility data URIs", () => {
    const newManifestItems = studioMediaManifest.filter(
      (item) => !studioAssets.some((asset) => asset.id === item.id)
    )
    expect(newManifestItems).toHaveLength(
      studioMediaManifest.length - studioAssets.length
    )
    for (const item of studioMediaManifest) {
      expect(studioAssetIdForValue(item.id)).toBe(item.id)
      expect(studioAssetIdForValue(item.resourcePath)).toBe(item.id)
      expect(studioAssetIdentityForValue(item.resourcePath)).toEqual({
        assetId: item.id,
        version: item.version,
        contentSha256: item.contentSha256,
      })
      expect(studioAssetContentPathForValue(item.resourcePath)).toBe(
        `/v1/studio/library/media/${encodeURIComponent(item.id)}/versions/${item.version}/content`
      )
    }
    for (const item of newManifestItems) {
      expect(item.resourcePath).not.toMatch(/^data:/)
    }
    expect(studioAssetContentPathForValue(studioAssets[0]?.src)).toBeUndefined()
  })
})
