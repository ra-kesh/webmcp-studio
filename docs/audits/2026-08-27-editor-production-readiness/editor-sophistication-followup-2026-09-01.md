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

## Editor-surface code-splitting closure

The remaining performance-polish gate was revisited against the accepted
START-01 rule that the document library and editor must not both render as
interactive surfaces. Persistence and session ownership remain shared in
`StudioShell`; this pass did not duplicate those contracts or perform a risky
route-controller rewrite. Instead, editor-only visual surfaces now cross real
lazy boundaries: the Fabric artboard, document and Inspector sidebars, page
filmstrip, ruler/guide overlay, zoom controls, empty-canvas actions, crop and
selection toolbars, text formatting, and link editing.

The production client shell fell from 1,114.50 kB minified / 290.16 kB gzip to
672.77 kB / 175.75 kB. The editor surfaces are emitted as independently named
chunks, including 19.98 kB for the artboard shell, 73.80 kB for the document
sidebar, 126.23 kB for Inspector, and 20.95 kB for the filmstrip. Fabric's
373.45 kB adapter remains cold until a document opens. The 500 kB warning is
still visible for the remaining shell and has not been hidden by raising the
limit.

A temporary production preview on port 4173 was started only for measurement
and stopped immediately afterward. Its start page measured 766 ms LCP and
0.00 CLS at 1x CPU/network. The complete start-page request inventory contained
none of the editor-only chunks. Opening the opt-in six-page sample then loaded
those chunks on demand and produced the complete toolbar, canvas, page strip,
document panel, and Inspector accessibility tree. The focused shell/session
matrix passed 15/15, Studio typecheck passed, and the full client, SSR, and
renderer production build passed.

That production-preview document also made the configured remote Browser
Rendering binding exercise real page-thumbnail requests. Parallel browser
creation exceeded the account's current Browser Rendering new-browser rate
limit and returned 429 errors through the local thumbnail endpoint. This was
not a code-splitting failure: the interactive editor and lazy surfaces mounted
correctly. It did expose a product-policy error: production editing enabled
remote thumbnails implicitly, while only development used the existing local
fallback.

Renderer-backed filmstrip and recent-document previews now require the exact
`VITE_STUDIO_RENDERER_THUMBNAILS=true` opt-in. Ordinary development and
production use the viewport-bounded local preview path, so opening the library
or a six-page document makes no page-thumbnail request and consumes no Browser
Run time. A rebuilt production preview proved the start card and all six
filmstrip pages remained visible, the editor stayed console-clean, and the
complete fetch/XHR inventory contained no `POST /v1/studio/page-thumbnail`.
The focused preview/producer suites pass 14/14 and Studio typecheck plus the
full production build pass. The server-rendered path remains available for
deliberate conformance evidence; no deployment or remote data mutation
occurred.

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

Publish and API-playground overlays were then opened from the same live
document and remained geometrically bounded with their current validation and
immutable-version states intact. This check found two sources of avoidable
DevTools noise. An unpublished document requested its missing immutable stream
through the public 404 contract even though absence is an expected editor
state, and several editor search/commit controls had an accessible label but
no stable HTML field identity. Internal publication discovery now requests the
same endpoint with `missing=empty`, which preserves the public 404 default but
returns 204 for the expected empty state. Search, commit, picker and hidden
import controls now carry stable `name` or `id` values. A cache-free editor
reload, unlocked Inspector selection, and both overlays now produce no console
errors, warnings, or browser issues. Studio typecheck and the focused
workspace-publication isolation regression pass.

The remaining primary shell surfaces were also opened live: Export, document
file actions, the application menu, Variables, Fields and Review. Their menus,
empty states and panel geometry remain bounded at the default layout, and the
document panel's keyboard resize path was exercised at its 208 px minimum.
This found one Review dead end: when the current browser cannot expose WebMCP,
the panel disabled **Copy demo brief**, even though copying the brief for a
supported browser is precisely the useful next action. The empty-state copy
now explains that handoff and remains available; the clipboard action was
confirmed live and the Inspector sidebar suite passes 11/11.

The full start surface was then exercised in both Recent and Trash, in list
view, through document actions, the rename dialog, the blank-document dialog,
template details, and the device-file import trigger. Its wide layout,
collection states, dialogs, and action geometry remain bounded and visually
coherent. That pass exposed seven native template filter controls whose visible
labels and accessible names were correct but whose HTML identities were not:
the controls had neither `id` nor `name`. Every filter now has a unique
React-stable identifier, an explicit label association, and a durable form
name. A cache-free reload reports no missing field identities, duplicate IDs,
console errors, warnings, or browser issues. The focused template-browser
suite passes 20/20 and Studio typecheck passes.

The compact start catalog also had no true mobile layout: its container logic
never returned fewer than two columns, producing 228 px cards even at the
smallest Chrome test viewport and leaving substantially less at the specified
390/320 px gates. The start catalog now uses one column below a 560 px content
width, then deliberately steps through two, three, and four columns. Live 500
px inspection shows a 468 px card with readable title, dimensions, and separate
44 px favorite/action targets; at 640 px it returns to two 290 px cards without
horizontal overflow. The responsive boundary is covered in the focused suite,
which now passes 21/21, and Studio typecheck remains green.

Native mobile/touch emulation then exercised the actual 390 px and 320 px
acceptance widths. At 390 px the editor preserves its compact two-row shell,
centered fit-page canvas, horizontal page filmstrip and four-control zoom bar;
the document drawer becomes a single-column template browser, the canonical
Layers tree remains legible, and the selected rectangle Inspector exposes its
full position, opacity, paint, fill and stroke controls without horizontal
overflow. The start catalog uses 358 px cards with separate favorite and action
targets. At 320 px the start heading wraps deliberately and the blank-document
dialog remains inside a 288 px surface with an internal scroll region. Invalid
dimensions move focus to the exact field and announce the inline error. Both
mobile widths completed with no console error, warning, browser issue,
duplicate ID or document-level horizontal overflow.

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
