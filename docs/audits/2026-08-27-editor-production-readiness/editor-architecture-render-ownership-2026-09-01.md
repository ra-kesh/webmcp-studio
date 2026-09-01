# Editor architecture and render ownership

Date: 2026-09-01

Status: Gates 1 through 4 accepted; multi-artboard extension planned

Branch: `codex/editor-architecture-render-controller`

Worktree: `/Users/rakesh/Developer/webmcp-studio-editor-architecture`

## Scope and invariants

This phase reduces the integration load in `use-document-editor.ts` and gives
the Fabric boundary one explicit invalidation owner. It does not change the
document schema, command semantics, history labels or coalescing, persistence
records, WebMCP tools, renderer output, or editor appearance. Fabric remains the
interactive canvas implementation. CanvasKit is not part of this work.

The acceptance rule is strict: every user-visible mutation must still pass
through the existing document commands and `commitCommandsWithResult`. A crop,
transform, or continuous preview remains transient until its existing settle
path creates one history entry. Persistence continues to capture settled
history only.

## Current ownership map

| Concern | Current owner | Inputs | Outputs and side effects | Problem to correct |
| --- | --- | --- | --- | --- |
| Canonical document and local undo | `useDocumentEditor` and `@webmcp/editor/history` | command drafts, history options | document snapshot, operation version, commit notification | Correct authority, but buried inside an 11,228-line integration hook. |
| Command admission | `useDocumentEditor.allowMutation` and command callbacks | review state, crop state, persistence/session locks | typed command drafts or rejection message | Must remain ahead of every canonical mutation. |
| Persistence session | `useDocumentEditor`, `DocumentDraftSaveController`, `StudioPersistenceApi` | settled history, source context, review journals | CAS draft writes, recovery/conflict state | Correctly excludes transient crop state. Do not move it into canvas code. |
| Selection | React state in `useDocumentEditor`; Fabric selection in `FabricCanvasAdapter` | UI selection intent and Fabric events | React selection projection and Fabric active objects | React effects call the adapter directly and selection repaint ownership is implicit. |
| Transform session | `FabricCanvasAdapter` transform session owner | Fabric moving/scaling/rotating events | transient Fabric object state, then `CanvasNodeChange[]` | Correct one-commit boundary. It must not become React state. |
| Image crop session | refs and state in `useDocumentEditor`; preview store in `@webmcp/editor` | crop intent, frame/placement previews | frame-coalesced external-store preview, then one command transaction | Store lifecycle, reconciliation, messages, and commit settlement are mixed through the main hook. |
| Continuous inspector preview | `FabricArtboardHandle` to `FabricCanvasAdapter` | node patch or restore request | transient Fabric object update and repaint | Calls bypass any named invalidation boundary. |
| Canonical review preview | `useDocumentEditor` memo | document, snapshot, pending change set | canonical preview document | Projection policy is embedded at the end of the main hook. |
| Asset preview projection | `useDocumentEditor` memo and asset URL refs | canonical preview, replacement preview, local/managed URLs | canvas-safe preview document | Presentation-only URL substitution sits beside command and persistence policy. |
| Fabric lifecycle and document synchronization | `FabricArtboard` effects | adapter attempt, document, page, fonts, image tokens | mount/unmount, serialized `adapter.sync`, runtime reports | Lifecycle checks are sound, but invalidation kinds are spread across effects. |
| Viewport and snap metadata | `FabricArtboard` effects plus DOM scale | zoom, page, snap targets | adapter viewport scale and snap targets | Direct adapter calls have no inspectable invalidation record. |
| Crop mode, crop draft, and selection projection | separate `FabricArtboard` effects and callbacks | interactivity, crop session, selection | adapter mode, draft preview, active Fabric selection | Ordering depends on effect placement and `ready` rather than one owner. |
| Fabric repaint | `FabricCanvasAdapter` methods | sync, selection, preview, guides, text, crop, transforms | `canvas.requestRenderAll()` | Repaint calls are valid inside the Fabric adapter, but the integration boundary cannot request or count repaint invalidations explicitly. |
| Thumbnail preview jobs | `DocumentPreviewController` | durable preview identity and repository events | bounded raster work, cache, cancellation | Already has a controller and stays separate from the live Fabric canvas. |
| WebMCP | `useStudioWebMcp` calling the public editor contract | tool input and current editor state | the same hook commands and review operations | Must see no API shape or behavior change from these extractions. |
| Renderer conformance | document fixtures, render view, renderer worker | canonical documents and assets | browser, PNG, and PDF evidence | Preview URL projection must never enter the canonical document or persistence. |

## Dependency direction after extraction

```text
Studio UI / WebMCP
        |
useDocumentEditor
        |-- useImageCropSessionController
        |       `-- @webmcp/editor crop session + preview store
        |
        |-- useDocumentPreviewProjection
        |       `-- canonical review + local/managed URL projection
        |
        `-- command/history/persistence authority, unchanged

FabricArtboard
        |
FabricRenderInvalidationController
        |-- document sync
        |-- viewport and snap metadata
        |-- selection
        |-- crop/continuous preview
        `-- explicit repaint request
                |
        CanvasAdapter interface
                |
        FabricCanvasAdapter
```

The extracted hooks depend on domain services and callbacks supplied by
`useDocumentEditor`. They do not import the editor hook or persistence. The
render invalidation controller depends only on `CanvasAdapter` and document
types. React owns controller construction and lifecycle. Fabric owns Fabric
objects, transform sessions, text editing, hit testing, and the final
`requestRenderAll()` implementation.

## Multi-artboard workspace extension

Studio will replace the single active-page artboard and bottom filmstrip with
one continuous workspace that shows every document page. The default layout is
vertical. The left Pages panel remains a navigation list. It does not become a
second editor or a source of page geometry.

### Coordination boundary

This branch records the multi-artboard contract but does not implement it. The
separate feature task owns the workspace host, page arrangement, camera, page
shells, visibility policy, Pages-panel navigation changes, and filmstrip
removal. This architecture task continues only the general
`useDocumentEditor` decomposition and the Fabric-compatible invalidation
boundary. It must not edit `page-filmstrip.tsx`, page-workspace UI, layout CSS,
or the Pages-panel interaction code.

### Integration contract from this branch

The feature task may consume these tested pieces without reaching into
`useDocumentEditor` internals:

- `FabricRenderInvalidationController` owns one attached `CanvasAdapter`. A
  multi-artboard registry creates one controller for each mounted page, passes
  the canonical document and that page id to `invalidateDocument`, and routes
  viewport, selection, preview, and repaint work through the named methods.
- `whenDocumentSettled` gives adapter teardown and visibility transitions a
  synchronization boundary. `detach` invalidates queued work by attachment
  identity. `getSnapshot` exposes invalidation counts for registry tests.
- `CanvasAdapter.requestRender` is the only public request for an explicit
  Fabric repaint. Fabric still owns `requestRenderAll` and frame coalescing.
- `useDocumentPreviewProjection` returns the canonical review projection and
  the canvas-safe asset projection. The feature task renders the latter but
  must never persist it or pass it to export.
- `ImageCropSessionController` keeps crop preview state outside React render
  state and settles through the existing editor callbacks. A future registry
  must keep the crop session's page mounted until settlement.
- The public editor command, history, persistence, selection, and WebMCP
  contracts remain unchanged. The feature task must use them rather than
  inventing page-specific mutation paths.

The controller is intentionally page-scoped, not workspace-aware. Layout
offsets, camera state, visibility, and active-page derivation belong above it.
The feature task may add a registry around multiple controllers, but it must not
add world coordinates to `CanvasAdapter`, document nodes, commands, or export.

This change adds two coordinate spaces:

- Page-local coordinates remain canonical. Node bounds, guides, crop frames,
  commands, history, persistence, renderer input, and export all use the page's
  own origin.
- World coordinates exist only in workspace state. They place page frames on
  the continuous canvas and let the camera pan or zoom across those frames.

`MultiArtboardLayoutController` will derive a `PageWorldFrame` for every page
from document order, page width and height, layout direction, and workspace
gap. It will provide `pageToWorld`, `worldToPage`, and document-bounds queries.
No command may write a world offset into a page or node. Reordering a page or
changing its dimensions recomputes the layout without rewriting node geometry.

`WorkspaceCameraController` will own the world-to-viewport transform. It will
handle pan, zoom, zoom-to-page, zoom-to-selection, and zoom-to-all-pages.
`MultiArtboardRenderRegistry` will own the set of mounted page adapters. Each
mounted page keeps its own `FabricRenderInvalidationController`; the registry
routes page-scoped invalidations and never turns the adapters into one shared
Fabric scene.

```text
canonical Document
        |
        | page order and page-local geometry
        v
MultiArtboardLayoutController ------> PageWorldFrame by pageId
        |                                      |
        | document bounds                      | page/world mapping
        v                                      v
WorkspaceCameraController ----------> MultiArtboardRenderRegistry
                                               |
                         +---------------------+---------------------+
                         |                     |                     |
                  page A controller     page B controller     page C preview
                  + Fabric adapter      + Fabric adapter      or placeholder
```

### Active page and selection ownership

`activePageId` remains ephemeral workspace navigation state. The canonical
document does not store it. The workspace derives it in this order:

1. A valid node selection owns the active page through `selection.pageId`.
2. A Pages-panel action or zoom-to-page request owns it until the camera motion
   finishes.
3. Passive pan and zoom choose the page containing the viewport center. If the
   center falls in a gap, the page with the largest viewport intersection wins.
   Document order breaks ties.

Fabric hit testing must return the page id with the node ids. Marquee, crop,
text editing, and transform sessions stay within the artboard where they
started. The existing `Selection` contract permits one page id, so cross-page
node selection is out of scope. A page may be active with no node selection.
Keyboard commands target the selection page first, then the active page.

Selecting a row in the left Pages panel updates the active page and asks the
camera to zoom to that page. It does not copy page data into editor state. A
selection change on an artboard updates the Pages-panel highlight through the
same active-page derivation.

### Invalidation and visibility policy

The registry will split invalidation by cause:

| Cause | Workspace action | Page-adapter action |
| --- | --- | --- |
| Page order, size, add, or remove | Recompute world frames and document bounds | Attach or detach only affected page entries |
| Page node revision | Keep the current layout unless page size changed | Sync only that page's adapter |
| Camera pan or zoom | Recompute viewport and visibility | Update mounted adapter zoom; do not resync page documents |
| Selection | Derive the active page | Select on the owner and clear stale adapter selections |
| Crop, transform, text, or inspector preview | Pin the owner page in the mounted set | Route the preview only to that page controller |
| Explicit repaint | No layout change | Request paint only from mounted affected adapters |

Every page keeps a lightweight world-frame shell so document height and scroll
position stay stable. A Fabric adapter mounts when its frame intersects the
viewport expanded by one viewport width and height on every side. Pages outside
that overscan use a cached preview or placeholder. The active interaction page
stays mounted until crop, transform, text editing, or continuous preview
settles, even if the camera moves it outside overscan. Adapter teardown must
abort queued document synchronization and clear its selection and previews.

Visibility changes are render state, not document changes. They do not enter
history or persistence. Camera movement must not enqueue `adapter.sync` for an
unchanged page.

### Camera commands and export

Zoom-to-page fits the selected `PageWorldFrame` inside the workspace viewport
with the existing safe inset. Zoom-to-all-pages fits the union of all page
frames. Zoom-to-selection converts the selected page-local bounds through
`pageToWorld` before fitting them. The inverse transform routes pointer input
back to the owning page before Fabric hit testing.

Export remains deliberately boring. Browser, PNG, and PDF rendering receive
the canonical document and page ids exactly as they do now. The multi-artboard
layout, camera, visibility state, cached previews, and world offsets never enter
renderer input. Two exports of the same canonical document must remain byte or
pixel equivalent under the existing conformance rules, regardless of camera
position or which artboards are mounted.

### Multi-artboard delivery gates

1. Add the pure layout controller and coordinate conversion tests. Cover mixed
   page sizes, reordering, gaps, empty documents, and round-trip conversion.
2. Add the camera controller and deterministic active-page derivation. Test
   Pages-panel focus, passive camera movement, gap tie-breaking,
   zoom-to-page, zoom-to-selection, and zoom-to-all-pages.
3. Add the page render registry and per-page invalidation routing. Prove that a
   page-local edit does not sync an unrelated adapter and camera movement does
   not cause document sync.
4. Replace the single artboard host with page shells, overscan mounting, and
   cold-page previews. Keep interaction pages pinned through settlement and
   test teardown during queued sync.
5. Remove the bottom filmstrip and make the left Pages panel navigation-only.
   Run history, crop, transform, persistence, WebMCP, renderer conformance, and
   accessibility checks before accepting the workspace change.

A large-document acceptance fixture should contain at least 100 mixed-size
pages. The number of mounted Fabric adapters must stay bounded by the viewport
and overscan set, and a camera-only interaction must produce zero document-sync
invalidations.

## OpenPencil comparison

The local OpenPencil checkout was inspected at
`outputs/reference-repos/editors/open-pencil` under the retained reference
root. Its `canvas/surface/render-loop.ts` coalesces callbacks on one animation
frame and distinguishes render, viewport, repaint, and selection events. Its
`editor/graph-events.ts` maps committed and preview graph changes to renderer
cache invalidation. Its surface lifecycle creates and destroys the renderer,
then pauses the render loop during teardown.

Studio should copy the ownership shape, not the implementation. Fabric already
coalesces `requestRenderAll`, owns object caches, and has tested transform and
crop behavior. Adding a second perpetual render loop would fight Fabric. The
Studio controller will therefore serialize document synchronization, route
named invalidations to the mounted adapter, expose counters for tests, and let
Fabric schedule the actual paint.

## Extraction gates

### Gate 2: split stable session and projection owners

1. Extract crop preview-store lifecycle and low-level session operations into
   `use-image-crop-session-controller.ts`.
2. Keep crop admission, settlement, command creation, history, and persistence
   in `useDocumentEditor` through injected callbacks.
3. Extract canonical review and asset URL projection into
   `use-document-preview-projection.ts`.
4. Add focused tests for crop lifecycle/reconciliation and preview purity.
5. Run the existing crop, history-commit, persistence, image-heavy, WebMCP crop,
   and typecheck suites before committing.

### Gate 3: add the Fabric render invalidation owner

1. Add a controller with typed document, viewport, selection, preview, and
   repaint invalidations.
2. Move document sync serialization out of React refs and into the controller.
3. Route the existing `FabricArtboard` effects and imperative preview calls
   through the controller. Keep attempt, timeout, abort, readiness, and focus
   behavior unchanged.
4. Add `requestRender` to the adapter contract so repaint requests have one
   public Fabric-compatible route.
5. Test invalidation routing, stale adapter rejection, serialized document
   sync, coalesced Fabric repaint, and unmount cleanup.

### Gate 4: focused acceptance and performance evidence

Run Studio typecheck and scoped lint, editor typecheck, Fabric adapter tests,
Fabric artboard lifecycle tests, crop and image-heavy mounted tests, history and
persistence tests, WebMCP crop tests, and renderer conformance structure checks.
Record exact commands and results in this document. A failing pre-existing or
environment-dependent check must be named; it must not be silently waived.

Gate 2 was accepted in commit `e851558`. Gate 3 was accepted in commit
`b52189b`. The final acceptance run used the repository's bundled Node
v24.19.0 because the shell default, Node 18, does not satisfy the repository's
Node requirement and cannot load the current Vitest dependency graph.

Acceptance results:

- Studio focused editor suite: 10 files and 46 tests passed with one worker.
  This covered the two extracted owners, the render invalidation controller,
  Fabric artboard unit and lifecycle behavior, crop, history settlement,
  image-heavy responsiveness, WebMCP crop, and Strict Mode persistence.
- Full mounted persistence suite: 94 tests passed.
- Full `@webmcp/editor` suite: 22 files and 376 tests passed.
- Render-view suite: 34 tests passed.
- Renderer suite: 3 files and 101 tests passed.
- TypeScript checks passed for Studio, editor, render-view, and renderer.
- The render conformance structure check passed for 11 canonical nodes, 3
  Fabric text projections, and 6 synchronous non-image Fabric objects.
- The Studio production client, SSR, and renderer builds passed. The build
  emitted only the existing chunk-size advisory.
- Scoped ESLint passed for every new architecture file and for the changed
  `fabric-artboard.tsx` file.

Full-file ESLint still reports 24 `no-unnecessary-condition` findings in
unchanged local-media sections of `use-document-editor.ts` and one finding in
the unchanged portion of `fabric-artboard.lifecycle.mounted.test.tsx`. Running
ESLint against those files as stored at base commit `c8aec74` produces the same
findings. They are baseline debt rather than regressions from this extraction.

The image-heavy mounted scenario remains under its existing five-second test
budget. No additional animation-frame loop was introduced: Fabric continues to
coalesce actual paints through `requestRenderAll()`.

## Merge overlap risk

The highest conflict risk is `use-document-editor.ts`, followed by
`fabric-artboard.tsx` and the `CanvasAdapter` interface. The separate Inspector
redesign must not modify the extracted controllers. If it also changes the main
hook return object or artboard props, merge the architecture branch first, then
reapply visual work against the unchanged public editor methods. No CSS,
Inspector component, route shell, page-filmstrip, page-workspace UI, or
design-system file belongs in this branch.

## 2026-09-01 post-integration image-sync incident

Status: repaired and live-verified

The first insertion of a curated image exposed two gaps in the accepted render
ownership contract. A document invalidation waited on the controller's prior
promise even after its caller had aborted, so one non-cooperative or delayed
adapter operation could keep every later update for that page queued. At the
same time, `FabricArtboard` discarded its ready identity and covered the last
good frame with a white blocking `Preparing canvas…` surface for every normal
incremental document edit. Undo or redo could appear to repair the image only
because it entered a later queue generation.

The repair makes abort settlement part of the controller contract around both
font preparation and adapter synchronization, allowing queued work to advance
even if the abandoned operation does not settle itself. The artboard now keeps
its last good frame interactive during an incremental sync, reserves the
blocking preparation surface for startup and explicit retry, reapplies the
latest selection after synchronization, and no longer treats changes to
interactivity or resource-token metadata as reasons to resynchronize the
document. Interactivity remains a separate named adapter concern.

Regression evidence:

- controller coverage proves an aborted adapter promise that never settles
  cannot strand the next document invalidation;
- mounted artboard coverage proves an incremental update preserves the ready
  frame and reapplies the exact selection after synchronization;
- the focused controller, lifecycle, library-media action, and picker-session
  suites pass 29/29 under the supported bundled Node runtime;
- Studio typecheck, scoped ESLint, Prettier, and `git diff --check` pass;
- a clean live run on port 3001 removed all prior test images, reloaded the
  persisted two-page document, inserted `Sandstone arches` as a new action,
  and confirmed that both artboards remained ready while the decoded image and
  its selected frame appeared on the active page.
