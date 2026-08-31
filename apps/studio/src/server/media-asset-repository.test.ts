import { describe, expect, it } from "vitest"
import {
  ManagedMediaLibraryCatalogRepository,
  MediaAssetRepository,
} from "./media-asset-repository"
import { validateMediaUpload } from "./media-assets"

type Row = Record<string, unknown>

const png1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
)

class FakeD1Statement {
  private values: unknown[] = []

  constructor(
    readonly query: string,
    private readonly state: FakeD1
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this as unknown as D1PreparedStatement
  }

  async first<T>() {
    const rows = this.rows()
    return (rows[0] ?? null) as T | null
  }

  async all<T>() {
    return { results: this.rows() as T[] } as D1Result<T>
  }

  async run<T>() {
    const changes = this.mutate()
    return { meta: { changes }, results: [] } as unknown as D1Result<T>
  }

  private rows(): Row[] {
    const marker = this.query.match(/\/\* (media:[^ ]+) \*\//)?.[1]
    const [workspaceId, second] = this.values as [string, string]
    if (marker === "media:get") {
      return this.state.assets.filter(
        (asset) => asset.workspace_id === workspaceId && asset.id === second
      )
    }
    if (marker === "media:catalog-get") {
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId && candidate.id === second
      )
      return asset ? [this.state.catalogRow(asset)] : []
    }
    if (marker === "media:catalog-revision") {
      const revision = this.state.catalogRevisions.get(workspaceId)
      return revision === undefined ? [] : [{ revision }]
    }
    if (marker === "media:library-catalog-revision") {
      const revision = this.state.catalogRevisions.get(workspaceId)
      return revision === undefined ? [] : [{ revision }]
    }
    if (marker === "media:library-catalog-snapshot") {
      const limit = Number(second)
      return this.state.assets
        .filter(
          (asset) =>
            asset.workspace_id === workspaceId && asset.status === "ready"
        )
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(0, limit)
        .map((asset) => this.state.catalogRow(asset))
    }
    if (marker === "media:library-catalog-exact") {
      const catalogVersion = Number(this.values[2])
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === second &&
          candidate.status === "ready"
      )
      if (!asset) return []
      const row = this.state.catalogRow(asset)
      return Number(row.catalog_version) === catalogVersion ? [row] : []
    }
    if (marker === "media:hash-get") {
      return this.state.assets.filter(
        (asset) =>
          asset.workspace_id === workspaceId && asset.content_hash === second
      )
    }
    if (marker === "media:idempotency-get") {
      const request = this.state.requests.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.idempotency_key === second
      )
      const asset = this.state.assets.find(
        (candidate) => candidate.id === request?.asset_id
      )
      return request && asset
        ? [{ ...asset, request_hash: request.request_hash }]
        : []
    }
    if (marker === "media:idempotency-hash") {
      return this.state.requests.filter(
        (request) =>
          request.workspace_id === workspaceId &&
          request.idempotency_key === second
      )
    }
    if (marker === "media:use-request-get") {
      return this.state.useRequests.filter(
        (request) =>
          request.workspace_id === workspaceId &&
          request.idempotency_key === second
      )
    }
    if (marker === "media:promotion-get") {
      const promotion = this.state.promotions.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.local_asset_id === second
      )
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === promotion?.asset_id
      )
      return promotion && asset
        ? [{ ...asset, local_asset_id: promotion.local_asset_id }]
        : []
    }
    if (marker === "media:promotions-resolve") {
      const ids = new Set(this.values.slice(1))
      return this.state.promotions.flatMap((promotion) => {
        if (
          promotion.workspace_id !== workspaceId ||
          !ids.has(promotion.local_asset_id)
        ) {
          return []
        }
        const asset = this.state.assets.find(
          (candidate) =>
            candidate.workspace_id === workspaceId &&
            candidate.id === promotion.asset_id
        )
        return asset
          ? [{ ...asset, local_asset_id: promotion.local_asset_id }]
          : []
      })
    }
    if (marker === "media:storage") {
      const assets = this.state.assets.filter(
        (asset) => asset.workspace_id === workspaceId
      )
      return [
        {
          bytes: assets.reduce((sum, asset) => sum + Number(asset.bytes), 0),
          count: assets.length,
        },
      ]
    }
    if (marker === "media:list") {
      const [, query, , cursorSort, cursorId, limit] = this.values as [
        string,
        string,
        string,
        string | null,
        string | null,
        number,
      ]
      const sort = this.query.includes("last_used_at <")
        ? "last_used_at"
        : "created_at"
      return this.state.assets
        .filter((asset) => {
          const catalog = this.state.catalogRow(asset)
          const searchable = [
            asset.name,
            catalog.catalog_description,
            catalog.catalog_tags_json,
            catalog.catalog_category_id,
            catalog.catalog_use_case_ids_json,
            catalog.catalog_provenance_source_name,
            catalog.catalog_license_name,
          ]
            .join(" ")
            .toLowerCase()
          return (
            asset.workspace_id === workspaceId &&
            asset.status === "ready" &&
            (!query || searchable.includes(query)) &&
            (!cursorSort ||
              String(asset[sort]) < cursorSort ||
              (asset[sort] === cursorSort &&
                String(asset.id) < String(cursorId)))
          )
        })
        .sort(
          (left, right) =>
            String(right[sort]).localeCompare(String(left[sort])) ||
            String(right.id).localeCompare(String(left.id))
        )
        .slice(0, limit)
        .map((asset) => this.state.catalogRow(asset))
    }
    if (marker === "media:references") {
      return this.state.references
        .filter(
          (reference) =>
            reference.workspace_id === workspaceId &&
            reference.asset_id === second
        )
        .sort((left, right) =>
          `${left.reference_kind}:${left.source_id}:${left.reference_key}`.localeCompare(
            `${right.reference_kind}:${right.source_id}:${right.reference_key}`
          )
        )
    }
    return []
  }

  mutate() {
    const marker = this.query.match(/\/\* (media:[^ ]+) \*\//)?.[1]
    if (marker === "media:insert") {
      const [
        id,
        workspaceId,
        name,
        mediaType,
        bytes,
        width,
        height,
        contentHash,
        r2Key,
        now,
      ] = this.values
      if (
        this.state.assets.some(
          (asset) =>
            asset.id === id ||
            (asset.workspace_id === workspaceId &&
              asset.content_hash === contentHash)
        )
      ) {
        throw new Error("UNIQUE constraint failed")
      }
      this.state.assets.push({
        id,
        workspace_id: workspaceId,
        name,
        media_type: mediaType,
        bytes,
        width,
        height,
        content_hash: contentHash,
        r2_key: r2Key,
        status: "ready",
        revision: 1,
        created_at: now,
        updated_at: now,
        last_used_at: now,
      })
      this.state.catalogMetadata.push(
        this.state.defaultCatalogMetadata(
          String(workspaceId),
          String(id),
          String(now)
        )
      )
      this.state.bumpCatalogRevision(String(workspaceId))
      return 1
    }
    if (marker === "media:idempotency-insert") {
      const [workspaceId, key, requestHash, assetId, now] = this.values
      if (this.state.skipPromotionRequestMutation) {
        this.state.skipPromotionRequestMutation = false
        return 1
      }
      if (
        this.state.requests.some(
          (request) =>
            request.workspace_id === workspaceId &&
            request.idempotency_key === key
        )
      ) {
        throw new Error("UNIQUE constraint failed")
      }
      this.state.requests.push({
        workspace_id: workspaceId,
        idempotency_key: key,
        request_hash: requestHash,
        asset_id: assetId,
        created_at: now,
      })
      return 1
    }
    if (marker === "media:promotion-insert") {
      const [workspaceId, localAssetId, assetId, now, principalId] = this.values
      if (
        this.state.promotions.some(
          (promotion) =>
            promotion.workspace_id === workspaceId &&
            promotion.local_asset_id === localAssetId
        )
      ) {
        throw new Error("UNIQUE constraint failed")
      }
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId && candidate.id === assetId
      )
      if (!asset) throw new Error("FOREIGN KEY constraint failed")
      this.state.promotions.push({
        workspace_id: workspaceId,
        local_asset_id: localAssetId,
        asset_id: assetId,
        created_at: now,
        updated_at: now,
        created_by: principalId,
      })
      return 1
    }
    if (marker === "media:mark-used") {
      const [workspaceId, id, now] = this.values
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === id &&
          (candidate.status === "ready" || candidate.status === "archived")
      )
      if (!asset) return 0
      asset.last_used_at = now
      asset.updated_at = now
      asset.revision = Number(asset.revision) + 1
      return 1
    }
    if (marker === "media:use-request-insert") {
      const [workspaceId, key, requestHash, assetId, now] = this.values
      if (
        this.state.useRequests.some(
          (request) =>
            request.workspace_id === workspaceId &&
            request.idempotency_key === key
        )
      ) {
        throw new Error("UNIQUE constraint failed")
      }
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === assetId &&
          (candidate.status === "ready" || candidate.status === "archived")
      )
      if (!asset) return 0
      this.state.useRequests.push({
        workspace_id: workspaceId,
        idempotency_key: key,
        request_hash: requestHash,
        asset_id: assetId,
        used_at: now,
        result_revision: asset.revision,
        created_at: now,
      })
      return 1
    }
    if (marker === "media:restore") {
      const [workspaceId, id, name, mediaType, bytes, width, height, now] =
        this.values
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === id &&
          candidate.status === "archived"
      )
      if (!asset) return 0
      asset.status = "ready"
      asset.name = name
      asset.media_type = mediaType
      asset.bytes = bytes
      asset.width = width
      asset.height = height
      asset.updated_at = now
      asset.last_used_at = now
      asset.archived_at = null
      asset.revision = Number(asset.revision) + 1
      this.state.bumpCatalogIdentity(
        String(workspaceId),
        String(id),
        String(now)
      )
      return 1
    }
    if (marker === "media:promotion-restore") {
      const [workspaceId, id, name, mediaType, bytes, width, height, now] =
        this.values
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === id &&
          candidate.status === "archived"
      )
      if (!asset) return 0
      asset.status = "ready"
      asset.name = name
      asset.media_type = mediaType
      asset.bytes = bytes
      asset.width = width
      asset.height = height
      asset.updated_at = now
      asset.last_used_at = now
      asset.archived_at = null
      asset.revision = Number(asset.revision) + 1
      this.state.bumpCatalogIdentity(
        String(workspaceId),
        String(id),
        String(now)
      )
      return 1
    }
    if (marker === "media:archive") {
      const [workspaceId, id, revision, now] = this.values
      const hasReferences = this.state.references.some(
        (reference) =>
          reference.workspace_id === workspaceId && reference.asset_id === id
      )
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === id &&
          candidate.status === "ready" &&
          candidate.revision === revision
      )
      if (!asset || hasReferences) return 0
      asset.status = "archived"
      asset.archived_at = now
      asset.updated_at = now
      asset.revision = Number(asset.revision) + 1
      this.state.bumpCatalogIdentity(
        String(workspaceId),
        String(id),
        String(now)
      )
      return 1
    }
    if (marker === "media:catalog-update") {
      const [
        workspaceId,
        assetId,
        expectedVersion,
        description,
        tagsJson,
        categoryId,
        useCaseIdsJson,
        sourceName,
        sourceUrl,
        licenseId,
        licenseName,
        licenseUrl,
        attributionRequired,
        attributionText,
        now,
      ] = this.values
      const metadata = this.state.catalogMetadata.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.asset_id === assetId &&
          candidate.catalog_version === expectedVersion
      )
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === assetId &&
          candidate.status === "ready"
      )
      if (!metadata || !asset) return 0
      Object.assign(metadata, {
        description,
        tags_json: tagsJson,
        category_id: categoryId,
        use_case_ids_json: useCaseIdsJson,
        provenance_source_name: sourceName,
        provenance_source_url: sourceUrl,
        license_id: licenseId,
        license_name: licenseName,
        license_url: licenseUrl,
        attribution_required: attributionRequired,
        attribution_text: attributionText,
        catalog_version: Number(metadata.catalog_version) + 1,
        updated_at: now,
      })
      this.state.bumpCatalogRevision(String(workspaceId))
      return 1
    }
    return 0
  }
}

class FakeD1 {
  assets: Row[] = []
  requests: Row[] = []
  useRequests: Row[] = []
  promotions: Row[] = []
  references: Row[] = []
  catalogMetadata: Row[] = []
  catalogRevisions = new Map<string, number>()
  batchFailure: Error | (() => Error) | null = null
  batchFailureAfterMutation: Error | (() => Error) | null = null
  batchResultChanges: number[] | null = null
  skipPromotionRequestMutation = false
  archiveAssetBeforeBatch: string | null = null
  archiveAssetAfterBatch: string | null = null

  prepare(query: string) {
    return new FakeD1Statement(query, this) as unknown as D1PreparedStatement
  }

  defaultCatalogMetadata(workspaceId: string, assetId: string, now: string) {
    return {
      workspace_id: workspaceId,
      asset_id: assetId,
      description: "Customer-provided workspace upload",
      tags_json: "[]",
      category_id: "workspace-upload",
      use_case_ids_json: "[]",
      provenance_source_name: "Workspace upload",
      provenance_source_url: null,
      license_id: "customer-provided",
      license_name: "Customer-provided; rights not verified",
      license_url: null,
      attribution_required: 0,
      attribution_text: null,
      catalog_version: 1,
      created_at: now,
      updated_at: now,
    }
  }

  catalogRow(asset: Row) {
    const metadata =
      this.catalogMetadata.find(
        (candidate) =>
          candidate.workspace_id === asset.workspace_id &&
          candidate.asset_id === asset.id
      ) ??
      this.defaultCatalogMetadata(
        String(asset.workspace_id),
        String(asset.id),
        String(asset.created_at)
      )
    return {
      ...asset,
      catalog_description: metadata.description,
      catalog_tags_json: metadata.tags_json,
      catalog_category_id: metadata.category_id,
      catalog_use_case_ids_json: metadata.use_case_ids_json,
      catalog_provenance_source_name: metadata.provenance_source_name,
      catalog_provenance_source_url: metadata.provenance_source_url,
      catalog_license_id: metadata.license_id,
      catalog_license_name: metadata.license_name,
      catalog_license_url: metadata.license_url,
      catalog_attribution_required: metadata.attribution_required,
      catalog_attribution_text: metadata.attribution_text,
      catalog_version: metadata.catalog_version,
      catalog_created_at: metadata.created_at,
      catalog_updated_at: metadata.updated_at,
    }
  }

  bumpCatalogRevision(workspaceId: string) {
    this.catalogRevisions.set(
      workspaceId,
      (this.catalogRevisions.get(workspaceId) ?? 0) + 1
    )
  }

  bumpCatalogIdentity(workspaceId: string, assetId: string, now: string) {
    const metadata = this.catalogMetadata.find(
      (candidate) =>
        candidate.workspace_id === workspaceId && candidate.asset_id === assetId
    )
    if (metadata) {
      metadata.catalog_version = Number(metadata.catalog_version) + 1
      metadata.updated_at = now
    }
    this.bumpCatalogRevision(workspaceId)
  }

  async batch<T>(statements: D1PreparedStatement[]) {
    if (this.batchFailure) {
      const failure = this.batchFailure
      this.batchFailure = null
      throw typeof failure === "function" ? failure() : failure
    }
    if (this.archiveAssetBeforeBatch) {
      const asset = this.assets.find(
        (candidate) => candidate.id === this.archiveAssetBeforeBatch
      )
      this.archiveAssetBeforeBatch = null
      if (asset) {
        const archivedAt = "2026-08-28T00:09:00.000Z"
        asset.status = "archived"
        asset.archived_at = archivedAt
        asset.updated_at = archivedAt
        asset.revision = Number(asset.revision) + 1
        this.bumpCatalogIdentity(
          String(asset.workspace_id),
          String(asset.id),
          archivedAt
        )
      }
    }
    const snapshot = structuredClone({
      assets: this.assets,
      requests: this.requests,
      useRequests: this.useRequests,
      promotions: this.promotions,
      references: this.references,
      catalogMetadata: this.catalogMetadata,
      catalogRevisions: [...this.catalogRevisions],
    })
    const results: D1Result<T>[] = []
    try {
      for (const statement of statements) {
        const fakeStatement = statement as unknown as FakeD1Statement
        results.push(
          /\/\* media:(?:catalog-get|list|storage|catalog-revision|library-catalog-snapshot|library-catalog-revision) \*\//.test(
            fakeStatement.query
          )
            ? await fakeStatement.all<T>()
            : await fakeStatement.run<T>()
        )
      }
    } catch (error) {
      this.assets = snapshot.assets
      this.requests = snapshot.requests
      this.useRequests = snapshot.useRequests
      this.promotions = snapshot.promotions
      this.references = snapshot.references
      this.catalogMetadata = snapshot.catalogMetadata
      this.catalogRevisions = new Map(snapshot.catalogRevisions)
      throw error
    }
    if (this.batchFailureAfterMutation) {
      const failure = this.batchFailureAfterMutation
      this.batchFailureAfterMutation = null
      throw typeof failure === "function" ? failure() : failure
    }
    if (this.archiveAssetAfterBatch) {
      const asset = this.assets.find(
        (candidate) => candidate.id === this.archiveAssetAfterBatch
      )
      this.archiveAssetAfterBatch = null
      if (asset) {
        const archivedAt = "2026-08-28T00:10:00.000Z"
        asset.status = "archived"
        asset.archived_at = archivedAt
        asset.updated_at = archivedAt
        asset.revision = Number(asset.revision) + 1
        this.bumpCatalogIdentity(
          String(asset.workspace_id),
          String(asset.id),
          archivedAt
        )
      }
    }
    if (this.batchResultChanges) {
      const changes = this.batchResultChanges
      this.batchResultChanges = null
      return results.map((result, index) => ({
        ...result,
        meta: {
          ...result.meta,
          changes: changes[index] ?? result.meta.changes,
        },
      }))
    }
    return results
  }
}

class FakeR2 {
  objects = new Map<string, Uint8Array>()
  deleted: string[] = []
  putKeys: string[] = []

  async put(key: string, value: Uint8Array) {
    this.putKeys.push(key)
    this.objects.set(key, Uint8Array.from(value))
    return { key } as unknown as R2Object
  }

  async get(key: string) {
    const bytes = this.objects.get(key)
    if (!bytes) return null
    const body = new Response(Uint8Array.from(bytes).buffer).body
    return {
      body,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    } as unknown as R2ObjectBody
  }

  async delete(key: string) {
    this.deleted.push(key)
    this.objects.delete(key)
  }
}

const validatedUpload = (name = "portrait.png") =>
  validateMediaUpload(
    Object.assign(new Blob([png1x1], { type: "image/png" }), { name })
  )

const repositoryFixture = () => {
  const db = new FakeD1()
  const r2 = new FakeR2()
  let id = 0
  let tick = 0
  const repository = new MediaAssetRepository(
    db as unknown as D1Database,
    r2 as unknown as R2Bucket,
    {
      createId: () => `asset-0000000000000000000000000000000${++id}`,
      now: () => `2026-08-28T00:00:0${tick++}.000Z`,
    }
  )
  return { db, r2, repository }
}

describe("MediaAssetRepository", () => {
  it("retains a deterministic object after a D1 failure and reuses it on retry", async () => {
    const { db, r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    db.batchFailure = new Error("D1 unavailable")

    await expect(
      repository.upload("workspace-a", upload, "cleanup-retry-1")
    ).rejects.toThrow("D1 unavailable")
    expect(r2.objects.size).toBe(1)
    expect(r2.deleted).toEqual([])
    const retainedKey = [...r2.objects.keys()][0]

    await expect(
      repository.upload("workspace-a", upload, "cleanup-retry-1")
    ).resolves.toMatchObject({ created: true })
    expect(r2.objects.size).toBe(1)
    expect([...r2.objects.keys()]).toEqual([retainedKey])
    expect(r2.putKeys).toEqual([retainedKey, retainedKey])
  })

  it("does not delete a shared content object when an idempotency race loses", async () => {
    const { db, r2, repository } = repositoryFixture()
    const loser = await validatedUpload("loser.png")
    const winner = await validatedUpload("winner.png")

    db.batchFailure = () => {
      const r2Key = r2.putKeys.at(-1)
      if (!r2Key) throw new Error("Expected the content object before D1")
      db.assets.push({
        id: "asset-0000000000000000000000000000999",
        workspace_id: "workspace-a",
        name: winner.name,
        media_type: winner.mediaType,
        bytes: winner.byteLength,
        width: winner.width,
        height: winner.height,
        content_hash: winner.contentHash,
        r2_key: r2Key,
        status: "ready",
        revision: 1,
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
        last_used_at: "2026-08-28T00:00:00.000Z",
      })
      db.requests.push({
        workspace_id: "workspace-a",
        idempotency_key: "shared-request-key",
        request_hash: winner.requestHash,
        asset_id: "asset-0000000000000000000000000000999",
        created_at: "2026-08-28T00:00:00.000Z",
      })
      return new Error("UNIQUE constraint failed")
    }

    await expect(
      repository.upload("workspace-a", loser, "shared-request-key")
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })

    const winnerKey = String(db.assets[0]?.r2_key)
    expect(r2.deleted).toEqual([])
    expect(r2.objects.get(winnerKey)).toEqual(png1x1)
    await expect(r2.get(winnerKey)).resolves.not.toBeNull()
  })

  it("writes private content and returns only public metadata", async () => {
    const { db, r2, repository } = repositoryFixture()
    const result = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      "upload-1"
    )
    expect(result.created).toBe(true)
    expect(result.asset).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^asset-/),
        name: "portrait.png",
        mediaType: "image/png",
        width: 1,
        height: 1,
        status: "ready",
      })
    )
    expect(result.asset).not.toHaveProperty("r2Key")
    expect(result.asset).not.toHaveProperty("url")
    expect(result.asset).not.toHaveProperty("contentHash")
    expect(result.asset).not.toHaveProperty("revision")
    expect(r2.objects.size).toBe(1)
    expect(db.assets).toHaveLength(1)
  })

  it("deduplicates by content hash and enforces idempotency request identity", async () => {
    const { repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      "upload-1"
    )
    const replay = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      "upload-1"
    )
    const duplicate = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      "upload-2"
    )
    expect(replay).toEqual({ asset: first.asset, created: false })
    expect(duplicate).toEqual({ asset: first.asset, created: false })
    await expect(
      repository.upload(
        "workspace-a",
        await validatedUpload("different-name.png"),
        "upload-1"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
  })

  it.each(["missing", "corrupt"] as const)(
    "repairs %s R2 content before returning a ready duplicate",
    async (failure) => {
      const { db, r2, repository } = repositoryFixture()
      const validated = await validatedUpload()
      const first = await repository.upload(
        "workspace-a",
        validated,
        "upload-ready"
      )
      const key = String(db.assets[0]?.r2_key)
      if (failure === "missing") r2.objects.delete(key)
      else r2.objects.set(key, Uint8Array.from([1, 2, 3]))

      await expect(
        repository.upload("workspace-a", validated, "upload-ready")
      ).resolves.toEqual({ asset: first.asset, created: false })
      expect(r2.objects.get(key)).toEqual(png1x1)
      expect(r2.putKeys.filter((candidate) => candidate === key)).toHaveLength(
        2
      )
    }
  )

  it.each(["missing", "corrupt"] as const)(
    "repairs %s R2 content before restoring an archived duplicate",
    async (failure) => {
      const { db, r2, repository } = repositoryFixture()
      const validated = await validatedUpload()
      const first = await repository.upload(
        "workspace-a",
        validated,
        "upload-archived"
      )
      const row = db.assets[0]
      row.status = "archived"
      row.archived_at = "2026-08-28T00:01:00.000Z"
      const key = String(row.r2_key)
      if (failure === "missing") r2.objects.delete(key)
      else r2.objects.set(key, Uint8Array.from([9, 8, 7]))

      const restored = await repository.upload(
        "workspace-a",
        validated,
        "upload-archived"
      )
      expect(restored).toMatchObject({
        created: false,
        asset: { id: first.asset.id, status: "ready" },
      })
      expect(row.status).toBe("ready")
      expect(r2.objects.get(key)).toEqual(png1x1)
      expect(r2.putKeys.filter((candidate) => candidate === key)).toHaveLength(
        2
      )
    }
  )

  it("lists only ready workspace-owned assets with stable cursor pagination and truthful Recent order", async () => {
    const { repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload("first.png"),
      null
    )
    await repository.upload(
      "workspace-b",
      await validatedUpload("private.png"),
      null
    )
    await repository.markUsed("workspace-a", first.asset.id, "recent-list-use")
    const list = await repository.list("workspace-a", {
      collection: "recent",
      query: "first",
      limit: 1,
      cursor: null,
    })
    expect(list.assets.map((asset) => asset.name)).toEqual(["first.png"])
    expect(list.storage).toEqual({ bytes: png1x1.length, count: 1 })
  })

  it("persists truthful managed catalog defaults and isolates exact metadata by workspace", async () => {
    const { repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )

    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).resolves.toMatchObject({
      asset: { id: first.asset.id, status: "ready" },
      metadata: {
        description: "Customer-provided workspace upload",
        tags: [],
        categoryId: "workspace-upload",
        useCaseIds: [],
        catalogVersion: 1,
        provenance: {
          sourceName: "Workspace upload",
          sourceUrl: null,
          license: {
            id: "customer-provided",
            name: "Customer-provided; rights not verified",
            url: null,
          },
          attribution: { required: false, text: null },
        },
      },
    })
    await expect(
      repository.lookupCatalogEntry("workspace-b", first.asset.id)
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    await expect(
      repository.updateCatalogMetadata("workspace-b", first.asset.id, 1, {
        tags: ["foreign"],
      })
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).resolves.toMatchObject({ metadata: { tags: [], catalogVersion: 1 } })
  })

  it("reads a bounded ready-only library snapshot and exact version under workspace authority", async () => {
    const { db, repository } = repositoryFixture()
    const catalog = new ManagedMediaLibraryCatalogRepository(
      db as unknown as D1Database
    )
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload("workspace-a.png"),
      null
    )
    const foreign = await repository.upload(
      "workspace-b",
      await validatedUpload("workspace-b.png"),
      null
    )

    await expect(catalog.readSnapshot("workspace-a")).resolves.toMatchObject({
      catalogRevision: 1,
      entries: [
        {
          asset: { id: first.asset.id, status: "ready" },
          metadata: { catalogVersion: 1 },
        },
      ],
    })
    await expect(
      catalog.getExact("workspace-a", first.asset.id, 1)
    ).resolves.toMatchObject({ asset: { id: first.asset.id } })
    await expect(
      catalog.getExact("workspace-a", first.asset.id, 2)
    ).resolves.toBeNull()
    await expect(
      catalog.getExact("workspace-a", foreign.asset.id, 1)
    ).resolves.toBeNull()
    await expect(
      catalog.getExact("workspace-a", "missing-curated-id", 1)
    ).resolves.toBeNull()

    const impact = await repository.deletionImpact(
      "workspace-a",
      first.asset.id
    )
    await repository.archive(
      "workspace-a",
      first.asset.id,
      impact.revision,
      impact.token
    )
    await expect(catalog.readSnapshot("workspace-a")).resolves.toMatchObject({
      catalogRevision: 2,
      entries: [],
    })
    await expect(
      catalog.getExact("workspace-a", first.asset.id, 2)
    ).resolves.toBeNull()
  })

  it("fails closed instead of silently truncating an oversized composed library", async () => {
    const { db } = repositoryFixture()
    const createdAt = "2026-08-28T00:00:00.000Z"
    for (let index = 0; index <= 1_000; index += 1) {
      const id = `asset-${String(index).padStart(32, "0")}`
      db.assets.push({
        id,
        workspace_id: "workspace-a",
        name: `Asset ${index}`,
        media_type: "image/png",
        bytes: png1x1.byteLength,
        width: 1,
        height: 1,
        content_hash: "a".repeat(64),
        r2_key: `private/${index}`,
        status: "ready",
        revision: 1,
        created_at: createdAt,
        updated_at: createdAt,
        last_used_at: createdAt,
      })
      db.catalogMetadata.push(
        db.defaultCatalogMetadata("workspace-a", id, createdAt)
      )
    }
    const catalog = new ManagedMediaLibraryCatalogRepository(
      db as unknown as D1Database
    )

    await expect(catalog.readSnapshot("workspace-a")).rejects.toMatchObject({
      code: "managed_media_library_catalog_capacity_exceeded",
    })
  })

  it("normalizes metadata, searches every catalog field, and rejects stale catalog writes", async () => {
    const { repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload("portrait.png"),
      null
    )
    const updated = await repository.updateCatalogMetadata(
      "workspace-a",
      first.asset.id,
      1,
      {
        description: "  Leadership   portrait for the annual report ",
        tags: ["Executive Team", "leadership", "executive-team"],
        categoryId: " People & Portraits ",
        useCaseIds: [" Annual Report ", "profile"],
      }
    )
    expect(updated.metadata).toMatchObject({
      description: "Leadership portrait for the annual report",
      tags: ["executive-team", "leadership"],
      categoryId: "people-portraits",
      useCaseIds: ["annual-report", "profile"],
      catalogVersion: 2,
    })

    for (const query of [
      "leadership portrait",
      "executive-team",
      "people-portraits",
      "annual-report",
      "workspace upload",
      "rights not verified",
    ]) {
      await expect(
        repository.listCatalog("workspace-a", {
          collection: "uploads",
          query,
          limit: 10,
          cursor: null,
        })
      ).resolves.toMatchObject({
        entries: [{ asset: { id: first.asset.id } }],
      })
    }
    await expect(
      repository.updateCatalogMetadata("workspace-a", first.asset.id, 1, {
        tags: ["stale"],
      })
    ).rejects.toMatchObject({
      code: "asset_catalog_version_mismatch",
      status: 412,
    })
  })

  it("returns the committed metadata snapshot when archive follows the atomic update batch", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.archiveAssetAfterBatch = first.asset.id

    await expect(
      repository.updateCatalogMetadata("workspace-a", first.asset.id, 1, {
        tags: ["approved"],
      })
    ).resolves.toMatchObject({
      asset: { id: first.asset.id, status: "ready" },
      metadata: { tags: ["approved"], catalogVersion: 2 },
    })
    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    expect(await repository.catalogRevision("workspace-a")).toBe(3)
  })

  it("returns a typed not-found outcome when archive wins before the metadata CAS batch", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.archiveAssetBeforeBatch = first.asset.id

    await expect(
      repository.updateCatalogMetadata("workspace-a", first.asset.id, 1, {
        tags: ["too-late"],
      })
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    expect(await repository.catalogRevision("workspace-a")).toBe(2)
  })

  it("keeps catalog identity and epoch separate from use revisions", async () => {
    const { repository } = repositoryFixture()
    const upload = await validatedUpload()
    const first = await repository.upload("workspace-a", upload, null)
    expect(await repository.catalogRevision("workspace-a")).toBe(1)

    await repository.markUsed("workspace-a", first.asset.id, "catalog-use-1")
    expect(await repository.catalogRevision("workspace-a")).toBe(1)
    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).resolves.toMatchObject({ metadata: { catalogVersion: 1 } })

    const changed = await repository.updateCatalogMetadata(
      "workspace-a",
      first.asset.id,
      1,
      { tags: ["portrait"] }
    )
    expect(changed.metadata.catalogVersion).toBe(2)
    expect(await repository.catalogRevision("workspace-a")).toBe(2)

    const unchanged = await repository.updateCatalogMetadata(
      "workspace-a",
      first.asset.id,
      2,
      { tags: ["portrait"] }
    )
    expect(unchanged.metadata.catalogVersion).toBe(2)
    expect(await repository.catalogRevision("workspace-a")).toBe(2)

    const impact = await repository.deletionImpact(
      "workspace-a",
      first.asset.id
    )
    await repository.archive(
      "workspace-a",
      first.asset.id,
      impact.revision,
      impact.token
    )
    expect(await repository.catalogRevision("workspace-a")).toBe(3)
    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).rejects.toMatchObject({ code: "asset_not_found" })

    await repository.upload("workspace-a", upload, null)
    expect(await repository.catalogRevision("workspace-a")).toBe(4)
    await expect(
      repository.lookupCatalogEntry("workspace-a", first.asset.id)
    ).resolves.toMatchObject({ metadata: { catalogVersion: 4 } })
  })

  it("does not advance the catalog epoch when references block archive", async () => {
    const { db, repository } = repositoryFixture()
    const { asset } = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.references.push({
      workspace_id: "workspace-a",
      asset_id: asset.id,
      reference_kind: "current_document",
      source_id: "document-1",
      reference_key: "node:cover:src",
      document_id: "document-1",
      page_id: "page-cover",
      node_id: "cover",
      field_id: null,
      property: "src",
    })
    const impact = await repository.deletionImpact("workspace-a", asset.id)
    await expect(
      repository.archive("workspace-a", asset.id, impact.revision, impact.token)
    ).rejects.toMatchObject({ code: "asset_referenced", status: 409 })
    expect(await repository.catalogRevision("workspace-a")).toBe(1)
  })

  it("marks Recent exactly once and replays the durable receipt", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )

    const receipt = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-1"
    )
    const replay = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-1"
    )

    expect(receipt).toEqual({
      assetId: first.asset.id,
      usedAt: "2026-08-28T00:00:01.000Z",
      assetRevision: 2,
    })
    expect(replay).toEqual(receipt)
    expect(db.assets[0]).toMatchObject({
      revision: 2,
      updated_at: receipt.usedAt,
      last_used_at: receipt.usedAt,
    })
    expect(db.useRequests).toHaveLength(1)
    expect(db.useRequests[0]?.request_hash).toBe(
      "2ffcb08745510fd707b3b56d7841ee5d8424c3cec985ba477e5c88222f39c69c"
    )
  })

  it("replays the original receipt after a later distinct use advances the asset", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    const original = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-original"
    )
    const later = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-later"
    )
    const replay = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-original"
    )

    expect(later).toMatchObject({ assetRevision: 3 })
    expect(replay).toEqual(original)
    expect(db.assets[0]).toMatchObject({
      revision: 3,
      last_used_at: later.usedAt,
      updated_at: later.usedAt,
    })
    expect(db.useRequests).toHaveLength(2)
  })

  it("rejects a use key replay for another asset without changing either asset", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    const secondId = "asset-0000000000000000000000000000999"
    db.assets.push({
      ...db.assets[0],
      id: secondId,
      content_hash: "b".repeat(64),
      r2_key: "media/workspaces/workspace-a/content/b/original",
    })
    await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "document-relink-use-conflict"
    )

    await expect(
      repository.markUsed(
        "workspace-a",
        secondId,
        "document-relink-use-conflict"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
    expect(db.assets.map((row) => row.revision)).toEqual([2, 1])
  })

  it("keeps use accounting workspace-scoped and retains archived state", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    await expect(
      repository.markUsed(
        "workspace-b",
        first.asset.id,
        "foreign-workspace-use"
      )
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    db.assets[0].status = "archived"
    await expect(
      repository.markUsed("workspace-a", first.asset.id, "archived-asset-use")
    ).resolves.toMatchObject({ assetId: first.asset.id, assetRevision: 2 })
    expect(db.assets[0]).toMatchObject({ status: "archived", revision: 2 })
    expect(db.useRequests).toHaveLength(1)
    await expect(
      repository.list("workspace-a", {
        collection: "recent",
        query: "",
        limit: 10,
        cursor: null,
      })
    ).resolves.toMatchObject({ assets: [] })
  })

  it("replays an archived committed-but-reported receipt without restoring or recounting", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.assets[0].status = "archived"
    db.batchFailureAfterMutation = new Error("D1 response lost")

    const firstReceipt = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "archived-recovery-use"
    )
    const replay = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "archived-recovery-use"
    )

    expect(replay).toEqual(firstReceipt)
    expect(db.assets[0]).toMatchObject({ status: "archived", revision: 2 })
    expect(db.useRequests).toHaveLength(1)
  })

  it("reconciles a committed-but-reported use without a second revision", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.batchFailureAfterMutation = new Error("D1 transport lost response")

    await expect(
      repository.markUsed(
        "workspace-a",
        first.asset.id,
        "committed-use-response-lost"
      )
    ).resolves.toMatchObject({ assetId: first.asset.id, assetRevision: 2 })
    expect(db.assets[0].revision).toBe(2)
    expect(db.useRequests).toHaveLength(1)
  })

  it("adopts a same-key D1 race without applying the losing update", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.batchFailure = () => {
      const row = db.assets[0]
      row.last_used_at = "2026-08-28T00:10:00.000Z"
      row.updated_at = "2026-08-28T00:10:00.000Z"
      row.revision = 2
      db.useRequests.push({
        workspace_id: "workspace-a",
        idempotency_key: "raced-use-request",
        request_hash:
          "2ffcb08745510fd707b3b56d7841ee5d8424c3cec985ba477e5c88222f39c69c",
        asset_id: first.asset.id,
        used_at: "2026-08-28T00:10:00.000Z",
        result_revision: 2,
        created_at: "2026-08-28T00:10:00.000Z",
      })
      return new Error("UNIQUE constraint failed")
    }

    await expect(
      repository.markUsed("workspace-a", first.asset.id, "raced-use-request")
    ).resolves.toEqual({
      assetId: first.asset.id,
      usedAt: "2026-08-28T00:10:00.000Z",
      assetRevision: 2,
    })
    expect(db.assets[0].revision).toBe(2)
    expect(db.useRequests).toHaveLength(1)
  })

  it("trusts the durable receipt over anomalous D1 result counts", async () => {
    const { db, repository } = repositoryFixture()
    const first = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.batchResultChanges = [0, 0]

    const receipt = await repository.markUsed(
      "workspace-a",
      first.asset.id,
      "anomalous-result-use"
    )
    expect(receipt.assetRevision).toBe(2)
    expect(db.assets[0].revision).toBe(2)
    expect(db.useRequests).toHaveLength(1)
  })

  it("streams workspace-owned bytes with an integrity-checked renderer source", async () => {
    const { repository } = repositoryFixture()
    const { asset } = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    const content = await repository.content("workspace-a", asset.id)
    expect(
      new Uint8Array(await new Response(content.body).arrayBuffer())
    ).toEqual(png1x1)
    await expect(
      repository.content("workspace-b", asset.id)
    ).rejects.toMatchObject({
      code: "asset_not_found",
      status: 404,
    })
    await expect(
      repository.resolveRendererSource("workspace-a", asset.id)
    ).resolves.toMatchObject({
      assetId: asset.id,
      src: expect.stringMatching(/^data:image\/png;base64,/),
      width: 1,
      height: 1,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: 1,
    })
  })

  it("rejects renderer materialization when managed dimensions disagree with verified bytes", async () => {
    const { db, repository } = repositoryFixture()
    const { asset } = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.assets[0].width = 2

    await expect(
      repository.resolveRendererSource("workspace-a", asset.id)
    ).rejects.toMatchObject({
      code: "asset_dimension_mismatch",
      status: 422,
    })
  })

  it("reports current and immutable published impact and blocks archival", async () => {
    const { db, repository } = repositoryFixture()
    const { asset } = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    db.references.push(
      {
        workspace_id: "workspace-a",
        asset_id: asset.id,
        reference_kind: "current_document",
        source_id: "document-1",
        reference_key: "node:cover:src",
        document_id: "document-1",
        page_id: "page-cover",
        node_id: "cover",
        field_id: null,
        property: "src",
      },
      {
        workspace_id: "workspace-a",
        asset_id: asset.id,
        reference_kind: "published_version",
        source_id: "version-1",
        reference_key: "node:cover:src",
        document_id: "document-1",
        page_id: "page-cover",
        node_id: "cover",
        field_id: null,
        property: "src",
      }
    )
    const impact = await repository.deletionImpact("workspace-a", asset.id)
    await expect(repository.lookup("workspace-a", asset.id)).resolves.toEqual(
      expect.objectContaining({
        id: asset.id,
        status: "ready",
        selectable: true,
      })
    )
    await expect(
      repository.lookup("workspace-b", asset.id)
    ).rejects.toMatchObject({ code: "asset_not_found", status: 404 })
    expect(impact).toMatchObject({
      canArchive: false,
      currentReferences: 1,
      publishedReferences: 1,
      references: expect.arrayContaining([
        expect.objectContaining({ nodeId: "cover", pageId: "page-cover" }),
      ]),
    })
    await expect(
      repository.archive("workspace-a", asset.id, impact.revision, impact.token)
    ).rejects.toMatchObject({ code: "asset_referenced", status: 409 })
  })

  it("requires a fresh revision and impact token, then archives metadata without deleting R2", async () => {
    const { r2, repository } = repositoryFixture()
    const { asset } = await repository.upload(
      "workspace-a",
      await validatedUpload(),
      null
    )
    const impact = await repository.deletionImpact("workspace-a", asset.id)
    await expect(
      repository.archive("workspace-a", asset.id, impact.revision, "stale")
    ).rejects.toMatchObject({ code: "asset_impact_stale", status: 412 })
    await expect(
      repository.archive(
        "workspace-a",
        asset.id,
        impact.revision + 1,
        impact.token
      )
    ).rejects.toMatchObject({ code: "asset_revision_mismatch", status: 412 })
    await expect(
      repository.archive("workspace-a", asset.id, impact.revision, impact.token)
    ).resolves.toEqual({
      assetId: asset.id,
      status: "archived",
      revision: impact.revision + 1,
    })
    expect(r2.deleted).toEqual([])
    await expect(repository.lookup("workspace-a", asset.id)).resolves.toEqual(
      expect.objectContaining({
        id: asset.id,
        status: "archived",
        selectable: false,
      })
    )
    await expect(
      repository.content("workspace-a", asset.id)
    ).resolves.toMatchObject({
      asset: { id: asset.id, status: "archived" },
    })
    await expect(
      repository.resolveRendererSource("workspace-a", asset.id)
    ).resolves.toMatchObject({
      assetId: asset.id,
      src: expect.stringMatching(/^data:image\/png;base64,/),
      width: 1,
      height: 1,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: impact.revision + 1,
    })
  })

  it("binds a local alias to one managed hash and replays new request keys without another object", async () => {
    const { db, r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    const first = await repository.promoteLocalAsset(
      "workspace-a",
      "local-portrait:1",
      upload,
      "promotion-key-1",
      "principal-a"
    )
    const replay = await repository.promoteLocalAsset(
      "workspace-a",
      "local-portrait:1",
      upload,
      "promotion-key-2",
      "principal-a"
    )

    expect(first.storageDeltaBytes).toBe(png1x1.length)
    expect(replay).toEqual({
      promotion: first.promotion,
      storageDeltaBytes: 0,
    })
    expect(db.assets).toHaveLength(1)
    expect(db.promotions).toHaveLength(1)
    expect(db.requests).toHaveLength(2)
    expect(r2.objects.size).toBe(1)
    expect(r2.deleted).toEqual([])
    expect(JSON.stringify(first)).not.toMatch(/r2|object|data:image|bytes":\[/i)
  })

  it("retains promotion bytes after D1 failure and converges on retry", async () => {
    const { db, r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    db.batchFailure = new Error("promotion D1 unavailable")
    await expect(
      repository.promoteLocalAsset(
        "workspace-a",
        "local-retry",
        upload,
        "promotion-retry-key",
        "principal-a"
      )
    ).rejects.toThrow("promotion D1 unavailable")
    expect(r2.objects.size).toBe(1)
    expect(r2.deleted).toEqual([])
    const retainedKey = [...r2.objects.keys()][0]

    await expect(
      repository.promoteLocalAsset(
        "workspace-a",
        "local-retry",
        upload,
        "promotion-retry-key",
        "principal-a"
      )
    ).resolves.toMatchObject({
      storageDeltaBytes: upload.byteLength,
      promotion: { localAssetId: "local-retry" },
    })
    expect([...r2.objects.keys()]).toEqual([retainedKey])
    expect(r2.deleted).toEqual([])
  })

  it("performs one bounded content-hash adoption after a concurrent D1 winner", async () => {
    const { db, r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    db.batchFailure = () => {
      const r2Key = r2.putKeys.at(-1)
      if (!r2Key) throw new Error("Expected immutable content before D1")
      db.assets.push({
        id: "asset-0000000000000000000000000000998",
        workspace_id: "workspace-a",
        name: upload.name,
        media_type: upload.mediaType,
        bytes: upload.byteLength,
        width: upload.width,
        height: upload.height,
        content_hash: upload.contentHash,
        r2_key: r2Key,
        status: "ready",
        revision: 1,
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
        last_used_at: "2026-08-28T00:00:00.000Z",
      })
      return new Error("UNIQUE content hash winner")
    }

    const result = await repository.promoteLocalAsset(
      "workspace-a",
      "local-raced",
      upload,
      "promotion-race-key",
      "principal-a"
    )
    expect(result).toMatchObject({
      storageDeltaBytes: 0,
      promotion: {
        localAssetId: "local-raced",
        asset: { id: "asset-0000000000000000000000000000998" },
      },
    })
    expect(db.assets).toHaveLength(1)
    expect(db.promotions).toHaveLength(1)
    expect(db.requests).toHaveLength(1)
    expect(r2.deleted).toEqual([])
  })

  it("binds request identity to the route and local alias", async () => {
    const { repository } = repositoryFixture()
    const upload = await validatedUpload()
    await repository.promoteLocalAsset(
      "workspace-a",
      "local-first",
      upload,
      "route-bound-key",
      "principal-a"
    )
    await expect(
      repository.promoteLocalAsset(
        "workspace-a",
        "local-second",
        upload,
        "route-bound-key",
        "principal-a"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })

    const { repository: secondRepository } = repositoryFixture()
    await secondRepository.upload("workspace-a", upload, "cross-route-key")
    await expect(
      secondRepository.promoteLocalAsset(
        "workspace-a",
        "local-first",
        upload,
        "cross-route-key",
        "principal-a"
      )
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 })
  })

  it("rejects different bytes for an existing alias before touching R2", async () => {
    const { r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    await repository.promoteLocalAsset(
      "workspace-a",
      "local-immutable",
      upload,
      "immutable-key-1",
      "principal-a"
    )
    const putsBefore = r2.putKeys.length
    await expect(
      repository.promoteLocalAsset(
        "workspace-a",
        "local-immutable",
        {
          ...upload,
          contentHash: "b".repeat(64),
          requestHash: "c".repeat(64),
        },
        "immutable-key-2",
        "principal-a"
      )
    ).rejects.toMatchObject({
      code: "local_asset_alias_conflict",
      status: 409,
    })
    expect(r2.putKeys).toHaveLength(putsBefore)
    expect(r2.deleted).toEqual([])
  })

  it("recovers an exact archived mapping without charging retained bytes", async () => {
    const { r2, repository } = repositoryFixture()
    const upload = await validatedUpload()
    const created = await repository.promoteLocalAsset(
      "workspace-a",
      "local-archived",
      upload,
      "archived-key-1",
      "principal-a"
    )
    const impact = await repository.deletionImpact(
      "workspace-a",
      created.promotion.asset.id
    )
    await repository.archive(
      "workspace-a",
      created.promotion.asset.id,
      impact.revision,
      impact.token
    )
    await expect(repository.storageUsage("workspace-a")).resolves.toEqual({
      bytes: png1x1.length,
      count: 1,
    })
    const recovered = await repository.promoteLocalAsset(
      "workspace-a",
      "local-archived",
      upload,
      "archived-key-2",
      "principal-a"
    )
    expect(recovered).toMatchObject({
      storageDeltaBytes: 0,
      promotion: { asset: { status: "ready", selectable: true, revision: 3 } },
    })
    expect(r2.deleted).toEqual([])
  })

  it("reconciles an archived restore race only when mapping, request, hash, asset, and ready state committed", async () => {
    const committed = repositoryFixture()
    const upload = await validatedUpload()
    const original = await committed.repository.promoteLocalAsset(
      "workspace-a",
      "local-original",
      upload,
      "restore-original",
      "principal-a"
    )
    const impact = await committed.repository.deletionImpact(
      "workspace-a",
      original.promotion.asset.id
    )
    await committed.repository.archive(
      "workspace-a",
      original.promotion.asset.id,
      impact.revision,
      impact.token
    )
    committed.db.batchResultChanges = [0, 1, 1]
    await expect(
      committed.repository.promoteLocalAsset(
        "workspace-a",
        "local-race-winner",
        upload,
        "restore-race-winner",
        "principal-a"
      )
    ).resolves.toMatchObject({
      storageDeltaBytes: 0,
      promotion: {
        localAssetId: "local-race-winner",
        asset: { id: original.promotion.asset.id, status: "ready" },
      },
    })

    const incomplete = repositoryFixture()
    const incompleteOriginal = await incomplete.repository.promoteLocalAsset(
      "workspace-a",
      "local-original",
      upload,
      "restore-incomplete-original",
      "principal-a"
    )
    const incompleteImpact = await incomplete.repository.deletionImpact(
      "workspace-a",
      incompleteOriginal.promotion.asset.id
    )
    await incomplete.repository.archive(
      "workspace-a",
      incompleteOriginal.promotion.asset.id,
      incompleteImpact.revision,
      incompleteImpact.token
    )
    incomplete.db.skipPromotionRequestMutation = true
    incomplete.db.batchResultChanges = [0, 1, 1]
    await expect(
      incomplete.repository.promoteLocalAsset(
        "workspace-a",
        "local-false-adoption",
        upload,
        "restore-missing-request",
        "principal-a"
      )
    ).rejects.toThrow("media_asset_promotion_restore_incomplete")
  })

  it.each(["exact", "non-exact"] as const)(
    "returns an archived mapping when archive wins after the %s restore batch",
    async (resultShape) => {
      const fixture = repositoryFixture()
      const upload = await validatedUpload()
      const original = await fixture.repository.promoteLocalAsset(
        "workspace-a",
        "local-before-archive-race",
        upload,
        `archive-race-original-${resultShape}`,
        "principal-a"
      )
      const impact = await fixture.repository.deletionImpact(
        "workspace-a",
        original.promotion.asset.id
      )
      await fixture.repository.archive(
        "workspace-a",
        original.promotion.asset.id,
        impact.revision,
        impact.token
      )
      fixture.db.archiveAssetAfterBatch = original.promotion.asset.id
      if (resultShape === "non-exact") {
        fixture.db.batchResultChanges = [0, 1, 1]
      }

      await expect(
        fixture.repository.promoteLocalAsset(
          "workspace-a",
          `local-after-archive-race-${resultShape}`,
          upload,
          `archive-race-new-${resultShape}`,
          "principal-a"
        )
      ).resolves.toMatchObject({
        storageDeltaBytes: 0,
        promotion: {
          asset: {
            id: original.promotion.asset.id,
            status: "archived",
            selectable: false,
          },
        },
      })
    }
  )

  it("resolves only workspace-owned mappings in exact request order", async () => {
    const { repository } = repositoryFixture()
    const upload = await validatedUpload()
    await repository.promoteLocalAsset(
      "workspace-a",
      "local-one",
      upload,
      "resolve-a",
      "principal-a"
    )
    await repository.promoteLocalAsset(
      "workspace-b",
      "local-private",
      upload,
      "resolve-b",
      "principal-b"
    )
    const results = await repository.resolveLocalPromotions("workspace-a", [
      "local-missing",
      "local-one",
      "local-private",
    ])
    expect(results.map((result) => result.localAssetId)).toEqual([
      "local-missing",
      "local-one",
      "local-private",
    ])
    expect(results.map((result) => result.promotion !== null)).toEqual([
      false,
      true,
      false,
    ])
    await expect(
      repository.resolveLocalPromotions("workspace-a", [
        "local-one",
        "local-one",
      ])
    ).rejects.toMatchObject({ code: "invalid_local_asset_ids", status: 400 })
  })

  it("fails closed when D1 reports an incomplete promotion batch", async () => {
    const { db, repository } = repositoryFixture()
    db.batchResultChanges = [1, 0, 1]
    await expect(
      repository.promoteLocalAsset(
        "workspace-a",
        "local-incomplete",
        await validatedUpload(),
        "incomplete-key",
        "principal-a"
      )
    ).rejects.toThrow("media_asset_promotion_write_incomplete")
  })
})
