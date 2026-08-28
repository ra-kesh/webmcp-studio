# GUIDE-01B phase-entry audit: rulers and page-local guides

Date: 2026-08-28
Status: phase-entry contract only; no production code changed

## Decision

Implement zoom-aware viewport rulers and persistent page-local guides as a
versioned editor-workspace sidecar. They are not canonical document nodes,
quotation content, bindings, template data, renderer input, publication data,
or export output.

The guide coordinate is expressed in the active page's canonical coordinate
system. A vertical guide stores an `x` position and a horizontal guide stores a
`y` position. The sidecar is keyed by `document.id` and `page.id`, so guides
survive page switches and local reloads without leaking onto another page or
changing the document revision, snapshot ID, operation version, render hash, or
published bytes.

This is an intentional Studio departure from OpenPencil. OpenPencil stores
guides on canvas/frame scene nodes for `.fig` fidelity. The current Studio
product requirement places them in editor state. If shared guides are required
later, sync this sidecar through a separate workspace-state repository. Do not
quietly add it to `@webmcp/document`.

## Evidence reread before this decision

The retained audit and backlog say GUIDE-01 is a viewport-dependent quality
slice, not a renderer or quotation feature. `remediation-progress.md` now
records GUIDE-01A as implemented and independently reviewed. The current tree
has:

- `packages/editor/src/viewport.ts`: the canonical `{ x, y, zoom }` camera math.
- `apps/studio/src/features/studio-shell.tsx`: the live camera owner and the
  fixed `workspaceRef` viewport. The artboard is translated inside this
  viewport, so ruler chrome must be a sibling overlay, not a child of the
  transformed artboard.
- `apps/studio/src/features/editor/use-canvas-gesture-navigation.ts`: scoped,
  request-animation-frame-coalesced wheel and gesture navigation.
- `packages/editor/src/snapping.ts`: deterministic page/object move snapping
  and transient alignment/spacing guides.
- `packages/editor/src/transform-constraints.ts`: zoom-aware resize snap
  acquire/release thresholds and typed per-axis latches.
- `packages/editor/src/fabric-adapter.ts`: public Fabric transform lifecycle,
  transient guide painting, guide/latch cleanup, and the one-commit transform
  session boundary.
- `apps/studio/src/features/editor/fabric-artboard.tsx`: the adapter boundary
  already receives live zoom through `setViewportZoom`.
- `packages/editor/src/product-commands.ts`: the generated View menu, command
  search, context-menu projection, checked state, and stable command execution
  path. It has zoom actions but no ruler or persistent-guide actions.

This means GUIDE-01B should add one sidecar model and one viewport overlay. It
must not rebuild the camera, Fabric transform sessions, document history,
renderer, or current move/resize constraint math.

## Exact OpenPencil references

Reference checkout:
`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil`
at commit `88c107707132`.

The implementation patterns inspected were:

- `packages/core/src/canvas/rulers.ts`: fixed 20 px top/left rulers, world range
  derived from pan/zoom, 1/2/5 × 10^n major steps, five minor subdivisions,
  selection bands, and coordinate badges.
- `packages/core/src/canvas/guides/{types,geometry,draw,hit-test,redlines}.ts`:
  separate persistent data, transient hover/selected/preview state, screen-space
  hit tolerance, world-to-screen projection, and overlay-only drawing.
- `packages/core/src/editor/guides.ts`: add/move/remove/transfer actions with
  finite-value guards and one commit on release.
- `packages/scene-graph/src/guides.ts`: the minimal `{ id, axis, position }`
  data shape.
- `packages/vue/src/canvas/guides/input.ts` and
  `packages/vue/src/canvas/useCanvasInput.ts`: ruler drag ownership, drag
  threshold, live preview without data mutation, existing-guide drag,
  Alt/Option duplication, delete/backspace, cursor changes, and cleanup.
- `packages/vue/src/shared/input/explicit-snap-targets.ts`: persistent guides
  become explicit snap targets instead of a second snapping engine.
- `packages/vue/src/canvas/surface/overlays.ts`: ruler visibility belongs to the
  canvas presentation boundary and is disabled in embedded/mobile contexts.
- `src/components/editor/ZoomDropdown.vue`,
  `src/app/shell/menu/{schema,editor-actions,app-menu}.ts`, and
  `src/app/editor/session/types.ts`: one checked View command owns ruler
  visibility across browser and desktop menus.
- `tests/engine/vue/input/guides.test.ts`: click-without-drag, preview/commit,
  duplication, discard, ownership, and ruler-hover precedence tests.

Patterns to adopt are the fixed viewport overlay, zoom-derived tick spacing,
screen-pixel hit targets, ephemeral drag preview, explicit snap targets, and
checked View command. Do not copy OpenPencil's CanvasKit renderer or scene-node
ownership.

## Smallest production-worthy slice

### 1. Add a pure guide/workspace model

Create a framework-independent module in `@webmcp/editor` with these concepts:

- `PageGuide`: `{ id, axis: "x" | "y", position }`.
- `PageGuideState`: ordered guides for one page plus transient selected/hovered
  identity kept outside persisted data.
- `EditorWorkspacePreferences`: `rulersVisible` and `guidesVisible`.
- strict add, move, remove, duplicate, prune, decode, and encode functions.
- pure page-to-screen, screen-to-page, ruler-step, tick, hit-test, and drag
  reducers.

Persist only stable preferences and guide records. Do not persist hover,
selection, drag preview, camera, snap latch, or DOM measurements.

Use a versioned local key such as `webmcp-studio:editor-workspace:v1` with this
shape:

```ts
type EditorWorkspaceRecordV1 = {
  version: 1
  preferences: {
    rulersVisible: boolean
    guidesVisible: boolean
  }
  documents: Record<string, { pages: Record<string, { guides: PageGuide[] }> }>
}
```

Parsing is strict and bounded. Reject duplicate IDs, non-finite coordinates,
unknown axes, oversized strings, and more than 256 guides per page. Clamp new or
moved guides to the active page bounds. Prune missing document/page keys after
document replacement or page deletion. A corrupt workspace record must never
block or replace the document: preserve the raw sidecar under a separate
quarantine key, reset only editor-workspace state, and report a recoverable
status.

### 2. Render one fixed viewport overlay

Add a `CanvasRulerGuideOverlay` beside the translated artboard inside
`workspaceRef`. It receives the live camera, viewport size, page dimensions,
active-page guides, preferences, and guide interaction callbacks.

Use one device-pixel-ratio-aware Canvas 2D overlay for rulers, guide lines,
coordinate labels, selection bands, and drag preview. Keep it
`pointer-events: none`; add only two narrow pointer hit strips for the top and
left rulers and screen-space guide hit regions. Do not place a full transparent
element over Fabric.

The ruler is 20 CSS px on precise-pointer desktop layouts. Its chrome never
scales with the page. Major ticks target roughly 80 CSS px using the
`1, 2, 5 × 10^n` sequence; minor ticks subdivide the major interval. Labels use
tabular numerals, skip collisions, support negative panned coordinates, and
remain legible at 10%, fit zoom, 100%, and 400%. Guide lines and hit tolerances
remain 1 CSS px and 6 CSS px respectively at every zoom.

Draw on `requestAnimationFrame`. Resize with `ResizeObserver`. Scale the backing
store by `devicePixelRatio`, and perform all math in CSS pixels before drawing.
The overlay must not trigger React state for every pointer move; keep the live
drag preview in an external/ref-backed controller and publish only settled
changes.

### 3. Add direct and accessible guide interaction

- Drag from the top ruler to create a horizontal `y` guide.
- Drag from the left ruler to create a vertical `x` guide.
- A click without crossing the existing drag threshold creates nothing.
- Hover and selection have distinct quiet states. A selected or dragged guide
  shows its exact page coordinate in the matching ruler.
- Drag an existing guide to move it. Alt/Option-drag duplicates it. Releasing in
  the source ruler removes the original; releasing outside the page cancels a
  new guide and preserves an existing guide.
- Delete or Backspace removes the selected guide when canvas/guide scope owns
  the key and text editing is inactive. Escape cancels a live guide drag before
  transform/text/crop/selection settlement.
- Page switch, document replacement, ruler/guide hide, compact-panel modal
  opening, review transition, and unmount cancel preview and clear hover.

Pointer drag is not the only path. Add `Manage guides…` to the View menu and
command search. Its labelled dialog lists the current page's guides, axis and
coordinate, supports exact numeric add/edit, and provides named Remove buttons.
Focus returns to the opener. Errors are inline, and updates use a polite status.
This is the keyboard and screen-reader alternative to ruler dragging.

### 4. Reuse snapping rather than adding a second engine

Extend the current snap target language with source `"guide"`. Feed visible
active-page guides into both move snapping and the existing resize constraint
policy. Persistent guide targets outrank page/object candidates at equal
distance because they express explicit user intent.

Move snapping currently uses a fixed document-space threshold and no latch.
Before persistent guides are enabled, give it the same 8 px acquire / 12 px
release, zoom-converted per-axis latch contract already used by resize. Without
that correction a guide becomes too sticky at 10% and too hard to acquire at
400%. Hidden guides must neither hit-test nor snap; invisible magnetic lines are
not acceptable.

Keep move/resize preview Fabric-local. A guide snap still settles through the
existing one `object:modified` document batch. Guide creation/movement itself
updates only workspace state and never calls `onNodesChange`.

### 5. Route commands and undo truthfully

Add stable product commands for checked `Rulers`, checked `Guides`, and `Manage
guides…`. Toggle commands are non-mutating document commands and remain
available during pending review. Guide add/move/remove are editor-workspace
mutations and must not alter review, publication, or canonical revision state.

Guide changes still need undo. Add a bounded guide-history controller that
stores before/after guide arrays, labels, and timestamps without document
copies. The Studio command router must keep a small session action ledger so
`history.undo` and `history.redo` choose the latest document or guide action in
true chronological order. Undoing a guide action changes no document revision,
snapshot ID, operation version, pending change set, or selection. Do not create
a second keyboard listener or a guide-only hidden shortcut.

## Exact code and test boundaries

Expected production files:

- `packages/editor/src/page-guides.ts` for strict data, workspace codec, pure
  geometry/ticks/hit testing, drag reducer, and bounded guide history.
- `packages/editor/src/snapping.ts` for explicit `guide` targets, screen-space
  move thresholds, priority, and move latch. Preserve spacing behavior.
- `packages/editor/src/transform-constraints.ts` for accepting explicit guide
  targets in the existing resize policy. Do not duplicate its math.
- `packages/editor/src/index.ts` for public types and `CanvasAdapter` guide sync
  only.
- `packages/editor/src/fabric-adapter.ts` for receiving active-page guide
  targets and using them in move/resize preview. It does not render rulers or
  persist guides.
- `packages/editor/src/product-commands.ts` and the existing command registry
  tests for View commands, checked state, search, shortcut reference, and
  duplicate-ID/chord protection.
- `apps/studio/src/features/editor/editor-workspace-state.ts` for the versioned
  local repository, quarantine, pruning, and persistence boundary.
- `apps/studio/src/features/editor/canvas-ruler-guide-overlay.tsx` for the fixed
  overlay, pointer owner, rAF drawing, and accessible dialog trigger contract.
- `apps/studio/src/features/editor/guide-manager-dialog.tsx` for exact numeric
  keyboard/screen-reader management using existing Dialog, Button, and Input
  primitives.
- `apps/studio/src/features/editor/fabric-artboard.tsx` to pass active-page
  guide targets through the adapter boundary.
- `apps/studio/src/features/studio-shell.tsx` to own workspace state, mount the
  overlay beside the translated artboard, project checked command state, route
  Escape/undo, and cancel stale previews.

Expected tests:

- `packages/editor/test/page-guides.test.ts`
- `packages/editor/test/snapping.test.ts`
- `packages/editor/test/transform-constraints.test.ts`
- `packages/editor/test/fabric-adapter.test.ts`
- `packages/editor/test/product-commands.test.ts`
- `apps/studio/src/features/editor/editor-workspace-state.test.ts`
- `apps/studio/src/features/editor/canvas-ruler-guide-overlay.test.tsx`
- `apps/studio/src/features/editor/guide-manager-dialog.test.tsx`
- a focused Playwright guide/ruler specification and visual snapshots at the
  viewport matrix described below.

## Non-browser acceptance

Pure model and persistence:

- 1/2/5 tick steps and stable labels at 10%, 25%, fit, 100%, and 400%; negative
  camera positions and high-DPI backing stores.
- page/screen round trips under arbitrary camera pan/zoom.
- ruler axis mapping, click-without-drag, threshold crossing, preview, commit,
  cancel, move, duplicate, remove, Escape, and every settlement cleanup path.
- 6 px hit tolerance remains 6 screen pixels at every zoom.
- page-local isolation, page/document pruning, strict version decode, bound and
  duplicate rejection, corruption quarantine, and exact reload persistence.
- guide actions leave canonical document bytes, revision, snapshot ID,
  operation version, review state, and renderer input unchanged.
- bounded guide history and chronological document/guide Undo/Redo routing.

Snap integration:

- persistent guide wins an equal-distance tie over page/object targets;
- move and resize acquire at 8 screen px, hold until 12 screen px, then release
  at 10%, 100%, and 400%;
- hidden guide state produces no target, line, hit, or latch;
- move/resize completion remains one document history entry; cancel/rejection
  restores geometry and clears transient snap plus persistent-guide preview;
- rotated resize keeps GUIDE-01A's deliberate world-axis snap decline.

Component tests:

- ruler and guide toggles expose checked state through View, compact More,
  context View, command search, and shortcut/help projection;
- manager dialog has a programmatic title, labelled axis/position fields,
  inline validation, named remove controls, focus containment, Escape close,
  and opener focus restoration;
- guide pointer strips do not intercept Fabric outside their hit regions;
- rAF work cancels and observers/listeners detach on unmount.

Run focused editor and Studio tests, both typechecks, scoped ESLint, Prettier,
and `git diff --check`. Do not start Vite, Playwright, Wrangler, Browser
Rendering, or a production build on the currently unhealthy host.

## Browser and visual acceptance

When the host is healthy, verify with real mouse/trackpad use:

1. At 1440 × 900 and 1280 × 800, toggle rulers from View, pan and zoom through
   10%, fit, 100%, and 400%, and confirm origin/ticks stay attached to page
   coordinates while chrome stays 20 px.
2. Create horizontal and vertical guides from both rulers, move, duplicate,
   remove, Escape-cancel, page-switch, reload, and Undo/Redo. Confirm page-local
   persistence and no document revision/snapshot change.
3. Move and resize ordinary shapes and fixed/auto-height text into a persistent
   guide at low/high zoom. Confirm 8/12 px acquire/release, one document history
   entry, and no guide flicker or invisible snapping.
4. Exercise View/Manage guides from keyboard, command search, compact More, and
   pending review. Pointer gestures and the dialog must produce the same stored
   guide state.
5. At 320, 390, 768, 1119, 1120, 1280, and 1440 px, assert no document-level
   overflow, no ruler obstruction of compact controls, and no guide overlay over
   the filmstrip, zoom HUD, selected-image toolbar, Sheet, Dialog, or menu.
6. Capture visual snapshots for no selection, selected object, guide hover,
   guide selected, guide drag with coordinate badge, rulers hidden, guides
   hidden, light theme, fit zoom, and 400% zoom.

The browser gate must also verify browser magnification outside the canvas,
ordinary canvas wheel/pinch ownership, coarse-pointer behavior, focus-visible
states, and that the 20 px precise-pointer ruler does not become an inaccessible
touch-only target. Compact/coarse-pointer users use the 44 px menu/dialog path.

## Risks and blockers

1. The ruler cannot live inside `FabricArtboard`: that element is page-sized,
   translated, and scaled. Doing so would scale the ruler and clip viewport
   lines to the page.
2. Fabric's current transient snap painter uses page coordinates and variable
   screen widths. Do not reuse it as the ruler renderer. Share target math, not
   drawing ownership.
3. `SnapGuide` and resize latches currently distinguish only page/object. Adding
   `guide` requires exhaustive type and priority updates. A cast would hide a
   real tie-breaking bug.
4. The current move snap threshold is document-space and lacks hysteresis. This
   must be corrected before persistent guide snapping is enabled.
5. Sidecar persistence must not silently claim portability. Document JSON,
   template publish, WebMCP inspection, PNG, and PDF will intentionally omit
   guides in this phase.
6. Ruler pointer strips can steal canvas gestures if their bounds or z-order are
   wrong. Test hit ownership at the 20 px boundary and during menus/dialogs.
7. Guide Undo/Redo must share the existing command owner. A second keyboard
   listener would recreate the command-integrity defect already fixed by
   CMD-01.

There is no architecture blocker. The only completion blocker is the known
unhealthy browser/Worker host, which prevents real pointer and visual evidence.
Implementation can proceed with non-browser gates, but GUIDE-01B cannot be
called visually complete until the browser matrix passes.

## Explicit non-goals

- Document-global guides, cross-page guide transfer, grids, margins, columns,
  layout constraints, auto-layout, bleed/safe-area systems, or measurement
  units other than page coordinates.
- Frame-local/rotated guides. Studio's first guide model is axis-aligned and
  page-local.
- Renderer, PDF, PNG, quotation, template, publication, API, or WebMCP guide
  fields.
- Replacing Fabric, rewriting GUIDE-01A, or changing the canonical document
  geometry model.
