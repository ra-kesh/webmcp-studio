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
import type { LibraryMediaDetail, LibraryMediaSummary } from "@webmcp/document"
import { deviceLocalMediaDiscoveryAdapter } from "./device-local-media-discovery-adapter"
import type {
  DeviceLocalMediaDiscoveryAdapter,
  DeviceLocalMediaSelectionIdentity,
  ExactDeviceLocalMediaSelection,
} from "./device-local-media-discovery-adapter"
import { LibraryDiscoveryController } from "./discovery-controller"
import type {
  LibraryDiscoveryDependencies,
  LibraryDiscoveryFailure,
  LibraryDiscoveryFilters,
  LibraryDiscoveryState,
} from "./discovery-controller"
import type { LibraryDiscoveryControllerPort } from "./library-discovery-provider"
import { studioLibraryDiscoveryAdapter } from "./library-discovery-adapter"
import { useLibraryDiscoveryInvalidation } from "./library-preference-provider"
import {
  composeLibraryMediaDiscovery,
  DeviceLocalMediaOverlayController,
} from "./library-media-discovery"
import type {
  DeviceLocalMediaOverlayState,
  ExactDeviceLocalMediaPreview,
  LibraryMediaDiscoveryComposition,
} from "./library-media-discovery"

const scheduleBrowserQuery: LibraryDiscoveryDependencies["scheduleQuery"] = (
  callback,
  delayMs
) => {
  const timer = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timer)
}

type LibraryMediaDiscoveryFilterPatch = Partial<
  Omit<LibraryDiscoveryFilters, "itemKinds">
>

export type LibraryMediaDiscoveryScope = Readonly<{
  entryPoint: LibraryDiscoveryState["entryPoint"]
  ownerKinds: LibraryDiscoveryFilters["ownerKinds"]
  collectionId: string | null
}>

export type LibraryMediaExactDetailResult =
  | Readonly<{ status: "ready"; detail: LibraryMediaDetail }>
  | Readonly<{
      status: "failed"
      message: string
      requestId: string | null
    }>

type AtomicLibraryDiscoveryControllerPort = LibraryDiscoveryControllerPort &
  Pick<LibraryDiscoveryController, "setScope">

export type LibraryMediaDiscoveryControllerFactory = (
  dependencies: LibraryDiscoveryDependencies
) => AtomicLibraryDiscoveryControllerPort

export type LibraryMediaDiscoveryControllerPort = Omit<
  AtomicLibraryDiscoveryControllerPort,
  "setFilters" | "setScope" | "selectItem" | "retryDetail"
> &
  Readonly<{
    setFilters: (patch: LibraryMediaDiscoveryFilterPatch) => void
    setScope: (scope: LibraryMediaDiscoveryScope) => void
    selectItem: (
      id: string,
      version: number,
      mediaSource: Exclude<LibraryMediaSummary["mediaSource"], "local">
    ) => Promise<LibraryMediaExactDetailResult>
    retryDetail: () => Promise<LibraryMediaDetail | null>
  }>

export type LibraryMediaDiscoveryCommands = Readonly<{
  setRawSearch: (rawSearch: string) => void
  applySearch: () => void
  clearSearch: () => void
  setFilters: (patch: LibraryMediaDiscoveryFilterPatch) => void
  setScope: (scope: LibraryMediaDiscoveryScope) => void
  setOrder: (order: LibraryDiscoveryState["order"]) => void
  setEntryPoint: (entryPoint: LibraryDiscoveryState["entryPoint"]) => void
  refresh: () => Promise<void>
  retryReplacement: () => Promise<void>
  loadMore: () => Promise<void>
  selectItem: (
    id: string,
    version: number,
    mediaSource: Exclude<LibraryMediaSummary["mediaSource"], "local">
  ) => Promise<LibraryMediaExactDetailResult>
  retryDetail: () => Promise<LibraryMediaDetail | null>
  clearSelection: () => void
  clearAnnouncement: (id: number) => void
  clearFocusIntent: (id: number) => void
}>

const createCommands = (
  controller: LibraryMediaDiscoveryControllerPort
): LibraryMediaDiscoveryCommands => ({
  setRawSearch: (rawSearch) => controller.setRawSearch(rawSearch),
  applySearch: () => controller.applySearch(),
  clearSearch: () => controller.clearSearch(),
  setFilters: (patch) => controller.setFilters(patch),
  setScope: (scope) => controller.setScope(scope),
  setOrder: (order) => controller.setOrder(order),
  setEntryPoint: (entryPoint) => controller.setEntryPoint(entryPoint),
  refresh: () => controller.refresh(),
  retryReplacement: () => controller.retryReplacement(),
  loadMore: () => controller.loadMore(),
  selectItem: (id, version, mediaSource) =>
    controller.selectItem(id, version, mediaSource),
  retryDetail: () => controller.retryDetail(),
  clearSelection: () => controller.clearSelection(),
  clearAnnouncement: (id) => controller.clearAnnouncement(id),
  clearFocusIntent: (id) => controller.clearFocusIntent(id),
})

const failedExactDetail = (
  failure: LibraryDiscoveryFailure | null,
  fallback: string
): LibraryMediaExactDetailResult => ({
  status: "failed",
  message: failure?.message ?? fallback,
  requestId: failure?.requestId ?? null,
})

const mediaOnlyDependencies = (
  dependencies: LibraryDiscoveryDependencies
): LibraryDiscoveryDependencies => ({
  ...dependencies,
  async list(query, signal) {
    if (query.itemKinds?.length !== 1 || query.itemKinds[0] !== "media") {
      throw new Error("Media discovery requires an exact media-only query.")
    }
    const result = await dependencies.list(query, signal)
    if (
      result.page.items.some(
        (item) => item.itemKind !== "media" || item.mediaSource === "local"
      )
    ) {
      throw new Error("Media discovery returned a non-media catalog item.")
    }
    return result
  },
  async getDetail(identity, signal) {
    if (identity.itemKind !== "media") {
      throw new Error("Media discovery cannot load template details.")
    }
    if (identity.mediaSource === "local") {
      throw new Error("Server media discovery cannot load local details.")
    }
    const detail = await dependencies.getDetail(identity, signal)
    if (
      detail.summary.itemKind !== "media" ||
      detail.summary.mediaSource === "local"
    ) {
      throw new Error("Server media detail used an invalid source.")
    }
    return detail
  },
})

export function createMediaLibraryDiscoveryController(
  dependencies: LibraryDiscoveryDependencies,
  createController: LibraryMediaDiscoveryControllerFactory = (input) =>
    new LibraryDiscoveryController(input)
): LibraryMediaDiscoveryControllerPort {
  const controller = createController(mediaOnlyDependencies(dependencies))
  // This happens before any surface can retain/activate the controller. There
  // is therefore no transient mixed template+media request.
  controller.setFilters({ itemKinds: ["media"] })
  const itemKinds = controller.getSnapshot().filters.itemKinds
  if (itemKinds.length !== 1 || itemKinds[0] !== "media") {
    controller.dispose()
    throw new Error("Media discovery controller refused media-only scope.")
  }
  const setFilters = (patch: LibraryMediaDiscoveryFilterPatch) => {
    const { itemKinds: _ignored, ...safePatch } =
      patch as Partial<LibraryDiscoveryFilters>
    controller.setFilters({ ...safePatch, itemKinds: ["media"] })
  }
  const setScope = (scope: LibraryMediaDiscoveryScope) => {
    controller.setScope(
      {
        itemKinds: ["media"],
        ownerKinds: scope.ownerKinds,
        collectionId: scope.collectionId,
      },
      scope.entryPoint
    )
  }
  const selectItem = async (
    id: string,
    version: number,
    mediaSource: Exclude<LibraryMediaSummary["mediaSource"], "local">
  ): Promise<LibraryMediaExactDetailResult> => {
    const detail = (await controller.selectItem(
      "media",
      id,
      version,
      mediaSource
    )) as LibraryMediaDetail | null
    if (detail) return { status: "ready", detail }
    const settled = controller.getSnapshot().detail
    return failedExactDetail(
      settled.status === "failed" &&
        settled.itemKind === "media" &&
        settled.id === id &&
        settled.version === version &&
        settled.mediaSource === mediaSource
        ? settled.failure
        : null,
      "The exact media version could not be verified."
    )
  }
  return Object.freeze({
    getSnapshot: controller.getSnapshot,
    subscribe: controller.subscribe,
    activate: () => controller.activate(),
    deactivate: () => controller.deactivate(),
    dispose: () => controller.dispose(),
    setRawSearch: (rawSearch) => controller.setRawSearch(rawSearch),
    applySearch: () => controller.applySearch(),
    clearSearch: () => controller.clearSearch(),
    setFilters,
    setScope,
    setOrder: (order) => controller.setOrder(order),
    setEntryPoint: (entryPoint) => controller.setEntryPoint(entryPoint),
    refresh: () => controller.refresh(),
    retryReplacement: () => controller.retryReplacement(),
    loadMore: () => controller.loadMore(),
    selectItem,
    retryDetail: () =>
      controller.retryDetail() as Promise<LibraryMediaDetail | null>,
    clearSelection: () => controller.clearSelection(),
    clearAnnouncement: (id) => controller.clearAnnouncement(id),
    clearFocusIntent: (id) => controller.clearFocusIntent(id),
  })
}

export type LibraryMediaDiscoveryApi = Readonly<{
  state: LibraryDiscoveryState
  localState: DeviceLocalMediaOverlayState
  composition: LibraryMediaDiscoveryComposition
  commands: LibraryMediaDiscoveryCommands
  localCommands: Readonly<{
    refresh: () => Promise<void>
    selectItem: (
      assetId: string,
      revision: number
    ) => Promise<LibraryMediaExactDetailResult>
    recheckSelection: (
      identity: DeviceLocalMediaSelectionIdentity,
      signal?: AbortSignal
    ) => Promise<ExactDeviceLocalMediaSelection>
    loadPreview: (
      identity: DeviceLocalMediaSelectionIdentity,
      signal?: AbortSignal
    ) => Promise<ExactDeviceLocalMediaPreview>
    clearSelection: () => void
  }>
}>

type LibraryMediaDiscoveryLifecycle = Readonly<{
  retain: () => () => void
}>

type LibraryMediaDiscoveryContextValue = Readonly<{
  controller: LibraryMediaDiscoveryControllerPort
  overlay: DeviceLocalMediaOverlayController
  commands: LibraryMediaDiscoveryCommands
  localCommands: LibraryMediaDiscoveryApi["localCommands"]
  lifecycle: LibraryMediaDiscoveryLifecycle
}>

const LibraryMediaDiscoveryContext =
  createContext<LibraryMediaDiscoveryContextValue | null>(null)

export type LibraryMediaDiscoveryProviderProps = PropsWithChildren<{
  createController?: LibraryMediaDiscoveryControllerFactory
  localAdapter?: DeviceLocalMediaDiscoveryAdapter
  scheduleFinalization?: (callback: () => void) => void
}>

export function LibraryMediaDiscoveryProvider({
  children,
  createController,
  localAdapter = deviceLocalMediaDiscoveryAdapter,
  scheduleFinalization = queueMicrotask,
}: LibraryMediaDiscoveryProviderProps) {
  const [owners] = useState(() => {
    const controller = createMediaLibraryDiscoveryController(
      {
        ...studioLibraryDiscoveryAdapter,
        scheduleQuery: scheduleBrowserQuery,
      },
      createController
    )
    const overlay = new DeviceLocalMediaOverlayController(
      localAdapter,
      controller.getSnapshot().appliedQuery
    )
    return { controller, overlay }
  })
  const retainedSurfacesRef = useRef(0)
  const lifetimeGenerationRef = useRef(0)
  const finalizedRef = useRef(false)

  useEffect(() => {
    const unsubscribe = owners.controller.subscribe(() => {
      owners.overlay.setQuery(owners.controller.getSnapshot().appliedQuery)
    })
    return () => {
      unsubscribe()
    }
  }, [owners])

  const lifecycle = useMemo<LibraryMediaDiscoveryLifecycle>(
    () => ({
      retain: () => {
        if (finalizedRef.current) return () => undefined
        retainedSurfacesRef.current += 1
        if (retainedSurfacesRef.current === 1) {
          owners.overlay.setQuery(owners.controller.getSnapshot().appliedQuery)
          owners.controller.activate()
          owners.overlay.activate()
        }

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
            if (retainedSurfacesRef.current === 0) {
              owners.controller.deactivate()
              owners.overlay.deactivate()
            }
          })
        }
      },
    }),
    [owners, scheduleFinalization]
  )

  useEffect(() => {
    const generation = ++lifetimeGenerationRef.current
    return () => {
      scheduleFinalization(() => {
        if (
          generation !== lifetimeGenerationRef.current ||
          finalizedRef.current
        ) {
          return
        }
        finalizedRef.current = true
        retainedSurfacesRef.current = 0
        owners.controller.dispose()
        owners.overlay.dispose()
      })
    }
  }, [owners, scheduleFinalization])

  useLibraryDiscoveryInvalidation(() => {
    // The Gate 5 preference owner publishes one authority revision. Both the
    // template and media controllers may refresh independently; neither owns
    // or mutates the other's criteria.
    void owners.controller.refresh()
  })

  const commands = useMemo(
    () => createCommands(owners.controller),
    [owners.controller]
  )
  const localCommands = useMemo<LibraryMediaDiscoveryApi["localCommands"]>(
    () => ({
      refresh: () => owners.overlay.refresh(),
      selectItem: async (assetId, revision) => {
        const detail = await owners.overlay.selectItem(assetId, revision)
        if (detail) return { status: "ready" as const, detail }
        const settled = owners.overlay.getSnapshot().detail
        return {
          status: "failed" as const,
          message:
            settled.status === "failed" &&
            settled.assetId === assetId &&
            settled.revision === revision
              ? settled.failure.message
              : "The exact device-local media version could not be verified.",
          requestId: null,
        }
      },
      recheckSelection: (identity, signal) =>
        owners.overlay.recheckSelection(identity, signal),
      loadPreview: (identity, signal) =>
        owners.overlay.loadPreview(identity, signal),
      clearSelection: () => owners.overlay.clearSelection(),
    }),
    [owners.overlay]
  )
  const value = useMemo<LibraryMediaDiscoveryContextValue>(
    () => ({
      controller: owners.controller,
      overlay: owners.overlay,
      commands,
      localCommands,
      lifecycle,
    }),
    [commands, lifecycle, localCommands, owners]
  )

  return (
    <LibraryMediaDiscoveryContext.Provider value={value}>
      {children}
    </LibraryMediaDiscoveryContext.Provider>
  )
}

export function useLibraryMediaDiscovery(): LibraryMediaDiscoveryApi {
  const context = useContext(LibraryMediaDiscoveryContext)
  if (!context) {
    throw new Error(
      "useLibraryMediaDiscovery must be used within LibraryMediaDiscoveryProvider."
    )
  }
  const state = useSyncExternalStore(
    context.controller.subscribe,
    context.controller.getSnapshot,
    context.controller.getSnapshot
  )
  const localState = useSyncExternalStore(
    context.overlay.subscribe,
    context.overlay.getSnapshot,
    context.overlay.getSnapshot
  )
  const page = state.confirmedPage ?? state.retainedPage
  const local = localState.confirmed ?? localState.retained
  const composition = useMemo(
    () => composeLibraryMediaDiscovery(page, local),
    [local, page]
  )
  return useMemo(
    () => ({
      state,
      localState,
      composition,
      commands: context.commands,
      localCommands: context.localCommands,
    }),
    [composition, context.commands, context.localCommands, localState, state]
  )
}

export function useLibraryMediaDiscoveryLease(visible = true): void {
  const context = useContext(LibraryMediaDiscoveryContext)
  if (!context) {
    throw new Error(
      "useLibraryMediaDiscoveryLease must be used within LibraryMediaDiscoveryProvider."
    )
  }
  useEffect(() => {
    if (!visible) return
    return context.lifecycle.retain()
  }, [context.lifecycle, visible])
}
