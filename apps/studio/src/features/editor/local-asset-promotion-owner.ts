import { MEDIA_ASSET_MAX_BYTES } from "@webmcp/document"
import type { LocalAssetPromotion } from "@webmcp/document"
import {
  claimLocalAssetPromotionJournal,
  compareAndSwapLocalAssetPromotionJournal,
  createOrResumeLocalAssetPromotionJournal,
  LocalAssetPromotionBusyError,
  LocalAssetPromotionCheckpointError,
  LocalAssetPromotionJournalCorruptError,
  LocalAssetPromotionLeaseError,
  LocalAssetPromotionJournalRevisionError,
  readLocalAssetPromotionJournal,
  releaseLocalAssetPromotionJournal,
  renewLocalAssetPromotionJournalLease,
} from "./local-asset-promotion-journal"
import type {
  CreateLocalAssetPromotionJournalInput,
  LocalAssetPromotionJournal,
  LocalAssetPromotionJournalPatch,
  LocalAssetPromotionState,
} from "./local-asset-promotion-journal"
import {
  LocalAssetPromotionHttpError,
  lookupLocalAssetPromotion,
  uploadLocalAssetPromotion,
} from "./local-asset-promotion-client"
import { getLocalAssetRecord } from "./local-asset-store"
import type { LocalAssetRecord } from "./local-asset-store"

const HASH_CHUNK_BYTES = 256 * 1024
const HASH_READ_TIMEOUT_MS = 15_000
const HASH_TOTAL_TIMEOUT_MS = 60_000
const OWNER_LEASE_MILLISECONDS = 90_000
const OWNER_LEASE_RENEWAL_MILLISECONDS = 30_000

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
])

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotateRight = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount))

class IncrementalSha256 {
  private readonly state = new Uint32Array(SHA256_INITIAL_STATE)
  private readonly words = new Uint32Array(64)
  private readonly pending = new Uint8Array(64)
  private pendingLength = 0
  private byteLength = 0

  update(bytes: Uint8Array) {
    this.byteLength += bytes.byteLength
    let offset = 0
    while (offset < bytes.byteLength) {
      const copied = Math.min(
        64 - this.pendingLength,
        bytes.byteLength - offset
      )
      this.pending.set(
        bytes.subarray(offset, offset + copied),
        this.pendingLength
      )
      this.pendingLength += copied
      offset += copied
      if (this.pendingLength === 64) {
        this.compress(this.pending)
        this.pendingLength = 0
      }
    }
  }

  digestHex() {
    const finalBytes = new Uint8Array(this.pendingLength < 56 ? 64 : 128)
    finalBytes.set(this.pending.subarray(0, this.pendingLength))
    finalBytes[this.pendingLength] = 0x80
    const bitLength = BigInt(this.byteLength) * 8n
    for (let index = 0; index < 8; index += 1) {
      finalBytes[finalBytes.length - 1 - index] = Number(
        (bitLength >> BigInt(index * 8)) & 0xffn
      )
    }
    for (let offset = 0; offset < finalBytes.length; offset += 64) {
      this.compress(finalBytes.subarray(offset, offset + 64))
    }
    return [...this.state]
      .map((word) => word.toString(16).padStart(8, "0"))
      .join("")
  }

  private compress(block: Uint8Array) {
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4
      this.words[index] =
        ((block[offset] << 24) |
          (block[offset + 1] << 16) |
          (block[offset + 2] << 8) |
          block[offset + 3]) >>>
        0
    }
    for (let index = 16; index < 64; index += 1) {
      const before2 = this.words[index - 2]
      const before15 = this.words[index - 15]
      const sigma1 =
        rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10)
      const sigma0 =
        rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3)
      this.words[index] =
        (this.words[index - 16] + sigma0 + this.words[index - 7] + sigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = this.state
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 =
        (h + sum1 + choice + SHA256_CONSTANTS[index] + this.words[index]) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }

    this.state[0] = (this.state[0] + a) >>> 0
    this.state[1] = (this.state[1] + b) >>> 0
    this.state[2] = (this.state[2] + c) >>> 0
    this.state[3] = (this.state[3] + d) >>> 0
    this.state[4] = (this.state[4] + e) >>> 0
    this.state[5] = (this.state[5] + f) >>> 0
    this.state[6] = (this.state[6] + g) >>> 0
    this.state[7] = (this.state[7] + h) >>> 0
  }
}

const readBlobSlice = (
  blob: Blob,
  start: number,
  end: number,
  signal?: AbortSignal
) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    let timedOut = false
    const cleanUp = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      reader.removeEventListener("abort", onAbort)
      reader.removeEventListener("error", onError)
      reader.removeEventListener("load", onLoad)
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanUp()
      callback()
    }
    const abort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
    const onAbort = () =>
      settle(() =>
        reject(
          signal?.aborted
            ? signal.reason
            : timedOut
              ? new LocalAssetPromotionOwnerError({
                  code: "local_promotion_hash_timeout",
                  message: "Studio took too long to read the local image.",
                  retryable: true,
                })
              : new DOMException("Image hashing was cancelled.", "AbortError")
        )
      )
    const onError = () =>
      settle(() =>
        reject(
          new LocalAssetPromotionOwnerError({
            code: "local_asset_corrupt",
            message: "The saved local image bytes could not be read.",
            retryable: false,
          })
        )
      )
    const onLoad = () =>
      settle(() => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(
            new LocalAssetPromotionOwnerError({
              code: "local_asset_corrupt",
              message: "The saved local image bytes could not be read.",
              retryable: false,
            })
          )
          return
        }
        resolve(reader.result)
      })
    const timeout = setTimeout(() => {
      timedOut = true
      abort()
    }, HASH_READ_TIMEOUT_MS)

    signal?.addEventListener("abort", abort, { once: true })
    reader.addEventListener("abort", onAbort, { once: true })
    reader.addEventListener("error", onError, { once: true })
    reader.addEventListener("load", onLoad, { once: true })
    try {
      reader.readAsArrayBuffer(blob.slice(start, end))
      if (signal?.aborted) abort()
    } catch {
      onError()
    }
  })

export async function hashLocalAssetBlobSha256(
  blob: Blob,
  signal?: AbortSignal
) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(
    () =>
      controller.abort(
        new LocalAssetPromotionOwnerError({
          code: "local_promotion_hash_timeout",
          message: "Studio took too long to verify the local image.",
          retryable: true,
        })
      ),
    HASH_TOTAL_TIMEOUT_MS
  )
  controller.signal.throwIfAborted()
  if (blob.size < 1 || blob.size > MEDIA_ASSET_MAX_BYTES) {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
    throw new LocalAssetPromotionOwnerError({
      code: "local_asset_corrupt",
      message: "The saved local image is outside Studio's upload limits.",
      retryable: false,
    })
  }
  try {
    const hasher = new IncrementalSha256()
    for (let offset = 0; offset < blob.size; offset += HASH_CHUNK_BYTES) {
      controller.signal.throwIfAborted()
      const bytes = await readBlobSlice(
        blob,
        offset,
        Math.min(offset + HASH_CHUNK_BYTES, blob.size),
        controller.signal
      )
      controller.signal.throwIfAborted()
      hasher.update(new Uint8Array(bytes))
    }
    controller.signal.throwIfAborted()
    return hasher.digestHex()
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
  }
}

export class LocalAssetPromotionOwnerError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string | null

  constructor(input: {
    code: string
    message: string
    retryable: boolean
    requestId?: string | null
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = "LocalAssetPromotionOwnerError"
    this.code = input.code
    this.retryable = input.retryable
    this.requestId = input.requestId ?? null
  }
}

export type LocalAssetPromotionOwnerInput = Omit<
  CreateLocalAssetPromotionJournalInput,
  "idempotencyKey" | "recentUseIdempotencyKey" | "now"
> & {
  idempotencyKey?: string
  recentUseIdempotencyKey?: string
}

export type LocalAssetPromotionOwnerResult = Readonly<{
  status: Extract<
    LocalAssetPromotionState,
    | "status_unknown"
    | "mapped"
    | "relinking"
    | "marking_used"
    | "complete"
    | "cancelled"
    | "failed"
    | "conflict"
  >
  journal: LocalAssetPromotionJournal
}>

export type LocalAssetPromotionProgress = Readonly<{
  state: LocalAssetPromotionState | "cancelling"
  loaded: number | null
  total: number | null
  journalRevision: number
}>

type PromotionLookup = (
  localAssetId: string,
  options?: { signal?: AbortSignal }
) => Promise<{ promotion: LocalAssetPromotion | null; requestId: string }>

type PromotionUpload = (
  input: {
    localAssetId: string
    blob: Blob
    name: string
    idempotencyKey: string
  },
  options?: {
    signal?: AbortSignal
    onProgress?: (loaded: number, total: number | null) => void
  }
) => Promise<{ promotion: LocalAssetPromotion; requestId: string }>

export type LocalAssetPromotionOwnerDependencies = Readonly<{
  readJournal: typeof readLocalAssetPromotionJournal
  createJournal: typeof createOrResumeLocalAssetPromotionJournal
  claimJournal: typeof claimLocalAssetPromotionJournal
  renewJournal: typeof renewLocalAssetPromotionJournalLease
  updateJournal: typeof compareAndSwapLocalAssetPromotionJournal
  releaseJournal: typeof releaseLocalAssetPromotionJournal
  readLocalAsset: typeof getLocalAssetRecord
  hashBlob: typeof hashLocalAssetBlobSha256
  lookupPromotion: PromotionLookup
  uploadPromotion: PromotionUpload
  createId: () => string
  now: () => string
  leaseMilliseconds: number
  leaseRenewalMilliseconds: number
}>

const defaultDependencies: LocalAssetPromotionOwnerDependencies = {
  readJournal: readLocalAssetPromotionJournal,
  createJournal: createOrResumeLocalAssetPromotionJournal,
  claimJournal: claimLocalAssetPromotionJournal,
  renewJournal: renewLocalAssetPromotionJournalLease,
  updateJournal: compareAndSwapLocalAssetPromotionJournal,
  releaseJournal: releaseLocalAssetPromotionJournal,
  readLocalAsset: getLocalAssetRecord,
  hashBlob: hashLocalAssetBlobSha256,
  lookupPromotion: lookupLocalAssetPromotion,
  uploadPromotion: uploadLocalAssetPromotion,
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  leaseMilliseconds: OWNER_LEASE_MILLISECONDS,
  leaseRenewalMilliseconds: OWNER_LEASE_RENEWAL_MILLISECONDS,
}

const allowedTransitions: Readonly<
  Record<LocalAssetPromotionState, readonly LocalAssetPromotionState[]>
> = {
  queued: ["hashing", "cancelled", "failed"],
  hashing: ["reconciling", "uploading", "cancelled", "failed"],
  reconciling: [
    "hashing",
    "uploading",
    "status_unknown",
    "mapped",
    "conflict",
    "cancelled",
    "failed",
  ],
  uploading: ["status_unknown", "mapped", "conflict", "cancelled", "failed"],
  status_unknown: ["reconciling"],
  mapped: ["relinking"],
  relinking: ["marking_used"],
  marking_used: ["complete"],
  complete: [],
  cancelled: ["hashing", "reconciling"],
  failed: ["hashing", "reconciling", "cancelled"],
  conflict: [],
}

const assertDirectionalTransition = (
  from: LocalAssetPromotionState,
  to: LocalAssetPromotionState
) => {
  if (!allowedTransitions[from].includes(to)) {
    throw new LocalAssetPromotionOwnerError({
      code: "local_promotion_invalid_transition",
      message: `Image promotion cannot move from ${from} to ${to}.`,
      retryable: false,
    })
  }
}

const combineAbortSignals = (...signals: AbortSignal[]) => {
  const controller = new AbortController()
  const listeners = signals.map((signal) => {
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    return { signal, abort }
  })
  return {
    signal: controller.signal,
    cleanUp: () => {
      for (const listener of listeners) {
        listener.signal.removeEventListener("abort", listener.abort)
      }
    },
  }
}

class PromotionJournalLease {
  private tail: Promise<void> = Promise.resolve()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private lostError: unknown = null

  constructor(
    private journal: LocalAssetPromotionJournal,
    private readonly ownerId: string,
    private readonly leaseToken: string,
    private readonly dependencies: LocalAssetPromotionOwnerDependencies,
    private readonly leaseLossController: AbortController,
    private readonly publish: (journal: LocalAssetPromotionJournal) => void
  ) {}

  current() {
    return this.journal
  }

  startHeartbeat() {
    this.heartbeat = setInterval(() => {
      void this.serialize(async () => {
        this.journal = await this.dependencies.renewJournal({
          localAssetId: this.journal.localAssetId,
          expectedRevision: this.journal.revision,
          ownerId: this.ownerId,
          leaseToken: this.leaseToken,
          leaseMilliseconds: this.dependencies.leaseMilliseconds,
          now: this.dependencies.now(),
        })
        this.publish(this.journal)
      }).catch((error: unknown) => {
        this.lostError = error
        this.leaseLossController.abort(error)
      })
    }, this.dependencies.leaseRenewalMilliseconds)
  }

  transition(
    state: LocalAssetPromotionState,
    patch: LocalAssetPromotionJournalPatch = {}
  ) {
    return this.serialize(async () => {
      assertDirectionalTransition(this.journal.state, state)
      const nextAttempt = patch.attempt ?? this.journal.attempt
      if (state === "uploading" && nextAttempt !== this.journal.attempt + 1) {
        throw new LocalAssetPromotionOwnerError({
          code: "local_promotion_invalid_transition",
          message: "An upload attempt must be checkpointed before the request.",
          retryable: false,
        })
      }
      if (state !== "uploading" && nextAttempt !== this.journal.attempt) {
        throw new LocalAssetPromotionOwnerError({
          code: "local_promotion_invalid_transition",
          message: "Only an upload transition may increment the attempt.",
          retryable: false,
        })
      }
      this.journal = await this.dependencies.updateJournal({
        localAssetId: this.journal.localAssetId,
        expectedRevision: this.journal.revision,
        ownerId: this.ownerId,
        leaseToken: this.leaseToken,
        patch: { ...patch, state },
        now: this.dependencies.now(),
      })
      this.publish(this.journal)
      return this.journal
    })
  }

  async release() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    await this.tail
    this.stopped = true
    if (this.lostError) throw this.lostError
    this.journal = await this.dependencies.releaseJournal({
      localAssetId: this.journal.localAssetId,
      expectedRevision: this.journal.revision,
      ownerId: this.ownerId,
      leaseToken: this.leaseToken,
      now: this.dependencies.now(),
    })
    this.publish(this.journal)
    return this.journal
  }

  private serialize<T>(operation: () => Promise<T>) {
    const result = this.tail.then(() => {
      if (this.stopped || this.lostError) {
        throw this.lostError ?? new LocalAssetPromotionLeaseError()
      }
      return operation()
    })
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

const resultFor = (
  journal: LocalAssetPromotionJournal
): LocalAssetPromotionOwnerResult => {
  if (
    journal.state !== "status_unknown" &&
    journal.state !== "mapped" &&
    journal.state !== "relinking" &&
    journal.state !== "marking_used" &&
    journal.state !== "complete" &&
    journal.state !== "cancelled" &&
    journal.state !== "failed" &&
    journal.state !== "conflict"
  ) {
    throw new LocalAssetPromotionOwnerError({
      code: "local_promotion_unsettled",
      message: "Image promotion did not reach a resumable checkpoint.",
      retryable: true,
    })
  }
  return { status: journal.state, journal }
}

const mappingPatch = (
  promotion: LocalAssetPromotion,
  requestId: string
): LocalAssetPromotionJournalPatch => ({
  managedAssetId: promotion.asset.id,
  managedContentSha256: promotion.contentSha256,
  managedStatus: promotion.asset.status,
  managedAssetRevision: promotion.asset.revision,
  mappingRequestId: requestId,
  errorCode: null,
  errorRequestId: null,
})

const stableFailure = (error: unknown) => {
  if (error instanceof LocalAssetPromotionOwnerError) return error
  if (error instanceof LocalAssetPromotionHttpError) {
    return new LocalAssetPromotionOwnerError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId: error.requestId,
      cause: error,
    })
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new LocalAssetPromotionOwnerError({
      code: "local_promotion_cancelled",
      message: "Image promotion was cancelled.",
      retryable: true,
      cause: error,
    })
  }
  return new LocalAssetPromotionOwnerError({
    code: "local_promotion_failed",
    message: "Studio could not make the local image available everywhere.",
    retryable: true,
    cause: error,
  })
}

const isOperationAbort = (signal: AbortSignal, error: unknown) =>
  signal.aborted &&
  (error === signal.reason ||
    (error instanceof DOMException && error.name === "AbortError"))

const validateLocalRecord = (
  record: LocalAssetRecord | null,
  expectedRevision: number
) => {
  if (!record) {
    throw new LocalAssetPromotionOwnerError({
      code: "local_asset_missing",
      message: "The saved local image is missing from this browser.",
      retryable: false,
    })
  }
  if (record.revision !== expectedRevision) {
    throw new LocalAssetPromotionOwnerError({
      code: "local_asset_alias_conflict",
      message: "The saved local image changed after promotion started.",
      retryable: false,
    })
  }
  return record
}

async function executePromotionOwner(
  input: LocalAssetPromotionOwnerInput,
  dependencies: LocalAssetPromotionOwnerDependencies,
  userSignal: AbortSignal,
  onProgress?: (progress: LocalAssetPromotionProgress) => void
) {
  let existing: Awaited<ReturnType<typeof readLocalAssetPromotionJournal>>
  try {
    existing = await dependencies.readJournal(input.localAssetId, userSignal)
  } catch (error) {
    if (
      error instanceof LocalAssetPromotionCheckpointError ||
      error instanceof LocalAssetPromotionJournalCorruptError ||
      error instanceof LocalAssetPromotionJournalRevisionError ||
      error instanceof LocalAssetPromotionBusyError ||
      isOperationAbort(userSignal, error)
    ) {
      throw error
    }
    throw new LocalAssetPromotionCheckpointError(error)
  }
  if (existing.status === "corrupt") {
    throw new LocalAssetPromotionJournalCorruptError()
  }
  const idempotencyKey =
    existing.status === "ready"
      ? existing.journal.idempotencyKey
      : (input.idempotencyKey ?? dependencies.createId())
  const recentUseIdempotencyKey =
    existing.status === "ready" &&
    input.supersedeCompletedRevision !== existing.journal.revision
      ? existing.journal.recentUseIdempotencyKey
      : (input.recentUseIdempotencyKey ?? dependencies.createId())
  let journal: LocalAssetPromotionJournal
  try {
    journal = await dependencies.createJournal(
      {
        ...input,
        idempotencyKey,
        recentUseIdempotencyKey,
        now: dependencies.now(),
      },
      userSignal
    )
  } catch (error) {
    if (
      error instanceof LocalAssetPromotionCheckpointError ||
      error instanceof LocalAssetPromotionJournalCorruptError ||
      error instanceof LocalAssetPromotionJournalRevisionError ||
      error instanceof LocalAssetPromotionBusyError ||
      isOperationAbort(userSignal, error)
    ) {
      throw error
    }
    throw new LocalAssetPromotionCheckpointError(error)
  }

  if (
    journal.state === "mapped" ||
    journal.state === "relinking" ||
    journal.state === "marking_used" ||
    journal.state === "complete" ||
    journal.state === "conflict"
  ) {
    return resultFor(journal)
  }

  // Creation may have committed just as cancellation arrived. No lease exists
  // yet, so acknowledge that exact resumable checkpoint without claiming it.
  userSignal.throwIfAborted()

  const ownerId = dependencies.createId()
  const leaseToken = dependencies.createId()
  try {
    journal = await dependencies.claimJournal(
      {
        localAssetId: journal.localAssetId,
        expectedRevision: journal.revision,
        ownerId,
        leaseToken,
        leaseMilliseconds: dependencies.leaseMilliseconds,
        now: dependencies.now(),
      },
      userSignal
    )
  } catch (error) {
    if (
      error instanceof LocalAssetPromotionCheckpointError ||
      error instanceof LocalAssetPromotionJournalCorruptError ||
      error instanceof LocalAssetPromotionJournalRevisionError ||
      error instanceof LocalAssetPromotionBusyError ||
      isOperationAbort(userSignal, error)
    ) {
      throw error
    }
    throw new LocalAssetPromotionCheckpointError(error)
  }
  const leaseLossController = new AbortController()
  let publishedState: LocalAssetPromotionState | "cancelling" = journal.state
  let publishedLoaded: number | null = null
  let publishedTotal: number | null = null
  const publish = (next: LocalAssetPromotionJournal) => {
    publishedState = next.state
    if (next.state !== "uploading") {
      publishedLoaded = null
      publishedTotal = null
    }
    onProgress?.({
      state: publishedState,
      loaded: publishedLoaded,
      total: publishedTotal,
      journalRevision: next.revision,
    })
  }
  const owned = new PromotionJournalLease(
    journal,
    ownerId,
    leaseToken,
    dependencies,
    leaseLossController,
    publish
  )
  owned.startHeartbeat()
  const active = combineAbortSignals(userSignal, leaseLossController.signal)
  const finish = async () => resultFor(await owned.release())
  const fail = async (error: unknown, state: "failed" | "cancelled") => {
    if (state === "cancelled" && owned.current().state === "cancelled") {
      return await finish()
    }
    const failure =
      state === "cancelled"
        ? new LocalAssetPromotionOwnerError({
            code: "local_promotion_cancelled",
            message: "Image promotion was cancelled.",
            retryable: true,
            cause: error,
          })
        : stableFailure(error)
    await owned.transition(state, {
      errorCode: failure.code,
      errorRequestId: failure.requestId,
    })
    return await finish()
  }
  const reconcile = async (signal: AbortSignal) => {
    const lookup = await dependencies.lookupPromotion(
      owned.current().localAssetId,
      { signal }
    )
    if (!lookup.promotion) return null
    const state =
      lookup.promotion.contentSha256 === owned.current().contentSha256
        ? "mapped"
        : "conflict"
    await owned.transition(
      state,
      mappingPatch(lookup.promotion, lookup.requestId)
    )
    return state
  }

  try {
    publish(journal)
    const startingState = owned.current().state
    let reconciledUnmapped = false
    const hadPossibleRemoteCommit =
      startingState === "status_unknown" ||
      startingState === "uploading" ||
      (owned.current().attempt > 0 && owned.current().contentSha256 !== null)

    if (startingState === "uploading") {
      await owned.transition("status_unknown", {
        errorCode: "local_promotion_status_unknown",
        errorRequestId: null,
      })
    }
    if (
      hadPossibleRemoteCommit &&
      owned.current().state !== "status_unknown" &&
      owned.current().state !== "reconciling"
    ) {
      await owned.transition("reconciling")
    }
    if (
      owned.current().state === "status_unknown" ||
      owned.current().state === "reconciling"
    ) {
      if (owned.current().state === "status_unknown") {
        await owned.transition("reconciling")
      }
      try {
        const reconciled = await reconcile(active.signal)
        if (reconciled) return await finish()
        reconciledUnmapped = true
      } catch (error) {
        if (leaseLossController.signal.aborted) {
          throw leaseLossController.signal.reason
        }
        const failure = stableFailure(error)
        const nextState = hadPossibleRemoteCommit
          ? "status_unknown"
          : isOperationAbort(userSignal, error)
            ? "cancelled"
            : "failed"
        await owned.transition(nextState, {
          errorCode:
            nextState === "status_unknown"
              ? "local_promotion_status_unknown"
              : nextState === "cancelled"
                ? "local_promotion_cancelled"
                : failure.code,
          errorRequestId: failure.requestId,
        })
        return await finish()
      }
    }

    try {
      userSignal.throwIfAborted()
    } catch (error) {
      return await fail(error, "cancelled")
    }

    if (owned.current().state !== "hashing") {
      await owned.transition("hashing", {
        errorCode: null,
        errorRequestId: null,
      })
    }
    let record: LocalAssetRecord
    try {
      record = validateLocalRecord(
        await dependencies.readLocalAsset(
          owned.current().localAssetId,
          active.signal
        ),
        owned.current().sourceLocalAssetRevision
      )
      const contentSha256 = await dependencies.hashBlob(
        record.blob,
        active.signal
      )
      const confirmed = validateLocalRecord(
        await dependencies.readLocalAsset(
          owned.current().localAssetId,
          active.signal
        ),
        owned.current().sourceLocalAssetRevision
      )
      if (
        confirmed.size !== record.size ||
        confirmed.mediaType !== record.mediaType
      ) {
        throw new LocalAssetPromotionOwnerError({
          code: "local_asset_alias_conflict",
          message: "The saved local image changed after promotion started.",
          retryable: false,
        })
      }
      if (
        owned.current().contentSha256 !== null &&
        owned.current().contentSha256 !== contentSha256
      ) {
        throw new LocalAssetPromotionOwnerError({
          code: "local_asset_alias_conflict",
          message:
            "The local image no longer matches its promotion checkpoint.",
          retryable: false,
        })
      }
      if (!reconciledUnmapped) {
        await owned.transition("reconciling", {
          contentSha256,
          errorCode: null,
          errorRequestId: null,
        })
        const reconciled = await reconcile(active.signal)
        if (reconciled) return await finish()
        reconciledUnmapped = true
      } else if (owned.current().contentSha256 === null) {
        throw new LocalAssetPromotionOwnerError({
          code: "local_promotion_checkpoint_failed",
          message: "The retry has no verified content checkpoint.",
          retryable: true,
        })
      }
    } catch (error) {
      if (leaseLossController.signal.aborted) {
        throw leaseLossController.signal.reason
      }
      return await fail(
        error,
        isOperationAbort(userSignal, error) ? "cancelled" : "failed"
      )
    }

    try {
      active.signal.throwIfAborted()
    } catch (error) {
      if (leaseLossController.signal.aborted) {
        throw leaseLossController.signal.reason
      }
      return await fail(error, "cancelled")
    }
    await owned.transition("uploading", {
      attempt: owned.current().attempt + 1,
      errorCode: null,
      errorRequestId: null,
    })
    if (userSignal.aborted) {
      return await fail(userSignal.reason, "cancelled")
    }
    let uploadResult: Awaited<ReturnType<PromotionUpload>>
    try {
      uploadResult = await dependencies.uploadPromotion(
        {
          localAssetId: owned.current().localAssetId,
          blob: record.blob,
          name: record.name,
          idempotencyKey: owned.current().idempotencyKey,
        },
        {
          signal: active.signal,
          onProgress: (loaded, total) => {
            if (active.signal.aborted) return
            publishedLoaded = loaded
            publishedTotal = total
            onProgress?.({
              state: userSignal.aborted ? "cancelling" : publishedState,
              loaded,
              total,
              journalRevision: owned.current().revision,
            })
          },
        }
      )
    } catch (error) {
      if (leaseLossController.signal.aborted) {
        throw leaseLossController.signal.reason
      }
      const failure = stableFailure(error)
      const remotelyAmbiguous =
        error instanceof LocalAssetPromotionHttpError &&
        error.commitStatus === "unknown"
      if (!remotelyAmbiguous && failure.code !== "local_asset_alias_conflict") {
        return await fail(error, "failed")
      }
      await owned.transition("status_unknown", {
        errorCode: "local_promotion_status_unknown",
        errorRequestId: failure.requestId,
      })
      await owned.transition("reconciling")
      try {
        const settled = await reconcile(leaseLossController.signal)
        if (settled) return await finish()
        await owned.transition("status_unknown", {
          errorCode: "local_promotion_status_unknown",
          errorRequestId: failure.requestId,
        })
        return await finish()
      } catch (reconcileError) {
        const reconcileFailure = stableFailure(reconcileError)
        await owned.transition("status_unknown", {
          errorCode: "local_promotion_status_unknown",
          errorRequestId: reconcileFailure.requestId ?? failure.requestId,
        })
        return await finish()
      }
    }

    const mappedState =
      uploadResult.promotion.contentSha256 === owned.current().contentSha256
        ? "mapped"
        : "conflict"
    await owned.transition(
      mappedState,
      mappingPatch(uploadResult.promotion, uploadResult.requestId)
    )
    return await finish()
  } finally {
    active.cleanUp()
    if (owned.current().lease) {
      // Normal exits call finish(). This branch is only a defensive guard for
      // a future early return added above.
      try {
        await owned.release()
      } catch {
        // The already returned checkpoint remains authoritative.
      }
    }
  }
}

export type LocalAssetPromotionTask = Readonly<{
  promise: Promise<LocalAssetPromotionOwnerResult>
  cancel: () => void
}>

export function startLocalAssetPromotion(
  input: LocalAssetPromotionOwnerInput,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: LocalAssetPromotionProgress) => void
    dependencies?: Partial<LocalAssetPromotionOwnerDependencies>
  } = {}
): LocalAssetPromotionTask {
  const dependencies = { ...defaultDependencies, ...options.dependencies }
  const controller = new AbortController()
  let lastProgress: LocalAssetPromotionProgress | null = null
  let settled = false
  const publishProgress = (progress: LocalAssetPromotionProgress) => {
    if (settled) return
    lastProgress = progress
    try {
      options.onProgress?.(progress)
    } catch {
      // Progress is advisory. A consumer cannot interrupt durable ownership.
    }
  }
  const publishCancelling = () => {
    if (!settled && lastProgress) {
      try {
        options.onProgress?.({ ...lastProgress, state: "cancelling" })
      } catch {
        // Cancellation must reach the owner even if its observer is stale.
      }
    }
  }
  const abort = () => {
    publishCancelling()
    controller.abort(options.signal?.reason)
  }
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  const promise = executePromotionOwner(
    input,
    dependencies,
    controller.signal,
    publishProgress
  ).finally(() => {
    settled = true
    options.signal?.removeEventListener("abort", abort)
  })
  return {
    promise,
    cancel: () => {
      if (settled || controller.signal.aborted) return
      publishCancelling()
      controller.abort(
        new DOMException("Image promotion was cancelled.", "AbortError")
      )
    },
  }
}
