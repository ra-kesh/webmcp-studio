# LIBRARY-02 Gate 6D shared media browser preflight

Date: 2026-08-31

Scope: implementation ownership and interaction planning for Gate 6 Slice D,
with the Slice E handoff boundary recorded so the two slices do not overlap.
This is an implementation preflight, not a completion or acceptance claim.

## Sources reread

- `library-02-gate6-media-integration-map.md`, especially P1.3, P1.4 and
  Slices D/E.
- `media-01-implementation-audit.md`, `media-01-ux-audit.md`,
  `media-01-browser-acceptance.md` and
  `media-01-browser-independent-review.md`.
- Gate 5 discovery, preference and collection controller/provider code and the
  current template browser, including its mounted virtualization and collection
  menu tests.
- The current media dialog and media card, upload, recovery, archive and local
  preview components.
- OpenPencil `src/components/assets-panel/AssetsPanel.vue` and Loora
  `packages/editor/src/components/assets-panel.tsx` plus Loora's stable asset
  URL helper.
- The current Web Interface Guidelines and the React performance guidance used
  by this repository.

The reference repositories remain read-only research material. No reference
code is imported or copied.

## Boundary decisions before implementation

### 1. Media gets one scoped discovery controller

The route-owned discovery controller is mutable: search, entry point, filters,
selection and pagination all belong to one state snapshot. The template browser
now enforces `itemKinds: ["template"]`. A media browser that enforces
`itemKinds: ["media"]` on the same controller instance would make the two
surfaces race whenever both are mounted or retained.

Slice D should therefore use the existing `LibraryDiscoveryController` class,
client semantics and preference invalidation rules through a **separate media
controller instance**. It is one controller for the media surface, not one
controller per tab or source. The existing template controller remains
untouched. Both controller instances consume the same route-owned Gate 5
preference provider.

The media controller must be initialized with `itemKinds: ["media"]` before it
is activated. Do not activate with the default mixed query and then repair the
query in a passive effect.

### 2. Device-local discovery is a bounded overlay, not a server cursor item

The server catalog owns curated and managed cursor ordering. Device-local
items exist only in the browser and cannot be inserted into, counted by or
encoded in that server cursor without creating a second cursor authority.

The media browser composes two retained results:

- the media controller's confirmed or retained server page; and
- one bounded, browser-owned local projection for the active media scope.

Local results render as their own labelled group and are filtered using the
same normalized search and applicable owner/collection scope. They appear
exactly once and are never appended again when the server cursor advances.
`Load more` advances managed/curated results only. Server totals and cursor
announcements remain server totals; the visible header may state the local and
server counts separately rather than inventing one cursor total.

The local list read used by Slice D must be metadata-bounded. Opening or
searching the browser must not call a path that reads or decodes every Blob.
Preview bytes are requested only for near-viewport local cards. This is a
required entry contract for the 1,000-item acceptance case.

### 3. Media identity stays source-aware at the browser edge

Catalog `LibraryItemIdentity` is sufficient for server-owned curated and
managed preference mutations. The browser's selected-media key must additionally
include `mediaSource`:

```text
media:{source}:{id}@{version}
```

This prevents a browser-local ID from being mistaken for a server item with the
same ID and version. Local detail and selection go through the Slice C exact
revision adapter. Curated and managed detail go through the server discovery
client. Slice D does not submit local IDs to Gate 5 favorites or collections.

### 4. Discovery and document mutation remain separate

Slice D may select an item and load source-aware details, but it does not insert,
replace, assign a field, mark an item used or close the dialog. It emits an exact
media intent to Slice E. Slice E rechecks the source, commits one typed document
command, and records Recent only after that command succeeds.

## Code-owner map

| Concern                                       | Existing owner or new Slice D owner                                                                                   | Rule                                                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict media summary/detail schemas           | `packages/document/src/library-catalog.ts` and `library-catalog-projections.ts`                                       | Consume the settled A/B/C contracts; do not add a UI-only parallel media shape.                                                                                                                                  |
| Curated and managed list/detail               | `apps/studio/src/content/library/library-discovery-client.ts`, `library-discovery-adapter.ts`, server catalog service | Preserve exact response parsing, retained-page behavior, cursor invalidation and request cancellation.                                                                                                           |
| Device-local summary/detail                   | `device-local-media-discovery-adapter.ts`                                                                             | Only ready, unarchived, verified revisions; no durable favorite or collection mutation.                                                                                                                          |
| Media controller lifetime                     | New focused `library-media-discovery-provider.tsx` beside the Gate 5 provider                                         | One isolated media controller instance, initialized as media-only, with preference invalidation and Strict Mode-safe retain/release.                                                                             |
| Shared media presentation                     | New `library-media-browser.tsx` beside `library-template-browser.tsx`                                                 | Pure catalog UI and source-aware selection; no document editor imports.                                                                                                                                          |
| Bounded media grid                            | New focused `library-media-collection.tsx`, or a small generic extraction only after identical behavior is proven     | Copy the accepted algorithm, not the 1,793-line template component. Keep focus-aware virtual rows and container-derived columns.                                                                                 |
| Durable preference projection                 | Generalize `library-preference-projection.ts` from template-only input to permitted `LibraryCatalogItemSummary` input | Apply optimistic state only at render; mask favorite/collection state when permissions deny it.                                                                                                                  |
| Collections UI                                | Gate 5 `library-collection-browser.tsx`, preference provider/controller                                               | Reuse checked menu semantics, exact member identity, retry/dismiss and permission-gated New collection.                                                                                                          |
| Preview source derivation                     | New small `library-media-preview.tsx` backed by settled A/B/C content ports                                           | Curated uses the immutable first-party path, managed derives the authenticated same-origin content route, local creates a short-lived object URL near the viewport. Never expose R2 keys or filesystem locators. |
| Existing upload/recovery/archive/promotion UI | `asset-library-dialog.tsx` and `asset-library-components.tsx`                                                         | Read-only during Slice D. Slice E integrates around these workflows without reimplementing or deleting them.                                                                                                     |
| Exact document action                         | Slice E focused media-selection command plus `use-document-editor.ts`                                                 | Source refetch/recheck, one document command, then Recent. Not owned by Slice D.                                                                                                                                 |

## Existing pieces to reuse

Reuse directly:

- `LibraryDiscoveryController` replacement/append/detail cancellation,
  retained-page state, cursor invalidation, announcements and focus intents.
- Gate 5 preference and collection providers, mutation receipts, checked menu
  semantics, retry/dismiss behavior and exact identity projection.
- The template browser's proven container-column calculation, virtualization
  threshold, focus-aware `rangeExtractor`, `aria-posinset`/`aria-setsize` and
  Load-more focus handoff. Extract a small shared primitive only if the template
  mounted tests remain byte-for-byte behaviorally equivalent.
- UI primitives already used by the template browser: native buttons, input
  group, sheet, dropdown menu, checkbox menu item, skeleton, badge and button.
- The existing dialog's upload queue, repository notices, missing-local repair,
  deletion-impact review, promotion control and close guards in Slice E.

Reuse as a behavior reference, not as the new catalog card:

- `AssetCard` proves the required split between the primary selection button
  and the overflow action and already has intrinsic preview dimensions.
- `LocalAssetCard` proves viewport-near object URL creation and cleanup, but it
  is coupled to legacy local summary, archive and promotion behavior and does
  not recheck the expected revision before loading.
- `LoadingGrid`, `RepositoryNotice` and `EmptyCollection` have useful visual
  treatment, but their copy and callbacks are tied to the current dialog.

Do not start Slice D with a broad template-browser refactor. First add the
small media-specific component and tests. Extract a shared primitive only when
the two call sites have identical semantics and the Gate 5 test suite protects
the move.

## Media browser interaction map

```text
open/retain media surface
  -> activate isolated media controller
  -> request curated + managed page from server
  -> request bounded local metadata overlay in parallel
  -> keep last confirmed server/local results while either source refreshes
  -> project Gate 5 preferences onto permitted server items
  -> group source-aware cards without flattening local into server pagination

search/filter/tab change
  -> cancel obsolete server list/detail work
  -> apply the same normalized criteria to the local metadata overlay
  -> preserve the last successful groups during replacement
  -> restore focus to a surviving card, search, Load more or status target

select a server card
  -> request exact curated/managed detail through discovery controller
  -> reject mismatched id/version/source
  -> expose exact intent to Slice E

select a local card
  -> request exact local id + revision through Slice C
  -> reject archived/missing/quarantined/changed bytes
  -> expose exact intent to Slice E

favorite/collection action
  -> render only when the summary permission allows it
  -> submit only curated/managed LibraryItemIdentity to Gate 5
  -> keep local controls absent or disabled with truthful device-only copy
```

The browser should accept a controlled media scope so Slice E can retain the
current shell's clear source model:

- **Recent:** server `recentOnly` plus the bounded local recent group;
- **Uploads:** managed workspace results plus the bounded device-local group;
- **Library:** Studio-owned curated results;
- **Favorites/collection:** server-owned permitted results only.

Search remains scoped to the active view. Upload queue and missing-media
recovery remain visible only where the existing dialog places them; the shared
catalog browser does not own those operations.

## Card and detail contract

Each card is one `article` with:

1. one native primary `button` whose accessible name includes action, name and
   source;
2. a stable aspect-ratio preview with explicit intrinsic dimensions and a
   non-shifting failure fallback;
3. visible name, useful dimensions/size and source label;
4. a separate favorite button only when allowed; and
5. a separate overflow menu for details and permitted collection actions.

Buttons must never be nested. Drag may be added later as an accelerator only;
click, Enter and Space remain complete action paths.

Details show the exact version/revision, source, dimensions, MIME/size,
description, provenance/license/attribution and current preference projection.
They do not show a private R2 key, browser object URL, local database locator or
arbitrary source URL. A detail failure keeps the card and offers Retry.

## Accessibility and keyboard invariants

- All actions use native controls with visible `focus-visible` treatment.
- Every icon-only action has an `aria-label`; decorative icons are hidden.
- Enter submits search, Escape clears a non-empty search before it closes the
  surrounding dialog, and Arrow Down may move from search to the selected card.
- Tab reaches primary card actions, favorites and overflow menus in DOM order.
  Enter/Space activates the primary card action. Complete grid arrow-key
  semantics are optional; partial arrow navigation is not allowed.
- Checked collection membership uses `menuitemcheckbox`, not a decorative
  checkmark. New collection and favorite controls obey permissions.
- Initial load, background update, detail failure, pagination failure and
  preference failure have one concise polite announcement. Failures retain a
  visible Retry and request ID where the existing error contract supplies one.
- Escape and dialog close return focus to the stable opener. Compact layouts do
  not autofocus search or summon the software keyboard.
- Every pointer action has a 44 px minimum project target. The surface remains
  usable at 320 px and 200% zoom without horizontal page overflow.
- The dialog/surface has one vertical scroll owner with contained overscroll;
  sticky controls do not hide focused cards.

## Paging and bounded-render invariants

- Server pages remain at the current maximum of 24 requested items and 50
  schema items. Append accepts only the exact generation, query identity,
  workspace revision, catalog revision and cursor.
- A changed search, source scope, owner, favorite or collection cancels and
  ignores an obsolete append/detail response.
- Device-local items are included once, bounded by the local overlay contract,
  and never alter or repeat a server cursor.
- More than 48 cards use focus-aware row virtualization. The selected and
  focused rows remain mounted long enough for deterministic focus restoration.
- Below the threshold, cards retain `content-visibility: auto` and intrinsic
  containment.
- Curated/managed previews use lazy decoding and explicit dimensions. Local
  Blob reads and object URLs start only inside the viewport margin, are capped
  by the rendered/overscan window, and are revoked when a card leaves that
  window, its revision changes, the query changes or the surface unmounts.
- Search and open never enumerate or decode every local Blob. The 1,000-item
  acceptance must assert both mounted-card and live-object-URL ceilings, not
  only elapsed time.

## Non-overlapping edit sequence

### D0. Freeze the browser ports

1. Add tests for media-only controller initialization and independent template
   and media criteria.
2. Freeze source-aware UI identity and the server-page plus local-group
   composition contract.
3. Freeze a metadata-only local listing port and viewport exact-preview port.

No React surface should be written until these tests make controller scope,
identity collision handling and bounded local reads unambiguous.

### D1. Add the media discovery boundary

1. Add the isolated media provider/controller factory using the current
   controller class and server client.
2. Subscribe it to Gate 5 discovery invalidation without creating another
   preference owner.
3. Add the local overlay owner with abort, retained-result and exact-revision
   detail behavior.

Do not edit `asset-library-dialog.tsx`, `use-document-editor.ts` or StudioShell.

### D2. Add the pure browser

1. Add media filter/source controls, skeleton/failure/empty states and source
   groups.
2. Add source-aware cards, details and permission-gated favorite/collection
   controls.
3. Add the bounded collection grid and local preview lifecycle.
4. Emit selection intents only; no document command.

### D3. Review and checkpoint Slice D

Run focused controller, projection, mounted browser, keyboard, paging and
bounded-preview tests; the full Studio typecheck; scoped lint; and diff check.
Perform independent code review before Slice E opens the overlapping editor
files.

### E0. Implement one exact action boundary

1. Accept the Slice D exact intent.
2. Curated: resolve exact ID/version/content identity.
3. Managed: refetch current workspace-owned row and reject archive or catalog
   version change.
4. Local: recheck exact ID/revision and verified bytes on this device.
5. Commit one insert, replace or field-assignment document command.
6. Record managed/curated Recent with an idempotent completion ID only after
   commit. Update local Recent only through the local repository contract.

### E1. Cut over the existing dialog last

Replace the old six-item curated feed and duplicated result grids with the
accepted shared browser. Preserve upload queue, cancellation/retry, recovery,
archive impact, promotion, storage status, close guards, reference navigation
and focus restoration. Remove compatibility code only after the retained 18
browser journeys and the new cross-source cases pass.

## Required tests

### Pure/controller

- Media and template controllers can be active without changing each other's
  `itemKinds`, search, filters, selection or retained page.
- Initial media request is media-only; no transient mixed request occurs.
- Server replacement/append/detail abort and exact cursor rejection remain
  identical to Gate 5.
- Local overlay is added once, filtered by the applied criteria, retained on a
  recoverable refresh failure and excluded from server total/cursor math.
- Same id/version from local and server remains distinguishable by source.
- Local absent, missing, quarantined, archived and stale revision details fail
  without selecting a newer or different item.
- Preference projection supports media and suppresses favorite/collection state
  and commands when permissions deny them.

### Mounted component

- Initial skeleton, retained update, initial failure, retained failure,
  search-empty, source-empty, detail failure and append failure show truthful
  copy and Retry/Dismiss behavior.
- Primary card, favorite and overflow actions are sibling native controls;
  accessible names include media name and source.
- Collection membership exposes checked menu semantics; local items cannot
  favorite, join a collection or create one from their menu.
- Search Enter/Escape/Arrow Down, card Enter/Space, Load-more focus, pagination
  status focus and detail retry work without a pointer.
- The 48/49 boundary switches from semantic list to virtual rows; selected and
  focused rows survive column changes and append.
- Compact width and 200% zoom keep 44 px controls, one scroll owner and no
  horizontal page overflow.

### Bounded preview

- A 1,000-summary local overlay does not read 1,000 Blobs or mount 1,000 cards.
- Only the viewport/overscan set owns object URLs; leaving the range, changing
  revision/search/scope and unmounting revoke them exactly once.
- Broken curated, managed and local previews keep card geometry and actions.
- Every preview has intrinsic dimensions, lazy loading where applicable and no
  private locator in DOM attributes or accessible copy.

### Slice E integration and regression

- Insert, replace and field assignment for curated, managed and local sources
  each produce one document command and one Undo step.
- Failed/stale source validation produces no document mutation and no Recent
  record.
- A committed action records Recent once across retry/reopen using the original
  card-attempt completion identity.
- Preserve the current 18 MEDIA-01 browser journeys, then add cross-source
  favorites/collections, exact detail mismatch, source-collision, 1,000-item
  bounded rendering and dialog-cutover regressions.

## Reference lessons retained

OpenPencil confirms grouped sources, grid/list density, details, per-item busy
state, keyboard insertion and canvas-centred placement. Studio keeps native
buttons instead of its clickable `div`, and drag remains optional.

Loora confirms one searchable media surface, upload/drop affordances, sorting,
lazy previews, stable identity-derived content routes, per-item busy state and
usage visibility. Studio does not adopt base64 upload, physical delete or a
public locator that bypasses workspace ownership and renderer admission.

Neither reference owns Studio's exact source recheck, immutable publication,
reference-safe archive, device-local recovery, R2 authority or one-command Undo
contract. Those remain with the owners listed above.
