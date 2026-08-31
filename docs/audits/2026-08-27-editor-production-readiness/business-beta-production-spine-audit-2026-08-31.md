# Business-beta production spine audit

Date: 2026-08-31

Baseline: `e719a3e` on `codex/business-beta`

Scope: durable drafts and recovery, multi-tab conflicts, shared media,
durable rendering, public API boundaries, deployed D1 migrations, and the
retained 100-page and 1,000-layer evidence.

## Verdict

The local production spine is substantially implemented. The remaining work is
mostly environment proof, not another rewrite of persistence, rendering, or
the API. The exception is the deployment migration lineage: the current
preflight proves that filenames are contiguous and that the remote ledger is a
prefix, but it does not prove that checked-in SQL for an existing migration has
remained unchanged.

The short status ledgers are also behind the tree. They describe migrations
`0012` and `0013` as the pending production suffix. This baseline contains
contiguous migrations through `0016`. The last retained read-only production
evidence only proves a remote prefix through `0011`; current remote state must
be inspected again before anyone states the exact pending suffix.

No remote Cloudflare state was read or changed in this audit.

## Implemented code versus open proof

| Boundary                                          | Implemented in this baseline                                                                                                                                                                                                                                                                                                                                                                                                                                 | Real gap                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable autosave and recovery                     | `DocumentDraftRepository` atomically stores metadata and bodies in IndexedDB, validates and quarantines corrupt records, keeps tombstones, and retains conflict candidates. `DocumentDraftSaveController` coalesces captures, orders compare-and-swap writes, retains failed captures, exposes retry, and supports an exact durable receipt. The editor marks an edit unsaved synchronously, warns before unload, and starts a best-effort `pagehide` drain. | Browser shutdown cannot guarantee completion of an asynchronous IndexedDB transaction. The current contract is honest because it warns while unsaved and saves during ordinary operation. A real close-during-write browser fault run remains useful evidence, but it is not a reason to replace the repository. |
| Multi-tab and conflict behavior                   | Repository writes use monotonic `recordVersion` and a base draft snapshot. BroadcastChannel is an invalidation signal. Stale writes and deleted heads preserve the candidate before returning conflict. Reload-saved, save-copy, deletion acceptance, and corrupt-record recovery have focused mounted and repository tests.                                                                                                                                 | Retain a real two-context CAS run on the final deployed build. Current local behavior is implemented, not a missing code path.                                                                                                                                                                                   |
| Shared asset availability                         | Browser-local bytes remain local by design. Promotion journals, owner coordination, managed-media upload/reconciliation, D1 promotion mappings, managed-use receipts, and recovery records exist. Migrations `0012`, `0013`, `0015`, and `0016` support promoted assets, use idempotency, catalog metadata, and source identity. Local cross-context PNG/PDF and recovery artifacts are retained.                                                            | Apply the migration suffix and matching Worker before exercising cross-profile availability. Then retain owner traversal, network-fault, restart, second-identity isolation, expiry, and cleanup evidence. Do not claim that an `asset:local/*` reference is shared before promotion succeeds.                   |
| Durable render jobs                               | D1 is the visible job authority. `RenderJobWorkflow` owns retryable steps, attempt fences, cancellation checkpoints, deterministic artifacts, settlement, and cleanup. A reconciler repairs dispatch gaps. Routes expose enqueue, poll, retry, cancel, history, and expiry. Migration `0008` and focused execution tests exist. This matches Cloudflare's requirement that durable side effects live in idempotent Workflow steps.                           | Retain a deployed Worker/Workflow restart run, trace correlation, and seven-day artifact-expiry evidence. Queues are not used in this architecture; Workflows are the chosen durable executor, so adding a Queue would duplicate ownership.                                                                      |
| API authentication, ownership, quotas, and errors | Cloudflare Access or the explicit local demo mode resolves one principal. Workspace-scoped repositories, general API admission, render/upload-specific admission, request IDs, the canonical error envelope, bounded issue paths, `Retry-After`, and asynchronous audit writes exist. Migrations `0009` through `0011` add the bounded request audit.                                                                                                        | Retain deployed Access rejection, cross-workspace denial, malformed and hostile resources, rate/concurrency exhaustion, request-to-audit correlation, and retention evidence.                                                                                                                                    |
| Deployed D1 migrations                            | Deployment tooling validates configured resource identities, contiguous migration ordinals, a remote ledger prefix, a stable plan/apply suffix, package builds, and a zero-pending post-deploy state. Individual local migration harnesses cover the important upgrades.                                                                                                                                                                                     | Historical SQL content is not pinned. Filename-only prefix validation cannot detect a changed applied migration. The last retained remote baseline predates migrations `0012` through `0016`; the current pending suffix is unknown until a new read-only inspection runs.                                       |
| 100 pages and 1,000 layers                        | The selected 100-page artifact records 800 nodes, 24.2 ms p95 scroll, a 361 ms page switch, and three thumbnail starts at concurrency three. The selected 1,000-layer artifact records 33 mounted rows, 258 ms inspector editing, 17.5 ms p95 pan, and 17.4 ms p95 gesture zoom. Independent review accepted the correctness repairs around camera projection, history admission, image decode, and crop visibility.                                         | Healthy-host Browser Rendering still needs first and steady raster latency, portrait/landscape/square parity, cache-hit proof, server-side cancellation, memory, and completed Object URL release. No local active-page scale implementation is open.                                                            |

## Dependency-ordered gates

Each gate is small enough to commit and review independently.

1. `BB-00 migration lineage`. Pin every migration filename and SHA-256 digest in
   a checked-in manifest. Static deployment preflight must reject a missing,
   extra, reordered, or changed migration. This is the only gate implemented in
   this pass.
2. `BB-01 authorized schema and Worker promotion`. With explicit production
   authorization, run a read-only ledger inspection, require the remote ledger
   to be an exact manifest prefix, apply only that suffix, deploy the matching
   clean Studio and Renderer builds, and require zero pending migrations.
3. `BB-02 identity and API adversarial evidence`. On the deployed build, retain
   Access rejection, owner success, cross-workspace denial, request/audit
   correlation, malformed bodies, hostile resources, and exhausted quotas.
4. `BB-03 durable render restart`. Dispatch one immutable render, interrupt the
   client and Worker lifecycle, prove Workflow recovery without duplicate
   outputs, cancel a running multi-output attempt, and inspect retry/settlement
   history.
5. `BB-04 shared-media availability`. Promote one browser-local asset, reuse it
   from a second browser context, inject a lost response and reconcile by
   idempotency key, verify durable render materialization, and prove a different
   principal cannot read it.
6. `BB-05 healthy renderer performance`. Retain completed thumbnail first and
   steady latency, visual parity, cache hits, cancellation at the renderer,
   memory, and Object URL cleanup. Keep the accepted 100-page and 1,000-layer
   artifacts unchanged unless a full rerun passes every promotion budget.
7. `BB-06 retention clocks`. After time has elapsed, prove render artifact
   expiry, request-audit retention, promotion/use-receipt retention, and safe
   cleanup without breaking referenced shared assets.

## Gate exclusions

- Do not deploy, apply remote migrations, create resources, or enable paid
  capacity without explicit production authorization.
- Do not touch the active general-mask or editor-sophistication files in this
  track.
- Do not use port 3000. Any later Studio browser proof uses port 3001.
- Do not add a Queue beside the render Workflow unless a new workload has
  different ownership and delivery semantics.

## Current reference decisions

- Cloudflare D1 records applied migration filenames and applies unapplied SQL in
  order. The project adds content hashes because the filename ledger alone
  cannot prove local historical SQL is immutable.
- Cloudflare Workflows may retry a step. Render side effects therefore stay in
  idempotent, fenced steps with D1 as the product-visible authority.
- Worker request audits remain non-blocking through `waitUntil`; API responses
  do not wait for the audit insert.

References:

- <https://developers.cloudflare.com/d1/reference/migrations/>
- <https://developers.cloudflare.com/d1/wrangler-commands/>
- <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>

## BB-00 implementation checkpoint — 31 August 2026

BB-00 now pins the checked-in D1 lineage in `migrations/manifest.json`. Each
entry records the exact ordered filename and SHA-256 digest. The shared
validator rejects missing, extra, reordered, renumbered, or changed migration
files before Cloudflare inspection or deployment can proceed. Static preflight
loads the same validator, and the production deployment runner snapshots the
lineage digest during planning and rechecks it immediately before applying a
remote suffix.

The lineage is intentionally append-safe. Tests derive the checked-in count and
names from the migration directory and separately prove that adding the next
contiguous migration succeeds when its manifest entry is added. They do not
hardcode the current length or final filename.

This branch predates `0017_media_derivation_jobs.sql`, which is already present
on main. Main integration must append that exact filename and its SHA-256 digest
to `migrations/manifest.json`. The validator must reject integration until that
entry exists; no existing digest should be regenerated or changed. The
append-safe tests require no update merely because `0017` becomes the new head.

Main integration appended `0017_media_derivation_jobs.sql` with digest
`3e2a05b9c3150499c29bdfb44916b1a4c11046890bd6541eaf9d6f3430bd01f7`.
The historical `0001` through `0016` entries remain unchanged, and main's
media-derivation verification scripts remain alongside the lineage check.

No remote Cloudflare command, migration, deployment, resource mutation, port,
or paid-capacity action was used for this checkpoint. BB-01 through BB-06 remain
separately authorized evidence gates.
