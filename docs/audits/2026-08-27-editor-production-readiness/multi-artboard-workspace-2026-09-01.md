# Multi-artboard workspace integration record

Date: 2026-09-01
Branch: `codex/multi-artboard-workspace`
Base: `bcb5cf9`

## Delivered commits

- `58ea084` — page/world layout, coordinate mapping, active-page derivation, culling, keyboard navigation, and camera fit models.
- `38dd799` — page-scoped render-controller registry and lifecycle ownership.
- `6116bc6` — continuous artboard host, lightweight offscreen shells, and page-local document sync identities.
- `dde365c` — Studio shell wiring, compact Pages navigator, filmstrip removal, page/selection/all zoom, and screen-space overlays.
- The final acceptance commit adds the real six-page quotation fixture, the 11px navigator metadata floor, and this record.

## Behavioral contract

- Document pages and nodes retain canonical page-local coordinates. World coordinates exist only in editor layout and camera state.
- Selection ownership wins active-page derivation, followed by explicit page focus, followed by the page nearest the camera center.
- Pages navigation centers the chosen artboard. Clicking an artboard activates it without rewriting document geometry.
- The workspace retains one lightweight shell per page, mounts Fabric only for the overscanned visibility set, and pins active/selected/crop/text-edit pages until interaction ends.
- Each mounted page receives only its own selection, hover, crop, text-edit, guide, and document-sync identity. A local edit therefore invalidates only its owning page.
- Rulers and selection/text/image toolbars remain screen-space projections of the active page. Export, persistence, renderer, and WebMCP contracts remain page-local and unchanged.
- Compact/coarse-pointer controls retain 44px targets. The Pages list follows canonical order and supports Arrow Up/Down, Home/End, and Page Up/Down navigation.

## Exact StudioShell integration seam

`apps/studio/src/features/studio-shell.tsx` is the intentional overlap point with concurrent Inspector work. Integrate it as a deliberate three-way merge; do not take either whole-file version.

Preserve the multi-artboard side of the seam:

1. Imports and lazy boundaries for `MultiArtboardLayoutController`, `WorkspaceCameraController`, `deriveActivePageId`, `visiblePageIds`, `buildMultiArtboardPageSyncIdentities`, and `MultiArtboardWorkspace`.
2. Camera/world refs and callbacks from layout creation through `settleCameraState`, `applyCamera`, `fitCanvas`, `fitAllPages`, `focusBounds`, `focusPage`, `activateArtboard`, and `addPageAndFocus`.
3. The `artboardHandlesRef` map, mounted/interaction page sets, and active-handle projection back to the existing `artboardRef` consumer seam.
4. The canvas JSX boundary: one camera transform wrapping `MultiArtboardWorkspace`, one page-scoped `FabricArtboard` per mounted page, then ruler/toolbars outside that transform.
5. `QuotationSidebar` page callbacks must remain `focusPage`/`addPageAndFocus`, and `CanvasZoomControls` must retain `onFitAll`.
6. Filmstrip imports, thumbnail producer state, image-resource thumbnail events, filmstrip JSX, and filmstrip-dependent bottom offsets stay removed.

Preserve concurrent Inspector prop/API changes around both `InspectorSidebar` call sites. This branch intentionally does not modify `use-document-editor.ts`, Inspector controls, Inspector schema, or global theme CSS.

`apps/studio/src/features/editor/fabric-artboard.tsx` has a second narrow seam: keep the optional `documentSyncIdentity` prop and use it as the document-sync effect dependency. When integrating the render-controller architecture branch, attach each page adapter/controller through `MultiArtboardRenderRegistry`; do not restore whole-document sync on camera-only updates.

## Verification evidence

- Six-page quotation: all six ordered shells and live artboards render in one workspace; labels retain canonical page names.
- 100-page mixed-size fixture: 100 shells remain reachable while only three overscanned pages mount; 97 stay lightweight placeholders.
- Feature interaction suite: page navigator, zoom controls, page sync, workspace host, Fabric lifecycle, gesture navigation, and template-sidebar tests pass.
- Serial rerun of the five editor tests that failed under concurrent package load: 5 passed, 154 skipped.
- Editor and Studio typechecks pass.
- Studio production client/SSR/renderer build passes.
- Render conformance structure passes for 11 canonical nodes, 3 Fabric text projections, and 6 synchronous non-image Fabric objects.

The package-wide Studio run completed with 1814 passing and 21 failing tests. The failures are outside this feature surface and include timing-sensitive persistence/virtualization/asset tests plus known baseline visual-contract and thumbnail-server assertions. The package-wide editor run completed with 378 passing and five timing failures; all five passed when rerun serially without concurrent package load. No deployment was performed.

### Camera settlement and short-document warming

Canvas pan and wheel previews remain imperative and frame-batched. Settled
camera coordinates now update only the virtualized artboard workspace rather
than writing an `{x, y}` object into `StudioShell` state and reconciling both
sidebars, the application header and the inspector after every pan.

Documents with up to eight pages keep their editable Fabric canvases mounted.
This removes first-scroll canvas initialization hitches from the common Studio
document size. Documents above that threshold continue to mount only the
visible overscan set plus interaction-pinned pages, preserving bounded memory
for the 100-page contract.

Camera navigation no longer changes the document's active page merely because
an artboard crosses the viewport center. That coupling caused the page rail to
scroll its active row and made the File rail, inspector and other shell regions
reconcile during ordinary canvas scrolling. Page activation is now explicit:
click a page row, click an artboard, or select content on that page. Wheel and
pan gestures own camera position only.

## 2026-09-02 File rail consolidation

Studio's document rail now follows OpenPencil's current `LayersPanel.vue`
ownership model: page navigation and the layer tree are persistent vertical
regions in one File workspace instead of mutually exclusive Pages and Layers
tabs. Templates and Assets remain separate Studio workspaces because they own
catalog and insertion workflows that do not belong to the document tree.

- The File workspace uses the reference's 30/70 default split, with Pages above
  Layers and independent scrolling in both regions.
- Existing page centering, add-page, keyboard navigation, virtualized layer
  tree, selection, search, rename, lock/visibility and reorder behavior remain
  on their existing components.
- A legacy in-memory `pages` tab value maps to File during hot reload, avoiding
  a blank panel during the cutover.
- Focused mounted evidence passes 4/4, Studio typecheck passes, and a live
  1280×720 check on port 3001 confirmed both regions, their independent bounds,
  and no console errors.

### Vercel rhythm follow-up

The first combined rail overused horizontal rules: tabs, Pages header, the
section seam, Layers header and search metadata each drew their own boundary.
The follow-up retains only the workspace-tabs rule and one semantic Pages/Layers
separator. Headers and search metadata now group through Vercel's 4/8/12 px
spacing rhythm rather than repeated borders. The Pages pane sizes to its actual
row count up to 48% of the rail, so the six-page quotation is fully visible at
1280×720 while larger documents still scroll. The active tab keeps a visible
one-pixel inset keyboard-focus ring without the previous bordered blue box.

The integrated File rail now omits layer search and uses one compact Layers
header: the canonical layer total sits beside the title while stack order stays
right-aligned. Standalone layer-tree surfaces retain search for larger,
dedicated navigation contexts.

File is now the first and default document-rail workspace. Templates and Assets
follow as insertion libraries. The rail uses the existing shadcn segmented Tabs
variant instead of a full-width underline navigation row, keeping all three
choices inside one compact control with a contained keyboard-focus treatment.

The Assets workspace temporarily exposes only the media browser. Removing the
Media / Components switch leaves one clear level of media scope navigation
(`Recent`, `Uploads`, `Library`, and `Favorites`) while component-library
placement is reconsidered.

Page rows in the File rail now expose the canonical page command menu through
right-click and `Shift+F10`. Rename, duplicate, add, reorder and delete use the
same validated product-command runtime and confirmation dialogs as the existing
page/output management surfaces.

Floating editor controls are now isolated from workspace double-click zoom.
The workspace rejects events originating inside any registered overlay control,
and the text-formatting toolbar also consumes its own double-clicks. A live
check held canvas zoom at 32% before and after repeated toolbar interaction.

### Application header hierarchy

The desktop application menus now occupy the primary top-left position beside
the Studio home control. They continue to use the canonical product-command
runtime, including command availability, shortcuts and checked states; the
far-right overflow exposes the same menus only as a narrow-screen fallback.

Document identity moved out of the application-command region. A centered
context header above the canvas now pairs the document name with the active
page name and uses the same height, border and surface tokens as the left and
right panel headers. The canvas ruler begins below this shared header line, so
application navigation, document context and canvas measurement each have one
clear level without introducing another command path.
