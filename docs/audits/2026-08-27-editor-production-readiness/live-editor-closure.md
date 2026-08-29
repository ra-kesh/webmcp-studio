# Live editor closure

Date: 2026-08-29

Status: completed locally and independently accepted

## Phase entry

The gate was reopened from the retained `SHELL-01`, `GUIDE-01B`, and
`PERF-01` evidence rather than from screenshots alone. The implementation was
compared again with OpenPencil's mounted editor workspace and Loora's explicit
panel/camera ownership. The required matrix was 320, 390, 1119, 1280, 1440,
and 1920 CSS pixels.

## Defects found in the real product

The first retained capture was structurally valid but visually wrong. After a
compact-to-desktop resize, the artboard remained stranded against the left
edge of a much wider canvas. At desktop widths the document and properties
panels also remained at their emergency minimums, 208 and 280 pixels, instead
of restoring the 264 and 336 pixel defaults.

Both failures had the same lifecycle cause. Their effects ran while Studio was
still showing the start surface, read a null ref, returned, and never subscribed
when the editor elements mounted. DOM overflow assertions did not expose this;
the visual capture did.

## Repair

- The shell and canvas observers now subscribe to the actual mounted element,
  not a one-shot ref read.
- Auto-fit derives the camera directly from the final measured viewport.
- Manual navigation preserves the same world point at the visual centre when
  panels or the browser viewport change size; zoom remains unchanged.
- A resize fallback complements `ResizeObserver` for browser viewport changes.
- The responsive browser matrix now proves artboard centring, exact desktop
  panel defaults, action reachability, no document overflow, compact focus
  containment, field labelling, splitter persistence, collapse/restore, and
  first-frame maximum widths.
- The local Renderer configuration uses Cloudflare's local Browser Run
  simulation. Remote Browser Run remains enabled only in the production
  Wrangler configuration.

## Retained evidence

The atomic report is `live-editor-capture-report.json`. It selects immutable
run
`artifacts/live-editor/runs/2026-08-29T13-34-36.698Z-129b1187-e1dd-4294-ae55-a8ff4eb4824a`.
The run contains exact-size PNGs and SHA-256 hashes for all six required
viewports. The capture runner waits for fonts, image decode, two painted
frames, artboard centring, and the desktop panel widths; arbitrary sleeps are
not part of acceptance. Incomplete images are awaited, broken or undecodable
images fail the run, and both document scroll dimensions and final PNG width
and height must match the requested viewport before promotion.

The six outputs were visually inspected. The page remains centred at every
width, the compact controls and filmstrip stay reachable, the 1119-to-1280
transition restores both desktop panels, and the 1920 layout uses the available
canvas instead of retaining compact camera geometry.

Focused evidence:

- viewport camera unit tests: 6/6;
- responsive/accessibility browser file: 5/5;
- editor and Studio typechecks: pass;
- independent P0/P1 review: the first pass rejected weaker image/dimension
  evidence checks; after the fail-closed repair and recapture, the reviewer
  returned **ACCEPT with no remaining P0/P1 finding** and independently
  revalidated all six files against the report's sizes, hashes, dimensions, and
  scroll measurements.
