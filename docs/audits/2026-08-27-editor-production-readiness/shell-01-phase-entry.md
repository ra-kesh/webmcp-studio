# SHELL-01 phase entry: adjustable editor workspace

Date: 2026-08-28
Status: implementation and independent code review complete; healthy-host browser acceptance pending

## Decision

SHELL-01 is the next editor-first slice after GUIDE-01B. This is not the next
production-safety slice: `DEMO-01`, `CMD-01`, `REVIEW-01`, and the other P0/P1
items remain release gates. It is the highest-value next slice for the editor
experience because navigation consolidation is now complete, while the live
desktop shell still spends fixed space on panels and a 128px filmstrip. The
remaining problem is structural, not a request to tune a few margins.

The current implementation in `apps/studio/src/features/studio-shell.tsx` uses
`236px / flexible canvas / 320px` at the desktop breakpoint. The left panel is
`QuotationSidebar`, the right panel is `InspectorSidebar`, and the bottom
`ProductPageFilmstrip` is mounted below the canvas. The compact mode correctly
uses the shared `QuotationSidebar` and inspector Sheet, so SHELL-01 must not
reintroduce a competing mobile sidebar or alter the Templates-left / Pages-
bottom information architecture.

The audit measured approximately 724px of center canvas at 1280px, about 564px
at 1120px, and a 128px filmstrip whose earlier role was mostly page selection.
The responsive phase moved the desktop threshold to 1280px and gave compact
widths an intentional Sheet composition. SHELL-01 therefore owns desktop
panel geometry and filmstrip density; it does not reopen RESP-01/A11Y-01.

## Reference evidence revisited

- OpenPencil's actual `src/components/editor/EditorWorkspace.vue` is the
  direct shell reference: splitter-controlled panel widths, min/max bounds,
  persisted layout state, and a distinct compact composition. Its
  `src/components/PagesPanel.vue`, `LayersPanel.vue`, `PropertiesPanel.vue`,
  `src/components/Toolbar/*`, and `src/theme/panel/*` show consistent panel
  headers, rows, focus treatment, and compact control metrics.
- OpenPencil's `src/components/ui/panel/*` confirms that panel content should
  scroll independently while the shell and splitter remain stable. Its
  navigation-panel documentation treats panel visibility as a workspace
  preference, not document data.
- Loora's editor shell and `packages/editor/src/components/editor.tsx` keep
  canvas, navigation, inspector, and command surfaces as explicit siblings.
  `canvas-menu.tsx` and `editor-command-menu.tsx` reinforce that panel actions
  must use live command/capability state. `packages/editor/src/lib/canvas-client.ts`
  is relevant only as a boundary lesson: persisted workspace state is separate
  from the canonical document and should be versioned/migratable.
- The local visual audit (VIS-02) explicitly requires min/default/max widths,
  keyboard resize, persisted collapse/restore, a canvas minimum, and a
  filmstrip that either gains useful page actions or shrinks to navigation.
  The completed PAGE-01 evidence says the filmstrip now has contextual page
  actions, so shrinking it to a purposeful gallery/navigation strip is the
  lower-risk choice.

## UX contract

### Desktop shell

At widths `>=1280px`, render three adjustable regions separated by real,
keyboard-operable splitters:

| Region              | Minimum |   Default |   Maximum | Contract                                                   |
| ------------------- | ------: | --------: | --------: | ---------------------------------------------------------- |
| Left document panel |   208px |     264px |     360px | Templates, Pages, Layers; collapse restores the last width |
| Canvas              |   520px | remaining | remaining | Never below this width in desktop mode                     |
| Right inspector     |   280px |     336px |     440px | Design, Fields, Review; collapse restores the last width   |

The exact defaults may be adjusted by a visual fixture, but the bounds and
canvas minimum are part of the contract. At the 1280px minimum desktop width,
the shell must resolve without overflow; if the two requested panel widths
cannot leave 520px, clamp panels before allowing canvas shrink.

Each splitter is a focusable separator with an accessible name, orientation,
`aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and keyboard support:
Arrow keys move by 8px, Shift+Arrow by 32px, Home/End go to min/max, and
Enter toggles collapse. Pointer dragging is coalesced to one settled layout
update per animation frame. The hit target is at least 12px even when the
visible divider is 1px. Focus remains on the splitter after resize.

Panel collapse controls are real buttons with stateful labels (for example,
“Collapse document panel” / “Expand document panel”), tooltips, and a visible
focus ring. Collapsed panels leave a narrow rail only if it preserves a clear
reopen affordance; otherwise the canvas receives the freed space. `Escape`
never unexpectedly collapses a panel and must remain reserved for active modal,
guide, crop, and text-edit cancellation.

### Filmstrip

The filmstrip remains a horizontal page gallery below the canvas. Its desktop
height target is 96px (including its header/action row), with a documented
minimum of 80px and maximum of 128px. Thumbnails preserve aspect ratio, active
page focus/selection, horizontal wheel/trackpad scrolling, and page context
actions. Add-page and gallery actions remain reachable without expanding the
strip permanently. Do not put templates or inspector content in this region.

At compact widths the filmstrip may become a shorter 72–88px gallery or be
represented by the existing Pages Sheet; it must not create page-level
horizontal overflow. Page order continues to come exclusively from
`output.pageIds`.

### Persistence boundary

Persist only versioned per-user/editor-workspace preferences: left/right
widths, collapsed flags, filmstrip density, and optionally the last active
desktop panel tab. Do not persist these in the canonical document, quotation
payload, published version, renderer manifest, WebMCP document state, or undo
history. Use the existing workspace-sidecar pattern from GUIDE-01B, with a
schema version, finite/clamped values, corrupt-record quarantine, and safe
defaults. A document switch must not leak a previous document's panel layout
unless the product explicitly defines the preference as user-global; choose
user-global for shell layout and document-local only for document-specific
selection/tab state.

## Files and bounded order

Likely owners are `apps/studio/src/features/studio-shell.tsx`,
`apps/studio/src/features/editor/quotation-sidebar.tsx`,
`apps/studio/src/features/editor/inspector-sidebar.tsx`,
`apps/studio/src/features/editor/page-filmstrip.tsx`, and shared editor chrome
primitives under `packages/ui/src/components`. Add a small pure module for
layout math/persistence rather than burying clamping and keyboard semantics in
the shell component.

1. Re-read this contract and OpenPencil `EditorWorkspace.vue`; write pure
   layout state, clamping, migration, and splitter keyboard math tests.
2. Add a versioned repository for user-global shell preferences. Verify corrupt,
   missing, out-of-range, and old-version records recover to defaults.
3. Add a tested splitter/separator primitive and mount left/right splitters as
   siblings of the existing panels. Keep compact Sheets unchanged.
4. Replace fixed desktop columns with the clamped layout, preserving the
   canvas minimum and independent panel scroll containers. Add collapse/restore
   with last-width memory.
5. Reduce filmstrip chrome to the purposeful gallery contract and verify page
   actions, active-page focus, and thumbnail order remain intact.
6. Run pure/component tests, package typechecks/lint, and the existing
   responsive, gesture, page/filmstrip, command, and accessibility suites.
   A browser visual pass at 1280, 1440, 1920, 1119, and 320px is required before
   completion; do not claim the phase from static tests alone.

## Risks and non-goals

- Do not let a splitter intercept canvas pointer gestures or browser zoom;
  splitter ownership ends at its hit target.
- Do not use CSS `resize` alone: it cannot provide the commandable keyboard,
  persistence, canvas guard, or collapse semantics required here.
- Do not put layout preferences into document snapshots; doing so would make
  panel resizing pollute Undo, publish revisions, and API rendering.
- Do not make the compact breakpoint depend on user panel widths. Compact mode
  remains a stable information-architecture transition at the existing 1280px
  boundary.
- Do not expand SHELL-01 into a new navigation tree, thumbnail raster rewrite,
  or toolbar overflow project. Those are separate backlog items and should be
  reviewed independently.

## Completion gate

SHELL-01 is complete only when the min/default/max table is encoded in tests,
keyboard and pointer resizing are accessible, collapse restores the prior
width, reload preserves preferences, desktop canvas width never violates its
minimum, compact mode has no overflow/regression, and the filmstrip's rendered
height and page actions match the contract. Capture a visual comparison at
least once against the current shell and the OpenPencil-inspired target.
