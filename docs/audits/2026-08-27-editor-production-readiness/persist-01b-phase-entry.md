# PERSIST-01B phase entry: routed local document product

Date: 2026-08-28
Status: implementation contract approved for staged delivery

## Outcome

PERSIST-01B turns the existing multi-document IndexedDB repository into the
product the user can actually operate:

- `/` is a durable local document library;
- `/documents/$documentId` is one exact editor session;
- create, template, import, quotation, and duplicate actions create a new record
  before navigation;
- ordinary Delete is recoverable and Trash can restore it;
- every route transition settles and durably flushes the current editor;
- stale saves preserve the user's version and expose real recovery choices.

This is a routing and ownership cutover, not a repository rewrite and not a
visual recents mock. PERSIST-01A already established validated atomic records,
ordered saves, compare-and-swap versions, reasoned invalidation events, and
durable conflict candidates. PERSIST-01B gives those capabilities complete
application owners and truthful UI.

## Evidence used

The implementation contract combines:

- `persist-01-phase-entry.md` and the independently approved PERSIST-01A code;
- `persist-01b-current-code-assessment.md` for current Studio ownership and
  lifecycle gaps;
- `persist-01b-reference-patterns.md` for verified OpenPencil, Loora, Avnac,
  and Canva-clone source patterns;
- `persist-01b-acceptance-plan.md` for risk-ranked executable gates;
- the retained START-01, workflow, architecture, and production-readiness
  audits.

The reference roles are deliberately separate:

- **OpenPencil**: bounded workspace refresh, exact open coordination, and later
  preview scheduling;
- **Loora**: route-keyed identity, controller replacement, ordered pending work,
  explicit conflict, command surfaces, and one operation path for humans and
  automation;
- **Canva**: create-before-navigate and accessible template-led entry;
- **Avnac**: useful card interaction details and persistence shortcuts to
  reject;
- **Studio**: its own quotation/document schema, deterministic multi-page
  composition, local assets, renderer, API, and WebMCP contracts.

No reference implementation is imported or copied.

## Current truth

The repository can already create, save, rename, duplicate, soft-delete,
restore, list, touch, quarantine, retain conflicts, and store previews for many
documents. The application still:

- has only one UI route, `/`;
- projects a 50-item repository list to `items.at(0)`;
- labels that item “Current browser draft” and claims there is only one draft;
- keeps Start, repository migration, list refresh, route-like session state,
  editor history, and save-controller ownership inside `useDocumentEditor`;
- uses an obsolete destructive-replacement warning for new documents;
- has no browser Back/Forward document identity or route blocker;
- exposes conflict warning/download but not Reload saved or Save as copy.

The bridge was correct for PERSIST-01A. Keeping it for 01B would create two
truths: router location and private `sessionMode`.

## Non-negotiable identity contract

| Identity             | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `document.id`        | Stable logical and route identity.                   |
| `document.revision`  | Canonical edit count; may rewind after Undo.         |
| history `snapshotId` | One local editor branch identity.                    |
| `contentSnapshotId`  | Exact validated canonical document content.          |
| `draftSnapshotId`    | Exact document plus source context.                  |
| `recordVersion`      | Monotonic local CAS token for one repository record. |
| `sessionId`          | One open browser-tab save/conflict origin.           |

Route, admitted document, save controller, editor heading, source context, and
publication projection must always name the same `document.id`. No history or
document revision value may substitute for `recordVersion`.

## Target ownership

### Client-only persistence application boundary

A pathless client-only layout owns one repository instance, legacy migration,
repository subscription lifetime, and typed availability state above both UI
routes:

```text
/_studio
  /                         -> document library
  /documents/$documentId    -> exact editor session
```

API routes remain outside this layout. The layout never silently falls back to
memory while claiming durability.

### Document library controller

A framework-independent controller with a thin React adapter owns:

- active and deleted metadata pages and cursors;
- query and grid/list preference;
- loading, retained-page refresh failure, empty, no-match, blocked,
  unavailable, and recovery states;
- one in-flight refresh plus one coalesced rerun;
- request generations and disposal checks;
- inactive Rename, Duplicate, Soft delete, and Restore state keyed by document;
- quarantine inventory and persistent route notices.

It retains complete `DocumentDraftSummary` rows. It never loads every document
body, owns editor history, renders previews, or maintains a second recents
index.

### Document route/session coordinator

The document route validates and admits one exact aggregate before mounting an
interactive editor:

```text
waiting -> admitting -> active -> leaving -> closed
                    \-> missing | deleted | recovery_required | unavailable
active -> external_change | conflict | failed
```

Admission uses a generation token, `get(documentId)`, full resource validation,
and `touchOpened(documentId)` as the final verified read. Only the returned
exact record can create the route-keyed editor session and save controller. A
stale request can never install, touch, navigate, or focus.

Missing, deleted, corrupt, quarantined, invalid, or unavailable targets never
open sample/blank/bootstrap content. They return to `/` once with a typed,
persistent notice and deterministic focus.

### Navigation coordinator

Home, logo, File menu, command palette, browser Back/Forward, another document,
new/template/import/sample creation, active Delete, and conflict resolution all
share one ordered transition:

1. claim a synchronous transition owner;
2. settle or block text, crop, transform, guide, and review modes;
3. capture exact document and source context;
4. await the exact save-controller flush;
5. keep the route and open recovery UI for failure, external change, or
   conflict;
6. allow one router transition;
7. close controller/subscriptions/resources and invalidate late work;
8. admit the target into fresh history, then focus.

TanStack Router's async blocker owns in-app and browser-history transitions.
Native `beforeunload` remains only for unsaved in-memory work; `pagehide` remains
best effort.

## Repository gaps to close first

Three lower-level gaps are blockers for honest UI:

1. **List state**: replace `includeDeleted` at the product boundary with an
   explicit `active | deleted | all` predicate applied before page-limit
   satisfaction. Filtering a mixed page in UI would make Trash incomplete.
2. **Recoverable list corruption**: one invalid metadata row must become a
   typed recovery item or safely quarantined row without hiding every healthy
   document in the page.
3. **Atomic conflict save-copy**: creating the preserved candidate as a new
   document and marking its conflict resolved must be idempotent/atomic. The UI
   cannot claim resolution after only changing a marker.

`purge()` stays unexposed in 01B. Ordinary Delete is always soft-delete.

## Product behavior

### Library

- Metadata renders independently of previews.
- Stable ordering is `activityAt`, then `documentId`, with opaque cursor
  pagination and a bounded page size.
- Search uses the repository metadata contract and works beyond the first
  loaded page.
- Repository events and focus/visibility are refresh hints; CAS remains
  authority.
- Every card/row exposes name, truthful origin/source, page facts, exact
  activity time, Open, Rename, Duplicate, Download JSON, and Move to Trash.
- Trash is requested separately and exposes Restore. No permanent-delete UI is
  present.
- Mutation failures retain the affected card, input, local error, and retry.

### Create and open

- Blank, template, import, quotation, sample, and duplicate all create a durable
  distinct record before navigating.
- Creation failure stays on the current route and never labels unsaved state as
  saved.
- Reopening the active ID focuses it rather than recreating controller/history.
- Rapid opens install only the latest admitted target.
- Successful admission precedes `touchOpened`; a failed touch may degrade
  recency but cannot replace identity.

### Active versus inactive mutation

- Inactive Rename/Delete/Restore/Duplicate use repository CAS through the
  library controller.
- Active Rename is a canonical editor commit followed by its save controller.
- Active Delete settles and flushes, tombstones with the controller's latest
  version, closes, then navigates Home.
- A stale controller can never resurrect a tombstoned record.

### Conflict and external change

The route owns a persistent accessible recovery surface:

- **Download my version** serializes the exact preserved in-memory envelope;
- **Reload saved version** admits the durable head, replaces the session, then
  records resolution;
- **Save my changes as a copy** creates/navigates to the copy before the old
  candidate is resolved.

There is no Overwrite action. Dismissing the surface does not clear the
candidate or resume autosave. A reload must rediscover an unresolved candidate.
Foreign `opened` and `publication_linked` events refresh metadata only. Foreign
content or deletion against the active document never merges silently.

## UI and accessibility contract

The existing Geist-based design language, template browser, Quick Starts,
storage/recovery language, and responsive typography remain. The obsolete
single-card section becomes a real document library.

- Grid and list render the same action model.
- Link/open target and overflow menu are sibling interaction owners.
- Compact widths 320/390 px retain Open, Rename, Duplicate, Delete, Restore,
  Retry, and Load more with 44 px coarse-pointer targets.
- Cmd/Ctrl+F focuses document search.
- Enter commits inline rename; Escape cancels and restores persisted text.
- Focus returns to the source card on failed open, moves deterministically after
  delete/restore, and enters the canvas after successful open/create.
- Loading, refresh, empty, no-match, blocked, unavailable, corrupt/recovery,
  Trash, and conflict states are visually and semantically distinct.

01B uses a truthful deterministic metadata placeholder or a valid stored
preview only. Preview production, scheduling, object URLs, and stale-image
semantics remain PERSIST-01C.

## Delivery slices

1. **Repository contract closure**: active/deleted pagination, recoverable list
   corruption, atomic conflict save-copy, and deterministic tests.
2. **Persistence boundary and library controller**: one repository lifecycle,
   real paginated metadata, ordered/coalesced refresh, quarantine inventory.
3. **Recent/Trash product UI**: search, Load more, grid/list, full inactive CRUD,
   compact and keyboard behavior.
4. **Canonical document route**: exact admission, typed redirect notices,
   get/touch race safety, route-keyed session, focus.
5. **Editor ownership cutover**: `useDocumentEditor` consumes an admitted record;
   migration/list/Start/Continue/private `sessionMode` leave the hook.
6. **Navigation ownership**: settle/flush/block/close for every route transition;
   destructive replacement language is removed.
7. **Conflict and recovery product UI**: reload, atomic save-copy, download,
   foreign delete/content, reload persistence, compact parity.
8. **Bridge removal and complete gates**: remove only proved-obsolete code,
   regenerate the TanStack route tree through its generator, and run all static
   and healthy-browser acceptance.

Each slice must reread this phase entry and the directly relevant reference
files before implementation. Each slice is independently tested and reviewed
before the next begins.

## Acceptance rule

No slice is complete because it renders once. Completion requires its risk
matrix from `persist-01b-acceptance-plan.md`, including deterministic deferred
race tests, typecheck, focused lint/format, and an independent code review.

On this restricted host, Vitest/typecheck/lint/format gates run first. Vite,
browser, build, Playwright, and Wrangler are not started here. The final status
therefore remains **statically verified; healthy-browser acceptance pending**
until the full 320/390/1280/1440, keyboard, Back/Forward, two-tab IndexedDB,
blocked-upgrade, and quota journeys pass on an approved healthy host.

## Explicit exclusions

PERSIST-01B does not include renderer-derived recent previews, preview queues,
retention/expiry/permanent-delete policy, storage estimates, D1 draft heads,
authentication/workspace ownership, cloud merge, offline outbox, presence,
operation rebase, or collaborative editing.

It also does not collapse local save state into publication sync. A document
may be locally durable while its published revision is stale; the UI must keep
those truths separate.
