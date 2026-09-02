import type { Document } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { materializeLocalExportNodes } from "./materialize-local-export-nodes"

const documentWithLocalImages = (): Document => ({
  ...structuredClone(quotationStarter.document),
  nodes: [
    ...structuredClone(quotationStarter.document.nodes),
    {
      id: "local-image-a",
      type: "image",
      name: "Local image A",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      assetId: "asset-a",
      src: "asset:local/asset-a",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: true,
    },
    {
      id: "local-image-b",
      type: "image",
      name: "Local image B",
      x: 120,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      assetId: "asset-b",
      src: "asset:local/asset-b",
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      frameMask: { shape: "rectangle" },
      alt: "",
      decorative: true,
    },
  ],
})

describe("materializeLocalExportNodes", () => {
  it("materializes browser-local image fills for export", async () => {
    const document = structuredClone(quotationStarter.document)
    const shape = document.nodes.find((node) => node.type === "rect")
    if (!shape) throw new Error("Rect fixture missing")
    shape.fills = [
      {
        id: "local-fill",
        type: "image",
        assetId: "asset-fill",
        src: "asset:local/asset-fill",
        opacity: 1,
        visible: true,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ]
    const loadAsset = vi.fn(async () => new Blob(["fill"]))
    const encodeBlob = vi.fn(async () => "data:image/png;base64,ZmlsbA==")

    const nodes = await materializeLocalExportNodes(
      document,
      new AbortController().signal,
      { loadAsset, encodeBlob }
    )
    const exported = nodes.find((node) => node.id === shape.id)

    expect(loadAsset).toHaveBeenCalledWith(
      "asset-fill",
      expect.any(AbortSignal)
    )
    expect(exported).toMatchObject({
      fills: [
        {
          id: "local-fill",
          src: "data:image/png;base64,ZmlsbA==",
        },
      ],
    })
    const canonicalFill = shape.fills[0]
    if (canonicalFill.type !== "image") {
      throw new Error("Image fill fixture missing")
    }
    expect(canonicalFill.src).toBe("asset:local/asset-fill")
  })

  it("aborts and joins sibling image work before reporting the first failure", async () => {
    const firstFailure = new Error("Asset A failed")
    let siblingSignal: AbortSignal | undefined
    let siblingSettled = false
    const loadAsset = vi.fn((assetId: string, signal: AbortSignal) => {
      if (assetId === "asset-a") return Promise.reject(firstFailure)
      siblingSignal = signal
      return new Promise<Blob | null>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            siblingSettled = true
            reject(signal.reason)
          },
          { once: true }
        )
      })
    })

    await expect(
      materializeLocalExportNodes(
        documentWithLocalImages(),
        new AbortController().signal,
        { loadAsset, encodeBlob: vi.fn() }
      )
    ).rejects.toBe(firstFailure)

    expect(loadAsset).toHaveBeenCalledTimes(2)
    expect(siblingSignal?.aborted).toBe(true)
    expect(siblingSignal?.reason).toBe(firstFailure)
    expect(siblingSettled).toBe(true)
  })

  it("preserves the caller cancellation after all pending images acknowledge it", async () => {
    const controller = new AbortController()
    const settled: string[] = []
    const loadAsset = vi.fn(
      (assetId: string, signal: AbortSignal) =>
        new Promise<Blob | null>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              settled.push(assetId)
              reject(new Error(`cleanup-${assetId}`))
            },
            { once: true }
          )
        })
    )
    const exporting = materializeLocalExportNodes(
      documentWithLocalImages(),
      controller.signal,
      { loadAsset, encodeBlob: vi.fn() }
    )
    const reason = new DOMException("Export cancelled", "AbortError")

    controller.abort(reason)

    await expect(exporting).rejects.toBe(reason)
    expect(settled.sort()).toEqual(["asset-a", "asset-b"])
  })

  it("reports the first observed failure instead of an earlier sibling cleanup error", async () => {
    const rootFailure = new Error("Asset B failed first")
    const cleanupFailure = new Error("Asset A cleanup failed")
    const loadAsset = vi.fn((assetId: string, signal: AbortSignal) => {
      if (assetId === "asset-b") return Promise.reject(rootFailure)
      return new Promise<Blob | null>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(cleanupFailure), {
          once: true,
        })
      })
    })

    await expect(
      materializeLocalExportNodes(
        documentWithLocalImages(),
        new AbortController().signal,
        { loadAsset, encodeBlob: vi.fn() }
      )
    ).rejects.toBe(rootFailure)
  })
})
