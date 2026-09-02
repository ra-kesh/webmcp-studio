# Advanced editor depth Gate 6: multiple fills and strokes

- Entry: 2026-09-02
- Acceptance: 2026-09-02
- Gate 5 baseline: `ccc5879dcc3d0b410dc5292d20ec10a3f832a302`
- Ledger mapping: capability item 5
- Phase map: implementation Gate 6
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 6 slice.

## Accepted contract

Gate 6 adds optional ordered `fills` and `strokes` arrays to rectangles,
frames, ellipses, icons, and lines. Each paint has a stable unique ID, color,
zero-through-one opacity, visibility, and the accepted Gate 4 blend mode. Each
stroke also owns its width. A stack is bounded to eight entries and rejects
duplicate IDs, unknown fields, invalid opacity, invalid blends, and negative
stroke widths.

Fill order is authored back to front, followed by stroke order back to front.
An explicit empty array means no paint and never falls back to the legacy
field. Hidden or zero-opacity entries retain their exact ordered position.

## Legacy projection and mutation

The arrays are optional, so every existing schema-v6 node parses to the same
bytes. When arrays are absent, the shared projection synthesizes one
`legacy-fill` and, when applicable, one `legacy-stroke` without changing the
stored document. New array mutations synchronize the legacy `fill`, `stroke`,
and `strokeWidth` fields to the first entry for older consumers. A later legacy
field edit updates the first explicit paint without flattening later paints.
An explicit empty stack remains empty after a legacy edit.

Inspector add, remove, reorder, visibility, color, opacity, blend, and width
operations commit complete typed arrays through the existing `update_node`
command. This keeps history, Review, autosave, replay, and WebMCP on one command
boundary without renderer-owned serialization.

## Render and design-system parity

`paint-stack.ts` owns legacy projection, visible-paint selection, primary-field
synchronization, and stroke scaling. `render-projection.ts` resolves default
blend modes once for all downstream renderers.

- Fabric keeps legacy single-paint objects unchanged. Explicit stacks become
  one atomic group with ordered child paints, per-paint opacity, visibility,
  composite operation, and one canonical transform. Committed stack edits
  replace that group atomically.
- React and renderer HTML emit ordered SVG paint geometry. Rectangles and
  frames reuse the Gate 5 smooth-corner path, ellipses share one local frame,
  icons reuse their canonical path/view box, and lines retain their canonical
  endpoints.
- Node opacity and blend remain on the outer layer; per-paint opacity and blend
  remain on each ordered paint. Hidden paints stay in the DOM/Fabric group so
  re-enabling them does not alter order.
- Component transforms and responsive output adaptation scale every stroke
  entry. Fill values, paint opacity, visibility, and blend mode are
  dimensionless and remain unchanged.
- Applying or propagating an existing paint style updates the primary explicit
  paint and preserves the remainder. A legacy fill/stroke variable binding
  follows the same primary-paint rule.

## Product surfaces

- The existing Appearance section now shows compact fill and stroke lists with
  add, remove, reorder, visibility, color, opacity, blend, and width controls.
  No Inspector layout or style-system migration was made.
- Review describes stack count and visible count deterministically instead of
  dumping raw paint JSON.
- WebMCP advertises strict bounded arrays for typed canvas edits and component
  overrides. Its proposal allowlist, canonical preview, public change-set
  projection, and responsive output scaling retain the arrays.
- Component override reconciliation admits `fills` and `strokes`; instance
  materialization and transform rebasing preserve order and scale widths.

## Reference review

The gate re-read OpenPencil's current
`packages/scene-graph/src/types.ts`. Studio follows its canonical ordered fill
and stroke arrays, per-paint opacity/visibility, optional fill blend mode, and
stroke-owned weight. Studio deliberately keeps solid colors only at this gate;
gradients, images, noise, patterns, and advanced stroke geometry are separate
capabilities. Advanced alignment, sides, dashes, caps, joins, and miter enter
phase-map Gate 7.

## Independent review and browser evidence

The review covered strict schema behavior, byte-compatible legacy parsing,
explicit-empty behavior, hidden-first primary edits, order, style/variable
propagation, component overrides, responsive scaling, Fabric groups, React and
renderer HTML, Inspector operations, Review text, and WebMCP proposal replay.

A mounted browser journey ran the isolated branch on `http://localhost:3002/`;
ports 3000 and 3001 were not touched. It opened the sample document, inserted a
rectangle, added a second fill and a stroke, changed the colors to `#112233`,
`#ff6600`, and `#ffffff`, moved the orange fill to the first position, hid it,
and observed the canvas immediately show the remaining dark fill with the
white edge. Undo restored the orange fill; Redo hid it again. Autosave reached
“All changes saved,” and a full reload restored the exact order, colors,
visibility, and stroke.

The current-page PNG action was also exercised. It reached the server and
surfaced `PNG export failed (500)` because this isolated local D1 had no
`demo_sessions` or `api_request_audit` tables. The failure occurred before
document rendering and is not paint-stack-specific. Renderer HTML and export
ownership remain covered by the green render-view and renderer type/suite
evidence below. No paint-stack console error was observed.

## Verification

All commands used the bundled Node 22 runtime.

- `bun run typecheck`: all eight workspaces passed.
- `@webmcp/document`: 46 files, 465 tests passed.
- `@webmcp/render-view`: 2 files, 41 tests passed.
- `@webmcp/webmcp`: 5 files, 77 tests passed.
- Focused Fabric paint-stack/blend/corner selection: 3 tests passed; 116
  unrelated tests skipped by the name filter.
- Focused Studio Review paint-stack summary: 1 test passed; 14 unrelated tests
  skipped by the name filter.
- Mounted browser add/edit/reorder/toggle/Undo/Redo/autosave/reload journey:
  passed on port 3002.
- `git diff --check`: passed.
- Prettier over every changed source, test, and audit file: passed.

No P0 or P1 finding remained after the WebMCP allowlist repair and the mounted
journey.
