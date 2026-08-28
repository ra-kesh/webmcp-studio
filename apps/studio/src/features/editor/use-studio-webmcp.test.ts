import { northstarSeed } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"

import { studioAssets } from "./asset-catalog"
import { projectStudioWebMcpSnapshot } from "./use-studio-webmcp"

describe("projectStudioWebMcpSnapshot", () => {
  it("reads live command capabilities for every inspection snapshot", () => {
    let cropEnabled = false
    const getCommandCapabilities = vi.fn(() => [
      {
        id: "image.crop",
        label: "Crop image",
        enabled: cropEnabled,
      },
    ])
    const services = {
      document: northstarSeed,
      snapshotId: "snapshot-live-command-policy",
      operationVersion: 0,
      activePageId: northstarSeed.pages[0].id,
      selection: null,
      pendingChangeSet: null,
      assets: studioAssets,
      publishedVersion: null,
      renderHistory: [],
      getCommandCapabilities,
      proposeChangeSet: vi.fn(),
      publishTemplate: vi.fn(),
      renderTemplate: vi.fn(),
    }

    expect(
      projectStudioWebMcpSnapshot(services).commandCapabilities?.[0]?.enabled
    ).toBe(false)
    cropEnabled = true
    expect(
      projectStudioWebMcpSnapshot(services).commandCapabilities?.[0]?.enabled
    ).toBe(true)
    expect(getCommandCapabilities).toHaveBeenCalledTimes(2)
  })
})
