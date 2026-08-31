PRAGMA foreign_keys = ON;

DROP TRIGGER media_derivation_provenance_insert_guard;
DROP TRIGGER media_derivation_provenance_immutable;
DROP TRIGGER media_derivation_attempts_claim_guard;

-- D1 applies migrations inside a foreign-key-enabled transaction. Dropping the
-- parent jobs table therefore cascades immediately; these unconstrained copies
-- preserve every child row until the replacement parent exists.
CREATE TABLE media_derivation_requests_0018_backup AS
SELECT * FROM media_derivation_requests;

CREATE TABLE media_derivation_attempts_0018_backup AS
SELECT * FROM media_derivation_attempts;

CREATE TABLE media_derivation_provenance_0018_backup AS
SELECT * FROM media_derivation_provenance;

DROP TABLE media_derivation_provenance;

CREATE TABLE media_derivation_jobs_v2 (
  id TEXT PRIMARY KEY
    CONSTRAINT chk_media_derivation_jobs_id
    CHECK (
      length(id) BETWEEN 28 AND 96
      AND substr(id, 1, 11) = 'derivation-'
      AND substr(id, 12) NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL,
  source_content_hash TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_source_hash
    CHECK (
      length(source_content_hash) = 64
      AND source_content_hash NOT GLOB '*[^a-f0-9]*'
    ),
  operation TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_operation
    CHECK (operation = 'remove_background'),
  parameters_json TEXT NOT NULL DEFAULT '{}'
    CONSTRAINT chk_media_derivation_jobs_parameters
    CHECK (parameters_json = '{}' AND json_valid(parameters_json)),
  parameters_hash TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_parameters_hash
    CHECK (
      length(parameters_hash) = 64
      AND parameters_hash NOT GLOB '*[^a-f0-9]*'
    ),
  provider_key TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_provider_key
    CHECK (
      length(provider_key) BETWEEN 1 AND 128
      AND substr(provider_key, 1, 1) GLOB '[A-Za-z0-9]'
      AND provider_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  provider_model_version TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_model_version
    CHECK (length(trim(provider_model_version)) BETWEEN 1 AND 200),
  privacy_policy_version TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_policy_version
    CHECK (length(trim(privacy_policy_version)) BETWEEN 1 AND 200),
  request_fingerprint TEXT NOT NULL
    CONSTRAINT chk_media_derivation_jobs_fingerprint
    CHECK (
      length(request_fingerprint) = 64
      AND request_fingerprint NOT GLOB '*[^a-f0-9]*'
    ),
  state TEXT NOT NULL DEFAULT 'queued'
    CONSTRAINT chk_media_derivation_jobs_state
    CHECK (state IN (
      'queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled'
    )),
  output_asset_id TEXT,
  active_attempt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_media_derivation_jobs_attempt_count
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  max_attempts INTEGER NOT NULL
    CONSTRAINT chk_media_derivation_jobs_max_attempts
    CHECK (typeof(max_attempts) = 'integer' AND max_attempts >= 1),
  retryable INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_media_derivation_jobs_retryable
    CHECK (retryable IN (0, 1)),
  safe_failure_code TEXT
    CONSTRAINT chk_media_derivation_jobs_failure_code
    CHECK (
      safe_failure_code IS NULL
      OR (
        length(safe_failure_code) BETWEEN 1 AND 128
        AND substr(safe_failure_code, 1, 1) GLOB '[a-z0-9]'
        AND safe_failure_code NOT GLOB '*[^a-z0-9_-]*'
      )
    ),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancellation_requested_at TEXT,
  updated_at TEXT NOT NULL,
  CONSTRAINT chk_media_derivation_jobs_attempt_budget
    CHECK (attempt_count <= max_attempts),
  CONSTRAINT chk_media_derivation_jobs_output_state
    CHECK ((state = 'succeeded') = (output_asset_id IS NOT NULL)),
  CONSTRAINT chk_media_derivation_jobs_failure_state
    CHECK (
      (state = 'failed' AND safe_failure_code IS NOT NULL)
      OR (state <> 'failed' AND safe_failure_code IS NULL AND retryable = 0)
    ),
  CONSTRAINT chk_media_derivation_jobs_completion_state
    CHECK (
      (state IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NOT NULL)
      OR (state NOT IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NULL)
    ),
  CONSTRAINT chk_media_derivation_jobs_cancellation_state
    CHECK (
      (state IN ('cancelling', 'cancelled') AND cancellation_requested_at IS NOT NULL)
      OR (state NOT IN ('cancelling', 'cancelled') AND cancellation_requested_at IS NULL)
    ),
  CONSTRAINT chk_media_derivation_jobs_active_attempt
    CHECK (
      (state IN ('running', 'cancelling', 'succeeded', 'failed')
        AND active_attempt_id IS NOT NULL AND attempt_count >= 1)
      OR (state = 'queued' AND active_attempt_id IS NULL)
      OR (state = 'cancelled' AND (
        (attempt_count = 0 AND active_attempt_id IS NULL)
        OR (attempt_count >= 1 AND active_attempt_id IS NOT NULL)
      ))
    ),
  CONSTRAINT chk_media_derivation_jobs_started_state
    CHECK (
      (state = 'queued' AND (
        (attempt_count = 0 AND started_at IS NULL)
        OR (attempt_count >= 1 AND started_at IS NOT NULL)
      ))
      OR (state = 'cancelled' AND (
        (attempt_count = 0 AND started_at IS NULL)
        OR (attempt_count >= 1 AND started_at IS NOT NULL)
      ))
      OR (state NOT IN ('queued', 'cancelled') AND started_at IS NOT NULL)
    ),
  CONSTRAINT chk_media_derivation_jobs_timestamps
    CHECK (
      updated_at >= created_at
      AND (started_at IS NULL OR started_at >= created_at)
      AND (completed_at IS NULL OR completed_at >= created_at)
      AND (
        cancellation_requested_at IS NULL
        OR cancellation_requested_at >= created_at
      )
    ),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, id, request_fingerprint),
  UNIQUE (workspace_id, request_fingerprint),
  UNIQUE (
    workspace_id, id, source_asset_id, source_content_hash, operation,
    provider_key, provider_model_version, privacy_policy_version,
    output_asset_id
  ),
  FOREIGN KEY (workspace_id, source_asset_id, source_content_hash)
    REFERENCES media_assets(workspace_id, id, content_hash) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

INSERT INTO media_derivation_jobs_v2
  (id, workspace_id, source_asset_id, source_content_hash, operation,
   parameters_json, parameters_hash, provider_key, provider_model_version,
   privacy_policy_version, request_fingerprint, state, output_asset_id,
   active_attempt_id, attempt_count, max_attempts, retryable,
   safe_failure_code, created_at, started_at, completed_at,
   cancellation_requested_at, updated_at)
SELECT id, workspace_id, source_asset_id, source_content_hash, operation,
       parameters_json, parameters_hash, provider_key, provider_model_version,
       privacy_policy_version, request_fingerprint, state, output_asset_id,
       active_attempt_id, attempt_count, max_attempts, retryable,
       safe_failure_code, created_at, started_at, completed_at,
       cancellation_requested_at, updated_at
FROM media_derivation_jobs;

DROP TABLE media_derivation_jobs;
ALTER TABLE media_derivation_jobs_v2 RENAME TO media_derivation_jobs;

INSERT INTO media_derivation_requests
SELECT * FROM media_derivation_requests_0018_backup;

INSERT INTO media_derivation_attempts
SELECT * FROM media_derivation_attempts_0018_backup;

CREATE TABLE media_derivation_provenance (
  workspace_id TEXT NOT NULL,
  output_asset_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  source_content_hash TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_source_hash
    CHECK (
      length(source_content_hash) = 64
      AND source_content_hash NOT GLOB '*[^a-f0-9]*'
    ),
  derivation_job_id TEXT NOT NULL,
  operation TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_operation
    CHECK (operation = 'remove_background'),
  provider_key TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_provider_key
    CHECK (
      length(provider_key) BETWEEN 1 AND 128
      AND substr(provider_key, 1, 1) GLOB '[A-Za-z0-9]'
      AND provider_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  provider_model_version TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_model_version
    CHECK (length(trim(provider_model_version)) BETWEEN 1 AND 200),
  privacy_policy_version TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_policy_version
    CHECK (length(trim(privacy_policy_version)) BETWEEN 1 AND 200),
  output_content_hash TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_output_hash
    CHECK (
      length(output_content_hash) = 64
      AND output_content_hash NOT GLOB '*[^a-f0-9]*'
    ),
  output_media_type TEXT NOT NULL
    CONSTRAINT chk_media_derivation_provenance_media_type
    CHECK (output_media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  output_width INTEGER NOT NULL
    CONSTRAINT chk_media_derivation_provenance_width
    CHECK (typeof(output_width) = 'integer' AND output_width BETWEEN 1 AND 16384),
  output_height INTEGER NOT NULL
    CONSTRAINT chk_media_derivation_provenance_height
    CHECK (typeof(output_height) = 'integer' AND output_height BETWEEN 1 AND 16384),
  created_at TEXT NOT NULL,
  CONSTRAINT chk_media_derivation_provenance_distinct_assets
    CHECK (source_asset_id <> output_asset_id),
  CONSTRAINT chk_media_derivation_provenance_pixel_area
    CHECK (output_width * output_height <= 100000000),
  PRIMARY KEY (workspace_id, derivation_job_id),
  FOREIGN KEY (workspace_id, source_asset_id, source_content_hash)
    REFERENCES media_assets(workspace_id, id, content_hash) ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id, output_asset_id, output_content_hash, output_media_type,
    output_width, output_height
  ) REFERENCES media_assets(
    workspace_id, id, content_hash, media_type, width, height
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id, derivation_job_id, source_asset_id, source_content_hash,
    operation, provider_key, provider_model_version, privacy_policy_version,
    output_asset_id
  ) REFERENCES media_derivation_jobs(
    workspace_id, id, source_asset_id, source_content_hash, operation,
    provider_key, provider_model_version, privacy_policy_version,
    output_asset_id
  ) ON DELETE CASCADE
);

INSERT INTO media_derivation_provenance
SELECT * FROM media_derivation_provenance_0018_backup;

DROP TABLE media_derivation_requests_0018_backup;
DROP TABLE media_derivation_attempts_0018_backup;
DROP TABLE media_derivation_provenance_0018_backup;

CREATE TRIGGER media_derivation_jobs_legal_state_transition
BEFORE UPDATE OF state ON media_derivation_jobs
WHEN OLD.state <> NEW.state AND NOT (
  (OLD.state = 'queued' AND NEW.state IN ('running', 'cancelled'))
  OR (OLD.state = 'running'
    AND NEW.state IN ('succeeded', 'failed', 'cancelling'))
  OR (OLD.state = 'cancelling' AND NEW.state = 'cancelled')
  OR (OLD.state = 'failed' AND NEW.state = 'queued')
)
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_job_transition_invalid');
END;

CREATE TRIGGER media_derivation_jobs_identity_immutable
BEFORE UPDATE OF
  workspace_id, source_asset_id, source_content_hash, operation,
  parameters_json, parameters_hash, provider_key, provider_model_version,
  privacy_policy_version, request_fingerprint, max_attempts, created_at
ON media_derivation_jobs
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_job_identity_immutable');
END;

CREATE TRIGGER media_derivation_jobs_attempt_fence_guard
BEFORE UPDATE OF state, active_attempt_id, attempt_count
ON media_derivation_jobs
WHEN NOT (
  (OLD.state = 'queued' AND NEW.state = 'running'
    AND OLD.active_attempt_id IS NULL
    AND NEW.active_attempt_id IS NOT NULL
    AND NEW.attempt_count = OLD.attempt_count + 1)
  OR (OLD.state = 'failed' AND NEW.state = 'queued'
    AND OLD.active_attempt_id IS NOT NULL
    AND NEW.active_attempt_id IS NULL
    AND NEW.attempt_count = OLD.attempt_count)
  OR (NEW.attempt_count = OLD.attempt_count
    AND NEW.active_attempt_id IS OLD.active_attempt_id)
)
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_job_attempt_fence_invalid');
END;

CREATE TRIGGER media_derivation_jobs_settlement_immutable
BEFORE UPDATE ON media_derivation_jobs
WHEN OLD.state IN ('succeeded', 'cancelled')
  OR (OLD.state = 'failed' AND NEW.state <> 'queued')
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_job_settlement_immutable');
END;

CREATE TRIGGER media_derivation_attempts_claim_guard
BEFORE INSERT ON media_derivation_attempts
WHEN NEW.state <> 'running' OR NOT EXISTS (
    SELECT 1 FROM media_derivation_jobs jobs
    WHERE jobs.workspace_id = NEW.workspace_id
      AND jobs.id = NEW.job_id
      AND jobs.state = 'running'
      AND jobs.active_attempt_id = NEW.id
      AND jobs.attempt_count = NEW.attempt_number
  )
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_attempt_claim_invalid');
END;

CREATE TRIGGER media_derivation_provenance_insert_guard
BEFORE INSERT ON media_derivation_provenance
WHEN NOT EXISTS (
  SELECT 1 FROM media_derivation_jobs jobs
  WHERE jobs.workspace_id = NEW.workspace_id
    AND jobs.id = NEW.derivation_job_id
    AND jobs.state = 'succeeded'
    AND jobs.output_asset_id = NEW.output_asset_id
)
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_provenance_job_not_succeeded');
END;

CREATE TRIGGER media_derivation_provenance_immutable
BEFORE UPDATE ON media_derivation_provenance
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_provenance_immutable');
END;

CREATE INDEX idx_media_derivation_provenance_output
ON media_derivation_provenance(workspace_id, output_asset_id, created_at, derivation_job_id);

CREATE INDEX idx_media_derivation_provenance_source
ON media_derivation_provenance(workspace_id, source_asset_id, created_at DESC);

CREATE INDEX idx_media_derivation_jobs_workspace_created
ON media_derivation_jobs(workspace_id, created_at DESC, id DESC);

CREATE INDEX idx_media_derivation_jobs_active
ON media_derivation_jobs(workspace_id, state, updated_at, id)
WHERE state IN ('queued', 'running', 'cancelling');

PRAGMA foreign_keys = ON;
