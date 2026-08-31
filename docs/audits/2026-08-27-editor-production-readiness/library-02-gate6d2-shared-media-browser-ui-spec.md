# LIBRARY-02 Gate 6D2 shared media browser UI preflight

Date: 2026-08-31

Status: **preflight only; no implementation or acceptance claim**

Scope: the pure shared media browser planned for Gate 6 Slice D2. This file
freezes the presentation boundary after D0/D1 discovery ownership and before
Slice E opens the editor dialog, document-command, upload, archive, recovery,
or promotion owners.

## Sources reread

- `library-02-gate6d-shared-media-browser-preflight.md` and the settled Gate 6
  A/B/C contracts.
- Gate 5 discovery, preferences, collections, template browser, mounted
  virtualization tests, and current D0/D1 media controller/provider work.
- `media-01-ux-audit.md`, `media-01-browser-acceptance.md`, the current asset
  library dialog, media cards, upload queue, recovery, archive, promotion, and
  local preview lifecycle.
- OpenPencil
  `outputs/reference-repos/editors/open-pencil/src/components/assets-panel/AssetsPanel.vue`
  and `AssetThumbnail.vue`.
- Loora
  `outputs/reference-repos/editors/loora/packages/editor/src/components/assets-panel.tsx`.
- Existing Studio UI primitives under `packages/ui/src/components`, especially
  tabs, input group, sheet, dropdown menu, skeleton, badge, and button.

Reference repositories remain read-only research. No reference code is copied
or imported.

## Frozen D2 boundary

### Controlled scope

```ts
export type LibraryMediaScope =
  | Readonly<{ kind: "recent" }>
  | Readonly<{ kind: "uploads" }>
  | Readonly<{ kind: "library" }>
  | Readonly<{ kind: "favorites" }>
  | Readonly<{
      kind: "collection"
      collectionId: string
      label: string
    }>
```

The scope-to-query projection has one owner and is tested as an exact mapping:

| Scope      | Server controller criteria                               | Local overlay      |
| ---------- | -------------------------------------------------------- | ------------------ |
| Recent     | `entryPoint: "recent"`, no owner or collection filter    | Recent local items |
| Uploads    | `entryPoint: "all"`, `ownerKinds: ["workspace"]`         | Device-local items |
| Library    | `entryPoint: "featured"`, `ownerKinds: ["studio"]`       | Excluded           |
| Favorites  | `entryPoint: "favorites"`, no owner or collection filter | Excluded           |
| Collection | `entryPoint: "all"`, exact `collectionId`                | Excluded           |

Every query retains exact `itemKinds: ["media"]`. Applying an initial scope
must happen before the media lease activates, so the browser cannot issue a
transient request for the wrong source scope. Search is owned by the media
controller and remains scoped to the active view.

### Exact selection intent

```ts
export type LibraryMediaIntent = Readonly<{
  itemKind: "media"
  id: string
  version: number
  mediaSource: "curated" | "managed" | "local"
  selectionIdentity: LibraryMediaDetail["selectionIdentity"]
}>
```

D2 loads and validates exact detail before emitting this intent. Slice E still
rechecks the source at the document action boundary. A card never emits a list
summary as authority.

### Browser props

```ts
export type LibraryMediaBrowserProps = Readonly<{
  visible?: boolean
  density?: "comfortable" | "compact"
  scope: LibraryMediaScope
  action: "insert" | "replace" | "assign_field"
  targetName?: string
  actionsEnabled?: boolean
  pendingIdentity?: string | null
  actionError?: string | null
  onScopeChange: (scope: LibraryMediaScope) => void
  onSelect: (intent: LibraryMediaIntent) => void
}>
```

The browser is a catalog surface. It imports no editor document, Fabric,
StudioShell, upload, archive, recovery, or promotion owner.

## Smallest implementation file set

### New production files

1. `apps/studio/src/content/library/library-media-browser.tsx`
   - Controller binding, controlled source scope, search/filter/status UI,
     source groups, cards, detail sheet, preferences, and exact intent emission.
2. `apps/studio/src/content/library/library-media-collection.tsx`
   - Container-derived columns and the accepted 48/49 focus-aware row
     virtualization algorithm only.
3. `apps/studio/src/content/library/library-media-preview.tsx`
   - Curated/managed exact same-origin preview derivation and viewport-scoped
     local Blob/object-URL lifecycle.

### Focused existing-file changes

- `library-preference-projection.ts`
  - Generalize effective preference projection from template summaries to
    permitted catalog media summaries while preserving `canFavorite` and
    `canAddToCollection` masking.
- D0/D1 local preview port and provider public API
  - Supply exact, abortable local preview bytes without letting D2 import the
    editor-local store.
- `apps/studio/src/content/library/index.ts`
  - Export the accepted public browser boundary.

Do not refactor the 1,793-line template browser in D2. Copy its accepted
algorithm into the focused media collection first. Extract a generic primitive
only after both call sites have identical semantics and mounted coverage.

## Surface hierarchy and editor density

The root is one `section` with `flex h-full min-h-0 flex-col overflow-hidden`.
It has one vertical scroll owner with contained overscroll. The eventual Slice
E dialog must not wrap the browser in a second `ScrollArea`.

The vertical hierarchy is fixed:

1. source tabs;
2. search and filter strip;
3. aggregate status and recoverable failures;
4. one scrolling results region containing the server group, local group, and
   server pagination; and
5. an overlay detail sheet that never resizes the grid.

Source tabs use the existing `Tabs`, `TabsList variant="line"`, and
`TabsTrigger` primitives. The list is `h-12`, full width, horizontally
scrollable when necessary, and touches its bottom divider. Triggers occupy the
full height so the active underline sits on the divider rather than floating.

The search/filter strip uses 12 px editor padding, an exact 44 px input group,
and a 44 px filter action. Filters use labelled native selects inside the
existing `Sheet`. Compact cards use 12 px gaps and an 8 px radius; comfortable
density may use 16 px outer padding and 12 px gaps. Selection uses a restrained
border/ring, not a second floating container.

At 320 CSS pixels and 200% zoom:

- there is no horizontal page overflow;
- source tabs scroll horizontally;
- the filter/detail sheet occupies the usable width;
- every pointer action remains at least 44 px;
- opening the surface does not autofocus search or summon the software
  keyboard; and
- focused content is not hidden behind sticky controls.

## Grouped authorities

The browser never flattens local items into the server cursor.

- The server group retains server order and uses the active scope label:
  `Recently used`, `Workspace uploads`, `Studio library`, `Favorites`, or the
  exact collection label.
- Device-local results render once in a separate `On this device` group.
- The visible count distinguishes authorities, for example
  `24 cloud results · 7 on this device`.
- `Load more` advances only the server page.
- The final pagination target reports only the server total.

Local inventory health remains independent of filtered count. A compact notice
above the local group reports migration, truncation, unindexed, unavailable,
archived, or integrity issues without listing private asset IDs. A local
failure retains a safe projection and offers Retry. Retained local items must be
reprojected immediately through every new query, so an Uploads result cannot
appear in Library, Favorites, or a collection while refresh fails.

Server list and detail boundaries reject `mediaSource: "local"`. A local source
can enter only through the device-local overlay.

## Card contract

Each card is one `article` keyed by
`media:{source}:{id}@{version}` and contains sibling controls:

1. one native primary action button;
2. one favorite button only when permission allows it; and
3. one overflow menu button.

No button is nested inside another control. The primary accessible name
includes mode, media name, and source, for example
`Replace “Hero image” with “Olive botanical” from Studio library`. Enter and
Space perform the complete primary action.

The preview occupies a stable 4:3 box with explicit intrinsic dimensions,
asynchronous decoding, lazy loading where applicable, object containment, and
a non-shifting failure fallback. Transparent media may use a restrained
checkerboard. Preview failure never removes the card or its actions.

Visible metadata is limited to:

- one-line name;
- dimensions and formatted byte size; and
- exact source label: `Studio library`, `Workspace upload`, or
  `On this device`.

Favorite and collection controls are absent when permission denies them.
Device-local overflow contains Details and truthful device-only copy, not fake
disabled favorite or collection actions. Curated and managed collection
membership uses `DropdownMenuCheckboxItem` with checked semantics. New and
Manage collection actions reuse the Gate 5 collection dialog and permission
rules.

Per-item busy copy distinguishes `Checking exact version` from the eventual
insert, replace, or field-assignment action. Motion is limited to opacity and
transform and respects reduced motion.

## Details contract

Details open only from the overflow menu, not from ordinary primary action.
They use the existing right-side `Sheet`, become full width on compact
viewports, do not become a second scroll owner, and return focus to the exact
originating overflow action.

The sheet retains the card summary while exact detail loads and shows:

- exact name, source, version or local revision;
- preview, dimensions, MIME type, and formatted size;
- description;
- provenance source and license;
- required attribution; and
- current favorite and collection projection where allowed.

Only schema-validated public provenance and license links may render. The DOM,
accessible copy, and telemetry-facing attributes never contain an R2 key,
filesystem or IndexedDB locator, content checksum, or arbitrary source URL. A
device-local preview may place its short-lived browser object URL only in the
functional ready-state image `src`; that URL is forbidden from details,
data/ARIA attributes, copy, telemetry, persistence, and every DOM attribute
after the preview lease is released.

An exact mismatch or detail failure retains the card and sheet, presents Retry,
and emits no selection intent. The sheet primary action uses the same validated
intent path as the card.

## Preview lifecycle

Curated and managed previews derive from the accepted exact same-origin media
content route or settled same-origin preview descriptor. IDs are encoded and
no private storage locator reaches the client.

Device-local previews use the D0/D1 exact preview port with
`{ source: "local", assetId, revision }`. They do not call `loadLocalAsset`
directly.

The local preview lifecycle is:

1. a mounted virtual or semantic card enters the 240 px viewport margin;
2. one abortable exact preview request starts;
3. the returned Blob is checked against source, ID, revision, MIME, byte size,
   and dimensions;
4. one object URL is created;
5. leaving the range, changing revision, search, scope, controller lifetime, or
   unmounting aborts the request and revokes the URL exactly once.

The controller owns a preview-request lifetime fence in addition to the UI's
AbortController. It rejects preview reads while inactive or disposed and aborts
all preview reads on query change, deactivation, and disposal. Opening or
searching media reads metadata only; it never enumerates or decodes every Blob.

## State model

The browser covers these states without replacing usable retained content:

- initial skeleton grid;
- retained background update;
- initial server failure with Retry;
- retained server failure as an inline alert;
- independent initial or retained local failure;
- search empty and source empty with scope-specific copy;
- local inventory health warning;
- exact detail loading, mismatch, failure, and Retry;
- preference snapshot or mutation failure with Retry and Dismiss; and
- append loading, append failure, Load more, and final pagination status.

One `aria-live="polite" aria-atomic="true"` region combines the controller
announcement, unique failures, and local health message. Preview failure stays
local to the affected card. A request ID is shown when the settled error
contract supplies one.

## Keyboard and focus

- Enter applies search.
- Escape clears a non-empty search before the surrounding dialog may close.
- Arrow Down from search focuses the selected or first visible primary card.
- Tab order is primary action, favorite when present, then overflow.
- Enter and Space activate primary cards.
- Complete grid arrow navigation is optional; a partial implementation is not
  allowed.
- Filtering moves a removed focused card to its deterministic successor, then
  search if no result survives.
- Load more retains focus while present. When final append removes it, focus
  moves to a labelled pagination-status target.
- Details close to their exact opener. The surrounding Slice E dialog owns
  final close and stable opener restoration.

Every icon-only action has an accessible label, decorative icons are hidden,
and all native controls retain visible `focus-visible` treatment.

## Virtualization and performance

Columns are measured from the grid host with one `ResizeObserver`; D2 never
reads `window.innerWidth`.

| Host width | Columns |
| ---------- | ------- |
| `< 360`    | 1       |
| `>= 360`   | 2       |
| `>= 620`   | 3       |
| `>= 860`   | 4       |

At 48 cards or fewer, render one semantic list and apply
`content-visibility: auto` plus a stable intrinsic size. At 49 or more,
virtualize rows with `useVirtualizer`, measured row heights, bounded overscan,
stable source-aware keys, and a range extractor that retains selected and
focused rows.

`aria-posinset` and `aria-setsize` describe order inside each labelled group.
Column changes preserve the focused card. The selected and focused row remains
mounted long enough for deterministic focus restoration.

The 1,000-local-item acceptance asserts ceilings for:

- mounted cards;
- local preview byte reads;
- concurrent preview reads;
- live object URLs; and
- revoked object URLs after query, scope, revision, and unmount changes.

Using elapsed time alone is not sufficient. There is one scroll owner; a
virtualizer must not sit inside an unreported nested `ScrollArea` viewport.

## Test file plan

### New focused tests

- `library-media-browser.test-support.tsx`
  - Static server controller, deferred exact detail, curated/managed/local
    factories, shared preference owner, local overlay, and same-ID/version
    source-collision fixtures.
- `library-media-browser.test.tsx`
  - Scope/query mapping, every visible state, exact mismatch, sibling native
    controls, source-inclusive accessible names, permission masking, checked
    collection semantics, keyboard paths, and aggregate announcements.
- `library-media-browser.virtualization.mounted.test.tsx`
  - 48/49 boundary, 1/2/3/4 container columns, selected/focused row retention,
    local group once, server cursor math, Load-more focus, and compact geometry.
- `library-media-preview.mounted.test.tsx`
  - 1,000 local summaries, bounded preview reads, abort/stale fencing,
    object-URL creation/revocation, exact route encoding, stable broken preview,
    and private-locator absence.

### Existing focused tests to extend

- `library-preference-projection.test.ts`
  - Curated and managed optimistic projection plus denied permission masking;
    local items cannot become durable preference commands.
- D0/D1 media discovery and provider tests
  - Cross-scope retained local re-projection, malformed server-local rejection,
    pinned media-only mutation attempts, preview reads while inactive, query
    change, deactivation, disposal, caller abort, and stale completion.

Stable production selectors may include:

- `data-library-media-browser`;
- `data-media-scope`;
- `data-media-group="server|local"`;
- `data-media-card={source-aware-identity}`;
- `data-library-media-grid-host`;
- `data-library-media-virtualized`;
- `data-media-details`; and
- `data-local-preview-state`.

Do not add test-only component props.

## Browser acceptance for D2

Before Slice E starts, run the pure browser in a real retained provider shell
and verify:

1. Recent, Uploads, Library, Favorites, and one collection switch without a
   transient wrong-source request or mixed authority count.
2. Search, clear, filters, retained refresh, initial failure, retained failure,
   local failure, detail failure, preference failure, and append failure all
   preserve truthful visible state and Retry behavior.
3. A same-ID/version curated, managed, and local fixture retains three distinct
   selection, focus, preview, and detail identities.
4. Local controls never submit favorite or collection mutations.
5. Keyboard-only search, scope switching, primary action, details, favorite,
   checked collection membership, Load more, Retry, and focus restoration work.
6. At 320 px and 200% zoom there is one scroll owner, no horizontal overflow,
   no forced software keyboard, and every action is at least 44 px.
7. At 1,000 local summaries, mounted cards and live object URLs remain bounded;
   scrolling, scope changes, search changes, and unmount revoke prior URLs.
8. Broken curated, managed, and local previews retain geometry and actions, and
   no private locator appears in DOM attributes, copy, or accessible names. The
   only permitted local Blob URL is the live ready-state image `src`, and it is
   absent after failure or lease release.

This is D2 browser acceptance only. It does not claim insert, replace, field
assignment, Undo, Recent recording, upload, recovery, archive, or promotion
parity; those remain Slice E.

## Reference lessons retained

OpenPencil `AssetsPanel.vue` supplies evidence for grouped sources, compact
grid/list density, per-item busy state, keyboard insertion, and separate detail
disclosure. `AssetThumbnail.vue` supplies viewport-only rendering, request
supersession, and object-URL cleanup. Studio keeps native buttons rather than
OpenPencil's clickable `div` and does not add drag as a required path.

Loora `assets-panel.tsx` supplies evidence for a single searchable surface,
compact search/sort/upload hierarchy, stable intrinsic lazy previews,
transparent-media checkerboards, usage visibility, and per-item actions.
Studio does not adopt base64 upload, physical delete, or public locators that
bypass workspace ownership.

Neither reference owns Studio's source-aware immutable identity, local revision
recheck, permission projection, server cursor authority, R2 admission,
reference-safe archive, or one-command Undo boundary.

## Explicit non-goals

D2 does not:

- edit `asset-library-dialog.tsx`, StudioShell, `use-document-editor.ts`, or any
  document command owner;
- insert, replace, assign a field, mutate a document, close a dialog, or record
  Recent;
- reimplement upload queue, drag/drop upload, retry/cancel, storage quota,
  missing-media recovery, archive/deletion impact, promotion, or reference
  navigation;
- submit device-local IDs to durable favorites or collections;
- merge local items into server totals or cursors;
- expose R2, filesystem, IndexedDB, or arbitrary source locators, or expose a
  local Blob URL anywhere except the live ready-state preview image `src`;
- add mandatory drag interaction or incomplete arrow-key grid navigation;
- broadly refactor the template browser or UI package; or
- claim production, browser, Slice D, or Slice E completion.

## Exit condition

This preflight is satisfied only when the implementation follows the frozen
boundary above, focused and mounted tests pass, the compact and 1,000-item
browser acceptance runs pass, scoped typecheck/lint/diff checks pass, and a
fresh independent review reports zero open P0/P1 findings. Only then may D2 be
recorded as accepted and D3/Slice E begin.
