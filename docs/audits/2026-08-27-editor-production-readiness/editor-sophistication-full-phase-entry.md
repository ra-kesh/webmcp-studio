# Full editor sophistication phase entry

Date: 2026-08-31

Status: active on isolated branch `codex/editor-sophistication-wide-20260831`

Exact base: `6265561ab4c9aa70c7489c2a90b3dcac6c1179d3`

## Boundary

This phase owns the editor-wide visual and interaction refinement that remains
after accepted `EDITOR-POLISH-01` Gates 1-7. It may consolidate editor recipes,
raise the remaining chrome typography floor, tune panel and canvas hierarchy,
and verify compact, dark, coarse-pointer and reduced-motion states.

It does not change document commands, history semantics, masks, library
architecture, generation, persistence ownership or renderer output.

## Fresh comparison

The current Studio was inspected in a real Chrome session at 1440 x 900 and
390 x 820 on isolated port 3102. The comparison reread the checked-out
OpenPencil toolbar, control, layer-tree, number-field, page-list, dialog and
workspace implementations; Loora's canvas and command menus; the checked-out
Canva-style editor's workflow rail, toolbar, template panel and zoom footer;
and Studio's Geist/shadcn decision records.

| Current Studio                                                                                                                                                                     | Reference signal                                                                                                                                   | Decision for this phase                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shell geometry, resizable panels, compact sheets and canvas ownership are already stronger than the old audit baseline.                                                            | OpenPencil keeps a 24/28/32 px control scale, 11 px panel text and persistent split ownership.                                                     | Preserve Studio geometry and commands. Do not reopen accepted shell behavior.                                |
| Shared editor recipes cover tabs, section headers and primary empty states, but many Inspector and secondary workflow labels still render at 9-10 px.                              | OpenPencil uses 11 px for tree rows, number fields, panel labels and canvas headers.                                                               | Enforce an 11 px product-chrome floor, excluding document artwork.                                           |
| Product menus inherit generic 14 px shadcn item anatomy and visually outweigh 11-12 px panel chrome.                                                                               | OpenPencil and Loora use compact menus with quiet shortcuts and live disabled state.                                                               | Add an editor-density recipe at the product-menu composition boundary. Keep command projection unchanged.    |
| Light mode is coherent but flat across top bar, panels and popovers. Dark tokens render the side panels, but `workspace` has no dark override, so the canvas surround stays light. | Geist/Vercel uses close neutral steps and restrained elevation. OpenPencil keeps artwork separate from a darker editor surround.                   | Add named editor surfaces and a dark workspace token. Never alter stored document colors.                    |
| Compact mode keeps the canvas visible and all actions reachable. The top bar and bottom sheet still need matrix evidence after typography and surface changes.                     | Canva's useful pattern is explicit workflow naming and large coarse-pointer targets. Its 68 px bars and one-off sidebars are too large for Studio. | Keep Studio's 48 px top bar and 44 px compact targets; use Canva only as a discoverability check.            |
| Frequent toolbar actions are already immediate. Shared button and toggle primitives still declare `transition-all`.                                                                | The retained motion standard blocks unbounded transitions and motion on high-frequency command activation.                                         | Limit transitions to color, border, shadow and transform. Keep command palette and keyboard actions instant. |

## Mounted baseline

The retained baseline lives under
`artifacts/editor-sophistication-full/` and includes desktop, compact, selected
Inspector, More menu and forced-dark captures plus measured geometry.

| Surface             |                                                  Baseline measurement |
| ------------------- | --------------------------------------------------------------------: |
| Top bar             |                                                                 48 px |
| Left panel          |                                                                208 px |
| Canvas viewport     |                                                          928 x 716 px |
| Right panel         |                                                                280 px |
| Compact viewport    |                                    390 x 820 px, no document overflow |
| Mounted chrome text | seven 10 px leaves, seven 11 px leaves in the initial Templates state |

The isolated local D1 instance did not contain the library preference/catalog
schema, so the Templates surface correctly showed its retained error and retry
states. Six request failures are recorded in `before-metrics.json`. They are an
environment fixture limitation, not a visual acceptance pass for the library.
No storage was cleared.

## Planned gates

### Gate A: typography, surfaces and feedback recipes

- enforce the 11 px editor-chrome minimum across Inspector and secondary
  editor workflow labels;
- add semantic editor surface and feedback recipes instead of more one-off
  bordered messages;
- correct dark workspace separation;
- remove unbounded shared-control transitions;
- retain focused component and mounted evidence, then commit.

### Gate B: menus, panels, canvas and compact matrix

- apply one compact product-menu anatomy without changing command state;
- refine top-bar, panel and floating-canvas separation with the shared tokens;
- verify desktop, compact, forced-dark, coarse-pointer and reduced-motion
  compositions;
- retain before/after captures and focused interaction evidence, then commit.

### Gate C: independent closure

- run a separate code and visual review against the exact gate commits;
- resolve every P0/P1 finding;
- update this checkpoint with exact checks, captures and verdict;
- report implementation, acceptance, commit and merge states separately.

## Gate A result

Status: implemented and locally accepted; independent review remains open

Implemented:

- raised every product-chrome leaf under the editor feature set and Studio
  shell to at least 11 px, including Inspector metadata, review provenance,
  compact component actions, page/output labels and dialog metadata;
- replaced the remaining tiny all-caps Inspector and component headings with
  sentence-case 11 px labels;
- introduced `EditorPanelNotice` for compact neutral, warning and error
  feedback with one icon, title, description and recovery-action anatomy;
- migrated quotation organization, locked-layer, partially locked selection
  and managed text-size explanations to the shared notice;
- added a dark `workspace` token so light document artwork remains distinct
  from dark editor chrome without changing any document color;
- replaced `transition-all` on shared buttons, toggles and badges with bounded
  color, border, shadow and transform transitions using the retained strong
  ease-out curve;
- added a source-level visual contract that rejects sub-11 px product chrome,
  a missing dark workspace override or unbounded shared-control transitions.

Mounted acceptance on isolated port 3102 confirmed:

- a selected 9-layer Inspector remains contained in its 336 px panel with no
  document overflow;
- no mounted text leaf in the selected desktop editor renders below 11 px;
- the forced-dark workspace resolves to `oklch(0.19 0.006 90)` and clearly
  separates the light quotation artboard;
- the browser reported no page errors during the selected Inspector captures.

Evidence:

- UI typecheck passes;
- Studio typecheck passes;
- 16 focused visual-contract, panel-notice, Inspector and quotation tests pass;
- retained captures: `gate-a-inspector-1440x900.png` and
  `gate-a-dark-1440x900.png`;
- retained measurements: `gate-a-metrics.json`.
