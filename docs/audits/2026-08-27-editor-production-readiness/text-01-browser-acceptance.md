# TEXT-01 healthy-browser interaction acceptance

Date: 2026-08-29

Status: interaction browser suite passes and is independently accepted;
cross-renderer pixel conformance remains open

## Boundary revisited

This gate tests the implemented content-first text workflow as a user reaches
it. It does not reopen the accepted sizing schema or create TEXT-02 rich-text
runs. The retained OpenPencil lesson is one explicit edit owner, one baseline,
and one content-plus-derived-geometry commit. Loora reinforces the same typed
command/transaction boundary across human and programmatic entry points.

The browser starts from an empty origin, explicitly opens the labelled
Northstar sample, and uses only the visible UI plus the registered read-only
`inspect_design` surface for canonical identity assertions. Runs target the one
existing Studio server through `PLAYWRIGHT_BASE_URL`; no second server or port
3000 listener is created.

## Defects exposed by the real workflow

### Preset menu focus race

The `T` shortcut correctly inserted Body and entered editing, but choosing a
preset through Add text did not reliably leave Fabric's hidden textarea focused.
The editor entered editing while the Radix menu was still closing; its normal
focus restoration then returned focus to the menu trigger.

Preset selection now stores the exact inserted node as a pending menu edit and
requests Fabric editing only from the menu's close-focus boundary. Closing the
menu without selecting a preset retains normal trigger focus. The direct
shortcut path does not use the pending-menu owner.

### Missing compact preset access

At 390 px the More menu exposed top-level application submenus and one generic
Text command, but not the four promised presets. Compact More now exposes
Heading, Subheading, Body, and Caption directly with the existing 44 px target
contract, and the selected preset uses the same deterministic focus handoff.

### Ambiguous alignment names

Compact Properties exposed both page/object alignment and paragraph alignment
as `Align left`, producing duplicate accessible controls. Paragraph controls
now expose `Align text left`, `Align text center`, and `Align text right`.

## Passing interaction matrix

The retained Playwright specification passes **16/16** on port 3001:

- `T` and all four preset entry points create the documented node and enter
  direct editing.
- Existing-text double click edits; blank-canvas double click changes the camera
  zoom without entering text editing.
- Auto width, Auto height, and Fixed own their documented axes; locked and mixed
  selections remain truthful.
- Horizontal and vertical clipping are reported independently and repaired by
  one undoable command.
- Direct content editing derives geometry in one transaction; Undo restores
  content and geometry exactly; Escape changes neither.
- Review start cancels an uncommitted edit, while selection and page changes
  commit it exactly once before navigation.
- Compact presets and text controls satisfy the 44 px target checks.
- Bulleted and numbered paragraphs continue, indent, outdent, terminate, remove
  markers, and renumber inside the transient Fabric session, then create one
  canonical commit on exit and one-step Undo.

## Retained release evidence

TEXT-01 interaction behavior is browser-accepted. It is not yet cross-renderer
pixel-complete. The checked-in Fabric/React/Renderer PNG/PDF golden corpus must
still run at device scale 1 with embedded Geist and retain comparison artifacts
for line breaks, glyph bounds, clipping, and anti-aliasing. TEXT-02 rich-text
runs, reusable text styles, extended font shaping, and advanced typography stay
outside this gate.

## Independent review

The reviewer inspected the menu-close focus owner, compact/desktop visibility,
canonical command guards, alignment accessibility, existing-server selection,
and all 16 browser assertions. The verdict is **ACCEPT with no P0/P1 finding**.
`text-01-browser-independent-review.md` retains the reviewed paths and final
conclusion.
