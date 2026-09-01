import type {
  CanvasDocumentSyncIdentity,
  CanvasRuntimeOwnerRelease,
  CanvasRuntimeReport,
} from "./fabric-artboard"
import {
  assertCanvasReplacementMutationAdmission,
  captureCanvasReplacementMutationAdmission,
  canvasMountedDocumentMutationAdmitted,
  canvasPageMutationAdmitted,
  reduceCanvasRuntimeAdmission,
  releaseCanvasRuntimeAdmission,
} from "./canvas-runtime-admission"
import type { CanvasRuntimeAdmissionRegistry } from "./canvas-runtime-admission"

export class CanvasRuntimeAdmissionController {
  private registry: CanvasRuntimeAdmissionRegistry = new Map()
  private requestsByPageId: ReadonlyMap<
    string,
    CanvasDocumentSyncIdentity
  > = new Map()
  private documentId = ""

  synchronize(
    registry: CanvasRuntimeAdmissionRegistry,
    requestsByPageId: ReadonlyMap<string, CanvasDocumentSyncIdentity>,
    documentId: string
  ) {
    this.registry = registry
    this.requestsByPageId = requestsByPageId
    this.documentId = documentId
  }

  report(report: CanvasRuntimeReport) {
    this.registry = reduceCanvasRuntimeAdmission(this.registry, report)
    return this.registry
  }

  release(owner: CanvasRuntimeOwnerRelease) {
    this.registry = releaseCanvasRuntimeAdmission(this.registry, owner)
    return this.registry
  }

  captureCommit(pageId?: string) {
    const documentId = this.documentId
    const requested = pageId ? this.requestsByPageId.get(pageId) : null
    return () => {
      if (this.documentId !== documentId) return false
      if (!pageId) {
        return canvasMountedDocumentMutationAdmitted(
          this.registry,
          documentId,
          this.requestsByPageId
        )
      }
      const current = this.requestsByPageId.get(pageId)
      return Boolean(
        requested &&
        current &&
        current.documentId === requested.documentId &&
        current.documentRevision === requested.documentRevision &&
        current.pageId === requested.pageId &&
        current.documentSyncIdentity === requested.documentSyncIdentity &&
        canvasPageMutationAdmitted(this.registry, requested)
      )
    }
  }

  captureReplacementCommit(pageId: string) {
    const lease = captureCanvasReplacementMutationAdmission(
      this.registry,
      this.requestsByPageId.get(pageId)
    )
    return () =>
      assertCanvasReplacementMutationAdmission(lease, this.documentId)
  }
}
