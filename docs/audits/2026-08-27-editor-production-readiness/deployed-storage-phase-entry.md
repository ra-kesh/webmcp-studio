# Deployed storage phase entry

Date: 2026-08-30

Status: production deployment completed; authenticated/deployed acceptance remains active

## Outcome

Turn the accepted local D1, R2, Workflow, Durable Object, renderer, and identity
contracts into one reproducible Cloudflare deployment without silently binding
Studio to another product's resources or accepting a partially functional
production Worker.

## Evidence reread

- `remaining-product-work-2026-08-29.md`: apply and inspect every D1 migration,
  exercise real asset and render objects, prove workspace isolation, and retain
  deployed render-capacity evidence.
- The media, publication, render-job, API-security, and conformance phase
  records: D1 is metadata authority; `ASSETS` and `RENDERS` are separate R2
  owners; the Renderer owns Browser Rendering; the Studio Worker owns Access,
  Workflows, Durable Object admission, and the service binding.
- `apps/studio/wrangler.jsonc`, `apps/renderer/wrangler.jsonc`, all eleven D1
  migrations, both repository implementations, and the render Workflow were
  reread before changing deployment mechanics.
- Current Cloudflare guidance: D1 bindings require the created database UUID;
  production migrations should target the binding with
  `wrangler d1 migrations apply DB --remote`; remote bindings are explicit and
  must not be confused with local persisted Miniflare state.

## Initial read-only account inventory

Wrangler is authenticated to the account associated with
`iamrakeshkumar@pm.me`. No WebMCP Studio production resource currently exists:

- no `webmcp-studio` D1 database;
- no `webmcp-studio-assets` or `webmcp-studio-renders` R2 bucket;
- no `webmcp-studio` or `webmcp-studio-renderer` Worker;
- no deployed Workflow;
- the Studio D1 binding has no `database_id`;
- `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are empty;
- the current OAuth token lacks Browser Rendering write scope.

Existing ShootBridge/Stuwiz and unrelated R2/D1 resources are out of scope and
must never be reused for this product.

Both production Wrangler files now pin the inspected account ID. The preflight
also compares that ID with the authenticated Wrangler account and, after D1 is
created, requires the configured database UUID to equal the UUID returned for
`webmcp-studio`; matching a resource name alone is not sufficient.

The remote-ready preflight reads Wrangler's structured identity response and
requires Browser, D1, Worker, and Worker-script write scopes before any
migration can run. It matches the two exact R2 bucket names, requires the
Renderer's `workers_dev` and version-preview routes to be explicitly disabled,
and validates the Access issuer and 64-hex application audience shape.

## Current package evidence

- Studio dry-run packages successfully with D1, both R2 buckets, Workflow,
  Durable Object, Renderer service binding, and Access configuration visible in
  the manifest.
- Renderer dry-run packages successfully with its R2 and Browser Rendering
  bindings.
- A successful dry-run does not prove resources exist: Wrangler accepts the
  declared names while the account inventory remains empty. Deployment must
  therefore fail closed before upload when identity, IDs, or resources are
  missing.
- The ordered plan runs both the Vite application build and an explicit Studio
  Wrangler dry-run before its plan/apply branch. Remote migrations and the
  Renderer deployment therefore cannot precede discovery of a broken Studio
  Worker entry point, export, or binding package.

## Gate sequence

1. Add a deterministic preflight that validates config, authentication scope,
   named remote resources, Access values, and migration continuity without
   mutating the account.
2. Add one ordered deployment entry point: preflight, a read-only remote schema
   probe, local package dry-runs, explicit migration apply, Renderer deploy,
   Studio deploy, and post-deploy inspection. It must never provision or migrate
   merely because a plan or build runs. Wrangler's migration-list command is
   forbidden in plan mode because it initializes the remote migration table.
   The read-only probe accepts only an empty first-install database or a remote
   migration ledger that is an exact prefix of the ordered local filenames; it
   prints and locks the pending suffix before apply.
3. With explicit authorization, create only the named WebMCP Studio resources,
   record the generated D1 UUID in config, refresh the OAuth scope, and supply
   the exact Access team domain/audience.
4. Apply all migrations remotely and inspect schema, foreign keys, migration
   ledger, indexes, and 30-day API-audit retention.
5. Exercise two isolated principals through real multipart upload, asset read,
   archive/reference protection, render Workflow, artifact retrieval,
   cancellation/retry, capacity rejection, and request/audit correlation.
6. Obtain independent P0/P1 code review, update the continuation ledger and
   remediation log, commit, and continue.

## Non-negotiable safety

- Inventory and dry-runs are read-only. Creating D1/R2/Workers/Workflows,
  applying remote migrations, or enabling paid capacity requires an explicit
  deployment decision.
- Deployment commands target binding `DB`, never a copied UUID from another
  project.
- Production Access may not fall back to the local-demo principal. Empty Access
  configuration is a preflight failure.
- No test may list, overwrite, or delete objects outside the two exact WebMCP
  Studio bucket names.
- Port 3000 remains owned by Stuwiz. Local Studio evidence stays on port 3001.

## Preparation completion evidence

- Static and remote-ready preflights fail closed on the exact unprovisioned
  boundaries: D1 UUID, Access issuer/audience, Browser write scope, D1, and the
  two R2 buckets. Existing unrelated account resources do not satisfy any name
  or identity check.
- The authenticated account, configured account, remote D1 name/UUID, exact R2
  names, OAuth scopes, private Renderer routes, Access value shapes, bindings,
  and contiguous local migration sequence are checked before mutation.
- Plan mode uses only account/resource inventory, read-only D1 `SELECT` queries,
  and Wrangler dry-run packages. It accepts only an empty first-install database
  or a `d1_migrations` ledger that is an exact local filename prefix.
- Apply mode requires the explicit production confirmation value, rechecks that
  the pending migration suffix did not change during both Worker package builds,
  applies through binding `DB`, deploys Renderer before Studio, then re-inspects
  resources and requires zero pending migrations.
- Renderer and Studio Wrangler packages pass. The Studio manifest retains its
  D1, R2, Workflow, Durable Object, Renderer service, and Access bindings.
- Independent review rejected plan-mode migration-table mutation, incomplete
  ledger validation, partial-rollout permissions, renderer exposure, malformed
  Access values, loose resource matching, and missing Studio Worker packaging.
  After each repair, final rereview returned **ACCEPT with no remaining P0/P1**.

## Provisioning checkpoint

After explicit authorization, Wrangler OAuth was refreshed with the exact
account/user, Worker, Worker-script, D1 and Browser write scopes. The following
isolated APAC resources now exist in the pinned account:

- D1 `webmcp-studio`; its generated UUID is recorded in the production `DB`
  binding;
- R2 `webmcp-studio-assets`;
- R2 `webmcp-studio-renders`.

The remote-ready preflight now passes account, permission, D1 identity, both
exact R2 checks, and the Cloudflare Access issuer/audience checks.

## Production deployment checkpoint

- Activated Cloudflare Zero Trust Free and created one self-hosted **WebMCP
  Studio** application for `webmcp-studio.iamrakeshkumar.workers.dev`.
- Access has one owner-only Allow policy for `iamrakeshkumar@pm.me`. A duplicate
  draft policy created by the dashboard's delayed state was detected, removed,
  and the final application was re-inspected with one policy.
- Recorded the public team issuer and 64-hex application audience in Studio's
  production bindings and regenerated Worker types.
- Static, remote-ready and plan preflights passed. The plan packaged both
  Workers and reported an empty first-install D1 with exactly eleven pending
  migrations without mutating it.
- The accepted apply sequence installed all eleven migrations, deployed the
  private Renderer first, deployed Studio with its Workflow, Durable Object,
  D1, R2 and Renderer service bindings, and passed post-deploy verification.
- Remote `d1_migrations` exactly matches the ordered local migration list. A
  read-only schema inventory found the expected workspace, document,
  publication, asset, render-job and API-audit tables and indexes in APAC.
- An unauthenticated request to the production hostname receives a Cloudflare
  Access `302` login redirect. No token, cookie or redirect payload is retained
  in repository evidence.

Still open for this larger gate: owner-authenticated product traversal,
two-principal isolation, real multipart/R2 and Workflow/artifact exercises,
capacity/audit/hostile-input evidence, a deployed restart, parity capture and
expiry proof. Those are acceptance evidence, not missing deployment mechanics.

## Current production deployment checkpoint

Date: 2026-09-01

- The guarded plan re-inspected the configured account, D1 database, two exact
  R2 buckets, Access issuer/audience, private Renderer, service binding,
  Workflows and Durable Object before mutation.
- The remote migration ledger was an exact prefix through `0011`. The apply
  sequence installed `0012` through `0019`; the final read-only query records
  19 applied migrations ending at
  `0019_media_derivation_mutation_receipts.sql`.
- Wrangler's remote migration path initially rejected the unapplied trigger
  migrations `0014` and `0016` with `incomplete input`. Their `SELECT CASE`
  trigger expressions were parenthesized using the D1-compatible syntax. Both
  complete SQLite migration harnesses and the checked-in lineage verifier pass.
- Renderer version `bfaccb02-1d9b-4ca7-a2bb-a6af17c7fb02` deployed before
  Studio version `91d00025-9eb5-47d6-9d68-175d4bd55572`.
- The post-deploy verifier passed with zero pending migrations. A read-only
  schema query found the expected library preference/collection and media
  derivation tables in the APAC primary database.
- `https://webmcp-studio.iamrakeshkumar.workers.dev` returns the expected
  unauthenticated Cloudflare Access `302` login redirect. The private Renderer
  has no public workers.dev or preview target.

The production schema and matching Workers are current. The larger evidence
program listed above remains useful hardening, but it no longer blocks the
deployment claim.
