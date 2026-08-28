import { describe, expect, it, vi } from "vitest"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftValueResult,
} from "./document-draft-repository"
import { DocumentRouteAdmissionController } from "./document-route-admission"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const summary = (
  documentId: string,
  options: Partial<DocumentDraftSummary> = {}
): DocumentDraftSummary => ({
  schemaVersion: 1,
  documentId,
  name: documentId,
  recordVersion: 1,
  contentSnapshotId: `sha256-${"1".repeat(64)}`,
  draftSnapshotId: `sha256-${"2".repeat(64)}`,
  documentRevision: 0,
  createdAt: "2026-08-28T10:00:00.000Z",
  savedAt: "2026-08-28T10:00:00.000Z",
  lastOpenedAt: "2026-08-28T10:00:00.000Z",
  activityAt: "2026-08-28T10:00:00.000Z",
  deletedAt: null,
  pageCount: 1,
  outputCount: 1,
  firstPageId: "page-1",
  firstPageName: "Page 1",
  firstPageWidth: 1240,
  firstPageHeight: 1754,
  encodedByteLength: 1024,
  exportFormats: ["png", "pdf"],
  sourceKind: null,
  origin: { kind: "blank" },
  lastPublished: null,
  ...options,
})

const record = (
  documentId: string,
  options: Partial<DocumentDraftSummary> = {}
): DocumentDraftRecord => ({
  summary: summary(documentId, options),
  envelope: {
    document: { id: documentId, name: documentId },
    sourceContext: null,
  } as unknown as CurrentDraftEnvelope,
})

const found = (value: DocumentDraftRecord): DocumentDraftReadResult => ({
  ok: true,
  status: "found",
  record: value,
})

const touched = (
  value: DocumentDraftRecord
): DraftValueResult<DocumentDraftRecord> => ({ ok: true, value })

describe("DocumentRouteAdmissionController", () => {
  it("publishes only the exact active record returned by final touch", async () => {
    const initial = record("document-a")
    const final = record("document-a", {
      lastOpenedAt: "2026-08-28T11:00:00.000Z",
      activityAt: "2026-08-28T11:00:00.000Z",
    })
    const get = vi.fn(async () => found(initial))
    const touchOpened = vi.fn(async () => touched(final))
    const controller = new DocumentRouteAdmissionController({
      get,
      touchOpened,
    })

    await expect(controller.admit("document-a")).resolves.toEqual({
      status: "opened",
      record: final,
      warning: null,
    })
    expect(get).toHaveBeenCalledWith("document-a")
    expect(touchOpened).toHaveBeenCalledWith("document-a")
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(
      touchOpened.mock.invocationCallOrder[0] ?? 0
    )
  })

  it("projects missing, deleted, recovery, and unavailable reads without touching", async () => {
    const cases: readonly [DocumentDraftReadResult, string][] = [
      [{ ok: true, status: "missing" }, "missing"],
      [
        {
          ok: false,
          reason: "corrupt_record",
          quarantineId: "quarantine-a",
          failure: { kind: "corrupt_record", message: "corrupt" },
        },
        "recovery_required",
      ],
      [
        {
          ok: false,
          reason: "storage_unavailable",
          failure: { kind: "storage_unavailable", message: "offline" },
        },
        "unavailable",
      ],
    ]
    for (const [read, status] of cases) {
      const touchOpened = vi.fn()
      const controller = new DocumentRouteAdmissionController({
        get: vi.fn(async () => read),
        touchOpened,
      })
      expect((await controller.admit("document-a")).status).toBe(status)
      expect(touchOpened).not.toHaveBeenCalled()
    }

    const deleted = record("document-a", {
      deletedAt: "2026-08-28T11:00:00.000Z",
    })
    const touchOpened = vi.fn()
    const controller = new DocumentRouteAdmissionController({
      get: vi.fn(async () => found(deleted)),
      touchOpened,
    })
    await expect(controller.admit("document-a")).resolves.toEqual({
      status: "deleted",
      documentId: "document-a",
      summary: deleted.summary,
    })
    expect(touchOpened).not.toHaveBeenCalled()
  })

  it("opens a verified get with a warning only for a current storage-unavailable touch", async () => {
    const verified = record("document-a")
    const failure = { kind: "storage_unavailable", message: "offline" } as const
    const controller = new DocumentRouteAdmissionController({
      get: vi.fn(async () => found(verified)),
      touchOpened: vi.fn(async () => ({
        ok: false as const,
        reason: "storage_unavailable" as const,
        failure,
      })),
    })
    await expect(controller.admit("document-a")).resolves.toEqual({
      status: "opened",
      record: verified,
      warning: failure,
    })
  })

  it("rejects late get and touch completions after a newer generation or disposal", async () => {
    const getA = deferred<DocumentDraftReadResult>()
    const touchB = deferred<DraftValueResult<DocumentDraftRecord>>()
    const get = vi.fn((documentId: string) =>
      documentId === "document-a"
        ? getA.promise
        : Promise.resolve(found(record("document-b")))
    )
    const touchOpened = vi.fn((documentId: string) =>
      documentId === "document-b"
        ? touchB.promise
        : Promise.resolve(touched(record(documentId)))
    )
    const controller = new DocumentRouteAdmissionController({
      get,
      touchOpened,
    })
    const openingA = controller.admit("document-a")
    const openingB = controller.admit("document-b")
    getA.resolve(found(record("document-a")))
    await expect(openingA).resolves.toEqual({
      status: "superseded",
      documentId: "document-a",
    })
    expect(touchOpened).not.toHaveBeenCalledWith("document-a")
    controller.dispose()
    touchB.resolve(touched(record("document-b")))
    await expect(openingB).resolves.toEqual({
      status: "superseded",
      documentId: "document-b",
    })
  })

  it("leaves the latest route as the final recency mutation when an earlier touch resolves late", async () => {
    const touchA = deferred<DraftValueResult<DocumentDraftRecord>>()
    const touchB = deferred<DraftValueResult<DocumentDraftRecord>>()
    const recency: string[] = []
    const touchOpened = vi.fn((documentId: string) => {
      if (documentId === "document-a") {
        return touchA.promise.then((result) => {
          recency.push("document-a")
          return result
        })
      }
      return touchB.promise.then((result) => {
        recency.push("document-b")
        return result
      })
    })
    const controller = new DocumentRouteAdmissionController({
      get: vi.fn(async (documentId: string) => found(record(documentId))),
      touchOpened,
    })

    const openingA = controller.admit("document-a")
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(touchOpened).toHaveBeenCalledTimes(1)

    const openingB = controller.admit("document-b")
    await Promise.resolve()
    await Promise.resolve()
    expect(touchOpened).not.toHaveBeenCalledWith("document-b")

    touchA.resolve(touched(record("document-a")))
    await expect(openingA).resolves.toEqual({
      status: "superseded",
      documentId: "document-a",
    })
    expect(touchOpened).toHaveBeenLastCalledWith("document-b")
    expect(recency).toEqual(["document-a"])

    touchB.resolve(touched(record("document-b")))
    await expect(openingB).resolves.toEqual({
      status: "opened",
      record: record("document-b"),
      warning: null,
    })
    expect(recency).toEqual(["document-a", "document-b"])
  })

  it("never opens identity-mismatched get or touch records", async () => {
    const mismatchedGet = record("document-b")
    const firstTouch = vi.fn()
    const first = new DocumentRouteAdmissionController({
      get: vi.fn(async () => found(mismatchedGet)),
      touchOpened: firstTouch,
    })
    expect((await first.admit("document-a")).status).toBe("recovery_required")
    expect(firstTouch).not.toHaveBeenCalled()

    const second = new DocumentRouteAdmissionController({
      get: vi.fn(async () => found(record("document-a"))),
      touchOpened: vi.fn(async () => touched(record("document-b"))),
    })
    expect((await second.admit("document-a")).status).toBe("recovery_required")
  })
})
