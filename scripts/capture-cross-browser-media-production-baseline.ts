#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { parseConfigFileTextToJson } from "typescript"
import {
  inspectMigrationPrefix,
  parseJsonOutput,
  safeDeploymentIdentity,
  sha256,
  writeAndPromoteProductionBaseline,
} from "./cross-browser-media-production-evidence"

type WranglerConfig = {
  name?: string
  account_id?: string
  vars?: Record<string, string>
  workflows?: Array<{
    binding?: string
    name?: string
    class_name?: string
  }>
  d1_databases?: Array<{
    binding?: string
    database_name?: string
    database_id?: string
  }>
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>
}

type CommandResult = { stdout: string; stderr: string }

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const studioDirectory = join(repositoryRoot, "apps/studio")
const rendererDirectory = join(repositoryRoot, "apps/renderer")
const runsRoot = join(
  repositoryRoot,
  "docs/audits/2026-08-27-editor-production-readiness/artifacts/deployed-acceptance/runs"
)
const productionOrigin =
  process.env.WEBMCP_STUDIO_PRODUCTION_ORIGIN ??
  "https://webmcp-studio.iamrakeshkumar.workers.dev"
const productionURL = new URL(productionOrigin)
if (
  productionURL.protocol !== "https:" ||
  productionURL.username ||
  productionURL.password ||
  productionURL.pathname !== "/" ||
  productionURL.search ||
  productionURL.hash
) {
  throw new Error("Production origin must be one credential-free HTTPS origin")
}

if (process.argv.slice(2).some((argument) => argument !== "--read-only")) {
  throw new Error(
    "This runner currently accepts only --read-only; production writes require a separately authorized Slice 6C runner."
  )
}

const run = (cwd: string, label: string, command: string[]): CommandResult => {
  const result = Bun.spawnSync(command, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new TextDecoder().decode(result.stdout)
  const stderr = new TextDecoder().decode(result.stderr)
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`)
  }
  return { stdout, stderr }
}

const parseConfig = (path: string): WranglerConfig => {
  const parsed = parseConfigFileTextToJson(path, readFileSync(path, "utf8"))
  if (parsed.error) {
    throw new Error(`Could not parse ${path}: ${parsed.error.messageText}`)
  }
  return parsed.config as WranglerConfig
}

const gitCommit = run(repositoryRoot, "git commit", [
  "git",
  "rev-parse",
  "HEAD",
]).stdout.trim()
const gitStatus = run(repositoryRoot, "git status", [
  "git",
  "status",
  "--porcelain",
]).stdout
if (gitStatus.trim()) {
  throw new Error(
    "Production baseline requires a clean committed worktree before capture."
  )
}

const studio = parseConfig(join(studioDirectory, "wrangler.jsonc"))
const renderer = parseConfig(join(rendererDirectory, "wrangler.jsonc"))
const database = studio.d1_databases?.find((item) => item.binding === "DB")
const workflow = studio.workflows?.find(
  (item) => item.binding === "RENDER_JOBS"
)
const accessAudience = studio.vars?.ACCESS_POLICY_AUD ?? ""
const accountId = studio.account_id ?? ""
if (
  !/^[0-9a-f]{40}$/.test(gitCommit) ||
  !/^[0-9a-f]{32}$/.test(accountId) ||
  !/^[0-9a-f]{64}$/.test(accessAudience) ||
  !database?.database_name ||
  !database.database_id ||
  !workflow?.name ||
  !workflow.class_name ||
  studio.name !== "webmcp-studio" ||
  renderer.name !== "webmcp-studio-renderer"
) {
  throw new Error("Production configuration identity is incomplete")
}

run(repositoryRoot, "post-deploy preflight", [
  "bun",
  "scripts/verify-cloudflare-deployment-preflight.ts",
  "--post-deploy",
])

const wranglerVersionOutput = run(repositoryRoot, "Wrangler version", [
  "bunx",
  "wrangler",
  "--version",
]).stdout.trim()
const wranglerVersion = wranglerVersionOutput.match(/\d+\.\d+\.\d+/)?.[0]
if (!wranglerVersion) throw new Error("Wrangler version was not recognized")

const whoami = parseJsonOutput<{
  loggedIn?: boolean
  accounts?: Array<{ id?: string }>
}>(
  run(studioDirectory, "Wrangler identity", [
    "bunx",
    "wrangler",
    "whoami",
    "--json",
  ]).stdout,
  "Wrangler identity"
)
if (
  whoami.loggedIn !== true ||
  !whoami.accounts?.some((item) => item.id === accountId)
) {
  throw new Error("Wrangler identity does not match the configured account")
}

const remoteDatabases = parseJsonOutput<
  Array<{ name?: string; uuid?: string }>
>(
  run(studioDirectory, "D1 inventory", [
    "bunx",
    "wrangler",
    "d1",
    "list",
    "--json",
  ]).stdout,
  "D1 inventory"
)
const remoteDatabase = remoteDatabases.find(
  (item) => item.name === database.database_name
)
if (!remoteDatabase || remoteDatabase.uuid !== database.database_id) {
  throw new Error("Configured D1 UUID does not match the remote database")
}

const r2Output = run(studioDirectory, "R2 inventory", [
  "bunx",
  "wrangler",
  "r2",
  "bucket",
  "list",
]).stdout
const configuredBuckets = [
  ...new Set(
    [...(studio.r2_buckets ?? []), ...(renderer.r2_buckets ?? [])].flatMap(
      (item) => item.bucket_name ?? []
    )
  ),
].sort()
for (const bucket of configuredBuckets) {
  if (
    !new RegExp(
      `^name:\\s+${bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
      "m"
    ).test(r2Output)
  ) {
    throw new Error(`Remote R2 bucket ${bucket} is missing`)
  }
}

const studioDeployment = safeDeploymentIdentity(
  parseJsonOutput(
    run(studioDirectory, "Studio deployments", [
      "bunx",
      "wrangler",
      "deployments",
      "list",
      "--json",
      "--name",
      studio.name ?? "",
    ]).stdout,
    "Studio deployments"
  ),
  "Studio"
)
const rendererDeployment = safeDeploymentIdentity(
  parseJsonOutput(
    run(rendererDirectory, "Renderer deployments", [
      "bunx",
      "wrangler",
      "deployments",
      "list",
      "--json",
      "--name",
      renderer.name ?? "",
    ]).stdout,
    "Renderer deployments"
  ),
  "Renderer"
)

const workflowOutput = run(studioDirectory, "Workflow inventory", [
  "bunx",
  "wrangler",
  "workflows",
  "list",
]).stdout
if (
  !workflowOutput.includes(workflow.name) ||
  !workflowOutput.includes(workflow.class_name)
) {
  throw new Error("Configured render Workflow is not present remotely")
}

const migrationOutput = parseJsonOutput<
  Array<{
    results?: Array<{ id?: number; name?: string }>
    success?: boolean
    meta?: { rows_written?: number; changed_db?: boolean }
  }>
>(
  run(studioDirectory, "remote migration ledger", [
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--json",
    "--command",
    "SELECT id, name FROM d1_migrations ORDER BY id",
  ]).stdout,
  "Remote migration ledger"
)
if (
  migrationOutput.some(
    (statement) =>
      statement.success !== true ||
      statement.meta?.rows_written !== 0 ||
      statement.meta?.changed_db !== false
  )
) {
  throw new Error("Remote migration inspection was not read-only")
}
const appliedMigrations = migrationOutput.flatMap((statement) =>
  (statement.results ?? []).map((row) => row.name ?? "")
)
const localMigrations = readdirSync(join(repositoryRoot, "migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
const migrationPrefix = inspectMigrationPrefix(
  localMigrations,
  appliedMigrations
)

const userDataDirectory = mkdtempSync(
  join(tmpdir(), "webmcp-studio-production-")
)
const resolvedProfile = realpathSync(userDataDirectory)
if (!relative(repositoryRoot, resolvedProfile).startsWith("..")) {
  throw new Error("Temporary browser profile was created inside the repository")
}
let unauthenticatedStatus = 0
let redirectHostHash = ""
try {
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: "chrome",
    headless: true,
  })
  try {
    const page = context.pages().at(0) ?? (await context.newPage())
    const protectedResponse = new Promise<{
      status: number
      location: string | null
    }>((resolveResponse) => {
      page.on("response", async (response) => {
        if (response.url().replace(/\/$/, "") !== productionURL.origin) return
        const headers = await response.allHeaders()
        resolveResponse({
          status: response.status(),
          location: headers.location ?? null,
        })
      })
    })
    await page.goto(productionOrigin, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    })
    const response = await protectedResponse
    unauthenticatedStatus = response.status
    const location = response.location
    if (!location)
      throw new Error("Protected production origin did not redirect")
    redirectHostHash = sha256(new URL(location, productionOrigin).hostname)
  } finally {
    await context.close()
  }
} finally {
  rmSync(userDataDirectory, { recursive: true, force: true })
}
if (![301, 302, 303, 307, 308].includes(unauthenticatedStatus)) {
  throw new Error("Unauthenticated production origin was not Access-protected")
}

const runId = `prod-readonly-${randomUUID()}`
const capturedAt = new Date().toISOString()
const baseline = {
  schemaVersion: 1,
  kind: "cross_browser_media_production_baseline",
  mode: "read_only",
  runId,
  capturedAt,
  productionOrigin,
  repository: { commit: gitCommit, clean: true },
  authority: {
    writesAuthorized: false,
    writesAttempted: false,
    ownerLoginAttempted: false,
  },
  isolation: {
    temporaryProfileOutsideRepository: true,
    storageStateExported: false,
    browserContextOwnsRequests: true,
    futureFixturePrefix: runId,
  },
  access: {
    unauthenticatedStatus,
    redirectHostSha256: redirectHostHash,
    audienceSha256: sha256(accessAudience),
  },
  cloudflare: {
    postDeployPreflight: "passed",
    wranglerVersion,
    configuredAccountMatchesAuthenticatedAccount: true,
    d1: {
      name: database.database_name,
      uuid: database.database_id,
      migrations: migrationPrefix,
    },
    r2: { bucketNames: configuredBuckets, remoteInventoryMatched: true },
    workers: {
      studio: studioDeployment,
      renderer: rendererDeployment,
    },
    workflow: {
      name: workflow.name,
      scriptName: studio.name,
      className: workflow.class_name,
      remoteInventoryMatched: true,
    },
  },
  productionWriteReady: migrationPrefix.exactMatch,
  blockers: migrationPrefix.exactMatch
    ? []
    : [
        {
          code: "remote_migration_suffix_pending",
          pendingMigrations: migrationPrefix.pending,
        },
      ],
}

const promoted = writeAndPromoteProductionBaseline({
  runsRoot,
  runId,
  baseline,
  forbiddenExactValues: [accountId, accessAudience],
})
console.log(
  JSON.stringify(
    {
      ok: true,
      mode: "read_only",
      runId,
      evidence: relative(repositoryRoot, promoted.directory),
      productionWriteReady: migrationPrefix.exactMatch,
      pendingMigrations: migrationPrefix.pending,
    },
    null,
    2
  )
)
