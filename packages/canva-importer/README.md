# Canva importer

This package turns a `StudioInterchangePackage` into a Canva import plan. It
does not claim to be a hosted Canva app. The repository does not currently
contain `@canva/design`, `@canva/asset`, a Canva app manifest, or Developer
Portal credentials.

Use `planCanvaImport` to inspect the conversion without side effects. A Canva
app calls `importStudioInterchangeToCanva` with its `CanvaImportHost` adapter.

`planCanvaImport` emits the Canva absolute-page concepts that Studio can map
without flattening everything:

- text becomes editable Canva text with range and paragraph formatting;
- rectangles, ellipses, lines, icons, polygons, stars, and vector paths become
  editable Canva shapes;
- default center-cropped image frames become shapes with Canva image fills;
- contiguous leaf groups become Canva groups;
- layer order stays back to front.

The plan requests a PNG only for the smallest selection Canva cannot reproduce
reliably. Current rasterization triggers are mask groups, effects, blend modes,
flips, non-default image placement, unsupported paint stacks, and frame clips.
The compatibility report lists every request and every Studio behavior that
will remain metadata only.

## Canva app boundary

A Canva app implements `CanvaImportHost` with its installed Apps SDK version:

1. `ensureAbsolutePage` selects a compatible absolute page. If the installed
   SDK cannot add pages, the host must require a design with enough pages or
   hand page creation to a separate Canva API flow.
2. `uploadImage` uses `@canva/asset` and returns the opaque Canva asset ref.
3. `renderAndUploadRaster` asks Studio's authenticated renderer for the exact
   selection and uploads that PNG.
4. `insertElements` translates the SDK-neutral plan to Canva `text`, `shape`,
   `rect`, and `group` elements in one design-editing session.
5. `completeImport` calls the SDK sync operation and records the compatibility
   report for the user.

The host must request `canva:design:content:write` and
`canva:asset:private:write`. Canva must be able to fetch image URLs, so local
and authenticated Studio assets need a short-lived public download URL or an
uploaded data URL.

Useful Canva references:

- https://www.canva.dev/docs/apps/design-editing/
- https://www.canva.dev/docs/apps/creating-shapes/
- https://www.canva.dev/docs/apps/creating-images/
