import { describe, expect, it, vi } from "vitest"
import { verifyManagedBrowserImageResource } from "./managed-image-resource"
import type { ManagedImageResourceError } from "./managed-image-resource"

const asset = {
  id: "asset-abcdefghij",
  mediaType: "image/png" as const,
  bytes: 4,
  width: 1_200,
  height: 800,
}

const verifiedResponse = () =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: {
      "Content-Type": asset.mediaType,
      ETag: `"sha256-${"a".repeat(64)}"`,
    },
  })

describe("managed browser image resource integrity", () => {
  it("returns one typed resource only after decoded dimensions match metadata", async () => {
    const fetchContent = vi
      .fn<typeof fetch>()
      .mockResolvedValue(verifiedResponse())

    await expect(
      verifyManagedBrowserImageResource(
        asset,
        async () => ({ width: 1_200, height: 800 }),
        fetchContent
      )
    ).resolves.toEqual({
      assetId: asset.id,
      src: `asset:managed/${asset.id}`,
      width: 1_200,
      height: 800,
      contentHash: "a".repeat(64),
    })
  })

  it("rejects a natural-dimension mismatch before downstream document mutation", async () => {
    const document = { revision: 7, nodeIds: ["image-a"] }
    const before = structuredClone(document)
    const commit = vi.fn()

    await expect(
      verifyManagedBrowserImageResource(
        asset,
        async () => ({ width: 800, height: 1_200 }),
        async () => verifiedResponse()
      ).then(commit)
    ).rejects.toEqual(
      expect.objectContaining<Partial<ManagedImageResourceError>>({
        code: "managed_image_dimension_mismatch",
      })
    )
    expect(commit).not.toHaveBeenCalled()
    expect(document).toEqual(before)
  })
})
