import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import {
  formatAssetBytes,
  localAssetUsage,
  localAssetUsageLabel,
} from "./local-asset-model"

describe("local asset model", () => {
  it("finds page, layer, and field references before deletion", () => {
    const assetId = "asset-personal"
    const source = `asset:local/${assetId}`
    const page = northstarSeed.pages[0]
    const document = {
      ...northstarSeed,
      pages: [{ ...page, nodeIds: [...page.nodeIds, "image-personal"] }],
      nodes: [
        ...northstarSeed.nodes,
        {
          id: "image-personal",
          type: "image" as const,
          name: "Personal image",
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
          id: "portrait",
          key: "portrait",
          label: "Portrait",
          type: "asset" as const,
          required: false,
          defaultValue: source,
          agentDescription: "",
          validation: {},
        },
      ],
    }

    const usage = localAssetUsage(document, assetId)

    expect(usage.nodeIds).toEqual(["image-personal"])
    expect(usage.pageIds).toEqual([page.id])
    expect(usage.fieldIds).toEqual(["portrait"])
    expect(usage.referenceCount).toBe(2)
    expect(localAssetUsageLabel(usage)).toBe("Used by 1 layer and 1 field")
  })

  it("finds local image-fill references before deletion", () => {
    const document = structuredClone(northstarSeed)
    const shape = document.nodes.find((node) => node.type === "rect")
    if (!shape) throw new Error("Rect fixture missing")
    shape.fills = [
      {
        id: "personal-fill",
        type: "image",
        assetId: "asset-personal-fill",
        src: "asset:local/asset-personal-fill",
        opacity: 1,
        visible: true,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ]

    expect(localAssetUsage(document, "asset-personal-fill")).toMatchObject({
      nodeIds: [shape.id],
      referenceCount: 1,
    })
  })

  it("formats repository sizes for compact UI", () => {
    expect(formatAssetBytes(0)).toBe("0 B")
    expect(formatAssetBytes(1536)).toBe("1.5 KB")
    expect(formatAssetBytes(25 * 1024 * 1024)).toBe("25 MB")
  })
})
