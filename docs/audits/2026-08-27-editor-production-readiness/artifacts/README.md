# Conformance artifacts

The `render-view`, `fabric`, `diff`, and `browser-sheet` files in this directory
come from the 2026-08-29 local React-versus-Fabric diagnostic.

The in-app browser returned JPEG screenshot bytes. The page PNGs are exact-size
crops decoded from those JPEGs. They are useful for locating geometry and text
contract defects, but JPEG compression means they are not the lossless browser,
Renderer PNG, or rasterized PDF acceptance artifacts required by
`../render-conformance.md`.

`../render-conformance-report.json` records the matching diagnostic metrics.
That retained run predates the final repair that prevents Fabric from wrapping
canonical projected text lines a second time. Do not treat its numbers as a
measurement of the current code.
