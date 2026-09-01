import type {
  CanvasDocumentSyncIdentity,
  CanvasRuntimeReport,
  CanvasRuntimeOwnerRelease,
} from "./fabric-artboard"

export type CanvasRuntimeAdmissionRegistry = ReadonlyMap<
  string,
  CanvasRuntimeReport
>

const runtimeKey = (documentId: string, pageId: string) =>
  `${documentId}\u0000${pageId}`

export const reduceCanvasRuntimeAdmission = (
  current: CanvasRuntimeAdmissionRegistry,
  report: CanvasRuntimeReport
): CanvasRuntimeAdmissionRegistry => {
  const key = runtimeKey(report.documentId, report.pageId)
  const next = new Map(current)
  // Generation is local to one FabricArtboard mount and resets after
  // virtualization culls/remounts a page. The artboard fences inactive async
  // settlements, so arrival order is the composition-level authority.
  next.set(key, report)
  return next
}

export const releaseCanvasRuntimeAdmission = (
  current: CanvasRuntimeAdmissionRegistry,
  owner: CanvasRuntimeOwnerRelease
): CanvasRuntimeAdmissionRegistry => {
  const key = runtimeKey(owner.documentId, owner.pageId)
  if (current.get(key)?.runtimeOwnerId !== owner.runtimeOwnerId) return current
  const next = new Map(current)
  next.delete(key)
  return next
}

export const canvasPageMutationAdmitted = (
  registry: CanvasRuntimeAdmissionRegistry,
  requested: CanvasDocumentSyncIdentity
) => {
  const report = registry.get(
    runtimeKey(requested.documentId, requested.pageId)
  )
  const applied = report?.appliedIdentity
  return Boolean(
    report?.status === "ready" &&
    report.requestedIdentity.documentId === requested.documentId &&
    report.requestedIdentity.pageId === requested.pageId &&
    report.requestedIdentity.documentSyncIdentity ===
      requested.documentSyncIdentity &&
    applied?.documentId === requested.documentId &&
    applied.pageId === requested.pageId &&
    applied.documentSyncIdentity === requested.documentSyncIdentity
  )
}

export const canvasPagesMutationAdmitted = (
  registry: CanvasRuntimeAdmissionRegistry,
  requests: readonly CanvasDocumentSyncIdentity[]
) =>
  requests.length > 0 &&
  requests.every((request) => canvasPageMutationAdmitted(registry, request))

export const canvasMountedDocumentMutationAdmitted = (
  registry: CanvasRuntimeAdmissionRegistry,
  documentId: string,
  requestsByPageId: ReadonlyMap<string, CanvasDocumentSyncIdentity>
) => {
  const mountedPageIds = new Set(
    [...registry.values()]
      .filter((report) => report.documentId === documentId)
      .map((report) => report.pageId)
  )
  return (
    mountedPageIds.size > 0 &&
    [...mountedPageIds].every((pageId) => {
      const request = requestsByPageId.get(pageId)
      return Boolean(request && canvasPageMutationAdmitted(registry, request))
    })
  )
}

export const runCanvasMutationIfAdmitted = <TResult>(
  admitted: boolean,
  mutation: () => TResult
): TResult | undefined => (admitted ? mutation() : undefined)
