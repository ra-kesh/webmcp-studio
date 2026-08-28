# PERSIST-01B exact stored-document open independent review

Date: 2026-08-29
Scope: `openStoredDocument(documentId)`, its shared transition and persistence
session machinery, repository `get` and `touchOpened` contracts, the
transitional Continue adapter, and mounted regression coverage

## Verdict

**APPROVE.** There are zero open P0, P1, or P2 findings in the reviewed scope.

The final implementation opens only the requested durable ID, preserves the
existing first-accepted transition owner, and never substitutes the private
bootstrap for a failed open. Missing, corrupt, deleted, identity-mismatched,
and activity-touch failure paths retain truthful workspace and error state.

## Contract reviewed

The review read the full Recent provider integration map, persistence ownership
cutover map and independent review, exact-open implementation note, current
transition and controller-retirement code, repository read and touch
implementations, and the mounted exact-open tests.

The implementation follows the required sequence:

1. claim the shared `continue` transition synchronously;
2. read the exact requested ID;
3. reject missing, corrupt, deleted, or inconsistent records;
4. touch activity for the same ID;
5. install the verified touched record, or the verified read only when the
   activity update fails with `storage_unavailable`;
6. clear the exact opening identity and release the same transition in
   `finally`.

`continueCurrentDraft` delegates its durable branch to this command. The
separately named `continueSessionEnvelope` remains restricted to blocked or
unavailable session-only recovery, so durable and in-memory continuation are
not conflated.

## Ownership and race audit

The command rechecks transition ownership, the exact opening object,
repository readiness, and provider readiness after every await. The same
predicate is passed into prior-session retirement and is checked after the
old controller settles, before it is closed, and again before the new session
is installed. Home, replacement, recovery, and unmount therefore cannot take
ownership after an exact open has already claimed it, while unmount and
readiness loss prevent a deferred open from installing.

Opening-ID repository events are reconciled instead of broadly suppressed.
The command's synchronous local `saved/opened` event is the authoritative
post-touch barrier. Before that barrier, stale hints are discarded because
the touch result is newer verified evidence. After it, quarantine is sticky;
otherwise the highest record version wins and later arrival breaks equal
versions. Content saves, deletes, and restores can never leave the installed
record falsely clean. Foreign open and publication-link metadata refresh list
state without creating a document conflict. A material event also outranks the
weaker verified-byte activity warning.

The selector reconciles delayed lower-version delete and restore events against
the touched head. Equal-version saved events are covered only when both content
and draft snapshot identities match the verified record. This avoids both
false conflicts from stale hints and stale clean installs from contradictory
heads.

## Findings closed during review

- **P1, closed:** the first implementation suppressed every event for the
  opening ID. Foreign content save, delete, restore, and quarantine events now
  accumulate behind the local touch barrier and are reconciled before or after
  installation.
- **P2, closed:** initial missing or corrupt reads could leave a matching
  transitional Continue card visible. Exact-ID cleanup now clears only that
  matching card; a newer unrelated card is preserved. Deleted and terminal
  touch failures follow the same identity-safe cleanup rule.
- **P2, closed:** the original negative proof began and ended on the private
  bootstrap and could not detect substitution. The final suite proves the
  behavior from both a neutral Start state and a real active workspace,
  including unchanged history, source context, save state, controller, lease,
  and durable bytes.
- **P2, closed:** a single mutable invalidation slot could let a delayed lower
  version overwrite a newer event. Ordered accumulation, sticky quarantine,
  and highest-version selection now make the result deterministic.
- **P2, closed:** readiness loss and invalidation could arrive while the prior
  controller was settling. The install predicate now reaches into retirement,
  and mounted coverage proves repository admission loss prevents lease
  acquisition and installation.
- **P2, closed:** the verified-byte touch warning could overwrite a stronger
  external-change error. Material repository state now wins.
- **P2, closed:** one newly added negative case initially failed scoped lint.
  The unnecessary assertion was removed and the final lint gate is clean.

## Mounted evidence

The final persistence-mounted suite proves exact selection among multiple
records; missing, deleted, corrupt, and identity-safe cleanup paths; active
workspace preservation; touch fallback; readiness loss; first-accepted Home
and replacement behavior; local touch barriers; stale and out-of-order event
handling; save, delete, restore, and quarantine races during controller
retirement; metadata-only events; and stronger-error precedence.

The pre-existing mounted suites continue to prove transitional Continue,
session-only continuation, Home, replacement, recovery, unmount, StrictMode,
and lease drain behavior through the extracted command and shared ownership
machinery.

## Independent verification

All commands used Node 24.19.0.

- Persistence mounted gate: **1 file, 67 tests passed**.
- Start and StrictMode mounted gate: **2 files, 12 tests passed**.
- Studio typecheck: **passed**.
- Scoped ESLint for the hook and mounted persistence test: **passed with zero
  errors or warnings**.
- Prettier check for the hook, mounted test, implementation note, and this
  review: **passed**.
- Scoped `git diff --check`: **passed**.

No Vite, browser, Playwright, Workerd, Wrangler, build, or deployment command
was started during this review.
