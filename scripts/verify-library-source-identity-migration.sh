#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
database=$(mktemp "${TMPDIR:-/tmp}/webmcp-library-source-identity.XXXXXX")
trap 'rm -f "$database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$database" < "$migration"
  if [ "$(basename "$migration")" = "0014_library_preferences_collections.sql" ]; then
    break
  fi
done

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;
-- Exercise the identity migration independently of the current upload ID
-- generator. Future managed ID policies must not be able to reinterpret an
-- immutable curated preference, even if their namespaces overlap.
PRAGMA ignore_check_constraints = ON;
INSERT INTO workspaces (id, name, kind, created_at)
VALUES ('workspace-a', 'Workspace A', 'personal', '2026-08-31T00:00:00.000Z');

INSERT INTO media_assets
  (id, workspace_id, name, media_type, bytes, width, height, content_hash,
   r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
VALUES
  ('olive-botanical', 'workspace-a', 'Managed collision', 'image/png', 68, 1, 1,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'media/workspaces/workspace-a/content/a/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL),
  ('asset-managed-only-0001', 'workspace-a', 'Managed only', 'image/png', 68, 1, 1,
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'media/workspaces/workspace-a/content/b/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL);
PRAGMA ignore_check_constraints = OFF;

INSERT INTO library_item_preferences
  (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
   last_used_at, revision, last_mutation_key, last_mutation_operation,
   last_mutation_hash, created_at, updated_at)
VALUES
  ('workspace-a', 'principal-a', 'media', 'olive-botanical', 1, 1, NULL, 1,
   'legacy-olive', 'set_favorite',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
  ('workspace-a', 'principal-a', 'media', 'asset-managed-only-0001', 1, 1,
   '2026-08-31T00:00:00.000Z', 1,
   'legacy-managed', 'record_used',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
  ('workspace-a', 'principal-a', 'media', 'unknown-curated', 1, 1, NULL, 1,
   'legacy-curated', 'set_favorite',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');

INSERT INTO library_collections
  (id, workspace_id, owner_principal_id, name, normalized_name, scope,
   revision, last_mutation_key, last_mutation_operation, last_mutation_hash,
   created_at, updated_at)
VALUES
  ('collection-a', 'workspace-a', 'principal-a', 'Migration', 'migration',
   'workspace', 1, 'legacy-collection', 'create_collection',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');

SQL

sqlite3 -bail "$database" < "$repo_root/migrations/0015_media_asset_catalog_metadata.sql"
sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;

INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'legacy-olive', 'set_favorite',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'preference', 'media:olive-botanical@1', 1,
   '{"schemaVersion":1,"operation":"set_favorite","preference":{"identity":{"itemKind":"media","id":"olive-botanical","version":1},"favorite":true,"lastUsedAt":null,"collectionIds":[],"revision":1,"updatedAt":"2026-08-31T00:00:00.000Z"},"workspaceRevision":3}',
   '2026-08-31T00:00:00.000Z'),
  ('workspace-a', 'principal-a', 'legacy-managed', 'record_used',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'preference', 'media:asset-managed-only-0001@1', 1,
   '{"schemaVersion":1,"operation":"record_used","completedAction":"insert","completionId":"legacy-managed-use","preference":{"identity":{"itemKind":"media","id":"asset-managed-only-0001","version":1},"favorite":true,"lastUsedAt":"2026-08-31T00:00:00.000Z","collectionIds":[],"revision":1,"updatedAt":"2026-08-31T00:00:00.000Z"},"workspaceRevision":3}',
   '2026-08-31T00:00:00.000Z');

INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES ('workspace-a', 'collection-a', 'media', 'olive-botanical', 1, 0,
  '2026-08-31T00:01:00.000Z');
UPDATE library_collections
SET revision = 2, last_mutation_key = 'legacy-add',
    last_mutation_operation = 'add_collection_member',
    last_mutation_hash =
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    updated_at = '2026-08-31T00:01:00.000Z'
WHERE id = 'collection-a';
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'legacy-add', 'add_collection_member',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'collection', 'collection-a', 2,
   '{"schemaVersion":1,"operation":"add_collection_member","identity":{"itemKind":"media","id":"olive-botanical","version":1},"collection":{"summary":{"id":"collection-a","name":"Migration","scope":"workspace","revision":2,"itemCount":1,"createdAt":"2026-08-31T00:00:00.000Z","updatedAt":"2026-08-31T00:01:00.000Z"},"members":[{"itemKind":"media","id":"olive-botanical","version":1}]},"workspaceRevision":4}',
   '2026-08-31T00:01:00.000Z');

DELETE FROM library_collection_members
WHERE workspace_id = 'workspace-a' AND collection_id = 'collection-a';
UPDATE library_collections
SET revision = 3, last_mutation_key = 'legacy-remove',
    last_mutation_operation = 'remove_collection_member',
    last_mutation_hash =
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    updated_at = '2026-08-31T00:02:00.000Z'
WHERE id = 'collection-a';
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'legacy-remove', 'remove_collection_member',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'collection', 'collection-a', 3,
   '{"schemaVersion":1,"operation":"remove_collection_member","identity":{"itemKind":"media","id":"olive-botanical","version":1},"collection":{"summary":{"id":"collection-a","name":"Migration","scope":"workspace","revision":3,"itemCount":0,"createdAt":"2026-08-31T00:00:00.000Z","updatedAt":"2026-08-31T00:02:00.000Z"},"members":[]},"workspaceRevision":6}',
   '2026-08-31T00:02:00.000Z');

INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES
  ('workspace-a', 'collection-a', 'media', 'asset-managed-only-0001', 1, 0,
   '2026-08-31T00:03:00.000Z'),
  ('workspace-a', 'collection-a', 'media', 'olive-botanical', 1, 1,
   '2026-08-31T00:03:00.000Z');
UPDATE library_collections
SET revision = 4, last_mutation_key = 'legacy-reorder',
    last_mutation_operation = 'reorder_collection_members',
    last_mutation_hash =
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    updated_at = '2026-08-31T00:03:00.000Z'
WHERE id = 'collection-a';
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'legacy-reorder',
   'reorder_collection_members',
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'collection', 'collection-a', 4,
   '{"schemaVersion":1,"operation":"reorder_collection_members","collection":{"summary":{"id":"collection-a","name":"Migration","scope":"workspace","revision":4,"itemCount":2,"createdAt":"2026-08-31T00:00:00.000Z","updatedAt":"2026-08-31T00:03:00.000Z"},"members":[{"itemKind":"media","id":"asset-managed-only-0001","version":1},{"itemKind":"media","id":"olive-botanical","version":1}]},"workspaceRevision":8}',
   '2026-08-31T00:03:00.000Z');
SQL
sqlite3 -bail "$database" < "$repo_root/migrations/0016_library_media_source_identity.sql"

test "$(sqlite3 "$database" "SELECT item_source FROM library_item_preferences WHERE item_id='olive-botanical'")" = "curated"
test "$(sqlite3 "$database" "SELECT item_source FROM library_item_preferences WHERE item_id='asset-managed-only-0001'")" = "managed"
test "$(sqlite3 "$database" "SELECT item_source FROM library_item_preferences WHERE item_id='unknown-curated'")" = "curated"
test "$(sqlite3 "$database" "SELECT item_source FROM library_collection_members WHERE item_id='olive-botanical'")" = "curated"
test "$(sqlite3 "$database" "SELECT item_source FROM library_collection_members WHERE item_id='asset-managed-only-0001'")" = "managed"
test "$(sqlite3 "$database" "SELECT json_extract(response_json, '$.preference.identity.mediaSource') FROM library_mutation_requests WHERE idempotency_key='legacy-olive'")" = "curated"
test "$(sqlite3 "$database" "SELECT json_extract(response_json, '$.preference.identity.mediaSource') FROM library_mutation_requests WHERE idempotency_key='legacy-managed'")" = "managed"
test "$(sqlite3 "$database" "SELECT result_identity FROM library_mutation_requests WHERE idempotency_key='legacy-olive'")" = "media:curated:olive-botanical@1"
test "$(sqlite3 "$database" "SELECT result_identity FROM library_mutation_requests WHERE idempotency_key='legacy-managed'")" = "media:managed:asset-managed-only-0001@1"
test "$(sqlite3 "$database" "SELECT json_extract(response_json, '$.identity.mediaSource') FROM library_mutation_requests WHERE idempotency_key='legacy-add'")" = "curated"
test "$(sqlite3 "$database" "SELECT json_extract(response_json, '$.identity.mediaSource') FROM library_mutation_requests WHERE idempotency_key='legacy-remove'")" = "curated"
test "$(sqlite3 "$database" "SELECT group_concat(json_extract(value, '$.mediaSource'), ',') FROM library_mutation_requests, json_each(response_json, '$.collection.members') WHERE idempotency_key='legacy-reorder' ORDER BY CAST(json_each.key AS INTEGER)")" = "managed,curated"
test "$(sqlite3 "$database" "SELECT request_hash FROM library_mutation_requests WHERE idempotency_key='legacy-reorder'")" = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
test "$(sqlite3 "$database" "SELECT last_mutation_hash FROM library_collections WHERE id='collection-a'")" = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("library_item_preferences") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,principal_id,item_kind,item_source,item_id,item_version"
test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("library_collection_members") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,collection_id,item_kind,item_source,item_id,item_version"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM sqlite_master WHERE type = "trigger" AND name GLOB "library_*_revision_*"')" = "9"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM sqlite_master WHERE type = "trigger" AND name = "library_mutation_requests_claim_guard"')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("library_item_preferences") WHERE name IN ("idx_library_item_preferences_favorite", "idx_library_item_preferences_recent")')" = "2"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("library_collection_members") WHERE name = "idx_library_collection_members_item"')" = "1"

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO library_item_preferences
  (workspace_id, principal_id, item_kind, item_source, item_id, item_version,
   favorite, last_used_at, revision, last_mutation_key,
   last_mutation_operation, last_mutation_hash, created_at, updated_at)
VALUES
  ('workspace-a', 'principal-a', 'media', 'managed', 'olive-botanical', 1,
   1, NULL, 1, 'managed-olive', 'set_favorite',
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   '2026-08-31T00:01:00.000Z', '2026-08-31T00:01:00.000Z'),
  ('workspace-a', 'principal-a', 'media', 'local', 'olive-botanical', 1,
   1, NULL, 1, 'local-olive', 'set_favorite',
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   '2026-08-31T00:02:00.000Z', '2026-08-31T00:02:00.000Z');
SQL

test "$(sqlite3 "$database" "SELECT group_concat(item_source, ',') FROM (SELECT item_source FROM library_item_preferences WHERE item_id='olive-botanical' ORDER BY item_source)")" = "curated,local,managed"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"

echo "library source identity migration verified"
