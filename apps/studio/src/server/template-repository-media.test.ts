import { describe, expect, it, vi } from "vitest"
import { northstarSeed } from "@webmcp/document"
import type { Document, TemplatePublishRequest } from "@webmcp/document"
import { collectManagedDocumentAssetReferences } from "./render-field-assets"
import { persistTemplateVersion } from "./template-repository"

class CaptureStatement {
  values: unknown[] = []

  constructor(
    readonly owner: CaptureD1,
    readonly query: string
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this as unknown as D1PreparedStatement
  }

  async first<T>() {
    if (this.query.includes("/* media:get */")) {
      return {
        id: assetId,
        workspace_id: "workspace-a",
        name: "Portrait",
        media_type: "image/png",
        bytes: 67,
        width: 1,
        height: 1,
        content_hash: "a".repeat(64),
        r2_key: "private/key",
        status: this.owner.assetStatus,
        revision: 1,
        created_at: now,
        updated_at: now,
        last_used_at: now,
      } as T
    }
    return null
  }
}

class CaptureD1 {
  statements: CaptureStatement[] = []
  batches: D1PreparedStatement[][] = []
  assetStatus: "ready" | "archived"

  constructor(
    assetStatus: "ready" | "archived" = "ready",
    readonly insertionChanges = 1,
    public beforeBatch?: () => void
  ) {
    this.assetStatus = assetStatus
  }

  prepare(query: string) {
    const statement = new CaptureStatement(this, query)
    this.statements.push(statement)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T>(statements: D1PreparedStatement[]) {
    this.beforeBatch?.()
    this.batches.push(statements)
    return statements.map((statement) => {
      const capture = statement as unknown as CaptureStatement
      const changes = capture.query.includes("/* media:reference-insert */")
        ? this.insertionChanges
        : 1
      return { meta: { changes }, results: [] } as unknown as D1Result<T>
    })
  }
}

const assetId = "asset-0123456789abcdef0123456789abcdef"
const managed = `asset:managed/${assetId}`
const now = "2026-08-28T00:00:00.000Z"

const managedDocument = (): Document => {
  const document = structuredClone(northstarSeed)
  const page = document.pages[0]
  document.nodes.push({
    id: "managed-image",
    name: "Managed image",
    type: "image",
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId,
    src: managed,
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    decorative: false,
    alt: "Portrait",
  })
  page.nodeIds.push("managed-image")
  document.fields.push({
    id: "managed_asset_field",
    key: "managed_asset_field",
    label: "Managed asset",
    type: "asset",
    required: true,
    defaultValue: managed,
    agentDescription: "Workspace-owned image",
    validation: {},
  })
  document.fieldValues.managed_asset_field = managed
  return document
}

describe("template media persistence boundary", () => {
  it("stores canonical managed IDs and reference rows atomically without reading R2", async () => {
    const db = new CaptureD1()
    const get = vi.fn(() => {
      throw new Error("Publication must not materialize private image bytes")
    })
    const request: TemplatePublishRequest = {
      id: "template-version-managed-1",
      templateId: "template-managed",
      version: 1,
      publishedAt: now,
      document: managedDocument(),
    }
    const result = await persistTemplateVersion(
      db as unknown as D1Database,
      { get } as unknown as R2Bucket,
      "workspace-a",
      request
    )
    expect(get).not.toHaveBeenCalled()
    expect(JSON.stringify(result.version.document)).toContain(managed)
    expect(JSON.stringify(result.version)).not.toContain("data:image")

    const versionInsert = db.statements.find((statement) =>
      statement.query.includes("INSERT INTO template_versions")
    )
    expect(versionInsert).toBeDefined()
    expect(String(versionInsert?.values[5])).toContain(managed)
    expect(String(versionInsert?.values[5])).not.toContain("data:image")
    expect(String(versionInsert?.values[6])).toContain(managed)
    expect(
      db.statements.filter((statement) =>
        statement.query.includes("/* media:reference-insert */")
      ).length
    ).toBe(
      collectManagedDocumentAssetReferences(
        request.document,
        "published_version",
        request.id
      ).length * 2
    )
    expect(db.batches).toHaveLength(1)
  })

  it.each(["archived", "archive-race"] as const)(
    "persists exact references when a managed asset is %s",
    async (scenario) => {
      const db = new CaptureD1(
        scenario === "archived" ? "archived" : "ready",
        1
      )
      if (scenario === "archive-race") {
        db.beforeBatch = () => {
          db.assetStatus = "archived"
        }
      }
      const request: TemplatePublishRequest = {
        id: `template-version-managed-${scenario}`,
        templateId: `template-managed-${scenario}`,
        version: 1,
        publishedAt: now,
        document: managedDocument(),
      }

      await expect(
        persistTemplateVersion(
          db as unknown as D1Database,
          { get: vi.fn() } as unknown as R2Bucket,
          "workspace-a",
          request
        )
      ).resolves.toMatchObject({ created: true })
      expect(db.assetStatus).toBe("archived")
      const insertionQueries = db.statements
        .filter((statement) =>
          statement.query.includes("/* media:reference-insert */")
        )
        .map((statement) => statement.query)
      expect(insertionQueries.length).toBeGreaterThan(0)
      expect(insertionQueries.every((query) => query.includes("VALUES"))).toBe(
        true
      )
      expect(
        insertionQueries.every((query) => !query.includes("status = 'ready'"))
      ).toBe(true)
    }
  )

  it("fails publication loudly when D1 does not report every reference insert", async () => {
    const db = new CaptureD1("ready", 0)
    const request: TemplatePublishRequest = {
      id: "template-version-managed-incomplete",
      templateId: "template-managed-incomplete",
      version: 1,
      publishedAt: now,
      document: managedDocument(),
    }

    await expect(
      persistTemplateVersion(
        db as unknown as D1Database,
        { get: vi.fn() } as unknown as R2Bucket,
        "workspace-a",
        request
      )
    ).rejects.toThrow(/^media_reference_write_incomplete:0\//)
  })
})
