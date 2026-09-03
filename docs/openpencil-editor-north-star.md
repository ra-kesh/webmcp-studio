# OpenPencil editor north star

OpenPencil is the primary reference for interaction quality and editor polish.
It is not the product model or a codebase to embed. This studio remains a
quotation-driven, API-controllable document system rather than a general Figma
clone.

Reference snapshot:

- Repository: <https://github.com/open-pencil/open-pencil>
- Local shallow clone:
  `outputs/reference-repos/editors/open-pencil` in the challenge research
  workspace
- Inspected commit: `88c107707132`
- License: MIT

## What “north star” means

Every editor change should be compared against OpenPencil for:

1. Immediate feedback: a click, drag, gesture, or shortcut produces an
   unambiguous visual response.
2. Stable geometry: selection borders, handles, labels, rulers, and chrome stay
   legible regardless of camera zoom.
3. Input fluency: trackpad, mouse, touch, and keyboard paths act on the same
   camera and command model.
4. Compact consistency: panel rows, fields, icons, hover states, and active
   states use a small shared set of metrics and tokens.
5. One operation model: UI, keyboard commands, API calls, and WebMCP tools invoke
   the same editor actions and document mutations.
6. Verifiable craft: interaction math has unit tests; important canvas behavior
   has browser tests and visual snapshots.

## Patterns adopted now

### Viewport input

- Own an explicit `{ x, y, zoom }` camera outside the document.
- Attach native non-passive wheel and Safari gesture listeners to the viewport.
- Interpret `Ctrl`/`Meta` + wheel as cursor-anchored zoom.
- Preserve two-dimensional trackpad panning and map `Shift` + vertical wheel to
  horizontal pan.
- Coalesce dense wheel input to one camera update per animation frame.
- Keep browser zoom out of the canvas gesture path.

Reference files:

- `packages/vue/src/shared/input/wheel.ts`
- `packages/vue/src/shared/input/gesture.ts`
- `packages/vue/src/shared/input/pan-zoom.ts`
- `tests/e2e/viewport/zoom-pan.spec.ts`

### Editor architecture

- Keep viewport, selection, document mutation, history, clipboard, and tool
  behavior in explicit action domains rather than UI components.
- Route every selection mutation and tool change through one canonical action so
  the canvas, panels, history, API, and agent surface cannot diverge.
- Separate repaint-only camera state from document-change state.
- Keep renderer and editor behavior testable without the application shell.

Reference files:

- `packages/core/src/editor/create.ts`
- `packages/core/src/editor/viewport.ts`
- `packages/core/src/editor/selection/`
- `packages/core/src/editor/types.ts`

### UI craft

- Use a neutral editor shell; reserve accent color for selection, focus, and the
  active tool.
- Use compact 24–32 px controls, 11–12 px labels, one icon scale, and tabular
  numerals for geometry.
- Give hover, selected, disabled, locked, hidden, and editing states distinct but
  quiet treatments.
- Keep panel sections and fields structurally consistent instead of composing
  one-off rows.
- Render tooltips and shortcuts from shared command metadata.
- Use splitters for adjustable workspace panels and preserve minimum useful
  canvas space.

Reference files:

- `src/theme/toolbar.ts`
- `src/theme/panel/`
- `src/theme/layer-tree.ts`
- `src/theme/number-field.ts`
- `src/components/Toolbar/`
- `src/components/PropertiesPanel.vue`
- `src/components/LayersPanel.vue`

## Product-specific departures

- Templates stay in the left workflow panel; pages stay in the bottom filmstrip.
- Quotation data remains source-controlled. Changing templates changes the
  visual system, not commercial content.
- The document schema must support deterministic multi-page composition and the
  external quotation contract.
- API rendering, field binding, revisions, review, and agent change sets are
  first-class product capabilities, not add-ons to a generic canvas.
- We use React, TanStack Start, Fabric, and Cloudflare Workers; OpenPencil's Vue,
  CanvasKit, Yoga, and Tauri choices are references, not migration targets.

## Review gate for editor work

Before calling an editor slice complete, verify:

- Pointer, keyboard, trackpad, and panel paths agree.
- The selected object is visibly identifiable on the canvas.
- Camera changes never mutate document coordinates.
- Zoom stays anchored to the user's point of intent.
- No browser-native gesture escapes the editor boundary.
- Controls share the established metrics and semantic states.
- Dense input does not cause visible frame drops or state floods.
- Unit tests cover geometry and input normalization.
- A real-browser interaction test covers the user-facing flow.
- A visual comparison is captured for materially changed editor chrome.
