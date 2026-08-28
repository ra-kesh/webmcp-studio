# GUIDE-01B shell-level test gap

## Review scope

The GUIDE-01B shell wiring is currently concentrated in `apps/studio/src/features/editor/studio-shell.tsx`. The pure guide model, persistence repository, overlay, dialog, snapping, Fabric adapter, and product-command catalog have focused tests. The shell itself is not exported as a testable controller, and its keyboard listener, command dispatcher, chronological session ledger, and `FabricArtboard` composition are all closed over component state.

## What is covered elsewhere

- `packages/editor/test/page-guides.test.ts` covers guide validation, persistence-safe codecs, coordinate conversion, hit testing, drag settlement, and guide history.
- `packages/editor/test/snapping.test.ts` and `packages/editor/test/transform-constraints.test.ts` cover explicit guide targets, priority, and zoom-aware hysteresis.
- `packages/editor/test/product-commands.test.ts` covers the catalog, menu placement, checked-state resolution, and invocation validation for ruler/guide commands.
- `apps/studio/src/features/editor/canvas-ruler-guide-overlay.test.tsx` covers overlay rendering and pointer interactions.
- `apps/studio/src/features/editor/guide-manager-dialog.test.tsx` covers the accessible guide manager surface.
- `apps/studio/src/features/editor/editor-escape.test.ts` covers the existing transient Escape precedence.

## Integration contracts after remediation

The shell now exposes focused pure controllers at the stateful boundaries that previously could only be inspected inside the monolith:

1. `studio-session-history.ts` and its tests prove same-turn guide→document and document→guide chronology, exact undo/redo transfer, branch clearing, coalescing deduplication, and document-identity reset. A mounted `useDocumentEditor` test proves commit observation happens synchronously and excludes undo, redo, and history maintenance.
2. `guide-product-commands.ts` and its tests prove checked state, independent ruler/guide toggles, and manager availability while both visual layers are hidden. The dialog suite proves labelled controls and explicit opener-focus restoration.
3. `editor-escape.ts` owns and tests guide-drag and guide-selection precedence before crop, text, transform, and ordinary selection handling. The shell retains the editable-target and active-text guard before guide deletion.
4. `guide-snap-targets.ts`, snapping/constraint tests, and Fabric adapter tests prove hidden-guide exclusion, active-page projection, guide priority, zoom-aware hysteresis, and move/resize consumption.
5. Workspace repository and hook behavior clear page/document transient state and retain only valid active document/page records. Overlay boundary tests cover visibility and interaction cancellation; the shell cancels overlay drag/hover when modal or compact surfaces open.

The remaining proof is deliberately browser-only: native pointer capture/cancellation, command-to-portal focus behavior in the assembled shell, visual ruler alignment, and mixed gesture behavior at real zoom levels. It cannot be replaced by another static shell fixture.

## Safe verification performed

No browser, Vite, build, Playwright, Wrangler, or worker process was started. The final static gate is editor **284/284** and Studio **405/405**, with typecheck, focused lint, Prettier, and `git diff --check` green.
