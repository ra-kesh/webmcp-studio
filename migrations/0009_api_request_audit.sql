CREATE TABLE api_request_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  method TEXT NOT NULL,
  route_path TEXT NOT NULL,
  status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  principal_id TEXT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  error_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1))
);

CREATE INDEX api_request_audit_workspace_occurred
  ON api_request_audit(workspace_id, occurred_at DESC);

CREATE INDEX api_request_audit_status_occurred
  ON api_request_audit(status, occurred_at DESC);

CREATE INDEX api_request_audit_request_id
  ON api_request_audit(request_id);
