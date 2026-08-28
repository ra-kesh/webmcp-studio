# MENU-01 final independent code review

Date: 2026-08-28
Reviewer: independent read-only pass after page/output and layer integrations

## Findings

### P1 — layer-targeted commands still execute against the live selection

The layer context model captures a node/group target and the layer row selects it on open, but the sole host executor does not verify or resolve that target. `object.rename` reads `editor.selectedNodes[0]`, visibility/lock mutate the current selection, and arrange/group/duplicate/delete commands are dispatched through `runEditorCommand` without checking `invocation.target` (`apps/studio/src/features/studio-shell.tsx:1425-1510`). A selection change between menu open and invocation can therefore mutate a different layer while the menu remains enabled. Add a final target-to-selection identity check and use target node IDs for target-scoped operations; add stale/changed-selection tests.

### P1 — output/page generated menus are present, but legacy fallback islands remain

When the product runtime props are absent, `PageOutputPanel` and `PageFilmstrip` retain handwritten dropdown command rows and direct callbacks (`apps/studio/src/features/editor/page-output-panel.tsx:253-302,408-501`; `apps/studio/src/features/editor/page-filmstrip.tsx:252-326`). This remains a fixture-only design concern: `QuotationSidebar` now requires both product props in its public production boundary, and `StudioShell` renders `ProductPageFilmstrip`, whose `Required<Pick<...>>` type requires both props. The production paths therefore cannot omit the generated runtime/model; the fallback branches may remain for isolated legacy fixtures.

### P1 — keyboard context dispatch on output header relies on a synthetic event path

The output ellipsis handler dispatches a synthetic `contextmenu` on the enclosing header (`apps/studio/src/features/editor/page-output-panel.tsx:241-246`), while the Radix trigger is the header wrapper. This is plausible, but it is not covered by a mounted test and can regress if event propagation or Radix's trigger filtering changes. Add a mounted test for Shift+F10/Context Menu from the output action and assert the output target, not the active page.

### P2 — native browser verification remains absent

The implementation uses Radix `ContextMenuTrigger asChild` around real DOM containers for canvas, layers, pages, outputs, and filmstrip items, and focus restoration hooks are present. However no healthy-host browser evidence exists for right-click, synthetic keyboard opening, nested dropdown propagation, portal collision, or focus restoration. The known orphaned `workerd` restriction means this is an evidence gap, not a claim of failure.

## Prior finding closure

- Page/output command handlers: closed; shell routes update/remove/add and target-validates IDs (`studio-shell.tsx:1511-1619`).
- Canvas/layer/page/output context-menu wiring: closed in code; all four surfaces now use the owned Radix wrapper and generated builders.
- Palette variant keys and mixed checked state: closed; invocation keys and tri-state mapping are implemented.
- Disabled-reason semantics: materially improved with `aria-describedby` and readable reason text in product menu and palette.
- Compact menu parity: generated product groups are used by the compact More menu and production page/output dropdown paths.
- Runtime acceptance: closed at the domain boundary; executor is typed to return boolean and only `true` is accepted.

## Review conclusion

The original P1 implementation risks are closed in the current tree. The remaining limitation is P2 evidence only: healthy-host browser verification of native pointer behavior, portal collision, and focus restoration has not been run. No production P1 remains from this review.

## Follow-up verdict (2026-08-28)

The earlier layer-target drift finding is closed in the current tree. `buildLayerContextMenu` converts the clicked node/group into a captured selection target (`packages/editor/src/product-commands.ts:1520-1525`), including node IDs and `groupId`. `validateProductCommandInvocation` now requires the same document/snapshot, active page, exact selection IDs, and group identity before execution (`packages/editor/src/product-commands.ts:643-655`); node/group targets also reject changed selection (`:666-692`). Thus a later selection change is declined before the shell's selection-based executor can mutate the wrong layer. The focused regression at `packages/editor/test/product-commands.test.ts:573-615` changes the captured selection from `[node-1,node-2]` to `[node-1,node-3]`, asserts `stale`, and verifies the executor is not called.

The prior production fallback concern is also closed at the type boundary: `QuotationSidebar` requires the product context/runtime, and `ProductPageFilmstrip` requires both before delegating to the compatibility component. Remaining handwritten branches are reachable only by direct isolated use of the compatibility components, not by Studio's production shell.

The synthetic output keyboard-path concern is closed by `apps/studio/src/features/editor/page-output-panel.context-menu.mounted.test.tsx`: the real `PageOutputPanel` and Radix path receive Shift+F10, render `output.update`, and invoke the captured output target ID. This leaves browser-level verification as the only outstanding evidence item.
