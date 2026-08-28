import type { CurrentDraftEnvelope } from "../editor/current-draft-repository"
import { DocumentDraftRepository } from "../editor/document-draft-repository"
import type { DraftRepositoryEvent } from "../editor/document-draft-repository"
import { migrateCurrentDraftToRepository } from "../editor/document-draft-migration"
import type { CurrentDraftRepositoryMigrationResult } from "../editor/document-draft-migration"
import type { DraftRecoveryRecord } from "../editor/draft-recovery"

type ReadyMigration = Extract<
  CurrentDraftRepositoryMigrationResult,
  { status: "empty" | "migrated" | "collision" }
>

type PersistenceFailureState = Readonly<{
  failure: Readonly<{ kind: string; message: string }>
  recoverableEnvelope: CurrentDraftEnvelope | null
}>

export type StudioPersistenceState =
  | Readonly<{ status: "opening" }>
  | Readonly<{
      status: "ready"
      migration: ReadyMigration
      warning: string | null
    }>
  | Readonly<{
      status: "recovery_required"
      recovery: DraftRecoveryRecord
    }>
  | (Readonly<{ status: "blocked" }> & PersistenceFailureState)
  | (Readonly<{ status: "unavailable" }> & PersistenceFailureState)

type MigrationRunner = (
  repository: DocumentDraftRepository
) => Promise<CurrentDraftRepositoryMigrationResult>

export type StudioPersistenceRuntimeOptions = Readonly<{
  createRepository?: () => DocumentDraftRepository
  migrate?: MigrationRunner
  scheduleMicrotask?: (callback: () => void) => void
}>

const collisionWarning =
  "Studio preserved a different legacy draft as a conflict instead of overwriting this document."

function warningForReadyMigration(migration: ReadyMigration): string | null {
  if (migration.status === "collision") return collisionWarning
  if (migration.status === "empty") return null
  return (
    [
      ...migration.bootstrapWarnings.map((warning) => warning.message),
      ...migration.cleanupFailures.map((failure) => failure.message),
    ].join(" ") || null
  )
}

function unavailableState(
  migration: CurrentDraftRepositoryMigrationResult
): Extract<StudioPersistenceState, { status: "unavailable" }> {
  if (migration.status === "repository_unavailable") {
    return {
      status: "unavailable",
      failure: migration.failure,
      recoverableEnvelope: null,
    }
  }
  if (migration.status === "legacy_storage_unavailable") {
    return {
      status: "unavailable",
      failure: {
        kind: "legacy_storage_unavailable",
        message: migration.failure.message,
      },
      recoverableEnvelope: migration.recoverableDraft ?? null,
    }
  }
  if (migration.status === "validation_failed") {
    const failure =
      migration.failure.reason === "validation_failed"
        ? migration.failure.failure
        : {
            kind: "too_large",
            message: `The legacy draft is ${(migration.failure.encodedByteLength / 1024 / 1024).toFixed(1)} MiB; Studio supports drafts up to ${(migration.failure.maximumEncodedByteLength / 1024 / 1024).toFixed(0)} MiB.`,
          }
    return {
      status: "unavailable",
      failure,
      recoverableEnvelope: null,
    }
  }
  if (migration.status === "migration_failed") {
    return {
      status: "unavailable",
      failure: migration.failure,
      recoverableEnvelope: null,
    }
  }
  if (migration.status === "verification_failed") {
    return {
      status: "unavailable",
      failure: {
        kind: "verification_failed",
        message: migration.message,
      },
      recoverableEnvelope: null,
    }
  }
  throw new Error(`Migration status ${migration.status} is not unavailable.`)
}

function stateForMigration(
  migration: CurrentDraftRepositoryMigrationResult
): Exclude<StudioPersistenceState, { status: "opening" }> {
  if (
    migration.status === "empty" ||
    migration.status === "migrated" ||
    migration.status === "collision"
  ) {
    return {
      status: "ready",
      migration,
      warning: warningForReadyMigration(migration),
    }
  }
  if (migration.status === "recovery_required") {
    return { status: "recovery_required", recovery: migration.recovery }
  }
  if (migration.status === "blocked") {
    return {
      status: "blocked",
      failure: migration.failure,
      recoverableEnvelope: null,
    }
  }
  return unavailableState(migration)
}

/**
 * Client-only persistence owner shared by the library and document routes.
 * Construction is inert; start or retain performs the first repository work.
 */
export class StudioPersistenceRuntime {
  readonly #createRepository: () => DocumentDraftRepository
  readonly #migrate: MigrationRunner
  readonly #scheduleMicrotask: (callback: () => void) => void
  readonly #stateListeners = new Set<() => void>()
  readonly #repositoryEventListeners = new Set<
    (event: DraftRepositoryEvent) => void
  >()
  #repository: DocumentDraftRepository | null = null
  #repositoryUnsubscribe: (() => void) | null = null
  #state: StudioPersistenceState = { status: "opening" }
  #migrationPromise: Promise<void> | null = null
  #generation = 0
  #retainCount = 0
  #leaseCount = 0
  #closeSchedule = 0
  #started = false
  #finalizing = false
  #closed = false

  constructor(options: StudioPersistenceRuntimeOptions = {}) {
    this.#createRepository =
      options.createRepository ?? (() => new DocumentDraftRepository())
    this.#migrate =
      options.migrate ??
      ((repository) => migrateCurrentDraftToRepository({ repository }))
    this.#scheduleMicrotask = options.scheduleMicrotask ?? queueMicrotask
  }

  get repository() {
    if (this.#closed) throw new Error("Studio persistence is closed.")
    return this.#ensureRepository()
  }

  get state() {
    return this.#state
  }

  getSnapshot = () => this.#state

  subscribe = (listener: () => void) => {
    if (this.#finalizing || this.#closed) return () => undefined
    this.#stateListeners.add(listener)
    return () => {
      this.#stateListeners.delete(listener)
    }
  }

  subscribeRepositoryEvents = (
    listener: (event: DraftRepositoryEvent) => void
  ) => {
    if (this.#finalizing || this.#closed) return () => undefined
    this.#repositoryEventListeners.add(listener)
    return () => {
      this.#repositoryEventListeners.delete(listener)
    }
  }

  start(): Promise<void> {
    if (this.#finalizing || this.#closed) {
      return Promise.reject(new Error("Studio persistence is closed."))
    }
    this.#started = true
    this.#installRepositorySubscription()
    return this.#startMigrationForGeneration()
  }

  retry(): void {
    if (
      this.#finalizing ||
      this.#closed ||
      (this.#state.status !== "blocked" && this.#state.status !== "unavailable")
    )
      return
    this.#generation += 1
    this.#migrationPromise = null
    this.#publishState({ status: "opening" })
    void this.#startMigrationForGeneration()
  }

  completeRecovery(warning: string | null): void {
    if (
      this.#finalizing ||
      this.#closed ||
      this.#state.status !== "recovery_required"
    )
      return
    this.#generation += 1
    this.#migrationPromise = Promise.resolve()
    this.#publishState({
      status: "ready",
      migration: { status: "empty" },
      warning,
    })
  }

  retain(): () => void {
    if (this.#finalizing || this.#closed) {
      throw new Error("Studio persistence is closed.")
    }
    this.#retainCount += 1
    this.#closeSchedule += 1
    void this.start()
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      this.#retainCount -= 1
      if (this.#retainCount === 0) this.#scheduleFinalization()
    }
  }

  acquireLease(): () => void {
    if (!this.#started || this.#finalizing || this.#closed) {
      throw new Error("Studio persistence must be retained before leasing.")
    }
    this.#leaseCount += 1
    let leased = true
    return () => {
      if (!leased) return
      leased = false
      this.#leaseCount -= 1
      this.#closeRepositoryIfReleased()
    }
  }

  #ensureRepository() {
    this.#repository ??= this.#createRepository()
    return this.#repository
  }

  #installRepositorySubscription() {
    if (this.#repositoryUnsubscribe) return
    this.#repositoryUnsubscribe = this.#ensureRepository().subscribe(
      (event) => {
        if (this.#finalizing || this.#closed) return
        for (const listener of this.#repositoryEventListeners) {
          try {
            listener(event)
          } catch {
            // Event observers cannot affect repository durability or other peers.
          }
        }
      }
    )
  }

  #startMigrationForGeneration() {
    if (this.#migrationPromise) return this.#migrationPromise
    const generation = this.#generation
    const repository = this.#ensureRepository()
    const migrationPromise = Promise.resolve()
      .then(() => this.#migrate(repository))
      .then(
        (migration) => {
          if (!this.#accepts(generation)) return
          this.#publishState(stateForMigration(migration))
        },
        (error: unknown) => {
          if (!this.#accepts(generation)) return
          const detail =
            error instanceof Error && error.message.trim()
              ? ` ${error.message.trim()}`
              : ""
          this.#publishState({
            status: "unavailable",
            failure: {
              kind: "storage_unavailable",
              message: `Studio document storage is unavailable.${detail}`,
            },
            recoverableEnvelope: null,
          })
        }
      )
    this.#migrationPromise = migrationPromise
    return migrationPromise
  }

  #accepts(generation: number) {
    return !this.#finalizing && !this.#closed && generation === this.#generation
  }

  #publishState(state: StudioPersistenceState) {
    if (this.#finalizing || this.#closed) return
    this.#state = state
    for (const listener of this.#stateListeners) {
      try {
        listener()
      } catch {
        // One view cannot prevent the persistence state reaching other views.
      }
    }
  }

  #scheduleFinalization() {
    const schedule = this.#closeSchedule + 1
    this.#closeSchedule = schedule
    this.#scheduleMicrotask(() => {
      if (
        schedule !== this.#closeSchedule ||
        this.#retainCount > 0 ||
        this.#finalizing ||
        this.#closed
      )
        return
      this.#beginFinalization()
    })
  }

  #beginFinalization() {
    this.#finalizing = true
    this.#generation += 1
    this.#migrationPromise = null
    this.#repositoryUnsubscribe?.()
    this.#repositoryUnsubscribe = null
    this.#stateListeners.clear()
    this.#repositoryEventListeners.clear()
    this.#closeRepositoryIfReleased()
  }

  #closeRepositoryIfReleased() {
    if (!this.#finalizing || this.#closed || this.#leaseCount > 0) return
    this.#closed = true
    this.#repository?.close()
  }
}
