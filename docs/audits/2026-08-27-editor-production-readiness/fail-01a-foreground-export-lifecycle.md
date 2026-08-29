# FAIL-01A foreground export lifecycle

Date: 2026-08-29

Status: implemented locally; independently accepted with no remaining P0/P1

## Bounded gate

This gate covers foreground PNG and PDF export only. It does not close the
complete FAIL-01 backlog for Fabric startup, draft storage, uploads, imports,
publication, WebMCP, or durable render jobs.

Before implementation, the phase reread the current FAIL-01 audit, Loora's
bounded iframe/font/image import cleanup, OpenPencil's timeout-aware fetch
handling, the existing thumbnail cancellation path, and current Cloudflare
Request/compatibility-flag documentation.

## Product contract now implemented

- PNG and PDF exports have one operation identity and request cancellation at a
  60-second deadline. The owner remains visibly `cancelling` until the current
  operation acknowledges abort; only then does it expose the timed-out or
  cancelled terminal state and Retry. A non-cooperative prerequisite can
  therefore remain `cancelling`, but it cannot overlap a retry or stale-write a
  newer operation.
- A fixed, always-mounted surface exposes progress and truthful Cancel; terminal
  states use an alert with Retry. It remains reachable outside compact menus.
- Cancellation propagates through local image materialization, draft flush
  checkpoints, Studio fetch, incoming Worker requests, managed asset reads,
  the private HTTP service binding, Browser Rendering, and response streaming.
- Browser sessions close exactly once when work is abandoned. Foreground PNG
  and PDF use an explicit ephemeral Renderer mode that returns captured bytes
  from memory and never writes an R2 artifact. The persistent artifact path
  retains its abort cleanup for durable render work.
- Capacity reservations complete on successful foreground renders and use an
  immediate idempotent retry when failure settlement transport fails. If both
  settlement attempts fail, the admission reservation's two-minute TTL is the
  final recovery; this gate does not claim instantaneous settlement in that
  double-transport-failure case.
- Aborted JSON body reads preserve AbortError instead of becoming a misleading
  `400 request_body_unreadable` response.
- Studio enables `enable_request_signal` and
  `request_signal_passthrough`; Renderer production/local enables
  `enable_request_signal`. The path uses HTTP service-binding fetch, so
  AbortSignal RPC compatibility is not required.
- The adjacent thumbnail boundary no longer treats a caller disconnect after
  Renderer invocation as success; it cancels the upstream body and fails the
  lease once.

## Evidence

- Focused lifecycle, status-surface, PNG, JSON-boundary, Studio thumbnail,
  admission, private-request, and Renderer tests cover the cancelling lock,
  cancel/retry identity, body cancellation, Browser close, no capture after
  abort, in-memory foreground artifacts with zero R2 calls, persistent-path R2
  cleanup, and admission-settlement retry/TTL fallback.
- `@webmcp/worker-boundary`, `@webmcp/renderer`, and `@webmcp/studio`
  typechecks pass.
- Renderer Wrangler dry-run accepts the compatibility flags and bundles the
  Worker. Direct Studio Wrangler bundling still cannot resolve TanStack's Vite
  virtual modules; this is the pre-existing reason Studio is built through its
  Vite pipeline, not a compatibility-flag rejection.
- Real-browser acceptance on port 3001 exercised More actions → File → 6-page
  PDF. The visible progress surface exposed Cancel; cancellation produced the
  alert and Retry; Retry started a fresh operation; the second operation was
  cancelled cleanly. Port 3000 was not touched.
- Independent line-by-line review accepted the bounded diff with no remaining
  P0/P1 finding after rejecting and rechecking the cancelling-ownership,
  ephemeral-artifact, admission-settlement, and documentation repairs.

## Honest remaining FAIL-01 work

1. Overall server-side render deadlines composed with caller cancellation, so
   launch, page setup, capture, and R2 cannot run indefinitely without a client.
2. Abort-aware or otherwise bounded draft flush and local-asset prerequisites,
   so the foreground owner never remains `cancelling` indefinitely.
3. Audited recovery contracts for Fabric startup, storage/open/save, upload,
   import, publish, WebMCP execution, and durable job operations.
4. One stable public error/retry envelope and request identity across those
   boundaries, followed by injected-failure and deployed Worker evidence.
