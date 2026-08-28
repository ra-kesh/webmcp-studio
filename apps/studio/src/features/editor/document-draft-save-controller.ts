import type { CurrentDraftSnapshot } from "./current-draft-repository"
import type {
  DocumentDraftRecord,
  DraftWriteResult,
} from "./document-draft-repository"

export type LocalSaveState =
  | Readonly<{ status: "opening" }>
  | Readonly<{ status: "saved"; recordVersion: number; savedAt: string }>
  | Readonly<{ status: "saving"; expectedRecordVersion: number }>
  | Readonly<{
      status: "external_change"
      reason: "saved_elsewhere" | "deleted_elsewhere"
      observedRecordVersion: number
    }>
  | Readonly<{ status: "failed"; message: string; retryable: boolean }>
  | Readonly<{
      status: "conflict"
      conflictId: string
      reason: "stale_write" | "deleted_elsewhere"
    }>
  | Readonly<{ status: "session_only"; message: string }>

export type DraftSaveRepository = Readonly<{
  save: (
    snapshot: CurrentDraftSnapshot,
    expectedRecordVersion: number,
    baseDraftSnapshotId: string
  ) => Promise<DraftWriteResult>
}>

export type DraftSaveTimer = Readonly<{
  set: (callback: () => void, delayMs: number) => unknown
  clear: (handle: unknown) => void
}>

export type DocumentDraftSaveControllerOptions = Readonly<{
  repository: DraftSaveRepository
  record: DocumentDraftRecord
  debounceMs?: number
  timer?: DraftSaveTimer
  cloneSnapshot?: (snapshot: CurrentDraftSnapshot) => CurrentDraftSnapshot
}>

type Listener = (state: LocalSaveState) => void

const defaultTimer: DraftSaveTimer = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const defaultClone = (snapshot: CurrentDraftSnapshot): CurrentDraftSnapshot =>
  structuredClone(snapshot)

const failureMessage = (result: Extract<DraftWriteResult, { ok: false }>) => {
  if ("failure" in result) return result.failure.message
  if (result.reason === "missing")
    return "This document no longer exists in local storage."
  if (result.reason === "exists")
    return "A different document already uses this identifier."
  return "Studio could not save this document."
}

/**
 * Orders durable writes for one open document. The editor owns when a settled
 * commit is captured; this controller owns debounce, compare-and-swap versions,
 * retry, and terminal conflict state.
 */
export class DocumentDraftSaveController {
  readonly documentId: string

  #repository: DraftSaveRepository
  #debounceMs: number
  #timerApi: DraftSaveTimer
  #cloneSnapshot: (snapshot: CurrentDraftSnapshot) => CurrentDraftSnapshot
  #recordVersion: number
  #contentSnapshotId: string
  #draftSnapshotId: string
  #state: LocalSaveState
  #listeners = new Set<Listener>()
  #pending: CurrentDraftSnapshot | null = null
  #timer: unknown | null = null
  #ordered: Promise<void> = Promise.resolve()
  #writeQueued = false
  #closed = false
  #terminal = false
  #generation = 0

  constructor(options: DocumentDraftSaveControllerOptions) {
    this.#repository = options.repository
    this.#debounceMs = options.debounceMs ?? 350
    this.#timerApi = options.timer ?? defaultTimer
    this.#cloneSnapshot = options.cloneSnapshot ?? defaultClone
    this.documentId = options.record.summary.documentId
    this.#recordVersion = options.record.summary.recordVersion
    this.#contentSnapshotId = options.record.summary.contentSnapshotId
    this.#draftSnapshotId = options.record.summary.draftSnapshotId
    this.#state = {
      status: "saved",
      recordVersion: options.record.summary.recordVersion,
      savedAt: options.record.summary.savedAt,
    }
  }

  get state(): LocalSaveState {
    return this.#state
  }

  get recordVersion() {
    return this.#recordVersion
  }

  get contentSnapshotId() {
    return this.#contentSnapshotId
  }

  get draftSnapshotId() {
    return this.#draftSnapshotId
  }

  get hasPendingCapture() {
    return this.#pending !== null
  }

  subscribe(listener: Listener) {
    if (this.#closed) return () => undefined
    this.#listeners.add(listener)
    this.#notify(listener, this.#state)
    return () => this.#listeners.delete(listener)
  }

  /** Captures an immutable, exact editor commit and coalesces the debounce window. */
  capture(snapshot: CurrentDraftSnapshot) {
    if (this.#closed) return false
    if (snapshot.document.id !== this.documentId) {
      throw new Error(
        `Cannot save document ${snapshot.document.id} with the controller for ${this.documentId}.`
      )
    }
    this.#pending = this.#cloneSnapshot(snapshot)
    if (this.#terminal || this.#state.status === "failed") return true
    this.#publish({
      status: "saving",
      expectedRecordVersion: this.#recordVersion,
    })
    this.#schedule()
    return true
  }

  /** Retries the latest retained capture after a failed storage operation. */
  retry() {
    if (this.#closed || this.#terminal || !this.#pending)
      return Promise.resolve()
    this.#clearTimer()
    this.#publish({
      status: "saving",
      expectedRecordVersion: this.#recordVersion,
    })
    return this.#enqueueOne(true)
  }

  /**
   * Bypasses debounce and drains the latest capture. It resolves after the
   * capture is durable, or after the controller reaches failed/conflict state.
   */
  async flush() {
    if (this.#closed) return
    this.#clearTimer()
    while (this.#canDrain()) {
      await this.#enqueueOne()
      if (this.#state.status === "failed" || this.#state.status === "conflict")
        return
    }
    await this.#ordered
  }

  /**
   * Stops scheduling and state publication. An IndexedDB transaction already
   * issued through the repository cannot be cancelled; its late completion is
   * deliberately ignored by this controller generation.
   */
  close() {
    if (this.#closed) return
    this.#closed = true
    this.#generation += 1
    this.#clearTimer()
    this.#listeners.clear()
  }

  #schedule() {
    this.#clearTimer()
    this.#timer = this.#timerApi.set(() => {
      this.#timer = null
      void this.#enqueueOne()
    }, this.#debounceMs)
  }

  #clearTimer() {
    if (this.#timer === null) return
    this.#timerApi.clear(this.#timer)
    this.#timer = null
  }

  #enqueueOne(retry = false) {
    if (this.#writeQueued) return this.#ordered
    if (!retry && this.#state.status === "failed") return this.#ordered
    this.#writeQueued = true
    const generation = this.#generation
    const write = this.#ordered
      .then(() => this.#persistOne(generation))
      .finally(() => {
        this.#writeQueued = false
      })
    // A failed operation updates state itself. Keep the ordering chain usable
    // so an explicit retry can follow it.
    this.#ordered = write.catch(() => undefined)
    return write
  }

  async #persistOne(generation: number) {
    if (this.#closed || generation !== this.#generation || this.#terminal)
      return
    const captured = this.#pending
    if (!captured) return
    this.#pending = null
    const expectedRecordVersion = this.#recordVersion
    const baseDraftSnapshotId = this.#draftSnapshotId
    this.#publish({ status: "saving", expectedRecordVersion })

    let result: DraftWriteResult
    try {
      result = await this.#repository.save(
        captured,
        expectedRecordVersion,
        baseDraftSnapshotId
      )
    } catch (error) {
      if (this.#isStale(generation)) return
      this.#restorePending(captured)
      this.#publish({
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Studio could not write this document to local storage.",
        retryable: true,
      })
      return
    }

    if (this.#isStale(generation)) return
    if (result.ok) {
      this.#recordVersion = result.record.summary.recordVersion
      this.#contentSnapshotId = result.record.summary.contentSnapshotId
      this.#draftSnapshotId = result.record.summary.draftSnapshotId
      if (this.#hasPending()) {
        this.#publish({
          status: "saving",
          expectedRecordVersion: this.#recordVersion,
        })
        this.#schedule()
      } else {
        this.#publish({
          status: "saved",
          recordVersion: this.#recordVersion,
          savedAt: result.record.summary.savedAt,
        })
      }
      return
    }

    if (result.reason === "conflict" || result.reason === "deleted") {
      // The repository has retained this exact candidate transactionally.
      // Keep any still-newer capture in memory for explicit conflict recovery.
      this.#restorePending(captured)
      this.#terminal = true
      this.#clearTimer()
      this.#publish({
        status: "conflict",
        conflictId: result.conflict.conflictId,
        reason:
          result.reason === "deleted" ? "deleted_elsewhere" : "stale_write",
      })
      return
    }

    this.#restorePending(captured)
    this.#publish({
      status: "failed",
      message: failureMessage(result),
      retryable: result.reason === "storage_unavailable",
    })
  }

  #restorePending(captured: CurrentDraftSnapshot) {
    // A capture made while this write was in flight is newer and wins.
    if (!this.#pending) this.#pending = captured
  }

  #canDrain() {
    return this.#pending !== null && !this.#terminal && !this.#closed
  }

  #hasPending() {
    return this.#pending !== null
  }

  #isStale(generation: number) {
    return this.#closed || generation !== this.#generation
  }

  #publish(state: LocalSaveState) {
    if (this.#closed) return
    this.#state = state
    for (const listener of this.#listeners) this.#notify(listener, state)
  }

  #notify(listener: Listener, state: LocalSaveState) {
    try {
      listener(state)
    } catch {
      // A view subscriber is observational. It cannot roll back or relabel a
      // repository result that has already become durable.
    }
  }
}
