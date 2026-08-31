import { Database } from "bun:sqlite"
import { Buffer } from "node:buffer"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { MediaDerivationRepository } from "../apps/studio/src/server/media-derivation-repository"
import { MediaDerivationOutputRepository } from "../apps/studio/src/server/media-derivation-output"
import { validateMediaUpload } from "../apps/studio/src/server/media-assets"
import type {
  MediaDerivationConfiguration,
  MediaDerivationCreateInput,
} from "../apps/studio/src/server/media-derivations"

type QueryResult = {
  changes?: number | bigint
  lastInsertRowid?: number | bigint
}

const d1Result = <T>(results: T[], queryResult?: QueryResult) => ({
  success: true,
  results,
  meta: {
    duration: 0,
    rows_read: results.length,
    rows_written: Number(queryResult?.changes ?? 0),
    changes: Number(queryResult?.changes ?? 0),
    last_row_id: Number(queryResult?.lastInsertRowid ?? 0),
    changed_db: Boolean(queryResult?.changes),
    size_after: 0,
  },
})

class BunD1Statement {
  constructor(
    private readonly database: Database,
    private readonly sql: string,
    private readonly values: unknown[] = []
  ) {}

  bind(...values: unknown[]) {
    return new BunD1Statement(this.database, this.sql, values)
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.database.query(this.sql).get(...this.values) as Record<
      string,
      unknown
    > | null
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async all<T>() {
    const rows = this.database.query(this.sql).all(...this.values) as T[]
    return d1Result(rows)
  }

  async run<T>() {
    const result = this.database
      .query(this.sql)
      .run(...this.values) as QueryResult
    return d1Result<T>([], result)
  }

  executeForBatch() {
    return this.run()
  }
}

class BunD1Database {
  batchFailure: Error | null = null

  constructor(private readonly database: Database) {}

  prepare(sql: string) {
    return new BunD1Statement(this.database, sql)
  }

  async batch(statements: unknown[]) {
    if (this.batchFailure) {
      const failure = this.batchFailure
      this.batchFailure = null
      throw failure
    }
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements as BunD1Statement[]) {
        results.push(await statement.executeForBatch())
      }
      this.database.exec("COMMIT")
      return results
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, Uint8Array>()
  readonly deleted: string[] = []

  async put(key: string, value: Uint8Array) {
    this.objects.set(key, Uint8Array.from(value))
  }

  async get(key: string) {
    const bytes = this.objects.get(key)
    if (!bytes) return null
    return {
      body: new Blob([Uint8Array.from(bytes).buffer]).stream(),
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    }
  }

  async delete(key: string) {
    this.deleted.push(key)
    this.objects.delete(key)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const expectCode = async (operation: Promise<unknown>, code: string) => {
  try {
    await operation
  } catch (error) {
    assert(
      error instanceof Error &&
        "code" in error &&
        (error as { code: unknown }).code === code,
      `Expected ${code}, received ${String(error)}`
    )
    return
  }
  throw new Error(`Expected ${code}, but the operation succeeded`)
}

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const directory = mkdtempSync(join(tmpdir(), "webmcp-derivation-repository-"))
const databasePath = join(directory, "repository.sqlite")
const database = new Database(databasePath, { create: true, strict: true })

const migrations = readdirSync(join(repositoryRoot, "migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()

try {
  database.exec("PRAGMA foreign_keys = ON")
  for (const migration of migrations) {
    database.exec(
      readFileSync(join(repositoryRoot, "migrations", migration), "utf8")
    )
  }
  database.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO workspaces (id, name, kind, created_at) VALUES
      ('workspace-a', 'Workspace A', 'personal', '2026-08-31T00:00:00.000Z'),
      ('workspace-b', 'Workspace B', 'personal', '2026-08-31T00:00:00.000Z');
    INSERT INTO media_assets
      (id, workspace_id, name, media_type, bytes, width, height, content_hash,
       r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
    VALUES
      ('asset-0000000000000001', 'workspace-a', 'Source A', 'image/png',
       68, 1, 1,
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       'media/workspaces/workspace-a/content/a/original', 'ready', 1,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
       '2026-08-31T00:00:00.000Z', NULL),
      ('asset-0000000000000002', 'workspace-a', 'Output A', 'image/png',
       70, 1, 1,
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       'media/workspaces/workspace-a/content/b/original', 'ready', 1,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
       '2026-08-31T00:00:00.000Z', NULL),
      ('asset-0000000000000003', 'workspace-a', 'Output B', 'image/webp',
       72, 2, 1,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'media/workspaces/workspace-a/content/c/original', 'ready', 1,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
       '2026-08-31T00:00:00.000Z', NULL),
      ('asset-0000000000000004', 'workspace-a', 'Archived source', 'image/png',
       68, 1, 1,
       'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
       'media/workspaces/workspace-a/content/d/original', 'archived', 2,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:01:00.000Z',
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:01:00.000Z'),
      ('asset-0000000000000005', 'workspace-b', 'Foreign asset', 'image/png',
       68, 1, 1,
       'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
       'media/workspaces/workspace-b/content/e/original', 'ready', 1,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
       '2026-08-31T00:00:00.000Z', NULL),
      ('asset-0000000000000006', 'workspace-a', 'Source B', 'image/jpeg',
       80, 2, 2,
       'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
       'media/workspaces/workspace-a/content/f/original', 'ready', 1,
       '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
       '2026-08-31T00:00:00.000Z', NULL);
  `)

  const d1 = new BunD1Database(database)
  let jobSequence = 0
  let attemptSequence = 0
  let clockSequence = 0
  const repository = new MediaDerivationRepository(
    d1 as unknown as D1Database,
    {
      createJobId: () =>
        `derivation-${String(++jobSequence).padStart(17, "0")}`,
      createAttemptId: () =>
        `derivation-attempt-${String(++attemptSequence).padStart(17, "0")}`,
      now: () =>
        `2026-08-31T00:${String(Math.floor(clockSequence / 60)).padStart(2, "0")}:${String(clockSequence++ % 60).padStart(2, "0")}.000Z`,
    }
  )

  const createInput: MediaDerivationCreateInput = {
    sourceAssetId: "asset-0000000000000001",
    operation: "remove_background",
    parameters: {},
  }
  const configuration: MediaDerivationConfiguration = {
    providerKey: "configured-adapter",
    providerModelVersion: "model-2026-08",
    privacyPolicyVersion: "privacy-2026-08",
    maxAttempts: 3,
  }

  const created = await repository.create(
    "workspace-a",
    "create-1",
    createInput,
    configuration
  )
  assert(created.created, "The first request must create a job")
  const replay = await repository.create(
    "workspace-a",
    "create-1",
    createInput,
    configuration
  )
  assert(
    !replay.created && replay.job.id === created.job.id,
    "Same-key replay diverged"
  )
  const compatible = await repository.create(
    "workspace-a",
    "create-2",
    createInput,
    configuration
  )
  assert(
    !compatible.created && compatible.job.id === created.job.id,
    "Same fingerprint under another key created duplicate work"
  )
  await expectCode(
    repository.create("workspace-a", "create-1", createInput, {
      ...configuration,
      providerModelVersion: "model-2026-09",
    }),
    "idempotency_key_reused"
  )
  await expectCode(
    repository.create(
      "workspace-a",
      "create-1",
      { ...createInput, sourceAssetId: "asset-0000000000000005" },
      configuration
    ),
    "idempotency_key_reused"
  )
  await expectCode(
    repository.create(
      "workspace-a",
      "create-1",
      { ...createInput, sourceAssetId: "asset-0000000000000999" },
      configuration
    ),
    "idempotency_key_reused"
  )
  assert(
    Number(
      database
        .query("SELECT COUNT(*) AS count FROM media_derivation_jobs")
        .get()?.count
    ) === 1,
    "Idempotency created more than one job"
  )
  database
    .query(
      `UPDATE media_assets
       SET status = 'archived', archived_at = ?, updated_at = ?, revision = revision + 1
       WHERE workspace_id = ? AND id = ?`
    )
    .run(
      "2026-08-31T00:10:00.000Z",
      "2026-08-31T00:10:00.000Z",
      "workspace-a",
      createInput.sourceAssetId
    )
  const archivedCompatible = await repository.create(
    "workspace-a",
    "create-3",
    createInput,
    configuration
  )
  assert(
    !archivedCompatible.created && archivedCompatible.job.id === created.job.id,
    "An archived source prevented replay of compatible existing work"
  )
  database
    .query(
      `UPDATE media_assets
       SET status = 'ready', archived_at = NULL, updated_at = ?, revision = revision + 1
       WHERE workspace_id = ? AND id = ?`
    )
    .run("2026-08-31T00:11:00.000Z", "workspace-a", createInput.sourceAssetId)

  d1.batchFailure = new Error("simulated D1 outage")
  try {
    await repository.create(
      "workspace-a",
      "d1-outage",
      { ...createInput, sourceAssetId: "asset-0000000000000006" },
      { ...configuration, providerModelVersion: "outage-model" }
    )
    throw new Error("The simulated D1 outage unexpectedly succeeded")
  } catch (error) {
    assert(
      error instanceof Error && error.message === "simulated D1 outage",
      "The repository misclassified a D1 write failure"
    )
  }

  await expectCode(
    repository.create(
      "workspace-a",
      "archived-source",
      { ...createInput, sourceAssetId: "asset-0000000000000004" },
      configuration
    ),
    "source_asset_not_ready"
  )
  await expectCode(
    repository.create(
      "workspace-a",
      "foreign-source",
      { ...createInput, sourceAssetId: "asset-0000000000000005" },
      configuration
    ),
    "source_asset_not_ready"
  )

  const firstClaim = await repository.claim("workspace-a", created.job.id)
  assert(firstClaim.job.attemptCount === 1, "Claim did not increment once")
  assert(
    firstClaim.attempt.attemptNumber === 1,
    "First attempt number is wrong"
  )
  await expectCode(
    repository.claim("workspace-a", created.job.id),
    "derivation_state_conflict"
  )
  const firstFailure = await repository.fail(
    "workspace-a",
    created.job.id,
    firstClaim.attempt.id,
    { code: "provider_unavailable", retryable: true }
  )
  assert(
    firstFailure.state === "failed" && firstFailure.retryable,
    "Retryable failure was lost"
  )
  const requeued = await repository.retry("workspace-a", created.job.id)
  assert(
    requeued.state === "queued" &&
      requeued.attemptCount === 1 &&
      requeued.providerKey === created.job.providerKey &&
      requeued.requestFingerprint === created.job.requestFingerprint,
    "Retry changed frozen job identity"
  )
  const secondClaim = await repository.claim("workspace-a", created.job.id)
  assert(
    secondClaim.attempt.attemptNumber === 2,
    "Retry did not create attempt two"
  )
  await expectCode(
    repository.fail("workspace-a", created.job.id, firstClaim.attempt.id, {
      code: "late_failure",
      retryable: false,
    }),
    "derivation_attempt_stale"
  )

  const sourceBefore = database
    .query("SELECT * FROM media_assets WHERE id = ?")
    .get(createInput.sourceAssetId)
  const sourceCatalogBefore = database
    .query("SELECT * FROM media_asset_catalog_metadata WHERE asset_id = ?")
    .get(createInput.sourceAssetId)
  await expectCode(
    repository.succeed(
      "workspace-a",
      created.job.id,
      secondClaim.attempt.id,
      createInput.sourceAssetId
    ),
    "derivation_output_not_ready"
  )
  await expectCode(
    repository.succeed(
      "workspace-a",
      created.job.id,
      secondClaim.attempt.id,
      "asset-0000000000000005"
    ),
    "derivation_output_not_ready"
  )
  const succeeded = await repository.succeed(
    "workspace-a",
    created.job.id,
    secondClaim.attempt.id,
    "asset-0000000000000002"
  )
  assert(succeeded.job.state === "succeeded", "Success did not settle the job")
  assert(
    succeeded.provenance.sourceContentHash === created.job.sourceContentHash &&
      succeeded.provenance.outputContentHash ===
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" &&
      succeeded.provenance.outputMediaType === "image/png",
    "Success did not freeze output provenance"
  )
  assert(
    JSON.stringify(sourceBefore) ===
      JSON.stringify(
        database
          .query("SELECT * FROM media_assets WHERE id = ?")
          .get(createInput.sourceAssetId)
      ),
    "Success mutated the source asset"
  )
  assert(
    JSON.stringify(sourceCatalogBefore) ===
      JSON.stringify(
        database
          .query(
            "SELECT * FROM media_asset_catalog_metadata WHERE asset_id = ?"
          )
          .get(createInput.sourceAssetId)
      ),
    "Success mutated source catalog metadata"
  )
  await expectCode(
    repository.fail("workspace-a", created.job.id, secondClaim.attempt.id, {
      code: "late_failure",
      retryable: false,
    }),
    "derivation_attempt_stale"
  )

  const queuedCancellation = await repository.create(
    "workspace-a",
    "queued-cancel",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    configuration
  )
  const queuedCancelled = await repository.requestCancellation(
    "workspace-a",
    queuedCancellation.job.id
  )
  assert(
    queuedCancelled.state === "cancelled" &&
      queuedCancelled.attemptCount === 0 &&
      queuedCancelled.completedAt !== null,
    "Queued cancellation did not settle immediately"
  )

  const runningCancellation = await repository.create(
    "workspace-a",
    "running-cancel",
    createInput,
    { ...configuration, privacyPolicyVersion: "privacy-2026-09" }
  )
  const cancellationClaim = await repository.claim(
    "workspace-a",
    runningCancellation.job.id
  )
  const cancelling = await repository.requestCancellation(
    "workspace-a",
    runningCancellation.job.id
  )
  assert(
    cancelling.state === "cancelling",
    "Running cancellation skipped intent state"
  )
  await expectCode(
    repository.succeed(
      "workspace-a",
      runningCancellation.job.id,
      cancellationClaim.attempt.id,
      "asset-0000000000000003"
    ),
    "derivation_attempt_stale"
  )
  const cancelled = await repository.settleCancellation(
    "workspace-a",
    runningCancellation.job.id,
    cancellationClaim.attempt.id
  )
  assert(cancelled.state === "cancelled", "Cancellation settlement failed")

  const nonRetryable = await repository.create(
    "workspace-a",
    "non-retryable",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, providerModelVersion: "non-retryable-model" }
  )
  const nonRetryableClaim = await repository.claim(
    "workspace-a",
    nonRetryable.job.id
  )
  const nonRetryableFailure = await repository.fail(
    "workspace-a",
    nonRetryable.job.id,
    nonRetryableClaim.attempt.id,
    { code: "invalid_provider_output", retryable: false }
  )
  assert(
    !nonRetryableFailure.retryable,
    "A non-retryable failure became retryable"
  )
  await expectCode(
    repository.retry("workspace-a", nonRetryable.job.id),
    "derivation_state_conflict"
  )

  const limited = await repository.create(
    "workspace-a",
    "attempt-limit",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, maxAttempts: 1, providerModelVersion: "limited-model" }
  )
  const limitedClaim = await repository.claim("workspace-a", limited.job.id)
  const limitedFailure = await repository.fail(
    "workspace-a",
    limited.job.id,
    limitedClaim.attempt.id,
    { code: "provider_timeout", retryable: true }
  )
  assert(!limitedFailure.retryable, "Attempt budget did not cap retryability")
  await expectCode(
    repository.retry("workspace-a", limited.job.id),
    "derivation_state_conflict"
  )

  const competing = await repository.create(
    "workspace-a",
    "competing-output",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, providerModelVersion: "competing-model" }
  )
  const competingClaim = await repository.claim("workspace-a", competing.job.id)
  const sharedOutput = await repository.succeed(
    "workspace-a",
    competing.job.id,
    competingClaim.attempt.id,
    "asset-0000000000000002"
  )
  const competingAfter = await repository.get("workspace-a", competing.job.id)
  assert(
    competingAfter.state === "succeeded" &&
      sharedOutput.provenance.derivationJobId === competing.job.id,
    "Shared canonical output did not preserve job-specific provenance"
  )

  const transparentPng = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==",
      "base64"
    )
  )
  const outputBucket = new MemoryR2Bucket()
  let outputSequence = 0
  const outputRepository = new MediaDerivationOutputRepository(
    d1 as unknown as D1Database,
    outputBucket as unknown as R2Bucket,
    {
      createAssetId: () =>
        `asset-derived-${String(++outputSequence).padStart(17, "0")}`,
      now: () => "2026-08-31T01:00:00.000Z",
      normalizeOutput: (output, name) =>
        validateMediaUpload(
          Object.assign(
            new Blob([Uint8Array.from(output.bytes).buffer], {
              type: output.mediaType,
            }),
            { name: "background-removed.png" }
          ),
          name
        ),
    }
  )
  const outputJob = await repository.create(
    "workspace-a",
    "atomic-output",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, providerModelVersion: "atomic-output-model" }
  )
  const outputClaim = await repository.claim("workspace-a", outputJob.job.id)
  const outputSettlement = await outputRepository.settle({
    job: outputClaim.job,
    attemptId: outputClaim.attempt.id,
    output: { mediaType: "image/png", bytes: transparentPng },
  })
  assert(
    outputSettlement.job.state === "succeeded" &&
      outputSettlement.job.outputAssetId === "asset-derived-00000000000000001",
    "Atomic output settlement did not publish the derived asset"
  )
  assert(
    Number(
      database
        .query(
          `SELECT COUNT(*) AS count FROM media_assets assets
           JOIN media_derivation_provenance provenance
             ON provenance.workspace_id = assets.workspace_id
            AND provenance.output_asset_id = assets.id
           WHERE provenance.derivation_job_id = ?`
        )
        .get(outputJob.job.id)?.count
    ) === 1,
    "Atomic output settlement omitted asset or provenance"
  )
  assert(
    outputBucket.objects.size === 1,
    "Atomic output settlement did not retain one immutable R2 object"
  )

  const canonicalBefore = database
    .query("SELECT * FROM media_assets WHERE id = ?")
    .get(outputSettlement.job.outputAssetId)
  const canonicalReplayJob = await repository.create(
    "workspace-a",
    "canonical-output-replay",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, providerModelVersion: "canonical-output-model" }
  )
  const canonicalReplayClaim = await repository.claim(
    "workspace-a",
    canonicalReplayJob.job.id
  )
  const canonicalReplaySettlement = await outputRepository.settle({
    job: canonicalReplayClaim.job,
    attemptId: canonicalReplayClaim.attempt.id,
    output: { mediaType: "image/png", bytes: transparentPng },
  })
  assert(
    canonicalReplaySettlement.job.outputAssetId ===
      outputSettlement.job.outputAssetId,
    "Same-hash output did not resolve to the canonical workspace asset"
  )
  assert(
    Number(
      database
        .query(
          `SELECT COUNT(*) AS count FROM media_derivation_provenance
           WHERE workspace_id = 'workspace-a' AND output_asset_id = ?`
        )
        .get(outputSettlement.job.outputAssetId)?.count
    ) === 2,
    "Distinct jobs did not retain independent immutable provenance"
  )
  assert(
    JSON.stringify(canonicalBefore) ===
      JSON.stringify(
        database
          .query("SELECT * FROM media_assets WHERE id = ?")
          .get(outputSettlement.job.outputAssetId)
      ),
    "Canonical output reconciliation mutated the existing asset"
  )
  assert(
    outputBucket.objects.size === 1 && outputBucket.deleted.length === 0,
    "Canonical output reconciliation staged or deleted R2 objects"
  )
  const canonicalRetry = await outputRepository.settle({
    job: canonicalReplayClaim.job,
    attemptId: canonicalReplayClaim.attempt.id,
    output: { mediaType: "image/png", bytes: transparentPng },
  })
  assert(
    canonicalRetry.job.outputAssetId ===
      canonicalReplaySettlement.job.outputAssetId &&
      outputBucket.objects.size === 1,
    "Canonical output settlement was not stable on retry"
  )

  const lateOutputJob = await repository.create(
    "workspace-a",
    "late-output",
    { ...createInput, sourceAssetId: "asset-0000000000000006" },
    { ...configuration, providerModelVersion: "late-output-model" }
  )
  const lateOutputClaim = await repository.claim(
    "workspace-a",
    lateOutputJob.job.id
  )
  await repository.requestCancellation("workspace-a", lateOutputJob.job.id)
  await expectCode(
    outputRepository.settle({
      job: lateOutputClaim.job,
      attemptId: lateOutputClaim.attempt.id,
      output: { mediaType: "image/png", bytes: transparentPng },
    }),
    "storage_failure"
  )
  assert(
    outputBucket.objects.size === 1 &&
      [...outputBucket.objects.keys()].every(
        (key) => !key.includes(lateOutputJob.job.id)
      ),
    "A rejected late output left staged R2 storage"
  )
  assert(
    Number(
      database
        .query(
          "SELECT COUNT(*) AS count FROM media_assets WHERE id = 'asset-derived-00000000000000002'"
        )
        .get()?.count
    ) === 0,
    "A rejected late output became selectable"
  )

  assert(
    database.query("PRAGMA foreign_key_check").all().length === 0,
    "Repository verification left broken foreign keys"
  )
  console.log("media derivation repository verified")
} finally {
  database.close()
  rmSync(directory, { recursive: true, force: true })
}
