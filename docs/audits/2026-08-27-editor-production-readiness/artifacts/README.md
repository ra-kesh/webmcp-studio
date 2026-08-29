# Conformance artifacts

The selected capture is immutable run
`runs/2026-08-29T13-39-06.443Z-9baa78c6-b315-4788-bcd3-0a357e3ad709`.
It is a complete 2026-08-29 lossless capture through Studio on port 3001 and
the local Renderer service binding. Browser surfaces are Playwright locator
PNGs at device scale factor 1. Renderer PNG and the raw vector PDF came through
the actual Studio service-binding routes using Cloudflare's local Browser Run
simulation. PDF page PNGs were rasterized at 96 DPI with no resizing. Exact
sizes and hashes are recorded in `../render-conformance-capture-report.json`.

This checked-in set predates the version-2 atomic layout and remains readable as
a legacy version-1 report. New successful captures are immutable under
`runs/<run-id>/`; the report is the atomic pointer to the current complete run.
The verifier checks every reported byte length and SHA-256 before comparison,
so a partial, stale, or manually mixed source set cannot enter the pixel gate.

`diff` and `../render-conformance-report.json` are the unchanged raw pixel
outputs for that selected run. The report also contains the strict text-only
ink-geometry result. Raw ratios and RMSE are never removed or weakened;
geometry can substitute only when the manifest proves one visible text node is
the complete canonical page content. Its ink scan covers the whole page, not
only the declared text frame. A line-count change, missing ink, or any
top/bottom/left/right line-band displacement above one pixel fails. Every line
also has bounded ink-pixel coverage, upper-quartile contrast, and foreground
color direction, so matching outer edges cannot hide missing glyph interiors,
wrong hue, or materially reduced opacity.

The older top-level `render-view`, `fabric`, `renderer-png`, and `renderer-pdf`
folders remain legacy version-1 evidence. The version-2 report no longer selects
them. Remote/deployed Browser Rendering has not been recaptured and remains a
separate release gate.

`browser-sheet` retains the older JPEG-derived visual diagnostic and is not an
acceptance baseline.
