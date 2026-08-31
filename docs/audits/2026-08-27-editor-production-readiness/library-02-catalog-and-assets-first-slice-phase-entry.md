# LIBRARY-02 catalog and Assets first-slice entry

Date: 2026-08-31

Status: implementation checkpoint

Branch baseline: `e719a3e`

## Why this slice exists

The original production-readiness audit described templates as three
quotation themes and media as a one-use upload path. That is no longer true.
The checked-in catalog now has 21 active templates, including 18 document
starters, 37 curated media items, immutable raster template previews, exact
media content identities, search and taxonomy filters, durable favorites,
recent use, collections, and source-aware media actions.

The remaining product problem is reachability. The editor's left tab is named
Assets but contains only document-local components. Reusable media can be
found only after opening a focused insert, replace, or field-assignment dialog.
That makes a real catalog feel like a file picker and leaves the editor below
the Canva-like browse-and-insert workflow named in `LIBRARY-02`.

## Evidence read before implementation

- the original production-readiness audit and the current remaining-work
  ledger;
- the LIBRARY-02 phase entry, Gate 5 preference plan, Gate 6 integration map,
  shared media browser UI contract, and exact-action preflight;
- the built-in template manifests, preview manifest and producer, curated
  media manifest, discovery providers, shared template/media browsers,
  preference projection, asset dialog, component panel, and editor shell;
- the checked-in Canva clone's dashboard template cards, editor template
  sidebar, image sidebar, and create-project flow;
- the checked-in OpenPencil and Loora asset-panel references named by the Gate
  6 preflight;
- the Orshot-style generation notes and Studio's existing durable render-job
  boundary.

The reference result is specific. Canva makes templates and media browsable
before a person understands the canvas, while Studio must keep its stricter
exact identity, provenance, permission, history, and renderer checks. The
Orshot workflow is already represented by immutable template versions and
durable render jobs. This slice does not change that workflow.

## Current gaps

1. The Assets tab label and its contents disagree. It opens Components with no
   path to the 37-item media catalog.
2. Media discovery, thumbnails, categories, Favorites, collections, Recent,
   Studio library, and workspace uploads exist only inside a modal task.
3. The editor has no persistent browse-and-insert path. People must reopen the
   dialog for every ordinary image insertion.
4. Component empty states are useful, but the parent Assets area has no clear
   Media versus Components organization.
5. The exact media action session owns cancellation, usage receipts, warnings,
   and focus recovery for dialogs. A persistent surface must reuse that owner,
   not call document mutation directly.

## First-slice boundary

This checkpoint adds one Assets workspace with Media and Components views.
Media mounts the accepted shared browser in compact density and supports
ordinary insertion into the active page. Components keeps its existing
document-local create, insert, and source-navigation behavior.

The persistent Media view uses the same route-owned media discovery provider,
exact detail resolution, source-aware preparation, canonical document command,
post-commit Recent receipt, and retryable usage warning path as the focused
dialog. It does not create a second catalog controller or media repository.

The existing focused dialog remains the owner for replace, image-field
assignment, upload management, archive impact, promotion, and missing-local
recovery.

## Exact exit criteria

The slice is accepted only when all of the following are true:

- Assets visibly contains Media and Components views on desktop and compact
  layouts.
- Media exposes Recent, Uploads, Studio library, Favorites, collections,
  search, category/use-case/format/orientation filters, exact thumbnails,
  details, and the accepted loading, failure, empty-catalog, no-results, and
  local-inventory states through the shared browser.
- Selecting media from Assets inserts into the active page through the same
  exact action performer used by the dialog. A successful insert is one named
  document command and records usage only after commit.
- Inline insertion does not flash or mount the focused media dialog. Pending
  identity and failure copy remain visible in the Assets browser, and a later
  selection can retry.
- Leaving the Media view, switching documents, or unmounting aborts stale
  inline work. Review or quotation-refresh locks disable insertion without
  hiding discovery.
- Components retain create, insert, focus-source, search, and empty-state
  behavior without a second copy of component state.
- Compact targets remain at least 44 CSS pixels and the Assets workspace has
  one scroll owner.
- Focused component tests cover view switching and state preservation. Media
  session tests cover inline success, rejection, cancellation, and the absence
  of dialog presentation. Studio typecheck and `git diff --check` pass.

## Deliberate exclusions

This slice does not change template or media schemas, manifest provenance,
renderer cutover, publication, WebMCP tools, general masks, frame masks, image
commands, upload/archive/recovery semantics, or port 3000. It does not add team
labels, remote search, AI generation, drag-and-drop, or cross-document
components.

Catalog expansion beyond the accepted 21 templates and 37 media items belongs
to a later content checkpoint. This first slice makes the existing breadth
usable throughout the editor before adding more inventory.
