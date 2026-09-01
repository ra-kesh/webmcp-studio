# Advanced editor depth Gate 4: blend modes

- Entry: 2026-09-01
- Acceptance: 2026-09-02
- Gate 3 baseline: `88e7b52a1e5a128757139efee141d9ec139023ee`
- Phase map: `advanced-editor-depth-phase-map-2026-09-01.md`
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 4 slice.

## Accepted contract

Gate 4 adds a bounded, portable layer-blending vocabulary to every canonical
scene node:

- normal, darken, multiply, color burn, lighten, screen, color dodge, overlay,
  soft light, hard light, difference, exclusion, hue, saturation, color, and
  luminosity;
- absence resolves to normal in the shared render projection, so existing
  schema-v6 documents retain their prior output without a migration or stored
  byte change;
- unsupported pass-through and Porter-Duff compositing operations are rejected
  at the document and WebMCP boundaries rather than acquiring renderer-specific
  meanings; and
- ordinary document updates, history, semantic clone, component overrides, and
  component materialization preserve the optional node property through their
  existing strict patch and copy paths.

## Rendering and composition

- Fabric maps normal to `source-over` and maps the other accepted modes to the
  corresponding canvas `globalCompositeOperation` value.
- React and renderer HTML consume the same normalized frame projection and emit
  the corresponding CSS `mix-blend-mode` value after node opacity.
- A retained mask content node keeps its blend operation inside the bounded
  content composite. The final vector, alpha, or luminance mask remains a
  `destination-in` operation owned by the mask pipeline; a source node's blend
  value cannot replace that operation.
- Frame clipping remains outside the node's paint style and therefore continues
  to bound blended descendants through the accepted Gate 2 wrapper contract.
- Renderer HTML, thumbnails, PNG, and PDF inherit blend behavior from their
  existing canonical node paint paths; no export-only blend model was added.

## Product surfaces

- The Inspector exposes the complete accepted vocabulary in the existing
  opacity section and displays normal for legacy nodes without materializing a
  redundant property.
- Review renders before/after mode names in readable title case.
- WebMCP advertises the exact enum for `update_node`, admits the property into
  change-set validation, and rejects unsupported compositing strings.

## Reference review

The gate re-read OpenPencil's scene-node blend vocabulary, its isolated canvas
layer application, SVG export mapping, and appearance-control helpers:

- `packages/scene-graph/src/types.ts`
- `packages/core/src/canvas/blend.ts`
- `packages/core/src/canvas/scene.ts`
- `packages/core/src/io/formats/svg/export.ts`
- `packages/vue/src/controls/appearance/helpers.ts`

It also re-read Loora's `packages/canvas/src/model.ts`,
`packages/canvas/src/style-css.ts`, its CSS projection test, and
`packages/agent/src/canvas-tools.ts`. Studio adopts the shared portable blend
set while rejecting pass-through because Studio has flat node identity rather
than an editor-only group pass-through semantic.

## Independent review

The acceptance pass inspected schema compatibility, paint order, opacity,
frame clipping, vector/alpha/luminance masks, Fabric and CSS naming parity,
Inspector discoverability, Review output, WebMCP strictness, component copy
paths, and exports.

Two issues were repaired before acceptance:

1. The initial Inspector assertion expected closed Radix select options in
   server-rendered markup. The structural test now verifies the labeled control,
   while the exact vocabulary is covered at the document and WebMCP boundaries.
2. Mask coverage initially proved only ordinary blend mapping. Retained vector
   mask fixtures now assert that content keeps its blend operation and the final
   mask remains `destination-in`; React markup separately proves the blend is
   emitted only for retained content, not the mask source.

No P0 or P1 issue remained after those repairs.

## Verification

All authoritative commands used the bundled Node 22 runtime. No development
server was started and port 3000 was not used.

- `bun run typecheck`: all eight workspaces passed.
- Serial `@webmcp/document` suite: 44 files, 454 tests passed.
- Serial `@webmcp/render-view` suite: 1 file, 39 tests passed.
- Serial `@webmcp/renderer` suite: 3 files, 104 tests passed.
- Serial `@webmcp/webmcp` suite: 5 files, 75 tests passed.
- Focused Studio Inspector and Review suites: 2 files, 28 tests passed.
- Focused Fabric blend and retained-mask tests: 2 tests passed; 115 unrelated
  tests skipped by name filter.
- `git diff --check`: passed.
- Prettier check over every changed file: passed.

One render-view timing assertion exceeded its 250 ms budget while four suites
were deliberately competing for the same host. The authoritative serial rerun
completed the entire render-view suite in 2.07 seconds with all 39 tests
passing; the blend correctness assertions were green in both runs.
