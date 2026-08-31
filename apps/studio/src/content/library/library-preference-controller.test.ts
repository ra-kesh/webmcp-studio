import { describe, expect, it, vi } from "vitest"
import type {
  LibraryCollectionDetail,
  LibraryCollectionMutationReceipt,
  LibraryPreferenceMutationReceipt,
  LibraryPreferenceSnapshot,
} from "@webmcp/document"
import { LibraryPreferenceController } from "./library-preference-controller"
import type { LibraryInvalidationChannel } from "./library-preference-controller"
import { LibraryPreferenceHttpError } from "./library-preference-client"
import type {
  LibraryPreferenceClient,
  LibraryPreferenceClientResult,
} from "./library-preference-client"

const identity = {
  itemKind: "template" as const,
  id: "proposal-template",
  version: 1,
}

const secondIdentity = {
  itemKind: "template" as const,
  id: "proposal-template-second",
  version: 1,
}

const preference = (
  revision: number,
  favorite = false,
  lastUsedAt: string | null = null
) => ({
  identity,
  favorite,
  lastUsedAt,
  collectionIds: [],
  revision,
  updatedAt: `2026-08-31T08:0${Math.min(revision, 9)}:00.000Z`,
})

const collection = (revision = 1) => ({
  id: "collection-proposals",
  name: "Proposals",
  scope: "workspace" as const,
  revision,
  itemCount: 0,
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: `2026-08-31T08:0${Math.min(revision, 9)}:00.000Z`,
})

const snapshot = (
  workspaceRevision = 1,
  preferenceRevision = 0,
  favorite = false
): LibraryPreferenceSnapshot => ({
  workspaceRevision,
  preferences:
    preferenceRevision === 0 ? [] : [preference(preferenceRevision, favorite)],
  collections: [collection()],
})

const result = <TValue>(
  value: TValue
): LibraryPreferenceClientResult<TValue> => ({
  value,
  requestId: "request-library-1",
  etag: null,
})

const deferred = <TValue>() => {
  let resolve!: (value: TValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const favoriteReceipt = (
  workspaceRevision: number,
  revision: number,
  favorite: boolean
): LibraryPreferenceMutationReceipt => ({
  schemaVersion: 1,
  operation: "set_favorite",
  preference: preference(revision, favorite),
  workspaceRevision,
})

const recordReceipt = (
  workspaceRevision: number,
  revision: number
): LibraryPreferenceMutationReceipt => ({
  schemaVersion: 1,
  operation: "record_used",
  completedAction: "create",
  completionId: "document-created-1",
  preference: preference(revision, false, "2026-08-31T08:02:00.000Z"),
  workspaceRevision,
})

const collectionDetail = (
  revision = 1,
  members: readonly (typeof identity)[] = [],
  name = "Proposals"
): LibraryCollectionDetail => ({
  summary: {
    ...collection(revision),
    name,
    itemCount: members.length,
  },
  members: [...members],
})

const collectionReceipt = (
  operation: Exclude<
    LibraryCollectionMutationReceipt["operation"],
    "delete_collection"
  >,
  options: {
    revision?: number
    workspaceRevision?: number
    members?: readonly (typeof identity)[]
    name?: string
  } = {}
): LibraryCollectionMutationReceipt =>
  ({
    schemaVersion: 1,
    operation,
    collection: collectionDetail(
      options.revision ?? (operation === "create_collection" ? 1 : 2),
      options.members,
      options.name
    ),
    workspaceRevision: options.workspaceRevision ?? 2,
    ...(operation === "add_collection_member" ||
    operation === "remove_collection_member"
      ? { identity }
      : {}),
  }) as LibraryCollectionMutationReceipt

const controllerHarness = (
  overrides: Partial<LibraryPreferenceClient> = {}
) => {
  const client: LibraryPreferenceClient = {
    readSnapshot: vi.fn(async () => result(snapshot())),
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
    ...overrides,
  }
  const keys = ["mutation-key-1", "mutation-key-2", "mutation-key-3"]
  let keyIndex = 0
  const controller = new LibraryPreferenceController({
    client,
    sessionId: "session-current",
    createIdempotencyKey: () => keys[keyIndex++] ?? `mutation-key-${keyIndex}`,
  })
  return { client, controller }
}

const activate = async (controller: LibraryPreferenceController) => {
  controller.activate()
  await controller.refresh()
  expect(controller.getSnapshot().snapshotStatus).toBe("ready")
}

const networkFailure = () =>
  new LibraryPreferenceHttpError({
    code: "library_network_error",
    status: 0,
    message: "offline",
    retryable: true,
    commitStatus: "unknown",
  })

const knownFailure = () =>
  new LibraryPreferenceHttpError({
    code: "library_request_failed",
    status: 409,
    message: "No.",
    retryable: true,
  })

describe("LibraryPreferenceController", () => {
  it("optimistically favorites, commits an authoritative receipt, and rolls back only the projection on failure", async () => {
    const first =
      deferred<
        LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>
      >()
    const second =
      deferred<
        LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>
      >()
    const setFavorite = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { controller } = controllerHarness({ setFavorite })
    await activate(controller)

    const committed = controller.setFavorite(identity, "Proposal", true)
    expect(controller.getSnapshot().snapshot?.preferences[0]?.favorite).toBe(
      true
    )
    expect(
      controller
        .getSnapshot()
        .pending.has("favorite:template:proposal-template@1")
    ).toBe(true)
    first.resolve(result(favoriteReceipt(2, 1, true)))
    await expect(committed).resolves.toBe(true)
    expect(controller.getSnapshot().snapshot?.preferences[0]?.favorite).toBe(
      true
    )
    expect(controller.getSnapshot().pending.size).toBe(0)

    const failed = controller.setFavorite(identity, "Proposal", false)
    expect(controller.getSnapshot().snapshot?.preferences[0]?.favorite).toBe(
      false
    )
    second.reject(networkFailure())
    await expect(failed).resolves.toBe(false)
    expect(controller.getSnapshot().snapshot?.preferences[0]?.favorite).toBe(
      true
    )
    expect(
      controller
        .getSnapshot()
        .failures.get("favorite:template:proposal-template@1")
    ).toMatchObject({
      message: "Couldn't remove Proposal from Favorites",
      commitStatus: "unknown",
    })
  })

  it("reuses one key for unknown commit status Retry", async () => {
    const statusUnknown = new LibraryPreferenceHttpError({
      code: "library_mutation_status_unknown",
      status: 409,
      message: "The mutation result is unknown.",
      requestId: "request-status-unknown-1",
      retryable: false,
      commitStatus: "unknown",
    })
    const setFavorite = vi
      .fn()
      .mockRejectedValueOnce(statusUnknown)
      .mockResolvedValueOnce(result(favoriteReceipt(2, 1, true)))
    const { controller } = controllerHarness({ setFavorite })
    await activate(controller)

    await controller.setFavorite(identity, "Proposal", true)
    expect(
      controller
        .getSnapshot()
        .failures.get("favorite:template:proposal-template@1")
    ).toMatchObject({
      code: "library_mutation_status_unknown",
      status: 409,
      retryable: true,
      retryMode: "same_key",
    })
    await controller.retry("favorite:template:proposal-template@1")

    expect(setFavorite).toHaveBeenCalledTimes(2)
    expect(setFavorite.mock.calls[0]?.[1].idempotencyKey).toBe("mutation-key-1")
    expect(setFavorite.mock.calls[1]?.[1].idempotencyKey).toBe("mutation-key-1")
  })

  it("reconciles 412 before Retry and uses a new key with the latest revision", async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockResolvedValueOnce(result(snapshot(5, 2, false)))
    const conflict = new LibraryPreferenceHttpError({
      code: "library_preference_revision_mismatch",
      status: 412,
      message: "changed",
      requestId: "request-conflict-1",
      retryable: false,
    })
    const setFavorite = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(result(favoriteReceipt(6, 3, true)))
    const { controller } = controllerHarness({ readSnapshot, setFavorite })
    await activate(controller)

    await controller.setFavorite(identity, "Proposal", true)
    expect(readSnapshot).toHaveBeenCalledTimes(2)
    expect(
      controller
        .getSnapshot()
        .failures.get("favorite:template:proposal-template@1")
    ).toMatchObject({ retryable: true, retryMode: "new_key" })
    await controller.retry("favorite:template:proposal-template@1")

    expect(setFavorite.mock.calls[0]?.[1]).toMatchObject({
      expectedRevision: 0,
      idempotencyKey: "mutation-key-1",
    })
    expect(setFavorite.mock.calls[1]?.[1]).toMatchObject({
      expectedRevision: 2,
      idempotencyKey: "mutation-key-2",
    })
  })

  it("blocks 412 Retry until a newer target revision is authoritatively ready", async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockResolvedValueOnce(result(snapshot(1)))
    const setFavorite = vi.fn(async () => {
      throw new LibraryPreferenceHttpError({
        code: "library_preference_revision_mismatch",
        status: 412,
        message: "changed",
        retryable: false,
      })
    })
    const { controller } = controllerHarness({ readSnapshot, setFavorite })
    await activate(controller)

    await controller.setFavorite(identity, "Proposal", true)
    expect(
      controller
        .getSnapshot()
        .failures.get("favorite:template:proposal-template@1")
    ).toMatchObject({ retryable: false, retryMode: null })
    await expect(
      controller.retry("favorite:template:proposal-template@1")
    ).resolves.toBe(false)
    expect(setFavorite).toHaveBeenCalledTimes(1)
  })

  it("reconciles a deleted collection without exposing an impossible Retry", async () => {
    const withoutCollections = { ...snapshot(2), collections: [] }
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockResolvedValueOnce(result(withoutCollections))
    const deleteCollection = vi.fn(async () => {
      throw new LibraryPreferenceHttpError({
        code: "library_collection_revision_mismatch",
        status: 412,
        message: "changed",
        retryable: false,
      })
    })
    const { controller } = controllerHarness({
      readSnapshot,
      deleteCollection,
    })
    await activate(controller)

    await controller.deleteCollection("collection-proposals")
    const key = "collection:collection-proposals:delete"
    expect(controller.getSnapshot().failures.get(key)).toMatchObject({
      retryable: false,
      retryMode: null,
    })
    await expect(controller.retry(key)).resolves.toBe(false)
    expect(deleteCollection).toHaveBeenCalledTimes(1)
  })

  it("rejects a late older mutation receipt after newer preference authority", async () => {
    const favorite =
      deferred<
        LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>
      >()
    const record =
      deferred<
        LibraryPreferenceClientResult<LibraryPreferenceMutationReceipt>
      >()
    const { controller } = controllerHarness({
      setFavorite: vi.fn(() => favorite.promise),
      recordUsed: vi.fn(() => record.promise),
    })
    await activate(controller)

    const favoritePromise = controller.setFavorite(identity, "Proposal", true)
    const recentPromise = controller.recordUsed(
      identity,
      "Proposal",
      "create",
      "document-created-1"
    )
    record.resolve(result(recordReceipt(3, 2)))
    await recentPromise
    favorite.resolve(result(favoriteReceipt(2, 1, true)))
    await favoritePromise

    expect(controller.getSnapshot().snapshot?.workspaceRevision).toBe(3)
    expect(controller.getSnapshot().snapshot?.preferences[0]).toMatchObject({
      revision: 2,
      favorite: false,
      lastUsedAt: "2026-08-31T08:02:00.000Z",
    })
  })

  it("retains newer mutation authority when an older snapshot read finishes late", async () => {
    const lateRead =
      deferred<LibraryPreferenceClientResult<LibraryPreferenceSnapshot>>()
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockImplementationOnce(() => lateRead.promise)
    const setFavorite = vi.fn(async () => result(favoriteReceipt(3, 1, true)))
    const { controller } = controllerHarness({ readSnapshot, setFavorite })
    await activate(controller)

    const refresh = controller.refresh()
    await controller.setFavorite(identity, "Proposal", true)
    lateRead.resolve(result(snapshot(2)))
    await refresh

    expect(controller.getSnapshot().snapshotStatus).toBe("ready")
    expect(controller.getSnapshot().snapshot?.workspaceRevision).toBe(3)
    expect(controller.getSnapshot().snapshot?.preferences[0]?.favorite).toBe(
      true
    )
  })

  it("rejects collection receipts with the wrong name, revision transition, or member order", async () => {
    const createCollection = vi.fn(async () =>
      result(collectionReceipt("create_collection", { name: "Not Campaigns" }))
    )
    const renameCollection = vi.fn(async () =>
      result(
        collectionReceipt("rename_collection", {
          revision: 3,
          name: "Quotes",
        })
      )
    )
    const reorderCollectionMembers = vi.fn(async () =>
      result(collectionReceipt("reorder_collection_members", { members: [] }))
    )
    const { controller } = controllerHarness({
      createCollection,
      renameCollection,
      reorderCollectionMembers,
    })
    await activate(controller)

    await expect(controller.createCollection("  Campaigns  ")).resolves.toBe(
      false
    )
    await expect(
      controller.renameCollection("collection-proposals", "Quotes")
    ).resolves.toBe(false)
    await expect(
      controller.reorderCollectionMembers("collection-proposals", [identity])
    ).resolves.toBe(false)

    for (const key of [
      "collection:create",
      "collection:collection-proposals:rename",
      "collection:collection-proposals:reorder",
    ]) {
      expect(controller.getSnapshot().failures.get(key)).toMatchObject({
        code: "library_invalid_response",
        retryable: true,
        retryMode: "same_key",
      })
    }
  })

  it("loads and caches persisted ordered collection details, including after a fresh controller reload", async () => {
    const ordered = collectionDetail(1, [secondIdentity, identity])
    const authoritativeSnapshot: LibraryPreferenceSnapshot = {
      ...snapshot(1),
      collections: [ordered.summary],
    }
    const getCollection = vi.fn(async () =>
      result({
        schemaVersion: 1 as const,
        workspaceRevision: 1,
        collection: ordered,
      })
    )
    const first = controllerHarness({
      readSnapshot: vi.fn(async () => result(authoritativeSnapshot)),
      getCollection,
    }).controller
    await activate(first)

    await expect(first.loadCollection("collection-proposals")).resolves.toEqual(
      ordered
    )
    await first.loadCollection("collection-proposals")
    expect(getCollection).toHaveBeenCalledTimes(1)
    expect(
      first.getSnapshot().collectionDetails.get("collection-proposals")
    ).toEqual({ status: "ready", detail: ordered })

    const reloadedGet = vi.fn(async () =>
      result({
        schemaVersion: 1 as const,
        workspaceRevision: 1,
        collection: ordered,
      })
    )
    const reloaded = controllerHarness({
      readSnapshot: vi.fn(async () => result(authoritativeSnapshot)),
      getCollection: reloadedGet,
    }).controller
    await activate(reloaded)
    await reloaded.loadCollection("collection-proposals")
    expect(reloadedGet).toHaveBeenCalledTimes(1)
    expect(
      reloaded.getSnapshot().collectionDetails.get("collection-proposals")
    ).toMatchObject({ status: "ready", detail: ordered })
  })

  it("keeps exact add-member detail usable when the follow-up snapshot refresh fails", async () => {
    const callbacks: Array<() => void> = []
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockRejectedValueOnce(
        new LibraryPreferenceHttpError({
          code: "library_network_error",
          status: 0,
          message: "offline",
          retryable: true,
        })
      )
    const added = collectionReceipt("add_collection_member", {
      revision: 2,
      workspaceRevision: 2,
      members: [identity],
    })
    const client = controllerHarness({
      readSnapshot,
      addCollectionMember: vi.fn(async () => result(added)),
    }).client
    const controller = new LibraryPreferenceController({
      client,
      sessionId: "session-current",
      createIdempotencyKey: () => "mutation-key-add",
      scheduleInvalidation: (callback) => callbacks.push(callback),
    })
    await activate(controller)

    await expect(
      controller.addCollectionMember(
        "collection-proposals",
        identity,
        "Proposal"
      )
    ).resolves.toBe(true)
    expect(
      controller.getSnapshot().collectionDetails.get("collection-proposals")
    ).toMatchObject({
      status: "ready",
      detail: { members: [identity], summary: { revision: 2 } },
    })
    expect(controller.getSnapshot().snapshot).toMatchObject({
      workspaceRevision: 2,
      preferences: [
        {
          identity,
          favorite: false,
          lastUsedAt: null,
          collectionIds: ["collection-proposals"],
          revision: 0,
          updatedAt: "2026-08-31T08:02:00.000Z",
        },
      ],
    })

    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.()
    await vi.waitFor(() =>
      expect(controller.getSnapshot().snapshotStatus).toBe("failed")
    )
    expect(controller.getSnapshot().snapshotFailure).toMatchObject({
      retryable: true,
      retryMode: "refresh",
    })
    expect(
      controller.getSnapshot().collectionDetails.get("collection-proposals")
    ).toMatchObject({
      status: "ready",
      detail: { members: [identity], summary: { revision: 2 } },
    })
  })

  it("keeps a committed add-member receipt ahead of a pre-commit snapshot read", async () => {
    const callbacks: Array<() => void> = []
    const staleRead =
      deferred<LibraryPreferenceClientResult<LibraryPreferenceSnapshot>>()
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockImplementationOnce(() => staleRead.promise)
    const added = collectionReceipt("add_collection_member", {
      revision: 2,
      workspaceRevision: 2,
      members: [identity],
    })
    const client = controllerHarness({
      readSnapshot,
      addCollectionMember: vi.fn(async () => result(added)),
    }).client
    const controller = new LibraryPreferenceController({
      client,
      sessionId: "session-race",
      createIdempotencyKey: () => "mutation-key-race",
      scheduleInvalidation: (callback) => callbacks.push(callback),
    })
    await activate(controller)

    const inFlightRead = controller.refresh()
    await controller.addCollectionMember(
      "collection-proposals",
      identity,
      "Proposal"
    )
    staleRead.resolve(result(snapshot(1)))
    await inFlightRead

    expect(controller.getSnapshot().snapshot).toMatchObject({
      workspaceRevision: 2,
      collections: [{ id: "collection-proposals", revision: 2 }],
      preferences: [
        {
          identity,
          collectionIds: ["collection-proposals"],
          revision: 0,
        },
      ],
    })
  })

  it("preserves preference metadata while projecting a remove-member receipt", async () => {
    const initial: LibraryPreferenceSnapshot = {
      ...snapshot(1, 3, true),
      preferences: [
        {
          ...preference(3, true, "2026-08-31T08:02:00.000Z"),
          collectionIds: ["collection-proposals"],
        },
      ],
    }
    const removed = collectionReceipt("remove_collection_member", {
      revision: 2,
      workspaceRevision: 2,
      members: [],
    })
    const { controller } = controllerHarness({
      readSnapshot: vi.fn(async () => result(initial)),
      removeCollectionMember: vi.fn(async () => result(removed)),
    })
    await activate(controller)

    await controller.removeCollectionMember(
      "collection-proposals",
      identity,
      "Proposal"
    )

    expect(controller.getSnapshot().snapshot?.preferences).toEqual([
      {
        ...initial.preferences[0],
        collectionIds: [],
      },
    ])
  })

  it("coalesces privacy-safe newer cross-tab hints into one authoritative refresh", async () => {
    const callbacks: Array<() => void> = []
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(result(snapshot(1)))
      .mockResolvedValueOnce(result(snapshot(4)))
    const channel: LibraryInvalidationChannel = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    const client = controllerHarness({ readSnapshot }).client
    const controller = new LibraryPreferenceController({
      client,
      sessionId: "session-current",
      createIdempotencyKey: () => "mutation-key-1",
      createInvalidationChannel: () => channel,
      scheduleInvalidation: (callback) => callbacks.push(callback),
    })
    await activate(controller)
    const invalidated = vi.fn()
    controller.subscribeDiscoveryInvalidation(invalidated)

    channel.onmessage?.(
      new MessageEvent("message", {
        data: {
          schemaVersion: 1,
          type: "library-invalidated",
          workspaceRevision: 9,
          sourceSessionId: "session-current",
        },
      })
    )
    channel.onmessage?.(new MessageEvent("message", { data: { nope: true } }))
    for (const workspaceRevision of [2, 3, 4]) {
      channel.onmessage?.(
        new MessageEvent("message", {
          data: {
            schemaVersion: 1,
            type: "library-invalidated",
            workspaceRevision,
            sourceSessionId: "session-other",
          },
        })
      )
    }
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.()
    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(controller.getSnapshot().snapshot?.workspaceRevision).toBe(4)
    )
    expect(invalidated).toHaveBeenCalledTimes(1)
    expect(invalidated).toHaveBeenCalledWith(4)
  })

  it("keeps every collection and Recent failure action-specific and independently retryable", async () => {
    const rejected = vi.fn(async () => {
      throw knownFailure()
    })
    const { controller } = controllerHarness({
      recordUsed: rejected,
      createCollection: rejected,
      renameCollection: rejected,
      deleteCollection: rejected,
      addCollectionMember: rejected,
      removeCollectionMember: rejected,
      reorderCollectionMembers: rejected,
    })
    await activate(controller)

    await controller.recordUsed(
      identity,
      "Proposal",
      "create",
      "document-created-1"
    )
    await controller.createCollection("Campaigns")
    await controller.renameCollection("collection-proposals", "Quotes")
    await controller.deleteCollection("collection-proposals")
    await controller.addCollectionMember(
      "collection-proposals",
      identity,
      "Proposal"
    )
    await controller.removeCollectionMember(
      "collection-proposals",
      identity,
      "Proposal"
    )
    await controller.reorderCollectionMembers("collection-proposals", [])

    expect(
      [...controller.getSnapshot().failures.values()].map(
        ({ message }) => message
      )
    ).toEqual([
      "Proposal was used, but Studio couldn't update Recent",
      "Couldn't create Campaigns",
      "Couldn't rename Proposals",
      "Couldn't delete Proposals",
      "Couldn't add Proposal to Proposals",
      "Couldn't remove Proposal from Proposals",
      "Couldn't reorder Proposals",
    ])
    expect(controller.getSnapshot().pending.size).toBe(0)
    expect(controller.getSnapshot().snapshotStatus).toBe("ready")
  })

  it("does not require BroadcastChannel for reads or mutations", async () => {
    const setFavorite = vi.fn(async () => result(favoriteReceipt(2, 1, true)))
    const client = controllerHarness({ setFavorite }).client
    const controller = new LibraryPreferenceController({
      client,
      sessionId: "session-current",
      createIdempotencyKey: () => "mutation-key-1",
      createInvalidationChannel: () => {
        throw new Error("unavailable")
      },
    })
    await activate(controller)
    await expect(
      controller.setFavorite(identity, "Proposal", true)
    ).resolves.toBe(true)
  })
})
