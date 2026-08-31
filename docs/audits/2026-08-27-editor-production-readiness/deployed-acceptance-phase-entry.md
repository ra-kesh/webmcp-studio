# Deployed acceptance phase entry

Date: 2026-08-30

Status: plan complete; production acceptance has not been executed

## Outcome

Close the evidence gap left after commit `833547b` without confusing a sound
deployment with a proven product. The production Workers, D1 database, R2
buckets, Workflow, Durable Object, and Access application exist and pass the
deployment checks. The remaining work is an authenticated black-box run, a
small set of read-only account inspections, one controlled restart exercise,
one second-principal run, and delayed retention checks.

This phase entry does not authorize any production request, test-data write,
Access policy change, Worker deployment, Workflow control operation, D1 write,
or R2 write. No Cloudflare state was changed while preparing it.

## Evidence reread and current truth

The following records and implementations were reread from the deployed
`833547b` tree:

- `deployed-storage-phase-entry.md` and rows 3 through 8 of
  `remaining-product-work-2026-08-29.md`;
- FAIL-01A through FAIL-01H, the FAIL-01I/JOB-01A completion record,
  `api-sec-error-01-phase-entry.md`, and their matching remediation entries;
- `render-conformance.md`, its independent review, both PERF-01 reviews, the
  renderer-thumbnail contract, and the crop-preview performance record;
- `docs/api.md`, all public `/v1` route handlers, the Access principal,
  request finalizer, admission Durable Object, render Workflow, reconciler,
  media repository, and migrations `0008` through `0011`;
- `deploy-cloudflare-production.ts`, the deployment preflight, both production
  Wrangler files, the conformance and live-editor capture scripts, the pixel
  and geometry comparators, both migration verification scripts, and the two
  PERF-01 browser specifications.

The accepted starting point is narrow:

- production has the exact isolated D1 and R2 resources, all eleven migrations,
  a private Renderer, Studio's Workflow and Durable Object, 100 percent Worker
  log sampling, and one owner-only Access policy;
- unauthenticated traffic redirects to Access;
- local conformance, render scheduling, cancellation, durable execution,
  resource admission, error normalization, and migration proofs are complete;
- no owner-authenticated production journey, real production object lifecycle,
  second-principal isolation, deployed restart, healthy-host raster profile,
  or wall-clock expiry result has been retained.

The last point is the release truth. Resource inventory and a green deploy are
not substitutes for it.

| Evidence group                                                                                                        | Can run with the owner now                                         | Additional dependency                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| owner traversal, multipart/R2, Workflow/artifact, hostile input, capacity/audit, parity, and healthy-host performance | yes, after explicit permission for ordinary production test writes | temporary owner Access browser context                                                           |
| active-Workflow restart                                                                                               | no                                                                 | explicit authorization for a same-commit Studio redeployment                                     |
| workspace isolation                                                                                                   | no                                                                 | a second human Access subject and temporary narrow policy change                                 |
| artifact expiry                                                                                                       | no                                                                 | completed immediate-run artifact plus seven days, one reconciler interval, and clock-skew margin |
| audit retention                                                                                                       | no                                                                 | named immediate-run audit row plus more than 30 days and one new request                         |

## Important harness findings

The existing capture commands must not be pointed at production as they stand.

- `capture-render-conformance.ts` accepts `CONFORMANCE_BASE_URL`, but opens a
  fresh headless context with no Access state. Its renderer requests use Node
  `fetch`, which does not share browser cookies. It also replaces the selected
  local conformance report.
- `capture-live-editor-matrix.ts` has the same fresh-context Access problem and
  replaces the selected local live-editor report.
- the PERF-01 Playwright configuration always owns a local web server, while
  its specifications replace the selected local performance artifacts.

Production evidence therefore needs a separate runner and separate output
root. The runner may reuse the fixture, projection, comparison, and browser
probe functions, but it must never overwrite local evidence.

There are also two documentation and audit risks to keep visible:

- `docs/api.md` still describes a synchronous challenge render, only four job
  states, and an older error example. The deployed implementation is durable
  and also exposes `retrying`, `cancelling`, and `cancelled`; the accepted
  API-SEC error contract includes `requestId`, `retryable`, and optional
  `issues`. The harness must derive assertions from the accepted phase records
  and route schemas until the API document is reconciled.
- `GET /v1/studio/session/token` resolves the production principal and then
  returns `409 access_token_export_disabled` without `session.respond`. Its
  audit row may therefore lack the already-resolved principal and workspace.
  The acceptance runner must check this explicitly. A missing identity is a
  product defect, not evidence-run noise.

## Safety and evidence rules

Use one unique run ID such as `prod-2026-08-30-<uuid>` in every template name,
asset name, idempotency key, request ID, and evidence file. Before the first
write, retain the git commit, clean-worktree check, Studio and Renderer
deployment IDs, Workflow name, D1 name and UUID match, R2 bucket names, Access
application audience hash, migration ledger, and UTC start time.

The future runner should stage into
`artifacts/deployed-acceptance/runs/.capture-<uuid>/` and rename the directory
only after every immediate assertion passes. Its manifest should bind every
artifact by relative path, byte length, SHA-256, production origin, request ID,
`CF-Ray` when present, Worker deployment IDs, browser runtime, and test-data
identities. Delayed checks append signed-off evidence to the same immutable run
identity rather than replacing the immediate manifest.

Never retain any of these values:

- Access JWTs, cookies, `Set-Cookie`, assertion headers, authorization values,
  service-token credentials, or Access redirect payloads;
- raw R2 keys, document bodies from Workflow step output, uploaded private
  bytes, or untrusted error text from logs;
- email addresses or other identity-provider claims.

The runner may compare a raw R2 key in memory, but the report should keep only
its SHA-256 and a boolean that its exact expected workspace or render prefix
matched. D1 query output should retain only the columns needed for the
assertion. Workflow description output must omit step output and be sanitized
before promotion.

All writes must pass through public product routes except the separately
authorized same-commit restart. D1 and R2 inspection is read-only. Do not edit
timestamps, insert synthetic production audit rows, delete product objects
directly, lower limits, expose the private Renderer, or reuse another product's
resources to make a case pass.

## Authentication handoff

Use a temporary Playwright user-data directory outside the repository. Start
one headful browser, let the owner complete Access login, then keep all browser
and API work inside that `BrowserContext`. `context.request` shares its cookie
jar, so it can drive exact HTTP cases without copying cookies into shell
arguments or evidence. Remove the temporary profile after the immediate run.

Do not commit Playwright `storageState`. Do not use the current Node-fetch
conformance path for authenticated API requests. Do not create a service token
as a shortcut for the owner or second-human tests. Cloudflare supports service
tokens for automated Access clients, but adding one requires a Service Auth
policy and it would prove a service credential, not isolation between two human
Access subjects.

The harness should first make a manual-redirect request in a clean unauthenticated
context and retain only the `302` status, protected hostname, and safe response
headers. It should then prove the owner context reaches `/`,
`/render-conformance`, and `GET /v1/studio/templates` without another login
challenge.

## What can be automated in the immediate run

The cases in this section need one authenticated owner and ordinary production
test data. They do not need a second identity or elapsed days. They still need
explicit authorization before execution because they mutate product data,
admission counters, audit rows, Workflow state, and R2.

### Owner-authenticated product traversal

Run one mounted browser journey rather than a collection of isolated HTTP
smokes:

1. Pass Access, load the Studio start page, open a sample, and wait for the
   Fabric canvas, panels, filmstrip, managed font, and images to settle.
2. Make one named text edit, one page or output change, and one managed-image
   insertion. Confirm Undo/Redo and the publication status remain truthful.
3. Publish the exact current snapshot. Reload the route and verify the
   immutable template and revision lookup resolve inside the same workspace.
4. Start a durable render in the API Playground, close the page after dispatch,
   reopen Studio, restore the job from History, and download its artifact.
5. Retain a production-only six-width layout capture under the deployed run.
   Do not replace `live-editor-capture-report.json`.

For every `/v1` call intercepted during the journey, retain status,
`X-Request-Id`, stable error code when present, and latency. A final read-only
D1 query must find the exact request IDs with normalized routes and the owner's
hashed principal/workspace identity.

### Multipart upload and asset R2 ownership

Use two small deterministic PNG fixtures and request IDs tied to the run.

1. Upload fixture A with multipart form data, `Content-Length`, and a fresh
   idempotency key. Require `ready`, exact bytes and dimensions, no public R2
   key, and one attributed audit row.
2. Read metadata and content. Compare bytes and SHA-256, retain the strong
   `ETag`, then require `If-None-Match` to return `304` without another object
   body.
3. Replay the same key and normalized upload and require the original asset.
   Reuse the key with different bytes or metadata and require `409`.
4. Mark the asset used and require it to lead the Recent collection.
5. For an unreferenced fixture, obtain deletion impact, archive with both exact
   preconditions, require removal from list/search, and prove archived content
   remains readable.
6. Upload fixture B, publish a document that references its managed ID, and
   require deletion impact to name current and published references. Archive
   must return `409` and the bytes must remain readable.
7. Query the exact two D1 asset rows and their upload/reference rows. Read the
   two exact R2 objects by the D1 keys, compare hashes in memory, and report only
   key hashes and prefix-match booleans.

This proves multipart parsing, D1 metadata authority, private R2 storage,
idempotency, conditional reads, archive semantics, and reference protection in
one bounded lifecycle.

### Workflow and artifact lifecycle

Publish a run-specific version of the conformance fixture, then use the durable
API, not the foreground export route.

1. `POST /v1/studio/render` with an exact `Idempotency-Key`. Require `202`, a
   stable render ID, and the same job on exact replay. Reuse the key with a
   changed body and require `409`.
2. Poll `GET /v1/renders/:renderId` through observable nonterminal states to a
   terminal result. Record every distinct state and request ID without imposing
   an invalid requirement that every fast job expose every intermediate state.
3. Require the requested page/output order, dimensions, byte counts, checksums,
   seven-day `expiresAt`, and download URLs. Download each artifact and compare
   magic bytes, byte count, and SHA-256 with the API metadata.
4. Read the exact D1 job, attempt, and output rows. Require one Workflow
   instance identity, exact attempt fencing, succeeded settlement, and R2 keys
   under `<render-id>/attempt-<n>/`.
5. Run `wrangler workflows instances describe webmcp-studio-render-jobs
<render-id>` read-only with step output disabled. Retain step states, retries,
   timestamps, and errors only after sanitization.
6. Read the exact R2 artifacts by their D1 keys and compare hashes with both D1
   and public downloads.
7. Run a separate cancellation job. Cancel while queued or rendering, poll to
   `cancelled`, require no public artifact, and require no object under that
   exact attempt prefix after Workflow compensation settles if an attempt was
   claimed.

Keep the completed job for the delayed expiry check. Keep the cancelled job as
cleanup evidence.

### Capacity, public errors, hostile inputs, and audit correlation

Run rejection cases before any high-volume rate test so an exhausted API window
does not blur their result. Every case supplies a conservative request ID and
forged `X-Studio-Audit-Principal` and `X-Studio-Audit-Workspace` headers. The
response must echo the request ID, expose the canonical envelope, and never
trust the forged identity.

The minimum hostile matrix is:

| Boundary       | Request                                                                                            | Required result                                    | Required non-invocation proof                  |
| -------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| JSON transport | wrong media type, malformed UTF-8/JSON, missing length, and streamed body over the route cap       | exact `400`, `411`, or `413` code and retryability | no template, job, asset, Browser, or R2 change |
| Strict schema  | unknown top-level and nested keys plus a bad field type                                            | canonical `issues` paths                           | no D1 product row or Workflow                  |
| Render policy  | unsupported font, unsafe color, remote image URL, oversized geometry, page count, or pixel area    | `422` with stable resource or policy identity      | no Browser call and no R2 artifact             |
| Multipart      | SVG/GIF, signature/MIME mismatch, malformed structure, over-byte, over-edge, and over-pixel inputs | stable deterministic 4xx                           | no asset row and no R2 object                  |
| Ownership      | random asset, template, revision, render, and output IDs                                           | scoped `404`                                       | no cross-workspace metadata in the response    |
| Idempotency    | same render or upload key with changed content                                                     | `409`                                              | original row and object unchanged              |

Use an authenticated page-side streaming `fetch` for the missing-length case,
because Playwright's request client adds a length to ordinary byte bodies. It
must share the same browser context and must not copy the Access cookie into a
command line.

Before and after counts from the exact WebMCP D1 tables and exact R2 prefixes
are the production non-invocation oracle. Worker invocation logs may support
the result, but the runner should not infer "no Browser call" from the absence
of a sampled log alone.

For deterministic general API capacity, issue 301 small authenticated GETs
after waiting for a fresh fixed one-minute window. Require 300 admitted
requests and then `429 studio_rate_limited` with a positive `Retry-After`.
Stop at the first proved rejection and wait for the next window before
continuing.

For render concurrency, start two bounded long-running foreground or thumbnail
requests and submit one more while both reservations are active. Require
`429 render_concurrency_exceeded` or the workload-specific concurrency code,
`retryable: true`, and the documented retry delay. Abort or await the two owners,
then prove a fresh request succeeds. Do not exhaust daily page, pixel, request,
or byte budgets merely to prove capacity.

Finish with a read-only D1 query for every named request ID. Assert method,
normalized route, status, nonnegative duration, stable error code,
retryability, real principal/workspace identity where resolution succeeded,
and no caller-forged identity. The token-export route check described above is
part of this gate.

### Deployed conformance parity

Build a production-only variant of the atomic conformance runner with these
changes:

- reuse the authenticated `BrowserContext` and its request client;
- write only under the deployed run staging directory;
- snapshot both Worker deployment IDs before capture;
- retain each safe `CF-Ray`, request ID, response header contract, and capture
  latency;
- preserve the same version-2 fixture, device scale factor 1, sequential page
  order, exact PNG sizes, raw PDF, 96-DPI PDF raster geometry, byte counts, and
  SHA-256 ownership checks;
- run the unchanged raw thresholds and text-only ink-geometry substitute from
  a manifest inside the deployed run.

The pass condition is the same as local: all 12 artifacts exist, raw results
remain visible, properties and square pages pass raw comparison, and the
text-only Fabric, React, and PDF candidates pass the complete-page geometry
gate without changing thresholds. The manifest must show the production Studio
and Renderer deployment identities. A Browser capacity error may trigger the
existing bounded sequential retry policy, but a partial run must never promote.

### Healthy-host renderer performance

Create a production-only Playwright configuration with no local web server and
no local evidence path. Reuse the 100-page and browser-probe logic, then extend
the gate beyond the selected local run, which had zero completed rasters.

The production profile must retain:

- cold first-raster and steady subsequent-raster latency;
- at least one completed portrait, landscape, and square thumbnail compared
  with the corresponding live React page;
- a true in-memory cache hit shown by revisiting an unchanged page with no new
  network request;
- the rapid-churn start and maximum-three concurrency limits, plus correlation
  of cancelled request IDs to server/audit termination. The runner can attach
  its run-scoped IDs with a Playwright route interceptor;
- created, retained, revoked, and final active Object-URL counts after route
  disposal;
- JS heap snapshots or comparable browser memory before completion, after
  churn, and after disposal;
- the existing 100-page frame, page-switch, DOM, long-task, and live-Artboard
  budgets.

One healthy run closes the remaining PERF-01 renderer evidence. A capacity-
limited or zero-completion run is diagnostic only and must not replace either
the accepted local interaction profile or a prior healthy deployed profile.

## What needs a controlled deployment mutation

The restart case cannot be proved by ordinary API traffic. It needs separate
authorization even after the owner run is approved.

Prepare a multi-page durable PNG job that lasts long enough to observe
`rendering`, retain the current Studio deployment ID, then redeploy the exact
same clean commit and unchanged configuration while the Workflow is active.
Do not use a code change, migration edit, Renderer exposure, or binding change
as a fault injector. Retain the new Studio deployment ID.

After replacement, require the same Workflow instance and attempt fence to
complete, the exact idempotency replay to return the original job, History to
restore it after a new browser context, and every artifact hash to match D1 and
R2. Also retain the Workflow description across the replacement. If the active
attempt fails retryably, exercise public `POST /v1/renders/:renderId` restart
and require the next fenced attempt to complete without stale objects.

If the job finishes before replacement, the run proves nothing about restart
and must be repeated. Do not manufacture failure by deleting a Worker, bucket,
or production object.

Run the existing read-only deployment plan before this exercise, prebuild the
unchanged Studio bundle so build time does not consume the active-job window,
deploy Studio from its checked-in Wrangler configuration, then run the existing
post-deploy preflight and migration-prefix inspection. The full production
apply script remains the normal release entry point; the coordinated Studio-only
redeployment is a bounded acceptance fault and needs its own approval record.

## What needs a second Access identity

The current Access application allows only the owner. A real two-principal test
therefore needs a second human Access subject and an explicitly approved,
temporary narrow Allow rule. Remove that rule after the run and re-inspect the
application so the final policy returns to owner-only.

Run the same deterministic fixture under principals A and B:

1. Give both users the same public template ID, upload bytes, idempotency keys,
   and run labels. Require separate asset IDs, template rows, jobs, storage
   counts, and audit identities.
2. Under B, request A's asset metadata/content, revision snapshot, render
   status, artifact download, and archive impact. Every request must return the
   scoped not-found contract without leaking existence, bytes, checksum,
   timestamps, or names. Repeat B-to-A.
3. List templates, assets, Recent, and render History for both principals and
   require only that workspace's records.
4. Query D1 by the exact public IDs and prove two distinct workspace hashes.
   Compare the two exact R2 objects in memory and require workspace-separated
   keys even when content hashes match. Retain only key hashes.
5. Run one independent capacity reservation per principal and prove one
   principal's active or exhausted budget does not reject the other.

Two sessions for the same Access subject are not two principals. A service
token is not a substitute for this gate. If a second identity is unavailable,
record the gate as blocked and leave the owner-only policy unchanged.

## What needs time passage

Do not edit production timestamps to accelerate these checks.

### Seven-day artifact expiry

Keep one completed immediate-run job and record its exact `expiresAt`. After
that timestamp plus the five-minute reconciler interval and a small clock-skew
margin:

1. require the artifact download to return `410 render_asset_expired`;
2. require render status and History to omit ready download artifacts while
   retaining the job and expiry metadata;
3. query D1 for `render_outputs.status = 'expired'` and a non-null deletion
   timestamp;
4. require the exact R2 object to be absent;
5. retain the expiry request ID and attributed audit row.

The Workflow instance is configured for 14-day retention, so describe it again
during this seven-day follow-up while it should still be inspectable.

### Thirty-day API audit retention

Keep one uniquely named audit request from the immediate run. After more than
30 days, issue one new authenticated `/v1` request to fire the insert trigger.
Then require the old exact request ID to be absent and the new request ID to be
present. This is the production wall-clock proof. The local migration harness
and deployed trigger inventory remain supporting evidence, not a replacement.

## Execution order and stop conditions

Run the work in this order:

1. build the separate production runner and redaction checks locally;
2. take the read-only deployment/schema baseline;
3. authenticate the owner and run traversal, multipart/R2, Workflow/artifact,
   hostile-input, capacity/audit, conformance, and healthy-host performance;
4. inspect and atomically promote the immediate run;
5. with separate authorization, run the same-commit restart exercise;
6. with a real second Access identity and policy approval, run isolation and
   restore owner-only Access;
7. complete the seven-day expiry and 30-day audit-retention follow-ups.

Stop without promotion on any authentication redirect inside the owner run,
secret in staged output, deployment-ID drift outside the restart window,
migration mismatch, unexpected resource name, partial conformance capture,
unattributed resolved-principal audit row, failed R2 checksum, cross-workspace
visibility, missing Workflow fence, unbounded retry, or daily-budget approach.
Delete only the unpromoted local staging directory. Do not "clean up" a failed
production run by deleting remote data outside the product's public archive or
cancellation paths.

## Gate closure

Rows 3 through 8 may move from environment-gated to deployed-accepted only when
the evidence manifest links all of these results:

- owner-authenticated mounted traversal;
- real multipart/D1/R2 lifecycle and reference protection;
- durable Workflow, attempt, artifact, cancellation, and trace correlation;
- canonical hostile-input, capacity, request-ID, and attributed-audit results;
- immutable deployed conformance and healthy-host renderer performance;
- same-commit active-Workflow restart;
- two-human-principal workspace isolation;
- seven-day artifact removal and 30-day audit retention.

Until then, commit `833547b` remains a verified production deployment with an
active deployed-acceptance gate. It is not yet complete production evidence.

## 2026-09-01 read-only Cloudflare recheck

The production plan was rerun from local `main` after the product-cleanliness
checkpoints. Wrangler authenticated to the configured account, found the
canonical D1 database and both R2 buckets, and confirmed that the Studio and
Renderer targets, RenderAdmission Durable Object, and Render Workflow are
present. Both Workers packaged successfully with `wrangler deploy --dry-run`;
the Studio package includes both Workflow bindings, D1, both R2 buckets, the
Renderer service, static assets, Access configuration, and the Durable Object.
The separate post-deploy inventory preflight also passes.

The remote D1 migration ledger is an exact local prefix but is eight migrations
behind current `main`: `0012` through `0019`. Those migrations cover local
promotion mapping, media use receipts, library preferences/collections,
catalog metadata, canonical media source identity, and media derivation jobs,
outputs, and mutation receipts. This is a safe deployment stop, not a packaging
failure: no migration, Worker, Workflow, object, Browser Rendering request, or
other remote write was performed. The current branch is therefore
deployment-plan-ready, while the deployed environment remains intentionally
behind the local media/library feature set until an explicit production apply
is authorized.

## Current Cloudflare references

- Access service tokens and their required Service Auth policy:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/>
- Workflow instance inspection with Wrangler:
  <https://developers.cloudflare.com/workflows/reference/wrangler-commands/>
- Worker invocation and custom log behavior:
  <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
