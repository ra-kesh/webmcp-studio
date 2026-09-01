import { describe, expect, it } from "vitest"
import type {
  CanvasDocumentSyncIdentity,
  CanvasRuntimeReport,
} from "./fabric-artboard"
import {
  assertCanvasReplacementMutationAdmission,
  captureCanvasReplacementMutationAdmission,
  canvasMountedDocumentMutationAdmitted,
  canvasPageMutationAdmitted,
  canvasPagesMutationAdmitted,
  reduceCanvasRuntimeAdmission,
  releaseCanvasRuntimeAdmission,
} from "./canvas-runtime-admission"
import type { CanvasRuntimeAdmissionRegistry } from "./canvas-runtime-admission"

const request = (
  pageId: string,
  documentSyncIdentity = `${pageId}:1`,
  documentId = "document-1"
): CanvasDocumentSyncIdentity => ({
  documentId,
  documentRevision: 1,
  pageId,
  documentSyncIdentity,
})

const report = (
  requestedIdentity: CanvasDocumentSyncIdentity,
  status: CanvasRuntimeReport["status"],
  syncGeneration: number
): CanvasRuntimeReport => ({
  runtimeOwnerId: `owner-${requestedIdentity.pageId}-${syncGeneration}`,
  status,
  attempt: 1,
  ...requestedIdentity,
  syncGeneration,
  requestedIdentity,
  appliedIdentity:
    status === "ready" || status === "syncing" || status === "stale_error"
      ? {
          ...requestedIdentity,
          syncGeneration: Math.max(1, syncGeneration - 1),
        }
      : null,
  stage: status === "stale_error" || status === "error" ? "sync" : null,
})

describe("canvas runtime mutation admission", () => {
  it("admits only an exact ready requested/applied identity", () => {
    const expected = request("page-1")
    let registry: CanvasRuntimeAdmissionRegistry = new Map()
    registry = reduceCanvasRuntimeAdmission(
      registry,
      report(expected, "ready", 2)
    )

    expect(canvasPageMutationAdmitted(registry, expected)).toBe(true)
    expect(
      canvasPageMutationAdmitted(registry, request("page-1", "page-1:2"))
    ).toBe(false)
    expect(
      canvasPageMutationAdmitted(
        registry,
        request("page-1", "page-1:1", "document-2")
      )
    ).toBe(false)

    registry = reduceCanvasRuntimeAdmission(
      registry,
      report(expected, "stale_error", 3)
    )
    expect(canvasPageMutationAdmitted(registry, expected)).toBe(false)
  })

  it("leases a ready replacement start without retaining the superseded render identity", () => {
    const original = request("page-1", "page-1:original")
    const replacementPreview = request("page-1", "page-1:replacement")
    const originalRegistry = reduceCanvasRuntimeAdmission(
      new Map(),
      report(original, "ready", 2)
    )
    const lease = captureCanvasReplacementMutationAdmission(
      originalRegistry,
      original
    )
    const replacementRegistry = reduceCanvasRuntimeAdmission(
      originalRegistry,
      report(replacementPreview, "ready", 3)
    )

    expect(canvasPageMutationAdmitted(replacementRegistry, original)).toBe(
      false
    )
    expect(
      assertCanvasReplacementMutationAdmission(lease, original.documentId)
    ).toBe(true)
    expect(assertCanvasReplacementMutationAdmission(lease, "document-2")).toBe(
      false
    )
    expect(
      captureCanvasReplacementMutationAdmission(replacementRegistry, original)
    ).toBeNull()
  })

  it("closes an old ready admission when the same page remounts at generation one", () => {
    const first = request("page-1")
    const second = request("page-2")
    let registry: CanvasRuntimeAdmissionRegistry = new Map()
    registry = reduceCanvasRuntimeAdmission(registry, report(first, "ready", 8))
    registry = reduceCanvasRuntimeAdmission(
      registry,
      report(second, "ready", 1)
    )
    expect(canvasPagesMutationAdmitted(registry, [first, second])).toBe(true)

    registry = reduceCanvasRuntimeAdmission(
      registry,
      report(first, "preparing", 1)
    )

    expect(canvasPageMutationAdmitted(registry, first)).toBe(false)
    expect(canvasPageMutationAdmitted(registry, second)).toBe(true)
    expect(canvasPagesMutationAdmitted(registry, [first, second])).toBe(false)
    expect(canvasPagesMutationAdmitted(registry, [second])).toBe(true)
  })

  it("ignores unmounted document pages while requiring every mounted owner to be exact-ready", () => {
    const first = request("page-1")
    const second = request("page-2")
    const requests = new Map([
      [first.pageId, first],
      [second.pageId, second],
    ])
    let registry: CanvasRuntimeAdmissionRegistry = new Map()
    registry = reduceCanvasRuntimeAdmission(registry, report(first, "ready", 1))

    expect(
      canvasMountedDocumentMutationAdmitted(
        registry,
        first.documentId,
        requests
      )
    ).toBe(true)

    registry = reduceCanvasRuntimeAdmission(
      registry,
      report(second, "syncing", 1)
    )
    expect(
      canvasMountedDocumentMutationAdmitted(
        registry,
        first.documentId,
        requests
      )
    ).toBe(false)
  })

  it("releases only the matching mounted runtime owner", () => {
    const expected = request("page-1")
    const ready = report(expected, "ready", 2)
    let registry: CanvasRuntimeAdmissionRegistry = reduceCanvasRuntimeAdmission(
      new Map(),
      ready
    )

    registry = releaseCanvasRuntimeAdmission(registry, {
      documentId: expected.documentId,
      pageId: expected.pageId,
      runtimeOwnerId: "retired-owner",
    })
    expect(canvasPageMutationAdmitted(registry, expected)).toBe(true)

    registry = releaseCanvasRuntimeAdmission(registry, {
      documentId: expected.documentId,
      pageId: expected.pageId,
      runtimeOwnerId: ready.runtimeOwnerId,
    })
    expect(canvasPageMutationAdmitted(registry, expected)).toBe(false)
  })
})
