# Open issues reconciliation

Date: 2026-09-01

Code baseline: `a3fed40`

## 2026-09-01 current-main hardening continuation

The first current-main integrated browser journey used a fresh two-page Signal
creative brief on port 3001 and exercised continuous multi-artboard navigation,
Layers selection, Inspector text editing, image insertion, crop, Undo/Redo,
autosave/reload, image replacement, immutable publication, and PDF export
dispatch. It found one real P0 integration defect: Inspector edits to
field-bound text bypassed the binding-aware command path, so the UI reported a
saved revision while reload reapplied the old field value. `0e96f4e` routes the
Inspector through the same canonical command projection as canvas edits and
adds a mounted durable-reload regression. The repaired value survived a real
full-page reload.

The same browser journey did not reproduce the previously reported blank canvas
during current-main curated image insertion, selection, crop, replacement, or
reload. It did expose the remaining architectural fault-injection gap in code:
the canonical Fabric paint-plan installer removed and disposed the last valid
scene before `canvas.add` had accepted the candidate scene. `397aa93` installs
the candidates first, removes partial candidates on synchronous failure, and
keeps the last-valid scene and node map untouched. The focused Fabric, local
asset, and thumbnail suites pass 167/167, and Studio/Editor typechecks pass.

`397aa93` also closes the disclosed test-harness debt for structured-cloned
File/Blob values and cross-realm AbortSignal values by asserting their public
contracts instead of realm-specific constructor identity. The affected tests
pass 52/52. Successful retired-object disposal already had explicit coverage;
it was stale backlog wording, not an open implementation gap.

Publication completed locally as immutable version 1. PDF export returned to
the idle editor without a visible product error, but this run did not retain the
downloaded artifact or a checksum, so renderer/export artifact conformance is
not being claimed from this browser journey alone.

`a3fed40` extracts the synchronous canvas-runtime admission owner from
`studio-shell.tsx`. Runtime reports and owner releases update one controller
snapshot before React scheduling, while the shell consumes its projected
registry for rendering. A focused regression proves that page and
document-wide commit predicates captured while ready close in the same tick as
a syncing report, and that a document identity change invalidates captured
work. This closes the named same-tick predicate seam and removes duplicated
snapshot/ref mutation policy from the shell; broader controller decomposition
still remains.

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

## Capabilities that are genuinely not built

These are the concrete editor-depth gaps identified in the separate
OpenPencil comparison and still absent from the canonical schema, renderer, or
Inspector:

1. Constraints and pinning behavior for responsive resizing.
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

1. Retain the exported PDF/PNG artifacts and checksums from the current-main
   browser journey. The integrated UI path is now exercised together; artifact
   retention and renderer comparison remain.
2. Continue architectural decomposition. Render invalidation, crop, preview,
   and lazy-interaction ownership have been extracted, but
   `use-document-editor.ts` remains 11,461 lines and `studio-shell.tsx` remains
   6,917 lines. Commit `741ce07` also extracts canonical canvas-node mutation
   ownership into `CanvasNodeMutationController`: Inspector and canvas changes
   now share binding-aware command projection, component-instance transforms,
   and history labeling. Its focused regression proves a bound Signal title
   edit becomes `set_field`, and a clean current-main browser reload proves the
   extraction does not leave the editor in a stale HMR-only hook state. This is
   maintenance and regression risk, not a reason to replace Fabric immediately.
3. Review only newly observed visual regressions and editor areas not covered by
   the completed Vercel/OpenPencil gates. Do not reopen the design foundation,
   Inspector geometry, workspace chrome, or completed interaction controls as
   if they were never implemented.
4. Continue controller decomposition in bounded domains. Canvas admission,
   same-tick predicates, cross-realm File/Blob and AbortSignal harness behavior,
   retired-Fabric disposal coverage, and injected failure at candidate
   installation are now closed.

## Remaining integration and production work

1. Read-only Wrangler inspection on 2026-09-01 confirms the active Studio and
   Renderer versions were deployed at 06:57 UTC from the rollout represented by
   `3ea3e56`. Current main is 53 commits ahead of that production checkpoint.
   Production therefore predates the multi-artboard editor and the latest
   image, quotation-text, architecture, guide, bound-Inspector, and Fabric
   candidate-install repairs. No deployment or remote mutation was performed
   during this inspection.
2. Owner-authenticated deployed acceptance remains incomplete: hostile and
   rate/concurrency cases, multipart/R2 lifecycle, Workflow restart/recovery,
   renderer parity/performance, second-principal isolation, artifact expiry,
   and audit-retention evidence.
3. Live Stuwiz retrieval and reconciliation remain external. Studio still
   needs an authenticated complete-source endpoint, stable source
   revision/fingerprint, authorization, and provenance contract from Stuwiz.
   A 2026-09-01 read-only check reconfirmed `origin/staging` at `8b79b190`;
   that remote ref still has no Studio source endpoint. The local Stuwiz
   checkout contains extensive unrelated in-progress quotation-rendering work
   and was not modified or used as shipped contract evidence.
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
