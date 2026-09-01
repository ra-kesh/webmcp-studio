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
