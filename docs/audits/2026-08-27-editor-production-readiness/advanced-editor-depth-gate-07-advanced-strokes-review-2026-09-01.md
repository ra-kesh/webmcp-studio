# Advanced editor depth Gate 7: advanced strokes

- Entry: 2026-09-02
- Acceptance: 2026-09-02
- Gate 6 baseline: `06125ee1e8a63be1e8c7d8f99be14fbb992b0072`
- Implementation checkpoint: `bf2cefefb9bfa393c37085ce65204e94409c29f3`
- Ledger mapping: capability item 6
- Phase map: implementation Gate 7
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 7 slice.

## Accepted contract

Each stroke paint can now own alignment (`inside`, `center`, or `outside`), an
independent top/right/bottom/left side mask, a bounded dash array, cap, join,
and miter limit. Defaults retain the Gate 6 rendering contract: closed shapes
use inside alignment, while line and icon paths use center alignment.

The document schema rejects unknown fields, negative dash segments, all-zero
non-empty dash patterns, more than sixteen dash segments, and miter limits
outside 1–100. Independent sides are admitted only for rectangle and frame
geometry. Open line and icon paths reject explicit non-center alignment instead
of allowing renderer-specific approximations.

## Geometry and renderer parity

`advanced-stroke.ts` owns alignment inset, visible-stack outset, and expanded
paint bounds. Hidden strokes do not affect bounds. Inside strokes add no
outset, center strokes add half their width, and outside strokes add their full
width. Component and responsive-output scaling update both stroke width and
dash segment lengths; alignment, side selection, caps, joins, and miter limits
remain dimensionless.

- React and renderer HTML emit the same SVG stroke geometry and attributes.
  Closed-shape paths inset or expand from the canonical frame according to
  alignment. Partial rectangle/frame strokes are emitted as ordered side
  lines. Ellipses and smooth-corner paths reuse the same alignment inset.
- Fabric explicit paint stacks retain one atomic outer group. Full strokes use
  adjusted synthetic geometry; partial rectangle/frame strokes use ordered
  Fabric line children. Dash, cap, join, miter, opacity, visibility, and blend
  state remain per paint.
- Line and icon paths use their canonical endpoints/view box with centered
  stroke geometry and the same dash/cap/join/miter attributes.
- WebMCP canvas edits and component overrides advertise the complete strict
  stroke record. Proposal replay and output-variant scaling preserve every
  field and scale dash lengths with stroke width.

## Product surface

The existing Appearance stroke cards now expose alignment, cap, join, dash,
miter, and compact T/R/B/L side toggles. Open-path alignment is visibly fixed
to center. All edits continue through the existing typed `update_node` command,
so history, Review, autosave, component overrides, and replay retain one
canonical mutation boundary.

## Browser acceptance

A mounted browser journey ran the isolated branch on
`http://localhost:3002/`; port 3000 was not used. It inserted a rectangle, added
a stroke, changed its color to `#13579b`, width to 8, dash pattern to `12 4`,
alignment to outside, and disabled the right and left sides. The canvas updated
through the Fabric path. Autosave reached “All changes saved.” After a full
reload, selecting the same layer in Layers restored the exact color, width,
outside alignment, dash pattern, and top/bottom-only side state. The cap and
join controls were present and their serialization/render behavior is covered
by the focused Fabric and SVG fixtures.

Gate 6 already recorded the isolated local PNG endpoint failure caused by the
missing `demo_sessions` and `api_request_audit` D1 tables before rendering.
Gate 7 therefore keeps export acceptance at the shared React/renderer markup
boundary plus deterministic bounds fixtures; it does not misclassify that
environmental database failure as stroke-renderer evidence.

## Verification

All commands used the bundled Node 22 runtime.

- `bun run typecheck`: all eight workspaces passed.
- `@webmcp/document`: 47 files, 468 tests passed.
- `@webmcp/render-view`: 2 files, 42 tests passed.
- `@webmcp/webmcp`: 5 files, 77 tests passed.
- Focused Fabric advanced-paint stack: 2 tests passed.
- Mounted browser add/edit/autosave/reload journey: passed on port 3002.
- `git diff --check`: passed.
- Prettier over every changed source and test file: passed.

No P0 or P1 finding remained after the open-path validation and dash-scaling
repairs.
