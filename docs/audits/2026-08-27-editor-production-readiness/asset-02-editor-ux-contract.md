# ASSET-02 editor image UX contract

Date: 2026-08-28
Scope: Image insertion, selection, cropping, replacement, transforms, frame masks, history, accessibility, responsive behavior, and renderer parity. This is a phase-entry code audit and interaction contract. Browser, Vite, build, and Playwright were intentionally not run.

Line references describe the working tree at audit time.

## Executive verdict

The media chooser is ready to feed a serious image editor. The image editor is not ready to receive it.

Studio currently has a sound reusable picker with insert and replace modes, per-item busy states, upload progress, recovery states, and keyboard-safe asset cards (`apps/studio/src/features/editor/asset-library-dialog.tsx:94-113,376-439,905-988,1020-1117`; `apps/studio/src/features/editor/asset-library-components.tsx:116-217,338-478`). After an asset reaches the document, however, the editable model stops at an outer rectangle, `cover` or `contain`, and two focal-point percentages (`packages/document/src/schema.ts:13-40,79-86,132-140`). The Fabric image is a non-interactive child of a generic group, so the user can transform the frame but cannot manipulate the image inside it (`packages/editor/src/fabric-adapter.ts:415-489`). Double-clicking an image does nothing (`packages/editor/src/fabric-adapter.ts:863-881`).

This is not a missing toolbar problem. Studio needs a first-class image edit session and a canonical inner-image transform shared by the document schema, Fabric, render view, export, API, WebMCP, inspector, history, and tests. Adding crop controls only to the inspector would create a second partial implementation and preserve the underlying mismatch.

The phase-entry decision is:

1. Treat the image frame and the image content as different things.
2. Make crop/reposition an explicit, cancellable edit mode with ephemeral draft state.
3. Commit the entire edit as one named history transaction.
4. Use one action registry and one capability model for canvas, toolbar, inspector, menus, keyboard, and automation.
5. Do not call focal-point sliders a crop tool, and do not call rounded image frames arbitrary Figma masks.

## Product principles

- **Direct manipulation first.** The canvas is where users see and change the image. The inspector is the precise, accessible alternative, not the only way to understand what changed.
- **Outer frame versus inner image.** Normal selection transforms the frame. Crop mode transforms image content inside a fixed frame. The visual treatment, cursor, labels, and history must make the distinction unmistakable.
- **Non-destructive by default.** Crop, fit, rotation, flip, and mask preserve the original asset. Reset restores its initial placement without re-uploading.
- **One source of truth.** A document opened in Fabric, the React render view, PNG/PDF export, a published URL, or WebMCP must render the same pixels.
- **Fast common path, precise expert path.** Double-click and drag should solve the usual task. Numeric inputs and keyboard controls should make exact work possible.
- **Visible mode and exit.** Crop mode must never be a hidden state. The toolbar says **Crop image**, the frame changes treatment, and **Done** and **Cancel** are visible.
- **No silent destructive reinterpretation.** Opening Media from the global Add action inserts. Opening **Replace image…** from a selected image replaces. Do not guess from selection and surprise the user.
- **Screen-space controls.** Handles and buttons remain usable at every camera zoom. They do not shrink with the page.

## Reference decisions

The contract uses official product behavior as interaction evidence and OpenPencil as architecture evidence.

| Reference                                                                                                                 | Pattern to adopt                                                                                                                                                                                                                       | Boundary                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Figma: Crop an image](https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image)                               | Double-click or inspector entry, faded overflow, drag to reposition, handles and scale control, Enter/click outside to apply, Escape to cancel, and non-destructive editing.                                                           | Studio needs its own document and renderer model; do not mimic only the visual chrome.                                                                      |
| [Figma: Adjust image properties](https://help.figma.com/hc/en-us/articles/360041098433-Adjust-the-properties-of-an-image) | Clear Fill, Fit, Crop, and Tile semantics plus inner-image rotation.                                                                                                                                                                   | ASSET-02 needs Fill, Fit, and manual crop. Tile can wait until repeat-pattern output is a real use case.                                                    |
| [Figma: Masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks)                                               | Masks are non-destructive and conceptually separate from crop.                                                                                                                                                                         | An ellipse or rounded image frame is a frame mask. Arbitrary layer masks require a document-level mask relationship and cannot be faked with border radius. |
| [Canva: Crop images](https://www.canva.com/features/crop-image/)                                                          | Low-friction double-click crop, scale/reposition, and aspect-ratio choices.                                                                                                                                                            | Keep Studio's exact document coordinates and undo contract.                                                                                                 |
| [Canva: Circle crop](https://www.canva.com/features/circle-crop/)                                                         | Frames are understandable containers; users drag content inside a frame and double-click to reframe it.                                                                                                                                | Studio should not require a separate media-copy workflow to change the frame mask.                                                                          |
| [Canva: Flip and rotate](https://www.canva.com/help/flip-and-rotate/)                                                     | Flip is a visible toolbar action; object rotation and inner-image rotation are separate operations.                                                                                                                                    | Labels must say **Frame rotation** and **Image rotation** when both are visible.                                                                            |
| OpenPencil command registry                                                                                               | Mask and flip are commands with centralized enablement and shortcuts (`outputs/reference-repos/editors/open-pencil/packages/vue/src/editor/commands/registry.ts:37-80`; `selection.ts:148-158,208-223`; `menu-model/canvas.ts:44-52`). | Copy the command/capability discipline, not Vue implementation details.                                                                                     |
| OpenPencil mask state                                                                                                     | Mask edits are headless state changes with named undo (`outputs/reference-repos/editors/open-pencil/packages/vue/src/controls/mask/use.ts:8-22`).                                                                                      | Studio's canonical state belongs in `@webmcp/document`, not Fabric objects.                                                                                 |

OpenPencil reference root: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/open-pencil`.

## Current gaps, grounded in code

| Priority | Gap                                                                              | Current evidence                                                                                                                                                                                                                                                                                                                                      | Required correction                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | No canonical crop transform exists.                                              | The image schema and patch accept only `fit`, `cropX`, `cropY`, and asset/alt fields (`packages/document/src/schema.ts:79-86,132-140`).                                                                                                                                                                                                               | Add a versioned inner-image placement model. Validate, migrate, serialize, render, and expose it through API/WebMCP.                                                                                                            |
| P0       | `cropX` and `cropY` are focal points, not crop bounds.                           | Cover calculates one source rectangle from the frame aspect ratio; contain always uses the full source (`packages/document/src/render-projection.ts:241-281`).                                                                                                                                                                                        | Store content position and zoom explicitly. The user must be able to create more than the one crop implied by cover.                                                                                                            |
| P0       | Browser render parity cannot express manual crop.                                | Render view maps the image to CSS `object-fit` and `object-position` only (`packages/render-view/src/index.tsx:92-97`).                                                                                                                                                                                                                               | Project one canonical placement into CSS transforms/clip paths or a deterministic canvas/SVG renderer. Add conformance fixtures.                                                                                                |
| P0       | Fabric cannot enter or represent an image edit session.                          | The adapter interface exposes sync, select, text editing, and export only (`packages/editor/src/index.ts:18-39`).                                                                                                                                                                                                                                     | Add explicit crop-session methods/events or a renderer-neutral edit-session controller. Do not smuggle crop state through selection events.                                                                                     |
| P0       | Image content is not directly manipulable.                                       | The image child is `selectable: false` and `evented: false` inside a generic group (`packages/editor/src/fabric-adapter.ts:415-463`).                                                                                                                                                                                                                 | During crop mode, keep the frame fixed and route dragging/scaling/rotation to a draft content transform.                                                                                                                        |
| P0       | Double-clicking an image has no behavior.                                        | Double-click handles a Textbox or an empty canvas; an image target falls through (`packages/editor/src/fabric-adapter.ts:863-881`).                                                                                                                                                                                                                   | Double-click an editable image to enter crop. Keep empty-canvas double-click for camera zoom and text double-click for text editing.                                                                                            |
| P0       | Inspector gives no visible crop mode.                                            | Image controls provide Cover/Contain, horizontal and vertical focus, alt text, source, and Replace only (`apps/studio/src/features/editor/inspector-sidebar.tsx:701-785`).                                                                                                                                                                            | Add **Crop**, Fit/Fill, scale, image rotation, flip, frame mask, and Reset. Move alt/source into a separate Content section.                                                                                                    |
| P0       | Frame and content rotation are conflated by omission.                            | `rotation` is a base frame property (`packages/document/src/schema.ts:13-25`); the inspector shows one generic rotation field (`apps/studio/src/features/editor/inspector-sidebar.tsx:303-340`).                                                                                                                                                      | Preserve frame rotation and add image rotation. Label both precisely.                                                                                                                                                           |
| P0       | Image actions are outside the action registry.                                   | Command IDs stop at generic object operations (`packages/editor/src/commands.ts:1-26`), and command context lacks image/source/edit-mode capability (`packages/editor/src/commands.ts:30-93`).                                                                                                                                                        | Add image commands and derived enablement. Use them from every surface.                                                                                                                                                         |
| P0       | Inspector capability is just “all selected nodes are images.”                    | Image capability has no lock, source readiness, mask, crop-session, or single-selection distinction (`packages/editor/src/inspector.ts:8-14,49-73`).                                                                                                                                                                                                  | Derive `canEnterCrop`, `canReplaceImage`, `canFlipImage`, `canApplyFrameMask`, `hasMissingSource`, and edit-mode constraints centrally.                                                                                         |
| P1       | The shell duplicates action metadata and dispatch.                               | Studio has a shell-only menu action type and label/icon arrays (`apps/studio/src/features/studio-shell.tsx:126-156,797-891`) plus a separate dispatch switch (`apps/studio/src/features/studio-shell.tsx:405-496`).                                                                                                                                   | Register labels, shortcuts, enablement, and handlers once. Inspector and contextual toolbar must invoke the same command IDs.                                                                                                   |
| P1       | Image insertion is centered on the page, not the visible work area.              | New images are capped and centered using page dimensions (`apps/studio/src/features/editor/media-selection-model.ts:14-42`).                                                                                                                                                                                                                          | Place at the visible page center, clamp fully into page bounds when possible, then select it. Keep deterministic page-center fallback for API insertion without a camera.                                                       |
| P1       | Replacement preserves a partial crop by accident, not a full placement contract. | Replacement patches only asset identity, source, and alt (`apps/studio/src/features/editor/media-selection-model.ts:45-52`).                                                                                                                                                                                                                          | Preserve frame and content placement by documented policy, re-clamp for the new aspect ratio, and offer **Reset crop**. Undo must restore every prior property.                                                                 |
| P1       | Fabric source change rebuilds the object with no staged edit state.              | A changed image URL removes and recreates the object during sync (`packages/editor/src/fabric-adapter.ts:717-741`).                                                                                                                                                                                                                                   | Preload/decode the replacement before committing. Keep the old pixels visible until the new source is ready.                                                                                                                    |
| P1       | Missing image state is visual but not actionable.                                | Fabric catches load failure and draws an unlabeled cross placeholder (`packages/editor/src/fabric-adapter.ts:285-351`).                                                                                                                                                                                                                               | Show “Image unavailable” in the frame and expose **Locate replacement** in inspector/context menu without moving the layer.                                                                                                     |
| P1       | Sync failures can leave a permanent preparation overlay.                         | Dynamic import and `adapter.sync()` are promise chains without a rendered rejection state (`apps/studio/src/features/editor/fabric-artboard.tsx:96-143,181-185`).                                                                                                                                                                                     | Render a retryable canvas error and announce it. Crop entry remains disabled until the selected source is ready.                                                                                                                |
| P1       | Selection visuals are duplicated and scale with camera zoom.                     | Fabric draws controls with a fixed canvas-space `cornerSize: 22` (`packages/editor/src/fabric-adapter.ts:95-124`), while the React artboard draws another aria-hidden outline and 8 px handles (`apps/studio/src/features/editor/fabric-artboard.tsx:190-253`).                                                                                       | Choose one interaction-control owner. Render hit targets and handles in screen space with one visual vocabulary for select and crop modes.                                                                                      |
| P1       | Camera gestures have no crop-mode arbitration.                                   | The viewport owns non-passive wheel and Safari gesture zoom with cursor anchoring (`apps/studio/src/features/editor/use-canvas-gesture-navigation.ts:75-213`).                                                                                                                                                                                        | Keep trackpad pinch as camera zoom. In crop mode, content zoom uses its visible slider or explicit modifier; two-touch direct manipulation on the image may scale content, while gestures outside the frame control the camera. |
| P1       | Crop gestures would fragment history with the current generic patch route.       | Canvas changes are unnamed except direct text (`apps/studio/src/features/editor/canvas-change-policy.ts:4-14`); history commits canonical snapshots (`packages/editor/src/history.ts:115-160`).                                                                                                                                                       | Keep pointer movement in an ephemeral draft and commit one `Crop image` transaction on Done. Cancel writes nothing.                                                                                                             |
| P1       | Compact inspector blocks direct canvas editing.                                  | Below 1280 px, inspector and document panels move into modal sheets and make the main editor inert (`apps/studio/src/features/studio-shell.tsx:893-903,1637-1766`).                                                                                                                                                                                   | Entering crop from a compact sheet closes it, restores the canvas, and opens a non-modal bottom crop bar that avoids the selected frame.                                                                                        |
| P1       | Current tests exercise media choice, not image composition.                      | Replacement coverage exists (`apps/studio/test/e2e/media-library-production.spec.ts:744-864`), but inspector fixtures are rectangles and generic controls (`apps/studio/test/e2e/inspector-production.spec.ts:53-103,168-296`). Fabric image tests cover missing-image containment, not crop (`packages/editor/test/fabric-adapter.test.ts:348-399`). | Add schema, projection, adapter, history, inspector, keyboard, responsive, and renderer-conformance tests listed below.                                                                                                         |

## Canonical image model

The stored node must distinguish the outer frame from the asset placement inside it. Names below are a product contract; implementation may refine the TypeScript shape only if every semantic remains explicit.

```ts
type ImagePlacement = {
  mode: "fill" | "fit" | "manual"
  focalX: number // 0..1 in oriented source coordinates
  focalY: number // 0..1 in oriented source coordinates
  zoom: number // >= 1, relative to the mode's base scale
  rotation: number // inner image degrees, normalized for display
  flipX: boolean
  flipY: boolean
}

type ImageFrameMask =
  | { kind: "rectangle" }
  | { kind: "rounded_rectangle"; radius: number }
  | { kind: "ellipse" }

type ImageNode = BaseNode & {
  type: "image"
  assetId: string
  src: string
  alt: string
  placement: ImagePlacement
  frameMask: ImageFrameMask
}
```

Semantics:

- Outer `x`, `y`, `width`, `height`, and base `rotation` describe the frame.
- `fill` uses the minimum source scale that fully covers the frame. `zoom: 1` is that scale.
- `fit` uses the maximum source scale that reveals the full source. `zoom: 1` is that scale.
- `manual` begins from fill-scale geometry and stores explicit focal point, zoom, inner rotation, and flips.
- Entering crop from Fill or Fit converts the visible pixels to an equivalent manual placement without a visual jump.
- Focal coordinates are defined after applying inner rotation and flip. Projection code, not UI code, owns the conversion and clamping rules.
- Manual placement must keep the frame covered when the active mode promises no empty area. Dragging stops with elastic resistance at the legal boundary; commit clamps exactly.
- Frame masks clip content but do not rasterize or destroy source pixels.
- Schema defaults are `fill`, centered focal point, `zoom: 1`, `rotation: 0`, no flip, rectangle mask.
- Legacy `cover` migrates to Fill. Legacy `contain` migrates to Fit. Existing `cropX` and `cropY` become focal coordinates. Migration must be deterministic and idempotent.

Arbitrary Figma-style masks are a separate document primitive. They need a mask-layer relationship or group child role, path projection, layer-tree behavior, export parity, and API operations. ASSET-02 must ship rectangle, rounded rectangle, and ellipse frame masks honestly. A later arbitrary-mask phase may add `maskNodeId` or a mask child role after the document tree contract is designed; it must not overload `frameMask` with renderer-only Fabric state.

## Image interaction state machine

| State            | Entry                                                                | Canvas behavior                                                                                                                              | Exit                                                                                                                       |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Idle             | No image selected.                                                   | Normal select, pan, and camera zoom.                                                                                                         | Select an image.                                                                                                           |
| Image selected   | Single, visible image selected.                                      | Frame handles move/resize/rotate the outer frame. Context bar shows Crop, Replace, Fit/Fill, Flip, and More.                                 | Deselect, select another node, or enter crop.                                                                              |
| Crop ready       | Source is decoded and editable.                                      | Frame boundary stays fixed. Overflowing content is visible through a 35–45% dim overlay. Inner image has a distinct border and crop handles. | Drag/scale/rotate to make a draft; Done, Enter, click outside, or page change commits. Escape or Cancel restores baseline. |
| Crop dragging    | Pointer/touch is captured by inner content.                          | Drag repositions content. Cursor remains `grabbing`. Camera pan cannot steal the pointer.                                                    | Pointer up returns to Crop ready without writing history.                                                                  |
| Crop scaling     | Slider, pinch, or crop handle changes content scale.                 | Zoom stays anchored at pointer/focal point when feasible. Min/max and frame-cover constraints are visible, not silently ignored.             | Gesture end returns to Crop ready without writing history.                                                                 |
| Replace choosing | Explicit Replace opens Media with target name.                       | Canvas remains visible behind modal; the old image and placement remain canonical.                                                           | Cancel returns focus to Replace. Selecting an asset enters Replace loading.                                                |
| Replace loading  | Chosen source is fetched/decoded and validated.                      | Old image remains visible. Chosen card says “Replacing…”. Duplicate activation and conflicting edits are blocked.                            | Success commits once and preserves selection. Failure keeps dialog open with retry/change-source actions.                  |
| Missing source   | Asset cannot resolve or decode.                                      | Stable placeholder retains frame geometry.                                                                                                   | Locate replacement, choose another asset, remove layer, or undo. Crop is unavailable.                                      |
| Read-only        | Review is pending, selection is locked, or document is not editable. | Image remains selectable and inspectable. Crop, replace, fit/fill, flip, rotate, mask, and reset are disabled with a reason.                 | Leave review mode or unlock through an allowed action.                                                                     |

Rules for ambiguous exits:

- **Enter** and **Done** apply the draft.
- **Escape** and **Cancel** restore the exact baseline and add no history entry.
- Clicking outside the frame applies only when the click is not an explicit destructive or navigation action.
- Switching page or selection applies a valid draft before the switch so ordinary work is not lost.
- Undo/redo, document replacement, review submission, and a remote/source invalidation cancel the draft first, then perform their own action. They must not merge with the crop transaction.
- If no property changed, Done closes crop without adding history.

## Required surface behavior

### Insert image

1. Global **Media** or **Add image** opens Media in Add mode.
2. Selecting an asset preloads and validates it before document mutation.
3. Place the image at natural aspect ratio, capped to 64% of the visible page region and 640 document units, with a sensible minimum. Center it in the visible page region and clamp it into page bounds. If no camera context exists, use the page center.
4. Default placement is Fit when the image should remain uncropped as inserted. If product decides Fill is the visual default, the frame must use a deliberate target aspect ratio; creating a natural-aspect frame and calling it Cover offers no benefit.
5. Select the new layer, close Media after commit, announce “Added {asset name} to {page name},” and record exactly one **Add image** history entry.
6. If insertion fails, keep Media open, keep the document unchanged, and place the error on the chosen asset or upload queue row.

### Enter and use crop mode

Crop entry points:

- Double-click an editable selected or unselected image on canvas.
- Press **Crop** in the image context bar.
- Press **Crop image** in the inspector.
- Invoke the registered `image.crop` command from a menu or automation surface.

On entry, select the image if necessary, hide outer-frame transform handles, draw the fixed crop frame, show overflow dimming, and show a compact crop bar with **Fit**, **Fill**, scale, rotate-left, rotate-right, flip-horizontal, flip-vertical, **Reset**, **Cancel**, and **Done**. The canvas and inspector display the same draft.

Direct manipulation:

- Drag inside the image to reposition content. Do not move the frame.
- Drag crop-frame edges/corners to change the frame bounds while content placement remains visually stable. Holding Shift preserves the current frame aspect ratio. Holding Alt/Option resizes symmetrically.
- Use the scale slider, wheel with an explicit modifier, or a two-touch pinch begun inside the image to zoom content. Trackpad pinch without that explicit content gesture remains camera zoom.
- Rotate content with toolbar steps and a numeric field. Free rotation uses an inner-image rotation handle only if it can be visually distinguished from frame rotation.
- **Resize frame to image** makes the frame match the visible source bounds without resampling.
- Clicking Done or pressing Enter applies. Escape cancels.

### Fit, fill, and manual crop

- **Fit** reveals the full oriented image. Letterboxing is allowed and uses a transparent frame interior in export unless the frame itself has a fill in a future schema.
- **Fill** covers the frame and centers on the current focal point.
- Dragging or changing scale while in Fit/Fill converts to Manual without a pixel jump.
- The inspector uses plain labels **Fit image**, **Fill frame**, and **Crop image**. Do not use only “Contain/Cover,” which describes CSS rather than the user's result.
- Multi-selection may apply Fit or Fill to all editable images as one transaction. Crop mode itself requires exactly one image.

### Replace image

- **Replace image…** opens the existing Media dialog in Replace mode and names the target layer.
- Preserve node ID, name, outer geometry, frame rotation, opacity, visibility, lock state, binding, stack position, frame mask, and placement mode.
- Preserve focal point, zoom, inner rotation, and flips, then clamp against the new source dimensions. This avoids a visual jump for same-subject or same-aspect replacements.
- Update `assetId` and `src`. Replace alt text with the new asset description only when the old alt was empty or still equal to the old asset default. Preserve user-authored alt text and mark it for review if the subject has materially changed.
- After replacement, show **Reset crop** as an immediate recovery action. One Undo restores the exact prior source, placement, and alt text.
- Never clear or move the selected frame while the new source loads.

### Flip and rotate

- **Flip horizontal** and **Flip vertical** affect inner content when an image is selected. Use Shift+H and Shift+V only if shortcut conflict review confirms they are free; list them in the command palette and shortcut help.
- Frame flip, if introduced later for groups/shapes, is a different command.
- Inspector labels are **Frame rotation** and **Image rotation**. Image rotation supports 90° steps plus exact degrees. Frame rotation retains existing generic object behavior.
- Rotation and flip are non-destructive and participate in Reset crop.

### Frame masks

- Provide Rectangle, Rounded rectangle, and Ellipse in the image inspector and context bar More menu.
- Switching masks never changes the asset or rasterizes pixels. It preserves placement and frame geometry.
- Rounded rectangle exposes one linked radius for this phase, clamped to half the shorter frame edge.
- Crop mode previews the active mask, while the frame bounds and inner-image controls remain legible.
- Changing a frame mask outside crop is one named **Change image frame** history step. Mask plus crop changes made during one crop session commit together as **Crop image**.
- Do not expose “Use as mask” until arbitrary layer masks are represented in the schema, layer tree, renderers, API, and tests.

### Reset

- **Reset crop** restores the selected image to centered Fill, `zoom: 1`, zero inner rotation, and no flips. It preserves frame geometry, frame mask, asset identity, alt text, frame rotation, opacity, and bindings.
- **Reset image frame** is a separate future/destructive action if product needs it. Do not hide it behind the same label.
- Reset is disabled when the placement already equals its default. One Undo restores the prior placement.

## Keyboard, touch, focus, and accessibility

### Keyboard

| Input             | Image selected                                                                                     | Crop mode                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Enter             | Enter crop when focus is on the selected canvas image; activate focused toolbar control otherwise. | Apply crop.                                                                                                |
| Escape            | Clear selection or close the active image menu.                                                    | Cancel crop and restore baseline.                                                                          |
| Arrow keys        | Nudge frame by 1 document unit; Shift uses the existing larger nudge.                              | Reposition image content by 1 screen pixel converted to document coordinates; Shift uses 10 screen pixels. |
| Shift+H / Shift+V | Flip inner image if registered and conflict-free.                                                  | Flip inner image draft.                                                                                    |
| Tab               | Move through context bar and inspector controls without trapping focus in canvas.                  | Move through crop bar and numeric alternatives; the canvas remains operable after focus returns.           |
| Cmd/Ctrl+Z        | Undo prior committed action.                                                                       | Cancel the uncommitted crop draft, then leave history unchanged. A second invocation performs Undo.        |

Shortcuts must live in `@webmcp/editor` with command IDs, labels, enablement, and platform display strings. They must be suppressed while a text field, textarea, contenteditable, dialog, or IME composition owns input.

### Touch and pointer

- Every visible button is at least 44 by 44 CSS pixels on compact/touch layouts. Crop handles have at least a 24 px invisible hit target even when the visual mark is smaller.
- A one-finger drag started inside the crop frame repositions image content. A two-finger pinch started inside the image scales content and may translate it. A gesture started outside the frame controls the camera.
- Pointer capture belongs to the operation that started first. Leaving the frame or viewport does not drop a drag.
- `touch-action` is scoped. Do not apply `touch-none` to the entire editor in a way that blocks page scrolling or assistive gestures; apply it to the direct-manipulation surface while a gesture is active.
- Do not require hover to discover Crop, Replace, Done, Cancel, or Reset.

### Focus and announcements

- The Fabric upper canvas already declares `role="application"` and `aria-label="Interactive design canvas"` (`packages/editor/src/fabric-adapter.ts:613-638`). Add concise, discoverable instructions tied with `aria-describedby`, including how to leave the application region.
- Entering crop moves programmatic focus to the crop bar heading or Done button only when entry came from an inspector/menu control. Canvas double-click keeps canvas focus.
- Exiting crop returns focus to the exact opener when it still exists; otherwise focus the selected canvas image/context bar.
- Announce mode once: “Crop image. Drag to reposition. Press Enter to apply or Escape to cancel.” Do not announce every pointer move.
- Numeric placement controls provide accessible names, valid ranges, units, current values, and visible validation. Canvas-only manipulation always has inspector equivalents.
- Missing source, decode failure, replacement failure, and canvas initialization failure use a polite status for state changes and an alert only when the user initiated the failed action.
- Decorative overflow dimming and canvas outlines stay hidden from the accessibility tree. The selected layer name, frame dimensions, placement mode, and lock state remain available as text.

## Busy, failure, and concurrency contract

| Situation                          | Required behavior                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial image decode               | Render the stable frame and a contained skeleton/placeholder. Do not allow crop until natural dimensions are known. Never resize the frame when decode completes. |
| Replace loading                    | Keep old image visible and selected. Busy state lives on the chosen media card and target image controls. Close only after decode and document commit.            |
| Replace decode failure             | Keep old source and document untouched. Show “{name} could not be used as an image” with Retry and Choose another.                                                |
| Existing source missing            | Keep frame, stack position, and bindings. Show an explicit unavailable placeholder plus Locate replacement, Choose from Media, and Remove layer.                  |
| Canvas adapter import/sync failure | Replace “Preparing canvas…” with a retryable error after failure. Inspector remains readable; image mutation controls are disabled.                               |
| Source changes during crop         | Cancel the draft, keep the last committed placement, then reconcile the new source. Never apply a transform measured against stale natural dimensions.            |
| Page/selection change during crop  | Apply a valid changed draft once before navigation; unchanged sessions close without history.                                                                     |
| Review becomes pending             | Cancel any uncommitted image session before locking mutations. Do not commit on behalf of a transition into read-only state.                                      |
| Duplicate activation               | Disable Crop/Replace/Done while the same transition is pending. A double-click or repeated Enter produces one session or transaction.                             |
| Stale managed asset                | Reuse the media dialog's exact-source recheck. If the chosen revision changed, keep the dialog open and explain which asset needs reselection.                    |

## Responsive behavior

### Desktop

- Contextual image actions appear above the canvas or near the selected frame without covering content. The right inspector keeps precision controls.
- The crop bar remains fixed in screen space. It may relocate when it would obscure the active frame.
- Only the canvas viewport scrolls/pans the work area. Inspector scrolling does not move the crop bar or page strip.

### Compact and high zoom

- The current inspector sheet makes the main editor inert (`apps/studio/src/features/studio-shell.tsx:893-903,1637-1766`). Entering crop from that sheet must close it before enabling the canvas.
- Use a non-modal bottom crop bar with safe-area padding, horizontal overflow only inside the action row, and a 44 px minimum target. Keep **Cancel** and **Done** fixed and visible.
- The bar chooses top or bottom placement based on the selected frame's screen bounds. It never covers more than 25% of the usable canvas height.
- At 320 px width and 200% browser zoom, no required action is lost. Secondary actions may move into More, but Crop, Replace, Fit/Fill, Cancel, and Done remain reachable.
- Opening crop must not summon the software keyboard. Numeric input appears only after the user explicitly focuses a field.
- Screen-space outlines, dimming, crop handles, and hit targets remain stable across camera zoom from the supported minimum through maximum.

## Command and capability contract

Minimum registered commands:

```text
image.insert
image.replace
image.crop
image.crop.apply
image.crop.cancel
image.fit
image.fill
image.flip-horizontal
image.flip-vertical
image.rotate-left
image.rotate-right
image.reset-placement
image.frame.rectangle
image.frame.rounded-rectangle
image.frame.ellipse
```

Minimum derived capability context:

```text
singleImageSelected
allSelectedNodesAreImages
allSelectedImagesEditable
selectedImageSourceReady
selectedImageSourceMissing
imageEditMode
imageEditDraftChanged
reviewPending
selectionLocked
```

Every action surface invokes these commands. Command enablement owns review, lock, selection-count, source-readiness, and edit-mode rules. The context bar, inspector, menu, keyboard, WebMCP action, and future command palette may vary presentation, but not semantics.

## History and persistence contract

- Crop state has `baseline`, `draft`, `status`, and target document/page/node identity outside canonical history while the gesture is active.
- Pointer move, slider input, pinch, flip, rotate, and mask preview update only the draft and renderer.
- Apply diffs baseline versus draft and commits one `update_node` command with label **Crop image**. No diff means no command.
- Cancel discards the draft and emits no command, dirty state, autosave, or collaboration event.
- Fit, Fill, Flip, Rotate, Reset, Replace, and Change frame invoked outside crop each create one named transaction.
- Multi-image Fit/Fill/Flip creates one batch transaction across all editable selected images.
- Undo/redo restores source, placement, frame mask, and alt text exactly. No object URL or Fabric runtime identity enters history.
- Autosave and API revisioning see only applied state. They never serialize an in-progress draft.
- Export and publish either wait for an applying transaction to finish or use the last committed snapshot. They never capture half a gesture.

## Exact acceptance tests

No ASSET-02 item is complete on visual inspection alone. The following checks are release gates.

### Document schema and migration

1. Parse defaults for a new image and assert centered Fill, zoom 1, zero inner rotation, no flips, rectangle frame.
2. Reject non-finite focal values, zoom below 1, invalid mask radius, unknown mask kind, and incoherent managed asset identity.
3. Migrate legacy Cover and Contain fixtures. Assert the pre-migration and post-migration render projections are pixel-equivalent within one rendered pixel.
4. Serialize, parse, and serialize every placement/mask combination. Assert deep equality and stable schema version.
5. Apply image patch commands through the public document command path. Assert API/WebMCP validation matches direct document validation.

### Projection and renderer conformance

6. Fixture matrix: landscape, portrait, and square sources into landscape, portrait, and square frames for Fit, Fill, and Manual.
7. For each matrix entry, test focal corners, zoom 1 and 2.5, rotations 0/90/33 degrees, both flips, and all three frame masks.
8. Compare Fabric, React render view, PNG/export renderer, and published/API render projection against one canonical expected geometry. Tolerance is at most one output pixel at 1x and 2x.
9. Assert no NaN, negative source dimension, empty-frame leak in Fill/Manual-cover mode, or source sampling outside natural bounds.
10. Assert Replace with a different source aspect ratio preserves placement values, clamps legally, and remains deterministic after reload.

### Adapter and edit-session unit tests

11. Double-click image emits crop entry for the correct node. Double-click text still enters text editing. Double-click empty canvas still emits camera zoom.
12. Starting crop hides frame transforms, fixes the frame, and makes content drag/scale/rotate update only draft placement.
13. Pointer move emits no canonical `onNodesChange`. Apply emits exactly one patch. Cancel emits none.
14. Pointer capture survives leaving the frame and releases on up, cancel, unmount, page change, and source invalidation.
15. Source decode failure creates the explicit unavailable state and disables crop without changing geometry.
16. Sync rejection leaves the adapter recoverable and does not leave `syncing` or Preparing state permanently active.
17. Screen-space handle hit areas stay within the specified pixel range at minimum, 25%, 100%, 200%, and maximum camera zoom.

### History transaction tests

18. A crop containing 50 drag updates, 20 scale updates, two flips, and a mask change commits one entry labeled **Crop image**.
19. Cancel after the same sequence leaves snapshot ID, operation version, history depth, and document identity unchanged.
20. Apply followed by Undo restores the exact baseline; Redo restores the exact draft.
21. Replace commits once and Undo restores source, alt, placement, mask, and selection target.
22. Multi-image Fit/Fill/Flip commits one batch and skips locked nodes according to the visible capability contract.

### Inspector and command tests

23. One editable image enables Crop, Replace, Fit/Fill, flip, rotation, mask, and reset as appropriate.
24. Locked image, pending review, missing source, mixed selection, multi-image selection, and no selection each expose the exact enabled/disabled command set.
25. Inspector controls invoke registered command IDs; no image-specific shell-only handler or duplicate shortcut metadata exists.
26. Frame rotation and Image rotation have distinct labels and patch different fields.
27. Slider input previews continuously and commits once at interaction end. Keyboard changes commit with the same semantics.
28. Reset is disabled at defaults and preserves every non-placement property.

### Media handoff tests

29. Add from Recent, Uploads, Library, and a fresh upload places one selected node at visible-page center and creates one **Add image** history entry.
30. Replace from every collection keeps the old image visible until successful decode and preserves the documented properties.
31. Cancel, decode failure, stale managed revision, page change, target deletion, and review lock during Replace leave the document unchanged and keep a local recovery action visible.
32. User-authored alt text survives replacement; unchanged asset-default alt text adopts the new default.

### Desktop interaction journeys

33. Keyboard-only: add image, select it, enter crop, reposition with arrows, change scale, flip, apply, undo, redo, replace, and return focus to the opener.
34. Pointer: double-click image, drag content without moving frame, resize frame without jumping content, scale around focal point, cancel, repeat, and apply.
35. Camera arbitration: trackpad pinch and wheel zoom only the editor camera, never browser chrome; crop-content zoom occurs only through the defined content gesture/control. Page coordinates under the cursor remain anchored.
36. Selection/page changes apply a changed crop once; Escape cancels; repeated Enter/double-click creates no duplicate transaction.
37. Missing source and canvas-sync failure show actionable inline states with Retry or Locate replacement.

### Compact, touch, and browser zoom journeys

38. At 320 px width, enter crop from inspector sheet. Assert the sheet closes, main is no longer inert, crop bar is visible, and no required action overflows the viewport.
39. One-finger reposition and two-finger content scale work inside the frame. A gesture outside the frame controls the camera. No pointer gets stuck after cancel or orientation change.
40. At 200% browser zoom and at minimum/maximum editor camera zoom, Crop, Replace, Cancel, Done, Fit/Fill, and More remain reachable with 44 px targets and no horizontal page overflow.
41. Opening crop does not invoke the software keyboard. Explicit numeric focus does, and Done remains reachable after it closes.

### Accessibility journeys

42. Screen reader announces image selection, Crop mode entry, Replace busy/success/failure, missing source, and mode exit once each without pointer-move chatter.
43. Full image workflow is operable without pointer or drag. Focus is visible, never trapped on canvas, never falls behind Media, and returns to the exact opener.
44. Canvas has application instructions and an escape route. Inspector exposes numeric alternatives for focal point, scale, image rotation, flip state, and frame mask.
45. Automated accessibility scan finds no missing accessible names, nested interactive controls, invalid ARIA, focusable inert content, or contrast regression in selection/crop states.

### Performance and resilience

46. Entering crop on an already decoded image is visually ready within one animation frame. Pointer interaction sustains the product's 60 fps target on a representative laptop document.
47. Drag/scale updates do not rerender the Studio shell or serialize the document per frame. Only the renderer and crop bar read the live draft.
48. Repeated enter/cancel, source replacement, page switching, and unmount release image listeners, object URLs, pointer capture, and temporary Fabric objects.
49. A 20-page document with image-heavy pages keeps camera, selection, crop entry, page switch, and Undo responsive; off-page sources are not all decoded at crop entry.
50. Export during crop uses the last committed state or waits for Apply according to one documented rule, never an intermediate frame.

## Definition of done

ASSET-02 is done only when:

- The document model can represent every visible image edit without renderer-private state.
- Fabric, render view, export, publish, API, and WebMCP pass the conformance matrix.
- Crop is directly manipulable, cancellable, and one-step undoable.
- The image context bar and inspector expose the complete common workflow with centralized commands and capabilities.
- Replacement is atomic and preserves the documented frame, placement, mask, and accessibility data.
- Desktop, keyboard, touch, compact, 200% browser zoom, missing-source, decode-failure, and review-lock journeys pass.
- No P0 or P1 row in this document remains open or is dismissed as polish.

## Recommended implementation order

1. Add schema, migration, projection math, and renderer-conformance fixtures.
2. Add centralized image commands, capabilities, and named history policies.
3. Build a renderer-neutral crop-session controller with baseline/draft/apply/cancel semantics.
4. Teach Fabric to render and manipulate the draft, including screen-space controls and source failure.
5. Add context bar and inspector controls, then wire the existing Media replace flow into the same command path.
6. Add frame masks and inner flip/rotation after plain crop parity is green.
7. Build compact crop bar and touch arbitration.
8. Run every acceptance layer in order: schema/projection, adapter/history, inspector/commands, media handoff, desktop, compact/touch, accessibility, performance, and final renderer parity.

The implementation should not begin from JSX. It should begin with the canonical placement math and transaction boundary; otherwise Studio will look more complete while remaining unable to save, replay, export, or automate the edits it shows.
