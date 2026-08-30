# Inspector core workflow reacceptance

Date: 2026-08-30

Status: active; prior broad inspector/polish acceptance is withdrawn

## Why this gate reopened

A live right-inspector workflow exposed two defects that the earlier audit and
tests missed:

- React Fast Refresh retained an obsolete `StudioShell` hook order while the
  editor hook changed, then crashed on the next interaction with `Cannot read
properties of null (reading '1')` inside React's `updateMemo`.
- text content, text color and rectangle Fill were gated by
  `canFlipImage`. That image-only capability is false for every text and shape
  layer, so ordinary non-image controls were disabled even when the layer was
  editable.

The previous status confused architectural coverage with product acceptance.
A schema, command or inspector section existing in code does not prove that a
person can use it.

## Reference rules retained for the repair

- OpenPencil's selection model derives property availability from the selected
  layer and edit state. An unrelated image capability must never disable text
  or shape properties.
- Loora routes human and agent changes through the same validated transaction
  engine. Inspector changes must commit canonical commands, appear in history,
  save, reload and render through the same document.
- Figma and Canva keep basic appearance controls direct and forgiving. A bad
  draft stays local with an inline error; it cannot crash or freeze the editor.
- The inspector must accept the document model's complete safe CSS color
  contract, not a private six-digit-hex subset.

## Required live matrix

Every row must pass on a cold port-3001 page. Each mutable control must change
the canvas, advance one named history step, save, survive reload, undo and redo,
and leave no console or error-boundary failure.

| Selection                           | Required inspector workflow                                                                 | Status                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Nothing selected                    | truthful empty state; no stale controls                                                     | Live pass                                           |
| Locked layer                        | properties disabled; visibility and unlock available                                        | Live pass                                           |
| Text                                | content, sizing mode, typography, text color, paragraph and link controls                   | Live mutation, save, undo and restore pass          |
| Rectangle                           | Fill, Stroke, radius and stroke width                                                       | Live mutation, validation, save, reload and undo pass |
| Ellipse and icon                    | Fill, Stroke and stroke width                                                               | Live pass with temporary layers removed             |
| Line                                | Stroke and stroke width                                                                     | Live pass with temporary layer removed              |
| Image                               | placement, focal point, zoom, inner rotation, flip, frame, alt/decorative, crop and replace | Live pass with temporary asset layer removed        |
| Multi-selection                     | mixed values, geometry, align/distribute, visibility, lock, order and delete                | Live pass with temporary layers removed             |
| Reusable style or variable attached | clear attachment state, propagation, detach-on-direct-edit and protected delete             | Pending with TEXT-02 Gate 4                         |
| Invalid/intermediate draft          | inline error, canonical value preserved, Escape cancels                                     | Live pass                                           |

## Repair already proven

- Non-image content/color/Fill controls now use the layer mutation state rather
  than `canFlipImage`.
- `StudioShell` opts into a full Fast Refresh reset so an editor-hook signature
  change cannot leave the running development page with a stale hook list.
- The color control uses the canonical render-safe CSS validator, supports hex
  with alpha, `rgb`/`rgba`, `hsl`/`hsla` and `transparent`, and renders the
  authored value in its swatch. The native picker remains a quick hex input.
- Focused inspector tests pass 11/11 and Studio typecheck passes under the
  repository's Node 22 runtime.
- A cold live page changed rectangle Fill and Stroke, saved through revision 24,
  emitted no runtime errors, and undid back to revision 22. A separate live
  change accepted `rgb(31 41 55 / 80%)`, saved it, and undid it cleanly.
- A second clean browser profile exercised text, ellipse, line, icon, image and
  multi-selection controls. Image focus, zoom, inner rotation, flip, frame,
  fit, crop cancellation, replacement dialog and alternative text remained
  interactive; temporary test layers were deleted afterwards.
- Invalid color and negative-width drafts stayed local, showed inline errors,
  did not advance the document revision and restored the canonical values on
  Escape.
- Rectangle Fill persisted after a cold reload once the field commit and
  autosave completed. The sample's original `#2F493C` Fill and locked state
  were restored after the check.

## Completion rule

Do not restore `EDITOR-POLISH-01` or the inspector to completed status until the
full matrix passes in the running editor. Static tests protect the discovered
capability and color-contract regressions but do not replace that browser gate.
