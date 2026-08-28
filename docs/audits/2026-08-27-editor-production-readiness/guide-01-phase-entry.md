# GUIDE-01 phase-entry audit: transform constraints and alignment feedback

Date: 2026-08-28
Status: phase-entry contract only; no production code changed

## Scope and current truth

This audit rereads `remediation-progress.md`, `next-local-parity-slice.md`,
`feature-parity-matrix.md`, `production-readiness-backlog.md`, and
`docs/loora-editor-reference.md`, then traces the current editor implementation
and tests. GUIDE-01 is not an invitation to rebuild snapping. The repository
already has a useful, deterministic move path and a completed cancellable
transform boundary.

Already implemented and should be preserved:

- `packages/editor/src/snapping.ts` computes page/edge/center alignment snaps,
  equal horizontal/vertical spacing, thresholds, priority, and transient guide
  geometry as a pure function.
- `FabricCanvasAdapter.onObjectMoving` applies those deltas during a Fabric
  move, excludes the moving objects from peers, stores transient guides, and
  paints alignment/spacing overlays in `after:render`.
- `CanvasTransformSessionController` owns immutable canonical baselines and
  commit/cancel/stale outcomes. Fabric starts it from the public
  `before:transform` event; Escape and replacement/unmount paths restore the
  baseline without creating a history mutation.
- The editor already forces uniform multi-selection corner resize and locks
  scaling flips because the canonical node model cannot represent the resulting
  geometry safely.
- `packages/editor/test/snapping.test.ts`, `transform-session.test.ts`, and
  the Fabric adapter tests cover pure move/spacing decisions, transform
  settlement, cancellation, rollback, guide cleanup, and public Fabric event
  boundaries.

The remaining GUIDE-01 gap is therefore later transform behavior: resize-edge
snapping, rotation-angle snapping, modifier semantics, and optional persistent
rulers/guides. Rulers and user-created guides are useful polish but are not a
prerequisite for safe direct manipulation and should follow the first slice.

## Reference findings

### OpenPencil

The local reference at
`outputs/reference-repos/editors/open-pencil/packages/vue/src` separates the
interaction owner from geometry helpers. `shared/input/move-snap.ts` derives a
moving selection from immutable pointer-down originals, resolves world-space
targets, converts correction back into parent-local coordinates, and explicitly
clears transient guides when snapping is disabled. `shared/input/resize/snap.ts`
does the same for the active edge: it identifies the edge being moved, derives
world bounds, refuses world-axis corrections for rotated bases, and applies only
the relevant width/height edge delta. This is the right conceptual pattern for
Studio, but Studio must keep its own canonical document/Fabric boundary.

OpenPencil's documented shortcuts establish familiar expectations: Shift while
resizing preserves aspect ratio, Shift while rotating snaps to 15 degrees, and
Alt/Option supports duplicate-and-move. Its settings model also treats geometry,
object, and pixel-grid snapping as explicit preferences, with a temporary
modifier to disable snapping. These preferences are not currently part of
Studio's document contract and should not be smuggled into the first patch as
untyped UI state.

Its rulers are an independent viewport overlay with theme tokens and a menu
toggle; they are not mixed into scene nodes or undo history. Persistent guides,
when added, should follow the same separation: viewport/document presentation
state, never renderer content or quotation data.

### Loora

`docs/loora-editor-reference.md` identifies Loora's `packages/canvas/src/react.tsx`
as the gesture reference and `packages/canvas/src/engine.ts` plus
`packages/agent/src/canvas-tools.ts` as the transaction reference. The relevant
lesson is ownership: pointer/gesture preview is ephemeral, validated operations
are committed through one transaction engine, and human/UI/agent/API surfaces
share the same operation vocabulary. Constraint math must therefore be pure and
testable, while only a successful final geometry enters the existing Studio
command/history path. Do not introduce a second transform store or a separate
WebMCP-only constraint implementation.

## Recommended smallest high-value slice

Implement **GUIDE-01A: constrained resize and rotation snapping**, in this order:

1. Add framework-independent geometry functions in `packages/editor/src/`
   (prefer `transform-constraints.ts` or a similarly focused module):
   `applyResizeConstraint`, `snapRotation`, and a typed modifier/policy input.
   Inputs must use canonical geometry, active handle, pointer-derived proposed
   geometry, page/peer snap targets, and explicit policy flags. Outputs must be
   canonical proposed geometry plus typed transient guides/diagnostics. No Fabric
   objects, React state, history, or DOM in this module.
2. Add pure tests for all eight resize handles, positive and negative deltas,
   minimum dimensions, Shift aspect preservation from the pointer-down ratio,
   Alt/Option center-preserving resize if we expose it, and 15-degree rotation
   snapping with threshold/hysteresis. Tests must include rotated-node and
   rotated-ancestor cases; either use exact local/world conversion or explicitly
   decline world-axis resize snapping when the basis is not axis-aligned, as the
   OpenPencil reference does.
3. Integrate the pure result into the existing Fabric public lifecycle. Use
   `before:transform` for the immutable baseline and public `object:scaling` /
   `object:rotating` preview events (or public control action handlers where
   Fabric requires pointer-time correction). Keep preview Fabric-local, update
   `setCoords`, replace active transient guides, and clear them on pointer-up,
   cancel, rejected commit, page/document replacement, and unmount.
4. Preserve the current transform-session commit boundary: one changed gesture
   yields one canonical node-change batch/history transaction; no-op and
   declined/rejected transforms emit nothing and restore the exact baseline.
5. Expose a single user-visible snapping policy through the existing product
   command/settings model only after the pure behavior is stable. At minimum,
   Shift must be discoverable as “preserve proportions” for resize and “snap to
   15°” for rotation. A temporary “disable snapping” modifier may be added only
   if its state is available to every transform path (mouse, keyboard, and
   future WebMCP) and is represented in tests.

Defer **GUIDE-01B** (rulers and persistent guides) until GUIDE-01A is complete.
GUIDE-01B should own viewport rulers, zoom-aware ticks, drag-out guide creation,
guide visibility/toggle, and a separate guide model. It should not be bundled
with resize/rotation math because it has different persistence, accessibility,
export, and multi-page semantics.

## Exact code boundaries

Likely production boundaries:

- `packages/editor/src/transform-constraints.ts` (new pure policy/math module)
- `packages/editor/src/snapping.ts` (reuse/extend typed target/guide primitives;
  do not duplicate `calculateSnap`)
- `packages/editor/src/fabric-adapter.ts` (public Fabric preview integration,
  baseline/session and guide lifecycle)
- `packages/editor/src/index.ts` (public types/exports only)
- `packages/editor/test/transform-constraints.test.ts` (new pure matrix)
- `packages/editor/test/fabric-adapter.test.ts` (public event and rollback
  regressions)
- `apps/studio/src/features/editor/fabric-artboard.tsx` only if the public
  imperative handle or Escape contract must expose a new policy capability.

Do not modify the canonical document schema for ephemeral snapping guides. Do
not add renderer/export fields for rulers. Do not alter WebMCP command payloads
until the operation is a canonical command with a validated, deterministic
result.

## UX contract

- A selected object resizes from the grabbed edge/corner. The opposite edge
  stays anchored; width and height never become zero or negative.
- Holding Shift during resize preserves the pointer-down aspect ratio. Holding
  Shift during rotation snaps to 15-degree increments. The behavior is stable
  near a snap angle (no flicker when the pointer jitters around the threshold).
- Resize edge/center snaps use the same page/object target language and visual
  treatment as existing move guides. The guide is transient and disappears as
  soon as the gesture ends or is cancelled.
- Rotated objects/ancestors never receive a silently incorrect world-axis
  correction. They either use a correct local/world projection or deliberately
  decline that resize snap while retaining safe manual resize.
- Locked/review-mode nodes remain non-mutating. Multi-selection continues to
  preserve the existing uniform-scale and locked-node policies.
- One gesture is one Undo entry; a click/no-op, Escape, rejected commit, or
  stale document/page produces no document/history/revision change.
- Shortcut/help surfaces use platform-neutral language and explain modifiers;
  tooltips must not claim a modifier that the integration does not actually
  observe.

## Risks and decisions

1. Fabric's `object:scaling` and `object:rotating` are preview events, not a
   canonical command boundary. Applying constraints there must not call
   `onNodesChange`; only `object:modified` may settle the existing session.
2. `getScaledWidth()`/`getScaledHeight()` and ActiveSelection transforms can
   describe world geometry differently from canonical top-left node geometry.
   Reuse the adapter's projection helpers and test single and multi-selection
   cases rather than adding ad-hoc `left + width` arithmetic.
3. Resize snapping must not apply a world correction as local width/height for
   rotated bases. This is a correctness risk, not merely a missing polish case.
4. Modifier semantics can conflict with Fabric's `uniScaleKey` and existing
   multi-selection action handlers. Capture the pointer-down ratio/baseline in
   the transform session; do not infer it from mutated Fabric state.
5. Guide rendering currently uses canvas-local coordinates and a top context.
   Any new guide type must be cleared on every settlement path and remain
   correct under zoom/pan; otherwise stale lines will be more damaging than the
   missing feature.
6. Persistent guides raise a product decision for multi-page documents: guides
   are page-local or document-global. Leave that decision explicit for GUIDE-01B.

## Non-browser acceptance tests

Pure constraint matrix:

- eight resize handles, anchored opposite edge, min-size clamp;
- Shift aspect preservation from immutable baseline;
- rotation 0/15/30 and negative angles, snap threshold and hysteresis;
- snap disabled path returns proposed geometry and no guides;
- page/peer edge and center targets for resize, including tie priority;
- rotated-node/ancestor safety path;
- finite/valid canonical output for extreme pointer deltas.

Fabric boundary:

- public `before:transform` captures a canonical baseline for resize and rotate;
- `object:scaling`/`object:rotating` preview applies constraints without
  `onNodesChange` or history changes;
- completed changed gesture emits one batch and preserves projected geometry;
- no-op, Escape, rejected commit, page/document replacement, and unmount restore
  exact geometry, clear guides, and preserve selection;
- Shift modifier behavior is read from the event/control path and does not
  mutate unrelated tools;
- multi-selection and locked-node policy remains uniform and safe.

Run the focused editor tests, editor typecheck/lint/Prettier, and `git diff --check`.
Browser proof is still required before claiming visual parity, but it is not a
phase-entry prerequisite on the current unhealthy local browser host.

## Explicit out-of-scope items

- Rebuilding existing move snapping, equal-spacing guides, or transform sessions.
- Persistent user rulers/guides (GUIDE-01B).
- Freeform constraints/layout systems, responsive constraints, grids, or
  auto-layout.
- Exporting guides, changing quotation/render schemas, or adding a parallel
  WebMCP transform engine.
