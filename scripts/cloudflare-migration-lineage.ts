import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export type MigrationLineageEntry = Readonly<{
  name: string
  sha256: string
}>

export type MigrationLineage = Readonly<{
  migrations: readonly MigrationLineageEntry[]
  lineageSha256: string
}>

type MigrationManifest = Readonly<{
  schemaVersion: 1
  migrations: readonly MigrationLineageEntry[]
}>

const migrationNamePattern = /^\d{4}_.+\.sql$/
const sha256Pattern = /^[0-9a-f]{64}$/

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")

const parseManifest = (value: unknown): MigrationManifest => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((value as { migrations?: unknown }).migrations)
  ) {
    throw new Error("D1 migration manifest is not schema version 1")
  }

  const migrations = (value as { migrations: unknown[] }).migrations.map(
    (entry, index): MigrationLineageEntry => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof (entry as { name?: unknown }).name !== "string" ||
        !migrationNamePattern.test((entry as { name: string }).name) ||
        typeof (entry as { sha256?: unknown }).sha256 !== "string" ||
        !sha256Pattern.test((entry as { sha256: string }).sha256)
      ) {
        throw new Error(`D1 migration manifest entry ${index + 1} is invalid`)
      }
      return {
        name: (entry as { name: string }).name,
        sha256: (entry as { sha256: string }).sha256,
      }
    }
  )

  return { schemaVersion: 1, migrations }
}

export function validateMigrationLineage(
  manifestValue: unknown,
  actualMigrations: readonly MigrationLineageEntry[]
): MigrationLineage {
  const manifest = parseManifest(manifestValue)
  if (manifest.migrations.length === 0) {
    throw new Error("D1 migration manifest is empty")
  }

  const expectedOrdinals = Array.from(
    { length: actualMigrations.length },
    (_, index) => String(index + 1).padStart(4, "0")
  )
  if (
    actualMigrations.some(
      (entry, index) => !entry.name.startsWith(`${expectedOrdinals[index]}_`)
    )
  ) {
    throw new Error("D1 migration ordinals are not contiguous from 0001")
  }

  const maximumLength = Math.max(
    manifest.migrations.length,
    actualMigrations.length
  )
  for (let index = 0; index < maximumLength; index += 1) {
    const expected = manifest.migrations[index]
    const actual = actualMigrations[index]
    if (!expected) {
      throw new Error(
        `D1 migration ${actual?.name ?? index + 1} is missing from manifest.json`
      )
    }
    if (!actual) {
      throw new Error(
        `D1 migration manifest references missing file ${expected.name}`
      )
    }
    if (expected.name !== actual.name) {
      throw new Error(
        `D1 migration manifest expected ${expected.name} at position ${index + 1}, found ${actual.name}`
      )
    }
    if (expected.sha256 !== actual.sha256) {
      throw new Error(
        `D1 migration ${actual.name} changed after its manifest digest was recorded`
      )
    }
  }

  const migrations = manifest.migrations.map((entry) => ({ ...entry }))
  return {
    migrations,
    lineageSha256: sha256(
      migrations.map((entry) => `${entry.name}:${entry.sha256}`).join("\n")
    ),
  }
}

export function loadMigrationLineage(repositoryRoot: string): MigrationLineage {
  const directory = join(repositoryRoot, "migrations")
  const actualMigrations = readdirSync(directory)
    .filter((name) => migrationNamePattern.test(name))
    .sort()
    .map((name) => ({
      name,
      sha256: sha256(readFileSync(join(directory, name))),
    }))
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8")
  ) as unknown
  return validateMigrationLineage(manifest, actualMigrations)
}
