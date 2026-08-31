import { z } from "zod"
import {
  libraryCollectionDetailSchema,
  libraryCollectionIdSchema,
  libraryCollectionNameSchema,
  libraryItemIdentitySchema,
  libraryPreferenceSnapshotSchema,
} from "@webmcp/document"
import type {
  LibraryCollectionDetail,
  LibraryCollectionMutationReceipt,
  LibraryCollectionSummary,
  LibraryItemIdentity,
  LibraryPreferenceMutationReceipt,
  LibraryPreferenceSnapshot,
  LibraryPreferenceState,
} from "@webmcp/document"
import { LibraryPreferenceHttpError } from "./library-preference-client"
import type { LibraryPreferenceClient } from "./library-preference-client"

const invalidationHintSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("library-invalidated"),
    workspaceRevision: z.number().int().nonnegative(),
    sourceSessionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict()

export type LibraryInvalidationHint = z.infer<typeof invalidationHintSchema>

export type LibraryInvalidationChannel = Readonly<{
  postMessage: (message: LibraryInvalidationHint) => void
  close: () => void
}> & {
  onmessage: ((message: MessageEvent<unknown>) => void) | null
}

export type LibraryPreferenceAction =
  | "refresh"
  | "load_collection"
  | "set_favorite"
  | "record_used"
  | "create_collection"
  | "rename_collection"
  | "delete_collection"
  | "add_collection_member"
  | "remove_collection_member"
  | "reorder_collection_members"

export type LibraryPreferencePending = Readonly<{
  key: string
  action: LibraryPreferenceAction
  phase: "mutating" | "reconciling"
  itemIdentity: LibraryItemIdentity | null
  collectionId: string | null
  idempotencyKey: string
  optimisticFavorite: boolean | null
}>

export type LibraryPreferenceFailure = Readonly<{
  key: string
  action: LibraryPreferenceAction
  message: string
  code: string
  status: number
  requestId: string | null
  retryable: boolean
  retryMode: "same_key" | "new_key" | "refresh" | null
  commitStatus: "known" | "unknown"
}>

export type LibraryCollectionDetailState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "loading"
      retained: LibraryCollectionDetail | null
    }>
  | Readonly<{ status: "ready"; detail: LibraryCollectionDetail }>
  | Readonly<{
      status: "failed"
      retained: LibraryCollectionDetail | null
      failure: LibraryPreferenceFailure
    }>

export type LibraryPreferenceStateOwner = Readonly<{
  active: boolean
  disposed: boolean
  snapshotStatus: "idle" | "loading" | "ready" | "failed"
  snapshot: LibraryPreferenceSnapshot | null
  snapshotFailure: LibraryPreferenceFailure | null
  pending: ReadonlyMap<string, LibraryPreferencePending>
  failures: ReadonlyMap<string, LibraryPreferenceFailure>
  collectionDetails: ReadonlyMap<string, LibraryCollectionDetailState>
  discoveryInvalidationRevision: number
}>

export type LibraryPreferenceControllerDependencies = Readonly<{
  client: LibraryPreferenceClient
  sessionId: string
  createIdempotencyKey: () => string
  createInvalidationChannel?: (
    name: string
  ) => LibraryInvalidationChannel | null
  scheduleInvalidation?: (callback: () => void) => void
}>

type Listener = () => void

type FavoriteCommand = Readonly<{
  action: "set_favorite"
  key: string
  identity: LibraryItemIdentity
  itemName: string
  favorite: boolean
  expectedRevision: number
  idempotencyKey: string
}>

type RecordUsedCommand = Readonly<{
  action: "record_used"
  key: string
  identity: LibraryItemIdentity
  itemName: string
  completedAction: "create" | "insert" | "replace"
  completionId: string
  idempotencyKey: string
}>

type CollectionCommand = Readonly<{
  action:
    | "create_collection"
    | "rename_collection"
    | "delete_collection"
    | "add_collection_member"
    | "remove_collection_member"
    | "reorder_collection_members"
  key: string
  collectionId: string | null
  collectionName: string
  name?: string
  identity?: LibraryItemIdentity
  itemName?: string
  orderedIdentities?: readonly LibraryItemIdentity[]
  expectedRevision?: number
  idempotencyKey: string
}>

type PreferenceCommand = FavoriteCommand | RecordUsedCommand | CollectionCommand

type Attempt = Readonly<{
  token: number
  lifetime: number
  workspaceRevisionAtDispatch: number
  command: PreferenceCommand
}>

type RetryRecord = Readonly<{
  command: PreferenceCommand
  mode: "same_key" | "new_key"
}>

type CollectionDetailRequest = Readonly<{
  token: number
  lifetime: number
  collectionId: string
  controller: AbortController
  promise: Promise<LibraryCollectionDetail | null>
}>

const identityKey = (identity: LibraryItemIdentity) =>
  `${identity.itemKind}:${identity.id}@${identity.version}`

const identitiesEqual = (
  left: readonly LibraryItemIdentity[],
  right: readonly LibraryItemIdentity[]
) =>
  left.length === right.length &&
  left.every((identity, index) =>
    right[index] ? identityKey(identity) === identityKey(right[index]) : false
  )

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const cloneMap = <TKey, TValue>(map: ReadonlyMap<TKey, TValue>) => new Map(map)

const preferenceFor = (
  snapshot: LibraryPreferenceSnapshot | null,
  identity: LibraryItemIdentity
) =>
  snapshot?.preferences.find(
    ({ identity: candidate }) =>
      identityKey(candidate) === identityKey(identity)
  ) ?? null

export const selectLibraryPreference = (
  state: LibraryPreferenceStateOwner,
  identity: LibraryItemIdentity
): LibraryPreferenceState | null => preferenceFor(state.snapshot, identity)

const collectionFor = (
  snapshot: LibraryPreferenceSnapshot | null,
  collectionId: string
) => snapshot?.collections.find(({ id }) => id === collectionId) ?? null

const mergePreference = (
  snapshot: LibraryPreferenceSnapshot,
  preference: LibraryPreferenceState,
  workspaceRevision: number
) => {
  const key = identityKey(preference.identity)
  const preferences = snapshot.preferences.filter(
    ({ identity }) => identityKey(identity) !== key
  )
  preferences.push(preference)
  return libraryPreferenceSnapshotSchema.parse({
    ...snapshot,
    workspaceRevision,
    preferences,
  })
}

const mergeCollection = (
  snapshot: LibraryPreferenceSnapshot,
  collection: LibraryCollectionSummary,
  workspaceRevision: number
) => {
  const collections = snapshot.collections.filter(
    ({ id }) => id !== collection.id
  )
  collections.push(collection)
  return libraryPreferenceSnapshotSchema.parse({
    ...snapshot,
    workspaceRevision,
    collections,
  })
}

const mergeCollectionMembership = (
  snapshot: LibraryPreferenceSnapshot,
  receipt: Extract<
    LibraryCollectionMutationReceipt,
    { operation: "add_collection_member" | "remove_collection_member" }
  >
) => {
  const current = preferenceFor(snapshot, receipt.identity)
  const collectionId = receipt.collection.summary.id
  const collectionIds =
    receipt.operation === "add_collection_member"
      ? [...new Set([...(current?.collectionIds ?? []), collectionId])]
      : (current?.collectionIds ?? []).filter(
          (candidate) => candidate !== collectionId
        )
  return mergePreference(
    snapshot,
    {
      identity: receipt.identity,
      favorite: current?.favorite ?? false,
      lastUsedAt: current?.lastUsedAt ?? null,
      collectionIds,
      revision: current?.revision ?? 0,
      updatedAt: current?.updatedAt ?? receipt.collection.summary.updatedAt,
    },
    receipt.workspaceRevision
  )
}

const deleteCollection = (
  snapshot: LibraryPreferenceSnapshot,
  collectionId: string,
  workspaceRevision: number
) =>
  libraryPreferenceSnapshotSchema.parse({
    ...snapshot,
    workspaceRevision,
    collections: snapshot.collections.filter(({ id }) => id !== collectionId),
    preferences: snapshot.preferences.map((preference) => ({
      ...preference,
      collectionIds: preference.collectionIds.filter(
        (candidate) => candidate !== collectionId
      ),
    })),
  })

const failureFrom = (
  key: string,
  action: LibraryPreferenceAction,
  message: string,
  error: unknown
): LibraryPreferenceFailure => {
  if (error instanceof LibraryPreferenceHttpError) {
    return {
      key,
      action,
      message,
      code: error.code,
      status: error.status,
      requestId: error.requestId,
      retryable: error.retryable,
      retryMode: null,
      commitStatus: error.commitStatus,
    }
  }
  return {
    key,
    action,
    message,
    code: "library_request_failed",
    status: 0,
    requestId: null,
    retryable: true,
    retryMode: null,
    commitStatus: "unknown",
  }
}

const snapshotFailure = (error: unknown): LibraryPreferenceFailure => ({
  ...failureFrom(
    "snapshot",
    "refresh",
    "Studio couldn't refresh library preferences.",
    error
  ),
  retryable: true,
  retryMode: "refresh",
})

const failedMessage = (command: PreferenceCommand) => {
  switch (command.action) {
    case "set_favorite":
      return `Couldn't ${command.favorite ? "add" : "remove"} ${command.itemName} ${command.favorite ? "to" : "from"} Favorites`
    case "record_used":
      return `${command.itemName} was used, but Studio couldn't update Recent`
    case "create_collection":
      return `Couldn't create ${command.collectionName}`
    case "rename_collection":
      return `Couldn't rename ${command.collectionName}`
    case "delete_collection":
      return `Couldn't delete ${command.collectionName}`
    case "add_collection_member":
      return `Couldn't add ${command.itemName ?? "item"} to ${command.collectionName}`
    case "remove_collection_member":
      return `Couldn't remove ${command.itemName ?? "item"} from ${command.collectionName}`
    case "reorder_collection_members":
      return `Couldn't reorder ${command.collectionName}`
  }
}

const pendingFrom = (command: PreferenceCommand): LibraryPreferencePending => ({
  key: command.key,
  action: command.action,
  phase: "mutating",
  itemIdentity:
    command.action === "set_favorite" || command.action === "record_used"
      ? command.identity
      : (command.identity ?? null),
  collectionId:
    command.action === "set_favorite" || command.action === "record_used"
      ? null
      : command.collectionId,
  idempotencyKey: command.idempotencyKey,
  optimisticFavorite:
    command.action === "set_favorite" ? command.favorite : null,
})

export class LibraryPreferenceController {
  readonly #dependencies: LibraryPreferenceControllerDependencies
  readonly #listeners = new Set<Listener>()
  readonly #invalidationListeners = new Set<(revision: number) => void>()
  readonly #attempts = new Map<string, Attempt>()
  readonly #retries = new Map<string, RetryRecord>()
  readonly #collectionDetailRequests = new Map<
    string,
    CollectionDetailRequest
  >()
  #state: LibraryPreferenceStateOwner
  #confirmedSnapshot: LibraryPreferenceSnapshot | null = null
  #lifetime = 1
  #requestToken = 0
  #snapshotGeneration = 0
  #snapshotRequest: { generation: number; controller: AbortController } | null =
    null
  #refreshPromise: Promise<void> | null = null
  #channel: LibraryInvalidationChannel | null = null
  #channelInitialized = false
  #scheduledInvalidation = false
  #queuedInvalidation = false

  constructor(dependencies: LibraryPreferenceControllerDependencies) {
    this.#dependencies = dependencies
    this.#state = immutable({
      active: false,
      disposed: false,
      snapshotStatus: "idle",
      snapshot: null,
      snapshotFailure: null,
      pending: new Map(),
      failures: new Map(),
      collectionDetails: new Map(),
      discoveryInvalidationRevision: 0,
    } satisfies LibraryPreferenceStateOwner)
  }

  getSnapshot = () => this.#state

  subscribe = (listener: Listener) => {
    if (this.#state.disposed) return () => undefined
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  subscribeDiscoveryInvalidation = (listener: (revision: number) => void) => {
    if (this.#state.disposed) return () => undefined
    this.#invalidationListeners.add(listener)
    return () => {
      this.#invalidationListeners.delete(listener)
    }
  }

  activate() {
    if (this.#state.disposed || this.#state.active) return
    this.#initializeChannel()
    this.#publish({ ...this.#state, active: true })
    void this.refresh()
  }

  deactivate() {
    if (this.#state.disposed || !this.#state.active) return
    this.#snapshotRequest?.controller.abort()
    this.#snapshotRequest = null
    this.#refreshPromise = null
    for (const request of this.#collectionDetailRequests.values()) {
      request.controller.abort()
    }
    this.#collectionDetailRequests.clear()
    this.#publish({ ...this.#state, active: false })
  }

  dispose() {
    if (this.#state.disposed) return
    this.#lifetime += 1
    this.#snapshotRequest?.controller.abort()
    this.#snapshotRequest = null
    this.#refreshPromise = null
    for (const request of this.#collectionDetailRequests.values()) {
      request.controller.abort()
    }
    this.#collectionDetailRequests.clear()
    try {
      this.#channel?.close()
    } catch {
      // Cross-tab invalidation is advisory.
    }
    this.#channel = null
    this.#publish({ ...this.#state, active: false, disposed: true })
    this.#listeners.clear()
    this.#invalidationListeners.clear()
  }

  refresh() {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    if (this.#refreshPromise) return this.#refreshPromise
    const generation = ++this.#snapshotGeneration
    const lifetime = this.#lifetime
    const controller = new AbortController()
    this.#snapshotRequest = { generation, controller }
    this.#publish({
      ...this.#state,
      snapshotStatus: "loading",
      snapshotFailure: null,
    })
    const promise = this.#dependencies.client
      .readSnapshot(controller.signal)
      .then(
        ({ value }) => {
          if (!this.#acceptsSnapshot(generation, lifetime)) return
          const snapshot = immutable(
            libraryPreferenceSnapshotSchema.parse(structuredClone(value))
          )
          if (
            this.#confirmedSnapshot &&
            snapshot.workspaceRevision <
              this.#confirmedSnapshot.workspaceRevision
          ) {
            this.#publishProjected({
              ...this.#state,
              snapshotStatus: "ready",
              snapshotFailure: null,
            })
            return
          }
          const priorRevision = this.#confirmedSnapshot?.workspaceRevision ?? -1
          this.#confirmedSnapshot = snapshot
          const collectionDetails = this.#reconcileCollectionDetails(
            snapshot,
            this.#state.collectionDetails
          )
          const failures = this.#reconcileRetryAvailability(snapshot)
          this.#publishProjected({
            ...this.#state,
            snapshotStatus: "ready",
            snapshotFailure: null,
            collectionDetails,
            failures,
          })
          if (snapshot.workspaceRevision > priorRevision) {
            this.#notifyDiscovery(snapshot.workspaceRevision)
          }
        },
        (error: unknown) => {
          if (!this.#acceptsSnapshot(generation, lifetime)) return
          this.#publishProjected({
            ...this.#state,
            snapshotStatus: "failed",
            snapshotFailure: snapshotFailure(error),
          })
        }
      )
      .finally(() => {
        if (this.#snapshotRequest?.generation === generation) {
          this.#snapshotRequest = null
          this.#refreshPromise = null
        }
        if (this.#queuedInvalidation) {
          this.#queuedInvalidation = false
          this.#scheduleAuthoritativeRefresh()
        }
      })
    this.#refreshPromise = promise
    return promise
  }

  refreshAfterCurrent() {
    if (this.#state.disposed || !this.#state.active) return Promise.resolve()
    if (!this.#refreshPromise) return this.refresh()
    this.#queuedInvalidation = true
    return this.#refreshPromise
  }

  loadCollection(collectionIdInput: string, force = false) {
    const collectionId = libraryCollectionIdSchema.parse(collectionIdInput)
    const summary = collectionFor(this.#confirmedSnapshot, collectionId)
    if (this.#state.disposed || !this.#state.active || !summary) {
      return Promise.resolve(null)
    }
    const existingRequest = this.#collectionDetailRequests.get(collectionId)
    if (existingRequest) return existingRequest.promise
    const current = this.#state.collectionDetails.get(collectionId)
    if (
      !force &&
      current?.status === "ready" &&
      current.detail.summary.revision === summary.revision
    ) {
      return Promise.resolve(current.detail)
    }
    const retained =
      current?.status === "ready"
        ? current.detail
        : current?.status === "loading" || current?.status === "failed"
          ? current.retained
          : null
    const controller = new AbortController()
    const token = ++this.#requestToken
    const lifetime = this.#lifetime
    const collectionDetails = cloneMap(this.#state.collectionDetails)
    collectionDetails.set(collectionId, { status: "loading", retained })
    this.#publish({ ...this.#state, collectionDetails })

    const promise = this.#dependencies.client
      .getCollection(collectionId, controller.signal)
      .then(
        ({ value }) => {
          if (!this.#acceptsCollectionDetail(collectionId, token, lifetime)) {
            return null
          }
          const detail = immutable(
            libraryCollectionDetailSchema.parse(
              structuredClone(value.collection)
            )
          )
          const authoritativeSummary = collectionFor(
            this.#confirmedSnapshot,
            collectionId
          )
          const currentWorkspaceRevision =
            this.#confirmedSnapshot?.workspaceRevision ?? -1
          const sameSummary =
            authoritativeSummary &&
            detail.summary.id === authoritativeSummary.id &&
            detail.summary.name === authoritativeSummary.name &&
            detail.summary.revision === authoritativeSummary.revision &&
            detail.summary.itemCount === authoritativeSummary.itemCount &&
            detail.summary.createdAt === authoritativeSummary.createdAt &&
            detail.summary.updatedAt === authoritativeSummary.updatedAt
          if (
            detail.summary.id !== collectionId ||
            !authoritativeSummary ||
            value.workspaceRevision < currentWorkspaceRevision ||
            detail.summary.revision < authoritativeSummary.revision ||
            (value.workspaceRevision === currentWorkspaceRevision &&
              !sameSummary)
          ) {
            throw new LibraryPreferenceHttpError({
              code: "library_invalid_response",
              status: 200,
              message:
                "Studio returned collection details for another revision.",
              retryable: true,
            })
          }
          const next = cloneMap(this.#state.collectionDetails)
          next.set(collectionId, { status: "ready", detail })
          this.#publish({ ...this.#state, collectionDetails: next })
          if (
            value.workspaceRevision >
            (this.#confirmedSnapshot?.workspaceRevision ?? -1)
          ) {
            this.#notifyDiscovery(value.workspaceRevision)
            this.#scheduleAuthoritativeRefresh()
          }
          return detail
        },
        (error: unknown) => {
          if (!this.#acceptsCollectionDetail(collectionId, token, lifetime)) {
            return null
          }
          const failed = {
            ...failureFrom(
              `collection:${collectionId}:load`,
              "load_collection",
              `Couldn't load ${summary.name}`,
              error
            ),
            retryable: true,
            retryMode: "refresh" as const,
          }
          const next = cloneMap(this.#state.collectionDetails)
          next.set(collectionId, {
            status: "failed",
            retained,
            failure: failed,
          })
          this.#publish({ ...this.#state, collectionDetails: next })
          return null
        }
      )
      .catch((error: unknown) => {
        if (!this.#acceptsCollectionDetail(collectionId, token, lifetime)) {
          return null
        }
        const failed = {
          ...failureFrom(
            `collection:${collectionId}:load`,
            "load_collection",
            `Couldn't load ${summary.name}`,
            error
          ),
          retryable: true,
          retryMode: "refresh" as const,
        }
        const next = cloneMap(this.#state.collectionDetails)
        next.set(collectionId, {
          status: "failed",
          retained,
          failure: failed,
        })
        this.#publish({ ...this.#state, collectionDetails: next })
        return null
      })
      .finally(() => {
        const active = this.#collectionDetailRequests.get(collectionId)
        if (active?.token === token) {
          this.#collectionDetailRequests.delete(collectionId)
        }
      })
    this.#collectionDetailRequests.set(collectionId, {
      token,
      lifetime,
      collectionId,
      controller,
      promise,
    })
    return promise
  }

  retryCollectionDetail(collectionId: string) {
    return this.loadCollection(collectionId, true)
  }

  setFavorite(
    identityInput: LibraryItemIdentity,
    itemName: string,
    favorite: boolean
  ) {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    const expectedRevision =
      preferenceFor(this.#confirmedSnapshot, identity)?.revision ?? 0
    return this.#execute({
      action: "set_favorite",
      key: `favorite:${identityKey(identity)}`,
      identity,
      itemName,
      favorite,
      expectedRevision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  recordUsed(
    identityInput: LibraryItemIdentity,
    itemName: string,
    completedAction: "create" | "insert" | "replace",
    completionId: string
  ) {
    const identity = libraryItemIdentitySchema.parse(identityInput)
    return this.#execute({
      action: "record_used",
      key: `recent:${identityKey(identity)}:${completionId}`,
      identity,
      itemName,
      completedAction,
      completionId,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  createCollection(name: string) {
    const normalizedName = libraryCollectionNameSchema.parse(name)
    return this.#execute({
      action: "create_collection",
      key: "collection:create",
      collectionId: null,
      collectionName: normalizedName,
      name: normalizedName,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  renameCollection(collectionId: string, name: string) {
    const current = collectionFor(this.#confirmedSnapshot, collectionId)
    if (!current) return Promise.resolve(false)
    const normalizedName = libraryCollectionNameSchema.parse(name)
    return this.#execute({
      action: "rename_collection",
      key: `collection:${collectionId}:rename`,
      collectionId,
      collectionName: current.name,
      name: normalizedName,
      expectedRevision: current.revision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  deleteCollection(collectionId: string) {
    const current = collectionFor(this.#confirmedSnapshot, collectionId)
    if (!current) return Promise.resolve(false)
    return this.#execute({
      action: "delete_collection",
      key: `collection:${collectionId}:delete`,
      collectionId,
      collectionName: current.name,
      expectedRevision: current.revision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  addCollectionMember(
    collectionId: string,
    identityInput: LibraryItemIdentity,
    itemName: string
  ) {
    const current = collectionFor(this.#confirmedSnapshot, collectionId)
    if (!current) return Promise.resolve(false)
    const identity = libraryItemIdentitySchema.parse(identityInput)
    return this.#execute({
      action: "add_collection_member",
      key: `collection:${collectionId}:add:${identityKey(identity)}`,
      collectionId,
      collectionName: current.name,
      identity,
      itemName,
      expectedRevision: current.revision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  removeCollectionMember(
    collectionId: string,
    identityInput: LibraryItemIdentity,
    itemName: string
  ) {
    const current = collectionFor(this.#confirmedSnapshot, collectionId)
    if (!current) return Promise.resolve(false)
    const identity = libraryItemIdentitySchema.parse(identityInput)
    return this.#execute({
      action: "remove_collection_member",
      key: `collection:${collectionId}:remove:${identityKey(identity)}`,
      collectionId,
      collectionName: current.name,
      identity,
      itemName,
      expectedRevision: current.revision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  reorderCollectionMembers(
    collectionId: string,
    orderedIdentities: readonly LibraryItemIdentity[]
  ) {
    const current = collectionFor(this.#confirmedSnapshot, collectionId)
    if (!current) return Promise.resolve(false)
    return this.#execute({
      action: "reorder_collection_members",
      key: `collection:${collectionId}:reorder`,
      collectionId,
      collectionName: current.name,
      orderedIdentities: orderedIdentities.map((identity) =>
        libraryItemIdentitySchema.parse(identity)
      ),
      expectedRevision: current.revision,
      idempotencyKey: this.#dependencies.createIdempotencyKey(),
    })
  }

  retry(key: string) {
    if (this.#state.disposed || this.#attempts.has(key)) {
      return Promise.resolve(false)
    }
    const retry = this.#retries.get(key)
    if (!retry) return Promise.resolve(false)
    let command = retry.command
    if (retry.mode === "new_key") {
      const reconciled = this.#reconcileCommandRevision({
        ...command,
        idempotencyKey: this.#dependencies.createIdempotencyKey(),
      })
      if (!reconciled) {
        this.#disableRetry(key)
        return Promise.resolve(false)
      }
      command = reconciled
    }
    return this.#execute(command)
  }

  dismissFailure(key: string) {
    if (!this.#state.failures.has(key)) return
    this.#retries.delete(key)
    const failures = cloneMap(this.#state.failures)
    failures.delete(key)
    this.#publish({ ...this.#state, failures })
  }

  #execute(command: PreferenceCommand): Promise<boolean> {
    if (
      this.#state.disposed ||
      !this.#state.active ||
      !this.#confirmedSnapshot ||
      this.#attempts.has(command.key)
    ) {
      return Promise.resolve(false)
    }
    const token = ++this.#requestToken
    const attempt = {
      token,
      lifetime: this.#lifetime,
      workspaceRevisionAtDispatch: this.#confirmedSnapshot.workspaceRevision,
      command,
    }
    this.#attempts.set(command.key, attempt)
    this.#retries.delete(command.key)
    const pending = cloneMap(this.#state.pending)
    const failures = cloneMap(this.#state.failures)
    pending.set(command.key, pendingFrom(command))
    failures.delete(command.key)
    this.#publishProjected({ ...this.#state, pending, failures })

    return this.#requestFor(command).then(
      (receipt) => this.#completeAttempt(attempt, receipt),
      (error: unknown) => this.#failAttempt(attempt, error)
    )
  }

  #requestFor(
    command: PreferenceCommand
  ): Promise<
    LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt
  > {
    const client = this.#dependencies.client
    switch (command.action) {
      case "set_favorite":
        return client
          .setFavorite(command.identity, {
            favorite: command.favorite,
            expectedRevision: command.expectedRevision,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "record_used":
        return client
          .recordUsed(command.identity, {
            completedAction: command.completedAction,
            completionId: command.completionId,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "create_collection":
        return client
          .createCollection({
            name: command.name ?? command.collectionName,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "rename_collection":
        return client
          .renameCollection(command.collectionId!, {
            name: command.name ?? command.collectionName,
            expectedRevision: command.expectedRevision!,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "delete_collection":
        return client
          .deleteCollection(command.collectionId!, {
            expectedRevision: command.expectedRevision!,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "add_collection_member":
        return client
          .addCollectionMember(command.collectionId!, command.identity!, {
            expectedRevision: command.expectedRevision!,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "remove_collection_member":
        return client
          .removeCollectionMember(command.collectionId!, command.identity!, {
            expectedRevision: command.expectedRevision!,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
      case "reorder_collection_members":
        return client
          .reorderCollectionMembers(command.collectionId!, {
            orderedIdentities: command.orderedIdentities ?? [],
            expectedRevision: command.expectedRevision!,
            idempotencyKey: command.idempotencyKey,
          })
          .then(({ value }) => value)
    }
  }

  #completeAttempt(
    attempt: Attempt,
    receipt: LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt
  ) {
    if (!this.#acceptsAttempt(attempt)) return false
    if (!this.#receiptMatches(attempt.command, receipt)) {
      return this.#failAttempt(
        attempt,
        new LibraryPreferenceHttpError({
          code: "library_invalid_response",
          status: 200,
          message: "Studio returned a receipt for another library action.",
          retryable: true,
          commitStatus: "unknown",
        })
      )
    }
    this.#attempts.delete(attempt.command.key)
    const pending = cloneMap(this.#state.pending)
    pending.delete(attempt.command.key)
    const failures = cloneMap(this.#state.failures)
    failures.delete(attempt.command.key)
    this.#retries.delete(attempt.command.key)
    const currentRevision = this.#confirmedSnapshot?.workspaceRevision ?? -1
    if (
      receipt.workspaceRevision >= currentRevision &&
      this.#confirmedSnapshot
    ) {
      if (
        receipt.operation === "set_favorite" ||
        receipt.operation === "record_used"
      ) {
        this.#confirmedSnapshot = immutable(
          mergePreference(
            this.#confirmedSnapshot,
            receipt.preference,
            receipt.workspaceRevision
          )
        )
      } else if (receipt.operation === "delete_collection") {
        this.#confirmedSnapshot = immutable(
          deleteCollection(
            this.#confirmedSnapshot,
            receipt.collectionId,
            receipt.workspaceRevision
          )
        )
      } else {
        this.#confirmedSnapshot = immutable(
          mergeCollection(
            this.#confirmedSnapshot,
            receipt.collection.summary,
            receipt.workspaceRevision
          )
        )
        if (
          receipt.operation === "add_collection_member" ||
          receipt.operation === "remove_collection_member"
        ) {
          this.#confirmedSnapshot = immutable(
            mergeCollectionMembership(this.#confirmedSnapshot, receipt)
          )
        }
      }
    }
    const collectionDetails = cloneMap(this.#state.collectionDetails)
    if (receipt.operation === "delete_collection") {
      collectionDetails.delete(receipt.collectionId)
      this.#collectionDetailRequests
        .get(receipt.collectionId)
        ?.controller.abort()
      this.#collectionDetailRequests.delete(receipt.collectionId)
    } else if (
      receipt.operation !== "set_favorite" &&
      receipt.operation !== "record_used"
    ) {
      const collectionId = receipt.collection.summary.id
      this.#collectionDetailRequests.get(collectionId)?.controller.abort()
      this.#collectionDetailRequests.delete(collectionId)
      if (receipt.workspaceRevision >= currentRevision) {
        collectionDetails.set(collectionId, {
          status: "ready",
          detail: immutable(structuredClone(receipt.collection)),
        })
      }
    }
    this.#publishProjected({
      ...this.#state,
      pending,
      failures,
      collectionDetails,
    })
    this.#broadcast(receipt.workspaceRevision)
    this.#notifyDiscovery(receipt.workspaceRevision)
    if (
      receipt.operation !== "set_favorite" &&
      receipt.operation !== "record_used"
    ) {
      this.#scheduleAuthoritativeRefresh()
    }
    return true
  }

  async #failAttempt(attempt: Attempt, error: unknown): Promise<boolean> {
    if (!this.#acceptsAttempt(attempt)) return false
    const precondition =
      error instanceof LibraryPreferenceHttpError &&
      error.status === 412 &&
      error.commitStatus === "known"
    if (precondition) {
      const reconciling = cloneMap(this.#state.pending)
      const current = reconciling.get(attempt.command.key)
      if (current) {
        reconciling.set(attempt.command.key, {
          ...current,
          phase: "reconciling",
          optimisticFavorite: null,
        })
      }
      this.#publishProjected({ ...this.#state, pending: reconciling })
      // A read that started before the precondition response cannot reconcile
      // the conflict. Supersede it and require one read started afterwards.
      this.#snapshotRequest?.controller.abort()
      this.#snapshotRequest = null
      this.#refreshPromise = null
      await this.refresh()
    } else {
      const failedPending = cloneMap(this.#state.pending)
      failedPending.delete(attempt.command.key)
      this.#publishProjected({ ...this.#state, pending: failedPending })
    }
    if (!this.#acceptsAttempt(attempt)) return false
    this.#attempts.delete(attempt.command.key)
    const rawFailure = failureFrom(
      attempt.command.key,
      attempt.command.action,
      failedMessage(attempt.command),
      error
    )
    const preconditionReconciled =
      precondition && this.#preconditionReconciled(attempt)
    const retryMode: "same_key" | "new_key" | null =
      rawFailure.commitStatus === "unknown"
        ? "same_key"
        : preconditionReconciled
          ? "new_key"
          : !precondition && rawFailure.retryable
            ? "new_key"
            : null
    const failure: LibraryPreferenceFailure = {
      ...rawFailure,
      retryable: retryMode !== null,
      retryMode,
    }
    const failures = cloneMap(this.#state.failures)
    failures.set(attempt.command.key, failure)
    const settledPending = cloneMap(this.#state.pending)
    settledPending.delete(attempt.command.key)
    if (retryMode) {
      this.#retries.set(attempt.command.key, {
        command: attempt.command,
        mode: retryMode,
      })
    } else {
      this.#retries.delete(attempt.command.key)
    }
    this.#publishProjected({
      ...this.#state,
      pending: settledPending,
      failures,
    })
    return false
  }

  #reconcileCommandRevision(
    command: PreferenceCommand
  ): PreferenceCommand | null {
    if (command.action === "set_favorite") {
      return {
        ...command,
        expectedRevision:
          preferenceFor(this.#confirmedSnapshot, command.identity)?.revision ??
          0,
      }
    }
    if (
      command.action !== "record_used" &&
      command.action !== "create_collection" &&
      command.collectionId
    ) {
      const revision = collectionFor(
        this.#confirmedSnapshot,
        command.collectionId
      )?.revision
      return revision ? { ...command, expectedRevision: revision } : null
    }
    return command
  }

  #preconditionReconciled(attempt: Attempt) {
    if (
      this.#state.snapshotStatus !== "ready" ||
      !this.#confirmedSnapshot ||
      this.#confirmedSnapshot.workspaceRevision <=
        attempt.workspaceRevisionAtDispatch
    ) {
      return false
    }
    const command = attempt.command
    if (command.action === "set_favorite") {
      return (
        (preferenceFor(this.#confirmedSnapshot, command.identity)?.revision ??
          0) > command.expectedRevision
      )
    }
    if (
      command.action === "record_used" ||
      command.action === "create_collection" ||
      !command.collectionId
    ) {
      return false
    }
    const collection = collectionFor(
      this.#confirmedSnapshot,
      command.collectionId
    )
    return Boolean(
      collection && collection.revision > (command.expectedRevision ?? 0)
    )
  }

  #disableRetry(key: string) {
    this.#retries.delete(key)
    const current = this.#state.failures.get(key)
    if (!current || (!current.retryable && current.retryMode === null)) return
    const failures = cloneMap(this.#state.failures)
    failures.set(key, { ...current, retryable: false, retryMode: null })
    this.#publish({ ...this.#state, failures })
  }

  #reconcileRetryAvailability(snapshot: LibraryPreferenceSnapshot) {
    const failures = cloneMap(this.#state.failures)
    for (const [key, retry] of this.#retries) {
      const command = retry.command
      if (
        command.action === "set_favorite" ||
        command.action === "record_used" ||
        command.action === "create_collection" ||
        !command.collectionId ||
        collectionFor(snapshot, command.collectionId)
      ) {
        continue
      }
      this.#retries.delete(key)
      const failure = failures.get(key)
      if (failure) {
        failures.set(key, {
          ...failure,
          retryable: false,
          retryMode: null,
        })
      }
    }
    return failures
  }

  #receiptMatches(
    command: PreferenceCommand,
    receipt: LibraryPreferenceMutationReceipt | LibraryCollectionMutationReceipt
  ) {
    if (command.action === "set_favorite") {
      if (receipt.operation !== "set_favorite") return false
      return (
        identityKey(receipt.preference.identity) ===
          identityKey(command.identity) &&
        receipt.preference.favorite === command.favorite &&
        receipt.preference.revision === command.expectedRevision + 1
      )
    }
    if (command.action === "record_used") {
      if (receipt.operation !== "record_used") return false
      return (
        identityKey(receipt.preference.identity) ===
          identityKey(command.identity) &&
        receipt.completedAction === command.completedAction &&
        receipt.completionId === command.completionId
      )
    }
    if (command.action === "create_collection") {
      return (
        receipt.operation === "create_collection" &&
        receipt.collection.summary.name === command.name
      )
    }
    if (receipt.operation !== command.action) return false
    if (receipt.operation === "delete_collection") {
      return (
        receipt.collectionId === command.collectionId &&
        receipt.deletedRevision === command.expectedRevision! + 1
      )
    }
    if (
      receipt.collection.summary.id !== command.collectionId ||
      receipt.collection.summary.revision !== command.expectedRevision! + 1
    )
      return false
    switch (command.action) {
      case "rename_collection":
        return receipt.collection.summary.name === command.name
      case "add_collection_member":
      case "remove_collection_member":
        return (
          "identity" in receipt &&
          identityKey(receipt.identity) === identityKey(command.identity!)
        )
      case "reorder_collection_members":
        return identitiesEqual(
          receipt.collection.members,
          command.orderedIdentities ?? []
        )
      case "delete_collection":
        return false
    }
  }

  #acceptsAttempt(attempt: Attempt) {
    const current = this.#attempts.get(attempt.command.key)
    return (
      !this.#state.disposed &&
      attempt.lifetime === this.#lifetime &&
      current?.token === attempt.token
    )
  }

  #acceptsCollectionDetail(
    collectionId: string,
    token: number,
    lifetime: number
  ) {
    const request = this.#collectionDetailRequests.get(collectionId)
    return (
      !this.#state.disposed &&
      this.#state.active &&
      lifetime === this.#lifetime &&
      request?.token === token
    )
  }

  #reconcileCollectionDetails(
    snapshot: LibraryPreferenceSnapshot,
    current: ReadonlyMap<string, LibraryCollectionDetailState>
  ) {
    const next = cloneMap(current)
    for (const [collectionId, slot] of next) {
      const summary = collectionFor(snapshot, collectionId)
      if (!summary) {
        this.#collectionDetailRequests.get(collectionId)?.controller.abort()
        this.#collectionDetailRequests.delete(collectionId)
        next.delete(collectionId)
        continue
      }
      const detail =
        slot.status === "ready"
          ? slot.detail
          : slot.status === "loading" || slot.status === "failed"
            ? slot.retained
            : null
      if (!detail || detail.summary.revision === summary.revision) continue
      next.set(
        collectionId,
        slot.status === "loading"
          ? { status: "loading", retained: null }
          : { status: "idle" }
      )
    }
    return next
  }

  #acceptsSnapshot(generation: number, lifetime: number) {
    return (
      !this.#state.disposed &&
      this.#state.active &&
      lifetime === this.#lifetime &&
      this.#snapshotRequest?.generation === generation
    )
  }

  #projectSnapshot(pending: ReadonlyMap<string, LibraryPreferencePending>) {
    if (!this.#confirmedSnapshot) return null
    let projected = this.#confirmedSnapshot
    for (const entry of pending.values()) {
      if (
        entry.action !== "set_favorite" ||
        entry.itemIdentity === null ||
        entry.optimisticFavorite === null
      )
        continue
      const current = preferenceFor(projected, entry.itemIdentity)
      const now = current?.updatedAt ?? new Date(0).toISOString()
      projected = libraryPreferenceSnapshotSchema.parse({
        ...projected,
        preferences: [
          ...projected.preferences.filter(
            ({ identity }) =>
              identityKey(identity) !== identityKey(entry.itemIdentity!)
          ),
          {
            identity: entry.itemIdentity,
            favorite: entry.optimisticFavorite,
            lastUsedAt: current?.lastUsedAt ?? null,
            collectionIds: current?.collectionIds ?? [],
            revision: current?.revision ?? 0,
            updatedAt: now,
          },
        ],
      })
    }
    return immutable(projected)
  }

  #publishProjected(next: LibraryPreferenceStateOwner) {
    this.#publish({ ...next, snapshot: this.#projectSnapshot(next.pending) })
  }

  #publish(next: LibraryPreferenceStateOwner) {
    this.#state = immutable(next)
    for (const listener of this.#listeners) listener()
  }

  #notifyDiscovery(workspaceRevision: number) {
    if (workspaceRevision <= this.#state.discoveryInvalidationRevision) return
    this.#publish({
      ...this.#state,
      discoveryInvalidationRevision: workspaceRevision,
    })
    for (const listener of this.#invalidationListeners) {
      try {
        listener(workspaceRevision)
      } catch {
        // Discovery refresh cannot change preference authority.
      }
    }
  }

  #initializeChannel() {
    if (this.#channelInitialized) return
    this.#channelInitialized = true
    let channel: LibraryInvalidationChannel | null = null
    try {
      channel =
        this.#dependencies.createInvalidationChannel?.(
          "webmcp-studio:library-preferences:v1"
        ) ?? null
      if (channel) {
        channel.onmessage = ({ data }) => this.#receiveHint(data)
      }
    } catch {
      try {
        channel?.close()
      } catch {
        // Cross-tab invalidation is optional.
      }
      channel = null
    }
    this.#channel = channel
  }

  #receiveHint(value: unknown) {
    const parsed = invalidationHintSchema.safeParse(value)
    if (
      !parsed.success ||
      parsed.data.sourceSessionId === this.#dependencies.sessionId ||
      parsed.data.workspaceRevision <=
        (this.#confirmedSnapshot?.workspaceRevision ?? -1)
    ) {
      return
    }
    this.#scheduleAuthoritativeRefresh()
  }

  #scheduleAuthoritativeRefresh() {
    if (this.#scheduledInvalidation || !this.#state.active) return
    this.#scheduledInvalidation = true
    const schedule = this.#dependencies.scheduleInvalidation ?? queueMicrotask
    schedule(() => {
      this.#scheduledInvalidation = false
      if (this.#state.disposed || !this.#state.active) return
      if (this.#refreshPromise) {
        this.#queuedInvalidation = true
        return
      }
      void this.refresh()
    })
  }

  #broadcast(workspaceRevision: number) {
    try {
      this.#channel?.postMessage({
        schemaVersion: 1,
        type: "library-invalidated",
        workspaceRevision,
        sourceSessionId: this.#dependencies.sessionId,
      })
    } catch {
      // A committed mutation is authoritative without BroadcastChannel.
    }
  }
}
