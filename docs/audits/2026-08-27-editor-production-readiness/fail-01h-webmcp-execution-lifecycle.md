# FAIL-01H — WebMCP execution lifecycle

Date: 2026-08-30

Status: implemented locally and independently accepted

## Boundary

This gate applies the retained FAIL-01 operation contract to WebMCP tool
registration, tool execution, publication, managed asset resolution, and the
Studio render-history projection. It does not claim the render backend is a
durable queued job system, browser-local assets are shared across browsers, or
deployed Worker failure evidence exists.

Before implementation, the WEBMCP-01C entry/review, remaining-product ledger,
and these matching reference areas were reread:

- Loora's `canvas-tools.ts` and transaction engine for one validated operation
  vocabulary shared by human and agent actions.
- Loora's editor client for finite ownership, synchronization, and stale
  completion rejection.
- Loora's export/capture flow for adopting authoritative output identity only
  after a confirmed result.
- Studio's actual WebMCP registration, product-command receipts, managed media,
  publication owner, render history, shell adapter, and mounted lifecycle tests.

## Implemented contract

- Every registered tool executes under one finite owner. Registration teardown,
  context replacement, and a 60-second deadline abort the tool signal. Tools
  return stable `execution_cancelled` or `execution_status_unknown` identity
  instead of allowing abandoned work to project success later.
- Registration itself has a 10-second deadline, bounded retry, generation
  ownership, and live `document.modelContext` replacement detection. A late
  completion from a retired registration cannot become ready.
- Managed media search and resolution receive the exact caller signal. Two
  concurrent lookups for the same asset no longer share the first caller's
  cancellation state, and proposal side effects recheck ownership immediately
  before entering Review.
- Publication uses the exact document, revision, and history snapshot inspected
  by WebMCP. A caller cannot join a publication owned by another snapshot.
  Registration teardown reaches the editor publication owner, while a joining
  waiter cannot cancel an existing matching owner. The immutable content hash
  remains a separate durable publication identity.
- Publication abort and timeout return typed unknown status because the server
  may already have committed. Active text editing is committed before exact
  identity validation and cannot silently change the approved snapshot.
- Render requires a caller idempotency key. Same-key/same-request calls join;
  conflicting reuse fails. At most three renders enter synchronously. Abort,
  network loss, and an unreadable successful response become `status_unknown`;
  an authoritative non-2xx response becomes `failed`.
- Retrying an unknown render with the same key reconciles the server identity.
  Local optimistic rows and restored authoritative rows de-duplicate even when
  render-history GET and render POST resolve in the adversarial order.

## Focused evidence

- Studio and WebMCP typechecks pass.
- Scoped Studio lint and Prettier checks pass for the changed files.
- Focused mounted Studio suites cover registration teardown/replacement,
  registration timeout, managed proposal cancellation, publication ownership,
  external publication abort, managed-catalog signal isolation, render unknown
  status, same-key reconciliation, and render-history projection races.
- The WebMCP registration suite covers all 15 tools, signal threading, stable
  publication unknown status, render idempotency input, and the existing
  command/proposal privacy contracts.
- Focused Studio suites pass 100/100 and the WebMCP registration suite passes
  38/38 under the bundled Node runtime.

## Remaining FAIL-01 work

- Durable queued render jobs with leases, attempts, restart recovery,
  cancellation, artifact expiry, and metrics.
- Browser-local upload promotion and cross-browser missing-byte recovery.
- Uniform public API errors, quotas/rate admission, and deployed injected-
  failure evidence.

## Independent review

The review rejected early iterations for registration-owned work that could
outlive teardown, hung registration, exact publication joining the wrong
snapshot, publication signals stopping at the shell boundary, shared asset
resolution signals, duplicate render rows, two different snapshot identity
domains, and transport failures falsely reported as authoritative render
failure. Each finding now has a focused regression. Final rereview returned
**ACCEPT with no remaining P0/P1**.

Status: **implemented locally and independently accepted; broader FAIL-01 remains open**
