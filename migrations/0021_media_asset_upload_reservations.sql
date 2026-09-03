PRAGMA foreign_keys = ON;

CREATE TABLE media_asset_upload_reservations (
  id TEXT PRIMARY KEY
    CONSTRAINT chk_media_asset_upload_reservations_id
    CHECK (
      length(id) BETWEEN 20 AND 96
      AND substr(id, 1, 7) = 'upload-'
      AND substr(id, 8) NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  token_hash TEXT NOT NULL UNIQUE
    CONSTRAINT chk_media_asset_upload_reservations_token_hash
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^a-f0-9]*'
    ),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  budget_key TEXT NOT NULL
    CONSTRAINT chk_media_asset_upload_reservations_budget_key
    CHECK (length(trim(budget_key)) BETWEEN 1 AND 255),
  name TEXT NOT NULL
    CONSTRAINT chk_media_asset_upload_reservations_name
    CHECK (length(trim(name)) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL
    CONSTRAINT chk_media_asset_upload_reservations_media_type
    CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  expected_bytes INTEGER NOT NULL
    CONSTRAINT chk_media_asset_upload_reservations_bytes
    CHECK (typeof(expected_bytes) = 'integer' AND expected_bytes BETWEEN 1 AND 25000000),
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_media_asset_upload_reservations_idempotency
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claim_expires_at TEXT,
  consumed_at TEXT,
  asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  CONSTRAINT chk_media_asset_upload_reservations_consumed
    CHECK (
      (consumed_at IS NULL AND asset_id IS NULL)
      OR (consumed_at IS NOT NULL AND asset_id IS NOT NULL)
    )
);

CREATE INDEX idx_media_asset_upload_reservations_expiry
ON media_asset_upload_reservations(expires_at);

CREATE INDEX idx_media_asset_upload_reservations_workspace
ON media_asset_upload_reservations(workspace_id, created_at DESC);
