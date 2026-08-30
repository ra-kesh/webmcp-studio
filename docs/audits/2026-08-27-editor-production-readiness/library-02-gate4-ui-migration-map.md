# LIBRARY-02 Gate 4 UI migration map

Date: 2026-08-31

Status: implementation map; no production changes in this pass

## Current evidence

- `template-catalog-panel.tsx` and the private `TemplateBrowser` inside
  `studio-start-surface.tsx` independently own search, category filtering,
  selection, empty/loading/failure UI, cards and selected details.
- Both consume `DesignTemplateCatalogItem`, which carries a preview document.
  Gate 4 list state must instead contain compact `LibraryTemplateSummary`
  values only.
- `use-document-editor.ts` currently loads the built-in repository into React
  state. Search therefore remains tied to editor-owned catalog state and the
  editor shell is still the catalog owner.
- `studioLibraryCatalogIndex` already exposes 21 compact template summaries and
  37 media summaries with exact paged query contracts. The exact-detail map
  already resolves `{ itemKind, id, version }` without widening list payloads.
- `LibraryPreviewProvider` is already mounted once under `/_studio`, and both
  existing template surfaces use `LibraryPreview`. Keep that single provider
  and its global three-fetch budget.
- `recent-documents-controller.ts` and `recent-documents-provider.tsx` are the
  local ownership precedent. `layer-tree.tsx` and `recent-documents.tsx` contain
  the existing TanStack Virtual focus/range patterns. The library grid must use
  container measurement rather than the window-width logic still present in
  `VirtualizedDocumentCollection`.

## Target ownership

```text
/_studio route
  LibraryPreviewProvider (one global preview scheduler)
  LibraryDiscoveryProvider (one catalog controller)
    Start surface lease ─┐
                         ├─ LibraryTemplateBrowser
    Editor surface lease ┘     variant: start | editor
```

The discovery controller owns query and result truth. The shared browser owns
only presentation state that is local to a mounted surface, such as its
selected identity, details disclosure and apply-confirmation dialog. Neither
browser variant reads `builtInDesignTemplateRepository` or stores full
documents.

## New boundaries

### Discovery

- [ ] Add `apps/studio/src/content/library/library-discovery-controller.ts`.
      Its injected port is exactly asynchronous and signal-aware:
      `list(query, signal)`, `getDetail(kind, id, version, signal)`,
      `getTaxonomy()`, and `scheduleQuery(callback, delay)`.
- [ ] State owns raw and applied search, item kind, category, use case, format,
      orientation, owner, favorite/collection, order/entry point, confirmed and
      retained pages, cursor, replacement and append failures, announcement,
      focus intent, generation and query identity.
- [ ] Every replacement gets a fresh generation and aborts both replacement
      and pagination. Append reuses the confirmed generation/query/cursor and
      rechecks all three before deduplicating exact identities.
- [ ] Same-query refresh retains the confirmed grid. A changed query may retain
      the old grid only with visible `Updating results` text and `aria-busy`; its
      old count is never announced as the new result.
- [ ] Add `library-discovery-adapter.ts` around the current index/detail map.
      Keep it Promise-based and check `signal.aborted` before and after the local
      lookup so the contract survives a future remote implementation.
- [ ] Add a validated, complete taxonomy projection from the complete catalog,
      never from the current page. Labels include categories, use cases, format
      families, orientations and owners; owner labels are exactly `Studio` and
      `Your workspace`.
- [ ] Add `library-discovery-provider.tsx` beside the controller. Construct it
      once under `/_studio`, expose state with `useSyncExternalStore`, and expose a
      retain/release lease so Start and editor visibility do not create controllers.

### Shared browser

- [ ] Add `library-template-browser.tsx` with `variant="start" | "editor"` and
      comfortable/compact density. Both variants render the same search, entry
      chips, filter model, cards, selection, preview, details and status surfaces.
- [ ] The Start variant offers Featured, Recent and Favorites; complete search;
      compact filters; a 2–4 column grid; and a full selected-detail pane. Its only
      template mutation is Create. Blank, Import, sample and Recent documents stay
      separate in `StudioStartSurface`.
- [ ] The editor variant offers horizontal entry chips, compact search, filters
      in a popover/sheet, a 1–2 column grid and compact details. Create remains
      primary; Apply stays explicit and retains the existing impact confirmation.
      The quotation layer-organization notice remains outside the shared browser.
- [ ] Cards receive `LibraryTemplateSummary`, use its exact preview descriptor,
      and emit only `{ itemKind: "template", id, version }` intents. No card mounts
      an `Artboard` unless the descriptor explicitly says `live_fallback`.

## Mutation authority

List summaries are never passed directly into Create or Apply.

1. Resolve `getDetail("template", id, version, signal)` at the action boundary.
2. Reject a missing or mismatched kind, ID, version, materialization identity,
   retired status, `canUse: false`, unavailable compatibility, missing requested
   action, or unmet `quotation_source` requirement.
3. Re-read the current document/source/review generation after the async detail
   lookup. If it changed, ask the user to choose the action again.
4. Pass the exact detail materialization ID/version into the existing
   `prepareCreateFromTemplate` or `prepareApplyTemplate` lifecycle. Those
   functions remain the final document/source validation boundary.
5. Compute Apply impact from the exact resolved version before opening the
   confirmation dialog, then revalidate the detail and current-document
   generation again on confirmation.

Put this orchestration in a tested `library-template-actions.ts` owner or in the
existing editor action owner, not in a card component. Abort it when the surface
unmounts, the active document changes, or a newer action supersedes it.

## Container layout and virtualization

- [ ] Measure the browser grid host with one `ResizeObserver`; do not read
      `window.innerWidth`. Start columns are 2/3/4 from host width. Editor columns
      are 1/2. Recompute virtual rows when the measured column count changes.
- [ ] At 48 items or fewer, render one semantic `<ul>` and apply
      `content-visibility: auto` plus a stable intrinsic size to cards.
- [ ] Above 48 items, virtualize rows with `useVirtualizer`, stable exact item
      keys, measured row heights, overscan and a range extractor that retains the
      selected/focus-target row. Expose `aria-setsize` and `aria-posinset` on
      virtualized list items so semantic order remains inspectable.
- [ ] When selection or focus intent targets an unmounted item, scroll its row,
      wait until it enters the virtual range, then focus it. Never focus a detached
      card or reset scroll because a preview settles.
- [ ] Only the currently rendered responsive tree retains previews. A CSS-hidden
      desktop panel and a compact sheet must not both hold discovery or preview
      leases.

## Interaction and state checklist

- [ ] Search and every filter have visible or programmatic labels. Filter groups
      use fieldset/legend or equivalent labelled grouping.
- [ ] One aggregate polite region announces confirmed result changes, loading,
      update completion and pagination. Preview failures remain local to their card.
- [ ] Incompatible cards remain selectable and inspectable; only their mutation
      controls are disabled, with the reason visible in details.
- [ ] Card selection, Favorite, overflow menu and preview Retry are sibling
      controls. No interactive control is nested inside another.
- [ ] Search retains focus while typing. If the selected item disappears,
      select the first exact result deterministically without stealing focus. If the
      focused card disappears, move focus by controller intent to the next result or
      search.
- [ ] Replacement failure with retained data shows a recoverable inline alert;
      initial failure uses the full empty-state error. Append failure appears beside
      Load More and never replaces the confirmed grid.
- [ ] Load More retains focus while it remains. When the final append removes the
      control, focus a labelled pagination-status target and announce completion.
- [ ] Compact interactive targets are at least 44 px. Skeleton and grid geometry
      remain stable. Motion is limited to opacity/transform and disabled under
      reduced motion.

## Exact production migration

| File                                                         | Required change                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/studio/src/routes/_studio/route.tsx`                   | Mount one `LibraryDiscoveryProvider` beside the existing single preview provider.                                                                                                  |
| `apps/studio/src/content/library/catalog.ts`                 | Supply the async adapter inputs and complete taxonomy source without exposing full documents or bytes.                                                                             |
| `apps/studio/src/content/library/index.ts`                   | Export the discovery/provider/browser public boundary.                                                                                                                             |
| `apps/studio/src/features/editor/studio-start-surface.tsx`   | Delete its private `TemplateBrowser`, preview, filter, card and detail implementations; mount the shared Start variant while retaining Blank, Import, sample and Recent documents. |
| `apps/studio/src/features/editor/quotation-sidebar.tsx`      | Replace `TemplateCatalogPanel` with the shared editor variant; keep layer organization separate.                                                                                   |
| `apps/studio/src/features/editor/studio-shell.tsx`           | Stop threading repository catalog arrays/loading/retry props; pass capability and exact identity action ports, and ensure only the visible editor surface holds a lease.           |
| `apps/studio/src/features/editor/use-document-editor.ts`     | Remove `designTemplateCatalog` React state and reload effect. Keep create/apply lifecycle, adding exact detail and document-generation revalidation at its action boundary.        |
| `apps/studio/src/features/editor/template-catalog-panel.tsx` | Delete after parity; all reusable UI moves to `LibraryTemplateBrowser`.                                                                                                            |
| `apps/studio/src/features/editor/template-catalog-model.ts`  | Delete local filtering/category derivation/preview-document helpers. Move only impact-row projection and identity helpers that remain useful to the shared model.                  |

## Exact test migration

- [ ] Add `library-discovery-controller.test.ts`: stale replacement, stale
      cursor, changed query, same-query retained refresh, separate append failure,
      dedupe, abort/dispose, deterministic selection/focus and 500-item timing.
- [ ] Add `library-discovery-provider.strict-mode.test.tsx`: one controller,
      one lease per visible surface, delayed StrictMode disposal and no hidden-tree
      duplicate activation.
- [ ] Add `library-discovery-adapter.test.ts`: compact list payload, exact detail,
      complete taxonomy, signal rejection and stable async behavior.
- [ ] Add `library-template-actions.test.ts`: exact detail mismatch, permission,
      compatibility/action/source rejection, document-generation race, exact create
      and apply handoff, and confirmation-time revalidation.
- [ ] Replace `template-catalog-panel.test.ts` with
      `library-template-browser.test.tsx`: both variants, one selection model,
      inspectable incompatibility, separate controls, retained/update/failure
      states, aggregate announcements and no normal-grid `Artboard`.
- [ ] Add `library-template-browser.virtualization.mounted.test.tsx`:
      ResizeObserver-driven 1/2 and 2/3/4 columns, threshold at 49, semantic order,
      selected/focus row retention, Load More focus and preview retain only for
      mounted near-visible cards.
- [ ] Update `studio-start-surface.test.tsx` to assert the retained non-template
      choices plus the shared Start variant contract, not duplicate card/filter
      markup.
- [ ] Update `studio-persistence-layout.test.ts` for the single discovery and
      preview provider order.
- [ ] Retire the filtering/category/preview-document cases in
      `template-catalog-model.test.ts`; preserve the apply-impact assertions in the
      new shared model/action test.
- [ ] Keep `template-lifecycle.test.ts` as final `prepareCreate`/`prepareApply`
      conformance and add a mounted shell regression proving search input does not
      rerender or replace the active editor document.

## Gate exit

Gate 4 closes only when both surfaces use the one browser/controller, Create and
Apply revalidate exact details, the 49-item path is virtualized from container
width, hidden trees do no work, all retained/update/error/focus states are
covered, normal grids contain no live renderers, and independent review reports
no P0/P1 findings.
