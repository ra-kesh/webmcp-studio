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

`PageFilmstrip` keeps the active page as the live React `Artboard`, preserving
the editor's immediate renderer acknowledgement. Inactive pages are admitted
only when they enter the filmstrip viewport or its 240 px horizontal preload
margin. Their requests use the fitted source-page aspect ratio at a bounded
device-independent pixel ratio; the canonical 1240 x 1754 portrait page
therefore requests 102 x 144 at 2x, not the 52 x 72 bounding box.

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
