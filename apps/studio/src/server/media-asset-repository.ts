import {
  assertMediaAssetId,
  createOpaqueMediaAssetId,
  inspectMediaAssetDimensions,
  mediaAssetDataUri,
  MediaAssetError,
  sha256Hex,
} from "./media-assets"
import type {
  MediaAssetDeletionImpact,
  MediaAssetReference,
  MediaAssetReferenceImpact,
  PublicMediaAsset,
  SupportedMediaAssetType,
  ValidatedMediaUpload,
  VerifiedManagedAssetResource,
} from "./media-assets"

type MediaAssetRow = {
  id: string
  workspace_id: string
  name: string
  media_type: SupportedMediaAssetType
  bytes: number
  width: number
  height: number
  content_hash: string
  r2_key: string
  status: "ready" | "archived"
  revision: number
  created_at: string
  updated_at: string
  last_used_at: string
}

type ReferenceRow = {
  reference_kind: "current_document" | "published_version"
  source_id: string
  document_id: string
  page_id: string | null
  node_id: string | null
  field_id: string | null
  property: string | null
  reference_key: string
}

type UploadRequestRow = MediaAssetRow & { request_hash: string }

export type MediaAssetListOptions = {
  collection: "uploads" | "recent"
  query: string
  limit: number
  cursor: string | null
}

export type MediaAssetListResult = {
  assets: PublicMediaAsset[]
  nextCursor: string | null
  storage: { bytes: number; count: number }
}

export type MediaAssetUploadResult = {
  asset: PublicMediaAsset
  created: boolean
}

export type MediaAssetContent = {
  asset: {
    id: string
    mediaType: SupportedMediaAssetType
    bytes: number
    width: number
    height: number
    status: "ready" | "archived"
    revision: number
  }
  contentHash: string
  body: ReadableStream
}

const mediaAssetColumns = `
  id, workspace_id, name, media_type, bytes, width, height, content_hash,
  r2_key, status, revision, created_at, updated_at, last_used_at
`

const qualifiedMediaAssetColumns = (alias: string) =>
  [
    "id",
    "workspace_id",
    "name",
    "media_type",
    "bytes",
    "width",
    "height",
    "content_hash",
    "r2_key",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "last_used_at",
  ]
    .map((column) => `${alias}.${column} AS ${column}`)
    .join(", ")

const managedUploadR2Key = (workspaceId: string, contentHash: string) =>
  `media/workspaces/${encodeURIComponent(workspaceId)}/content/${contentHash}/original`

const publicAsset = (row: MediaAssetRow): PublicMediaAsset => {
  if (row.status !== "ready") {
    throw new MediaAssetError("asset_archived", 409, "Asset is archived")
  }
  return {
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    status: "ready",
  }
}

const publicAssetLookup = (row: MediaAssetRow) => ({
  id: row.id,
  name: row.name,
  mediaType: row.media_type,
  bytes: row.bytes,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at,
  status: row.status,
  selectable: row.status === "ready",
})

type CursorPayload = {
  version: 1
  collection: "uploads" | "recent"
  query: string
  sort: string
  id: string
}

const encodeCursor = (payload: CursorPayload) =>
  btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

const decodeCursor = (
  cursor: string,
  options: Pick<MediaAssetListOptions, "collection" | "query">
): CursorPayload => {
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/")
    const payload = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
    ) as Partial<CursorPayload>
    if (
      payload.version !== 1 ||
      payload.collection !== options.collection ||
      payload.query !== options.query ||
      typeof payload.sort !== "string" ||
      !payload.sort ||
      typeof payload.id !== "string" ||
      !payload.id
    ) {
      throw new Error("Invalid cursor payload")
    }
    return payload as CursorPayload
  } catch {
    throw new MediaAssetError(
      "invalid_cursor",
      400,
      "Asset cursor is invalid for this collection and query"
    )
  }
}

const escapeLike = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

const impactToken = async (
  workspaceId: string,
  assetId: string,
  revision: number,
  references: ReferenceRow[]
) =>
  sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        workspaceId,
        assetId,
        revision,
        references: references.map((reference) => [
          reference.reference_kind,
          reference.source_id,
          reference.reference_key,
        ]),
      })
    )
  )

export class MediaAssetRepository {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly options: {
      now?: () => string
      createId?: () => string
    } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private createId() {
    return this.options.createId?.() ?? createOpaqueMediaAssetId()
  }

  private async row(workspaceId: string, assetId: string) {
    assertMediaAssetId(assetId)
    return this.db
      .prepare(
        `/* media:get */ SELECT ${mediaAssetColumns}
         FROM media_assets WHERE workspace_id = ?1 AND id = ?2`
      )
      .bind(workspaceId, assetId)
      .first<MediaAssetRow>()
  }

  async lookup(workspaceId: string, assetId: string) {
    const row = await this.row(workspaceId, assetId)
    if (!row) {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace"
      )
    }
    return publicAssetLookup(row)
  }

  private async ensureStoredUpload(
    row: MediaAssetRow,
    upload: ValidatedMediaUpload
  ): Promise<void> {
    let currentIsValid = false
    try {
      const current = await this.bucket.get(row.r2_key)
      if (current) {
        const bytes = new Uint8Array(await current.arrayBuffer())
        currentIsValid =
          bytes.byteLength === upload.byteLength &&
          (await sha256Hex(bytes)) === upload.contentHash
      }
    } catch {
      // A validated re-upload is also the recovery payload. If verification
      // fails, overwrite the same private key before any D1 state transition.
    }
    if (currentIsValid) return
    await this.bucket.put(row.r2_key, upload.bytes, {
      httpMetadata: { contentType: upload.mediaType },
      sha256: upload.contentHash,
    })
  }

  private async restoreArchivedUpload(
    workspaceId: string,
    row: MediaAssetRow,
    upload: ValidatedMediaUpload,
    idempotencyKey: string | null,
    requestAlreadyStored: boolean
  ): Promise<MediaAssetUploadResult> {
    await this.ensureStoredUpload(row, upload)
    const now = this.now()
    const results = await this.db.batch([
      this.db
        .prepare(
          `/* media:restore */ UPDATE media_assets
           SET status = 'ready', name = ?3, media_type = ?4, bytes = ?5,
               width = ?6, height = ?7, updated_at = ?8, last_used_at = ?8,
               archived_at = NULL, revision = revision + 1
           WHERE workspace_id = ?1 AND id = ?2 AND status = 'archived'`
        )
        .bind(
          workspaceId,
          row.id,
          upload.name,
          upload.mediaType,
          upload.byteLength,
          upload.width,
          upload.height,
          now
        ),
      ...(idempotencyKey && !requestAlreadyStored
        ? [
            this.uploadRequestStatement(
              workspaceId,
              idempotencyKey,
              upload.requestHash,
              row.id,
              now
            ),
          ]
        : []),
    ])
    if (Number(results[0]?.meta.changes) !== 1) {
      throw new Error("media_asset_restore_race")
    }
    const restored = await this.row(workspaceId, row.id)
    if (!restored) {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Restored asset could not be read"
      )
    }
    return { asset: publicAsset(restored), created: false }
  }

  async list(
    workspaceId: string,
    options: MediaAssetListOptions
  ): Promise<MediaAssetListResult> {
    const cursor = options.cursor ? decodeCursor(options.cursor, options) : null
    const sortColumn =
      options.collection === "recent" ? "last_used_at" : "created_at"
    const query = options.query.trim().toLocaleLowerCase()
    const search = `%${escapeLike(query)}%`
    const rows = await this.db
      .prepare(
        `/* media:list */ SELECT ${mediaAssetColumns}
         FROM media_assets
         WHERE workspace_id = ?1 AND status = 'ready'
           AND (?2 = '' OR lower(name) LIKE ?3 ESCAPE '\\')
           AND (
             ?4 IS NULL OR ${sortColumn} < ?4
             OR (${sortColumn} = ?4 AND id < ?5)
           )
         ORDER BY ${sortColumn} DESC, id DESC
         LIMIT ?6`
      )
      .bind(
        workspaceId,
        query,
        search,
        cursor?.sort ?? null,
        cursor?.id ?? null,
        options.limit + 1
      )
      .all<MediaAssetRow>()
    const hasMore = rows.results.length > options.limit
    const page = rows.results.slice(0, options.limit)
    const tail = page.at(-1)
    const storage = await this.db
      .prepare(
        `/* media:storage */ SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS count
         FROM media_assets WHERE workspace_id = ?1 AND status = 'ready'`
      )
      .bind(workspaceId)
      .first<{ bytes: number; count: number }>()
    return {
      assets: page.map(publicAsset),
      nextCursor:
        hasMore && tail
          ? encodeCursor({
              version: 1,
              collection: options.collection,
              query: options.query,
              sort:
                options.collection === "recent"
                  ? tail.last_used_at
                  : tail.created_at,
              id: tail.id,
            })
          : null,
      storage: {
        bytes: Number(storage?.bytes ?? 0),
        count: Number(storage?.count ?? 0),
      },
    }
  }

  async upload(
    workspaceId: string,
    upload: ValidatedMediaUpload,
    idempotencyKey: string | null
  ): Promise<MediaAssetUploadResult> {
    if (idempotencyKey) {
      const request = await this.db
        .prepare(
          `/* media:idempotency-get */
           SELECT ${qualifiedMediaAssetColumns("media_assets")}, requests.request_hash
           FROM media_asset_upload_requests requests
           JOIN media_assets ON media_assets.id = requests.asset_id
           WHERE requests.workspace_id = ?1 AND requests.idempotency_key = ?2`
        )
        .bind(workspaceId, idempotencyKey)
        .first<UploadRequestRow>()
      if (request) {
        if (request.request_hash !== upload.requestHash) {
          throw new MediaAssetError(
            "idempotency_key_reused",
            409,
            "Idempotency-Key was already used for a different upload"
          )
        }
        if (request.status === "archived") {
          return this.restoreArchivedUpload(
            workspaceId,
            request,
            upload,
            idempotencyKey,
            true
          )
        }
        await this.ensureStoredUpload(request, upload)
        return { asset: publicAsset(request), created: false }
      }
    }

    const duplicate = await this.db
      .prepare(
        `/* media:hash-get */ SELECT ${mediaAssetColumns}
         FROM media_assets WHERE workspace_id = ?1 AND content_hash = ?2`
      )
      .bind(workspaceId, upload.contentHash)
      .first<MediaAssetRow>()
    if (duplicate?.status === "ready") {
      await this.ensureStoredUpload(duplicate, upload)
      if (idempotencyKey) {
        await this.insertUploadRequest(
          workspaceId,
          idempotencyKey,
          upload.requestHash,
          duplicate.id
        )
      }
      return { asset: publicAsset(duplicate), created: false }
    }
    if (duplicate?.status === "archived") {
      return this.restoreArchivedUpload(
        workspaceId,
        duplicate,
        upload,
        idempotencyKey,
        false
      )
    }

    const id = this.createId()
    assertMediaAssetId(id)
    const r2Key = managedUploadR2Key(workspaceId, upload.contentHash)
    await this.bucket.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.mediaType },
      sha256: upload.contentHash,
    })
    const now = this.now()
    try {
      await this.db.batch([
        this.db
          .prepare(
            `/* media:insert */ INSERT INTO media_assets
             (id, workspace_id, name, media_type, bytes, width, height,
              content_hash, r2_key, status, revision, created_at, updated_at,
              last_used_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ready', 1,
                     ?10, ?10, ?10, NULL)`
          )
          .bind(
            id,
            workspaceId,
            upload.name,
            upload.mediaType,
            upload.byteLength,
            upload.width,
            upload.height,
            upload.contentHash,
            r2Key,
            now
          ),
        ...(idempotencyKey
          ? [
              this.uploadRequestStatement(
                workspaceId,
                idempotencyKey,
                upload.requestHash,
                id,
                now
              ),
            ]
          : []),
      ])
    } catch (error) {
      // The content key is deterministic, so another request may already own
      // the same object. Never delete it from a losing D1 transaction. A later
      // upload with the same bytes safely overwrites/reuses this key; orphan
      // reclamation must be handled by a separate ownership-aware process.
      const idempotent = idempotencyKey
        ? await this.db
            .prepare(
              `/* media:idempotency-get */
               SELECT ${qualifiedMediaAssetColumns("media_assets")}, requests.request_hash
               FROM media_asset_upload_requests requests
               JOIN media_assets ON media_assets.id = requests.asset_id
               WHERE requests.workspace_id = ?1 AND requests.idempotency_key = ?2`
            )
            .bind(workspaceId, idempotencyKey)
            .first<UploadRequestRow>()
        : null
      if (idempotent) {
        if (idempotent.request_hash !== upload.requestHash) {
          throw new MediaAssetError(
            "idempotency_key_reused",
            409,
            "Idempotency-Key was already used for a different upload"
          )
        }
        if (idempotent.status === "archived") {
          return this.restoreArchivedUpload(
            workspaceId,
            idempotent,
            upload,
            idempotencyKey,
            true
          )
        }
        await this.ensureStoredUpload(idempotent, upload)
        return { asset: publicAsset(idempotent), created: false }
      }
      const raced = await this.db
        .prepare(
          `/* media:hash-get */ SELECT ${mediaAssetColumns}
           FROM media_assets WHERE workspace_id = ?1 AND content_hash = ?2`
        )
        .bind(workspaceId, upload.contentHash)
        .first<MediaAssetRow>()
      if (raced?.status === "ready") {
        await this.ensureStoredUpload(raced, upload)
        return { asset: publicAsset(raced), created: false }
      }
      if (raced?.status === "archived") {
        return this.restoreArchivedUpload(
          workspaceId,
          raced,
          upload,
          idempotencyKey,
          false
        )
      }
      throw error
    }
    return {
      asset: {
        id,
        name: upload.name,
        mediaType: upload.mediaType,
        bytes: upload.byteLength,
        width: upload.width,
        height: upload.height,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        status: "ready",
      },
      created: true,
    }
  }

  private uploadRequestStatement(
    workspaceId: string,
    idempotencyKey: string,
    requestHash: string,
    assetId: string,
    now: string
  ) {
    return this.db
      .prepare(
        `/* media:idempotency-insert */ INSERT INTO media_asset_upload_requests
         (workspace_id, idempotency_key, request_hash, asset_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(workspaceId, idempotencyKey, requestHash, assetId, now)
  }

  private async insertUploadRequest(
    workspaceId: string,
    idempotencyKey: string,
    requestHash: string,
    assetId: string
  ) {
    try {
      await this.uploadRequestStatement(
        workspaceId,
        idempotencyKey,
        requestHash,
        assetId,
        this.now()
      ).run()
    } catch {
      const existing = await this.db
        .prepare(
          `/* media:idempotency-hash */ SELECT request_hash
           FROM media_asset_upload_requests
           WHERE workspace_id = ?1 AND idempotency_key = ?2`
        )
        .bind(workspaceId, idempotencyKey)
        .first<{ request_hash: string }>()
      if (existing?.request_hash !== requestHash) {
        throw new MediaAssetError(
          "idempotency_key_reused",
          409,
          "Idempotency-Key was already used for a different upload"
        )
      }
    }
  }

  async contentMetadata(workspaceId: string, assetId: string) {
    const row = await this.row(workspaceId, assetId)
    if (!row) {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace"
      )
    }
    return {
      asset: {
        id: row.id,
        mediaType: row.media_type,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        status: row.status,
        revision: row.revision,
      },
      contentHash: row.content_hash,
      r2Key: row.r2_key,
    }
  }

  async content(
    workspaceId: string,
    assetId: string
  ): Promise<MediaAssetContent> {
    const metadata = await this.contentMetadata(workspaceId, assetId)
    const object = await this.bucket.get(metadata.r2Key)
    if (!object?.body) {
      throw new MediaAssetError(
        "asset_content_missing",
        404,
        "Asset metadata exists but its private image object is missing"
      )
    }
    return {
      asset: metadata.asset,
      contentHash: metadata.contentHash,
      body: object.body,
    }
  }

  async markUsed(workspaceId: string, assetId: string) {
    const now = this.now()
    const result = await this.db
      .prepare(
        `/* media:mark-used */ UPDATE media_assets
         SET last_used_at = ?3, updated_at = ?3, revision = revision + 1
         WHERE workspace_id = ?1 AND id = ?2 AND status = 'ready'`
      )
      .bind(workspaceId, assertMediaAssetId(assetId), now)
      .run()
    if (Number(result.meta.changes) !== 1) {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace"
      )
    }
    const updated = await this.row(workspaceId, assetId)
    if (!updated) {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace"
      )
    }
    return publicAsset(updated)
  }

  async deletionImpact(
    workspaceId: string,
    assetId: string
  ): Promise<MediaAssetDeletionImpact> {
    const row = await this.row(workspaceId, assetId)
    if (!row || row.status !== "ready") {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace"
      )
    }
    const result = await this.db
      .prepare(
        `/* media:references */
         SELECT reference_kind, source_id, document_id, page_id, node_id,
                field_id, property, reference_key
         FROM media_asset_references
         WHERE workspace_id = ?1 AND asset_id = ?2
         ORDER BY reference_kind, source_id, reference_key`
      )
      .bind(workspaceId, assetId)
      .all<ReferenceRow>()
    const currentReferences = result.results.filter(
      (reference) => reference.reference_kind === "current_document"
    ).length
    const publishedReferences = result.results.length - currentReferences
    const references: MediaAssetReferenceImpact[] = result.results.map(
      (reference) => ({
        referenceKind: reference.reference_kind,
        sourceId: reference.source_id,
        documentId: reference.document_id,
        pageId: reference.page_id,
        nodeId: reference.node_id,
        fieldId: reference.field_id,
        property: reference.property,
      })
    )
    return {
      assetId,
      revision: row.revision,
      token: await impactToken(
        workspaceId,
        assetId,
        row.revision,
        result.results
      ),
      canArchive: result.results.length === 0,
      currentReferences,
      publishedReferences,
      references,
    }
  }

  async archive(
    workspaceId: string,
    assetId: string,
    expectedRevision: number,
    expectedImpactToken: string
  ): Promise<{ assetId: string; status: "archived"; revision: number }> {
    const impact = await this.deletionImpact(workspaceId, assetId)
    if (impact.revision !== expectedRevision) {
      throw new MediaAssetError(
        "asset_revision_mismatch",
        412,
        "Asset changed after the archive confirmation was opened"
      )
    }
    if (impact.token !== expectedImpactToken) {
      throw new MediaAssetError(
        "asset_impact_stale",
        412,
        "Asset references changed after the archive impact was reviewed"
      )
    }
    if (!impact.canArchive) {
      throw new MediaAssetError(
        "asset_referenced",
        409,
        "Referenced assets cannot be archived until every current and published use is resolved"
      )
    }
    const now = this.now()
    const result = await this.db
      .prepare(
        `/* media:archive */ UPDATE media_assets
         SET status = 'archived', archived_at = ?4, updated_at = ?4,
             revision = revision + 1
         WHERE workspace_id = ?1 AND id = ?2 AND status = 'ready'
           AND revision = ?3
           AND NOT EXISTS (
             SELECT 1 FROM media_asset_references references
             WHERE references.workspace_id = ?1
               AND references.asset_id = media_assets.id
           )`
      )
      .bind(workspaceId, assetId, expectedRevision, now)
      .run()
    if (Number(result.meta.changes) !== 1) {
      const latest = await this.deletionImpact(workspaceId, assetId)
      if (!latest.canArchive) {
        throw new MediaAssetError(
          "asset_referenced",
          409,
          "Asset gained a reference while archive was being committed"
        )
      }
      throw new MediaAssetError(
        "asset_revision_mismatch",
        412,
        "Asset changed while archive was being committed"
      )
    }
    return {
      assetId,
      status: "archived",
      revision: expectedRevision + 1,
    }
  }

  async resolveRendererSource(
    workspaceId: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<VerifiedManagedAssetResource> {
    signal?.throwIfAborted()
    const metadata = await this.contentMetadata(workspaceId, assetId)
    signal?.throwIfAborted()
    const object = await this.bucket.get(metadata.r2Key)
    signal?.throwIfAborted()
    if (!object?.body) {
      throw new MediaAssetError(
        "asset_content_missing",
        404,
        "Managed asset content is missing"
      )
    }
    const bytes = new Uint8Array(await object.arrayBuffer())
    signal?.throwIfAborted()
    if ((await sha256Hex(bytes)) !== metadata.contentHash) {
      throw new MediaAssetError(
        "asset_content_missing",
        404,
        "Managed asset content failed its integrity check"
      )
    }
    signal?.throwIfAborted()
    const dimensions = inspectMediaAssetDimensions(
      metadata.asset.mediaType,
      bytes
    )
    if (
      dimensions.width !== metadata.asset.width ||
      dimensions.height !== metadata.asset.height
    ) {
      throw new MediaAssetError(
        "asset_dimension_mismatch",
        422,
        "Managed asset dimensions do not match its verified content"
      )
    }
    signal?.throwIfAborted()
    return {
      assetId: metadata.asset.id,
      src: mediaAssetDataUri(metadata.asset.mediaType, bytes),
      width: dimensions.width,
      height: dimensions.height,
      contentHash: metadata.contentHash,
      revision: metadata.asset.revision,
    }
  }
}

export type MediaAssetReferenceMutation = {
  statements: D1PreparedStatement[]
  insertionStatementIndexes: number[]
  expectedInsertions: number
}

export class MediaAssetReferenceInvariantError extends Error {
  constructor(inserted: number, expected: number) {
    super(`media_reference_write_incomplete:${inserted}/${expected}`)
    this.name = "MediaAssetReferenceInvariantError"
  }
}

/**
 * Builds a replacement set that can be included in the same D1 batch as the
 * document/version write. Inserts use the composite workspace/asset foreign
 * key, so a missing or cross-workspace asset aborts the entire batch instead
 * of silently dropping a reference. Archived assets remain valid identities.
 */
export function mediaAssetReferenceMutation(
  db: D1Database,
  workspaceId: string,
  referenceKind: MediaAssetReference["referenceKind"],
  sourceId: string,
  references: MediaAssetReference[],
  now: string
): MediaAssetReferenceMutation {
  const statements = [
    db
      .prepare(
        `/* media:references-delete */ DELETE FROM media_asset_references
         WHERE workspace_id = ?1 AND reference_kind = ?2 AND source_id = ?3`
      )
      .bind(workspaceId, referenceKind, sourceId),
    ...references.map((reference) =>
      db
        .prepare(
          `/* media:reference-insert */ INSERT INTO media_asset_references
           (id, workspace_id, asset_id, reference_kind, source_id,
            reference_key, document_id, page_id, node_id, field_id, property,
            created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                   ?12, ?12)`
        )
        .bind(
          `media-reference-${crypto.randomUUID()}`,
          workspaceId,
          reference.assetId,
          referenceKind,
          sourceId,
          reference.referenceKey,
          reference.documentId,
          reference.pageId,
          reference.nodeId,
          reference.fieldId,
          reference.property,
          now
        )
    ),
  ]
  return {
    statements,
    insertionStatementIndexes: references.map((_, index) => index + 1),
    expectedInsertions: references.length,
  }
}

export function assertMediaAssetReferenceMutationResult(
  mutation: MediaAssetReferenceMutation,
  results: D1Result<unknown>[]
): void {
  const inserted = mutation.insertionStatementIndexes.reduce(
    (count, index) => count + Number(results[index]?.meta.changes ?? 0),
    0
  )
  if (
    results.length !== mutation.statements.length ||
    inserted !== mutation.expectedInsertions
  ) {
    throw new MediaAssetReferenceInvariantError(
      inserted,
      mutation.expectedInsertions
    )
  }
}
