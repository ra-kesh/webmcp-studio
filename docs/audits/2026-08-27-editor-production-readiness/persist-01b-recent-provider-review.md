# PERSIST-01B Recent provider code review

Date: 2026-08-29
Reviewer: independent provider review
Verdict: APPROVE

## Scope

I read the full provider integration map and the current implementation and
tests for:

- `apps/studio/src/features/editor/recent-documents-provider.tsx`
- `apps/studio/src/features/editor/recent-documents-provider.strict-mode.test.tsx`
- `apps/studio/src/features/editor/recent-documents-test-wrapper.tsx`
- `apps/studio/src/routes/_studio/route.tsx`
- `apps/studio/src/routes/studio-persistence-layout.test.ts`
- `apps/studio/src/features/persistence/studio-persistence-provider.tsx`
- `apps/studio/src/features/persistence/studio-persistence-runtime.ts`
- the controller's subscription, activation, deactivation, action, and disposal
  paths

The route nesting is currently correct. Controller construction does not touch
the repository, install the provider fanout subscription, schedule a query, or
write the view preference. `useSyncExternalStore` receives stable controller
methods. The context command object remains stable across persistence state
changes. Provider state gives opening, recovery, blocked, and unavailable
precedence over the retained library state. Terminal finalization disposes the
controller before releasing the child lease, and the real-runtime test proves
that the lease prevents an early repository close.

The production shell visibility call and Start UI cutover are later steps in the
recorded implementation order, so their current absence is not treated as a
defect in this provider-only gate.

## Findings and remediation

### Resolved P2: public commands could bypass provider-owned activation

`RecentDocumentsCommands` includes `activate` and `deactivate`, and
`createCommands()` publishes both through `RecentDocumentsApi` at
`recent-documents-provider.tsx:75-101` and `:132-160`.

This makes a product consumer able to call `commands.activate()` while
persistence is opening, recovery-required, blocked, or unavailable, or while an
editor route has hidden the Start library. `RecentDocumentsController.activate()`
immediately installs the fanout listener and may call `list()`. The provider's
readiness and visibility gate is therefore a convention rather than an
ownership boundary. The existing non-ready tests only prove that
`useRecentDocumentsVisibility()` does not call Activate automatically; they do
not prove that the public API cannot bypass it.

Keep lifecycle commands internal to the provider/visibility hook. The product
`commands` object should start at collection/query/view commands. Add a mounted
assertion that the public command object has no activation controls and that a
non-ready provider cannot activate through any exported consumer API.

Remediation verified: `RecentDocumentsCommands` no longer contains lifecycle
methods. `setVisible()` now lives in a module-private context value used only by
`useRecentDocumentsVisibility()`. Both compile-time and mounted assertions prove
that the consumer API has no `activate` or `deactivate` property. Non-ready
states still perform no activation, list, or lease acquisition.

### Resolved P2: Start activation began before the child lease was acquired

The child lease is acquired in a provider passive effect at
`recent-documents-provider.tsx:258-266`. The visibility hook activates the
controller in a passive effect at `:303-311`. React runs passive mount effects
child-first. `StudioShell` is a child of the provider, so its visibility effect
runs first. The resulting order on the ready commit is:

1. `controller.activate()`;
2. provider fanout subscription and possible repository `list()`;
3. `persistence.acquireLease()`.

The normal effect flush makes this gap short, but it is the reverse of the
ownership guarantee the lease is meant to establish. If lease acquisition
throws or the subtree is synchronously torn down during activation, repository
work has already started without the child lease that prevents parent
finalization. The mounted suite counts one activation and one lease but never
asserts their order.

Acquire the lease before child passive activation, for example in a provider
layout effect after persistence becomes ready, or hold activation behind an
explicit retained/leased state. Add an ordered event assertion requiring
`lease.acquire` before fanout subscription and `list`, while retaining the
existing `controller.dispose` before `lease.release` assertion.

Remediation verified: the internal visibility command records desired
visibility but cannot activate until both the ready-state ref and the retained
lease are present. If the child passive effect runs first, the provider lease
effect acquires the lease and then honors the recorded visibility. If the lease
effect runs first, the later visibility command sees the lease. The mounted
event trace now proves the exact order `lease.acquire`, `fanout.subscribe`,
`list`. Terminal cleanup still proves `controller.dispose` before
`lease.release`, and the real runtime does not close its repository before the
release.

### Resolved P2: the route ownership test did not prove provider nesting

`studio-persistence-layout.test.ts:12-23` checks only that several strings occur
in the route source. It would still pass if `RecentDocumentsProvider` and
`StudioPersistenceProvider` were reversed or rendered as siblings. Either
change would break the required ownership boundary, and reversed nesting would
make `useStudioPersistence()` throw at runtime.

The current route source is correctly nested. Strengthen the regression test to
mount the layout with a stub outlet or, at minimum, assert the complete ordered
nesting expression rather than independent token presence.

Remediation verified: the route test now matches the complete ordered wrapper
expression from `StudioPersistenceProvider` through `RecentDocumentsProvider`
and `Outlet` to both closing tags. Reversed or sibling ownership no longer
passes this gate.

## Re-review result

The repaired implementation has no unresolved P0, P1, or P2 findings in this
review scope. The provider remains inert through render, survives StrictMode
replay with one retained controller, keeps one child lease and one fanout
consumer, deactivates without unsubscribing, projects persistence precedence,
and finalizes in controller-dispose then lease-release order.

Current checks:

```text
bun --filter @webmcp/studio test --run \
  src/features/editor/recent-documents-provider.strict-mode.test.tsx \
  src/routes/studio-persistence-layout.test.ts

2 files passed, 8 tests passed

bun --filter @webmcp/studio typecheck

passed

scoped ESLint

passed

scoped Prettier check

passed

git diff --check

passed
```
