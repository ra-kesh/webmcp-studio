PRAGMA foreign_keys = ON;

-- Media source is part of immutable catalog identity. Rebuild the two tables
-- whose original primary keys predated managed-media catalog composition.
-- Template rows retain the literal `template` source. Existing media rows are
-- classified as managed only when their exact D1 catalog identity exists and
-- no immutable Studio item owns that same id/version. That preserves the old
-- curated-first detail semantics for the only inherently ambiguous legacy
-- case while retaining ordinary managed preferences and collection members.

DROP TRIGGER library_mutation_requests_claim_guard;

CREATE TABLE library_item_preferences_source_identity (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL CHECK (length(trim(principal_id)) BETWEEN 1 AND 255),
  item_kind TEXT NOT NULL CHECK (item_kind IN ('template', 'media')),
  item_source TEXT NOT NULL CHECK (
    (item_kind = 'template' AND item_source = 'template')
    OR (item_kind = 'media' AND item_source IN ('curated', 'managed', 'local'))
  ),
  item_id TEXT NOT NULL CHECK (
    length(item_id) BETWEEN 1 AND 200
    AND substr(item_id, 1, 1) GLOB '[A-Za-z0-9]'
    AND item_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  item_version INTEGER NOT NULL CHECK (
    typeof(item_version) = 'integer' AND item_version >= 1
  ),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_used_at TEXT CHECK (
    last_used_at IS NULL OR length(trim(last_used_at)) BETWEEN 1 AND 64
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision >= 1
  ),
  last_mutation_key TEXT NOT NULL CHECK (
    length(last_mutation_key) BETWEEN 1 AND 128
    AND last_mutation_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  last_mutation_operation TEXT NOT NULL CHECK (
    last_mutation_operation IN ('set_favorite', 'record_used')
  ),
  last_mutation_hash TEXT NOT NULL CHECK (
    length(last_mutation_hash) = 64
    AND last_mutation_hash NOT GLOB '*[^a-f0-9]*'
  ),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) BETWEEN 1 AND 64),
  CHECK (
    updated_at >= created_at
    AND (last_used_at IS NULL OR last_used_at <= updated_at)
  ),
  PRIMARY KEY (
    workspace_id, principal_id, item_kind, item_source, item_id, item_version
  )
);

INSERT INTO library_item_preferences_source_identity (
  workspace_id, principal_id, item_kind, item_source, item_id, item_version,
  favorite, last_used_at, revision, last_mutation_key,
  last_mutation_operation, last_mutation_hash, created_at, updated_at
)
SELECT
  preference.workspace_id,
  preference.principal_id,
  preference.item_kind,
  CASE
    WHEN preference.item_kind = 'template' THEN 'template'
    WHEN EXISTS (
      SELECT 1 FROM media_asset_catalog_metadata AS metadata
      WHERE metadata.workspace_id = preference.workspace_id
        AND metadata.asset_id = preference.item_id
        AND metadata.catalog_version = preference.item_version
    ) AND NOT (
      (preference.item_id IN (
        'olive-botanical', 'sandstone-arches', 'linen-paper', 'dusk-blocks',
        'floral-linework', 'warm-grain'
      ) AND preference.item_version IN (1, 2))
      OR (preference.item_id IN (
        'cherry-blossom', 'hibiscus', 'sunflower', 'seedling', 'herb',
        'rocket', 'star', 'sparkles', 'confetti-ball', 'wrapped-gift',
        'bullseye', 'artist-palette', 'megaphone', 'camera', 'video-camera',
        'light-bulb', 'envelope', 'calendar', 'chart-increasing',
        'round-pushpin', 'check-mark-button', 'speech-balloon',
        'globe-americas', 'ring', 'dordogne-valley', 'marmolada-snow',
        'oahu-rainforest-panorama', 'silver-water-waves',
        'metal-water-drops', 'sunlit-yellow-textile',
        'spring-daffodil-field'
      ) AND preference.item_version = 1)
    ) THEN 'managed'
    ELSE 'curated'
  END,
  preference.item_id,
  preference.item_version,
  preference.favorite,
  preference.last_used_at,
  preference.revision,
  preference.last_mutation_key,
  preference.last_mutation_operation,
  preference.last_mutation_hash,
  preference.created_at,
  preference.updated_at
FROM library_item_preferences AS preference;

DROP TABLE library_item_preferences;
ALTER TABLE library_item_preferences_source_identity
  RENAME TO library_item_preferences;

CREATE INDEX idx_library_item_preferences_favorite
ON library_item_preferences(
  workspace_id, principal_id, favorite, updated_at DESC,
  item_kind, item_source, item_id, item_version
);

CREATE INDEX idx_library_item_preferences_recent
ON library_item_preferences(
  workspace_id, principal_id, last_used_at DESC,
  item_kind, item_source, item_id, item_version
)
WHERE last_used_at IS NOT NULL;

CREATE TABLE library_collection_members_source_identity (
  workspace_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('template', 'media')),
  item_source TEXT NOT NULL CHECK (
    (item_kind = 'template' AND item_source = 'template')
    OR (item_kind = 'media' AND item_source IN ('curated', 'managed', 'local'))
  ),
  item_id TEXT NOT NULL CHECK (
    length(item_id) BETWEEN 1 AND 200
    AND substr(item_id, 1, 1) GLOB '[A-Za-z0-9]'
    AND item_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  item_version INTEGER NOT NULL CHECK (
    typeof(item_version) = 'integer' AND item_version >= 1
  ),
  position INTEGER NOT NULL CHECK (
    typeof(position) = 'integer' AND position >= 0
  ),
  added_at TEXT NOT NULL CHECK (length(trim(added_at)) BETWEEN 1 AND 64),
  PRIMARY KEY (
    workspace_id, collection_id, item_kind, item_source, item_id, item_version
  ),
  UNIQUE (workspace_id, collection_id, position),
  FOREIGN KEY (workspace_id, collection_id)
    REFERENCES library_collections(workspace_id, id) ON DELETE CASCADE
);

INSERT INTO library_collection_members_source_identity (
  workspace_id, collection_id, item_kind, item_source, item_id, item_version,
  position, added_at
)
SELECT
  member.workspace_id,
  member.collection_id,
  member.item_kind,
  CASE
    WHEN member.item_kind = 'template' THEN 'template'
    WHEN EXISTS (
      SELECT 1 FROM media_asset_catalog_metadata AS metadata
      WHERE metadata.workspace_id = member.workspace_id
        AND metadata.asset_id = member.item_id
        AND metadata.catalog_version = member.item_version
    ) AND NOT (
      (member.item_id IN (
        'olive-botanical', 'sandstone-arches', 'linen-paper', 'dusk-blocks',
        'floral-linework', 'warm-grain'
      ) AND member.item_version IN (1, 2))
      OR (member.item_id IN (
        'cherry-blossom', 'hibiscus', 'sunflower', 'seedling', 'herb',
        'rocket', 'star', 'sparkles', 'confetti-ball', 'wrapped-gift',
        'bullseye', 'artist-palette', 'megaphone', 'camera', 'video-camera',
        'light-bulb', 'envelope', 'calendar', 'chart-increasing',
        'round-pushpin', 'check-mark-button', 'speech-balloon',
        'globe-americas', 'ring', 'dordogne-valley', 'marmolada-snow',
        'oahu-rainforest-panorama', 'silver-water-waves',
        'metal-water-drops', 'sunlit-yellow-textile',
        'spring-daffodil-field'
      ) AND member.item_version = 1)
    ) THEN 'managed'
    ELSE 'curated'
  END,
  member.item_id,
  member.item_version,
  member.position,
  member.added_at
FROM library_collection_members AS member;

DROP TABLE library_collection_members;
ALTER TABLE library_collection_members_source_identity
  RENAME TO library_collection_members;

CREATE INDEX idx_library_collection_members_item
ON library_collection_members(
  workspace_id, item_kind, item_source, item_id, item_version, collection_id
);

-- Existing successful mutation receipts were hashed before mediaSource became
-- part of request identity. Preserve those hashes as immutable evidence, but
-- migrate every media identity in the receipt and result metadata. Runtime
-- replay accepts the old hash only after checking the migrated source-aware
-- receipt against the caller's exact source. This retains legitimate replay,
-- rejects same-key wrong-source requests, and keeps target claim hashes equal
-- to their request rows without pretending SQLite can recompute SHA-256.
CREATE TABLE library_media_identity_source_migration (
  workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_version INTEGER NOT NULL,
  item_source TEXT NOT NULL DEFAULT 'curated'
    CHECK (item_source IN ('curated', 'managed')),
  PRIMARY KEY (workspace_id, item_id, item_version)
);

INSERT OR IGNORE INTO library_media_identity_source_migration
  (workspace_id, item_id, item_version)
SELECT workspace_id, item_id, item_version
FROM library_item_preferences
WHERE item_kind = 'media';

INSERT OR IGNORE INTO library_media_identity_source_migration
  (workspace_id, item_id, item_version)
SELECT workspace_id, item_id, item_version
FROM library_collection_members
WHERE item_kind = 'media';

INSERT OR IGNORE INTO library_media_identity_source_migration
  (workspace_id, item_id, item_version)
SELECT
  workspace_id,
  json_extract(response_json, '$.preference.identity.id'),
  json_extract(response_json, '$.preference.identity.version')
FROM library_mutation_requests
WHERE json_extract(response_json, '$.preference.identity.itemKind') = 'media';

INSERT OR IGNORE INTO library_media_identity_source_migration
  (workspace_id, item_id, item_version)
SELECT
  workspace_id,
  json_extract(response_json, '$.identity.id'),
  json_extract(response_json, '$.identity.version')
FROM library_mutation_requests
WHERE json_extract(response_json, '$.identity.itemKind') = 'media';

INSERT OR IGNORE INTO library_media_identity_source_migration
  (workspace_id, item_id, item_version)
SELECT
  request.workspace_id,
  json_extract(member.value, '$.id'),
  json_extract(member.value, '$.version')
FROM library_mutation_requests AS request,
     json_each(request.response_json, '$.collection.members') AS member
WHERE json_extract(member.value, '$.itemKind') = 'media';

UPDATE library_media_identity_source_migration AS identity
SET item_source = 'managed'
WHERE EXISTS (
  SELECT 1 FROM media_asset_catalog_metadata AS metadata
  WHERE metadata.workspace_id = identity.workspace_id
    AND metadata.asset_id = identity.item_id
    AND metadata.catalog_version = identity.item_version
)
AND NOT (
  (identity.item_id IN (
    'olive-botanical', 'sandstone-arches', 'linen-paper', 'dusk-blocks',
    'floral-linework', 'warm-grain'
  ) AND identity.item_version IN (1, 2))
  OR (identity.item_id IN (
    'cherry-blossom', 'hibiscus', 'sunflower', 'seedling', 'herb',
    'rocket', 'star', 'sparkles', 'confetti-ball', 'wrapped-gift',
    'bullseye', 'artist-palette', 'megaphone', 'camera', 'video-camera',
    'light-bulb', 'envelope', 'calendar', 'chart-increasing',
    'round-pushpin', 'check-mark-button', 'speech-balloon',
    'globe-americas', 'ring', 'dordogne-valley', 'marmolada-snow',
    'oahu-rainforest-panorama', 'silver-water-waves',
    'metal-water-drops', 'sunlit-yellow-textile',
    'spring-daffodil-field'
  ) AND identity.item_version = 1)
);

UPDATE library_mutation_requests AS request
SET response_json = json_set(
  response_json,
  '$.preference.identity.mediaSource',
  (
    SELECT identity.item_source
    FROM library_media_identity_source_migration AS identity
    WHERE identity.workspace_id = request.workspace_id
      AND identity.item_id =
        json_extract(request.response_json, '$.preference.identity.id')
      AND identity.item_version =
        json_extract(request.response_json, '$.preference.identity.version')
  )
)
WHERE json_extract(response_json, '$.preference.identity.itemKind') = 'media';

UPDATE library_mutation_requests AS request
SET response_json = json_set(
  response_json,
  '$.identity.mediaSource',
  (
    SELECT identity.item_source
    FROM library_media_identity_source_migration AS identity
    WHERE identity.workspace_id = request.workspace_id
      AND identity.item_id = json_extract(request.response_json, '$.identity.id')
      AND identity.item_version =
        json_extract(request.response_json, '$.identity.version')
  )
)
WHERE json_extract(response_json, '$.identity.itemKind') = 'media';

UPDATE library_mutation_requests AS request
SET response_json = json_set(
  response_json,
  '$.collection.members',
  json(COALESCE((
    SELECT json_group_array(json(
      CASE
        WHEN json_extract(member.value, '$.itemKind') = 'media' THEN
          json_set(
            member.value,
            '$.mediaSource',
            (
              SELECT identity.item_source
              FROM library_media_identity_source_migration AS identity
              WHERE identity.workspace_id = request.workspace_id
                AND identity.item_id = json_extract(member.value, '$.id')
                AND identity.item_version =
                  json_extract(member.value, '$.version')
            )
          )
        ELSE member.value
      END
    ))
    FROM json_each(request.response_json, '$.collection.members') AS member
  ), '[]'))
)
WHERE json_type(response_json, '$.collection.members') = 'array';

UPDATE library_mutation_requests AS request
SET result_identity =
  'media:' ||
  json_extract(response_json, '$.preference.identity.mediaSource') || ':' ||
  json_extract(response_json, '$.preference.identity.id') || '@' ||
  json_extract(response_json, '$.preference.identity.version')
WHERE result_kind = 'preference'
  AND json_extract(response_json, '$.preference.identity.itemKind') = 'media';

DROP TABLE library_media_identity_source_migration;

CREATE TRIGGER library_item_preferences_revision_insert
AFTER INSERT ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_item_preferences_revision_update
AFTER UPDATE ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_item_preferences_revision_delete
AFTER DELETE ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (OLD.workspace_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_insert
AFTER INSERT ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.added_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_update
AFTER UPDATE ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_delete
AFTER DELETE ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (OLD.workspace_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1, updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_mutation_requests_claim_guard
BEFORE INSERT ON library_mutation_requests
BEGIN
  SELECT CASE
    WHEN NEW.result_kind = 'preference' AND EXISTS (
      SELECT 1 FROM library_item_preferences AS preference
      WHERE preference.workspace_id = NEW.workspace_id
        AND preference.principal_id = NEW.principal_id
        AND CASE WHEN preference.item_kind = 'media'
          THEN 'media:' || preference.item_source || ':' || preference.item_id ||
               '@' || preference.item_version
          ELSE 'template:' || preference.item_id || '@' || preference.item_version
        END = NEW.result_identity
        AND preference.revision = NEW.result_revision
        AND preference.last_mutation_key = NEW.idempotency_key
        AND preference.last_mutation_operation = NEW.operation
        AND preference.last_mutation_hash = NEW.request_hash
    ) THEN 1
    WHEN NEW.result_kind = 'collection' AND EXISTS (
      SELECT 1 FROM library_collections AS collection
      WHERE collection.workspace_id = NEW.workspace_id
        AND collection.owner_principal_id = NEW.principal_id
        AND collection.id = NEW.result_identity
        AND collection.revision = NEW.result_revision
        AND collection.last_mutation_key = NEW.idempotency_key
        AND collection.last_mutation_operation = NEW.operation
        AND collection.last_mutation_hash = NEW.request_hash
    ) THEN 1
    ELSE RAISE(ABORT, 'library mutation target was not claimed')
  END;
END;
