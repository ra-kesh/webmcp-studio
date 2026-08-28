PRAGMA foreign_keys = OFF;

CREATE TABLE document_revisions_v2 (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'api', 'seed')),
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, snapshot_id)
);

INSERT INTO document_revisions_v2
  (document_id, snapshot_id, revision, actor, document_json, created_at)
SELECT
  document_id,
  'legacy-revision-' || revision,
  revision,
  actor,
  document_json,
  created_at
FROM document_revisions;

DROP TABLE document_revisions;
ALTER TABLE document_revisions_v2 RENAME TO document_revisions;

CREATE INDEX idx_document_revisions_revision
ON document_revisions(document_id, revision);

ALTER TABLE template_versions ADD COLUMN source_snapshot_id TEXT;

UPDATE template_versions
SET source_snapshot_id = COALESCE(
  (
    SELECT dr.snapshot_id
    FROM templates t
    JOIN document_revisions dr
      ON dr.document_id = t.source_document_id
     AND dr.revision = template_versions.source_revision
    WHERE t.id = template_versions.template_id
    LIMIT 1
  ),
  'legacy-template-version-' || template_versions.id
)
WHERE source_snapshot_id IS NULL;

CREATE UNIQUE INDEX idx_template_versions_source_snapshot
ON template_versions(template_id, source_snapshot_id);

PRAGMA foreign_keys = ON;
