# Advanced editor depth Gate 1: constraints and responsive pinning

- Date: 2026-09-01
- Base: `e35656d43ed71126ebfb0785fd9a9050251b2232`
- Phase map: `advanced-editor-depth-phase-map-2026-09-01.md`
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 1 slice.

## Accepted contract

Gate 1 makes page-resize constraints canonical document behavior rather than
renderer-local metadata.

- Schema version 6 requires a strict two-axis `constraints` object on every
  scene node. Both axes use the bounded `min`, `center`, `max`, `stretch`, and
  `scale` vocabulary. New layers default to top/left (`min`/`min`).
- Schema-v1 through v5 drafts receive explicit top/left constraints during
  decoding without mutating the persisted input. Published template versions
  remain immutable and require republication across the schema boundary.
- `update_node` patches the complete constraint value. `update_page` applies
  deterministic geometry to layers owned by that page: minimum-edge pins keep
  position and size, center pins move by half the parent delta, maximum-edge
  pins move by the full delta, stretch changes size by the delta, and scale
  changes position and size by the parent ratio. A stretch that would collapse
  a layer is rejected atomically.
- Constraint metadata is part of component override policy, command history,
  Review detail, and the public typed WebMCP canvas-edit contract. Partial or
  unknown constraint values are rejected.
- The Inspector exposes compact horizontal and vertical controls. Layers on
  other pages do not move when one page changes size.
- Render projection deliberately ignores constraint metadata. Rendering
  consumes the canonical geometry produced by the page-resize command, so
  Fabric, React, HTML, PNG, and PDF do not own competing resize semantics.

## Compatibility and identity review

- Current source constructors, generated starters, conformance fixtures, and
  editor insertion paths emit schema-v6 documents with explicit constraints.
- Precomputed current built-in template hashes and the text-design-system
  source snapshot were regenerated from their canonical schema-v6 content.
- Retired quotation composer-v3 identities retain their original checksums.
  Checksum verification reconstructs the canonical v3 preview and serializes
  its historical schema-v5 shape, proving the new metadata did not rewrite the
  retired identity.
- The renderer label and capture description now identify current mask input as
  schema v6. Existing retained artifact filenames are not renamed.

## Independent review

The acceptance pass inspected the schema/defaults, decoder and immutable
template boundary, page-resize transaction, Inspector controls, Review
projection, WebMCP allowlist and JSON schema, component override vocabulary,
render projection, history, and tests.

Two review findings were repaired before acceptance:

1. The retired-template checksum test supplied no canonical preview for v3.
   It now uses the versioned composer and verifies the unchanged historical
   checksum.
2. Current renderer test prose still called the canonical mask document
   schema v5. The label now matches schema v6, and the page-resize test also
   proves another page's layer remains byte-for-byte unchanged.

No remaining Gate 1 gap was found. Container-relative constraints are deferred
to Gate 2 because the current canonical parent boundary is a page; Gate 2 adds
explicit container ownership and reflow.

## Verification

All commands used the bundled Node 22 runtime. No development server was
started and port 3000 was not used.

- `bun run typecheck`: all eight workspaces passed.
- `bunx vitest run packages/document/test --maxWorkers=1`: 41 files, 440 tests
  passed.
- `bunx vitest run packages/editor/test/history.test.ts packages/webmcp/test/registration.test.ts apps/studio/src/features/editor/inspector-sidebar.test.ts apps/studio/src/features/editor/review-operation-details.test.ts --maxWorkers=1`:
  4 files, 100 tests passed.
- `bunx vitest run packages/document/test/commands.test.ts packages/document/test/built-in-template-manifests.test.ts apps/renderer/test/index.test.ts --maxWorkers=1`:
  3 files, 118 tests passed.
- `bun run verify:migrations`: passed, including rollback for malformed and
  incomplete persisted template rows.
- `git diff --check`: passed.

An earlier all-package concurrent run was not used as an acceptance signal:
the host lacks the optional native canvas binding, concurrent performance
thresholds were noisy, and pre-existing Studio cross-realm/stale-template
expectations failed outside this slice. The serial Gate 1 matrix above is green
and includes the complete document package.
