import { describe, expect, it } from "vitest"

export type ImageEditCompletion = "done" | "enter"
export type ImageEditCancellation = "cancel" | "escape"

export type ImageEditHistoryCommit = {
  label: string
  patch: unknown
}

export type ImageEditSessionSnapshot = {
  cropTargetId: string | null
  draftRevision: number
  documentRevision: number
  historyCommits: readonly ImageEditHistoryCommit[]
  cameraZoomRequests: readonly number[]
  contentScaleRequests: readonly number[]
}

/**
 * Adapter used by the ASSET-02 acceptance contract.
 *
 * Keep this boundary renderer-neutral. The product harness may delegate to the
 * crop-session controller, Fabric intent helpers, and the camera router, but it
 * must report canonical history separately from draft render updates.
 */
export type ImageEditSessionContractHarness = {
  doubleClickImage: (nodeId: string) => void | Promise<void>
  moveDraftContent: (delta: { x: number; y: number }) => void | Promise<void>
  completeCrop: (action: ImageEditCompletion) => void | Promise<void>
  cancelCrop: (action: ImageEditCancellation) => void | Promise<void>
  pinchCamera: (scale: number) => void | Promise<void>
  setContentScale: (scale: number) => void | Promise<void>
  snapshot: () => ImageEditSessionSnapshot
}

export type CreateImageEditSessionContractHarness = () =>
  ImageEditSessionContractHarness | Promise<ImageEditSessionContractHarness>

const enterCrop = async (harness: ImageEditSessionContractHarness) => {
  await harness.doubleClickImage("image-1")
  expect(harness.snapshot().cropTargetId).toBe("image-1")
}

/**
 * Registers the focused ASSET-02 transaction and gesture acceptance tests.
 *
 * Invoke this from an `*.test.ts` file once the image edit-session controller
 * exists. Keeping the contract separate lets the implementation choose its
 * internal state shape without weakening the behavior required at the boundary.
 */
export function registerImageEditSessionContract(
  createHarness: CreateImageEditSessionContractHarness
) {
  describe("ASSET-02 image edit session", () => {
    it("turns an image double-click into crop entry without committing", async () => {
      const harness = await createHarness()
      const before = harness.snapshot()

      await enterCrop(harness)

      expect(harness.snapshot()).toMatchObject({
        cropTargetId: "image-1",
        documentRevision: before.documentRevision,
        historyCommits: [],
      })
    })

    it("keeps pointer changes in the draft and out of history", async () => {
      const harness = await createHarness()
      await enterCrop(harness)
      const before = harness.snapshot()

      await harness.moveDraftContent({ x: 14, y: -8 })
      await harness.moveDraftContent({ x: -3, y: 5 })

      const after = harness.snapshot()
      expect(after.cropTargetId).toBe("image-1")
      expect(after.draftRevision).toBeGreaterThan(before.draftRevision)
      expect(after.documentRevision).toBe(before.documentRevision)
      expect(after.historyCommits).toEqual([])
    })

    for (const action of ["done", "enter"] as const) {
      it(`commits one named history entry when crop ends with ${action}`, async () => {
        const harness = await createHarness()
        await enterCrop(harness)
        const before = harness.snapshot()
        await harness.moveDraftContent({ x: 18, y: 7 })

        await harness.completeCrop(action)

        const after = harness.snapshot()
        expect(after.cropTargetId).toBeNull()
        expect(after.documentRevision).toBe(before.documentRevision + 1)
        expect(after.historyCommits).toEqual([
          expect.objectContaining({ label: "Crop image" }),
        ])
      })
    }

    for (const action of ["cancel", "escape"] as const) {
      it(`discards the draft without history when crop ends with ${action}`, async () => {
        const harness = await createHarness()
        await enterCrop(harness)
        const before = harness.snapshot()
        await harness.moveDraftContent({ x: 18, y: 7 })

        await harness.cancelCrop(action)

        const after = harness.snapshot()
        expect(after.cropTargetId).toBeNull()
        expect(after.documentRevision).toBe(before.documentRevision)
        expect(after.historyCommits).toEqual([])
      })
    }

    it("keeps a trackpad pinch routed to the editor camera", async () => {
      const harness = await createHarness()
      await enterCrop(harness)
      const before = harness.snapshot()

      await harness.pinchCamera(1.25)

      const after = harness.snapshot()
      expect(after.cameraZoomRequests).toEqual([1.25])
      expect(after.contentScaleRequests).toEqual([])
      expect(after.documentRevision).toBe(before.documentRevision)
      expect(after.historyCommits).toEqual([])
    })

    it("routes the explicit image-scale control to draft content", async () => {
      const harness = await createHarness()
      await enterCrop(harness)
      const before = harness.snapshot()

      await harness.setContentScale(1.4)

      const after = harness.snapshot()
      expect(after.contentScaleRequests).toEqual([1.4])
      expect(after.cameraZoomRequests).toEqual([])
      expect(after.draftRevision).toBeGreaterThan(before.draftRevision)
      expect(after.documentRevision).toBe(before.documentRevision)
      expect(after.historyCommits).toEqual([])
    })
  })
}
