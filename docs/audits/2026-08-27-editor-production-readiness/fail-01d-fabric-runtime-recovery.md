# FAIL-01D Fabric runtime recovery

Date: 2026-08-29

Status: implemented locally; independently accepted with no remaining P0/P1

## Bounded gate

This gate closes startup, document synchronization, font preparation, image
decode, teardown, and visible image-retry ownership for the interactive Fabric
canvas. It does not claim that upload, import, publish, WebMCP, or durable render
jobs have the same recovery contract yet.

Before implementation, the phase reread the retained FAIL-01 evidence and the
actual Loora and OpenPencil lifecycle code. Loora supplied the bounded
settlement and cleanup model. OpenPencil supplied the abort, concurrency, and
destroy-before-replacement patterns. The product implementation remains our own
document/image editor boundary.

## Product contract now implemented

- Adapter import/mount has a 15-second deadline and exact attempt ownership.
  Document synchronization has a 20-second deadline and reports preparing,
  ready, or error for the exact document ID, revision, and page.
- A new attempt waits for both the previous synchronization and adapter
  lifecycle. Retry cannot mount a second live adapter. Failed async disposal is
  not swallowed; the editor exposes a reload recovery instead of unsafe Retry.
- Every incremental document synchronization visibly returns to Preparing.
  Fabric and its crop/selection chrome are inert and hidden from accessibility
  APIs until the exact attempt is ready. A user-owned successful retry restores
  keyboard focus to the Fabric application canvas.
- Font preparation derives requests only from visible text on the requested
  page. It waits for exact `load` and `check` results, not unrelated global
  `FontFaceSet.ready` work.
- Image preparation forwards the parent cancellation signal, limits decode
  concurrency to six, and gives each decode eight seconds. Ordinary image
  failure becomes a bounded placeholder while later siblings continue; parent
  cancellation remains fatal to the whole stale synchronization. A failed
  replacement retains the previously decoded pixels.
- Visible per-image Retry carries the exact source and resource token, has its
  own eight-second deadline, rejects stale completion, reports failure, and is
  cancelled on replacement or component unmount.
- Product readiness follows exact synchronization rather than animation
  frames, avoiding false timeout errors in background tabs. The conformance
  harness owns its separate painted-frame wait.

## Evidence

- Mounted lifecycle regressions cover stalled import, accessible Retry,
  teardown-before-remount, failed-disposal reload recovery, inert state, focus
  restoration, and exact-token bounded image Retry.
- Studio Fabric runtime tests pass 19/19. Editor Fabric adapter tests pass
  76/76. Both package typechecks pass; Studio scoped ESLint, Prettier, and
  repository whitespace checks pass.
- Independent review reread the implementation and the Loora/OpenPencil
  references, then returned **ACCEPT with no remaining P0/P1 finding**.

## Honest remaining FAIL-01 work

1. Upload and import still need explicit operation identity, bounded progress,
   cancellation acknowledgement, retry, and recovery.
2. Publish and WebMCP execution need the same no-overlap ownership contract.
3. Durable jobs need restart-safe attempts, leases, cancellation, and expiry.
4. Public Worker failures still need one request identity, stable error code,
   path, and retryability contract.
5. Deployed Worker and injected network/storage failure evidence remains open.
