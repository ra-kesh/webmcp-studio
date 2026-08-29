# PERF-01 renderer-backed thumbnails

Status: the authenticated Studio and private Renderer contracts are implemented
locally. Deployed Browser Rendering and browser cache-integration evidence are
still required.

## Public request contract

Studio accepts:

```http
POST /v1/studio/page-thumbnail
Content-Type: application/json
Content-Length: <exact JSON byte length>
```

```ts
const body = {
  pageId: "cover",
  size: { width: 124, height: 175 },
  document,
}
```

`document` is a canonical Studio document containing the requested page. The
client projects the current full snapshot to one output/page and only that
page's pixel-render dependencies: nodes and page-owned groups. Canonical field
commands already apply bound values to nodes, and the HTML renderer paints only
nodes, so fields, field values, and bindings are deliberately removed rather
than duplicating managed image bytes. Studio repeats this projection
defensively, so a 100-page editor document does not inherit the publication
renderer's 40-page aggregate limit or send unrelated resources to Browser
Rendering. Width and height must be integers between 1 and 512. The pair must
match the source page's aspect ratio after canonical nearest-pixel rounding;
an otherwise subpixel short axis is clamped to one pixel while the limiting
axis preserves uniform scale. The endpoint rejects mismatched pairs before
managed asset reads or capacity reservation.

The Studio boundary authenticates the principal, materializes managed image
sources into a transient render clone, proves the exact node, asset, source
hash, and source dimensions, validates the complete render document, and
reserves one thumbnail-specific render-capacity lease. Cancellation is checked
before, during, and after managed-resource preparation and before/after
capacity reservation, then the same signal continues through the private
service binding.

## Private Renderer contract

Studio calls `POST https://renderer.internal/render/thumbnail` with the public
selection plus `renderId`, the resolved `outputId`, and the explicit managed
image expectation manifest. The Renderer repeats document and resource
admission, checks the page/output relation, and validates the requested size.

Browser Rendering receives a viewport equal to the requested raster size. The
HTML keeps source page coordinates inside one uniformly scaled page root, and
the screenshot call sets `fullPage: false`. The Renderer waits for the managed
font and exact image decodes, including natural-dimension verification, before
capture. It reads the PNG IHDR and rejects a response whose actual raster does
not equal the request.

Successful responses are ephemeral. The Renderer does not call `RENDERS.put`
or `RENDERS.get`, and it returns no `X-Render-Key`:

```text
Content-Type: image/png
Cache-Control: no-store
X-Render-Mode: ephemeral-thumbnail
X-Render-Id: <request render id>
X-Page-Id: <page id>
X-Output-Id: <output id>
X-Width: <actual PNG width>
X-Height: <actual PNG height>
X-Bytes: <actual response bytes>
```

Studio verifies those private response headers before completing capacity. A
private error or header drift fails the lease. Thumbnail admission is isolated
from durable artifact quotas, matches the client's three-producer concurrency,
uses the requested thumbnail pixel area, and settles with the actual response
byte count. Failed settlement RPCs remain retryable instead of stranding a
reservation until TTL expiry.

The existing full PNG request and durable R2 artifact schema are unchanged.

## Filmstrip cache and scheduling

`PageFilmstrip` keeps the active page as a live React `Artboard`, but its
thumbnail document follows React's deferred lane. Canonical inspector and
canvas commits therefore update the editor immediately while repeated
thumbnail work coalesces to the newest settled document. A memoized thumbnail
boundary prevents unrelated product-menu and shell renders from repainting
every layer. Inactive pages are admitted only when they enter the filmstrip
viewport or its 240 px horizontal preload margin. Their requests use the fitted
source-page aspect ratio at a bounded device-independent pixel ratio; the
canonical 1240 x 1754 portrait page therefore requests 102 x 144 at 2x, not the
52 x 72 bounding box.

The framework-independent raster cache owns a maximum of three simultaneous
producer calls and 64 retained entries. Identity includes document, the
selected page's canonical visual/dependency revision, renderer revision, and
raster dimensions. Global snapshot metadata is intentionally excluded: an
unrelated page edit reuses the completed raster, while a change to the selected
page invalidates only that page. Duplicate requests share work; superseded and
removed page generations are aborted before they can consume the queue or
publish stale results; and every Object URL is revoked on replacement,
eviction, clear, or disposal. The UI rechecks the current page key before
showing an image, so a prior page revision cannot flash after an edit.

When an inactive page leaves the viewport margin—or becomes the live active
page—the cache aborts queued/active work but retains an already completed LRU
entry. Fast horizontal page churn therefore cannot leave a tail of obsolete
Browser Rendering jobs. Cache ownership is safe under React Strict Mode and a
mounted producer replacement cannot issue work through the disposed cache.
Transient network, 408, 425, 429, and 5xx failures keep the bounded live
fallback visible while retrying at most three times with `Retry-After` and an
exponential floor capped at 30 seconds. Cache hits travel through the
recency-touching request path, so the 64-entry policy is true LRU under mounted
filmstrip navigation.

The 100-page mounted fixture proves viewport admission, an always-live active
page, low-resolution inactive rasters, stale observer suppression, page-local
revision replacement, removed-page cleanup, unrelated-page reuse, producer
replacement, URL revocation, content containment, and roving keyboard focus.

## Local evidence

- Renderer: 51 tests passed. The focused contracts cover invalid bounds,
  aspect mismatch, low-resolution viewport and CSS, `fullPage: false`, resource
  dimension failure before capture, PNG dimension drift, no R2 reads or writes,
  response headers, and abort preflight.
- Studio: 353 tests passed. The focused contracts cover authentication order,
  strict request policy, aspect rejection before asset work, capacity plan and
  settlement, exact private request shape, request-signal propagation, private
  response validation, and failure settlement.
- Document: 172 tests passed. The thumbnail tests cover bounds, nearest-pixel
  aspect handling, uniform scale, and requested-raster capacity accounting.
- Studio, Renderer, and Document TypeScript checks passed. Scoped Studio ESLint,
  Prettier, and diff checks passed.

## Remaining integration evidence

A healthy-host browser run must still prove actual Browser Rendering latency,
rapid page-churn cancellation, memory and Object URL release, scroll and input
latency at 100 pages, and visual parity against the live page at representative
portrait, landscape, and square sizes. Browser profiling must also quantify the
remaining per-page projection transfer and Worker startup cost before PERF-01
can be closed; snapshot registration or batching remains a measurement-driven
follow-up rather than an assumed requirement.

## 100-page real-browser interaction gate, 2026-08-29

The first real Chromium profile used one canonical 100-page / 800-node
document and the actual filmstrip scroll viewport. It exposed two production
defects that mounted tests could not show:

- development's live-Artboard fallback missed the 32 ms p95 frame budget at
  60 ms during extreme page churn;
- the renderer-backed path launched 36–41 transient requests, reached six
  browser requests at once, and delayed a page switch as long as 26.7 seconds.

The cache's producer limit was still three. The larger transport count happened
because an aborted fetch freed a client cache slot before the local Browser
Rendering process had actually stopped. Cancellation after launch was therefore
too late to protect interaction latency.

Renderer admission now waits until the horizontal filmstrip has been still for
300 ms. Scrolling resets the quiet window; pages leaving the preload margin
still cancel immediately. IntersectionObserver visibility updates are React
transitions, so a newer viewport can supersede obsolete 100-item parent work.
Ordinary development retains the live fallback; setting
`VITE_STUDIO_RENDERER_THUMBNAILS=true` profiles the deployed raster path through
Wrangler's local Browser Run simulation without remote usage.

The selected machine-readable profile is
`artifacts/perf-01-scale-profile.json`. On macOS HeadlessChrome 152 at
1440 × 900 it records:

- 100 pages and 800 canonical nodes;
- 90 alternating full-range scroll frames: 17.7 ms median, 24.2 ms p95,
  29.5 ms p99, and 32.1 ms maximum;
- page 100 acknowledgement in 361 ms;
- three thumbnail requests started, maximum concurrency three;
- one live Artboard, 87 deferred placeholders, and no completed raster or
  Object URL at the evidence boundary.

The browser gate requires renderer-backed mode, at least one request, no more
than three total starts in the measured churn window, and maximum concurrency
three. All budgets must pass before a temporary report is atomically promoted
to selected evidence, so a fallback or failed rerun cannot replace the accepted
profile. Mounted admission and existing filmstrip coverage pass 32/32; the
complete cache plus filmstrip slice passes 43/43; the Studio TypeScript gate
and scoped lint pass.

Viewport truth is recorded synchronously inside the native observer callback.
An exit clears its pending admission timer and cancels the exact raster key
before React's transition-deferred visibility publication. Mounted regressions
cover both exit before admission and immediate abort after admission.

The local Browser simulator logged Chrome readiness-probe timeouts and did not
complete a raster in this run. Therefore renderer steady-state latency, visual
parity, cache-hit behavior, and completed Object-URL retention/release remain
open. The interaction/cancellation result is valid because requests reached the
real endpoint and the evidence separately records zero completions; it is not
being used as steady-state renderer proof.

## 1,000-layer active-page interaction gate, 2026-08-29

Phase entry reread this contract, the completed NAV-01 hierarchy work,
OpenPencil's 5,000-row virtual Layers test and LayerTree implementation, and
Loora's memoized layer nodes plus viewport camera. The bounded target was one
visible 1,000-layer page: prove the canonical WebMCP model, virtualized Layers,
tail search and selection, one inspector edit, ordinary wheel pan, and
pointer-centred gesture zoom in real Chromium. It did not reopen healthy-host
Browser Rendering work.

The first run failed honestly: pan reached about 217 ms p95 because every
camera frame updated `StudioShell` React state. Camera transform and ruler paint
now update imperatively during the gesture and settle canonical React state
after 120 ms of idle. Artboard zoom uses the same preview/settlement split, so
the canvas and selection chrome scale together without browser page zoom.

The next run exposed 769–910 ms inspector edits. A CPU profile localized the
delay to a live filmstrip `Artboard` rebuilding all 1,000 React nodes. The
thumbnail document is now deferred and memoized. The canonical history path no
longer reparses an already-admitted document on every command: it validates the
command and semantic result while preserving unchanged node/page identity for
Fabric's incremental sync. The public `applyCommand` boundary still reparses
both unknown input and result and remains strict.

Independent code review rejected the first implementation on five correctness
paths that the timing fixture did not exercise. The repaired implementation
keeps guide paint, hit targets, and drag coordinate conversion on the same live
camera; projects the selected-image toolbar from that camera before React state
settles; admits history documents through schema plus semantic validation and
keeps the fast path behind an internal runtime guard; commits an image node's
Fabric identity only after an awaited source swap survives the generation
guard; and refuses crop chrome for hidden or off-page images. Focused
regressions retain each path.

`artifacts/perf-01-layer-scale-profile.json` is promoted only after all budgets
pass. Three consecutive Chromium runs passed, followed by a final passing run
after the canonical field-identity regression. The selected run records a
3,507 ms open, 33 mounted rows for a 30,038 px / 1,001-item expanded tree,
111 ms tail search, 431 ms selection acknowledgement, 258 ms inspector edit,
17.5 ms p95 pan, and 17.4 ms p95 gesture zoom. The editor/document focused
tests and affected TypeScript checks pass. Healthy-host raster completion,
visual parity, cache hits, and Object-URL release remain the separate open
renderer evidence above.

A later rerun during severe host memory/CPU pressure missed only the open-time
budget (27,279 ms versus the retained 3,507 ms) and was rejected before evidence
promotion. The selected atomic artifact above remains unchanged; the failed run
is not presented as product evidence.
