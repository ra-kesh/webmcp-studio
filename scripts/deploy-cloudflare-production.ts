#!/usr/bin/env bun

import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

type DeploymentMode = "plan" | "apply"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const studioDirectory = join(repositoryRoot, "apps/studio")
const rendererDirectory = join(repositoryRoot, "apps/renderer")
const localMigrations = readdirSync(join(repositoryRoot, "migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
const modeArgument = process.argv[2] ?? "--plan"
const mode = modeArgument.slice(2) as DeploymentMode

if (!(["plan", "apply"] as const).includes(mode)) {
  throw new Error(
    "Usage: bun scripts/deploy-cloudflare-production.ts [--plan|--apply]"
  )
}

if (
  mode === "apply" &&
  process.env.WEBMCP_STUDIO_DEPLOY_CONFIRM !== "webmcp-studio-production"
) {
  throw new Error(
    "Production deployment requires " +
      "WEBMCP_STUDIO_DEPLOY_CONFIRM=webmcp-studio-production"
  )
}

const run = (label: string, command: string[], cwd = repositoryRoot) => {
  console.log(`\n[${label}] ${command.join(" ")}`)
  const result = Bun.spawnSync(command, {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`)
  }
}

const queryRemoteD1 = (label: string, sql: string) => {
  console.log(`\n[${label}] read-only D1 query`)
  const result = Bun.spawnSync(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    {
      cwd: studioDirectory,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    }
  )
  const stdout = new TextDecoder().decode(result.stdout)
  const stderr = new TextDecoder().decode(result.stderr)
  if (result.exitCode !== 0) {
    if (stdout) console.error(stdout)
    if (stderr) console.error(stderr)
    throw new Error(`${label} failed with exit code ${result.exitCode}`)
  }
  const payload = JSON.parse(stdout) as
    | { results?: Array<Record<string, unknown>> }
    | Array<{ results?: Array<Record<string, unknown>> }>
  const statements = Array.isArray(payload) ? payload : [payload]
  return statements.flatMap((statement) => statement.results ?? [])
}

const inspectRemoteMigrationState = () => {
  const userTables = queryRemoteD1(
    "remote user-table inventory",
    `SELECT name FROM sqlite_schema
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'
     ORDER BY name`
  ).map((row) => String(row.name))

  if (!userTables.includes("d1_migrations")) {
    if (userTables.length > 0) {
      throw new Error(
        "Remote DB has user tables but no d1_migrations ledger; refusing to treat it as a first install"
      )
    }
    console.log(
      `Remote DB is an empty first install; ${localMigrations.length} migrations are pending.`
    )
    return localMigrations
  }

  const applied = queryRemoteD1(
    "remote migration ledger",
    "SELECT name FROM d1_migrations ORDER BY id"
  ).map((row) => String(row.name))
  const expectedPrefix = localMigrations.slice(0, applied.length)
  if (
    applied.length > localMigrations.length ||
    applied.some((name, index) => name !== expectedPrefix[index])
  ) {
    throw new Error(
      `Remote migration ledger is not an exact local prefix. Remote: ${JSON.stringify(applied)}`
    )
  }
  const pending = localMigrations.slice(applied.length)
  console.log(
    pending.length === 0
      ? "Remote migration ledger exactly matches local migrations."
      : `Pending migration suffix (${pending.length}): ${pending.join(", ")}`
  )
  return pending
}

run("remote resource preflight", [
  "bun",
  "scripts/verify-cloudflare-deployment-preflight.ts",
  "--remote-ready",
])
const plannedPendingMigrations = inspectRemoteMigrationState()
run("renderer package", ["bun", "run", "build"], rendererDirectory)
run("studio Worker package", ["bun", "run", "build:worker"], studioDirectory)

if (mode === "plan") {
  console.log(
    "\nDeployment plan passed. No remote resource, migration, Worker, Workflow, or object was changed."
  )
  process.exit(0)
}

const applyPendingMigrations = inspectRemoteMigrationState()
if (
  JSON.stringify(applyPendingMigrations) !==
  JSON.stringify(plannedPendingMigrations)
) {
  throw new Error(
    "Remote migration state changed after planning; refusing a stale deployment"
  )
}

run(
  "remote migration apply",
  ["bunx", "wrangler", "d1", "migrations", "apply", "DB", "--remote"],
  studioDirectory
)
run("renderer deploy", ["bun", "run", "deploy"], rendererDirectory)
run("studio deploy", ["bun", "run", "deploy"], studioDirectory)
run("post-deploy resource verification", [
  "bun",
  "scripts/verify-cloudflare-deployment-preflight.ts",
  "--post-deploy",
])
const remainingMigrations = inspectRemoteMigrationState()
if (remainingMigrations.length > 0) {
  throw new Error(
    `Deployment left migrations unapplied: ${remainingMigrations.join(", ")}`
  )
}

console.log(
  "\nCloudflare production deployment completed and was re-inspected."
)
