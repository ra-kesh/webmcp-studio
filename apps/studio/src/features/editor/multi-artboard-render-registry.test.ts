import { describe, expect, it, vi } from "vitest"
import type { Document } from "@webmcp/document"
import { MultiArtboardLayoutController } from "@webmcp/editor/multi-artboard"
import {
  MultiArtboardRenderRegistry,
  type PageRenderInvalidationController,
} from "./multi-artboard-render-registry"
import { quotationStarter } from "./quotation-starter"

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const createController = (
  documentSettlement: Promise<void> = Promise.resolve()
) =>
  ({
    detach: vi.fn(() => true),
    whenDocumentSettled: vi.fn(() => documentSettlement),
    invalidateDocument: vi.fn(async () => true),
    invalidateViewport: vi.fn(() => true),
    invalidateSelection: vi.fn(() => true),
    invalidatePreview: vi.fn(() => true),
    invalidateRepaint: vi.fn(() => true),
  }) satisfies PageRenderInvalidationController

describe("MultiArtboardRenderRegistry", () => {
  it("routes page document and preview invalidations only to their owner", async () => {
    const registry = new MultiArtboardRenderRegistry()
    const first = createController()
    const second = createController()
    registry.attach("first", first)
    registry.attach("second", second)
    const document = quotationStarter.document as Document

    await registry.invalidateDocument("second", { document })
    registry.invalidatePreview("second", {
      kind: "node_patch",
      nodeId: "node",
      patch: { x: 12 },
    })

    expect(first.invalidateDocument).not.toHaveBeenCalled()
    expect(first.invalidatePreview).not.toHaveBeenCalled()
    expect(second.invalidateDocument).toHaveBeenCalledWith({
      document,
      pageId: "second",
    })
    expect(second.invalidatePreview).toHaveBeenCalledOnce()
  })

  it("updates mounted viewports without producing document invalidations", () => {
    const registry = new MultiArtboardRenderRegistry()
    const first = createController()
    const second = createController()
    registry.attach("first", first)
    registry.attach("second", second)

    registry.invalidateCamera(0.42)

    expect(first.invalidateViewport).toHaveBeenCalledWith({
      kind: "zoom",
      zoom: 0.42,
    })
    expect(second.invalidateViewport).toHaveBeenCalledWith({
      kind: "zoom",
      zoom: 0.42,
    })
    expect(first.invalidateDocument).not.toHaveBeenCalled()
    expect(second.invalidateDocument).not.toHaveBeenCalled()
  })

  it("projects selection to its page and clears stale adapter selections", () => {
    const registry = new MultiArtboardRenderRegistry()
    const first = createController()
    const second = createController()
    registry.attach("first", first)
    registry.attach("second", second)

    registry.invalidateSelection({ pageId: "second", nodeIds: ["node"] })

    expect(first.invalidateSelection).toHaveBeenCalledWith(null)
    expect(second.invalidateSelection).toHaveBeenCalledWith({
      pageId: "second",
      nodeIds: ["node"],
    })
  })

  it("pins an interaction page outside overscan until settlement", () => {
    const registry = new MultiArtboardRenderRegistry()
    const pages = Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index + 1}`,
      width: 600,
      height: 800,
    }))
    const layout = new MultiArtboardLayoutController(pages, { gap: 120 })
    registry.pin("page-100")

    const visible = registry.visiblePageIds(
      layout,
      { x: 56, y: 56, zoom: 1 },
      { width: 712, height: 912 }
    )

    expect(visible.has("page-1")).toBe(true)
    expect(visible.has("page-100")).toBe(true)
    expect(visible.size).toBeLessThan(10)
    registry.unpin("page-100")
    expect(
      registry
        .visiblePageIds(
          layout,
          { x: 56, y: 56, zoom: 1 },
          { width: 712, height: 912 }
        )
        .has("page-100")
    ).toBe(false)
  })

  it("invalidates queued work before waiting for teardown settlement", async () => {
    const pending = deferred()
    const controller = createController(pending.promise)
    const registry = new MultiArtboardRenderRegistry()
    registry.attach("first", controller)

    const detaching = registry.detach("first", controller)

    expect(controller.detach).toHaveBeenCalledOnce()
    expect(registry.getSnapshot().mountedPageIds).toEqual([])
    let settled = false
    void detaching.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    pending.resolve()
    await expect(detaching).resolves.toBe(true)
  })
})
