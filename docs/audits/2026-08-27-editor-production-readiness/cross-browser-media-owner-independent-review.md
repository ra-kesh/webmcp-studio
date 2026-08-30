# Cross-browser media Slice 3B independent owner/client review

Date: 2026-08-30

Reviewer: independent code-review agent

Scope: row 10, Slice 3B — browser promotion transport, durable promotion
owner, bounded exact-byte hashing, journal cancellation integration, local
asset read cancellation, lease ownership, recovery, progress, and focused
tests.

Final verdict: **ACCEPT — no remaining P0/P1 in the reviewed Slice 3B code.**

This verdict does not close row 10. Active-document relinking and critical
draft persistence, controller/session publication guards, admission recovery,
two-browser evidence, and deployed D1/R2 evidence remain later slices in
`cross-browser-media-phase-entry.md`.

## Evidence reread

Before reviewing the implementation, I reread the complete 764-line
`cross-browser-media-phase-entry.md`, the Slice 3A journal and Slice 2 server
independent reviews, `media-01-implementation-audit.md`,
`media-01-ux-audit.md`, `fail-01e-import-lifecycle.md`, and
`fail-01f-managed-upload-lifecycle.md`.

The implementation was reviewed from the live source and tests, not from the
implementation summary:

- `local-asset-promotion-client.ts` and its tests;
- `local-asset-promotion-owner.ts` and its tests;
- `local-asset-promotion-journal.ts` and its real fake-IndexedDB tests; and
- the signal-aware paths in `local-asset-store.ts` and their tests.

The first review verdict was **REJECT** despite the then-green focused suite.
The implementation was reread after every repair below, and this report records
the final code only.

## Accepted contract

- The durable journal checkpoint and stable idempotency key exist before any
  local byte read, hash, lookup, or upload. Unexpected initial IndexedDB/open
  failures normalize to `local_promotion_checkpoint_failed`; no checkpoint
  failure is swallowed and no network work starts behind it.
- The owner reads the exact local revision twice, hashes and later uploads the
  same immutable Blob, rejects revision/size/media-type drift, and checkpoints
  the content hash before the first upload attempt. SHA-256 is incremental over
  256 KiB reads, has per-read and whole-hash deadlines, propagates cancellation
  only after FileReader abort acknowledgement, and matches Web Crypto across
  chunk and padding boundaries.
- State changes are directional. Only `uploading` increments `attempt`, and it
  increments exactly once before `send`. Cancellation after that checkpoint is
  durably settled with zero upload. Failed or cancelled attempted operations
  reconcile the exact alias before requiring local bytes or retrying.
- Exact lookup is always performed before a first upload. `uploading` crash
  recovery becomes `status_unknown`; any transport-ambiguous upload result is
  reconciled before another upload. Same-hash resolution becomes `mapped`, a
  different hash becomes `conflict`, and an unmapped ambiguous result remains
  truthfully `status_unknown`.
- `mapped`, `relinking`, `complete`, and `conflict` resume without local reads,
  hashing, lookup, or upload. Stable idempotency identity survives every retry.
- Initial journal read/create/claim cancellation waits for the underlying open
  or transaction outcome. Abort-wins rolls back and acknowledges before an
  immediate retry; commit-wins returns the exact committed checkpoint. A
  create that commits remains an unleased queued checkpoint, while a claim
  that commits is observed by the owner, durably cancelled, and released. No
  cancellation branch leaves an unknown live 90-second lease.
- Ownership uses a finite renewable lease plus revision-and-token CAS. Lease
  loss aborts cooperative work; noncooperative late progress and upload success
  cannot publish or mutate the journal. Expired-owner writes fail the live
  lease/revision checks, and takeover remains bounded.
- User cancellation waits for the active IndexedDB read, FileReader, lookup, or
  XHR to acknowledge abort. Once an upload result is uncertain, the owner uses
  the ownership signal—not the discarded UI signal—to perform mandatory
  reconciliation. No second upload overlaps that recovery.
- Lookup cancellation and timeout cover response-body parsing, not merely
  response headers. Lookup/upload responses must carry a valid request ID and
  the requested local alias. Invalid or mismatched 2xx upload responses are
  treated as remotely ambiguous and reconciled.
- XHR construction, open, header, FormData, send, network, abort, timeout, and
  response-validation failures have explicit stable identities and correct
  known/unknown commit classification. A pre-aborted request constructs and
  sends no XHR.
- Byte progress exists only for the active upload attempt and is cleared on
  every later state. Progress observers are advisory: observer exceptions do
  not affect operation correctness or cancellation, and no progress is
  published after settlement or lease loss.
- Slice 3B does not mutate a document or draft. Its terminal output is the
  authoritative released journal checkpoint; document relinking and UI
  publication belong to Slice 4 and must revalidate the active document/session
  before touching user state.

## P1 findings found and repaired during review

### 1. Cancellation could escape before the browser operation acknowledged it

Initial journal/open work and local IndexedDB reads could reject to the caller
before the underlying operation settled. A cancelled create or claim therefore
had a race in which a checkpoint—or a 90-second lease—could commit after the
owner had already disappeared.

Repair: journal read/mutate/claim and local store open/read paths became
signal-aware and wait for the real operation result or transaction abort.
Journal work is serialized within the browser context across abort
acknowledgement. Mutation commit wins cancellation and returns its exact
checkpoint; abort wins rolls back before retry. Owner-level tests prove
create-commit-after-abort, claim-commit-after-abort, failed/cancelled retry
claims, automatic lease release, zero network work, and immediate retry.

### 2. Pre-aborted and mid-flight transport cancellation was incomplete

The upload client could construct/send XHR for an already-aborted signal, and
lookup timeout/cancellation stopped at the response headers rather than
covering `response.json()`. Upload cancellation and the uploading-checkpoint
boundary also lacked complete zero-send acknowledgement evidence.

Repair: pre-abort exits before XHR construction; fetch keeps the bounded signal
through response parsing; XHR abort settles only through abort/error outcome;
and the owner waits for that acknowledgement before mandatory reconciliation.
Tests cover cancel during lookup body, local read, hash, upload, journal
read/create/claim, and both sides of the uploading checkpoint.

### 3. Some remotely ambiguous results could retry without reconciliation

Attempted `failed`/`cancelled` checkpoints did not always reconcile before
reading local bytes, and invalid 2xx upload responses without trustworthy
request identity were initially classified as known failures. That could miss
a late committed mapping or permit an unsafe retry.

Repair: every attempted checkpoint with a verified hash reconciles first.
Invalid/missing request identity or mismatched alias on a 2xx upload is
`commitStatus: unknown`; the owner checkpoints `status_unknown` and reconciles
before any later upload. Late same-hash mapping succeeds without local bytes;
different-hash mapping becomes an explicit conflict.

### 4. Transition and cancellation edges could produce invalid or misleading state

Cancellation after the uploading checkpoint attempted an unsupported
transition, arbitrary caller abort reasons could leak as unrelated error
codes, and pre-work retries from failed/cancelled states had incomplete
directional coverage.

Repair: the transition table now admits only the required cancellation/retry
edges, attempt changes remain exclusive to `uploading`, and every user-cancel
checkpoint uses `local_promotion_cancelled`. Cancellation after reconciliation
and immediately before the upload checkpoint is durably cancelled with zero
send.

### 5. Lease loss and advisory progress could publish stale outcomes

A noncooperative upload could report progress or success after lease loss, and
an exception thrown by the UI progress observer could interrupt durable owner
work.

Repair: all post-await mutations still pass through owned revision/token CAS;
the lease-loss signal suppresses late progress and prevents late mapping.
Observer calls are isolated from correctness and cancellation. Regression
tests cover cooperative and noncooperative lease loss, heartbeat renewal, late
success, late progress, and throwing observers.

### 6. Transport identity and hash boundary evidence was incomplete

Lookup/upload success initially did not prove the returned alias was the one
requested, and the custom incremental SHA implementation lacked padding-edge
vectors.

Repair: both clients reject alias mismatch, all accepted successes require a
valid request identity, and SHA tests compare against Web Crypto at 55, 56, 63,
64, and 65 bytes as well as across the 256 KiB read boundary.

### 7. Malformed journal setup could release a database handle before abort acknowledgement

Synchronous object-store setup failure aborted and closed immediately, leaving
the serialized operation without a confirmed transaction outcome.

Repair: when a transaction exists, both read and mutation setup-failure paths
install abort/error handlers, request abort, and close/reject only after the
abort acknowledgement. Tests cover both read and create setup failures.

## Independent verification run

Using bundled Node 24.19.0, from `apps/studio`:

- Focused Slice 3B suite: **97/97 passing** across client, owner, journal, and
  local-asset-store tests.
- The journal/owner subset was additionally rerun twice during the final audit:
  **59/59 passing** on each run before the final added cancellation regression.
- Studio typecheck: passed.
- Scoped ESLint over the eight reviewed implementation/test files: passed.
- `git diff --check`: passed for the shared working tree at review time.

## Explicitly deferred evidence

These are not Slice 3B blockers, but they remain mandatory before row 10 can
close:

- Slice 4 must own active-document admission, one undoable relink transaction,
  critical draft flush, completion receipt, refresh recovery, and session-safe
  UI publication. This review proves that Slice 3B itself makes no document/UI
  mutation; it does not prove the future controller guard.
- Slice 5 must exercise real Chromium contexts for IndexedDB, FileReader,
  trackable XHR progress/abort, BroadcastChannel refresh behavior, two-tab
  contention, refresh recovery, and two-browser relinking/export.
- Slice 6 must prove the complete owner against deployed D1/R2 promotion and
  exact lookup, including real request IDs, idempotent recovery, alias conflict,
  archived restore, timeout/disconnect ambiguity, and storage/accounting.
- Global in-context journal serialization favors correctness over throughput.
  Its performance with many simultaneous unrelated promotions should be
  measured with the later batch-media workload, but it is not a correctness
  blocker for this slice.
