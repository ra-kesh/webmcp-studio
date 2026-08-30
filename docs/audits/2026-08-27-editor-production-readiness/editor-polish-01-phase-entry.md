# EDITOR-POLISH-01 phase entry

Date: 2026-08-30

Status: active; Gates 1-6 accepted locally

## Purpose

Close the gap between a functionally complete editor and an editor that feels
deliberate, dense, and trustworthy in daily use. This phase does not replace
Studio's document, command, persistence, or renderer architecture. It gives the
existing product one measured visual and interaction system.

## Sources revisited before implementation

- `visual-and-interaction-audit.md`
- `remaining-product-work-2026-08-29.md`, row `EDITOR-POLISH-01`
- OpenPencil `src/theme/control.ts`
- OpenPencil `src/theme/icon-button.ts`
- OpenPencil `src/theme/toolbar.ts`
- OpenPencil `src/theme/canvas-pane-header.ts`
- OpenPencil `src/theme/page-list.ts`
- Studio `packages/ui/src/styles/globals.css`
- Studio `packages/ui/src/components/{button,tabs,editor-chrome}.tsx`
- Studio mounted shell, document panel, Layers tree, and inspector code

OpenPencil is a behavioral and composition reference, not a source-code donor.
Studio keeps its React/Tailwind implementation, Geist typography, quotation
workflow, document model, and renderer-safe command boundary.

## Mounted baseline

The real Studio document was inspected at `1440 x 900` on port `3001`. Port
`3000` was not touched.

Measured baseline:

| Surface                              |                   Baseline |
| ------------------------------------ | -------------------------: |
| Application toolbar                  |                      48 px |
| Left, canvas, and right context bars |                      44 px |
| Desktop toolbar icon controls        |                      28 px |
| Desktop inputs                       |                      32 px |
| Layer rows                           |                      30 px |
| Panel tabs                           | 43 px hit area, 12 px type |
| Inspector section labels             |             10 px all-caps |

Geometry alignment is no longer the primary defect. The defect is that each
region expresses density, type hierarchy, radii, focus, selected, and hover
states independently. The result is usable but visually fragmented.

## Measured system

The editor system uses a small fixed scale:

- controls: 24 / 28 / 32 px;
- panel context bar: 40 px;
- tree/list row: 28 px desktop and 44 px compact/coarse-pointer mode;
- primary panel type: 12 px;
- secondary metadata and property labels: 11 px;
- spacing rhythm: 4 / 8 / 12 / 16 / 24 px;
- compact radius: 5-6 px, with larger radii reserved for cards, dialogs, and
  floating canvas controls;
- visible focus: 2 px internal editor ring without moving geometry;
- active editor accent: one blue semantic token shared by canvas selection,
  tree selection, and contextual status.

## Gate 1 — editor chrome and control anatomy

This first gate is intentionally structural. It must:

1. introduce semantic editor tokens and reusable chrome recipes;
2. make panel tabs meet their bar and share exact geometry;
3. normalize toolbar, panel header, tree row, search, selected, hover, focus,
   disabled, and drag states;
4. make inspector section labels readable at normal desktop density;
5. preserve 44 px compact targets below the desktop shell breakpoint;
6. retain existing commands, keyboard behavior, tree semantics,
   virtualization, responsive drawers, and persisted split layout;
7. pass focused code checks and a mounted `1440 x 900` visual inspection.

## Later gates in the same phase

- left panel content and template/page-card composition;
- inspector section anatomy and contextual property grouping;
- page filmstrip, canvas HUD, rulers, overlays, and floating controls;
- menus, dialogs, empty/error/loading states, and compact sheets;
- final full-width visual matrix and end-to-end use pass.

The phase is not complete when Gate 1 lands. Each later gate must revisit this
entry, the original audit, and the matching OpenPencil reference files before
implementation.

## Gate 1 result

Implemented:

- semantic editor height, spacing, selection, and compact-target tokens;
- one 40 px panel context bar shared by the document, canvas, and inspector;
- line tabs with a full bar hit area, bottom-connected indicator, restrained
  hover state, and a two-pixel focus ring;
- 28 px virtualized desktop Layers rows while preserving 44 px compact rows;
- shared accent treatment for tree selection, keyboard focus, and drop intent;
- a 28 px desktop layer search control and readable 11 px result metadata;
- readable sentence-case 11 px inspector property labels and denser, consistent
  property-section insets;
- compact six-pixel toolbar button anatomy and a clearer 11 px document status
  line.

Mounted acceptance at `1440 x 900` confirmed:

- top toolbar remains exactly 48 px;
- all three context bars are exactly 40 px and share the same baseline;
- both tab groups are 39 px inside the 40 px bar with their active indicator on
  the bottom border;
- expanded hierarchical groups remain visible and keyboard/selection semantics
  still operate;
- selected Layers rows are exactly 28 px;
- the selected layer remains visible on canvas and its inspector values update;
- no horizontal shell overflow appeared.

Focused evidence:

- Studio typecheck passes;
- 35 focused inspector, shell-layout, and splitter tests pass;
- scoped Studio and UI ESLint passes;
- `git diff --check` passes.

## Gate 5C result — compact panel composition

Sources revisited before implementation:

- the `A11Y-01` compact-drawer and `VIS-02` independent-composition findings
  in `visual-and-interaction-audit.md`;
- OpenPencil `EditorWorkspace.vue`, `MobileDrawer.vue`, and `theme/dialog.ts`;
- Studio's shared Sheet primitive, responsive shell matrix, compact panel
  triggers, Quotation sidebar, and Inspector sidebar.

Implemented:

- phone-width document and properties panels now open as a bounded bottom
  workspace sheet instead of a narrow full-height rail;
- 640-1279 px compact layouts retain directional side panels with a wider
  384 px working width, correct inner-edge radius, and panel-specific shadow;
- the phone sheet uses a 78dvh/44rem bound, safe-area padding, a restrained grab
  affordance, and one contained scroll owner so the canvas remains visible as
  context;
- initial focus moves deliberately to the named panel heading, focus stays in
  the modal, and close/Escape returns to the exact opener without scrolling;
- the 44 px close target now fits inside a 56 px sheet header instead of
  overhanging the first tab row;
- the shared overlay has clear modal separation while preserving the existing
  Radix dialog semantics, background inertness, Escape handling, and focus
  trap.

Mounted acceptance confirmed:

- at `390 x 820`, the Document panel is exactly viewport-wide, 639.6 px high,
  bottom anchored, horizontally contained, and leaves visible canvas context;
- its heading owns initial focus and `Create new` remains reachable after
  scrolling;
- at `768 x 820`, Properties remains a 384 px right-side workspace with no
  horizontal overflow and the same calm panel-state hierarchy;
- the complete 320-1920 px responsive action matrix continues to expose every
  required business action.

Focused evidence:

- Studio and UI typechecks plus scoped ESLint pass;
- the compact modal/focus/recovery end-to-end test passes with new bounds,
  heading-focus, and action-reachability assertions;
- the ten-width business-action reachability matrix passes;
- `git diff --check` passes.

## Gate 6 result — duplicate and dead editor UI cleanup

Sources revisited before implementation:

- the `A11Y-02` duplicate-control and decorative-preview findings in
  `visual-and-interaction-audit.md`;
- the retained feature-parity and independent-code audits to distinguish old
  findings from currently mounted surfaces;
- Studio's editor import controls, start surface, media library, local-media
  recovery, filmstrip, and mounted accessibility projection.

Implemented:

- all programmatically triggered document, quotation, media-upload, and
  locate-replacement file inputs are now truly hidden implementation controls;
- the user-facing Import, Upload, Locate, and Replace buttons remain the only
  announced controls and continue to own the file chooser action;
- page-filmstrip preview artboards are explicitly decorative; the named page
  selector remains the accessible page-navigation object;
- removed an unused recent-documents test wrapper and an unused media-library
  label export instead of preserving orphaned scaffolding;
- retained intentional parallel command placements, such as toolbar, menu,
  keyboard, and WebMCP access, because those are capability projections rather
  than duplicate ownership.

Mounted acceptance confirmed:

- the live editor's two anonymous `Choose File` buttons dropped to zero while
  Publish and the interactive canvas kept one canonical accessible control;
- File → Import document JSON still raises the native file chooser against the
  hidden single-file input;
- the responsive 320-1920 px action matrix and compact modal journey remain
  green.

Focused evidence:

- 46 focused start-surface, filmstrip, and media-promotion tests pass;
- Studio typecheck and scoped ESLint pass;
- the two focused responsive end-to-end journeys pass;
- direct browser file-chooser evidence reports `multiple: false`, zero
  `Choose File` controls, and two hidden editor import inputs;
- `git diff --check` passes.

## Gate 2 result — document-panel composition

Implemented:

- template previews now use the editor's restrained workspace surface, compact
  radii, and 128 px preview stage instead of heavy 160 px cards;
- selected and applied templates use the shared editor accent rather than an
  unrelated black border/check treatment;
- the selected template's description, compatibility, provenance, format, and
  actions now remain in a bounded bottom dock outside the catalog scroll area;
  selecting a template can no longer appear to do nothing because its actions
  are below the entire list;
- source/license/version remain visible without occupying six separate rows;
- output headers use the shared panel-section recipe;
- Pages use compact output containers, clear hover/focus feedback, 11 px
  metadata, and the same accent line/surface treatment as Layers;
- all template and page commands, dialogs, context menus, review locks, and
  compact targets remain intact.

Mounted acceptance at `1440 x 900` confirmed:

- the template dock remains visible while the catalog scrolls;
- the dock is 295 px for the selected starter and does not create horizontal
  overflow;
- at least two useful template previews remain visible above the dock;
- six quotation pages remain legible in one output card;
- the active page has one clear accent line and surface without changing its
  56 px target;
- page/output actions and the template primary/secondary actions remain
  visible and named.

Focused evidence:

- Studio typecheck passes;
- six focused template and page-context tests pass;
- scoped Studio and UI ESLint passes;
- `git diff --check` passes.

## Gate 3 result — inspector information architecture

Sources revisited before implementation:

- OpenPencil `src/theme/panel/{section,header,field,grid}.ts`;
- OpenPencil `src/theme/number-field.ts`;
- OpenPencil `src/components/properties/PropertyListRoot.vue`;
- OpenPencil `src/components/properties/{PositionSection,AppearanceSection}.vue`;
- Studio's mounted inspector, selection projection, typed controls, crop
  preview, and image-recovery paths.

Implemented:

- selected-object identity now names the actual object and its type instead of
  presenting an ambiguous generic layer-name form;
- `Name in Layers` explicitly explains that it changes Layers identity only,
  while visible text is edited under Typography;
- inspector properties are organized into named, compact sections for
  alignment, geometry, opacity, typography, appearance, and images;
- multi-selection uses the same hierarchy for geometry, alignment and
  distribution, and layer order;
- contextual controls, capability explanations, recovery actions, typed value
  commits, crop projection, and review locks remain unchanged.

Mounted acceptance at `1440 x 900` confirmed:

- selecting a rectangle shows clear `Align to page`, `Position & size`,
  `Opacity`, and `Appearance` sections;
- selecting `Quotation title` exposes its Layers identity separately from the
  visible `Content` field under Typography;
- section headers use one readable 11 px semibold hierarchy and compact 32 px
  anatomy;
- canvas, tree, and inspector selection remain linked;
- no horizontal inspector or shell overflow appeared.

Focused evidence:

- Studio typecheck passes;
- 18 focused inspector, crop-preview, slider, and typed-control tests pass;
- scoped Studio ESLint passes;
- `git diff --check` passes.

## Gate 4 result — page strip and canvas controls

Sources revisited before implementation:

- the filmstrip, gesture, ruler, canvas-HUD, and overlay findings in
  `visual-and-interaction-audit.md`;
- OpenPencil `src/components/editor/ZoomDropdown.vue`;
- OpenPencil `src/components/canvas/CanvasPaneHeader.vue`;
- OpenPencil `src/theme/{page-list,canvas-pane-header}.ts`;
- Loora `packages/canvas/src/react.tsx` camera, fit, zoom, and input controls;
- Studio's mounted filmstrip, zoom HUD, ruler/guide canvas, selected-image
  toolbar, crop toolbar, and overlay-placement tests.

Implemented:

- the filmstrip's active page now uses the same Studio accent as canvas and
  Layers selection instead of a separate black ring and neutral surface;
- page hover, focus, Add page, and density states use one restrained editor
  treatment, and the density toggle now describes the action it will perform;
- the oversized permanent zoom slider was replaced with a compact, named
  canvas toolbar: zoom out, current percentage, zoom in, Fit page, and Zoom to
  selection remain immediately available;
- clicking the percentage opens a complete zoom menu with the slider, live
  percentage, shortcuts, fit/selection actions, and 25/50/100/200 presets;
- selected-image and crop toolbars now share the 36 px desktop floating-control
  anatomy, compact radii, shadow/ring treatment, and 28 px desktop controls
  while retaining 44 px compact targets;
- existing pointer-centred zoom, trackpad/pinch handling, rulers, guide hit
  strips, crop placement, toolbar collision avoidance, and page raster
  virtualization remain unchanged.

Mounted acceptance at `1440 x 900` confirmed:

- filmstrip selection, canvas selection, Layers selection, and ruler selection
  bands use one accent;
- the active page remains legible among all six quotation pages;
- the zoom toolbar no longer exposes an unnecessary permanent slider across
  the canvas;
- the zoom menu opens above the toolbar without clipping the page strip;
- selecting 50% changes the camera and Fit page returns it to 34%;
- Zoom to selection enables as soon as a layer is selected;
- the density action is named `Use comfortable page strip` in compact mode;
- no horizontal shell overflow appeared.

Focused evidence:

- Studio typecheck passes;
- 72 focused filmstrip, zoom, ruler/guide, selected-image, crop, and placement
  tests pass;
- scoped Studio ESLint passes;
- `git diff --check` passes.

## Gate 5A result — application menus and dialog sizing

Sources revisited before implementation:

- the compact reachability and modal-surface findings in
  `visual-and-interaction-audit.md`;
- `menu-01-topbar-placement-review.md` and its exact seven-heading contract;
- OpenPencil `src/components/Shell/AppMenu.vue` and `src/theme/dialog.ts`;
- Studio's product-menu model, responsive More menu, shared Dialog primitive,
  shortcuts dialog, and mounted Publish dialog.

Implemented:

- the 1280-1599 px More menu now exposes the complete File, Edit, View, Object,
  Text, Arrange, and Help sequence from the shared product-menu model;
- below 640 px, Text continues to use the richer preset surface and is omitted
  only from the duplicate product submenu;
- the shortcuts dialog now correctly overrides the shared responsive width at
  `sm:max-w-3xl` instead of being forced back to the primitive's 384 px
  default;
- the responsive menu projection is a named, tested component contract rather
  than local filter markup inside the shell;
- existing Radix submenu semantics, command enablement, shortcuts, focus
  return, compact targets, and Publish dialog anatomy remain unchanged.

Mounted acceptance at `1440 x 900` confirmed:

- More exposes all seven ordered application groups, including Text;
- the shortcuts dialog renders as a readable two-column 768 px surface with no
  truncated command labels caused by the old width cascade;
- the close control, modal focus, scroll containment, backdrop, and keyboard
  shortcut regions remain correctly named;
- the Publish dialog retains its clear summary, validation state, footer, and
  focus-owning actions.

Focused evidence:

- Studio typecheck passes;
- focused responsive-menu and shortcut-disclosure tests pass;
- scoped Studio ESLint passes;
- `git diff --check` passes.

## Gate 5B result — loading, empty, error, and recovery states

Sources revisited before implementation:

- the compact reachability, modal semantics, and asynchronous-state findings
  in `visual-and-interaction-audit.md`;
- OpenPencil `src/theme/dialog.ts`, its application menu, and selection rename
  dialog;
- Studio's Templates, Layers, Fields, Review, Design inspector, and shared
  editor-chrome implementations.

Implemented:

- introduced one compact `EditorPanelState` recipe with explicit title,
  description, icon, action, and destructive-error slots;
- migrated Templates loading failures and filtered-empty recovery to the
  shared state, preserving retry and clear-filter actions;
- migrated Layers empty/search states and Design's no-selection state so the
  three primary panels no longer use unrelated visual grammars;
- migrated the Fields, selected-layer bindings, and Review secondary empty
  states, including their create-field and copy-brief actions;
- retained the asset library's purpose-built asynchronous surface and the
  empty-canvas creation actions because those are workflows rather than panel
  status messages.

Mounted acceptance at `1440 x 900` confirmed:

- a no-result template search shows a compact named state and an immediate
  `Clear filters` recovery, then restores the catalog;
- a no-result layer search shows the matching compact hierarchy without
  disturbing the canvas;
- Review shows the same hierarchy while keeping its available WebMCP action
  reachable and the surrounding inspector sections intact;
- the Design no-selection state is calm, centered, and no longer resembles a
  generic marketing empty card.

Focused evidence:

- Studio and UI package typechecks pass;
- 11 focused panel-state, catalog, inspector, and crop-preview tests pass;
- scoped Studio and UI ESLint passes;
- `git diff --check` passes.
