PRAGMA foreign_keys = ON;

CREATE TABLE media_derivation_mutation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_media_derivation_mutation_receipts_key
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  job_id TEXT NOT NULL,
  action TEXT NOT NULL
    CONSTRAINT chk_media_derivation_mutation_receipts_action
    CHECK (action IN ('cancel', 'retry')),
  request_hash TEXT NOT NULL
    CONSTRAINT chk_media_derivation_mutation_receipts_hash
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^a-f0-9]*'
    ),
  result_json TEXT NOT NULL
    CONSTRAINT chk_media_derivation_mutation_receipts_result
    CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  dispatch_state TEXT NOT NULL
    CONSTRAINT chk_media_derivation_mutation_receipts_dispatch
    CHECK (
      (action = 'cancel' AND dispatch_state = 'not_required')
      OR (action = 'retry' AND dispatch_state IN ('pending', 'dispatched'))
    ),
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES media_derivation_jobs(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_media_derivation_mutation_receipts_dispatched_at
    CHECK ((dispatch_state = 'dispatched') = (dispatched_at IS NOT NULL))
);

CREATE TRIGGER media_derivation_mutation_receipts_identity_immutable
BEFORE UPDATE OF workspace_id, idempotency_key, job_id, action, request_hash,
  result_json, created_at
ON media_derivation_mutation_receipts
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_mutation_receipt_immutable');
END;

CREATE TRIGGER media_derivation_mutation_receipts_dispatch_guard
BEFORE UPDATE OF dispatch_state, dispatched_at
ON media_derivation_mutation_receipts
WHEN NOT (
  OLD.action = 'retry'
  AND OLD.dispatch_state = 'pending'
  AND OLD.dispatched_at IS NULL
  AND NEW.dispatch_state = 'dispatched'
  AND NEW.dispatched_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'media_derivation_mutation_dispatch_invalid');
END;

CREATE INDEX idx_media_derivation_mutation_receipts_job
ON media_derivation_mutation_receipts(workspace_id, job_id, created_at);
