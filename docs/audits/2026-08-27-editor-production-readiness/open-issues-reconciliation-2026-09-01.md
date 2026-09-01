# Open issues reconciliation

Date: 2026-09-01

Code baseline: `7fa5cdd8b1a5f797348644c6aab15320d7d3d11b`

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
2. Auto layout and explicit clipping/overflow controls for containers.
3. Blend modes.
4. Independent corner radii and corner smoothing.
5. Multiple fills and strokes on one layer.
6. Advanced stroke controls: alignment, per-side strokes, dashes, caps, joins,
   and miter behavior.
7. Layer effects such as shadows and blur.
8. Per-layer export settings.
9. Additional text layout controls: direction, vertical alignment,
   justification, case transformation, and truncation behavior.
10. Frame/layout-guide settings beyond the existing canvas rulers, snapping,
    and persistent ruler guides.

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
