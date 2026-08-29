#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
database=$(mktemp /tmp/webmcp-render-migration-XXXXXX.sqlite)
trap 'rm -f "$database"' EXIT

for migration in "$repo_root"/migrations/000{1..7}_*.sql; do
  sqlite3 "$database" < "$migration"
done

sqlite3 "$database" <<'SQL'
INSERT INTO workspaces VALUES
  ('w1', 'Workspace', 'demo', '2026-01-01T00:00:00Z');
INSERT INTO documents VALUES
  ('d1', 'w1', 'Doc', 1, '2026-01-01T00:00:00Z',
   '2026-01-01T00:00:00Z', 'document-public');
INSERT INTO templates
  (id, workspace_id, source_document_id, name, latest_version, created_at,
   public_id)
VALUES
  ('t1', 'w1', 'd1', 'Template', 1, '2026-01-01T00:00:00Z',
   'public-template');
INSERT INTO template_versions VALUES
  ('t1', 1, '{"revision":1}', '{}', '2026-01-01T00:00:00Z', 'tv1', 1,
   'legacy-snapshot-1');
INSERT INTO render_jobs VALUES
  ('job-running', 'w1', 't1', 1, 'rendering', '{}', NULL, NULL,
   '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', NULL, 'idem-1',
   'hash-1'),
  ('job-malformed', 'w1', 't1', 1, 'completed', 'not-json', NULL, NULL,
   '2026-01-01T00:00:00Z', NULL, NULL, 'idem-2', 'hash-2');
INSERT INTO render_outputs VALUES
  ('output-1', 'job-running', 'output', 'png',
   'job-running/output.png', 100, 200, 1234, 'checksum',
   '2026-01-01T00:02:00Z', 'page-1');
SQL

sqlite3 "$database" < "$repo_root/migrations/0008_durable_render_jobs.sql"

test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM render_jobs')" = "2"
test "$(sqlite3 "$database" 'SELECT COUNT(*) FROM render_outputs')" = "1"
test "$(sqlite3 "$database" "SELECT status || ':' || error_code FROM render_jobs WHERE id = 'job-running'")" = "failed:legacy_execution_interrupted"
test "$(sqlite3 "$database" "SELECT status || ':' || error_code || ':' || (completed_at IS NOT NULL) FROM render_jobs WHERE id = 'job-malformed'")" = "failed:legacy_invalid_request:1"
test "$(sqlite3 "$database" "SELECT json_extract(request_json, '$.legacyMalformedRequest') FROM render_jobs WHERE id = 'job-malformed'")" = "not-json"
test -z "$(sqlite3 "$database" 'PRAGMA foreign_key_check')"
test "$(sqlite3 "$database" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_render_attempts_job', 'idx_render_jobs_workspace', 'idx_render_jobs_active', 'idx_render_jobs_idempotency', 'idx_render_jobs_workflow_instance', 'idx_render_outputs_artifact_identity')")" = "6"

printf 'durable render migration verified\n'
