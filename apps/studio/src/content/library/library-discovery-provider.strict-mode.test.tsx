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
import { LibraryDiscoveryController } from "./discovery-controller"
import type { LibraryDiscoveryDependencies } from "./discovery-controller"
import {
  LibraryDiscoveryProvider,
  useLibraryDiscovery,
  useLibraryDiscoveryCommands,
  useLibraryDiscoveryLease,
} from "./library-discovery-provider"
import type {
  LibraryDiscoveryApi,
  LibraryDiscoveryControllerFactory,
} from "./library-discovery-provider"

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
  controller: LibraryDiscoveryController
  activate: ReturnType<typeof vi.spyOn>
  deactivate: ReturnType<typeof vi.spyOn>
  dispose: ReturnType<typeof vi.spyOn>
}>

const controllerFactoryHarness = () => {
  const controllers: ControllerLifecycle[] = []
  const factory: LibraryDiscoveryControllerFactory = (
    dependencies: LibraryDiscoveryDependencies
  ) => {
    const controller = new LibraryDiscoveryController(dependencies)
    controllers.push({
      controller,
      activate: vi.spyOn(controller, "activate"),
      deactivate: vi.spyOn(controller, "deactivate"),
      dispose: vi.spyOn(controller, "dispose"),
    })
    return controller
  }
  return { controllers, factory }
}

function DiscoveryProbe({
  capture,
  visible,
}: {
  capture?: (api: LibraryDiscoveryApi) => void
  visible: boolean
}) {
  const discovery = useLibraryDiscovery()
  useLibraryDiscoveryLease(visible)
  useLayoutEffect(() => capture?.(discovery), [capture, discovery])
  return null
}

function LeaseOnlyProbe({ onRender }: { onRender: () => void }) {
  onRender()
  useLibraryDiscoveryLease(true)
  return null
}

function CommandsOnlyProbe({ onRender }: { onRender: () => void }) {
  onRender()
  useLibraryDiscoveryCommands()
  return null
}

describe("LibraryDiscoveryProvider mounted lifecycle", () => {
  let host: HTMLDivElement
  let root: Root
  let rootUnmounted: boolean

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    rootUnmounted = false
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it("keeps lifecycle controls out of the public command contract", () => {
    expectTypeOf<LibraryDiscoveryApi["commands"]>().not.toHaveProperty(
      "activate"
    )
    expectTypeOf<LibraryDiscoveryApi["commands"]>().not.toHaveProperty(
      "deactivate"
    )
    expectTypeOf<LibraryDiscoveryApi["commands"]>().not.toHaveProperty(
      "dispose"
    )
  })

  it("retains one active controller through StrictMode and ignores hidden surfaces", async () => {
    const harness = controllerFactoryHarness()
    const finalization = new ManualFinalizationScheduler()
    const captured: { current: LibraryDiscoveryApi | null } = { current: null }
    const capture = (api: LibraryDiscoveryApi) => {
      captured.current = api
    }
    const render = (primaryVisible: boolean, hiddenVisible: boolean) =>
      root.render(
        <StrictMode>
          <LibraryDiscoveryProvider
            createController={harness.factory}
            scheduleFinalization={finalization.schedule}
          >
            <DiscoveryProbe capture={capture} visible={primaryVisible} />
            <DiscoveryProbe visible={hiddenVisible} />
          </LibraryDiscoveryProvider>
        </StrictMode>
      )

    await act(async () => render(true, false))
    await act(async () => finalization.flush())

    const activeControllers = harness.controllers.filter(
      ({ activate }) => activate.mock.calls.length > 0
    )
    expect(activeControllers).toHaveLength(1)
    const activeController = activeControllers[0]
    expect(activeController.activate).toHaveBeenCalledTimes(1)
    expect(activeController.deactivate).not.toHaveBeenCalled()
    expect(activeController.dispose).not.toHaveBeenCalled()
    expect(captured.current?.state.active).toBe(true)
    expect(captured.current?.commands).not.toHaveProperty("activate")
    expect(captured.current?.commands).not.toHaveProperty("deactivate")
    expect(captured.current?.commands).not.toHaveProperty("dispose")

    await act(async () => render(true, true))
    await act(async () => finalization.flush())
    expect(activeController.activate).toHaveBeenCalledTimes(1)
    expect(activeController.deactivate).not.toHaveBeenCalled()

    await act(async () => render(false, true))
    await act(async () => finalization.flush())
    expect(activeController.activate).toHaveBeenCalledTimes(1)
    expect(activeController.deactivate).not.toHaveBeenCalled()

    await act(async () => render(false, false))
    expect(activeController.deactivate).not.toHaveBeenCalled()
    await act(async () => finalization.flush())
    expect(activeController.deactivate).toHaveBeenCalledTimes(1)
    expect(captured.current?.state.active).toBe(false)

    await act(async () => render(true, false))
    expect(activeController.activate).toHaveBeenCalledTimes(2)
    expect(captured.current?.state.active).toBe(true)

    await act(async () => {
      root.unmount()
      rootUnmounted = true
    })
    expect(activeController.dispose).not.toHaveBeenCalled()
    await act(async () => finalization.flush())
    expect(activeController.dispose).toHaveBeenCalledTimes(1)
  })

  it("does not rerender a lease-only consumer when discovery state changes", async () => {
    const harness = controllerFactoryHarness()
    const finalization = new ManualFinalizationScheduler()
    const onRender = vi.fn()

    await act(async () =>
      root.render(
        <LibraryDiscoveryProvider
          createController={harness.factory}
          scheduleFinalization={finalization.schedule}
        >
          <LeaseOnlyProbe onRender={onRender} />
        </LibraryDiscoveryProvider>
      )
    )
    const rendersAfterMount = onRender.mock.calls.length
    const controller = harness.controllers[0].controller

    await act(async () => controller.setRawSearch("proposal"))
    expect(onRender).toHaveBeenCalledTimes(rendersAfterMount)
  })

  it("does not rerender a commands-only consumer when discovery state changes", async () => {
    const harness = controllerFactoryHarness()
    const onRender = vi.fn()

    await act(async () =>
      root.render(
        <LibraryDiscoveryProvider createController={harness.factory}>
          <CommandsOnlyProbe onRender={onRender} />
        </LibraryDiscoveryProvider>
      )
    )
    const rendersAfterMount = onRender.mock.calls.length
    const controller = harness.controllers[0].controller

    await act(async () => controller.setRawSearch("proposal"))
    expect(onRender).toHaveBeenCalledTimes(rendersAfterMount)
  })
})
