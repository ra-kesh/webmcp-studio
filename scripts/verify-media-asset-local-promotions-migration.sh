#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
database=$(mktemp "${TMPDIR:-/tmp}/webmcp-media-promotions.XXXXXX")
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

INSERT INTO media_asset_local_promotions
  (workspace_id, local_asset_id, asset_id, created_at, updated_at, created_by)
VALUES
  ('workspace-a', 'local-fixture:1', 'asset-0000000000000001',
   '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 'principal-a');
SQL

promotion_count=$(sqlite3 "$database" 'SELECT COUNT(*) FROM media_asset_local_promotions')
promotion_index_count=$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_index_list("media_asset_local_promotions") WHERE name = "idx_media_asset_local_promotions_asset"')
promotion_fk_count=$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_foreign_key_list("media_asset_local_promotions") WHERE "table" = "media_assets" AND on_delete = "RESTRICT"')
promotion_primary_key=$(sqlite3 "$database" 'SELECT group_concat(name, ",") FROM (SELECT name FROM pragma_table_info("media_asset_local_promotions") WHERE pk > 0 ORDER BY pk)')
required_column_count=$(sqlite3 "$database" 'SELECT COUNT(*) FROM pragma_table_info("media_asset_local_promotions") WHERE name IN ("workspace_id", "local_asset_id", "asset_id", "created_at", "updated_at", "created_by") AND "notnull" = 1')
foreign_key_violations=$(sqlite3 "$database" 'PRAGMA foreign_key_check')

test "$promotion_count" = "1"
test "$promotion_index_count" = "1"
test "$promotion_fk_count" = "2"
test "$promotion_primary_key" = "workspace_id,local_asset_id"
test "$required_column_count" = "6"
test -z "$foreign_key_violations"

if sqlite3 "$database" "PRAGMA foreign_keys=ON; DELETE FROM media_assets WHERE workspace_id='workspace-a' AND id='asset-0000000000000001';" 2>/dev/null; then
  echo "mapped asset deletion unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$database" "PRAGMA foreign_keys=ON; INSERT INTO media_asset_local_promotions VALUES ('workspace-b','foreign-alias','asset-0000000000000001','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z','principal-b');" 2>/dev/null; then
  echo "cross-workspace promotion unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$database" "INSERT INTO media_asset_local_promotions VALUES ('workspace-a','bad alias','asset-0000000000000001','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z','principal-a');" 2>/dev/null; then
  echo "malformed local alias unexpectedly succeeded" >&2
  exit 1
fi

echo "media asset local promotion migration verified"
