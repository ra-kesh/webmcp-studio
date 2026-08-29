# WEBMCP-01C independent execution review

Date: 2026-08-29

Verdict: **ACCEPT — no P0/P1 findings**

## Reviewed boundary

The reviewer read the current implementation diff and checked canonical target
reconstruction, exact identity and ordered-selection preconditions, proposal
compiler parity with Studio commands, Review-only document dispatch, live-crop
blocking, public privacy projection, affected-ID and operation bounds,
concurrent idempotency, and the direct-command allowlist.

## Evidence

- Execution policy has one narrow direct allowlist, Review-only document
  mutations, and explicit specialized-tool redirects.
- `capabilityId` is resolved again through the canonical current/page/output
  projection; callers cannot fabricate a runtime invocation.
- Document ID, revision, snapshot, operation version, active page, node order,
  and group identity fail closed on mismatch.
- Direct commands use the same Studio product-command runtime as human UI
  commands and are limited to current-session targets.
- Proposal commands compile to existing validated `DocumentCommand` operations,
  preview through the existing ChangeSet path, and only call the existing
  `proposeChangeSet` owner. They never accept or apply Review operations.
- Live crop blocks proposal execution and proposal dry-run against stale
  committed geometry. Public projections strip renderer sources.
- Idempotency is request-hash-bound, concurrent-safe, limited to 128 receipts,
  and never evicts pending work. Exact in-flight requests share one result;
  key reuse with different input fails.
- Editor, WebMCP, and Studio typechecks pass. Focused gates pass editor
  **18/18**, WebMCP **51/51**, and mounted Studio WebMCP **4/4**.

## Deliberate open boundary

Receipts live for one WebMCP registration. Deterministic proposal IDs make
retries stable and inspectable, but durable Review history and cross-reload
deduplication remain REVIEW-02 and are not claimed here.
