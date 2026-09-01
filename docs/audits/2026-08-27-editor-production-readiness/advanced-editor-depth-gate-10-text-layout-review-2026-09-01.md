# Advanced editor depth Gate 10: advanced text layout

- Entry: 2026-09-02
- Acceptance: 2026-09-02
- Gate 9 baseline: `c5cb1cf6360691cb6329dcac5d6cf72e3e8a6766`
- Implementation checkpoint: `e1fffda87d0a6445aaa651d51a448c9939ccbcc2`
- Ledger mapping: capability item 9
- Phase map: implementation Gate 10
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 10 slice.

## Accepted contract

Text layers admit optional canonical direction, vertical alignment, case,
truncation, and maximum-line fields. Paragraph alignment now admits justify.
The optional layer fields preserve legacy schema-v6 bytes; their shared render
projection resolves `auto`, `top`, `original`, `clip`, and unlimited lines when
they are absent. Strict patches reject unknown values and line limits outside
1–100.

Direction, vertical alignment, case, truncation, and maximum lines are
layer-level behavior. Justification remains paragraph-level and can therefore
be applied to an exact rich-text selection without inventing character-run
semantics. Direct Fabric editing projects the authored string without case or
truncation so the hidden textarea, caret, selection, links, and range offsets
continue to use canonical UTF-16 source positions.

The managed-font layout projector is now version 3. It resolves automatic text
direction from the first strong character, applies case before measurement,
retains authored source ranges for projected glyphs, measures expanding Unicode
case transforms, and preserves ordered run/link styling. It reports displayed
and source line counts separately. Full intrinsic dimensions and overflow stay
observable while fixed containers and optional maximum lines select the visible
line set. Ellipsis is a synthetic final segment measured against the same
managed-font width contract.

The common render projection carries all resolved text behavior. Fabric uses
the projected display lines, direction, and deterministic top/middle/bottom
offset. React and renderer HTML use matching direction and flex-column vertical
placement, retain the existing per-line justification spacing, and expose exact
text-layout metadata. PNG and PDF consume that renderer HTML rather than a
separate interpretation.

Design-plan compilation, component overrides, responsive cloning, typed node
commands, Review summaries, and strict WebMCP canvas/component schemas retain
the same fields. The Inspector exposes justification, automatic/LTR/RTL
direction, top/middle/bottom vertical alignment, original/upper/lower/title
case, clip/ellipsis, and an optional 1–100 line limit.

## Separate review repair

The post-implementation review found one Unicode measurement edge: a case
transform can expand one authored code point into multiple displayed glyphs,
for example `ß` to `SS`. The projector was repaired before acceptance to
measure each displayed glyph while retaining the overlapping authored source
range. The existing 28,000-character late-wrap performance fixture remained
inside its 250 ms budget after the repair.

## Product surface and browser acceptance

A mounted browser journey ran on `http://localhost:3002/`; port 3000 was not
used. It selected **Quotation title** from Layers, changed paragraph alignment
to Justify, direction to Right to left, vertical alignment to Middle, case to
Uppercase, overflow to Ellipsis, and maximum lines to 1. Undo restored the
default 3-line limit and Redo restored 1. Autosave reached **All changes saved**
at revision 31. After a full reload, all six controls and the one-line limit
were restored exactly.

## Verification

All commands used the bundled Node 22 runtime.

- `bun run typecheck`: all eight workspaces passed.
- `@webmcp/document`: 49 files, 479 tests passed.
- `@webmcp/render-view`: 2 files, 44 tests passed.
- `@webmcp/renderer`: 3 files, 106 tests passed.
- `@webmcp/webmcp`: 5 files, 78 tests passed.
- Focused Fabric advanced-text projection: 1 test passed.
- Focused mounted Inspector and Review detail: 2 tests passed.
- Mounted configure/Undo/Redo/autosave/reload journey: passed on port 3002.
- `git diff --check`: passed.
- Prettier over every changed source, test, and audit file: passed.

The full local Editor suite still contains its previously recorded jsdom
Canvas 2D environment failures; the focused pure Fabric projection test and the
real browser journey passed. No Gate 10 failure was hidden by that baseline
harness limitation.
