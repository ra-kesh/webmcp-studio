#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
database="$(mktemp "${TMPDIR:-/tmp}/webmcp-api-audit.XXXXXX.sqlite")"
trap 'rm -f "$database"' EXIT

for migration in "$repo_root"/migrations/*.sql; do
  sqlite3 "$database" < "$migration"
done

sqlite3 "$database" <<'SQL'
INSERT INTO api_request_audit
  (request_id, occurred_at, method, route_path, status, duration_ms,
   principal_id, workspace_id, error_code, retryable)
VALUES
  ('expired', '2000-01-01T00:00:00.000Z', 'GET', '/v1/test', 200, 1,
   NULL, NULL, NULL, 0);

INSERT INTO api_request_audit
  (request_id, occurred_at, method, route_path, status, duration_ms,
   principal_id, workspace_id, error_code, retryable)
VALUES
  ('current', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'POST', '/v1/test',
   429, 2, NULL, NULL, 'rate_limited', 1);
SQL

test "$(sqlite3 "$database" "SELECT COUNT(*) FROM api_request_audit WHERE request_id = 'expired'")" = "0"
test "$(sqlite3 "$database" "SELECT COUNT(*) FROM api_request_audit WHERE request_id = 'current'")" = "1"
test "$(sqlite3 "$database" "SELECT COUNT(*) FROM pragma_index_list('api_request_audit')")" -ge "3"

echo "api audit migration verified"
