# FAIL-01G — Publication lifecycle and authority

Date: 2026-08-30

Status: implemented locally and independently accepted

## Boundary

This gate closes authenticated publication-history authority, exact operation
ownership, truthful cancellation, cross-browser ordinal recovery, and durable
draft linking for immutable document publication. It does not claim WebMCP
execution, render jobs, browser-local asset promotion, deployed Worker failure
evidence, quotas, or public error standardization are complete.

Before implementation, the retained FAIL-01 publication findings and these
matching reference areas were reread:

- Loora's transaction engine and agent tools: human and programmatic actions
  share one operation identity and canonical state transition.
- Loora's export/capture boundary: immutable output identity is adopted only
  after the authoritative renderer/server response.
- OpenPencil's finite asynchronous admission patterns: cancellation is tied to
  an exact attempt and stale completions cannot project into a newer editor
  state.
- Studio's publication route, D1 template repository, local draft repository,
  dialog, shell status, and mounted persistence races as one lifecycle.

## Implemented contract

- Origin-global `localStorage` publication replay was removed. Each workspace
  session clears the current stream from memory and loads server authority
  through authenticated GET. Publishing repeats that authenticated read before
  consuming history, so a same-document ID from another principal cannot be
  posted into the active workspace.
- Public template identity is stable and document-owned
  (`template-${document.id}`). Quotation style remains composition metadata and
  cannot merge unrelated customer documents or fork one document's API stream.
- Publication is synchronous single-flight. Dialog, WebMCP, and other callers
  join the exact same promise. A 45-second deadline and explicit Cancel abort
  the local waiter; document/session/snapshot guards prevent late success or
  failure from overwriting a newer editor state.
- Draft flush receives the publication signal. IndexedDB head reads and
  publication links use an abortable waiter plus a serialized repository tail:
  Retry cannot overlap an abandoned step, and a cancelled queued retry cannot
  start after its predecessor settles.
- Cancellation never claims the Worker rolled back. It ends in **Status
  unknown** with explicit copy that Retry checks the same immutable snapshot.
  The shell and dialog expose syncing, stopping, unknown, failed, and synced
  states truthfully.
- Every publish rechecks the exact durable record version and content snapshot.
  Server success links only that head; later edits remain saved and explicitly
  unpublished.
- D1 is authoritative. Provisional client versions are never installed.
  Same-slot cross-browser races return the next expected ordinal, the client
  retries inside the same operation, and an authoritative older version for a
  reverted snapshot is retained without creating a phantom candidate.
- The dialog distinguishes stream latest from the version matching the current
  snapshot. Reverting to previously published content is therefore represented
  as published even when it is not the highest ordinal.

## Focused evidence

- Studio typecheck passes.
- Scoped Studio lint passes for every changed TypeScript/React file.
- Mounted persistence and template repository suites pass 84/84 under the
  bundled Node 24 runtime.
- Regressions cover origin-global cache isolation, authenticated GET before
  publication, exact single-flight, cancel acknowledgement, status-unknown
  truth, cross-browser ordinal repair without a phantom version, exact durable
  linking, and a late publication against a newer local head.

## Remaining FAIL-01 work

- WebMCP command execution ownership, cancellation, timeout, stale completion,
  and visible recovery.
- Durable render-job attempts, leases, cancellation, restart recovery, and
  artifact expiry.
- Browser-local upload promotion and cross-browser missing-byte recovery.
- Uniform public error/retry identity, workspace quota/rate admission, and
  deployed injected-failure evidence.

## Independent review

The review rejected early iterations for cross-workspace cache replay,
unbounded local repository waits, ambiguous cancellation copy, stale editor
projection, phantom provisional versions, real D1 ordinal races, and queued
retry overlap. The final implementation combines authenticated authority,
snapshot/session guards, a serialized abortable repository tail, server-derived
ordinal recovery, and truthful status projection. Final rereview returned
**ACCEPT with no remaining P0/P1**.
