import { describe, expect, it } from "bun:test"
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadMigrationLineage,
  validateMigrationLineage,
} from "./cloudflare-migration-lineage"

const hash = (character: string) => character.repeat(64)
const entry = (name: string, character: string) => ({
  name,
  sha256: hash(character),
})
const actual = [entry("0001_initial.sql", "a"), entry("0002_next.sql", "b")]
const manifest = (migrations: typeof actual) => ({
  schemaVersion: 1,
  migrations,
})

describe("Cloudflare migration lineage", () => {
  it("loads the checked-in contiguous migration lineage", () => {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const lineage = loadMigrationLineage(repositoryRoot)
    const checkedInMigrationNames = readdirSync(
      join(repositoryRoot, "migrations")
    )
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()

    expect(lineage.migrations.map(({ name }) => name)).toEqual(
      checkedInMigrationNames
    )
    expect(lineage.migrations[0]?.name).toBe("0001_initial.sql")
    expect(lineage.lineageSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("accepts an append-only migration without a hardcoded lineage length", () => {
    const appended = [...actual, entry("0003_appended.sql", "c")]

    expect(validateMigrationLineage(manifest(appended), appended)).toEqual({
      migrations: appended,
      lineageSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it("rejects a historical migration content change", () => {
    expect(() =>
      validateMigrationLineage(manifest(actual), [
        actual[0],
        entry("0002_next.sql", "c"),
      ])
    ).toThrow("changed after its manifest digest was recorded")
  })

  it("rejects missing, extra, and reordered migration files", () => {
    expect(() =>
      validateMigrationLineage(manifest(actual), [actual[0]])
    ).toThrow("references missing file 0002_next.sql")
    expect(() =>
      validateMigrationLineage(manifest([actual[0]]), actual)
    ).toThrow("0002_next.sql is missing from manifest.json")
    expect(() =>
      validateMigrationLineage(manifest(actual), [actual[1], actual[0]])
    ).toThrow("ordinals are not contiguous")
  })

  it("rejects malformed manifest entries", () => {
    expect(() =>
      validateMigrationLineage(
        {
          schemaVersion: 1,
          migrations: [{ name: "0001_initial.sql", sha256: "not-a-hash" }],
        },
        [actual[0]]
      )
    ).toThrow("manifest entry 1 is invalid")
  })
})
