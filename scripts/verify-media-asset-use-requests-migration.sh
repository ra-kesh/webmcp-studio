#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
database=$(mktemp "${TMPDIR:-/tmp}/webmcp-media-use-requests.XXXXXX")
trap 'rm -f "$database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$database" < "$migration"
done

sqlite3 -bail "$database" <<'SQL'
PRAGMA foreign_keys = ON;

INSERT INTO workspaces (id, name, kind, created_at)
VALUES
  ('workspace-a', 'Workspace A', 'personal', '2026-08-30T00:00:00.000Z'),
  ('workspace-b', 'Workspace B', 'personal', '2026-08-30T00:00:00.000Z');

INSERT INTO media_assets
  (id, workspace_id, name, media_type, bytes, width, height, content_hash,
   r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
VALUES
  ('asset-0000000000000001', 'workspace-a', 'Fixture', 'image/png', 68, 1, 1,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'media/workspaces/workspace-a/content/aaaaaaaa/original', 'ready', 1,
   '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z',
   '2026-08-30T00:00:00.000Z', NULL);

BEGIN IMMEDIATE;
UPDATE media_assets
SET last_used_at = '2026-08-30T00:01:00.000Z',
    updated_at = '2026-08-30T00:01:00.000Z',
    revision = revision + 1
WHERE workspace_id = 'workspace-a'
  AND id = 'asset-0000000000000001'
  AND status = 'ready';
INSERT INTO media_asset_use_requests
  (workspace_id, idempotency_key, request_hash, asset_id, used_at,
   result_revision, created_at)
SELECT
  'workspace-a', 'use-request-1',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  id, '2026-08-30T00:01:00.000Z', revision,
  '2026-08-30T00:01:00.000Z'
FROM media_assets
WHERE workspace_id = 'workspace-a'
  AND id = 'asset-0000000000000001'
  AND status = 'ready';
COMMIT;
SQL

test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM media_asset_use_requests')" = "1"
test "$(sqlite3 "$database" 'SELECT used_at || ":" || result_revision FROM media_asset_use_requests WHERE idempotency_key = "use-request-1"')" = "2026-08-30T00:01:00.000Z:2"
test "$(sqlite3 "$database" 'SELECT revision FROM media_assets WHERE id = "asset-0000000000000001"')" = "2"
test "$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("media_asset_use_requests") WHERE pk > 0 ORDER BY pk)')" = "workspace_id,idempotency_key"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_table_info("media_asset_use_requests") WHERE name IN ("workspace_id", "idempotency_key", "request_hash", "asset_id", "used_at", "result_revision", "created_at") AND "notnull" = 1')" = "7"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("media_asset_use_requests") WHERE name = "idx_media_asset_use_requests_asset"')" = "1"
test "$(sqlite3 "$database" 'SELECT group_concat(name || ":" || "desc", ",") FROM (SELECT name, "desc" FROM pragma_index_xinfo("idx_media_asset_use_requests_asset") WHERE key = 1 ORDER BY seqno)')" = "workspace_id:0,asset_id:0,used_at:1"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_foreign_key_list("media_asset_use_requests") WHERE "table" = "media_assets" AND on_delete = "RESTRICT"')" = "2"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"

if sqlite3 "$database" "PRAGMA foreign_keys=ON; DELETE FROM media_assets WHERE workspace_id='workspace-a' AND id='asset-0000000000000001';" 2>/dev/null; then
  echo "used asset deletion unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$database" "PRAGMA foreign_keys=ON; INSERT INTO media_asset_use_requests VALUES ('workspace-b','cross-workspace','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','asset-0000000000000001','2026-08-30T00:02:00.000Z',2,'2026-08-30T00:02:00.000Z');" 2>/dev/null; then
  echo "cross-workspace use receipt unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$database" "INSERT INTO media_asset_use_requests VALUES ('workspace-a','bad key','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','asset-0000000000000001','2026-08-30T00:02:00.000Z',2,'2026-08-30T00:02:00.000Z');" 2>/dev/null; then
  echo "malformed idempotency key unexpectedly succeeded" >&2
  exit 1
fi

echo "media asset use request migration verified"
