// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { act, StrictMode, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { DocumentDraftRepository } from "../editor/document-draft-repository"
import { migrateCurrentDraftToRepository } from "../editor/document-draft-migration"
import {
  StudioPersistenceProvider,
  useStudioPersistence,
} from "./studio-persistence-provider"
import type { StudioPersistenceApi } from "./studio-persistence-provider"
import { StudioPersistenceRuntime } from "./studio-persistence-runtime"

const databaseName = "webmcp-studio-provider-strict-mode-test"
const realIndexedDB = globalThis.indexedDB

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = realIndexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

function PersistenceConsumer({
  capture,
}: {
  capture: (api: StudioPersistenceApi) => void
}) {
  const persistence = useStudioPersistence()
  useLayoutEffect(() => capture(persistence), [capture, persistence])
  return null
}

describe("StudioPersistenceProvider StrictMode lifecycle", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(async () => {
    localStorage.clear()
    await deleteRepositoryDatabase()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    localStorage.clear()
    await deleteRepositoryDatabase()
  })

  it("activates only the retained runtime and closes one repository after its final lease", async () => {
    const indexedDbOpen = vi.spyOn(realIndexedDB, "open")
    const channelClose = vi.fn()
    const channelPostMessage = vi.fn()
    const createBroadcastChannel = vi.fn(
      (name: string) =>
        ({
          name,
          onmessage: null,
          onmessageerror: null,
          close: channelClose,
          postMessage: channelPostMessage,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as BroadcastChannel
    )
    const repositories: Array<{
      repository: DocumentDraftRepository
      close: ReturnType<typeof vi.spyOn>
      activeListeners: number
      unsubscribeCalls: number
    }> = []
    const createRepository = vi.fn(() => {
      const repository = new DocumentDraftRepository({
        databaseName,
        indexedDB: realIndexedDB,
        sessionId: `provider-repository-${repositories.length + 1}`,
        createBroadcastChannel,
      })
      const lifecycle = {
        repository,
        close: vi.spyOn(repository, "close"),
        activeListeners: 0,
        unsubscribeCalls: 0,
      }
      const originalSubscribe = repository.subscribe.bind(repository)
      vi.spyOn(repository, "subscribe").mockImplementation((listener) => {
        lifecycle.activeListeners += 1
        const unsubscribe = originalSubscribe(listener)
        let active = true
        return () => {
          if (!active) return
          active = false
          lifecycle.activeListeners -= 1
          lifecycle.unsubscribeCalls += 1
          unsubscribe()
        }
      })
      repositories.push(lifecycle)
      return repository
    })
    const migrate = vi.fn((repository: DocumentDraftRepository) =>
      migrateCurrentDraftToRepository({ repository })
    )
    const createRuntime = vi.fn(
      () => new StudioPersistenceRuntime({ createRepository, migrate })
    )
    const captured: { current: StudioPersistenceApi | null } = {
      current: null,
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <PersistenceConsumer
              capture={(persistence) => {
                captured.current = persistence
              }}
            />
          </StudioPersistenceProvider>
        </StrictMode>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.state.status).toBe("ready")
    })
    await act(async () => Promise.resolve())

    expect(createRuntime.mock.calls.length).toBeGreaterThan(1)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(createBroadcastChannel).toHaveBeenCalledTimes(1)
    expect(repositories).toHaveLength(1)
    expect(repositories[0]?.activeListeners).toBe(1)
    expect(repositories[0]?.unsubscribeCalls).toBe(0)
    expect(repositories[0]?.close).not.toHaveBeenCalled()
    expect(channelClose).not.toHaveBeenCalled()
    expect(channelPostMessage).not.toHaveBeenCalled()
    expect(captured.current?.repository).toBe(repositories[0]?.repository)

    const releaseChildLease = captured.current!.acquireLease()
    await act(async () => {
      root.unmount()
      rootUnmounted = true
      await Promise.resolve()
    })

    expect(repositories[0]?.activeListeners).toBe(0)
    expect(repositories[0]?.unsubscribeCalls).toBe(1)
    expect(repositories[0]?.close).not.toHaveBeenCalled()
    expect(channelClose).not.toHaveBeenCalled()
    expect(captured.current?.repository).toBe(repositories[0]?.repository)
    const openCallsBeforeFinalClose = indexedDbOpen.mock.calls.length

    releaseChildLease()
    expect(repositories[0]?.close).toHaveBeenCalledTimes(1)
    expect(channelClose).toHaveBeenCalledTimes(1)
    expect(channelPostMessage).not.toHaveBeenCalled()
    expect(() => captured.current?.repository).toThrow(
      "Studio persistence is closed."
    )
    expect(() => captured.current?.repository.open()).toThrow(
      "Studio persistence is closed."
    )
    expect(indexedDbOpen).toHaveBeenCalledTimes(openCallsBeforeFinalClose)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(createBroadcastChannel).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
  })

  it("projects an authoritative recovery completion through the context API", async () => {
    const recovery = {
      schemaVersion: 1 as const,
      sourceStorageKey: "webmcp-studio:current-draft:v1",
      capturedAt: "2026-08-29T00:10:00.000Z",
      failure: {
        kind: "malformed_json" as const,
        message: "The saved draft is not valid JSON.",
      },
      raw: "{broken",
    }
    const repository = new DocumentDraftRepository({
      indexedDB: {} as IDBFactory,
      sessionId: "provider-recovery-completion",
    })
    const repositorySubscribe = vi.spyOn(repository, "subscribe")
    const createRepository = vi.fn(() => repository)
    const migrate = vi.fn(async () => ({
      status: "recovery_required" as const,
      recovery,
      recoveryStored: true,
    }))
    const createRuntime = vi.fn(
      () => new StudioPersistenceRuntime({ createRepository, migrate })
    )
    const captured: { current: StudioPersistenceApi | null } = {
      current: null,
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <StudioPersistenceProvider createRuntime={createRuntime}>
            <PersistenceConsumer
              capture={(persistence) => {
                captured.current = persistence
              }}
            />
          </StudioPersistenceProvider>
        </StrictMode>
      )
    })
    await vi.waitFor(() => {
      expect(captured.current?.state.status).toBe("recovery_required")
    })

    const cleanupWarning =
      "The document was restored, but one legacy recovery key could not be removed."
    await act(async () => {
      captured.current?.completeRecovery(cleanupWarning)
    })
    await vi.waitFor(() => {
      expect(captured.current?.state).toEqual({
        status: "ready",
        migration: { status: "empty" },
        warning: cleanupWarning,
      })
    })
    const completedState = captured.current?.state

    await act(async () => {
      captured.current?.completeRecovery("Must remain idempotent")
    })
    expect(captured.current?.state).toBe(completedState)
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(repositorySubscribe).toHaveBeenCalledTimes(1)
  })
})
