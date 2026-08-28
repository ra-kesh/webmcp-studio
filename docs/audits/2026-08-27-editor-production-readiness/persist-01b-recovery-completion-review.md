# PERSIST-01B recovery-completion primitive review

Date: 2026-08-29
Scope: `StudioPersistenceRuntime.completeRecovery`, provider exposure, and focused tests
Verdict: **APPROVE**

## Final finding status

No P0, P1, or P2 finding remains in this bounded primitive.

The prior P1 is closed. `completeRecovery()` now increments the generation and
installs `Promise.resolve()` as the completed-generation migration memo before
publishing the authoritative ready state
(`studio-persistence-runtime.ts:221-234`). Later `start()` and `retain()` calls
reach `#startMigrationForGeneration()`, receive that same completed sentinel,
and cannot invoke migration again (`studio-persistence-runtime.ts:237-250,
288-316`).

The repair preserves the exact supplied warning and the exact completed state
object. It does not create another repository, underlying subscription, or
channel. It does not interfere with `retry()`, which still clears the memo only
for `blocked` or `unavailable` and starts a new guarded generation
(`studio-persistence-runtime.ts:208-219`).

## Contract review

| Requirement                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                           | Result |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Recovery-only transition                 | `completeRecovery()` rejects finalizing, closed, and every state except `recovery_required` at `studio-persistence-runtime.ts:221-227`. Opening, ready, blocked, and unavailable preserve state identity and do no work in `studio-persistence-runtime.test.ts:438-477`.                                                                                                                                                           | Pass   |
| Generation invalidation                  | Generation increments before authoritative publication at line 228. The reentrant migration-notification test proves recovery completion supersedes the old generation at `studio-persistence-runtime.test.ts:479-510`.                                                                                                                                                                                                            | Pass   |
| Completed-generation memo                | Line 229 installs a resolved sentinel. The repaired regression calls `start()`, adds a retain, and calls `start()` again after completion while its migration mock continues to return recovery; migration remains one call at `studio-persistence-runtime.test.ts:379-417`.                                                                                                                                                       | Pass   |
| Exact warning and state                  | Non-null cleanup warning is preserved at `studio-persistence-runtime.test.ts:392-406`; null is preserved at lines 419-436. The post-start/retain state is the same object, not merely equal, at line 406.                                                                                                                                                                                                                          | Pass   |
| Idempotency                              | Later start, additional retain, and repeated `completeRecovery()` leave the exact state and listener count unchanged at `studio-persistence-runtime.test.ts:403-416`.                                                                                                                                                                                                                                                              | Pass   |
| Wrong-state no-op                        | Opening, ready, blocked, and unavailable preserve exact state with no migration or subscription at `studio-persistence-runtime.test.ts:438-477`.                                                                                                                                                                                                                                                                                   | Pass   |
| Terminal no-op                           | Source guards both finalizing and closed. The closed-state test proves unchanged state and no new repository, migration, or subscription at `studio-persistence-runtime.test.ts:512-538`.                                                                                                                                                                                                                                          | Pass   |
| Singular repository/subscription/channel | `#ensureRepository()` memoizes one repository at `studio-persistence-runtime.ts:267-270`; `#installRepositorySubscription()` admits one underlying subscription at lines 272-286. The repaired completion regression keeps migration and subscription at one call. Provider StrictMode coverage proves one repository, one lazy channel, and one underlying listener at `studio-persistence-provider.strict-mode.test.tsx:72-192`. | Pass   |
| Exact close                              | Finalization closes only after retain/lease release at `studio-persistence-runtime.ts:335-365`. Multiple-retain exact close is covered at `studio-persistence-runtime.test.ts:611-637`; provider StrictMode proves one final repository/channel close at `studio-persistence-provider.strict-mode.test.tsx:164-191`. The completed sentinel changes no retain or close counters.                                                   | Pass   |
| Provider exposure                        | `StudioPersistenceApi` exposes the exact method and delegates to the runtime at `studio-persistence-provider.tsx:17-26,51-64`. Mounted context coverage proves authoritative projection and repeated-call idempotency at `studio-persistence-provider.strict-mode.test.tsx:194-261`.                                                                                                                                               | Pass   |

The runtime completion regression does not independently spy repository
construction or perform final close inside that one test. This is not a gap in
the bounded proof: repository construction is structurally memoized, and the
same focused runtime suite separately proves construction, multiple-retain
subscription ownership, and exact final close. The provider StrictMode suite
also proves the corresponding real repository and lazy channel lifecycle.

## Verification run

The gates ran with the Codex workspace Node 24.19.0 runtime.

Focused tests:

```text
cd apps/studio
PATH="/Users/rakesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ../../node_modules/.bin/vitest run --config vitest.config.ts \
  src/features/persistence/studio-persistence-runtime.test.ts \
  src/features/persistence/studio-persistence-provider.strict-mode.test.tsx

2 files passed; 26 tests passed
```

Studio typecheck:

```text
cd apps/studio
PATH="/Users/rakesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ../../node_modules/.bin/tsc --noEmit

passed
```

The recovery-completion primitive is approved for the persistence ownership
cutover. This verdict does not approve the separate controller-retirement P1
identified in `persist-01b-ownership-cutover-map.md`.
