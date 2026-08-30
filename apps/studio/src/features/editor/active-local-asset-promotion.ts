import { startLocalAssetPromotion } from "./local-asset-promotion-owner"
import type {
  LocalAssetPromotionOwnerInput,
  LocalAssetPromotionProgress,
} from "./local-asset-promotion-owner"
import {
  claimLocalAssetPromotionJournal,
  compareAndSwapLocalAssetPromotionJournal,
  releaseLocalAssetPromotionJournal,
  renewLocalAssetPromotionJournalLease,
} from "./local-asset-promotion-journal"
import type {
  LocalAssetPromotionJournal,
  LocalAssetPromotionJournalPatch,
} from "./local-asset-promotion-journal"

const RELINK_LEASE_MILLISECONDS = 90_000
const RELINK_LEASE_RENEWAL_MILLISECONDS = 30_000

export class LocalAssetPromotionStartGate {
  readonly #createId: () => string
  #reservation: Readonly<{
    key: string
    token: string
    controller: AbortController
  }> | null = null

  constructor(createId: () => string = () => crypto.randomUUID()) {
    this.#createId = createId
  }

  reserve(key: string) {
    if (this.#reservation) return null
    const token = this.#createId()
    this.#reservation = { key, token, controller: new AbortController() }
    return token
  }

  owns(key: string, token: string) {
    return this.#reservation?.key === key && this.#reservation.token === token
  }

  release(key: string, token: string) {
    if (!this.owns(key, token)) return false
    this.#reservation = null
    return true
  }

  signal(key: string, token: string) {
    return this.owns(key, token)
      ? (this.#reservation?.controller.signal ?? null)
      : null
  }

  cancel(key: string, token: string) {
    const reservation = this.#reservation
    if (
      !reservation ||
      !this.owns(key, token) ||
      reservation.controller.signal.aborted
    ) {
      return false
    }
    reservation.controller.abort(
      new DOMException("Image promotion was cancelled.", "AbortError")
    )
    return true
  }
}

export type ActiveLocalAssetPromotionPhase =
  | "preparing"
  | LocalAssetPromotionProgress["state"]
  | "backed_up"
  | "saving"
  | "updating_recent"

export type ActiveLocalAssetPromotionProgress = Readonly<{
  localAssetId: string
  phase: ActiveLocalAssetPromotionPhase
  loaded: number | null
  total: number | null
  message: string | null
  retryable: boolean
  undoable: boolean | null
}>

export type ActiveRelinkResult = Readonly<{
  kind: "committed" | "already_applied"
  contentSnapshotId: string
  historySnapshotId: string
  operationVersion: number
  commitId: string | null
  undoable: boolean
}>

export type DurableRelinkReceipt = Readonly<{
  documentId: string
  contentSnapshotId: string
  draftSnapshotId: string
  recordVersion: number
  savedAt: string
}>

export type ManagedRecentUseReceipt = Readonly<{
  assetId: string
  usedAt: string
  assetRevision: number
  requestId: string
}>

export type ActiveLocalAssetPromotionResult =
  | Readonly<{
      status: "complete"
      journal: LocalAssetPromotionJournal
      published: boolean
    }>
  | Readonly<{
      status:
        "backed_up" | "status_unknown" | "cancelled" | "failed" | "conflict"
      journal: LocalAssetPromotionJournal | null
      message: string
      retryable: boolean
    }>

export type ActiveLocalAssetPromotionDependencies = Readonly<{
  startOwner: typeof startLocalAssetPromotion
  claimJournal: typeof claimLocalAssetPromotionJournal
  renewJournal: typeof renewLocalAssetPromotionJournalLease
  updateJournal: typeof compareAndSwapLocalAssetPromotionJournal
  releaseJournal: typeof releaseLocalAssetPromotionJournal
  applyOrRecognizeRelink: (
    journal: LocalAssetPromotionJournal,
    signal: AbortSignal,
    enterCritical: (undoable: boolean) => void,
    reassertOwned: () => Promise<void>
  ) => Promise<ActiveRelinkResult | null>
  flushRelink: (
    journal: LocalAssetPromotionJournal,
    relink: ActiveRelinkResult
  ) => Promise<DurableRelinkReceipt | null>
  markManagedUsed: (
    assetId: string,
    idempotencyKey: string
  ) => Promise<ManagedRecentUseReceipt>
  onDurableRelink?: () => void
  mayPublish: (operationId: string) => boolean
  createId: () => string
  now: () => string
  leaseMilliseconds: number
  leaseRenewalMilliseconds: number
}>

const defaultDependencies: Omit<
  ActiveLocalAssetPromotionDependencies,
  "applyOrRecognizeRelink" | "flushRelink" | "markManagedUsed" | "mayPublish"
> = {
  startOwner: startLocalAssetPromotion,
  claimJournal: claimLocalAssetPromotionJournal,
  renewJournal: renewLocalAssetPromotionJournalLease,
  updateJournal: compareAndSwapLocalAssetPromotionJournal,
  releaseJournal: releaseLocalAssetPromotionJournal,
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  leaseMilliseconds: RELINK_LEASE_MILLISECONDS,
  leaseRenewalMilliseconds: RELINK_LEASE_RENEWAL_MILLISECONDS,
}

const errorIdentity = (error: unknown, fallback: string) => {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : fallback
  return /^[a-z][a-z0-9_]{0,127}$/.test(candidate) ? candidate : fallback
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const errorRequestId = (error: unknown) => {
  const candidate =
    error && typeof error === "object" && "requestId" in error
      ? error.requestId
      : null
  return typeof candidate === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)
    ? candidate
    : null
}

const isSignalAbort = (signal: AbortSignal, error: unknown) =>
  signal.aborted && error === signal.reason

class RelinkJournalLease {
  private currentJournal: LocalAssetPromotionJournal
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private failure: unknown = null

  constructor(
    journal: LocalAssetPromotionJournal,
    private readonly ownerId: string,
    private readonly token: string,
    private readonly dependencies: ActiveLocalAssetPromotionDependencies
  ) {
    this.currentJournal = journal
  }

  current() {
    return this.currentJournal
  }

  start() {
    this.heartbeat = setInterval(() => {
      void this.serialize(async () => {
        this.currentJournal = await this.dependencies.renewJournal({
          localAssetId: this.currentJournal.localAssetId,
          expectedRevision: this.currentJournal.revision,
          ownerId: this.ownerId,
          leaseToken: this.token,
          leaseMilliseconds: this.dependencies.leaseMilliseconds,
          now: this.dependencies.now(),
        })
      }).catch((error: unknown) => {
        this.failure = error
      })
    }, this.dependencies.leaseRenewalMilliseconds)
  }

  update(patch: LocalAssetPromotionJournalPatch) {
    return this.serialize(async () => {
      this.currentJournal = await this.dependencies.updateJournal({
        localAssetId: this.currentJournal.localAssetId,
        expectedRevision: this.currentJournal.revision,
        ownerId: this.ownerId,
        leaseToken: this.token,
        patch,
        now: this.dependencies.now(),
      })
      return this.currentJournal
    })
  }

  assertOwned() {
    return this.serialize(async () => {
      this.currentJournal = await this.dependencies.renewJournal({
        localAssetId: this.currentJournal.localAssetId,
        expectedRevision: this.currentJournal.revision,
        ownerId: this.ownerId,
        leaseToken: this.token,
        leaseMilliseconds: this.dependencies.leaseMilliseconds,
        now: this.dependencies.now(),
      })
      return this.currentJournal
    })
  }

  async prepareTerminal() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    await this.tail
    if (this.failure) throw this.failure
  }

  async release() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    await this.tail
    if (this.stopped) return this.currentJournal
    this.stopped = true
    if (this.failure) throw this.failure
    this.currentJournal = await this.dependencies.releaseJournal({
      localAssetId: this.currentJournal.localAssetId,
      expectedRevision: this.currentJournal.revision,
      ownerId: this.ownerId,
      leaseToken: this.token,
      now: this.dependencies.now(),
    })
    return this.currentJournal
  }

  private serialize<T>(operation: () => Promise<T>) {
    const result = this.tail.then(() => {
      if (this.stopped || this.failure)
        throw this.failure ?? new Error("Lease closed")
      return operation()
    })
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

const existingRelinkResult = (
  journal: LocalAssetPromotionJournal
): ActiveRelinkResult | null => {
  if (
    !journal.relinkResultKind ||
    !journal.relinkResultContentSnapshotId ||
    !journal.relinkResultHistorySnapshotId ||
    journal.relinkResultOperationVersion === null ||
    journal.relinkUndoable === null
  ) {
    return null
  }
  return {
    kind: journal.relinkResultKind,
    contentSnapshotId: journal.relinkResultContentSnapshotId,
    historySnapshotId: journal.relinkResultHistorySnapshotId,
    operationVersion: journal.relinkResultOperationVersion,
    commitId: journal.relinkCommitId,
    undoable: journal.relinkUndoable,
  }
}

export function startActiveLocalAssetPromotion(
  input: LocalAssetPromotionOwnerInput,
  options: {
    onProgress?: (progress: ActiveLocalAssetPromotionProgress) => void
    dependencies: Pick<
      ActiveLocalAssetPromotionDependencies,
      | "applyOrRecognizeRelink"
      | "flushRelink"
      | "markManagedUsed"
      | "mayPublish"
    > &
      Partial<ActiveLocalAssetPromotionDependencies>
  }
) {
  const dependencies: ActiveLocalAssetPromotionDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  }
  const operationId = dependencies.createId()
  const controller = new AbortController()
  let finishing = false
  let settled = false
  const publish = (
    phase: ActiveLocalAssetPromotionPhase,
    patch: Partial<ActiveLocalAssetPromotionProgress> = {}
  ) => {
    if (settled || !dependencies.mayPublish(operationId)) return
    try {
      options.onProgress?.({
        localAssetId: input.localAssetId,
        phase,
        loaded: null,
        total: null,
        message: null,
        retryable: false,
        undoable: null,
        ...patch,
      })
    } catch {
      // View publication is observational and cannot interrupt durable work.
    }
  }

  const owner = dependencies.startOwner(input, {
    signal: controller.signal,
    onProgress: (progress) =>
      publish(progress.state, {
        loaded: progress.loaded,
        total: progress.total,
      }),
  })

  const promise = (async (): Promise<ActiveLocalAssetPromotionResult> => {
    let ownerResult: Awaited<typeof owner.promise>
    try {
      ownerResult = await owner.promise
    } catch (error) {
      return {
        status: controller.signal.aborted ? "cancelled" : "failed",
        journal: null,
        message: errorMessage(
          error,
          "Studio could not prepare this image for shared use."
        ),
        retryable: true,
      }
    }

    if (ownerResult.status === "complete") {
      return {
        status: "complete",
        journal: ownerResult.journal,
        published: dependencies.mayPublish(operationId),
      }
    }
    if (
      ownerResult.status === "status_unknown" ||
      ownerResult.status === "cancelled" ||
      ownerResult.status === "failed" ||
      ownerResult.status === "conflict"
    ) {
      return {
        status: ownerResult.status,
        journal: ownerResult.journal,
        message:
          ownerResult.status === "conflict"
            ? "This local image identity is already backed by different bytes."
            : ownerResult.status === "status_unknown"
              ? "Studio could not confirm whether the image backup completed. Retry will check before uploading."
              : ownerResult.status === "cancelled"
                ? "Making this image available everywhere was cancelled."
                : "Studio could not make this image available everywhere.",
        retryable: ownerResult.status !== "conflict",
      }
    }

    if (controller.signal.aborted) {
      return {
        status: "cancelled",
        journal: ownerResult.journal,
        message: "The image is backed up, but the document was not changed.",
        retryable: true,
      }
    }

    const ownerId = dependencies.createId()
    const leaseToken = dependencies.createId()
    const claimed = await dependencies.claimJournal({
      localAssetId: ownerResult.journal.localAssetId,
      expectedRevision: ownerResult.journal.revision,
      ownerId,
      leaseToken,
      leaseMilliseconds: dependencies.leaseMilliseconds,
      now: dependencies.now(),
    })
    const lease = new RelinkJournalLease(
      claimed,
      ownerId,
      leaseToken,
      dependencies
    )
    lease.start()
    let released = false
    const release = async () => {
      if (released) return lease.current()
      released = true
      return lease.release()
    }

    try {
      let relink = existingRelinkResult(lease.current())
      if (lease.current().state === "mapped") {
        await lease.update({
          state: "relinking",
          errorCode: null,
          errorRequestId: null,
        })
      }
      if (lease.current().state === "relinking" && !relink) {
        publish("relinking")
        await lease.assertOwned()
        controller.signal.throwIfAborted()
        try {
          relink = await dependencies.applyOrRecognizeRelink(
            lease.current(),
            controller.signal,
            (undoable) => {
              finishing = true
              publish("saving", { undoable })
            },
            async () => {
              await lease.assertOwned()
            }
          )
        } catch (error) {
          if (!isSignalAbort(controller.signal, error)) throw error
          const journal = await release()
          return {
            status: "backed_up",
            journal,
            message:
              "The image is backed up, but the document was not changed.",
            retryable: true,
          }
        }
        if (!relink) {
          await lease.update({ errorCode: "local_relink_conflict" })
          const journal = await release()
          return {
            status: "backed_up",
            journal,
            message:
              "Backed up, relink not applied. The design changed while the image was being prepared.",
            retryable: true,
          }
        }
        finishing = true
        await lease.update({
          relinkResultKind: relink.kind,
          relinkResultContentSnapshotId: relink.contentSnapshotId,
          relinkResultHistorySnapshotId: relink.historySnapshotId,
          relinkResultOperationVersion: relink.operationVersion,
          relinkCommitId: relink.commitId,
          relinkUndoable: relink.undoable,
          errorCode: null,
          errorRequestId: null,
        })
      }

      if (!relink) {
        throw new Error("The relink result checkpoint is incomplete.")
      }

      if (lease.current().state === "relinking") {
        if (!finishing) {
          finishing = true
          publish("saving", { undoable: relink.undoable })
        }
        const durable = await dependencies.flushRelink(lease.current(), relink)
        if (!durable) {
          await lease.update({
            errorCode: "local_relink_persistence_failed",
            errorRequestId: null,
          })
          const journal = await release()
          return {
            status: "failed",
            journal,
            message:
              "The image was relinked in this tab, but the durable draft could not be confirmed. Retry will not upload again.",
            retryable: true,
          }
        }
        await lease.update({
          state: "marking_used",
          relinkResultDraftContentSnapshotId: durable.contentSnapshotId,
          relinkResultDraftSnapshotId: durable.draftSnapshotId,
          relinkResultDraftRecordVersion: durable.recordVersion,
          errorCode: null,
          errorRequestId: null,
        })
        try {
          dependencies.onDurableRelink?.()
        } catch {
          // Session teardown coordination is observational and cannot roll back
          // the durable draft/journal receipt that was just checkpointed.
        }
      }

      if (lease.current().state === "marking_used") {
        finishing = true
        publish("updating_recent", {
          undoable: lease.current().relinkUndoable,
        })
        try {
          const receipt = await dependencies.markManagedUsed(
            lease.current().managedAssetId!,
            lease.current().recentUseIdempotencyKey
          )
          if (receipt.assetId !== lease.current().managedAssetId) {
            throw new Error(
              "Studio returned a Recent receipt for another image."
            )
          }
          await lease.prepareTerminal()
          await lease.update({
            state: "complete",
            recentUseUsedAt: receipt.usedAt,
            recentUseAssetRevision: receipt.assetRevision,
            recentUseRequestId: receipt.requestId,
            errorCode: null,
            errorRequestId: null,
          })
        } catch (error) {
          await lease.update({
            errorCode: errorIdentity(error, "local_recent_update_failed"),
            errorRequestId: errorRequestId(error),
          })
          const journal = await release()
          return {
            status: "failed",
            journal,
            message:
              "The design is safely relinked. Studio could not refresh Recent yet; Retry will reuse the same receipt identity.",
            retryable: true,
          }
        }
      }

      const journal = await release()
      publish("complete", { undoable: journal.relinkUndoable })
      return {
        status: "complete",
        journal,
        published: dependencies.mayPublish(operationId),
      }
    } catch (error) {
      let journal = lease.current()
      try {
        journal = await lease.update({
          errorCode: errorIdentity(
            error,
            finishing ? "local_relink_checkpoint_failed" : "local_relink_failed"
          ),
          errorRequestId: null,
        })
      } catch {
        // A newer journal revision or lease owner is authoritative.
      }
      try {
        journal = await release()
      } catch {
        // Preserve the last exact journal we observed for recovery copy.
      }
      return {
        status: "failed",
        journal,
        message: finishing
          ? "The image relink needs recovery. Retry will verify the document before doing any more work."
          : errorMessage(
              error,
              "Studio could not relink the local image in this document."
            ),
        retryable: true,
      }
    }
  })().finally(() => {
    settled = true
  })

  return {
    operationId,
    promise,
    cancel: () => {
      if (settled || finishing || controller.signal.aborted) return false
      controller.abort(
        new DOMException("Image promotion was cancelled.", "AbortError")
      )
      owner.cancel()
      return true
    },
  }
}
