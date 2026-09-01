# Advanced editor depth Gate 3: frame and layout-guide settings

- Entry: 2026-09-01
- Acceptance: 2026-09-02
- Gate 2 baseline: `82e7ff456ebeb60e568e5189a198024fccf09439`
- Phase map: `advanced-editor-depth-phase-map-2026-09-01.md`
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 3 slice.

## Accepted contract

Gate 3 adds bounded, frame-owned layout-guide metadata without creating a
second rendering model.

- A frame may own up to eight uniquely identified guides. Each guide has
  explicit visibility, color, opacity, and non-negative offset.
- Column and row guides carry a one-to-64 section count, start/center/end or
  stretch alignment, positive fixed section size, and non-negative gutter.
  Stretch derives section width or height from the frame interior.
- Square grids carry a positive interval and project bounded horizontal and
  vertical line sequences. Projection is capped at 4,096 lines per axis so a
  malformed or microscopic grid cannot create unbounded editor work.
- Spatial guide values scale with component instances and responsive WebMCP
  document adaptation. Column measurements follow horizontal scale, row
  measurements follow vertical scale, and square grids use uniform scale.
- Existing schema-v6 documents remain valid when `layoutGrids` is absent. New
  metadata survives canonical JSON persistence, semantic clone, ordinary
  `update_node` history, component overrides, and component materialization.

## Editor and product surfaces

- The frame Inspector exposes the existing position and size fields plus frame
  fill, corner radius, stroke, and stroke width. It adds an ordered layout-guide
  editor for add/remove, columns/rows/square pattern, visibility, count,
  gutter, alignment, fixed section size, interval, offset, color, and opacity.
- The editor draws guide bands and lines in frame space with pointer events
  disabled. A frame clips its own guide chrome, and clipping ancestors further
  bound nested-frame guides through the canonical frame-clip projection.
- The existing View > Guides command and command search remain the global
  discovery and visibility owner. Its persisted `guidesVisible` preference now
  controls both ruler guides and frame layout guides; the Inspector is the
  per-frame authoring surface.
- Review summarizes a layout-guide patch by exact guide count. WebMCP advertises
  the strict discriminated guide union, rejects unknown fields, more than eight
  guides, duplicate IDs, counts above 64, and incomplete objects.

## Export boundary

Layout guides are authoring metadata only. They are not added to
`projectNodeForRender`, Fabric scene objects, React `RenderNode`, renderer HTML,
thumbnail markup, PNG paint, or PDF paint. The overlay exists only beside the
interactive Fabric canvas and carries `data-editor-overlay="frame-layout-grids"`.
An export regression fixture proves that neither the guide identity nor the
`layoutGrids` property enters renderer HTML; PNG and PDF consume that same
guide-free export path.

## Reference review

The gate re-read these exact OpenPencil files:

- `packages/scene-graph/src/types.ts`
- `packages/scene-graph/src/node-defaults.ts`
- `packages/scene-graph/src/layout-guides.ts`
- `packages/core/src/canvas/layout-grids.ts`
- `packages/core/src/figma-api/rescale.ts`
- `packages/vue/src/shared/input/explicit-snap-targets.ts`

It also re-read Loora's `packages/canvas/src/model.ts` and
`packages/canvas/src/style-css.ts` for its typed container and CSS-projection
boundaries. Studio follows OpenPencil's frame-owned grid vocabulary and scaling
semantics, but keeps the accepted set smaller and rejects ambiguous raw fields.
Loora's responsive website grid is not imported because Studio pages retain
fixed document geometry.

## Independent review

The separate acceptance pass inspected schema bounds, identifier stability,
projection arithmetic, nested clipping, persistence, component scaling,
Inspector completeness, menu ownership, Review, WebMCP, and export isolation.

Three findings were repaired before acceptance:

1. The first overlay pass clipped each guide to its own frame but not to a
   clipping ancestor. It now consumes the canonical ancestor clip bounds and
   suppresses fully clipped frame guides.
2. Guide IDs were initially only non-empty. Frame guide arrays now reject
   duplicate IDs, preventing React identity collisions and ambiguous edits.
3. Column and row controls initially exposed stretch settings only. The
   Inspector now exposes start, center, end, and stretch alignment plus fixed
   section size when applicable.

No P0 or P1 issue remained after those repairs.

## Verification

All authoritative commands used the bundled Node 22 runtime. No development
server was started and port 3000 was not used.

- `bun run typecheck`: all eight workspaces passed.
- Serial `@webmcp/document` suite: 43 files, 451 tests passed.
- Serial `@webmcp/webmcp` suite: 5 files, 75 tests passed.
- Serial `@webmcp/renderer` suite: 3 files, 103 tests passed.
- Focused Studio overlay, Inspector, and Review suites: 3 files, 29 tests
  passed.
- Focused WebMCP registration suite: 1 file, 47 tests passed.
- Focused renderer HTML suite: 1 file, 44 tests passed.
- Focused document guide suite: 1 file, 4 tests passed.
- `git diff --check`: passed.

The complete Studio run passed 219 files and 1,895 tests, with ten unrelated
baseline failures: retired quotation-template version fixtures, two existing
page-thumbnail mock argument expectations, one sample version expectation, and
one StrictMode persistence timing case. Gate 3's affected Studio suites pass
serially. The complete editor run remains limited by the pre-existing missing
optional native-canvas binding; 20 files and 386 tests pass, while the same 15
Fabric raster/text tests fail before Gate 3 code is exercised.
