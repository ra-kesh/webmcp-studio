# EDITOR-POLISH-01 phase entry

Date: 2026-08-30

Status: active; Gate 1 accepted locally

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
