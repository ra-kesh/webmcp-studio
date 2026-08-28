import { describe, expect, it } from "vitest"
import { MediaAssetRepository } from "./media-asset-repository"
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
    if (marker === "media:storage") {
      const assets = this.state.assets.filter(
        (asset) =>
          asset.workspace_id === workspaceId && asset.status === "ready"
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
        .filter(
          (asset) =>
            asset.workspace_id === workspaceId &&
            asset.status === "ready" &&
            (!query || String(asset.name).toLowerCase().includes(query)) &&
            (!cursorSort ||
              String(asset[sort]) < cursorSort ||
              (asset[sort] === cursorSort &&
                String(asset.id) < String(cursorId)))
        )
        .sort(
          (left, right) =>
            String(right[sort]).localeCompare(String(left[sort])) ||
            String(right.id).localeCompare(String(left.id))
        )
        .slice(0, limit)
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
      return 1
    }
    if (marker === "media:idempotency-insert") {
      const [workspaceId, key, requestHash, assetId, now] = this.values
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
    if (marker === "media:mark-used") {
      const [workspaceId, id, now] = this.values
      const asset = this.state.assets.find(
        (candidate) =>
          candidate.workspace_id === workspaceId &&
          candidate.id === id &&
          candidate.status === "ready"
      )
      if (!asset) return 0
      asset.last_used_at = now
      asset.updated_at = now
      asset.revision = Number(asset.revision) + 1
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
      return 1
    }
    return 0
  }
}

class FakeD1 {
  assets: Row[] = []
  requests: Row[] = []
  references: Row[] = []

  prepare(query: string) {
    return new FakeD1Statement(query, this) as unknown as D1PreparedStatement
  }

  async batch<T>(statements: D1PreparedStatement[]) {
    return Promise.all(
      statements.map((statement) =>
        (statement as unknown as FakeD1Statement).run<T>()
      )
    )
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
    await repository.markUsed("workspace-a", first.asset.id)
    const list = await repository.list("workspace-a", {
      collection: "recent",
      query: "first",
      limit: 1,
      cursor: null,
    })
    expect(list.assets.map((asset) => asset.name)).toEqual(["first.png"])
    expect(list.storage).toEqual({ bytes: png1x1.length, count: 1 })
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
})
