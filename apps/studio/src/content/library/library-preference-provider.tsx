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
  LibraryCollectionDetail,
  LibraryItemIdentity,
} from "@webmcp/document"
import { LibraryPreferenceController } from "./library-preference-controller"
import type {
  LibraryInvalidationChannel,
  LibraryPreferenceControllerDependencies,
  LibraryPreferenceStateOwner,
} from "./library-preference-controller"
import { createLibraryPreferenceClient } from "./library-preference-client"
import type { LibraryPreferenceFetch } from "./library-preference-client"

export type LibraryPreferenceControllerPort = Pick<
  LibraryPreferenceController,
  | "getSnapshot"
  | "subscribe"
  | "subscribeDiscoveryInvalidation"
  | "activate"
  | "deactivate"
  | "dispose"
  | "refresh"
  | "refreshAfterCurrent"
  | "loadCollection"
  | "retryCollectionDetail"
  | "setFavorite"
  | "recordUsed"
  | "createCollection"
  | "renameCollection"
  | "deleteCollection"
  | "addCollectionMember"
  | "removeCollectionMember"
  | "reorderCollectionMembers"
  | "retry"
  | "dismissFailure"
>

export type LibraryPreferenceControllerFactory = (
  dependencies: LibraryPreferenceControllerDependencies
) => LibraryPreferenceControllerPort

export type LibraryPreferenceCommands = Readonly<{
  refresh: () => Promise<void>
  loadCollection: (
    collectionId: string
  ) => Promise<LibraryCollectionDetail | null>
  retryCollectionDetail: (
    collectionId: string
  ) => Promise<LibraryCollectionDetail | null>
  setFavorite: (
    identity: LibraryItemIdentity,
    itemName: string,
    favorite: boolean
  ) => Promise<boolean>
  recordUsed: (
    identity: LibraryItemIdentity,
    itemName: string,
    completedAction: "create" | "insert" | "replace",
    completionId: string
  ) => Promise<boolean>
  createCollection: (name: string) => Promise<boolean>
  renameCollection: (collectionId: string, name: string) => Promise<boolean>
  deleteCollection: (collectionId: string) => Promise<boolean>
  addCollectionMember: (
    collectionId: string,
    identity: LibraryItemIdentity,
    itemName: string
  ) => Promise<boolean>
  removeCollectionMember: (
    collectionId: string,
    identity: LibraryItemIdentity,
    itemName: string
  ) => Promise<boolean>
  reorderCollectionMembers: (
    collectionId: string,
    orderedIdentities: readonly LibraryItemIdentity[]
  ) => Promise<boolean>
  retry: (key: string) => Promise<boolean>
  dismissFailure: (key: string) => void
}>

export type LibraryPreferenceApi = Readonly<{
  state: LibraryPreferenceStateOwner
  commands: LibraryPreferenceCommands
}>

type LibraryPreferenceStableContext = Readonly<{
  controller: LibraryPreferenceControllerPort
  commands: LibraryPreferenceCommands
}>

const LibraryPreferenceContext =
  createContext<LibraryPreferenceStableContext | null>(null)

const createCommands = (
  controller: LibraryPreferenceControllerPort
): LibraryPreferenceCommands => ({
  refresh: () => controller.refreshAfterCurrent(),
  loadCollection: (collectionId) => controller.loadCollection(collectionId),
  retryCollectionDetail: (collectionId) =>
    controller.retryCollectionDetail(collectionId),
  setFavorite: (identity, itemName, favorite) =>
    controller.setFavorite(identity, itemName, favorite),
  recordUsed: (identity, itemName, completedAction, completionId) =>
    controller.recordUsed(identity, itemName, completedAction, completionId),
  createCollection: (name) => controller.createCollection(name),
  renameCollection: (collectionId, name) =>
    controller.renameCollection(collectionId, name),
  deleteCollection: (collectionId) => controller.deleteCollection(collectionId),
  addCollectionMember: (collectionId, identity, itemName) =>
    controller.addCollectionMember(collectionId, identity, itemName),
  removeCollectionMember: (collectionId, identity, itemName) =>
    controller.removeCollectionMember(collectionId, identity, itemName),
  reorderCollectionMembers: (collectionId, orderedIdentities) =>
    controller.reorderCollectionMembers(collectionId, orderedIdentities),
  retry: (key) => controller.retry(key),
  dismissFailure: (key) => controller.dismissFailure(key),
})

const defaultChannelFactory = (name: string) =>
  typeof window !== "undefined" && "BroadcastChannel" in globalThis
    ? (new BroadcastChannel(name) as LibraryInvalidationChannel)
    : null

export type LibraryPreferenceProviderProps = PropsWithChildren<{
  createController?: LibraryPreferenceControllerFactory
  fetchRequest?: LibraryPreferenceFetch
  createInvalidationChannel?: (
    name: string
  ) => LibraryInvalidationChannel | null
  createIdempotencyKey?: () => string
  sessionId?: string
  scheduleInvalidation?: (callback: () => void) => void
  scheduleFinalization?: (callback: () => void) => void
}>

export function LibraryPreferenceProvider({
  children,
  createController = (dependencies) =>
    new LibraryPreferenceController(dependencies),
  fetchRequest = (input, init) => globalThis.fetch(input, init),
  createInvalidationChannel = defaultChannelFactory,
  createIdempotencyKey = () => crypto.randomUUID(),
  sessionId,
  scheduleInvalidation = queueMicrotask,
  scheduleFinalization = queueMicrotask,
}: LibraryPreferenceProviderProps) {
  const dependenciesRef = useRef({
    fetchRequest,
    createInvalidationChannel,
    createIdempotencyKey,
    sessionId: sessionId ?? `session-${crypto.randomUUID()}`,
    scheduleInvalidation,
  })
  const [controller] = useState<LibraryPreferenceControllerPort>(() =>
    createController({
      client: createLibraryPreferenceClient(
        dependenciesRef.current.fetchRequest
      ),
      sessionId: dependenciesRef.current.sessionId,
      createIdempotencyKey: dependenciesRef.current.createIdempotencyKey,
      createInvalidationChannel:
        dependenciesRef.current.createInvalidationChannel,
      scheduleInvalidation: dependenciesRef.current.scheduleInvalidation,
    })
  )
  const lifetimeGenerationRef = useRef(0)
  const finalizedRef = useRef(false)

  useEffect(() => {
    const generation = ++lifetimeGenerationRef.current
    controller.activate()
    return () => {
      scheduleFinalization(() => {
        if (
          generation !== lifetimeGenerationRef.current ||
          finalizedRef.current
        )
          return
        finalizedRef.current = true
        controller.dispose()
      })
    }
  }, [controller, scheduleFinalization])

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return
    const refresh = () => {
      void controller.refreshAfterCurrent()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [controller])

  const commands = useMemo(() => createCommands(controller), [controller])
  const contextValue = useMemo(
    () => ({ controller, commands }),
    [commands, controller]
  )

  return (
    <LibraryPreferenceContext.Provider value={contextValue}>
      {children}
    </LibraryPreferenceContext.Provider>
  )
}

export function useLibraryPreferences(): LibraryPreferenceApi {
  const context = useContext(LibraryPreferenceContext)
  if (!context) {
    throw new Error(
      "useLibraryPreferences must be used within LibraryPreferenceProvider."
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
 * Subscribe the discovery owner to authoritative preference revisions without
 * making it a consumer of preference state or editor-document state.
 */
export function useLibraryDiscoveryInvalidation(
  listener: (workspaceRevision: number) => void
): void {
  const context = useContext(LibraryPreferenceContext)
  if (!context) {
    throw new Error(
      "useLibraryDiscoveryInvalidation must be used within LibraryPreferenceProvider."
    )
  }
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(
    () =>
      context.controller.subscribeDiscoveryInvalidation((revision) =>
        listenerRef.current(revision)
      ),
    [context.controller]
  )
}
