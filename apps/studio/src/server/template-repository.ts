import { templateVersionSchema, type TemplateVersion } from "@webmcp/document"

export const DEMO_WORKSPACE_ID = "workspace-demo"

type VersionRow = {
  id: string
  template_id: string
  version: number
  source_revision: number
  document_json: string
  manifest_json: string
  published_at: string
}

type ExistingVersionRow = Pick<
  VersionRow,
  "id" | "source_revision" | "document_json" | "manifest_json" | "published_at"
>

const matchesVersion = (
  existing: ExistingVersionRow,
  version: TemplateVersion
) =>
  existing.id === version.id &&
  existing.source_revision === version.sourceRevision &&
  existing.document_json === JSON.stringify(version.document) &&
  existing.manifest_json === JSON.stringify(version.manifest) &&
  existing.published_at === version.publishedAt

export async function persistTemplateVersion(
  db: D1Database,
  versionInput: TemplateVersion
) {
  const version = templateVersionSchema.parse(versionInput)
  const existing = await db
    .prepare(
      `SELECT id, source_revision, document_json, manifest_json, published_at
       FROM template_versions WHERE template_id = ?1 AND version = ?2`
    )
    .bind(version.templateId, version.version)
    .first<ExistingVersionRow>()
  if (existing) {
    if (!matchesVersion(existing, version)) {
      throw new Error("published_version_conflict")
    }
    return version
  }

  const latest = await db
    .prepare("SELECT latest_version FROM templates WHERE id = ?1")
    .bind(version.templateId)
    .first<{ latest_version: number }>()
  const expectedVersion = (latest?.latest_version ?? 0) + 1
  if (version.version !== expectedVersion) {
    throw new Error(`expected_version:${expectedVersion}`)
  }

  try {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO workspaces (id, name, kind, created_at) VALUES (?1, ?2, 'demo', ?3)"
        )
        .bind(DEMO_WORKSPACE_ID, "WebMCP Studio Demo", version.publishedAt),
      db
        .prepare(
          `INSERT INTO documents (id, workspace_id, name, current_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           current_revision = excluded.current_revision,
           updated_at = excluded.updated_at`
        )
        .bind(
          version.document.id,
          DEMO_WORKSPACE_ID,
          version.document.name,
          version.sourceRevision,
          version.document.createdAt,
          version.document.updatedAt
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO document_revisions
         (document_id, revision, actor, document_json, created_at)
         VALUES (?1, ?2, 'human', ?3, ?4)`
        )
        .bind(
          version.document.id,
          version.sourceRevision,
          JSON.stringify(version.document),
          version.publishedAt
        ),
      db
        .prepare(
          `INSERT INTO templates
         (id, workspace_id, source_document_id, name, latest_version, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           source_document_id = excluded.source_document_id,
           name = excluded.name,
           latest_version = excluded.latest_version`
        )
        .bind(
          version.templateId,
          DEMO_WORKSPACE_ID,
          version.document.id,
          version.document.name,
          version.version,
          version.publishedAt
        ),
      db
        .prepare(
          `INSERT INTO template_versions
         (id, template_id, version, source_revision, document_json, manifest_json, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
        .bind(
          version.id,
          version.templateId,
          version.version,
          version.sourceRevision,
          JSON.stringify(version.document),
          JSON.stringify(version.manifest),
          version.publishedAt
        ),
    ])
  } catch (error) {
    const raced = await db
      .prepare(
        `SELECT id, source_revision, document_json, manifest_json, published_at
         FROM template_versions WHERE template_id = ?1 AND version = ?2`
      )
      .bind(version.templateId, version.version)
      .first<ExistingVersionRow>()
    if (!raced) throw error
    if (!matchesVersion(raced, version)) {
      throw new Error("published_version_conflict")
    }
  }
  return version
}

export async function getTemplateVersion(
  db: D1Database,
  templateId: string,
  version?: number
): Promise<TemplateVersion | null> {
  const row = version
    ? await db
        .prepare(
          `SELECT tv.id, tv.template_id, tv.version, tv.source_revision,
                  tv.document_json, tv.manifest_json, tv.published_at
           FROM template_versions tv
           WHERE tv.template_id = ?1 AND tv.version = ?2`
        )
        .bind(templateId, version)
        .first<VersionRow>()
    : await db
        .prepare(
          `SELECT tv.id, tv.template_id, tv.version, tv.source_revision,
                  tv.document_json, tv.manifest_json, tv.published_at
           FROM template_versions tv
           WHERE tv.template_id = ?1
           ORDER BY tv.version DESC LIMIT 1`
        )
        .bind(templateId)
        .first<VersionRow>()
  if (!row) return null
  return templateVersionSchema.parse({
    id: row.id,
    templateId: row.template_id,
    version: row.version,
    sourceRevision: row.source_revision,
    publishedAt: row.published_at,
    document: JSON.parse(row.document_json) as unknown,
    manifest: JSON.parse(row.manifest_json) as unknown,
  })
}
