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
})
