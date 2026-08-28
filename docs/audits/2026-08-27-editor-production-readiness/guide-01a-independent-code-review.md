# GUIDE-01A independent code review

Date: 2026-08-28
Reviewer scope: read-only production-code review
Initial verdict: two P1 modifier regressions blocked GUIDE-01A completion; see
the 2026-08-28 follow-up below for the current verdict.

## Material reviewed

- `docs/audits/2026-08-27-editor-production-readiness/guide-01-phase-entry.md`
- `docs/loora-editor-reference.md`
- OpenPencil `packages/vue/src/shared/input/move-snap.ts`
- OpenPencil `packages/vue/src/shared/input/resize/snap.ts`
- `packages/editor/src/transform-constraints.ts`
- `packages/editor/src/fabric-adapter.ts`
- `packages/editor/test/transform-constraints.test.ts`
- `packages/editor/test/fabric-adapter.test.ts`
- Fabric 7.4.0 public control and event implementation under
  `node_modules/fabric/src/controls` and `node_modules/fabric/src/canvas`

The focused tests are green: 79 tests and 495 assertions across
`transform-constraints.test.ts` and `fabric-adapter.test.ts`. That does not close
the findings below because the adapter tests call private preview handlers with
handwritten event objects. They do not pass through Fabric's public control
dispatcher.

## Findings

### P1: Shift on a shape side handle still invokes Fabric skew, not constrained resize

Evidence:

- Studio leaves Fabric's `altActionKey` at its default, `shiftKey`.
  `FABRIC_TRANSFORM_MODIFIER_POLICY` sets `uniformScaling`, `uniScaleKey`,
  `centeredScaling`, and `centeredKey`, but not `altActionKey`
  (`packages/editor/src/fabric-adapter.ts:80-85`).
- Studio shapes keep Fabric's default side controls. Fabric's public control
  factory wires `ml` and `mr` to `scalingXOrSkewingY`, and `mt` and `mb` to
  `scalingYOrSkewingX`
  (`node_modules/fabric/src/controls/commonControls.ts:14-45`).
- Those handlers read `canvas.altActionKey` on every pointer event. With Shift
  held, they call the skew handler and report the action as `skewX` or `skewY`
  (`node_modules/fabric/src/controls/scaleSkew.ts:13-35,65-94`).
- `fabricTransformKind` rejects skew actions, and the adapter does not listen to
  `object:skewing` (`packages/editor/src/fabric-adapter.ts:238-251,1291-1297`).
  A side drag that starts with Shift therefore has no transform session and no
  GUIDE-01A preview. If Shift changes during an existing side resize, Fabric can
  switch the action handler to skew while Studio still holds a resize session.
- The passing Shift test manually begins `scale`, manually changes `scaleX` and
  `scaleY`, then directly invokes `onObjectTransformPreview`
  (`packages/editor/test/fabric-adapter.test.ts:318-357`). It never exercises a
  side control or Fabric's action lookup.

Impact:

The phase contract says Shift preserves the pointer-down aspect ratio for all
eight resize handles. On ordinary rectangle, ellipse, line, image, and icon
side handles, Shift instead enters an unrepresentable skew path. Releasing or
pressing Shift during the gesture can also change the operation under an
already-open transform session. The canonical node model has no skew field, so
the final sync can jump or discard part of what the user saw.

Required correction:

- Remove skew from Studio's object controls. Use explicit scale-only side
  controls, or set a non-conflicting/disabled alternate action and verify the
  public action name.
- Test pointer-down with Shift and Shift changes during the gesture through the
  real Fabric control action handler. Assert `before:transform` starts a resize
  session, only resize events fire, skew remains zero, preview preserves the
  immutable baseline ratio, and settlement produces one canonical batch.
- Repeat the integration case for a rotated node. Studio may decline world-axis
  snapping, but it must still perform a safe local proportional resize.

### P1: the constraint preview removes Alt/Option center-origin resizing

Evidence:

- Studio explicitly enables Fabric's Alt center-origin resize behavior through
  `centeredKey: "altKey"` and labels the policy as familiar center-origin
  semantics (`packages/editor/src/fabric-adapter.ts:75-85` and
  `packages/editor/test/fabric-adapter.test.ts:127-135`).
- Fabric chooses the transform origin at pointer-down. Alt makes that origin the
  object center (`node_modules/fabric/src/canvas/SelectableCanvas.ts:621-698`).
- `applyResizeConstraint` has no Alt/centered input. `proposedEdges` always
  restores the nominal opposite edge from the canonical baseline
  (`packages/editor/src/transform-constraints.ts:148-169`).
- `applyFabricRectPreview` then moves `left`/`top` and changes scale to match that
  opposite-edge result (`packages/editor/src/fabric-adapter.ts:135-151`). The
  adapter calls it for every axis-aligned single-node resize, even when no snap
  candidate exists (`packages/editor/src/fabric-adapter.ts:2270-2297`).

A concrete case shows the loss. For a baseline `{ x: 100, width: 200 }`, an Alt
east drag can propose `{ x: 80, width: 240 }`. The pure constraint returns
`{ x: 100, width: 220 }`, even with no guide. The left edge stops moving and the
resize becomes opposite-edge anchored.

Impact:

The adapter advertises and configures center-origin resizing, but GUIDE-01A
silently converts it to ordinary anchored resizing after Fabric has produced the
correct preview. This is a direct manipulation regression for every axis-aligned
single object.

Required correction:

- Either add an explicit centered-resize policy to the pure constraint input and
  derive both moving edges from the immutable baseline, or stop exposing the Alt
  behavior until it has a complete contract.
- Read Alt from the public transform state established at pointer-down. Do not
  infer centered geometry from the already-mutated Fabric object.
- Add tests for all side and corner handles with Alt, plus Shift and Alt
  together. Verify the center stays fixed, minimum-size clamping remains
  symmetric, snaps do not move the center, and cancel/reject restores the exact
  baseline.

### P2: Textbox resize snapping changes scale instead of the intrinsic text width

Evidence:

- Fabric's `Textbox` side controls use `changeWidth`, which mutates intrinsic
  `target.width` so text reflows during the gesture
  (`node_modules/fabric/src/controls/commonControls.ts:86-105` and
  `node_modules/fabric/src/controls/changeWidth.ts:15-51`).
- Studio listens to `object:resizing`, but `applyFabricRectPreview` implements
  every correction by multiplying `scaleX` and `scaleY`
  (`packages/editor/src/fabric-adapter.ts:135-151,1294-1296`).
- The integration tests exercise only the ellipse fixture for GUIDE-01A. There
  is no snapped `Textbox` resize assertion
  (`packages/editor/test/fabric-adapter.test.ts:85-124,318-442`).

Impact:

When a text side edge snaps, the last few pixels of preview stretch the glyphs
instead of changing the text box width and reflowing its lines. Canonical commit
and resync then replace that scaled preview with intrinsic geometry, which can
change wrapping at pointer-up. Fixed and `auto_height` text need separate
geometry rules because the document manages different axes for each mode.

Required correction:

- Branch preview application by Fabric action and node type. A `Textbox`
  `resizing` correction should update intrinsic width through the same geometry
  path as Fabric's width control, then update coordinates. Do not introduce
  visual scale on a document-managed text axis.
- Add fixed, `auto_height`, and `auto_width` coverage. Assert line wrapping and
  managed axes before preview, after snap, after commit, and after canonical
  resync.

### P2: resize snapping has a hard threshold with no latch

Evidence:

- Rotation snapping carries a `RotationSnapLatch` with separate acquire and
  release thresholds (`packages/editor/src/transform-constraints.ts:59-80,552-609`).
- Resize snapping selects a candidate only while its correction is within one
  threshold. It has no previous candidate or release threshold
  (`packages/editor/src/transform-constraints.ts:332-350,393-468`).

Impact:

Pointer noise around eight document units alternates between snapped and free
geometry. The edge and guide can jump by roughly the full threshold. This is
visually inconsistent across zoom levels because the threshold is expressed in
page units, not screen pixels. Existing move snapping has the same debt, but
GUIDE-01A should not present resize snapping as polished without recording it.

Required correction:

- Carry a typed resize snap latch per active axis and release it outside a wider
  threshold, using immutable pointer-derived geometry.
- Define thresholds in screen pixels and convert at the canvas boundary, or
  document and test the current zoom-dependent behavior.

## Areas that passed static review

- The pure constraint module does not mutate inputs and explicitly declines
  world-axis snapping for non-axis-aligned bases.
- Rotation snapping normalizes wrapped angles and has working acquire/release
  hysteresis.
- Preview handlers do not call `onNodesChange`; `object:modified` remains the
  canonical settlement point.
- Cancel, rejected commit, stale context, selection replacement, sync, and
  unmount paths restore the transform baseline in the covered single-object and
  ActiveSelection cases.
- Resize guides reuse the existing `SnapGuide` type and clear on the covered
  settlement paths.
- ActiveSelection resize remains uniform-only and rejects nonrepresentable
  nonuniform completion.

## Residual browser gates

After the P1 fixes, GUIDE-01A still needs a healthy-host browser pass. The pass
should cover rectangle, rotated rectangle, line, image group, fixed text,
`auto_height` text, and multi-selection at fit zoom and 100 percent. Exercise
every handle, Shift pressed before pointer-down, Shift pressed and released
midgesture, Alt center resize if retained, rotation latch acquire/release,
snap-guide cleanup, Escape, rejected commit, Undo, and page replacement. Check
that text does not stretch or rewrap only after pointer-up, guides stay aligned
under pan/zoom, and one completed gesture creates one Undo entry.

The focused unit tests passing is useful evidence for the pure math and existing
settlement boundary. It is not evidence that Fabric dispatches the intended
operation or that the live preview matches the canonical result.

## Follow-up review after remediation — 2026-08-28

Current verdict: one P1 Textbox integration regression still blocks GUIDE-01A
completion. The original Fabric skew, centered resize, and resize-latch findings
are closed. The rotated Shift side-resize regression found during this follow-up
was also corrected and independently rechecked.

### Verification performed

- Re-read the current implementation rather than relying on remediation notes:
  `packages/editor/src/transform-constraints.ts`,
  `packages/editor/src/fabric-adapter.ts`, `packages/editor/src/index.ts`,
  `apps/studio/src/features/editor/fabric-artboard.tsx`, and all three focused
  test files.
- Re-ran the focused suite through the package's Vitest runner: 95 tests pass
  across `transform-constraints.test.ts`, `fabric-adapter.test.ts`, and
  `fabric-textbox-resize.test.ts`.
- Re-ran `@webmcp/editor` typecheck; it passes.
- Reproduced the remaining Textbox issue through Fabric's public `mr` control
  action handler, then Studio's preview and settlement handlers. This matters
  because directly assigning `textbox.width` does not execute Fabric's
  fixed-anchor behavior.

### Closure status for the original findings

1. **Fabric Shift side skew — closed.** The canvas now sets
   `altActionKey: null` (`fabric-adapter.ts:81-89`). The public side-control test
   resolves `scaleX`, invokes the real control action handler, and verifies that
   neither skew axis changes (`fabric-adapter.test.ts:171-211`).
2. **Alt/Option centered resize — closed.** The pure constraint accepts a
   centered modifier and covers all eight handles, Shift+Alt, symmetric minimum
   clamps, and centered snaps (`transform-constraints.test.ts:125-198,276-310`).
   The adapter reads Fabric's pointer-down transform origin instead of the live
   key state (`fabric-adapter.ts:2381-2395`), and its integration coverage keeps
   the immutable center after Alt is released (`fabric-adapter.test.ts:435-480`).
3. **Textbox intrinsic resize — partially closed.** Fixed text now updates
   intrinsic dimensions and its clip, auto-height text changes intrinsic width
   without glyph scaling, and auto-width handles are hidden. The remaining
   public-control anchor regression is detailed below.
4. **Resize latch and zoom dependence — closed.** Resize snapping now carries
   per-axis latches with separate acquire/release thresholds, converts screen
   pixels through viewport zoom, and clears latch state together with transient
   guides. The Studio artboard supplies the current zoom through the public
   adapter boundary (`fabric-artboard.tsx:335-338`). Pure and adapter tests cover
   acquisition, partial release, full release, and two materially different
   zoom levels.
5. **Rotated Shift side resize — closed after follow-up correction.** The
   adapter now derives local proposed dimensions, applies safe aspect constraints
   even when world-axis snapping is declined, and restores the opposite handle
   with Fabric's public origin APIs (`fabric-adapter.ts:180-227,2381-2429`). The
   18-degree regression test verifies both the baseline ratio and the fixed
   anchor (`fabric-adapter.test.ts:610-640`).

### P1: public auto-height width resize moves the text box vertically

Evidence:

- Fabric's public Textbox `mr`/`ml` action is `changeWidth`, wrapped with
  `wrapWithFixedAnchor`. Because changing width reflows an auto-height Textbox,
  Fabric preserves the opposite side's **center**, not its top. A narrower box
  therefore moves vertically before Studio receives `object:resizing`.
- Studio applies `resizeAnchor(handle, centered)` after its intrinsic Textbox
  correction. For an ordinary east/west handle, that helper also returns
  `originY: "center"` (`fabric-adapter.ts:210-227`). The correction therefore
  preserves Fabric's already-shifted center and cannot restore the canonical
  top coordinate.
- The document layout boundary owns auto-height height only; a width patch
  derives height without changing `x` or `y`
  (`packages/document/src/text-layout.ts:219-235`). The adapter nevertheless
  includes the shifted `y` in the canonical change because
  `constrainTextGeometryPatch("auto_height", ...)` removes only `height`
  (`fabric-adapter.ts:2824-2832`).
- Concrete public-control reproduction with `long-text-only`: canonical geometry
  was `{ x: 40, y: 40, width: 560, height: 153.6 }`. Fabric's `mr` handler at a
  narrower pointer produced `{ x: 40, y: -68.5, width: 275, height: 374.3 }`.
  Studio snapped the width to `280` but retained `y: -68.5`, then emitted
  `{ x: 40, y: -68.5, width: 280, rotation: 0 }` on settlement. A horizontal
  width resize therefore moves the object upward by 108.5 document units.
- `fabric-textbox-resize.test.ts:83-151` assigns `textbox.width` directly. That
  bypasses the public `changeWidth`/`wrapWithFixedAnchor` path, so its unchanged
  `y` cannot prove the browser behavior.

Impact:

Auto-height text jumps vertically during an ordinary left/right resize and the
unexpected position is committed as canonical geometry. The derived document
height can then differ from the Fabric preview after resync, adding a second
visible jump. This violates both direct-manipulation expectations and the
document's managed-axis contract.

Required correction:

- Give auto-height width resize an anchor policy that preserves canonical
  top-position while keeping the opposite horizontal edge fixed. For rotated
  text, perform that correction in the object's local basis rather than mixing
  world `x`/`y` offsets with local dimensions.
- Add a jsdom integration test that invokes the actual public Textbox `mr` and
  `ml` action handlers before `onObjectTransformPreview`. Assert stable `y`,
  intrinsic width and reflowed height during preview, a width-only canonical
  sizing mutation at settlement, and stable geometry after canonical resync.
  Repeat at a non-zero rotation and for a snapped edge.

### Current residual browser gates

The browser matrix from the initial review still applies. In addition, exercise
public left/right handles on auto-height text at multiple widths and zooms,
including enough reflow to add and remove several lines. The top position and
opposite horizontal edge must stay stable through preview, pointer-up, Undo,
Redo, and canonical resync.

## Final Textbox closure review — 2026-08-28

Current verdict: the public auto-height regression above is closed, but one P1
fixed-Textbox modifier regression remains. No P0 was found.

### Auto-height closure

The adapter now treats a public Textbox `resizing` action as intrinsic horizontal
editing and restores a top-edge point derived from the immutable canonical
baseline (`fabric-adapter.ts:211-256,2410-2463`). The updated jsdom test invokes
Fabric's real `mr` handler, proves Fabric first moves `y`, and proves Studio then
restores canonical `y` while snapping intrinsic width and omitting the
layout-owned height from the canonical patch
(`fabric-textbox-resize.test.ts:83-166`). Static review and the focused test
confirm the axis-aligned auto-height case is closed. The baseline-point formula
also correctly expresses left-top, right-top, and center-top anchors in the
rotated local basis.

### P1: fixed Textbox anchoring mixes canonical clip geometry with intrinsic Fabric geometry

Evidence:

- The latest sizing-mode split correctly reserves canonical top anchoring for
  auto-height text (`fabric-adapter.ts:211-237,2445-2451`). Fixed text now asks
  for an ordinary side-center anchor.
- `textResizeBaselineAnchor` computes that point from the canonical fixed frame,
  whose height is the clip height. `setPositionByOrigin`, however, interprets
  `originY: "center"` using the Textbox's intrinsic Fabric height
  (`fabric-adapter.ts:240-265,2493-2498`). Those heights can differ whenever the
  fixed frame clips or pads its text.
- Concrete public `mr` reproduction on `text-typography`: canonical top was
  `y = 52`, canonical clip height was `190`, and intrinsic Textbox height was
  `202.496`. The baseline helper supplied the canonical side-center at `y = 147`;
  Fabric placed its intrinsic center there, moving the object top to `45.752`
  (`45.8` after canonical rounding).
- The updated fixed-mode public-control test now detects this exact regression:
  the focused run has 95 passes and one failure at
  `fabric-textbox-resize.test.ts:79`, expected `y = 52`, received `45.8`.
- Shift proportional resize remains an additional implication: its fixed anchor
  must be the canonical clip-frame side-center, and Shift+Alt must preserve the
  canonical clip-frame center. A Fabric intrinsic center is not interchangeable
  with either point, especially after width reflow or at non-zero rotation.

Impact:

Even an unmodified horizontal resize moves a fixed text frame vertically when
its intrinsic and clipped heights differ. Shift and Shift+Alt add incorrect
canonical center behavior. These coordinates are included in the settlement
patch, so the error survives pointer-up.

Required correction:

- Keep canonical top anchoring for `auto_height`. For fixed text, convert the
  desired canonical clip-frame anchor into the corresponding Fabric intrinsic
  origin, or position from canonical frame geometry without asking Fabric to
  reinterpret the point against its intrinsic height. The conversion must use
  the rotated local basis.
- Keep the new public no-modifier regression test, then add public `mr` and `ml`
  cases with Shift and Shift+Alt. Assert canonical frame anchors and ratio,
  intrinsic and clip dimensions, one settlement batch, and exact canonical
  resync at zero and non-zero rotation.

### Final verification state

The editor typecheck passes. The current focused Vitest run has 95 passes and
one failure in the new fixed Textbox public-control regression. That failure is
correct evidence that GUIDE-01A is not yet closed.

## Latest fixed-frame projection review — 2026-08-28

Current verdict: the public fixed resize cases above now pass, but the projection
change introduces one P1 canonical round-trip regression. GUIDE-01A is not yet
closed.

### Closed since the preceding review

The adapter now distinguishes auto-height top anchoring from fixed-frame center
anchoring. Fixed public `mr` tests cover ordinary Shift and centered Shift+Alt,
and the canonical projection accounts for the visible clip's centered inset.
The focused suite passes 97 tests. Editor and Studio typechecks also pass.

### P1: an untouched fixed Textbox no longer round-trips canonical position

Evidence:

- `fabricObjectToNodePatch` now adds the rotated, world-scaled inset between the
  intrinsic Textbox and centered fixed clip to `x`/`y`
  (`fabric-adapter.ts:266-325`). This is the visible clip-frame position.
- Creation and canonical sync still place the intrinsic Textbox top-left at
  canonical `node.x`/`node.y` through `sharedOptions`
  (`fabric-adapter.ts:392-427,567-584,1231-1332`). They do not apply the inverse
  inset needed to put the visible clip frame at the canonical position.
- Concrete untouched round-trip for rotated `text-typography`: canonical
  `{ x: 48, y: 52, width: 340, height: 190, rotation: 7 }` creates a Fabric
  Textbox with intrinsic height `202.496` and the expected `340 × 190` clip, but
  immediately projects back as
  `{ x: 47.2, y: 58.2, width: 340, height: 190, rotation: 7 }`.
  `syncFabricObjectFromNode` produces the same mismatch.
- The 97 passing tests do not assert fixed text canonical → Fabric → canonical
  identity before a transform. The new resize tests first run the preview anchor
  correction, which moves the object onto the new projected baseline and hides
  the initial mismatch.

Impact:

The first changed fixed-text transform can include a spurious position offset,
and any settlement path that compares the untouched Fabric projection with the
canonical baseline can treat a no-op as changed. A rotated fixed frame is also
visually offset from the canonical renderer before interaction, so editor and
export geometry can disagree.

Required correction:

- During fixed Textbox creation and every canonical sync, derive the intrinsic
  layout dimensions first and position the Fabric object by the inverse rotated
  clip inset so the visible clip's top-left is exactly canonical `x`/`y`.
  Alternatively use a Fabric representation whose outer object is the canonical
  frame and whose intrinsic Textbox is a child; either representation must make
  the projection an identity.
- Add zero- and non-zero-rotation round-trip tests for fixed text, including a
  frame shorter and taller than intrinsic layout. Assert initial creation,
  canonical resync, click/no-op settlement, changed move, Shift resize,
  Shift+Alt resize, cancel, rejection, and subsequent resync all preserve the
  same visible-frame coordinates.

## Inverse-placement follow-up — 2026-08-28

Current verdict: canonical creation and resync identity are now closed. One P1
fixed-Textbox all-handles regression remains, so GUIDE-01A is not yet closed.

### Canonical round-trip closure

`positionFixedTextboxFrame` now places the intrinsic Textbox center on the
rotated canonical clip-frame center during creation and canonical sync
(`fabric-adapter.ts:455-471,585-603,1322-1351`). The inverse agrees with the
visible-frame projection. The new rotated regression test proves
canonical → create → projection identity, mutation → sync → projection identity,
and no-op settlement without a change
(`fabric-textbox-resize.test.ts:15-59`). The focused suite passes 98 tests, and
both editor and Studio typechecks pass.

### P1: fixed Textbox vertical and corner handles anchor the intrinsic box, not the canonical frame

Evidence:

- Fixed Textbox side handles use the public `resizing` action and now receive an
  explicit canonical frame anchor. Top/bottom and corner handles instead use
  Fabric's `scaleY`/`scale` actions, so `intrinsicTextWidth` is false
  (`fabric-adapter.ts:2441-2501`).
- For those actions, `applyFabricRectPreview` captures the anchor through
  `object.getPointByOrigin` (`fabric-adapter.ts:140-178`). Fabric resolves that
  origin against the intrinsic Textbox dimensions, not the centered clip-frame
  dimensions represented by canonical width and height.
- Concrete fixed-top contraction using Fabric's exact fixed-bottom semantics on
  axis-aligned `text-typography`: baseline canonical frame was
  `{ y: 52, height: 190 }`, with bottom `242`. After an `mt` preview at
  `scaleY = 0.5`, Studio projected `{ y: 150.1, height: 95 }`, whose bottom is
  `245.1`. The expected canonical result is `{ y: 147, height: 95 }`, preserving
  bottom `242`. The 3.1-unit error is the scaled intrinsic/clip height mismatch.
- At non-zero rotation the same local anchor mismatch introduces error on both
  world axes. Corner handles inherit it, including Shift and Shift+Alt cases.
- The current fixed-text tests exercise public `mr` only. They do not exercise
  `mt`, `mb`, or any corner, so the 98 passing tests do not cover the
  all-eight-handle contract.

Impact:

Fixed text visibly drifts at the nominally anchored edge during vertical and
corner resize. The wrong position is canonicalized on pointer-up. This violates
the phase's explicit opposite-edge and all-eight-handle requirements.

Required correction:

- Derive fixed Textbox anchors from the canonical clip frame for every transform
  action, not only intrinsic-width `resizing`. Convert that canonical point to
  Fabric's intrinsic origin or position the intrinsic box with the inverse inset
  after applying constrained frame geometry.
- Add public `mt`, `mb`, and all four corner-handler tests for fixed text, at zero
  and non-zero rotation. Cover ordinary resize, Shift, and Shift+Alt; assert the
  visible clip-frame anchor, ratio, one settlement, cancel/reject restoration,
  and canonical resync.

## Final all-handle closure review — 2026-08-28

Final static-review verdict: **GUIDE-01A is closed.** No remaining P0, P1, or P2
correctness finding was identified in the reviewed implementation. The residual
browser gates below remain required before claiming visual parity.

### Closure of the fixed Textbox all-handle finding

- Every fixed Textbox resize action now uses the immutable canonical clip-frame
  anchor, including intrinsic-width `resizing`, `scaleX`, `scaleY`, and corner
  `scale` actions (`fabric-adapter.ts:2490-2554`). Auto-height retains its
  separate canonical-top policy.
- After constrained geometry is applied, the adapter derives the desired visible
  clip-frame center from the canonical anchor, constrained width and height, and
  total rotation. It then positions Fabric by its intrinsic center
  (`fabric-adapter.ts:140-208`). This avoids asking Fabric to interpret a
  canonical clip edge against different intrinsic Textbox dimensions.
- The conversion is the algebraic inverse of fixed-frame projection: positioning
  the intrinsic center at the desired visible-frame center, then adding the
  rotated centered clip inset in `fabricObjectToNodePatch`, recovers the
  constrained canonical top-left and frame dimensions. The same conversion is
  safe at non-zero rotation and under the uniform world scale allowed for an
  ActiveSelection.
- The public Fabric control matrix covers `tl`, `mt`, `tr`, `mr`, `br`, `mb`,
  `bl`, and `ml` with Shift. It asserts the canonical opposite anchor and
  pointer-down ratio for every handle
  (`fabric-textbox-resize.test.ts:229-349`). Separate public tests cover fixed
  Shift+Alt, fixed intrinsic width/clip behavior, auto-height reflow and snap,
  rotated auto-height top anchoring, rotated fixed create/sync identity, and
  no-op settlement.

### Final verification

- Focused editor suite: 99 tests pass across
  `transform-constraints.test.ts`, `fabric-adapter.test.ts`, and
  `fabric-textbox-resize.test.ts`.
- `@webmcp/editor` typecheck passes.
- `@webmcp/studio` typecheck passes.
- Review-document Prettier and diff checks pass.

### Residual browser gates after static closure

Run the existing healthy-host matrix before calling the interaction visually
complete: all eight handles on ordinary and rotated shapes and fixed text;
public left/right handles on auto-height text; Shift pressed before pointer-down
and toggled midgesture; Shift+Alt center resize; fit zoom and 100 percent;
snap acquire/hold/release; Escape; rejected settlement; Undo/Redo; page change;
and canonical resync. Verify visible handles track the clipped fixed frame,
guides clear on every settlement, text never stretches, and one gesture creates
exactly one history entry.
