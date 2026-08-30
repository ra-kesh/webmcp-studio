PRAGMA foreign_keys = ON;

CREATE TABLE media_asset_use_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_media_asset_use_requests_key
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  request_hash TEXT NOT NULL
    CONSTRAINT chk_media_asset_use_requests_hash
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^a-f0-9]*'
    ),
  asset_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  result_revision INTEGER NOT NULL
    CONSTRAINT chk_media_asset_use_requests_result_revision
    CHECK (typeof(result_revision) = 'integer' AND result_revision >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_media_asset_use_requests_asset
ON media_asset_use_requests(workspace_id, asset_id, used_at DESC);
