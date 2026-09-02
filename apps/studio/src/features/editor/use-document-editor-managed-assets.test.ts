import { describe, expect, it } from "vitest"
import { managedAssetIdsInCommands } from "./managed-asset-command-accounting"

describe("managed asset command accounting", () => {
  it("tracks the canonical image replacement command", () => {
    expect(
      managedAssetIdsInCommands([
        {
          id: "replace-image",
          type: "replace_image_source",
          actor: "human",
          at: "2026-08-28T12:00:00.000Z",
          nodeId: "image-1",
          assetId: "asset-replacement01",
          src: "asset:managed/asset-replacement01",
        },
      ])
    ).toEqual(["asset-replacement01"])
  })

  it("tracks managed image fills in node additions and updates", () => {
    expect(
      managedAssetIdsInCommands([
        {
          id: "update-fill",
          type: "update_node",
          actor: "human",
          at: "2026-08-28T12:00:00.000Z",
          nodeId: "shape-1",
          patch: {
            fills: [
              {
                id: "updated-image-fill",
                type: "image",
                assetId: "asset-updatedfill01",
                src: "asset:managed/asset-updatedfill01",
                opacity: 1,
                visible: true,
                transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
              },
            ],
          },
        },
        {
          id: "add-filled-shape",
          type: "add_node",
          actor: "human",
          at: "2026-08-28T12:00:00.000Z",
          pageId: "page-1",
          node: {
            id: "shape-2",
            type: "rect",
            name: "Image-filled shape",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            constraints: { horizontal: "min", vertical: "min" },
            fill: "#ffffff",
            fills: [
              {
                id: "added-image-fill",
                type: "image",
                assetId: "asset-addedfill001",
                src: "asset:managed/asset-addedfill001",
                opacity: 1,
                visible: true,
                transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
              },
            ],
            radius: 0,
            strokeWidth: 0,
          },
        },
      ])
    ).toEqual(["asset-updatedfill01", "asset-addedfill001"])
  })
})
