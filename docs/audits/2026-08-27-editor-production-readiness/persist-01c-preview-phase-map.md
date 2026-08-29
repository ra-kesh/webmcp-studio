# PERSIST-01C durable document previews phase map

Date: 2026-08-29

Status: completed and independently accepted for the PERSIST-01C boundary

## Outcome

Replace the Recent library's neutral metadata tiles with truthful first-page
previews without making document listing wait for document bodies or rendering.
The preview shown as current must have the exact identity of the listed saved
document. Missing previews are produced only for cards in or near the viewport,
stored independently, and reused after reload. A preview failure belongs to one
card and never blocks Open, metadata, search, pagination, or document saving.

This is the next bounded PERSIST gate. It does not rewrite Recent/Trash, the
draft repository, the editor renderer, or the server thumbnail route. It joins
their existing seams with one dedicated preview owner.

## Product promise

For a Recent card, the user should see one of five honest states:

1. a stable preview well while the card is outside the loading margin;
2. a layout-preserving loading treatment while its exact saved preview is read;
3. the exact renderer-backed first-page PNG for the listed saved content;
4. a visibly labelled live Artboard fallback in local development or for a
   browser-local image that the Worker cannot materialize; or
5. a card-local unavailable state with Retry while every document action stays
   usable.

If a document changes while an old image is on screen, the old pixels may be
retained briefly only under an explicit `Updating preview` label. They must
never be presented as the current saved version.

Trash remains metadata-first in this slice. Its retained preview is not loaded
while the document is tombstoned. Restore makes the same exact preview eligible
again if the content identity did not change. This avoids calling the current
`getPreview()` path, which treats a tombstoned document/preview pair as a corrupt
read instead of a normal inactive state.

## Evidence reread

### Studio contracts and audits

- `production-readiness-backlog.md`: PERSIST-01, START-01, PERF-01,
  CONFORM-01, FAIL-01, and API-SEC-01.
- `remediation-progress.md`: PERSIST-01A repository closure, PERSIST-01B
  metadata-only Recent/Trash, canonical routes, and the remaining PERSIST-01C
  handoff.
- `persist-01-phase-entry.md`: exact preview record, independent preview writes,
  local-asset limitation, and identity separation.
- `persist-01b-phase-entry.md`, `persist-01b-recent-trash-phase-map.md`, and
  `persist-01b-acceptance-plan.md`: metadata must render before previews,
  preview errors remain card-local, and no list operation reads every body.
- `persist-01b-reference-patterns.md`: verified OpenPencil and Loora preview
  patterns and rejected full-body dashboard patterns.
- `perf-01-renderer-thumbnails.md`: the implemented authenticated Studio to
  Renderer thumbnail contract and the filmstrip's visibility/cache behavior.
- `render-conformance.md`: renderer PNG remains the artifact baseline and the
  live React Artboard is a separate implementation that must be compared.

### Studio production code

- `apps/studio/src/features/editor/document-draft-repository.ts`
- `apps/studio/src/features/editor/recent-documents-controller.ts`
- `apps/studio/src/features/editor/recent-documents-provider.tsx`
- `apps/studio/src/features/editor/recent-documents-model.ts`
- `apps/studio/src/features/editor/recent-documents.tsx`
- `apps/studio/src/features/editor/page-thumbnail-raster-cache.ts`
- `apps/studio/src/features/editor/page-thumbnail-raster-producer.ts`
- `apps/studio/src/features/editor/page-filmstrip.tsx`
- `apps/studio/src/features/persistence/studio-persistence-runtime.ts`
- `apps/studio/src/features/persistence/studio-persistence-provider.tsx`
- `apps/studio/src/routes/_studio/route.tsx`
- `apps/studio/src/server/page-thumbnail-http.ts`
- `apps/studio/src/routes/v1/studio/page-thumbnail.ts`
- `apps/renderer/src/index.ts`
- `apps/renderer/src/html.ts`
- `packages/document/src/page-thumbnail.ts`
- `packages/render-view/src/index.tsx`

### Actual reference code

OpenPencil root:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil`

Inspected:

- `packages/vue/src/document/workspace/previews.ts`
- `packages/vue/src/document/workspace/use.ts`
- `src/components/home/HomeWorkspace.vue`
- `src/app/recent-files/thumbnails.ts`

Loora root:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/loora`

Inspected:

- `packages/shell/src/components/design-thumbnail.tsx`
- `packages/shell/src/components/designs-dashboard.tsx`

OpenPencil is the scheduling reference: `IntersectionObserver` with a 240 px
margin, bounded concurrency, deduplicated queue entries, revision generations,
independent errors, and exact object-URL revocation. Loora is useful for the
revision-keyed lazy card composition and stable preview/card shape. Neither
reference is a storage authority for Studio. Loora downloads the whole design
per thumbnail, and OpenPencil's local-file cache identity is filesystem based;
both are wrong for Studio's content-snapshot repository.

## What already exists and should be reused

### Repository mechanics already usable

`DocumentDraftSummary` already supplies every metadata fact needed to form a
preview request without opening a body:

- `documentId`;
- `recordVersion` and `contentSnapshotId`;
- `documentRevision`;
- `firstPageId`, name, width, and height;
- deletion state.

`DocumentDraftPreview` already stores a durable PNG Blob with:

- document and content-snapshot identity;
- page identity;
- renderer revision;
- exact raster dimensions, MIME, byte length, and creation time.

`putPreview()` already validates Blob bytes, reads the exact active document,
checks content/page/aspect identity again in a write transaction, publishes a
`preview` repository event only after commit, and leaves draft-save success
independent from preview failure.

Content saves delete the preview only when `contentSnapshotId` changes.
Source-context-only saves, Rename, Open/touch, and publication linkage preserve
the same pixels. Soft Delete retains the preview for a possible Restore. Purge
and quarantine delete it. These are the correct retention semantics.

### Renderer path already usable

The current client producer and `/v1/studio/page-thumbnail` route already:

- project a document to one page and its dependencies;
- reject a browser-local `asset:local/*` source instead of lying about it;
- require authentication and render-capacity admission;
- materialize managed assets;
- invoke the private Renderer binding;
- verify render/page/output/dimension/byte response identity;
- return ephemeral `image/png` bytes without writing a durable render artifact.

The Renderer already uses the same document projectors as render-view, waits
for the managed font and image decode/dimensions, captures the exact low-resolution
viewport, reads the PNG dimensions, and returns identity headers. PERSIST-01C
should persist those verified bytes locally through `putPreview()`; it should
not create another thumbnail HTTP route or another HTML serializer.

### Filmstrip mechanics already usable as patterns

The filmstrip has proven implementations for:

- 240 px near-viewport admission;
- maximum three producer calls;
- exact key deduplication and stale completion rejection;
- cancellation when an item leaves the margin;
- a 64-entry LRU of object URLs with revocation;
- retry classification and bounded backoff;
- renderer-revision invalidation;
- a live Artboard fallback for local development and local-only images;
- decorative thumbnail semantics and stable layout.

Do not couple Recent cards to `PageFilmstrip`. Reuse or extract the small
framework-independent mechanics; keep page-navigation state, active-page rules,
and filmstrip JSX out of the document library.

### Recent/Trash mechanics already usable

The Recent controller is correctly metadata-only and already owns pagination,
search, list invalidation, operations, focus, and view preference. It should
remain so. The Recent model already projects truthful card facts and the UI
already has static and virtualized collection paths, stable card dimensions,
sibling Open/action controls, loading/empty/error states, and deterministic
focus recovery.

PERSIST-01C should add a preview identity to a row and a preview surface to a
card. It must not add Blob URLs, IntersectionObservers, renderer requests, or
preview failure state to `RecentDocumentsController`.

## Exact missing contracts

### 1. A lightweight exact preview read

The current `getPreview(documentId, contentSnapshotId?)` first calls `get()` and
then opens another transaction containing preview, metadata, and body. A single
visible preview therefore reads and canonically hashes the complete document at
least once, even when an exact PNG is already stored. Using that API across a
24-card page would violate the metadata-first product boundary.

Add a summary-bound read that accesses only `draft-meta` and `draft-previews`:

```ts
type DraftPreviewIdentity = Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  pageId: string
  pageWidth: number
  pageHeight: number
  rendererRevision: string
  width: number
  height: number
}>

type DraftPreviewReadResult =
  | Readonly<{ ok: true; status: "ready"; preview: DocumentDraftPreview }>
  | Readonly<{ ok: true; status: "missing" | "stale_preview" | "not_active" }>
  | Readonly<{
      ok: false
      reason: "stale_head"
      current: DocumentDraftSummary
    }>
  | Readonly<{
      ok: false
      reason: "corrupt_preview" | "storage_unavailable"
      failure: DraftRepositoryFailure
    }>
```

The transaction must prove that current metadata still matches the requested
record/content/page geometry and active state. It validates preview shape,
Blob/MIME/byte length, aspect ratio, page, renderer revision, and dimensions.
It does not read or quarantine the document body. A malformed preview is a
preview failure, not proof that the canonical document is corrupt. `stale_head`
asks the library to refresh its metadata; it must not trigger rendering for the
old summary.

Keep the existing fully verified `getPreview()` for repository diagnostics and
backward compatibility. The card pipeline uses the lightweight method.

### 2. One immutable preview identity from the Recent model

`RecentDocumentRowModel` currently omits `contentSnapshotId`, numeric first-page
geometry, and first-page ID. Add a value such as:

```ts
previewIdentity: Readonly<{
  documentId: string
  recordVersion: number
  contentSnapshotId: string
  documentRevision: number
  pageId: string
  pageWidth: number
  pageHeight: number
}>
```

This is request identity, not preview state. The model remains pure and does not
read storage. Do not pass the full `DocumentDraftSummary` into arbitrary card
components or create a second list model.

### 3. A dedicated document-preview controller

Create one framework-independent owner separate from Recent listing. It owns:

- observers/consumers keyed by exact preview identity;
- deferred, reading, producing, ready, live-fallback, updating, and failed
  states per document;
- a maximum of three body/render jobs;
- exact-key deduplication;
- generation and AbortController cancellation;
- bounded transient retry and explicit manual Retry;
- at most 64 retained object URLs and exact revocation;
- repository preview/content/delete/restore/quarantine invalidation hints;
- terminal disposal.

It does not own card metadata, search, list pagination, document opening, or
editor state.

The production miss path is ordered:

1. read the stored preview for the exact row identity;
2. if exact, create/reuse one object URL and publish `ready`;
3. if missing or renderer-stale, wait for a body-production slot;
4. call `repository.get(documentId)` only then;
5. reject deleted, changed, corrupt, or missing records without rendering;
6. project the canonical first page and calculate one canonical stored size;
7. if local development or an `asset:local/*` node is present, publish a
   minimal live Artboard fallback only while the card is near-visible;
8. otherwise call the existing authenticated thumbnail endpoint;
9. persist the returned Blob with `putPreview()`;
10. publish a URL only if storage accepted the same exact identity and the
    consumer generation is still current.

`putPreview()` is the final compare-and-store barrier. A render that completes
after another tab edits/deletes the document is discarded. A failed preview
write never changes draft save status.

### 4. A stateless thumbnail producer entry point

`createStudioPageThumbnailRasterProducer()` owns a mutable `getSnapshot`
closure designed for one active editor. Recent production can have several
documents in flight, so sharing that closure would permit the wrong body to be
paired with a queued key.

Extract a stateless operation, for example:

```ts
produceStudioPageThumbnailRaster({ key, snapshot, signal, fetcher, endpoint })
```

The existing active-editor factory should delegate to it, preserving the
filmstrip API and tests. The new preview controller passes the exact record it
just admitted. Do not maintain a mutable global `currentPreviewDocument` map in
the producer.

### 5. A fixed stored-preview size policy

The repository stores one preview per document. Grid/list toggles and device
pixel ratios must not continually replace it. Choose one canonical raster size
from the first-page aspect, independent of the current card layout. Recommended
boundary: `fitPageThumbnailSize(firstPage, { maxWidth: 320, maxHeight: 240 })`.
It fits Loora's 4:3 preview well, stays below the shared 512/262,144 limits, and
is sufficient for high-density Recent cards without storing multiple variants.

CSS fits this raster inside both grid and list wells with `object-contain`.
Changing this policy requires a renderer-revision bump. Do not key durable
storage by viewport width or DPR in this phase.

### 6. Explicit local fallback semantics

The existing editor deliberately passes no raster pipeline in development
because the local Renderer has no Browser Rendering binding. Preserve that
decision.

For a near-visible Recent card, a local fallback may hold the admitted minimal
first-page document and render `Artboard` with `imageSemantics="thumbnail"`.
It is disposable UI state, not a durable PNG and not renderer-conformance
evidence. It must disappear/cancel when the card leaves the margin. Production
renderer failure does not silently switch to a supposedly equivalent client
artifact; it shows a card-local Retry state. A browser-local asset is the
exception because the server is intentionally unable to materialize it.

## Ownership map

| Concern                        | File owner                                                                                      | Required change                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact lightweight preview read | existing `apps/studio/src/features/editor/document-draft-repository.ts`                         | Add summary-bound metadata+preview read and typed stale/not-active/corrupt-preview results. Preserve existing write validation and full diagnostic read.                                                                                                                   |
| Stored preview size/key        | new `apps/studio/src/features/editor/document-preview-contract.ts`                              | Own canonical bounds, request identity, serialization, and equality. No React or storage.                                                                                                                                                                                  |
| Scheduling and URL lifetime    | new `apps/studio/src/features/editor/document-preview-controller.ts`                            | Own observation admission, queue/concurrency, retry, generations, stale labels, LRU URLs, live fallback, and disposal.                                                                                                                                                     |
| React persistence adapter      | new `apps/studio/src/features/editor/document-preview-provider.tsx`                             | Bind one controller to the retained `StudioPersistenceProvider`, repository fanout, and one persistence lease. Expose a selector/subscription hook and observation callback.                                                                                               |
| Provider placement             | existing `apps/studio/src/routes/_studio/route.tsx`                                             | Place `DocumentPreviewProvider` under persistence and above `RecentDocumentsProvider`/routes, or directly inside Recent provider composition while keeping controllers separate. It must survive grid/list and keyed route children without running jobs on editor routes. |
| Stateless renderer call        | existing `apps/studio/src/features/editor/page-thumbnail-raster-producer.ts`                    | Extract one immutable snapshot operation; keep active-filmstrip factory as a wrapper.                                                                                                                                                                                      |
| Row request identity           | existing `apps/studio/src/features/editor/recent-documents-model.ts`                            | Project immutable preview identity only. Do not project URLs or loading state.                                                                                                                                                                                             |
| Card preview UI/observation    | new `apps/studio/src/features/editor/document-preview.tsx` plus existing `recent-documents.tsx` | Replace grid metadata tile and list icon with one shared preview surface. Register visibility, render state, Retry, stale label, and separate Open target.                                                                                                                 |
| Existing cache reuse           | existing `page-thumbnail-raster-cache.ts` only if extraction is clean                           | Prefer extracting generic cancellation/LRU mechanics only when filmstrip tests remain unchanged. Do not force document-preview states into a page-navigation cache type.                                                                                                   |
| Server and Renderer            | existing endpoint/renderer files                                                                | No new product route. Only focused changes if the stateless client reveals an identity/header gap. Preserve current admission and serializers.                                                                                                                             |
| Conformance evidence           | existing `render-conformance.md` fixtures plus focused PERSIST-01C artifact folder              | Compare exact stored PNG to live Artboard for portrait, landscape, square, text, shape, and managed-image cases.                                                                                                                                                           |

Suggested provider composition:

```text
StudioPersistenceProvider
  DocumentPreviewProvider
    RecentDocumentsProvider
      Outlet
```

The preview provider is inert until a card registers and intersects. Editor
routes therefore retain no list-preview body/render work. Provider construction
must remain StrictMode-safe and must not create repository work during render.

## UI/product implementation

This section is deliberately separate from repository mechanics.

### Card composition

- Use a 4:3 preview well for grid cards so loading, fallback, and PNG states do
  not change card height.
- Fit the page inside the well; never crop a portrait document with
  `object-cover`.
- Preserve page background and a restrained canvas surround so white pages
  remain visible.
- Make the preview and title independent Open controls or one deliberate card
  Open owner with the actions menu as a valid sibling. Do not nest a menu button
  inside an Open button.
- Keep the action menu usable while preview work is pending or failed.
- In list view, use a small aspect-preserving preview in the existing 5 rem
  leading column. Use the same controller identity and cached URL as grid view.
- Thumbnail content is decorative because the named Open control and metadata
  convey document identity. Hide live Artboard descendants from the document
  library accessibility tree.

### Visible states

| State             | Visual                                                          | Semantics                                                                |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Deferred          | Neutral page silhouette plus existing page/dimension facts      | No busy announcement; metadata is ready.                                 |
| Reading/producing | Same-sized subtle skeleton, reduced-motion safe                 | Card may expose `aria-busy`; do not announce every card simultaneously.  |
| Ready             | Exact PNG, contained and crisp                                  | Decorative image; no duplicate alt text.                                 |
| Updating          | Retained old PNG dimmed with persistent `Updating preview` chip | Text states pixels are stale; a polite aggregate announcement is enough. |
| Live fallback     | Minimal React Artboard with `Local preview` label               | Explicitly not a stored/export guarantee.                                |
| Failed            | Neutral tile and `Retry preview` button                         | Card-local message; Open and actions remain enabled.                     |

The list header and metadata page must render before any preview promise
settles. Preview errors must not enter the collection's retained/terminal error
states. Automatic retries are bounded; manual Retry clears only that exact
failure.

### Visibility behavior

- Observe the preview host, not the whole card action region.
- Use a 240 px root margin, matching the proven filmstrip and OpenPencil
  behavior.
- Static collections observe every mounted preview host but produce only near
  visible identities.
- Virtualized collections first bound mounting through TanStack Virtual, then
  apply the same observer. Do not infer visibility from row indexes alone.
- When the last host for an identity unmounts/leaves the margin, cancel queued
  or active production but retain a completed LRU URL.
- Delay zero-consumer cancellation by one microtask so StrictMode replay and a
  grid/list remount do not churn valid work.

## Repository/mechanics implementation

### Identity and race rules

The scheduling key is:

```text
documentId
+ recordVersion/contentSnapshotId
+ firstPageId/geometry
+ rendererRevision
+ canonical stored raster dimensions
```

`contentSnapshotId` is the pixel-content authority. `recordVersion` detects a
newer metadata head even when pixels remain equal. `documentRevision` is useful
diagnostic metadata but is not a CAS or cache authority.

Every asynchronous boundary captures key plus controller generation. The
controller rechecks both before publishing. Repository events are invalidation
hints only:

- `preview` for the exact content identity re-reads stored bytes;
- `saved/content_saved` marks a visible older image as updating and waits for
  the refreshed summary identity;
- `saved/opened` and `saved/publication_linked` retain exact pixels;
- `deleted` cancels work and removes live fallback; the completed stored URL may
  remain in bounded LRU for Restore but is not shown in Trash;
- `restored` waits for authoritative Recent metadata, then reuses or produces;
- `quarantined` cancels and revokes every identity for that document.

No BroadcastChannel event supplies Blob bytes or directly changes a card to
ready.

### Failure classification

- `missing` stored preview: normal cache miss, eligible for production.
- renderer revision or fixed-size mismatch: normal stale preview, eligible for
  replacement.
- `stale_head`: cancel and request/coalesce Recent metadata refresh.
- deleted/missing document after body admission: cancel without rendering.
- corrupt preview: retain canonical document; show card-local Retry and allow a
  replacement render.
- corrupt document: use the existing recovery/quarantine path; do not collapse
  it into a thumbnail error.
- transient fetch/408/425/429/5xx: at most three attempts with the existing
  capped backoff, then manual Retry.
- validation, admission, or identity mismatch: no automatic retry until an
  identity/event changes.
- preview quota/storage failure: show exact preview-storage failure but keep
  document Save and Open healthy. The successfully rendered in-memory Blob may
  be shown for the current session only if its exact identity remains proven;
  label it `Preview not cached`.

### Object URL rules

- one URL per exact stored/produced Blob identity;
- duplicate consumers share it;
- replacement revokes the previous URL after the new state is published;
- LRU eviction, quarantine, clear, and provider disposal revoke exactly once;
- aborted or stale producer completions never create a URL;
- a producer that ignores AbortSignal still occupies a slot until it exits but
  cannot publish.

## Explicitly rejected shortcuts

- Do not call `repository.get()` for every row when the metadata page loads.
- Do not put preview promises, URLs, or errors into
  `RecentDocumentsController`.
- Do not render every card as a live `Artboard`; that recreates PERF-01 at the
  start screen and inflates the accessibility tree.
- Do not use Loora's full-document fetch/cache as the normal ready path.
- Do not use Avnac-style data URLs or browser screenshots as production proof.
- Do not persist a development Artboard fallback as if the Renderer produced
  it.
- Do not show an old preview without a stale/updating label.
- Do not let renderer failure remove, disable, or globally fail a document
  card.
- Do not add a permanent preview-failure cache.
- Do not create multiple durable sizes for grid, list, DPR, or breakpoints in
  this phase.
- Do not change the renderer HTML or React Artboard independently to make a
  preview test green; conformance differences must be resolved at the shared
  document projector or deliberately recorded.

## P0 and P1 risks

| Priority | Risk                                                                                                              | Required prevention                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0       | A stale render completes after another tab saves/deletes and is displayed or stored as current.                   | Exact summary key on every stage, abort/generation checks, and `putPreview()` as final CAS barrier. |
| P0       | The library issues one body/hash/render operation for every listed document.                                      | Metadata-first lightweight read, 240 px admission, maximum three miss productions, cancellation.    |
| P0       | A preview from document A is rendered/stored for document B through the active editor's mutable snapshot closure. | Stateless producer with an immutable admitted record per job.                                       |
| P0       | Local assets are omitted or replaced in a server preview.                                                         | Detect `asset:local/*`; use explicit near-visible live fallback and never persist fake bytes.       |
| P0       | Object URLs and live fallback documents survive route/provider disposal.                                          | Ref-counted consumers, terminal generation, bounded LRU, exact revoke tests.                        |
| P1       | Current `getPreview()` body reads erase the metadata-only scaling benefit.                                        | New metadata+preview exact read; body only after a visible cache miss.                              |
| P1       | Grid/list/DPR changes continually overwrite the single stored preview.                                            | One canonical fixed raster size and renderer-revision invalidation.                                 |
| P1       | Soft-deleted preview reads are reported as corruption.                                                            | Typed `not_active`; no Trash production; Restore re-admits.                                         |
| P1       | Renderer or storage failure becomes a global Recent error.                                                        | Separate preview state/controller and per-card Retry.                                               |
| P1       | Cross-tab events or list refreshes let old pixels flash as current.                                               | Explicit updating state and summary-key reconciliation before ready.                                |
| P1       | Virtualization and IntersectionObserver disagree, starving focus or overproducing.                                | Observe mounted preview hosts; do not change card/open focus ownership.                             |
| P1       | Auto retry loops continue offscreen or after a permanent validation error.                                        | Typed retry policy, cancel on zero consumers, three transient attempts only.                        |
| P1       | Preview markup adds all page text to the library accessibility tree.                                              | Decorative image semantics and hidden fallback subtree.                                             |
| P1       | Renderer PNG and live Artboard visually drift.                                                                    | Focused portrait/landscape/square/text/image conformance artifacts against renderer PNG.            |

## Minimal phase acceptance matrix

This matrix is the smallest gate that makes the feature trustworthy. It is not
a request to run the full repository suite before the user can see the UI.

| ID      | Layer       | Acceptance                                                                                                                                                                                                                                                       | Focused evidence                                                                                                                |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1C-R01 | Repository  | Exact lightweight read uses metadata+preview only, returns ready only for matching active summary/page/renderer/size/Blob bytes, and distinguishes missing, stale, not-active, corrupt-preview, stale-head, and storage failure.                                 | `document-draft-repository.preview.test.ts` or focused additions to the existing repository suite with transaction/store spies. |
| P1C-R02 | Repository  | Content save invalidates; source-only save, Rename, Open, and publication retain; Soft Delete hides without destroying; Restore reuses; purge/quarantine delete.                                                                                                 | focused repository tests.                                                                                                       |
| P1C-R03 | Repository  | Render completion after save/delete cannot pass `putPreview`; no `preview` event publishes before commit.                                                                                                                                                        | deferred two-instance race tests.                                                                                               |
| P1C-C01 | Controller  | Metadata rows can be ready while all previews are deferred. Only near-visible identities start; concurrency never exceeds three; duplicate consumers share one job.                                                                                              | framework-independent controller tests with manual observer/scheduler/deferred promises.                                        |
| P1C-C02 | Controller  | Leaving visibility, identity change, grid/list remount, StrictMode replay, and provider disposal cancel or retain exactly as specified; stale completions cannot publish.                                                                                        | controller plus mounted provider tests.                                                                                         |
| P1C-C03 | Controller  | Exact stored hit creates one shared URL; replacement/eviction/quarantine/disposal revoke exactly once; maximum 64 retained entries.                                                                                                                              | controller URL ownership tests.                                                                                                 |
| P1C-C04 | Controller  | Production miss reads one body only after visibility, renders the first page, persists exact bytes, then publishes. Renderer revision change regenerates.                                                                                                        | deferred producer/repository integration test.                                                                                  |
| P1C-C05 | Controller  | Local dev/local-asset miss publishes a near-visible Artboard fallback, never calls/persists Renderer bytes, and releases the document offscreen.                                                                                                                 | controller/component test.                                                                                                      |
| P1C-U01 | UI          | Grid and list show stable contained preview wells with deferred, loading, ready, updating, fallback, failed, and Retry states; Open/actions remain usable in every state.                                                                                        | focused `recent-documents` component tests.                                                                                     |
| P1C-U02 | UI          | Preview/title Open ownership and menu HTML are valid; keyboard focus, 320/390 layouts, 200% text, reduced motion, and decorative thumbnail semantics remain sound.                                                                                               | mounted browser/component acceptance.                                                                                           |
| P1C-I01 | Integration | A stored exact preview appears after reload without a body/render call; a visible missing preview is produced and appears on the next reload; an offscreen missing preview is not produced.                                                                      | one healthy-browser IndexedDB journey with call instrumentation.                                                                |
| P1C-I02 | Integration | Editing in another tab marks/removes old pixels, prevents stale storage, and eventually shows the new exact preview after authoritative list refresh.                                                                                                            | one two-tab browser journey.                                                                                                    |
| P1C-V01 | Conformance | Renderer-backed stored previews match the canonical Artboard at chosen portrait, landscape, square, text, shape, and managed-image fixtures within the retained conformance thresholds. Local fallback is labelled and excluded from production-artifact claims. | focused captured artifacts and pixel report.                                                                                    |

## Delivery order

1. Add the lightweight repository read and focused exact/race tests.
2. Extract the stateless thumbnail producer while keeping the active filmstrip
   contract unchanged.
3. Implement the framework-independent preview controller and its deterministic
   queue, stale, retry, URL, and disposal tests.
4. Add the retained provider and exact row preview identity.
5. Replace grid/list placeholders with the shared preview component.
6. Run the focused repository/controller/component/typecheck gate and open the
   library for hands-on testing.
7. After user feedback, capture the bounded browser/conformance evidence,
   independently review this gate, update `remediation-progress.md`, and commit
   PERSIST-01C before moving to the next backlog gate.

## Exit criteria

PERSIST-01C is complete when Recent feels like a real document workspace:
metadata appears immediately; only nearby missing previews cost body/render
work; exact PNGs survive reload; stale pixels are never passed off as current;
local-only work remains honestly previewable; errors are isolated and retryable;
and every URL/job/document reference is released on invalidation or exit.

This closes durable Recent previews, not all of PERF-01 or CONFORM-01. The
100-page editor profiling, deployed Browser Rendering latency/cancellation,
full PNG/PDF oracle matrix, storage estimates/retention policy, and cloud preview
mirroring remain their own measured gates.

## Implementation close-out

Implemented on 2026-08-29 without changing the Recent controller's
metadata-only ownership:

- added one immutable summary-derived preview identity and one canonical
  320-by-240 raster policy;
- added a metadata-and-preview-only repository read with typed miss, inactive,
  stale-head, stale-renderer, corrupt-preview, and storage-failure outcomes;
- extracted a stateless thumbnail producer so concurrent document jobs cannot
  share the active editor's mutable snapshot closure;
- added one retained preview controller with exact-key deduplication, three-job
  admission, visibility cancellation, bounded renderer retry, final repository
  compare-and-store, manual Retry, and provider disposal;
- protected active object URLs from LRU eviction, downgraded evicted inactive
  entries before revocation, and retained card failures across viewport churn;
- materialized both browser-local Blob URLs and managed workspace content URLs
  for the explicitly labelled live Artboard fallback, with exact cleanup after
  cancellation, failure, visibility loss, or provider disposal;
- composed `DocumentPreviewProvider` between persistence and Recent ownership;
  repository events remain invalidation hints and never carry preview bytes;
- replaced both grid and list placeholders with the same aspect-preserving
  preview component; the preview well and title are independent valid Open
  controls, while Retry and the actions menu remain usable siblings.

Focused evidence:

- the complete focused slice passes 120/120 across seven files; controller and
  mounted library regressions pass 24/24, including active URL
  retention, no viewport-driven retry, local and managed source projection,
  exact cleanup, bounded concurrency, duplicate consumers, and preview-well
  opening;
- Studio typecheck, focused ESLint, Prettier, and `git diff --check` pass;
- the live localhost library showed the real first page in List view, and the
  dedicated preview Open control navigated to the exact canonical
  `/documents/quotation-quote-demo-2026-0142` route.

The broader two-tab/deployed renderer conformance matrix remains intentionally
outside this fast product-facing close-out. It is tracked under CONFORM-01 and
the remaining browser acceptance rows rather than being mislabeled as complete.

The independent remediation review reread the current production code and
returned **ACCEPT with no remaining P0/P1 findings**. Its final evidence is
recorded in `persist-01c-preview-review.md`.
