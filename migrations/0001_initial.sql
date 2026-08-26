PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('demo', 'personal')),
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'api', 'seed')),
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision)
);

CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'partially_accepted', 'accepted', 'rejected')),
  created_by TEXT NOT NULL CHECK (created_by IN ('human', 'agent')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE change_operations (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  summary TEXT NOT NULL,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  UNIQUE (change_set_id, position)
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_id TEXT NOT NULL REFERENCES documents(id),
  name TEXT NOT NULL,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE template_versions (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);

CREATE TABLE render_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'completed', 'failed')),
  request_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (template_id, template_version) REFERENCES template_versions(template_id, version)
);

CREATE TABLE render_outputs (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('png', 'pdf')),
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_documents_workspace ON documents(workspace_id, updated_at DESC);
CREATE INDEX idx_render_jobs_workspace ON render_jobs(workspace_id, created_at DESC);
CREATE INDEX idx_demo_sessions_expiry ON demo_sessions(expires_at);
