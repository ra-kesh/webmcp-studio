# MENU-01 browser acceptance

Date: 2026-08-29

Status: **essential command-discovery journeys accepted on the local product
boundary; exhaustive contextual focus and collision coverage remains open**

## Phase entry revisited

Before this gate, the implementation reread the MENU-01 audit, top-bar
placement decision, page/output integration review, final independent code
review, and the relevant OpenPencil and Loora command/menu implementations.
The retained product rule is one typed command vocabulary and one live
capability policy across menus, command search, keyboard shortcuts, context
menus, WebMCP, and the shell executor.

## Browser evidence

The healthy-host pass used the running Studio product at
`http://localhost:3001`; port 3000 remained the separate Stuwiz application.

1. At 1920 by 1080, File, Edit, View, Object, Text, Arrange, and Help remain in
   the existing top bar. Help exposes command search from the generated menu.
2. At 390 by 844, the compact More menu exposes the same Help command-search
   entry, and the command dialog remains inside the viewport.
3. Right-clicking a blank, nonempty canvas clears selection and exposes Paste,
   Select all, Insert, and View. Select all is enabled and no longer reports the
   false `This command needs a target.` explanation.
4. Running Select all from that context menu selects all nine layers on the
   active Cover page and projects the exact multi-selection into the inspector.
5. With no selection, command search exposes the same enabled Select all action
   and running it produces the same nine-layer selection.
6. A real virtualized locked group menu preserves its exact group selection,
   enables Copy and Unlock, and disables mutation with the canonical unlock
   explanation. Shift+F10 retains the same target-aware path.

The browser pass exposed and fixed one shared-contract defect rather than
patching a surface. `selection.select-all` had inherited selection scope, so
the registry required a selection before the command that creates a selection
could run. It is now page-scoped, captures the active page at menu/palette open,
and becomes stale if the active page changes before execution. The Studio
capability state also gives empty pages the truthful explanation
`This page does not contain any layers.`

## Retained regression

- `menu-command-production.spec.ts`: **2/2 passed** against port 3001
- `product-commands.test.ts`: **19/19 passed**
- Editor TypeScript: passed
- Studio TypeScript: passed
- Focused Studio ESLint: passed
- `git diff --check`: passed

The remaining exhaustive browser matrix is pointer placement for every
page/output/image/locked/group variant, nested portal collision at every edge,
and focus restoration through every Escape stacking combination. Existing
mounted tests and independent code review cover those paths structurally, but
this document does not mislabel them as complete browser evidence.
