-- D1 applies each migration in one transaction. Foreign-key checks must be
-- deferred while the referenced template_versions table and both dependent
-- render tables are rebuilt; foreign_keys cannot be disabled inside D1's
-- migration transaction.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE template_versions_v2 (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  document_json TEXT NOT NULL
    CONSTRAINT chk_template_versions_document_json
    CHECK (json_valid(document_json) AND substr(ltrim(document_json), 1, 1) = '{'),
  manifest_json TEXT NOT NULL
    CONSTRAINT chk_template_versions_manifest_json
    CHECK (json_valid(manifest_json) AND substr(ltrim(manifest_json), 1, 1) = '{'),
  published_at TEXT NOT NULL,
  id TEXT NOT NULL
    CONSTRAINT chk_template_versions_id
    CHECK (length(trim(id)) > 0),
  source_revision INTEGER NOT NULL
    CONSTRAINT chk_template_versions_source_revision
    CHECK (
      typeof(source_revision) = 'integer'
      AND source_revision >= 0
      AND json_extract(document_json, '$.revision') = source_revision
    ),
  source_snapshot_id TEXT NOT NULL
    CONSTRAINT chk_template_versions_source_snapshot_id
    CHECK (
      (
        length(source_snapshot_id) = 71
        AND substr(source_snapshot_id, 1, 7) = 'sha256-'
        AND substr(source_snapshot_id, 8) NOT GLOB '*[^a-f0-9]*'
      )
      OR (
        length(source_snapshot_id) > 7
        AND substr(source_snapshot_id, 1, 7) = 'legacy-'
        AND substr(source_snapshot_id, 8) NOT GLOB '*[^A-Za-z0-9._:-]*'
      )
    ),
  PRIMARY KEY (template_id, version)
);

-- This copy is the migration's validation boundary. Any null identity,
-- malformed JSON, revision mismatch, or invalid snapshot ID aborts the whole
-- migration before the current tables are removed.
INSERT INTO template_versions_v2
  (template_id, version, document_json, manifest_json, published_at,
   id, source_revision, source_snapshot_id)
SELECT
  template_id, version, document_json, manifest_json, published_at,
  id, source_revision, source_snapshot_id
FROM template_versions;

-- render_jobs owns a composite foreign key into template_versions, and
-- render_outputs cascades from render_jobs. Preserve both tables explicitly so
-- replacing the parent cannot discard existing render history.
CREATE TABLE render_jobs_migration_backup AS
SELECT
  id, workspace_id, template_id, template_version, status, request_json,
  error_code, error_message, created_at, started_at, completed_at,
  idempotency_key, request_hash
FROM render_jobs;

CREATE TABLE render_outputs_migration_backup AS
SELECT
  id, render_job_id, output_id, format, r2_key, width, height, bytes,
  checksum, created_at, page_id
FROM render_outputs;

DROP TABLE render_outputs;
DROP TABLE render_jobs;
DROP TABLE template_versions;
ALTER TABLE template_versions_v2 RENAME TO template_versions;

CREATE TABLE render_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'completed', 'failed')),
  request_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  idempotency_key TEXT,
  request_hash TEXT,
  FOREIGN KEY (template_id, template_version)
    REFERENCES template_versions(template_id, version)
);

CREATE TABLE render_outputs (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('png', 'pdf')),
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  page_id TEXT
);

INSERT INTO render_jobs
  (id, workspace_id, template_id, template_version, status, request_json,
   error_code, error_message, created_at, started_at, completed_at,
   idempotency_key, request_hash)
SELECT
  id, workspace_id, template_id, template_version, status, request_json,
  error_code, error_message, created_at, started_at, completed_at,
  idempotency_key, request_hash
FROM render_jobs_migration_backup;

INSERT INTO render_outputs
  (id, render_job_id, output_id, format, r2_key, width, height, bytes,
   checksum, created_at, page_id)
SELECT
  id, render_job_id, output_id, format, r2_key, width, height, bytes,
  checksum, created_at, page_id
FROM render_outputs_migration_backup;

DROP TABLE render_outputs_migration_backup;
DROP TABLE render_jobs_migration_backup;

CREATE INDEX idx_template_versions_id ON template_versions(id);
CREATE UNIQUE INDEX idx_template_versions_source_snapshot
ON template_versions(template_id, source_snapshot_id);

CREATE INDEX idx_render_jobs_workspace
ON render_jobs(workspace_id, created_at DESC);

CREATE UNIQUE INDEX idx_render_jobs_idempotency
ON render_jobs(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_render_outputs_artifact_identity
ON render_outputs(
  render_job_id,
  output_id,
  COALESCE(page_id, ''),
  format
);

-- Turning deferral off makes unresolved references fail before D1 records the
-- migration as applied.
PRAGMA defer_foreign_keys = OFF;
