# FAIL-01F — Managed upload lifecycle

Date: 2026-08-29

Status: implemented locally and independently accepted

## Boundary

This gate closes ownership, bounded concurrency, truthful recovery, and
idempotent reconciliation for managed workspace image uploads. It does not
claim browser-local upload promotion, workspace quota/rate admission, remote
upload cancellation, publish, WebMCP, or durable render jobs are complete.

Before implementation, the retained FAIL-01 and MEDIA-01 audits and these
matching reference areas were reread:

- OpenPencil `src/app/editor/clipboard/figma-images.ts`: bounded concurrency,
  finite per-request deadlines, and per-item failure containment.
- Loora's asset-panel upload flow: independent queue rows and stable asset
  insertion after upload completion.
- Studio's managed media route, XHR repository, idempotency table, D1 metadata,
  and private R2 content path as one lifecycle.

## Implemented contract

- New files enter one visible queue and at most three managed uploads own a
  request concurrently. Synchronous claims prevent React effects from starting
  the same queued item twice.
- Each queue item owns an attempt number and stable idempotency key. Progress,
  completion, failure, and cleanup are accepted only from the current attempt.
- Queued work can be cancelled before a request exists. Active cancellation is
  shown as stopping until the local XHR acknowledges abort; the UI makes no
  claim that the remote Worker was cancelled.
- Retry is offered only for typed transient outcomes. Validation and other
  deterministic 4xx failures stay terminal. Timeout and network loss are
  labelled **Status unknown**, because the Worker may have committed after the
  client lost contact.
- Retrying cancellation or an unknown result reuses the original idempotency
  key and enters **Checking server**. A committed upload resolves to the
  existing asset; an uncommitted upload safely completes once.
- New R2 content keys are deterministic by workspace and SHA-256 content hash.
  D1 race losers never delete a shared content object. Retrying a D1 failure
  reuses or overwrites that exact key, while orphan reclamation remains a
  separate ownership-aware maintenance concern.

## Focused evidence

- Studio typecheck passes.
- Three focused suites pass 30/30 under Node 22: queue admission and truthful
  terminal controls, XHR progress/cancel/timeout/error typing, and repository
  D1/R2 identity/race handling.
- Scoped Studio lint passes for every changed TypeScript/React file.
- The adversarial repository regression injects a same-content,
  same-idempotency-key, different-request race and proves the winner's private
  bytes remain readable.

## Remaining FAIL-01 work

- Browser-local upload ownership/promotion and cross-browser missing-byte
  recovery.
- Publish, WebMCP, and durable render-job recovery.
- Uniform public error/retry identity plus deployed injected-failure evidence.
- Workspace upload quotas, rate/concurrency admission, and orphan reclamation
  remain API-SEC/JOB production boundaries rather than claims of this client
  recovery gate.

## Independent review

The first review rejected the gate for two P1 defects: a D1 race loser could
delete an R2 key already owned by the winner, and timeout copy claimed failure
although the server result was ambiguous. The shared-key deletion was removed,
an adversarial race regression was added, and timeout/network loss now enters a
truthful unknown-status reconciliation path. Final rereview returned **ACCEPT
with no remaining P0/P1**. A mounted full-queue lifecycle regression is retained
as P2 hardening rather than a blocker.
