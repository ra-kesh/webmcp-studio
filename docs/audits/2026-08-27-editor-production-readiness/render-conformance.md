# Render conformance contract

`renderConformanceDocument` is the versioned golden document for CONFORM-01. It contains every current scene node type and the properties most likely to drift: rotation, opacity, text metrics and whitespace, image fit and focal position, shape stroke and radius, hidden and locked state, mixed page sizes, page backgrounds, page order, and PNG/PDF output combinations.

The non-browser gate is:

```sh
bun run verify:conformance:structure
```

It checks canonical projections against the actual React style mapper and Renderer HTML serializer. Fabric shapes use the synchronous object mapper; Fabric text uses the pure property projection because constructing and measuring a `Textbox` is browser-dependent. Package tests cover image crop math, text sizing policy, and typography separately. This catches dropped properties and incompatible geometry policy. It does not prove that CSS and Fabric produce identical text line breaks, glyph bounds, or pixels.

The pixel gate expects captures under `docs/audits/2026-08-27-editor-production-readiness/artifacts/`:

```text
artifacts/
  fabric/{properties-page,long-text-page,square-page}.png
  render-view/{properties-page,long-text-page,square-page}.png
  renderer-png/{properties-page,long-text-page,square-page}.png
  renderer-pdf/{properties-page,long-text-page}.png
```

Capture every file at the canonical page dimensions with device scale factor 1 and the embedded managed Geist face loaded. Rasterize PDF pages to those same pixel dimensions without resampling. Then run:

```sh
bun run verify:conformance:pixels
```

The checked-in manifest requires exact dimensions. A pixel differs when any RGBA channel differs by more than 24. Each comparison allows at most 1.5 percent differing pixels and an RGBA RMSE of 6. The command writes red-on-gray diff PNGs plus `render-conformance-report.json`, and returns a nonzero status when either threshold fails. CI should retain the source captures, diffs, and report for every failed run.

Renderer PNG is the comparison baseline because it is the customer artifact path, not because it is assumed correct. A baseline update requires review against the canonical document and all other implementations. The gate must include deployed Browser Rendering before CONFORM-01 can close.
