# Next local editor parity slice

Date: 2026-08-28

Status: **implemented, independently reviewed, and non-browser verified**

Completion evidence is recorded in `remediation-progress.md` under **Cancellable canvas transform sessions (HIST-01 follow-up)**. This file remains the retained phase-entry contract.

## Recommendation

Implement an explicit, cancellable canvas transform session for ordinary move, resize, and rotate gestures.

This is the highest-value editor gap that can be closed and tested on the current host without Vite, Browser Rendering, Playwright, Wrangler, or a production build. Direct manipulation is the editor's most repeated interaction. Studio currently commits a completed Fabric transform once, but it has no public begin/cancel boundary. Pressing Escape clears selection instead of restoring an in-progress transform. This is the remaining named P1 follow-up from HIST-01, not a newly invented backlog item.

## Current-code evidence

- `packages/editor/src/fabric-adapter.ts:1124-1128` listens to `object:modified` and `object:moving`, but not a public transform-start event. The adapter stores crop and text sessions, but no ordinary transform session.
- `packages/editor/src/fabric-adapter.ts:2016-2055` converts Fabric geometry to one canonical `onNodesChange` batch only after `object:modified`. That gives one-step Undo after pointer-up, but there is no baseline to restore before pointer-up.
- `apps/studio/src/features/editor/fabric-artboard.tsx:26-40` exposes text and crop imperative controls only. It cannot ask the adapter to cancel an ordinary transform.
- `apps/studio/src/features/studio-shell.tsx:997-1000` handles Escape by clearing selection. It neither asks the canvas to cancel first nor preserves selection after cancellation.
- `packages/editor/src/snapping.ts:209-270` and `fabric-adapter.ts:1910-1945` already implement deterministic move snapping and visible alignment/spacing guides. This slice should preserve that work and clear its transient guides on cancel. It must not rebuild snapping.
- `docs/audits/2026-08-27-editor-production-readiness/remediation-progress.md:340-343` explicitly leaves Escape rollback during an in-flight Fabric transform open.

## Bounded implementation contract

1. Add a small framework-independent transform-session model in `@webmcp/editor`. A session records document ID, page ID, selected node IDs, transform kind, and exact canonical baseline geometry. It has `begin`, `commit`, `cancel`, and stale-context outcomes.
2. In `FabricCanvasAdapter`, begin the session from Fabric's public transform lifecycle. Do not read or write private members such as `_currentTransform`. Single and multi-selection sessions must use canonical node geometry as the rollback source.
3. Preview remains Fabric-local. A normal pointer completion emits exactly one existing `onNodesChange` batch. A no-op completion emits nothing.
4. Expose `cancelTransform(): boolean` through `CanvasAdapter` and `FabricArtboardHandle`. Escape calls it before any selection-clearing behavior. A successful cancel restores every transformed object, calls `setCoords`, clears guides, requests one render, keeps the same selection, and suppresses the trailing `object:modified` event.
5. Cancel on document replacement, page change, review lock, loss of interactive mode, and unmount. A stale session must never commit against another document or page.
6. If Studio rejects a completed batch, use the same baseline restoration path. This removes the current duplicate rollback logic and keeps rejected and cancelled transforms behaviorally identical.

## Acceptance tests that do not need a browser or server

- Add `packages/editor/test/transform-session.test.ts` for single selection, multi-selection, no-op completion, duplicate begin, cancel, stale document/page, and commit-after-cancel rejection.
- Extend `packages/editor/test/fabric-adapter.test.ts` with public-event regressions for move, scale, rotate, multi-selection, guide cleanup, trailing `object:modified` suppression, rejected commit rollback, page/document replacement, and unmount.
- Add a mounted `FabricArtboard` contract test or extract a pure Escape resolver under `apps/studio/src/features/editor/` to prove this order: crop cancel, text cancel, ordinary transform cancel, then selection clear. Verify that only the last case clears selection.
- Prove that a completed gesture still creates one named history entry and one Undo restores exact geometry. Prove cancellation leaves revision, snapshot ID, operation version, history depth, and selection unchanged.
- Run the editor and focused Studio test suites, their typechecks, scoped ESLint, Prettier, and `git diff --check`. Do not claim pointer or visual proof until the host is healthy.

## Reference code to reread before implementation

Primary reference root: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos`.

- OpenPencil: `editors/open-pencil/packages/vue/src/canvas/useCanvasInput.ts`, `canvas/transform/{actions,input,rotation}.ts`, `shared/input/{types,move-snap}.ts`, `shared/input/resize/snap.ts`, and `controls/undo-batch/use.ts`. Take the explicit interaction ownership, baseline, and commit boundary. Do not copy its engine-specific state model.
- Fabric: inspect the installed public canvas transform events and control actions before choosing the start/cancel hook. Avoid private canvas state.
- React Design Editor: `editors/react-design-editor/src/canvas/handlers/{TransactionHandler,InteractionHandler,GuidelineHandler,SpacingGuidelineHandler}.ts` and their tests. Use it only to cross-check rollback and transient-guide cleanup behavior.

## Dependencies and non-goals

Dependencies already exist: canonical geometry projection, selection reconciliation, named history transactions, command capability gating, Fabric object-to-node conversion, and move snapping.

Do not add rulers, persistent user guides, resize snapping, angle snapping, modifier constraints, command search, context menus, or history byte accounting in this slice. They are separate work. Do not weaken the boundary into "Undo after pointer-up". The missing behavior is cancellation before a canonical mutation occurs.

## Stale-audit discrepancies

The original parity matrix and executive audit should not drive implementation without checking the current tree:

- Pages and outputs are no longer unreachable. PAGE-01 is implemented.
- Layers are no longer a flat list. NAV-01 has a virtualized hierarchical ARIA tree with groups and structural commands.
- Inspector validation, locked and mixed states, and continuous-control commit boundaries are implemented under INSPECT-01.
- The generic 44 px text path has been replaced by presets, direct editing, sizing modes, overflow repair, lists, and shared layout projection. TEXT-01 still needs browser and pixel evidence, not another local feature rewrite.
- User media browsing, reuse, deletion safety, crop editing, and managed WebMCP media are implemented. MEDIA-01 and the ASSET-02 local contract are code-review clean.
- Filmstrip thumbnails no longer render every inactive page as a live Artboard. PERF-01 uses visibility-bounded renderer rasters and a bounded cache.
- Canvas gesture ownership is no longer global, and published render repair is implemented locally. Their remaining gates require a healthy browser or deployed environment and are excluded here.
- GUIDE-01 is partly stale. Move snapping, equal-spacing guides, and visual overlays already exist. Only later ruler, persistent-guide, resize/rotation snap, and modifier work remains.

After this slice, the strongest all-local editor candidates are MENU-01 command discovery/context menus and the remaining bounded GUIDE-01 constraint work. Neither should displace transform cancellation because the current Escape behavior can lose the user's live direct-manipulation intent.
