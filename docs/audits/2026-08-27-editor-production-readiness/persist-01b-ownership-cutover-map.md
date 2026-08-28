# PERSIST-01B persistence ownership cutover map

Date: 2026-08-29
Status: implementation map; product and test code were not changed

## Verdict

The runtime and provider are ready to become the sole persistence owner, but the
hook cutover is **blocked by two P1 contract gaps**. First, a runtime in
`recovery_required` has no supported transition to `ready` after the hook's
existing Retry or Reset action succeeds. `StudioPersistenceRuntime.retry()`
accepts only `blocked` and `unavailable`
(`studio-persistence-runtime.ts:208-219`), while the current recovery actions
create a durable record, remove legacy keys, clear local recovery state, and
install the record (`use-document-editor.ts:1429-1530`). If the hook merely
projects provider state, the provider remains permanently
`recovery_required` and can reassert stale recovery over the restored session.

Second, current workspace replacement closes the prior save controller without
a proven flush (`use-document-editor.ts:637,665-670`). A repository lease would
keep storage open, but would not prevent pending document bytes from being
discarded. The cutover needs one identity-safe asynchronous controller
retirement path.

Repair that transition first. Then land the route layout, product injection,
hook ownership removal, controller leases, generated route tree, and all
mounted-harness changes as one atomic cutover. There must be no commit in which
both the provider and `useDocumentEditor` migrate, subscribe, or close the same
repository.

## Current ownership ledger

### Calls that must leave `useDocumentEditor`

| Current owner and line             | Current operation                                                                                         | Required cutover                                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-document-editor.ts:143-150`   | Imports the concrete repository and migration runner                                                      | Remove the repository value import and migration import. Keep record/event types as type-only imports. Import `StudioPersistenceApi` as a type.                                                                                              |
| `use-document-editor.ts:340-349`   | Accepts `createDraftRepository`, then constructs a repository in lazy hook state                          | Replace the factory option with required `persistence: StudioPersistenceApi`; derive `draftRepository` from `persistence.repository`. Do not keep a fallback constructor for tests.                                                          |
| `use-document-editor.ts:451`       | Tracks a hook-owned repository-effect generation                                                          | Remove it. Runtime generation and provider retain/release own migration and StrictMode finalization. Keep hook request generations that guard document admission and imports.                                                                |
| `use-document-editor.ts:934-1117`  | Migrates legacy storage and maps every migration result                                                   | Remove the `migrateCurrentDraftToRepository` call and `openRepository`. Replace them with a narrow adapter over `persistence.state`.                                                                                                         |
| `use-document-editor.ts:1119-1169` | Subscribes directly to `draftRepository`                                                                  | Subscribe through `persistence.subscribeRepositoryEvents`. Preserve the current active-document foreign-event filters and treat other events only as list invalidations.                                                                     |
| `use-document-editor.ts:1172-1195` | Unsubscribes, runs a hook StrictMode microtask, flushes/closes the controller, then closes the repository | Remove the repository effect-generation guard and both `draftRepository.close()` calls at lines 1189 and 1192. Provider/runtime finalization is the only repository close. Hook cleanup must settle its controller lease as specified below. |

The direct repository calls at `use-document-editor.ts:684-705`, `738-810`,
`1459-1503`, and `2215-2258` remain temporarily. They are document operations,
not ownership operations, and must use the repository supplied by the provider.
The bounded 50-row Start projection at lines 940-985 also remains as a
transitional adapter until the real library controller replaces it.

### Owner that remains

`StudioPersistenceRuntime` is the only place that may:

- construct `DocumentDraftRepository` (`studio-persistence-runtime.ts:161-167,
251-254`);
- call `migrateCurrentDraftToRepository`
  (`studio-persistence-runtime.ts:272-300`);
- hold the underlying repository subscription
  (`studio-persistence-runtime.ts:256-270`); and
- call `repository.close()` (`studio-persistence-runtime.ts:334-349`).

`StudioPersistenceProvider` owns React retention and exposes the repository,
state, retry, event fanout, and lease API
(`studio-persistence-provider.tsx:17-25,35-68`). Its retained effect at line 48
is the only React lifecycle entry into the runtime.

## Exact product injection path

The product path is:

```text
routes/_studio/route.tsx
  StudioPersistenceProvider (ssr: false pathless layout)
    Outlet
      routes/_studio/index.tsx
        StudioShell
          useStudioPersistence()
          useDocumentEditor({ persistence, onHistoryCommit })
```

Implement it in these files:

1. Add `apps/studio/src/routes/_studio/route.tsx` with
   `createFileRoute("/_studio")`, `ssr: false`, and
   `<StudioPersistenceProvider><Outlet /></StudioPersistenceProvider>`.
2. Move `apps/studio/src/routes/index.tsx:1-14` to
   `routes/_studio/index.tsx`, declare `createFileRoute("/_studio/")`, and
   remove the child `ssr: false`; the pathless parent owns the client boundary.
3. At `studio-shell.tsx:344` call `useStudioPersistence()` once. Change the hook
   call at `studio-shell.tsx:498` to
   `useDocumentEditor({ persistence, onHistoryCommit })`.
4. Do not put the provider in `routes/__root.tsx:41-52`. API routes are root
   siblings and must never construct browser persistence.
5. Regenerate `apps/studio/src/routeTree.gen.ts`; never edit it manually. The
   generated tree must make `/_studio` pathless, keep `/` as the index full
   path, and leave every API route under the root.

The repository still lacks the direct, pinned route generator command specified
by `persist-01b-persistence-layout-route-plan.md:59-92`. Add
`@tanstack/router-cli` at the lockstep generator version, the
`routes:generate` script, and `tsr.config.json` in the same route-source change,
then run `bun --filter @webmcp/studio routes:generate`.

The hook API should require persistence. Optional injection or a default
repository constructor would preserve a second owner and allow tests to pass on
a path production no longer uses.

## Transitional provider-state adapter

The replacement for `use-document-editor.ts:934-1196` has two effects with
separate responsibilities:

1. A provider-state projection effect maps `opening`, `ready`,
   `recovery_required`, `blocked`, and `unavailable` to the existing
   `repositoryLifecycle`, `startModel`, `draftRecovery`, save-state refs, and
   warnings. On `ready`, it performs the existing `list({ limit: 50 })` and
   projects only the first current summary. Each list request needs a local
   cancellation/request generation so a late page cannot overwrite a newer
   provider state.
2. One consumer event effect calls
   `persistence.subscribeRepositoryEvents`. Preserve the active-record
   invalidation logic at `use-document-editor.ts:1121-1166`; non-active events
   trigger a new bounded list request. The effect cleanup only removes this
   consumer listener. It never touches the runtime's underlying subscription or
   repository lifetime.

Provider state is authoritative. The adapter may not maintain an independent
migration lifecycle that can disagree with it. Collision must remain `ready`
with the exact provider warning. `unavailable.recoverableEnvelope` must retain
the exact legacy envelope identity. Repository list recovery warnings remain
additive to the provider migration warning.

### Required P1 recovery transition

Add a guarded provider/runtime command before cutover, for example
`completeRecovery(warning: string | null): void`, with this contract:

- accepted only while the current state is `recovery_required`;
- called only after the existing durable recovery create succeeds;
- increments the runtime generation so no old asynchronous result can publish;
- publishes `{ status: "ready", migration: { status: "empty" }, warning }`;
- preserves a legacy-key cleanup warning rather than forcing migration to read
  the same corrupt key again; and
- is idempotent after the first accepted completion.

Both `retryDraftRecovery` and `resetDraftRecovery` must call it after the durable
record exists and legacy cleanup has been attempted, before installing the
record. A rejected create leaves provider state and recovery bytes unchanged.
An alternative API is acceptable only if it proves the same authoritative
state transition, including the cleanup-failure case.

## Controller lease and teardown contract

The controller is still hook-owned during this adapter slice. Replace the three
parallel refs at `use-document-editor.ts:442-446` with, or treat them as, one
identity-safe slot:

```ts
type ActivePersistenceSession = Readonly<{
  generation: number
  controller: DocumentDraftSaveController
  unsubscribe: () => void
  releaseLease: () => void
}>
```

### Install

At `use-document-editor.ts:599-648`:

1. validate record identity;
2. acquire a provider lease before constructing the new controller;
3. if construction or subscription fails, close the partial controller if it
   exists, then release that exact new lease;
4. install the controller, listener, and release function as one slot;
5. retire the prior slot by identity, never through mutable `current` refs; and
6. release the prior lease only after its unsubscribe, required flush, and
   controller close have completed.

Do not release a lease merely because a newer controller was assigned. The old
controller may still be draining a write.

### Replacement and Home

Every workspace-to-workspace replacement must durably settle the old controller
before the old lease is released. The current immediate closes at
`use-document-editor.ts:637` and `665-670` are not sufficient for the cutover.
Use one asynchronous retirement helper and route all replacement paths through
it, including Continue (`738-810`), imports (`3243-3261`), template creation
(`3916-3940`), blank creation (`4045-4076`), demo restoration (`4079-4096`), and
recovery (`1429-1530`). A failed flush must keep the old session and lease owned;
it must not install a second active session or silently discard pending bytes.

`returnToStart` already flushes first (`909-932`). After a successful flush, it
must unsubscribe, close that exact controller, release its exact lease, clear
the slot, and only then project Start. A failed flush leaves the session and
lease intact.

### Unmount and browser lifecycle

On real hook unmount, detach the controller listener, capture the exact slot,
and asynchronously execute:

```text
capture settled canonical draft
  -> controller.flush()
  -> controller.close()
  -> release that controller's lease
```

Release must run in `finally`, but only after `flush()` has settled and
`close()` has run. The provider may begin finalization first; its lease count
must keep the repository open until this sequence finishes. Hook cleanup never
calls `repository.close()`.

The existing `beforeunload` and `pagehide` capture/flush behavior at
`use-document-editor.ts:1308-1327` stays. It does not release the lease because
the mounted session still owns the controller.

This mirrors the useful ownership lesson in Loora's
`packages/editor/src/lib/canvas-client.ts`: one controller owns pending writes
and listeners (`368-445`), writes remain ordered (`1245-1271`), and close waits
for flush and pending persistence before marking the controller closed and
removing listeners (`699-754`). Studio should keep its own snapshot/CAS model;
no Loora transaction or transport code is copied.

## Mounted harness and test migration

Product-shaped mounted tests should use this composition:

```text
StudioPersistenceProvider(createRuntime fixture)
  TestConsumer
    useStudioPersistence()
    useDocumentEditor({ persistence, ...test options })
```

This ensures the runtime is retained before controllers can lease it. Do not
call a raw runtime repository from a hook fixture without retaining the runtime.

| Test owner                                                            | Current seam                                | Required change and retained proof                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-document-editor.persistence.mounted.test.tsx:350-410`            | Injects `createDraftRepository` directly    | Make `mount` build a runtime around the supplied repository and wrap the consumer in the provider. Preserve every existing identity, import race, Home flush, conflict, publication, blocked/unavailable, and recovery assertion. Add provider-state projection cases and controller lease release ordering.                 |
| `use-document-editor.strict-mode.persistence.mounted.test.tsx:34-184` | Treats the hook as repository/channel owner | Remove the obsolete hook construction/close assertion. Rewrite the suite to prove one active controller lease survives provider unmount until a deferred controller flush settles, then closes/releases exactly once. Runtime/provider channel ownership stays in `studio-persistence-provider.strict-mode.test.tsx:72-192`. |
| `studio-persistence-provider.strict-mode.test.tsx:36-192`             | Provider lifecycle authority                | Keep as the authority for discarded inert runtimes, one retained repository/migration/subscription/channel, lease-delayed close, terminal getter rejection, and exact final close. Extend only for the recovery-completion API and an active child lease if not covered by the rewritten hook suite.                         |
| `use-document-editor.start.mounted.test.tsx:23-68`                    | Calls the hook with its old default owner   | Wrap it with a deterministic runtime/provider. Preserve neutral first run, exact recoverable legacy envelope, blocked/unavailable wording, and no private-bootstrap persistence.                                                                                                                                             |
| `use-document-editor.history-commit.mounted.test.tsx:13-23`           | Calls the hook without persistence          | Use the shared provider consumer while preserving synchronous history callback timing.                                                                                                                                                                                                                                       |
| `use-document-editor.image-crop.mounted.test.ts:143-150`              | Calls the hook without persistence          | Wrap/inject retained persistence; keep crop render-count and session identity assertions independent of repository timing.                                                                                                                                                                                                   |
| `image-heavy-responsiveness.mounted.test.ts:94-103`                   | Calls the hook without persistence          | Wrap/inject retained persistence; do not let adapter state updates invalidate its render-count budget.                                                                                                                                                                                                                       |
| `use-studio-webmcp.image-crop.mounted.test.tsx:97-106`                | Calls the hook without persistence          | Wrap/inject retained persistence so WebMCP exercises the same product hook path. Preserve command and crop identity assertions.                                                                                                                                                                                              |

Add a small test-only persistence wrapper rather than seven slightly different
runtime bootstraps. It must accept a repository factory and migration runner,
expose no product fallback, wait explicitly for the desired provider state, and
always unmount/release. Persistence-specific tests may retain their own
repository inspectors; those are test peers, not product owners.

Add route-source/generated-tree coverage for the pathless layout. There is no
current `StudioShell` mount suite, so Studio typecheck plus one minimal route
composition test must prove `StudioShell` cannot render outside the provider and
the API route tree remains provider-free.

## Safest atomic file boundary

One cutover change must include all of the following:

- `studio-persistence-runtime.ts`, its tests, and
  `studio-persistence-provider.tsx` for the recovery-completion contract;
- new `routes/_studio/route.tsx`, moved `routes/_studio/index.tsx`, removal of
  old `routes/index.tsx`, route CLI/config/package lock changes, and regenerated
  `routeTree.gen.ts`;
- `studio-shell.tsx` for context acquisition and hook injection;
- `use-document-editor.ts` for constructor/migration/subscription/close removal,
  provider-state adapter, and controller lease teardown;
- the seven mounted hook consumers listed above;
- provider/runtime/adapter/route tests.

Do not combine this boundary with `/documents/$documentId`, real-recents UI,
rename/delete/restore, navigation blockers, or route admission. Those require
the later library and route coordinator. Do not split the route/provider
mounting from hook owner removal: either split leaves the application with no
owner or two owners.

## Risks and blockers

- **P1, blocking:** recovery has no authoritative provider transition after a
  successful Retry/Reset. Fix and test before ownership cutover.
- **P1, blocking:** current controller replacement closes the previous
  controller synchronously without a proven flush (`use-document-editor.ts:637,
665-670`). A lease added around that code would only delay repository close;
  it would not make replacement durable. Centralize async retirement.
- **P1:** a retained-provider cleanup may race a child cleanup. Releasing the
  controller lease before its flush settles permits repository close under an
  active write. Test with a deterministic deferred flush.
- **P1:** keeping `createDraftRepository` as a fallback creates a hidden second
  product owner and lets mounted tests validate the wrong topology.
- **P2:** late `list({ limit: 50 })` completions can overwrite blocked,
  unavailable, recovery, or a newer event projection unless separately
  generation-guarded.
- **P2:** the adapter can create duplicate repository-event consumers under
  dependency churn. Its subscription dependency must be the stable provider API
  method, and tests must assert one consumer subscription per retained mount.
- **P2:** adding the provider to `__root.tsx` would construct client storage for
  API routes and violate the SSR boundary.
- **P2:** non-persistence mounted suites can accidentally absorb asynchronous
  adapter renders and weaken performance counts. Make readiness explicit rather
  than adding arbitrary waits.

## Acceptance gates

Approval requires all of these observable facts:

1. Production search finds no `new DocumentDraftRepository`,
   `migrateCurrentDraftToRepository`, direct `draftRepository.subscribe`, or
   `draftRepository.close` outside the runtime/repository implementation and
   deliberate test fixtures.
2. `useDocumentEditor` has a required provider API and no repository factory
   fallback.
3. StrictMode creates at most one retained repository, runs one migration per
   generation, owns one underlying repository subscription/channel, and closes
   once after the final controller lease.
4. Recovery Retry and Reset move the authoritative provider state to `ready`;
   failed recovery leaves state and bytes unchanged; cleanup failure remains a
   visible warning.
5. Empty, migrated, collision, blocked, unavailable, recovery, and returning
   draft projections preserve exact current identity and warning behavior.
6. Home, unmount, session-only fallback, and every workspace replacement prove
   `flush -> close -> release lease` for the exact controller. A failed flush
   does not release or replace it.
7. Foreign active-document events retain the current reason/session/CAS filters;
   other events invalidate the bounded Start list through provider fanout.
8. Generated routing shows one client-only pathless provider parent for `/`, no
   provider under API routes, and no hand edits to `routeTree.gen.ts`.
9. All seven mounted hook consumers exercise the provider topology. The
   provider StrictMode suite remains the repository-lifecycle authority.
10. Focused Node 24 Vitest gates, Studio typecheck, focused ESLint, Prettier
    check, and `git diff --check` pass. On the restricted host, do not start
    Vite, Workerd, Wrangler, Playwright, a browser, or a build.

Until the two P1 blockers are repaired and these gates pass, the ownership
cutover is not approved for implementation merge.
