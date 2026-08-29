# ASSET-02 desktop browser acceptance phase entry

Date: 2026-08-29

Status: desktop browser boundary implemented, exercised, and independently
accepted

## Boundary

Close the retained real-browser evidence gap for the existing ASSET-02 image
crop implementation without reopening its accepted document model or affine
projection. This slice covers the desktop pointer and keyboard contract. Touch,
compact layout, performance profiling, pixel conformance, and deployed renderer
evidence remain separate gates until directly exercised.

## Evidence reread

- `asset-02-domain-render-contract.md`, `asset-02-editor-ux-contract.md`,
  `asset-02-independent-implementation-review.md`, and the ASSET-02 sections in
  `remediation-progress.md`.
- OpenPencil's image fill transform and mask renderer, plus its gesture/wheel
  scheduling pattern: canonical image intent is projected centrally; transient
  pointer state stays outside history; one semantic commit closes the gesture.
- Loora's canvas input owner: native non-passive wheel cancellation is scoped to
  the canvas, pointer-centred camera math owns trackpad zoom, and touch/pointer
  capture has one explicit state owner.
- Studio's current crop session, preview store, Fabric adapter, crop toolbar,
  command capability projection, inspector draft projection, and mounted crop
  regressions.

## Desktop acceptance contract

- Insert a reusable image through the real media library and enter crop from the
  Inspector as well as by image double-click.
- Crop mode exposes its named toolbar and instructions, hides the ordinary
  camera bar, keeps the outer frame canonical, and holds preview changes outside
  the saved document.
- Pointer pan after image zoom changes the crop draft. Cancel restores the exact
  document identity and focus; Done creates one revision/operation and one Undo
  restores the exact baseline while Redo restores the crop.
- Modifier-wheel over the canvas remains camera-owned during crop and does not
  change image zoom or browser page scale.
- The retained Playwright regression must use the public UI and live WebMCP
  inspection surface. It must not call the crop session or history domain
  functions directly.

## Browser defect found and repaired

The existing gesture hook read `workspaceRef.current` once while Studio was
still rendering the start or verified-route loading surface. That read was
`null`; when the real workspace mounted later, none of the native wheel,
Safari-gesture, or two-touch listeners were installed. Browser zoom therefore
remained the owner of a trackpad pinch even though the gesture math itself was
correct.

Studio now tracks the mounted workspace element explicitly. The navigation
hook subscribes when that exact element becomes available and cleans up when it
is replaced or unmounted. Its native wheel listener is non-passive and captures
at the workspace boundary, before Fabric's upper canvas can stop propagation.
The camera remains the one semantic wheel owner; the handler keeps the existing
pointer-centred projection and one-frame accumulation.

A mounted regression recreates the actual lifecycle: the hook first renders
behind a start surface with no workspace, the workspace mounts later, and a
modifier-wheel dispatched from its Fabric child is cancelled at the editor
boundary.

The first independent review then found a separate reachable ownership defect:
if Hand was active before crop entry, workspace capture-phase panning could
claim the pointer before Fabric's crop handler. Crop is now the modal pointer
owner. Canonical command policy disables Select and Hand until Done or Cancel,
workspace panning returns before claiming the pointer, and the Hand cursor is
suppressed without overwriting the retained tool. Exiting crop therefore
restores the user's earlier Hand state naturally. The repaired review verdict
is **ACCEPT with no remaining P0/P1 blocker**.

## Desktop browser evidence

The retained browser journey starts from an empty browser profile and creates a
blank document through the real start surface. It inserts `Sandstone arches`
through the visible media library, uses the mounted Fabric canvas and Inspector,
and reads document identity only through the registered `inspect_design` WebMCP
tool.

- Inspector crop shows the named crop toolbar and instructions and hides the
  ordinary camera zoom bar.
- Zoom plus pointer pan remains preview-only. Cancel preserves exact revision,
  snapshot, and operation identity and returns focus to the Crop opener.
- Done increments revision and operation version exactly once. Undo restores
  the exact baseline snapshot and image node; Redo restores the exact applied
  snapshot and placement.
- Image double-click enters crop. A cancellable modifier-wheel originating on
  the actual Fabric upper canvas is prevented by the workspace owner, changes
  the artboard camera scale, and leaves the image crop zoom unchanged.
- The formerly failing Hand → Inspector Crop → drag path disables tool changes,
  leaves camera geometry unchanged during the crop drag, changes the crop draft,
  and re-enables the retained Hand tool after Cancel.

Focused evidence on 2026-08-29:

- Mounted gesture unit slice: **6/6** across two files.
- Focused canonical editor-command slice: **24/24**.
- Production crop browser slice: **2/2** through the public UI and live WebMCP
  inspection surface.
- Studio and editor typechecks, scoped Studio ESLint, the production Studio
  build, and `git diff --check` pass.

## Retained boundary

This closes the desktop pointer/keyboard acceptance slice only. It does not
claim the still-unrun touch-device arbitration, compact 320 px / 200 percent
zoom placement, real Chrome performance profile, deployed renderer journey, or
the 1x/2x cross-renderer pixel corpus.
