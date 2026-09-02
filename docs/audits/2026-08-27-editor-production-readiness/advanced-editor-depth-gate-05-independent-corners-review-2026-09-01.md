# Advanced editor depth Gate 5: independent corners and smoothing

- Entry: 2026-09-01
- Acceptance: 2026-09-02
- Gate 4 baseline: `c6a0f005b319f05099542384372dc5c2588ccf9a`
- Ledger mapping: capability item 4
- Phase map: implementation Gate 5
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 5 slice.

## Accepted contract

Gate 5 adds one portable corner model for rectangles, frames, clipping frames,
and rounded image frames.

- Rectangles and frames retain the legacy uniform `radius`. An explicit
  `independentCorners` flag activates a strict four-value record ordered top
  left, top right, bottom right, bottom left.
- `cornerSmoothing` is bounded from zero through one. Zero retains circular
  corners; larger values use the shared deterministic continuous-corner path.
- Rounded image-frame corner radii remain normalized against the shorter frame
  edge, preserving the existing responsive image-mask contract while allowing
  four independent normalized values.
- Competing corner demands split each edge proportionally. Oversized radii are
  clamped without negative coordinates, `NaN`, infinity, or order-dependent
  distortion.
- Independent corners require a complete four-value record on canonical nodes.
  Partial objects, negative radii, smoothing outside zero through one, and
  normalized image values above one half are rejected.

## Legacy-radius migration

No schema-version bump or stored document rewrite is required. The new node
fields are optional, and absence projects the existing uniform radius into four
equal corners with zero smoothing. Existing image masks retain their former
projection shape exactly; advanced image clip fields appear only when authored.
Legacy schema-v6 parse output and the canonical image affine/clip fingerprints
therefore remain unchanged.

The explicit activation flag also permits a reversible linked/independent UI
without overloading equal numeric values. Dormant four-corner values do not
affect paint until independent corners are enabled.

## Shared geometry and render parity

`corner-geometry.ts` owns the edge-budget resolver, cubic construction, path
rounding precision, CSS radius order, scaling, and centered-stroke inset path.
Fabric, React, renderer HTML, thumbnails, masks, frame clips, image clips, PNG,
and PDF consume that geometry rather than implementing local squircle math.

- Fabric retains ordinary `Rect` objects for legacy shapes and uses a `Path`
  only for independent or smoothed corners. Object replacement is atomic when
  a committed edit crosses that boundary, and canonical transform dimensions
  remain stable.
- React and renderer HTML use SVG paths for advanced shape paint, CSS
  four-corner radii for ordinary clipping, and path clips when smoothing is
  active.
- Centered strokes use an inset path in every renderer so the stroke stays
  inside the canonical outer frame. Fill remains beneath the stroke.
- Vector, alpha, and luminance masks preserve advanced shape geometry. Rounded
  images use the same path for ordinary image clipping and mask-source
  extraction.
- Clipping frames carry advanced corner geometry through the existing nested
  Gate 2 clip stack. Intersections of multiple ancestor clips retain the
  established rectangular intersection behavior.

## Product surfaces

- The shape/frame Inspector keeps the linked uniform-radius field and adds one
  compact independent-corners toggle, a two-by-two corner editor, and a
  smoothing slider.
- Rounded image frames expose the same controls while storing radii in the
  accepted normalized image-mask form.
- Review summarizes linked state, exact TL/TR/BR/BL values, and smoothing as a
  percentage.
- WebMCP advertises the exact four-corner records for shapes and normalized
  image masks, bounded smoothing, component overrides, and responsive scaling.
- Component materialization and instance override rescaling apply uniform scale
  to absolute corner radii. Normalized image corners and smoothing remain
  dimensionless.

## Reference and license review

The gate re-read OpenPencil's `packages/scene-graph/src/types.ts`, specifically
its uniform radius, top-left/top-right/bottom-right/bottom-left values,
independent-corner flag, and zero-through-one smoothing field. It also checked
Figma's public REST type contract for clockwise four-corner order and smoothing
bounds.

The deterministic cubic construction is adapted from the MIT-licensed
`msurguy/squircle-path-kit` `src/core.ts`. The required copyright, permission,
warranty, and source notice is retained at the top of `corner-geometry.ts`.
Studio owns the resulting code locally so document rendering does not acquire a
runtime package or network dependency.

## Independent review

The acceptance pass inspected schema strictness, legacy byte compatibility,
edge-budget bounds, stroke placement, component scaling, responsive scaling,
frame clips, image clips, vector/alpha/luminance masks, Fabric object identity,
React and renderer HTML, Inspector controls, Review, WebMCP, and export paths.

Three findings were repaired before acceptance:

1. Advanced clip fields were initially projected for legacy rounded images and
   frames, changing exact compatibility fingerprints. They are now optional and
   emitted only for authored advanced geometry.
2. A dormant four-corner record could initially select an advanced vector-mask
   path even while independent corners were disabled. Every consumer now keys
   activation from the explicit flag, while smoothing remains independently
   active.
3. The first SVG implementation stroked the outer clip path, allowing half of a
   centered stroke beyond the canonical node frame. A shared inset paint-path
   helper now matches Fabric, React, and renderer HTML without changing the
   outer clip or mask path.

No P0 or P1 issue remained after those repairs.

## Verification

All authoritative commands used the bundled Node 22 runtime. No development
server was started and port 3000 was not used.

- `bun run typecheck`: all eight workspaces passed.
- Serial `@webmcp/document` suite: 45 files, 458 tests passed.
- Serial `@webmcp/render-view` suite: 1 file, 40 tests passed.
- Serial `@webmcp/renderer` suite: 3 files, 105 tests passed.
- Serial `@webmcp/webmcp` suite: 5 files, 76 tests passed.
- Focused Studio Inspector and Review suites: 2 files, 30 tests passed.
- Focused Fabric advanced shape, image clip, and retained-mask tests: 3 tests
  passed; 115 unrelated tests skipped by name filter.
- `git diff --check`: passed.
- Prettier formatting over every changed file: passed.

An initial document-suite run hit two pre-existing host timing guards while the
machine was still handling a workspace typecheck: the bounded media-alias case
timed out and the 28,000-character text case took 351 ms against a 250 ms
budget. Both passed immediately in isolation, including the text case at 150
ms, and the authoritative serial full rerun passed all 458 document tests.
