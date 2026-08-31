# ASSET-02 background removal phase entry

Date: 2026-08-31
Status: design accepted for Slice B0; implementation not yet accepted
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
    | "queued"
    | "running"
    | "cancelling"
    | "succeeded"
    | "failed"
    | "cancelled"
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

| Method | Resource | Behavior |
| --- | --- | --- |
| `POST` | `/v1/studio/assets/:assetId/derivations` | Create or return an idempotent job for an admitted operation. |
| `GET` | `/v1/studio/media-derivations/:jobId` | Read safe workspace-owned job state and output asset identity. |
| `POST` | `/v1/studio/media-derivations/:jobId/cancel` | Request cooperative cancellation with an expected job revision. |
| `POST` | `/v1/studio/media-derivations/:jobId/retry` | Requeue one retryable failed job with an expected job revision. |

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
