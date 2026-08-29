# FAIL-01C export prerequisite cancellation

Date: 2026-08-29

Status: implemented locally; independently accepted with no remaining P0/P1

## Bounded gate

This gate closes the Studio work that happens before a PNG or PDF request
reaches Renderer. A foreground export can now stop waiting for an in-flight
draft save and can cancel browser-local image reads and encoding without
releasing the operation while sibling work is still alive.

Before implementation, the phase reread the current FAIL-01 audit, Loora's
canvas import and export cleanup, OpenPencil's AbortSignal fetch deadlines, and
the Studio draft controller, local asset repository, PNG path, and PDF path.

## Product contract now implemented

- PNG and PDF pass the foreground operation signal through the active draft
  flush. Cancellation stops only the export waiter. It does not cancel or
  duplicate an IndexedDB compare-and-swap write that already owns document
  durability.
- Retry joins the same ordered draft write. A newer captured edit remains
  queued behind it, with one active write and increasing record versions.
- Browser-local asset lookup accepts AbortSignal through legacy-migration
  waiting, database open, readonly lookup, and corrupt-asset quarantine.
  Cancellation closes a database that opens late and aborts active
  transactions. The operation rejects after IndexedDB reports rollback.
- Local image materialization owns every image operation it starts. The first
  failure aborts sibling reads and FileReaders, waits for all siblings to
  settle, and then reports the original error. Caller cancellation takes
  precedence over cleanup errors.
- PNG and PDF call the same local-image materializer. Missing or corrupt bytes
  fail before Renderer receives a request.

## Evidence

- Draft controller regressions cover an aborted waiter joining one existing
  write and a newer captured edit draining in exact order with a maximum of one
  active write.
- Two-image regressions cover ordinary failure aborting a pending sibling and
  caller cancellation waiting for both children before returning AbortError.
- The PNG regression proves the exact signal reaches draft flush and Renderer
  is never called after cancellation.
- Focused draft, PNG, materialization, and local-asset storage tests pass 37/37.
  Studio typecheck and scoped ESLint pass.
- Independent review rejected the first pass because Retry could overlap a
  cancelled but unsettled IndexedDB open. The final reservation gate keeps that
  open owned through late close. Review then accepted the repaired code with no
  remaining P0/P1.

## Honest remaining FAIL-01 work

1. Fabric startup and document/image decode loading need explicit timeout,
   cancellation, error, retry, and recovery states.
2. Upload, import, publish, WebMCP, and durable job operations need the same
   identity and ownership rules.
3. Public Worker errors still need one request identity, stable code, path, and
   retryability contract.
4. Deployed Worker and injected-failure evidence remains open.
