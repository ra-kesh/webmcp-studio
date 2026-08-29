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

The reproducible capture command is:

```sh
bun run capture:conformance
```

It verifies byte-stable document JSON, exact output/page ownership and order,
captures React and Fabric with lossless Playwright locator screenshots, invokes
the real Studio PNG/PDF routes sequentially, validates response headers and
magic bytes, rasterizes the returned PDF at one CSS pixel per output pixel, and
promotes a staged run only after every artifact is valid. A successful capture
is renamed into an immutable `artifacts/runs/<run-id>/` directory, then an
atomic report replacement points the verifier at that complete run. An
interrupted or failed capture therefore leaves the prior report and run
coherent. The pixel verifier validates every reported byte length and SHA-256,
requires runtime metadata for version-2 reports, and rejects comparison inputs
that are not owned by the report before decoding pixels. Renderer requests have
bounded attempts and a 30-second deadline. Browser Rendering capacity and
connection failures are exposed as stable retryable `503` responses.

## Local browser diagnostic, 2026-08-29

The checked-in `render-conformance-browser-manifest.json` is a narrower React
Artboard versus Fabric diagnostic. The dedicated `/render-conformance` route
marks each capture `ready` only after React fonts and images settle, Fabric
finishes sync, and two animation frames paint. An `error` state is terminal and
must not be captured. React and Fabric use the same exact per-page font
load/check contract; `document.fonts.ready` alone is not accepted because it can
settle while the requested managed face still falls back.

This run found and repaired three real contract defects:

- the fixture SVG now declares intrinsic width and height, so CSS and Fabric
  start from the same source dimensions;
- Fabric `auto_width` text preserves explicit newlines and never soft-wraps;
- Fabric waits for the exact managed font before measuring, converts its
  internal 1.13 glyph-line multiplier to CSS line-height semantics, and keeps
  fixed text at its canonical frame height.
- Fabric idle display consumes canonical projected lines exactly once. Direct
  editing and live resize switch to raw text for normal reflow, then restore
  the canonical projection on every transform exit.

The retained browser diagnostic report below predates the final canonical-line
repair. It remains useful evidence for the earlier SVG, font, line-height, and
auto-width defects, but must be regenerated with lossless captures before its
numbers can describe the current code:

| Page       | Different pixels | RGBA RMSE | Diagnostic result |
| ---------- | ---------------: | --------: | ----------------- |
| Properties |          2.3177% |   14.0508 | Fails             |
| Long text  |          5.5473% |   17.9172 | Fails             |
| Square     |          0.3239% |    4.9801 | Passes            |

The square result confirms that `AUTO WIDTH` is no longer clipped or wrapped.
The long-text line boxes now align within one pixel; the remaining difference
is mostly CSS text versus Canvas text rasterization and smaller glyph-width
differences. The source screenshots returned by the in-app browser are JPEG,
so the cropped PNG files and their report are retained as diagnostic evidence,
not as the lossless acceptance baseline described above.

## Local Renderer service path, 2026-08-29

Studio now passes the request-scoped Cloudflare Worker environment through the
TanStack Start server entry into every Renderer-calling server route. The local
Renderer auxiliary Worker has an explicit remote Browser Rendering binding,
and Studio's default development port is 3001 so it cannot collide with Stuwiz
on 3000.

Sequential end-to-end smoke evidence through the actual service binding now
returns:

- a valid 9,181-byte `image/png` for `square-page`;
- a valid 41,087-byte `%PDF-1.4` document for the two-page `mixed-document`
  output.

This closes the missing-local-binding blocker. It does not close CONFORM-01 or
EXPORT-01: lossless Renderer PNG/PDF captures still need to be retained and
compared against React/Fabric, and the same gate must run against a deployed
Renderer. Remote Browser Rendering can rate-limit concurrent new browser
sessions, so conformance capture is deliberately sequential until JOB-01 owns
bounded render concurrency and retry policy.

## Lossless capture and repair evidence, 2026-08-29

One complete local-service run retained 12 lossless artifacts: three React
pages, three Fabric pages, three Renderer PNGs, the raw two-page Renderer PDF,
and two exact-size PDF rasters. Every PNG matched its canonical dimensions;
the PDF preserved `mixed-document` page order and exact 720 x 960 and 640 x 360
page geometry. The machine-readable hashes and sizes are in
`render-conformance-capture-report.json`.

That capture exposed real, subsequently repaired implementation drift:

- React and Renderer now share grayscale/geometric font raster policy.
- Fabric canonical text uses native full-line Canvas shaping and letter spacing
  instead of Fabric's per-grapheme path.
- Fabric's managed-font baseline bridge is corrected by one pixel.
- Fabric line positioning compensates stroke-inclusive bounds while canonical
  transform round trips remain exact.
- Fabric icon paths compensate scaled stroke bounds inside the canonical SVG
  viewport.

Focused lossless screenshots of the repaired local surfaces, compared against
the last successful Renderer PNG baseline with the unchanged raw thresholds,
measure:

| Page       | React ratio / RMSE | Fabric ratio / RMSE | Raw result   |
| ---------- | -----------------: | ------------------: | ------------ |
| Properties |   0.2140% / 1.4709 |    0.9184% / 4.7245 | Pass         |
| Long text  |   1.2205% / 4.5212 |   1.9878% / 11.5152 | Fabric fails |
| Square     |   0.1060% / 2.2306 |    0.1228% / 2.2538 | Pass         |

The remaining long-text Fabric raw mismatch is Canvas-versus-CSS glyph
rasterization: canonical line strings, wrapping, x extents, and baselines are
already aligned. The acceptance gate must add an ink/baseline geometry check
that tolerates at most one edge pixel while retaining the raw report; it must
not raise the existing raw limit and hide line or icon displacement.

A post-repair full recapture is currently blocked by Cloudflare Browser
Rendering returning `browser_session_rate_limited` on the second page. The
runner exits coherently and removes staging output. Therefore the retained full
artifact set is labelled as the last complete capture, not falsely presented
as post-repair evidence. Deployed same-runtime capture and PDF raster evidence
remain open before CONFORM-01 / EXPORT-01 can close.
