#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fresh_database=$(mktemp "${TMPDIR:-/tmp}/webmcp-media-catalog-fresh.XXXXXX")
upgrade_database=$(mktemp "${TMPDIR:-/tmp}/webmcp-media-catalog-upgrade.XXXXXX")
trap 'rm -f "$fresh_database" "$upgrade_database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$fresh_database" < "$migration"
  if [ "$(basename "$migration")" = "0014_library_preferences_collections.sql" ]; then
    break
  fi
done

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
SQL

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$upgrade_database" < "$migration"
  if [ "$(basename "$migration")" = "0014_library_preferences_collections.sql" ]; then
    break
  fi
done

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO workspaces (id, name, kind, created_at)
VALUES
  ('workspace-a', 'Workspace A', 'personal', '2026-08-31T00:00:00.000Z'),
  ('workspace-b', 'Workspace B', 'personal', '2026-08-31T00:00:00.000Z');
INSERT INTO media_assets
  (id, workspace_id, name, media_type, bytes, width, height, content_hash,
   r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
VALUES
  ('asset-0000000000000001', 'workspace-a', 'Legacy A', 'image/png', 68, 1, 1,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'media/workspaces/workspace-a/content/a/original', 'ready', 4,
   '2026-08-30T00:00:00.000Z', '2026-08-30T00:05:00.000Z',
   '2026-08-30T00:05:00.000Z', NULL),
  ('asset-0000000000000002', 'workspace-b', 'Legacy B', 'image/png', 68, 1, 1,
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'media/workspaces/workspace-b/content/b/original', 'archived', 7,
   '2026-08-30T00:00:00.000Z', '2026-08-30T00:06:00.000Z',
   '2026-08-30T00:06:00.000Z', '2026-08-30T00:06:00.000Z');
SQL

sqlite3 -bail "$upgrade_database" < "$repo_root/migrations/0015_media_asset_catalog_metadata.sql"

test "$(sqlite3 "$upgrade_database" 'SELECT COUNT(*) FROM media_asset_catalog_metadata')" = "2"
test "$(sqlite3 "$upgrade_database" 'SELECT COUNT(*) FROM media_asset_catalog_state WHERE revision = 1')" = "2"
test "$(sqlite3 "$upgrade_database" "SELECT description || ':' || category_id || ':' || provenance_source_name || ':' || license_id || ':' || catalog_version FROM media_asset_catalog_metadata WHERE workspace_id='workspace-a'")" = "Customer-provided workspace upload:workspace-upload:Workspace upload:customer-provided:1"
test "$(sqlite3 "$upgrade_database" "SELECT updated_at FROM media_asset_catalog_metadata WHERE workspace_id='workspace-a'")" = "2026-08-30T00:05:00.000Z"
test -z "$(sqlite3 "$upgrade_database" 'PRAGMA foreign_key_check')"

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; INSERT INTO media_asset_catalog_metadata (workspace_id,asset_id,description,created_at,updated_at) VALUES ('workspace-b','asset-0000000000000001','Cross workspace','2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z');" 2>/dev/null; then
  echo "cross-workspace media catalog metadata unexpectedly succeeded" >&2
  exit 1
fi

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM media_assets
WHERE workspace_id = 'workspace-b' AND id = 'asset-0000000000000002';
SQL

test "$(sqlite3 "$upgrade_database" "SELECT revision FROM media_asset_catalog_state WHERE workspace_id='workspace-b'")" = "2"
test "$(sqlite3 "$upgrade_database" "SELECT COUNT(*) FROM media_asset_catalog_metadata WHERE workspace_id='workspace-b'")" = "0"

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM workspaces WHERE id = 'workspace-a';
SQL

test "$(sqlite3 "$upgrade_database" "SELECT COUNT(*) FROM workspaces WHERE id='workspace-a'")" = "0"
test "$(sqlite3 "$upgrade_database" "SELECT COUNT(*) FROM media_asset_catalog_state WHERE workspace_id='workspace-a'")" = "0"
test -z "$(sqlite3 "$upgrade_database" 'PRAGMA foreign_key_check')"

for migration in "$repo_root"/migrations/*.sql; do
  if [ "$(basename "$migration")" = "0015_media_asset_catalog_metadata.sql" ]; then
    sqlite3 -bail "$fresh_database" < "$migration"
  fi
done

sqlite3 -bail "$fresh_database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO workspaces (id, name, kind, created_at)
VALUES ('workspace-fresh', 'Fresh', 'personal', '2026-08-31T00:00:00.000Z');
INSERT INTO media_assets
  (id, workspace_id, name, media_type, bytes, width, height, content_hash,
   r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
VALUES
  ('asset-0000000000000003', 'workspace-fresh', 'Fresh upload', 'image/png',
   68, 1, 1,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'media/workspaces/workspace-fresh/content/c/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL);
SQL

test "$(sqlite3 "$fresh_database" "SELECT revision FROM media_asset_catalog_state WHERE workspace_id='workspace-fresh'")" = "1"
test "$(sqlite3 "$fresh_database" "SELECT catalog_version || ':' || tags_json || ':' || use_case_ids_json || ':' || COALESCE(license_url, '') FROM media_asset_catalog_metadata WHERE workspace_id='workspace-fresh'")" = "1:[]:[]:"

sqlite3 -bail "$fresh_database" <<'SQL'
UPDATE media_assets
SET last_used_at = '2026-08-31T00:01:00.000Z',
    updated_at = '2026-08-31T00:01:00.000Z',
    revision = revision + 1
WHERE workspace_id = 'workspace-fresh'
  AND id = 'asset-0000000000000003';
SQL

test "$(sqlite3 "$fresh_database" "SELECT revision FROM media_asset_catalog_state WHERE workspace_id='workspace-fresh'")" = "1"
test "$(sqlite3 "$fresh_database" "SELECT catalog_version FROM media_asset_catalog_metadata WHERE workspace_id='workspace-fresh'")" = "1"

sqlite3 -bail "$fresh_database" <<'SQL'
UPDATE media_assets
SET status = 'archived', archived_at = '2026-08-31T00:02:00.000Z',
    updated_at = '2026-08-31T00:02:00.000Z', revision = revision + 1
WHERE workspace_id = 'workspace-fresh'
  AND id = 'asset-0000000000000003';
UPDATE media_assets
SET status = 'ready', archived_at = NULL,
    updated_at = '2026-08-31T00:03:00.000Z', revision = revision + 1
WHERE workspace_id = 'workspace-fresh'
  AND id = 'asset-0000000000000003';
UPDATE media_asset_catalog_metadata
SET description = 'Portrait for team profiles',
    tags_json = '["portrait","team-profile"]',
    category_id = 'people',
    use_case_ids_json = '["profile"]',
    catalog_version = catalog_version + 1,
    updated_at = '2026-08-31T00:04:00.000Z'
WHERE workspace_id = 'workspace-fresh'
  AND asset_id = 'asset-0000000000000003';
SQL

test "$(sqlite3 "$fresh_database" "SELECT revision FROM media_asset_catalog_state WHERE workspace_id='workspace-fresh'")" = "4"
test "$(sqlite3 "$fresh_database" "SELECT catalog_version FROM media_asset_catalog_metadata WHERE workspace_id='workspace-fresh'")" = "4"
test "$(sqlite3 "$fresh_database" "SELECT COUNT(*) FROM media_asset_catalog_metadata WHERE tags_json LIKE '%team-profile%' AND use_case_ids_json LIKE '%profile%'")" = "1"
test -z "$(sqlite3 "$fresh_database" 'PRAGMA foreign_key_check')"

if sqlite3 "$fresh_database" "UPDATE media_asset_catalog_metadata SET tags_json='not-json' WHERE workspace_id='workspace-fresh';" 2>/dev/null; then
  echo "invalid media catalog JSON unexpectedly succeeded" >&2
  exit 1
fi

sqlite3 -bail "$fresh_database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM media_assets
WHERE workspace_id = 'workspace-fresh'
  AND id = 'asset-0000000000000003';
SQL

test "$(sqlite3 "$fresh_database" "SELECT revision FROM media_asset_catalog_state WHERE workspace_id='workspace-fresh'")" = "5"
test "$(sqlite3 "$fresh_database" "SELECT COUNT(*) FROM media_asset_catalog_metadata WHERE workspace_id='workspace-fresh'")" = "0"

sqlite3 -bail "$fresh_database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM workspaces WHERE id = 'workspace-fresh';
SQL

test "$(sqlite3 "$fresh_database" "SELECT COUNT(*) FROM workspaces WHERE id='workspace-fresh'")" = "0"
test "$(sqlite3 "$fresh_database" "SELECT COUNT(*) FROM media_asset_catalog_state WHERE workspace_id='workspace-fresh'")" = "0"
test -z "$(sqlite3 "$fresh_database" 'PRAGMA foreign_key_check')"

echo "media asset catalog metadata migration verified"
