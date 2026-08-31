import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { PropsWithChildren } from "react"
import type {
  LibraryCatalogItemDetail,
  LibraryMediaSummary,
} from "@webmcp/document"
import { LibraryDiscoveryController } from "./discovery-controller"
import type {
  LibraryDiscoveryDependencies,
  LibraryDiscoveryEntryPoint,
  LibraryDiscoveryFilters,
  LibraryDiscoveryState,
} from "./discovery-controller"
import { studioLibraryDiscoveryAdapter } from "./library-discovery-adapter"

export type LibraryDiscoveryControllerPort = Pick<
  LibraryDiscoveryController,
  | "getSnapshot"
  | "subscribe"
  | "activate"
  | "deactivate"
  | "dispose"
  | "setRawSearch"
  | "applySearch"
  | "clearSearch"
  | "setFilters"
  | "setOrder"
  | "setEntryPoint"
  | "refresh"
  | "retryReplacement"
  | "loadMore"
  | "selectItem"
  | "retryDetail"
  | "clearSelection"
  | "clearAnnouncement"
  | "clearFocusIntent"
>

export type LibraryDiscoveryControllerFactory = (
  dependencies: LibraryDiscoveryDependencies
) => LibraryDiscoveryControllerPort

export type LibraryDiscoveryCommands = Readonly<{
  setRawSearch: (rawSearch: string) => void
  applySearch: () => void
  clearSearch: () => void
  setFilters: (patch: Partial<LibraryDiscoveryFilters>) => void
  setOrder: (order: LibraryDiscoveryState["order"]) => void
  setEntryPoint: (entryPoint: LibraryDiscoveryEntryPoint) => void
  refresh: () => Promise<void>
  retryReplacement: () => Promise<void>
  loadMore: () => Promise<void>
  selectItem: (
    kind: "template" | "media",
    id: string,
    version: number,
    mediaSource?: LibraryMediaSummary["mediaSource"]
  ) => Promise<LibraryCatalogItemDetail | null>
  retryDetail: () => Promise<LibraryCatalogItemDetail | null>
  clearSelection: () => void
  clearAnnouncement: (id: number) => void
  clearFocusIntent: (id: number) => void
}>

export type LibraryDiscoveryApi = Readonly<{
  state: LibraryDiscoveryState
  commands: LibraryDiscoveryCommands
}>

type LibraryDiscoveryLifecycle = Readonly<{
  retain: () => () => void
}>

type LibraryDiscoveryStableContext = Readonly<{
  controller: LibraryDiscoveryControllerPort
  commands: LibraryDiscoveryCommands
  lifecycle: LibraryDiscoveryLifecycle
}>
const LibraryDiscoveryStableContext =
  createContext<LibraryDiscoveryStableContext | null>(null)

const scheduleBrowserQuery: LibraryDiscoveryDependencies["scheduleQuery"] = (
  callback,
  delayMs
) => {
  const timer = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timer)
}

const createCommands = (
  controller: LibraryDiscoveryControllerPort
): LibraryDiscoveryCommands => ({
  setRawSearch: (rawSearch) => controller.setRawSearch(rawSearch),
  applySearch: () => controller.applySearch(),
  clearSearch: () => controller.clearSearch(),
  setFilters: (patch) => controller.setFilters(patch),
  setOrder: (order) => controller.setOrder(order),
  setEntryPoint: (entryPoint) => controller.setEntryPoint(entryPoint),
  refresh: () => controller.refresh(),
  retryReplacement: () => controller.retryReplacement(),
  loadMore: () => controller.loadMore(),
  selectItem: (kind, id, version, mediaSource) =>
    controller.selectItem(
      kind,
      id,
      version,
      kind === "media" ? mediaSource : {}
    ),
  retryDetail: () => controller.retryDetail(),
  clearSelection: () => controller.clearSelection(),
  clearAnnouncement: (id) => controller.clearAnnouncement(id),
  clearFocusIntent: (id) => controller.clearFocusIntent(id),
})

export type LibraryDiscoveryProviderProps = PropsWithChildren<{
  createController?: LibraryDiscoveryControllerFactory
  scheduleFinalization?: (callback: () => void) => void
}>

export function LibraryDiscoveryProvider({
  children,
  createController = (dependencies) =>
    new LibraryDiscoveryController(dependencies),
  scheduleFinalization = queueMicrotask,
}: LibraryDiscoveryProviderProps) {
  const [controller] = useState<LibraryDiscoveryControllerPort>(() =>
    createController({
      ...studioLibraryDiscoveryAdapter,
      scheduleQuery: scheduleBrowserQuery,
    })
  )
  const retainedSurfacesRef = useRef(0)
  const lifetimeGenerationRef = useRef(0)
  const finalizedRef = useRef(false)

  const lifecycle = useMemo<LibraryDiscoveryLifecycle>(
    () => ({
      retain: () => {
        if (finalizedRef.current) return () => undefined
        retainedSurfacesRef.current += 1
        if (retainedSurfacesRef.current === 1) controller.activate()

        let released = false
        return () => {
          if (released) return
          released = true
          scheduleFinalization(() => {
            if (finalizedRef.current) return
            retainedSurfacesRef.current = Math.max(
              0,
              retainedSurfacesRef.current - 1
            )
            if (retainedSurfacesRef.current === 0) controller.deactivate()
          })
        }
      },
    }),
    [controller, scheduleFinalization]
  )

  useEffect(() => {
    const generation = ++lifetimeGenerationRef.current
    return () => {
      scheduleFinalization(() => {
        if (
          generation !== lifetimeGenerationRef.current ||
          finalizedRef.current
        )
          return
        finalizedRef.current = true
        retainedSurfacesRef.current = 0
        controller.dispose()
      })
    }
  }, [controller, scheduleFinalization])

  const commands = useMemo(() => createCommands(controller), [controller])
  const contextValue = useMemo<LibraryDiscoveryStableContext>(
    () => ({ controller, commands, lifecycle }),
    [commands, controller, lifecycle]
  )

  return (
    <LibraryDiscoveryStableContext.Provider value={contextValue}>
      {children}
    </LibraryDiscoveryStableContext.Provider>
  )
}

export function useLibraryDiscovery(): LibraryDiscoveryApi {
  const context = useContext(LibraryDiscoveryStableContext)
  if (!context) {
    throw new Error(
      "useLibraryDiscovery must be used within LibraryDiscoveryProvider."
    )
  }
  const state = useSyncExternalStore(
    context.controller.subscribe,
    context.controller.getSnapshot,
    context.controller.getSnapshot
  )
  return useMemo(
    () => ({ state, commands: context.commands }),
    [context.commands, state]
  )
}

/**
 * Read the stable discovery commands without subscribing to discovery state.
 * Route-owned coordination uses this narrow hook so catalog updates do not
 * rerender the coordinator or any editor owner.
 */
export function useLibraryDiscoveryCommands(): LibraryDiscoveryCommands {
  const context = useContext(LibraryDiscoveryStableContext)
  if (!context) {
    throw new Error(
      "useLibraryDiscoveryCommands must be used within LibraryDiscoveryProvider."
    )
  }
  return context.commands
}

/**
 * Retain the route-owned discovery controller while this surface is visible.
 * Call the hook unconditionally and pass the surface's actual visibility.
 */
export function useLibraryDiscoveryLease(visible = true): void {
  const context = useContext(LibraryDiscoveryStableContext)
  if (!context) {
    throw new Error(
      "useLibraryDiscoveryLease must be used within LibraryDiscoveryProvider."
    )
  }

  useEffect(() => {
    if (!visible) return
    return context.lifecycle.retain()
  }, [context.lifecycle, visible])
}
