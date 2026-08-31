PRAGMA foreign_keys = ON;

CREATE TABLE media_asset_catalog_metadata (
  workspace_id TEXT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  description TEXT NOT NULL
    CONSTRAINT chk_media_asset_catalog_description
    CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  tags_json TEXT NOT NULL DEFAULT '[]'
    CONSTRAINT chk_media_asset_catalog_tags
    CHECK (
      json_valid(tags_json)
      AND json_type(tags_json) = 'array'
      AND json_array_length(tags_json) <= 50
    ),
  category_id TEXT NOT NULL DEFAULT 'workspace-upload'
    CONSTRAINT chk_media_asset_catalog_category
    CHECK (
      length(category_id) BETWEEN 1 AND 200
      AND substr(category_id, 1, 1) GLOB '[a-z0-9]'
      AND category_id NOT GLOB '*[^a-z0-9_-]*'
    ),
  use_case_ids_json TEXT NOT NULL DEFAULT '[]'
    CONSTRAINT chk_media_asset_catalog_use_cases
    CHECK (
      json_valid(use_case_ids_json)
      AND json_type(use_case_ids_json) = 'array'
      AND json_array_length(use_case_ids_json) <= 30
    ),
  provenance_source_name TEXT NOT NULL DEFAULT 'Workspace upload'
    CONSTRAINT chk_media_asset_catalog_source_name
    CHECK (length(trim(provenance_source_name)) BETWEEN 1 AND 200),
  provenance_source_url TEXT
    CONSTRAINT chk_media_asset_catalog_source_url
    CHECK (
      provenance_source_url IS NULL
      OR (
        length(provenance_source_url) BETWEEN 8 AND 2048
        AND (
          substr(provenance_source_url, 1, 7) = 'http://'
          OR substr(provenance_source_url, 1, 8) = 'https://'
        )
      )
    ),
  license_id TEXT NOT NULL DEFAULT 'customer-provided'
    CONSTRAINT chk_media_asset_catalog_license_id
    CHECK (
      length(license_id) BETWEEN 1 AND 200
      AND substr(license_id, 1, 1) GLOB '[a-z0-9]'
      AND license_id NOT GLOB '*[^a-z0-9_-]*'
    ),
  license_name TEXT NOT NULL DEFAULT 'Customer-provided; rights not verified'
    CONSTRAINT chk_media_asset_catalog_license_name
    CHECK (length(trim(license_name)) BETWEEN 1 AND 200),
  license_url TEXT
    CONSTRAINT chk_media_asset_catalog_license_url
    CHECK (
      license_url IS NULL
      OR (
        length(license_url) BETWEEN 8 AND 2048
        AND (
          substr(license_url, 1, 7) = 'http://'
          OR substr(license_url, 1, 8) = 'https://'
        )
      )
    ),
  attribution_required INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_media_asset_catalog_attribution_required
    CHECK (attribution_required IN (0, 1)),
  attribution_text TEXT
    CONSTRAINT chk_media_asset_catalog_attribution_text
    CHECK (
      attribution_text IS NULL
      OR length(trim(attribution_text)) BETWEEN 1 AND 500
    ),
  catalog_version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT chk_media_asset_catalog_version
    CHECK (typeof(catalog_version) = 'integer' AND catalog_version >= 1),
  created_at TEXT NOT NULL
    CONSTRAINT chk_media_asset_catalog_created_at
    CHECK (length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL
    CONSTRAINT chk_media_asset_catalog_updated_at
    CHECK (length(trim(updated_at)) BETWEEN 1 AND 64),
  CONSTRAINT chk_media_asset_catalog_attribution
    CHECK (attribution_required = 0 OR attribution_text IS NOT NULL),
  CONSTRAINT chk_media_asset_catalog_timestamps CHECK (updated_at >= created_at),
  PRIMARY KEY (workspace_id, asset_id),
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_media_asset_catalog_category
ON media_asset_catalog_metadata(workspace_id, category_id, asset_id);

CREATE TABLE media_asset_catalog_state (
  workspace_id TEXT PRIMARY KEY
    REFERENCES workspaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_media_asset_catalog_state_revision
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  updated_at TEXT NOT NULL
    CONSTRAINT chk_media_asset_catalog_state_updated_at
    CHECK (length(trim(updated_at)) BETWEEN 1 AND 64)
);

INSERT INTO media_asset_catalog_metadata (
  workspace_id,
  asset_id,
  description,
  tags_json,
  category_id,
  use_case_ids_json,
  provenance_source_name,
  provenance_source_url,
  license_id,
  license_name,
  license_url,
  attribution_required,
  attribution_text,
  catalog_version,
  created_at,
  updated_at
)
SELECT
  workspace_id,
  id,
  'Customer-provided workspace upload',
  '[]',
  'workspace-upload',
  '[]',
  'Workspace upload',
  NULL,
  'customer-provided',
  'Customer-provided; rights not verified',
  NULL,
  0,
  NULL,
  1,
  created_at,
  updated_at
FROM media_assets;

INSERT INTO media_asset_catalog_state (workspace_id, revision, updated_at)
SELECT workspace_id, 1, MAX(updated_at)
FROM media_assets
GROUP BY workspace_id;

CREATE TRIGGER media_asset_catalog_metadata_after_asset_insert
AFTER INSERT ON media_assets
BEGIN
  INSERT INTO media_asset_catalog_metadata (
    workspace_id,
    asset_id,
    description,
    tags_json,
    category_id,
    use_case_ids_json,
    provenance_source_name,
    provenance_source_url,
    license_id,
    license_name,
    license_url,
    attribution_required,
    attribution_text,
    catalog_version,
    created_at,
    updated_at
  ) VALUES (
    NEW.workspace_id,
    NEW.id,
    'Customer-provided workspace upload',
    '[]',
    'workspace-upload',
    '[]',
    'Workspace upload',
    NULL,
    'customer-provided',
    'Customer-provided; rights not verified',
    NULL,
    0,
    NULL,
    1,
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER media_asset_catalog_state_after_metadata_insert
AFTER INSERT ON media_asset_catalog_metadata
BEGIN
  INSERT INTO media_asset_catalog_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER media_asset_catalog_state_after_metadata_update
AFTER UPDATE ON media_asset_catalog_metadata
WHEN
  OLD.description IS NOT NEW.description
  OR OLD.tags_json IS NOT NEW.tags_json
  OR OLD.category_id IS NOT NEW.category_id
  OR OLD.use_case_ids_json IS NOT NEW.use_case_ids_json
  OR OLD.provenance_source_name IS NOT NEW.provenance_source_name
  OR OLD.provenance_source_url IS NOT NEW.provenance_source_url
  OR OLD.license_id IS NOT NEW.license_id
  OR OLD.license_name IS NOT NEW.license_name
  OR OLD.license_url IS NOT NEW.license_url
  OR OLD.attribution_required IS NOT NEW.attribution_required
  OR OLD.attribution_text IS NOT NEW.attribution_text
  OR OLD.catalog_version IS NOT NEW.catalog_version
BEGIN
  INSERT INTO media_asset_catalog_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER media_asset_catalog_state_after_asset_visibility_update
AFTER UPDATE OF name, status ON media_assets
WHEN OLD.name IS NOT NEW.name OR OLD.status IS NOT NEW.status
BEGIN
  UPDATE media_asset_catalog_metadata
  SET catalog_version = catalog_version + 1,
      updated_at = NEW.updated_at
  WHERE workspace_id = NEW.workspace_id AND asset_id = NEW.id;
END;

CREATE TRIGGER media_asset_catalog_state_after_metadata_delete
AFTER DELETE ON media_asset_catalog_metadata
WHEN EXISTS (
  SELECT 1 FROM workspaces WHERE id = OLD.workspace_id
)
BEGIN
  INSERT INTO media_asset_catalog_state (workspace_id, revision, updated_at)
  VALUES (
    OLD.workspace_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;
