# MENU-01 topbar placement review

Date: 2026-08-28
Status: implementation placement decision
Scope: desktop application menubar only; no Studio code changed

## Decision

Keep Studio's application bar exactly 48 px high and keep every existing control
vertically centered on the same line. On wide desktop, place the persistent
menubar **after the fixed document-identity zone and before the editor tool
controls**:

`document identity | File Edit View Object Text Arrange Help | tools/history/selection | status/publish/API/export/more`

The document identity remains the current 224 px (`w-56`) desktop zone. Retain
the existing separator after that zone, put the menubar immediately after it,
and add one separator between the menubar and Select/Hand. Do not put the menu
above or below the topbar, do not move it into the Layers panel, and do not
increase `--studio-topbar-height`.

Render the complete seven-heading menubar only at `min-width: 1600px`. Below
that width, remove the root and both menu-specific separators atomically. The
existing **More studio actions** menu remains the compact access point and must
render the same File/Edit/View/Object/Text/Arrange/Help groups from the shared
menu model. Cmd/Ctrl+K remains the faster command-discovery route at every
width.

This is a deliberate responsive switch, not a partial or horizontally scrolling
menubar. A hidden heading at the end of a scroll strip is worse than a clearly
collapsed application menu.

## Why this fits the current shell

- Studio has an explicit 48 px application-bar token
  (`packages/ui/src/styles/globals.css:57-59`) and consumes it as a fixed,
  non-wrapping header (`apps/studio/src/features/studio-shell.tsx:1383-1388`).
  A second row would change the vertical canvas budget and create another
  horizontal seam across all three editor columns.
- At desktop width, document identity is deliberately fixed at 224 px while the
  rest of the bar is a single flex line
  (`apps/studio/src/features/studio-shell.tsx:1388-1407`). That stable identity
  boundary is the correct left anchor for global commands.
- The same line already carries four insertion/tool controls
  (`apps/studio/src/features/studio-shell.tsx:1407-1568`), history
  (`apps/studio/src/features/studio-shell.tsx:1569-1592`), conditional selection
  controls and Paste (`apps/studio/src/features/studio-shell.tsx:1594-1655`),
  then the save/publish/API/file/export/overflow group aligned to the right
  (`apps/studio/src/features/studio-shell.tsx:1657-1843`). Seven labels cannot be
  added safely at the 1280 px three-panel breakpoint, especially when a
  selection makes the conditional controls appear.
- Studio's desktop body begins at 1280 px and already reserves 236 px and 320 px
  sidebars (`apps/studio/src/features/studio-shell.tsx:1846-1849`). Therefore
  `1280px` means "three-panel layout," not "enough unused application-bar
  width." The menubar needs its own wider visibility threshold.

## What to adopt from OpenPencil

OpenPencil's actual browser menu is useful, but its placement should not be
copied literally:

- `AppMenu.vue` renders a document-name row followed by a separate compact menu
  row (`outputs/reference-repos/editors/open-pencil/src/components/Shell/AppMenu.vue:61-104`).
  `LayersPanel.vue` mounts that entire block as the first child of the left
  sidebar (`outputs/reference-repos/editors/open-pencil/src/components/LayersPanel.vue:31-38`),
  and `EditorWorkspace.vue` confirms the sidebar is a resizable panel rather
  than a global topbar (`outputs/reference-repos/editors/open-pencil/src/components/editor/EditorWorkspace.vue:32-59`).
  Studio's application identity and publish/export state already live globally,
  so moving its menu into Layers would give global commands a local-looking
  owner and make them disappear with the compact panel.
- Adopt OpenPencil's restrained trigger anatomy: compact text, 8 px horizontal
  padding, no outer card, and visible hover/open states
  (`AppMenu.vue:103-111`). Adopt its portal, start alignment, submenu, checkbox,
  shortcut, and separator composition (`AppMenu.vue:113-176`).
- Adopt the centralized menu-surface sizing: main content `min-w-52`, submenu
  `min-w-44` (`AppMenu.vue:55-58`), and concise rows with consistent focus and
  disabled states (`outputs/reference-repos/editors/open-pencil/src/components/ui/menu.ts:3-12`).
- OpenPencil's browser test asserts a real `role="menubar"` and the complete
  visible top-level sequence rather than testing decorative labels
  (`outputs/reference-repos/editors/open-pencil/tests/e2e/app/menu.spec.ts:5-14`).
  Studio should extend that sequence with Help, as required by MENU-01.

Do not copy OpenPencil's `overflow-x-auto` menubar (`AppMenu.vue:103-104`) into
Studio's global header. It is a containment compromise for a resizable sidebar;
it would make application commands silently disappear in the topbar.

## Exact visual contract

| Element           | Contract                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topbar            | Remains `48px`; one line; no wrap; current border and horizontal padding unchanged.                                                                                                                           |
| Menubar root      | `height: 32px`; natural width with a 320 px layout budget; `flex: none`; gap `0`; transparent background; no root border, radius, shadow, or padding.                                                         |
| Top-level trigger | `height: 28px`; `padding-inline: 8px`; Geist `12px/16px`; weight 500; neutral foreground; 4 px radius.                                                                                                        |
| Trigger states    | Hover and open use the existing muted/accent surface; keyboard focus uses the shared visible focus ring; no scale, elevation, or animated underline.                                                          |
| Main menu         | Start-aligned to its trigger; 8 px side offset from the trigger produces a surface aligned with the 48 px bar edge; width at least 224 px and at most 320 px; viewport-capped height with vertical scrolling. |
| Submenu           | At least 192 px wide; 4 px side offset; same surface/ring/shadow and item anatomy as the main menu.                                                                                                           |
| Menu item         | Minimum 28 px height on wide desktop; 6 px horizontal gap; 16 px icon; label grows; shortcut is 12 px, muted, and right-aligned. Destructive color appears only on destructive actions.                       |
| Separators        | One semantic border-color line with 4 px vertical breathing room; never an empty disabled item.                                                                                                               |

The owned wrapper already supports the necessary geometry and portal behavior:
`packages/ui/src/components/menubar.tsx:7-20` defines the root,
`:35-49` the trigger, `:51-73` portal content, and `:225-268` submenus. The
Studio placement should override the wrapper's default bordered root with the
transparent topbar contract above; menu surfaces should retain the wrapper's
popover tokens, focus states, motion, ring, and collision-aware Radix portal.

## Responsive contract

### 1600 px and wider

- Show all seven headings in this exact order: File, Edit, View, Object, Text,
  Arrange, Help.
- Keep every heading visible without clipping, wrapping, truncating, or
  horizontal scrolling.
- The right action group retains `margin-left: auto`; no status, publish, API,
  export, or More control may be pushed out of the viewport.
- Conditional selection actions may appear without moving a menu heading to a
  second line or changing the topbar height.

### 1280-1599 px

- Do not render the persistent menubar or leave blank reserved width.
- Keep the present desktop toolbar and right-side actions in their current
  positions.
- **More studio actions** exposes the seven command groups as submenus or
  labelled groups built from the same model; it is not a second handwritten
  command catalog.

### Below 1280 px

- Keep the existing compact 44 px targets and sheet/overflow behavior.
- No persistent text menubar and no long-press substitute.
- More and Cmd/Ctrl+K provide complete command reachability. Do not add another
  icon-only "hamburger" beside More.

## Keyboard and focus contract

1. The menubar is one stop in the topbar's Tab order, between the document zone
   and Select. Radix roving focus makes only one top-level trigger tabbable.
2. Left/Right moves between headings. Down, Enter, or Space opens the active
   heading. Once a menu is open, Left/Right may switch headings, Up/Down moves
   items, Enter/Space invokes, and typeahead remains owned by Radix.
3. Pointer hover may switch headings only after a menu has been opened. Hovering
   over the closed bar must not open menus.
4. Escape closes the deepest submenu first, then the main menu, and restores
   focus to its heading. Only a subsequent Escape reaches text/crop/transform or
   canvas Escape handling.
5. Tab closes the menu and proceeds to the next topbar control; it must not trap
   focus in a non-modal application menu.
6. Merely opening or traversing a menu must not commit text editing, apply a
   crop/transform preview, clear selection, or move canvas focus. Command
   invocation resolves the active editor session through the shared runtime.
7. After an ordinary command, Radix restores focus to the heading unless the
   command opens another focus-owning surface (file picker, Dialog, command
   search, API playground). That destination then owns focus and returns it to
   the originating heading when closed.
8. The root is labelled `Application menu`. Checkbox and radio state use the
   primitive semantics; submenus expose expansion; disabled items use the shared
   live command capability and never run from stale menu state.
9. Do not add browser-conflicting Alt-letter mnemonic handling in this phase.
   Platform shortcut display and execution continue to come from the command
   chord model.

## Placement acceptance checks

- At 1600 and 1920 CSS px, with no selection and with the maximum visible
  selection-action set, the header remains exactly 48 px, every heading and
  right action is visible, and the document/tool/status baselines remain
  vertically centered.
- At 1280 and 1440 px, the persistent root is absent and More exposes all seven
  groups; no blank menu gap remains.
- At 320, 640, 940, 1100, and 1279 px, the existing compact controls retain their
  44 px targets and no new horizontal overflow appears.
- Keyboard-only traversal proves the ordering and Escape/Tab restoration above.
  Opening every main menu and deepest submenu proves portal collision handling
  at the left and right viewport edges.
- A mounted test asserts one `role="menubar"` only when the wide contract is
  active and checks the exact seven labels. Compact tests assert the equivalent
  seven generated groups in More rather than pretending hidden headings are
  reachable.

## Non-goals for this placement slice

- No second command row, native operating-system menu, hamburger duplicate,
  horizontal menu scroll, responsive label abbreviation, or icon-only category.
- No relocation of document identity, editor tools, save status, Publish, API
  playground, Export, or More.
- No new animation system. The existing menu fade/scale and Radix collision/focus
  behavior are sufficient.
