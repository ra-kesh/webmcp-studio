# PERSIST-01B current-code assessment and bounded route/library architecture

Date: 2026-08-28
Status: phase-entry audit; no production or test changes made in this pass

## Verdict

PERSIST-01A is a strong persistence foundation, but PERSIST-01B has not started at
the product boundary. The repository can already hold and safely mutate many
documents. The application still reduces that repository to one `currentDraft`,
keeps both Start and the editor inside one `/` route, and owns repository startup,
route-like session state, editor history, conflict projection, and teardown inside
`useDocumentEditor`.

The next bounded phase is therefore not another repository rewrite and not a
visual recents mock. It is a routing and ownership cutover:

1. mount one browser-only persistence application boundary above `/` and
   `/documents/$documentId`;
2. move repository migration, list pagination, inactive-document mutations, and
   recovery inventory into a document-library controller;
3. admit one exact repository record for the document route before mounting the
   editor;
4. make `useDocumentEditor` a document-session consumer rather than the owner of
   Start and repository bootstrap;
5. make navigation use one settle -> flush -> close -> admit -> install sequence;
6. surface real conflict and recovery actions rather than only status text.

The existing repository, migration coordinator, ordered save controller, import
admission, start template browser, and compact editor shell are reusable. Durable
previews, preview scheduling, storage estimates, retention/purge policy, and all
cloud synchronization stay outside 01B.

## Governing evidence reread

This assessment re-read the current PERSIST-01 phase entry, PERSIST-01A hook
cutover plan and independent approval, START-01 phase entry, START-01 start-surface
audit and integration review, the production-readiness backlog, and remediation
progress before inspecting the current source.

The fixed contracts remain:

- `document.id` is the stable logical and route identity; `recordVersion` is the
  monotonic local compare-and-swap token. Neither `Document.revision` nor editor
  history identity may substitute for it
  (`persist-01-phase-entry.md:90-105`).
- `/` is Start and `/documents/$documentId` is one editor session; both remain
  client-only (`persist-01-phase-entry.md:429-452`).
- route changes settle interactions, flush, close the old session, admit the next
  exact record, install fresh history, update recent activity, and restore focus
  (`persist-01-phase-entry.md:442-450`).
- stale writes retain the candidate and offer Reload saved or Save as copy. There
  is no overwrite or last-write-wins action
  (`persist-01-phase-entry.md:394-406`).
- 01B contains real routes, the multi-document list, create/open/rename/duplicate/
  soft-delete/restore, navigation blocking, focus, and visible conflict recovery.
  Previews and retention/purge policy are 01C
  (`persist-01-phase-entry.md:536-542`).
- the earlier START-only replacement warning was explicitly temporary. Once the
  repository exists, creation produces a distinct record and the warning goes
  away (`start-01-start-surface-audit.md:252-268,458-479`).

## Current application flow

### Routing is not a document identity boundary

- The only UI route is `/`; it disables SSR and renders `StudioShell`
  (`apps/studio/src/routes/index.tsx:1-14`).
- `StudioShell` conditionally renders either Start or the workspace from the
  hook's internal `sessionMode` (`apps/studio/src/features/studio-shell.tsx:2276-2398`).
- The generated route tree contains `/` and server/API routes, but no UI
  `/documents/$documentId` route. The similarly named
  `/v1/studio/documents/$documentId/revisions/$snapshotId` is an immutable server
  revision endpoint, not a local-draft editor route
  (`apps/studio/src/routeTree.gen.ts:11-37,145-183`).
- No production code uses TanStack Router navigation or a route blocker. Browser
  Back/Forward therefore cannot identify or restore a document session.

Today the de facto route parameter is `startDocumentIdRef`. It is populated from
the first metadata row and used by `continueCurrentDraft`
(`apps/studio/src/features/editor/use-document-editor.ts:415-423,713-785`). That
ref has no URL, direct-open, history, not-found, or deleted-route semantics.

### Repository startup is embedded in the editor hook

`useDocumentEditor` currently:

- lazily constructs the repository and initializes a private neutral history
  (`use-document-editor.ts:316-332`);
- owns Start/workspace mode, repository lifecycle, Start model, active record,
  controller, subscription, and several generations
  (`use-document-editor.ts:326-353,410-426`);
- runs legacy migration, lists the repository, and subscribes to repository events
  in one effect (`use-document-editor.ts:909-1147`);
- admits, touches, installs, and closes document sessions
  (`use-document-editor.ts:547-785,884-907`);
- returns both library/start concerns and all editor commands from a single hook
  (`use-document-editor.ts:4316-4469`).

This was a safe PERSIST-01A bridge, but it is now the principal 01B boundary.
Keeping it would create two sources of truth: router location and `sessionMode`.

### The list is real, but its product projection is one row

Repository startup calls `list({ limit: 50 })`, then selects only
`items.at(0)`, discards `nextCursor`, and stores that row as `currentDraft`
(`use-document-editor.ts:915-948`). The Start UI then labels the section
“Current browser draft”, renders “1 draft”, and has one Continue button
(`studio-start-surface.tsx:203-294`). The explanatory copy still explicitly says
“the one draft stored in this browser” (`studio-start-surface.tsx:898-903`).

This is truthful for the prior bridge but false as the final repository UI. It
also wastes a 50-row metadata read to display one row.

`StudioStartModel` is shaped around `currentDraft`, not a page of documents. Its
card projection discards the repository `recordVersion`, content/draft identities,
deletion state, origin, and publication metadata required for safe card actions
(`studio-start-model.ts:15-54,93-109`). It therefore cannot drive Rename, Delete,
Restore, or conflict-aware action retry without rereading.

Multiple inactive repository events call `installReadyList()` without a list
request generation. A slower earlier refresh can publish after a newer refresh
(`use-document-editor.ts:915-948,1082-1120`). A real library controller must order
or invalidate list completions.

### Start creation still uses destructive-replacement semantics

`StudioShell` treats any current repository document as if there were still one
storage slot. It routes template, blank, JSON import, and sample creation through
`useDraftReplacement` (`studio-shell.tsx:972-988,2326-2393`). The resulting dialog
claims the current document is “the only draft stored in this browser” and that
the new action will replace it (`replace-current-draft-dialog.tsx:41-55`).

That copy and interaction are now obsolete. `persistAndInstallSession` already
uses `repository.create`, so a distinct ID creates a second durable document
(`use-document-editor.ts:625-703`). In 01B, Start creation should create then
navigate. Creation from an open workspace should settle/flush the old route,
create the new record, then navigate; it should not say the saved old record will
be destroyed.

There are two additional identity hazards in the bridge that cannot cross into
01B:

- `restoreDemoDocument` submits the fixed `quotationStarter.document` identity
  (`use-document-editor.ts:4030-4045`). `persistAndInstallSession` special-cases an
  existing quotation ID by saving over that repository head
  (`use-document-editor.ts:659-681`). In a multi-document product, Open sample
  must materialize a fresh document ID or explicitly open the existing sample; it
  must never reset a user's existing record because the starter ID collided.
- Start passes the last mounted editor's `quotationSource` to template
  compatibility (`studio-shell.tsx:2307-2314`), and template creation reads the
  hook's current source context. Once Start is a real route, it has no implicit
  active-document source. Quotation-backed templates remain unavailable until
  the Start action owns an explicit quotation source; it cannot inherit the last
  route's source context.

Start JSON import also needs an explicit collision contract. The current path
calls `create()` and reports “identifier already exists.” It must never overwrite.
For 01B, an existing exact ID should offer Open existing, while importing as a
copy must be an explicit action that assigns a new document ID and fresh
timestamps. Different bytes under an existing ID are not an update.

### Current open and Home behavior are good reusable mechanics, not routing

Continue uses a request generation, reads the target, calls `touchOpened`, and
installs only the record returned by the final verified touch. A delete/corruption
race does not install the earlier `get()` bytes
(`use-document-editor.ts:713-779`; `document-draft-repository.ts:2206-2296`).

Home blocks crop/review, flushes, closes the controller, and changes internal mode
only after success (`use-document-editor.ts:884-907`). The product command first
settles active Fabric text and reports failure persistently
(`studio-shell.tsx:2020-2045`). These mechanics should become route-navigation
preconditions rather than be discarded.

### Save durability and publication are already separate

The ordered controller owns one document ID, record version, exact snapshot
capture, a reusable ordered promise chain, debounce, retry, and terminal conflict
state (`document-draft-save-controller.ts:65-175,221-326`). Closing suppresses late
state publication but correctly does not claim that an already-issued IndexedDB
transaction can be cancelled (`document-draft-save-controller.ts:178-189`).

The hook captures exact document plus source context and verifies controller
identity before saving (`use-document-editor.ts:787-860`). Home and JSON/PNG/PDF
export flush the local head (`use-document-editor.ts:862-907,1352-1378`;
`studio-shell.tsx:1605-1627,1636-1700`), and publish flushes then verifies the exact
repository head (`use-document-editor.ts:2134-2194`). Publication sync is rendered
as a separate status (`studio-shell.tsx:1840-1849`). 01B must preserve this split;
route loading and cloud/publish state must not relabel local durability.

Best-effort unload behavior is also correctly bounded: `beforeunload` warns when
the in-memory state is not saved, and `pagehide` only begins a drain
(`use-document-editor.ts:1259-1278`). 01B must not upgrade this to a shutdown
guarantee.

## Repository capability matrix

| Capability          | Current implementation                                                                                                                        | Product use now                                                          | 01B assessment                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open database       | typed `open()` with blocked/unavailable outcomes (`document-draft-repository.ts:1019-1043`)                                                   | migration effect only                                                    | Reuse in the application persistence boundary.                                                                                                                                     |
| List                | validated metadata, newest-first compound cursor, limit 1-100, query and `nextCursor` (`:459-471,869-901,2394-2480`)                          | first row only                                                           | Reuse, but expose the real page/cursor and order async refreshes.                                                                                                                  |
| Get/open            | paired body/meta validation, integrity admission, quarantine on failure (`:2298-2392`)                                                        | Continue only                                                            | Route admission authority. Never substitute bootstrap bytes for a failed target.                                                                                                   |
| Create              | validates before one atomic body/meta transaction and refuses an existing ID (`:1151-1275`)                                                   | blank/template/import/sample                                             | Reuse; success navigates to the created document route.                                                                                                                            |
| Save/rename         | CAS save retains conflicts; rename changes canonical `Document.name` through save (`:1499-1699,1842-1889`)                                    | autosave uses save; rename is disconnected                               | Inactive Start rename uses repository CAS. Active rename must be an editor commit through the active controller, never a side write behind it.                                     |
| Duplicate           | new document ID, revision zero, fresh timestamps, copied nested IDs/source context, origin `duplicate` (`:1891-1932`)                         | disconnected                                                             | Reuse for active records. Navigate to the returned record on success. Publication is not copied because `create()` starts `lastPublished` as null (`:521-576`).                    |
| Soft delete/restore | one CAS tombstone transition advances `recordVersion` and broadcasts (`:1934-2096`)                                                           | disconnected                                                             | Ordinary Delete is soft. Start can restore from Trash. Active-route delete must flush/close before tombstoning with the latest token.                                              |
| Purge               | removes body/meta/preview and resolved conflicts with CAS (`:2098-2204`)                                                                      | disconnected                                                             | Keep unexposed in 01B. Repository primitive is useful, but user-visible retention/permanent-delete policy is explicitly 01C. Unresolved conflict candidates intentionally survive. |
| Touch opened        | rereads and updates activity without changing record version/content (`:2206-2296`)                                                           | Continue                                                                 | Reuse as the final admission read before visible route install.                                                                                                                    |
| Cross-tab events    | reasoned content/open/publication events plus delete/restore/preview; observer failure cannot roll back commits (`:161-182,474-504,984-1017`) | hook refreshes one card; active content/delete becomes `external_change` | Library controller invalidates pages; session controller handles exact active-ID events. CAS remains authority.                                                                    |
| Conflict records    | exact validated candidate, one ID per document/session (`:198-215,1603-1632,2861-2931`)                                                       | save status/download only                                                | Reuse candidate storage, add actual resolution orchestration and UI.                                                                                                               |
| Resolve conflict    | marks `reload_saved` or `save_copy` on a conflict row (`:2933-2970`)                                                                          | disconnected                                                             | Marker-only; it does not reload or create a copy. Do not expose it as if resolution were complete.                                                                                 |
| Quarantine          | retains raw body/meta and removes the observed active pair only when still current (`:330-349,2752-2859,2972-3015`)                           | legacy recovery dialog only; repository quarantine is disconnected       | Start/application boundary owns repository recovery inventory and exact raw download/delete actions.                                                                               |
| Preview             | exact PNG/content identity methods already exist (`:184-196,2483-2750`)                                                                       | not used by Start                                                        | Leave card preview production and scheduling to 01C. Use a stable non-image placeholder in 01B.                                                                                    |

## Missing or unsafe contracts to close before UI wiring

### 1. Active-only and deleted-only pagination

`list({ includeDeleted: false })` returns active records. `includeDeleted: true`
returns active and deleted records together (`document-draft-repository.ts:2394-2448`).
Filtering that mixed page in the view would produce incomplete Trash pages and
misleading continuation counts. Replace the boolean at the library boundary with
an explicit mode such as `state: "active" | "deleted" | "all"`; the IndexedDB
scan must apply that predicate before satisfying the page limit.

### 2. Conflict resolution is not transactional product behavior

`resolveConflict()` currently updates only the conflict marker. “Save my changes
as a copy” must create a new validated record from `conflict.candidate`, assign a
new document ID/revision/timestamps, preserve source context and nested IDs, omit
publication linkage, and mark the conflict resolved. A failure between create and
marker update must not create repeated ambiguous copies on Retry.

The bounded repository addition should be one atomic operation over body, meta,
and conflicts for `save_copy`. `reload_saved` may mark resolution only after a
fresh current record has been admitted. The route/session coordinator then closes
the old controller and navigates/installs the returned exact record.

### 3. List corruption has no recoverable item identity

`get()` quarantines a corrupt pair and returns a quarantine ID. `list()` stops on
an invalid metadata row with a generic `corrupt_record` failure and does not
return which row became a recovery item (`document-draft-repository.ts:2440-2459`).
A real Start surface cannot hide all healthy documents or pretend the repository
is empty. The repository/list adapter needs a typed recovery descriptor or a
bounded repair pass that quarantines the observed row safely, then reloads the
page. `listQuarantine()` supplies the retained inventory after that boundary.

### 4. Active and inactive mutations need different owners

Start-card mutations can call repository CAS using the card's `recordVersion`.
An open document cannot: a direct `repository.rename` or `softDelete` would move
the head behind the active save controller and guarantee a later conflict.

- Active Rename is a canonical editor history commit followed by the existing
  controller.
- Active Delete settles and flushes, uses the controller's latest version to
  tombstone, closes, then navigates Home.
- Inactive Rename/Delete/Restore/Duplicate belong to the library controller.

### 5. Route admission needs a typed result

Define an admission result that distinguishes at least:

```ts
type DocumentRouteAdmission =
  | { status: "opened"; record: DocumentDraftRecord }
  | { status: "missing"; documentId: string }
  | { status: "deleted"; summary: DocumentDraftSummary }
  | { status: "recovery_required"; documentId: string; quarantineId: string }
  | { status: "blocked" | "unavailable"; message: string }
```

Do not collapse these into `false`, and do not mount `useDocumentEditor` until
`opened`. Direct unknown, quarantined, or deleted URLs return to `/` with a typed,
persistent Start notice. TanStack search state such as
`?notice=document-not-found&documentId=...` is preferable to a transient hook
error because it survives the redirect and is testable on direct load. Never put
raw storage error text into the URL.

### 6. Starter and import identity must be newly owned

Blank and general-template creation already produce fresh IDs. Sample creation
must do the same, rather than using the quotation reset special case. Start import
preserves a foreign file's canonical ID only when it is new; an existing ID never
becomes an overwrite. These decisions belong to the library creation service,
not an editor session whose current source/history can leak into the candidate.

## Target bounded architecture

### One client-only persistence layout

Add a pathless UI layout above both pages, with SSR disabled:

```text
/_studio (pathless, client-only persistence provider)
  /                              -> StudioStartPage
  /documents/$documentId         -> StudioDocumentPage
```

The layout constructs one `DocumentDraftRepository`, runs migration once, owns
the one BroadcastChannel/subscription lifetime, and closes it once on real
unmount. API routes remain outside this layout. This preserves the StrictMode
guarantees already proved for lazy channel construction.

The provider state is:

```ts
type StudioPersistenceState =
  | { status: "opening" }
  | { status: "recovery_required"; recovery: LegacyRecovery }
  | { status: "blocked"; failure: DraftRepositoryFailure }
  | { status: "unavailable"; failure: DraftRepositoryFailure }
  | { status: "ready"; repository: DocumentDraftRepository }
```

Legacy current-draft migration remains here. `current-draft-repository.ts` is not
dead code yet; it remains the downgrade-safe decoder/recovery source used by
`document-draft-migration.ts:1-35,179-240`.

### Framework-independent document-library controller

Add a controller (with a thin React adapter) that owns:

- active and deleted metadata pages independently;
- query, loading, retained-page error, `nextCursor`, and Load more;
- request generations so stale list completions cannot publish;
- reasoned repository-event invalidation;
- inactive Rename, Duplicate, Soft delete, and Restore;
- per-action pending/error state keyed by document ID;
- repository quarantine inventory and persistent route notices.

It also owns all Start creation: blank, template, import, and sample candidates
are fully materialized and admitted without reading an editor history ref. A
successful create returns the exact record to navigate; a collision returns a
typed Open-existing or Import-as-copy choice.

Its ready state should retain full `DocumentDraftSummary` rows, not the lossy
`CurrentDraftSummary`. Rendering may derive labels, but action CAS tokens stay in
the controller model.

For real pagination, changing query resets pages and cursor; Load more appends
only if the captured query/mode/generation still matches. A `saved/opened`,
`deleted`, or `restored` event invalidates the affected collection. Refresh may
retain the previous page under an `updating` state, but it cannot append a page
from an older generation.

### Document-route session coordinator

The route coordinator owns the state machine:

```text
waiting_for_repository
  -> admitting(documentId, generation)
  -> active(record, saveController)
  -> leaving(settling -> flushing -> closing)
  -> closed

admitting -> missing | deleted | recovery_required | unavailable
active -> external_change -> conflict
active -> failed
```

Admission order is:

1. validate a non-empty route parameter and capture a route generation;
2. `get(documentId)` and run all current draft/resource admission;
3. call `touchOpened(documentId)` as the final verified repository read;
4. require the same generation and exact returned ID;
5. create the save controller from that returned record;
6. mount a keyed editor session with fresh history/source context;
7. fit and focus the interactive canvas.

Using the final `touchOpened` record preserves the current get-then-delete and
get-then-corrupt race protection. “Touch after successful installation” should
mean after successful target admission, not after exposing stale bytes to the
interactive editor.

Change `useDocumentEditor` to accept the admitted record and controller/session
services. Remove repository migration, Start model, Continue, `sessionMode`, and
`startDocumentIdRef` from the hook. WebMCP registration then follows route mount:
it exists only while `StudioDocumentPage` is active, preserving the current
workspace-only boundary.

### Route navigation and blocker ownership

One route-navigation coordinator must be used by:

- Home/logo/File menu/command palette;
- browser Back/Forward;
- clicking another recent document;
- creating from template/blank/import/sample while a document is open;
- active-document Delete;
- conflict Reload or Save as copy.

Its ordered transition is:

1. claim one navigation owner synchronously;
2. settle or block active Fabric text, crop, transform, guide, and review state;
3. capture the exact document/source context;
4. await `saveController.flush()`;
5. if failed, conflict, or external-change state remains, stay on the route and
   open the relevant persistent recovery UI;
6. allow exactly one router transition;
7. unsubscribe and close the old controller, revoke document resource URLs, and
   invalidate late session generations;
8. admit the destination, mount fresh history, then focus.

Use TanStack Router's blocker for browser and link navigation. The coordinator
needs an allow-once token so its own post-flush navigation is not blocked again.
`beforeunload` remains only for unsaved in-memory work. `pagehide` remains a
best-effort drain, never a correctness claim.

Publish and explicit exports retain their existing local flushes. They do not
navigate and must not be folded into the router blocker. Publication sync remains
a separate projection from local save state.

### Visible conflict and external-change ownership

The current status menu correctly exposes warning text and Download my version
(`studio-shell.tsx:2807-2876`), but it does not resolve anything. Add one
route-owned accessible conflict dialog/sheet:

- **Download my version** always serializes the exact in-memory
  `{schemaVersion: 1, document, sourceContext}` without another save.
- **Reload saved version** fetches/admisses the current head, confirms candidate
  loss when necessary, replaces the session, then records `reload_saved`.
- **Save my changes as a copy** uses the atomic candidate-copy repository
  operation, navigates to the new document route, then shows the original conflict
  as resolved.
- no Overwrite action exists.

A clean foreign `content_saved` event may first show an external-change dialog
with Reload and Download. If the user edits, the existing controller reaches
real CAS conflict and the repository retains the candidate. Foreign `opened` and
`publication_linked` events remain metadata invalidations and do not block Home,
matching `use-document-editor.ts:1082-1117`.

### Recovery ownership

Recovery has two distinct owners:

1. **Legacy migration recovery** preempts both routes at the persistence layout.
   The existing modal and raw Download/Retry/Reset mechanics are retained until
   migration is complete (`draft-recovery-dialog.tsx:20-109`;
   `use-document-editor.ts:1380-1481`).
2. **Repository document recovery** belongs to Start/library state. A quarantined
   route redirects to its recovery item. The item exposes exact raw body/metadata
   download, retry/read-after-repair, and explicit removal of that quarantine
   record. It never installs the sample or labels the repository empty.

Missing external/local resources remain document-open recovery, not malformed
storage quarantine. This distinction must survive the 01B UI even though broader
media repository work is separate.

## Start surface and compact parity

Keep the current template browser, Quick Starts, storage warning, loading/error
semantics, and responsive typography. Replace only the obsolete current-card
section with a real document library.

Required desktop and compact behavior:

- Start list/grid uses one column at 320/390 px and bounded columns only when
  width permits.
- Each document row/card has one primary route Link. The overflow menu is a
  sibling interactive owner, never nested inside the Link/button.
- Coarse-pointer Open, overflow, dialog, Retry, Restore, and Load-more controls
  keep 44 px targets.
- Every active-row action exists in compact UI: Open, Rename, Duplicate, Delete.
  Trash exposes Restore; permanent purge does not appear in 01B.
- Start supports opening, empty, ready, refreshing, loading-more, blocked,
  unavailable, recovery, and retained-list-with-error states.
- Search operates over the repository query contract. Grid/list preference may
  be local UI state, but both layouts render the same action model.
- Start initial focus goes to the heading without opening a software keyboard.
  Home returns focus to the exact originating document card. Delete focuses the
  next card or section heading; Rename/Duplicate/Restore restore focus to their
  action owner; successful Open/Create focuses the canvas.
- Conflict/recovery dialogs use the established accessible Dialog/Sheet
  primitives and have full action parity at compact width.

No thumbnail should be fabricated for 01B. Use a stable document-format
placeholder derived from metadata. Renderer-derived previews, stale labeling,
visibility scheduling, local-asset conformance, and object-URL lifecycle are 01C.

## Dead, duplicate, or disconnected code after the cutover

Remove only after equivalent route/library tests pass:

- internal `sessionMode` and its Start/workspace conditional shell branch
  (`use-document-editor.ts:326-328`; `studio-shell.tsx:2276-2398`);
- `startDocumentIdRef`, `continueCurrentDraft`, `rememberStartRecord`, and the
  one-row list adapter (`use-document-editor.ts:415-423,522-532,713-785,915-948`);
- `CurrentDraftCard` and its “1 draft” copy
  (`studio-start-surface.tsx:203-294`);
- the destructive `ReplaceCurrentDraftDialog` and the repository-era use of
  `useDraftReplacement` (`replace-current-draft-dialog.tsx:15-88`;
  `studio-shell.tsx:972-988`);
- `repositoryLifecycle`, which is maintained and returned but has no production
  consumer (`use-document-editor.ts:352-353,4333-4335`);
- unused production projections `projectStudioStartModel` and
  `startIntentReplacesCurrentDraft` (`studio-start-model.ts:112-154`).

Do **not** delete:

- `current-draft-repository.ts` or migration cleanup code; they remain the legacy
  decoder/recovery/rollback boundary;
- `DocumentDraftSaveController`;
- repository preview methods (01C will consume them);
- the Start template browser, Quick Starts, import parser/admission, or recovery
  dialog;
- publication flush/linkage logic.

The repository's Rename, Duplicate, Soft delete, Restore, conflict, quarantine,
and pagination methods are not dead. They are completed lower-level primitives
that simply have no product owner yet.

## Safe incremental implementation order

1. **Close repository contract gaps.** Add active/deleted list mode, typed list
   recovery descriptors, atomic Save-conflict-as-copy, and explicit starter/import
   collision outcomes. Do not touch routing until repository tests cover them.
2. **Add the persistence layout and library controller.** Run migration once,
   project real paginated metadata, order refresh generations, and wire
   quarantine inventory. Keep the existing one-card Start rendering temporarily
   through an adapter.
3. **Build the real recent/trash components.** Wire Load more, query, Rename,
   Duplicate, Soft delete, and Restore against full summaries. Creation still may
   open the old workspace internally during this patch; no destructive copy
   change is claimed yet.
4. **Add `/documents/$documentId` admission.** Direct URL, missing/deleted/
   quarantined redirect notices, get/touch race protection, keyed session mount,
   and exact canvas focus must pass before links replace Continue.
5. **Cut `useDocumentEditor` to session input.** Move migration/list/Start/Continue
   out; preserve editor history, save capture, import guards, publish, exports,
   pagehide, and WebMCP lifecycle. Remove internal `sessionMode` only here.
6. **Install route navigation ownership.** Home, Back/Forward, recent links,
   create-new-from-workspace, and active Delete all share settle/flush/block/close
   ordering. Remove the destructive replacement dialog after multi-document
   creation passes.
7. **Add conflict and recovery UI.** Exercise real two-repository CAS conflict,
   reload, atomic save-copy, foreign delete, raw candidate download, quarantine
   redirect, and compact dialog behavior.
8. **Delete bridge code and run the complete static/browser gates.** Generated
   route tree changes only through the router plugin, never by hand.

Every step is independently revertible until step 5. The rollback boundary is the
current PERSIST-01A adapter: it can continue displaying the newest repository row
without writing legacy localStorage or losing additional records. Do not re-enable
single-slot writes as a rollback.

## Required acceptance coverage

### Repository and controller tests

- active and deleted pagination are complete and cursor-stable with identical
  `activityAt` values;
- query reset, invalid cursor, bounded limit, and stale list generation;
- Rename CAS and active-side-write rejection by ownership;
- Duplicate identity/revision/timestamps/source/nested IDs/no publication link;
- sample creation never overwrites the fixed starter ID, and import collision
  never overwrites an existing head;
- Soft delete cannot be resurrected by a stale open controller;
- Restore advances the version and returns to active pagination;
- ordinary Delete never calls purge;
- atomic conflict save-copy is idempotent under retry and retains both documents;
- list corruption yields a recoverable item without hiding healthy rows.

### Mounted route/start/session tests

- `/` empty, ready, blocked, unavailable, legacy recovery, repository recovery,
  refresh error, and loading-more states;
- two or more real recents, search, Load more, active/Trash switch, every CRUD
  action, and no “only draft” replacement warning;
- direct `/documents/:id` open, unknown ID, deleted ID, quarantine, get-then-delete,
  get-then-corrupt, and late prior-route completion;
- fresh history/source context and exact document/controller ID per route;
- Home and another-document navigation wait for deferred flush; failed/conflict/
  external change refuses transition;
- browser Back/Forward uses the same blocker and never exposes private bootstrap;
- active rename uses the controller; inactive rename uses repository CAS;
- active Delete flushes, tombstones, closes, returns Home, and focuses the next
  deterministic target;
- foreign open/publication events do not block; true newer content/source and
  delete events do;
- Reload saved, Save as copy, Download my version, and unresolved-candidate reload;
- StrictMode creates/closes one retained repository channel and leaks no listener;
- WebMCP is registered only on the document route and aborts before Start becomes
  interactive.

### Compact and healthy-browser gates

- 320, 390, 1280, and 1440 px Start/list/trash/dialog/workspace parity;
- keyboard-only list, overflow, rename, duplicate, delete, restore, conflict, and
  recovery journeys;
- focus after direct open, Home, Back/Forward, action cancel/success/failure, and
  deleted-card removal;
- refresh while saved, saving, failed, conflict, deleted, and quarantined;
- two real tabs edit/save/delete/reload/save-copy against the same browser DB;
- blocked IndexedDB upgrade and recovery after the other tab closes;
- quota failure with exact candidate Download and Retry;
- pagehide best-effort drain observed without claiming guaranteed completion.

## Explicitly out of scope

PERSIST-01B must not absorb:

- renderer-derived recent previews, preview queues, stale/updating pixels,
  IntersectionObserver scheduling, local-asset preview production, or object URL
  cache policy (PERSIST-01C);
- storage estimate UI, automatic retention, trash expiry, or user-visible
  permanent purge policy (PERSIST-01C);
- D1 draft heads, server ETags/versions, authentication/workspace ownership,
  offline outbox, reconnect/rebase, cross-device sync, or collaborative merge
  (later cloud synchronization);
- using immutable publication revisions as mutable draft heads;
- automatic last-write-wins, overwrite, or command rebase;
- template/media/editor feature expansion unrelated to document-library routing.

Local save state and publication sync remain separate throughout. Completing 01B
does not complete PERSIST-01: 01C and the healthy-browser gates still remain.
