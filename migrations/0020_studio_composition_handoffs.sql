PRAGMA foreign_keys = ON;

CREATE TABLE studio_composition_handoffs (
  token_hash TEXT PRIMARY KEY
    CONSTRAINT chk_studio_composition_handoffs_token_hash
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^a-f0-9]*'
    ),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL
    CONSTRAINT chk_studio_composition_handoffs_revision
    CHECK (source_revision >= 0),
  request_json TEXT NOT NULL
    CONSTRAINT chk_studio_composition_handoffs_request
    CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  claimed_workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_studio_composition_handoffs_expiry
ON studio_composition_handoffs(expires_at);

CREATE INDEX idx_studio_composition_handoffs_source
ON studio_composition_handoffs(source_kind, source_id, source_revision);

CREATE TRIGGER studio_composition_handoffs_source_immutable
BEFORE UPDATE OF token_hash, source_kind, source_id, source_revision,
  request_json, expires_at, created_at
ON studio_composition_handoffs
BEGIN
  SELECT RAISE(ABORT, 'studio_composition_handoff_immutable');
END;

CREATE TRIGGER studio_composition_handoffs_claim_once
BEFORE UPDATE OF claimed_workspace_id
ON studio_composition_handoffs
WHEN (
  OLD.claimed_workspace_id IS NOT NULL
  AND NEW.claimed_workspace_id <> OLD.claimed_workspace_id
) OR NEW.claimed_workspace_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'studio_composition_handoff_claim_invalid');
END;
