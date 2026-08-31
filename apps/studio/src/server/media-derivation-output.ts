import {
  createOpaqueMediaAssetId,
  MAX_MEDIA_ASSET_BYTES,
  MAX_MEDIA_ASSET_DIMENSION,
  MAX_MEDIA_ASSET_PIXEL_AREA,
  validateMediaUpload,
} from "./media-assets"
import type { ValidatedMediaUpload } from "./media-assets"
import { MediaDerivationError } from "./media-derivations"
import type {
  MediaDerivationJob,
  MediaDerivationProvenance,
} from "./media-derivations"
import type {
  MediaDerivationOutput,
  MediaDerivationSettlement,
} from "./media-derivation-execution"
import { MediaDerivationDispatchError } from "./media-derivation-provider"

const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index])

const uint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset
  )

const concatBytes = (parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  )
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const paeth = (left: number, above: number, upperLeft: number) => {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

const containsTransparentPixel = async (
  compressed: Uint8Array,
  width: number,
  height: number
) => {
  const stride = width * 4
  const expectedBytes = (stride + 1) * height
  const scan = async (format: CompressionFormat, bytes: Uint8Array) => {
    const reader = new Blob([Uint8Array.from(bytes).buffer])
      .stream()
      .pipeThrough(new DecompressionStream(format))
      .getReader()
    let previous = new Uint8Array(stride)
    let scanline = new Uint8Array(stride + 1)
    let scanlineOffset = 0
    let produced = 0
    let transparent = false
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        let chunkOffset = 0
        while (chunkOffset < chunk.value.byteLength) {
          const remaining = scanline.byteLength - scanlineOffset
          const available = chunk.value.byteLength - chunkOffset
          const length = Math.min(remaining, available)
          produced += length
          if (produced > expectedBytes) {
            throw new Error("png_inflated_size_exceeded")
          }
          scanline.set(
            chunk.value.subarray(chunkOffset, chunkOffset + length),
            scanlineOffset
          )
          scanlineOffset += length
          chunkOffset += length
          if (scanlineOffset !== scanline.byteLength) continue

          const filter = scanline[0]
          if (filter > 4) throw new Error("png_filter_invalid")
          const row = new Uint8Array(stride)
          for (let x = 0; x < stride; x += 1) {
            const value = scanline[x + 1]
            const left = x >= 4 ? row[x - 4] : 0
            const above = previous[x]
            const upperLeft = x >= 4 ? previous[x - 4] : 0
            row[x] =
              filter === 0
                ? value
                : filter === 1
                  ? value + left
                  : filter === 2
                    ? value + above
                    : filter === 3
                      ? value + Math.floor((left + above) / 2)
                      : value + paeth(left, above, upperLeft)
          }
          for (let alpha = 3; alpha < stride; alpha += 4) {
            if (row[alpha] < 255) transparent = true
          }
          previous = row
          scanline = new Uint8Array(stride + 1)
          scanlineOffset = 0
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      reader.releaseLock()
    }
    if (produced !== expectedBytes || scanlineOffset !== 0) {
      throw new Error("png_inflated_size_mismatch")
    }
    return transparent
  }
  try {
    return await scan("deflate", compressed)
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "png_inflated_size_exceeded" ||
        error.message === "png_inflated_size_mismatch" ||
        error.message === "png_filter_invalid")
    ) {
      throw error
    }
    if (compressed.byteLength <= 6) throw new Error("png_deflate_truncated")
    return scan(
      "deflate-raw",
      compressed.subarray(2, compressed.byteLength - 4)
    )
  }
}

export async function normalizeTransparentDerivationOutput(
  output: MediaDerivationOutput,
  name = "Background removed"
): Promise<ValidatedMediaUpload> {
  if (
    output.mediaType !== "image/png" ||
    output.bytes.byteLength < 57 ||
    output.bytes.byteLength > MAX_MEDIA_ASSET_BYTES ||
    !equalBytes(output.bytes.subarray(0, 8), pngSignature)
  ) {
    throw new MediaDerivationError(
      "derivation_output_not_ready",
      409,
      "Background removal requires a normalized transparent PNG"
    )
  }
  const idat: Uint8Array[] = []
  let width = 0
  let height = 0
  let sawHeader = false
  let sawEnd = false
  let offset = 8
  while (offset < output.bytes.byteLength) {
    if (offset + 12 > output.bytes.byteLength) {
      throw new MediaDerivationError(
        "derivation_output_not_ready",
        409,
        "Provider output PNG is truncated"
      )
    }
    const length = uint32(output.bytes, offset)
    const end = offset + 12 + length
    if (end > output.bytes.byteLength) {
      throw new MediaDerivationError(
        "derivation_output_not_ready",
        409,
        "Provider output PNG is truncated"
      )
    }
    const type = new TextDecoder().decode(
      output.bytes.subarray(offset + 4, offset + 8)
    )
    const data = output.bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      if (sawHeader || length !== 13 || offset !== 8) {
        throw new MediaDerivationError(
          "derivation_output_not_ready",
          409,
          "Provider output PNG header is invalid"
        )
      }
      sawHeader = true
      width = uint32(data, 0)
      height = uint32(data, 4)
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_MEDIA_ASSET_DIMENSION ||
        height > MAX_MEDIA_ASSET_DIMENSION ||
        width * height > MAX_MEDIA_ASSET_PIXEL_AREA ||
        data[8] !== 8 ||
        data[9] !== 6 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new MediaDerivationError(
          "derivation_output_not_ready",
          409,
          "Provider output must be non-interlaced 8-bit RGBA PNG"
        )
      }
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      sawEnd = true
      if (length !== 0 || end !== output.bytes.byteLength) {
        throw new MediaDerivationError(
          "derivation_output_not_ready",
          409,
          "Provider output PNG end marker is invalid"
        )
      }
    } else {
      throw new MediaDerivationError(
        "derivation_output_not_ready",
        409,
        "Provider output PNG contains non-canonical metadata"
      )
    }
    offset = end
  }
  let hasTransparency = false
  try {
    hasTransparency =
      idat.length > 0 &&
      (await containsTransparentPixel(concatBytes(idat), width, height))
  } catch {
    hasTransparency = false
  }
  if (!sawHeader || !sawEnd || !hasTransparency) {
    throw new MediaDerivationError(
      "derivation_output_not_ready",
      409,
      "Provider output does not contain transparent pixels"
    )
  }
  return validateMediaUpload(
    Object.assign(
      new Blob([Uint8Array.from(output.bytes).buffer], { type: "image/png" }),
      { name: "background-removed.png" }
    ),
    name
  )
}

const batchChanges = (result: D1Result<unknown> | undefined) =>
  Number(result?.meta.changes ?? 0)

type CommittedOutputRow = {
  output_asset_id: string
  output_r2_key: string
  output_content_hash: string
  output_media_type: "image/png"
  output_width: number
  output_height: number
  completed_at: string
}

type CanonicalOutputRow = {
  id: string
  media_type: "image/png" | "image/jpeg" | "image/webp"
  bytes: number
  width: number
  height: number
  content_hash: string
  r2_key: string
  status: "ready" | "archived"
}

export class MediaDerivationOutputRepository {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly options: {
      now?: () => string
      createAssetId?: () => string
      normalizeOutput?: (
        output: MediaDerivationOutput,
        name: string
      ) => Promise<ValidatedMediaUpload>
    } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private createAssetId() {
    return this.options.createAssetId?.() ?? createOpaqueMediaAssetId()
  }

  private committed(job: MediaDerivationJob) {
    return this.db
      .prepare(
        `SELECT jobs.output_asset_id, output.r2_key AS output_r2_key,
                provenance.output_content_hash,
                provenance.output_media_type, provenance.output_width,
                provenance.output_height, jobs.completed_at
         FROM media_derivation_jobs jobs
         JOIN media_derivation_provenance provenance
           ON provenance.workspace_id = jobs.workspace_id
          AND provenance.derivation_job_id = jobs.id
         JOIN media_assets output
           ON output.workspace_id = jobs.workspace_id
          AND output.id = jobs.output_asset_id
         WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
           AND jobs.state = 'succeeded'`
      )
      .bind(job.workspaceId, job.id)
      .first<CommittedOutputRow>()
  }

  private canonical(workspaceId: string, contentHash: string) {
    return this.db
      .prepare(
        `SELECT id, media_type, bytes, width, height, content_hash, r2_key,
                status
         FROM media_assets
         WHERE workspace_id = ?1 AND content_hash = ?2`
      )
      .bind(workspaceId, contentHash)
      .first<CanonicalOutputRow>()
  }

  private async requireSafeCanonical(
    row: CanonicalOutputRow,
    output: ValidatedMediaUpload
  ) {
    if (
      row.status !== "ready" ||
      row.media_type !== output.mediaType ||
      Number(row.bytes) !== output.byteLength ||
      Number(row.width) !== output.width ||
      Number(row.height) !== output.height ||
      row.content_hash !== output.contentHash
    ) {
      throw new MediaDerivationDispatchError(
        "storage_failure",
        true,
        "The canonical derived asset is not safe to reuse"
      )
    }
    const object = await this.bucket.get(row.r2_key).catch(() => null)
    if (!object?.body) {
      throw new MediaDerivationDispatchError(
        "storage_failure",
        true,
        "The canonical derived asset is not available"
      )
    }
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (!equalBytes(bytes, output.bytes)) {
      throw new MediaDerivationDispatchError(
        "storage_failure",
        true,
        "The canonical derived asset failed integrity verification"
      )
    }
  }

  private settlement(
    job: MediaDerivationJob,
    outputAssetId: string,
    output: ValidatedMediaUpload,
    completedAt: string
  ): MediaDerivationSettlement {
    const settledJob: MediaDerivationJob = {
      ...job,
      state: "succeeded",
      outputAssetId,
      retryable: false,
      safeFailureCode: null,
      completedAt,
      updatedAt: completedAt,
    }
    const provenance: MediaDerivationProvenance = {
      workspaceId: job.workspaceId,
      outputAssetId,
      sourceAssetId: job.sourceAssetId,
      sourceContentHash: job.sourceContentHash,
      derivationJobId: job.id,
      operation: job.operation,
      providerKey: job.providerKey,
      providerModelVersion: job.providerModelVersion,
      privacyPolicyVersion: job.privacyPolicyVersion,
      outputContentHash: output.contentHash,
      outputMediaType: output.mediaType,
      outputWidth: output.width,
      outputHeight: output.height,
      createdAt: completedAt,
    }
    return { job: settledJob, provenance }
  }

  private settlementStatements(
    input: {
      job: MediaDerivationJob
      attemptId: string
    },
    outputAssetId: string,
    output: ValidatedMediaUpload,
    completedAt: string
  ) {
    return [
      this.db
        .prepare(
          `UPDATE media_derivation_jobs
           SET state = 'succeeded', output_asset_id = ?4,
               completed_at = ?5, updated_at = ?5,
               retryable = 0, safe_failure_code = NULL
           WHERE workspace_id = ?1 AND id = ?2 AND state = 'running'
             AND active_attempt_id = ?3
             AND cancellation_requested_at IS NULL
             AND source_asset_id <> ?4
             AND EXISTS (
               SELECT 1 FROM media_assets
               WHERE workspace_id = ?1 AND id = ?4 AND status = 'ready'
                 AND media_type = ?6 AND bytes = ?7 AND width = ?8
                 AND height = ?9 AND content_hash = ?10
             )`
        )
        .bind(
          input.job.workspaceId,
          input.job.id,
          input.attemptId,
          outputAssetId,
          completedAt,
          output.mediaType,
          output.byteLength,
          output.width,
          output.height,
          output.contentHash
        ),
      this.db
        .prepare(
          `UPDATE media_derivation_attempts
           SET state = 'succeeded', finished_at = ?4,
               retryable = 0, safe_failure_code = NULL
           WHERE workspace_id = ?1 AND job_id = ?2 AND id = ?3
             AND state = 'running'
             AND EXISTS (
               SELECT 1 FROM media_derivation_jobs
               WHERE workspace_id = ?1 AND id = ?2
                 AND state = 'succeeded' AND active_attempt_id = ?3
             )`
        )
        .bind(
          input.job.workspaceId,
          input.job.id,
          input.attemptId,
          completedAt
        ),
      this.db
        .prepare(
          `INSERT INTO media_derivation_provenance
             (workspace_id, output_asset_id, source_asset_id,
              source_content_hash, derivation_job_id, operation,
              provider_key, provider_model_version, privacy_policy_version,
              output_content_hash, output_media_type, output_width,
              output_height, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                   'image/png', ?11, ?12, ?13)`
        )
        .bind(
          input.job.workspaceId,
          outputAssetId,
          input.job.sourceAssetId,
          input.job.sourceContentHash,
          input.job.id,
          input.job.operation,
          input.job.providerKey,
          input.job.providerModelVersion,
          input.job.privacyPolicyVersion,
          output.contentHash,
          output.width,
          output.height,
          completedAt
        ),
    ]
  }

  private async commit(
    input: {
      job: MediaDerivationJob
      attemptId: string
    },
    outputAssetId: string,
    output: ValidatedMediaUpload,
    completedAt: string,
    insertAsset?: D1PreparedStatement
  ) {
    const statements = this.settlementStatements(
      input,
      outputAssetId,
      output,
      completedAt
    )
    const results = await this.db.batch(
      insertAsset ? [insertAsset, ...statements] : statements
    )
    if (results.some((result) => batchChanges(result) !== 1)) {
      throw new Error("media_derivation_output_transaction_incomplete")
    }
    return this.settlement(input.job, outputAssetId, output, completedAt)
  }

  async settle(input: {
    job: MediaDerivationJob
    attemptId: string
    output: MediaDerivationOutput
  }): Promise<MediaDerivationSettlement> {
    let normalized: ValidatedMediaUpload
    try {
      normalized = await (
        this.options.normalizeOutput ?? normalizeTransparentDerivationOutput
      )(input.output, "Background removed")
    } catch {
      throw new MediaDerivationDispatchError(
        "invalid_provider_output",
        false,
        "The provider returned an invalid transparent image"
      )
    }
    if (normalized.contentHash === input.job.sourceContentHash) {
      throw new MediaDerivationDispatchError(
        "invalid_provider_output",
        false,
        "Derived output must not reuse the source bytes"
      )
    }
    const previouslyCommitted = await this.committed(input.job).catch(
      () => null
    )
    if (previouslyCommitted) {
      if (
        previouslyCommitted.output_content_hash !== normalized.contentHash ||
        previouslyCommitted.output_media_type !== normalized.mediaType ||
        Number(previouslyCommitted.output_width) !== normalized.width ||
        Number(previouslyCommitted.output_height) !== normalized.height
      ) {
        throw new MediaDerivationDispatchError(
          "invalid_provider_output",
          false,
          "A completed derivation cannot be retried with different output"
        )
      }
      return this.settlement(
        input.job,
        previouslyCommitted.output_asset_id,
        normalized,
        previouslyCommitted.completed_at
      )
    }
    const canonical = await this.canonical(
      input.job.workspaceId,
      normalized.contentHash
    )
    if (canonical) {
      await this.requireSafeCanonical(canonical, normalized)
      try {
        return await this.commit(input, canonical.id, normalized, this.now())
      } catch (error) {
        const committed = await this.committed(input.job).catch(() => null)
        if (
          committed &&
          committed.output_content_hash === normalized.contentHash
        ) {
          return this.settlement(
            input.job,
            committed.output_asset_id,
            normalized,
            committed.completed_at
          )
        }
        if (error instanceof MediaDerivationError) throw error
        throw new MediaDerivationDispatchError(
          "storage_failure",
          true,
          "Derived output could not be committed"
        )
      }
    }
    const outputAssetId = this.createAssetId()
    const r2Key = `media/workspaces/${encodeURIComponent(input.job.workspaceId)}/derivations/${encodeURIComponent(input.job.id)}/${encodeURIComponent(input.attemptId)}/${normalized.contentHash}.png`
    try {
      await this.bucket.put(r2Key, normalized.bytes, {
        httpMetadata: { contentType: "image/png" },
        sha256: normalized.contentHash,
      })
    } catch {
      throw new MediaDerivationDispatchError(
        "storage_failure",
        true,
        "Derived output could not be staged"
      )
    }
    const completedAt = this.now()
    try {
      const insertAsset = this.db
        .prepare(
          `INSERT INTO media_assets
             (id, workspace_id, name, media_type, bytes, width, height,
              content_hash, r2_key, status, revision, created_at, updated_at,
              last_used_at, archived_at)
           SELECT ?1, ?2, ?3, 'image/png', ?4, ?5, ?6, ?7, ?8,
                  'ready', 1, ?9, ?9, ?9, NULL
           WHERE EXISTS (
             SELECT 1 FROM media_derivation_jobs
             WHERE workspace_id = ?2 AND id = ?10 AND state = 'running'
               AND active_attempt_id = ?11
               AND cancellation_requested_at IS NULL
               AND source_asset_id <> ?1
           )`
        )
        .bind(
          outputAssetId,
          input.job.workspaceId,
          normalized.name,
          normalized.byteLength,
          normalized.width,
          normalized.height,
          normalized.contentHash,
          r2Key,
          completedAt,
          input.job.id,
          input.attemptId
        )
      return await this.commit(
        input,
        outputAssetId,
        normalized,
        completedAt,
        insertAsset
      )
    } catch (error) {
      const committed = await this.committed(input.job).catch(() => null)
      if (
        committed &&
        committed.output_content_hash === normalized.contentHash
      ) {
        if (committed.output_r2_key !== r2Key) {
          await this.bucket.delete(r2Key).catch(() => undefined)
        }
        return this.settlement(
          input.job,
          committed.output_asset_id,
          normalized,
          committed.completed_at
        )
      }
      const raced = await this.canonical(
        input.job.workspaceId,
        normalized.contentHash
      )
      if (raced) {
        try {
          await this.requireSafeCanonical(raced, normalized)
          const settlement = await this.commit(
            input,
            raced.id,
            normalized,
            this.now()
          )
          await this.bucket.delete(r2Key).catch(() => undefined)
          return settlement
        } catch {
          const reconciled = await this.committed(input.job).catch(() => null)
          await this.bucket.delete(r2Key).catch(() => undefined)
          if (
            reconciled &&
            reconciled.output_content_hash === normalized.contentHash
          ) {
            return this.settlement(
              input.job,
              reconciled.output_asset_id,
              normalized,
              reconciled.completed_at
            )
          }
        }
      }
      await this.bucket.delete(r2Key).catch(() => undefined)
      if (error instanceof MediaDerivationError) throw error
      throw new MediaDerivationDispatchError(
        "storage_failure",
        true,
        "Derived output could not be committed"
      )
    }
  }
}
