# PERSIST-01B Recent and Trash phase map

Date: 2026-08-29
Status: phase-entry implementation map; no product code changed in this pass

## Decision

The next slice replaces the one-card Start bridge with a real repository-backed
document library. It owns bounded Recent and Trash pages, repository search,
ordered refresh, inactive-document actions, and complete UI states. It does not
add a second recents index and it never reads document bodies to build the list.

The lower repository work required for this slice is already present and
approved:

- `DocumentDraftRepository.list()` accepts explicit active, deleted, and all
  states. It applies state and query before satisfying the healthy-row limit
  and uses the stable `(activityAt, documentId)` cursor.
- list corruption returns healthy rows plus typed `recoveryItems`; a corrupt row
  does not consume the requested limit or hide healthy rows;
- Rename, Duplicate, Soft delete, and Restore return exact committed records and
  use `recordVersion` compare and swap;
- `StudioPersistenceRuntime` owns the sole production repository, migration,
  underlying subscription, and final close. The library must consume provider
  fanout rather than subscribe to or construct another repository.

The current product gap is above that boundary. `use-document-editor.ts:1051-1104`
lists 50 active summaries, throws away `nextCursor`, projects only `items.at(0)`,
and stores the selected ID in a private ref. `studio-start-model.ts:13-54` drops
the record version, origin, snapshot identities, deletion state, and publication
metadata. `studio-start-surface.tsx:203-293` then renders one button under
"Current browser draft". None of those shapes can safely power a document
library.

## Phase boundary

This slice includes:

- one framework-independent Recent/Trash controller;
- a React provider that survives Start/editor transitions under `/_studio`;
- metadata-only search and opaque cursor pagination;
- grid and list views over the same action model;
- inactive Rename, Duplicate, Move to Trash, Restore, and explicit JSON download;
- operation-local failures, persistent delete undo, recovery warnings, focus,
  keyboard behavior, and compact parity;
- a temporary exact-ID open command that reuses the existing verified
  `get -> touchOpened -> install` path until the canonical document route lands.

This slice does not claim canonical `/documents/$documentId` history, route
blocking, active-document lifecycle actions, conflict resolution, preview
production, or permanent purge UI. Those owners remain in their named later
slices.

## Evidence from actual reference code

### OpenPencil

Use:

- `outputs/reference-repos/editors/open-pencil/packages/vue/src/document/workspace/use.ts:20-125`
  for a small list controller, one active refresh, one queued rerun, focus/source
  invalidation, disposal, and independent preview ownership;
- `outputs/reference-repos/editors/open-pencil/src/components/home/HomeWorkspace.vue:150-320`
  for separate empty, search-no-match, grid, list, and failure compositions.

Do not copy:

- `outputs/reference-repos/editors/open-pencil/src/app/recent-files/store.ts:1-103`.
  It is a ten-item localStorage pointer list. Studio records are already
  canonical IndexedDB entities, so a second index would create competing truth.
- `HomeWorkspace.vue:93-105` filters only the client rows already loaded. Studio
  search must call the repository so matches beyond the first page remain
  discoverable.

### Loora

Use:

- `outputs/reference-repos/editors/loora/packages/shell/src/components/designs-dashboard.tsx:46-238`
  for sibling route/menu interaction owners, focus-visible action disclosure,
  loading shapes, grid/list parity, and archived-only Restore behavior;
- `designs-dashboard.tsx:280-620` for Cmd/Ctrl+F, lazy archived loading,
  separate first-use and no-match states, and create-before-navigation;
- `outputs/reference-repos/editors/loora/packages/editor/src/lib/canvas-client.ts:699-755`
  and `:1245-1271` for one controller owning pending work, ordered persistence,
  conflict-aware flush, and close waiting for pending durability.

Do not copy:

- the dashboard loads every design into one unbounded array and filters it in
  memory;
- Rename, Archive, and Delete often close their dialog on failure and project a
  global error. Studio must keep the affected input/card and its retry context;
- Loora thumbnails fetch complete design data. Studio previews remain a separate
  PERSIST-01C pipeline.

### Canva clone

Use:

- `outputs/reference-repos/editors/canva-clone-fabric/src/app/(dashboard)/templates-section.tsx:24-47`
  for the create-completes-before-navigation order;
- `outputs/reference-repos/editors/canva-clone-fabric/src/app/(dashboard)/projects-section.tsx:224-279`
  for an explicit Load more control and visible pending state.

Do not copy:

- `features/projects/api/use-get-projects.ts:8-27` uses numeric offset pages;
  Studio already has an opaque tie-stable cursor;
- the project table uses clickable cells instead of links/buttons, action icons
  lack precise accessible names, Delete is permanent, and mutation failures are
  generic toasts.

### Avnac

Use:

- `outputs/reference-repos/editors/avnac/frontend/src/components/file-grid-card.tsx:30-285`
  for separate preview/title open targets, a sibling actions menu, Escape
  handling, focus-visible disclosure, long-name truncation, tabular dimensions,
  and semantic `<time>` content;
- `outputs/reference-repos/editors/avnac/frontend/src/routes/files.tsx:324-532`
  for compact one-column cards, first-use composition, and explicit migration
  warning placement.

Do not copy:

- `frontend/src/lib/avnac-editor-idb.ts:90-121` calls `getAll()`, parses every
  body, and sorts only by `updatedAt`;
- `idbDeleteDocument()` at `:158-174` permanently removes the record even though
  the card says "Move to trash";
- Duplicate spans IndexedDB and separate localStorage writes, and failed actions
  are logged rather than retained beside the operation.

## Exact owners

| Owner                       | File                                                                                                                       | Responsibility                                                                                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                  | existing `apps/studio/src/features/editor/document-draft-repository.ts`                                                    | Canonical metadata pages, cursor, CAS mutations, tombstones, corruption recovery descriptors, events. No new list database.                                                                                                                                                                  |
| Persistence boundary        | existing `apps/studio/src/features/persistence/studio-persistence-runtime.ts` and provider                                 | One repository and one underlying event subscription. Fan out events and stay authoritative for opening, recovery, blocked, unavailable, and ready.                                                                                                                                          |
| Library controller          | new `apps/studio/src/features/editor/recent-documents-controller.ts`                                                       | Active/deleted slots, applied query, cursors, request generations, coalesced invalidation, operation state, committed mutation projection, recovery accumulation, announcements, and focus intents. No JSX.                                                                                  |
| React owner                 | new `apps/studio/src/features/editor/recent-documents-provider.tsx`                                                        | Construct one controller for the retained persistence runtime, subscribe with `useSyncExternalStore`, activate it only while Start is visible, and dispose exactly once. It uses `persistence.subscribeRepositoryEvents`; it does not call `repository.subscribe()` or `repository.close()`. |
| UI model                    | new `apps/studio/src/features/editor/recent-documents-model.ts`                                                            | Exhaustive projection from controller state and complete `DocumentDraftSummary` rows to view states, labels, capabilities, metadata, and exact action availability. No storage or timers.                                                                                                    |
| Collection UI               | new `apps/studio/src/features/editor/recent-documents.tsx`                                                                 | Recent/Trash tabs, search, view toggle, skeletons, cards/rows, Load more, menus, Rename dialog, delete undo/status, local errors, focus return, and virtualization.                                                                                                                          |
| Start composition           | existing `studio-start-surface.tsx`                                                                                        | Replace `CurrentDraftCard` only. Keep the existing header, persistence warning, templates, Quick Starts, and Geist tokens. It receives the library view model and callbacks rather than a lossy `currentDraft`.                                                                              |
| Exact-ID compatibility open | bounded extraction in `use-document-editor.ts`                                                                             | Replace `continueCurrentDraft()` with `openStoredDocument(documentId)`, using the existing verified read/touch/session-install path and shared transition owner. This is a button command until the canonical document route replaces it with a `Link`.                                      |
| Route search codec          | new `apps/studio/src/features/editor/document-library-search.ts`, integrated by `apps/studio/src/routes/_studio/index.tsx` | Validate `collection=recent                                                                                                                                                                                                                                                                  | trash`and`q`. Browser Back restores tab/query. Grid/list preference stays local because it does not change document identity or results. Cursor and loaded-page count stay transient. |

The `recent-documents-provider` belongs directly under
`StudioPersistenceProvider` in `routes/_studio/route.tsx`. It therefore survives
the later switch between `/` and `/documents/$documentId`, retains recovery
inventory, and can mark cached pages stale while the editor route is active
without fetching them in the background.

## Controller contract

### Dependencies

The controller accepts dependencies instead of importing browser globals:

```ts
type RecentDocumentsDependencies = Readonly<{
  list: DocumentDraftRepository["list"]
  rename: DocumentDraftRepository["rename"]
  duplicate: DocumentDraftRepository["duplicate"]
  softDelete: DocumentDraftRepository["softDelete"]
  restore: DocumentDraftRepository["restore"]
  getForDownload: DocumentDraftRepository["get"]
  subscribe: StudioPersistenceApi["subscribeRepositoryEvents"]
  scheduleQuery: (callback: () => void, delayMs: number) => () => void
  readViewPreference: () => "grid" | "list"
  writeViewPreference: (view: "grid" | "list") => void
}>
```

Production binds these functions to the provider's one repository. Tests use
deferred promises and a manual query scheduler. No test needs a sleep.

### State

Keep the controller state explicit. Do not encode loading and failure in several
unrelated booleans.

```ts
type DocumentsCollection = "recent" | "trash"
type DocumentsView = "grid" | "list"

type ConfirmedPage = Readonly<{
  items: readonly DocumentDraftSummary[]
  nextCursor: string | null
  recoveryItems: readonly DraftListRecoveryItem[]
  confirmedAt: number
  revision: number
}>

type CollectionSlot =
  | Readonly<{ status: "idle"; stale: boolean }>
  | Readonly<{ status: "loading"; retained: ConfirmedPage | null }>
  | Readonly<{
      status: "ready"
      page: ConfirmedPage
      stale: boolean
      pagination: "idle" | "loading_more"
      paginationFailure: DraftRepositoryFailure | null
    }>
  | Readonly<{
      status: "failed"
      retained: ConfirmedPage | null
      failure: DraftRepositoryFailure
    }>

type DocumentActionState =
  | Readonly<{ kind: "rename"; phase: "editing"; input: string; error: null }>
  | Readonly<{
      kind: "rename"
      phase: "submitting"
      input: string
      token: number
      error: string | null
    }>
  | Readonly<{
      kind: "duplicate" | "trash" | "restore" | "download"
      phase: "submitting"
      token: number
      error: string | null
    }>

type RecentDocumentsState = Readonly<{
  active: boolean
  disposed: boolean
  collection: DocumentsCollection
  queryInput: string
  appliedQuery: string
  view: DocumentsView
  recent: CollectionSlot
  trash: CollectionSlot
  actions: ReadonlyMap<string, DocumentActionState>
  recoveryItems: readonly DraftListRecoveryItem[]
  undo: null | Readonly<{
    kind: "restore"
    documentId: string
    name: string
    expectedRecordVersion: number
  }>
  announcement: string | null
  focusIntent: null | Readonly<{
    id: number
    target: "search" | "collection-heading" | "load-more" | "document"
    documentId?: string
  }>
}>
```

The state keeps active and deleted pages independent. Switching to Trash never
filters an active page and never issues `state: "all"`. The repository calls are
exactly `state: "active"` for Recent and `state: "deleted"` for Trash.

`recoveryItems` is a sticky, deduplicated session inventory. A clean later page
must not erase an earlier quarantine or retained warning. This matches the
approved corruption-list review. Deduplicate quarantined rows by `quarantineId`;
deduplicate retained rows by document ID plus failure kind/message.

### View-state projection

`recent-documents-model.ts` derives these mutually exclusive view states:

- `opening`: no confirmed page and the first request is pending;
- `empty`: confirmed first page has no rows, no cursor, no query, and no
  recovery item that would make "first use" false;
- `recovery_only`: no readable rows but one or more recovery items exist;
- `no_results`: confirmed query returned no rows and no cursor;
- `ready`: confirmed rows with no background work;
- `refreshing`: retained confirmed rows remain visible while a replacement
  first page is pending;
- `loading_more`: confirmed rows remain visible while one cursor request runs;
- `load_more_failed`: confirmed rows and cursor remain visible with a retry
  anchored beside Load more;
- `retained_error`: a refresh failed after a successful page; rows remain
  visible, marked "Last confirmed", with a prominent Retry;
- `terminal_error`: no confirmed rows exist and the request failed;
- provider-owned `blocked`, `unavailable`, and `recovery_required` preempt all
  repository collection states.

An operation failure never becomes an empty state. It remains attached to the
affected card/dialog and can also populate the shared alert region.

## Concurrency and stale-completion rules

### First page, refresh, and retry

Each collection slot has a monotonically increasing replacement generation.
Initial load, query application, collection activation, explicit Retry, focus
refresh, and repository-event refresh all capture:

- controller lifetime generation;
- collection;
- normalized applied query;
- replacement generation.

Only an exact match may replace the slot. A late initial page cannot overwrite a
newer refresh. A late Recent page cannot publish into Trash. A page for an older
query cannot publish after the user types or clears search.

One replacement request per current context runs at a time. An invalidation
during it sets one queued rerun bit. Completion clears the active promise and
runs exactly one rerun if the controller is still active and the context still
matches. Query or collection changes invalidate the old queued rerun rather than
waiting behind it.

When the provider is mounted but Start is not visible, events mark both slots
stale without fetching. `activate()` refreshes the selected slot if it is idle or
stale. `deactivate()` cancels query scheduling and focus ownership but retains
confirmed pages and recovery inventory.

### Load more

Load more captures:

- lifetime and replacement generations;
- collection and applied query;
- the exact base page revision;
- the exact opaque `nextCursor`.

Allow one append per slot. Any refresh, Retry, query change, collection change,
or disposal invalidates it. A late append cannot publish against a replaced
page. A failed append retains rows and the same cursor so Retry repeats the same
request.

Before append, validate that the returned rows:

- match the selected deletion state;
- do not repeat an ID already in the confirmed page or inside the appended page;
- remain in descending `(activityAt, documentId)` order.

An invariant violation does not silently deduplicate or present a broken order.
Keep the prior page, mark it stale, expose a retryable list error, and request a
fresh first page.

### Search

`queryInput` updates synchronously. The controller applies its trimmed value
after 180 ms through the injected scheduler. Enter, Clear, tab change, and route
search restoration apply immediately. Every applied query resets both cursors,
invalidates both slots, and loads only the visible collection.

Search always goes to `repository.list({ state, query, limit, cursor })`. Never
filter only rendered rows. A match after 50 nonmatching metadata records must be
discoverable. Search reads names only because that is the repository's truthful
current contract; the UI copy must say "Search document names", not imply full
text search.

### Repository events

Treat events as invalidation hints only:

- `saved/content_saved`, `saved/opened`, and `saved/publication_linked` stale
  Recent because activity or visible metadata can change;
- `deleted` and `restored` stale both Recent and Trash;
- `quarantined` stales both and adds the recovery descriptor when a subsequent
  list reports it;
- `preview` does nothing in this slice;
- `conflict_resolved` belongs to the later conflict inventory and does not patch
  document metadata here.

Self and foreign events use the same rule. Do not patch event payloads into
cards, because events are not complete summaries. CAS and the next list remain
authoritative. An unavailable or malformed channel changes refresh latency, not
repository correctness.

### Mutations

Claim a synchronous action token per document before the first await. Reject a
second action for that document until the token resolves. Different documents
may mutate concurrently because each operation carries its own CAS token and UI
state.

- Rename submits the exact visible row `recordVersion` and trimmed input. Keep
  the dialog, input, and inline error on validation, conflict, corruption, or
  storage failure. Close only after committed success.
- Duplicate has one synchronous owner. It inserts the exact returned committed
  summary into a loaded matching Recent page, marks both slots stale, and
  announces the created name. It does not copy publication linkage. Navigation
  to the copy belongs to the canonical route slice.
- Move to Trash uses the exact visible `recordVersion`. Remove the card only
  after the repository returns committed success. Store a persistent Restore
  affordance with the returned tombstone version. Never call `purge()`.
- Restore uses the exact tombstone version. After commit, insert the returned
  summary into Recent, switch to Recent, and focus the restored card. Its name
  still matches the shared query because Restore does not rename it.
- Download JSON is the only card action allowed to call `get()`. It does so only
  after direct activation, verifies the exact document ID, and serializes the
  canonical envelope. List load, render, search, and hover never call `get()`.

Late mutation results must match the action token before changing UI state. A
committed result that arrives after controller disposal remains durable, but it
must not navigate, focus, or publish into a dead React tree.

## Pagination and Trash semantics

- Use a page size of 24. It composes cleanly into 1, 2, 3, 4, or 6-column grids
  and stays far below the repository maximum of 100.
- Load more is explicit. Do not auto-fetch from an intersection observer in
  this phase. Explicit pagination is easier to recover, announce, and test.
- `nextCursor` is opaque. The UI never decodes or persists it in a URL.
- A query or collection switch resets pagination. Grid/list switching preserves
  the same loaded rows and cursor.
- Trash is a separate repository query, not client filtering and not
  `state: "all"`.
- Ordinary Delete always means `softDelete`. Trash exposes Restore only in this
  slice. There is no "Delete permanently", retention timer, automatic expiry,
  empty-trash command, or bulk destructive action.
- The persistent undo action calls Restore with the committed tombstone version.
  It remains visible until dismissed, superseded by another completed
  destructive action, or successfully restored. It does not disappear on a
  timer.
- If a repository event invalidates an already loaded multi-page collection,
  refresh replaces it with one freshly confirmed first page. It does not splice
  a new head onto an old tail and pretend the combined order is one snapshot.

## Component composition and accessibility

### Collection header

- `Tabs` exposes Recent and Trash with text labels and `aria-selected` semantics.
- Search has a visible label, `type="search"`, `name="document-search"`,
  `autoComplete="off"`, placeholder `Search document names…`, and a Clear
  button when nonempty.
- Cmd/Ctrl+F prevents browser Find only while Start is active, focuses search,
  and selects the current query.
- Grid/list icon buttons have accessible names and `aria-pressed`. Persist the
  preference under one versioned key such as `webmcp-studio:documents-view:v1`.

### Cards and rows

- Use semantic `<ul>/<li>` collections. The primary Open button is a sibling of
  the overflow menu, never an ancestor. The canonical route slice replaces it
  with a TanStack `Link` without changing card layout.
- The metadata tile is not a thumbnail. It shows a neutral document icon, page
  count, and first-page dimensions derived from `DocumentDraftSummary`. Do not
  draw fake text, fake brand colors, or fake page content.
- Render name, truthful origin label, page/output facts, localized activity time,
  and exact ISO `<time dateTime>`. Use `Intl.DateTimeFormat`, tabular numerals,
  `min-w-0`, and truncation with the complete name available to assistive tech.
- Menu actions have text labels. Decorative icons use `aria-hidden="true"`.
  Hover disclosure must also appear for `focus-within`, open state, and coarse
  pointers. No action is hover-only.
- Controls keep at least 44 by 44 CSS pixels on compact/coarse layouts. Visible
  focus uses the existing Geist ring tokens. Do not remove outlines without a
  replacement.

### States and announcements

- Initial skeletons match the selected grid/list geometry and set `aria-busy`.
  Announce the load once, not once per skeleton.
- Empty Recent offers Create. Empty Trash explains that moved documents appear
  there. No-results preserves the query and offers Clear search.
- A retained refresh error keeps rows visible and names their age as "Last
  confirmed". Retry stays adjacent to the warning.
- Errors use `role="alert"`. Refresh, Load more, move, restore, duplicate, and
  rename completions use one concise `role="status" aria-live="polite"` region.
- Rename uses the shared Dialog primitive. The input has a visible label and
  stable name. Enter submits, Escape cancels and restores persisted text. The
  input may receive initial focus only after the user explicitly invokes Rename;
  Start itself never focuses a text field on compact entry.
- Dialog/menu primitives restore focus to the exact opener on cancel and
  failure. After committed delete, focus moves to the next card, previous card,
  or collection heading. After Restore, switch to Recent and focus the restored
  Open target. Load more keeps focus on its button and announces the added count.

### Long lists

`@tanstack/react-virtual` is already installed. Once more than 48 rows are
loaded, virtualize the collection with a small overscan instead of mounting 100+
interactive cards. The list view has fixed row estimates. The grid view groups
items into virtual rows using the measured container width and the same column
breakpoints as the CSS grid. Keep DOM order equal to visual order. A focus intent
for an unmounted row first scrolls to its index, then focuses after the row
mounts. Pagination remains explicit and independent from virtualization.

Animations may use opacity and transform only, and must honor
`prefers-reduced-motion`. Do not use `transition: all`.

## Integration cutover

Implement in this order:

1. Add the pure controller and deterministic tests against injected repository
   methods. Do not touch Start rendering yet.
2. Add the retained React provider under `/_studio`; prove one controller,
   provider-fanout subscription, cleanup, and StrictMode behavior.
3. Extract `openStoredDocument(documentId)` from the current Continue path. It
   must use the shared session-transition owner currently under independent
   repair. Do not introduce a second transition guard.
4. Replace `StudioStartModel.currentDraft` and `CurrentDraftCard` with the new
   library model/component. Keep provider opening/recovery/blocked/unavailable
   precedence and all existing template/Quick Start behavior.
5. Remove the transitional `refreshReadyList`, `startDocumentIdRef`,
   `deriveRepositoryDraftSummary`, and inactive-document list refresh from
   `useDocumentEditor`. Keep its active-document foreign-event filters until the
   route/session slice moves them.
6. Add inactive actions and exact focus restoration. Remove no repository
   primitive and expose no purge path.
7. Run the focused gates, full Studio suite, typecheck, scoped lint/format, and
   independent code review before beginning the canonical route phase.

Do not temporarily run both the one-card adapter and the new controller. That
would duplicate list calls, subscriptions, warning ownership, and selected-ID
truth.

## Required tests

### Pure controller

- initial active list uses `{ state: "active", query: "", limit: 24 }`;
- Trash uses `state: "deleted"` and never filters an active/all page;
- active and deleted slots retain independent pages and cursors;
- late initial, refresh, Retry, append, older query, older tab, and disposed
  completions cannot publish;
- one active refresh plus one queued rerun under event bursts;
- inactive controller marks stale without fetching and refreshes on activation;
- Load more appends exact order, rejects duplicate/out-of-order rows, and keeps
  the cursor on failure;
- query scheduler, Enter, Clear, route restoration, and a match beyond 50
  nonmatching metadata rows all call repository search rather than local filter;
- `saved` reasons, delete, restore, quarantine, preview, and conflict-resolved
  events produce the exact invalidation behavior above;
- initial failure, retained refresh failure, pagination failure, empty,
  recovery-only, and no-results remain distinct;
- recovery items remain sticky and deduplicated after later clean pages;
- no list/search/render test calls `get()` or any preview method;
- same-tick duplicate action runs once;
- Rename retains input on validation, conflict, corruption, quota, and storage
  failure;
- Move to Trash removes only after commit, stores the returned version for undo,
  and never calls purge;
- Restore uses the tombstone version, switches collection, and targets restored
  focus;
- a late action after dispose performs no navigation, focus, or state publish.

### Model and components

- opening, empty Recent, empty Trash, recovery-only, no-results, ready,
  refreshing, loading-more, load-more failure, retained error, blocked,
  unavailable, and recovery-required render distinct copy/actions;
- every row renders from `DocumentDraftSummary` without a body or fabricated
  preview;
- origin, source, page/output facts, dimensions, long names, and invalid dates
  project truthfully;
- Open and actions menu are sibling interactive elements with accessible names;
- complete keyboard flow for tab, search, grid/list, card, menu, Rename dialog,
  Load more, Move to Trash, undo Restore, and Trash Restore;
- exact focus after cancel, failure, delete, restore, Load more, and collection
  switch;
- status and alert announcements are concise and not duplicated;
- compact classes preserve 44 px targets and every action at 320 and 390 px;
- more than 48 rows uses the virtualized path while maintaining semantic order
  and focus-to-unmounted-row behavior.

### Mounted integration

- the library provider constructs one controller and one provider-fanout
  listener through StrictMode replay and disposes once;
- provider opening, legacy recovery, blocked, unavailable, and ready preempt or
  activate the controller correctly;
- Start and editor visibility deactivate/reactivate refresh without losing
  confirmed pages or recovery inventory;
- selecting any card passes its exact ID to `openStoredDocument`;
- a missing/deleted/corrupt open never substitutes the private starter;
- the old one-card list adapter is absent and only the library controller calls
  `list()`;
- templates, blank, import, sample, and existing recovery flows retain their
  current tests unchanged unless a stronger multi-document assertion replaces
  them.

### Restricted and healthy-browser gates

Restricted-host gates include the new controller/model/component/provider suites,
all repository suites, persistence runtime/provider suites, mounted Start and
persistence suites, Studio typecheck, scoped ESLint/Prettier, `git diff --check`,
and the full Studio Vitest suite.

Healthy-browser acceptance remains mandatory later. It must cover at least 105
equal-time records, Load more without duplicates/skips, another-tab touch and
delete/restore invalidation, real Cmd/Ctrl+F and focus return, 320/390/1280/1440
layouts, 200 percent text zoom, reduced motion, and keyboard-only Recent/Trash
actions. Until those run on an approved host, the honest status is statically
verified, browser acceptance pending.

## Non-goals and rejection rules

This phase must not:

- fabricate a thumbnail, render every body, generate previews on list load, or
  cache preview failures. PERSIST-01C owns stored preview production, revision
  checks, viewport scheduling, object URLs, and stale-preview labels;
- expose `purge()`, permanent delete, empty Trash, retention timers, or automatic
  expiry;
- add bulk delete or bulk restore before transactional and focus semantics exist;
- use localStorage as a recents index or treat view preference as document truth;
- load all bodies, call `getAll()`, decode cursor strings in UI, use offset
  pagination, or filter a mixed page into Trash;
- label storage/list failure as an empty durable workspace;
- patch incomplete BroadcastChannel events directly into canonical cards;
- introduce another repository, migration, event subscription, session-transition
  guard, or route identity;
- claim canonical routing, Back/Forward blocking, active Delete/Rename, conflict
  Reload/Save as copy, or recovery-item raw download as completed here.

Immediate rejection conditions are: a Trash page built by client filtering, a
late request changing a newer query/tab, a Delete path that calls purge, a card
list that reads bodies or invents previews, an operation failure that removes its
card/input, or two simultaneous Start list owners.
