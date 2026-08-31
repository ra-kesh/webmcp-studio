# ASSET-02 background removal phase entry

Date: 2026-08-31
Status: Slices B0 through B4 implemented and locally verified; independent acceptance, provider configuration, and deployed evidence remain open
Scope: provider-neutral image derivation jobs and non-destructive application

## Decision

Background removal is an asynchronous media derivation. It creates a new
workspace-owned managed asset. It does not mutate the selected image, overwrite
the original bytes, create a frame mask, create a general mask group, or store a
provider URL in the document.

The durable job record is the authority for execution state. The provider is an
adapter behind that record. Studio may change providers without changing the
public job, asset, document, render, or review contracts.

The first production slice, B0, is deliberately smaller than a working provider
integration. It adds the D1 job, attempt, and output-provenance model plus a
provider-free repository and focused tests. It makes no external calls and adds
no user-facing control. Later slices may dispatch provider work only after they
can preserve the state and ownership rules recorded here.

## Boundaries that remain closed

General mask work is active under Gates M2 through M5. This phase does not edit:

- the document mask schema or mask validation
- mask product commands or history behavior
- the shared page paint plan
- Fabric mask compositing
- React render-view mask output
- renderer mask output

Background removal changes asset pixels. A mask changes how existing layers are
painted. Keeping those models separate prevents a remote service result from
becoming renderer-private state or an opaque masking shortcut.

The accepted image placement, crop, frame-mask, managed-source, and
renderer-acknowledged replacement contracts also remain unchanged.

## Reference conclusions

OpenPencil confirms that masks belong to ordered scene paint and bounded
compositing. Its asset work also supports content-derived identity, bounded
ingestion, one named history action, and materializing only the resource closure
needed by a render.

Polotno's examples provide useful interaction cues for reusable uploads and
replacement. They also show why Studio needs a stronger contract. Assigning a
URL directly to `src` or `maskSrc` does not establish workspace ownership,
immutable provenance, privacy, idempotency, or deterministic server rendering.

The audited Canva-style clone keeps the selected preview visible and exposes a
single progress action. Its implementation reads a private Fabric image URL,
sends that URL to a provider, and inserts the returned URL as another image.
Studio will keep the clear progress and retry behavior, but not that data or
identity boundary.

Canva-style product expectations worth preserving are simple entry from the
selected image, visible processing state, a before-and-after decision, one
application action, Undo, and a reusable result in the media library.

## Canonical resources

### Job

A media derivation job is workspace scoped and provider neutral:

```ts
type MediaDerivationJob = {
  id: string
  workspaceId: string
  sourceAssetId: string
  sourceContentHash: string
  operation: "remove_background"
  parameters: Record<string, never>
  parametersHash: string
  providerKey: string
  providerModelVersion: string
  privacyPolicyVersion: string
  state:
    "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled"
  outputAssetId: string | null
  attemptCount: number
  maxAttempts: number
  retryable: boolean
  safeFailureCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  cancellationRequestedAt: string | null
  updatedAt: string
}
```

`providerKey` identifies an internal configured adapter. It is not a caller
choice in the public API. `providerModelVersion` is frozen when the job is
created. A provider or model change produces a different request fingerprint.

The initial `remove_background` operation has no user parameters. The database
still records canonical `{}` and its hash so a later parameterized operation
cannot weaken request identity.

### Attempt

An attempt records one provider dispatch. Attempts never overwrite one another.
Each stores its number, opaque execution ID, state, start and finish times, safe
failure code, retryability, and provider request identity if one exists.

Provider payloads, signed URLs, images, EXIF, stack traces, and raw failure
bodies are not attempt data.

### Output provenance

A succeeded job points to a new managed media asset. A separate immutable
provenance row links:

- output asset
- source asset and frozen source content hash
- derivation job
- operation
- provider key and model version
- privacy policy version
- normalized output content hash, media type, dimensions, and creation time

One output asset can have only one derivation provenance record. Source and
output asset IDs must differ. Both must belong to the job's workspace.

The existing catalog metadata may describe the result to a user, but it does
not replace the derivation provenance record.

## Idempotency and admission

Creating a job requires:

1. an authenticated workspace principal
2. a ready managed source owned by that workspace
3. verified source bytes whose hash, type, and dimensions match D1 metadata
4. an admitted operation and provider configuration
5. recorded consent for the exact privacy policy version
6. a bounded idempotency key

The request fingerprint covers workspace, source asset ID, source content hash,
operation, canonical parameters, provider key, provider model version, and
privacy policy version.

Replaying one idempotency key with the same fingerprint returns the existing
job. Replaying it with different input returns a stable conflict. Submitting the
same fingerprint under another idempotency key returns the compatible existing
job rather than starting another paid attempt.

The server, not the client, chooses provider configuration, captures source
identity, calculates the fingerprint, and creates opaque job and attempt IDs.

## State transitions

Allowed job transitions are:

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelling -> cancelled
queued -> cancelled
failed retryable -> queued
```

Every transition uses the expected current state. A stale worker, duplicate
delivery, or late provider callback cannot settle a newer attempt.

Attempt count increments when execution claims a queued job, not when a user
presses Retry. Retry is allowed only for a failed job whose failure is marked
retryable and whose attempt count remains below `maxAttempts`. Retry reuses the
same job, source snapshot, provider/model, privacy version, and request
fingerprint.

Cancellation is cooperative while a provider call is active. Cancelling a
queued job settles it immediately. Cancelling a running job records intent and
moves it to `cancelling`. The executor then asks the adapter to cancel if that
adapter supports cancellation. The job still becomes `cancelled` if the
provider cannot stop billing or computation.

A late success after cancellation must not become the job output. Any bytes
already received stay outside the selectable asset catalog until cleanup or an
explicit reconciliation proves that the same attempt still owns settlement.

## Provider adapter

The provider adapter receives verified bytes through a private server boundary:

```ts
interface MediaDerivationProvider {
  readonly key: string
  readonly modelVersion: string
  start(input: VerifiedDerivationInput): Promise<ProviderExecution>
  poll(execution: ProviderExecution): Promise<ProviderResult>
  cancel(execution: ProviderExecution): Promise<ProviderCancelResult>
}
```

No route accepts an arbitrary provider name, remote image URL, data URI,
provider request ID, or provider output URL. The adapter may use temporary
provider references internally, but they never become public identity or
canonical document data.

Long-running dispatch belongs in a Cloudflare Workflow or another durable
execution owner. A request handler creates or reads the D1 job and returns. It
does not wait for remote image processing. Every promise is awaited or owned by
the durable execution system.

## Original preservation and non-destructive application

The source `media_assets` row and its R2 object remain immutable. Background
removal writes normalized output bytes under a new asset ID and immutable R2
key, validates those bytes, inserts the new managed asset, inserts provenance,
and only then settles the job as succeeded.

The selected image node does not change while a job is queued, running, failed,
or cancelled. Success produces a before-and-after choice. Applying it uses the
accepted typed `replace_image_source` command and the renderer-acknowledged
handoff. It preserves node ID, geometry, placement, frame mask, opacity,
visibility, lock state, stack position, and authored accessibility intent.

If the image source is field-bound, application is rejected with the existing
bound-property result and directs the user to update the field. The job output
remains a reusable media asset.

One successful Apply creates one history entry named `Remove background`.
Undo restores the original asset identity and presentation. It does not delete
the derived asset or provenance. Archive and physical deletion continue to use
the media repository's reference rules.

## Privacy and security

Before first dispatch, the product copy must identify the configured
subprocessor, material retention, processing region when material, expected
cost or credit, cancellation limits, and the privacy policy version being
accepted.

The server strips EXIF and GPS and normalizes orientation and color policy
before provider dispatch. Logs contain opaque workspace, asset, job, attempt,
and request IDs plus timings and safe codes. They contain no image bytes,
prompts, signed URLs, storage keys, EXIF, provider payloads, or raw provider
errors.

Quotas apply before dispatch and again when an attempt is claimed. Required
limits include per-source bytes and pixels, transparent output expansion,
active jobs per workspace, attempts per job, jobs per time window, and maximum
stored derivative bytes. Exact values require measured Worker, provider, and
renderer evidence and are not invented in this phase entry.

Provider calls use an allowlisted endpoint and server-held secret. Callers can
never supply a URL or credential. Stable public failures distinguish policy
rejection, unsupported input, quota, timeout, provider unavailable, invalid
provider output, storage failure, stale attempt, and cancellation.

## API and WebMCP control

The intended HTTP resources are:

| Method | Resource                                     | Behavior                                                        |
| ------ | -------------------------------------------- | --------------------------------------------------------------- |
| `POST` | `/v1/studio/assets/:assetId/derivations`     | Create or return an idempotent job for an admitted operation.   |
| `GET`  | `/v1/studio/media-derivations/:jobId`        | Read safe workspace-owned job state and output asset identity.  |
| `POST` | `/v1/studio/media-derivations/:jobId/cancel` | Request cooperative cancellation with an expected job revision. |
| `POST` | `/v1/studio/media-derivations/:jobId/retry`  | Requeue one retryable failed job with an expected job revision. |

Public create input names the operation and source asset. It does not choose a
provider. Every mutation requires an idempotency key, request ID, workspace
ownership, expected revision where applicable, and an API audit event.

WebMCP exposes capability and inspection first. Starting cloud processing must
be a purpose-built, user-confirmed operation because it sends image pixels to a
subprocessor and may incur cost. Applying a completed output is a reviewed
canonical source replacement, not a private direct document mutation.

Public responses expose job ID, operation, state, retryability, safe failure,
attempt count, timestamps, source asset ID, and output asset ID after success.
They do not expose provider request IDs, model payloads, URLs, R2 keys, or
internal execution state.

## Deterministic rendering

Rendering does not know about providers or jobs. Once accepted, a derived image
is an ordinary immutable managed asset with verified bytes, dimensions, media
type, and content hash.

The existing server materialization path resolves the derived managed ID into
a transient render clone, verifies R2 bytes against D1 identity, applies the
existing resource admission limits, and passes only network-isolated data to
the Renderer. The canonical document stores the managed ID and alias, not job
metadata or a provider URL.

Original and derived assets can therefore render independently and reproduce
historical versions. A missing or corrupt derivative fails with the existing
node-specific managed-resource error. Rendering never falls back to the
original or calls the provider again.

## Delivery gates

### Slice B0: durable contract and repository

- add D1 job, attempt, and provenance tables
- add strict provider-neutral input and public projections
- add repository operations for create/read/claim/fail/cancel/retry/succeed
- enforce ownership, idempotency, attempt fences, and legal transitions
- verify fresh migration, upgrade migration, constraints, and foreign keys

Exit: focused local tests prove the state and identity contract. No provider,
route, UI, R2 output, document mutation, or mask code is added.

### Slice B1: authenticated API and dispatch

- add bounded routes and canonical API errors
- add Workflow dispatch behind an injected provider adapter
- add quota reservations, timeouts, and redacted observability
- use a fake local adapter for automated tests

Exit: hostile input, replay, cancellation, retry, duplicate delivery, and late
settlement tests pass without paid calls.

### Slice B2: output asset transaction

- normalize and validate transparent output
- stage immutable R2 bytes
- atomically insert asset, provenance, and job success
- clean or quarantine partial output after failed settlement

Exit: a succeeded job always names one verified managed asset and never mutates
the source.

### Slice B3: selected-image workflow

- add privacy consent and job progress UI
- add before-and-after preview, cancellation, retry, and failure recovery
- apply through renderer-acknowledged replacement with one history entry
- preserve field-binding, source-change, review, and stale-selection guards

Exit: success, failure, cancellation, late success, Undo, reload, and compact
keyboard journeys pass.

### Slice B4: API, WebMCP, and deployed evidence

- add public inspection and purpose-built automation control
- add review details and safe provenance display
- run real staging D1, R2, Workflow, provider, privacy, and renderer evidence
- retain exact provider/model/policy identities without sensitive payloads

Exit: no public surface can bypass consent, ownership, idempotency, provenance,
or deterministic rendering.

## B0 test matrix

- valid job IDs, operation, provider keys, model versions, policy versions,
  idempotency keys, hashes, and strict unknown-key rejection
- same-key same-request replay and same-key different-request conflict
- same fingerprint under a different key returns the existing job
- cross-workspace and archived source rejection
- queued claim creates one fenced attempt and increments the count once
- duplicate claim and stale attempt settlement change nothing
- retryable and non-retryable failure settlement
- retry only from eligible failure below the attempt limit
- queued cancellation, running cancellation request, cancellation settlement,
  and late success rejection
- success requires a distinct ready output asset in the same workspace and
  writes one immutable provenance row
- source row, content hash, R2 key, and catalog metadata remain unchanged
- fresh and upgrade migrations reject invalid state, hashes, counters,
  cross-workspace references, source/output identity equality, and broken
  foreign keys

## B0 acceptance

The design above is the implementation contract for the first slice. The slice
may add only new derivation files, migration verification, and package scripts.
It must not change mask schema, mask commands, mask renderers, image replacement
semantics, route behavior, provider configuration, or deployed resources.

## B0 acceptance result

Slice B0 is locally complete at implementation checkpoint `73e62df`.

- Migration `0017_media_derivation_jobs.sql` adds workspace-scoped job,
  idempotency-request, attempt, and immutable output-provenance records. D1
  constraints and triggers enforce source and output identity, attempt fences,
  legal state changes, retry budgets, terminal settlement, and provenance
  consistency.
- The provider-neutral repository implements create, read, claim, failure,
  retry, cancellation, cancellation settlement, success, and provenance reads.
  Every operation is workspace scoped. D1 batches fence attempt settlement and
  preserve atomicity where a transition spans records.
- The strict create contract admits only the source asset, operation, and empty
  parameters. Provider key, model version, privacy policy version, and attempt
  budget are injected configuration snapshots. Public projection removes those
  internal values, hashes, workspace identity, and active-attempt identity.
- Fingerprints cover workspace, source identity and frozen content hash,
  operation, canonical parameters, provider, model, and policy. Same-key replay,
  conflicting replay, compatible work under another key, archived-source replay,
  and write-failure behavior have focused repository evidence.
- Fresh and upgrade migration verification covers constraints, foreign keys,
  legal transitions, attempt claims and counters, workspace ownership, distinct
  source/output identity, immutable provenance, and workspace cleanup.
- Focused verification passes the combined migration and repository checks plus
  3 Vitest contract tests. Studio typecheck, scoped lint, Prettier check, and
  `git diff --check` also pass.

No provider call, route, user-facing control, R2 write, document mutation, mask
change, server, deployment, or Cloudflare resource write is part of this
checkpoint. No product decision was required. Slices B1 through B4 require new
acceptance and remain closed.

## B1 implementation result

Slice B1 is implemented on the isolated background-removal branch. It is not
independently accepted or merged.

- Authenticated create, inspect, cancel, retry, and policy-disclosure handlers
  use the existing Studio principal boundary. All responses are private and
  omit provider execution IDs, storage keys, URLs, source hashes, and internal
  configuration.
- Create requires one bounded idempotency key and consent for the exact
  configured privacy-policy version. The public input cannot choose a provider,
  supply a remote URL, or add operation parameters.
- Dispatch uses a dedicated Workflow binding with the job ID as its durable
  instance ID. A duplicate create reconciles the existing instance instead of
  creating another execution owner.
- The provider interface receives only workspace-verified source bytes and
  frozen source identity. The deterministic adapter is available only through
  explicit injection or the explicit `deterministic-local-fake` configuration;
  no production provider or endpoint is configured.
- Creation and attempt admission read limits from required environment
  configuration. The checked-in production configuration contains no invented
  quotas. Missing provider, disclosure, quota, or Workflow configuration fails
  closed.
- Cancellation checks state immediately before polling and immediately before
  output settlement. A late success cannot cross the settlement callback after
  cancellation. Provider errors become bounded safe codes; raw payloads and
  exceptions are not public job data.
- B1 deliberately leaves successful-byte settlement closed. The Workflow's
  settlement callback fails closed until B2 installs the immutable output asset
  transaction.

Focused local verification at this checkpoint:

- media-derivation contract, HTTP, and execution tests: 12/12 passed
- Studio typecheck: passed
- no provider call, deployment, secret write, paid operation, or remote
  Cloudflare resource operation was performed

## B2 implementation result

Slice B2 is implemented on the isolated background-removal branch. It is not
independently accepted or merged.

- Provider input is workspace-owned bytes whose stored and computed hashes
  match the frozen source identity. The dispatch sanitizer admits PNG only,
  removes ancillary chunks including EXIF and color profiles, retains pixel
  chunks and transparency semantics, and rejects JPEG or WebP until a deployed
  image normalizer can correct orientation and color without leaking metadata.
- Output admission requires a bounded, non-interlaced, 8-bit RGBA PNG with at
  least one transparent pixel. It rejects opaque pixels-only output, other
  media types, ancillary metadata, malformed chunks, unsupported filters, and
  decompression failures.
- R2 receives one attempt-scoped immutable object before D1 settlement. One D1
  batch inserts the new ready asset, settles the exact running attempt and job,
  and inserts immutable provenance. The provenance insert guard aborts the
  batch if a stale or cancelled attempt no longer owns settlement.
- A failed or incomplete batch triggers a committed-state read. Exact committed
  output survives a lost D1 response. Otherwise the staged object is deleted
  and no selectable asset remains.
- The source row and object are never updated. The derived asset uses its own
  ID, R2 key, content hash, dimensions, catalog row, and provenance. Renderers
  continue to see it as an ordinary verified managed asset.
- The B1 Workflow now uses this settlement transaction. Provider, quota, and
  policy configuration still fail closed, and no production adapter is
  configured.

Focused local verification at this checkpoint:

- normalization, source sanitization, execution, cancellation, output
  transaction, and reconciliation tests: 8/8 passed
- executable SQLite repository verification, including atomic output and late
  cancellation cleanup: passed
- Studio typecheck: passed
- no provider call, deployment, secret write, paid operation, or remote
  Cloudflare resource operation was performed

## B3 implementation result

Slice B3 is implemented on the isolated background-removal branch. It is not
independently accepted or merged.

- The Image inspector exposes background removal only for one selected,
  editable, workspace-managed image. Local-only, curated, source-changed,
  multi-selection, and review-locked states do not start processing.
- Start requires an explicit checkbox against the exact configured privacy
  policy version. Before consent, the control discloses the configured
  processor, retention, region, cost, and cooperative-cancellation limit.
- The client sends only the managed asset ID, fixed operation, empty
  parameters, and exact consent. It uses generated request and idempotency
  identities and accepts only strict provider-neutral public responses.
- Queued, running, cancelling, failed, cancelled, and succeeded states have
  bounded progress and recovery UI. Cancellation and retry carry the expected
  update timestamp so stale actions fail closed. Failures show only safe codes.
- A workspace-scoped latest-job lookup restores active or terminal work after
  reload without resending the source or inventing consent. Selection changes
  and unmount abort polling; the durable result remains in Media.
- Successful output has an explicit before/after comparison. Apply resolves the
  output through the managed-media catalog and existing image replacement
  coordinator. The canonical document changes only after Fabric and React
  renderer acknowledgements and records exactly one `Remove background` undo
  entry. A rejected binding, stale target, or renderer failure keeps the
  original and leaves the result in Media.

Focused local verification at this checkpoint:

- derivation contract, HTTP, execution, output, client, control, and mounted
  editor replacement tests: 34/34 passed
- mounted replacement proof covers both renderer acknowledgements, one history
  entry, and Undo restoring the original asset
- Studio typecheck: passed
- `git diff --check`: passed
- no provider call, deployment, secret write, paid operation, or remote
  Cloudflare resource operation was performed

Live compact-keyboard and deployed-provider journeys remain B4 acceptance
evidence; this local checkpoint does not claim independent acceptance.

## B4 implementation result

Slice B4 is implemented on the isolated background-removal branch. It is not
independently accepted or merged, and its deployed evidence gate remains open.

- Authenticated API inspection covers policy, latest source job, exact job, and
  immutable output provenance. Historical job and provenance reads do not
  depend on the current provider being configured.
- Public provenance contains only source/output asset IDs, derivation job ID,
  operation, accepted privacy-policy version, normalized output type and
  dimensions, and creation time. It removes workspace identity, provider and
  model identifiers, source/output hashes, R2 keys, URLs, bytes, and attempt
  internals. API audit paths normalize the output asset ID.
- The successful before/after review shows that safe provenance before Apply.
  The result remains a managed Media asset even when document application is
  rejected or never requested.
- WebMCP registers `inspect_background_removal` for policy, source history,
  durable job, and safe-provenance reads. It registers
  `manage_background_removal` only for start, cancel, and retry. The start
  action requires a selectable workspace asset plus affirmative consent for an
  exact policy version; built-in, local-only, archived, and unknown assets fail
  before dispatch.
- WebMCP cannot choose a provider, send a URL or payload, bypass quotas, or
  apply output to the document. Document application remains the human-visible
  renderer-acknowledged Studio action. Cancel and retry preserve optimistic
  concurrency with the expected job update timestamp.
- Exact provider key, provider model version, privacy-policy version, source
  hash, and output hash remain in immutable internal job/provenance records for
  audit. Provider and model identities intentionally remain outside public API
  and WebMCP projections.

Focused local verification at this checkpoint:

- WebMCP registration, consent, ownership, inspection, proposal, publication,
  and rendering suites: 67/67 passed
- Studio API-boundary, derivation, client, control, mounted replacement, and
  WebMCP lifecycle suites: 57/57 passed
- WebMCP and Studio typechecks: passed
- Studio production client, SSR, and renderer build: passed (existing route-file
  and chunk-size warnings remain)
- local route generation and `git diff --check`: passed
- no provider call, deployment, secret write, paid operation, or remote
  Cloudflare resource operation was performed

The following acceptance evidence is deliberately not claimed: real staging
D1/R2/Workflow/provider execution, provider retention and region verification,
real billing/cancellation behavior, compact keyboard/browser journeys, deployed
WebMCP registration, and production renderer evidence. Those require explicit
deployment/provider authority and independent acceptance.
