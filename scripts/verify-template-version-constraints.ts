import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createTemplateManifest,
  northstarSeed,
  templateVersionSchema,
} from "../packages/document/src/index"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const migrationPath = (name: string) => join(repositoryRoot, "migrations", name)
const migrationSql = (name: string) => readFileSync(migrationPath(name), "utf8")

const migrationNames = [
  "0001_initial.sql",
  "0002_published_version_identity.sql",
  "0003_demo_workspace_isolation.sql",
  "0004_branch_safe_publication_identity.sql",
  "0005_render_output_identity.sql",
] as const

type DatabaseFixture = {
  db: Database
  databasePath: string
  directory: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createDatabaseFixture(label: string): DatabaseFixture {
  const directory = mkdtempSync(join(tmpdir(), `webmcp-${label}-`))
  const databasePath = join(directory, "migration.sqlite")
  const db = new Database(databasePath, {
    create: true,
    strict: true,
  })
  db.exec("PRAGMA foreign_keys = ON")
  return { db, databasePath, directory }
}

function closeDatabaseFixture(fixture: DatabaseFixture) {
  fixture.db.close()
  rmSync(fixture.directory, { recursive: true, force: true })
}

function insertLegacyPublication(db: Database) {
  const documentJson = JSON.stringify(northstarSeed)
  const manifestJson = JSON.stringify(createTemplateManifest(northstarSeed))
  const publishedAt = "2026-08-28T00:00:00.000Z"

  db.query(
    "INSERT INTO workspaces (id, name, kind, created_at) VALUES (?, ?, ?, ?)"
  ).run("workspace-valid", "Valid workspace", "personal", publishedAt)
  db.query(
    `INSERT INTO documents
       (id, workspace_id, name, current_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "document-valid",
    "workspace-valid",
    northstarSeed.name,
    northstarSeed.revision,
    northstarSeed.createdAt,
    northstarSeed.updatedAt
  )
  db.query(
    `INSERT INTO document_revisions
       (document_id, revision, actor, document_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "document-valid",
    northstarSeed.revision,
    "human",
    documentJson,
    publishedAt
  )
  db.query(
    `INSERT INTO templates
       (id, workspace_id, source_document_id, name, latest_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "template-valid",
    "workspace-valid",
    "document-valid",
    northstarSeed.name,
    1,
    publishedAt
  )
  db.query(
    `INSERT INTO template_versions
       (template_id, version, document_json, manifest_json, published_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run("template-valid", 1, documentJson, manifestJson, publishedAt)
  db.query(
    `INSERT INTO render_jobs
       (id, workspace_id, template_id, template_version, status, request_json,
        created_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "render-valid",
    "workspace-valid",
    "template-valid",
    1,
    "completed",
    JSON.stringify({ outputId: northstarSeed.outputs[0]!.id, format: "pdf" }),
    publishedAt,
    publishedAt,
    publishedAt
  )
  db.query(
    `INSERT INTO render_outputs
       (id, render_job_id, output_id, format, r2_key, width, height, bytes,
        checksum, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "output-valid",
    "render-valid",
    northstarSeed.outputs[0]!.id,
    "pdf",
    "renders/render-valid/proposal.pdf",
    null,
    null,
    4096,
    "sha256-valid",
    publishedAt
  )
}

function databaseAtMigrationFive(label: string): DatabaseFixture {
  const fixture = createDatabaseFixture(label)
  fixture.db.exec(migrationSql(migrationNames[0]))
  insertLegacyPublication(fixture.db)
  for (const name of migrationNames.slice(1)) {
    fixture.db.exec(migrationSql(name))
  }
  fixture.db.exec("PRAGMA foreign_keys = ON")
  const checkPragma = fixture.db
    .query("PRAGMA ignore_check_constraints")
    .get() as {
    ignore_check_constraints: number
  }
  assert(
    checkPragma.ignore_check_constraints === 0,
    "legacy fixture unexpectedly disables CHECK constraints"
  )
  return fixture
}

const selectRows = (db: Database, table: string) =>
  db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()

const selectSchema = (db: Database) =>
  db
    .query(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all()

function applyMigrationSix(fixture: DatabaseFixture) {
  fixture.db.close()
  const result = spawnSync("sqlite3", [fixture.databasePath], {
    encoding: "utf8",
    input: [
      ".bail on",
      "PRAGMA foreign_keys = ON;",
      "BEGIN IMMEDIATE;",
      `.read ${migrationPath("0006_template_version_constraints.sql")}`,
      "COMMIT;",
      "",
    ].join("\n"),
  })
  fixture.db = new Database(fixture.databasePath, { strict: true })
  fixture.db.exec("PRAGMA foreign_keys = ON")
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim())
  }
}

function verifyValidLegacyMigration() {
  const fixture = databaseAtMigrationFive("valid-publication")
  try {
    const renderJobsBefore = selectRows(fixture.db, "render_jobs")
    const renderOutputsBefore = selectRows(fixture.db, "render_outputs")

    applyMigrationSix(fixture)

    const columns = fixture.db
      .query("PRAGMA table_info(template_versions)")
      .all() as Array<{ name: string; notnull: number; pk: number }>
    const byName = new Map(columns.map((column) => [column.name, column]))
    for (const name of ["id", "source_revision", "source_snapshot_id"]) {
      assert(byName.get(name)?.notnull === 1, `${name} must be NOT NULL`)
    }
    assert(byName.get("template_id")?.pk === 1, "template_id must lead the PK")
    assert(byName.get("version")?.pk === 2, "version must complete the PK")

    const tableSql = fixture.db
      .query(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'template_versions'"
      )
      .get() as { sql: string }
    for (const constraint of [
      "chk_template_versions_document_json",
      "chk_template_versions_manifest_json",
      "chk_template_versions_id",
      "chk_template_versions_source_revision",
      "chk_template_versions_source_snapshot_id",
    ]) {
      assert(
        tableSql.sql.includes(constraint),
        `template_versions is missing ${constraint}`
      )
    }

    const indexes = fixture.db
      .query("PRAGMA index_list(template_versions)")
      .all() as Array<{ name: string; unique: number }>
    const indexesByName = new Map(indexes.map((index) => [index.name, index]))
    assert(
      indexesByName.get("idx_template_versions_id")?.unique === 0,
      "version ID lookup index must be preserved"
    )
    assert(
      indexesByName.get("idx_template_versions_source_snapshot")?.unique === 1,
      "snapshot uniqueness index must be preserved"
    )

    const templateForeignKeys = fixture.db
      .query("PRAGMA foreign_key_list(template_versions)")
      .all() as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>
    assert(
      templateForeignKeys.some(
        (foreignKey) =>
          foreignKey.table === "templates" &&
          foreignKey.from === "template_id" &&
          foreignKey.to === "id" &&
          foreignKey.on_delete === "CASCADE"
      ),
      "template_versions.template_id foreign key must be preserved"
    )

    const jobForeignKeys = fixture.db
      .query("PRAGMA foreign_key_list(render_jobs)")
      .all() as Array<{ table: string; from: string; to: string }>
    const versionKeyParts = jobForeignKeys.filter(
      (foreignKey) => foreignKey.table === "template_versions"
    )
    assert(
      versionKeyParts.length === 2,
      "render job composite FK must be preserved"
    )
    assert(
      versionKeyParts.some(
        (foreignKey) =>
          foreignKey.from === "template_id" && foreignKey.to === "template_id"
      ) &&
        versionKeyParts.some(
          (foreignKey) =>
            foreignKey.from === "template_version" &&
            foreignKey.to === "version"
        ),
      "render job FK must still target the template version identity"
    )

    assert(
      JSON.stringify(selectRows(fixture.db, "render_jobs")) ===
        JSON.stringify(renderJobsBefore),
      "render jobs changed during the parent-table rebuild"
    )
    assert(
      JSON.stringify(selectRows(fixture.db, "render_outputs")) ===
        JSON.stringify(renderOutputsBefore),
      "render outputs changed during the parent-table rebuild"
    )

    const row = fixture.db
      .query(
        "SELECT * FROM template_versions WHERE template_id = ? AND version = ?"
      )
      .get("template-valid", 1) as Record<string, unknown>
    templateVersionSchema.parse({
      id: row.id,
      templateId: row.template_id,
      version: row.version,
      sourceRevision: row.source_revision,
      sourceSnapshotId: row.source_snapshot_id,
      publishedAt: row.published_at,
      document: JSON.parse(String(row.document_json)),
      manifest: JSON.parse(String(row.manifest_json)),
    })

    const foreignKeyViolations = fixture.db
      .query("PRAGMA foreign_key_check")
      .all()
    assert(
      foreignKeyViolations.length === 0,
      "foreign_key_check found violations"
    )
    console.log(
      "valid legacy row: migrated, runtime-parsed, dependent rows preserved, schema/FKs clean"
    )
  } finally {
    closeDatabaseFixture(fixture)
  }
}

type InvalidCase = {
  label: string
  mutation: string
  expectedError: RegExp
}

function verifyTransactionalRejection(testCase: InvalidCase) {
  const fixture = databaseAtMigrationFive(testCase.label)
  try {
    fixture.db.exec(testCase.mutation)
    const schemaBefore = selectSchema(fixture.db)
    const rowBefore = selectRows(fixture.db, "template_versions")
    assert(rowBefore.length === 1, `${testCase.label} fixture row is missing`)
    if (testCase.label === "malformed-document-json") {
      assert(
        (rowBefore[0] as { document_json: string }).document_json ===
          "{malformed",
        `${testCase.label} fixture mutation was not applied`
      )
    }
    if (testCase.label === "null-source-revision") {
      assert(
        (rowBefore[0] as { source_revision: number | null }).source_revision ===
          null,
        `${testCase.label} fixture mutation was not applied`
      )
    }
    if (testCase.label === "null-source-snapshot") {
      assert(
        (rowBefore[0] as { source_snapshot_id: string | null })
          .source_snapshot_id === null,
        `${testCase.label} fixture mutation was not applied`
      )
    }
    const jobsBefore = selectRows(fixture.db, "render_jobs")
    const outputsBefore = selectRows(fixture.db, "render_outputs")

    let failure = ""
    try {
      applyMigrationSix(fixture)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    assert(
      failure.length > 0,
      `${testCase.label} migration unexpectedly succeeded`
    )
    assert(
      testCase.expectedError.test(failure),
      `${testCase.label} returned a non-actionable error: ${failure}`
    )
    assert(
      JSON.stringify(selectSchema(fixture.db)) === JSON.stringify(schemaBefore),
      `${testCase.label} did not roll back schema changes`
    )
    assert(
      JSON.stringify(selectRows(fixture.db, "template_versions")) ===
        JSON.stringify(rowBefore),
      `${testCase.label} did not retain the row requiring repair`
    )
    assert(
      JSON.stringify(selectRows(fixture.db, "render_jobs")) ===
        JSON.stringify(jobsBefore) &&
        JSON.stringify(selectRows(fixture.db, "render_outputs")) ===
          JSON.stringify(outputsBefore),
      `${testCase.label} changed render history despite rollback`
    )
    const leftovers = fixture.db
      .query(
        `SELECT name FROM sqlite_schema
         WHERE name IN (
           'template_versions_v2',
           'render_jobs_migration_backup',
           'render_outputs_migration_backup'
         )`
      )
      .all()
    assert(
      leftovers.length === 0,
      `${testCase.label} left migration tables behind`
    )
    console.log(`${testCase.label}: rejected and rolled back (${failure})`)
  } finally {
    closeDatabaseFixture(fixture)
  }
}

verifyValidLegacyMigration()

for (const testCase of [
  {
    label: "malformed-document-json",
    mutation:
      "UPDATE template_versions SET document_json = '{malformed' WHERE template_id = 'template-valid'",
    expectedError: /chk_template_versions_document_json|malformed JSON/i,
  },
  {
    label: "null-source-revision",
    mutation:
      "UPDATE template_versions SET source_revision = NULL WHERE template_id = 'template-valid'",
    expectedError: /source_revision/i,
  },
  {
    label: "null-source-snapshot",
    mutation:
      "UPDATE template_versions SET source_snapshot_id = NULL WHERE template_id = 'template-valid'",
    expectedError: /source_snapshot_id/i,
  },
] satisfies InvalidCase[]) {
  verifyTransactionalRejection(testCase)
}

console.log("template version migration verification passed")
