// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { StrictMode, act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest"
import { DocumentDraftRepository } from "./document-draft-repository"
import type { DraftListResult } from "./document-draft-repository"
import type { CurrentDraftRepositoryMigrationResult } from "./document-draft-migration"
import type { DraftRecoveryRecord } from "./draft-recovery"
import { RecentDocumentsController } from "./recent-documents-controller"
import type { RecentDocumentsDependencies } from "./recent-documents-controller"
import {
  RecentDocumentsProvider,
  useRecentDocuments,
  useRecentDocumentsVisibility,
} from "./recent-documents-provider"
import type {
  RecentDocumentsApi,
  RecentDocumentsControllerFactory,
} from "./recent-documents-provider"
import { StudioPersistenceProvider } from "../persistence/studio-persistence-provider"
import { StudioPersistenceRuntime } from "../persistence/studio-persistence-runtime"

const emptyMigration = {
  status: "empty",
} as const satisfies CurrentDraftRepositoryMigrationResult

const recovery: DraftRecoveryRecord = {
  schemaVersion: 1,
  sourceStorageKey: "webmcp-studio:current-draft:v1",
  capturedAt: "2026-08-29T08:00:00.000Z",
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

const blockedMigration = {
  status: "blocked",
  failure: {
    kind: "blocked",
    message: "Another Studio tab is upgrading storage.",
  },
} as const satisfies CurrentDraftRepositoryMigrationResult

const unavailableMigration = {
  status: "repository_unavailable",
  failure: {
    kind: "storage_unavailable",
    message: "Studio document storage is unavailable.",
  },
} as const satisfies CurrentDraftRepositoryMigrationResult

const emptyPage: DraftListResult = {
  ok: true,
  page: { items: [], nextCursor: null, recoveryItems: [] },
}

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
}>

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

class ManualFinalizationScheduler {
  readonly callbacks: Array<() => void> = []

  schedule = (callback: () => void) => {
    this.callbacks.push(callback)
  }

  flush() {
    while (this.callbacks.length > 0) this.callbacks.shift()?.()
  }
}

type ControllerLifecycle = Readonly<{
  controller: RecentDocumentsController
  activate: ReturnType<typeof vi.spyOn>
  deactivate: ReturnType<typeof vi.spyOn>
  dispose: ReturnType<typeof vi.spyOn>
}>

const controllerFactoryHarness = (events: string[] = []) => {
  const controllers: ControllerLifecycle[] = []
  const factory: RecentDocumentsControllerFactory = (
    dependencies: RecentDocumentsDependencies
  ) => {
    const controller = new RecentDocumentsController(dependencies)
    const originalDispose = controller.dispose.bind(controller)
    const activate = vi.spyOn(controller, "activate")
    const deactivate = vi.spyOn(controller, "deactivate")
    const dispose = vi.spyOn(controller, "dispose").mockImplementation(() => {
      events.push("controller.dispose")
      originalDispose()
    })
    controllers.push({ controller, activate, deactivate, dispose })
    return controller
  }
  return { controllers, factory }
}

function RecentProbe({
  visible,
  capture,
}: {
  visible: boolean
  capture: (api: RecentDocumentsApi) => void
}) {
  const recentDocuments = useRecentDocuments()
  useRecentDocumentsVisibility(visible)
  useLayoutEffect(() => capture(recentDocuments), [capture, recentDocuments])
  return null
}

describe("RecentDocumentsProvider mounted lifecycle", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
  })

  it("keeps activation controls out of the public context contract", () => {
    expectTypeOf<RecentDocumentsApi["commands"]>().not.toHaveProperty(
      "activate"
    )
    expectTypeOf<RecentDocumentsApi["commands"]>().not.toHaveProperty(
      "deactivate"
    )
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it.each([
    ["recovery_required", recoveryMigration],
    ["blocked", blockedMigration],
    ["unavailable", unavailableMigration],
  ] as const)(
    "keeps the library inactive while persistence is %s",
    async (expectedStatus, migration) => {
      const repository = new DocumentDraftRepository({
        indexedDB: {} as IDBFactory,
        sessionId: `recent-provider-${expectedStatus}`,
      })
      const list = vi.spyOn(repository, "list").mockResolvedValue(emptyPage)
      vi.spyOn(repository, "subscribe").mockReturnValue(vi.fn())
      const runtimes: StudioPersistenceRuntime[] = []
      const acquireLease: ReturnType<typeof vi.spyOn>[] = []
      const createRuntime = () => {
        const runtime = new StudioPersistenceRuntime({
          createRepository: () => repository,
          migrate: async () => migration,
        })
        acquireLease.push(vi.spyOn(runtime, "acquireLease"))
        runtimes.push(runtime)
        return runtime
      }
      const controllerHarness = controllerFactoryHarness()
      const captured: { current: RecentDocumentsApi | null } = {
        current: null,
      }

      await act(async () => {
        root.render(
          <StrictMode>
            <StudioPersistenceProvider createRuntime={createRuntime}>
              <RecentDocumentsProvider
                createController={controllerHarness.factory}
              >
                <RecentProbe
                  visible
                  capture={(api) => {
                    captured.current = api
                  }}
                />
              </RecentDocumentsProvider>
            </StudioPersistenceProvider>
          </StrictMode>
        )
      })
      await vi.waitFor(() => {
        expect(captured.current?.state.status).toBe(expectedStatus)
      })

      expect(controllerHarness.controllers.length).toBeGreaterThan(1)
      expect(
        controllerHarness.controllers.reduce(
          (count, item) => count + item.activate.mock.calls.length,
          0
        )
      ).toBe(0)
      expect(list).not.toHaveBeenCalled()
      expect(
        acquireLease.reduce(
          (count, lease) => count + lease.mock.calls.length,
          0
        )
      ).toBe(0)
      if (captured.current?.state.status === "ready") {
        throw new Error("The provider exposed a ready library too early.")
      }
      expect("library" in captured.current!.state).toBe(false)
      expect(captured.current!.commands).not.toHaveProperty("activate")
      expect(captured.current!.commands).not.toHaveProperty("deactivate")
    }
  )

  it("projects opening without constructing repository work during render", async () => {
    const migration = deferred<CurrentDraftRepositoryMigrationResult>()
    const repository = new DocumentDraftRepository({
      indexedDB: {} as IDBFactory,
      sessionId: "recent-provider-opening",
    })
    const repositorySubscribe = vi
      .spyOn(repository, "subscribe")
      .mockReturnValue(vi.fn())
    const list = vi.spyOn(repository, "list").mockResolvedValue(emptyPage)
    const createRepository = vi.fn(() => repository)
    const renderObservations: Array<{
      repositoryCreations: number
      repositorySubscriptions: number
    }> = []
    const createRuntime = () =>
      new StudioPersistenceRuntime({
        createRepository,
        migrate: () => migration.promise,
      })
    const controllerHarness = controllerFactoryHarness()
    const createController: RecentDocumentsControllerFactory = (
      dependencies
    ) => {
      renderObservations.push({
        repositoryCreations: createRepository.mock.calls.length,
        repositorySubscriptions: repositorySubscribe.mock.calls.length,
      })
      return controllerHarness.factory(dependencies)
    }
    const captured: { current: RecentDocumentsApi | null } = {
      current: null,
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <RecentDocumentsProvider createController={createController}>
              <RecentProbe
                visible
                capture={(api) => {
                  captured.current = api
                }}
              />
            </RecentDocumentsProvider>
          </StudioPersistenceProvider>
        </StrictMode>
      )
    })

    expect(renderObservations.length).toBeGreaterThan(1)
    expect(renderObservations).toEqual(
      renderObservations.map(() => ({
        repositoryCreations: 0,
        repositorySubscriptions: 0,
      }))
    )
    expect(captured.current?.state).toEqual({ status: "opening" })
    expect(captured.current!.commands).not.toHaveProperty("activate")
    expect(captured.current!.commands).not.toHaveProperty("deactivate")
    expect(list).not.toHaveBeenCalled()
    expect(
      controllerHarness.controllers.reduce(
        (count, item) => count + item.activate.mock.calls.length,
        0
      )
    ).toBe(0)

    await act(async () => migration.resolve(emptyMigration))
    await vi.waitFor(() => expect(captured.current?.state.status).toBe("ready"))
    expect(list).toHaveBeenCalledTimes(1)
  })

  it("retains one controller, one fanout consumer, and one child lease through StrictMode and visibility changes", async () => {
    const lifecycleEvents: string[] = []
    const repository = new DocumentDraftRepository({
      indexedDB: {} as IDBFactory,
      sessionId: "recent-provider-retained",
    })
    const underlyingUnsubscribe = vi.fn()
    const repositorySubscribe = vi
      .spyOn(repository, "subscribe")
      .mockReturnValue(underlyingUnsubscribe)
    const list = vi.spyOn(repository, "list").mockImplementation(async () => {
      lifecycleEvents.push("list")
      return emptyPage
    })
    const runtimes: StudioPersistenceRuntime[] = []
    const fanoutUnsubscribes: ReturnType<typeof vi.fn>[] = []
    const acquireLeaseSpies: ReturnType<typeof vi.spyOn>[] = []
    const leaseReleases: ReturnType<typeof vi.fn>[] = []
    const createRuntime = () => {
      const runtime = new StudioPersistenceRuntime({
        createRepository: () => repository,
        migrate: async () => emptyMigration,
      })
      const originalSubscribe = runtime.subscribeRepositoryEvents
      vi.spyOn(runtime, "subscribeRepositoryEvents").mockImplementation(
        (listener) => {
          lifecycleEvents.push("fanout.subscribe")
          const release = originalSubscribe(listener)
          const releaseSpy = vi.fn(release)
          fanoutUnsubscribes.push(releaseSpy)
          return releaseSpy
        }
      )
      const acquireLease = runtime.acquireLease.bind(runtime)
      acquireLeaseSpies.push(
        vi.spyOn(runtime, "acquireLease").mockImplementation(() => {
          lifecycleEvents.push("lease.acquire")
          const release = vi.fn(acquireLease())
          leaseReleases.push(release)
          return release
        })
      )
      runtimes.push(runtime)
      return runtime
    }
    const controllerHarness = controllerFactoryHarness()
    const finalization = new ManualFinalizationScheduler()
    const captured: { current: RecentDocumentsApi | null } = {
      current: null,
    }
    const capture = (api: RecentDocumentsApi) => {
      captured.current = api
    }
    const render = (visible: boolean) =>
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <RecentDocumentsProvider
              createController={controllerHarness.factory}
              scheduleFinalization={finalization.schedule}
            >
              <RecentProbe visible={visible} capture={capture} />
            </RecentDocumentsProvider>
          </StudioPersistenceProvider>
        </StrictMode>
      )

    await act(async () => render(true))
    await vi.waitFor(() => {
      expect(captured.current?.state.status).toBe("ready")
      expect(list).toHaveBeenCalledTimes(1)
    })
    finalization.flush()

    const retainedControllers = controllerHarness.controllers.filter(
      (item) => item.activate.mock.calls.length > 0
    )
    expect(retainedControllers).toHaveLength(1)
    const retainedController = retainedControllers[0]
    expect(repositorySubscribe).toHaveBeenCalledTimes(1)
    expect(fanoutUnsubscribes).toHaveLength(1)
    expect(fanoutUnsubscribes[0]).not.toHaveBeenCalled()
    expect(
      acquireLeaseSpies.reduce(
        (count, lease) => count + lease.mock.calls.length,
        0
      )
    ).toBe(1)
    expect(retainedController.dispose).not.toHaveBeenCalled()
    expect(leaseReleases).toHaveLength(1)
    expect(leaseReleases[0]).not.toHaveBeenCalled()
    expect(lifecycleEvents).toEqual([
      "lease.acquire",
      "fanout.subscribe",
      "list",
    ])

    const controllerBeforePersistenceIdentityChange =
      retainedController.controller
    await act(async () => render(false))
    expect(captured.current?.state.status).toBe("ready")
    expect(captured.current!.commands).not.toHaveProperty("activate")
    expect(captured.current!.commands).not.toHaveProperty("deactivate")
    expect(
      controllerHarness.controllers.find(
        (item) => item.controller === controllerBeforePersistenceIdentityChange
      )?.controller
    ).toBe(controllerBeforePersistenceIdentityChange)
    expect(fanoutUnsubscribes[0]).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(1)

    await act(async () => render(true))
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(fanoutUnsubscribes).toHaveLength(1)
    expect(repositorySubscribe).toHaveBeenCalledTimes(1)

    const clearAnnouncement = vi.spyOn(
      retainedController.controller,
      "clearAnnouncement"
    )
    const clearFocusIntent = vi.spyOn(
      retainedController.controller,
      "clearFocusIntent"
    )
    captured.current!.commands.clearAnnouncement(47)
    captured.current!.commands.clearFocusIntent(83)
    expect(clearAnnouncement).toHaveBeenCalledWith(47)
    expect(clearFocusIntent).toHaveBeenCalledWith(83)

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    finalization.flush()
    expect(retainedController.dispose).toHaveBeenCalledTimes(1)
    expect(fanoutUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(leaseReleases[0]).toHaveBeenCalledTimes(1)
  })

  it("disposes the real controller before releasing its lease and closing the real repository", async () => {
    const databaseName = `recent-provider-real-${crypto.randomUUID()}`
    const repository = new DocumentDraftRepository({
      databaseName,
      indexedDB: globalThis.indexedDB,
      sessionId: "recent-provider-real-runtime",
    })
    const close = vi.spyOn(repository, "close")
    const events: string[] = []
    const controllerHarness = controllerFactoryHarness(events)
    const providerFinalization = new ManualFinalizationScheduler()
    const runtimeFinalization = new ManualFinalizationScheduler()
    const createRuntime = () => {
      const runtime = new StudioPersistenceRuntime({
        createRepository: () => repository,
        migrate: async () => emptyMigration,
        scheduleMicrotask: runtimeFinalization.schedule,
      })
      const acquireLease = runtime.acquireLease.bind(runtime)
      vi.spyOn(runtime, "acquireLease").mockImplementation(() => {
        const release = acquireLease()
        return () => {
          events.push("lease.release")
          release()
        }
      })
      return runtime
    }
    const captured: { current: RecentDocumentsApi | null } = {
      current: null,
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <RecentDocumentsProvider
              createController={controllerHarness.factory}
              scheduleFinalization={providerFinalization.schedule}
            >
              <RecentProbe
                visible
                capture={(api) => {
                  captured.current = api
                }}
              />
            </RecentDocumentsProvider>
          </StudioPersistenceProvider>
        </StrictMode>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.state.status).toBe("ready")
      if (captured.current?.state.status === "ready") {
        expect(captured.current.state.library.recent.status).toBe("ready")
      }
    })
    providerFinalization.flush()
    runtimeFinalization.flush()
    expect(close).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    runtimeFinalization.flush()
    expect(close).not.toHaveBeenCalled()
    providerFinalization.flush()
    runtimeFinalization.flush()

    expect(events).toEqual(["controller.dispose", "lease.release"])
    expect(close).toHaveBeenCalledTimes(1)
    await new Promise<void>((resolve) => {
      const request = globalThis.indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })
})
