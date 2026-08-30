import { createHash } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative, resolve } from "node:path"

export type DeploymentRecord = {
  id?: unknown
  source?: unknown
  strategy?: unknown
  author_email?: unknown
  versions?: unknown
  created_on?: unknown
}

export type SafeDeploymentIdentity = {
  deploymentId: string
  versionIds: string[]
  createdAt: string
}

export type MigrationPrefix = {
  exactPrefix: true
  exactMatch: boolean
  applied: string[]
  pending: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")

export function parseJsonOutput<T>(output: string, label: string): T {
  try {
    return JSON.parse(output) as T
  } catch {
    throw new Error(`${label} did not return valid JSON`)
  }
}

export function safeDeploymentIdentity(
  records: DeploymentRecord[],
  label: string
): SafeDeploymentIdentity {
  const record = records.at(0)
  if (!record || typeof record.id !== "string" || !UUID.test(record.id)) {
    throw new Error(`${label} has no current deployment identity`)
  }
  if (
    typeof record.created_on !== "string" ||
    !Number.isFinite(Date.parse(record.created_on))
  ) {
    throw new Error(`${label} has no valid deployment timestamp`)
  }
  if (!Array.isArray(record.versions) || record.versions.length < 1) {
    throw new Error(`${label} has no deployed Worker version`)
  }
  const versionIds = record.versions.map((version) => {
    const id =
      version && typeof version === "object"
        ? (version as { version_id?: unknown }).version_id
        : null
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new Error(`${label} returned an invalid Worker version identity`)
    }
    return id
  })
  return {
    deploymentId: record.id,
    versionIds,
    createdAt: record.created_on,
  }
}

export function inspectMigrationPrefix(
  localMigrations: readonly string[],
  appliedMigrations: readonly string[]
): MigrationPrefix {
  if (
    appliedMigrations.length > localMigrations.length ||
    appliedMigrations.some(
      (migration, index) => migration !== localMigrations[index]
    )
  ) {
    throw new Error(
      `Remote migration ledger is not an exact local prefix: ${JSON.stringify(appliedMigrations)}`
    )
  }
  return {
    exactPrefix: true,
    exactMatch: appliedMigrations.length === localMigrations.length,
    applied: [...appliedMigrations],
    pending: localMigrations.slice(appliedMigrations.length),
  }
}

const forbiddenPatterns: ReadonlyArray<readonly [string, RegExp]> = [
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["authorization material", /authorization|cf-access-jwt-assertion/i],
  ["cookie material", /set-cookie|cookie|webmcp_demo_session/i],
  ["JWT", /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/],
  ["local asset identity", /asset:local\//i],
  ["private R2 key", /media\/workspaces\//i],
  ["signed URL", /(?:x-amz-|x-goog-|signature=|token=)/i],
  ["data URI", /data:image\//i],
  ["object URL", /blob:/i],
]

export function assertSafeProductionEvidence(
  value: unknown,
  forbiddenExactValues: readonly string[] = []
) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  for (const [label, pattern] of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`Production evidence contains ${label}`)
    }
  }
  for (const exactValue of forbiddenExactValues) {
    if (exactValue && serialized.includes(exactValue)) {
      throw new Error("Production evidence contains a private exact value")
    }
  }
}

const filesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

export function scanProductionEvidenceDirectory(
  directory: string,
  forbiddenExactValues: readonly string[] = []
) {
  for (const path of filesUnder(directory)) {
    assertSafeProductionEvidence(
      readFileSync(path, "utf8"),
      forbiddenExactValues
    )
  }
}

export function productionEvidencePaths(runsRoot: string, runId: string) {
  if (!/^prod-readonly-[0-9a-f-]{36}$/.test(runId)) {
    throw new Error("Production evidence run ID is not canonical")
  }
  const root = resolve(runsRoot)
  const staging = resolve(root, `.capture-${runId}`)
  const final = resolve(root, runId)
  if (
    relative(root, staging).startsWith("..") ||
    relative(root, final).startsWith("..")
  ) {
    throw new Error("Production evidence path escaped its run root")
  }
  return { root, staging, final }
}

export function writeAndPromoteProductionBaseline(input: {
  runsRoot: string
  runId: string
  baseline: unknown
  forbiddenExactValues?: readonly string[]
}) {
  const paths = productionEvidencePaths(input.runsRoot, input.runId)
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.staging, { recursive: false })
  try {
    const baselineBytes = Buffer.from(
      `${JSON.stringify(input.baseline, null, 2)}\n`
    )
    assertSafeProductionEvidence(
      baselineBytes.toString("utf8"),
      input.forbiddenExactValues
    )
    writeFileSync(join(paths.staging, "baseline.json"), baselineBytes)
    const manifest = {
      schemaVersion: 1,
      runId: input.runId,
      artifacts: [
        {
          path: "baseline.json",
          bytes: baselineBytes.byteLength,
          sha256: sha256(baselineBytes),
        },
      ],
    }
    assertSafeProductionEvidence(manifest, input.forbiddenExactValues)
    writeFileSync(
      join(paths.staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    scanProductionEvidenceDirectory(paths.staging, input.forbiddenExactValues)
    renameSync(paths.staging, paths.final)
    return {
      directory: paths.final,
      relativeDirectory: basename(paths.final),
      manifest,
    }
  } catch (error) {
    rmSync(paths.staging, { recursive: true, force: true })
    throw error
  }
}
