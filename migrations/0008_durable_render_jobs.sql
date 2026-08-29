PRAGMA defer_foreign_keys = ON;

CREATE TABLE render_jobs_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'queued', 'rendering', 'retrying', 'completed', 'failed',
      'cancelling', 'cancelled'
    )),
  request_json TEXT NOT NULL
    CHECK (json_valid(request_json) AND substr(ltrim(request_json), 1, 1) = '{'),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  idempotency_key TEXT,
  request_hash TEXT,
  workflow_instance_id TEXT,
  reservation_id TEXT,
  admission_key TEXT NOT NULL,
  dispatch_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (dispatch_state IN ('pending', 'dispatched', 'restart_pending')),
  active_attempt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count BETWEEN 0 AND 5),
  max_attempts INTEGER NOT NULL DEFAULT 5
    CHECK (typeof(max_attempts) = 'integer' AND max_attempts BETWEEN 1 AND 5),
  heartbeat_at TEXT,
  cancellation_requested_at TEXT,
  deadline_at TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  admission_settlement TEXT
    CHECK (admission_settlement IN ('pending', 'completed', 'failed')),
  artifact_expires_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id, template_version)
    REFERENCES template_versions(template_id, version),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    status NOT IN ('completed', 'failed', 'cancelled')
    OR completed_at IS NOT NULL
  )
);

CREATE TABLE render_outputs_migration_backup AS
SELECT
  id, render_job_id, output_id, format, r2_key, width, height, bytes,
  checksum, created_at, page_id
FROM render_outputs;

INSERT INTO render_jobs_v2 (
  id, workspace_id, template_id, template_version, status, request_json,
  error_code, error_message, created_at, started_at, completed_at,
  idempotency_key, request_hash, workflow_instance_id, reservation_id,
  admission_key, dispatch_state, active_attempt_id, attempt_count, max_attempts, heartbeat_at,
  cancellation_requested_at, deadline_at, retryable, admission_settlement,
  artifact_expires_at, updated_at
)
SELECT
  id, workspace_id, template_id, template_version,
  CASE
    WHEN NOT json_valid(request_json)
      OR substr(ltrim(request_json), 1, 1) <> '{' THEN 'failed'
    WHEN status IN ('queued', 'rendering') THEN 'failed'
    ELSE status
  END,
  CASE
    WHEN json_valid(request_json) AND substr(ltrim(request_json), 1, 1) = '{'
      THEN request_json
    ELSE json_object('legacyMalformedRequest', request_json)
  END,
  CASE
    WHEN NOT json_valid(request_json)
      OR substr(ltrim(request_json), 1, 1) <> '{'
      THEN 'legacy_invalid_request'
    WHEN status IN ('queued', 'rendering') THEN 'legacy_execution_interrupted'
    ELSE error_code
  END,
  CASE
    WHEN NOT json_valid(request_json)
      OR substr(ltrim(request_json), 1, 1) <> '{'
      THEN 'The legacy render request was not a JSON object'
    WHEN status IN ('queued', 'rendering')
      THEN 'The previous synchronous render owner stopped before completion'
    ELSE error_message
  END,
  created_at, started_at,
  CASE
    WHEN status IN ('queued', 'rendering', 'completed', 'failed')
      OR NOT json_valid(request_json)
      OR substr(ltrim(request_json), 1, 1) <> '{'
      THEN COALESCE(completed_at, started_at, created_at)
    ELSE completed_at
  END,
  idempotency_key, request_hash, NULL, NULL, workspace_id, 'pending', NULL,
  CASE WHEN started_at IS NULL THEN 0 ELSE 1 END,
  5, started_at, NULL, NULL, 0, NULL, NULL,
  COALESCE(completed_at, started_at, created_at)
FROM render_jobs;

DROP TABLE render_outputs;
DROP TABLE render_jobs;
ALTER TABLE render_jobs_v2 RENAME TO render_jobs;

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
  page_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'expired', 'deleted')),
  expires_at TEXT,
  deleted_at TEXT
);

INSERT INTO render_outputs (
  id, render_job_id, output_id, format, r2_key, width, height, bytes,
  checksum, created_at, page_id, status, expires_at, deleted_at
)
SELECT
  id, render_job_id, output_id, format, r2_key, width, height, bytes,
  checksum, created_at, page_id, 'ready', NULL, NULL
FROM render_outputs_migration_backup;

DROP TABLE render_outputs_migration_backup;

CREATE TABLE render_attempts (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL
    CHECK (typeof(attempt_number) = 'integer' AND attempt_number BETWEEN 1 AND 5),
  workflow_instance_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  error_code TEXT,
  error_message TEXT,
  reservation_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (render_job_id, attempt_number)
);

CREATE INDEX idx_render_attempts_job
ON render_attempts(render_job_id, attempt_number DESC);

CREATE INDEX idx_render_jobs_workspace
ON render_jobs(workspace_id, created_at DESC);

CREATE INDEX idx_render_jobs_active
ON render_jobs(status, heartbeat_at)
WHERE status IN ('queued', 'rendering', 'retrying', 'cancelling');

CREATE UNIQUE INDEX idx_render_jobs_idempotency
ON render_jobs(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_render_jobs_workflow_instance
ON render_jobs(workflow_instance_id)
WHERE workflow_instance_id IS NOT NULL;

CREATE UNIQUE INDEX idx_render_outputs_artifact_identity
ON render_outputs(
  render_job_id,
  output_id,
  COALESCE(page_id, ''),
  format
);

PRAGMA defer_foreign_keys = OFF;
