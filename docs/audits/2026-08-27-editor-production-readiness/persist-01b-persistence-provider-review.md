# PERSIST-01B persistence provider independent review

Date: 2026-08-29
Scope: `studio-persistence-runtime.ts`, `studio-persistence-provider.tsx`, the provider StrictMode test, the runtime tests, and the ownership contract in `persist-01b-persistence-layout-route-plan.md`.

## Verdict

**APPROVE.** The final re-review found no remaining P0, P1, or P2 defects in this provider/runtime slice. The retained runtime, `useSyncExternalStore` bridge, StrictMode replay handling, migration ownership, repository event fanout, lease-delayed final close, and terminal repository capability all satisfy the reviewed contract.

## Resolved P1: terminal repository capability

The previous review rejected the slice because a stale captured context API could retrieve the repository after final close and use it to reopen IndexedDB without the runtime subscription or invalidation channel.

The repair is correct:

- `apps/studio/src/features/persistence/studio-persistence-runtime.ts:170-173` now rejects `runtime.repository` synchronously once `#closed` is true, before `#ensureRepository()` can create or return anything.
- The guard intentionally does not reject merely because `#finalizing` is true. An admitted child lease can therefore continue using the exact retained repository during its asynchronous cleanup window. The mounted test proves this after provider unmount and before final lease release at `studio-persistence-provider.strict-mode.test.tsx:164-176`.
- Releasing the last child lease sets `#closed` and closes the repository exactly once at `studio-persistence-runtime.ts:344-348`. The stale captured provider API then throws on both direct repository access and an attempted `repository.open()` expression at `studio-persistence-provider.strict-mode.test.tsx:178-187`.
- The test snapshots the IndexedDB open-call count before final close and proves it does not increase afterward. It also reasserts exactly one repository factory, BroadcastChannel factory, and migration call at `studio-persistence-provider.strict-mode.test.tsx:176-191`. The stale API cannot restart repository, database, channel, or migration work.
- The getter remains lazy. The new terminal check does not instantiate a repository, so discarded StrictMode runtime initializers remain inert.

## Verified behavior

- **Discarded runtime inertness:** the runtime constructor stores factories only. Repository creation, subscription, channel creation, and migration begin from the retained effect's `runtime.retain()`. The StrictMode test observes multiple runtime initializer calls but exactly one repository, one migration, and one channel.
- **External-store bridge:** `useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)` uses stable runtime methods and immutable snapshot replacement. Subscription is side-effect free with respect to repository construction, so discarded renders stay inert.
- **Retain cleanup:** effect cleanup releases the retained runtime. The runtime's scheduled generation guard cancels the development StrictMode cleanup/remount close and starts finalization only after the final retain disappears.
- **Single owner:** `#installRepositorySubscription()` is idempotent, migration is memoized per generation, and repository events fan out through one runtime subscription.
- **Final lease ordering:** finalization first rejects later delivery and removes the repository subscription, then waits for `#leaseCount` to reach zero before closing the repository exactly once.
- **Context boundary:** use outside the provider throws a clear error; the provider API exposes the planned repository, state, retry, event subscription, and lease operations without eagerly touching the repository in render.
- **Test rigor:** the mounted StrictMode test uses the real repository with fake IndexedDB, counts runtime/repository/migration/channel construction, counts active subscription and unsubscribe calls, proves no close during effect replay, and proves final close waits for a child lease. Runtime tests cover state mapping, retry generations, stale migration rejection, fanout isolation, replay cancellation, stopped delivery, and lease-delayed close.

## Final gates

From `apps/studio` with the explicit Node 24 runtime:

- Vitest: `studio-persistence-runtime.test.ts` plus `studio-persistence-provider.strict-mode.test.tsx`: **2 files, 20 tests passed**.
- TypeScript: `tsc --noEmit`: **passed**.

The provider test now exercises the stale captured-API boundary after final lease release, including the no-new-IndexedDB-work assertion.
