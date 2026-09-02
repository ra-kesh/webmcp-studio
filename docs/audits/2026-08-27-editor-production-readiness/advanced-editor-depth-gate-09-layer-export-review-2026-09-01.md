# Advanced editor depth Gate 9: per-layer export settings

- Entry: 2026-09-02
- Acceptance: 2026-09-02
- Gate 8 baseline: `db515d772c84697556789c9fe3c07f60a059f935`
- Implementation checkpoint: `c5cb1cf6360691cb6329dcac5d6cf72e3e8a6766`
- Ledger mapping: capability item 8
- Phase map: implementation Gate 9
- Verdict: **ACCEPT.** No P0 or P1 issue remains in the Gate 9 slice.

## Accepted contract

Every layer can own up to four strict export presets. Each preset has a stable
unique ID, PNG or PDF format, 0.25–4× scale, and a bounded filename suffix.
The optional array preserves legacy schema-v6 bytes. Duplicate IDs, unknown
fields, unsafe suffix characters, invalid formats, and out-of-range scales are
rejected at the document boundary.

`layer-export.ts` is the shared routing authority. It resolves the layer's
owning page and output, produces a deterministic slug/suffix/scale filename,
expands the layer frame for visible advanced strokes and effects, and projects
one isolated transparent render page. The projection scales node geometry,
text metrics, corners, strokes, dashes, shadows, and blur before using the
existing PNG/PDF renderer endpoints. It removes page-local grouping/mask
ownership so the preset exports the selected canonical layer itself.

The direct **Export layer** command in the layer context menu flushes the
durable draft, captures the first preset, materializes local assets, routes PNG
or PDF through the existing server endpoint, and downloads the deterministic
filename. It retains cancellation, timeout, image-replacement output admission,
and text/crop barriers from ordinary exports.

Published template manifests retain the same layer-to-page-to-output routes,
setting IDs, formats, scales, and filenames under each output. WebMCP reads
expose settings through the canonical public node, typed canvas edits and
component overrides admit the strict array, and the product command catalog
advertises the context-menu action. Review summarizes preset count rather than
dumping raw records.

## Product surface and browser acceptance

The Inspector adds one compact Export section after Effects. It supports PNG
and PDF presets, format, scale, suffix, and removal without changing the
existing Appearance layout.

A mounted browser journey ran on `http://localhost:3002/`; port 3000 was not
used. It added a PNG preset to the Gate 7/8 rectangle, changed scale to 2× and
suffix to `-asset`, opened the layer menu with Shift+F10, and confirmed
**Export layer**. The command reached the direct route and surfaced `Layer
export failed (500)` because the isolated local D1 still lacks the session and
audit tables recorded in Gate 6. The failure occurred before rendering. After
autosave and full reload, the exact PNG, 2×, and `-asset` settings remained.

Direct route tests prove the successful request/download path, isolated page
projection, endpoint selection, and filename. Publishing tests prove the same
routes appear in immutable manifests.

## Verification

All commands used the bundled Node 22 runtime.

- `bun run typecheck`: all eight workspaces passed.
- `@webmcp/document`: 49 files, 474 tests passed.
- `@webmcp/webmcp`: 5 files, 78 tests passed.
- Focused document layer-export/publishing: 2 files, 11 tests passed.
- Focused Studio direct-export and Review: 2 files, 18 tests passed.
- Product command catalog/menu: 22 tests passed; mounted layer-context menu: 4
  tests passed.
- Mounted browser configure/menu/direct-route/autosave/reload journey: passed
  through the expected isolated-D1 endpoint boundary on port 3002.
- `git diff --check`: passed.
- Prettier over every changed source, test, and audit file: passed.

No P0 or P1 finding remained after the app-menu scoping repair.
