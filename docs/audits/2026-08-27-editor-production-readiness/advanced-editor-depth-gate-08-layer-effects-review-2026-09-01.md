# Advanced editor depth Gate 8: shadows, blur, and effects

- Entry: 2026-09-02
- Acceptance: 2026-09-02
- Gate 7 baseline: `bf2cefefb9bfa393c37085ce65204e94409c29f3`
- Implementation checkpoint: `db515d772c84697556789c9fe3c07f60a059f935`
- Ledger mapping: capability item 7
- Phase map: implementation Gate 8
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 8 slice.

## Accepted contract

Every layer can own an optional ordered stack of up to eight effects. Gate 8
admits portable drop shadows and layer blur. A drop shadow owns a stable ID,
hex RGB/RGBA color, bounded X/Y offset, blur radius, and visibility. A layer
blur owns a stable ID, radius, and visibility. Effects remain optional so
legacy schema-v6 documents parse without new stored fields or changed bytes.

The schema rejects duplicate IDs, unknown fields, blur radii above 64 px,
offsets outside ±4096 px, malformed effect colors, and visible stacks whose
combined blur budget exceeds 128 px. This bounds renderer resources before a
proposal reaches Canvas, Review, persistence, or export.

## Bounds, compositing, and masks

`effect-stack.ts` owns visible-effect projection, authored filter order,
deterministic bounds expansion, and scaling. Layer blur expands all sides by
twice its radius. Drop shadows union the current bounds with their offset blur
extent. Hidden effects retain order but consume neither bounds nor blur budget.

Fabric wraps an effected layer in one atomic `EffectGroup` and applies the
ordered Canvas 2D filter chain while rendering its fully composited child.
React and renderer HTML use the identical ordered CSS filter chain on the
canonical layer frame. This applies effects after layer paint/opacity and
before a retained parent mask or clipping boundary. The retained-mask fixture
proves a shadowed, blended content layer stays inside the ordinary mask paint
path before the vector mask is applied.

Component transforms and responsive output variants scale shadow offsets,
shadow blur, and layer blur. IDs, order, colors, types, and visibility remain
unchanged. Review summarizes effect and visible counts instead of exposing raw
records. WebMCP advertises the strict stack on every typed canvas-node patch and
component override boundary.

## Product surface and browser acceptance

The Inspector adds one compact Effects section without changing the existing
Appearance layout. It supports add shadow, add blur, reorder, visibility,
remove, shadow color/offset/blur, and layer-blur radius. Every action commits
the complete typed stack through `update_node`, preserving history, Review,
autosave, replay, and component override semantics.

A mounted browser journey ran on `http://localhost:3002/`; port 3000 was not
used. On the Gate 7 acceptance rectangle it added a drop shadow and layer blur,
changed the shadow color to `#11223366`, changed layer blur to 6 px, and moved
blur before shadow. Undo restored shadow-first order and Redo restored
blur-first order. Autosave reached “All changes saved.” A full reload and layer
reselection restored blur-first order, the exact shadow color, and the 6 px
radius.

The isolated local PNG endpoint remains blocked before rendering by the
previously recorded missing D1 session/audit tables. Gate 8 export parity is
therefore accepted at the shared React/renderer HTML boundary, deterministic
bounds fixture, mask fixture, and output-variant scaling fixture.

## Verification

All commands used the bundled Node 22 runtime.

- `bun run typecheck`: all eight workspaces passed.
- `@webmcp/document`: 48 files, 471 tests passed.
- `@webmcp/render-view`: 2 files, 43 tests passed.
- `@webmcp/webmcp`: 5 files, 77 tests passed; the focused output-variant suite
  passed 14 tests after adding exact effect scaling.
- Focused Fabric paint/effect stack: 3 tests passed.
- Focused Studio Review details: 16 tests passed.
- Mounted browser add/edit/reorder/Undo/Redo/autosave/reload journey: passed on
  port 3002.
- `git diff --check`: passed.
- Prettier over every changed source, test, and audit file: passed.

No P0 or P1 finding remained after the conformance-frame expectation and
retained-mask fixture repairs.
