# PERSIST-01B reference patterns: documents, recents, routes, and conflicts

Date: 2026-08-28

Status: reference study complete. This document contains no production-code
changes.

## Purpose

PERSIST-01B turns the single current-draft start experience into a real local
document product. The target is not a file picker attached to the editor. It is
a trustworthy document workspace with canonical routes, bounded recents,
recoverable destructive actions, exact open behavior, and visible conflict
resolution.

This memo records patterns verified in the actual OpenPencil, Loora, Avnac, and
Canva-clone code. It maps them to WebMCP Studio's existing PERSIST-01A
repository. README claims are not used as implementation evidence.

## Reference checkouts and inspected code

The reference checkout root is:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors`

### OpenPencil

Checkout: `open-pencil`

Inspected files:

- `src/components/home/HomeWorkspace.vue`
- `src/app/recent-files/store.ts`
- `src/app/recent-files/thumbnails.ts`
- `src/app/storage/workspace/source.ts`
- `src/app/storage/workspace/events.ts`
- `src/app/storage/local-store/types.ts`
- `src/app/storage/local-store/store.ts`
- `src/app/storage/local-store/idb.ts`
- `src/app/storage/local-store/meta.ts`
- `src/app/storage/reconcile.ts`
- `src/app/tabs/index.ts`
- `src/app/shell/menu/files.ts`
- `src/App.vue`
- `packages/vue/src/document/workspace/use.ts`
- `packages/vue/src/document/workspace/previews.ts`
- `tests/engine/app/recent-files/store.test.ts`
- `tests/engine/app/storage/local-store.test.ts`
- `tests/engine/vue/document-workspace.test.ts`
- `tests/e2e/app/recent-files.spec.ts`
- `tests/e2e/storage/workspace.spec.ts`

### Loora

Checkout: `loora`

Inspected files:

- `packages/shell/src/components/designs-dashboard.tsx`
- `packages/shell/src/components/designs-dashboard.test.tsx`
- `packages/shell/src/components/design-thumbnail.tsx`
- `packages/shell/src/components/app-navigation.tsx`
- `packages/shell/src/components/app-page-shell.tsx`
- `apps/web/src/routes/app.index.tsx`
- `apps/web/src/routes/design.$id.tsx`
- `apps/web/src/routes/design.$id_.b.$branchId.tsx`
- `apps/web/src/routes/app.design.tsx`
- `packages/editor/src/components/app.tsx`
- `packages/editor/src/lib/canvas-client.ts`
- `packages/editor/src/lib/designs.ts`

### Avnac

Checkout: `avnac`

Inspected files:

- `frontend/src/lib/avnac-editor-idb.ts`
- `frontend/src/lib/avnac-document-preview.ts`
- `frontend/src/routes/files.tsx`
- `frontend/src/routes/create.tsx`
- `frontend/src/components/file-grid-card.tsx`
- `frontend/src/components/file-grid-preview.tsx`
- `frontend/src/components/new-canvas-dialog.tsx`

### Canva clone

Checkout: `canva-clone-fabric`

Inspected files:

- `src/app/(dashboard)/page.tsx`
- `src/app/(dashboard)/projects-section.tsx`
- `src/app/(dashboard)/templates-section.tsx`
- `src/app/api/[[...route]]/projects.ts`
- `src/features/projects/api/use-get-projects.ts`
- `src/features/projects/api/use-create-project.ts`
- `src/features/projects/api/use-delete-project.ts`
- `src/features/projects/api/use-duplicate-project.ts`
- `src/features/projects/api/use-update-project.ts`

The separate `avnac-studio` checkout did not add a more useful PERSIST-01B
documents or recents implementation than Avnac's current `frontend` code, so it
is not used as an authority here.

## Governing Studio facts

PERSIST-01A already provides the important storage invariants. PERSIST-01B must
consume them instead of creating a second recents database or a UI-owned cache
of canonical state.

The existing implementation is in:

- `apps/studio/src/features/editor/document-draft-repository.ts`
- `apps/studio/src/features/editor/document-draft-save-controller.ts`
- `apps/studio/src/features/editor/use-document-editor.ts`
- `apps/studio/src/features/editor/studio-start-model.ts`
- `apps/studio/src/features/editor/studio-start-surface.tsx`

`DocumentDraftSummary` already carries document identity, record version,
content and draft snapshot IDs, saved/opened/activity timestamps, deletion
state, page facts, source kind, origin, encoded size, export formats, and
publication linkage. The repository already exposes typed read, list, create,
save, rename, duplicate, soft-delete, restore, conflict, quarantine, preview,
and publication-link behavior.

PERSIST-01B therefore needs an application controller and routes around this
repository. It does not need a new persistence abstraction.

## Reference conclusions

### 1. The document list is a metadata workspace, not a collection of bodies

OpenPencil's current workspace code separates listing, previews, and opening:

- `packages/vue/src/document/workspace/use.ts` owns list loading, refresh,
  errors, queued invalidation, focus refresh, and disposal.
- `packages/vue/src/document/workspace/previews.ts` owns viewport-aware preview
  work with independent concurrency and cancellation.
- `src/components/home/HomeWorkspace.vue` renders loading, error, empty,
  no-match, grid, and list states without requiring previews to finish.

This separation is the correct pattern for Studio. The start route should call
`DocumentDraftRepository.list()` and render `DocumentDraftSummary` values. It
must not call `get()` for every card. Document bodies remain unopened until the
user chooses a document or a later preview job explicitly needs one.

The older OpenPencil `src/app/recent-files/store.ts` is a pointer list for local
paths and storage providers. Its move-to-front deduplication is sound for file
history, but Studio's IndexedDB records are already canonical. Building a
second localStorage list would introduce stale identities and two competing
sort orders.

Studio adaptation:

- Use repository `activityAt` plus `documentId` as the stable recency order and
  cursor.
- Keep a bounded page in memory and expose `Load more` or incremental fetch.
- Search through repository metadata. Do not load bodies to search.
- Represent list loading, storage unavailable, storage blocked, corrupt
  metadata, empty, ready, and search-no-match as distinct states.
- A preview failure must affect only that card. It must not fail or delay the
  metadata list.

### 2. Refresh is a controller responsibility with coalescing

OpenPencil's `packages/vue/src/document/workspace/use.ts` prevents overlapping
refreshes and allows one queued rerun. It refreshes on focus, online state,
interval, and source invalidation, then removes every listener on dispose.
`src/app/storage/workspace/events.ts` isolates listener exceptions so one
consumer cannot break the source.

Studio should adopt the same controller shape, with a smaller local-first event
set:

1. Initial repository list.
2. Repository subscription invalidation.
3. Window focus or `visibilitychange` to visible.
4. A direct refresh after a successful local mutation.

One refresh may run at a time. An event during that refresh sets a rerun flag.
The controller must discard results after disposal or after its generation no
longer matches the mounted route.

BroadcastChannel messages are refresh hints. They must never directly patch a
record version, clear a conflict, or overwrite a card. Repository compare and
swap remains authoritative.

Do not adopt OpenPencil's periodic network refresh for local-only PERSIST-01B.
Add it only when cloud synchronization exists.

### 3. Canonical routes own editor identity

Loora's route files demonstrate the right identity boundary:

- `apps/web/src/routes/design.$id.tsx` uses `/design/$id` and keys the editor by
  target ID.
- `apps/web/src/routes/design.$id_.b.$branchId.tsx` expands the key when branch
  identity is part of the target.
- `apps/web/src/routes/app.design.tsx` redirects a legacy query route to the
  canonical path with history replacement.
- `packages/editor/src/components/app.tsx` validates a requested target before
  installing it, uses cancellation for stale async work, and closes the prior
  controller after replacement.

Studio's canonical routes should be:

- `/` for the document workspace.
- `/documents/$documentId` for one document editor session.

Do not use a mutable global `currentDocumentId`, query-string identity, or a
private bootstrap record as route truth. A route ID that is missing, deleted,
or quarantined returns to `/` with a persistent, exact error. It never opens a
sample and never creates a blank document under that ID.

The editor subtree should be keyed by `documentId` or otherwise receive an
equivalent explicit session reset. The implementation must prove that history,
selection, Fabric objects, crop state, pending async jobs, save controller, and
asset object URLs belong only to that route target.

### 4. Opening is an admission transaction, not navigation followed by hope

OpenPencil's `src/app/tabs/index.ts` deduplicates concurrent opens by source
identity, reuses an already open target, and remembers the item only after the
open succeeds. If a new tab was created for a failed open, only that new tab is
closed. Existing working state is preserved.

Loora's `packages/editor/src/components/app.tsx` fetches and validates the new
target before replacing its current controller. It also guards async route work
with cancellation.

Studio needs the same ordering, adjusted for a single route-based editor:

1. Set an operation token for the requested `documentId`.
2. Read and validate the repository aggregate.
3. Refuse missing, soft-deleted, quarantined, or storage-failed reads with exact
   UI.
4. Settle any active Fabric text, crop, drag, or transform in the old session.
5. Flush the old save controller and require a durable non-conflicted result.
6. Close the old controller, subscriptions, preview URLs, and async jobs.
7. Install the new record into fresh editor history.
8. Call `touchOpened` only after successful installation.
9. Navigate or complete navigation, then focus the canvas or selected card.

Any stale operation token must stop without installing, touching, or focusing.
A repeated open of the active ID should focus the editor, not reconstruct it or
create another controller.

The Avnac route in `frontend/src/routes/create.tsx` is a warning. It treats a
missing record as a current document and can proceed toward a blank editor. Its
new-file flow navigates with a generated ID before the canonical record is
known to exist. Studio must create durably first and navigate second.

### 5. Create and template actions create a record before entering the editor

The Canva clone's `src/app/(dashboard)/templates-section.tsx` posts a complete
template-derived project, waits for the server result, then navigates to its
editor ID. `src/app/api/[[...route]]/projects.ts` creates a canonical row and
returns its assigned identity. This order is correct even though the clone's
schema and error handling are not sufficient for Studio.

Loora's `packages/editor/src/lib/designs.ts` follows the same basic rule with a
client-generated stable ID.

Studio create flow:

1. Build and validate the complete Studio envelope.
2. Call repository `create()` with a new document ID and exact origin.
3. If the result is durable, navigate to `/documents/$documentId`.
4. If storage is unavailable, either remain on `/` with a truthful session-only
   decision or enter an explicitly session-only editor. Never label it saved.
5. If creation collides, generate a new ID and retry as a new user action. Do
   not overwrite.

Template creation copies the selected template's actual document, identity
rules, source context, and version. It must not open a visual mock or a shared
mutable template record.

### 6. List mutations must retain recovery context

Loora's `packages/shell/src/components/designs-dashboard.tsx` offers create,
rename, archive, restore, and permanent deletion. Its ordinary destructive
action is archive. Permanent deletion appears only in the archived view and
requires specific confirmation. This is the right product distinction.

Studio mapping:

- Rename uses repository `rename(documentId, expectedRecordVersion, name)`.
  Because the canonical `Document.name` changes, it is a body save, not a
  metadata-only patch.
- Duplicate uses repository `duplicate()`, receives the newly persisted ID,
  then adds or focuses that card. Opening the copy is an explicit product
  choice, not an accidental side effect.
- Delete uses `softDelete()` and removes the card from the default recents view
  only after commit.
- Restore is available in a Trash or deleted-documents view and uses the exact
  current record version.
- Purge is a separate later action with explicit unrecoverable wording. It must
  not be the default Delete command.

Each mutation needs an operation-local pending state. A failed rename keeps the
input and error visible. A failed duplicate keeps the source card. A failed
delete keeps the card and selection. A failed restore keeps the item in Trash.
Global toasts may supplement these states but cannot replace them.

The Canva clone uses server mutations followed by broad query invalidation.
That is acceptable as a refresh hint, but its immediate hard delete and generic
toast errors are not acceptable Studio behavior. Its offset pagination ordered
only by `updatedAt` is also unstable when rows change or timestamps tie.

Avnac labels the menu action `Move to trash`, but
`frontend/src/lib/avnac-editor-idb.ts` immediately deletes the record and
auxiliary vector-board storage. That mismatch is specifically forbidden.

### 7. Conflict is an editor state with two preserving exits

Loora's `packages/editor/src/lib/canvas-client.ts` has explicit `conflict`
status. It serializes pending operations before network work, prevents normal
flush while conflicted, persists remaining work after acknowledgements, and
does not let network failure erase pending edits. These are strong architecture
patterns for later cloud synchronization.

PERSIST-01B is simpler because Studio already stores whole-snapshot conflict
candidates. The visible dialog must be driven by the save controller and
repository conflict result, not by BroadcastChannel delivery.

Required choices:

1. `Reload saved version`. Re-read the durable head, replace the editor only
   after successful admission, reset history, then resolve the candidate.
2. `Save my changes as a copy`. Create a new document from the preserved
   candidate, navigate to its new route, then resolve the old candidate.

The candidate remains downloadable until one preserving resolution commits.
Closing the dialog does not resume autosave. Reloading the page must restore a
visible unresolved-conflict state from the repository.

If another tab soft-deletes an active document, the active editor enters
conflict and may not resurrect the ID. If another tab saves a clean inactive
card, the workspace refreshes metadata. If another tab saves the active dirty
document, the current tab keeps its in-memory branch and the next compare and
swap produces the candidate.

Do not port Loora's operation rebase into PERSIST-01B. Studio's current contract
is whole-document compare and swap. Rebase is a later collaboration design,
not a shortcut around conflict UX.

### 8. Route blockers depend on local durability, not generic navigation

Loora calls flush before switching designs, renaming, or archiving. Its pending
queue is target-keyed and already durable in IndexedDB, so it can tolerate some
offline navigation that Studio cannot yet treat the same way.

Studio must block route exit while the local save state is `saving`, `failed`,
or `conflict`. The blocker should settle active Fabric work and attempt an exact
flush. The user may continue only after a durable success or an explicit
recovery action such as downloading the in-memory version.

Use the native `beforeunload` prompt only when unsaved in-memory work remains.
Modern browsers ignore custom prompt text. `pagehide` is a final best-effort
flush or persistence signal, not evidence of successful durability.

### 9. The workspace needs complete, non-overlapping UI states

Useful behavior appears in both OpenPencil's `HomeWorkspace.vue` and Loora's
`designs-dashboard.tsx`:

- loading placeholders that preserve the future layout;
- a load error with a real retry action;
- a first-use empty state with a primary Create action;
- a separate search-no-match state that preserves the query and offers Clear;
- grid and list modes with a persisted preference;
- direct card or row navigation plus a separate actions menu;
- keyboard search focus with Cmd/Ctrl+F;
- exact active-route links and focus-visible controls;
- an archived view loaded only when requested.

Studio should add the same states without copying their visual systems. Use the
existing Studio and Geist decisions, token scale, controls, and start-page
composition.

Required workspace state shape:

```ts
type DocumentsWorkspaceState =
  | { status: "loading"; retainedPage?: DraftListPage }
  | { status: "storage_unavailable"; message: string }
  | { status: "corrupt"; message: string; recoveryAvailable: boolean }
  | { status: "empty" }
  | {
      status: "ready"
      page: DraftListPage
      query: string
      view: "grid" | "list"
      refreshing: boolean
    }
```

`retainedPage` may keep cards visible during a background refresh, but it cannot
be presented as freshly confirmed after a storage failure. The warning and
retry remain visible.

### 10. Card semantics must be precise

Avnac's `frontend/src/components/file-grid-card.tsx` provides useful interaction
details:

- the preview and title are both clear open targets;
- the actions menu is separate from navigation;
- menu and selection controls remain keyboard reachable even when visually
  hidden until hover;
- Escape closes the menu;
- dimensions and modified time use tabular numerals;
- multi-selection is explicit and has a bulk-action bar.

Studio should use the first five patterns. Bulk selection is optional for this
phase because the repository contract is record-oriented and bulk recovery
semantics have not been specified.

Every Studio card should expose:

- document name;
- truthful source label such as quotation, template, import, duplicate, or
  blank;
- page count and first-page dimensions;
- last activity or last opened time with an exact date in accessible text;
- save, conflict, deleted, or recovery status when applicable;
- Open as the primary action;
- Rename, Duplicate, Download JSON, and Move to Trash in the action menu.

A whole-card link overlay, as used by Loora, is acceptable only if nested action
controls remain valid HTML, independently focusable, and never trigger
navigation.

### 11. Preview architecture remains PERSIST-01C

The references reinforce the need to defer previews rather than improvise them
inside PERSIST-01B:

- OpenPencil's `packages/vue/src/document/workspace/previews.ts` uses
  IntersectionObserver, near-visible scheduling, bounded concurrency, queued
  work deduplication, generation checks, and object-URL cleanup.
- Loora's `design-thumbnail.tsx` keys cached previews by design revision and
  lazy-loads them.
- Avnac's `file-grid-preview.tsx` loads the full body for every mounted card,
  renders a data URL, and relies on a small in-memory cache.

PERSIST-01B cards may use a deterministic placeholder or an already valid
repository preview. They must not generate every preview during the metadata
list request. PERSIST-01C should implement OpenPencil-style bounded scheduling
against `DocumentDraftRepository.getPreview()` and its renderer revision.

Do not copy the Loora or Avnac full-body thumbnail approach. It makes list cost
proportional to complete document size, couples list reliability to rendering,
and creates avoidable memory pressure. Do not cache preview failure forever.

## Anti-patterns to reject explicitly

| Reference behavior                                                       | Why it is unsafe for Studio                               | Required Studio behavior                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| OpenPencil recent-path list as a second localStorage index               | Canonical records and display order can diverge           | List `DocumentDraftSummary` directly from IndexedDB                                      |
| OpenPencil silently falls back to an in-memory local store               | UI may imply durability that does not exist               | Expose session-only or storage-unavailable state truthfully                              |
| OpenPencil removes a recent pointer after any open error                 | Transient and recoverable failures are treated as absence | Preserve the record and show typed missing, corrupt, deleted, or storage errors          |
| OpenPencil's desktop tabs and file/provider identity                     | Studio is a routed web app with repository document IDs   | One route-bound editor session at `/documents/$documentId`                               |
| OpenPencil metadata sorted only by `updatedAt` in some store paths       | Ties and concurrent mutation destabilize traversal        | Use `activityAt + documentId` cursor already defined by PERSIST-01A                      |
| Loora loads all designs into one unbounded client list                   | Local repositories can grow without bound                 | Use repository cursor pagination, maximum 100 per page                                   |
| Loora dashboard has one global mutation error and often closes dialogs   | The failed item and user input lose context               | Keep local input, local error, and retry action with the affected item                   |
| Loora thumbnail fetches the complete document                            | Recents become body and renderer bound                    | Read metadata first; use stored preview jobs later                                       |
| Loora transaction rebase copied into local snapshot saves                | It changes the conflict model without a product contract  | Keep whole-snapshot CAS and visible candidate resolution                                 |
| Canva clone immediately deletes projects                                 | No restore or conflict-safe tombstone                     | Soft-delete first, restore from Trash, purge separately                                  |
| Canva clone offset pagination by `updatedAt`                             | Inserts, deletes, and ties can skip or repeat rows        | Stable repository cursor                                                                 |
| Canva clone broad generic toast errors                                   | Failure is not anchored to the operation                  | Persistent local error plus optional toast                                               |
| Avnac navigates before a new record exists                               | A route can become an accidental blank or false save      | Create durably, then navigate                                                            |
| Avnac treats a missing route record as a current document                | Missing identity can silently become new content          | Return to `/` with exact persistent error                                                |
| Avnac rename is fire-and-forget                                          | UI may show a name that did not persist                   | Await typed CAS result and retain failed input                                           |
| Avnac `Move to trash` permanently deletes                                | Label and recoverability disagree                         | Soft-delete ordinary action                                                              |
| Avnac list reads every full document with `getAll()`                     | List latency and memory scale with body size              | Metadata-only indexed list                                                               |
| Avnac duplicate spans IndexedDB and localStorage without one transaction | Partial copy can exist                                    | Duplicate the canonical document atomically; treat assets by their own explicit contract |

## PERSIST-01B implementation contract

### Documents workspace controller

Create a controller or hook whose only durable dependency is
`DocumentDraftRepository`. It owns:

- current list page and cursor;
- query and grid/list preference;
- loading, refreshing, typed failure, empty, and no-match derivation;
- one in-flight refresh plus one queued rerun;
- repository subscription and focus invalidation;
- operation state keyed by document ID and action;
- disposal and async generation checks.

It does not own document bodies, save controllers, editor history, Fabric, or
preview rendering.

### Route entry

Route entry for `/documents/$documentId` must:

1. validate the route parameter;
2. show a stable loading shell;
3. `get()` and validate the exact aggregate;
4. reject missing, deleted, corrupt, quarantined, and unavailable states;
5. install a fresh `useDocumentEditor` session tied to that record;
6. call `touchOpened()` only after installation;
7. focus the canvas after the route commits.

The editor title, source context, publication link, and save controller identity
must all come from the admitted record. A stale async load cannot overwrite a
newer route.

### Route exit

Before Home, browser Back, another card, Create, Import, or template selection
replaces an editor session:

1. commit active Fabric text and transforms;
2. capture the current document into its controller;
3. flush;
4. block on failed or conflict status;
5. close subscriptions, controller, object URLs, and async coordinators;
6. navigate only after the exit decision is final.

Same-tick duplicate critical actions must be rejected by a synchronous dispatch
guard. Buttons should be disabled while the accepted action is pending.

### Mutation result handling

Every repository result is typed and must be handled exhaustively:

- `saved` or equivalent success updates the exact card from returned summary;
- `unchanged` keeps the card and clears pending state;
- `conflict` opens the preserving conflict UI;
- `deleted` moves the item to Trash and never recreates it;
- `missing` removes only after a confirming refresh and shows what disappeared;
- `corrupt_record` retains recovery access and quarantine ID;
- `validation_failed` retains user input and points to the field or action;
- `storage_unavailable` retains the last confirmed list with a prominent stale
  warning and retry.

### Focus and keyboard behavior

- Cmd/Ctrl+F focuses document search when `/` is active.
- Escape closes a card menu, cancels inline rename, or clears selection in that
  order.
- Enter commits inline rename; Escape restores the persisted name.
- After Create or Open, focus enters the canvas.
- After failed Open, focus returns to the triggering card and the error is
  announced.
- After Delete, focus moves to the next card, previous card, or Create action.
- After Restore, focus moves to the restored item in the appropriate list.
- Route and menu controls expose visible focus and meaningful accessible names.

## Required executable coverage

The following tests should gate PERSIST-01B:

### Workspace list

- metadata renders before any preview resolves;
- stable ordering with identical `activityAt` values;
- pagination does not skip or duplicate document IDs;
- loading, blocked, unavailable, corrupt, empty, ready, and no-match states;
- Cmd/Ctrl+F and persisted grid/list preference;
- repository events coalesce to one active refresh and one rerun;
- late refresh after disposal cannot update UI;
- a preview failure affects one card only.

### Create and open

- blank, template, import, duplicate, and quotation records exist before route
  navigation;
- repeated open of the active ID does not recreate editor/controller history;
- two rapid open requests install only the latest accepted target;
- failed open preserves the current editor and focuses the source card;
- missing, deleted, quarantined, corrupt, and unavailable route targets never
  open bootstrap or sample content;
- successful install precedes `touchOpened`;
- a failed `touchOpened` reports degraded recency but does not discard a valid
  admitted editor.

### Rename, duplicate, delete, and restore

- rename uses expected record version and retains input on failure;
- duplicate creates a new ID, resets document revision, preserves nested IDs,
  source context, and valid assets, and clears publication linkage;
- concurrent mutation produces conflict instead of overwriting;
- soft delete removes from default recents and appears in Trash;
- restore returns it without changing its document body;
- stale save after delete cannot resurrect it;
- ordinary Delete never purges body, preview, or recovery data.

### Navigation and conflict

- Home, browser Back, card Open, Create, Import, and template selection settle
  and flush the active editor;
- navigation remains blocked for saving, failed, and conflict states;
- native unload protection appears only for unsaved in-memory work;
- conflict candidate survives reload and remains downloadable;
- Reload saved version installs the exact durable head, then resolves;
- Save my changes as a copy creates and navigates to the copy before resolving;
- external save refreshes a clean inactive card;
- external save against an active dirty editor never merges silently;
- external soft delete cannot be undone by autosave;
- BroadcastChannel absence or failure changes freshness latency only, never CAS
  correctness.

## Deferred work

PERSIST-01B should leave these concerns behind explicit seams:

- PERSIST-01C stored preview generation, viewport scheduling, renderer revision,
  and stale preview replacement;
- server mirrors, authentication, D1 schema, remote list merge, offline queues,
  and realtime presence;
- transaction rebase or collaborative editing;
- bulk destructive actions unless transactional and recovery semantics are
  specified;
- permanent purge UI;
- cross-device cloud recents.

The local workspace, routes, and conflict behavior must be complete without any
of them. Cloud sync can later project onto the same `documentId`, local record
version, tombstone, and conflict boundaries without changing what the user
believes was saved.

## Final recommendation

Use OpenPencil as the reference for workspace-controller lifecycle, bounded
refresh, open coordination, and later preview scheduling. Use Loora as the
reference for canonical route identity, target replacement, explicit conflict,
and pending-work preservation. Use the Canva clone only for the durable
create-before-navigate order. Use Avnac for card interaction details and as a
catalog of persistence shortcuts to avoid.

The result should feel like a document application, not an editor with a recent
file widget. The start page is the durable document workspace; the route is the
document identity; IndexedDB is the local source of truth; and every conflict or
failure must preserve the user's work before it tries to simplify the UI.
