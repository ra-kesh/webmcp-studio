import { builtInDesignTemplateRepository } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import type { CurrentDraftSnapshot } from "./current-draft-repository"
import { DocumentDraftSaveController } from "./document-draft-save-controller"
import type {
  DraftSaveRepository,
  DraftSaveTimer,
  LocalSaveState,
} from "./document-draft-save-controller"
import type {
  DocumentDraftConflict,
  DocumentDraftRecord,
  DraftWriteResult,
} from "./document-draft-repository"

const initialSnapshot = (): CurrentDraftSnapshot => {
  const document = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  return {
    document: {
      ...document,
      id: "document-save-controller",
      name: "Initial",
    },
    sourceContext: {
      quotationSource: null,
      quotationTemplateId: "editorial-olive",
      designTemplate: { id: "editorial-one-pager", version: 1 },
    },
  }
}

const changed = (
  snapshot: CurrentDraftSnapshot,
  name: string
): CurrentDraftSnapshot => ({
  document: {
    ...snapshot.document,
    name,
    revision: snapshot.document.revision + 1,
  },
  sourceContext: snapshot.sourceContext,
})

const recordFor = (
  snapshot: CurrentDraftSnapshot,
  recordVersion = 1,
  suffix = String(recordVersion)
): DocumentDraftRecord => ({
  summary: {
    schemaVersion: 1,
    documentId: snapshot.document.id,
    name: snapshot.document.name,
    recordVersion,
    contentSnapshotId: `content-${suffix}`,
    draftSnapshotId: `draft-${suffix}`,
    documentRevision: snapshot.document.revision,
    createdAt: "2026-08-28T00:00:00.000Z",
    savedAt: `2026-08-28T00:00:0${Math.min(recordVersion, 9)}.000Z`,
    lastOpenedAt: "2026-08-28T00:00:00.000Z",
    activityAt: "2026-08-28T00:00:00.000Z",
    deletedAt: null,
    pageCount: snapshot.document.pages.length,
    outputCount: snapshot.document.outputs.length,
    firstPageId: snapshot.document.pages[0]?.id ?? "page",
    firstPageName: snapshot.document.pages[0]?.name ?? "Page",
    firstPageWidth: snapshot.document.pages[0]?.width ?? 1,
    firstPageHeight: snapshot.document.pages[0]?.height ?? 1,
    encodedByteLength: 1,
    exportFormats: ["png", "pdf"],
    sourceKind: "template",
    origin: { kind: "blank" },
    lastPublished: null,
  },
  envelope: {
    schemaVersion: 1,
    document: snapshot.document,
    sourceContext: snapshot.sourceContext,
  },
})

const saved = (
  snapshot: CurrentDraftSnapshot,
  version: number
): DraftWriteResult => ({
  ok: true,
  created: false,
  unchanged: false,
  record: recordFor(snapshot, version),
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

class ManualTimer implements DraftSaveTimer {
  #nextId = 0
  #callbacks = new Map<number, () => void>()

  set(callback: () => void) {
    const id = ++this.#nextId
    this.#callbacks.set(id, callback)
    return id
  }

  clear(handle: unknown) {
    this.#callbacks.delete(handle as number)
  }

  runAll() {
    const callbacks = [...this.#callbacks.values()]
    this.#callbacks.clear()
    for (const callback of callbacks) callback()
  }

  get size() {
    return this.#callbacks.size
  }
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const conflictFor = (
  snapshot: CurrentDraftSnapshot,
  reason: "stale_write" | "deleted_elsewhere"
): DocumentDraftConflict => ({
  schemaVersion: 1,
  conflictId: `conflict-${reason}`,
  documentId: snapshot.document.id,
  sessionId: "session-test",
  expectedRecordVersion: 1,
  observedRecordVersion: 2,
  baseDraftSnapshotId: "draft-1",
  observedContentSnapshotId: "content-2",
  observedDraftSnapshotId: "draft-2",
  candidateContentSnapshotId: "candidate-content",
  candidateDraftSnapshotId: "candidate-draft",
  candidate: snapshot,
  reason,
  detectedAt: "2026-08-28T00:00:02.000Z",
  resolvedAt: null,
  resolution: null,
  resolutionDocumentId: null,
})

describe("DocumentDraftSaveController", () => {
  it("returns the exact durable head only after the latest capture drains", async () => {
    const initial = initialSnapshot()
    const next = changed(initial, "Receipt")
    const repository: DraftSaveRepository = {
      save: vi.fn(async (snapshot) => saved(snapshot, 2)),
    }
    const controller = new DocumentDraftSaveController({
      repository,
      record: recordFor(initial),
      timer: new ManualTimer(),
    })
    controller.capture(next)

    await expect(controller.flushWithReceipt()).resolves.toEqual({
      ok: true,
      receipt: {
        documentId: initial.document.id,
        recordVersion: 2,
        contentSnapshotId: "content-2",
        draftSnapshotId: "draft-2",
        savedAt: "2026-08-28T00:00:02.000Z",
      },
    })
    expect(repository.save).toHaveBeenCalledTimes(1)
    expect(controller.hasPendingCapture).toBe(false)
  })

  it("orders writes so an older completion cannot replace a newer capture", async () => {
    const initial = initialSnapshot()
    const first = changed(initial, "First")
    const second = changed(first, "Second")
    const firstWrite = deferred<DraftWriteResult>()
    const secondWrite = deferred<DraftWriteResult>()
    const calls: Array<{ name: string; expected: number }> = []
    let active = 0
    let maximumActive = 0
    const repository: DraftSaveRepository = {
      save: async (snapshot, expected) => {
        calls.push({ name: snapshot.document.name, expected })
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const result = await (calls.length === 1
          ? firstWrite.promise
          : secondWrite.promise)
        active -= 1
        return result
      },
    }
    const timer = new ManualTimer()
    const controller = new DocumentDraftSaveController({
      repository,
      record: recordFor(initial),
      debounceMs: 10,
      timer,
    })

    controller.capture(first)
    timer.runAll()
    await settle()
    controller.capture(second)
    timer.runAll()
    firstWrite.resolve(saved(first, 2))
    await settle()
    const flushed = controller.flush()
    await vi.waitFor(() => expect(calls).toHaveLength(2))

    expect(controller.state.status).toBe("saving")
    expect(calls).toEqual([
      { name: "First", expected: 1 },
      { name: "Second", expected: 2 },
    ])

    secondWrite.resolve(saved(second, 3))
    await flushed
    expect(maximumActive).toBe(1)
    expect(controller.recordVersion).toBe(3)
    expect(controller.contentSnapshotId).toBe("content-3")
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 3,
    })
  })

  it("coalesces rapid captures to the latest exact snapshot", async () => {
    const initial = initialSnapshot()
    const timer = new ManualTimer()
    const save = vi.fn(async (snapshot: CurrentDraftSnapshot) =>
      saved(snapshot, 2)
    )
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer,
    })

    controller.capture(changed(initial, "One"))
    controller.capture(changed(initial, "Two"))
    controller.capture(changed(initial, "Three"))
    expect(timer.size).toBe(1)
    timer.runAll()
    await controller.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0].document.name).toBe("Three")
  })

  it("lets an aborted waiter leave without duplicating the ordered draft write", async () => {
    const initial = initialSnapshot()
    const candidate = changed(initial, "Abortable flush")
    const write = deferred<DraftWriteResult>()
    const save = vi.fn(() => write.promise)
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer: new ManualTimer(),
    })
    const abortController = new AbortController()

    controller.capture(candidate)
    const firstFlush = controller.flush(abortController.signal)
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const reason = new DOMException("Export cancelled", "AbortError")
    abortController.abort(reason)

    await expect(firstFlush).rejects.toBe(reason)
    expect(controller.state.status).toBe("saving")

    const retryFlush = controller.flush()
    expect(save).toHaveBeenCalledOnce()
    write.resolve(saved(candidate, 2))
    await retryFlush

    expect(save).toHaveBeenCalledOnce()
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 2,
    })
  })

  it("keeps newer captures ordered when an export waiter aborts and retries", async () => {
    const initial = initialSnapshot()
    const first = changed(initial, "First save")
    const second = changed(first, "Newer capture")
    const firstWrite = deferred<DraftWriteResult>()
    const secondWrite = deferred<DraftWriteResult>()
    const calls: string[] = []
    let active = 0
    let maximumActive = 0
    const save = vi.fn(async (snapshot: CurrentDraftSnapshot) => {
      calls.push(snapshot.document.name)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const result = await (calls.length === 1
        ? firstWrite.promise
        : secondWrite.promise)
      active -= 1
      return result
    })
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer: new ManualTimer(),
    })
    const abortController = new AbortController()

    controller.capture(first)
    const cancelledFlush = controller.flush(abortController.signal)
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    controller.capture(second)
    const reason = new DOMException("Export cancelled", "AbortError")
    abortController.abort(reason)

    await expect(cancelledFlush).rejects.toBe(reason)
    const retryFlush = controller.flush()
    expect(save).toHaveBeenCalledOnce()

    firstWrite.resolve(saved(first, 2))
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(calls).toEqual(["First save", "Newer capture"])

    secondWrite.resolve(saved(second, 3))
    await retryFlush

    expect(maximumActive).toBe(1)
    expect(controller.recordVersion).toBe(3)
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 3,
    })
  })

  it("captures source context at commit time instead of reading it later", async () => {
    const initial = initialSnapshot()
    const timer = new ManualTimer()
    const captured = structuredClone(initial)
    if (!captured.sourceContext) throw new Error("Expected source context")
    captured.sourceContext.quotationTemplateId = "warm-paper"
    const save = vi.fn(async (snapshot: CurrentDraftSnapshot) =>
      saved(snapshot, 2)
    )
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer,
    })

    controller.capture(captured)
    captured.sourceContext.quotationTemplateId = "midnight-film"
    timer.runAll()
    await controller.flush()

    expect(save.mock.calls[0]?.[0].sourceContext?.quotationTemplateId).toBe(
      "warm-paper"
    )
  })

  it.each([
    ["conflict", "stale_write"],
    ["deleted", "deleted_elsewhere"],
  ] as const)(
    "pauses after a %s result and retains the candidate",
    async (kind, reason) => {
      const initial = initialSnapshot()
      const candidate = changed(initial, "Candidate")
      const conflict = conflictFor(candidate, reason)
      const save = vi.fn(async (): Promise<DraftWriteResult> =>
        kind === "deleted"
          ? {
              ok: false,
              reason: "deleted",
              conflict,
              current: recordFor(initial, 2).summary,
            }
          : {
              ok: false,
              reason: "conflict",
              conflict,
              current: recordFor(initial, 2).summary,
            }
      )
      const timer = new ManualTimer()
      const controller = new DocumentDraftSaveController({
        repository: { save },
        record: recordFor(initial),
        timer,
      })

      controller.capture(candidate)
      timer.runAll()
      await controller.flush()
      expect(controller.state).toEqual({
        status: "conflict",
        conflictId: `conflict-${reason}`,
        reason,
      })
      expect(controller.hasPendingCapture).toBe(true)

      controller.capture(changed(candidate, "Newer candidate"))
      timer.runAll()
      await controller.flush()
      expect(save).toHaveBeenCalledTimes(1)
    }
  )

  it("retains a capture after storage failure and retries it", async () => {
    const initial = initialSnapshot()
    const candidate = changed(initial, "Retry me")
    const save = vi
      .fn<
        (
          ...args: Parameters<DraftSaveRepository["save"]>
        ) => Promise<DraftWriteResult>
      >()
      .mockResolvedValueOnce({
        ok: false,
        reason: "storage_unavailable",
        failure: {
          kind: "storage_unavailable",
          message: "IndexedDB transaction aborted.",
        },
      })
      .mockResolvedValueOnce(saved(candidate, 2))
    const timer = new ManualTimer()
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer,
    })

    controller.capture(candidate)
    timer.runAll()
    await controller.flush()
    expect(controller.state).toEqual({
      status: "failed",
      message: "IndexedDB transaction aborted.",
      retryable: true,
    })
    expect(controller.hasPendingCapture).toBe(true)

    await controller.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0].document.name).toBe("Retry me")
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 2,
    })
  })

  it("pauses automatic writes after a non-retryable failure", async () => {
    const initial = initialSnapshot()
    const first = changed(initial, "Invalid")
    const second = changed(first, "Still pending")
    const save = vi
      .fn<
        (
          ...args: Parameters<DraftSaveRepository["save"]>
        ) => Promise<DraftWriteResult>
      >()
      .mockResolvedValueOnce({
        ok: false,
        reason: "validation_failed",
        failure: {
          kind: "validation_failed",
          message: "The captured document is invalid.",
        },
      })
      .mockResolvedValueOnce(saved(second, 2))
    const timer = new ManualTimer()
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer,
    })

    controller.capture(first)
    timer.runAll()
    await controller.flush()
    expect(controller.state).toEqual({
      status: "failed",
      message: "The captured document is invalid.",
      retryable: false,
    })

    controller.capture(second)
    expect(timer.size).toBe(0)
    await controller.flush()
    expect(save).toHaveBeenCalledTimes(1)

    await controller.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0].document.name).toBe("Still pending")
  })

  it("isolates subscriber exceptions from durable save state", async () => {
    const initial = initialSnapshot()
    const candidate = changed(initial, "Durable despite listener")
    const timer = new ManualTimer()
    const save = vi.fn(async (snapshot: CurrentDraftSnapshot) =>
      saved(snapshot, 2)
    )
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      timer,
    })
    controller.subscribe(() => {
      throw new Error("Broken view subscriber")
    })

    controller.capture(candidate)
    timer.runAll()
    await controller.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 2,
    })
  })

  it("does not publish or adopt an in-flight write completion after close", async () => {
    const initial = initialSnapshot()
    const write = deferred<DraftWriteResult>()
    const timer = new ManualTimer()
    const controller = new DocumentDraftSaveController({
      repository: { save: () => write.promise },
      record: recordFor(initial),
      timer,
    })
    const states: LocalSaveState[] = []
    controller.subscribe((state) => states.push(state))
    const candidate = changed(initial, "Late")

    controller.capture(candidate)
    timer.runAll()
    await settle()
    controller.close()
    write.resolve(saved(candidate, 2))
    await settle()

    expect(controller.recordVersion).toBe(1)
    expect(states.at(-1)?.status).toBe("saving")
    expect(controller.capture(changed(candidate, "Closed"))).toBe(false)
  })

  it("flushes immediately without waiting for the debounce timer", async () => {
    const initial = initialSnapshot()
    const candidate = changed(initial, "Explicit flush")
    const timer = new ManualTimer()
    const save = vi.fn(async (snapshot: CurrentDraftSnapshot) =>
      saved(snapshot, 2)
    )
    const controller = new DocumentDraftSaveController({
      repository: { save },
      record: recordFor(initial),
      debounceMs: 60_000,
      timer,
    })

    controller.capture(candidate)
    expect(timer.size).toBe(1)
    await controller.flush()

    expect(timer.size).toBe(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.state).toMatchObject({
      status: "saved",
      recordVersion: 2,
    })
  })

  it("never returns a durable receipt after the persistence session closes", async () => {
    const initial = initialSnapshot()
    const controller = new DocumentDraftSaveController({
      repository: { save: vi.fn() },
      record: recordFor(initial),
      timer: new ManualTimer(),
    })

    controller.close()

    await expect(controller.flushWithReceipt()).resolves.toMatchObject({
      ok: false,
      reason: "session_closed",
    })
  })
})
