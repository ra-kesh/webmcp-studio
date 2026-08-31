import { createOpaqueMediaAssetId, validateMediaUpload } from "./media-assets"
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
  const decompress = (format: CompressionFormat, bytes: Uint8Array) =>
    new Response(
      new Blob([Uint8Array.from(bytes).buffer])
        .stream()
        .pipeThrough(new DecompressionStream(format))
    ).arrayBuffer()
  let decompressed: ArrayBuffer
  try {
    decompressed = await decompress("deflate", compressed)
  } catch {
    if (compressed.byteLength <= 6) throw new Error("png_deflate_truncated")
    decompressed = await decompress(
      "deflate-raw",
      compressed.subarray(2, compressed.byteLength - 4)
    )
  }
  const source = new Uint8Array(decompressed)
  const stride = width * 4
  if (source.byteLength !== (stride + 1) * height) return false
  let previous = new Uint8Array(stride)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = source[offset]
    offset += 1
    if (filter > 4) return false
    const row = new Uint8Array(stride)
    for (let x = 0; x < stride; x += 1) {
      const value = source[offset + x]
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
      if (row[alpha] < 255) return true
    }
    previous = row
    offset += stride
  }
  return false
}

export async function normalizeTransparentDerivationOutput(
  output: MediaDerivationOutput,
  name = "Background removed"
): Promise<ValidatedMediaUpload> {
  if (
    output.mediaType !== "image/png" ||
    output.bytes.byteLength < 57 ||
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
  output_content_hash: string
  output_media_type: "image/png"
  output_width: number
  output_height: number
  completed_at: string
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
        `SELECT jobs.output_asset_id, provenance.output_content_hash,
                provenance.output_media_type, provenance.output_width,
                provenance.output_height, jobs.completed_at
         FROM media_derivation_jobs jobs
         JOIN media_derivation_provenance provenance
           ON provenance.workspace_id = jobs.workspace_id
          AND provenance.derivation_job_id = jobs.id
         WHERE jobs.workspace_id = ?1 AND jobs.id = ?2
           AND jobs.state = 'succeeded'`
      )
      .bind(job.workspaceId, job.id)
      .first<CommittedOutputRow>()
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
    const outputAssetId = this.createAssetId()
    const r2Key = `media/workspaces/${encodeURIComponent(input.job.workspaceId)}/derivations/${encodeURIComponent(input.job.id)}/${normalized.contentHash}.png`
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
      const results = await this.db.batch([
        this.db
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
          ),
        this.db
          .prepare(
            `UPDATE media_derivation_jobs
             SET state = 'succeeded', output_asset_id = ?4,
                 completed_at = ?5, updated_at = ?5,
                 retryable = 0, safe_failure_code = NULL
             WHERE workspace_id = ?1 AND id = ?2 AND state = 'running'
               AND active_attempt_id = ?3
               AND cancellation_requested_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM media_assets
                 WHERE workspace_id = ?1 AND id = ?4 AND status = 'ready'
               )`
          )
          .bind(
            input.job.workspaceId,
            input.job.id,
            input.attemptId,
            outputAssetId,
            completedAt
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
            normalized.contentHash,
            normalized.width,
            normalized.height,
            completedAt
          ),
      ])
      if (results.some((result) => batchChanges(result) !== 1)) {
        throw new Error("media_derivation_output_transaction_incomplete")
      }
      return this.settlement(input.job, outputAssetId, normalized, completedAt)
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
