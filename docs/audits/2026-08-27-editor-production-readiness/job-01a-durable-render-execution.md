# JOB-01A — durable render execution

Status: **implemented locally and independently accepted**

## Revisited evidence

- The original workflow audit and backlog require queued/running/completed/
  failed/cancelled states, bounded attempts, idempotency, restart recovery,
  cancellation, artifact retention, and status polling.
- The current POST route owns rendering inside one HTTP request. D1 records a
  job, but no durable owner can resume it after an isolate or request dies.
- Loora's export path derives output from canonical document state and cleans
  capture resources deterministically. We keep that ownership pattern without
  copying its AGPL implementation.
- Current Cloudflare Workflows guidance requires side effects to live inside
  retryable steps and every side effect to be idempotent.

## Gate contract

1. POST validates the immutable template request, persists a queued job, starts
   exactly one Workflow instance using the render ID, and returns `202` with a
   status URL. An idempotency replay returns the same job.
2. The Workflow rematerializes the immutable template, owns admission, renderer
   calls, bounded retries, deterministic artifact identity, D1 settlement, and
   partial-artifact cleanup.
3. D1 is the product-visible authority for queued, rendering, retrying,
   completed, failed, cancelling, and cancelled states. Attempts and timestamps
   are inspectable through status and history routes.
4. DELETE requests cancellation. A queued attempt cancels without rendering; a
   running attempt stops before the next artifact, deletes partial artifacts,
   settles admission, and records cancelled. Cancellation never claims to stop
   a renderer invocation that has already crossed the service boundary.
5. The playground polls durable status, shows intermediate states, exposes
   cancellation, and only presents downloads after D1 commits the output rows.
6. Completed artifacts receive an explicit expiry timestamp. Expired or missing
   objects return the existing stable `render_asset_expired` response.

## Focused proof

- Migration constraints and preservation of existing render history.
- Workflow attempt idempotency, retry/final failure, cancellation, and partial
  cleanup through focused server tests.
- Hook-level enqueue, polling, cancellation, and status-unknown reconciliation.
- Studio typecheck and scoped render tests. Browser/deployed Worker evidence is
  retained for the final JOB-01 acceptance gate.

## Implemented ownership model

- D1 is the user-visible authority; a Cloudflare Workflow owns execution.
  Dispatch intent is persisted and the scheduled reconciler inspects every
  queued Workflow so a crash between D1 and Workflow restart cannot strand it.
- The Workflow checkpoints claim/admission, every individual artifact,
  finalization, and failure compensation. Renderer keys are attempt-scoped;
  retries cannot overwrite or delete a successor attempt.
- Cancellation first claims the exact active attempt, then terminates and
  cleans. Completion first settles admission, then atomically claims the job;
  outputs and the succeeded attempt are conditional on that same claim.
- The production principal budget key is persisted. Admission settlement is
  explicit and reconciled, completed reservations reacquire concurrency before
  a product retry, and artifacts expire after seven days.
- Every artifact and finalization refreshes a fenced heartbeat, enforces the
  persisted ten-minute deadline, and bounds Renderer execution by the remaining
  time.
- Migration `0008` normalizes malformed legacy requests and missing terminal
  timestamps while preserving jobs, outputs, foreign keys, and indexes. The
  retained executable harness verifies those cases.

## Acceptance evidence

- Studio and WebMCP typechecks pass.
- 51 focused render/admission/history/WebMCP tests pass.
- `scripts/verify-durable-render-migration.sh` passes.
- Production Studio build passes.
- A local browser run on port 3001 lost its client connection after dispatch,
  but Workflow execution still completed. Reloaded History restored the exact
  D1 job and a downloadable 291.6 KB PDF.
- Independent code review rejected three iterations of ownership, settlement,
  dispatch, migration, and deadline races. The final rereview returned
  **ACCEPT with no remaining P0/P1**.

Deployed Worker restart/failure evidence remains an environment acceptance
gate; it is not represented as locally proven.
