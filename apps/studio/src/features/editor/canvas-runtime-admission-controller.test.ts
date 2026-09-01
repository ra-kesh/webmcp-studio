import { describe, expect, it } from "vitest"
import { CanvasRuntimeAdmissionController } from "./canvas-runtime-admission-controller"
import type {
  CanvasDocumentSyncIdentity,
  CanvasRuntimeReport,
} from "./fabric-artboard"
import type { CanvasRuntimeAdmissionRegistry } from "./canvas-runtime-admission"

const request: CanvasDocumentSyncIdentity = {
  documentId: "document-1",
  documentRevision: 1,
  pageId: "page-1",
  documentSyncIdentity: "page-1:1",
}

const report = (
  status: CanvasRuntimeReport["status"],
  syncGeneration: number
): CanvasRuntimeReport => ({
  runtimeOwnerId: "owner-1",
  status,
  attempt: 1,
  ...request,
  syncGeneration,
  requestedIdentity: request,
  appliedIdentity:
    status === "ready" || status === "syncing" || status === "stale_error"
      ? { ...request, syncGeneration: Math.max(1, syncGeneration - 1) }
      : null,
  stage: status === "stale_error" || status === "error" ? "sync" : null,
})

describe("CanvasRuntimeAdmissionController", () => {
  it("closes captured commit predicates in the same tick as a runtime report", () => {
    const controller = new CanvasRuntimeAdmissionController()
    let registry: CanvasRuntimeAdmissionRegistry = new Map()
    const requests = new Map([[request.pageId, request]])
    controller.synchronize(registry, requests, request.documentId)
    registry = controller.report(report("ready", 1))
    controller.synchronize(registry, requests, request.documentId)
    const pageCommit = controller.captureCommit(request.pageId)
    const documentCommit = controller.captureCommit()
    expect(pageCommit()).toBe(true)
    expect(documentCommit()).toBe(true)

    controller.report(report("syncing", 2))

    expect(pageCommit()).toBe(false)
    expect(documentCommit()).toBe(false)
    expect(controller.captureCommit(request.pageId)()).toBe(false)
  })

  it("invalidates captured work when the document snapshot changes", () => {
    const controller = new CanvasRuntimeAdmissionController()
    const requests = new Map([[request.pageId, request]])
    const registry = controller.report(report("ready", 1))
    controller.synchronize(registry, requests, request.documentId)
    const commit = controller.captureCommit(request.pageId)

    controller.synchronize(registry, requests, "document-2")

    expect(commit()).toBe(false)
  })
})
