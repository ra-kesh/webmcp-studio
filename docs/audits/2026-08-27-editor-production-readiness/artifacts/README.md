# Conformance artifacts

`render-view`, `fabric`, `renderer-png`, and `renderer-pdf` come from the last
complete 2026-08-29 lossless capture through Studio on port 3001. The browser
surfaces are Playwright locator PNGs at device scale factor 1. Renderer PNG and
the raw PDF came through the actual Studio service-binding routes. PDF page PNGs
were rasterized at 96 DPI with no resizing. Exact sizes and hashes are recorded
in `../render-conformance-capture-report.json`.

This checked-in set predates the version-2 atomic layout and remains readable as
a legacy version-1 report. New successful captures are immutable under
`runs/<run-id>/`; the report is the atomic pointer to the current complete run.
The verifier checks every reported byte length and SHA-256 before comparison,
so a partial, stale, or manually mixed source set cannot enter the pixel gate.

`diff` and `../render-conformance-report.json` are the raw comparison outputs
for that same complete run. The later font-shaping, baseline, line, icon, and
font-smoothing repairs could not receive a new complete Renderer capture because
Cloudflare Browser Rendering exhausted its new-session rate. The capture runner
discarded that partial staging run. No further remote capture should be started
until the account plan/allowance is confirmed. Treat the retained files as coherent
pre-repair evidence and the focused post-repair numbers in
`../render-conformance.md` as local repair evidence; do not mix their claims.

`browser-sheet` retains the older JPEG-derived visual diagnostic and is not an
acceptance baseline.
