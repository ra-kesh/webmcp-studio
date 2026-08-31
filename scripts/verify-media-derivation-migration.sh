#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fresh_database=$(mktemp "${TMPDIR:-/tmp}/webmcp-derivation-fresh.XXXXXX")
upgrade_database=$(mktemp "${TMPDIR:-/tmp}/webmcp-derivation-upgrade.XXXXXX")
trap 'rm -f "$fresh_database" "$upgrade_database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 -bail "$fresh_database" < "$migration"
done

for migration in "$repo_root"/migrations/*.sql; do
  if [ "$(basename "$migration")" = "0017_media_derivation_jobs.sql" ]; then
    break
  fi
  sqlite3 -bail "$upgrade_database" < "$migration"
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
  ('asset-0000000000000001', 'workspace-a', 'Source', 'image/png', 68, 1, 1,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'media/workspaces/workspace-a/content/source/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL),
  ('asset-0000000000000002', 'workspace-a', 'Output', 'image/png', 70, 1, 1,
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'media/workspaces/workspace-a/content/output/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL),
  ('asset-0000000000000003', 'workspace-b', 'Foreign output', 'image/png', 70, 1, 1,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'media/workspaces/workspace-b/content/output/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL);
SQL

sqlite3 -bail "$upgrade_database" < "$repo_root/migrations/0017_media_derivation_jobs.sql"

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO media_derivation_jobs
  (id, workspace_id, source_asset_id, source_content_hash, operation,
   parameters_json, parameters_hash, provider_key, provider_model_version,
   privacy_policy_version, request_fingerprint, state, attempt_count,
   max_attempts, retryable, created_at, updated_at)
VALUES
  ('derivation-00000000000000001', 'workspace-a',
   'asset-0000000000000001',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'remove_background', '{}',
   '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
   'configured-adapter', 'model-2026-08', 'privacy-2026-08',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'queued', 0, 3, 0,
   '2026-08-31T00:01:00.000Z', '2026-08-31T00:01:00.000Z');
INSERT INTO media_derivation_requests
  (workspace_id, idempotency_key, request_fingerprint, job_id, created_at)
VALUES
  ('workspace-a', 'request-1',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'derivation-00000000000000001', '2026-08-31T00:01:00.000Z');
UPDATE media_derivation_jobs
SET state = 'running', active_attempt_id = 'derivation-attempt-00000000000000001',
    attempt_count = 1, started_at = '2026-08-31T00:02:00.000Z',
    updated_at = '2026-08-31T00:02:00.000Z'
WHERE id = 'derivation-00000000000000001';
INSERT INTO media_derivation_attempts
  (id, workspace_id, job_id, attempt_number, state, started_at)
VALUES
  ('derivation-attempt-00000000000000001', 'workspace-a',
   'derivation-00000000000000001', 1, 'running',
   '2026-08-31T00:02:00.000Z');
UPDATE media_derivation_jobs
SET state = 'succeeded', output_asset_id = 'asset-0000000000000002',
    completed_at = '2026-08-31T00:03:00.000Z',
    updated_at = '2026-08-31T00:03:00.000Z'
WHERE id = 'derivation-00000000000000001';
UPDATE media_derivation_attempts
SET state = 'succeeded', finished_at = '2026-08-31T00:03:00.000Z'
WHERE id = 'derivation-attempt-00000000000000001';
INSERT INTO media_derivation_provenance
  (workspace_id, output_asset_id, source_asset_id, source_content_hash,
   derivation_job_id, operation, provider_key, provider_model_version,
   privacy_policy_version, output_content_hash, output_media_type,
   output_width, output_height, created_at)
VALUES
  ('workspace-a', 'asset-0000000000000002', 'asset-0000000000000001',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'derivation-00000000000000001', 'remove_background',
   'configured-adapter', 'model-2026-08', 'privacy-2026-08',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'image/png', 1, 1, '2026-08-31T00:03:00.000Z');
SQL

sqlite3 -bail "$upgrade_database" < "$repo_root/migrations/0018_media_derivation_canonical_outputs.sql"

test "$(sqlite3 "$upgrade_database" 'SELECT state || ":" || output_asset_id FROM media_derivation_jobs')" = "succeeded:asset-0000000000000002"
test "$(sqlite3 "$upgrade_database" 'SELECT state || ":" || attempt_number FROM media_derivation_attempts')" = "succeeded:1"
test "$(sqlite3 "$upgrade_database" 'SELECT source_asset_id || ":" || output_asset_id FROM media_derivation_provenance')" = "asset-0000000000000001:asset-0000000000000002"
test "$(sqlite3 "$upgrade_database" 'SELECT COUNT(*) FROM pragma_index_list("media_derivation_jobs") WHERE name IN ("idx_media_derivation_jobs_workspace_created", "idx_media_derivation_jobs_active")')" = "2"
test "$(sqlite3 "$upgrade_database" 'SELECT COUNT(*) FROM sqlite_schema WHERE type = "trigger" AND name IN ("media_derivation_jobs_attempt_fence_guard", "media_derivation_provenance_immutable")')" = "2"
test "$(sqlite3 "$upgrade_database" 'SELECT group_concat(name, ",") FROM pragma_table_info("media_derivation_provenance") WHERE pk > 0 ORDER BY pk')" = "workspace_id,derivation_job_id"
test -z "$(sqlite3 "$upgrade_database" 'PRAGMA foreign_key_check')"

if sqlite3 "$upgrade_database" "UPDATE media_derivation_provenance SET provider_model_version='mutated';" 2>/dev/null; then
  echo "immutable provenance update unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; INSERT INTO media_derivation_requests VALUES ('workspace-a','mismatched-request','9999999999999999999999999999999999999999999999999999999999999999','derivation-00000000000000001','2026-08-31T00:04:00.000Z');" 2>/dev/null; then
  echo "mismatched idempotency fingerprint unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "UPDATE media_derivation_jobs SET state='queued', output_asset_id=NULL, active_attempt_id=NULL, completed_at=NULL WHERE id='derivation-00000000000000001';" 2>/dev/null; then
  echo "illegal terminal job transition unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "INSERT INTO media_derivation_attempts (id,workspace_id,job_id,attempt_number,state,started_at) VALUES ('derivation-attempt-00000000000000002','workspace-a','derivation-00000000000000001',2,'running','2026-08-31T00:04:00.000Z');" 2>/dev/null; then
  echo "unclaimed attempt unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; INSERT INTO media_derivation_provenance VALUES ('workspace-a','asset-0000000000000001','asset-0000000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','derivation-00000000000000001','remove_background','configured-adapter','model-2026-08','privacy-2026-08','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',1,1,'2026-08-31T00:04:00.000Z');" 2>/dev/null; then
  echo "same-source provenance unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; UPDATE media_derivation_jobs SET output_asset_id='asset-0000000000000003' WHERE id='derivation-00000000000000001';" 2>/dev/null; then
  echo "cross-workspace output unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "INSERT INTO media_derivation_jobs (id,workspace_id,source_asset_id,source_content_hash,operation,parameters_json,parameters_hash,provider_key,provider_model_version,privacy_policy_version,request_fingerprint,state,attempt_count,max_attempts,retryable,created_at,updated_at) VALUES ('derivation-00000000000000002','workspace-a','asset-0000000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','remove_background','{}','44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a','configured-adapter','model-2026-08','privacy-2026-08','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','queued',2,1,0,'2026-08-31T00:04:00.000Z','2026-08-31T00:04:00.000Z');" 2>/dev/null; then
  echo "invalid attempt counters unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; INSERT INTO media_derivation_jobs (id,workspace_id,source_asset_id,source_content_hash,operation,parameters_json,parameters_hash,provider_key,provider_model_version,privacy_policy_version,request_fingerprint,state,attempt_count,max_attempts,retryable,created_at,started_at,updated_at) VALUES ('derivation-00000000000000004','workspace-a','asset-0000000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','remove_background','{}','44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a','configured-adapter','model-2026-08','privacy-2026-08','7777777777777777777777777777777777777777777777777777777777777777','queued',1,3,0,'2026-08-31T00:04:00.000Z','2026-08-31T00:04:00.000Z','2026-08-31T00:04:00.000Z'); UPDATE media_derivation_jobs SET attempt_count=2 WHERE id='derivation-00000000000000004';" 2>/dev/null; then
  echo "out-of-claim attempt increment unexpectedly succeeded" >&2
  exit 1
fi

if sqlite3 "$upgrade_database" "PRAGMA foreign_keys=ON; INSERT INTO media_derivation_jobs (id,workspace_id,source_asset_id,source_content_hash,operation,parameters_json,parameters_hash,provider_key,provider_model_version,privacy_policy_version,request_fingerprint,state,attempt_count,max_attempts,retryable,created_at,updated_at) VALUES ('derivation-00000000000000003','workspace-a','asset-0000000000000001','9999999999999999999999999999999999999999999999999999999999999999','remove_background','{}','44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a','configured-adapter','model-2026-08','privacy-2026-08','8888888888888888888888888888888888888888888888888888888888888888','queued',0,1,0,'2026-08-31T00:04:00.000Z','2026-08-31T00:04:00.000Z');" 2>/dev/null; then
  echo "mismatched source hash unexpectedly succeeded" >&2
  exit 1
fi

sqlite3 -bail "$upgrade_database" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM workspaces WHERE id = 'workspace-a';
SQL

test "$(sqlite3 "$upgrade_database" "SELECT COUNT(*) FROM media_derivation_jobs WHERE workspace_id='workspace-a'")" = "0"
test "$(sqlite3 "$upgrade_database" "SELECT COUNT(*) FROM media_derivation_provenance WHERE workspace_id='workspace-a'")" = "0"
test -z "$(sqlite3 "$upgrade_database" 'PRAGMA foreign_key_check')"

sqlite3 -bail "$fresh_database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO workspaces (id, name, kind, created_at)
VALUES ('workspace-fresh', 'Fresh', 'personal', '2026-08-31T00:00:00.000Z');
INSERT INTO media_assets
  (id, workspace_id, name, media_type, bytes, width, height, content_hash,
   r2_key, status, revision, created_at, updated_at, last_used_at, archived_at)
VALUES
  ('asset-0000000000000010', 'workspace-fresh', 'Fresh source', 'image/png',
   68, 1, 1,
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'media/workspaces/workspace-fresh/content/source/original', 'ready', 1,
   '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z',
   '2026-08-31T00:00:00.000Z', NULL);
INSERT INTO media_derivation_jobs
  (id, workspace_id, source_asset_id, source_content_hash, operation,
   parameters_json, parameters_hash, provider_key, provider_model_version,
   privacy_policy_version, request_fingerprint, state, attempt_count,
   max_attempts, retryable, created_at, updated_at)
VALUES
  ('derivation-00000000000000010', 'workspace-fresh',
   'asset-0000000000000010',
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'remove_background', '{}',
   '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
   'configured-adapter', 'model-2026-08', 'privacy-2026-08',
   '1111111111111111111111111111111111111111111111111111111111111111',
   'queued', 0, 2, 0,
   '2026-08-31T00:01:00.000Z', '2026-08-31T00:01:00.000Z');
SQL

test "$(sqlite3 "$fresh_database" 'SELECT COUNT(*) FROM media_derivation_jobs')" = "1"
test -z "$(sqlite3 "$fresh_database" 'PRAGMA foreign_key_check')"

echo "media derivation migration verified"
