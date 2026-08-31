import {
  assertMediaAssetId,
  assertMediaIdempotencyKey,
  assertLocalAssetId,
  createOpaqueMediaAssetId,
  inspectMediaAssetDimensions,
  mediaAssetDataUri,
  MediaAssetError,
  sha256Hex,
} from "./media-assets"
import type {
  LocalAssetPromotion,
  MediaAssetDeletionImpact,
  MediaAssetReference,
  MediaAssetReferenceImpact,
  PublicMediaAsset,
  SupportedMediaAssetType,
  ValidatedMediaUpload,
  VerifiedManagedAssetResource,
} from "./media-assets"
import {
  ManagedMediaCatalogError,
  managedMediaCatalogMetadataEqual,
  normalizeManagedMediaCatalogMetadataUpdate,
} from "./media-asset-catalog-metadata"
import type {
  ManagedMediaCatalogMetadata,
  ManagedMediaCatalogMetadataUpdate,
} from "./media-asset-catalog-metadata"

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

type MediaAssetCatalogRow = MediaAssetRow & {
  catalog_description: string
  catalog_tags_json: string
  catalog_category_id: string
  catalog_use_case_ids_json: string
  catalog_provenance_source_name: string
  catalog_provenance_source_url: string | null
  catalog_license_id: string
  catalog_license_name: string
  catalog_license_url: string | null
  catalog_attribution_required: number
  catalog_attribution_text: string | null
  catalog_version: number
  catalog_created_at: string
  catalog_updated_at: string
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

type LocalPromotionRow = MediaAssetRow & {
  local_asset_id: string
}

type MediaAssetUseRequestRow = {
  workspace_id: string
  idempotency_key: string
  request_hash: string
  asset_id: string
  used_at: string
  result_revision: number
  created_at: string
}

export type MediaAssetUseResult = {
  assetId: string
  usedAt: string
  assetRevision: number
}

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

export type ManagedMediaCatalogEntry = {
  asset: PublicMediaAsset
  metadata: ManagedMediaCatalogMetadata
}

export type ManagedMediaCatalogListResult = {
  entries: ManagedMediaCatalogEntry[]
  nextCursor: string | null
  storage: { bytes: number; count: number }
  catalogRevision: number
}

export type ManagedMediaLibraryCatalogSnapshot = {
  entries: ManagedMediaCatalogEntry[]
  catalogRevision: number
}

export const MAX_MANAGED_LIBRARY_CATALOG_ITEMS = 1_000

export class ManagedMediaLibraryCatalogCapacityError extends Error {
  readonly code = "managed_media_library_catalog_capacity_exceeded"

  constructor() {
    super(
      `A workspace library can project at most ${MAX_MANAGED_LIBRARY_CATALOG_ITEMS} managed media items`
    )
    this.name = "ManagedMediaLibraryCatalogCapacityError"
  }
}

export type MediaAssetUploadResult = {
  asset: PublicMediaAsset
  created: boolean
}

export type MediaAssetPromotionResult = {
  promotion: LocalAssetPromotion
  storageDeltaBytes: number
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

const mediaAssetCatalogColumns = `${qualifiedMediaAssetColumns("assets")},
  metadata.description AS catalog_description,
  metadata.tags_json AS catalog_tags_json,
  metadata.category_id AS catalog_category_id,
  metadata.use_case_ids_json AS catalog_use_case_ids_json,
  metadata.provenance_source_name AS catalog_provenance_source_name,
  metadata.provenance_source_url AS catalog_provenance_source_url,
  metadata.license_id AS catalog_license_id,
  metadata.license_name AS catalog_license_name,
  metadata.license_url AS catalog_license_url,
  metadata.attribution_required AS catalog_attribution_required,
  metadata.attribution_text AS catalog_attribution_text,
  metadata.catalog_version AS catalog_version,
  metadata.created_at AS catalog_created_at,
  metadata.updated_at AS catalog_updated_at`

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

const catalogStringArray = (value: string, field: string) => {
  const parsed: unknown = JSON.parse(value)
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`media_asset_catalog_${field}_invalid`)
  }
  return parsed
}

const catalogMetadata = (
  row: MediaAssetCatalogRow
): ManagedMediaCatalogMetadata => ({
  description: row.catalog_description,
  tags: catalogStringArray(row.catalog_tags_json, "tags"),
  categoryId: row.catalog_category_id,
  useCaseIds: catalogStringArray(row.catalog_use_case_ids_json, "use_cases"),
  provenance: {
    sourceName: row.catalog_provenance_source_name,
    sourceUrl: row.catalog_provenance_source_url,
    license: {
      id: row.catalog_license_id,
      name: row.catalog_license_name,
      url: row.catalog_license_url,
    },
    attribution: {
      required: row.catalog_attribution_required === 1,
      text: row.catalog_attribution_text,
    },
  },
  catalogVersion: Number(row.catalog_version),
  createdAt: row.catalog_created_at,
  updatedAt: row.catalog_updated_at,
})

const catalogEntry = (row: MediaAssetCatalogRow): ManagedMediaCatalogEntry => ({
  asset: publicAsset(row),
  metadata: catalogMetadata(row),
})

const publicPromotion = (
  localAssetId: string,
  row: MediaAssetRow
): LocalAssetPromotion => ({
  localAssetId,
  contentSha256: row.content_hash,
  asset: {
    ...publicAssetLookup(row),
    revision: row.revision,
  },
})

const promotionRequestHash = (
  localAssetId: string,
  uploadRequestHash: string
) =>
  sha256Hex(
    new TextEncoder().encode(
      `local-promotion\0${localAssetId}\0${uploadRequestHash}`
    )
  )

const useRequestHash = (assetId: string) =>
  sha256Hex(new TextEncoder().encode(`media-used\0${assetId}`))

const exactBatchChanges = (
  results: D1Result<unknown>[],
  expectedChanges: readonly number[],
  error: string
) => {
  if (!batchChangesMatch(results, expectedChanges)) {
    throw new Error(error)
  }
}

const batchChangesMatch = (
  results: D1Result<unknown>[],
  expectedChanges: readonly number[]
) =>
  !(
    results.length !== expectedChanges.length ||
    expectedChanges.some(
      (expected, index) =>
        Number(results[index]?.meta.changes ?? 0) !== expected
    )
  )

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

/**
 * D1-only authority used by the shared library catalog. It deliberately has
 * no R2 binding: discovery and exact metadata admission must never load or
 * expose private media bytes.
 */
export class ManagedMediaLibraryCatalogRepository {
  constructor(private readonly db: D1Database) {}

  async readRevision(workspaceId: string): Promise<number> {
    const state = await this.db
      .prepare(
        `/* media:library-catalog-revision */ SELECT revision
         FROM media_asset_catalog_state WHERE workspace_id = ?1`
      )
      .bind(workspaceId)
      .first<{ revision: number }>()
    return Number(state?.revision ?? 0)
  }

  async readSnapshot(
    workspaceId: string
  ): Promise<ManagedMediaLibraryCatalogSnapshot> {
    const [entriesResult, revisionResult] = await this.db.batch([
      this.db
        .prepare(
          `/* media:library-catalog-snapshot */ SELECT ${mediaAssetCatalogColumns}
           FROM media_assets assets
           JOIN media_asset_catalog_metadata metadata
             ON metadata.workspace_id = assets.workspace_id
            AND metadata.asset_id = assets.id
           WHERE assets.workspace_id = ?1 AND assets.status = 'ready'
           ORDER BY assets.id
           LIMIT ?2`
        )
        .bind(workspaceId, MAX_MANAGED_LIBRARY_CATALOG_ITEMS + 1),
      this.db
        .prepare(
          `/* media:library-catalog-revision */ SELECT revision
           FROM media_asset_catalog_state WHERE workspace_id = ?1`
        )
        .bind(workspaceId),
    ])
    const rows = entriesResult.results as MediaAssetCatalogRow[]
    if (rows.length > MAX_MANAGED_LIBRARY_CATALOG_ITEMS) {
      throw new ManagedMediaLibraryCatalogCapacityError()
    }
    const state = revisionResult.results[0] as { revision: number } | undefined
    return {
      entries: rows.map(catalogEntry),
      catalogRevision: Number(state?.revision ?? 0),
    }
  }

  async getExact(
    workspaceId: string,
    assetId: string,
    catalogVersion: number
  ): Promise<ManagedMediaCatalogEntry | null> {
    try {
      assertMediaAssetId(assetId)
    } catch (error) {
      if (
        error instanceof MediaAssetError &&
        error.code === "invalid_asset_id"
      ) {
        return null
      }
      throw error
    }
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) return null
    const row = await this.db
      .prepare(
        `/* media:library-catalog-exact */ SELECT ${mediaAssetCatalogColumns}
         FROM media_assets assets
         JOIN media_asset_catalog_metadata metadata
           ON metadata.workspace_id = assets.workspace_id
          AND metadata.asset_id = assets.id
         WHERE assets.workspace_id = ?1 AND assets.id = ?2
           AND assets.status = 'ready' AND metadata.catalog_version = ?3`
      )
      .bind(workspaceId, assetId, catalogVersion)
      .first<MediaAssetCatalogRow>()
    return row ? catalogEntry(row) : null
  }
}

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

  private catalogRowStatement(workspaceId: string, assetId: string) {
    assertMediaAssetId(assetId)
    return this.db
      .prepare(
        `/* media:catalog-get */ SELECT ${mediaAssetCatalogColumns}
         FROM media_assets assets
         JOIN media_asset_catalog_metadata metadata
           ON metadata.workspace_id = assets.workspace_id
          AND metadata.asset_id = assets.id
         WHERE assets.workspace_id = ?1 AND assets.id = ?2`
      )
      .bind(workspaceId, assetId)
  }

  private async catalogRow(workspaceId: string, assetId: string) {
    return this.catalogRowStatement(
      workspaceId,
      assetId
    ).first<MediaAssetCatalogRow>()
  }

  async lookupCatalogEntry(
    workspaceId: string,
    assetId: string
  ): Promise<ManagedMediaCatalogEntry> {
    const row = await this.catalogRow(workspaceId, assetId)
    if (!row || row.status !== "ready") {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace catalog"
      )
    }
    return catalogEntry(row)
  }

  async catalogRevision(workspaceId: string): Promise<number> {
    const state = await this.catalogRevisionStatement(workspaceId).first<{
      revision: number
    }>()
    return Number(state?.revision ?? 0)
  }

  private storageUsageStatement(workspaceId: string) {
    return this.db
      .prepare(
        `/* media:storage */ SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS count
         FROM media_assets WHERE workspace_id = ?1`
      )
      .bind(workspaceId)
  }

  private catalogRevisionStatement(workspaceId: string) {
    return this.db
      .prepare(
        `/* media:catalog-revision */ SELECT revision
         FROM media_asset_catalog_state WHERE workspace_id = ?1`
      )
      .bind(workspaceId)
  }

  async updateCatalogMetadata(
    workspaceId: string,
    assetId: string,
    expectedCatalogVersion: number,
    update: ManagedMediaCatalogMetadataUpdate
  ): Promise<ManagedMediaCatalogEntry> {
    if (
      !Number.isInteger(expectedCatalogVersion) ||
      expectedCatalogVersion < 1
    ) {
      throw new ManagedMediaCatalogError(
        "invalid_asset_catalog_version",
        400,
        "Expected catalog version must be a positive integer"
      )
    }
    const currentRow = await this.catalogRow(workspaceId, assetId)
    if (!currentRow || currentRow.status !== "ready") {
      throw new MediaAssetError(
        "asset_not_found",
        404,
        "Asset was not found in this workspace catalog"
      )
    }
    const current = catalogMetadata(currentRow)
    if (current.catalogVersion !== expectedCatalogVersion) {
      throw new ManagedMediaCatalogError(
        "asset_catalog_version_mismatch",
        412,
        "Asset catalog metadata changed before this update"
      )
    }
    const normalized = normalizeManagedMediaCatalogMetadataUpdate(
      update,
      current
    )
    if (managedMediaCatalogMetadataEqual(normalized, current)) {
      return catalogEntry(currentRow)
    }
    const now = this.now()
    const updateStatement = this.db
      .prepare(
        `/* media:catalog-update */ UPDATE media_asset_catalog_metadata
         SET description = ?4,
             tags_json = ?5,
             category_id = ?6,
             use_case_ids_json = ?7,
             provenance_source_name = ?8,
             provenance_source_url = ?9,
             license_id = ?10,
             license_name = ?11,
             license_url = ?12,
             attribution_required = ?13,
             attribution_text = ?14,
             catalog_version = catalog_version + 1,
             updated_at = ?15
         WHERE workspace_id = ?1 AND asset_id = ?2
           AND catalog_version = ?3
           AND EXISTS (
             SELECT 1 FROM media_assets assets
             WHERE assets.workspace_id = ?1
               AND assets.id = ?2
               AND assets.status = 'ready'
           )`
      )
      .bind(
        workspaceId,
        assetId,
        expectedCatalogVersion,
        normalized.description,
        JSON.stringify(normalized.tags),
        normalized.categoryId,
        JSON.stringify(normalized.useCaseIds),
        normalized.provenance.sourceName,
        normalized.provenance.sourceUrl,
        normalized.provenance.license.id,
        normalized.provenance.license.name,
        normalized.provenance.license.url,
        normalized.provenance.attribution.required ? 1 : 0,
        normalized.provenance.attribution.text,
        now
      )
    const [updateResult, committedResult] = await this.db.batch([
      updateStatement,
      this.catalogRowStatement(workspaceId, assetId),
    ])
    const committed = committedResult.results[0] as
      MediaAssetCatalogRow | undefined
    if (Number(updateResult.meta.changes) !== 1) {
      const latest = committed
      if (!latest || latest.status !== "ready") {
        throw new MediaAssetError(
          "asset_not_found",
          404,
          "Asset was removed from the workspace catalog"
        )
      }
      throw new ManagedMediaCatalogError(
        "asset_catalog_version_mismatch",
        412,
        "Asset catalog metadata changed while this update was committed"
      )
    }
    if (!committed || committed.status !== "ready") {
      throw new Error("media_asset_catalog_update_unreadable")
    }
    return catalogEntry(committed)
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
    const result = await this.listCatalog(workspaceId, options)
    return {
      assets: result.entries.map((entry) => entry.asset),
      nextCursor: result.nextCursor,
      storage: result.storage,
    }
  }

  async listCatalog(
    workspaceId: string,
    options: MediaAssetListOptions
  ): Promise<ManagedMediaCatalogListResult> {
    const cursor = options.cursor ? decodeCursor(options.cursor, options) : null
    const sortColumn =
      options.collection === "recent"
        ? "assets.last_used_at"
        : "assets.created_at"
    const query = options.query.trim().toLocaleLowerCase()
    const search = `%${escapeLike(query)}%`
    const listStatement = this.db
      .prepare(
        `/* media:list */ SELECT ${mediaAssetCatalogColumns}
         FROM media_assets assets
         JOIN media_asset_catalog_metadata metadata
           ON metadata.workspace_id = assets.workspace_id
          AND metadata.asset_id = assets.id
         WHERE assets.workspace_id = ?1 AND assets.status = 'ready'
           AND (
             ?2 = ''
             OR lower(assets.name) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.description) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.tags_json) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.category_id) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.use_case_ids_json) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.provenance_source_name) LIKE ?3 ESCAPE '\\'
             OR lower(metadata.license_name) LIKE ?3 ESCAPE '\\'
           )
           AND (
             ?4 IS NULL OR ${sortColumn} < ?4
             OR (${sortColumn} = ?4 AND assets.id < ?5)
           )
         ORDER BY ${sortColumn} DESC, assets.id DESC
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
    const [rowsResult, storageResult, catalogRevisionResult] =
      await this.db.batch([
        listStatement,
        this.storageUsageStatement(workspaceId),
        this.catalogRevisionStatement(workspaceId),
      ])
    const rows = rowsResult.results as MediaAssetCatalogRow[]
    const hasMore = rows.length > options.limit
    const page = rows.slice(0, options.limit)
    const tail = page.at(-1)
    const storageRow = storageResult.results[0] as
      { bytes: number; count: number } | undefined
    const catalogState = catalogRevisionResult.results[0] as
      { revision: number } | undefined
    return {
      entries: page.map(catalogEntry),
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
        bytes: Number(storageRow?.bytes ?? 0),
        count: Number(storageRow?.count ?? 0),
      },
      catalogRevision: Number(catalogState?.revision ?? 0),
    }
  }

  async storageUsage(workspaceId: string) {
    const storage = await this.storageUsageStatement(workspaceId).first<{
      bytes: number
      count: number
    }>()
    return {
      bytes: Number(storage?.bytes ?? 0),
      count: Number(storage?.count ?? 0),
    }
  }

  private async promotionRow(workspaceId: string, localAssetId: string) {
    return this.db
      .prepare(
        `/* media:promotion-get */ SELECT ${qualifiedMediaAssetColumns("assets")},
                promotions.local_asset_id
         FROM media_asset_local_promotions promotions
         JOIN media_assets assets
           ON assets.workspace_id = promotions.workspace_id
          AND assets.id = promotions.asset_id
         WHERE promotions.workspace_id = ?1
           AND promotions.local_asset_id = ?2`
      )
      .bind(workspaceId, assertLocalAssetId(localAssetId))
      .first<LocalPromotionRow>()
  }

  private async uploadRequestRow(workspaceId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `/* media:idempotency-get */
         SELECT ${qualifiedMediaAssetColumns("media_assets")}, requests.request_hash
         FROM media_asset_upload_requests requests
         JOIN media_assets ON media_assets.id = requests.asset_id
         WHERE requests.workspace_id = ?1 AND requests.idempotency_key = ?2`
      )
      .bind(workspaceId, idempotencyKey)
      .first<UploadRequestRow>()
  }

  private async useRequestRow(workspaceId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `/* media:use-request-get */ SELECT workspace_id, idempotency_key,
                request_hash, asset_id, used_at, result_revision, created_at
         FROM media_asset_use_requests
         WHERE workspace_id = ?1 AND idempotency_key = ?2`
      )
      .bind(workspaceId, idempotencyKey)
      .first<MediaAssetUseRequestRow>()
  }

  private useReceipt(
    request: MediaAssetUseRequestRow,
    requestHash: string,
    assetId: string
  ): MediaAssetUseResult {
    if (request.request_hash !== requestHash || request.asset_id !== assetId) {
      throw new MediaAssetError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for a different request"
      )
    }
    return {
      assetId: request.asset_id,
      usedAt: request.used_at,
      assetRevision: Number(request.result_revision),
    }
  }

  private assertPromotionRequest(
    request: UploadRequestRow,
    requestHash: string,
    assetId?: string
  ) {
    if (
      request.request_hash !== requestHash ||
      (assetId !== undefined && request.id !== assetId)
    ) {
      throw new MediaAssetError(
        "idempotency_key_reused",
        409,
        "Idempotency-Key was already used for a different request"
      )
    }
  }

  private async ensurePromotionRequest(
    workspaceId: string,
    idempotencyKey: string,
    requestHash: string,
    assetId: string
  ) {
    const existing = await this.uploadRequestRow(workspaceId, idempotencyKey)
    if (existing) {
      this.assertPromotionRequest(existing, requestHash, assetId)
      return
    }
    let results: D1Result<unknown>[]
    try {
      results = await this.db.batch([
        this.uploadRequestStatement(
          workspaceId,
          idempotencyKey,
          requestHash,
          assetId,
          this.now()
        ),
      ])
    } catch (error) {
      const raced = await this.uploadRequestRow(workspaceId, idempotencyKey)
      if (!raced) throw error
      this.assertPromotionRequest(raced, requestHash, assetId)
      return
    }
    exactBatchChanges(results, [1], "media_asset_promotion_request_incomplete")
  }

  async lookupLocalPromotion(workspaceId: string, localAssetId: string) {
    const row = await this.promotionRow(workspaceId, localAssetId)
    if (!row) {
      throw new MediaAssetError(
        "local_asset_promotion_not_found",
        404,
        "No Studio copy is mapped to this local asset"
      )
    }
    return publicPromotion(localAssetId, row)
  }

  async resolveLocalPromotions(workspaceId: string, localAssetIds: string[]) {
    const parsed = localAssetIds.map(assertLocalAssetId)
    if (
      parsed.length < 1 ||
      parsed.length > 100 ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new MediaAssetError(
        "invalid_local_asset_ids",
        400,
        "Resolve requires 1-100 distinct local asset IDs"
      )
    }
    const placeholders = parsed.map((_, index) => `?${index + 2}`).join(", ")
    const rows = await this.db
      .prepare(
        `/* media:promotions-resolve */ SELECT ${qualifiedMediaAssetColumns("assets")},
                promotions.local_asset_id
         FROM media_asset_local_promotions promotions
         JOIN media_assets assets
           ON assets.workspace_id = promotions.workspace_id
          AND assets.id = promotions.asset_id
         WHERE promotions.workspace_id = ?1
           AND promotions.local_asset_id IN (${placeholders})`
      )
      .bind(workspaceId, ...parsed)
      .all<LocalPromotionRow>()
    const byId = new Map(rows.results.map((row) => [row.local_asset_id, row]))
    return parsed.map((localAssetId) => {
      const row = byId.get(localAssetId)
      return {
        localAssetId,
        promotion: row ? publicPromotion(localAssetId, row) : null,
      }
    })
  }

  private promotionMappingStatement(
    workspaceId: string,
    localAssetId: string,
    assetId: string,
    principalId: string,
    now: string
  ) {
    return this.db
      .prepare(
        `/* media:promotion-insert */ INSERT INTO media_asset_local_promotions
         (workspace_id, local_asset_id, asset_id, created_at, updated_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)`
      )
      .bind(workspaceId, localAssetId, assetId, now, principalId)
  }

  private async restoreArchivedPromotion(
    workspaceId: string,
    localAssetId: string,
    row: MediaAssetRow,
    upload: ValidatedMediaUpload,
    idempotencyKey: string,
    requestHash: string,
    principalId: string,
    mappingExists: boolean,
    requestExists: boolean
  ): Promise<MediaAssetPromotionResult> {
    await this.ensureStoredUpload(row, upload)
    const now = this.now()
    const statements = [
      this.db
        .prepare(
          `/* media:promotion-restore */ UPDATE media_assets
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
      ...(!mappingExists
        ? [
            this.promotionMappingStatement(
              workspaceId,
              localAssetId,
              row.id,
              principalId,
              now
            ),
          ]
        : []),
      ...(!requestExists
        ? [
            this.uploadRequestStatement(
              workspaceId,
              idempotencyKey,
              requestHash,
              row.id,
              now
            ),
          ]
        : []),
    ]
    let results: D1Result<unknown>[]
    try {
      results = await this.db.batch(statements)
    } catch (error) {
      const raced = await this.promotionRow(workspaceId, localAssetId)
      if (raced && raced.content_hash !== upload.contentHash) {
        throw new MediaAssetError(
          "local_asset_alias_conflict",
          409,
          "This local asset ID is already mapped to different image bytes"
        )
      }
      if (!raced) throw error
      await this.ensurePromotionRequest(
        workspaceId,
        idempotencyKey,
        requestHash,
        raced.id
      )
      return {
        promotion: publicPromotion(localAssetId, raced),
        storageDeltaBytes: 0,
      }
    }
    if (
      !batchChangesMatch(
        results,
        statements.map(() => 1)
      )
    ) {
      const reconciledMapping = await this.promotionRow(
        workspaceId,
        localAssetId
      )
      const reconciledRequest = await this.uploadRequestRow(
        workspaceId,
        idempotencyKey
      )
      if (
        !reconciledMapping ||
        reconciledMapping.content_hash !== upload.contentHash ||
        !reconciledRequest
      ) {
        throw new Error("media_asset_promotion_restore_incomplete")
      }
      this.assertPromotionRequest(
        reconciledRequest,
        requestHash,
        reconciledMapping.id
      )
      return {
        promotion: publicPromotion(localAssetId, reconciledMapping),
        storageDeltaBytes: 0,
      }
    }
    const restored = await this.promotionRow(workspaceId, localAssetId)
    const restoredRequest = await this.uploadRequestRow(
      workspaceId,
      idempotencyKey
    )
    if (
      !restored ||
      restored.content_hash !== upload.contentHash ||
      !restoredRequest
    ) {
      throw new Error("media_asset_promotion_restore_unreadable")
    }
    this.assertPromotionRequest(restoredRequest, requestHash, restored.id)
    return {
      promotion: publicPromotion(localAssetId, restored),
      storageDeltaBytes: 0,
    }
  }

  async promoteLocalAsset(
    workspaceId: string,
    localAssetIdInput: string,
    upload: ValidatedMediaUpload,
    idempotencyKey: string,
    principalId: string
  ): Promise<MediaAssetPromotionResult> {
    const localAssetId = assertLocalAssetId(localAssetIdInput)
    const requestHash = await promotionRequestHash(
      localAssetId,
      upload.requestHash
    )
    const idempotent = await this.uploadRequestRow(workspaceId, idempotencyKey)
    if (idempotent) this.assertPromotionRequest(idempotent, requestHash)

    const mapped = await this.promotionRow(workspaceId, localAssetId)
    if (mapped && mapped.content_hash !== upload.contentHash) {
      throw new MediaAssetError(
        "local_asset_alias_conflict",
        409,
        "This local asset ID is already mapped to different image bytes"
      )
    }
    if (mapped) {
      if (idempotent && idempotent.id !== mapped.id) {
        throw new MediaAssetError(
          "idempotency_key_reused",
          409,
          "Idempotency-Key resolved to another managed asset"
        )
      }
      if (mapped.status === "archived") {
        return this.restoreArchivedPromotion(
          workspaceId,
          localAssetId,
          mapped,
          upload,
          idempotencyKey,
          requestHash,
          principalId,
          true,
          Boolean(idempotent)
        )
      }
      await this.ensureStoredUpload(mapped, upload)
      await this.ensurePromotionRequest(
        workspaceId,
        idempotencyKey,
        requestHash,
        mapped.id
      )
      const latest = await this.promotionRow(workspaceId, localAssetId)
      if (!latest) throw new Error("media_asset_promotion_unreadable")
      return {
        promotion: publicPromotion(localAssetId, latest),
        storageDeltaBytes: 0,
      }
    }

    const duplicate = await this.db
      .prepare(
        `/* media:hash-get */ SELECT ${mediaAssetColumns}
         FROM media_assets WHERE workspace_id = ?1 AND content_hash = ?2`
      )
      .bind(workspaceId, upload.contentHash)
      .first<MediaAssetRow>()
    if (duplicate?.status === "archived") {
      return this.restoreArchivedPromotion(
        workspaceId,
        localAssetId,
        duplicate,
        upload,
        idempotencyKey,
        requestHash,
        principalId,
        false,
        Boolean(idempotent)
      )
    }
    if (duplicate?.status === "ready") {
      await this.ensureStoredUpload(duplicate, upload)
      const now = this.now()
      const statements = [
        this.promotionMappingStatement(
          workspaceId,
          localAssetId,
          duplicate.id,
          principalId,
          now
        ),
        ...(!idempotent
          ? [
              this.uploadRequestStatement(
                workspaceId,
                idempotencyKey,
                requestHash,
                duplicate.id,
                now
              ),
            ]
          : []),
      ]
      let adoptionResults: D1Result<unknown>[] | null = null
      try {
        adoptionResults = await this.db.batch(statements)
      } catch (error) {
        const raced = await this.promotionRow(workspaceId, localAssetId)
        if (raced && raced.content_hash !== upload.contentHash) {
          throw new MediaAssetError(
            "local_asset_alias_conflict",
            409,
            "This local asset ID is already mapped to different image bytes"
          )
        }
        if (!raced) throw error
      }
      if (adoptionResults) {
        exactBatchChanges(
          adoptionResults,
          statements.map(() => 1),
          "media_asset_promotion_adoption_incomplete"
        )
      }
      const adopted = await this.promotionRow(workspaceId, localAssetId)
      if (!adopted) throw new Error("media_asset_promotion_adoption_unreadable")
      await this.ensurePromotionRequest(
        workspaceId,
        idempotencyKey,
        requestHash,
        adopted.id
      )
      return {
        promotion: publicPromotion(localAssetId, adopted),
        storageDeltaBytes: 0,
      }
    }

    const id = this.createId()
    assertMediaAssetId(id)
    const r2Key = managedUploadR2Key(workspaceId, upload.contentHash)
    await this.bucket.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.mediaType },
      sha256: upload.contentHash,
    })
    const now = this.now()
    const statements = [
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
      this.promotionMappingStatement(
        workspaceId,
        localAssetId,
        id,
        principalId,
        now
      ),
      this.uploadRequestStatement(
        workspaceId,
        idempotencyKey,
        requestHash,
        id,
        now
      ),
    ]
    let wroteNewAsset = false
    let writeResults: D1Result<unknown>[] | null = null
    try {
      writeResults = await this.db.batch(statements)
    } catch (error) {
      // The immutable content key may now be shared by a concurrent winner.
      // Never delete it. Reconcile exact request and alias identity once.
      const racedRequest = await this.uploadRequestRow(
        workspaceId,
        idempotencyKey
      )
      if (racedRequest) this.assertPromotionRequest(racedRequest, requestHash)
      let racedMapping = await this.promotionRow(workspaceId, localAssetId)
      if (!racedMapping) {
        const racedAsset = await this.db
          .prepare(
            `/* media:hash-get */ SELECT ${mediaAssetColumns}
             FROM media_assets WHERE workspace_id = ?1 AND content_hash = ?2`
          )
          .bind(workspaceId, upload.contentHash)
          .first<MediaAssetRow>()
        if (racedAsset) {
          const adoptionNow = this.now()
          const adoption = [
            this.promotionMappingStatement(
              workspaceId,
              localAssetId,
              racedAsset.id,
              principalId,
              adoptionNow
            ),
            ...(!racedRequest
              ? [
                  this.uploadRequestStatement(
                    workspaceId,
                    idempotencyKey,
                    requestHash,
                    racedAsset.id,
                    adoptionNow
                  ),
                ]
              : []),
          ]
          let adoptionResults: D1Result<unknown>[] | null = null
          try {
            adoptionResults = await this.db.batch(adoption)
          } catch {
            // One bounded adoption attempt is enough. The exact mapping read
            // below is the race authority.
          }
          if (adoptionResults) {
            exactBatchChanges(
              adoptionResults,
              adoption.map(() => 1),
              "media_asset_promotion_race_adoption_incomplete"
            )
          }
          racedMapping = await this.promotionRow(workspaceId, localAssetId)
        }
      }
      if (racedMapping?.content_hash !== upload.contentHash) {
        if (racedMapping) {
          throw new MediaAssetError(
            "local_asset_alias_conflict",
            409,
            "This local asset ID is already mapped to different image bytes"
          )
        }
        throw error
      }
    }
    if (writeResults) {
      exactBatchChanges(
        writeResults,
        [1, 1, 1],
        "media_asset_promotion_write_incomplete"
      )
      wroteNewAsset = true
    }
    const committed = await this.promotionRow(workspaceId, localAssetId)
    if (!committed) throw new Error("media_asset_promotion_write_unreadable")
    await this.ensurePromotionRequest(
      workspaceId,
      idempotencyKey,
      requestHash,
      committed.id
    )
    return {
      promotion: publicPromotion(localAssetId, committed),
      storageDeltaBytes: wroteNewAsset ? upload.byteLength : 0,
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

  async markUsed(
    workspaceId: string,
    assetIdInput: string,
    idempotencyKeyInput: string
  ): Promise<MediaAssetUseResult> {
    const assetId = assertMediaAssetId(assetIdInput)
    const idempotencyKey = assertMediaIdempotencyKey(idempotencyKeyInput)
    if (!idempotencyKey) {
      throw new MediaAssetError(
        "invalid_idempotency_key",
        400,
        "Marking an asset used requires Idempotency-Key"
      )
    }
    const requestHash = await useRequestHash(assetId)
    const replay = await this.useRequestRow(workspaceId, idempotencyKey)
    if (replay) return this.useReceipt(replay, requestHash, assetId)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.row(workspaceId, assetId)
      if (!current) {
        throw new MediaAssetError(
          "asset_not_found",
          404,
          "Asset was not found in this workspace"
        )
      }
      const now = this.now()
      const statements = [
        this.db
          .prepare(
            `/* media:mark-used */ UPDATE media_assets
             SET last_used_at = ?3, updated_at = ?3, revision = revision + 1
             WHERE workspace_id = ?1 AND id = ?2
               AND status IN ('ready', 'archived')`
          )
          .bind(workspaceId, assetId, now),
        this.db
          .prepare(
            `/* media:use-request-insert */ INSERT INTO media_asset_use_requests
             (workspace_id, idempotency_key, request_hash, asset_id,
              used_at, result_revision, created_at)
             SELECT ?1, ?2, ?3, id, ?5, revision, ?5
             FROM media_assets
             WHERE workspace_id = ?1 AND id = ?4
               AND status IN ('ready', 'archived')`
          )
          .bind(workspaceId, idempotencyKey, requestHash, assetId, now),
      ]
      let results: D1Result<unknown>[] | null = null
      let writeError: unknown = null
      try {
        results = await this.db.batch(statements)
      } catch (error) {
        writeError = error
      }

      const committed = await this.useRequestRow(workspaceId, idempotencyKey)
      if (committed) return this.useReceipt(committed, requestHash, assetId)
      if (writeError && attempt === 1) throw writeError
      if (results && batchChangesMatch(results, [1, 1]) && attempt === 1) {
        throw new Error("media_asset_use_receipt_unreadable")
      }
    }
    throw new Error("media_asset_use_request_incomplete")
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
