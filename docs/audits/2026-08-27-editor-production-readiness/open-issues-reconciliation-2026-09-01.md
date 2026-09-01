# Open issues reconciliation

Date: 2026-09-01

Updated: 2026-09-02

Code baseline: `e1fffda87d0a6445aaa651d51a448c9939ccbcc2`

This checkpoint reconciles the main conversation with the separate redesign,
mask, rich-text, component, library, image-architecture, generation, independent
review, and production tasks. Historical audit prose that conflicts with this
checkpoint is not an active backlog.

## Side-task work already integrated

The following work is complete in `main`, sometimes through an integration or
superseding commit rather than the original side-task hash:

- the exact Vercel brand stylesheet and `design.md` foundation;
- compact OpenPencil-derived Inspector controls, 288 px default width, number
  scrubbing, condensed identity, separate Content section, general flip and
  rotate controls, live text preview/commit, 11 px metadata floor, and an
  explicit dark workspace token;
- continuous multi-artboard editing and removal of the bottom page filmstrip;
- rich-text conformance P1 closure, reusable text/paint styles, and variables;
- components, instances, variants, overrides, and Component Gate 5 evidence;
- vector, alpha, luminance, and nested masks including retained output and
  negative-path evidence;
- the persistent Assets workspace plus the 21-template/37-media catalog;
- skill-driven blank/exact-template document generation through WebMCP, Review,
  and editable canonical documents;
- image-selection suspension, output admission, replacement, and StrictMode
  local-asset restoration fixes;
- quotation direct editing and semantic legacy migration;
- Layers hierarchy and transient-guide lifecycle fixes;
- the business-beta migration-lineage work and the guarded production rollout.

No completed side-task product feature is waiting for an ordinary merge.

## Advanced editor-depth capability ledger

These are the concrete editor-depth gaps identified in the separate OpenPencil
comparison. Accepted gates remain in the numbered ledger so their exact
checkpoint and evidence stay auditable.

1. **Constraints and responsive pinning — completed and independently
   accepted.** Commit `7fa5cdd8b1a5f797348644c6aab15320d7d3d11b`
   adds the schema-v6 two-axis constraint model, v1-v5 draft migration,
   deterministic page-resize transaction, history, component override policy,
   Inspector, Review, WebMCP, renderer-ownership rule, compatibility hashes,
   and focused regression coverage. Evidence:
   `advanced-editor-depth-gate-01-constraints-review-2026-09-01.md`. No Gate 1
   gap remains; container-relative reflow begins in Gate 2.
2. **Auto layout and explicit clipping/overflow controls — completed and
   independently accepted.** Commit
   `82e7ff456ebeb60e568e5189a198024fccf09439` adds the explicit frame identity,
   ordered child layout metadata, stable atomic paint-order reconciliation,
   nested horizontal/vertical layout solver, fixed/fill and fixed/hug sizing,
   four-side padding, gap and alignment, exact nested clipping across Fabric,
   React, renderer HTML, thumbnails, PNG and PDF, Layers hierarchy and
   drag/drop, history, semantic clone and component preservation, Inspector,
   Review, and a strict WebMCP frame schema. Evidence:
   `advanced-editor-depth-gate-02-auto-layout-clipping-review-2026-09-01.md`.
   No Gate 2 gap remains. The accepted boundary rejects rotated owner frames
   and frame-owned mask sources instead of allowing renderer divergence; a
   future expansion of either contract must add a new canonical geometry and
   cross-renderer conformance gate.
3. **Blend modes — completed as phase-map Gate 4 and independently
   accepted.** Commit `9372b7a43fa83cef272f3a1f1545542b07f450c2`,
   with component-override repair
   `c6a0f005b319f05099542384372dc5c2588ccf9a`,
   adds a strict 16-mode portable blend vocabulary; canonical projection;
   Fabric canvas and React/CSS/renderer mappings; explicit opacity, clipping,
   and retained-mask ordering; Inspector and Review controls; strict WebMCP
   admission; legacy schema-v6 compatibility; and focused cross-renderer
   regression coverage. Evidence:
   `advanced-editor-depth-gate-04-blend-modes-review-2026-09-01.md`. No Gate 4
   gap remains. Pass-through and Porter-Duff operations stay deliberately
   rejected because they do not have a portable flat-layer meaning across the
   accepted renderers.
4. **Independent corner radii and corner smoothing — completed as phase-map
   Gate 5 and independently accepted.** Commit
   `ccc5879dcc3d0b410dc5292d20ec10a3f832a302` adds a strict linked/four-corner
   model; byte-compatible legacy-radius projection; bounded deterministic
   smoothing and edge-budget clamping; shared centered-stroke geometry;
   rectangle, frame, image, clip, and mask parity across Fabric, React, HTML,
   PNG, and PDF; component and responsive scaling; compact Inspector controls;
   Review; and strict WebMCP schemas. Evidence:
   `advanced-editor-depth-gate-05-independent-corners-review-2026-09-01.md`.
   No capability-item 4 / implementation-Gate 5 gap remains. The implementation
   retains the adapted geometry source's MIT notice and adds no runtime
   dependency.
5. **Multiple fills and strokes on one layer — completed as phase-map Gate 6
   and independently accepted.** Commit
   `06125ee1e8a63be1e8c7d8f99be14fbb992b0072` adds strict bounded ordered
   paint arrays; byte-compatible legacy paint projection; explicit-empty and
   primary-paint synchronization semantics; per-paint visibility, opacity,
   blend, and stroke width; Fabric, React, and renderer HTML parity; style,
   variable, component, and responsive scaling compatibility; compact
   Inspector list controls; deterministic Review summaries; strict WebMCP
   proposals; and a mounted add/edit/reorder/toggle/Undo/Redo/autosave/reload
   browser journey. Evidence:
   `advanced-editor-depth-gate-06-multiple-paints-review-2026-09-01.md`. No
   capability-item 5 / implementation-Gate 6 gap remains. Gradients, image
   paints, patterns, and noise remain outside this solid-paint gate; advanced
   stroke geometry begins in phase-map Gate 7.
6. **Advanced stroke controls — completed as phase-map Gate 7 and
   independently accepted.** Commit
   `bf2cefefb9bfa393c37085ce65204e94409c29f3` adds strict alignment,
   per-side, dash, cap, join, and miter semantics; deterministic visible-stroke
   bounds; Fabric, React, and renderer HTML parity; component and responsive
   dash scaling; compact Inspector controls; strict WebMCP schemas; and a
   mounted add/edit/autosave/reload browser journey. Evidence:
   `advanced-editor-depth-gate-07-advanced-strokes-review-2026-09-01.md`. No
   capability-item 6 / implementation-Gate 7 gap remains.
7. **Layer effects — completed as phase-map Gate 8 and independently
   accepted.** Commit `db515d772c84697556789c9fe3c07f60a059f935`
   adds strict ordered drop-shadow and layer-blur stacks; renderer resource
   budgets; deterministic bounds; Canvas 2D/Fabric, React, renderer HTML, mask,
   and responsive-output parity; component preservation; compact Inspector
   controls; Review summaries; strict WebMCP admission; and a mounted
   add/edit/reorder/Undo/Redo/autosave/reload browser journey. Evidence:
   `advanced-editor-depth-gate-08-layer-effects-review-2026-09-01.md`. No
   capability-item 7 / implementation-Gate 8 gap remains.
8. **Per-layer export settings — completed as phase-map Gate 9 and
   independently accepted.** Commit
   `c5cb1cf6360691cb6329dcac5d6cf72e3e8a6766` adds strict PNG/PDF presets;
   deterministic page/output routing, bounds, scaling, and filenames; direct
   layer-menu export through existing renderer endpoints; immutable published
   manifest routes; component, Review, and WebMCP preservation; compact
   Inspector controls; and mounted configure/menu/autosave/reload evidence.
   Evidence:
   `advanced-editor-depth-gate-09-layer-export-review-2026-09-01.md`. No
   capability-item 8 / implementation-Gate 9 gap remains.
9. **Additional text layout controls — completed as phase-map Gate 10 and
   independently accepted.** Commit
   `e1fffda87d0a6445aaa651d51a448c9939ccbcc2` adds strict optional direction,
   vertical-alignment, case, truncation, and maximum-line fields; paragraph
   justification; managed-font v3 measurement with source-range preservation;
   deterministic overflow and synthetic ellipsis rules; Fabric, React,
   renderer HTML, PNG, and PDF parity; direct-edit isolation; component,
   design-plan, Review, and WebMCP preservation; compact Inspector controls;
   and mounted configure/Undo/Redo/autosave/reload evidence. Evidence:
   `advanced-editor-depth-gate-10-text-layout-review-2026-09-01.md`. No
   capability-item 9 / implementation-Gate 10 gap remains.
10. **Frame/layout-guide settings — completed as phase-map Gate 3 and
    independently accepted.** Commit
    `88e7b52a1e5a128757139efee141d9ec139023ee` adds strict per-frame column,
    row, and square-grid metadata; bounded projection and component scaling;
    frame size/background/stroke controls; nested-clipped editor-only overlay;
    persisted View > Guides visibility; Review and strict WebMCP support; and
    explicit HTML/PNG/PDF export isolation. Evidence:
    `advanced-editor-depth-gate-03-frame-layout-guides-review-2026-09-01.md`.
    No Gate 3 gap remains. Layout grids are deliberately authoring metadata,
    not printable scene paint; promoting them to artwork would require a new
    cross-renderer contract.

These require document-model, command, renderer/export, history, Inspector,
WebMCP, and migration work. They are not styling-only tasks.

## Remaining local quality work

1. Retain one integrated real-browser journey on the current code that combines
   multi-artboard navigation, transforms, direct text, image
   insert/replace/crop, Undo/Redo, autosave/reload, publish, and export. The
   separate tasks provide focused evidence, but no single post-integration run
   proves all of these systems together.
2. Continue architectural decomposition. Render invalidation, crop, preview,
   and lazy-interaction ownership have been extracted, but
   `use-document-editor.ts` remains 11,479 lines and `studio-shell.tsx` remains
   6,959 lines. This is maintenance and regression risk, not a reason to replace
   Fabric immediately.
3. Review only newly observed visual regressions and editor areas not covered by
   the completed Vercel/OpenPencil gates. Do not reopen the design foundation,
   Inspector geometry, workspace chrome, or completed interaction controls as
   if they were never implemented.
4. Resolve the remaining low-level hardening evidence from the async
   architecture review: isolated cross-realm File/Blob and AbortSignal harness
   behavior, explicit retired-Fabric disposal coverage, injected failure after
   the synchronous install barrier, and same-tick shell predicate coverage.

## Remaining integration and production work

1. Production is behind this local code baseline by 46 commits. It predates the
   multi-artboard editor and the latest image, quotation-text, architecture,
   and guide repairs.
2. Owner-authenticated deployed acceptance remains incomplete: hostile and
   rate/concurrency cases, multipart/R2 lifecycle, Workflow restart/recovery,
   renderer parity/performance, second-principal isolation, artifact expiry,
   and audit-retention evidence.
3. Live Stuwiz retrieval and reconciliation remain external. Studio still
   needs an authenticated complete-source endpoint, stable source
   revision/fingerprint, authorization, and provenance contract from Stuwiz.
4. Browser-local media is not automatically shared across devices. Promotion,
   relink, and recovery exist, but shared availability and its deployed
   isolation/restart/cleanup/fault behavior still need production evidence.
5. Public API documentation and the production session-token denial audit
   identity need reconciliation with the implemented durable job/error model.

## Deliberately deferred or optional

- Background removal remains disabled by default. The service boundary exists,
  but no paid provider or local/on-device inference provider is configured.
- Skill-driven generation does not yet persist an unapproved candidate across
  reload and has no screenshot-inspect-correct loop. A retained real ChatGPT
  session consuming an arbitrary GitHub `SKILL.md` is still host evidence, not
  a missing document-generation foundation.
- The library mechanics are complete; Canva-scale content volume beyond 21
  templates and 37 media items is optional catalog expansion.
- Cross-page multi-selection remains out of scope.
- Collaboration, presence, comments, team libraries, and organization roles
  are explicitly excluded.
