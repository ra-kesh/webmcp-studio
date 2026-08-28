import { describe, expect, it, vi } from "vitest"
import type { Document, SceneNode } from "@webmcp/document"
import { commitCommands, createDocumentHistory } from "@webmcp/editor/history"
import { quotationStarter } from "./quotation-starter"
import { ImageReplacementCoordinator } from "./image-replacement-coordinator"
import type { PreparedImageReplacement } from "./image-replacement-coordinator"

type Payload = Readonly<{
  assetId: string
  src: string
  alt?: string
}>

function fixture() {
  const document: Document = structuredClone(quotationStarter.document)
  const page = document.pages.at(0)
  if (!page) throw new Error("Expected a page in the quotation fixture")
  const image: Extract<SceneNode, { type: "image" }> = {
    id: "replacement-image",
    type: "image",
    name: "Replacement image",
    assetId: "asset-original",
    src: "https://assets.example.test/original.png",
    alt: "Original authored description",
    altProvenance: "authored",
    placement: {
      mode: "manual",
      focalX: 0.25,
      focalY: 0.75,
      zoom: 1.4,
      rotation: 12,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "ellipse" },
    decorative: false,
    x: 40,
    y: 80,
    width: 320,
    height: 180,
    rotation: -4,
    opacity: 0.8,
    visible: true,
    locked: false,
  }
  document.nodes.push(image)
  page.nodeIds.push(image.id)
  return { document, image }
}

const candidate = (): PreparedImageReplacement<Payload> => ({
  token: "replacement-token",
  nodeId: "replacement-image",
  previewSrc: "https://assets.example.test/replacement.png",
  naturalSize: { width: 1600, height: 900 },
  payload: {
    assetId: "asset-replacement",
    src: "https://assets.example.test/replacement.png",
  },
})

describe("renderer-acknowledged image replacement coordinator", () => {
  it("keeps canonical state and history untouched when React rejects the candidate", async () => {
    const { document } = fixture()
    let history = createDocumentHistory(document, "snapshot-before")
    const previews: Array<PreparedImageReplacement<Payload> | null> = []
    const failures: string[] = []
    const coordinator = new ImageReplacementCoordinator<Payload>({
      validate: () => null,
      commit: (replacement) => {
        history = commitCommands(history, [
          {
            id: "replace-image",
            type: "replace_image_source",
            actor: "human",
            at: "2026-08-28T12:00:00.000Z",
            nodeId: replacement.nodeId,
            ...replacement.payload,
          },
        ])
        return true
      },
      onPendingChange: (replacement) => previews.push(replacement),
      onFailure: (message) => failures.push(message),
    })
    const completion = coordinator.start(candidate())

    expect(
      coordinator.report({
        token: "replacement-token",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "fabric",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })
    ).toBe("pending")
    expect(
      coordinator.report({
        token: "replacement-token",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "react",
        readiness: "unavailable",
        naturalSize: null,
      })
    ).toBe("failed")

    await expect(completion).resolves.toBe(false)
    expect(history.document).toBe(document)
    expect(history.snapshotId).toBe("snapshot-before")
    expect(history.past).toEqual([])
    expect(previews).toEqual([candidate(), null])
    expect(failures[0]).toContain("document preview")
  })

  it("commits one typed Replace image history entry after both exact renderers are ready", async () => {
    const { document, image } = fixture()
    let history = createDocumentHistory(document, "snapshot-before")
    let commits = 0
    const coordinator = new ImageReplacementCoordinator<Payload>({
      validate: () => null,
      commit: (replacement) => {
        commits += 1
        history = commitCommands(history, [
          {
            id: "replace-image",
            type: "replace_image_source",
            actor: "human",
            at: "2026-08-28T12:00:00.000Z",
            nodeId: replacement.nodeId,
            ...replacement.payload,
          },
        ])
        return true
      },
      onPendingChange: vi.fn(),
      onFailure: vi.fn(),
    })
    const completion = coordinator.start(candidate())
    coordinator.report({
      token: "replacement-token",
      nodeId: "replacement-image",
      src: "https://assets.example.test/replacement.png",
      renderer: "fabric",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    expect(
      coordinator.report({
        token: "replacement-token",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "react",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })
    ).toBe("committed")

    await expect(completion).resolves.toBe(true)
    expect(commits).toBe(1)
    expect(history.past).toHaveLength(1)
    expect(history.past[0]?.label).toBe("Replace image")
    expect(history.document.nodes.find((node) => node.id === image.id)).toEqual(
      {
        ...image,
        assetId: "asset-replacement",
        src: "https://assets.example.test/replacement.png",
      }
    )
  })

  it("ignores a stale token and revalidates the target before commit", async () => {
    let valid = true
    let commits = 0
    const coordinator = new ImageReplacementCoordinator<Payload>({
      validate: () => (valid ? null : "The target changed."),
      commit: () => {
        commits += 1
        return true
      },
      onPendingChange: vi.fn(),
      onFailure: vi.fn(),
    })
    const completion = coordinator.start(candidate())
    expect(
      coordinator.report({
        token: "replacement-stale",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "fabric",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })
    ).toBe("stale")
    coordinator.report({
      token: "replacement-token",
      nodeId: "replacement-image",
      src: "https://assets.example.test/replacement.png",
      renderer: "fabric",
      readiness: "ready",
      naturalSize: { width: 1600, height: 900 },
    })
    valid = false
    expect(
      coordinator.report({
        token: "replacement-token",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "react",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })
    ).toBe("rejected")

    await expect(completion).resolves.toBe(false)
    expect(commits).toBe(0)
  })

  it("times out without committing when a renderer never acknowledges", async () => {
    vi.useFakeTimers()
    try {
      let commits = 0
      const failures: string[] = []
      const coordinator = new ImageReplacementCoordinator<Payload>({
        validate: () => null,
        commit: () => {
          commits += 1
          return true
        },
        onPendingChange: vi.fn(),
        onFailure: (message) => failures.push(message),
        timeoutMs: 100,
      })
      const completion = coordinator.start(candidate())
      coordinator.report({
        token: "replacement-token",
        nodeId: "replacement-image",
        src: "https://assets.example.test/replacement.png",
        renderer: "fabric",
        readiness: "ready",
        naturalSize: { width: 1600, height: 900 },
      })

      await vi.advanceTimersByTimeAsync(100)

      await expect(completion).resolves.toBe(false)
      expect(commits).toBe(0)
      expect(failures[0]).toContain("original image was kept")
    } finally {
      vi.useRealTimers()
    }
  })
})
