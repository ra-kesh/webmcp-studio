import { describe, expect, it, vi } from "vitest"
import { northstarSeed } from "@webmcp/document"
import { exportLayer } from "./export-layer"

describe("direct layer export", () => {
  it("flushes, projects, routes, and downloads the selected preset", async () => {
    const document = structuredClone(northstarSeed)
    const page = document.pages[0]!
    const nodeId = page.nodeIds[0]!
    document.nodes = document.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            exportSettings: [
              {
                id: "direct",
                format: "png" as const,
                scale: 2,
                suffix: "-asset",
              },
            ],
          }
        : node
    )
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.pageId).toBe(page.id)
      expect(
        body.document.pages.find(
          (candidate: { id: string }) => candidate.id === page.id
        )
      ).toMatchObject({
        background: "transparent",
        nodeIds: [nodeId],
      })
      return { ok: true, status: 200, blob: async () => new Blob(["png"]) }
    })
    const download = vi.fn()
    await expect(
      exportLayer({
        nodeId,
        flushActiveDraft: async () => true,
        getCurrentDocumentSnapshot: () => document,
        materializeNodes: async (candidate) => candidate.nodes,
        fetcher,
        download,
      })
    ).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/studio/export-png",
      expect.objectContaining({ method: "POST" })
    )
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringMatching(/-asset@2x\.png$/)
    )
  })
})
