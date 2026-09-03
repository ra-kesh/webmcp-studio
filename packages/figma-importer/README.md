# Studio Interchange Importer for Figma

This development plugin rebuilds a Studio interchange package as editable Figma pages and layers.

## Run it locally

```sh
bun install
bun run --filter @webmcp/figma-importer build
```

In the Figma desktop app, open **Plugins > Development > Import plugin from manifest** and choose `packages/figma-importer/manifest.json`.

The importer accepts a local JSON file, pasted JSON, or a handoff URL that returns a `StudioInterchangePackage`.

## Current mapping

- Studio pages become Figma pages with one page-sized frame.
- Text, rectangles, ellipses, lines, polygons, stars, frames, and SVG paths stay editable.
- Image layers become editable shape layers with image fills.
- Frame ownership and compatible organize groups become Figma hierarchy.
- Opacity, rotation, visibility, locking, solid paints, basic gradients, strokes, blend modes, and supported effects are mapped.
- Every imported page, group, and layer keeps its Studio ID in Figma plugin data.

The plugin reports unsupported or lossy mappings after each import. Studio field bindings, design variables, component semantics, multiple mask sources, independent stroke widths, and renderer-specific text shaping do not yet have exact Figma equivalents.
