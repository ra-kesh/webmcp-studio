# FAIL-01B Renderer execution deadline

Date: 2026-08-29

Status: implemented locally; independently accepted with no remaining P0/P1

## Bounded gate

This gate covers the Renderer execution deadline for PNG, PDF, and thumbnail
requests. It composes the caller's AbortSignal with a 45-second server deadline
and preserves the ownership rule established in FAIL-01A: Renderer never
returns a deadline response while its Browser or artifact cleanup is still
owned by the request.

Before implementation, the phase reread the current FAIL-01 audit, Loora's
bounded but unowned iframe/font/image readiness waits, OpenPencil's
AbortSignal-based fetch deadlines, and the complete Studio → Renderer → Browser
→ R2 boundary. Loora's bare `Promise.race` was deliberately not copied for
owned Browser/R2 work.

## Product contract now implemented

- `/render`, `/render/pdf`, and `/render/thumbnail` compose caller cancellation
  with one 45-second execution deadline.
- Browser acquisition and connection run through one BrowserWorker proxy that
  forwards the composed signal into every binding fetch. Acquired sessions use
  the platform's minimum 10-second idle keep-alive to bound an unconnected
  orphan.
- A deadline closes the active Browser session once, prevents capture or
  success after the deadline, and returns a stable `504
  render_deadline_exceeded` response with retry metadata after cleanup settles.
- A persistent R2 put cannot accept AbortSignal. If the deadline lands during a
  put, Renderer keeps ownership, waits for the binding to settle, deletes the
  late artifact, and only then returns 504. Studio therefore does not release
  its admission lease while Renderer work is still alive.
- Caller cancellation takes precedence over the server timeout, so a caller
  disconnect remains AbortError rather than being rewritten as 504.
- The deadline is cooperative, not a false hard wall. A platform primitive
  that neither accepts AbortSignal nor settles can keep the request in cleanup
  past 45 seconds. That limitation is recorded instead of releasing capacity
  early through a bare race.

## Evidence

- Renderer tests cover an acquisition stall plus PNG, PDF, and thumbnail
  page-setup stalls. The binding fetch observes TimeoutError; acquired sessions
  close exactly once; no capture/R2 work follows; each path returns the exact
  stable 504 envelope.
- A persistent-PDF regression proves the request does not return at the
  deadline while R2 put is pending; after put settles it deletes the late key,
  skips get, closes Browser, and then returns 504.
- The deadline Worker boundary passes 35/35; the complete Renderer package
  passes 63/63; Renderer typecheck passes.
- Independent line-by-line review accepted the final code and documentation
  with no remaining P0/P1 finding after rejecting the early-response ownership
  race and the unbounded Browser-acquisition path.

## Honest remaining FAIL-01 work

1. Abort-aware or separately bounded Studio draft flush and browser-local asset
   reads, so foreground cancellation cannot remain in `cancelling` forever.
2. Platform-level evidence for Browser close and R2 settlement latency; R2 and
   every Browser primitive do not expose AbortSignal directly.
3. Failure/recovery contracts for Fabric startup, persistence, upload, import,
   publish, WebMCP, and durable job retries/restart recovery.
4. One public error/request identity envelope across those boundaries, followed
   by injected-failure and deployed Worker evidence.
