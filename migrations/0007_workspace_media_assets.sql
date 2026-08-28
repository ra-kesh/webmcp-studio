PRAGMA foreign_keys = ON;

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY
    CONSTRAINT chk_media_assets_id
    CHECK (
      length(id) BETWEEN 16 AND 96
      AND substr(id, 1, 6) = 'asset-'
      AND substr(id, 7) NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL
    CONSTRAINT chk_media_assets_name
    CHECK (length(trim(name)) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL
    CONSTRAINT chk_media_assets_media_type
    CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL
    CONSTRAINT chk_media_assets_bytes
    CHECK (typeof(bytes) = 'integer' AND bytes BETWEEN 1 AND 25000000),
  width INTEGER NOT NULL
    CONSTRAINT chk_media_assets_width
    CHECK (typeof(width) = 'integer' AND width BETWEEN 1 AND 16384),
  height INTEGER NOT NULL
    CONSTRAINT chk_media_assets_height
    CHECK (typeof(height) = 'integer' AND height BETWEEN 1 AND 16384),
  content_hash TEXT NOT NULL
    CONSTRAINT chk_media_assets_content_hash
    CHECK (
      length(content_hash) = 64
      AND content_hash NOT GLOB '*[^a-f0-9]*'
    ),
  r2_key TEXT NOT NULL
    CONSTRAINT chk_media_assets_r2_key
    CHECK (length(trim(r2_key)) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'ready'
    CONSTRAINT chk_media_assets_status
    CHECK (status IN ('ready', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1
    CONSTRAINT chk_media_assets_revision
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  archived_at TEXT,
  CONSTRAINT chk_media_assets_pixel_area
    CHECK (width * height <= 100000000),
  UNIQUE (workspace_id, content_hash),
  UNIQUE (workspace_id, id),
  UNIQUE (r2_key)
);

CREATE TABLE media_asset_references (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  reference_kind TEXT NOT NULL
    CONSTRAINT chk_media_asset_references_kind
    CHECK (reference_kind IN ('current_document', 'published_version')),
  source_id TEXT NOT NULL,
  reference_key TEXT NOT NULL,
  document_id TEXT NOT NULL,
  page_id TEXT,
  node_id TEXT,
  field_id TEXT,
  property TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, reference_kind, source_id, reference_key),
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE media_asset_upload_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL
    CONSTRAINT chk_media_asset_upload_request_hash
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^a-f0-9]*'
    ),
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key)
);

CREATE INDEX idx_media_assets_workspace_created
ON media_assets(workspace_id, status, created_at DESC, id DESC);

CREATE INDEX idx_media_assets_workspace_recent
ON media_assets(workspace_id, status, last_used_at DESC, id DESC);

CREATE INDEX idx_media_assets_workspace_name
ON media_assets(workspace_id, status, name COLLATE NOCASE);

CREATE INDEX idx_media_asset_references_asset
ON media_asset_references(workspace_id, asset_id, reference_kind);

CREATE INDEX idx_media_asset_references_source
ON media_asset_references(workspace_id, reference_kind, source_id);
