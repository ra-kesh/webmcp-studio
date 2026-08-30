import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { studioMediaManifest } from "../../content/library/media/manifest"
import { studioAssetIdForValue, studioAssets } from "./asset-catalog"

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
    }
  })

  it("does not expose new first-party paths as canonical document sources", () => {
    const newManifestItems = studioMediaManifest.filter(
      (item) => !studioAssets.some((asset) => asset.id === item.id)
    )
    expect(newManifestItems).toHaveLength(
      studioMediaManifest.length - studioAssets.length
    )
    for (const item of newManifestItems) {
      expect(studioAssetIdForValue(item.resourcePath)).toBeUndefined()
    }
  })
})
