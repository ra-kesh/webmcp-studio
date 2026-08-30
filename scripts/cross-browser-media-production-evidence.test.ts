import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import {
  assertSafeProductionEvidence,
  inspectMigrationPrefix,
  safeDeploymentIdentity,
  scanProductionEvidenceDirectory,
  writeAndPromoteProductionBaseline,
} from "./cross-browser-media-production-evidence"

const temporaryDirectories: string[] = []
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "production-evidence-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("production evidence boundary", () => {
  it("accepts an exact remote migration prefix and retains the pending suffix", () => {
    expect(
      inspectMigrationPrefix(
        ["0001_initial.sql", "0002_next.sql", "0003_last.sql"],
        ["0001_initial.sql"]
      )
    ).toEqual({
      exactPrefix: true,
      exactMatch: false,
      applied: ["0001_initial.sql"],
      pending: ["0002_next.sql", "0003_last.sql"],
    })
  })

  it("rejects divergent or overlong remote migration ledgers", () => {
    expect(() =>
      inspectMigrationPrefix(
        ["0001_initial.sql", "0002_next.sql"],
        ["0001_initial.sql", "0003_wrong.sql"]
      )
    ).toThrow("not an exact local prefix")
    expect(() =>
      inspectMigrationPrefix(
        ["0001_initial.sql"],
        ["0001_initial.sql", "0002_remote-only.sql"]
      )
    ).toThrow("not an exact local prefix")
  })

  it("projects deployment identity without retaining the author", () => {
    const projected = safeDeploymentIdentity(
      [
        {
          id: "47d3b71d-f0c3-4a31-ade5-23892e61725d",
          author_email: "private@example.com",
          created_on: "2026-08-29T21:45:41.736Z",
          versions: [{ version_id: "e6c32ac4-5ecb-45a3-b9b3-f23493651a08" }],
        },
      ],
      "Studio"
    )
    expect(projected).toEqual({
      deploymentId: "47d3b71d-f0c3-4a31-ade5-23892e61725d",
      versionIds: ["e6c32ac4-5ecb-45a3-b9b3-f23493651a08"],
      createdAt: "2026-08-29T21:45:41.736Z",
    })
    expect(JSON.stringify(projected)).not.toContain("private@example.com")
  })

  it("rejects credentials, private identities, media payloads and private keys", () => {
    for (const unsafe of [
      "owner@example.com",
      "Authorization: Bearer secret",
      "Set-Cookie: session=secret",
      "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "asset:local/private-alias",
      "media/workspaces/private/object.png",
      "https://example.com/file?X-Amz-Signature=secret",
      "data:image/png;base64,secret",
      "blob:https://example.com/private",
    ]) {
      expect(() => assertSafeProductionEvidence(unsafe)).toThrow()
    }
    expect(() =>
      assertSafeProductionEvidence({ audience: "private-audience" }, [
        "private-audience",
      ])
    ).toThrow("private exact value")
  })

  it("promotes only a recursively scanned safe staging directory", () => {
    const root = temporaryDirectory()
    const runId = "prod-readonly-47d3b71d-f0c3-4a31-ade5-23892e61725d"
    const promoted = writeAndPromoteProductionBaseline({
      runsRoot: root,
      runId,
      baseline: { ok: true, writesAttempted: false },
    })
    expect(
      readFileSync(join(promoted.directory, "baseline.json"), "utf8")
    ).toContain('"writesAttempted": false')
    expect(
      readFileSync(join(promoted.directory, "manifest.json"), "utf8")
    ).toContain('"sha256"')
  })

  it("finds unsafe material during the final recursive scan", () => {
    const root = temporaryDirectory()
    writeFileSync(join(root, "unsafe.json"), '{"email":"owner@example.com"}')
    expect(() => scanProductionEvidenceDirectory(root)).toThrow("email address")
  })

  it("removes an unsafe staging directory instead of promoting it", () => {
    const root = temporaryDirectory()
    const runId = "prod-readonly-eaa0ca17-d13a-4f25-adbe-7dcdde2bf939"
    expect(() =>
      writeAndPromoteProductionBaseline({
        runsRoot: root,
        runId,
        baseline: { author: "owner@example.com" },
      })
    ).toThrow("email address")
    expect(existsSync(join(root, `.capture-${runId}`))).toBe(false)
    expect(existsSync(join(root, runId))).toBe(false)
  })
})
