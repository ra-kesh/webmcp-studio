# PERSIST-01B Recent provider implementation

Date: 2026-08-29

## What changed

`RecentDocumentsProvider` now sits below `StudioPersistenceProvider` in the
client-only `/_studio` route and above the route outlet. It retains one Recent
and Trash controller while Studio routes change.

The provider constructs the controller with deferred closures. Rendering does
not access the persistence repository, subscribe to repository events, or run a
list request. The controller reads through `useSyncExternalStore`, and the
context projects an exhaustive persistence union. Only the `ready` branch
exposes the retained library snapshot.

`useRecentDocumentsVisibility()` is the single Start/editor lifecycle input.
It is meant to run unconditionally in the retained Studio shell. It activates
only when the caller says the library is visible and persistence is ready.
Other persistence states and editor visibility deactivate the controller while
keeping its confirmed pages and fanout listener.

The provider acquires one child persistence lease after readiness. StrictMode
cleanup uses a generation check and a scheduled microtask. A replay cleanup is
ignored. A real unmount disposes the controller first, then releases the child
lease. `RecentDocumentsTestWrapper` exposes the controller factory,
finalization scheduler, and library visibility for later mounted feature tests.

The private visibility channel records a visibility request before readiness,
but it cannot activate the controller until the provider holds the child lease.
This remains correct when React runs a child's passive effect before its parent
effect. The mounted test records the required order: lease acquisition, fanout
subscription, then list request.

The public context keeps the library command vocabulary intact, including
exact-ID announcement and focus acknowledgement. Activation and deactivation
stay in a private context channel used only by
`useRecentDocumentsVisibility()`. An ordinary library consumer cannot bypass
the persistence-readiness and Start-visibility gates. The public context also
does not expose repository close or direct subscription ownership.

## Verification

- Focused mounted and route tests: 2 files, 8 tests passed.
- Studio TypeScript check passed.
- Scoped ESLint passed.
- Prettier passed for every changed TypeScript file.

The mounted tests cover opening, recovery-required, blocked, unavailable, and
ready precedence; inert discarded StrictMode factories; one retained fanout
consumer and child lease; editor deactivation and stale Start refresh; exact-ID
acknowledgement forwarding; and controller-dispose before lease-release against
a real `StudioPersistenceRuntime`, `DocumentDraftRepository`, and fake
IndexedDB.

## Deliberate boundary

This change does not connect `StudioShell`, replace the old Start card, or
extract `openStoredDocument(documentId)`. Those changes belong to the following
integration pass, after the independently reviewed controller contract is
stable.
