# Advanced editor depth Gate 2: auto layout and container clipping

- Entry: 2026-09-01
- Acceptance: 2026-09-02
- Gate 1 baseline: `7fa5cdd8b1a5f797348644c6aab15320d7d3d11b`
- Phase map: `advanced-editor-depth-phase-map-2026-09-01.md`
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 2 slice.

## Accepted contract

Gate 2 adds an explicit `frame` scene-node identity and keeps layout in the
canonical document layer.

- A frame owns an ordered list of child identities. Each child declares auto
  or absolute positioning, fixed or fill sizing on both axes, offsets, and a
  non-negative grow value. One child can belong to only one frame.
- A frame may use horizontal or vertical auto layout with fixed or hug frame
  sizing, four-side padding, gap, primary-axis packing, counter-axis alignment,
  and stretch. Nested hug frames are measured bottom-up, then arranged
  top-down into absolute page geometry.
- Frame-child order and page paint order are reconciled atomically with a
  stable topological pass. Layer-tree drag/drop can reorder existing children
  or place an ordinary layer inside a frame without admitting an invalid
  intermediate document.
- `clipsContent` owns overflow behavior. Every clipping ancestor remains an
  independent rounded clip in immediate-parent to outer-parent order. Nested
  clips are not flattened into a rectangle that would lose corner geometry.
- Page resizing applies Gate 1 constraints only to top-level page children.
  Frame-owned layers get their geometry from their frame. Flat documents keep
  their existing identity and behavior.
- Removing a child releases its frame reference. Semantic clone, built-in
  template materialization, component instance materialization, scaling, and
  quotation palette application preserve or remap frame relationships.

## Rendering and product surfaces

- Fabric uses absolute page-space clip paths, including a nested clip chain in
  retained mask-content paint. Fixed text regains its intrinsic text-box clip
  when frame clipping is disabled.
- React Artboards, retained mask content, and the shared paint-plan view use
  the same canonical clip stack. Renderer HTML does the same; thumbnails,
  document HTML, output HTML, PNG, and PDF therefore consume one HTML path.
- Frame paint projects like the existing bordered rectangle contract. Layout
  metadata is resolved before render projection, so no renderer owns a second
  layout engine.
- Layers shows frame identity and owned children once. The Inspector exposes
  frame direction, fixed/hug sizing, packing, alignment, gap, four-side
  padding, and clipping. A selected child exposes auto/absolute positioning,
  fixed/fill sizing, grow, and offsets.
- Review names layout direction, gap, child count, and clipping changes. The
  public WebMCP canvas-edit tool advertises a strict discriminated frame
  schema and rejects partial or unknown layout objects.

## Compatibility and bounded admission

The persisted schema remains version 6. This gate adds a new discriminated
node kind without changing any existing node shape or default, so every
existing schema-v6 document and published template keeps its bytes and render
result. A schema bump would add migration churn without a legacy value to
upgrade. New frames must carry their explicit child and layout values.

Frame owners are currently axis-aligned. A frame with children and non-zero
rotation is rejected because the canonical layout solver and CSS/Fabric clip
contract are page-axis based. Child rotation is supported inside the owner
clip. A frame-owned layer cannot simultaneously serve as a mask source; that
combination is rejected at admission rather than rendered differently across
Fabric, React, and export. Mask content may be frame-owned and has direct
conformance coverage.

## Reference review

The gate re-read these exact OpenPencil files:

- `packages/scene-graph/src/types.ts`
- `packages/scene-graph/src/node-defaults.ts`
- `packages/core/src/layout/apply.ts`
- `src/components/properties/LayoutSection/AutoLayoutControls.vue`
- `src/components/properties/LayoutSection/ClipContentControl.vue`

It also re-read Loora's `packages/canvas/src/model.ts`,
`packages/canvas/src/style-css.ts`, the relevant property-panel controls, and
`agent/src/canvas-tools.ts`.

Studio follows OpenPencil's separation between container and child layout
properties, but does not import Yoga or renderer-local relative geometry. It
resolves the smaller accepted vocabulary into Studio's existing absolute page
model. Loora's typed patch and CSS-projection discipline informed the strict
WebMCP and export boundaries; its responsive website breakpoint model was not
applicable to fixed document pages.

## Independent review

The separate acceptance pass inspected schema admission, solver order,
component and clone identity, page ordering, Layer-tree behavior, all three
render implementations, retained mask content, Inspector, Review, WebMCP,
history, and test coverage.

Five findings were repaired before acceptance:

1. Empty hug frames initially rejected zero inner space. Empty and
   absolute-only frames now remain valid while non-empty auto flow still
   rejects impossible padding.
2. Fixed text lost its intrinsic box clip after frame clipping was switched
   off. Fabric now restores it explicitly.
3. Mask-content paint initially received frame clipping only on ordinary paint
   paths. React and Fabric now thread the document through retained mask
   content, with a dedicated React regression.
4. Intersecting nested clips into one rectangle discarded inner rounded
   corners. All renderer paths now retain the complete ordered clip stack.
5. Child reordering could make frame metadata and page paint order disagree.
   A stable atomic order reconciliation now covers direct edits, Layers
   drag/drop, WebMCP, and reconciled component instances.

No P0 or P1 issue remained after those repairs.

## Verification

All authoritative commands used the bundled Node 22 runtime. No development
server was started and port 3000 was not used.

- `bun run typecheck`: all eight workspaces passed.
- Serial `@webmcp/document` suite: 42 files, 448 tests passed.
- `@webmcp/render-view` suite: 1 file, 37 tests passed.
- Renderer HTML suite: 1 file, 43 tests passed, including the browser
  luminance probe and the shared HTML path used by PNG/PDF.
- WebMCP registration suite: 1 file, 47 tests passed.
- Studio Inspector and Review suites: 2 files, 27 tests passed.
- Editor history and Layers suites: 2 files, 45 tests passed.
- Focused Fabric frame-clip tests: 2 passed. The full Fabric file remains
  limited on this host by the pre-existing optional native-canvas binding;
  Gate 2's structural clip tests do not require that binding.
- `git diff --check`: passed.

A four-suite concurrent run was not used as an acceptance signal because its
pre-existing wall-clock assertions timed out under CPU contention. The same
document and React suites passed serially above.
