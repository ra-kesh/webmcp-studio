import { describe, expect, it, vi } from "vitest"
import type { CurrentDraftEnvelope } from "../editor/current-draft-repository"
import { DocumentDraftRepository } from "../editor/document-draft-repository"
import type {
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftRepositoryEvent,
} from "../editor/document-draft-repository"
import type { CurrentDraftRepositoryMigrationResult } from "../editor/document-draft-migration"
import type { DraftRecoveryRecord } from "../editor/draft-recovery"
import { StudioPersistenceRuntime } from "./studio-persistence-runtime"
import type { StudioPersistenceState } from "./studio-persistence-runtime"

const emptyMigration = {
  status: "empty",
} as const satisfies CurrentDraftRepositoryMigrationResult

const repositoryFailure = {
  kind: "storage_unavailable",
  message: "Studio document storage is unavailable for this test.",
} as const

const blockedMigration = {
  status: "blocked",
  failure: {
    kind: "blocked",
    message: "Another Studio tab is upgrading storage.",
  },
} as const satisfies CurrentDraftRepositoryMigrationResult

const recovery: DraftRecoveryRecord = {
  schemaVersion: 1,
  sourceStorageKey: "webmcp-studio:current-draft:v1",
  capturedAt: "2026-08-28T22:00:00.000Z",
  failure: {
    kind: "malformed_json",
    message: "The saved draft is not valid JSON.",
  },
  raw: "{broken",
}

const recoveryMigration = {
  status: "recovery_required",
  recovery,
  recoveryStored: true,
} as const satisfies CurrentDraftRepositoryMigrationResult

const recoverableEnvelope = {
  schemaVersion: 1,
  document: { id: "recoverable-document" },
  sourceContext: null,
} as unknown as CurrentDraftEnvelope

function repositoryHarness() {
  const repository = new DocumentDraftRepository({
    indexedDB: {} as IDBFactory,
    sessionId: "runtime-test-session",
  })
  let repositoryListener: ((event: DraftRepositoryEvent) => void) | null = null
  const repositoryUnsubscribe = vi.fn()
  const subscribe = vi
    .spyOn(repository, "subscribe")
    .mockImplementation((listener) => {
      repositoryListener = listener
      return repositoryUnsubscribe
    })
  const close = vi.spyOn(repository, "close")
  return {
    repository,
    subscribe,
    repositoryUnsubscribe,
    close,
    deliver: (event: DraftRepositoryEvent) => repositoryListener?.(event),
  }
}

function controlledMicrotasks() {
  const pending: Array<() => void> = []
  return {
    schedule: (callback: () => void) => pending.push(callback),
    flush: () => {
      while (pending.length) pending.shift()?.()
    },
    count: () => pending.length,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function migratedResult(): Extract<
  CurrentDraftRepositoryMigrationResult,
  { status: "migrated" }
> {
  return {
    status: "migrated",
    disposition: "created",
    source: "envelope",
    record: { summary: {}, envelope: {} } as unknown as DocumentDraftRecord,
    bootstrapWarnings: [
      { operation: "read_legacy", message: "A legacy context was ignored." },
    ],
    cleanupFailures: [
      {
        key: "webmcp-studio:northstar-document:v2",
        message: "A legacy key could not be removed.",
      },
    ],
  }
}

function collisionResult(): Extract<
  CurrentDraftRepositoryMigrationResult,
  { status: "collision" }
> {
  return {
    status: "collision",
    conflict: {} as never,
    current: {} as DocumentDraftSummary,
  }
}

const savedEvent: DraftRepositoryEvent = {
  type: "saved",
  reason: "content_saved",
  documentId: "runtime-event-document",
  recordVersion: 2,
  contentSnapshotId: "content-2",
  draftSnapshotId: "draft-2",
  sessionId: "foreign-session",
}

describe("StudioPersistenceRuntime", () => {
  it("calls the default browser microtask scheduler with its global receiver", async () => {
    const harness = repositoryHarness()
    const originalQueueMicrotask = globalThis.queueMicrotask
    const receivers: unknown[] = []
    Object.defineProperty(globalThis, "queueMicrotask", {
      configurable: true,
      writable: true,
      value: function (this: unknown, callback: () => void) {
        receivers.push(this)
        callback()
      },
    })

    try {
      const runtime = new StudioPersistenceRuntime({
        createRepository: () => harness.repository,
        migrate: async () => emptyMigration,
      })
      const release = runtime.retain()
      await runtime.start()

      release()

      expect(receivers).toEqual([globalThis])
      expect(harness.close).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(globalThis, "queueMicrotask", {
        configurable: true,
        writable: true,
        value: originalQueueMicrotask,
      })
    }
  })

  it("is inert until start or retain and memoizes one migration per generation", async () => {
    const harness = repositoryHarness()
    const createRepository = vi.fn(() => harness.repository)
    const migration = deferred<CurrentDraftRepositoryMigrationResult>()
    const migrate = vi.fn(() => migration.promise)
    const runtime = new StudioPersistenceRuntime({
      createRepository,
      migrate,
    })

    runtime.subscribe(() => undefined)
    runtime.subscribeRepositoryEvents(() => undefined)
    expect(runtime.state).toEqual({ status: "opening" })
    expect(createRepository).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
    expect(harness.subscribe).not.toHaveBeenCalled()

    const firstStart = runtime.start()
    const secondStart = runtime.start()
    expect(firstStart).toBe(secondStart)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(harness.subscribe).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(migrate).toHaveBeenCalledTimes(1)

    migration.resolve(emptyMigration)
    await firstStart
    expect(runtime.state).toEqual({
      status: "ready",
      migration: emptyMigration,
      warning: null,
    })
    await runtime.start()
    expect(migrate).toHaveBeenCalledTimes(1)
  })

  const stateCases = [
    {
      label: "empty",
      migration: emptyMigration,
      expected: {
        status: "ready",
        migration: emptyMigration,
        warning: null,
      },
    },
    {
      label: "migrated with warnings",
      migration: migratedResult(),
      expected: {
        status: "ready",
        migration: migratedResult(),
        warning:
          "A legacy context was ignored. A legacy key could not be removed.",
      },
    },
    {
      label: "collision",
      migration: collisionResult(),
      expected: {
        status: "ready",
        migration: collisionResult(),
        warning:
          "Studio preserved a different legacy draft as a conflict instead of overwriting this document.",
      },
    },
    {
      label: "recovery required",
      migration: recoveryMigration,
      expected: { status: "recovery_required", recovery },
    },
    {
      label: "blocked",
      migration: blockedMigration,
      expected: {
        status: "blocked",
        failure: blockedMigration.failure,
        recoverableEnvelope: null,
      },
    },
    {
      label: "repository unavailable",
      migration: {
        status: "repository_unavailable",
        failure: repositoryFailure,
      },
      expected: {
        status: "unavailable",
        failure: repositoryFailure,
        recoverableEnvelope: null,
      },
    },
    {
      label: "legacy storage unavailable with recoverable bytes",
      migration: {
        status: "legacy_storage_unavailable",
        failure: {
          operation: "get_storage",
          message: "Legacy local storage is unavailable.",
        },
        recoverableDraft: recoverableEnvelope,
      },
      expected: {
        status: "unavailable",
        failure: {
          kind: "legacy_storage_unavailable",
          message: "Legacy local storage is unavailable.",
        },
        recoverableEnvelope,
      },
    },
    {
      label: "invalid legacy draft",
      migration: {
        status: "validation_failed",
        failure: {
          ok: false,
          reason: "validation_failed",
          failure: {
            kind: "schema_invalid",
            message: "The legacy draft schema is invalid.",
          },
        },
      },
      expected: {
        status: "unavailable",
        failure: {
          kind: "schema_invalid",
          message: "The legacy draft schema is invalid.",
        },
        recoverableEnvelope: null,
      },
    },
    {
      label: "oversized legacy draft",
      migration: {
        status: "validation_failed",
        failure: {
          ok: false,
          reason: "too_large",
          encodedByteLength: 40 * 1024 * 1024,
          maximumEncodedByteLength: 32 * 1024 * 1024,
        },
      },
      expected: {
        status: "unavailable",
        failure: {
          kind: "too_large",
          message:
            "The legacy draft is 40.0 MiB; Studio supports drafts up to 32 MiB.",
        },
        recoverableEnvelope: null,
      },
    },
    {
      label: "migration failure",
      migration: {
        status: "migration_failed",
        failure: repositoryFailure,
      },
      expected: {
        status: "unavailable",
        failure: repositoryFailure,
        recoverableEnvelope: null,
      },
    },
    {
      label: "verification failure",
      migration: {
        status: "verification_failed",
        message: "Migrated bytes did not verify exactly.",
      },
      expected: {
        status: "unavailable",
        failure: {
          kind: "verification_failed",
          message: "Migrated bytes did not verify exactly.",
        },
        recoverableEnvelope: null,
      },
    },
  ] satisfies readonly {
    label: string
    migration: CurrentDraftRepositoryMigrationResult
    expected: StudioPersistenceState
  }[]

  it.each(stateCases)(
    "maps $label to an exact public state",
    async ({ migration, expected }) => {
      const harness = repositoryHarness()
      const microtasks = controlledMicrotasks()
      const runtime = new StudioPersistenceRuntime({
        createRepository: () => harness.repository,
        migrate: async () => migration,
        scheduleMicrotask: microtasks.schedule,
      })
      const release = runtime.retain()

      await runtime.start()
      expect(runtime.state).toEqual(expected)

      release()
      microtasks.flush()
      expect(harness.close).toHaveBeenCalledTimes(1)
    }
  )

  it("retries exactly once from blocked or unavailable and nowhere else", async () => {
    const harness = repositoryHarness()
    const migrate = vi
      .fn<() => Promise<CurrentDraftRepositoryMigrationResult>>()
      .mockResolvedValueOnce(blockedMigration)
      .mockResolvedValueOnce(emptyMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
    })
    runtime.retain()

    await runtime.start()
    expect(runtime.state.status).toBe("blocked")
    runtime.retry()
    expect(runtime.state).toEqual({ status: "opening" })
    runtime.retry()
    await runtime.start()
    expect(runtime.state).toEqual({
      status: "ready",
      migration: emptyMigration,
      warning: null,
    })
    expect(migrate).toHaveBeenCalledTimes(2)

    runtime.retry()
    await runtime.start()
    expect(migrate).toHaveBeenCalledTimes(2)
  })

  it("completes recovery exactly once and preserves the cleanup warning", async () => {
    const harness = repositoryHarness()
    const migrate = vi.fn(async () => recoveryMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
    })
    runtime.retain()
    await runtime.start()
    expect(runtime.state).toEqual({ status: "recovery_required", recovery })
    const listener = vi.fn()
    runtime.subscribe(listener)

    const cleanupWarning =
      "Studio restored the document, but one legacy recovery key could not be removed."
    runtime.completeRecovery(cleanupWarning)
    const completedState = runtime.state
    expect(completedState).toEqual({
      status: "ready",
      migration: { status: "empty" },
      warning: cleanupWarning,
    })
    expect(listener).toHaveBeenCalledTimes(1)

    await runtime.start()
    const releaseAdditionalRetain = runtime.retain()
    await runtime.start()
    expect(runtime.state).toBe(completedState)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(harness.subscribe).toHaveBeenCalledTimes(1)

    runtime.completeRecovery("A later caller must not replace the warning.")
    expect(runtime.state).toBe(completedState)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(harness.subscribe).toHaveBeenCalledTimes(1)
    releaseAdditionalRetain()
  })

  it("accepts a null recovery warning without rerunning migration", async () => {
    const harness = repositoryHarness()
    const migrate = vi.fn(async () => recoveryMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
    })
    runtime.retain()
    await runtime.start()

    runtime.completeRecovery(null)
    expect(runtime.state).toEqual({
      status: "ready",
      migration: { status: "empty" },
      warning: null,
    })
    expect(migrate).toHaveBeenCalledTimes(1)
  })

  it("does not admit recovery completion from any non-recovery state", async () => {
    const inertHarness = repositoryHarness()
    const createRepository = vi.fn(() => inertHarness.repository)
    const inertRuntime = new StudioPersistenceRuntime({
      createRepository,
      migrate: async () => recoveryMigration,
    })
    const openingState = inertRuntime.state
    inertRuntime.completeRecovery("Wrong state")
    expect(inertRuntime.state).toBe(openingState)
    expect(createRepository).not.toHaveBeenCalled()

    const wrongStateMigrations = [
      emptyMigration,
      blockedMigration,
      {
        status: "repository_unavailable",
        failure: repositoryFailure,
      } as const satisfies CurrentDraftRepositoryMigrationResult,
    ]
    for (const migration of wrongStateMigrations) {
      const harness = repositoryHarness()
      const migrate = vi.fn(async () => migration)
      const runtime = new StudioPersistenceRuntime({
        createRepository: () => harness.repository,
        migrate,
      })
      runtime.retain()
      await runtime.start()
      const state = runtime.state
      const listener = vi.fn()
      runtime.subscribe(listener)

      runtime.completeRecovery("Wrong state")
      expect(runtime.state).toBe(state)
      expect(listener).not.toHaveBeenCalled()
      expect(migrate).toHaveBeenCalledTimes(1)
      expect(harness.subscribe).toHaveBeenCalledTimes(1)
    }
  })

  it("lets recovery completion supersede the migration notification generation", async () => {
    const harness = repositoryHarness()
    const migrate = vi.fn(async () => recoveryMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
    })
    const observedStates: StudioPersistenceState[] = []
    runtime.subscribe(() => {
      observedStates.push(runtime.state)
      if (runtime.state.status === "recovery_required") {
        runtime.completeRecovery("Recovery cleanup remains pending.")
      }
    })
    runtime.retain()

    await runtime.start()
    expect(runtime.state).toEqual({
      status: "ready",
      migration: { status: "empty" },
      warning: "Recovery cleanup remains pending.",
    })
    expect(observedStates).toEqual([
      { status: "recovery_required", recovery },
      {
        status: "ready",
        migration: { status: "empty" },
        warning: "Recovery cleanup remains pending.",
      },
    ])
    expect(migrate).toHaveBeenCalledTimes(1)
  })

  it("rejects recovery completion after terminal close without new work", async () => {
    const harness = repositoryHarness()
    const microtasks = controlledMicrotasks()
    const createRepository = vi.fn(() => harness.repository)
    const migrate = vi.fn(async () => recoveryMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository,
      migrate,
      scheduleMicrotask: microtasks.schedule,
    })
    const release = runtime.retain()
    await runtime.start()
    const terminalState = runtime.state
    const listener = vi.fn()
    runtime.subscribe(listener)

    release()
    microtasks.flush()
    runtime.completeRecovery("Too late")

    expect(runtime.state).toBe(terminalState)
    expect(listener).not.toHaveBeenCalled()
    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(harness.subscribe).toHaveBeenCalledTimes(1)
  })

  it("keeps a reentrant retry generation authoritative after the failed generation settles", async () => {
    const harness = repositoryHarness()
    const retriedMigration = deferred<CurrentDraftRepositoryMigrationResult>()
    const migrate = vi
      .fn<() => Promise<CurrentDraftRepositoryMigrationResult>>()
      .mockRejectedValueOnce(new Error("Generation zero storage failure"))
      .mockImplementationOnce(() => retriedMigration.promise)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
    })
    const observedStates: StudioPersistenceState["status"][] = []
    runtime.subscribe(() => {
      observedStates.push(runtime.state.status)
      if (runtime.state.status === "unavailable") runtime.retry()
    })
    runtime.retain()

    const generationZero = runtime.start()
    await generationZero
    expect(runtime.state).toEqual({ status: "opening" })
    expect(migrate).toHaveBeenCalledTimes(2)

    retriedMigration.resolve(emptyMigration)
    await runtime.start()
    const authoritativeState = runtime.state
    expect(authoritativeState).toEqual({
      status: "ready",
      migration: emptyMigration,
      warning: null,
    })
    expect(observedStates).toEqual(["unavailable", "opening", "ready"])

    await generationZero
    await Promise.resolve()
    expect(runtime.state).toBe(authoritativeState)
    expect(observedStates).toEqual(["unavailable", "opening", "ready"])
  })

  it("uses one repository subscription to fan out events without listener coupling", async () => {
    const harness = repositoryHarness()
    const microtasks = controlledMicrotasks()
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate: async () => emptyMigration,
      scheduleMicrotask: microtasks.schedule,
    })
    const first = vi.fn(() => {
      throw new Error("View listener failed")
    })
    const second = vi.fn()
    const unsubscribeFirst = runtime.subscribeRepositoryEvents(first)
    runtime.subscribeRepositoryEvents(second)
    const release = runtime.retain()
    await runtime.start()

    expect(harness.subscribe).toHaveBeenCalledTimes(1)
    harness.deliver(savedEvent)
    expect(first).toHaveBeenCalledWith(savedEvent)
    expect(second).toHaveBeenCalledWith(savedEvent)

    unsubscribeFirst()
    harness.deliver(savedEvent)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    release()
    microtasks.flush()
    expect(harness.repositoryUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it("cancels StrictMode-style microtask close when retained again", async () => {
    const harness = repositoryHarness()
    const microtasks = controlledMicrotasks()
    const migrate = vi.fn(async () => emptyMigration)
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate,
      scheduleMicrotask: microtasks.schedule,
    })

    const firstRelease = runtime.retain()
    await runtime.start()
    firstRelease()
    expect(microtasks.count()).toBe(1)
    const secondRelease = runtime.retain()
    microtasks.flush()

    expect(harness.repositoryUnsubscribe).not.toHaveBeenCalled()
    expect(harness.close).not.toHaveBeenCalled()
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(harness.subscribe).toHaveBeenCalledTimes(1)

    secondRelease()
    microtasks.flush()
    expect(harness.repositoryUnsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.close).toHaveBeenCalledTimes(1)
  })

  it("stops delivery at finalization but delays repository close for a child lease", async () => {
    const harness = repositoryHarness()
    const microtasks = controlledMicrotasks()
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate: async () => emptyMigration,
      scheduleMicrotask: microtasks.schedule,
    })
    const eventListener = vi.fn()
    const stateListener = vi.fn()
    runtime.subscribeRepositoryEvents(eventListener)
    runtime.subscribe(stateListener)
    const releaseRetain = runtime.retain()
    await runtime.start()
    const releaseLease = runtime.acquireLease()

    releaseRetain()
    microtasks.flush()
    expect(harness.repositoryUnsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.close).not.toHaveBeenCalled()

    harness.deliver(savedEvent)
    expect(eventListener).not.toHaveBeenCalled()
    releaseLease()
    expect(harness.close).toHaveBeenCalledTimes(1)
    releaseLease()
    expect(harness.close).toHaveBeenCalledTimes(1)
  })

  it("rejects a late migration result after final close without publishing state", async () => {
    const harness = repositoryHarness()
    const microtasks = controlledMicrotasks()
    const migration = deferred<CurrentDraftRepositoryMigrationResult>()
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate: () => migration.promise,
      scheduleMicrotask: microtasks.schedule,
    })
    const stateListener = vi.fn()
    runtime.subscribe(stateListener)
    const release = runtime.retain()
    const started = runtime.start()
    await Promise.resolve()

    release()
    microtasks.flush()
    migration.resolve(emptyMigration)
    await started

    expect(runtime.state).toEqual({ status: "opening" })
    expect(stateListener).not.toHaveBeenCalled()
    expect(harness.close).toHaveBeenCalledTimes(1)
  })

  it("maps a thrown migration boundary to retryable unavailable state", async () => {
    const harness = repositoryHarness()
    const runtime = new StudioPersistenceRuntime({
      createRepository: () => harness.repository,
      migrate: async () => {
        throw new Error("IndexedDB policy denied access")
      },
    })
    runtime.retain()

    await runtime.start()
    expect(runtime.state).toEqual({
      status: "unavailable",
      failure: {
        kind: "storage_unavailable",
        message:
          "Studio document storage is unavailable. IndexedDB policy denied access",
      },
      recoverableEnvelope: null,
    })
  })
})
