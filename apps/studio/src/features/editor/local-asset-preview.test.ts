import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { Document } from "@webmcp/document"
import type { LocalAssetRecord } from "./local-asset-store"
import {
  LOCAL_ASSET_UNAVAILABLE_PREVIEW_SOURCE,
  projectLocalAssetPreviewSources,
  reusableAssetFromLocalRecord,
} from "./local-asset-preview"

const localDocument = (): Document => ({
  ...renderConformanceDocument,
  nodes: renderConformanceDocument.nodes.map((node) =>
    node.id === "image-cover" && node.type === "image"
      ? {
          ...node,
          assetId: "asset-local-preview",
          src: "asset:local/asset-local-preview",
          alt: "Portrait",
        }
      : node
  ),
})

const localRecord = (): LocalAssetRecord => ({
  schemaVersion: 4,
  id: "asset-local-preview",
  name: "portrait.png",
  mediaType: "image/png",
  size: 5,
  width: 9_999,
  height: 9_999,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  lastUsedAt: "2026-08-28T00:00:00.000Z",
  archivedAt: null,
  revision: 1,
  integrity: "ready",
  blob: new Blob(["image"], { type: "image/png" }),
})

describe("local image preview integrity", () => {
  it("projects a missing local source to a deterministic safe placeholder without mutating canonical bytes", () => {
    const canonical = localDocument()
    const preview = projectLocalAssetPreviewSources(canonical, new Map())
    const canonicalImage = canonical.nodes.find(
      (node) => node.id === "image-cover"
    )
    const previewImage = preview.nodes.find((node) => node.id === "image-cover")

    expect(canonicalImage).toMatchObject({
      src: "asset:local/asset-local-preview",
      alt: "Portrait",
    })
    expect(previewImage).toMatchObject({
      src: LOCAL_ASSET_UNAVAILABLE_PREVIEW_SOURCE,
      alt: "Portrait. File missing on this device.",
    })
    expect(JSON.stringify(preview)).not.toContain(
      "asset:local/asset-local-preview"
    )
  })

  it("projects an object URL only into the preview clone", () => {
    const canonical = localDocument()
    const preview = projectLocalAssetPreviewSources(
      canonical,
      new Map([["asset-local-preview", "blob:device-preview"]])
    )

    expect(
      preview.nodes.find((node) => node.id === "image-cover")
    ).toMatchObject({ src: "blob:device-preview" })
    expect(JSON.stringify(canonical)).not.toContain("blob:device-preview")
  })

  it("projects local image-fill sources without mutating canonical paint", () => {
    const canonical = localDocument()
    const shape = canonical.nodes.find((node) => node.type === "rect")
    if (!shape) throw new Error("Rect fixture missing")
    shape.fills = [
      {
        id: "local-fill",
        type: "image",
        assetId: "asset-local-fill",
        src: "asset:local/asset-local-fill",
        opacity: 1,
        visible: true,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ]

    const preview = projectLocalAssetPreviewSources(
      canonical,
      new Map([["asset-local-fill", "blob:fill-preview"]])
    )
    const previewShape = preview.nodes.find((node) => node.id === shape.id)
    const previewFill =
      previewShape && "fills" in previewShape
        ? previewShape.fills?.[0]
        : undefined
    const canonicalFill = shape.fills[0]

    expect(previewFill).toMatchObject({ src: "blob:fill-preview" })
    expect(canonicalFill).toMatchObject({
      src: "asset:local/asset-local-fill",
    })
  })

  it("decodes authoritative bytes on every reuse instead of trusting cached dimensions", async () => {
    const decode = vi.fn().mockResolvedValue({ width: 640, height: 480 })

    await expect(
      reusableAssetFromLocalRecord(localRecord(), decode)
    ).resolves.toEqual(
      expect.objectContaining({
        assetId: "asset-local-preview",
        src: "asset:local/asset-local-preview",
        width: 640,
        height: 480,
      })
    )
    expect(decode).toHaveBeenCalledOnce()
    expect(decode).toHaveBeenCalledWith(expect.any(Blob))
  })

  it("rejects decoded dimensions outside the shared media bounds", async () => {
    const decode = vi.fn().mockResolvedValue({ width: 20_000, height: 20 })

    await expect(
      reusableAssetFromLocalRecord(localRecord(), decode)
    ).rejects.toThrow("16,384 px or smaller")
    expect(decode).toHaveBeenCalledOnce()
  })
})
