# LIBRARY-02 Gates 3–4 implementation audit

Date: 2026-08-31

Status: read-only code audit complete; implementation follows Gate 2

## Conclusion

Studio does not need a preview or discovery architecture restart. The current
repository already contains the hard mechanics needed for a scalable library:

- exact renderer-backed page thumbnails;
- bounded three-job scheduling patterns;
- AbortController and generation ownership;
- near-viewport work admission;
- bounded object-URL caches and release;
- strict paged catalog and cursor contracts;
- exact template materialization and apply safety;
- TanStack Virtual list patterns;
- retained-content background refresh patterns.

The work is to assemble those seams into library-specific owners and replace
the duplicated live-rendering template browsers. Reference repositories remain
behavior and interaction research only.

## Gate 3: immutable raster previews

Add a strict template preview manifest keyed by
`template:<id>@<version>`. Each record is an exact
`LibraryPreviewDescriptor`; it remains separate from the Gate 2 authoring
manifest.

The preview generator must:

1. iterate every active exact template version;
2. materialize its canonical preview document;
3. select the exact `previewPageId`;
4. call `fitPageThumbnailSize` with a 320 × 240 bound;
5. render through the existing page-thumbnail producer and renderer path;
6. run at most three jobs globally;
7. inspect the returned PNG bytes and hash the exact file;
8. write to a temporary directory first;
9. publish fingerprinted files and the manifest only after the complete run
   succeeds.

Immutable resources belong at a path such as
`/library/previews/templates/<id>/v<version>/<page>.<hash-prefix>.png`.
Verification rejects missing or extra entries, stale versions, wrong page IDs,
renderer revisions, dimensions, MIME types and SHA-256 hashes.

Reuse these existing paths:

- `packages/document/src/page-thumbnail.ts`:
  `createPageThumbnailDocument`, `createPageThumbnailRevision`,
  `fitPageThumbnailSize`, `assertPageThumbnailSize`;
- `apps/studio/src/features/editor/page-thumbnail-raster-producer.ts`:
  `produceStudioPageThumbnailRaster`, renderer revision and response identity;
- `apps/studio/src/server/page-thumbnail-http.ts`: authentication, resource
  materialization, request admission and response verification;
- `apps/renderer/src/index.ts`: Browser Rendering thumbnail execution;
- `packages/document/src/library-catalog-projections.ts`: exact preview
  attachment to compact catalog summaries.

### Runtime preview owner

Create one `LibraryPreviewController`, not card-owned fetch state and not one
controller per browser surface. It owns exact descriptor keys, reference-counted
consumers, deferred/loading/ready/live-fallback/failed state, a global maximum
of three fetches, deduplication, abort and generation rejection, one-card Retry,
MIME/dimension/hash verification and a 64-entry object-URL LRU. URLs are revoked
once on eviction, replacement and disposal; StrictMode release uses the
existing microtask-delay pattern.

Raster bytes load only within a 240 px observer margin. Normal retry may use
the immutable browser cache; manual Retry bypasses a potentially corrupt cached
response. A failed raster is a local failure with Retry. It must not silently
become a live renderer. `live_fallback` is an explicit manifest state and is
labelled as local/live preview.

The shared preview component uses a fixed 4:3 well, decorative raster image,
`object-contain`, stable skeleton and separate selection/Retry controls. Normal
template grids mount no live `Artboard` renderers.

## Gate 4: framework-independent discovery

Add one `LibraryDiscoveryController`, following the ownership model in
`RecentDocumentsController` rather than the UI-bound request state in the
current asset dialog. Its dependencies are asynchronous and signal-aware:

```ts
list(query, signal): Promise<LibraryCatalogPage>
getDetail(kind, id, version, signal): Promise<LibraryCatalogItemDetail>
getTaxonomy(): LibraryTaxonomy
scheduleQuery(callback, delay): () => void
```

State owns raw search, applied normalized query, all filters, order/entry point,
confirmed and retained pages, pagination cursor, separate replacement/append
failures, announcements, focus intent, exact generation and query identity.

Every replacement receives a fresh generation. Search and filter changes abort
replacement and pagination. Load More reuses the confirmed page generation,
query identity and cursor. A result is accepted only when request token,
generation, active query and controller lifetime still match. Append rechecks
the current cursor and deduplicates identities. Same-query refresh retains the
confirmed grid. If old results remain visible during a changed query, the UI
must label them `Updating results`; they cannot be announced as current.
Preview failure never becomes catalog repository failure.

Keep this controller outside `useDocumentEditor`; typing in library search must
not rerender the editor shell. Construct it once under the Studio route, expose
it through `useSyncExternalStore`, and retain/release it from Start and editor
surfaces. The initial local adapter wraps `LibraryCatalogIndex`; its async
boundary remains stable when Gate 5 adds server preferences.

List results are summaries, not mutation authority. Create/apply resolves an
exact detail and rechecks version, compatibility and permission before calling
the existing `prepareCreateFromTemplate`, `prepareApplyTemplate` and
`DesignTemplateRepository` lifecycle.

Taxonomy is a validated complete projection, not labels inferred from the
current page. It contains category, use case, format family, orientation and
ownership labels. Ownership labels are exactly `Studio` and `Your workspace`.

## Shared browser migration

Create one `LibraryTemplateBrowser` with layout/density variants. Remove
duplicated search, category, selection and live preview logic from
`template-catalog-panel.tsx` and the private browser in
`studio-start-surface.tsx`.

- Start uses featured, recent and favorites entry points, complete search,
  compact filters, a responsive 2–4 column grid and selected details. Create is
  primary; Blank, Import and Recent documents remain separate.
- Editor uses compact search, horizontal entry chips, filters in a popover or
  sheet, a one/two-column container-aware grid and compact selected details.
  Create remains primary; Apply is explicit and retains impact confirmation.
- Layout responds to the resizable container through ResizeObserver, never
  `window.innerWidth`.
- Lists above 48 items use the existing TanStack Virtual pattern and preserve
  semantic order and focus intent. Smaller lists use `content-visibility`.

Accessibility requires labelled search/filters, readable filter grouping,
inspectable incompatible cards, one selection model, one aggregate polite
result announcement, separate selection/favorite/Retry controls, stable focus,
deterministic selection when results disappear, clear Load More focus/status,
44 px compact targets and reduced-motion-safe states.

## Acceptance traps

P0 risks:

- generating a preview from mutable editor state instead of the exact template;
- cards invoking Browser Rendering at runtime;
- stale query/cursor responses replacing or appending current results;
- create/apply trusting summary metadata without exact-detail revalidation;
- multiple preview providers multiplying the global three-job budget;
- full documents or private media bytes entering list/controller state.

P1 risks:

- retaining old results during a changed query without an Updating label;
- hidden desktop and compact trees both fetching previews;
- deriving taxonomy only from the current page;
- nested Retry/favorite/menu controls inside the card selection control;
- changing a static resource without changing version/hash/path;
- using window width for a resizable-panel grid;
- a preview failure replacing the complete catalog failure state.

## Gate 2 adjacency

Canonical image rendering currently accepts approved inline image sources or
managed/local identities materialized server-side. It rejects a bare
same-origin `/library/media/...` value persisted into an image node. Gate 2's
curated manifest may use immutable first-party resource paths for discovery,
but the current insertion compatibility path must remain valid until Gate 6
adds an exact curated identity/materializer. Moving `StudioAsset.src` to a URL
without that bridge would break editor insertion and export.
