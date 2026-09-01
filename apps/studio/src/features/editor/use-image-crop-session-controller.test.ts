import { describe, expect, it, vi } from "vitest"
import { renderConformanceDocument } from "@webmcp/document"
import { startImageCropSession } from "@webmcp/editor"
import { ImageCropSessionController } from "./use-image-crop-session-controller"

const imageFixture = () => {
  const document = structuredClone(renderConformanceDocument)
  const image = document.nodes.find((node) => node.type === "image")
  if (!image) throw new Error("Quotation fixture has no image")
  const page = document.pages.find((candidate) =>
    candidate.nodeIds.includes(image.id)
  )
  if (!page) throw new Error("Quotation image has no page")
  const started = startImageCropSession(document, page.id, image.id)
  if (started.status !== "started") throw new Error(started.reason)
  return { document, image, page, session: started.session }
}

describe("ImageCropSessionController", () => {
  it("owns one preview store and destroys it when the session closes", () => {
    const stores = vi.fn()
    const controller = new ImageCropSessionController(stores)
    const { image, session } = imageFixture()

    controller.open(session)
    const store = controller.previewStore
    expect(controller.currentSession).toBe(session)
    expect(controller.hasActiveSession).toBe(true)
    expect(stores).toHaveBeenLastCalledWith(store)
    expect(
      controller.preview(image.id, {
        placement: { mode: "manual", focalX: 0.2 },
      })
    ).toBe(true)
    expect(controller.currentSession?.draft.focalX).toBe(0.2)

    controller.close()
    expect(controller.currentSession).toBeNull()
    expect(controller.previewStore).toBeNull()
    expect(stores).toHaveBeenLastCalledWith(null)
    expect(store?.preview(session.target, { placement: { focalX: 0.8 } })).toBe(
      "destroyed"
    )
  })

  it("closes and reports a canonical invalidation message", () => {
    const controller = new ImageCropSessionController(() => undefined)
    const { document, image, page, session } = imageFixture()
    controller.open(session)
    const changed = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === image.id ? { ...node, locked: true } : node
      ),
    }

    expect(controller.reconcile(changed, page.id)).toBe(
      "Crop was cancelled because the image was locked. No crop changes were applied."
    )
    expect(controller.hasActiveSession).toBe(false)
  })

  it("rejects unavailable reports only for the active target", () => {
    const controller = new ImageCropSessionController(() => undefined)
    const { image, session } = imageFixture()
    controller.open(session)

    expect(controller.rejectUnavailable("another-image")).toBeNull()
    expect(controller.hasActiveSession).toBe(true)
    expect(controller.rejectUnavailable(image.id)).toContain(
      "could not be loaded"
    )
    expect(controller.hasActiveSession).toBe(false)
  })
})
