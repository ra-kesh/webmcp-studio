# Editor interaction model

The studio is a page-layout editor, not a general whiteboard. Its viewport still
uses the interaction conventions people already know from Figma, Penpot, Canva,
and infinite-canvas tools such as tldraw.

OpenPencil is the standing quality reference for this interaction model. See
[OpenPencil editor north star](./openpencil-editor-north-star.md) for the
adopted patterns and deliberate product-specific departures.

## Non-negotiable behavior

- The viewport owns an explicit camera: page-space content never changes when
  the camera pans or zooms.
- Zoom preserves the page point under the cursor. Controls and selection
  feedback remain readable in screen space.
- A selected layer is always locatable. Selection has a high-contrast outline,
  stable handles, a canvas label, a selected Layers row, and an inspector state.
- A single Layers click selects and reveals an offscreen object. Double-clicking
  a Layers row focuses that object.
- Layer identity and rendered content are separate concepts. Renaming a layer
  changes its editor identity; editing Content changes what appears on the page.
- Direct manipulation, panel editing, keyboard commands, and programmatic API
  edits all update the same canonical document nodes.

## Input map

| Input                                                 | Behavior                          |
| ----------------------------------------------------- | --------------------------------- |
| Trackpad or mouse wheel                               | Pan in x/y                        |
| `Shift` + vertical mouse wheel                        | Pan horizontally                  |
| Trackpad pinch or `Cmd/Ctrl` + wheel                  | Zoom toward the pointer           |
| Space + drag, Hand tool + drag, or middle-button drag | Pan freely                        |
| Double-click empty canvas                             | Zoom in toward the pointer        |
| Double-click text                                     | Enter Fabric text editing         |
| Single-click a Layers row                             | Select and reveal if offscreen    |
| Double-click a Layers row                             | Zoom to that layer                |
| `Shift+1`                                             | Fit page                          |
| `Shift+2`                                             | Zoom to selection                 |
| `Cmd/Ctrl` + `+` or `-`                               | Zoom in or out                    |
| `Cmd/Ctrl+0`                                          | Reset to 100%                     |
| Arrow keys with a selection                           | Nudge by 1; Shift nudges by 10    |
| Arrow keys without a selection                        | Pan by 40; Shift pans by 120      |
| Drag a resize handle + `Shift`                        | Preserve pointer-down proportions |
| Drag a resize handle + `Alt` / `Option`               | Resize from the center            |
