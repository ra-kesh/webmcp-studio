# MENU-01 independent code review

Date: 2026-08-28
Reviewer: independent read-only pass
Scope: current MENU-01 implementation, package models/runtime, shared Radix wrappers, and Studio integration.

## Findings

### P0 — page/output context commands are modelled but not executable

`buildPageContextMenu` and `buildOutputContextMenu` emit `page.update`, `page.remove`, `output.update`, `output.remove`, and `output.add` in `packages/editor/src/product-commands.ts:1542-1583`. However the Studio `executeProductCommand` switch ends at `page.move-up/page.move-down` and falls through to `return false` for these IDs (`apps/studio/src/features/studio-shell.tsx:1568-1569`). The runtime therefore returns `declined` for enabled entries. This is especially dangerous because the menu presents these as real actions. Route every visible structure invocation through the existing canonical editor callbacks, or omit it until a handler exists; add one test per command asserting the handler and mutation.

### P0 — context-menu components are not wired to any Studio surface

`ProductCommandContextMenu` exists (`apps/studio/src/features/editor/product-command-menu.tsx:304-323`), but the only current Studio usage is the menubar (`apps/studio/src/features/studio-shell.tsx:1728-1732`) and command palette. There is no `ProductCommandContextMenu` usage around the Fabric canvas, LayerTree, page filmstrip, or output panel. Fabric still suppresses native context menu. Consequently the required right-click, Shift+F10, and Context Menu key journeys have no reachable UI path. Integration must capture a typed target, apply the documented selection rule, build the matching pure model, and wrap each surface with the Radix primitive.

### P1 — layer target invocations can mutate the wrong selection

`buildLayerContextMenu` creates invocations targeted at a node/group (`packages/editor/src/product-commands.ts:1480-1539`), but the Studio execution switch for rename/visibility/lock/duplicate/delete/arrange reads `editor.selectedNodes` and ignores `invocation.target` (`apps/studio/src/features/studio-shell.tsx:1491-1540`). Until opening a layer menu first selects that target (preserving an existing multi-selection when appropriate), an enabled layer menu can rename, hide, lock, delete, or reorder a different selection. Add target-selection at context-open and final target checks in handlers; test pointer and keyboard invocation for selected and unselected rows.

### P1 — palette identity collapses typed variants and can produce duplicate React keys

`projectProductCommandPalette` intentionally emits twelve alignment and two distribution variants (`packages/editor/src/product-commands.ts:1381-1432`), but Studio maps every item ID to only `command.invocation.commandId` (`apps/studio/src/features/studio-shell.tsx:1583-1596`). The palette therefore has repeated `id="arrange.align"`/`id="arrange.distribute"` values and `CommandItem key={item.id}` repeats keys (`apps/studio/src/features/editor/command-palette.tsx:108`). This can cause unstable reconciliation and makes filtering/selection ambiguous. Derive a deterministic invocation key containing typed arguments (and target identity where needed), and use it for both `id` and `key` while keeping `data-command-id` as the stable catalog ID.

### P1 — palette drops the catalog's mixed checked state

`StudioCommandPaletteItem.checked` is boolean (`apps/studio/src/features/editor/command-palette.tsx:14-24`), while the domain model supports `boolean | "mixed"` (`packages/editor/src/product-commands.ts:140-145`). Studio maps `command.checked === true` (`apps/studio/src/features/studio-shell.tsx:1593`), silently converting `mixed` to false and rendering it as unchecked. Preserve the tri-state in the palette model or deliberately omit checked semantics for palette rows; do not show a contradictory state.

### P1 — disabled reasons are exposed as descriptions, not reliably visible/announced

Menu rows put the reason in a nested truncated span and `aria-description` (`apps/studio/src/features/editor/product-command-menu.tsx:50-59,80-88`). `aria-description` support is inconsistent in the target browser matrix, and the reason is visually truncated at 72 characters. The palette repeats the same pattern (`apps/studio/src/features/editor/command-palette.tsx:116-126`) without an explicit live announcement of the disabled reason when focus changes. Use a stable labelled description element (`aria-describedby`) with a non-truncated accessible name/description, and keep the visual copy readable for important lock/review/stale cases.

### P1 — menubar is hidden at the exact compact/desktop boundary where discovery is needed

`ProductCommandMenubar` is rendered only under `min-[1600px]:block` (`apps/studio/src/features/studio-shell.tsx:1728-1737`). At widths from 640 through 1599, the app menus are absent; the compact overflow is a different handwritten action surface. This violates the “same model at every width” requirement unless the overflow is proven to use `ProductCommandDropdownGroups` for all equivalent actions. Verify that fallback and add responsive mounted tests at the boundary widths.

### P1 — runtime acceptance does not distinguish a handler that did nothing

`createProductCommandRuntime.run` returns `accepted` for every executor result except literal `false` (`packages/editor/src/product-commands.ts:988-1002`). Many host handlers return `true` after opening a dialog, but a stale/unsupported handler can accidentally return `undefined` and be accepted. The structure fallthrough currently returns false, demonstrating the mismatch. Prefer an explicit typed execution result (accepted/declined) and require every catalog command to have a handler in a tested dispatch table.

## Verification limits

This was a read-only code review. I did not start the browser or claim healthy-host keyboard, focus, portal, pointer, or accessibility evidence. The host remains unsuitable for browser verification because of the known orphaned `workerd` process.
