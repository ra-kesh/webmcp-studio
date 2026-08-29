# MENU-01 command discovery and context menus

Date: 2026-08-28
Status: implementation and independent code review complete; full browser acceptance remains open

The retained sections below describe the original phase-entry state. Current
closure evidence lives in `remediation-progress.md` and
`menu-01-final-code-review.md`; the product now has the canonical catalog,
menubar, command search, shortcut reference, and canvas/layer/page/output
context-menu integrations described by this contract.

## Product outcome

Studio should teach both a first-time user and an expert what can be done in the current context. The same command must have the same label, shortcut, checked state, enablement, disabled reason, and effect whether it appears in the app menu, command palette, canvas context menu, layer tree, page controls, toolbar, compact overflow, or WebMCP capability inspection.

This phase is command discovery and contextual access. It is not a request for more drawing features. The work closes a trust gap in the current editor: many capabilities exist, but a user must already know which icon, sidebar section, hover action, or keyboard chord owns them.

## Current implementation, checked against the live tree

### What already works

- `packages/editor/src/commands.ts` owns 41 stable editor command IDs, labels, mutation policy, image command capabilities, platform shortcut formatting, chord resolution, and a serializable capability projection. `packages/editor/test/commands.test.ts` proves unique chords, stable labels, review lockout, image state, platform labels, and shared dispatch.
- `packages/editor/src/structure-commands.ts` owns nine page/output command IDs and their review and aggregate-invariant enablement. The page filmstrip and Pages panel mark their visible controls with those IDs.
- `apps/studio/src/features/studio-shell.tsx:679-935` derives the live editor command context and routes toolbar and keyboard invocations through `runEditorCommand`.
- Responsive capability loss is already fixed. `StudioShell` has one `More studio actions` menu at every width, while desktop has direct document and export menus. Compact targets meet the existing 44 px contract.
- Page cards, output rows, text presets, shape insertion, and selected-image controls already use accessible Radix dropdown menus. Selected-image actions dispatch central image command IDs.
- The repository already contains `@webmcp/ui/components/command.tsx` backed by `cmdk`, plus the shared Dialog and Dropdown Menu primitives. The installed `radix-ui` bundle includes Context Menu and Menubar primitives, but Studio has no owned wrappers for them yet.

### Concrete gaps

- The command registry is not the complete product command vocabulary. Document/file/export actions are local `StudioMenuAction` objects in `studio-shell.tsx:1279-1365`. Page/output actions use a second enablement-only registry. Alignment, distribution, lock, visibility, ordering, rename, page actions, document lifecycle, publish, and export still enter through direct hook callbacks.
- `runEditorCommand` is a large host switch. Registry metadata has no category, keywords, checked state, scope, destructive flag, icon token, complete disabled reason, or typed argument contract. A generic menu or palette cannot be built from it without re-encoding product rules.
- Visible menu structure is handwritten in several components. `StudioShell`, `PageFilmstrip`, `PageOutputPanel`, and `SelectedImageToolbar` each assemble their own labels, separators, icons, shortcuts, and disabled states.
- Several visible shortcut labels are hardcoded Mac strings even though `formatEditorShortcut` supports Mac and Windows. The command registry does not model Linux separately.
- There is no File/Edit/View/Object/Text/Arrange/Help application menu, command palette, shortcut reference, canvas context menu, or layer-tree context menu.
- `FabricCanvasAdapter` constructs Fabric with `stopContextMenu: true` and `fireRightClick: true`, but registers no right-click/context-menu callback. Native context is suppressed without providing an editor context menu.
- `LayerTree` has strong keyboard and hover controls, but no `onContextMenu`, Context Menu key, or Shift+F10 route. Page/output ellipsis menus work, but right-click and the visible menu duplicate would not share a generated model.
- Disabled reasons are sparse. `editorCommandDisabledReason` currently reports the image-replacement reason only. Menu users cannot learn why grouping, paste, page deletion, image actions, history, or review-locked mutations are unavailable.
- WebMCP receives the 41-command editor projection only. It does not see the complete visible document/page/layer command vocabulary or target-aware reasons.

## Required command architecture

### One product command catalog

Create a single exported catalog that can describe every command exposed during this phase. Existing editor and structure IDs remain stable. Add IDs only for already-working product actions that must appear in discovery or context menus.

Minimum command families:

- Document: new, import document, import quotation source, export document JSON, export current page PNG, export active output PDF, publish, open API Playground.
- Edit: undo, redo, copy, paste, duplicate, delete, select all.
- View: Select and Hand tool state, zoom in/out/100%, fit page, zoom to selection, and open command search.
- Insert/Text: text preset insertion, image insertion, rectangle, ellipse, line, and existing icon insertion.
- Object: group, ungroup, rename, show/hide, lock/unlock, image operations, and move selection to another page only if the existing canonical command can preserve all relationships.
- Arrange: front, back, forward, backward, align, align to page, and distribute through the existing editor hook operations.
- Structure: the existing page and output commands with a typed target.
- Help: command search and keyboard shortcut reference. No placeholder documentation link.

Use a typed invocation rather than making every target or option part of the string ID. For example, alignment, a text preset, a page target, and an export format are typed arguments validated before enablement and again before execution. A menu item stores a command invocation, never an arbitrary callback.

Each static definition owns:

- stable ID, default label, category and subgroup;
- search keywords and optional alternate names;
- shortcut chords as machine-readable data;
- scope and whether a stable target is required;
- mutating, destructive, and palette/menu visibility policy;
- icon token, not a React component in the domain package.

The live runtime owns:

- context-sensitive label such as Show/Hide and Lock/Unlock;
- enabled state and a specific disabled reason;
- checked/radio state such as Select/Hand and Fit/Fill;
- the resolved target identity and target display name;
- `run(invocation)`, with a final capability check at execution time.

Do not cache authority when a menu opens. Selection, review state, crop state, document snapshot, active page, output invariants, clipboard state, and async locks can change while a menu or palette is mounted. The runtime must revalidate on invocation and return a stable no-op/error result rather than applying to a stale target.

### Pure menu models

Build app and context menus as pure arrays of command invocations, groups, separators, submenus, and noninteractive explanations. React renders the model through owned Radix primitives.

Required models:

- desktop app menu: File, Edit, View, Object, Text, Arrange, Help;
- command palette groups using the same catalog and live runtime;
- canvas context menu for blank canvas, one selected object, multi-selection, and image selection;
- layer context menu for the active node or group;
- page/output context models shared by the existing ellipsis menus and new right-click/keyboard entry;
- selected-image More menu generated from the same image command group.

The current responsive `More studio actions` menu remains the compact fallback and status surface. Rebuild its command sections from the same model, but do not turn it into a second command palette.

## User journeys

### Find an unfamiliar command

1. Press Cmd/Ctrl+K from the canvas, layer tree, inspector, or compact shell.
2. Search by command label, category, keyword, or platform shortcut.
3. Results show the same live label, shortcut, checked state, and disabled reason used elsewhere.
4. Enter executes through the shared runtime. The palette closes only after the command accepts the invocation. Focus returns to the prior surface or to the control opened by the command.

### Work from the canvas

1. Right-click a visible object. If it is outside the current selection, make it the context selection before opening. If it belongs to the current multi-selection, preserve that selection.
2. Show Edit, Arrange, Object, and type-specific groups derived from the captured target and current runtime.
3. Right-click blank canvas to clear object selection and offer only valid blank-context actions such as Paste, Select all, View, and Insert.
4. A locked object remains targetable. Show Unlock and non-mutating navigation; disable mutations with the exact reason.

### Work from Layers without a pointer

1. Focus a layer-tree row.
2. Open its context menu with Shift+F10 or the Context Menu key. Pointer right-click follows the same selection rule as canvas right-click.
3. Rename, show/hide, lock/unlock, duplicate, group/ungroup, arrange, and delete use the same invocations as the app menu and palette.
4. Closing the menu restores focus to the tree, preserves `aria-activedescendant`, and keeps the active row mounted by the existing virtualizer.

### Manage pages and outputs

1. Open the existing ellipsis menu, right-click the page/output item, or focus it and press Shift+F10.
2. All three routes render one generated target-aware model.
3. Page/output deletion keeps the existing impact confirmation. Invariant-disabled items state why the last page or output cannot be removed.

### Pending review and active crop

- Menus and palette stay available for navigation and inspection.
- Every mutation uses the same review/crop capability policy as toolbar and keyboard routes.
- The palette may show disabled mutations so users can discover them, but it must say what must be resolved. Context menus may omit commands irrelevant to the target, but cannot present an enabled action that another surface blocks.

## Keyboard, focus, and accessibility contract

- Cmd/Ctrl+K opens command search globally, including from ordinary inputs, unless an IME composition is active. Opening it must not commit or discard text editing. Executing a mutation resolves any active editor session through the same policy as toolbar execution.
- Application menus use the Radix Menubar keyboard model: Left/Right across headings, Up/Down through items, Enter/Space to invoke, Escape to close, typeahead where supported, and focus restoration to the opener.
- Context menus use the Radix Context Menu primitive. Support pointer right-click, Shift+F10, and the Context Menu key. Do not implement a hand-positioned `role="menu"` div.
- Command search is a named Dialog with a labelled search input, focus containment, an announced result count, a clear empty state, and no focusable disabled results. A disabled result's reason remains available as text.
- Checked commands use menu checkbox/radio semantics, not a decorative check icon. Submenus expose their expanded state through the primitive.
- Menu opening must not steal or silently rewrite selection except for the documented target-selection rule. Escape closes the topmost menu or dialog before it reaches canvas Escape behavior.
- Pointer coordinates and keyboard anchors remain inside the viewport. Portals must not be clipped by the editor shell.
- Compact touch access remains through existing 44 px ellipsis/overflow buttons and command search. Long-press is not required because it conflicts with browser selection and operating-system gestures.
- Shortcut labels come only from machine-readable chords and the detected Mac, Windows, or Linux platform. The formatter and the keyboard resolver must consume the same chord data.

## Acceptance tests

### Pure and package tests

- Every app-menu, palette, context-menu, toolbar, compact-overflow, and page/image menu entry resolves to a registered command invocation.
- Every discoverable command has a nonempty label, category, keywords, scope, platform shortcut projection when applicable, and one tested runtime handler.
- Chords are unique within overlapping scopes and modes. Mac, Windows, and Linux labels match the resolver.
- Menu builders produce exact groups and separators for blank canvas, text, image, mixed selection, locked selection, group, page, output, review, crop, no clipboard, final page/output, and stale target fixtures.
- Runtime tests prove checked states, dynamic Show/Hide and Lock/Unlock labels, precise disabled reasons, final execution revalidation, and zero mutation after target/document/snapshot invalidation.
- Static coverage fails if a visible `data-command-id` is absent from the catalog or if a catalog command intended for discovery is unreachable from both the palette and an app/context menu.
- WebMCP capability projection uses the same live runtime for the command IDs it exposes. No second enablement switch is allowed.

### Mounted Studio tests that do not require Vite

- Command Dialog opens from the platform chord, filters by labels/keywords/shortcuts, announces empty/result states, executes one command, and restores focus.
- Escape priority is command dialog, submenu/menu, crop/text/transform session, then canvas selection.
- Canvas context payload maps pointer target and multi-selection correctly; blank canvas produces the blank model.
- Layer and page keyboard context entry open the correct target model and restore focus after close.
- Review, crop, locked selection, and last-page/output states render the same enablement and reason in menu and palette.
- Existing compact overflow, selected-image, page, and output markup is generated from the shared model without losing accessible names or 44 px compact targets.

### Healthy-host browser acceptance

Author these contracts during implementation but do not report them as executed while the host remains unhealthy:

- Desktop app-menu traversal using keyboard only.
- Cmd/Ctrl+K from canvas, Layers, inspector, and compact shell.
- Right-click selected/unselected/blank canvas, multi-selection, image, locked layer, nested group, page, and output.
- Shift+F10 and Context Menu key parity in the virtualized layer tree and page list.
- Focus restoration, Escape stacking, portal viewport containment, selection preservation, review lockout, one-step Undo, and screenshot checks at desktop and compact widths.
- Axe checks for the menubar, command dialog, and each context menu state.

## Reference decisions

Primary reference root: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos`.

Adopt from OpenPencil:

- `editors/open-pencil/packages/vue/src/editor/commands/{registry,definitions,actions,use,shortcut,types}.ts` for separate static metadata, live command state, one `runCommand`, platform formatting, and menu-item projection.
- `editors/open-pencil/packages/vue/src/editor/menu-model/{types,builders,command-groups,canvas,use}.ts` for pure app/context models, grouped command IDs, conditional context items, dynamic labels, and submenus.
- `editors/open-pencil/packages/vue/src/editor/selection-capabilities/use.ts` for one capability source shared by all placements.

Cross-check only:

- `editors/avnac-studio/frontend/src/features/scene-editor/tools/scene-canvas-context-menu.tsx` confirms the useful minimal canvas actions, but its hand-positioned menu lacks robust focus management, collision handling, submenus, and shared command metadata. Do not copy its component.
- `editors/react-design-editor/src/canvas/handlers/ContextmenuHandler.ts` cleanly separates canvas target detection from portal rendering. Its debounced opaque React-content payload is too weak for Studio's typed and accessible menu model.
- `editors/react-design-editor/src/canvas/handlers/ShortcutHandler.ts` is a warning against one predicate per shortcut. Studio should keep its data-driven chord resolver.

Use the existing shadcn/Radix styling and owned UI package. Add owned `context-menu.tsx` and `menubar.tsx` wrappers rather than hand-stitching ARIA roles or importing reference CSS.

## P0 and P1 scope

P0 for this phase:

- one complete command catalog for every action exposed by the new menus and palette;
- one runtime invocation and capability path with final revalidation;
- app menus, command search, and canvas/layer/page context access without contradictory enablement;
- pending-review, crop, locked-selection, stale-target, page/output invariant, destructive confirmation, and focus/Escape safety;
- no regression in compact reachability or existing keyboard commands.

P1 for this phase:

- complete dynamic disabled reasons and checked states;
- platform-correct shortcut discovery and reference;
- target-aware submenus such as Move to page and image operations when the underlying canonical behavior already exists;
- WebMCP inspection parity for the shared command capabilities;
- browser and accessibility evidence when the host is healthy.

## Non-goals

- Do not add cut, inverse selection, masks, boolean geometry, components, auto layout, plugins, collaboration, or commands whose domain behavior does not exist.
- Do not add user-remappable shortcuts or a native operating-system menu bar.
- Do not turn the command palette into a document search, asset search, or AI prompt surface.
- Do not add long-press context menus.
- Do not replace the layer tree, responsive overflow, image toolbar, page panel, or command registry wholesale. Reuse their working behavior behind one generated model.
- Do not claim menu completion from static markup tests alone. Real keyboard, focus, target-selection, and portal behavior remain required browser evidence.

## Stale-audit corrections

- The audit says there is no command registry. A tested 41-command editor registry and serializable capability projection now exist.
- The audit says two global shortcut listeners conflict. The product now has one shell-level resolver plus scoped canvas/text/tree handlers with explicit ownership.
- The audit says shortcut labels are Mac-only at the architecture level. Platform formatting exists, but several visible menus still hardcode Mac labels. The remaining problem is adoption, not formatter absence.
- The audit says there is no overflow menu and compact actions disappear. RESP-01 added the persistent `More studio actions` menu and accessible compact sheets.
- The audit says page controls and hierarchical Layers are unreachable or absent. PAGE-01 and NAV-01 are implemented, including page/output menus and a virtualized ARIA tree.
- The audit says image editing has no contextual surface. ASSET-02 added a selected-image toolbar and More menu driven by image command IDs.

The remaining MENU-01 problem is narrower and more concrete: the product has several good command-aware islands, but no complete command catalog or generated discovery system connecting them.
