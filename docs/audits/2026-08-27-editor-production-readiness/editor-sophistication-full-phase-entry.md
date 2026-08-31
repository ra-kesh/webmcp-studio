# Full editor sophistication phase entry

Date: 2026-08-31

Status: implemented and locally accepted on isolated branch
`codex/editor-sophistication-wide-20260831`; independent acceptance and
integration remain pending

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

Gate A commit: `4c1cdaacc98175a31f9ef1ea9aae59b9bf0350c0`

## Gate B result

Status: implemented and locally accepted; independent review remains open

Implemented:

- exposed the existing editor panel, muted-panel, hover and floating colors as
  semantic utilities, then applied them to the top bar, both side panels,
  shared panel headers, the page filmstrip and docked/floating canvas controls;
- kept the quotation artboard on its document-owned colors while making the
  editor surround and floating controls resolve through theme-aware tokens;
- added one product-command density contract at the menu composition boundary:
  28 px desktop rows, 44 px compact and coarse-pointer rows, 12 px labels and
  11 px mono shortcuts with normal tracking;
- applied the density contract to command items, checkbox items and submenu
  triggers across the desktop menubar, canvas context menu and responsive More
  menu without changing command IDs, enablement, disabled reasons or dispatch;
- retained existing 44 px compact zoom controls and responsive panel sheets.

Mounted acceptance on isolated port 3102 confirmed:

- desktop geometry remains a 48 px top bar, 40 px canvas context bar, 96 px
  filmstrip and 36 px zoom toolbar with no document overflow;
- the 390 x 820 compact editor keeps both sidebars out of flow, preserves its
  40 px context bar, 88 px filmstrip and 48 px zoom toolbar, and has no document
  overflow;
- desktop More-menu and nested command rows resolve to 28 px with 12 px labels;
  compact rows resolve to 44 px, while descriptive text presets retain their
  deliberate 56 px two-line anatomy;
- at a 1440 px viewport with `(pointer: coarse)` true, product-menu rows remain
  44 px rather than collapsing to desktop density;
- shortcuts resolve to Geist Mono at 11 px with normal letter spacing;
- forced dark mode resolves workspace, panel and floating colors to the named
  dark tokens, keeps the artboard light and redraws ruler chrome after layout;
- with reduced motion enabled, mounted control transition and animation
  durations resolve to `0.00001s`.

Evidence:

- UI typecheck passes;
- Studio typecheck passes;
- 19 focused product-menu, visual-contract, shared panel, Inspector and
  quotation tests pass across six matched files;
- `git diff --check` passes;
- retained captures: `gate-b-desktop-1440x900.png`,
  `gate-b-more-menu-1440x900.png`, `gate-b-compact-390x820.png`,
  `gate-b-compact-menu-390x820.png`,
  `gate-b-coarse-pointer-1440x900.png` and
  `gate-b-dark-reduced-motion-1440x900.png`;
- retained measurements: `gate-b-metrics.json`.

The isolated D1 library-schema limitation from the baseline remains visible in
the Templates panel. This gate did not modify or accept Library behavior, and
no browser storage was cleared.

Gate B commit: `0783b813d71d208aa3132b2614563cb7727203b8`

## Local closure review

No P0 or P1 visual, interaction or code findings remain in the two gate
commits. This is a local closure review, not the independent Gate C acceptance
defined above.

### Motion review

| Before                                                       | After                                                                                                             | Why                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shared buttons, toggles and badges used `transition-all`.    | Buttons and toggles transition only color, background, border, shadow and transform for 150 ms on a strong curve. | Bounds work to intentional properties and stays inside the 100-160 ms press-feedback range. |
| Badge feedback could transition layout-affecting properties. | Badges transition only color, background, border and shadow for 150 ms.                                           | Preserves quiet status feedback without layout motion.                                      |
| Reduced-motion behavior was only source-inspected.           | Mounted controls resolve animation and transition durations to `0.00001s` when reduction is requested.            | Confirms the retained accessibility override wins over component motion.                    |

Motion verdict: pass for this phase. Command execution and keyboard command
paths remain immediate; the gate adds no keyframe, stagger, spring or
layout-property animation.

### Verification and integration state

- both exact gate commits are descendants of dispatched base
  `6265561ab4c9aa70c7489c2a90b3dcac6c1179d3`;
- UI and Studio typechecks pass;
- the final focused run passes 19 tests across six files;
- targeted lint passes for every changed Studio file except
  `inspector-sidebar.tsx`, whose seven reported rules already fail at the exact
  dispatched base; the changed UI files pass targeted lint;
- `git diff --check 6265561..HEAD` passes;
- read-only comparison against main
  `cee0f77587440a5ef349a1ea191b5f6d15048baa` finds no overlapping changed
  paths and the merge-tree reports no conflict;
- the original main checkout and its known untracked capture directories were
  not modified;
- implementation: complete; local acceptance: complete; independent
  acceptance: pending; committed: complete; merged: no.
