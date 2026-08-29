# ASSET-02 desktop browser independent review

Date: 2026-08-29

Final verdict: **ACCEPT — no remaining P0/P1 blocker in the reviewed desktop
browser slice**

## Review method

The reviewer read the actual implementation and tests against the retained
ASSET-02 interaction contract and the OpenPencil/Loora ownership patterns. The
review covered late workspace mounting, native wheel listener options and
cleanup, callback stability, Fabric/workspace pointer arbitration, canonical
tool policy, and whether the browser assertions prove the claimed history and
gesture outcomes.

## Initial rejection

The first pass found one P1 interaction defect. Entering crop while Hand was
already active left workspace panning enabled. Its capture-phase pointer handler
could prevent propagation and capture the pointer before Fabric received the
crop drag. The original browser journey entered crop only under Select, so it
did not exercise the reachable Hand → Crop path.

## Repair reviewed

- `tool.select` and `tool.hand` are disabled by the canonical editor command
  policy whenever `imageCropActive` is true. Shortcuts, direct Studio dispatch,
  visible buttons, product menus, and capability projection now share that
  policy and exact disabled reason.
- Workspace panning returns before `preventDefault`, propagation cancellation,
  or pointer capture while crop owns the interaction.
- The Hand cursor is suppressed during crop without mutating the retained tool,
  so Done or Cancel restores the user's previous Hand state without a second
  tool-state owner.
- The retained browser test activates Hand before Inspector Crop, verifies the
  tool is disabled, drags the crop content, proves camera geometry is unchanged,
  then verifies Hand is re-enabled after Cancel. The existing semantic checks
  still prove preview isolation, one Done transaction, and exact Undo/Redo.

## Final finding

The reviewer found no remaining P0/P1 defect in late-mount subscription,
non-passive capture ownership, listener cleanup, callback stability, crop/tool
arbitration, or the focused desktop browser evidence. Touch, compact zoom,
performance profiling, deployment, and cross-renderer pixels remain explicitly
outside this accepted slice.
