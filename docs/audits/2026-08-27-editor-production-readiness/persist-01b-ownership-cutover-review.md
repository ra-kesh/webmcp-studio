# PERSIST-01B persistence ownership cutover independent review

Date: 2026-08-29
Scope: persistence runtime/provider, the `useDocumentEditor` ownership adapter,
session transitions and controller retirement, `StudioShell` injection, the
pathless Studio route, generated route tree, migrated mounted harnesses, and the
shared test wrapper

## Verdict

**APPROVE.** The repaired cutover has no remaining P0, P1, or P2 finding in the
reviewed scope.

The former P1 Home/replacement race is resolved in the hook-level application
boundary. Continue, replacement, recovery, and Home now share one synchronously
claimed transition owner. The first accepted transition remains authoritative
until its final continuation and releases its exact token in `finally`.

The wider ownership cutover also remains sound: production has one repository
factory, migration owner, underlying repository subscription, and final close
owner. Provider-state projection, stale-list rejection, recovery completion,
StrictMode retention, route/API separation, and controller lease ordering match
the reviewed contract.

## Resolved P1: one first-accepted session-transition owner

### Code evidence

- `apps/studio/src/features/editor/use-document-editor.ts:479-489` holds one
  monotonic transition sequence, one active transition token, and identity-keyed
  settlement and retirement promises.
- `use-document-editor.ts:753-782` claims synchronously before any await, rejects
  a second owner, validates the exact token plus mounted state, and allows only
  that token to release itself.
- Replacement claims at `use-document-editor.ts:877-880`, Continue at
  `:991-1008`, Home at `:1124-1138`, and both recovery paths at `:1603-1607` and
  `:1681-1684`. Session-only Continue delegates to the same replacement owner at
  `:998-1002`; there is no parallel admission path.
- Continue revalidates after `get`, `touchOpened`, and `installDraftRecord` at
  `use-document-editor.ts:1010-1029`. Replacement revalidates after settlement,
  `create`, quotation reset-save, and installation at `:913-972`. Recovery
  revalidates after durable create and installation at `:1636-1668` and
  `:1697-1729`.
- `installDraftRecord` validates the token before preparation, binds controller,
  listener, generation, and lease into one candidate slot, awaits retirement of
  the exact previous slot, and closes/releases a stale candidate without
  installing it at `use-document-editor.ts:784-865`.
- Exact-session settlement is memoized at `use-document-editor.ts:681-713`.
  Exact-session retirement is memoized at `:716-750`; failure retains the old
  slot, while success performs unsubscribe, close, release, and monotonic
  generation advance before a successor can install.
- Home uses that same retirement helper and publishes Start only after successful
  retirement and token revalidation at `use-document-editor.ts:1124-1158`.

### Deterministic regression evidence

`apps/studio/src/features/editor/use-document-editor.persistence.mounted.test.tsx`
now proves the four formerly missing races:

- delayed replacement create wins over later Home at `:1233-1280`;
- delayed Home teardown rejects replacement and performs one flush, close, and
  lease release at `:1282-1352`;
- a failed overlapping flush retains the exact old document, controller, and
  lease and performs no create at `:1354-1430`; and
- two same-tick replacements admit only the first and create only its record at
  `:1432-1491`.

### Unmount overlap classification

Unmount is not a second session-transition owner. Cleanup invalidates the token,
clears the exact active slot, unsubscribes, then drains that captured controller
before close and lease release at `use-document-editor.ts:1326-1369`. An
in-flight transition therefore fails its mounted/exact-slot checks and cannot
install or retire a successor.

Cleanup can call `controller.flush()` while a transition settlement is already
awaiting that controller. This is safe and is not a finding: the controller's
`#writeQueued` and `#ordered` chain coalesce both callers onto the same durable
write. Clearing the active slot makes the transition settlement return false,
so cleanup alone closes and releases the exact session. There is no duplicate
repository save, early lease release, stale install, or generation rollback.

## Other verified implementation facts

The following passed code review:

- `StudioPersistenceRuntime` is the sole production owner of repository
  construction, legacy migration, the underlying repository subscription, and
  final repository close (`studio-persistence-runtime.ts:137-167,267-365`).
- Runtime leases are identity-safe and delay final repository close until child
  cleanup releases the last lease (`studio-persistence-runtime.ts:253-264,350-365`).
- `useDocumentEditor` requires `StudioPersistenceApi`. It has no repository
  constructor, migration fallback, or repository close path.
- Provider state is authoritative. Opening, ready, recovery, blocked, and
  unavailable are projected without a second migration lifecycle at
  `use-document-editor.ts:1214-1267`.
- Ready-list completion verifies mounted state, request generation, and current
  provider readiness before publishing at `use-document-editor.ts:1160-1171`.
- The hook installs one stable provider-fanout consumer at
  `use-document-editor.ts:1269-1324`. Active-document events retain session,
  reason, record-version, and snapshot checks.
- Recovery Retry and Reset call the runtime's guarded `completeRecovery` only
  after durable create and legacy-key cleanup attempt. Failed create retains
  recovery state and source bytes; cleanup failure remains visible
  (`studio-persistence-runtime.ts:221-235` and
  `use-document-editor.ts:1603-1739`).
- The sticky repository recovery warning is intentional. The approved
  corruption-list review requires a later empty page not to erase an already
  reported quarantine/recovery outcome.
- `/_studio` is a client-only pathless owner for the UI. API routes remain root
  siblings; the generated-tree structural assertion checks both facts
  (`routes/_studio/route.tsx:1-18` and
  `routes/studio-persistence-layout.test.ts:13-31`).
- `StudioShell` receives persistence through context. All migrated mounted hook
  consumers use the shared provider/runtime wrapper; the wrapper is test-only
  and does not create a product fallback.

## Verification

Using Node 24.19.0 on the restricted host:

- Coordinating focused ownership gate: **10 files, 95 tests passed**.
- Independent repaired race suite: **45/45 passed**.
- Independent StrictMode controller lease suite: **1/1 passed**.
- Canonical Studio TypeScript check: **passed** independently and in the
  coordinating run.
- Full Studio ESLint: **passed** independently.
- Focused Prettier check across runtime/provider, hook, repaired mounted suites,
  wrapper, shell, route, and configs: **passed**. The generated route tree is
  intentionally covered by `.prettierignore` and by the structural route test.
- Tracked ownership-cutover `git diff --check`: **passed**.
- The coordinating concurrent Studio run recorded **99 files and 712 tests
  passed**, with six opening/debounce wait timeouts under host contention. Every
  affected file then passed serially: StrictMode **1/1**, persistence **45/45**,
  image-heavy **2/2**, image-crop **6/6**, and filmstrip **29/29**.

No Vite, build, browser, Playwright, Workerd, Wrangler, or deployment command was
started during this review.
