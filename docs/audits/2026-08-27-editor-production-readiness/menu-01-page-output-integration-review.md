# MENU-01 page/output integration review

Date: 2026-08-28
Reviewer: bounded independent read-only pass
Status: integration plan; no code changes made

## Executive finding

The page/output command builders now exist in `packages/editor/src/product-commands.ts`, but page and output surfaces are still an older command island. `PageOutputPanel` and `PageFilmstrip` render handwritten dropdowns and callback handlers; neither receives the product runtime or a generated target-aware menu. `QuotationSidebar` does not plumb the runtime into either surface, and `studio-shell.tsx` only wraps the canvas with `ProductCommandContextMenu`.

This means the same action currently has two sources of truth: the generated product model (which can be enabled and invoked through the shell runtime) and local UI menus (which call callbacks directly and use their own booleans). The required parity is not achieved until right-click, Shift+F10/Context Menu key, and existing ellipsis menus all resolve the same invocation model and target semantics.

## Evidence from the current tree

- `apps/studio/src/features/editor/page-output-panel.tsx` owns page/output state dialogs (`settingsPageId`, `renameOutputId`, `newOutputOpen`, `deleteTarget`) and directly calls `onAddPage`, `onDuplicatePage`, `onUpdatePage`, `onRemovePage`, `onReorderPage`, `onAddOutput`, `onUpdateOutput`, and `onRemoveOutput`.
- Its output and page ellipsis menus duplicate command IDs and enablement via `isDocumentStructureCommandEnabled`; they do not use `buildPageContextMenu` or `buildOutputContextMenu`.
- `apps/studio/src/features/editor/page-filmstrip.tsx` owns a separate page ellipsis menu with duplicate/move/delete actions and direct callback execution. Page selector keyboard behavior handles navigation, but there is no context-menu entry point.
- `apps/studio/src/features/editor/quotation-sidebar.tsx` passes document/selection and structural callbacks to `PageOutputPanel` and `LayerTree`, but has no `ProductCommandRuntimeContext` or `ProductCommandMenuRuntime` props.
- `apps/studio/src/features/studio-shell.tsx` constructs the live product context/runtime and generated page/output builders are available there, but the runtime is not passed to the sidebar or filmstrip. The filmstrip call near the editor bottom passes only document, page callbacks, raster, and image-resource props.
- `ProductCommandContextMenu` in `apps/studio/src/features/editor/product-command-menu.tsx` is the correct Radix primitive to reuse. It is `asChild`, so the trigger must be an actual DOM row/card wrapper, not a custom component that drops injected props/ref.
- `buildPageContextMenu` and `buildOutputContextMenu` emit typed page/output targets and include update, duplicate/add, ordering/export, and destructive commands. They are the canonical model for this integration.

## Recommended implementation sequence

### 1. Plumb one live runtime through sidebar and filmstrip

Add optional props to `QuotationSidebar` and `PageOutputPanelProps`:

```ts
productCommandContext?: ProductCommandRuntimeContext
productCommandRuntime?: ProductCommandMenuRuntime
```

Pass both from the two shell sidebar render sites. Pass them to `PageFilmstrip` as well. Keep them optional temporarily so existing mounted tests and isolated story fixtures remain valid; production shell should always provide both.

Do not create a second executor in these components. The shell runtime must remain the only authority for invocation and final stale-target/review/invariant checks.

### 2. Define target selection at the page/output boundary

For a page card/row:

- Build `ProductCommandTarget` with `kind: "page"`, `pageId`, document/snapshot identity, and page display name.
- On pointer right-click, select that page before Radix opens the menu. The selection callback must be idempotent and must not change the selected canvas node set.
- On keyboard context entry, the focused page selector/card becomes the target, then opens the same menu. Support both `Shift+F10` and `event.key === "ContextMenu"`.
- If the user invokes a page command after the document changed, the shell runtime must decline the stale target; do not silently retarget to the newly active page.

For an output section/header:

- Build `ProductCommandTarget` with `kind: "output"`, `outputId`, identity, and output display name.
- Right-clicking anywhere in the output header targets the output. Right-clicking a page row targets the page, not its containing output.
- Keyboard context entry should be attached to a focusable output header or an explicit labelled menu trigger. Avoid making the whole section a second tab stop solely for context menus; use the existing header action button/heading wrapper with a documented `aria-keyshortcuts` route.

The page and output target must be captured when the menu opens and used by every item in that menu. Do not read `activePageId` at execution time to reconstruct the target.

### 3. Wrap real DOM containers with Radix context menus

In `PageOutputPanel`:

- Wrap each output `<section>` or a dedicated output header DOM wrapper with `ProductCommandContextMenu groups={buildOutputContextMenu(...)} runtime={...}`.
- Wrap each page row (`div.group/page`) with a separate page context menu using `buildPageContextMenu(...)`.
- Keep the existing nested ellipsis `DropdownMenu` trigger inside the wrapper. Stop propagation only where needed so opening the ellipsis does not also open the context menu.
- Because `ContextMenuTrigger asChild` clones its child, use the actual `<section>`/`<div>` element as child. Do not pass a custom `PageRow` component unless it forwards every trigger prop and ref.

In `PageFilmstrip`:

- Extend `PageFilmstripProps` and `PageFilmstripItemProps` with the optional runtime/context.
- Wrap the existing per-page outer `div.group.relative...` with the page context menu. Preserve the existing selector button as the primary focusable element and ellipsis as the compact action.
- For right-click, the page context target is the page under the pointer. For keyboard entry, handle `Shift+F10`/Context Menu on the selector button and synthesize/open the Radix menu at the selector’s bounding-box anchor if the primitive requires a pointer event.
- Prefer a native Radix context trigger event path over a hand-positioned `role=menu` implementation.

### 4. Replace handwritten ellipsis rows with the shared model

The existing ellipsis menus should become renderers of the same `ProductMenuGroup[]` used for context menus. Use `ProductCommandDropdownItems`/`ProductCommandDropdownGroups` from `product-command-menu.tsx` and pass a target-specific context/runtime.

This removes the current divergence where:

- page settings/rename/delete invoke local dialog state directly;
- generated commands invoke shell structure dialogs through `executeProductCommand`;
- local menus use `isDocumentStructureCommandEnabled` while product menus use live runtime state.

The shell runtime already owns the structure-dialog route. Therefore the local page/output components should not retain a second rename/delete implementation for the product path. Either:

1. route generated invocations through the shell runtime and let the shell-owned dialogs open, or
2. expose a typed `onRunProductCommand` adapter that invokes the same runtime and remove duplicate dialog state after migration.

Do not make local dropdowns call raw callbacks after the migration; raw callbacks remain useful only as the shell executor’s canonical implementation.

### 5. Preserve compact affordances and focus

- Keep the existing 44px compact controls and the horizontal filmstrip scroll behavior.
- The ellipsis button remains a normal dropdown opener; context-menu access is additive and must not require hover.
- When a context menu closes, restore focus to the page selector or output action that opened it. For a pointer-opened menu, restore to the triggering row/button where possible.
- Escape must close the menu before it reaches canvas/page navigation. The Radix primitive owns menu focus; do not add a document-level Escape handler in page components.
- Add `aria-keyshortcuts="Shift+F10"` to focusable page selectors and a concise accessible description/help text indicating “Open page actions”. Do not put a keyboard shortcut on a non-focusable heading.
- Keep destructive invariant explanations visible/non-truncated: last-page removal and last-output removal must explain the exact reason in both dropdown and context menu.

## Required tests

### Pure model/runtime tests

Add a page/output integration test module (likely under `apps/studio/src/features/editor`):

- page target model uses the clicked page ID and correct output-relative index;
- output target model uses the clicked output ID;
- page move-up/down enablement differs correctly for first/middle/last page;
- `page.remove` is disabled with the “every output must keep at least one page” reason for a one-page output;
- `output.remove` is disabled with the “document must keep at least one output” reason for a one-output document;
- stale page/output target is declined after snapshot/document identity changes;
- review-pending state is identical in generated dropdown and context models;
- every generated item resolves to a registered command ID and typed target.

### Mounted tests without Vite

Extend or add mounted tests for both `PageOutputPanel` and `PageFilmstrip`:

- right-click page opens a menu containing the page’s name and page-target commands;
- right-click output header opens output-target commands and does not target the active page;
- existing ellipsis menu and context menu expose the same command IDs, labels, disabled state, and disabled reason;
- `Shift+F10` and Context Menu key open the same menu from a focused page selector and return focus after close;
- right-clicking a non-active page selects that page exactly once before invocation;
- clicking the nested ellipsis does not open the context menu;
- keyboard navigation through a filmstrip keeps only the active selector tabbable;
- compact controls remain at least 44px and context menu portals are not clipped by the scroll area;
- last-page/output destructive actions remain disabled and explain why.

### Browser evidence when host is healthy

Verify at desktop and compact widths: pointer right-click, Shift+F10, Context Menu key, focus restoration, scroll/portal collision, page selection, output targeting, review lockout, stale target, and screenshot parity. Do not claim this evidence while the known orphaned `workerd` keeps the browser host unhealthy.

## Risks to call out to the main implementation thread

- A context trigger around a custom memoized page item will silently fail if it does not forward Radix-injected props/ref. Wrap an actual DOM element.
- If the local page/output dialogs remain active alongside shell runtime dialogs, users will see different confirmation/focus behavior depending on entry surface.
- The filmstrip uses a virtualized/lazy thumbnail path and horizontal scroll area; menu portals must escape clipping, while trigger focus must remain on the selector.
- The filmstrip’s `PageFilmstripItem` currently accepts callbacks and booleans only. Threading the whole runtime through it should remain optional and memo-safe; derive a stable per-page target/model in the parent and avoid recreating callback closures unnecessarily.
- Output export is present in the generated output builder but not in the visible handwritten output menu. Confirm that the shell executor’s PDF export route is safe for the active output before exposing it in both surfaces.

## Conclusion

The next implementation slice should be page/output integration, not another command definition pass: plumb the existing live runtime, derive immutable page/output targets, wrap real DOM rows with Radix Context Menu, and make ellipsis menus render the same generated groups. Then prove parity with mounted tests before browser verification. This closes the remaining P0 context-menu gap without changing the page/output data contract or inventing new editor behavior.
