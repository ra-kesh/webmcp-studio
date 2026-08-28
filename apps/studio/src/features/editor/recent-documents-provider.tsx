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
import { useStudioPersistence } from "../persistence/studio-persistence-provider"
import type { StudioPersistenceState } from "../persistence/studio-persistence-runtime"
import { RecentDocumentsController } from "./recent-documents-controller"
import type {
  DocumentsCollection,
  DocumentsView,
  RecentDocumentsDependencies,
  RecentDocumentsState,
} from "./recent-documents-controller"

export const RECENT_DOCUMENTS_VIEW_STORAGE_KEY =
  "webmcp-studio:documents-view:v1"

type PersistenceReadyState = Extract<
  StudioPersistenceState,
  { status: "ready" }
>

export type RecentDocumentsProviderState =
  | Readonly<{ status: "opening" }>
  | Extract<StudioPersistenceState, { status: "recovery_required" }>
  | Extract<StudioPersistenceState, { status: "blocked" }>
  | Extract<StudioPersistenceState, { status: "unavailable" }>
  | Readonly<{
      status: "ready"
      migration: PersistenceReadyState["migration"]
      warning: string | null
      library: RecentDocumentsState
    }>

export type RecentDocumentsControllerPort = Pick<
  RecentDocumentsController,
  | "getSnapshot"
  | "subscribe"
  | "activate"
  | "deactivate"
  | "dispose"
  | "setCollection"
  | "setQueryInput"
  | "applyQueryInput"
  | "clearQuery"
  | "restoreRouteState"
  | "setView"
  | "refresh"
  | "retry"
  | "loadMore"
  | "beginRename"
  | "updateRename"
  | "cancelAction"
  | "submitRename"
  | "duplicate"
  | "moveToTrash"
  | "restore"
  | "restoreUndo"
  | "dismissUndo"
  | "download"
  | "clearAnnouncement"
  | "clearFocusIntent"
>

export type RecentDocumentsControllerFactory = (
  dependencies: RecentDocumentsDependencies
) => RecentDocumentsControllerPort

export type RecentDocumentsCommands = Readonly<
  Pick<
    RecentDocumentsControllerPort,
    | "setCollection"
    | "setQueryInput"
    | "applyQueryInput"
    | "clearQuery"
    | "restoreRouteState"
    | "setView"
    | "refresh"
    | "retry"
    | "loadMore"
    | "beginRename"
    | "updateRename"
    | "cancelAction"
    | "submitRename"
    | "duplicate"
    | "moveToTrash"
    | "restore"
    | "restoreUndo"
    | "dismissUndo"
    | "download"
    | "clearAnnouncement"
    | "clearFocusIntent"
  >
>

export type RecentDocumentsApi = Readonly<{
  state: RecentDocumentsProviderState
  commands: RecentDocumentsCommands
}>

type RecentDocumentsLifecycle = Readonly<{
  setVisible: (visible: boolean) => void
}>

type RecentDocumentsContextValue = Readonly<{
  api: RecentDocumentsApi
  lifecycle: RecentDocumentsLifecycle
}>

const RecentDocumentsContext =
  createContext<RecentDocumentsContextValue | null>(null)

const scheduleBrowserQuery: RecentDocumentsDependencies["scheduleQuery"] = (
  callback,
  delayMs
) => {
  const timer = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timer)
}

const readViewPreference = (): DocumentsView => {
  if (typeof globalThis.localStorage === "undefined") return "grid"
  return globalThis.localStorage.getItem(RECENT_DOCUMENTS_VIEW_STORAGE_KEY) ===
    "list"
    ? "list"
    : "grid"
}

const writeViewPreference = (view: DocumentsView) => {
  if (typeof globalThis.localStorage === "undefined") return
  globalThis.localStorage.setItem(RECENT_DOCUMENTS_VIEW_STORAGE_KEY, view)
}

function createCommands(controller: RecentDocumentsControllerPort) {
  return {
    setCollection: (collection: DocumentsCollection) =>
      controller.setCollection(collection),
    setQueryInput: (query: string) => controller.setQueryInput(query),
    applyQueryInput: () => controller.applyQueryInput(),
    clearQuery: () => controller.clearQuery(),
    restoreRouteState: (collection: DocumentsCollection, query: string) =>
      controller.restoreRouteState(collection, query),
    setView: (view: DocumentsView) => controller.setView(view),
    refresh: () => controller.refresh(),
    retry: () => controller.retry(),
    loadMore: () => controller.loadMore(),
    beginRename: (documentId: string) => controller.beginRename(documentId),
    updateRename: (documentId: string, input: string) =>
      controller.updateRename(documentId, input),
    cancelAction: (documentId: string) => controller.cancelAction(documentId),
    submitRename: (documentId: string) => controller.submitRename(documentId),
    duplicate: (documentId: string) => controller.duplicate(documentId),
    moveToTrash: (documentId: string) => controller.moveToTrash(documentId),
    restore: (documentId: string) => controller.restore(documentId),
    restoreUndo: () => controller.restoreUndo(),
    dismissUndo: () => controller.dismissUndo(),
    download: (documentId: string) => controller.download(documentId),
    clearAnnouncement: (id: number) => controller.clearAnnouncement(id),
    clearFocusIntent: (id: number) => controller.clearFocusIntent(id),
  } as const
}

function projectProviderState(
  persistence: StudioPersistenceState,
  library: RecentDocumentsState
): RecentDocumentsProviderState {
  switch (persistence.status) {
    case "opening":
      return { status: "opening" }
    case "recovery_required":
      return persistence
    case "blocked":
      return persistence
    case "unavailable":
      return persistence
    case "ready":
      return {
        status: "ready",
        migration: persistence.migration,
        warning: persistence.warning,
        library,
      }
  }
}

export type RecentDocumentsProviderProps = PropsWithChildren<{
  createController?: RecentDocumentsControllerFactory
  scheduleFinalization?: (callback: () => void) => void
}>

export function RecentDocumentsProvider({
  children,
  createController = (dependencies) =>
    new RecentDocumentsController(dependencies),
  scheduleFinalization = queueMicrotask,
}: RecentDocumentsProviderProps) {
  const persistence = useStudioPersistence()
  const persistenceRef = useRef(persistence)
  persistenceRef.current = persistence

  const [controller] = useState<RecentDocumentsControllerPort>(() =>
    createController({
      list: (options) => persistenceRef.current.repository.list(options),
      rename: (documentId, expectedRecordVersion, name) =>
        persistenceRef.current.repository.rename(
          documentId,
          expectedRecordVersion,
          name
        ),
      duplicate: (documentId) =>
        persistenceRef.current.repository.duplicate(documentId),
      softDelete: (documentId, expectedRecordVersion) =>
        persistenceRef.current.repository.softDelete(
          documentId,
          expectedRecordVersion
        ),
      restore: (documentId, expectedRecordVersion) =>
        persistenceRef.current.repository.restore(
          documentId,
          expectedRecordVersion
        ),
      getForDownload: (documentId) =>
        persistenceRef.current.repository.get(documentId),
      subscribe: (listener) =>
        persistenceRef.current.subscribeRepositoryEvents(listener),
      scheduleQuery: scheduleBrowserQuery,
      readViewPreference,
      writeViewPreference,
    })
  )
  const library = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const leaseReleaseRef = useRef<(() => void) | null>(null)
  const desiredVisibilityRef = useRef(false)
  const persistenceReadyRef = useRef(false)
  persistenceReadyRef.current = persistence.state.status === "ready"
  const lifetimeGenerationRef = useRef(0)
  const finalizedRef = useRef(false)

  const lifecycle = useMemo<RecentDocumentsLifecycle>(
    () => ({
      setVisible: (visible) => {
        desiredVisibilityRef.current = visible
        if (
          visible &&
          persistenceReadyRef.current &&
          leaseReleaseRef.current &&
          !finalizedRef.current
        ) {
          controller.activate()
          return
        }
        controller.deactivate()
      },
    }),
    [controller]
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
        desiredVisibilityRef.current = false
        controller.dispose()
        const release = leaseReleaseRef.current
        leaseReleaseRef.current = null
        release?.()
      })
    }
  }, [controller, scheduleFinalization])

  useEffect(() => {
    if (
      persistence.state.status !== "ready" ||
      leaseReleaseRef.current ||
      finalizedRef.current
    )
      return
    leaseReleaseRef.current = persistenceRef.current.acquireLease()
    if (desiredVisibilityRef.current) controller.activate()
  }, [controller, persistence.state.status])

  useEffect(() => {
    if (persistence.state.status !== "ready") controller.deactivate()
  }, [controller, persistence.state.status])

  const commands = useMemo(() => createCommands(controller), [controller])
  const state = useMemo(
    () => projectProviderState(persistence.state, library),
    [library, persistence.state]
  )
  const api = useMemo<RecentDocumentsApi>(
    () => ({ state, commands }),
    [commands, state]
  )
  const contextValue = useMemo<RecentDocumentsContextValue>(
    () => ({ api, lifecycle }),
    [api, lifecycle]
  )

  return (
    <RecentDocumentsContext.Provider value={contextValue}>
      {children}
    </RecentDocumentsContext.Provider>
  )
}

export function useRecentDocuments(): RecentDocumentsApi {
  const context = useContext(RecentDocumentsContext)
  if (!context) {
    throw new Error(
      "useRecentDocuments must be used within RecentDocumentsProvider."
    )
  }
  return context.api
}

/**
 * Call unconditionally from the retained Studio shell. The provider decides
 * whether persistence is ready before it starts repository work.
 */
export function useRecentDocumentsVisibility(libraryVisible: boolean): void {
  const context = useContext(RecentDocumentsContext)
  if (!context) {
    throw new Error(
      "useRecentDocumentsVisibility must be used within RecentDocumentsProvider."
    )
  }
  const active = libraryVisible && context.api.state.status === "ready"

  useEffect(() => {
    context.lifecycle.setVisible(active)
    return () => context.lifecycle.setVisible(false)
  }, [active, context.lifecycle])
}
