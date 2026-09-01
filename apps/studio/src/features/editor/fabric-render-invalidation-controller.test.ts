import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import type { CanvasAdapter } from "@webmcp/editor"
import { FabricRenderInvalidationController } from "./fabric-render-invalidation-controller"

const adapterMock = () => {
  const methods = {
    sync: vi.fn(async () => undefined),
    setViewportZoom: vi.fn(),
    setSnapTargets: vi.fn(),
    select: vi.fn(),
    setImageCropMode: vi.fn(() => true),
    previewImageCropDraft: vi.fn(() => true),
    previewNodePatch: vi.fn(() => true),
    restoreNodePreview: vi.fn(() => true),
    requestRender: vi.fn(),
  }
  return {
    adapter: methods as unknown as CanvasAdapter,
    methods,
  }
}

describe("FabricRenderInvalidationController", () => {
  it("routes named invalidations to the attached Fabric-compatible adapter", async () => {
    const controller = new FabricRenderInvalidationController()
    const { adapter, methods } = adapterMock()
    controller.attach(adapter)
    const image = renderConformanceDocument.nodes.find(
      (node) => node.type === "image"
    )
    if (!image) throw new Error("Expected image fixture")

    await controller.invalidateDocument({
      document: renderConformanceDocument,
      pageId: renderConformanceDocument.pages[0].id,
    })
    expect(controller.invalidateViewport({ kind: "zoom", zoom: 1.5 })).toBe(
      true
    )
    expect(controller.invalidateSelection(null)).toBe(true)
    expect(
      controller.invalidatePreview({
        kind: "node_patch",
        nodeId: image.id,
        patch: { opacity: 0.5 },
      })
    ).toBe(true)
    expect(controller.invalidateRepaint()).toBe(true)

    expect(methods.sync).toHaveBeenCalledOnce()
    expect(methods.setViewportZoom).toHaveBeenCalledWith(1.5)
    expect(methods.select).toHaveBeenCalledWith(null)
    expect(methods.previewNodePatch).toHaveBeenCalledWith(image.id, {
      opacity: 0.5,
    })
    expect(methods.requestRender).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      attached: true,
      lastKind: "repaint",
      counts: {
        document: 1,
        viewport: 1,
        selection: 1,
        preview: 1,
        repaint: 1,
      },
    })
  })

  it("serializes document preparation and skips queued work after detach", async () => {
    const controller = new FabricRenderInvalidationController()
    const { adapter, methods } = adapterMock()
    controller.attach(adapter)
    let releaseFirst: () => void = () => undefined
    const firstPreparation = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = controller.invalidateDocument({
      document: renderConformanceDocument,
      pageId: renderConformanceDocument.pages[0].id,
      prepare: () => firstPreparation,
    })
    const second = controller.invalidateDocument({
      document: renderConformanceDocument,
      pageId: renderConformanceDocument.pages[0].id,
    })

    await Promise.resolve()
    expect(methods.sync).not.toHaveBeenCalled()
    controller.detach(adapter)
    releaseFirst()

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(methods.sync).not.toHaveBeenCalled()
    expect(controller.getSnapshot().attached).toBe(false)
  })

  it("does not let an old adapter detach its replacement", () => {
    const controller = new FabricRenderInvalidationController()
    const first = adapterMock().adapter
    const second = adapterMock().adapter
    controller.attach(first)
    controller.attach(second)

    expect(controller.detach(first)).toBe(false)
    expect(controller.adapter).toBe(second)
  })
})
