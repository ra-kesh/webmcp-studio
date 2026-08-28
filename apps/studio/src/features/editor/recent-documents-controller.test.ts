import { describe, expect, it, vi } from "vitest"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftListRecoveryItem,
  DraftListResult,
  DraftRepositoryEvent,
  DraftWriteResult,
} from "./document-draft-repository"
import {
  RECENT_DOCUMENTS_PAGE_SIZE,
  RECENT_DOCUMENTS_QUERY_DELAY_MS,
  RecentDocumentsController,
} from "./recent-documents-controller"
import type {
  CollectionSlot,
  RecentDocumentsDependencies,
} from "./recent-documents-controller"

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}>

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const summary = (
  documentId: string,
  options: Partial<DocumentDraftSummary> = {}
): DocumentDraftSummary => ({
  schemaVersion: 1,
  documentId,
  name: options.name ?? documentId,
  recordVersion: options.recordVersion ?? 1,
  contentSnapshotId: options.contentSnapshotId ?? `sha256-${"1".repeat(64)}`,
  draftSnapshotId: options.draftSnapshotId ?? `sha256-${"2".repeat(64)}`,
  documentRevision: options.documentRevision ?? 0,
  createdAt: options.createdAt ?? "2026-08-29T10:00:00.000Z",
  savedAt: options.savedAt ?? "2026-08-29T10:00:00.000Z",
  lastOpenedAt: options.lastOpenedAt ?? "2026-08-29T10:00:00.000Z",
  activityAt: options.activityAt ?? "2026-08-29T10:00:00.000Z",
  deletedAt: options.deletedAt ?? null,
  pageCount: options.pageCount ?? 1,
  outputCount: options.outputCount ?? 1,
  firstPageId: options.firstPageId ?? "page-1",
  firstPageName: options.firstPageName ?? "Page 1",
  firstPageWidth: options.firstPageWidth ?? 1240,
  firstPageHeight: options.firstPageHeight ?? 1754,
  encodedByteLength: options.encodedByteLength ?? 1024,
  exportFormats: options.exportFormats ?? ["png", "pdf"],
  sourceKind: options.sourceKind ?? null,
  origin: options.origin ?? { kind: "blank" },
  lastPublished: options.lastPublished ?? null,
})

const record = (item: DocumentDraftSummary): DocumentDraftRecord => ({
  summary: item,
  envelope: {
    document: {
      id: item.documentId,
      name: item.name,
      marker: `body:${item.documentId}`,
    },
    sourceContext: null,
  } as unknown as CurrentDraftEnvelope,
})

const writeSuccess = (item: DocumentDraftSummary): DraftWriteResult => ({
  ok: true,
  record: record(item),
  created: false,
  unchanged: false,
})

const page = (
  items: readonly DocumentDraftSummary[],
  nextCursor: string | null = null,
  recoveryItems: readonly DraftListRecoveryItem[] = []
): DraftListResult => ({
  ok: true,
  page: { items, nextCursor, recoveryItems },
})

const failure = (message: string): DraftListResult => ({
  ok: false,
  reason: "storage_unavailable",
  failure: { kind: "storage_unavailable", message },
})

const ready = (slot: CollectionSlot) => {
  expect(slot.status).toBe("ready")
  if (slot.status !== "ready") throw new Error("Expected a ready slot.")
  return slot
}

class ManualQueryScheduler {
  readonly calls: Array<{
    callback: () => void
    delayMs: number
    cancelled: boolean
  }> = []

  schedule = (callback: () => void, delayMs: number) => {
    const call = { callback, delayMs, cancelled: false }
    this.calls.push(call)
    return () => {
      call.cancelled = true
    }
  }

  run(index = this.calls.length - 1) {
    const call = this.calls[index]
    if (call.cancelled) return
    call.callback()
  }
}

const createHarness = () => {
  const listRequests: Deferred<DraftListResult>[] = []
  const list = vi.fn<RecentDocumentsDependencies["list"]>(() => {
    const request = deferred<DraftListResult>()
    listRequests.push(request)
    return request.promise
  })
  const rename = vi.fn<RecentDocumentsDependencies["rename"]>()
  const duplicate = vi.fn<RecentDocumentsDependencies["duplicate"]>()
  const softDelete = vi.fn<RecentDocumentsDependencies["softDelete"]>()
  const restore = vi.fn<RecentDocumentsDependencies["restore"]>()
  const getForDownload = vi.fn<RecentDocumentsDependencies["getForDownload"]>()
  let eventListener: ((event: DraftRepositoryEvent) => void) | null = null
  const unsubscribe = vi.fn()
  const subscribe = vi.fn<RecentDocumentsDependencies["subscribe"]>(
    (listener) => {
      eventListener = listener
      return unsubscribe
    }
  )
  const scheduler = new ManualQueryScheduler()
  const writeViewPreference = vi.fn()
  const dependencies: RecentDocumentsDependencies = {
    list,
    rename,
    duplicate,
    softDelete,
    restore,
    getForDownload,
    subscribe,
    scheduleQuery: scheduler.schedule,
    readViewPreference: () => "grid",
    writeViewPreference,
    now: () => 1_777,
  }
  const controller = new RecentDocumentsController(dependencies)
  return {
    controller,
    list,
    listRequests,
    rename,
    duplicate,
    softDelete,
    restore,
    getForDownload,
    subscribe,
    unsubscribe,
    scheduler,
    writeViewPreference,
    emit(event: DraftRepositoryEvent) {
      if (!eventListener) throw new Error("Controller has not subscribed.")
      eventListener(event)
    },
  }
}

const savedEvent = (
  reason: "content_saved" | "opened" | "publication_linked" = "opened"
): DraftRepositoryEvent => ({
  type: "saved",
  reason,
  documentId: "document-a",
  recordVersion: 2,
  contentSnapshotId: `sha256-${"3".repeat(64)}`,
  draftSnapshotId: `sha256-${"4".repeat(64)}`,
  sessionId: "session-foreign",
})

describe("RecentDocumentsController lifecycle and replacement pages", () => {
  it("keeps construction inert and installs one retained fanout subscription on first activation", async () => {
    const harness = createHarness()

    expect(harness.subscribe).not.toHaveBeenCalled()
    expect(harness.list).not.toHaveBeenCalled()
    expect(harness.controller.getSnapshot()).toMatchObject({
      active: false,
      disposed: false,
      view: "grid",
    })

    harness.controller.activate()
    harness.controller.activate()
    expect(harness.subscribe).toHaveBeenCalledTimes(1)
    expect(harness.list).toHaveBeenCalledTimes(1)
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "",
      limit: RECENT_DOCUMENTS_PAGE_SIZE,
    })

    harness.listRequests[0].resolve(page([summary("document-a")], "cursor-a"))
    await flushPromises()
    const first = ready(harness.controller.getSnapshot().recent)
    expect(first.page.confirmedAt).toBe(1_777)

    harness.controller.deactivate()
    harness.controller.deactivate()
    harness.emit(savedEvent())
    expect(harness.list).toHaveBeenCalledTimes(1)
    expect(ready(harness.controller.getSnapshot().recent).stale).toBe(true)

    harness.controller.activate()
    expect(harness.subscribe).toHaveBeenCalledTimes(1)
    expect(harness.list).toHaveBeenCalledTimes(2)
  })

  it("disposes once and rejects a late page without notifying a dead consumer", async () => {
    const harness = createHarness()
    const listener = vi.fn()
    harness.controller.subscribe(listener)
    harness.controller.activate()
    const notificationsBeforeDispose = listener.mock.calls.length

    harness.controller.dispose()
    harness.controller.dispose()
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.controller.getSnapshot()).toMatchObject({
      active: false,
      disposed: true,
    })

    harness.listRequests[0].resolve(page([summary("too-late")]))
    await flushPromises()
    expect(harness.controller.getSnapshot().recent.status).not.toBe("ready")
    expect(listener).toHaveBeenCalledTimes(notificationsBeforeDispose + 1)
  })

  it("retains independent active and deleted pages and never requests all records", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(
      page([summary("active-a")], "active-cursor")
    )
    await flushPromises()

    harness.controller.setCollection("trash")
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "deleted",
      query: "",
      limit: 24,
    })
    harness.listRequests[1].resolve(
      page(
        [
          summary("deleted-a", {
            deletedAt: "2026-08-29T11:00:00.000Z",
          }),
        ],
        "trash-cursor"
      )
    )
    await flushPromises()

    expect(ready(harness.controller.getSnapshot().recent).page.nextCursor).toBe(
      "active-cursor"
    )
    expect(ready(harness.controller.getSnapshot().trash).page.nextCursor).toBe(
      "trash-cursor"
    )
    expect(
      harness.list.mock.calls.some(([options]) => options?.state === "all")
    ).toBe(false)
  })

  it("queues refresh behind initial load and rejects older tab and query contexts", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const refresh = harness.controller.refresh()
    expect(harness.list).toHaveBeenCalledTimes(1)

    harness.listRequests[0].resolve(page([summary("initial")]))
    await refresh
    await flushPromises()
    expect(harness.list).toHaveBeenCalledTimes(2)
    harness.listRequests[1].resolve(page([summary("new-refresh")]))
    await flushPromises()
    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("new-refresh")

    harness.controller.setQueryInput("proposal")
    harness.controller.setCollection("trash")
    expect(harness.list).toHaveBeenCalledTimes(3)
    harness.listRequests[2].resolve(
      page([
        summary("trash-proposal", {
          deletedAt: "2026-08-29T12:00:00.000Z",
        }),
      ])
    )
    await flushPromises()
    expect(harness.controller.getSnapshot()).toMatchObject({
      collection: "trash",
      appliedQuery: "proposal",
    })
  })

  it("keeps retained rows through refresh failure and separates terminal failure", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("retained")]))
    await flushPromises()

    harness.controller.refresh()
    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "loading",
    })
    harness.listRequests[1].resolve(failure("disk unavailable"))
    await flushPromises()
    const retainedFailure = harness.controller.getSnapshot().recent
    expect(retainedFailure).toMatchObject({
      status: "failed",
      failure: { message: "disk unavailable" },
    })
    if (retainedFailure.status !== "failed") throw new Error("Expected failure")
    expect(retainedFailure.retained?.items[0]?.documentId).toBe("retained")

    const fresh = createHarness()
    fresh.controller.activate()
    fresh.listRequests[0].resolve(failure("no database"))
    await flushPromises()
    const terminal = fresh.controller.getSnapshot().recent
    expect(terminal.status).toBe("failed")
    if (terminal.status !== "failed") throw new Error("Expected failure")
    expect(terminal.retained).toBeNull()
  })

  it("coalesces repeated same-context refresh requests into one queued rerun", async () => {
    const harness = createHarness()
    harness.controller.activate()
    const firstRefresh = harness.controller.refresh()
    const secondRefresh = harness.controller.refresh()
    expect(harness.list).toHaveBeenCalledTimes(1)

    harness.listRequests[0].resolve(page([summary("initial")]))
    await Promise.all([firstRefresh, secondRefresh])
    await flushPromises()
    expect(harness.list).toHaveBeenCalledTimes(2)
    harness.listRequests[1].resolve(page([summary("queued-refresh")]))
    await flushPromises()
    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("queued-refresh")
  })

  it("classifies a thrown list dependency as a request failure", async () => {
    const harness = createHarness()
    harness.list.mockImplementationOnce(() => {
      throw new Error("IndexedDB request exploded")
    })
    harness.controller.activate()
    await flushPromises()

    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "failed",
      failure: {
        kind: "request_failed",
        message: "IndexedDB request exploded",
      },
    })
  })
})

describe("RecentDocumentsController query scheduling and invalidation", () => {
  it("applies a trimmed repository query after the injected 180 ms schedule", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("first")]))
    await flushPromises()

    harness.controller.setQueryInput("  proposal  ")
    expect(harness.controller.getSnapshot().queryInput).toBe("  proposal  ")
    expect(harness.scheduler.calls[0]?.delayMs).toBe(
      RECENT_DOCUMENTS_QUERY_DELAY_MS
    )
    expect(harness.list).toHaveBeenCalledTimes(1)

    harness.scheduler.run(0)
    expect(harness.list).toHaveBeenCalledTimes(2)
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "proposal",
      limit: 24,
    })
    harness.listRequests[1].resolve(page([summary("match-after-fifty")]))
    await flushPromises()
    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("match-after-fifty")
  })

  it("Enter, Clear, tab switch, and route restoration apply immediately and cancel old schedules", () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.controller.setQueryInput("one")
    harness.controller.applyQueryInput()
    expect(harness.scheduler.calls[0]?.cancelled).toBe(true)
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "one",
      limit: 24,
    })

    harness.controller.setQueryInput("two")
    harness.controller.setCollection("trash")
    expect(harness.scheduler.calls[1]?.cancelled).toBe(true)
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "deleted",
      query: "two",
      limit: 24,
    })

    harness.controller.restoreRouteState("recent", " route ")
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "route",
      limit: 24,
    })
    harness.controller.clearQuery()
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "",
      limit: 24,
    })
  })

  it("rejects an older repository search after a newer query has completed", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("initial")]))
    await flushPromises()

    harness.controller.setQueryInput("old")
    harness.scheduler.run()
    harness.controller.setQueryInput("new")
    harness.scheduler.run()
    harness.listRequests[2].resolve(page([summary("new-result")]))
    await flushPromises()
    harness.listRequests[1].resolve(page([summary("old-result")]))
    await flushPromises()

    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("new-result")
  })

  it("applies a pending query on reactivation after deactivation cancels its timer", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("initial")]))
    await flushPromises()
    harness.controller.setQueryInput("pending")
    harness.controller.deactivate()
    expect(harness.scheduler.calls[0]?.cancelled).toBe(true)

    harness.controller.activate()
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "pending",
      limit: 24,
    })
  })

  it("coalesces event bursts into one queued rerun and applies exact event rules", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.emit(savedEvent("content_saved"))
    harness.emit(savedEvent("publication_linked"))
    harness.emit({
      type: "quarantined",
      documentId: "document-a",
      quarantineId: "quarantine-a",
      sessionId: "foreign",
    })
    expect(harness.list).toHaveBeenCalledTimes(1)

    harness.listRequests[0].resolve(page([summary("first")]))
    await flushPromises()
    expect(harness.list).toHaveBeenCalledTimes(2)

    harness.emit({
      type: "preview",
      documentId: "document-a",
      contentSnapshotId: `sha256-${"5".repeat(64)}`,
      sessionId: "foreign",
    })
    harness.emit({
      type: "conflict_resolved",
      conflictId: "conflict-a",
      documentId: "document-a",
      resolution: "reload_saved",
      resolutionDocumentId: null,
      sessionId: "foreign",
    })
    expect(harness.list).toHaveBeenCalledTimes(2)

    harness.listRequests[1].resolve(page([summary("rerun")]))
    await flushPromises()
    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("rerun")
  })

  it("saved events stale only Recent while delete and restore stale both slots", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("recent")]))
    await flushPromises()
    harness.controller.setCollection("trash")
    harness.listRequests[1].resolve(
      page([summary("trashed", { deletedAt: "2026-08-29T12:00:00.000Z" })])
    )
    await flushPromises()

    harness.emit(savedEvent())
    expect(ready(harness.controller.getSnapshot().recent).stale).toBe(true)
    expect(ready(harness.controller.getSnapshot().trash).stale).toBe(false)
    expect(harness.list).toHaveBeenCalledTimes(2)

    harness.emit({
      type: "restored",
      documentId: "trashed",
      recordVersion: 2,
      sessionId: "foreign",
    })
    expect(harness.list).toHaveBeenCalledTimes(3)
    expect(ready(harness.controller.getSnapshot().recent).stale).toBe(true)
  })

  it("retains quarantine visibility when the invalidating clean list no longer contains the row", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("document-a")]))
    await flushPromises()
    harness.emit({
      type: "quarantined",
      documentId: "document-a",
      quarantineId: "quarantine-event",
      sessionId: "foreign",
    })
    harness.listRequests[1].resolve(page([]))
    await flushPromises()

    expect(harness.controller.getSnapshot().recoveryItems).toMatchObject([
      {
        documentId: "document-a",
        quarantineId: "quarantine-event",
        status: "quarantined",
        failure: { kind: "corrupt_record" },
      },
    ])
  })
})

describe("RecentDocumentsController opaque cursor pagination", () => {
  it("appends one exact ordered page and preserves the opaque cursor on failure", async () => {
    const harness = createHarness()
    const newest = summary("z", { activityAt: "2026-08-29T12:00:00.000Z" })
    const older = summary("y", { activityAt: "2026-08-29T11:00:00.000Z" })
    harness.controller.activate()
    harness.listRequests[0].resolve(page([newest], "opaque:cursor:1"))
    await flushPromises()

    const append = harness.controller.loadMore()
    expect(harness.list).toHaveBeenLastCalledWith({
      state: "active",
      query: "",
      limit: 24,
      cursor: "opaque:cursor:1",
    })
    harness.listRequests[1].resolve(page([older], "opaque:cursor:2"))
    await append
    expect(ready(harness.controller.getSnapshot().recent).page).toMatchObject({
      nextCursor: "opaque:cursor:2",
      items: [{ documentId: "z" }, { documentId: "y" }],
    })

    const failedAppend = harness.controller.loadMore()
    harness.listRequests[2].resolve(failure("page failed"))
    await failedAppend
    const failedSlot = ready(harness.controller.getSnapshot().recent)
    expect(failedSlot.page.nextCursor).toBe("opaque:cursor:2")
    expect(failedSlot.paginationFailure?.message).toBe("page failed")
  })

  it("focuses the settled pagination status when the final appended page exhausts Load more", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("base")], "last-cursor"))
    await flushPromises()
    const append = harness.controller.loadMore()
    harness.listRequests[1].resolve(page([], null))
    await append

    expect(harness.controller.getSnapshot().focusIntent).toMatchObject({
      target: "pagination-status",
    })
    expect(
      ready(harness.controller.getSnapshot().recent).page.nextCursor
    ).toBeNull()
  })

  it("rejects a late append after a query or tab change", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("base")], "cursor"))
    await flushPromises()

    const append = harness.controller.loadMore()
    harness.controller.restoreRouteState("trash", "deleted")
    harness.listRequests[1].resolve(page([summary("late-append")]))
    harness.listRequests[2].resolve(
      page([
        summary("trash-match", {
          deletedAt: "2026-08-29T12:00:00.000Z",
        }),
      ])
    )
    await append
    await flushPromises()
    expect(harness.controller.getSnapshot().collection).toBe("trash")
    expect(
      ready(harness.controller.getSnapshot().trash).page.items[0]?.documentId
    ).toBe("trash-match")
  })

  it("rejects an append completion after disposal", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([summary("base")], "cursor"))
    await flushPromises()
    const append = harness.controller.loadMore()
    harness.controller.dispose()
    harness.listRequests[1].resolve(page([summary("late")]))
    await append

    expect(harness.controller.getSnapshot()).toMatchObject({ disposed: true })
    expect(
      ready(harness.controller.getSnapshot().recent).page.items.map(
        (item) => item.documentId
      )
    ).toEqual(["base"])
  })

  it("rejects duplicate, deletion-state, and out-of-order pages and requests a fresh first page", async () => {
    for (const invalidItem of [
      summary("base", { activityAt: "2026-08-29T09:00:00.000Z" }),
      summary("deleted", {
        activityAt: "2026-08-29T09:00:00.000Z",
        deletedAt: "2026-08-29T09:00:00.000Z",
      }),
      summary("newer-than-base", {
        activityAt: "2026-08-29T12:00:00.000Z",
      }),
    ]) {
      const harness = createHarness()
      harness.controller.activate()
      harness.listRequests[0].resolve(
        page(
          [summary("base", { activityAt: "2026-08-29T10:00:00.000Z" })],
          "cursor"
        )
      )
      await flushPromises()
      const append = harness.controller.loadMore()
      harness.listRequests[1].resolve(page([invalidItem]))
      await append
      expect(harness.list).toHaveBeenCalledTimes(3)
      expect(harness.list.mock.calls[2]?.[0]).toEqual({
        state: "active",
        query: "",
        limit: 24,
      })
    }
  })

  it("uses IndexedDB code-unit document ID order for equal timestamps", async () => {
    const harness = createHarness()
    const activityAt = "2026-08-29T10:00:00.000Z"
    harness.controller.activate()
    harness.listRequests[0].resolve(
      page([summary("é", { activityAt })], "cursor")
    )
    await flushPromises()

    const validAppend = harness.controller.loadMore()
    harness.listRequests[1].resolve(page([summary("z", { activityAt })]))
    await validAppend
    expect(
      ready(harness.controller.getSnapshot().recent).page.items.map(
        (item) => item.documentId
      )
    ).toEqual(["é", "z"])

    const secondHarness = createHarness()
    secondHarness.controller.activate()
    secondHarness.listRequests[0].resolve(
      page([summary("z", { activityAt })], "cursor")
    )
    await flushPromises()
    const invalidAppend = secondHarness.controller.loadMore()
    secondHarness.listRequests[1].resolve(page([summary("é", { activityAt })]))
    await invalidAppend
    expect(secondHarness.list).toHaveBeenCalledTimes(3)
  })
})

describe("RecentDocumentsController recovery inventory", () => {
  it("keeps quarantined and retained recovery items sticky and deduplicated", async () => {
    const quarantined: DraftListRecoveryItem = {
      documentId: "document-q",
      quarantineId: "quarantine-1",
      status: "quarantined",
      failure: { kind: "corrupt_record", message: "corrupt" },
    }
    const retained: DraftListRecoveryItem = {
      documentId: "document-r",
      quarantineId: null,
      status: "retained",
      failure: { kind: "request_failed", message: "retained" },
    }
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([], null, [quarantined, retained]))
    await flushPromises()
    harness.controller.refresh()
    harness.listRequests[1].resolve(
      page([], null, [quarantined, { ...retained }])
    )
    await flushPromises()
    harness.controller.refresh()
    harness.listRequests[2].resolve(page([]))
    await flushPromises()

    expect(harness.controller.getSnapshot().recoveryItems).toEqual([
      quarantined,
      retained,
    ])
  })

  it("deduplicates recovery descriptors structurally without delimiter collisions", async () => {
    const first: DraftListRecoveryItem = {
      documentId: "a",
      quarantineId: null,
      status: "retained",
      failure: {
        kind: "request_failed",
        message: "x:quota_exceeded:y",
      },
    }
    const second: DraftListRecoveryItem = {
      documentId: "a:request_failed:x",
      quarantineId: null,
      status: "retained",
      failure: { kind: "quota_exceeded", message: "y" },
    }
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(page([], null, [first, second]))
    await flushPromises()

    expect(harness.controller.getSnapshot().recoveryItems).toEqual([
      first,
      second,
    ])
  })
})

describe("RecentDocumentsController document actions", () => {
  const loadActive = async (
    harness: ReturnType<typeof createHarness>,
    items = [summary("document-a", { name: "Proposal" })]
  ) => {
    harness.controller.activate()
    harness.listRequests[0].resolve(page(items))
    await flushPromises()
  }

  it("keeps rename input and local validation, conflict, corruption, quota, and storage failures", async () => {
    const cases: DraftWriteResult[] = [
      {
        ok: false,
        reason: "validation_failed",
        failure: { kind: "validation_failed", message: "invalid name" },
      },
      {
        ok: false,
        reason: "conflict",
        conflict: {} as never,
        current: summary("document-a", { recordVersion: 2 }),
      },
      {
        ok: false,
        reason: "corrupt_record",
        quarantineId: "quarantine-a",
        failure: { kind: "corrupt_record", message: "corrupt" },
      },
      {
        ok: false,
        reason: "storage_unavailable",
        failure: { kind: "quota_exceeded", message: "quota" },
      },
      {
        ok: false,
        reason: "storage_unavailable",
        failure: { kind: "storage_unavailable", message: "offline" },
      },
    ]

    for (const result of cases) {
      const harness = createHarness()
      await loadActive(harness)
      expect(harness.controller.beginRename("document-a")).toBe(true)
      harness.controller.updateRename("document-a", "  Revised  ")
      harness.rename.mockResolvedValueOnce(result)
      await harness.controller.submitRename("document-a")
      expect(harness.rename).toHaveBeenCalledWith("document-a", 1, "Revised")
      expect(
        harness.controller.getSnapshot().actions.get("document-a")
      ).toMatchObject({
        kind: "rename",
        phase: "editing",
        input: "  Revised  ",
        error: expect.any(String),
      })
    }

    const local = createHarness()
    await loadActive(local)
    local.controller.beginRename("document-a")
    local.controller.updateRename("document-a", "   ")
    await local.controller.submitRename("document-a")
    expect(local.rename).not.toHaveBeenCalled()
    expect(
      local.controller.getSnapshot().actions.get("document-a")
    ).toMatchObject({
      input: "   ",
      error: "Document name is required.",
    })
  })

  it("keeps the visible rename CAS version across a later repository refresh", async () => {
    const harness = createHarness()
    await loadActive(harness, [
      summary("document-a", {
        name: "Version one",
        recordVersion: 1,
      }),
    ])
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Stale dialog edit")
    harness.controller.refresh()
    harness.listRequests[1].resolve(
      page([
        summary("document-a", {
          name: "Version two",
          recordVersion: 2,
          activityAt: "2026-08-29T12:00:00.000Z",
        }),
      ])
    )
    await flushPromises()
    harness.rename.mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      conflict: {} as never,
      current: summary("document-a", { recordVersion: 2 }),
    })

    await harness.controller.submitRename("document-a")
    expect(harness.rename).toHaveBeenCalledWith(
      "document-a",
      1,
      "Stale dialog edit"
    )
  })

  it("submits the reserved rename after refresh removes the cached row", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Still submit this")
    harness.controller.refresh()
    harness.listRequests[1].resolve(page([]))
    await flushPromises()
    harness.rename.mockResolvedValueOnce({ ok: false, reason: "missing" })

    await harness.controller.submitRename("document-a")
    expect(harness.rename).toHaveBeenCalledWith(
      "document-a",
      1,
      "Still submit this"
    )
    expect(
      harness.controller.getSnapshot().actions.get("document-a")
    ).toMatchObject({
      kind: "rename",
      phase: "editing",
      input: "Still submit this",
      error: expect.stringContaining("no longer exists"),
    })
  })

  it("reserves a document while rename is editing without blocking other documents", async () => {
    const harness = createHarness()
    await loadActive(harness, [summary("document-b"), summary("document-a")])
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Unsubmitted rename")
    expect(harness.controller.beginRename("document-a")).toBe(false)
    harness.duplicate.mockResolvedValueOnce(
      writeSuccess(summary("document-b-copy"))
    )

    expect(await harness.controller.duplicate("document-a")).toBeNull()
    expect(await harness.controller.moveToTrash("document-a")).toBeNull()
    expect(await harness.controller.download("document-a")).toBeNull()
    expect(
      harness.controller.getSnapshot().actions.get("document-a")
    ).toMatchObject({
      kind: "rename",
      phase: "editing",
      input: "Unsubmitted rename",
    })
    expect(harness.duplicate).not.toHaveBeenCalledWith("document-a")

    await harness.controller.duplicate("document-b")
    expect(harness.duplicate).toHaveBeenCalledWith("document-b")
  })

  it("does not focus a hidden source card when rename completes after a tab switch", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Renamed")
    const request = deferred<DraftWriteResult>()
    harness.rename.mockReturnValueOnce(request.promise)
    const rename = harness.controller.submitRename("document-a")
    harness.controller.setCollection("trash")
    request.resolve(
      writeSuccess(
        summary("document-a", {
          name: "Renamed",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    await rename

    expect(harness.controller.getSnapshot()).toMatchObject({
      collection: "trash",
      focusIntent: { target: "collection-heading" },
    })
  })

  it("removes a renamed row that leaves the applied query and retains that truth if refresh fails", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.controller.restoreRouteState("recent", "proposal")
    harness.listRequests[1].resolve(
      page([summary("document-a", { name: "Proposal" })])
    )
    await flushPromises()
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Invoice")
    harness.rename.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Invoice",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    await harness.controller.submitRename("document-a")

    expect(harness.controller.getSnapshot()).toMatchObject({
      focusIntent: { target: "collection-heading" },
      recent: { status: "loading", retained: { items: [] } },
    })
    harness.listRequests[2].resolve(failure("refresh failed"))
    await flushPromises()
    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "failed",
      retained: { items: [] },
    })
  })

  it("inserts a committed rename that enters a newer applied query before refresh succeeds", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.listRequests[0].resolve(
      page([summary("document-a", { name: "Proposal" })])
    )
    await flushPromises()
    harness.controller.beginRename("document-a")
    harness.controller.updateRename("document-a", "Invoice")
    harness.controller.setQueryInput("invoice")
    harness.controller.applyQueryInput()
    harness.listRequests[1].resolve(page([]))
    await flushPromises()
    harness.rename.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Invoice",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )

    await harness.controller.submitRename("document-a")
    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "loading",
      retained: { items: [{ documentId: "document-a", name: "Invoice" }] },
    })
    harness.listRequests[2].resolve(failure("refresh failed"))
    await flushPromises()
    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "failed",
      retained: { items: [{ documentId: "document-a", name: "Invoice" }] },
    })
  })

  it("claims duplicate synchronously per document while allowing different documents", async () => {
    const harness = createHarness()
    await loadActive(harness, [summary("document-b"), summary("document-a")])
    const duplicateA = deferred<DraftWriteResult>()
    const duplicateB = deferred<DraftWriteResult>()
    harness.duplicate
      .mockReturnValueOnce(duplicateA.promise)
      .mockReturnValueOnce(duplicateB.promise)

    const first = harness.controller.duplicate("document-a")
    const sameTick = harness.controller.duplicate("document-a")
    const other = harness.controller.duplicate("document-b")
    expect(harness.duplicate).toHaveBeenCalledTimes(2)
    expect(await sameTick).toBeNull()

    duplicateA.resolve(
      writeSuccess(
        summary("copy-a", {
          name: "Document A copy",
          activityAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    duplicateB.resolve(
      writeSuccess(
        summary("copy-b", {
          name: "Document B copy",
          activityAt: "2026-08-29T14:00:00.000Z",
        })
      )
    )
    await Promise.all([first, other])
    expect(harness.list).toHaveBeenCalledTimes(3)
  })

  it("refreshes after a successful mutation even when no repository event arrives", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.duplicate.mockResolvedValueOnce(
      writeSuccess(
        summary("copy-a", {
          name: "Proposal copy",
          activityAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )

    await harness.controller.duplicate("document-a")
    expect(harness.list).toHaveBeenCalledTimes(2)
    expect(harness.list.mock.calls[1]?.[0]).toEqual({
      state: "active",
      query: "",
      limit: 24,
    })
  })

  it("does not let an older refresh failure discard a committed duplicate projection", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.controller.refresh()
    const copy = summary("copy-a", {
      name: "Proposal copy",
      activityAt: "2026-08-29T13:00:00.000Z",
    })
    harness.duplicate.mockResolvedValueOnce(writeSuccess(copy))
    await harness.controller.duplicate("document-a")
    harness.listRequests[1].resolve(failure("older refresh failed"))
    await flushPromises()

    const slot = harness.controller.getSnapshot().recent
    const retained = slot.status === "loading" ? slot.retained : null
    expect(retained?.items.some((item) => item.documentId === "copy-a")).toBe(
      true
    )
  })

  it("does not let an older refresh resurrect a document after committed Trash", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.controller.refresh()
    harness.softDelete.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
          deletedAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    await harness.controller.moveToTrash("document-a")
    harness.listRequests[1].resolve(page([summary("document-a")]))
    await flushPromises()

    const slot = harness.controller.getSnapshot().recent
    const retained = slot.status === "loading" ? slot.retained : null
    expect(
      retained?.items.some((item) => item.documentId === "document-a") ?? false
    ).toBe(false)
  })

  it("moves to Trash only after commit, stores exact undo version, and restores into Recent", async () => {
    const harness = createHarness()
    await loadActive(harness)
    const deleteRequest = deferred<DraftWriteResult>()
    harness.softDelete.mockReturnValueOnce(deleteRequest.promise)
    const deleting = harness.controller.moveToTrash("document-a")
    expect(
      ready(harness.controller.getSnapshot().recent).page.items
    ).toHaveLength(1)

    const tombstone = summary("document-a", {
      name: "Proposal",
      recordVersion: 2,
      activityAt: "2026-08-29T13:00:00.000Z",
      deletedAt: "2026-08-29T13:00:00.000Z",
    })
    deleteRequest.resolve(writeSuccess(tombstone))
    await deleting
    expect(harness.softDelete).toHaveBeenCalledWith("document-a", 1)
    expect(harness.controller.getSnapshot().undo).toEqual({
      kind: "restore",
      documentId: "document-a",
      name: "Proposal",
      expectedRecordVersion: 2,
    })

    harness.restore.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 3,
          activityAt: "2026-08-29T14:00:00.000Z",
        })
      )
    )
    await harness.controller.restoreUndo()
    expect(harness.restore).toHaveBeenCalledWith("document-a", 2)
    expect(harness.controller.getSnapshot()).toMatchObject({
      collection: "recent",
      undo: null,
      focusIntent: { target: "document", documentId: "document-a" },
    })
  })

  it("resolves Restore from the visible Trash owner when stale Recent has the same ID", async () => {
    const harness = createHarness()
    await loadActive(harness, [
      summary("document-a", { name: "Proposal", recordVersion: 1 }),
    ])
    harness.controller.setCollection("trash")
    const tombstone = summary("document-a", {
      name: "Proposal",
      recordVersion: 2,
      activityAt: "2026-08-29T13:00:00.000Z",
      deletedAt: "2026-08-29T13:00:00.000Z",
    })
    harness.listRequests[1].resolve(page([tombstone]))
    await flushPromises()
    harness.restore.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 3,
          activityAt: "2026-08-29T14:00:00.000Z",
        })
      )
    )

    await harness.controller.restore("document-a")
    expect(harness.restore).toHaveBeenCalledWith("document-a", 2)
  })

  it("retains an exact Trash-first restore in Recent while its direct refresh is pending or fails", async () => {
    const harness = createHarness()
    harness.controller.activate()
    harness.controller.setCollection("trash")
    const tombstone = summary("document-a", {
      name: "Proposal",
      recordVersion: 2,
      activityAt: "2026-08-29T13:00:00.000Z",
      deletedAt: "2026-08-29T13:00:00.000Z",
    })
    harness.listRequests[1].resolve(page([tombstone]))
    await flushPromises()
    const restored = summary("document-a", {
      name: "Proposal",
      recordVersion: 3,
      activityAt: "2026-08-29T14:00:00.000Z",
    })
    harness.restore.mockResolvedValueOnce(writeSuccess(restored))

    await harness.controller.restore("document-a")
    expect(harness.controller.getSnapshot()).toMatchObject({
      collection: "recent",
      focusIntent: { target: "document", documentId: "document-a" },
      recent: {
        status: "loading",
        retained: { items: [{ documentId: "document-a", recordVersion: 3 }] },
      },
    })

    harness.listRequests[2].resolve(failure("refresh unavailable"))
    await flushPromises()
    expect(harness.controller.getSnapshot().recent).toMatchObject({
      status: "failed",
      retained: { items: [{ documentId: "document-a", recordVersion: 3 }] },
      failure: { message: "refresh unavailable" },
    })
  })

  it("keeps the current query when undo restores a document hidden by that search", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.softDelete.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
          deletedAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    await harness.controller.moveToTrash("document-a")
    harness.controller.setQueryInput("invoice")
    harness.controller.applyQueryInput()
    harness.restore.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 3,
          activityAt: "2026-08-29T14:00:00.000Z",
        })
      )
    )

    await harness.controller.restoreUndo()
    expect(harness.controller.getSnapshot()).toMatchObject({
      collection: "recent",
      queryInput: "invoice",
      appliedQuery: "invoice",
      announcement: { message: expect.stringContaining("hidden") },
      focusIntent: { target: "collection-heading" },
    })
    const slot = harness.controller.getSnapshot().recent
    const retained = slot.status === "loading" ? slot.retained : null
    expect(
      retained?.items.some((item) => item.documentId === "document-a") ?? false
    ).toBe(false)
  })

  it("keeps a failed destructive action and its source row available for retry", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.softDelete.mockResolvedValueOnce({
      ok: false,
      reason: "storage_unavailable",
      failure: { kind: "quota_exceeded", message: "Storage quota exceeded." },
    })

    await harness.controller.moveToTrash("document-a")
    expect(
      ready(harness.controller.getSnapshot().recent).page.items[0]?.documentId
    ).toBe("document-a")
    expect(harness.controller.getSnapshot().actions.get("document-a")).toEqual({
      kind: "trash",
      phase: "failed",
      owner: "recent",
      documentName: "Proposal",
      token: 1,
      error: "Storage quota exceeded.",
    })

    harness.softDelete.mockResolvedValueOnce(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
          deletedAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )
    await harness.controller.moveToTrash("document-a")
    expect(harness.softDelete).toHaveBeenCalledTimes(2)
    expect(harness.controller.getSnapshot().actions.has("document-a")).toBe(
      false
    )
    expect(harness.controller.getSnapshot().undo).toMatchObject({
      documentId: "document-a",
      expectedRecordVersion: 2,
    })
  })

  it("retains the exact thrown action message in a non-busy retry state", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.duplicate.mockImplementationOnce(() => {
      throw new Error("Duplicate request failed")
    })

    await harness.controller.duplicate("document-a")
    expect(harness.controller.getSnapshot().actions.get("document-a")).toEqual({
      kind: "duplicate",
      phase: "failed",
      owner: "recent",
      documentName: "Proposal",
      token: 1,
      error: "Duplicate request failed",
    })
  })

  it("retains the source name when a failed action outlives its visible row", async () => {
    const harness = createHarness()
    await loadActive(harness)
    const duplicateRequest = deferred<DraftWriteResult>()
    harness.duplicate.mockReturnValueOnce(duplicateRequest.promise)

    const duplicate = harness.controller.duplicate("document-a")
    harness.controller.refresh()
    harness.listRequests[1].resolve(page([]))
    await flushPromises()
    expect(ready(harness.controller.getSnapshot().recent).page.items).toEqual(
      []
    )

    duplicateRequest.resolve({
      ok: false,
      reason: "storage_unavailable",
      failure: { kind: "quota_exceeded", message: "Storage is full." },
    })
    await duplicate

    expect(harness.controller.getSnapshot().actions.get("document-a")).toEqual({
      kind: "duplicate",
      phase: "failed",
      owner: "recent",
      documentName: "Proposal",
      token: 1,
      error: "Storage is full.",
    })
  })

  it("adds corrupt write and download results to the sticky quarantine inventory", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.duplicate.mockResolvedValueOnce({
      ok: false,
      reason: "corrupt_record",
      quarantineId: "quarantine-write",
      failure: { kind: "corrupt_record", message: "Write source was corrupt." },
    })
    await harness.controller.duplicate("document-a")
    harness.getForDownload.mockResolvedValueOnce({
      ok: false,
      reason: "corrupt_record",
      quarantineId: "quarantine-download",
      failure: {
        kind: "corrupt_record",
        message: "Download source was corrupt.",
      },
    })
    await harness.controller.download("document-a")

    expect(harness.controller.getSnapshot().recoveryItems).toEqual([
      {
        documentId: "document-a",
        quarantineId: "quarantine-write",
        status: "quarantined",
        failure: {
          kind: "corrupt_record",
          message: "Write source was corrupt.",
        },
      },
      {
        documentId: "document-a",
        quarantineId: "quarantine-download",
        status: "quarantined",
        failure: {
          kind: "corrupt_record",
          message: "Download source was corrupt.",
        },
      },
    ])
  })

  it("reads a body only for explicit download and verifies the exact identity", async () => {
    const harness = createHarness()
    await loadActive(harness)
    expect(harness.getForDownload).not.toHaveBeenCalled()
    harness.getForDownload.mockResolvedValueOnce({
      ok: true,
      status: "found",
      record: record(summary("document-a", { name: "A/B Proposal" })),
    })

    const download = await harness.controller.download("document-a")
    expect(harness.getForDownload).toHaveBeenCalledWith("document-a")
    expect(download).toMatchObject({
      documentId: "document-a",
      name: "A/B Proposal",
      fileName: "A-B Proposal.json",
    })
    expect(JSON.parse(download?.json ?? "null").document.id).toBe("document-a")

    harness.getForDownload.mockResolvedValueOnce({
      ok: true,
      status: "found",
      record: record(summary("wrong-document")),
    })
    expect(await harness.controller.download("document-a")).toBeNull()
    expect(
      harness.controller.getSnapshot().actions.get("document-a")
    ).toMatchObject({
      kind: "download",
      phase: "failed",
      error: expect.stringContaining("identity"),
    })
  })

  it("publishes no late action state after disposal", async () => {
    const harness = createHarness()
    await loadActive(harness)
    const request = deferred<DraftWriteResult>()
    harness.duplicate.mockReturnValueOnce(request.promise)
    const action = harness.controller.duplicate("document-a")
    harness.controller.dispose()
    request.resolve(writeSuccess(summary("copy-after-dispose")))
    expect(await action).toBeNull()
    expect(harness.controller.getSnapshot()).toMatchObject({
      disposed: true,
      announcement: null,
      focusIntent: null,
    })
  })

  it("returns no committed destructive result to a caller after disposal", async () => {
    const harness = createHarness()
    await loadActive(harness)
    const request = deferred<DraftWriteResult>()
    harness.softDelete.mockReturnValueOnce(request.promise)
    const action = harness.controller.moveToTrash("document-a")
    harness.controller.dispose()
    request.resolve(
      writeSuccess(
        summary("document-a", {
          recordVersion: 2,
          deletedAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )

    expect(await action).toBeNull()
  })

  it("retains a committed action while inactive without recreating focus ownership", async () => {
    const harness = createHarness()
    await loadActive(harness)
    const request = deferred<DraftWriteResult>()
    harness.softDelete.mockReturnValueOnce(request.promise)
    const action = harness.controller.moveToTrash("document-a")
    harness.controller.deactivate()
    request.resolve(
      writeSuccess(
        summary("document-a", {
          name: "Proposal",
          recordVersion: 2,
          activityAt: "2026-08-29T13:00:00.000Z",
          deletedAt: "2026-08-29T13:00:00.000Z",
        })
      )
    )

    await action
    expect(harness.controller.getSnapshot()).toMatchObject({
      active: false,
      focusIntent: null,
      undo: {
        documentId: "document-a",
        expectedRecordVersion: 2,
      },
    })
  })

  it("guards stale announcement and focus acknowledgements by identity", async () => {
    const harness = createHarness()
    await loadActive(harness)
    harness.duplicate
      .mockResolvedValueOnce(
        writeSuccess(summary("copy-one", { name: "Copy" }))
      )
      .mockResolvedValueOnce(
        writeSuccess(summary("copy-two", { name: "Copy" }))
      )

    await harness.controller.duplicate("document-a")
    const firstAnnouncement = harness.controller.getSnapshot().announcement
    await harness.controller.duplicate("document-a")
    const secondAnnouncement = harness.controller.getSnapshot().announcement
    expect(secondAnnouncement?.id).not.toBe(firstAnnouncement?.id)
    if (!firstAnnouncement || !secondAnnouncement)
      throw new Error("Expected announcements")
    harness.controller.clearAnnouncement(firstAnnouncement.id)
    expect(harness.controller.getSnapshot().announcement).toEqual(
      secondAnnouncement
    )
    harness.controller.clearAnnouncement(secondAnnouncement.id)
    expect(harness.controller.getSnapshot().announcement).toBeNull()

    harness.controller.setCollection("trash")
    const firstFocus = harness.controller.getSnapshot().focusIntent
    harness.controller.setCollection("recent")
    const secondFocus = harness.controller.getSnapshot().focusIntent
    if (!firstFocus || !secondFocus) throw new Error("Expected focus intents")
    expect(secondFocus.id).not.toBe(firstFocus.id)
    harness.controller.clearFocusIntent(firstFocus.id)
    expect(harness.controller.getSnapshot().focusIntent).toEqual(secondFocus)
    harness.controller.clearFocusIntent(secondFocus.id)
    expect(harness.controller.getSnapshot().focusIntent).toBeNull()
  })
})
