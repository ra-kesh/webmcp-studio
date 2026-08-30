import {
  LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT,
  applyLocalMediaAdmissionPlan,
  extractAssetReferences,
  localAssetIdFromSource,
  managedAssetSource,
  planLocalMediaAdmission,
} from "@webmcp/document"
import type {
  LocalMediaAdmissionFact,
  LocalMediaAdmissionPlan,
  UnresolvedLocalMediaAdmission,
} from "@webmcp/document"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  AdmissionMigrationAlias,
  DocumentDraftReadResult,
  DocumentDraftRecord,
  DocumentDraftRepository,
  DocumentDraftSummary,
  DraftHeadIdentity,
  DraftRepositoryFailure,
  LocalMediaAdmissionReceipt,
} from "./document-draft-repository"
import { LocalAssetPromotionHttpError } from "./local-asset-promotion-client"
import type { resolveLocalAssetPromotions } from "./local-asset-promotion-client"
import type { hashLocalAssetBlobSha256 } from "./local-asset-promotion-owner"
import type {
  LocalAssetAdmissionState,
  inspectRequestedLocalAssets,
} from "./local-asset-store"
import type { markManagedMediaUsed } from "./managed-media-repository"

const MAPPING_BATCH_SIZE = 100
const ADMISSION_CONCURRENCY = 2
const MAX_STALE_HEAD_REPLANS = 2

export type DocumentRouteAdmissionPhase =
  | "checking_document"
  | "checking_device"
  | "checking_studio"
  | "verifying_files"
  | "saving_recovery"
  | "finishing_recovery"

export type DocumentRouteAdmissionProgress = Readonly<{
  phase: DocumentRouteAdmissionPhase
  completed: number
  total: number
  cancellable: boolean
}>

export type DocumentRouteMediaAdmission = Readonly<{
  status:
    | "not_needed"
    | "unchanged"
    | "migrated"
    | "replayed"
    | "deferred"
    | "receipt_pending"
  aliasCount: number
  migratedLocalAssetIds: readonly string[]
  unresolved: readonly UnresolvedLocalMediaAdmission[]
  receipt: LocalMediaAdmissionReceipt | null
  message: string | null
}>

export type DocumentRouteAdmissionWarning = Readonly<{
  kind: DraftRepositoryFailure["kind"] | "local_media_recovery_deferred"
  message: string
}>

type OpenedAdmissionIdentity = Readonly<{
  generation: number
  documentId: string
  head: DraftHeadIdentity
}>

export type OpenedDocumentRouteAdmission = Readonly<{
  status: "opened"
  record: DocumentDraftRecord
  warning: DocumentRouteAdmissionWarning | null
  media: DocumentRouteMediaAdmission
  admissionIdentity: OpenedAdmissionIdentity
}>

export type DocumentRouteAdmission =
  | OpenedDocumentRouteAdmission
  | Readonly<{ status: "missing"; documentId: string }>
  | Readonly<{
      status: "deleted"
      documentId: string
      summary: DocumentDraftSummary
    }>
  | Readonly<{
      status: "recovery_required"
      documentId: string
      quarantineId: string | null
    }>
  | Readonly<{
      status: "unavailable"
      documentId: string
      failure: DraftRepositoryFailure
    }>
  | Readonly<{ status: "superseded"; documentId: string }>

type PromotionResolution = Awaited<
  ReturnType<typeof resolveLocalAssetPromotions>
>

export type DocumentRouteAdmissionDependencies = Readonly<{
  get: DocumentDraftRepository["get"]
  touchOpened: DocumentDraftRepository["touchOpened"]
  getPendingReceipt: DocumentDraftRepository["getPendingLocalMediaAdmissionReceiptForDocument"]
  inspectLocalAssets: typeof inspectRequestedLocalAssets
  resolvePromotions: typeof resolveLocalAssetPromotions
  hashBlob: typeof hashLocalAssetBlobSha256
  migrateLocalMedia: DocumentDraftRepository["migrateLocalMedia"]
  markManagedUsed: typeof markManagedMediaUsed
  updateManagedUse: DocumentDraftRepository["markLocalMediaAdmissionManagedUse"]
  createOperationId?: () => string
  now?: () => string
}>

export type DocumentRouteAdmissionOptions = Readonly<{
  recover?: boolean
  onProgress?: (progress: DocumentRouteAdmissionProgress) => void
}>

export type DocumentRouteInstallConfirmation =
  | Readonly<{
      status: "confirmed"
      warning: DocumentRouteAdmissionWarning | null
    }>
  | Readonly<{ status: "superseded" }>

type ActiveOperation = {
  generation: number
  documentId: string
  controller: AbortController
  done: Promise<void>
}

type MappingEvidence = Readonly<{
  resolution: PromotionResolution["results"][number]
  requestId: string
}>

const recordHasIdentity = (
  record: DocumentDraftRecord,
  documentId: string
): boolean =>
  record.summary.documentId === documentId &&
  record.envelope.document.id === documentId

const headForRecord = (record: DocumentDraftRecord): DraftHeadIdentity => ({
  documentId: record.summary.documentId,
  recordVersion: record.summary.recordVersion,
  contentSnapshotId: record.summary.contentSnapshotId,
  draftSnapshotId: record.summary.draftSnapshotId,
  deletedAt: record.summary.deletedAt,
})

const sameHead = (left: DraftHeadIdentity, right: DraftHeadIdentity) =>
  left.documentId === right.documentId &&
  left.recordVersion === right.recordVersion &&
  left.contentSnapshotId === right.contentSnapshotId &&
  left.draftSnapshotId === right.draftSnapshotId &&
  left.deletedAt === right.deletedAt

const localAliasIdsFor = (record: DocumentDraftRecord) =>
  [
    ...new Set(
      extractAssetReferences(record.envelope.document).flatMap((reference) => {
        if (reference.identity !== "local") return []
        const localAssetId = localAssetIdFromSource(reference.source)
        return localAssetId ? [localAssetId] : []
      })
    ),
  ].sort()

const notNeededMedia = (): DocumentRouteMediaAdmission => ({
  status: "not_needed",
  aliasCount: 0,
  migratedLocalAssetIds: [],
  unresolved: [],
  receipt: null,
  message: null,
})

const opened = (
  record: DocumentDraftRecord,
  generation: number,
  media: DocumentRouteMediaAdmission = notNeededMedia(),
  warning: DocumentRouteAdmissionWarning | null = null
): OpenedDocumentRouteAdmission => ({
  status: "opened",
  record,
  warning,
  media,
  admissionIdentity: {
    generation,
    documentId: record.summary.documentId,
    head: headForRecord(record),
  },
})

const mapWithConcurrency = async <T, TResult>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<TResult>
): Promise<TResult[]> => {
  const results = new Array<TResult>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await operation(values[index], index)
      }
    }
  )
  const settlements = await Promise.allSettled(workers)
  const failure = settlements.find(
    (settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected"
  )
  if (failure) throw failure.reason
  return results
}

const chunksOf = <T>(values: readonly T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const localFactFor = (
  state: LocalAssetAdmissionState
): LocalMediaAdmissionFact["local"] => ({ status: state.status })

const localAdmissionStateIdentity = (state: LocalAssetAdmissionState) => {
  switch (state.status) {
    case "ready":
      return JSON.stringify({
        status: state.status,
        id: state.record.id,
        revision: state.record.revision,
        updatedAt: state.record.updatedAt,
        size: state.record.size,
        mediaType: state.record.mediaType,
        integrity: state.record.integrity,
        blobSize: state.record.blob.size,
        blobType: state.record.blob.type,
      })
    case "missing_bytes":
      return JSON.stringify({
        status: state.status,
        id: state.summary.id,
        revision: state.summary.revision,
        updatedAt: state.summary.updatedAt,
        issueCode: state.issue.code,
      })
    case "quarantined":
      return JSON.stringify({
        status: state.status,
        issueCode: state.issue.code,
        records: state.expectation.records,
      })
    case "unavailable":
      return JSON.stringify({ status: state.status, code: state.code })
    case "absent":
      return JSON.stringify({ status: state.status })
  }
}

const sameLocalAdmissionState = (
  left: LocalAssetAdmissionState,
  right: LocalAssetAdmissionState
) => localAdmissionStateIdentity(left) === localAdmissionStateIdentity(right)

const isAbort = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof DOMException && error.name === "AbortError")

export class DocumentRouteAdmissionController {
  #generation = 0
  #disposed = false
  #active: ActiveOperation | null = null
  #touchQueue: Promise<void> = Promise.resolve()
  #managedUseFinishing = new Map<string, Promise<void>>()

  constructor(
    private readonly dependencies: DocumentRouteAdmissionDependencies
  ) {}

  get generation() {
    return this.#generation
  }

  get disposed() {
    return this.#disposed
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
    await this.#abortActive()
  }

  async supersede() {
    if (this.#disposed) return
    this.#generation += 1
    await this.#abortActive()
  }

  async admit(
    documentId: string,
    options: DocumentRouteAdmissionOptions = {}
  ): Promise<DocumentRouteAdmission> {
    const generation = ++this.#generation
    await this.#abortActive()
    if (!this.#ownsGeneration(generation)) {
      return { status: "superseded", documentId }
    }

    const controller = new AbortController()
    let releaseDone!: () => void
    const done = new Promise<void>((resolve) => {
      releaseDone = resolve
    })
    const operation: ActiveOperation = {
      generation,
      documentId,
      controller,
      done,
    }
    this.#active = operation
    try {
      return await this.#runAdmission(operation, options)
    } catch (error) {
      if (isAbort(error, controller.signal) || !this.#owns(operation)) {
        return { status: "superseded", documentId }
      }
      throw error
    } finally {
      releaseDone()
      if (this.#active === operation) this.#active = null
    }
  }

  async confirmInstalled(
    admission: OpenedDocumentRouteAdmission,
    installedRecord: DocumentDraftRecord
  ): Promise<DocumentRouteInstallConfirmation> {
    const identity = admission.admissionIdentity
    if (
      !this.#ownsGeneration(identity.generation) ||
      identity.documentId !== installedRecord.summary.documentId ||
      !sameHead(identity.head, headForRecord(installedRecord))
    ) {
      return { status: "superseded" }
    }

    const previousTouch = this.#touchQueue
    let releaseTouch!: () => void
    this.#touchQueue = new Promise<void>((resolve) => {
      releaseTouch = resolve
    })
    await previousTouch
    if (!this.#ownsGeneration(identity.generation)) {
      releaseTouch()
      return { status: "superseded" }
    }

    const touched = await this.dependencies
      .touchOpened(identity.documentId)
      .finally(releaseTouch)
    if (!this.#ownsGeneration(identity.generation)) {
      return { status: "superseded" }
    }
    if (!touched.ok) {
      const warning =
        "failure" in touched
          ? { kind: touched.failure.kind, message: touched.failure.message }
          : {
              kind: "validation_failed" as const,
              message:
                "The document opened, but Studio could not update its recent activity because the saved record is no longer available.",
            }
      this.#startManagedUseReconciliation(admission.media.receipt)
      return {
        status: "confirmed",
        warning,
      }
    }
    if (
      !recordHasIdentity(touched.value, identity.documentId) ||
      touched.value.summary.deletedAt !== null ||
      !sameHead(identity.head, headForRecord(touched.value))
    ) {
      return { status: "superseded" }
    }
    this.#startManagedUseReconciliation(admission.media.receipt)
    return { status: "confirmed", warning: null }
  }

  async #runAdmission(
    operation: ActiveOperation,
    options: DocumentRouteAdmissionOptions
  ): Promise<DocumentRouteAdmission> {
    for (
      let staleHeadReplans = 0;
      staleHeadReplans <= MAX_STALE_HEAD_REPLANS;
      staleHeadReplans += 1
    ) {
      const result = await this.#prepareAndMigrate(
        operation,
        options,
        staleHeadReplans
      )
      if (result !== "stale_head") return result
    }
    const latest = await this.dependencies.get(operation.documentId)
    this.#assertOwner(operation)
    const projected = this.#projectRead(operation.documentId, latest)
    if (projected) return projected
    if (!latest.ok || latest.status !== "found") {
      return { status: "missing", documentId: operation.documentId }
    }
    const message =
      "Image recovery was deferred because this document kept changing in another Studio session."
    return opened(
      latest.record,
      operation.generation,
      {
        status: "deferred",
        aliasCount: localAliasIdsFor(latest.record).length,
        migratedLocalAssetIds: [],
        unresolved: [],
        receipt: null,
        message,
      },
      { kind: "local_media_recovery_deferred", message }
    )
  }

  async #prepareAndMigrate(
    operation: ActiveOperation,
    options: DocumentRouteAdmissionOptions,
    staleHeadReplans: number
  ): Promise<DocumentRouteAdmission | "stale_head"> {
    const { documentId } = operation
    const signal = operation.controller.signal
    this.#progress(operation, options, "checking_document", 0, 1, true)
    const read = await this.dependencies.get(documentId)
    this.#assertOwner(operation)
    const readFailure = this.#projectRead(documentId, read)
    if (readFailure) return readFailure
    if (!read.ok || read.status !== "found") {
      return { status: "missing", documentId }
    }

    const verified = read.record
    if (!recordHasIdentity(verified, documentId)) {
      return { status: "recovery_required", documentId, quarantineId: null }
    }
    if (verified.summary.deletedAt !== null) {
      return { status: "deleted", documentId, summary: verified.summary }
    }
    this.#progress(operation, options, "checking_document", 1, 1, true)

    const pending = await this.dependencies.getPendingReceipt(
      documentId,
      signal
    )
    this.#assertOwner(operation)
    if (!pending.ok) {
      return opened(
        verified,
        operation.generation,
        {
          status: "deferred",
          aliasCount: localAliasIdsFor(verified).length,
          migratedLocalAssetIds: [],
          unresolved: [],
          receipt: null,
          message:
            "Studio could not verify an earlier image recovery receipt. The document was opened unchanged.",
        },
        { kind: pending.failure.kind, message: pending.failure.message }
      )
    }
    if (pending.status === "found") {
      const restored = pending.receipt.restoredAt !== null
      return opened(verified, operation.generation, {
        status: "receipt_pending",
        aliasCount: pending.receipt.aliases.length,
        migratedLocalAssetIds: restored
          ? []
          : pending.receipt.aliases.map((alias) => alias.localAssetId),
        unresolved: [],
        receipt: pending.receipt,
        message: restored
          ? "The device-only version was restored and will stay unchanged until you choose another recovery action."
          : "Recovered Studio images are ready for review.",
      })
    }

    const aliases = localAliasIdsFor(verified)
    if (!aliases.length) return opened(verified, operation.generation)
    if (
      options.recover === false ||
      aliases.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT
    ) {
      const limitExceeded = aliases.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT
      const message = limitExceeded
        ? "This document has too many device-only image identities to recover automatically."
        : "The document opened without recovering device-only images."
      return opened(
        verified,
        operation.generation,
        {
          status: "deferred",
          aliasCount: aliases.length,
          migratedLocalAssetIds: [],
          unresolved: [],
          receipt: null,
          message,
        },
        limitExceeded
          ? { kind: "local_media_recovery_deferred", message }
          : null
      )
    }

    this.#progress(
      operation,
      options,
      "checking_device",
      0,
      aliases.length,
      true
    )
    const localStates = await this.dependencies.inspectLocalAssets(aliases, {
      signal,
      verificationConcurrency: ADMISSION_CONCURRENCY,
    })
    this.#assertOwner(operation)
    this.#progress(
      operation,
      options,
      "checking_device",
      aliases.length,
      aliases.length,
      true
    )

    this.#progress(
      operation,
      options,
      "checking_studio",
      0,
      aliases.length,
      true
    )
    const mappingEvidence = await this.#resolveMappings(
      operation,
      options,
      aliases
    )
    this.#assertOwner(operation)

    const facts = aliases.map<LocalMediaAdmissionFact>(
      (localAssetId, index) => {
        const local = localStates[index]
        const evidence = mappingEvidence?.[index] ?? null
        const promotion = evidence?.resolution.promotion ?? null
        return {
          localAssetId,
          local: localFactFor(local),
          mapping: promotion
            ? {
                status: promotion.asset.status,
                managedAssetId: promotion.asset.id,
                managedSource: managedAssetSource(promotion.asset.id),
                contentSha256: promotion.contentSha256,
              }
            : mappingEvidence === null
              ? { status: "unavailable" }
              : { status: "unmapped" },
        }
      }
    )

    const hashIndexes = facts.flatMap((fact, index) =>
      fact.local.status === "ready" &&
      (fact.mapping.status === "ready" || fact.mapping.status === "archived")
        ? [index]
        : []
    )
    this.#progress(
      operation,
      options,
      "verifying_files",
      0,
      hashIndexes.length,
      true
    )
    let hashed = 0
    await mapWithConcurrency(
      hashIndexes,
      ADMISSION_CONCURRENCY,
      async (index) => {
        const local = localStates[index]
        if (local.status !== "ready") return
        try {
          const hash = await this.dependencies.hashBlob(
            local.record.blob,
            signal
          )
          this.#assertOwner(operation)
          facts[index] = { ...facts[index], localContentSha256: hash }
        } catch (error) {
          if (isAbort(error, signal)) throw error
          facts[index] = {
            ...facts[index],
            local: { status: "unavailable" },
          }
        } finally {
          hashed += 1
          this.#progress(
            operation,
            options,
            "verifying_files",
            hashed,
            hashIndexes.length,
            true
          )
        }
      }
    )
    this.#assertOwner(operation)

    const planned = planLocalMediaAdmission(verified.envelope.document, facts)
    if (!planned.ok) {
      const message = "Studio could not safely prepare image recovery."
      return opened(
        verified,
        operation.generation,
        {
          status: "deferred",
          aliasCount: aliases.length,
          migratedLocalAssetIds: [],
          unresolved: [],
          receipt: null,
          message,
        },
        { kind: "local_media_recovery_deferred", message }
      )
    }
    if (!planned.plan.safeMigrations.length) {
      return opened(verified, operation.generation, {
        status: "unchanged",
        aliasCount: aliases.length,
        migratedLocalAssetIds: [],
        unresolved: planned.plan.unresolved,
        receipt: null,
        message:
          planned.plan.unresolved.length > 0
            ? "Some document images still need attention."
            : null,
      })
    }

    const applied = applyLocalMediaAdmissionPlan(
      verified.envelope.document,
      planned.plan,
      {
        operationId: `route-admission-${operation.generation}-${staleHeadReplans}`,
        at: this.#now(),
      }
    )
    if (!applied.ok) {
      const message =
        "Studio could not safely apply the complete image recovery plan."
      return opened(
        verified,
        operation.generation,
        {
          status: "deferred",
          aliasCount: aliases.length,
          migratedLocalAssetIds: [],
          unresolved: planned.plan.unresolved,
          receipt: null,
          message,
        },
        { kind: "local_media_recovery_deferred", message }
      )
    }

    // The document CAS cannot protect browser-local bytes. Re-read every
    // alias immediately before the non-cancellable migration so a restore,
    // replacement, or quarantine change in another tab cannot be interpreted
    // using the earlier device-state plan.
    const currentLocalStates = await this.dependencies.inspectLocalAssets(
      aliases,
      {
        signal,
        verificationConcurrency: ADMISSION_CONCURRENCY,
      }
    )
    this.#assertOwner(operation)
    let localStateChanged =
      currentLocalStates.length !== localStates.length ||
      currentLocalStates.some(
        (state, index) =>
          !localStates[index] ||
          !sameLocalAdmissionState(localStates[index], state)
      )
    if (!localStateChanged) {
      const readyMigrationIds = new Set(
        planned.plan.safeMigrations
          .filter((migration) => migration.localStatus === "ready")
          .map((migration) => migration.localAssetId)
      )
      await mapWithConcurrency(
        aliases.flatMap((alias, index) =>
          readyMigrationIds.has(alias) ? [index] : []
        ),
        ADMISSION_CONCURRENCY,
        async (index) => {
          const state = currentLocalStates[index]
          if (state.status !== "ready") {
            localStateChanged = true
            return
          }
          try {
            const currentHash = await this.dependencies.hashBlob(
              state.record.blob,
              signal
            )
            this.#assertOwner(operation)
            if (currentHash !== facts[index]?.localContentSha256) {
              localStateChanged = true
            }
          } catch (error) {
            if (isAbort(error, signal)) throw error
            localStateChanged = true
          }
        }
      )
      this.#assertOwner(operation)
    }
    if (localStateChanged) {
      const message =
        "Image recovery was deferred because device image state changed during verification. The document was opened unchanged."
      return opened(
        verified,
        operation.generation,
        {
          status: "deferred",
          aliasCount: aliases.length,
          migratedLocalAssetIds: [],
          unresolved: planned.plan.unresolved,
          receipt: null,
          message,
        },
        { kind: "local_media_recovery_deferred", message }
      )
    }

    this.#assertOwner(operation)
    this.#progress(operation, options, "saving_recovery", 0, 1, false)
    const receiptId =
      this.dependencies.createOperationId?.() ??
      `media-admission-${crypto.randomUUID()}`
    const resultEnvelope: CurrentDraftEnvelope = {
      ...verified.envelope,
      document: applied.document,
    }
    const migrated = await this.dependencies.migrateLocalMedia(
      {
        source: headForRecord(verified),
        resultEnvelope,
        aliases: this.#aliasesForReceipt(planned.plan, mappingEvidence),
        receiptId,
        createdAt: this.#now(),
      },
      signal
    )
    this.#assertOwner(operation)
    if (!migrated.ok) {
      if (migrated.reason === "stale_head") return "stale_head"
      if (migrated.reason === "deleted") {
        return { status: "deleted", documentId, summary: migrated.current }
      }
      if (migrated.reason === "receipt_pending") {
        return opened(verified, operation.generation, {
          status: "receipt_pending",
          aliasCount: migrated.receipt.aliases.length,
          migratedLocalAssetIds: migrated.receipt.aliases.map(
            (alias) => alias.localAssetId
          ),
          unresolved: planned.plan.unresolved,
          receipt: migrated.receipt,
          message: "An earlier image recovery is ready for review.",
        })
      }
      if (migrated.reason === "corrupt_record") {
        return {
          status: "recovery_required",
          documentId,
          quarantineId: migrated.quarantineId,
        }
      }
      if ("failure" in migrated) {
        return {
          status: "unavailable",
          documentId,
          failure: migrated.failure,
        }
      }
      return "stale_head"
    }
    this.#progress(operation, options, "saving_recovery", 1, 1, false)

    return opened(migrated.record, operation.generation, {
      status: migrated.status,
      aliasCount: aliases.length,
      migratedLocalAssetIds: applied.appliedLocalAssetIds,
      unresolved: planned.plan.unresolved,
      receipt: migrated.receipt,
      message:
        applied.appliedLocalAssetIds.length > 0
          ? `Recovered ${applied.appliedLocalAssetIds.length} Studio ${
              applied.appliedLocalAssetIds.length === 1 ? "image" : "images"
            }.`
          : null,
    })
  }

  async #resolveMappings(
    operation: ActiveOperation,
    options: DocumentRouteAdmissionOptions,
    aliases: readonly string[]
  ): Promise<MappingEvidence[] | null> {
    const chunks = chunksOf(aliases, MAPPING_BATCH_SIZE)
    const mappingController = new AbortController()
    const abortMappings = () =>
      mappingController.abort(operation.controller.signal.reason)
    operation.controller.signal.addEventListener("abort", abortMappings, {
      once: true,
    })
    if (operation.controller.signal.aborted) abortMappings()
    let completed = 0
    try {
      const chunkResults = await mapWithConcurrency(
        chunks,
        ADMISSION_CONCURRENCY,
        async (chunk) => {
          let result: PromotionResolution
          try {
            result = await this.dependencies.resolvePromotions(chunk, {
              signal: mappingController.signal,
            })
          } catch (error) {
            mappingController.abort(error)
            throw error
          }
          this.#assertOwner(operation)
          completed += chunk.length
          this.#progress(
            operation,
            options,
            "checking_studio",
            completed,
            aliases.length,
            true
          )
          return result
        }
      )
      return chunkResults.flatMap((result) =>
        result.results.map((resolution) => ({
          resolution,
          requestId: result.requestId,
        }))
      )
    } catch (error) {
      if (isAbort(error, operation.controller.signal)) throw error
      if (error instanceof LocalAssetPromotionHttpError) return null
      return null
    } finally {
      operation.controller.signal.removeEventListener("abort", abortMappings)
    }
  }

  #aliasesForReceipt(
    plan: LocalMediaAdmissionPlan,
    mappingEvidence: readonly MappingEvidence[] | null
  ): AdmissionMigrationAlias[] {
    const requestIds = new Map(
      (mappingEvidence ?? []).map((evidence) => [
        evidence.resolution.localAssetId,
        evidence.requestId,
      ])
    )
    return plan.safeMigrations.map((migration) => ({
      localAssetId: migration.localAssetId,
      managedAssetId: migration.managedAssetId,
      managedSource: migration.managedSource,
      contentSha256: migration.contentSha256,
      managedStatus: migration.managedStatus,
      expectedReferenceKeys: migration.expectedReferenceKeys,
      localState: migration.localStatus,
      relationship: migration.relationship,
      mappingRequestId: requestIds.get(migration.localAssetId)!,
    }))
  }

  #startManagedUseReconciliation(receipt: LocalMediaAdmissionReceipt | null) {
    if (
      !receipt ||
      receipt.restoredAt !== null ||
      receipt.managedUses.every((use) => use.usedAt !== null) ||
      this.#managedUseFinishing.has(receipt.receiptId)
    ) {
      return
    }
    const finishing = mapWithConcurrency(
      receipt.managedUses.filter((use) => use.usedAt === null),
      ADMISSION_CONCURRENCY,
      async (use) => {
        try {
          const recent = await this.dependencies.markManagedUsed(use.assetId, {
            idempotencyKey: use.idempotencyKey,
          })
          await this.dependencies.updateManagedUse({
            receiptId: receipt.receiptId,
            assetId: use.assetId,
            idempotencyKey: use.idempotencyKey,
            requestId: recent.requestId,
            usedAt: recent.usedAt,
            assetRevision: recent.assetRevision,
          })
        } catch {
          // The exact durable key remains in the receipt. A later confirmed
          // admission can replay it without delaying document installation.
        }
      }
    ).then(() => undefined)
    this.#managedUseFinishing.set(receipt.receiptId, finishing)
    void finishing.finally(() => {
      if (this.#managedUseFinishing.get(receipt.receiptId) === finishing) {
        this.#managedUseFinishing.delete(receipt.receiptId)
      }
    })
  }

  #progress(
    operation: ActiveOperation,
    options: DocumentRouteAdmissionOptions,
    phase: DocumentRouteAdmissionPhase,
    completed: number,
    total: number,
    cancellable: boolean
  ) {
    if (!this.#owns(operation)) return
    options.onProgress?.({ phase, completed, total, cancellable })
  }

  #now() {
    return this.dependencies.now?.() ?? new Date().toISOString()
  }

  #ownsGeneration(generation: number) {
    return !this.#disposed && generation === this.#generation
  }

  #owns(operation: ActiveOperation) {
    return (
      this.#ownsGeneration(operation.generation) && this.#active === operation
    )
  }

  #assertOwner(operation: ActiveOperation) {
    operation.controller.signal.throwIfAborted()
    if (!this.#owns(operation)) {
      throw new DOMException(
        "The document admission was superseded.",
        "AbortError"
      )
    }
  }

  async #abortActive() {
    const active = this.#active
    if (!active) return
    active.controller.abort(
      new DOMException("The document admission was superseded.", "AbortError")
    )
    await active.done
  }

  #projectRead(
    documentId: string,
    read: DocumentDraftReadResult
  ): Exclude<DocumentRouteAdmission, { status: "opened" }> | null {
    if (read.ok) {
      return read.status === "missing"
        ? { status: "missing", documentId }
        : null
    }
    if (read.reason === "corrupt_record") {
      return {
        status: "recovery_required",
        documentId,
        quarantineId: read.quarantineId,
      }
    }
    return { status: "unavailable", documentId, failure: read.failure }
  }
}
