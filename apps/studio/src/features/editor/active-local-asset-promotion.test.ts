import { describe, expect, it, vi } from "vitest"
import {
  LocalAssetPromotionStartGate,
  startActiveLocalAssetPromotion,
} from "./active-local-asset-promotion"
import type { ActiveLocalAssetPromotionDependencies } from "./active-local-asset-promotion"
import { localAssetPromotionJournalSchema } from "./local-asset-promotion-journal"
import type { LocalAssetPromotionJournal } from "./local-asset-promotion-journal"

const sha = (character: string) => `sha256-${character.repeat(64)}`

describe("local asset promotion start gate", () => {
  it("admits one synchronous owner for rapid duplicate starts", async () => {
    const gate = new LocalAssetPromotionStartGate(() => "reservation-1")
    const owner = vi.fn(async () => {})
    const start = async () => {
      const token = gate.reserve("session-1\0document-1\0local-photo-1")
      if (!token) return false
      try {
        await owner()
        return true
      } finally {
        gate.release("session-1\0document-1\0local-photo-1", token)
      }
    }

    const [first, second] = await Promise.all([start(), start()])

    expect([first, second]).toEqual([true, false])
    expect(owner).toHaveBeenCalledTimes(1)
  })

  it("cancels and fences a reserved preflight before an owner starts", () => {
    const gate = new LocalAssetPromotionStartGate(() => "reservation-1")
    const key = "session-1\0document-1\0local-photo-1"
    const token = gate.reserve(key)!
    const signal = gate.signal(key, token)!

    expect(gate.cancel(key, token)).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(gate.cancel(key, token)).toBe(false)
    expect(gate.release(key, token)).toBe(true)
  })
})

const journalFor = (
  state: LocalAssetPromotionJournal["state"] = "mapped",
  patch: Partial<LocalAssetPromotionJournal> = {}
) =>
  localAssetPromotionJournalSchema.parse({
    schemaVersion: 1,
    localAssetId: "local-photo-1",
    revision: 5,
    contentSha256: "a".repeat(64),
    idempotencyKey: "upload-key-1",
    recentUseIdempotencyKey: "recent-key-document-1",
    attempt: 1,
    state,
    managedAssetId: "asset-1234567890",
    managedContentSha256: "a".repeat(64),
    managedStatus: "ready",
    managedAssetRevision: 2,
    sourceDocumentId: "document-1",
    sourceContentSnapshotId: sha("b"),
    sourceHistorySnapshotId: "history-1",
    sourceOperationVersion: 7,
    sourceDraftRecordVersion: 3,
    sourceDraftSnapshotId: sha("c"),
    sourceLocalAssetRevision: 4,
    expectedReferenceKeys: ["node/photo/src"],
    mappingRequestId: "mapping-request-1",
    relinkResultContentSnapshotId: null,
    relinkResultHistorySnapshotId: null,
    relinkResultOperationVersion: null,
    relinkResultKind: null,
    relinkResultDraftContentSnapshotId: null,
    relinkResultDraftSnapshotId: null,
    relinkResultDraftRecordVersion: null,
    relinkCommitId: null,
    relinkUndoable: null,
    recentUseUsedAt: null,
    recentUseAssetRevision: null,
    recentUseRequestId: null,
    errorCode: null,
    errorRequestId: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z",
    lease: null,
    ...patch,
  })

const ownerInput = {
  localAssetId: "local-photo-1",
  sourceDocumentId: "document-1",
  sourceContentSnapshotId: sha("b"),
  sourceHistorySnapshotId: "history-1",
  sourceOperationVersion: 7,
  sourceDraftRecordVersion: 3,
  sourceDraftSnapshotId: sha("c"),
  sourceLocalAssetRevision: 4,
  expectedReferenceKeys: ["node/photo/src"],
} as const

const eventually = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for controller progress")
}

const flushMicrotasks = async (iterations = 20) => {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

const relinkCheckpoint = {
  relinkResultContentSnapshotId: sha("d"),
  relinkResultHistorySnapshotId: "history-2",
  relinkResultOperationVersion: 8,
  relinkResultKind: "committed" as const,
  relinkCommitId: "commit-1",
  relinkUndoable: true,
}

const durableCheckpoint = {
  ...relinkCheckpoint,
  relinkResultDraftContentSnapshotId: sha("d"),
  relinkResultDraftSnapshotId: sha("e"),
  relinkResultDraftRecordVersion: 4,
}

const harness = (initial = journalFor()) => {
  let journal = initial
  let now = Date.parse("2026-08-30T00:00:02.000Z")
  const startOwner = vi.fn(() => ({
    promise: Promise.resolve({ status: journal.state, journal }),
    cancel: vi.fn(() => true),
  }))
  const claimJournal = vi.fn(async () => {
    journal = localAssetPromotionJournalSchema.parse({
      ...journal,
      revision: journal.revision + 1,
      updatedAt: new Date((now += 1_000)).toISOString(),
      lease: {
        ownerId: "owner-1",
        token: "lease-1",
        expiresAt: new Date(now + 90_000).toISOString(),
      },
    })
    return journal
  })
  const renewJournal = vi.fn(async () => journal)
  const updateJournal = vi.fn(async (input: { patch: object }) => {
    journal = localAssetPromotionJournalSchema.parse({
      ...journal,
      ...input.patch,
      revision: journal.revision + 1,
      updatedAt: new Date((now += 1_000)).toISOString(),
    })
    return journal
  })
  const releaseJournal = vi.fn(async () => {
    journal = localAssetPromotionJournalSchema.parse({
      ...journal,
      revision: journal.revision + 1,
      updatedAt: new Date((now += 1_000)).toISOString(),
      lease: null,
    })
    return journal
  })
  return {
    journal: () => journal,
    startOwner,
    claimJournal,
    renewJournal,
    updateJournal,
    releaseJournal,
  }
}

const dependenciesFor = (
  state: ReturnType<typeof harness>,
  overrides: Partial<ActiveLocalAssetPromotionDependencies> = {}
) => ({
  startOwner: state.startOwner as never,
  claimJournal: state.claimJournal as never,
  renewJournal: state.renewJournal as never,
  updateJournal: state.updateJournal as never,
  releaseJournal: state.releaseJournal as never,
  createId: vi
    .fn()
    .mockReturnValueOnce("operation-1")
    .mockReturnValueOnce("owner-1")
    .mockReturnValueOnce("lease-1"),
  now: () => new Date().toISOString(),
  leaseMilliseconds: 90_000,
  leaseRenewalMilliseconds: 60_000,
  mayPublish: () => true,
  applyOrRecognizeRelink: vi.fn(async (_journal, _signal, enterCritical) => {
    enterCritical(true)
    return {
      kind: "committed" as const,
      contentSnapshotId: sha("d"),
      historySnapshotId: "history-2",
      operationVersion: 8,
      commitId: "commit-1",
      undoable: true,
    }
  }),
  flushRelink: vi.fn(async () => ({
    documentId: "document-1",
    contentSnapshotId: sha("d"),
    draftSnapshotId: sha("e"),
    recordVersion: 4,
    savedAt: "2026-08-30T00:00:07.000Z",
  })),
  markManagedUsed: vi.fn(async (assetId) => ({
    assetId,
    usedAt: "2026-08-30T00:00:08.000Z",
    assetRevision: 3,
    requestId: "use-request-1",
  })),
  ...overrides,
})

describe("active local asset promotion", () => {
  it("checkpoints one truthful relink, durable draft, and idempotent Recent receipt", async () => {
    const state = harness()
    const dependencies = dependenciesFor(state)
    const operation = startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    })

    const result = await operation.promise

    expect(result.status).toBe("complete")
    expect(dependencies.applyOrRecognizeRelink).toHaveBeenCalledTimes(1)
    expect(dependencies.flushRelink).toHaveBeenCalledTimes(1)
    expect(dependencies.markManagedUsed).toHaveBeenCalledWith(
      "asset-1234567890",
      "recent-key-document-1"
    )
    expect(state.journal()).toMatchObject({
      state: "complete",
      relinkResultOperationVersion: 8,
      relinkCommitId: "commit-1",
      relinkUndoable: true,
      relinkResultDraftContentSnapshotId: sha("d"),
      recentUseRequestId: "use-request-1",
    })
  })

  it("keeps a verified mapping reusable when the mounted document is stale", async () => {
    const state = harness()
    const dependencies = dependenciesFor(state, {
      applyOrRecognizeRelink: vi.fn(async () => null),
    })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    }).promise

    expect(result).toMatchObject({ status: "backed_up", retryable: true })
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
    expect(state.journal()).toMatchObject({
      state: "relinking",
      relinkResultKind: null,
      errorCode: "local_relink_conflict",
    })
  })

  it("preserves non-Undo target-only replay truth", async () => {
    const state = harness()
    const dependencies = dependenciesFor(state, {
      applyOrRecognizeRelink: vi.fn(
        async (_journal, _signal, enterCritical) => {
          enterCritical(false)
          return {
            kind: "already_applied" as const,
            contentSnapshotId: sha("d"),
            historySnapshotId: "history-2",
            operationVersion: 8,
            commitId: null,
            undoable: false,
          }
        }
      ),
    })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    }).promise

    expect(result.status).toBe("complete")
    expect(state.journal()).toMatchObject({
      relinkResultKind: "already_applied",
      relinkCommitId: null,
      relinkUndoable: false,
    })
  })

  it("cancels during precommit validation without entering the durable phases", async () => {
    const state = harness()
    let continueValidation!: () => void
    const validation = new Promise<void>((resolve) => {
      continueValidation = resolve
    })
    const dependencies = dependenciesFor(state, {
      applyOrRecognizeRelink: vi.fn(async (_journal, signal) => {
        await validation
        signal.throwIfAborted()
        return null
      }),
    })
    const operation = startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    })
    await eventually(
      () =>
        vi.mocked(dependencies.applyOrRecognizeRelink).mock.calls.length === 1
    )

    expect(operation.cancel()).toBe(true)
    continueValidation()
    const result = await operation.promise

    expect(result.status).toBe("backed_up")
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
  })

  it("retains the relink checkpoint when the critical flush fails", async () => {
    const state = harness()
    const dependencies = dependenciesFor(state, {
      flushRelink: vi.fn(async () => null),
    })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    }).promise

    expect(result).toMatchObject({ status: "failed", retryable: true })
    expect(state.journal()).toMatchObject({
      state: "relinking",
      relinkResultKind: "committed",
      errorCode: "local_relink_persistence_failed",
    })
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
  })

  it("publishes Saving immediately and removes Cancel before the result CAS settles", async () => {
    const state = harness()
    let releaseResultCheckpoint!: () => void
    const resultCheckpoint = new Promise<void>((resolve) => {
      releaseResultCheckpoint = resolve
    })
    const ordinaryUpdate = state.updateJournal
    const updateJournal = vi.fn(
      async (input: { patch: { relinkResultKind?: unknown } }) => {
        if (input.patch.relinkResultKind) await resultCheckpoint
        return ordinaryUpdate(input)
      }
    )
    const phases: string[] = []
    const dependencies = dependenciesFor(state, {
      updateJournal,
    })
    const operation = startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
      onProgress: (progress) => phases.push(progress.phase),
    })
    await eventually(() => phases.includes("saving"))

    expect(operation.cancel()).toBe(false)
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    releaseResultCheckpoint()
    await expect(operation.promise).resolves.toMatchObject({
      status: "complete",
    })
  })

  it("resumes a checkpointed relink without dispatching another command", async () => {
    const state = harness(journalFor("relinking", relinkCheckpoint))
    const dependencies = dependenciesFor(state)

    await expect(
      startActiveLocalAssetPromotion(ownerInput, { dependencies }).promise
    ).resolves.toMatchObject({ status: "complete" })

    expect(dependencies.applyOrRecognizeRelink).not.toHaveBeenCalled()
    expect(dependencies.flushRelink).toHaveBeenCalledTimes(1)
  })

  it("resumes Recent accounting with the retained key and no relink or flush", async () => {
    const state = harness(
      journalFor("marking_used", {
        ...durableCheckpoint,
        managedStatus: "archived",
      })
    )
    const dependencies = dependenciesFor(state)

    await expect(
      startActiveLocalAssetPromotion(ownerInput, { dependencies }).promise
    ).resolves.toMatchObject({ status: "complete" })

    expect(dependencies.applyOrRecognizeRelink).not.toHaveBeenCalled()
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).toHaveBeenCalledWith(
      "asset-1234567890",
      "recent-key-document-1"
    )
  })

  it("drains a queued heartbeat before the terminal completion checkpoint", async () => {
    vi.useFakeTimers()
    try {
      const state = harness(
        journalFor("marking_used", {
          ...durableCheckpoint,
          managedStatus: "ready",
        })
      )
      let resolveHeartbeat!: (journal: LocalAssetPromotionJournal) => void
      const heartbeat = new Promise<LocalAssetPromotionJournal>((resolve) => {
        resolveHeartbeat = resolve
      })
      let resolveRecent!: (receipt: {
        assetId: string
        usedAt: string
        assetRevision: number
        requestId: string
      }) => void
      const recent = new Promise<{
        assetId: string
        usedAt: string
        assetRevision: number
        requestId: string
      }>((resolve) => {
        resolveRecent = resolve
      })
      const renewJournal = vi.fn(() => heartbeat)
      const dependencies = dependenciesFor(state, {
        renewJournal,
        leaseRenewalMilliseconds: 10,
        markManagedUsed: vi.fn(() => recent),
      })
      const operation = startActiveLocalAssetPromotion(ownerInput, {
        dependencies,
      })
      await flushMicrotasks()
      expect(dependencies.markManagedUsed).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10)
      expect(renewJournal).toHaveBeenCalledTimes(1)
      resolveRecent({
        assetId: "asset-1234567890",
        usedAt: "2026-08-30T00:00:08.000Z",
        assetRevision: 3,
        requestId: "use-request-1",
      })
      await flushMicrotasks()

      resolveHeartbeat(state.journal())
      await expect(operation.promise).resolves.toMatchObject({
        status: "complete",
      })
      expect(state.journal()).toMatchObject({
        state: "complete",
        lease: null,
        recentUseRequestId: "use-request-1",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("does no work for a completed receipt", async () => {
    const completed = journalFor("complete", {
      ...durableCheckpoint,
      recentUseUsedAt: "2026-08-30T00:00:08.000Z",
      recentUseAssetRevision: 3,
      recentUseRequestId: "use-request-1",
    })
    const state = harness(completed)
    const dependencies = dependenciesFor(state)

    await expect(
      startActiveLocalAssetPromotion(ownerInput, { dependencies }).promise
    ).resolves.toMatchObject({ status: "complete" })

    expect(dependencies.claimJournal).not.toHaveBeenCalled()
    expect(dependencies.applyOrRecognizeRelink).not.toHaveBeenCalled()
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
  })

  it("retains the durable receipt, Recent key, and request trace after an ambiguous use response", async () => {
    const state = harness(journalFor("marking_used", durableCheckpoint))
    const error = Object.assign(new Error("Response lost"), {
      code: "media_use_status_unknown",
      requestId: "request-ambiguous-1",
    })
    const dependencies = dependenciesFor(state, {
      markManagedUsed: vi.fn(async () => {
        throw error
      }),
    })

    await expect(
      startActiveLocalAssetPromotion(ownerInput, { dependencies }).promise
    ).resolves.toMatchObject({ status: "failed", retryable: true })

    expect(state.journal()).toMatchObject({
      state: "marking_used",
      recentUseIdempotencyKey: "recent-key-document-1",
      relinkResultDraftSnapshotId: sha("e"),
      errorCode: "media_use_status_unknown",
      errorRequestId: "request-ambiguous-1",
    })
  })

  it("replays the same Recent receipt identity after completion checkpoint loss", async () => {
    const state = harness(journalFor("marking_used", durableCheckpoint))
    const ordinaryUpdate = state.updateJournal
    let loseCompletionCheckpoint = true
    const updateJournal = vi.fn(
      async (input: {
        patch: { state?: LocalAssetPromotionJournal["state"] }
      }) => {
        if (input.patch.state === "complete" && loseCompletionCheckpoint) {
          throw Object.assign(new Error("Completion checkpoint lost"), {
            code: "local_promotion_revision_conflict",
          })
        }
        return ordinaryUpdate(input)
      }
    )
    const firstDependencies = dependenciesFor(state, { updateJournal })

    await expect(
      startActiveLocalAssetPromotion(ownerInput, {
        dependencies: firstDependencies,
      }).promise
    ).resolves.toMatchObject({ status: "failed", retryable: true })

    expect(firstDependencies.markManagedUsed).toHaveBeenCalledWith(
      "asset-1234567890",
      "recent-key-document-1"
    )
    expect(state.journal()).toMatchObject({
      state: "marking_used",
      recentUseIdempotencyKey: "recent-key-document-1",
      relinkResultDraftSnapshotId: sha("e"),
    })

    loseCompletionCheckpoint = false
    const retryDependencies = dependenciesFor(state, { updateJournal })
    await expect(
      startActiveLocalAssetPromotion(ownerInput, {
        dependencies: retryDependencies,
      }).promise
    ).resolves.toMatchObject({ status: "complete" })

    expect(retryDependencies.applyOrRecognizeRelink).not.toHaveBeenCalled()
    expect(retryDependencies.flushRelink).not.toHaveBeenCalled()
    expect(retryDependencies.markManagedUsed).toHaveBeenCalledWith(
      "asset-1234567890",
      "recent-key-document-1"
    )
    expect(state.journal()).toMatchObject({
      state: "complete",
      recentUseRequestId: "use-request-1",
    })
  })

  it("suppresses progress publication after mounted ownership is lost", async () => {
    const state = harness()
    const onProgress = vi.fn()
    const dependencies = dependenciesFor(state, { mayPublish: () => false })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
      onProgress,
    }).promise

    expect(result).toMatchObject({ status: "complete", published: false })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it("never reports completion after losing the relink-result CAS", async () => {
    const state = harness()
    const ordinaryUpdate = state.updateJournal
    const dependencies = dependenciesFor(state, {
      updateJournal: vi.fn(
        async (input: { patch: { relinkResultKind?: unknown } }) => {
          if (input.patch.relinkResultKind) {
            throw Object.assign(new Error("Lease lost"), {
              code: "local_promotion_lease_lost",
            })
          }
          return ordinaryUpdate(input)
        }
      ),
    })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    }).promise

    expect(result.status).toBe("failed")
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
    expect(state.journal().state).not.toBe("complete")
  })

  it("reasserts the lease after delayed validation before admitting a commit", async () => {
    const state = harness()
    const enterCritical = vi.fn()
    const dependencies = dependenciesFor(state, {
      renewJournal: vi.fn(async () => {
        throw Object.assign(new Error("Lease taken over"), {
          code: "local_promotion_lease_lost",
        })
      }),
      applyOrRecognizeRelink: vi.fn(
        async (_journal, _signal, _enterCritical, reassertOwned) => {
          await reassertOwned()
          enterCritical()
          return null
        }
      ),
    })

    const result = await startActiveLocalAssetPromotion(ownerInput, {
      dependencies,
    }).promise

    expect(result.status).toBe("failed")
    expect(enterCritical).not.toHaveBeenCalled()
    expect(dependencies.flushRelink).not.toHaveBeenCalled()
    expect(dependencies.markManagedUsed).not.toHaveBeenCalled()
  })
})
