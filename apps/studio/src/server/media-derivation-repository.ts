import {
  assertMediaDerivationAttemptId,
  assertMediaDerivationFailureCode,
  assertMediaDerivationIdempotencyKey,
  assertMediaDerivationJobId,
  createMediaDerivationAttemptId,
  createMediaDerivationJobId,
  mediaDerivationMutationRequestHash,
  mediaDerivationRequestIdentity,
  MediaDerivationError,
  parseMediaDerivationConfiguration,
  parseMediaDerivationCreateInput,
} from "./media-derivations"
import type {
  MediaDerivationAttempt,
  MediaDerivationConfiguration,
  MediaDerivationCreateInput,
  MediaDerivationJob,
  MediaDerivationJobState,
  MediaDerivationOperation,
  MediaDerivationProvenance,
} from "./media-derivations"

type MediaAssetIdentityRow = {
  id: string
  workspace_id: string
  content_hash: string
  media_type: "image/png" | "image/jpeg" | "image/webp"
  width: number
  height: number
  status: "ready" | "archived"
}

type MediaDerivationJobRow = {
  id: string
  workspace_id: string
  source_asset_id: string
  source_content_hash: string
  operation: MediaDerivationOperation
  parameters_json: string
  parameters_hash: string
  provider_key: string
  provider_model_version: string
  privacy_policy_version: string
  request_fingerprint: string
  state: MediaDerivationJobState
  output_asset_id: string | null
  active_attempt_id: string | null
  attempt_count: number
  max_attempts: number
  retryable: number
  safe_failure_code: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  cancellation_requested_at: string | null
  updated_at: string
}

type MediaDerivationRequestRow = MediaDerivationJobRow & {
  claimed_fingerprint: string
}

type MediaDerivationAttemptRow = {
  id: string
  workspace_id: string
  job_id: string
  attempt_number: number
  provider_execution_id: string | null
  state: "running" | "succeeded" | "failed" | "cancelled"
  safe_failure_code: string | null
  retryable: number
  started_at: string
  finished_at: string | null
}

type MediaDerivationProvenanceRow = {
  workspace_id: string
  output_asset_id: string
  source_asset_id: string
  source_content_hash: string
  derivation_job_id: string
  operation: MediaDerivationOperation
  provider_key: string
  provider_model_version: string
  privacy_policy_version: string
  output_content_hash: string
  output_media_type: "image/png" | "image/jpeg" | "image/webp"
  output_width: number
  output_height: number
  created_at: string
}

type MediaDerivationMutationReceiptRow = {
  workspace_id: string
  idempotency_key: string
  job_id: string
  action: "cancel" | "retry"
  request_hash: string
  result_json: string
  dispatch_state: "not_required" | "pending" | "dispatched"
  created_at: string
  dispatched_at: string | null
}

const jobColumns = `
  id, workspace_id, source_asset_id, source_content_hash, operation,
  parameters_json, parameters_hash, provider_key, provider_model_version,
  privacy_policy_version, request_fingerprint, state, output_asset_id,
  active_attempt_id, attempt_count, max_attempts, retryable,
  safe_failure_code, created_at, started_at, completed_at,
  cancellation_requested_at, updated_at
`

const qualifiedJobColumns = (alias: string) =>
  jobColumns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => `${alias}.${column} AS ${column}`)
    .join(", ")

const attemptColumns = `
  id, workspace_id, job_id, attempt_number, provider_execution_id, state,
  safe_failure_code, retryable, started_at, finished_at
`

const provenanceColumns = `
  workspace_id, output_asset_id, source_asset_id, source_content_hash,
  derivation_job_id, operation, provider_key, provider_model_version,
  privacy_policy_version, output_content_hash, output_media_type,
  output_width, output_height, created_at
`

const jobFromRow = (row: MediaDerivationJobRow): MediaDerivationJob => {
  if (row.parameters_json !== "{}") {
    throw new Error("media_derivation_parameters_not_canonical")
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceAssetId: row.source_asset_id,
    sourceContentHash: row.source_content_hash,
    operation: row.operation,
    parameters: {},
    parametersHash: row.parameters_hash,
    providerKey: row.provider_key,
    providerModelVersion: row.provider_model_version,
    privacyPolicyVersion: row.privacy_policy_version,
    requestFingerprint: row.request_fingerprint,
    state: row.state,
    outputAssetId: row.output_asset_id,
    activeAttemptId: row.active_attempt_id,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    retryable: Boolean(row.retryable),
    safeFailureCode: row.safe_failure_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancellationRequestedAt: row.cancellation_requested_at,
    updatedAt: row.updated_at,
  }
}

const attemptFromRow = (
  row: MediaDerivationAttemptRow
): MediaDerivationAttempt => ({
  id: row.id,
  workspaceId: row.workspace_id,
  jobId: row.job_id,
  attemptNumber: Number(row.attempt_number),
  providerExecutionId: row.provider_execution_id,
  state: row.state,
  safeFailureCode: row.safe_failure_code,
  retryable: Boolean(row.retryable),
  startedAt: row.started_at,
  finishedAt: row.finished_at,
})

const provenanceFromRow = (
  row: MediaDerivationProvenanceRow
): MediaDerivationProvenance => ({
  workspaceId: row.workspace_id,
  outputAssetId: row.output_asset_id,
  sourceAssetId: row.source_asset_id,
  sourceContentHash: row.source_content_hash,
  derivationJobId: row.derivation_job_id,
  operation: row.operation,
  providerKey: row.provider_key,
  providerModelVersion: row.provider_model_version,
  privacyPolicyVersion: row.privacy_policy_version,
  outputContentHash: row.output_content_hash,
  outputMediaType: row.output_media_type,
  outputWidth: Number(row.output_width),
  outputHeight: Number(row.output_height),
  createdAt: row.created_at,
})

const batchChanges = (result: D1Result<unknown> | undefined) =>
  Number(result?.meta.changes ?? 0)

export type CreateMediaDerivationResult = Readonly<{
  job: MediaDerivationJob
  created: boolean
}>

export type MediaDerivationClaim = Readonly<{
  job: MediaDerivationJob
  attempt: MediaDerivationAttempt
}>

export type MediaDerivationMutationResult = Readonly<{
  job: MediaDerivationJob
  replayed: boolean
  dispatchRequired: boolean
}>

export class MediaDerivationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly options: {
      now?: () => string
      createJobId?: () => string
      createAttemptId?: () => string
    } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private createJobId() {
    return this.options.createJobId?.() ?? createMediaDerivationJobId()
  }

  private createAttemptId() {
    return this.options.createAttemptId?.() ?? createMediaDerivationAttemptId()
  }

  private async sourceAsset(workspaceId: string, assetId: string) {
    return this.db
      .prepare(
        `/* derivation:source */ SELECT id, workspace_id, content_hash,
                media_type, width, height, status
         FROM media_assets WHERE workspace_id = ?1 AND id = ?2`
      )
      .bind(workspaceId, assetId)
      .first<MediaAssetIdentityRow>()
  }

  private async outputAsset(workspaceId: string, assetId: string) {
    return this.db
      .prepare(
        `/* derivation:output */ SELECT id, workspace_id, content_hash,
                media_type, width, height, status
         FROM media_assets WHERE workspace_id = ?1 AND id = ?2`
      )
      .bind(workspaceId, assetId)
      .first<MediaAssetIdentityRow>()
  }

  private async jobRow(workspaceId: string, jobId: string) {
    return this.db
      .prepare(
        `/* derivation:get */ SELECT ${jobColumns}
         FROM media_derivation_jobs WHERE workspace_id = ?1 AND id = ?2`
      )
      .bind(workspaceId, jobId)
      .first<MediaDerivationJobRow>()
  }

  private async requiredJob(workspaceId: string, jobId: string) {
    const row = await this.jobRow(
      workspaceId,
      assertMediaDerivationJobId(jobId)
    )
    if (!row) {
      throw new MediaDerivationError(
        "derivation_job_not_found",
        404,
        "Media derivation job was not found in this workspace"
      )
    }
    return row
  }

  private mutationReceipt(workspaceId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `/* derivation:mutation-receipt-get */
         SELECT workspace_id, idempotency_key, job_id, action, request_hash,
                result_json, dispatch_state, created_at, dispatched_at
         FROM media_derivation_mutation_receipts
         WHERE workspace_id = ?1 AND idempotency_key = ?2`
      )
      .bind(workspaceId, idempotencyKey)
      .first<MediaDerivationMutationReceiptRow>()
  }

  private mutationReceiptResult(
    receipt: MediaDerivationMutationReceiptRow,
    expected: {
      jobId: string
      action: "cancel" | "retry"
      requestHash: string
    },
    replayed: boolean
  ): MediaDerivationMutationResult {
    if (
      receipt.job_id !== expected.jobId ||
      receipt.action !== expected.action ||
      receipt.request_hash !== expected.requestHash
    ) {
      throw new MediaDerivationError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for a different mutation"
      )
    }
    let job: MediaDerivationJob
    try {
      job = JSON.parse(receipt.result_json) as MediaDerivationJob
    } catch {
      throw new Error("media_derivation_mutation_receipt_unreadable")
    }
    if (job.workspaceId !== receipt.workspace_id || job.id !== receipt.job_id) {
      throw new Error("media_derivation_mutation_receipt_unreadable")
    }
    return {
      job,
      replayed,
      dispatchRequired:
        receipt.action === "retry" && receipt.dispatch_state === "pending",
    }
  }

  private mutationReceiptStatement(input: {
    workspaceId: string
    idempotencyKey: string
    jobId: string
    action: "cancel" | "retry"
    requestHash: string
    job: MediaDerivationJob
    dispatchState: "not_required" | "pending"
    now: string
    requiredState?: MediaDerivationJobState
    requiredUpdatedAt?: string
  }) {
    return this.db
      .prepare(
        `/* derivation:mutation-receipt-insert */
         INSERT INTO media_derivation_mutation_receipts
           (workspace_id, idempotency_key, job_id, action, request_hash,
            result_json, dispatch_state, created_at, dispatched_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL
         WHERE ?9 IS NULL OR EXISTS (
           SELECT 1 FROM media_derivation_jobs
           WHERE workspace_id = ?1 AND id = ?3
             AND state = ?9 AND updated_at = ?10
         )`
      )
      .bind(
        input.workspaceId,
        input.idempotencyKey,
        input.jobId,
        input.action,
        input.requestHash,
        JSON.stringify(input.job),
        input.dispatchState,
        input.now,
        input.requiredState ?? null,
        input.requiredUpdatedAt ?? null
      )
  }

  private async requestRow(workspaceId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `/* derivation:idempotency-get */
         SELECT ${qualifiedJobColumns("jobs")},
                requests.request_fingerprint AS claimed_fingerprint
         FROM media_derivation_requests requests
         JOIN media_derivation_jobs jobs
           ON jobs.workspace_id = requests.workspace_id
          AND jobs.id = requests.job_id
         WHERE requests.workspace_id = ?1
           AND requests.idempotency_key = ?2`
      )
      .bind(workspaceId, idempotencyKey)
      .first<MediaDerivationRequestRow>()
  }

  private async fingerprintRow(workspaceId: string, fingerprint: string) {
    return this.db
      .prepare(
        `/* derivation:fingerprint-get */ SELECT ${jobColumns}
         FROM media_derivation_jobs
         WHERE workspace_id = ?1 AND request_fingerprint = ?2`
      )
      .bind(workspaceId, fingerprint)
      .first<MediaDerivationJobRow>()
  }

  private async attemptRow(
    workspaceId: string,
    jobId: string,
    attemptId: string
  ) {
    return this.db
      .prepare(
        `/* derivation:attempt-get */ SELECT ${attemptColumns}
         FROM media_derivation_attempts
         WHERE workspace_id = ?1 AND job_id = ?2 AND id = ?3`
      )
      .bind(workspaceId, jobId, attemptId)
      .first<MediaDerivationAttemptRow>()
  }

  private async attachRequest(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    jobId: string,
    now: string
  ) {
    let writeError: unknown = null
    try {
      const result = await this.db
        .prepare(
          `/* derivation:idempotency-insert */
           INSERT INTO media_derivation_requests
             (workspace_id, idempotency_key, request_fingerprint, job_id, created_at)
           SELECT ?1, ?2, ?3, id, ?5
           FROM media_derivation_jobs
           WHERE workspace_id = ?1 AND id = ?4 AND request_fingerprint = ?3`
        )
        .bind(workspaceId, idempotencyKey, fingerprint, jobId, now)
        .run()
      if (batchChanges(result) === 1) return
    } catch (error) {
      // A concurrent claim is resolved by the authoritative request row below.
      writeError = error
    }
    const claimed = await this.requestRow(workspaceId, idempotencyKey)
    if (!claimed && writeError) throw writeError
    if (
      !claimed ||
      claimed.claimed_fingerprint !== fingerprint ||
      claimed.request_fingerprint !== fingerprint
    ) {
      throw new MediaDerivationError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for a different media derivation"
      )
    }
  }

  async get(workspaceId: string, jobId: string): Promise<MediaDerivationJob> {
    return jobFromRow(await this.requiredJob(workspaceId, jobId))
  }

  async latestForSource(
    workspaceId: string,
    sourceAssetId: string
  ): Promise<MediaDerivationJob | null> {
    const row = await this.db
      .prepare(
        `/* derivation:latest-for-source */ SELECT ${jobColumns}
         FROM media_derivation_jobs
         WHERE workspace_id = ?1 AND source_asset_id = ?2
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .bind(workspaceId, sourceAssetId)
      .first<MediaDerivationJobRow>()
    return row ? jobFromRow(row) : null
  }

  async create(
    workspaceId: string,
    idempotencyKeyInput: string,
    createInput: MediaDerivationCreateInput,
    configurationInput: MediaDerivationConfiguration
  ): Promise<CreateMediaDerivationResult> {
    const input = parseMediaDerivationCreateInput(createInput)
    const configuration = parseMediaDerivationConfiguration(configurationInput)
    const idempotencyKey =
      assertMediaDerivationIdempotencyKey(idempotencyKeyInput)
    const replay = await this.requestRow(workspaceId, idempotencyKey)
    if (replay) {
      const replayIdentity = await mediaDerivationRequestIdentity({
        workspaceId,
        sourceAssetId: input.sourceAssetId,
        sourceContentHash: replay.source_content_hash,
        operation: input.operation,
        parameters: input.parameters,
        configuration,
      })
      if (
        replay.claimed_fingerprint !== replayIdentity.requestFingerprint ||
        replay.request_fingerprint !== replayIdentity.requestFingerprint
      ) {
        throw new MediaDerivationError(
          "idempotency_key_reused",
          409,
          "Idempotency-Key was already used for a different media derivation"
        )
      }
      return { job: jobFromRow(replay), created: false }
    }
    const source = await this.sourceAsset(workspaceId, input.sourceAssetId)
    if (!source) {
      throw new MediaDerivationError(
        "source_asset_not_ready",
        409,
        "Background removal requires a ready asset owned by this workspace"
      )
    }
    const identity = await mediaDerivationRequestIdentity({
      workspaceId,
      sourceAssetId: source.id,
      sourceContentHash: source.content_hash,
      operation: input.operation,
      parameters: input.parameters,
      configuration,
    })
    const compatible = await this.fingerprintRow(
      workspaceId,
      identity.requestFingerprint
    )
    const now = this.now()
    if (compatible) {
      await this.attachRequest(
        workspaceId,
        idempotencyKey,
        identity.requestFingerprint,
        compatible.id,
        now
      )
      return { job: jobFromRow(compatible), created: false }
    }
    if (source.status !== "ready") {
      throw new MediaDerivationError(
        "source_asset_not_ready",
        409,
        "Background removal requires a ready asset owned by this workspace"
      )
    }

    const jobId = assertMediaDerivationJobId(this.createJobId())
    let writeError: unknown = null
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `/* derivation:create-job */
             INSERT INTO media_derivation_jobs
               (id, workspace_id, source_asset_id, source_content_hash,
                operation, parameters_json, parameters_hash, provider_key,
                provider_model_version, privacy_policy_version,
                request_fingerprint, state, attempt_count, max_attempts,
                retryable, created_at, updated_at)
             SELECT ?1, workspace_id, id, content_hash, ?4, ?5, ?6, ?7,
                    ?8, ?9, ?10, 'queued', 0, ?11, 0, ?12, ?12
             FROM media_assets
             WHERE workspace_id = ?2 AND id = ?3 AND status = 'ready'
               AND content_hash = ?13`
          )
          .bind(
            jobId,
            workspaceId,
            source.id,
            input.operation,
            identity.parametersJson,
            identity.parametersHash,
            configuration.providerKey,
            configuration.providerModelVersion,
            configuration.privacyPolicyVersion,
            identity.requestFingerprint,
            configuration.maxAttempts,
            now,
            source.content_hash
          ),
        this.db
          .prepare(
            `/* derivation:create-request */
             INSERT INTO media_derivation_requests
               (workspace_id, idempotency_key, request_fingerprint, job_id, created_at)
             SELECT ?1, ?2, ?3, id, ?5
             FROM media_derivation_jobs
             WHERE workspace_id = ?1 AND id = ?4 AND request_fingerprint = ?3`
          )
          .bind(
            workspaceId,
            idempotencyKey,
            identity.requestFingerprint,
            jobId,
            now
          ),
      ])
      if (batchChanges(results[0]) === 1 && batchChanges(results[1]) === 1) {
        const created = await this.requiredJob(workspaceId, jobId)
        return { job: jobFromRow(created), created: true }
      }
    } catch (error) {
      // Unique-key races are resolved through the request or fingerprint rows.
      writeError = error
    }

    const claimed = await this.requestRow(workspaceId, idempotencyKey)
    if (claimed) {
      if (claimed.claimed_fingerprint !== identity.requestFingerprint) {
        throw new MediaDerivationError(
          "idempotency_key_reused",
          409,
          "Idempotency-Key was already used for a different media derivation"
        )
      }
      return { job: jobFromRow(claimed), created: false }
    }
    const raced = await this.fingerprintRow(
      workspaceId,
      identity.requestFingerprint
    )
    if (raced) {
      await this.attachRequest(
        workspaceId,
        idempotencyKey,
        identity.requestFingerprint,
        raced.id,
        now
      )
      return { job: jobFromRow(raced), created: false }
    }
    if (writeError) throw writeError
    throw new MediaDerivationError(
      "source_asset_not_ready",
      409,
      "The source asset changed before the derivation job was committed"
    )
  }

  async claim(
    workspaceId: string,
    jobId: string
  ): Promise<MediaDerivationClaim> {
    const current = await this.requiredJob(workspaceId, jobId)
    if (current.state !== "queued") {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Only a queued media derivation can be claimed"
      )
    }
    if (current.attempt_count >= current.max_attempts) {
      throw new MediaDerivationError(
        "derivation_attempt_limit_reached",
        409,
        "Media derivation attempt budget is exhausted"
      )
    }
    const attemptId = assertMediaDerivationAttemptId(this.createAttemptId())
    const attemptNumber = current.attempt_count + 1
    const now = this.now()
    let results: D1Result<unknown>[]
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `/* derivation:claim-job */
             UPDATE media_derivation_jobs
             SET state = 'running', active_attempt_id = ?3,
                 attempt_count = attempt_count + 1,
                 started_at = COALESCE(started_at, ?5), updated_at = ?5
             WHERE workspace_id = ?1 AND id = ?2 AND state = 'queued'
               AND active_attempt_id IS NULL AND attempt_count = ?4
               AND attempt_count < max_attempts`
          )
          .bind(workspaceId, current.id, attemptId, current.attempt_count, now),
        this.db
          .prepare(
            `/* derivation:claim-attempt */
             INSERT INTO media_derivation_attempts
               (id, workspace_id, job_id, attempt_number, state, started_at)
             SELECT ?3, workspace_id, id, ?4, 'running', ?5
             FROM media_derivation_jobs
             WHERE workspace_id = ?1 AND id = ?2 AND state = 'running'
               AND active_attempt_id = ?3 AND attempt_count = ?4`
          )
          .bind(workspaceId, current.id, attemptId, attemptNumber, now),
      ])
    } catch (error) {
      const latest = await this.requiredJob(workspaceId, current.id)
      if (latest.state === "queued") throw error
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Another executor claimed this media derivation"
      )
    }
    if (batchChanges(results[0]) !== 1 || batchChanges(results[1]) !== 1) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Another executor claimed this media derivation"
      )
    }
    const [job, attempt] = await Promise.all([
      this.requiredJob(workspaceId, current.id),
      this.attemptRow(workspaceId, current.id, attemptId),
    ])
    if (!attempt) throw new Error("media_derivation_claim_unreadable")
    return { job: jobFromRow(job), attempt: attemptFromRow(attempt) }
  }

  async fail(
    workspaceId: string,
    jobId: string,
    attemptIdInput: string,
    failure: Readonly<{ code: string; retryable: boolean }>
  ): Promise<MediaDerivationJob> {
    const attemptId = assertMediaDerivationAttemptId(attemptIdInput)
    const failureCode = assertMediaDerivationFailureCode(failure.code)
    const current = await this.requiredJob(workspaceId, jobId)
    if (current.active_attempt_id !== attemptId) {
      throw new MediaDerivationError(
        "derivation_attempt_stale",
        409,
        "The media derivation attempt no longer owns settlement"
      )
    }
    const now = this.now()
    const retryable =
      failure.retryable && current.attempt_count < current.max_attempts
    const results = await this.db.batch([
      this.db
        .prepare(
          `/* derivation:fail-job */
           UPDATE media_derivation_jobs
           SET state = 'failed', retryable = ?4, safe_failure_code = ?5,
               completed_at = ?6, updated_at = ?6
           WHERE workspace_id = ?1 AND id = ?2 AND state = 'running'
             AND active_attempt_id = ?3`
        )
        .bind(
          workspaceId,
          current.id,
          attemptId,
          retryable ? 1 : 0,
          failureCode,
          now
        ),
      this.db
        .prepare(
          `/* derivation:fail-attempt */
           UPDATE media_derivation_attempts
           SET state = 'failed', retryable = ?4, safe_failure_code = ?5,
               finished_at = ?6
           WHERE workspace_id = ?1 AND job_id = ?2 AND id = ?3
             AND state = 'running'
             AND EXISTS (
               SELECT 1 FROM media_derivation_jobs jobs
               WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
                 AND jobs.state = 'failed' AND jobs.active_attempt_id = ?3
             )`
        )
        .bind(
          workspaceId,
          current.id,
          attemptId,
          retryable ? 1 : 0,
          failureCode,
          now
        ),
    ])
    if (batchChanges(results[0]) !== 1 || batchChanges(results[1]) !== 1) {
      throw new MediaDerivationError(
        "derivation_attempt_stale",
        409,
        "The media derivation attempt no longer owns settlement"
      )
    }
    return jobFromRow(await this.requiredJob(workspaceId, current.id))
  }

  async retry(workspaceId: string, jobId: string): Promise<MediaDerivationJob> {
    const current = await this.requiredJob(workspaceId, jobId)
    if (
      current.state !== "failed" ||
      !current.retryable ||
      current.attempt_count >= current.max_attempts
    ) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Only an eligible retryable failure can be requeued"
      )
    }
    const result = await this.db
      .prepare(
        `/* derivation:retry */
         UPDATE media_derivation_jobs
         SET state = 'queued', active_attempt_id = NULL, retryable = 0,
             safe_failure_code = NULL, completed_at = NULL, updated_at = ?3
         WHERE workspace_id = ?1 AND id = ?2 AND state = 'failed'
           AND retryable = 1 AND attempt_count < max_attempts`
      )
      .bind(workspaceId, current.id, this.now())
      .run()
    if (batchChanges(result) !== 1) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Media derivation changed before retry was committed"
      )
    }
    return jobFromRow(await this.requiredJob(workspaceId, current.id))
  }

  async requestCancellation(
    workspaceId: string,
    jobId: string
  ): Promise<MediaDerivationJob> {
    const current = await this.requiredJob(workspaceId, jobId)
    if (current.state === "cancelling" || current.state === "cancelled") {
      return jobFromRow(current)
    }
    if (current.state !== "queued" && current.state !== "running") {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Only a queued or running media derivation can be cancelled"
      )
    }
    const now = this.now()
    const result = await this.db
      .prepare(
        `/* derivation:request-cancellation */
         UPDATE media_derivation_jobs
         SET state = CASE WHEN state = 'queued' THEN 'cancelled'
                          ELSE 'cancelling' END,
             cancellation_requested_at = ?3,
             completed_at = CASE WHEN state = 'queued' THEN ?3 ELSE NULL END,
             retryable = 0, safe_failure_code = NULL, updated_at = ?3
         WHERE workspace_id = ?1 AND id = ?2
           AND state IN ('queued', 'running')`
      )
      .bind(workspaceId, current.id, now)
      .run()
    if (batchChanges(result) !== 1) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Media derivation changed before cancellation was recorded"
      )
    }
    return jobFromRow(await this.requiredJob(workspaceId, current.id))
  }

  async requestCancellationWithReceipt(
    workspaceId: string,
    jobId: string,
    idempotencyKeyInput: string,
    expectedUpdatedAt: string
  ): Promise<MediaDerivationMutationResult> {
    const idempotencyKey =
      assertMediaDerivationIdempotencyKey(idempotencyKeyInput)
    const requestHash = await mediaDerivationMutationRequestHash({
      workspaceId,
      jobId,
      action: "cancel",
      expectedUpdatedAt,
    })
    const expected = { jobId, action: "cancel" as const, requestHash }
    const existing = await this.mutationReceipt(workspaceId, idempotencyKey)
    if (existing) return this.mutationReceiptResult(existing, expected, true)

    const current = await this.requiredJob(workspaceId, jobId)
    if (current.updated_at !== expectedUpdatedAt) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Media derivation changed before cancellation"
      )
    }
    if (
      current.state !== "queued" &&
      current.state !== "running" &&
      current.state !== "cancelling" &&
      current.state !== "cancelled"
    ) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Only a queued or running media derivation can be cancelled"
      )
    }

    const now = this.now()
    const currentJob = jobFromRow(current)
    const resultJob: MediaDerivationJob =
      current.state === "cancelling" || current.state === "cancelled"
        ? currentJob
        : {
            ...currentJob,
            state: current.state === "queued" ? "cancelled" : "cancelling",
            cancellationRequestedAt: now,
            completedAt: current.state === "queued" ? now : null,
            retryable: false,
            safeFailureCode: null,
            updatedAt: now,
          }
    const receipt = this.mutationReceiptStatement({
      workspaceId,
      idempotencyKey,
      jobId: current.id,
      action: "cancel",
      requestHash,
      job: resultJob,
      dispatchState: "not_required",
      now,
      requiredState: resultJob.state,
      requiredUpdatedAt: resultJob.updatedAt,
    })

    try {
      if (current.state === "cancelling" || current.state === "cancelled") {
        const inserted = await receipt.run()
        if (batchChanges(inserted) !== 1) {
          throw new Error("media_derivation_mutation_receipt_incomplete")
        }
      } else {
        const results = await this.db.batch([
          this.db
            .prepare(
              `/* derivation:request-cancellation-receipted */
               UPDATE media_derivation_jobs
               SET state = CASE WHEN state = 'queued' THEN 'cancelled'
                                ELSE 'cancelling' END,
                   cancellation_requested_at = ?4,
                   completed_at = CASE WHEN state = 'queued' THEN ?4 ELSE NULL END,
                   retryable = 0, safe_failure_code = NULL, updated_at = ?4
               WHERE workspace_id = ?1 AND id = ?2
                 AND updated_at = ?3 AND state IN ('queued', 'running')`
            )
            .bind(workspaceId, current.id, expectedUpdatedAt, now),
          receipt,
        ])
        if (results.some((result) => batchChanges(result) !== 1)) {
          throw new MediaDerivationError(
            "derivation_state_conflict",
            409,
            "Media derivation changed before cancellation was recorded"
          )
        }
      }
      return { job: resultJob, replayed: false, dispatchRequired: false }
    } catch (error) {
      const raced = await this.mutationReceipt(workspaceId, idempotencyKey)
      if (raced) return this.mutationReceiptResult(raced, expected, true)
      throw error
    }
  }

  async retryWithReceipt(
    workspaceId: string,
    jobId: string,
    idempotencyKeyInput: string,
    expectedUpdatedAt: string
  ): Promise<MediaDerivationMutationResult> {
    const idempotencyKey =
      assertMediaDerivationIdempotencyKey(idempotencyKeyInput)
    const requestHash = await mediaDerivationMutationRequestHash({
      workspaceId,
      jobId,
      action: "retry",
      expectedUpdatedAt,
    })
    const expected = { jobId, action: "retry" as const, requestHash }
    const existing = await this.mutationReceipt(workspaceId, idempotencyKey)
    if (existing) return this.mutationReceiptResult(existing, expected, true)

    const current = await this.requiredJob(workspaceId, jobId)
    if (current.updated_at !== expectedUpdatedAt) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Media derivation changed before retry"
      )
    }
    if (
      current.state !== "failed" ||
      !current.retryable ||
      current.attempt_count >= current.max_attempts
    ) {
      throw new MediaDerivationError(
        "derivation_state_conflict",
        409,
        "Only an eligible retryable failure can be requeued"
      )
    }

    const now = this.now()
    const resultJob: MediaDerivationJob = {
      ...jobFromRow(current),
      state: "queued",
      activeAttemptId: null,
      retryable: false,
      safeFailureCode: null,
      completedAt: null,
      updatedAt: now,
    }
    const receipt = this.mutationReceiptStatement({
      workspaceId,
      idempotencyKey,
      jobId: current.id,
      action: "retry",
      requestHash,
      job: resultJob,
      dispatchState: "pending",
      now,
      requiredState: "queued",
      requiredUpdatedAt: now,
    })
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `/* derivation:retry-receipted */
             UPDATE media_derivation_jobs
             SET state = 'queued', active_attempt_id = NULL, retryable = 0,
                 safe_failure_code = NULL, completed_at = NULL, updated_at = ?4
             WHERE workspace_id = ?1 AND id = ?2 AND updated_at = ?3
               AND state = 'failed' AND retryable = 1
               AND attempt_count < max_attempts`
          )
          .bind(workspaceId, current.id, expectedUpdatedAt, now),
        receipt,
      ])
      if (results.some((result) => batchChanges(result) !== 1)) {
        throw new MediaDerivationError(
          "derivation_state_conflict",
          409,
          "Media derivation changed before retry was committed"
        )
      }
      return { job: resultJob, replayed: false, dispatchRequired: true }
    } catch (error) {
      const raced = await this.mutationReceipt(workspaceId, idempotencyKey)
      if (raced) return this.mutationReceiptResult(raced, expected, true)
      throw error
    }
  }

  async markRetryDispatched(
    workspaceId: string,
    jobId: string,
    idempotencyKeyInput: string
  ) {
    const idempotencyKey =
      assertMediaDerivationIdempotencyKey(idempotencyKeyInput)
    const now = this.now()
    const result = await this.db
      .prepare(
        `/* derivation:mutation-receipt-dispatched */
         UPDATE media_derivation_mutation_receipts
         SET dispatch_state = 'dispatched', dispatched_at = ?4
         WHERE workspace_id = ?1 AND idempotency_key = ?2 AND job_id = ?3
           AND action = 'retry' AND dispatch_state = 'pending'`
      )
      .bind(workspaceId, idempotencyKey, jobId, now)
      .run()
    if (batchChanges(result) === 1) return
    const receipt = await this.mutationReceipt(workspaceId, idempotencyKey)
    if (
      receipt?.job_id === jobId &&
      receipt.action === "retry" &&
      receipt.dispatch_state === "dispatched"
    ) {
      return
    }
    throw new Error("media_derivation_mutation_dispatch_unreadable")
  }

  async settleCancellation(
    workspaceId: string,
    jobId: string,
    attemptIdInput: string
  ): Promise<MediaDerivationJob> {
    const attemptId = assertMediaDerivationAttemptId(attemptIdInput)
    const current = await this.requiredJob(workspaceId, jobId)
    if (current.active_attempt_id !== attemptId) {
      throw new MediaDerivationError(
        "derivation_attempt_stale",
        409,
        "The media derivation attempt no longer owns cancellation"
      )
    }
    const now = this.now()
    const results = await this.db.batch([
      this.db
        .prepare(
          `/* derivation:cancel-job */
           UPDATE media_derivation_jobs
           SET state = 'cancelled', completed_at = ?4, updated_at = ?4,
               retryable = 0, safe_failure_code = NULL
           WHERE workspace_id = ?1 AND id = ?2 AND state = 'cancelling'
             AND active_attempt_id = ?3`
        )
        .bind(workspaceId, current.id, attemptId, now),
      this.db
        .prepare(
          `/* derivation:cancel-attempt */
           UPDATE media_derivation_attempts
           SET state = 'cancelled', finished_at = ?4,
               retryable = 0, safe_failure_code = NULL
           WHERE workspace_id = ?1 AND job_id = ?2 AND id = ?3
             AND state = 'running'
             AND EXISTS (
               SELECT 1 FROM media_derivation_jobs jobs
               WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
                 AND jobs.state = 'cancelled' AND jobs.active_attempt_id = ?3
             )`
        )
        .bind(workspaceId, current.id, attemptId, now),
    ])
    if (batchChanges(results[0]) !== 1 || batchChanges(results[1]) !== 1) {
      throw new MediaDerivationError(
        "derivation_attempt_stale",
        409,
        "The media derivation attempt no longer owns cancellation"
      )
    }
    return jobFromRow(await this.requiredJob(workspaceId, current.id))
  }

  async succeed(
    workspaceId: string,
    jobId: string,
    attemptIdInput: string,
    outputAssetId: string
  ): Promise<
    Readonly<{
      job: MediaDerivationJob
      provenance: MediaDerivationProvenance
    }>
  > {
    const attemptId = assertMediaDerivationAttemptId(attemptIdInput)
    const current = await this.requiredJob(workspaceId, jobId)
    if (current.active_attempt_id !== attemptId) {
      throw new MediaDerivationError(
        "derivation_attempt_stale",
        409,
        "The media derivation attempt no longer owns settlement"
      )
    }
    const output = await this.outputAsset(workspaceId, outputAssetId)
    if (
      !output ||
      output.status !== "ready" ||
      output.id === current.source_asset_id
    ) {
      throw new MediaDerivationError(
        "derivation_output_not_ready",
        409,
        "Success requires a distinct ready output asset in the same workspace"
      )
    }
    const now = this.now()
    let results: D1Result<unknown>[]
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `/* derivation:succeed-job */
             UPDATE media_derivation_jobs
             SET state = 'succeeded', output_asset_id = ?4,
                 completed_at = ?5, updated_at = ?5,
                 retryable = 0, safe_failure_code = NULL
             WHERE workspace_id = ?1 AND id = ?2 AND state = 'running'
               AND active_attempt_id = ?3
               AND cancellation_requested_at IS NULL
               AND source_asset_id <> ?4
               AND EXISTS (
                 SELECT 1 FROM media_assets source
                 WHERE source.workspace_id = ?1
                   AND source.id = source_asset_id
                   AND source.content_hash = source_content_hash
               )
               AND EXISTS (
                 SELECT 1 FROM media_assets output
                 WHERE output.workspace_id = ?1 AND output.id = ?4
                   AND output.status = 'ready'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM media_derivation_provenance provenance
                 WHERE provenance.workspace_id = ?1
                   AND provenance.derivation_job_id = ?2
               )`
          )
          .bind(workspaceId, current.id, attemptId, output.id, now),
        this.db
          .prepare(
            `/* derivation:succeed-attempt */
             UPDATE media_derivation_attempts
             SET state = 'succeeded', finished_at = ?4,
                 retryable = 0, safe_failure_code = NULL
             WHERE workspace_id = ?1 AND job_id = ?2 AND id = ?3
               AND state = 'running'
               AND EXISTS (
                 SELECT 1 FROM media_derivation_jobs jobs
                 WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
                   AND jobs.state = 'succeeded'
                   AND jobs.active_attempt_id = ?3
               )`
          )
          .bind(workspaceId, current.id, attemptId, now),
        this.db
          .prepare(
            `/* derivation:insert-provenance */
             INSERT INTO media_derivation_provenance
               (workspace_id, output_asset_id, source_asset_id,
                source_content_hash, derivation_job_id, operation,
                provider_key, provider_model_version, privacy_policy_version,
                output_content_hash, output_media_type, output_width,
                output_height, created_at)
             SELECT jobs.workspace_id, output.id, source.id,
                    jobs.source_content_hash, jobs.id, jobs.operation,
                    jobs.provider_key, jobs.provider_model_version,
                    jobs.privacy_policy_version, output.content_hash,
                    output.media_type, output.width, output.height, ?5
             FROM media_derivation_jobs jobs
             JOIN media_assets source
               ON source.workspace_id = jobs.workspace_id
              AND source.id = jobs.source_asset_id
              AND source.content_hash = jobs.source_content_hash
             JOIN media_assets output
               ON output.workspace_id = jobs.workspace_id
              AND output.id = jobs.output_asset_id
              AND output.status = 'ready'
             WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
               AND jobs.state = 'succeeded'
               AND jobs.active_attempt_id = ?3
               AND jobs.output_asset_id = ?4
               AND source.id <> output.id`
          )
          .bind(workspaceId, current.id, attemptId, output.id, now),
      ])
    } catch (error) {
      const conflict = await this.provenanceForJobRow(workspaceId, current.id)
      if (!conflict) throw error
      throw new MediaDerivationError(
        "derivation_output_conflict",
        409,
        "The derivation job already has immutable provenance"
      )
    }
    if (
      batchChanges(results[0]) !== 1 ||
      batchChanges(results[1]) !== 1 ||
      batchChanges(results[2]) !== 1
    ) {
      const latest = await this.requiredJob(workspaceId, current.id)
      if (
        latest.active_attempt_id !== attemptId ||
        latest.state !== "running"
      ) {
        throw new MediaDerivationError(
          "derivation_attempt_stale",
          409,
          "The media derivation attempt no longer owns settlement"
        )
      }
      throw new MediaDerivationError(
        "derivation_output_not_ready",
        409,
        "The source or output asset changed before success was committed"
      )
    }
    const [job, provenance] = await Promise.all([
      this.requiredJob(workspaceId, current.id),
      this.provenanceForJobRow(workspaceId, current.id),
    ])
    if (!provenance) throw new Error("media_derivation_provenance_unreadable")
    return {
      job: jobFromRow(job),
      provenance: provenanceFromRow(provenance),
    }
  }

  private async provenanceRow(workspaceId: string, outputAssetId: string) {
    return this.db
      .prepare(
        `/* derivation:provenance-get */ SELECT ${provenanceColumns}
         FROM media_derivation_provenance
         WHERE workspace_id = ?1 AND output_asset_id = ?2
         ORDER BY created_at, derivation_job_id
         LIMIT 1`
      )
      .bind(workspaceId, outputAssetId)
      .first<MediaDerivationProvenanceRow>()
  }

  private async provenanceForJobRow(workspaceId: string, jobId: string) {
    return this.db
      .prepare(
        `/* derivation:provenance-job-get */ SELECT ${provenanceColumns}
         FROM media_derivation_provenance
         WHERE workspace_id = ?1 AND derivation_job_id = ?2`
      )
      .bind(workspaceId, jobId)
      .first<MediaDerivationProvenanceRow>()
  }

  async getProvenance(
    workspaceId: string,
    outputAssetId: string
  ): Promise<MediaDerivationProvenance | null> {
    const row = await this.provenanceRow(workspaceId, outputAssetId)
    return row ? provenanceFromRow(row) : null
  }
}
