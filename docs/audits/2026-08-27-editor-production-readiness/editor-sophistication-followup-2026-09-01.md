# Editor sophistication follow-up

Date: 2026-09-01

Status: accepted on `main` after the accepted general-mask merge

## Revisited evidence

Before editing, this pass reread `editor-sophistication-full-phase-entry.md`,
`reference-patterns.md`, and the retained OpenPencil, Loora, Canva-style, Geist,
and shadcn decisions recorded there. The accepted panel geometry, command
projection, 11 px chrome floor, coarse-pointer targets, dark workspace,
reduced-motion behavior, and continuous-control transaction model remain
frozen regression gates.

The current build was then exercised at `http://localhost:3001` through the
real start surface, Recent documents, template catalog, a six-page quotation,
the hierarchical Layers tree, a selected locked text layer, an editable
template-backed text layer, and one color edit followed by Undo. Local D1 was
migrated from `0015` through `0019`; the previously visible library error then
disappeared and the catalog loaded normally. No remote migration or deployment
was performed.

## Observed follow-up defects

1. Returning from a document to the start surface programmatically focuses the
   H1 for assistive-technology continuity, but the heading inherited Chrome's
   large native outline. The result looked like a broken input around the hero
   title. Keep the focus transfer and suppress decoration on this non-interactive
   programmatic focus target.
2. `studio-persistence-layout.test.ts` lived directly under the TanStack route
   directory without the configured `-` ignore prefix. Development and every
   production build repeatedly warned that it was not a route. Keep the test in
   place but rename it to the route generator's explicit ignored form.
3. The production build remains truthful but heavy: the client Studio shell is
   about 1.26 MB minified / 330 kB gzip. Treat route/dialog/panel code splitting
   as the next performance-polish gate; do not hide the warning by increasing
   the limit.

## Measured startup split

The cold editor surfaces now load only when opened: new document, draft
replacement, recovery and conflict handling, quotation refresh, publishing,
API playground, asset library, guide management, command search, keyboard
shortcuts, layer rename, and structure-command dialogs. Their shared command
identity and filtering model lives outside the command-palette component so a
small helper import cannot pull the dialog back into the startup graph.

The final production client Studio shell is 1,113.44 kB minified / 289.79 kB
gzip, down from approximately 1,260.42 kB / 329.86 kB. That removes 146.98 kB
minified and 40.07 kB gzip from the initial shell (about 12%) without raising
the bundle warning threshold. Vite emits separate named chunks for every cold
surface and no longer reports an ineffective command-palette dynamic import.

The live application on port 3001 was used to open and close the new-document,
Publish, API playground, Assets, and command-search surfaces after the split.
The active document route remained intact and no dialog was left mounted.
Focused shell and command tests passed 35/35; Studio typecheck, production
client/SSR/renderer builds, formatting, and diff checks passed.

The complete five-journey responsive-shell browser gate also passes on the
committed product. Its first run exposed two historical accessible-name
assertions left behind by accepted UI changes: Gate 8 renamed the compact
template action to **Create from template**, and the visible density toggle is
named **Use comfortable page strip**. Captures proved both controls remained
present and usable; the regression now asserts their current product labels.
The two repaired cases passed 2/2, followed by the complete gate at 5/5.

## Core interaction recertification

The Inspector and canvas-gesture Playwright gates still booted the pre-library
application at `/` and, for Inspector, wrote the retired localStorage draft.
They could therefore time out on the healthy Start surface without exercising
the product. Both now open the routed sample document. Inspector derives its
fixture from the canonical IndexedDB draft and imports it through Studio's
validated JSON boundary instead of mutating obsolete storage.

The current Inspector gate passes 4/4. Its added native color-picker journey
dispatches six continuous inputs, proves preview creates no document revision,
commits exactly one revision on change, restores the original fill through
Undo, and records no page error. The canvas gesture gate passes 3/3: modifier
wheel zoom changes only Studio's canvas zoom, ordinary wheel input pans without
zooming, and wheel cancellation is scoped away from the sidebar and dialogs.
The camera transform now has an explicit `data-canvas-camera` identity so ruler
and guide overlays cannot make the regression inspect the wrong element.

## Layers search hit-target repair

The full Layers browser gate found a genuine desktop and scale-path defect:
the browser-native search cancel control and Studio's clear button occupied the
same field, and the search input intercepted real clicks intended for the
visible Studio action. The repair disables native search decoration and gives
the search field and clear action distinct adjacent geometry; compact keeps a
44 px clear target and desktop keeps a dense 28 px control. The live editor
clears the query through the visible button, and the complete hierarchy,
rename, atomic reorder, selection, aggregate lock/visibility, drag-reparent,
compact and 1,000-layer browser matrix passes 10/10.

## Curated-image selection crash repair

The complete media-production journey exposed a render-time identity error
after inserting a curated Library image. The document mutation itself used the
correct exact catalog identity and canonical curated resource path. The Studio
shell then asked whether the selected image was eligible for background
removal by constructing a managed-asset source from that curated ID. Because
managed upload IDs intentionally use a stricter namespace, the constructor
threw during React render and the route error boundary replaced the editor.

The shell now classifies eligibility by parsing the selected node's persisted
source and comparing the parsed managed ID with the node identity. It no longer
constructs or validates a managed source merely to test its type. Curated and
device-local images therefore remain valid editor selections while background
removal stays limited to workspace-managed uploads. The focused curated insert
journey and the four geometry-safe inspector replacement/recovery journeys pass
without a page error. The complete 18-journey media-production matrix passes.
Its compact geometry assertion now waits for the existing 100 ms dialog-open
animation to settle before measuring the full-viewport surface, eliminating a
timing-only 390 px false failure without weakening the geometry requirement.

## Curated-image publish and render closure

The complete edit-to-artifact journey then found two independent contract gaps
that focused editor and media tests could not exercise. First, request-owned
render preparation could resolve first-party files through the Cloudflare
static-assets binding, but the durable Workflow repeated preparation without
the caller's request origin. That is valid in production, where an assets
binding routes by pathname, but the Cloudflare Vite binding is a development
service backed by the active Vite origin. The accepted request origin now
travels as execution context in the Workflow payload and attempt plan, so every
durable preparation step resolves the same approved first-party path. The
document and persisted public render request remain origin-free.

Second, Studio correctly preserved curated identities such as
`olive-botanical` in the renderer admission manifest, while the private
renderer schema incorrectly restricted every image expectation to the
workspace-upload `asset-...` namespace. The image-resource expectation schema
now lives in the shared document package and accepts the bounded identity space
already supported by image nodes and checksum admission. The renderer imports
that schema instead of maintaining a narrower duplicate. Exact node identity,
inline bytes, SHA-256 digest, natural dimensions, and revision checks remain
mandatory.

The repaired path was first proved directly through the local Cloudflare
Workflow: a published seven-page template with a curated image completed and
stored a 315,688-byte PDF artifact. The complete browser journey then passed
1/1 in 25.2 seconds, covering start surface, template selection, editing,
curated-image insertion, publish, durable Workflow execution, artifact
download, PDF signature, seven-page inspection, and rendered text.

## Live product-cleanliness follow-up

The running editor was inspected at 1,440, 1,280, 1,024, 768 and 640 CSS-pixel
widths after the artifact journey. The wide three-column shell and the compact
canvas-first shell both preserve a usable toolbar, centered page, page strip,
panel entry points and zoom controls. The Inspector's native fill control was
also exercised with 48 continuous color inputs on a newly inserted rectangle.
Every update completed on the next animation frame (16.3 ms average, 17.8 ms
maximum), the document autosaved, Undo restored the original state, and no page
error occurred.

That live pass did expose one visible default-width defect: Media's four source
tabs used content-sized 24 px horizontal padding, pushing **Favorites** beyond
the 264 px document panel and presenting a clipped label. The source tabs now
share the available width with compact typography and remain fully visible at
the default panel width. The repaired surface was verified in the live
Cloudflare/Vite application and the focused Media browser suite passes 18/18.

## Acceptance

- the start heading still receives programmatic focus after returning home but
  no longer paints a false input-like outline;
- route generation and both production builds run without the false route-file
  warning;
- focused start-surface and route-layout tests pass;
- Studio typecheck, formatting, and diff checks pass;
- curated first-party images survive publish, durable Workflow preparation,
  private-renderer admission, and inspectable PDF output;
- the editor entry chunk is measurably smaller without changing command,
  document, Inspector, renderer, or WebMCP semantics.
