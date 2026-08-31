# Editor sophistication follow-up

Date: 2026-09-01

Status: active on `main` after the accepted general-mask merge

## Revisited evidence

Before editing, this pass reread `editor-sophistication-full-phase-entry.md`,
`reference-patterns.md`, and the retained OpenPencil, Loora, Canva-style, Geist,
and shadcn decisions recorded there. The accepted panel geometry, command
projection, 11 px chrome floor, coarse-pointer targets, dark workspace,
reduced-motion behavior, and continuous-control transaction model remain
frozen regression gates.

The current build was then exercised at `http://localhost:3001` through the
real start surface, Recent documents, template catalog, a six-page quotation,
the hierarchical Layers tree, a selected locked text layer, an editable
template-backed text layer, and one color edit followed by Undo. Local D1 was
migrated from `0015` through `0019`; the previously visible library error then
disappeared and the catalog loaded normally. No remote migration or deployment
was performed.

## Observed follow-up defects

1. Returning from a document to the start surface programmatically focuses the
   H1 for assistive-technology continuity, but the heading inherited Chrome's
   large native outline. The result looked like a broken input around the hero
   title. Keep the focus transfer and suppress decoration on this non-interactive
   programmatic focus target.
2. `studio-persistence-layout.test.ts` lived directly under the TanStack route
   directory without the configured `-` ignore prefix. Development and every
   production build repeatedly warned that it was not a route. Keep the test in
   place but rename it to the route generator's explicit ignored form.
3. The production build remains truthful but heavy: the client Studio shell is
   about 1.26 MB minified / 330 kB gzip. Treat route/dialog/panel code splitting
   as the next performance-polish gate; do not hide the warning by increasing
   the limit.

## Acceptance

- the start heading still receives programmatic focus after returning home but
  no longer paints a false input-like outline;
- route generation and both production builds run without the false route-file
  warning;
- focused start-surface and route-layout tests pass;
- Studio typecheck, formatting, and diff checks pass;
- the next checkpoint measures and reduces the editor entry chunk without
  changing command, document, Inspector, renderer, or WebMCP semantics.
