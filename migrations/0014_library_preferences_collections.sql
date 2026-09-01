PRAGMA foreign_keys = ON;

CREATE TABLE library_workspace_state (
  workspace_id TEXT PRIMARY KEY
    REFERENCES workspaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_library_workspace_state_revision
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  updated_at TEXT NOT NULL
    CONSTRAINT chk_library_workspace_state_updated_at
    CHECK (length(trim(updated_at)) BETWEEN 1 AND 64)
);

CREATE TABLE library_item_preferences (
  workspace_id TEXT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_principal
    CHECK (length(trim(principal_id)) BETWEEN 1 AND 255),
  item_kind TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_kind
    CHECK (item_kind IN ('template', 'media')),
  item_id TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_item_id
    CHECK (
      length(item_id) BETWEEN 1 AND 200
      AND substr(item_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND item_id NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  item_version INTEGER NOT NULL
    CONSTRAINT chk_library_item_preferences_version
    CHECK (typeof(item_version) = 'integer' AND item_version >= 1),
  favorite INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_library_item_preferences_favorite
    CHECK (favorite IN (0, 1)),
  last_used_at TEXT
    CONSTRAINT chk_library_item_preferences_last_used_at
    CHECK (
      last_used_at IS NULL
      OR length(trim(last_used_at)) BETWEEN 1 AND 64
    ),
  revision INTEGER NOT NULL DEFAULT 1
    CONSTRAINT chk_library_item_preferences_revision
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  last_mutation_key TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_mutation_key
    CHECK (
      length(last_mutation_key) BETWEEN 1 AND 128
      AND last_mutation_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  last_mutation_operation TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_mutation_operation
    CHECK (last_mutation_operation IN ('set_favorite', 'record_used')),
  last_mutation_hash TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_mutation_hash
    CHECK (
      length(last_mutation_hash) = 64
      AND last_mutation_hash NOT GLOB '*[^a-f0-9]*'
    ),
  created_at TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_created_at
    CHECK (length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL
    CONSTRAINT chk_library_item_preferences_updated_at
    CHECK (length(trim(updated_at)) BETWEEN 1 AND 64),
  CONSTRAINT chk_library_item_preferences_timestamps
    CHECK (
      updated_at >= created_at
      AND (last_used_at IS NULL OR last_used_at <= updated_at)
    ),
  PRIMARY KEY (
    workspace_id,
    principal_id,
    item_kind,
    item_id,
    item_version
  )
);

CREATE INDEX idx_library_item_preferences_favorite
ON library_item_preferences(
  workspace_id,
  principal_id,
  favorite,
  updated_at DESC,
  item_kind,
  item_id,
  item_version
);

CREATE INDEX idx_library_item_preferences_recent
ON library_item_preferences(
  workspace_id,
  principal_id,
  last_used_at DESC,
  item_kind,
  item_id,
  item_version
)
WHERE last_used_at IS NOT NULL;

CREATE TABLE library_collections (
  id TEXT PRIMARY KEY
    CONSTRAINT chk_library_collections_id
    CHECK (
      length(id) BETWEEN 12 AND 200
      AND substr(id, 1, 11) = 'collection-'
      AND substr(id, 12, 1) GLOB '[A-Za-z0-9]'
      AND substr(id, 12) NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  workspace_id TEXT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_principal_id TEXT NOT NULL
    CONSTRAINT chk_library_collections_owner
    CHECK (length(trim(owner_principal_id)) BETWEEN 1 AND 255),
  name TEXT NOT NULL
    CONSTRAINT chk_library_collections_name
    CHECK (length(trim(name)) BETWEEN 1 AND 512),
  normalized_name TEXT NOT NULL COLLATE NOCASE
    CONSTRAINT chk_library_collections_normalized_name
    CHECK (length(trim(normalized_name)) BETWEEN 1 AND 512),
  scope TEXT NOT NULL DEFAULT 'workspace'
    CONSTRAINT chk_library_collections_scope
    CHECK (scope = 'workspace'),
  revision INTEGER NOT NULL DEFAULT 1
    CONSTRAINT chk_library_collections_revision
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  last_mutation_key TEXT NOT NULL
    CONSTRAINT chk_library_collections_mutation_key
    CHECK (
      length(last_mutation_key) BETWEEN 1 AND 128
      AND last_mutation_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  last_mutation_operation TEXT NOT NULL
    CONSTRAINT chk_library_collections_mutation_operation
    CHECK (
      last_mutation_operation IN (
        'create_collection',
        'rename_collection',
        'delete_collection',
        'add_collection_member',
        'remove_collection_member',
        'reorder_collection_members'
      )
    ),
  last_mutation_hash TEXT NOT NULL
    CONSTRAINT chk_library_collections_mutation_hash
    CHECK (
      length(last_mutation_hash) = 64
      AND last_mutation_hash NOT GLOB '*[^a-f0-9]*'
    ),
  created_at TEXT NOT NULL
    CONSTRAINT chk_library_collections_created_at
    CHECK (length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL
    CONSTRAINT chk_library_collections_updated_at
    CHECK (length(trim(updated_at)) BETWEEN 1 AND 64),
  CONSTRAINT chk_library_collections_timestamps
    CHECK (updated_at >= created_at),
  UNIQUE (workspace_id, owner_principal_id, normalized_name),
  UNIQUE (workspace_id, id)
);

CREATE INDEX idx_library_collections_owner_updated
ON library_collections(
  workspace_id,
  owner_principal_id,
  updated_at DESC,
  id
);

CREATE TABLE library_collection_members (
  workspace_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  item_kind TEXT NOT NULL
    CONSTRAINT chk_library_collection_members_kind
    CHECK (item_kind IN ('template', 'media')),
  item_id TEXT NOT NULL
    CONSTRAINT chk_library_collection_members_item_id
    CHECK (
      length(item_id) BETWEEN 1 AND 200
      AND substr(item_id, 1, 1) GLOB '[A-Za-z0-9]'
      AND item_id NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  item_version INTEGER NOT NULL
    CONSTRAINT chk_library_collection_members_version
    CHECK (typeof(item_version) = 'integer' AND item_version >= 1),
  position INTEGER NOT NULL
    CONSTRAINT chk_library_collection_members_position
    CHECK (typeof(position) = 'integer' AND position >= 0),
  added_at TEXT NOT NULL
    CONSTRAINT chk_library_collection_members_added_at
    CHECK (length(trim(added_at)) BETWEEN 1 AND 64),
  PRIMARY KEY (
    workspace_id,
    collection_id,
    item_kind,
    item_id,
    item_version
  ),
  -- SQLite enforces this uniqueness row by row. Reorders and compaction must
  -- first move affected positions into a disjoint temporary offset range.
  UNIQUE (workspace_id, collection_id, position),
  FOREIGN KEY (workspace_id, collection_id)
    REFERENCES library_collections(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_library_collection_members_item
ON library_collection_members(
  workspace_id,
  item_kind,
  item_id,
  item_version,
  collection_id
);

CREATE TABLE library_mutation_requests (
  workspace_id TEXT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_principal
    CHECK (length(trim(principal_id)) BETWEEN 1 AND 255),
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_key
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    ),
  operation TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_operation
    CHECK (
      operation IN (
        'set_favorite',
        'record_used',
        'create_collection',
        'rename_collection',
        'delete_collection',
        'add_collection_member',
        'remove_collection_member',
        'reorder_collection_members'
      )
    ),
  request_hash TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_hash
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^a-f0-9]*'
    ),
  result_kind TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_result_kind
    CHECK (
      (
        result_kind = 'preference'
        AND operation IN ('set_favorite', 'record_used')
      )
      OR (
        result_kind = 'collection'
        AND operation IN (
          'create_collection',
          'rename_collection',
          'delete_collection',
          'add_collection_member',
          'remove_collection_member',
          'reorder_collection_members'
        )
      )
    ),
  result_identity TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_result_identity
    CHECK (length(trim(result_identity)) BETWEEN 1 AND 256),
  result_revision INTEGER NOT NULL
    CONSTRAINT chk_library_mutation_requests_result_revision
    CHECK (typeof(result_revision) = 'integer' AND result_revision >= 1),
  response_json TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_response_json
    CHECK (
      length(response_json) BETWEEN 2 AND 65536
      AND json_valid(response_json)
      AND substr(ltrim(response_json), 1, 1) = '{'
    ),
  created_at TEXT NOT NULL
    CONSTRAINT chk_library_mutation_requests_created_at
    CHECK (length(trim(created_at)) BETWEEN 1 AND 64),
  PRIMARY KEY (workspace_id, principal_id, idempotency_key)
);

CREATE INDEX idx_library_mutation_requests_created
ON library_mutation_requests(created_at);

CREATE TRIGGER library_mutation_requests_claim_guard
BEFORE INSERT ON library_mutation_requests
BEGIN
  SELECT (CASE
    WHEN NEW.result_kind = 'preference' AND EXISTS (
      SELECT 1
      FROM library_item_preferences AS preference
      WHERE preference.workspace_id = NEW.workspace_id
        AND preference.principal_id = NEW.principal_id
        AND preference.item_kind || ':' || preference.item_id || '@' ||
              preference.item_version = NEW.result_identity
        AND preference.revision = NEW.result_revision
        AND preference.last_mutation_key = NEW.idempotency_key
        AND preference.last_mutation_operation = NEW.operation
        AND preference.last_mutation_hash = NEW.request_hash
    ) THEN 1
    WHEN NEW.result_kind = 'collection' AND EXISTS (
      SELECT 1
      FROM library_collections AS collection
      WHERE collection.workspace_id = NEW.workspace_id
        AND collection.owner_principal_id = NEW.principal_id
        AND collection.id = NEW.result_identity
        AND collection.revision = NEW.result_revision
        AND collection.last_mutation_key = NEW.idempotency_key
        AND collection.last_mutation_operation = NEW.operation
        AND collection.last_mutation_hash = NEW.request_hash
    ) THEN 1
    ELSE RAISE(ABORT, 'library mutation target was not claimed')
  END);
END;

CREATE TRIGGER library_item_preferences_revision_insert
AFTER INSERT ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_item_preferences_revision_update
AFTER UPDATE ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_item_preferences_revision_delete
AFTER DELETE ON library_item_preferences
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (
    OLD.workspace_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collections_revision_insert
AFTER INSERT ON library_collections
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collections_revision_update
AFTER UPDATE ON library_collections
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collections_revision_delete
AFTER DELETE ON library_collections
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (
    OLD.workspace_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_insert
AFTER INSERT ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (NEW.workspace_id, 1, NEW.added_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_update
AFTER UPDATE ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (
    NEW.workspace_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER library_collection_members_revision_delete
AFTER DELETE ON library_collection_members
BEGIN
  INSERT INTO library_workspace_state (workspace_id, revision, updated_at)
  VALUES (
    OLD.workspace_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(workspace_id) DO UPDATE SET
    revision = revision + 1,
    updated_at = excluded.updated_at;
END;
