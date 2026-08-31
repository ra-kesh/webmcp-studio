import { describe, expect, it, vi } from "vitest"
import {
  MediaDerivationOutputRepository,
  normalizeTransparentDerivationOutput,
} from "./media-derivation-output"
import type { MediaDerivationJob } from "./media-derivations"

const transparentPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==",
    "base64"
  )
)
const opaquePng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NgYGD4DwABBAEApOCsMQAAAABJRU5ErkJggg==",
    "base64"
  )
)
const attemptId = "derivation-attempt-01234567-89ab-cdef-0123-456789abcdef"
const outputAssetId = "asset-fedcba9876543210fedcba9876543210"
const completedAt = "2026-08-31T13:00:00.000Z"

const job: MediaDerivationJob = {
  id: "derivation-01234567-89ab-cdef-0123-456789abcdef",
  workspaceId: "workspace-a",
  sourceAssetId: "asset-0123456789abcdef0123456789abcdef",
  sourceContentHash: "a".repeat(64),
  operation: "remove_background",
  parameters: {},
  parametersHash: "b".repeat(64),
  providerKey: "deterministic-local-fake",
  providerModelVersion: "fixture-v1",
  privacyPolicyVersion: "privacy-v1",
  requestFingerprint: "c".repeat(64),
  state: "running",
  outputAssetId: null,
  activeAttemptId: attemptId,
  attemptCount: 1,
  maxAttempts: 3,
  retryable: false,
  safeFailureCode: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: "2026-08-31T12:01:00.000Z",
  completedAt: null,
  cancellationRequestedAt: null,
  updatedAt: "2026-08-31T12:01:00.000Z",
}

class FakeStatement {
  values: unknown[] = []

  constructor(
    readonly query: string,
    private readonly db: FakeD1
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async first<T>() {
    return this.db.committed as T | null
  }
}

class FakeD1 {
  readonly statements: FakeStatement[] = []
  changes = [1, 1, 1, 1]
  batchError: Error | null = null
  committed: Record<string, unknown> | null = null

  prepare(query: string) {
    const statement = new FakeStatement(query, this)
    this.statements.push(statement)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T>() {
    if (this.batchError) throw this.batchError
    return this.changes.map((changes) => ({
      success: true,
      results: [],
      meta: { changes },
    })) as unknown as D1Result<T>[]
  }
}

const fixture = () => {
  const db = new FakeD1()
  const bucket = {
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
  const repository = new MediaDerivationOutputRepository(
    db as unknown as D1Database,
    bucket as unknown as R2Bucket,
    { now: () => completedAt, createAssetId: () => outputAssetId }
  )
  return { db, bucket, repository }
}

describe("derived background-removal output", () => {
  it("accepts only canonical RGBA PNG bytes with actual transparency", async () => {
    await expect(
      normalizeTransparentDerivationOutput({
        mediaType: "image/png",
        bytes: transparentPng,
      })
    ).resolves.toMatchObject({
      mediaType: "image/png",
      width: 1,
      height: 1,
      byteLength: transparentPng.byteLength,
    })
    await expect(
      normalizeTransparentDerivationOutput({
        mediaType: "image/png",
        bytes: opaquePng,
      })
    ).rejects.toMatchObject({ code: "derivation_output_not_ready" })
    await expect(
      normalizeTransparentDerivationOutput({
        mediaType: "image/jpeg",
        bytes: transparentPng,
      })
    ).rejects.toMatchObject({ code: "derivation_output_not_ready" })
  })

  it("stages immutable bytes and commits asset, job, attempt, and provenance together", async () => {
    const { db, bucket, repository } = fixture()
    const settlement = await repository.settle({
      job,
      attemptId,
      output: { mediaType: "image/png", bytes: transparentPng },
    })

    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringContaining(`/derivations/${job.id}/`),
      transparentPng,
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } })
    )
    expect(db.statements.map(({ query }) => query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO media_assets"),
        expect.stringContaining("UPDATE media_derivation_jobs"),
        expect.stringContaining("UPDATE media_derivation_attempts"),
        expect.stringContaining("INSERT INTO media_derivation_provenance"),
      ])
    )
    expect(settlement.job).toMatchObject({
      state: "succeeded",
      outputAssetId,
    })
    expect(settlement.provenance).toMatchObject({
      outputAssetId,
      sourceAssetId: job.sourceAssetId,
      derivationJobId: job.id,
      outputMediaType: "image/png",
    })
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it("deletes staged bytes when a stale attempt cannot commit", async () => {
    const { db, bucket, repository } = fixture()
    db.changes = [0, 0, 0, 0]
    await expect(
      repository.settle({
        job,
        attemptId,
        output: { mediaType: "image/png", bytes: transparentPng },
      })
    ).rejects.toMatchObject({ code: "storage_failure", retryable: true })
    expect(bucket.delete).toHaveBeenCalledTimes(1)
  })

  it("reconciles a committed batch after a lost D1 response without deleting output", async () => {
    const { db, bucket, repository } = fixture()
    const normalized = await normalizeTransparentDerivationOutput({
      mediaType: "image/png",
      bytes: transparentPng,
    })
    db.batchError = new Error("transport lost after commit")
    db.committed = {
      output_asset_id: outputAssetId,
      output_content_hash: normalized.contentHash,
      output_media_type: "image/png",
      output_width: 1,
      output_height: 1,
      completed_at: completedAt,
    }

    await expect(
      repository.settle({
        job,
        attemptId,
        output: { mediaType: "image/png", bytes: transparentPng },
      })
    ).resolves.toMatchObject({
      job: { state: "succeeded", outputAssetId },
    })
    expect(bucket.delete).not.toHaveBeenCalled()
  })
})
