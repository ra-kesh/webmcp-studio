# PERSIST-01B Recent provider integration map

Date: 2026-08-29
Status: compatibility contract for the React/provider cutover

## Decision

`RecentDocumentsProvider` belongs immediately below
`StudioPersistenceProvider` in `routes/_studio/route.tsx` and above the route
`Outlet`. It owns one retained Recent/Trash controller for the whole Studio UI
route lifetime. The controller stays mounted while the user moves between the
Start screen and an editor route, but it fetches only while the document library
is actually visible.

The nesting is:

```tsx
<StudioPersistenceProvider>
  <RecentDocumentsProvider>
    <Outlet />
  </RecentDocumentsProvider>
</StudioPersistenceProvider>
```

API routes remain outside `/_studio`. They must never construct this provider,
IndexedDB, BroadcastChannel, or localStorage state.

## Construction boundary

Controller construction must be inert. In particular, rendering the provider
must not evaluate `persistence.repository`, call a repository method, install a
fanout listener, schedule a query, or write the view preference. React may
evaluate a lazy state initializer more than once in development StrictMode. A
discarded controller is acceptable only because it owns no resources.

Use a current persistence ref and deferred dependency closures:

```ts
const persistenceRef = useRef(persistence)
persistenceRef.current = persistence

const [controller] = useState(() =>
  createRecentDocumentsController({
    list: (options) => persistenceRef.current.repository.list(options),
    rename: (...args) => persistenceRef.current.repository.rename(...args),
    duplicate: (...args) =>
      persistenceRef.current.repository.duplicate(...args),
    softDelete: (...args) =>
      persistenceRef.current.repository.softDelete(...args),
    restore: (...args) => persistenceRef.current.repository.restore(...args),
    getForDownload: (documentId) =>
      persistenceRef.current.repository.get(documentId),
    subscribe: (listener) =>
      persistenceRef.current.subscribeRepositoryEvents(listener),
    // browser preference and query scheduler adapters
  })
)
```

Do not make the controller depend on the `StudioPersistenceApi` object itself.
That context value changes whenever persistence state changes. Recreating the
controller from that identity would discard pages, duplicate subscriptions, and
make late request guards meaningless.

The provider reads the controller with `useSyncExternalStore`. `subscribe` and
`getSnapshot` must be stable callbacks, or the provider must wrap them in stable
closures. A snapshot object changes only when the controller publishes a real
state transition.

## Lifecycle contract

The controller has three distinct lifecycle operations:

- `activate()` marks the Start library active, installs the one fanout
  subscription on first activation, and loads the selected collection when it
  is idle or stale.
- `deactivate()` cancels the pending query scheduler and focus ownership. It
  keeps confirmed pages, recovery inventory, operation results, and the fanout
  subscription. Repository events can therefore mark cached pages stale while
  the editor is open without causing background list calls.
- `dispose()` is terminal and idempotent. It removes the fanout listener,
  cancels scheduled work, invalidates request/action generations, clears view
  subscribers, and prevents later completions from publishing.

Start visibility is not the same thing as `editor.sessionMode === "start"`.
The library is visible only when both conditions hold:

```ts
editor.sessionMode === "start" && persistence.state.status === "ready"
```

The activation hook must run unconditionally in `StudioShell`, before any of
its conditional Start/editor returns. It activates for that exact condition and
deactivates otherwise. Do not activate from inside `StudioStartSurface`; the
opening and recovery compositions replace that surface, and future direct
document routes still need the retained provider above them.

Once persistence reaches `ready`, the Recent provider should acquire one child
lease from `StudioPersistenceApi`. Keep it until terminal controller disposal,
then dispose the controller before releasing the lease. This prevents parent
finalization from closing the repository while a list or mutation completion is
still unwinding.

## StrictMode finalization

A normal `useEffect(() => () => controller.dispose(), [controller])` is wrong.
StrictMode replays the cleanup and would permanently dispose the controller that
the second setup is about to reuse.

Use the same generation plus microtask pattern as
`StudioPersistenceRuntime.retain()`:

1. Each lifetime effect setup increments a generation.
2. Cleanup captures that generation and schedules finalization in a microtask.
3. A replayed setup increments the generation before the microtask runs, so the
   stale cleanup does nothing.
4. A real unmount has no replacement setup. Its microtask calls `dispose()`
   once and then releases the child lease once.

The activation effect may call `deactivate()` immediately during replay because
deactivation is reversible and retains the fanout subscription. The following
setup calls `activate()` again. Controller lifecycle methods must be idempotent.

Tests should not assert that React evaluated the controller factory once. The
existing persistence provider test correctly observes more than one runtime
initializer call under StrictMode. The meaningful guarantees are one retained
controller, one live provider-fanout subscription, one lease, and one terminal
dispose/release sequence.

## Provider-state precedence

The provider must project persistence and collection state as one exhaustive
union. Persistence wins in this order:

| Persistence state   | Library behavior                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `opening`           | Deactivate and render the existing opening composition. Do not reveal a retained page.                    |
| `recovery_required` | Deactivate and render draft recovery before every library/template action.                                |
| `blocked`           | Deactivate, preserve cached pages privately, and render session-only storage handling.                    |
| `unavailable`       | Same as blocked, including the exact recoverable legacy envelope when present.                            |
| `ready`             | Include the migration warning, expose the controller projection, and activate only when Start is visible. |

A repository `list()` failure belongs to the controller's terminal or retained
error state. It must not rewrite `StudioPersistenceRuntime` to unavailable and
must not turn the whole Start screen into session-only mode. Migration/storage
opening failures remain provider-owned. List corruption remains a sticky,
deduplicated controller recovery inventory. A later clean page does not clear
it.

`StudioStartSurface` keeps the header, migration/storage warning, templates,
Quick Starts, and the existing recovery/session-only choices. It receives the
new library view model and callbacks. It no longer receives a lossy durable
`currentDraft` or an `onContinue` callback. If an unavailable provider has a
recoverable in-memory envelope, show that as a separate session-only recovery
choice. Do not insert it into Recent or pretend it is durable.

## Subscription ownership

The library controller calls
`persistence.subscribeRepositoryEvents()` exactly once on first activation and
unsubscribes only on disposal. It never calls `repository.subscribe()` and
never closes the repository.

During this bounded cutover, `useDocumentEditor` still has one provider-fanout
listener for the active document's foreign save/delete/quarantine conflict
handling. That listener and the library listener are separate consumers of the
runtime's single underlying repository subscription. Remove only the inactive
document branch that currently calls `refreshReadyList()`. Do not remove the
active document filters until the canonical document-route/session phase owns
them.

## Controller API required by React

The pure controller must expose these capabilities without React or browser
imports:

- stable `getSnapshot()` and `subscribe(listener)` for
  `useSyncExternalStore`;
- idempotent `activate()`, `deactivate()`, and terminal `dispose()`;
- immediate collection selection and an atomic route restoration command for
  `{ collection, query }`, so restoring `trash?q=...` does not fetch Recent
  first;
- synchronous query input, scheduled query application, immediate Enter/Clear,
  view selection, refresh/retry, and Load more;
- Rename edit/input/cancel/submit, Duplicate, Move to Trash, Restore, persistent
  undo Restore, undo dismissal, and explicit JSON download commands;
- conditional acknowledgement of a `focusIntent.id` and the current
  announcement. React must be able to clear handled effects without clearing a
  newer intent that arrived in the same frame;
- a stable disposed snapshot and no-op subscription after disposal.

`activate()` must be the first operation allowed to invoke the injected fanout
`subscribe`. `deactivate()` must not unsubscribe. If the controller API lacks
either rule, the provider cannot meet the no-render-side-effects and
inactive-staleness requirements.

## Start and open-command cutover

Selecting a library row passes its exact `documentId` to
`openStoredDocument(documentId)`. That command is a bounded extraction of the
verified current path:

1. claim the existing session-transition owner;
2. `repository.get(documentId)`;
3. reject missing, deleted, or corrupt data without substituting the private
   starter document;
4. `touchOpened(documentId)`;
5. install the exact verified record, with the current touch-failure fallback;
6. release the same transition owner.

Do not add another opening flag or transition guard. `openingDocumentIdRef`
continues to suppress the command's own active-document event. The library
event listener treats the touch event as an invalidation hint.

## Exact legacy code to remove in this cutover

From `use-document-editor.ts`:

- `describeDraftListRecovery` and the `DraftListRecoveryItem` import;
- `repositoryRecoveryWarningRef`, `startDocumentIdRef`, and
  `readyListRequestGenerationRef`;
- `refreshReadyList` and every call/dependency that exists only for it;
- the inactive-document tail of the repository-event effect that calls
  `refreshReadyList()`;
- `rememberStartRecord` and its calls from session installation and publication
  linkage. Keep the authoritative `activeRecordRef` updates; repository events
  make the library stale;
- the durable branch of `continueCurrentDraft`. Replace it with
  `openStoredDocument(documentId)`. Keep a separately named session-envelope
  continuation path for unavailable/session-only work;
- the `deriveRepositoryDraftSummary` import.

The persistence-state effect remains, but its `ready` branch must stop listing.
It should only mark the repository usable and project provider warning/session
state. The new provider owns list status and recovery inventory.

From `studio-start-model.ts`:

- `deriveRepositoryDraftSummary`;
- the durable one-card `currentDraft` projection. Keep only the data needed for
  a genuine recoverable session envelope, under a name that cannot be confused
  with repository Recent state.

From `studio-start-surface.tsx` and `StudioShell`:

- `CurrentDraftCard`, `onContinue`, `currentDraftRef`, and copy that says one
  browser draft;
- the `draftReplacement` `hasCurrentDraft` check based on a durable Start card;
- the shell call to `editor.continueCurrentDraft`.

Do not run the old adapter and the new controller together for even one render.
That would create two list owners and two recovery-warning projections.

## Test harness

Add a `RecentDocumentsTestWrapper` around the existing
`StudioPersistenceTestWrapper`, or extend that wrapper with an opt-in Recent
provider. It should accept a controller factory and a finalization scheduler so
tests can observe lifecycle without sleeps. A mounted probe captures
`useStudioPersistence()`, the Recent context value, and a boolean Start
visibility prop.

Required mounted assertions:

- opening, recovery, blocked, and unavailable never activate or list;
- ready plus visible activates once; editor visibility deactivates without
  losing pages or unsubscribing fanout; returning to Start reactivates and
  refreshes stale data;
- StrictMode may evaluate inert factories more than once, but only one retained
  controller subscribes, leases, publishes, disposes, and releases;
- real unmount disposes before lease release; replay cleanup does neither;
- persistence API identity changes do not reconstruct the controller;
- any card passes its exact ID to `openStoredDocument`;
- after cutover, a production search finds no `refreshReadyList`,
  `startDocumentIdRef`, `deriveRepositoryDraftSummary`, or library-owned direct
  `repository.subscribe()` call.

Use deferred repository promises and the controller's manual query scheduler.
Do not use timers or real IndexedDB for provider lifecycle assertions. Keep one
separate mounted integration test with the real `StudioPersistenceRuntime` and
fake IndexedDB to prove the repository and lease close order.

## Reference decisions retained

OpenPencil's workspace controller confirms one active refresh, one queued rerun,
focus/source invalidation, and disposal while the UI keeps preview ownership
separate. Loora's dashboard confirms that the dashboard is a sibling of the
editor route, activates archived data only when needed, and finishes creation
before navigation. Studio keeps those ownership lessons but uses its own
bounded repository pages, provider fanout, recovery states, and exact-ID open
command.
