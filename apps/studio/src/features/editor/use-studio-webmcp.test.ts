import { northstarSeed } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"

import { studioAssets } from "./asset-catalog"
import { projectStudioWebMcpSnapshot } from "./use-studio-webmcp"

describe("projectStudioWebMcpSnapshot", () => {
  it("reads the live canonical command context for every snapshot", () => {
    const firstContext = null
    const secondContext = null
    const getProductCommandContext = vi
      .fn()
      .mockReturnValueOnce(firstContext)
      .mockReturnValueOnce(secondContext)
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
      getProductCommandContext,
      proposeChangeSet: vi.fn(),
      publishTemplate: vi.fn(),
      renderTemplate: vi.fn(),
    }

    expect(projectStudioWebMcpSnapshot(services).productCommandContext).toBe(
      firstContext
    )
    expect(projectStudioWebMcpSnapshot(services).productCommandContext).toBe(
      secondContext
    )
    expect(getProductCommandContext).toHaveBeenCalledTimes(2)
  })
})
