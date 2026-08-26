ALTER TABLE template_versions ADD COLUMN id TEXT;
ALTER TABLE template_versions ADD COLUMN source_revision INTEGER;

UPDATE template_versions
SET id = template_id || '-v' || version,
    source_revision = json_extract(document_json, '$.revision')
WHERE id IS NULL OR source_revision IS NULL;

CREATE UNIQUE INDEX idx_template_versions_id ON template_versions(id);

ALTER TABLE render_outputs ADD COLUMN page_id TEXT;

ALTER TABLE render_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE render_jobs ADD COLUMN request_hash TEXT;

CREATE UNIQUE INDEX idx_render_jobs_idempotency
ON render_jobs(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
