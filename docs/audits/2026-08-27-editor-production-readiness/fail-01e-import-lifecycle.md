# FAIL-01E — Import lifecycle

Date: 2026-08-29

Status: implemented locally and independently accepted

## Boundary

This gate closes the recoverable lifecycle for Studio document JSON and Stuwiz
quotation JSON imports. It does not claim media uploads, draft repository writes,
publish, WebMCP execution, or durable render jobs are complete.

Before implementation, the retained FAIL-01 audit and these matching reference
areas were reread:

- Loora `packages/editor/src/lib/canvas-html-import.ts`: byte admission,
  finite resource waits, and owned cleanup in `finally`.
- OpenPencil `src/app/editor/clipboard/figma-images.ts`: AbortSignal deadlines
  and bounded child work.
- OpenPencil `src/app/tabs/index.ts`: pending-operation ownership and stale
  completion cleanup.
- Studio's existing abortable local IndexedDB and managed-media repository
  reads, which are reused rather than raced by a second cancellation layer.

## Implemented contract

- Canonical Studio JSON is rejected before reading above 32 MiB. Quotation JSON
  uses the stricter 2,000,000-byte Stuwiz API body boundary.
- Browser file ingestion uses `FileReader`, aborts the owned read, removes all
  listeners on every terminal path, and settles only from the matching reader.
  The non-browser test/runtime fallback remains signal-aware.
- The caller signal crosses exact local IndexedDB and managed-media admission.
  Abort and timeout errors are rethrown instead of being mislabeled as missing
  resources.
- Workspace document and quotation imports use the shell's identity-aware
  critical action owner. Only one operation can run, a 45-second admission
  deadline is visible, Cancel waits for acknowledgement, and Retry cannot
  overlap the old attempt.
- Home import uses the same owner. Once file and resource admission succeeds,
  it enters an explicit non-cancellable phase: the admission deadline is
  removed and the existing draft replacement/repository transition owns the
  durable create. The UI therefore never claims an atomic IndexedDB create was
  cancelled after it started.
- Unmount, session replacement, or a newer import makes an old completion
  silent. An ordinary edit in the same document receives an explanatory stale
  import message. Crop and Review continue to report their existing exact
  mutation blocker.
- Successful in-place imports remain one named history replacement and enter
  the existing autosave path. Successful Home imports remain durably created
  before workspace installation.

## Focused evidence

- Studio typecheck passes.
- Document admission tests pass 30/30, including the real FileReader abort and
  listener-cleanup path plus delayed managed-resource abort acknowledgement.
- Critical action owner and visible status tests pass 17/17, including
  terminal Retry revocation and the non-cancellable storage status.
- Nine focused mounted persistence races pass for ordinary edits, session
  replacement, and competing document/quotation imports.
- The focused suite totals 56 passing tests. The existing React
  test warning around a pagehide fixture is pre-existing and is not an import
  lifecycle failure.

## Remaining FAIL-01 work

- Managed and local media upload ownership, concurrency, reconciliation, and
  cleanup repair.
- Publish, WebMCP, and durable render-job recovery.
- Uniform public error code/retryability identity and deployed injected-failure
  evidence.

## Independent review

The first review rejected the gate for three P1 defects: resource admission
released before abort acknowledgement, cancelling the replacement dialog left
stale Retry authority, and the Home storage phase still claimed it was reading.
The repaired diff directly awaits repository cleanup, revokes terminal Retry on
dialog cancellation and target changes, and exposes truthful storage status.
The reviewer reread the final code and returned **ACCEPT with no remaining
P0/P1 finding**.
