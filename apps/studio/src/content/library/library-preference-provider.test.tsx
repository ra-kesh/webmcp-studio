// @vitest-environment jsdom

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
import type { LibraryPreferenceSnapshot } from "@webmcp/document"
import { LibraryPreferenceController } from "./library-preference-controller"
import type { LibraryPreferenceClient } from "./library-preference-client"
import {
  LibraryPreferenceProvider,
  useLibraryDiscoveryInvalidation,
  useLibraryPreferenceCommands,
  useLibraryPreferences,
} from "./library-preference-provider"
import type {
  LibraryPreferenceApi,
  LibraryPreferenceCommands,
  LibraryPreferenceControllerFactory,
} from "./library-preference-provider"

class ManualScheduler {
  readonly callbacks: Array<() => void> = []
  schedule = (callback: () => void) => this.callbacks.push(callback)
  flush() {
    while (this.callbacks.length > 0) this.callbacks.shift()?.()
  }
}

const snapshot: LibraryPreferenceSnapshot = {
  workspaceRevision: 1,
  preferences: [],
  collections: [],
}

const client: LibraryPreferenceClient = {
  readSnapshot: vi.fn(async () => ({
    value: snapshot,
    requestId: "request-library-1",
    etag: '"library-workspace-revision-1"',
  })),
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  setFavorite: vi.fn(),
  recordUsed: vi.fn(),
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addCollectionMember: vi.fn(),
  removeCollectionMember: vi.fn(),
  reorderCollectionMembers: vi.fn(),
}

const deferred = <TValue,>() => {
  let resolve!: (value: TValue) => void
  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function PreferenceProbe({
  capture,
}: {
  capture: (api: LibraryPreferenceApi) => void
}) {
  const api = useLibraryPreferences()
  useLayoutEffect(() => {
    capture(api)
  }, [api, capture])
  return null
}

function InvalidationOnlyProbe({ onRender }: { onRender: () => void }) {
  onRender()
  useLibraryDiscoveryInvalidation(() => undefined)
  return null
}

function CommandsOnlyProbe({
  capture,
  onRender,
}: {
  capture: (commands: LibraryPreferenceCommands) => void
  onRender: () => void
}) {
  onRender()
  const commands = useLibraryPreferenceCommands()
  useLayoutEffect(() => {
    capture(commands)
  }, [capture, commands])
  return null
}

describe("LibraryPreferenceProvider", () => {
  let host: HTMLDivElement
  let root: Root
  let unmounted: boolean

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    unmounted = false
  })

  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it("keeps lifecycle controls private", () => {
    expectTypeOf<LibraryPreferenceApi["commands"]>().not.toHaveProperty(
      "activate"
    )
    expectTypeOf<LibraryPreferenceApi["commands"]>().not.toHaveProperty(
      "dispose"
    )
  })

  it("creates one retained runtime through StrictMode and disposes it only after final unmount", async () => {
    const scheduler = new ManualScheduler()
    const controllers: Array<{
      controller: LibraryPreferenceController
      activate: ReturnType<typeof vi.spyOn>
      dispose: ReturnType<typeof vi.spyOn>
    }> = []
    const factory: LibraryPreferenceControllerFactory = (dependencies) => {
      const controller = new LibraryPreferenceController({
        ...dependencies,
        client,
      })
      controllers.push({
        controller,
        activate: vi.spyOn(controller, "activate"),
        dispose: vi.spyOn(controller, "dispose"),
      })
      return controller
    }
    const captured = { current: null as LibraryPreferenceApi | null }
    const onRender = vi.fn()

    await act(async () =>
      root.render(
        <StrictMode>
          <LibraryPreferenceProvider
            createController={factory}
            sessionId="session-provider"
            createIdempotencyKey={() => "mutation-provider-1"}
            scheduleFinalization={scheduler.schedule}
          >
            <PreferenceProbe capture={(api) => (captured.current = api)} />
            <InvalidationOnlyProbe onRender={onRender} />
          </LibraryPreferenceProvider>
        </StrictMode>
      )
    )
    await act(async () => scheduler.flush())

    expect(controllers).toHaveLength(2)
    const active = controllers.filter(
      ({ activate }) => activate.mock.calls.length > 0
    )
    expect(active).toHaveLength(1)
    expect(active[0]?.controller.getSnapshot().active).toBe(true)
    expect(active[0]?.dispose).not.toHaveBeenCalled()
    expect(captured.current?.state.snapshotStatus).toBe("ready")

    const rendersAfterReady = onRender.mock.calls.length
    await act(async () => active[0]?.controller.refresh())
    expect(onRender).toHaveBeenCalledTimes(rendersAfterReady)

    await act(async () => {
      root.unmount()
      unmounted = true
    })
    expect(active[0]?.dispose).not.toHaveBeenCalled()
    await act(async () => scheduler.flush())
    expect(active[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it("queues one authoritative follow-up when focus returns during an in-flight refresh", async () => {
    const first =
      deferred<Awaited<ReturnType<LibraryPreferenceClient["readSnapshot"]>>>()
    const readSnapshot = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        value: { ...snapshot, workspaceRevision: 2 },
        requestId: "request-library-2",
        etag: '"library-workspace-revision-2"',
      })
    const focusedClient = { ...client, readSnapshot }
    const factory: LibraryPreferenceControllerFactory = (dependencies) =>
      new LibraryPreferenceController({
        ...dependencies,
        client: focusedClient,
      })

    await act(async () =>
      root.render(
        <LibraryPreferenceProvider
          createController={factory}
          sessionId="session-focus"
        >
          <PreferenceProbe capture={() => undefined} />
        </LibraryPreferenceProvider>
      )
    )
    expect(readSnapshot).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    first.resolve({
      value: snapshot,
      requestId: "request-library-1",
      etag: '"library-workspace-revision-1"',
    })

    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledTimes(2))
  })

  it("queues one follow-up when public Refresh is used during an in-flight read", async () => {
    const first =
      deferred<Awaited<ReturnType<LibraryPreferenceClient["readSnapshot"]>>>()
    const readSnapshot = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        value: { ...snapshot, workspaceRevision: 2 },
        requestId: "request-library-2",
        etag: '"library-workspace-revision-2"',
      })
    const refreshClient = { ...client, readSnapshot }
    const factory: LibraryPreferenceControllerFactory = (dependencies) =>
      new LibraryPreferenceController({
        ...dependencies,
        client: refreshClient,
      })
    const captured = { current: null as LibraryPreferenceApi | null }

    await act(async () =>
      root.render(
        <LibraryPreferenceProvider
          createController={factory}
          sessionId="session-explicit-refresh"
        >
          <PreferenceProbe capture={(api) => (captured.current = api)} />
        </LibraryPreferenceProvider>
      )
    )
    expect(readSnapshot).toHaveBeenCalledTimes(1)

    const refresh = captured.current?.commands.refresh()
    first.resolve({
      value: snapshot,
      requestId: "request-library-1",
      etag: '"library-workspace-revision-1"',
    })
    await refresh

    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledTimes(2))
  })

  it("publishes stable commands without rerendering a document owner on preference changes", async () => {
    let controller: LibraryPreferenceController | null = null
    const factory: LibraryPreferenceControllerFactory = (dependencies) => {
      controller = new LibraryPreferenceController({ ...dependencies, client })
      return controller
    }
    const onRender = vi.fn()
    const captured = { current: null as LibraryPreferenceCommands | null }

    await act(async () =>
      root.render(
        <LibraryPreferenceProvider
          createController={factory}
          sessionId="session-commands-only"
        >
          <CommandsOnlyProbe
            capture={(commands) => (captured.current = commands)}
            onRender={onRender}
          />
        </LibraryPreferenceProvider>
      )
    )
    await vi.waitFor(() =>
      expect(controller?.getSnapshot().snapshotStatus).toBe("ready")
    )
    const rendersAfterReady = onRender.mock.calls.length

    await act(async () => controller?.refresh())

    expect(onRender).toHaveBeenCalledTimes(rendersAfterReady)
    expect(captured.current?.recordUsed).toBeTypeOf("function")
    expect(captured.current?.createCollectionResult).toBeTypeOf("function")
    expect(captured.current?.retryCreateCollectionResult).toBeTypeOf("function")
    expect(captured.current?.dismissCollectionDetailFailure).toBeTypeOf(
      "function"
    )
  })
})
