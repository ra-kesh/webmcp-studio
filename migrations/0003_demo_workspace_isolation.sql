ALTER TABLE documents ADD COLUMN public_id TEXT;
ALTER TABLE templates ADD COLUMN public_id TEXT;

UPDATE documents SET public_id = id WHERE public_id IS NULL;
UPDATE templates SET public_id = id WHERE public_id IS NULL;

CREATE UNIQUE INDEX idx_documents_workspace_public_id
ON documents(workspace_id, public_id);

CREATE UNIQUE INDEX idx_templates_workspace_public_id
ON templates(workspace_id, public_id);

DROP INDEX idx_template_versions_id;
CREATE INDEX idx_template_versions_id ON template_versions(id);
