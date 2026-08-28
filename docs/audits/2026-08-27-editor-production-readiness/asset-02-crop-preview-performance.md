# ASSET-02 crop-preview performance seam

## Problem

The committed document and React shell currently own the live crop draft. Every
pointer preview therefore updates the top-level editor hook, rebuilds the
preview document, and rerenders shell consumers. That violates UX contract 47:
only the renderer and crop bar may observe a per-frame crop draft.

## Reference pattern

OpenPencil keeps gesture input in mutable pending state and schedules one flush
per animation frame (`shared/input/gesture.ts`, `shared/input/wheel.ts`). Its
canvas render loop also deduplicates callbacks in a shared RAF scheduler before
reading the latest editor state (`canvas/surface/render-loop.ts`). The important
properties are:

1. Input writes the latest value synchronously.
2. At most one paint notification is queued for a frame.
3. The frame reads the latest value rather than replaying every intermediate
   input.
4. Cancellation removes pending work and listeners.

## Proposed ownership

`ImageCropPreviewStore` is scoped to one immutable crop target. It owns two
immutable session snapshots:

- `live`: the latest validated draft, readable synchronously by Done/Cancel and
  by the next toolbar event;
- `published`: the latest frame-coalesced draft returned to renderer/crop-bar
  subscribers.

Pointer, touch, and numeric previews update `live` without touching React shell
state or the canonical document. The first changed preview schedules one frame;
later previews in that frame only replace `live`. On flush, the store publishes
the newest session once. Exact document/page/node/asset/source target matching
rejects late events from a replaced or ended crop session.

The crop bar should subscribe with `useSyncExternalStore`. Fabric already paints
its local preview directly in the adapter, so it does not need a React
round-trip. Done must read `getLiveSession()` before applying the existing
domain transaction, which preserves the one `Crop image` history entry even
when the final pointer event has not reached a RAF flush. The shell should only
hold the stable session identity needed to enter/exit crop mode.

## Integration sequence

1. Create/destroy one store with crop-mode lifetime.
2. Route Fabric pointer/touch preview events to `preview(target, patch)` and keep
   the adapter's local paint path unchanged.
3. Subscribe only the crop toolbar (and a React renderer if one is mounted) to
   the published snapshot.
4. Route toolbar previews through the same store so pointer and numeric input
   merge against the latest live session.
5. On Done, apply `getLiveSession()` once; on Cancel/invalidation/unmount,
   destroy the store and discard the draft.

This seam intentionally does not introduce a second document, serialize a
draft, or notify accessibility live regions for pointer movement.

## Exact API usage

The store is created only after `startImageCropSession` succeeds. Its immutable
target must accompany every producer event; callers must not reconstruct a
partial node-only key.

```ts
const previewStore = createImageCropPreviewStore(started.session)

previewStore.preview(started.session.target, {
  placement: nextPlacement,
})
```

The crop toolbar is the React subscription boundary. Its snapshot is allowed to
rerender once per scheduled frame; the component containing the document,
history, page list, inspector, and shell chrome must not subscribe.

```ts
const session = useSyncExternalStore(
  previewStore.subscribe,
  previewStore.getSnapshot,
  previewStore.getSnapshot
)
```

Event handlers that derive a partial update must merge through `preview()`;
they must not derive the next draft from a captured toolbar render and replace
the store. `preview()` always validates and merges against the newest live
session. Done similarly reads the live session, not the potentially one-frame
older published snapshot:

```ts
const result = applyImageCropSession(
  previewStore.getLiveSession(),
  document,
  activePageId
)
```

Lifecycle ownership is exact: cancel, successful Done, invalidation, source
replacement, crop-target change, and unmount all call `destroy()`. A store is
never reused for a different target. `destroy()` cancels the queued frame,
clears subscribers, and makes late producer events return `"destroyed"`.

## Proof boundary

The pure-store regression sends 50 distinct previews in one frame and asserts:

- exactly one frame request;
- zero subscriber calls before flush and exactly one after flush;
- the published snapshot jumps directly from revision 0 to revision 50;
- Done reads revision 50 before flush and produces one named transaction with
  one placement command;
- stale source/target events and post-destroy events cannot mutate the draft.

The mounted integration must retain those assertions while additionally
counting renders at the shell and crop-bar boundaries. The acceptance target is
zero extra shell renders from the 50 previews, at most one crop-bar render per
flushed frame, no document identity/revision/snapshot/history change before
Done, and one history entry after Done.

## Retained 20-page non-browser evidence

The deterministic fixture in
`apps/studio/src/features/editor/image-heavy-performance-fixture.test-contract.ts`
contains 20 pages, 8 image nodes per page, and 160 distinct image sources. The
mounted contract in
`apps/studio/src/features/editor/image-heavy-responsiveness.mounted.test.ts`
retains these operation and render-count assertions:

- selecting another node on the active page causes one editor-shell render and
  zero filmstrip Artboard renders;
- selecting another page causes one editor-shell render and exactly two
  filmstrip Artboard renders, for the previous and next active thumbnails;
- 50 changed crop previews request one animation frame and cause zero shell,
  toolbar, crop-renderer, or filmstrip renders before the frame flush;
- the flush causes exactly one crop-toolbar render and one active-page crop
  renderer render, with no off-page crop subscriber;
- the canonical document object, snapshot ID, operation version, and history
  stay unchanged until Apply; Apply increments document revision and operation
  version once, and Undo restores the exact document and snapshot identities.

`PageFilmstrip` and its page items are memoized. Event callbacks pass through
stable refs, so an active-page-dependent callback cannot invalidate every
thumbnail during selection.

## Retained 100-page raster-filmstrip evidence

The fixture can now scale to 100 pages while preserving eight distinct images
per page. At that size the filmstrip no longer mounts a live `Artboard` for
every page. It keeps the active page live and renders only near-viewport
inactive pages through the authenticated ephemeral thumbnail endpoint.

The scheduling and ownership contract is explicit:

- one `IntersectionObserver` is rooted to the horizontal scroll viewport with
  a 240 px preload margin;
- inactive requests are bounded to three concurrent producers and 64 LRU
  entries;
- leaving the viewport margin or becoming the live active page aborts queued or
  active work while preserving an already completed cache entry;
- cache identity includes the document, the selected page's canonical
  visual/dependency revision, renderer revision, and aspect-fitted raster
  dimensions; unrelated snapshot/page changes preserve completed entries;
- stale generations and replaced observer callbacks cannot publish;
- raster Object URLs are revoked on invalidation, eviction, replacement, and
  unmount;
- the active page remains the live React renderer rather than a stale raster;
- page selectors use roving focus with ArrowLeft, ArrowRight, Home, and End;
- off-screen items use CSS content containment without removing semantic page
  selectors from the accessibility model.

Mounted tests prove exact portrait and landscape dimensions, visibility
admission, page-local revision replacement, unrelated-page reuse, URL cleanup,
active-page live rendering, and keyboard traversal across all 100 pages. Server and renderer tests prove
the low-resolution request is authenticated, resource-admitted, abortable,
dimension-verified, and returned directly without an R2 artifact.

## Browser evidence still required

The retained test uses deterministic React operation and render counts. It does
not replace a browser profile. Completion still requires the real 20-page
fixture in Chromium on the representative laptop to prove:

- camera, selection, crop entry, page switching, Apply, and Undo meet the 60 fps
  interaction target without long tasks;
- crop pointer input produces no shell commits in the React profiler;
- off-screen filmstrip image sources are not eagerly decoded or retained when
  crop starts;
- repeated crop entry/cancel and page switching release image listeners,
  temporary Fabric objects, pointer capture, and object URLs.
- a 100-page filmstrip remains within authored scroll/input, memory, and network
  budgets while real Browser Rendering is active; the per-page canonical
  projection removes unrelated pages/resources, but its remaining transfer and
  Worker startup cost still require measurement before choosing a
  snapshot-reference or batch follow-up.
