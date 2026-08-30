import { afterEach, describe, expect, it, vi } from "vitest"
import type { LocalAssetPromotion } from "@webmcp/document"
import {
  localAssetPromotionJournalSchema,
  LocalAssetPromotionBusyError,
  LocalAssetPromotionCheckpointError,
  LocalAssetPromotionJournalRevisionError,
} from "./local-asset-promotion-journal"
import type {
  CreateLocalAssetPromotionJournalInput,
  LocalAssetPromotionJournal,
  LocalAssetPromotionJournalPatch,
} from "./local-asset-promotion-journal"
import { LocalAssetPromotionHttpError } from "./local-asset-promotion-client"
import {
  hashLocalAssetBlobSha256,
  startLocalAssetPromotion,
} from "./local-asset-promotion-owner"
import type {
  LocalAssetPromotionOwnerDependencies,
  LocalAssetPromotionOwnerInput,
} from "./local-asset-promotion-owner"
import type { LocalAssetRecord } from "./local-asset-store"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const START = Date.parse("2026-08-30T00:00:00.000Z")

const sourceInput: LocalAssetPromotionOwnerInput = {
  localAssetId: "local-photo-1",
  sourceDocumentId: "document-1",
  sourceContentSnapshotId: `sha256-${"c".repeat(64)}`,
  sourceHistorySnapshotId: "history-1",
  sourceOperationVersion: 7,
  sourceDraftRecordVersion: 4,
  sourceDraftSnapshotId: `sha256-${"d".repeat(64)}`,
  sourceLocalAssetRevision: 3,
  expectedReferenceKeys: ["node/image-1/src"],
}

const localRecord: LocalAssetRecord = {
  schemaVersion: 4,
  id: sourceInput.localAssetId,
  name: "portrait.png",
  mediaType: "image/png",
  size: 3,
  width: 1,
  height: 1,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  lastUsedAt: "2026-08-29T00:00:00.000Z",
  archivedAt: null,
  revision: sourceInput.sourceLocalAssetRevision,
  integrity: "ready",
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
}

const promotion = (contentSha256 = HASH_A): LocalAssetPromotion => ({
  localAssetId: sourceInput.localAssetId,
  contentSha256,
  asset: {
    id: "asset-abcdefghij",
    name: "portrait.png",
    mediaType: "image/png",
    bytes: 3,
    width: 1,
    height: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
    status: "ready",
    selectable: true,
    revision: 1,
  },
})

const journalFor = (
  state: LocalAssetPromotionJournal["state"],
  overrides: Partial<LocalAssetPromotionJournal> = {}
) => {
  const hasContent = !["queued", "hashing", "cancelled", "failed"].includes(
    state
  )
  const hasMapping = ["mapped", "relinking", "complete", "conflict"].includes(
    state
  )
  const mapped = hasMapping
    ? promotion(state === "conflict" ? HASH_B : HASH_A)
    : null
  return localAssetPromotionJournalSchema.parse({
    schemaVersion: 1,
    localAssetId: sourceInput.localAssetId,
    revision: 1,
    contentSha256: hasContent ? HASH_A : null,
    idempotencyKey: "promotion-key-1",
    attempt: state === "queued" || state === "hashing" ? 0 : 1,
    state,
    managedAssetId: mapped?.asset.id ?? null,
    managedContentSha256: mapped?.contentSha256 ?? null,
    managedStatus: mapped?.asset.status ?? null,
    managedAssetRevision: mapped?.asset.revision ?? null,
    sourceDocumentId: sourceInput.sourceDocumentId,
    sourceContentSnapshotId: sourceInput.sourceContentSnapshotId,
    sourceHistorySnapshotId: sourceInput.sourceHistorySnapshotId,
    sourceOperationVersion: sourceInput.sourceOperationVersion,
    sourceDraftRecordVersion: sourceInput.sourceDraftRecordVersion,
    sourceDraftSnapshotId: sourceInput.sourceDraftSnapshotId,
    sourceLocalAssetRevision: sourceInput.sourceLocalAssetRevision,
    expectedReferenceKeys: sourceInput.expectedReferenceKeys,
    mappingRequestId: mapped ? "request-map-1" : null,
    relinkResultContentSnapshotId: null,
    relinkResultHistorySnapshotId: null,
    relinkResultDraftSnapshotId: null,
    relinkResultDraftRecordVersion: null,
    relinkCommitId: null,
    relinkUndoable: null,
    errorCode: null,
    errorRequestId: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    lease: null,
    ...overrides,
  })
}

type Harness = ReturnType<typeof createHarness>

const createHarness = (
  initial: LocalAssetPromotionJournal | null = null,
  timing: { leaseRenewalMilliseconds?: number } = {}
) => {
  let journal = initial
  let clock = 0
  const updates: LocalAssetPromotionJournal[] = []
  const uploadPromotion = vi.fn<
    LocalAssetPromotionOwnerDependencies["uploadPromotion"]
  >(async () => ({ promotion: promotion(), requestId: "request-upload-1" }))
  const lookupPromotion = vi.fn<
    LocalAssetPromotionOwnerDependencies["lookupPromotion"]
  >(async () => ({ promotion: null, requestId: "request-lookup-1" }))
  const readLocalAsset = vi.fn<
    LocalAssetPromotionOwnerDependencies["readLocalAsset"]
  >(async () => localRecord)
  const hashBlob = vi.fn<LocalAssetPromotionOwnerDependencies["hashBlob"]>(
    async () => HASH_A
  )
  const now = () => new Date(START + clock++ * 1_000).toISOString()
  const parse = (next: LocalAssetPromotionJournal) => {
    journal = localAssetPromotionJournalSchema.parse(next)
    updates.push(journal)
    return journal
  }
  const dependencies: Partial<LocalAssetPromotionOwnerDependencies> = {
    now,
    createId: vi
      .fn()
      .mockReturnValueOnce("promotion-key-1")
      .mockReturnValueOnce("owner-1")
      .mockReturnValueOnce("lease-1")
      .mockImplementation(() => `generated-${clock}`),
    readJournal: vi.fn(async () =>
      journal
        ? { status: "ready" as const, journal }
        : { status: "missing" as const }
    ),
    createJournal: vi.fn(
      async (input: CreateLocalAssetPromotionJournalInput) => {
        if (journal) return journal
        return parse(
          journalFor("queued", {
            idempotencyKey: input.idempotencyKey,
            createdAt: input.now ?? now(),
            updatedAt: input.now ?? now(),
          })
        )
      }
    ),
    claimJournal: vi.fn(async (input) => {
      if (!journal || journal.revision !== input.expectedRevision) {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      if (
        journal.lease &&
        Date.parse(journal.lease.expiresAt) > Date.parse(input.now ?? now())
      ) {
        throw new LocalAssetPromotionBusyError()
      }
      return parse({
        ...journal,
        revision: journal.revision + 1,
        updatedAt: input.now ?? now(),
        lease: {
          ownerId: input.ownerId,
          token: input.leaseToken ?? "lease-generated",
          expiresAt: new Date(
            Date.parse(input.now ?? now()) + input.leaseMilliseconds
          ).toISOString(),
        },
      })
    }),
    renewJournal: vi.fn(async (input) => {
      if (!journal || journal.revision !== input.expectedRevision) {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      return parse({
        ...journal,
        revision: journal.revision + 1,
        updatedAt: input.now ?? now(),
        lease: {
          ownerId: input.ownerId,
          token: input.leaseToken,
          expiresAt: new Date(
            Date.parse(input.now ?? now()) + input.leaseMilliseconds
          ).toISOString(),
        },
      })
    }),
    updateJournal: vi.fn(async (input) => {
      if (!journal || journal.revision !== input.expectedRevision) {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      return parse({
        ...journal,
        ...(input.patch as LocalAssetPromotionJournalPatch),
        revision: journal.revision + 1,
        updatedAt: input.now ?? now(),
      })
    }),
    releaseJournal: vi.fn(async (input) => {
      if (!journal || journal.revision !== input.expectedRevision) {
        throw new LocalAssetPromotionJournalRevisionError()
      }
      return parse({
        ...journal,
        revision: journal.revision + 1,
        updatedAt: input.now ?? now(),
        lease: null,
      })
    }),
    readLocalAsset,
    hashBlob,
    lookupPromotion,
    uploadPromotion,
    leaseMilliseconds: 90_000,
    leaseRenewalMilliseconds: timing.leaseRenewalMilliseconds ?? 30_000,
  }
  return {
    dependencies,
    updates,
    uploadPromotion,
    lookupPromotion,
    readLocalAsset,
    hashBlob,
    journal: () => journal,
  }
}

const run = (harness: Harness, input = sourceInput) =>
  startLocalAssetPromotion(input, { dependencies: harness.dependencies })

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("local asset promotion owner", () => {
  it("persists the initial checkpoint before local or network work", async () => {
    const harness = createHarness()
    ;(
      harness.dependencies.createJournal as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new LocalAssetPromotionCheckpointError())

    await expect(run(harness).promise).rejects.toMatchObject({
      code: "local_promotion_checkpoint_failed",
    })
    expect(harness.readLocalAsset).not.toHaveBeenCalled()
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it.each(["readJournal", "createJournal", "claimJournal"] as const)(
    "normalizes unexpected initial %s failure without network work",
    async (boundary) => {
      const harness = createHarness()
      ;(
        harness.dependencies[boundary] as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("IndexedDB unavailable"))

      await expect(run(harness).promise).rejects.toMatchObject({
        code: "local_promotion_checkpoint_failed",
      })
      expect(harness.lookupPromotion).not.toHaveBeenCalled()
      expect(harness.uploadPromotion).not.toHaveBeenCalled()
    }
  )

  it("preserves the corrupt-journal identity and starts no network work", async () => {
    const harness = createHarness()
    ;(
      harness.dependencies.readJournal as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      status: "corrupt",
      localAssetId: sourceInput.localAssetId,
    })

    await expect(run(harness).promise).rejects.toMatchObject({
      code: "local_promotion_journal_corrupt",
    })
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("acknowledges a create that commits after cancellation without claiming a lease", async () => {
    const harness = createHarness()
    const createStarted = deferred<void>()
    const commitCreate = deferred<void>()
    const createJournal = harness.dependencies.createJournal as ReturnType<
      typeof vi.fn
    >
    const originalCreate =
      createJournal.getMockImplementation() as LocalAssetPromotionOwnerDependencies["createJournal"]
    createJournal.mockImplementationOnce(async (input, signal) => {
      createStarted.resolve()
      await commitCreate.promise
      return originalCreate(input, signal)
    })
    const task = run(harness)
    await createStarted.promise

    task.cancel()
    commitCreate.resolve()

    await expect(task.promise).rejects.toMatchObject({ name: "AbortError" })
    expect(harness.journal()).toMatchObject({ state: "queued", lease: null })
    expect(harness.dependencies.claimJournal).not.toHaveBeenCalled()
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
    })
  })

  it("settles and releases a claim that commits after cancellation", async () => {
    const harness = createHarness()
    const claimStarted = deferred<void>()
    const commitClaim = deferred<void>()
    const claimJournal = harness.dependencies.claimJournal as ReturnType<
      typeof vi.fn
    >
    const originalClaim =
      claimJournal.getMockImplementation() as LocalAssetPromotionOwnerDependencies["claimJournal"]
    claimJournal.mockImplementationOnce(async (input, signal) => {
      claimStarted.resolve()
      await commitClaim.promise
      return originalClaim(input, signal)
    })
    const task = run(harness)
    await claimStarted.promise

    task.cancel()
    commitClaim.resolve()

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: { errorCode: "local_promotion_cancelled", lease: null },
    })
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it.each(["failed", "cancelled"] as const)(
    "releases a committed %s retry claim when cancellation arrives before work",
    async (startingState) => {
      const harness = createHarness(journalFor(startingState))
      const claimStarted = deferred<void>()
      const commitClaim = deferred<void>()
      const claimJournal = harness.dependencies.claimJournal as ReturnType<
        typeof vi.fn
      >
      const originalClaim =
        claimJournal.getMockImplementation() as LocalAssetPromotionOwnerDependencies["claimJournal"]
      claimJournal.mockImplementationOnce(async (input, signal) => {
        claimStarted.resolve()
        await commitClaim.promise
        return originalClaim(input, signal)
      })
      const task = run(harness)
      await claimStarted.promise

      task.cancel()
      commitClaim.resolve()

      await expect(task.promise).resolves.toMatchObject({
        status: "cancelled",
        journal: { lease: null },
      })
      expect(harness.lookupPromotion).not.toHaveBeenCalled()
      expect(harness.uploadPromotion).not.toHaveBeenCalled()
    }
  )

  it.each(["readJournal", "createJournal", "claimJournal"] as const)(
    "waits for initial %s abort acknowledgement and starts no network work",
    async (boundary) => {
      const harness = createHarness()
      const entered = deferred<void>()
      const acknowledge = deferred<void>()
      const original = harness.dependencies[boundary] as ReturnType<
        typeof vi.fn
      >
      original.mockImplementationOnce(async (...parameters: unknown[]) => {
        entered.resolve()
        const signal = parameters.at(-1) as AbortSignal
        await acknowledge.promise
        throw signal.reason
      })
      const task = run(harness)
      await entered.promise
      task.cancel()
      let settled = false
      void task.promise.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(harness.lookupPromotion).not.toHaveBeenCalled()
      expect(harness.uploadPromotion).not.toHaveBeenCalled()

      acknowledge.resolve()
      await expect(task.promise).rejects.toMatchObject({ name: "AbortError" })
      expect(harness.lookupPromotion).not.toHaveBeenCalled()
      expect(harness.uploadPromotion).not.toHaveBeenCalled()
    }
  )

  it("hashes exact stable local bytes, reconciles, checkpoints an attempt, and maps once", async () => {
    const harness = createHarness()
    const progress = vi.fn()
    const task = startLocalAssetPromotion(sourceInput, {
      dependencies: harness.dependencies,
      onProgress: progress,
    })

    await expect(task.promise).resolves.toMatchObject({
      status: "mapped",
      journal: {
        contentSha256: HASH_A,
        idempotencyKey: "promotion-key-1",
        attempt: 1,
        managedAssetId: "asset-abcdefghij",
        lease: null,
      },
    })
    expect(harness.readLocalAsset).toHaveBeenCalledTimes(2)
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(1)
    expect(harness.uploadPromotion).toHaveBeenCalledTimes(1)
    expect(harness.uploadPromotion.mock.calls[0]?.[0]).toMatchObject({
      localAssetId: sourceInput.localAssetId,
      idempotencyKey: "promotion-key-1",
      blob: localRecord.blob,
    })
    const uploading = harness.updates.find((item) => item.state === "uploading")
    expect(uploading?.attempt).toBe(1)
    expect(uploading?.contentSha256).toBe(HASH_A)
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ state: "uploading" })
    )
  })

  it("clears byte progress when upload leaves the active attempt", async () => {
    const harness = createHarness()
    harness.uploadPromotion.mockImplementationOnce(async (_input, options) => {
      options?.onProgress?.(2, 3)
      return { promotion: promotion(), requestId: "request-progress-1" }
    })
    const progress: Array<{
      state: string
      loaded: number | null
      total: number | null
    }> = []

    await expect(
      startLocalAssetPromotion(sourceInput, {
        dependencies: harness.dependencies,
        onProgress: (next) => progress.push(next),
      }).promise
    ).resolves.toMatchObject({ status: "mapped" })
    expect(progress).toContainEqual(
      expect.objectContaining({ state: "uploading", loaded: 2, total: 3 })
    )
    expect(progress.at(-2)).toMatchObject({
      state: "mapped",
      loaded: null,
      total: null,
    })
  })

  it("keeps observer failures advisory for completion and cancellation", async () => {
    const completionHarness = createHarness()
    await expect(
      startLocalAssetPromotion(sourceInput, {
        dependencies: completionHarness.dependencies,
        onProgress: () => {
          throw new Error("stale observer")
        },
      }).promise
    ).resolves.toMatchObject({ status: "mapped" })

    const cancellationHarness = createHarness()
    const uploadStarted = deferred<void>()
    cancellationHarness.uploadPromotion.mockImplementationOnce(
      async (_input, options) => {
        uploadStarted.resolve()
        return new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new LocalAssetPromotionHttpError({
                  code: "local_promotion_upload_cancelled",
                  status: 0,
                  message: "Cancelled",
                  retryable: true,
                  commitStatus: "unknown",
                })
              ),
            { once: true }
          )
        })
      }
    )
    const task = startLocalAssetPromotion(sourceInput, {
      dependencies: cancellationHarness.dependencies,
      onProgress: () => {
        throw new Error("stale observer")
      },
    })
    await uploadStarted.promise

    expect(() => task.cancel()).not.toThrow()
    await expect(task.promise).resolves.toMatchObject({
      status: "status_unknown",
    })
  })

  it("resumes a status-unknown operation by reconciling before any upload", async () => {
    const harness = createHarness(journalFor("status_unknown"))
    harness.lookupPromotion.mockResolvedValueOnce({
      promotion: promotion(),
      requestId: "request-reconcile-1",
    })

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
      journal: { mappingRequestId: "request-reconcile-1" },
    })
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(1)
    expect(harness.readLocalAsset).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
    expect(harness.updates.map((item) => item.state)).toContain("reconciling")
  })

  it("reconciles an attempted failed checkpoint before requiring missing local bytes", async () => {
    const harness = createHarness(
      journalFor("failed", {
        attempt: 1,
        contentSha256: HASH_A,
        errorCode: "local_asset_missing",
      })
    )
    harness.readLocalAsset.mockResolvedValue(null)
    harness.lookupPromotion.mockResolvedValueOnce({
      promotion: promotion(),
      requestId: "request-late-mapping-1",
    })

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
      journal: { mappingRequestId: "request-late-mapping-1" },
    })
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(1)
    expect(harness.readLocalAsset).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("records an exact alias conflict and never uploads different bytes", async () => {
    const harness = createHarness(journalFor("status_unknown"))
    harness.lookupPromotion.mockResolvedValueOnce({
      promotion: promotion(HASH_B),
      requestId: "request-conflict-1",
    })

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "conflict",
      journal: {
        contentSha256: HASH_A,
        managedContentSha256: HASH_B,
        mappingRequestId: "request-conflict-1",
      },
    })
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("turns a crashed uploading checkpoint into status unknown and reconciles before retry", async () => {
    const harness = createHarness(journalFor("uploading"))
    harness.lookupPromotion.mockResolvedValueOnce({
      promotion: null,
      requestId: "request-missing-1",
    })

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
      journal: { attempt: 2, idempotencyKey: "promotion-key-1" },
    })
    expect(harness.lookupPromotion.mock.invocationCallOrder[0]).toBeLessThan(
      harness.uploadPromotion.mock.invocationCallOrder[0]
    )
    expect(harness.uploadPromotion.mock.calls[0]?.[0].idempotencyKey).toBe(
      "promotion-key-1"
    )
  })

  it("reconciles a network loss that may have committed and does not duplicate upload", async () => {
    const harness = createHarness()
    harness.uploadPromotion.mockRejectedValueOnce(
      new LocalAssetPromotionHttpError({
        code: "local_promotion_network_error",
        status: 0,
        message: "Connection lost",
        requestId: "request-upload-lost",
        retryable: true,
        commitStatus: "unknown",
      })
    )
    harness.lookupPromotion
      .mockResolvedValueOnce({
        promotion: null,
        requestId: "request-before-upload",
      })
      .mockResolvedValueOnce({
        promotion: promotion(),
        requestId: "request-after-upload",
      })

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
      journal: { mappingRequestId: "request-after-upload", attempt: 1 },
    })
    expect(harness.uploadPromotion).toHaveBeenCalledTimes(1)
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(2)
  })

  it("keeps an unknown upload truthful when reconciliation finds no mapping", async () => {
    const harness = createHarness()
    harness.uploadPromotion.mockRejectedValueOnce(
      new LocalAssetPromotionHttpError({
        code: "local_promotion_upload_timeout",
        status: 0,
        message: "Timed out",
        requestId: "request-timeout",
        retryable: true,
        commitStatus: "unknown",
      })
    )

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "status_unknown",
      journal: {
        attempt: 1,
        errorCode: "local_promotion_status_unknown",
        lease: null,
      },
    })
    expect(harness.uploadPromotion).toHaveBeenCalledTimes(1)
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(2)
  })

  it("reports missing local bytes after a status-unknown retry reconciles unmapped", async () => {
    const harness = createHarness(journalFor("status_unknown"))
    harness.readLocalAsset.mockResolvedValueOnce(null)

    await expect(run(harness).promise).resolves.toMatchObject({
      status: "failed",
      journal: { errorCode: "local_asset_missing", lease: null },
    })
    expect(harness.lookupPromotion).toHaveBeenCalledTimes(1)
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("waits for upload abort acknowledgement, publishes cancelling, then reconciles", async () => {
    const harness = createHarness()
    const uploadStarted = deferred<void>()
    const abortObserved = deferred<void>()
    const acknowledgeAbort = deferred<void>()
    harness.uploadPromotion.mockImplementationOnce(async (_input, options) => {
      uploadStarted.resolve()
      return new Promise((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            abortObserved.resolve()
            void acknowledgeAbort.promise.then(() =>
              reject(
                new LocalAssetPromotionHttpError({
                  code: "local_promotion_upload_cancelled",
                  status: 0,
                  message: "Cancelled",
                  retryable: true,
                  commitStatus: "unknown",
                })
              )
            )
          },
          { once: true }
        )
      })
    })
    const progress = vi.fn()
    const task = startLocalAssetPromotion(sourceInput, {
      dependencies: harness.dependencies,
      onProgress: progress,
    })
    await uploadStarted.promise

    task.cancel()
    await abortObserved.promise
    let settled = false
    void task.promise.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ state: "cancelling" })
    )

    acknowledgeAbort.resolve()
    await expect(task.promise).resolves.toMatchObject({
      status: "status_unknown",
      journal: { lease: null },
    })
  })

  it("cancels after the attempt checkpoint without issuing the request", async () => {
    const harness = createHarness()
    const taskReference: {
      current: ReturnType<typeof startLocalAssetPromotion> | null
    } = { current: null }
    const task = startLocalAssetPromotion(sourceInput, {
      dependencies: harness.dependencies,
      onProgress: (progress) => {
        if (progress.state === "uploading") taskReference.current?.cancel()
      },
    })
    taskReference.current = task

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: { attempt: 1, lease: null },
    })
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("waits for an in-flight uploading checkpoint, then cancels durably before sending", async () => {
    const harness = createHarness()
    const checkpointStarted = deferred<void>()
    const acknowledgeCheckpoint = deferred<void>()
    const updateJournal = harness.dependencies.updateJournal as ReturnType<
      typeof vi.fn
    >
    const originalUpdate =
      updateJournal.getMockImplementation() as LocalAssetPromotionOwnerDependencies["updateJournal"]
    updateJournal.mockImplementation(async (input) => {
      if (input.patch.state === "uploading") {
        checkpointStarted.resolve()
        await acknowledgeCheckpoint.promise
      }
      return originalUpdate(input)
    })
    const task = run(harness)
    await checkpointStarted.promise

    task.cancel()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
    acknowledgeCheckpoint.resolve()

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: {
        attempt: 1,
        errorCode: "local_promotion_cancelled",
        lease: null,
      },
    })
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("cancels hashing after acknowledgement without starting network work", async () => {
    const harness = createHarness()
    const hashingStarted = deferred<void>()
    const acknowledgeAbort = deferred<void>()
    harness.hashBlob.mockImplementationOnce(async (_blob, signal) => {
      hashingStarted.resolve()
      return new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            void acknowledgeAbort.promise.then(() => reject(signal.reason))
          },
          { once: true }
        )
      })
    })
    const task = run(harness)
    await hashingStarted.promise
    task.cancel()
    acknowledgeAbort.resolve()

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: { errorCode: "local_promotion_cancelled", lease: null },
    })
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("persists the canonical cancellation code for an arbitrary caller abort reason", async () => {
    const harness = createHarness()
    const hashingStarted = deferred<void>()
    const acknowledgeAbort = deferred<void>()
    harness.hashBlob.mockImplementationOnce(async (_blob, signal) => {
      hashingStarted.resolve()
      return new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            void acknowledgeAbort.promise.then(() => reject(signal.reason))
          },
          { once: true }
        )
      })
    })
    const controller = new AbortController()
    const task = startLocalAssetPromotion(sourceInput, {
      signal: controller.signal,
      dependencies: harness.dependencies,
    })
    await hashingStarted.promise

    controller.abort(new Error("caller session replaced"))
    acknowledgeAbort.resolve()

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: { errorCode: "local_promotion_cancelled", lease: null },
    })
  })

  it("settles cancellation after reconciliation and before the upload checkpoint", async () => {
    const harness = createHarness()
    const controller = new AbortController()
    const task = startLocalAssetPromotion(sourceInput, {
      signal: controller.signal,
      dependencies: harness.dependencies,
      onProgress: (progress) => {
        if (progress.state === "reconciling") {
          controller.abort(new Error("editor session replaced"))
        }
      },
    })

    await expect(task.promise).resolves.toMatchObject({
      status: "cancelled",
      journal: { errorCode: "local_promotion_cancelled", lease: null },
    })
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it("waits for local IndexedDB read abort acknowledgement before retry can proceed", async () => {
    const harness = createHarness()
    const readStarted = deferred<void>()
    const acknowledgeAbort = deferred<void>()
    harness.readLocalAsset.mockImplementationOnce(async (_assetId, signal) => {
      readStarted.resolve()
      return new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            void acknowledgeAbort.promise.then(() => reject(signal.reason))
          },
          { once: true }
        )
      })
    })
    const first = run(harness)
    await readStarted.promise
    first.cancel()
    const second = run(harness)
    const busy = expect(second.promise).rejects.toMatchObject({
      code: "local_promotion_busy",
    })
    await Promise.resolve()
    expect(harness.readLocalAsset).toHaveBeenCalledTimes(1)
    expect(harness.lookupPromotion).not.toHaveBeenCalled()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()

    acknowledgeAbort.resolve()
    await busy
    await expect(first.promise).resolves.toMatchObject({ status: "cancelled" })
    await expect(run(harness).promise).resolves.toMatchObject({
      status: "mapped",
    })
  })

  it("waits for initial reconciliation cancellation and starts no upload", async () => {
    const harness = createHarness()
    const lookupStarted = deferred<void>()
    const acknowledgeAbort = deferred<void>()
    harness.lookupPromotion.mockImplementationOnce(
      async (_assetId, options) => {
        lookupStarted.resolve()
        return new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              void acknowledgeAbort.promise.then(() =>
                reject(options.signal?.reason)
              )
            },
            { once: true }
          )
        })
      }
    )
    const task = run(harness)
    await lookupStarted.promise
    task.cancel()
    await Promise.resolve()
    expect(harness.uploadPromotion).not.toHaveBeenCalled()

    acknowledgeAbort.resolve()
    await expect(task.promise).resolves.toMatchObject({ status: "cancelled" })
    expect(harness.uploadPromotion).not.toHaveBeenCalled()
  })

  it.each(["mapped", "relinking"] as const)(
    "resumes %s without local reads, hashing, reconciliation, or upload",
    async (state) => {
      const harness = createHarness(journalFor(state))

      await expect(run(harness).promise).resolves.toMatchObject({
        status: state,
      })
      expect(harness.readLocalAsset).not.toHaveBeenCalled()
      expect(harness.hashBlob).not.toHaveBeenCalled()
      expect(harness.lookupPromotion).not.toHaveBeenCalled()
      expect(harness.uploadPromotion).not.toHaveBeenCalled()
    }
  )

  it("renews a finite lease while an upload is active", async () => {
    vi.useFakeTimers()
    const harness = createHarness(null, { leaseRenewalMilliseconds: 10 })
    const upload = deferred<{
      promotion: LocalAssetPromotion
      requestId: string
    }>()
    harness.uploadPromotion.mockReturnValueOnce(upload.promise)
    const task = run(harness)
    await vi.waitFor(() => expect(harness.uploadPromotion).toHaveBeenCalled())

    await vi.advanceTimersByTimeAsync(11)
    expect(harness.dependencies.renewJournal).toHaveBeenCalled()
    upload.resolve({ promotion: promotion(), requestId: "request-renewed" })
    await expect(task.promise).resolves.toMatchObject({ status: "mapped" })
  })

  it("aborts active upload on lease loss and cannot publish a late mapping", async () => {
    vi.useFakeTimers()
    const harness = createHarness(null, { leaseRenewalMilliseconds: 10 })
    ;(
      harness.dependencies.renewJournal as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new LocalAssetPromotionJournalRevisionError())
    harness.uploadPromotion.mockImplementationOnce(
      async (_input, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new LocalAssetPromotionHttpError({
                  code: "local_promotion_upload_cancelled",
                  status: 0,
                  message: "Lease lost",
                  retryable: true,
                  commitStatus: "unknown",
                })
              ),
            { once: true }
          )
        })
    )
    const task = run(harness)
    const rejected = expect(task.promise).rejects.toMatchObject({
      code: "local_promotion_revision_conflict",
    })
    await vi.waitFor(() => expect(harness.uploadPromotion).toHaveBeenCalled())

    await vi.advanceTimersByTimeAsync(11)

    await rejected
    expect(harness.journal()?.state).toBe("uploading")
    expect(harness.updates.some((item) => item.state === "mapped")).toBe(false)
  })

  it("rejects noncooperative late upload success and progress after lease loss", async () => {
    vi.useFakeTimers()
    const harness = createHarness(null, { leaseRenewalMilliseconds: 10 })
    ;(
      harness.dependencies.renewJournal as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new LocalAssetPromotionJournalRevisionError())
    const lateUpload = deferred<{
      promotion: LocalAssetPromotion
      requestId: string
    }>()
    let lateProgress:
      ((loaded: number, total: number | null) => void) | undefined
    harness.uploadPromotion.mockImplementationOnce(async (_input, options) => {
      lateProgress = options?.onProgress
      return lateUpload.promise
    })
    const progress = vi.fn()
    const task = startLocalAssetPromotion(sourceInput, {
      dependencies: harness.dependencies,
      onProgress: progress,
    })
    const rejected = expect(task.promise).rejects.toMatchObject({
      code: "local_promotion_revision_conflict",
    })
    await vi.waitFor(() => expect(harness.uploadPromotion).toHaveBeenCalled())

    await vi.advanceTimersByTimeAsync(11)
    const progressCountAfterLoss = progress.mock.calls.length
    lateProgress?.(3, 3)
    lateUpload.resolve({ promotion: promotion(), requestId: "request-late-1" })

    await rejected
    expect(progress).toHaveBeenCalledTimes(progressCountAfterLoss)
    expect(harness.journal()?.state).toBe("uploading")
    expect(harness.updates.some((item) => item.state === "mapped")).toBe(false)
  })
})

class ImmediateFileReader extends EventTarget {
  static readonly EMPTY = 0
  static readonly LOADING = 1
  static readonly DONE = 2
  readyState = ImmediateFileReader.EMPTY
  result: ArrayBuffer | null = null

  readAsArrayBuffer(blob: Blob) {
    this.readyState = ImmediateFileReader.LOADING
    void blob.arrayBuffer().then((result) => {
      if (this.readyState !== ImmediateFileReader.LOADING) return
      this.result = result
      this.readyState = ImmediateFileReader.DONE
      this.dispatchEvent(new Event("load"))
    })
  }

  abort() {
    if (this.readyState !== ImmediateFileReader.LOADING) return
    this.readyState = ImmediateFileReader.DONE
    this.dispatchEvent(new Event("abort"))
  }
}

describe("bounded local asset hashing", () => {
  it("matches the SHA-256 standard vector", async () => {
    vi.stubGlobal("FileReader", ImmediateFileReader)
    await expect(hashLocalAssetBlobSha256(new Blob(["abc"]))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
  })

  it("hashes across bounded chunk boundaries", async () => {
    vi.stubGlobal("FileReader", ImmediateFileReader)
    const bytes = new Uint8Array(300_000)
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251
    }
    const expected = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")

    await expect(hashLocalAssetBlobSha256(new Blob([bytes]))).resolves.toBe(
      expected
    )
  })

  it.each([55, 56, 63, 64, 65])(
    "matches Web Crypto at the SHA-256 padding boundary for %i bytes",
    async (length) => {
      vi.stubGlobal("FileReader", ImmediateFileReader)
      const bytes = new Uint8Array(length)
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 37 + 11) % 256
      }
      const expected = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")

      await expect(hashLocalAssetBlobSha256(new Blob([bytes]))).resolves.toBe(
        expected
      )
    }
  )

  it("waits for FileReader abort acknowledgement", async () => {
    class ControlledFileReader extends ImmediateFileReader {
      static instance: ControlledFileReader | null = null
      constructor() {
        super()
        ControlledFileReader.instance = this
      }
      override readAsArrayBuffer() {
        this.readyState = ImmediateFileReader.LOADING
      }
      override abort() {
        // The test acknowledges abort explicitly below.
      }
      acknowledgeAbort() {
        this.readyState = ImmediateFileReader.DONE
        this.dispatchEvent(new Event("abort"))
      }
    }
    vi.stubGlobal("FileReader", ControlledFileReader)
    const controller = new AbortController()
    const hashing = hashLocalAssetBlobSha256(
      new Blob(["abc"]),
      controller.signal
    )
    await vi.waitFor(() => expect(ControlledFileReader.instance).not.toBeNull())

    controller.abort(new DOMException("Cancelled", "AbortError"))
    let settled = false
    void hashing.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    ControlledFileReader.instance?.acknowledgeAbort()
    await expect(hashing).rejects.toMatchObject({ name: "AbortError" })
  })
})
