import {
  createTemplateVersionFromPublishRequest,
  decodeDocument,
  decodeTemplateVersion,
  PublishValidationError,
  templatePublishRequestSchema,
} from "@webmcp/document"
import type { TemplatePublishRequest, TemplateVersion } from "@webmcp/document"
import { databaseDocumentId, databaseTemplateId } from "./demo-session"
import {
  catalogAssetFieldIssues,
  collectManagedDocumentAssetReferences,
} from "./render-field-assets"
import {
  assertMediaAssetReferenceMutationResult,
  MediaAssetRepository,
  MediaAssetReferenceInvariantError,
  mediaAssetReferenceMutation,
} from "./media-asset-repository"
import type { MediaAssetReferenceMutation } from "./media-asset-repository"

type VersionRow = {
  id: string
  template_id: string
  version: number
  source_revision: number
  source_snapshot_id: string
  document_json: string
  manifest_json: string
  published_at: string
}

type StoredVersionRow = Pick<
  VersionRow,
  | "id"
  | "version"
  | "source_revision"
  | "source_snapshot_id"
  | "document_json"
  | "manifest_json"
  | "published_at"
>

const matchesVersion = (existing: StoredVersionRow, version: TemplateVersion) =>
  existing.id === version.id &&
  existing.source_revision === version.sourceRevision &&
  existing.source_snapshot_id === version.sourceSnapshotId &&
  existing.document_json === JSON.stringify(version.document) &&
  existing.manifest_json === JSON.stringify(version.manifest) &&
  existing.published_at === version.publishedAt

const storedVersion = (
  row: StoredVersionRow,
  templateId: string
): TemplateVersion =>
  decodeTemplateVersion({
    id: row.id,
    templateId,
    version: row.version,
    sourceRevision: row.source_revision,
    sourceSnapshotId: row.source_snapshot_id,
    publishedAt: row.published_at,
    document: JSON.parse(row.document_json) as unknown,
    manifest: JSON.parse(row.manifest_json) as unknown,
  }).version

export type PersistTemplateVersionResult = {
  version: TemplateVersion
  created: boolean
}

export async function persistTemplateVersion(
  db: D1Database,
  assets: R2Bucket,
  workspaceId: string,
  publishInput: TemplatePublishRequest
): Promise<PersistTemplateVersionResult> {
  const request = templatePublishRequestSchema.parse(publishInput)
  const mediaAssets = new MediaAssetRepository(db, assets)
  const publishedReferences = collectManagedDocumentAssetReferences(
    request.document,
    "published_version",
    request.id
  )
  await Promise.all(
    [...new Set(publishedReferences.map((reference) => reference.assetId))].map(
      (assetId) => mediaAssets.contentMetadata(workspaceId, assetId)
    )
  )
  const version = await createTemplateVersionFromPublishRequest(request)
  const assetFieldIssues = catalogAssetFieldIssues(version.document)
  if (assetFieldIssues.length) {
    throw new PublishValidationError(assetFieldIssues)
  }
  const storedTemplateId = databaseTemplateId(workspaceId, version.templateId)
  const storedDocumentId = databaseDocumentId(workspaceId, version.document.id)
  const currentReferences = publishedReferences.map((reference) => ({
    ...reference,
    referenceKind: "current_document" as const,
    sourceId: version.document.id,
  }))
  const referenceMutations = (): MediaAssetReferenceMutation[] => [
    mediaAssetReferenceMutation(
      db,
      workspaceId,
      "current_document",
      version.document.id,
      currentReferences,
      version.publishedAt
    ),
    mediaAssetReferenceMutation(
      db,
      workspaceId,
      "published_version",
      version.id,
      publishedReferences,
      version.publishedAt
    ),
  ]
  const persistWithReferences = async (
    leadingStatements: D1PreparedStatement[] = []
  ) => {
    const mutations = referenceMutations()
    const results = await db.batch<unknown>([
      ...leadingStatements,
      ...mutations.flatMap((mutation) => mutation.statements),
    ])
    let offset = leadingStatements.length
    for (const mutation of mutations) {
      assertMediaAssetReferenceMutationResult(
        mutation,
        results.slice(offset, offset + mutation.statements.length)
      )
      offset += mutation.statements.length
    }
  }
  const sameSnapshot = await db
    .prepare(
      `SELECT id, version, source_revision, source_snapshot_id,
              document_json, manifest_json, published_at
       FROM template_versions
       WHERE template_id = ?1 AND source_snapshot_id = ?2`
    )
    .bind(storedTemplateId, version.sourceSnapshotId)
    .first<StoredVersionRow>()
  if (sameSnapshot) {
    const existing = storedVersion(sameSnapshot, version.templateId)
    if (
      JSON.stringify(existing.document) !== JSON.stringify(version.document)
    ) {
      throw new Error("published_snapshot_conflict")
    }
    await persistWithReferences()
    return { version: existing, created: false }
  }
  const existing = await db
    .prepare(
      `SELECT id, version, source_revision, source_snapshot_id,
              document_json, manifest_json, published_at
       FROM template_versions WHERE template_id = ?1 AND version = ?2`
    )
    .bind(storedTemplateId, version.version)
    .first<StoredVersionRow>()
  if (existing) {
    if (!matchesVersion(existing, version)) {
      throw new Error("published_version_conflict")
    }
    await persistWithReferences()
    return {
      version: storedVersion(existing, version.templateId),
      created: false,
    }
  }

  const latest = await db
    .prepare("SELECT latest_version FROM templates WHERE id = ?1")
    .bind(storedTemplateId)
    .first<{ latest_version: number }>()
  const expectedVersion = (latest?.latest_version ?? 0) + 1
  if (version.version !== expectedVersion) {
    throw new Error(`expected_version:${expectedVersion}`)
  }

  try {
    await persistWithReferences([
      db
        .prepare(
          `INSERT INTO documents
           (id, workspace_id, public_id, name, current_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           current_revision = excluded.current_revision,
           updated_at = excluded.updated_at`
        )
        .bind(
          storedDocumentId,
          workspaceId,
          version.document.id,
          version.document.name,
          version.sourceRevision,
          version.document.createdAt,
          version.document.updatedAt
        ),
      db
        .prepare(
          `INSERT INTO document_revisions
         (document_id, snapshot_id, revision, actor, document_json, created_at)
         VALUES (?1, ?2, ?3, 'human', ?4, ?5)
         ON CONFLICT(document_id, snapshot_id) DO NOTHING`
        )
        .bind(
          storedDocumentId,
          version.sourceSnapshotId,
          version.sourceRevision,
          JSON.stringify(version.document),
          version.publishedAt
        ),
      db
        .prepare(
          `INSERT INTO templates
         (id, workspace_id, public_id, source_document_id, name, latest_version, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           source_document_id = excluded.source_document_id,
           name = excluded.name,
           latest_version = excluded.latest_version`
        )
        .bind(
          storedTemplateId,
          workspaceId,
          version.templateId,
          storedDocumentId,
          version.document.name,
          version.version,
          version.publishedAt
        ),
      db
        .prepare(
          `INSERT INTO template_versions
         (id, template_id, version, source_revision, source_snapshot_id,
          document_json, manifest_json, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        )
        .bind(
          version.id,
          storedTemplateId,
          version.version,
          version.sourceRevision,
          version.sourceSnapshotId,
          JSON.stringify(version.document),
          JSON.stringify(version.manifest),
          version.publishedAt
        ),
    ])
  } catch (error) {
    if (error instanceof MediaAssetReferenceInvariantError) throw error
    const snapshotRace = await db
      .prepare(
        `SELECT id, version, source_revision, source_snapshot_id,
                document_json, manifest_json, published_at
         FROM template_versions
         WHERE template_id = ?1 AND source_snapshot_id = ?2`
      )
      .bind(storedTemplateId, version.sourceSnapshotId)
      .first<StoredVersionRow>()
    if (snapshotRace) {
      const raced = storedVersion(snapshotRace, version.templateId)
      if (JSON.stringify(raced.document) !== JSON.stringify(version.document)) {
        throw new Error("published_snapshot_conflict")
      }
      return { version: raced, created: false }
    }
    const raced = await db
      .prepare(
        `SELECT id, version, source_revision, source_snapshot_id,
                document_json, manifest_json, published_at
         FROM template_versions WHERE template_id = ?1 AND version = ?2`
      )
      .bind(storedTemplateId, version.version)
      .first<StoredVersionRow>()
    if (!raced) throw error
    if (!matchesVersion(raced, version)) {
      throw new Error("published_version_conflict")
    }
  }
  return { version, created: true }
}

export async function getTemplateVersion(
  db: D1Database,
  workspaceId: string,
  templateId: string,
  version?: number
): Promise<TemplateVersion | null> {
  const storedTemplateId = databaseTemplateId(workspaceId, templateId)
  const row = version
    ? await db
        .prepare(
          `SELECT tv.id, t.public_id AS template_id, tv.version, tv.source_revision,
                  tv.source_snapshot_id,
                  tv.document_json, tv.manifest_json, tv.published_at
           FROM template_versions tv
           JOIN templates t ON t.id = tv.template_id
           WHERE tv.template_id = ?1 AND tv.version = ?2`
        )
        .bind(storedTemplateId, version)
        .first<VersionRow>()
    : await db
        .prepare(
          `SELECT tv.id, t.public_id AS template_id, tv.version, tv.source_revision,
                  tv.source_snapshot_id,
                  tv.document_json, tv.manifest_json, tv.published_at
           FROM template_versions tv
           JOIN templates t ON t.id = tv.template_id
           WHERE tv.template_id = ?1
           ORDER BY tv.version DESC LIMIT 1`
        )
        .bind(storedTemplateId)
        .first<VersionRow>()
  if (!row) return null
  return decodeTemplateVersion({
    id: row.id,
    templateId: row.template_id,
    version: row.version,
    sourceRevision: row.source_revision,
    sourceSnapshotId: row.source_snapshot_id,
    publishedAt: row.published_at,
    document: JSON.parse(row.document_json) as unknown,
    manifest: JSON.parse(row.manifest_json) as unknown,
  }).version
}

export type DocumentRevisionAudit = {
  documentId: string
  snapshotId: string
  revision: number
  actor: "human" | "agent" | "api" | "seed"
  createdAt: string
  document: TemplateVersion["document"]
}

export async function getDocumentRevisionBySnapshotId(
  db: D1Database,
  workspaceId: string,
  documentId: string,
  snapshotId: string
): Promise<DocumentRevisionAudit | null> {
  const row = await db
    .prepare(
      `SELECT d.public_id AS document_id, dr.snapshot_id, dr.revision,
              dr.actor, dr.document_json, dr.created_at
       FROM document_revisions dr
       JOIN documents d ON d.id = dr.document_id
       WHERE d.workspace_id = ?1
         AND d.public_id = ?2
         AND dr.snapshot_id = ?3`
    )
    .bind(workspaceId, documentId, snapshotId)
    .first<{
      document_id: string
      snapshot_id: string
      revision: number
      actor: "human" | "agent" | "api" | "seed"
      document_json: string
      created_at: string
    }>()
  if (!row) return null
  return {
    documentId: row.document_id,
    snapshotId: row.snapshot_id,
    revision: row.revision,
    actor: row.actor,
    createdAt: row.created_at,
    document: decodeDocument(JSON.parse(row.document_json) as unknown).document,
  }
}
