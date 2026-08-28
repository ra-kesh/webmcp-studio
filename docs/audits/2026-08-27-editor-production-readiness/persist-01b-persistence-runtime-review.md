# PERSIST-01B persistence runtime independent review

Date: 2026-08-28
Final re-review: 2026-08-28
Verdict: **APPROVE**
Scope: `studio-persistence-runtime.ts` and its focused unit suite against `persist-01b-persistence-layout-route-plan.md`

## Executive result

The runtime implementation is coherent and no production defect was confirmed in the reviewed lifecycle. Construction is inert, migration outcomes map exactly, repeated `start()` calls share one promise, repository events fan out through one subscription, StrictMode-style cleanup is cancelled by a new retain, finalization waits for child leases, and late completion after final close cannot publish.

The final test revision closes the only former P2 acceptance gap. A reachable reentrant retry now proves that the new generation remains authoritative while the failed generation's promise finishes. No P0, P1, or P2 finding remains in this bounded runtime scope.

## Final finding disposition

### Former P2-1: Closed

`retry()` increments `#generation`, clears the memoized promise, publishes `opening`, and starts the next attempt (`studio-persistence-runtime.ts:207-218`). Each migration captures its generation, and both fulfillment and rejection consult `#accepts()` before publishing (`:271-304`). The guard is correct by inspection.

`studio-persistence-runtime.test.ts:377-414` exercises the reachable race. Generation 0 rejects; its `unavailable` notification synchronously calls `retry()` before the old promise finishes; generation 1 remains deferred and authoritative; awaiting generation 0 leaves the runtime at generation 1's `opening`; resolving generation 1 publishes the only terminal `ready` state. Exact observed states are `unavailable`, `opening`, and `ready`, and the migration runner is called exactly twice. Re-awaiting generation 0 cannot mutate either state identity or listener history.

## Reviewed evidence

- The constructor stores factories only. Repository construction, subscription, and migration start at `start()` or `retain()` (`studio-persistence-runtime.ts:161-168`, `:198-226`, `:250-299`).
- All migration union members are projected: empty, migrated warnings, collision, recovery, blocked, repository unavailable, legacy storage unavailable with recoverable bytes, schema invalid, too large, migration failed, verification failed, and a thrown runner (`:45-135`; table tests in `studio-persistence-runtime.test.ts:174-345`).
- `#installRepositorySubscription()` is idempotent and isolates every consumer event listener (`studio-persistence-runtime.ts:255-269`). The fanout test at line 377 proves one underlying subscription and peer isolation.
- Retain/release uses a monotonically invalidated microtask schedule (`studio-persistence-runtime.ts:220-233`, `:318-330`). The line-409 test proves an effect replay neither unsubscribes nor closes and does not repeat migration.
- Finalization invalidates migration generation, stops state and repository-event delivery, removes the underlying subscription, and closes only after all leases release (`studio-persistence-runtime.ts:333-348`). The line-437 test proves delayed one-time close; the line-466 test proves post-finalization migration suppression.
- `start()`, `retain()`, and `acquireLease()` reject terminal misuse. The repository getter is stable because `#ensureRepository()` memoizes the instance. No second repository owner or subscription is introduced by this file.
- State and repository-event listeners are independently wrapped so one exception cannot stop peer delivery (`studio-persistence-runtime.ts:260-266`, `:306-315`).

## Focused gates

Node 24 was forced through the bundled runtime.

```text
bun --filter @webmcp/studio test -- \
  src/features/persistence/studio-persistence-runtime.test.ts

1 file passed; 18 tests passed.

bun --filter @webmcp/studio typecheck
Passed.

bun --filter @webmcp/studio lint -- \
  src/features/persistence/studio-persistence-runtime.ts \
  src/features/persistence/studio-persistence-runtime.test.ts
Passed.

bun --filter @webmcp/studio test -- \
  src/features/persistence/studio-persistence-runtime.test.ts \
  -t "reentrant retry generation authoritative"

1 file passed; 1 test passed; 18 skipped.
```

The re-review did not reopen provider, adapter, route, or list scope. The persistence runtime and its retry-generation acceptance boundary are approved.
