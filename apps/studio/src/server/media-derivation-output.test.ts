import { describe, expect, it, vi } from "vitest"
import { deflateSync } from "node:zlib"
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

const syntheticPng = (width: number, height: number, inflated: Uint8Array) => {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(12 + data.byteLength)
    new DataView(bytes.buffer).setUint32(0, data.byteLength)
    bytes.set(new TextEncoder().encode(type), 4)
    bytes.set(data, 8)
    return bytes
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    chunk("IDAT", Uint8Array.from(deflateSync(inflated))),
    chunk("IEND", new Uint8Array()),
  ]
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  )
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

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
    return (
      this.query.includes("FROM media_assets")
        ? this.db.canonical
        : this.db.committed
    ) as T | null
  }
}

class FakeD1 {
  readonly statements: FakeStatement[] = []
  changes = [1, 1, 1, 1]
  batchError: Error | null = null
  batchErrorCanonical: Record<string, unknown> | null = null
  committed: Record<string, unknown> | null = null
  canonical: Record<string, unknown> | null = null

  prepare(query: string) {
    const statement = new FakeStatement(query, this)
    this.statements.push(statement)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T>(statements: D1PreparedStatement[]) {
    if (this.batchError) {
      const error = this.batchError
      this.batchError = null
      this.canonical = this.batchErrorCanonical
      throw error
    }
    return statements.map((_, index) => ({
      success: true,
      results: [],
      meta: { changes: this.changes[index] ?? 1 },
    })) as unknown as D1Result<T>[]
  }
}

const fixture = () => {
  const db = new FakeD1()
  type FakeObject = {
    body: ReadableStream<Uint8Array>
    arrayBuffer: () => Promise<ArrayBuffer>
  }
  const bucket = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async (): Promise<FakeObject | null> => null),
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

  it.each([
    ["oversized dimensions", syntheticPng(16_385, 1, Uint8Array.of(0, 0))],
    ["inflated expansion", syntheticPng(1, 1, new Uint8Array(1_000_000))],
  ])("rejects %s before D1 or R2 side effects", async (_, bytes) => {
    const { db, bucket, repository } = fixture()

    await expect(
      repository.settle({
        job,
        attemptId,
        output: { mediaType: "image/png", bytes },
      })
    ).rejects.toMatchObject({ code: "invalid_provider_output" })
    expect(db.statements).toHaveLength(0)
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
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
      output_r2_key: `media/workspaces/workspace-a/derivations/${job.id}/${attemptId}/${normalized.contentHash}.png`,
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

  it("reuses a verified same-hash workspace asset without overwriting it", async () => {
    const { db, bucket, repository } = fixture()
    const normalized = await normalizeTransparentDerivationOutput({
      mediaType: "image/png",
      bytes: transparentPng,
    })
    const canonicalId = "asset-canonical0123456789abcdef0123456"
    db.canonical = {
      id: canonicalId,
      media_type: "image/png",
      bytes: normalized.byteLength,
      width: normalized.width,
      height: normalized.height,
      content_hash: normalized.contentHash,
      r2_key: "media/workspaces/workspace-a/content/canonical/original",
      status: "ready",
    }
    bucket.get.mockResolvedValue({
      body: new Blob([transparentPng]).stream(),
      arrayBuffer: () => Promise.resolve(transparentPng.buffer),
    })

    const settlement = await repository.settle({
      job,
      attemptId,
      output: { mediaType: "image/png", bytes: transparentPng },
    })

    expect(settlement.job.outputAssetId).toBe(canonicalId)
    expect(settlement.provenance.derivationJobId).toBe(job.id)
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(
      db.statements.some(({ query }) =>
        query.includes("INSERT INTO media_assets")
      )
    ).toBe(false)
  })

  it("reconciles a same-hash insert race and removes the losing staged object", async () => {
    const { db, bucket, repository } = fixture()
    const normalized = await normalizeTransparentDerivationOutput({
      mediaType: "image/png",
      bytes: transparentPng,
    })
    const canonicalId = "asset-racewinner0123456789abcdef012345"
    db.batchError = new Error("unique workspace content hash")
    db.batchErrorCanonical = {
      id: canonicalId,
      media_type: "image/png",
      bytes: normalized.byteLength,
      width: normalized.width,
      height: normalized.height,
      content_hash: normalized.contentHash,
      r2_key: "media/workspaces/workspace-a/content/race-winner/original",
      status: "ready",
    }
    bucket.get.mockResolvedValue({
      body: new Blob([transparentPng]).stream(),
      arrayBuffer: () => Promise.resolve(transparentPng.buffer),
    })

    await expect(
      repository.settle({
        job,
        attemptId,
        output: { mediaType: "image/png", bytes: transparentPng },
      })
    ).resolves.toMatchObject({
      job: { state: "succeeded", outputAssetId: canonicalId },
      provenance: { derivationJobId: job.id, outputAssetId: canonicalId },
    })
    expect(bucket.put).toHaveBeenCalledTimes(1)
    expect(bucket.delete).toHaveBeenCalledTimes(1)
  })

  it("returns the committed canonical output on retry without restaging", async () => {
    const { db, bucket, repository } = fixture()
    const normalized = await normalizeTransparentDerivationOutput({
      mediaType: "image/png",
      bytes: transparentPng,
    })
    db.committed = {
      output_asset_id: outputAssetId,
      output_r2_key: "media/workspaces/workspace-a/content/canonical/original",
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
    ).resolves.toMatchObject({ job: { outputAssetId } })
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
  })
})
