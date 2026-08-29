PRAGMA foreign_keys = ON;

CREATE TABLE media_asset_local_promotions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  local_asset_id TEXT NOT NULL
    CONSTRAINT chk_media_asset_local_promotions_local_id
    CHECK (
      length(local_asset_id) BETWEEN 1 AND 128
      AND substr(local_asset_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND local_asset_id NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL
    CONSTRAINT chk_media_asset_local_promotions_created_by
    CHECK (length(trim(created_by)) BETWEEN 1 AND 255),
  PRIMARY KEY (workspace_id, local_asset_id),
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_media_asset_local_promotions_asset
ON media_asset_local_promotions(workspace_id, asset_id);
