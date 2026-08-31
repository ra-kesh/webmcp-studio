#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
database=$(mktemp "${TMPDIR:-/tmp}/webmcp-library-preferences.XXXXXX")
trap 'rm -f "$database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$database" < "$migration"
done

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;

INSERT INTO workspaces (id, name, kind, created_at)
VALUES
  ('workspace-a', 'Workspace A', 'personal', '2026-08-31T00:00:00.000Z'),
  ('workspace-b', 'Workspace B', 'personal', '2026-08-31T00:00:00.000Z');

INSERT INTO library_item_preferences
  (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
   last_used_at, revision, last_mutation_key, last_mutation_operation,
   last_mutation_hash, created_at, updated_at)
VALUES
  ('workspace-a', 'principal-a', 'template', 'template-a', 1, 1, NULL, 1,
   'favorite-1', 'set_favorite',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   '2026-08-31T00:01:00.000Z', '2026-08-31T00:01:00.000Z');

UPDATE library_item_preferences
SET favorite = 0,
    revision = revision + 1,
    last_mutation_key = 'favorite-2',
    last_mutation_operation = 'set_favorite',
    last_mutation_hash =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    updated_at = '2026-08-31T00:02:00.000Z'
WHERE workspace_id = 'workspace-a'
  AND principal_id = 'principal-a'
  AND item_kind = 'template'
  AND item_id = 'template-a'
  AND item_version = 1;

INSERT INTO library_collections
  (id, workspace_id, owner_principal_id, name, normalized_name, scope,
   revision, last_mutation_key, last_mutation_operation, last_mutation_hash,
   created_at, updated_at)
VALUES
  ('collection-a', 'workspace-a', 'principal-a', 'Favorites', 'favorites',
   'workspace', 1, 'collection-1', 'create_collection',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   '2026-08-31T00:03:00.000Z',
   '2026-08-31T00:03:00.000Z');

INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES
  ('workspace-a', 'collection-a', 'template', 'template-a', 1, 0,
   '2026-08-31T00:04:00.000Z');

INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'favorite-2', 'set_favorite',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'preference', 'template:template-a@1', 2,
   '{"schemaVersion":1,"receipt":{"operation":"set_favorite"}}',
   '2026-08-31T00:02:00.000Z');

INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'collection-1', 'create_collection',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'collection', 'collection-a', 1,
   '{"schemaVersion":1,"receipt":{"operation":"create_collection"}}',
   '2026-08-31T00:03:00.000Z');
SQL

test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_workspace_state')" = "1"
test "$(sqlite3 "$database" 'SELECT revision FROM library_workspace_state WHERE workspace_id = "workspace-a"')" = "4"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_item_preferences')" = "1"
test "$(sqlite3 "$database" 'SELECT revision FROM library_item_preferences')" = "2"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_collections')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_collection_members')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_mutation_requests')" = "2"

test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("library_item_preferences") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,principal_id,item_kind,item_id,item_version"
test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("library_collection_members") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,collection_id,item_kind,item_id,item_version"
test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("library_mutation_requests") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,principal_id,idempotency_key"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM sqlite_master WHERE type = "trigger" AND name GLOB "library_*_revision_*"')" = "9"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM sqlite_master WHERE type = "trigger" AND name = "library_mutation_requests_claim_guard"')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("library_item_preferences") WHERE name IN ("idx_library_item_preferences_favorite", "idx_library_item_preferences_recent")')" = "2"
test "$(sqlite3 "$database" 'SELECT group_concat(name || ":" || "desc", ",") FROM (SELECT name, "desc" FROM pragma_index_xinfo("idx_library_item_preferences_recent") WHERE key = 1 ORDER BY seqno)')" = "workspace_id:0,principal_id:0,last_used_at:1,item_kind:0,item_id:0,item_version:0"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("library_collection_members") WHERE name = "idx_library_collection_members_item"')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("library_mutation_requests") WHERE name = "idx_library_mutation_requests_created"')" = "1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_foreign_key_list("library_collection_members") WHERE "table" = "library_collections" AND on_delete = "CASCADE"')" = "2"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
PRAGMA foreign_keys = ON;
INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES
  ('workspace-b', 'collection-a', 'template', 'foreign-item', 1, 1,
   '2026-08-31T00:05:00.000Z');
SQL
then
  echo "cross-workspace collection membership unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_collections
  (id, workspace_id, owner_principal_id, name, normalized_name, scope,
   revision, last_mutation_key, last_mutation_operation, last_mutation_hash,
   created_at, updated_at)
VALUES
  ('collection-b', 'workspace-a', 'principal-a', 'FAVORITES', 'FAVORITES',
   'workspace', 1, 'collection-duplicate', 'create_collection',
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   '2026-08-31T00:05:00.000Z',
   '2026-08-31T00:05:00.000Z');
SQL
then
  echo "duplicate normalized collection name unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'bad key', 'set_favorite',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'preference', 'template:template-a@1', 2, 'not-json',
   '2026-08-31T00:06:00.000Z');
SQL
then
  echo "malformed mutation receipt unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'unclaimed-request', 'set_favorite',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'preference', 'template:template-a@1', 2, '{"schemaVersion":1}',
   '2026-08-31T00:06:00.000Z');
SQL
then
  echo "unclaimed mutation receipt unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-b', 'favorite-2', 'set_favorite',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'preference', 'template:template-a@1', 2, '{"schemaVersion":1}',
   '2026-08-31T00:06:00.000Z');
SQL
then
  echo "cross-principal mutation claim unexpectedly succeeded" >&2
  exit 1
fi

# Simulate retention removing a successful receipt. A stale retry that reuses
# its key for a different expected-revision/body hash must not be able to prove
# ownership from the target's key and revision alone.
sqlite3 -bail "$database" <<'SQL'
DELETE FROM library_mutation_requests
WHERE workspace_id = 'workspace-a'
  AND principal_id = 'principal-a'
  AND idempotency_key = 'favorite-2';
SQL
if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'favorite-2', 'set_favorite',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'preference', 'template:template-a@1', 2, '{"schemaVersion":1}',
   '2026-08-31T00:06:00.000Z');
SQL
then
  echo "different-hash stale mutation claim unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'favorite-2', 'record_used',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'preference', 'template:template-a@1', 2, '{"schemaVersion":1}',
   '2026-08-31T00:06:00.000Z');
SQL
then
  echo "cross-operation stale mutation claim unexpectedly succeeded" >&2
  exit 1
fi

# Position uniqueness is immediate in SQLite. Prove that an in-place swap is
# rejected, then exercise the repository's required disjoint-offset strategy
# for a multi-member reorder and removal compaction.
sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES
  ('workspace-a', 'collection-a', 'media', 'media-b', 1, 1,
   '2026-08-31T00:06:00.000Z'),
  ('workspace-a', 'collection-a', 'template', 'template-c', 1, 2,
   '2026-08-31T00:06:00.000Z'),
  ('workspace-a', 'collection-a', 'media', 'media-d', 1, 3,
   '2026-08-31T00:06:00.000Z');
SQL
if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
UPDATE library_collection_members
SET position = CASE item_id
  WHEN 'template-a' THEN 1
  WHEN 'media-b' THEN 0
END
WHERE workspace_id = 'workspace-a'
  AND collection_id = 'collection-a'
  AND item_id IN ('template-a', 'media-b');
SQL
then
  echo "in-place member swap unexpectedly bypassed immediate uniqueness" >&2
  exit 1
fi
test "$(sqlite3 "$database" 'SELECT group_concat(item_id || ":" || position, ",") FROM (SELECT item_id, position FROM library_collection_members WHERE workspace_id = "workspace-a" AND collection_id = "collection-a" ORDER BY position)')" = "template-a:0,media-b:1,template-c:2,media-d:3"

sqlite3 -bail "$database" <<'SQL'
BEGIN IMMEDIATE;
UPDATE library_collection_members
SET position = position + 1000
WHERE workspace_id = 'workspace-a' AND collection_id = 'collection-a';
UPDATE library_collection_members
SET position = CASE item_id
  WHEN 'template-c' THEN 0
  WHEN 'template-a' THEN 1
  WHEN 'media-b' THEN 2
  WHEN 'media-d' THEN 3
END
WHERE workspace_id = 'workspace-a' AND collection_id = 'collection-a';
COMMIT;
SQL
test "$(sqlite3 "$database" 'SELECT group_concat(item_id || ":" || position, ",") FROM (SELECT item_id, position FROM library_collection_members WHERE workspace_id = "workspace-a" AND collection_id = "collection-a" ORDER BY position)')" = "template-c:0,template-a:1,media-b:2,media-d:3"

sqlite3 -bail "$database" <<'SQL'
BEGIN IMMEDIATE;
DELETE FROM library_collection_members
WHERE workspace_id = 'workspace-a'
  AND collection_id = 'collection-a'
  AND item_kind = 'template'
  AND item_id = 'template-a'
  AND item_version = 1;
UPDATE library_collection_members
SET position = position + 1000
WHERE workspace_id = 'workspace-a'
  AND collection_id = 'collection-a'
  AND position > 1;
UPDATE library_collection_members
SET position = position - 1001
WHERE workspace_id = 'workspace-a'
  AND collection_id = 'collection-a'
  AND position >= 1002;
COMMIT;
SQL
test "$(sqlite3 "$database" 'SELECT group_concat(item_id || ":" || position, ",") FROM (SELECT item_id, position FROM library_collection_members WHERE workspace_id = "workspace-a" AND collection_id = "collection-a" ORDER BY position)')" = "template-c:0,media-b:1,media-d:2"

revision_before_failed_batch=$(sqlite3 "$database" 'SELECT revision FROM library_workspace_state WHERE workspace_id = "workspace-a"')
if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
INSERT INTO library_item_preferences
  (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
   last_used_at, revision, last_mutation_key, last_mutation_operation,
   last_mutation_hash, created_at, updated_at)
VALUES
  ('workspace-a', 'principal-a', 'media', 'media-a', 1, 1, NULL, 1,
   'failed-batch', 'set_favorite',
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   '2026-08-31T00:07:00.000Z',
   '2026-08-31T00:07:00.000Z');
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'failed-batch', 'set_favorite', 'bad-hash',
   'preference', 'media:media-a@1', 1, '{"schemaVersion":1}',
   '2026-08-31T00:07:00.000Z');
COMMIT;
SQL
then
  echo "failed preference and receipt transaction unexpectedly succeeded" >&2
  exit 1
fi
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_item_preferences WHERE item_id = "media-a"')" = "0"
test "$(sqlite3 "$database" 'SELECT revision FROM library_workspace_state WHERE workspace_id = "workspace-a"')" = "$revision_before_failed_batch"

# An exact retained claim may repair its own receipt, while the trigger tests
# above continue to reject a different hash, operation, principal, or target.
sqlite3 -bail "$database" <<'SQL'
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'favorite-2', 'set_favorite',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'preference', 'template:template-a@1', 2,
   '{"schemaVersion":1,"operation":"set_favorite"}',
   '2026-08-31T00:07:00.000Z');
SQL
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_mutation_requests WHERE idempotency_key = "favorite-2"')" = "1"

sqlite3 -bail "$database" <<'SQL'
INSERT INTO library_collections
  (id, workspace_id, owner_principal_id, name, normalized_name, scope,
   revision, last_mutation_key, last_mutation_operation, last_mutation_hash,
   created_at, updated_at)
VALUES
  ('collection-atomic', 'workspace-a', 'principal-a', 'Atomic', 'atomic',
   'workspace', 1, 'atomic-collection', 'create_collection',
   '4444444444444444444444444444444444444444444444444444444444444444',
   '2026-08-31T00:07:00.000Z', '2026-08-31T00:07:00.000Z');
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'atomic-collection', 'create_collection',
   '4444444444444444444444444444444444444444444444444444444444444444',
   'collection', 'collection-atomic', 1,
   '{"schemaVersion":1,"operation":"create_collection"}',
   '2026-08-31T00:07:00.000Z');
SQL
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_mutation_requests WHERE idempotency_key = "atomic-collection"')" = "1"
sqlite3 -bail "$database" 'DELETE FROM library_mutation_requests WHERE idempotency_key = "atomic-collection"; DELETE FROM library_collections WHERE id = "collection-atomic";'

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM library_collections
WHERE workspace_id = 'workspace-a' AND id = 'collection-a';
SQL

test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_collection_members')" = "0"
test "$(sqlite3 "$database" 'SELECT revision FROM library_workspace_state WHERE workspace_id = "workspace-a"')" -gt "4"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_mutation_requests WHERE workspace_id = "workspace-a" AND principal_id = "principal-a" AND idempotency_key = "collection-1"')" = "1"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"

# A deleted collection remains replayable only while its exact receipt exists.
# Once retention removes that receipt, the missing claimed target must prevent
# the receipt from being recreated.
sqlite3 -bail "$database" <<'SQL'
DELETE FROM library_mutation_requests
WHERE workspace_id = 'workspace-a'
  AND principal_id = 'principal-a'
  AND idempotency_key = 'collection-1';
SQL
if sqlite3 -bail "$database" <<'SQL' 2>/dev/null
INSERT INTO library_mutation_requests
  (workspace_id, principal_id, idempotency_key, operation, request_hash,
   result_kind, result_identity, result_revision, response_json, created_at)
VALUES
  ('workspace-a', 'principal-a', 'collection-1', 'create_collection',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'collection', 'collection-a', 1, '{"schemaVersion":1}',
   '2026-08-31T00:09:00.000Z');
SQL
then
  echo "deleted-target receipt recreation unexpectedly succeeded" >&2
  exit 1
fi

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO workspaces (id, name, kind, created_at)
VALUES ('workspace-c', 'Workspace C', 'personal', '2026-08-31T00:00:00.000Z');
INSERT INTO library_item_preferences
  (workspace_id, principal_id, item_kind, item_id, item_version, favorite,
   last_used_at, revision, last_mutation_key, last_mutation_operation,
   last_mutation_hash, created_at, updated_at)
VALUES
  ('workspace-c', 'principal-c', 'template', 'template-c', 1, 1, NULL, 1,
   'cascade-1', 'set_favorite',
   '1111111111111111111111111111111111111111111111111111111111111111',
   '2026-08-31T00:08:00.000Z', '2026-08-31T00:08:00.000Z');
INSERT INTO library_collections
  (id, workspace_id, owner_principal_id, name, normalized_name, scope,
   revision, last_mutation_key, last_mutation_operation, last_mutation_hash,
   created_at, updated_at)
VALUES
  ('collection-c', 'workspace-c', 'principal-c', 'Collection C',
   'collection c', 'workspace', 1, 'cascade-2', 'create_collection',
   '2222222222222222222222222222222222222222222222222222222222222222',
   '2026-08-31T00:08:00.000Z', '2026-08-31T00:08:00.000Z');
INSERT INTO library_collection_members
  (workspace_id, collection_id, item_kind, item_id, item_version, position,
   added_at)
VALUES
  ('workspace-c', 'collection-c', 'template', 'template-c', 1, 0,
   '2026-08-31T00:08:00.000Z');
DELETE FROM workspaces WHERE id = 'workspace-c';
SQL

test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_workspace_state WHERE workspace_id = "workspace-c"')" = "0"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_item_preferences WHERE workspace_id = "workspace-c"')" = "0"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_collections WHERE workspace_id = "workspace-c"')" = "0"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM library_collection_members WHERE workspace_id = "workspace-c"')" = "0"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"

echo "library preference and collection migration verified"
