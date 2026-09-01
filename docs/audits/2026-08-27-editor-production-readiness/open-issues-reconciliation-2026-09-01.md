# Open issues reconciliation

Date: 2026-09-01

Baseline: `10b8aae`

This is the current continuation checkpoint after reconciling the main product
conversation, repository history, the original audit, later gate reports, and
an independent read-only review. Historical audit prose that conflicts with
this checkpoint is not an active backlog.

## Open local product work

1. Run one integrated real-browser acceptance journey on the current HEAD. It
   must cover multi-artboard navigation, selection and transforms, direct text
   editing, image insert/replace/crop, Undo/Redo, autosave/reload, publish, and
   export in one retained run. Focused gates exist, but not one post-fix
   journey proving these systems together.
2. Complete a cohesive, user-approved editor redesign and cleanliness pass.
   The earlier sophistication gate implemented many OpenPencil-derived details,
   but later user feedback explicitly rejected the overall result. Treat
   spacing, hierarchy, density, contextual chrome, empty/loading/error states,
   and cross-surface consistency as open until accepted in the live product.
3. Rework and recertify action discoverability after moving editor controls to
   the bottom dock. Delete and contextual commands exist, but their placement
   and visibility have not received a dedicated post-move acceptance gate.
4. Continue architectural decomposition. Render invalidation, crop, and preview
   ownership have been extracted, but `use-document-editor.ts` remains 11,479
   lines and `studio-shell.tsx` remains 6,959 lines. This is regression and
   maintenance debt, not a reason to replace Fabric immediately.
5. Close the remaining hardening seams recorded by the async architecture
   review: isolated cross-realm File/Blob and AbortSignal harness failures,
   injected-failure rollback after the synchronous Fabric install barrier,
   explicit disposal coverage for retired Fabric objects, and same-tick shell
   predicate seam coverage. These are not currently reproduced user-facing
   outages, but current-HEAD full-suite cleanliness is not yet proven.

## Open integration and production work

6. Production is 46 commits behind this baseline. It predates the
   multi-artboard editor and the latest image, direct-text, architecture, and
   transient-guide repairs.
7. Owner-authenticated deployed acceptance remains incomplete: hostile and
   rate/concurrency cases, multipart/R2 lifecycle, Workflow restart/recovery,
   renderer parity/performance, second-principal isolation, artifact expiry,
   and audit-retention evidence.
8. Public API documentation and a possible production session-token audit
   identity edge need reconciliation with the implemented durable job/error
   behavior.
9. Live Stuwiz retrieval and reconciliation remain external. Studio has a
   versioned local refresh/conflict model, but still needs an authenticated
   complete-source endpoint, stable source revision/fingerprint, authorization,
   and provenance contract from Stuwiz.
10. Browser-local media is not inherently shared across devices. Promotion,
    relink, and recovery exist locally, but shared availability depends on
    successful managed promotion and still needs deployed owner/isolation,
    restart, cleanup, and fault evidence.

## Deliberately deferred or optional

- Background removal is implemented behind a boundary but disabled by default.
  No paid provider is configured and no local/on-device inference provider is
  implemented. This is not a blocker unless the feature is enabled.
- Skill-driven WebMCP generation is accepted, but an unapproved generated
  candidate is memory-only, GPT has no screenshot-inspect/correct loop, and an
  actual ChatGPT session consuming an arbitrary GitHub `SKILL.md` has not been
  retained as production evidence.
- The catalog has 21 templates and 37 curated media items. Its product
  mechanics are complete; Canva-scale content breadth is optional expansion,
  not an unfinished Gate 8.
- Cross-page multi-selection is currently out of scope.
- Collaboration, presence, comments, team libraries, and organization roles
  are explicitly excluded from this product plan.

## Closed work that must not re-enter the backlog

- Continuous multi-artboard workspace and page navigation.
- Hierarchical Layers tree, search, reorder, reparent, lock, and visibility.
- Inspector color preview/commit performance and the reported freeze.
- Moving canvas tools, Undo/Redo, and panel controls out of the top bar.
- Direct persisted text editing, including generated quotation text and legacy
  quotation migration.
- Curated/local image selection, insertion, replacement, StrictMode restoration,
  and the reported blank-editor crashes.
- Crop, fit/fill, flip, and image frames.
- Transient snapping-line cleanup, including blank selection and interrupted
  transforms. Persistent ruler guides remain intentional.
- Rich text, reusable typography/paint styles, and variables.
- Components, instances, variants, and overrides.
- General vector, alpha, luminance, and nested masks.
- Template/media Library Gate 8.
- Bounded blank/template document generation through WebMCP and Review.

