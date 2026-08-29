#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseConfigFileTextToJson } from "typescript"

type WranglerConfig = {
  name?: string
  account_id?: string
  workers_dev?: boolean
  preview_urls?: boolean
  vars?: Record<string, string>
  browser?: { binding?: string; remote?: boolean }
  services?: Array<{ binding?: string; service?: string }>
  workflows?: Array<{ binding?: string; name?: string; class_name?: string }>
  durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> }
  d1_databases?: Array<{
    binding?: string
    database_name?: string
    database_id?: string
    migrations_dir?: string
  }>
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>
}

type Mode = "static" | "remote-ready" | "post-deploy"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const studioDirectory = join(repositoryRoot, "apps/studio")
const rendererDirectory = join(repositoryRoot, "apps/renderer")

const modeArgument = process.argv[2] ?? "--static"
const mode = modeArgument.slice(2) as Mode
if (!(["static", "remote-ready", "post-deploy"] as const).includes(mode)) {
  throw new Error(
    "Usage: bun scripts/verify-cloudflare-deployment-preflight.ts " +
      "[--static|--remote-ready|--post-deploy]"
  )
}

const errors: string[] = []
const decoder = new TextDecoder()

const parseConfig = (path: string): WranglerConfig => {
  const parsed = parseConfigFileTextToJson(path, readFileSync(path, "utf8"))
  if (parsed.error) {
    throw new Error(`Could not parse ${path}: ${parsed.error.messageText}`)
  }
  return parsed.config as WranglerConfig
}

const findBinding = <T extends { binding?: string }>(
  bindings: T[] | undefined,
  binding: string
) => bindings?.find((candidate) => candidate.binding === binding)

const requireValue = (condition: unknown, message: string) => {
  if (!condition) errors.push(message)
}

const studio = parseConfig(join(studioDirectory, "wrangler.jsonc"))
const renderer = parseConfig(join(rendererDirectory, "wrangler.jsonc"))

requireValue(
  studio.name === "webmcp-studio",
  "Studio Worker name is not canonical"
)
requireValue(
  renderer.name === "webmcp-studio-renderer",
  "Renderer Worker name is not canonical"
)
requireValue(
  /^[0-9a-f]{32}$/i.test(studio.account_id ?? ""),
  "Studio is missing its production Cloudflare account_id"
)
requireValue(
  renderer.account_id === studio.account_id,
  "Studio and Renderer target different Cloudflare accounts"
)

const database = findBinding(studio.d1_databases, "DB")
requireValue(database, "Studio is missing the DB binding")
requireValue(
  database?.database_name === "webmcp-studio",
  "DB must target webmcp-studio"
)
requireValue(
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(database?.database_id ?? ""),
  "DB is missing its created Cloudflare database_id"
)
requireValue(
  database?.migrations_dir === "../../migrations",
  "DB migrations_dir must remain ../../migrations"
)

for (const [binding, bucketName] of [
  ["ASSETS", "webmcp-studio-assets"],
  ["RENDERS", "webmcp-studio-renders"],
] as const) {
  requireValue(
    findBinding(studio.r2_buckets, binding)?.bucket_name === bucketName,
    `Studio ${binding} must target ${bucketName}`
  )
}
requireValue(
  findBinding(renderer.r2_buckets, "RENDERS")?.bucket_name ===
    "webmcp-studio-renders",
  "Renderer RENDERS must target webmcp-studio-renders"
)
requireValue(
  renderer.browser?.binding === "BROWSER" && renderer.browser.remote === true,
  "Renderer production BROWSER binding must be explicit and remote"
)
requireValue(
  renderer.workers_dev === false && renderer.preview_urls === false,
  "Renderer workers.dev and preview URLs must both be explicitly disabled"
)
requireValue(
  findBinding(studio.services, "RENDERER")?.service ===
    "webmcp-studio-renderer",
  "Studio RENDERER must target webmcp-studio-renderer"
)
requireValue(
  findBinding(studio.workflows, "RENDER_JOBS")?.name ===
    "webmcp-studio-render-jobs",
  "Studio RENDER_JOBS must target webmcp-studio-render-jobs"
)
requireValue(
  studio.durable_objects?.bindings?.some(
    (binding) =>
      binding.name === "RENDER_ADMISSION" &&
      binding.class_name === "RenderAdmission"
  ),
  "Studio is missing the RenderAdmission Durable Object binding"
)
requireValue(
  studio.vars?.STUDIO_ACCESS_MODE === "cloudflare_access",
  "Production STUDIO_ACCESS_MODE must be cloudflare_access"
)
requireValue(
  /^https:\/\/[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(
    studio.vars?.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, "") ?? ""
  ),
  "ACCESS_TEAM_DOMAIN must be an https://*.cloudflareaccess.com issuer"
)
requireValue(
  /^[0-9a-f]{64}$/i.test(studio.vars?.ACCESS_POLICY_AUD?.trim() ?? ""),
  "ACCESS_POLICY_AUD must be a 64-hex Cloudflare Access application audience"
)

const migrations = readdirSync(join(repositoryRoot, "migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
const expectedOrdinals = Array.from({ length: migrations.length }, (_, index) =>
  String(index + 1).padStart(4, "0")
)
requireValue(migrations.length > 0, "No D1 migrations were found")
requireValue(
  migrations.every((name, index) =>
    name.startsWith(`${expectedOrdinals[index]}_`)
  ),
  "D1 migration ordinals are not contiguous from 0001"
)

const runWrangler = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["bunx", "wrangler", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    success: result.exitCode === 0,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  }
}

if (mode !== "static") {
  const whoami = runWrangler(studioDirectory, "whoami", "--json")
  requireValue(whoami.success, "Wrangler is not authenticated")
  if (whoami.success) {
    try {
      const identity = JSON.parse(whoami.output) as {
        loggedIn?: boolean
        accounts?: Array<{ id?: string }>
        tokenPermissions?: string[]
      }
      requireValue(identity.loggedIn, "Wrangler is not logged in")
      requireValue(
        identity.accounts?.some((account) => account.id === studio.account_id),
        "Authenticated Wrangler account does not match production account_id"
      )
      const permissions = new Set(identity.tokenPermissions ?? [])
      for (const permission of [
        "browser:write",
        "d1:write",
        "workers:write",
        "workers_scripts:write",
      ]) {
        requireValue(
          permissions.has(permission),
          `Wrangler OAuth token is missing ${permission}`
        )
      }
    } catch {
      errors.push("Wrangler identity response was not valid JSON")
    }
  }

  const d1 = runWrangler(studioDirectory, "d1", "list", "--json")
  requireValue(d1.success, "Could not list D1 databases")
  let remoteDatabase: { name?: string; uuid?: string } | undefined
  if (d1.success) {
    try {
      const databases = JSON.parse(d1.output) as Array<{
        name?: string
        uuid?: string
      }>
      remoteDatabase = databases.find(
        (candidate) => candidate.name === "webmcp-studio"
      )
    } catch {
      errors.push("D1 inventory was not valid JSON")
    }
  }
  requireValue(
    remoteDatabase,
    "Remote D1 database webmcp-studio does not exist"
  )
  if (remoteDatabase) {
    requireValue(
      remoteDatabase.uuid === database?.database_id,
      "Configured DB database_id does not match remote webmcp-studio UUID"
    )
  }

  const r2 = runWrangler(studioDirectory, "r2", "bucket", "list")
  requireValue(r2.success, "Could not list R2 buckets")
  requireValue(
    /^name:\s+webmcp-studio-assets[ \t]*$/m.test(r2.output),
    "Remote R2 bucket webmcp-studio-assets does not exist"
  )
  requireValue(
    /^name:\s+webmcp-studio-renders[ \t]*$/m.test(r2.output),
    "Remote R2 bucket webmcp-studio-renders does not exist"
  )
}

if (mode === "post-deploy") {
  for (const [directory, workerName] of [
    [rendererDirectory, "webmcp-studio-renderer"],
    [studioDirectory, "webmcp-studio"],
  ] as const) {
    const deployments = runWrangler(directory, "deployments", "list")
    requireValue(deployments.success, `Worker ${workerName} is not deployed`)
  }

  const workflows = runWrangler(studioDirectory, "workflows", "list")
  requireValue(workflows.success, "Could not list deployed Workflows")
  requireValue(
    /(?:^|[\s│|])webmcp-studio-render-jobs(?:[\s│|]|$)/m.test(workflows.output),
    "Workflow webmcp-studio-render-jobs is not deployed"
  )
}

if (errors.length > 0) {
  console.error(`Cloudflare deployment preflight failed (${mode}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `Cloudflare deployment preflight passed (${mode}); ${migrations.length} contiguous migrations found.`
)
